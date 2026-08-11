/**
 * LIVE — Real-Time Sports Operations Center
 * Powered by SSE delta updates via realtimeService + polling fallback.
 * AppState-aware: pauses SSE/polling when app goes to background.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView,
  RefreshControl, ActivityIndicator, Animated, Easing, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import MatchCard from '@/components/feature/MatchCard';
import { FONTS, RADIUS, SPACING, SPORTS, getSportIcon } from '@/constants/theme';
import type { Match } from '@/services/types';
import { getDateNavItems, getUTCRangeForLocalDate, isSameLocalDay, type DateNavItem } from '@/services/dateUtils';
import { fetchMatchesByDate } from '@/services/matchService';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { getLiveMatches, getRecentMatches } from '@/services/supabase';
import {
  useLiveScores,
  useRealtimeMatchList,
} from '@/services/realtimeService';

// ─── Types ────────────────────────────────────────────────────────────────────
type DataSource = 'sse' | 'polling' | 'supabase' | 'loading';

// ─── 13 canonical sports only (boxing + esports added; formula1/afl removed) ──
const SPORT_EMOJI: Record<string, string> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
  mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉',
  handball: '🤾', volleyball: '🏐', 'american-football': '🏈',
  boxing: '🥊', esports: '🎮',
};

// ─── DB sport key → display name (13 canonical sports) ─────────────────────
const DB_SPORT_TO_DISPLAY: Record<string, string> = {
  football: 'Football', basketball: 'Basketball', tennis: 'Tennis',
  baseball: 'Baseball', hockey: 'Hockey', rugby: 'Rugby',
  handball: 'Handball', volleyball: 'Volleyball',
  'american-football': 'American Football', americanfootball: 'American Football',
  cricket: 'Cricket', mma: 'MMA',
  boxing: 'Boxing', esports: 'Esports',
};

function dbSportToDisplay(sport: string): string {
  return (
    DB_SPORT_TO_DISPLAY[sport.toLowerCase()] ??
    DB_SPORT_TO_DISPLAY[sport.toLowerCase().replace(/[\s-]+/g, '')] ??
    sport.charAt(0).toUpperCase() + sport.slice(1)
  );
}

// ─── Group by sport (13 canonical sports display order) ─────────────────────
const DISPLAY_SPORT_ORDER = [
  'Football', 'Basketball', 'Tennis', 'Cricket', 'Baseball',
  'Hockey', 'Rugby', 'Handball', 'Volleyball', 'American Football',
  'MMA', 'Boxing', 'Esports',
];

function groupBySport(matches: Match[]) {
  const map: Record<string, Match[]> = {};
  matches.forEach(m => {
    const key = dbSportToDisplay(m.sport);
    if (!map[key]) map[key] = [];
    map[key].push(m);
  });
  const sorted = [
    ...DISPLAY_SPORT_ORDER.filter(s => map[s]),
    ...Object.keys(map).filter(s => !DISPLAY_SPORT_ORDER.includes(s)),
  ];
  return sorted.filter(s => (map[s]?.length ?? 0) > 0).map(s => ({ sport: s, matches: map[s] }));
}

// ─── SSE-powered Live Hook ────────────────────────────────────────────────────
/**
 * Loads match list from Supabase for the selected local calendar date.
 * Live matches are always included regardless of date selection.
 * AppState listener reloads when app resumes from background.
 */
function useLiveTab(sport: string, selectedDate: Date) {
  const [baseMatches, setBaseMatches] = useState<Match[]>([]);
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>('loading');
  const sportRef = useRef(sport);
  const dateRef = useRef(selectedDate);
  sportRef.current = sport;
  dateRef.current = selectedDate;

  // SSE / polling subscription for the current sport scope
  const sportKey = sport === 'All' ? 'all' : sport.toLowerCase().replace(/\s+/g, '-');
  const { scores, liveCount } = useLiveScores(sportKey);

  // Merge SSE delta updates into base match list
  const liveMatches = useRealtimeMatchList(baseMatches, sportKey);

  // Derive data source label from scores map size
  useEffect(() => {
    if (scores.size > 0) {
      setDataSource(typeof EventSource !== 'undefined' ? 'sse' : 'polling');
    }
  }, [scores.size]);

  const loadBase = useCallback(async (silent = false) => {
    try {
      const sp = sportRef.current !== 'All'
        ? sportRef.current.toLowerCase().replace(/\s+/g, '-')
        : undefined;

      // Use date-bounded query for proper local-timezone fixture filtering.
      // fetchMatchesByDate uses UTC boundaries derived from the device's timezone
      // so a match at 23:30 UTC appears on the correct local date.
      const isToday = isSameLocalDay(dateRef.current, new Date());

      if (isToday) {
        // For today: always include live matches + today's day-bounded window
        const [live, recent, dayMatches] = await Promise.all([
          getLiveMatches(sp),
          getRecentMatches(sp, 24),
          fetchMatchesByDate(dateRef.current, sp),
        ]);
        // Merge: live first, then day-bounded, then recent finished — dedup by id
        const seenIds = new Set<string>();
        const merged: Match[] = [];
        for (const m of [...live, ...dayMatches, ...recent]) {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); merged.push(m); }
        }
        setBaseMatches(merged.filter(m => m.status === 'live' || m.status === 'upcoming'));
        setFinishedMatches(merged.filter(m => m.status === 'finished'));
      } else {
        // Past or future date: use UTC-boundary query for that specific local day
        const dayMatches = await fetchMatchesByDate(dateRef.current, sp);
        setBaseMatches(dayMatches.filter(m => m.status !== 'finished'));
        setFinishedMatches(dayMatches.filter(m => m.status === 'finished'));
      }

      setLastUpdated(Date.now());
      setDataSource(typeof EventSource !== 'undefined' ? 'sse' : 'polling');
    } catch {
      /* non-blocking */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + reload when sport OR date filter changes
  useEffect(() => {
    setLoading(true);
    setBaseMatches([]); // Clear stale data before loading new selection
    setFinishedMatches([]);
    loadBase();
  }, [sport, selectedDate.toDateString()]);

  // Re-load base list when app resumes from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') loadBase(true);
    });
    return () => sub.remove();
  }, [loadBase]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBase(true);
    setRefreshing(false);
  }, [loadBase]);

  return {
    liveMatches,
    finishedMatches,
    loading,
    refreshing,
    onRefresh,
    lastUpdated,
    liveCount,
    dataSource,
  };
}

// ─── Date Navigation Bar ──────────────────────────────────────────────────────
function DateNavBar({
  selectedDate,
  onSelect,
  C,
}: {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  C: import('@/constants/theme').AppColors;
}) {
  const items = getDateNavItems();
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    const idx = items.findIndex(i => isSameLocalDay(i.date, selectedDate));
    if (idx >= 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: Math.max(0, idx * 68 - 40), animated: true });
    }
  }, [selectedDate]);

  return (
    <View style={[dnb.wrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={dnb.row}
      >
        {items.map(item => {
          const isSelected = isSameLocalDay(item.date, selectedDate);
          return (
            <Pressable
              key={item.offset}
              onPress={() => onSelect(item.date)}
              style={[dnb.chip, { borderColor: isSelected ? '#6EDC1F' : C.border, backgroundColor: isSelected ? 'rgba(110,220,31,0.12)' : C.card }]}
              accessibilityLabel={`Select ${item.label}`}
            >
              <Text style={[dnb.dayInitial, { color: isSelected ? '#6EDC1F' : C.textMuted }]}>
                {item.dayInitial}
              </Text>
              <Text style={[dnb.dayNum, { color: isSelected ? '#6EDC1F' : C.textPrimary }]}>
                {item.dayNumber}
              </Text>
              {item.isToday ? (
                <View style={[dnb.todayDot, { backgroundColor: '#6EDC1F' }]} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const dnb = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  row: { paddingHorizontal: SPACING.md, paddingVertical: 8, gap: 8 },
  chip: {
    alignItems: 'center', justifyContent: 'center',
    width: 52, paddingVertical: 7, borderRadius: RADIUS.lg, borderWidth: 1.5, gap: 1,
  },
  dayInitial: { fontSize: 10, fontWeight: FONTS.semiBold, letterSpacing: 0.3 },
  dayNum: { fontSize: 16, fontWeight: FONTS.extraBold, lineHeight: 20 },
  todayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 1 },
});

// ─── Pulsing dot ──────────────────────────────────────────────────────────────
function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.15, duration: 600, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    a.start();
    return () => a.stop();
  }, []);
  return (
    <Animated.View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: color, opacity: op,
      }}
    />
  );
}

// ─── Live Match Hero ──────────────────────────────────────────────────────────
function LiveMatchHero({ match, C, onPress }: { match: Match; C: AppColors; onPress: () => void }) {
  const abbr = (name: string) =>
    name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [lmh.card, { borderColor: '#FF475744' }, pressed ? { opacity: 0.9 } : null]}
    >
      <LinearGradient
        colors={['#2D0A10', '#1A0508']}
        style={lmh.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={lmh.header}>
          {match.leagueLogo ? (
            <Image source={{ uri: match.leagueLogo }} style={lmh.leagueLogo} contentFit="contain" />
          ) : null}
          <Text style={[lmh.league, { color: 'rgba(255,255,255,0.55)' }]} numberOfLines={1}>
            {match.league}
          </Text>
          <View style={lmh.liveBadge}>
            <PulseDot color="#FF4757" size={6} />
            <Text style={lmh.liveText}>
              LIVE {match.minute ? `${match.minute}'` : ''}
            </Text>
          </View>
        </View>

        <View style={lmh.teamsRow}>
          <View style={lmh.team}>
            {match.homeLogo ? (
              <Image source={{ uri: match.homeLogo }} style={lmh.teamLogo} contentFit="contain" />
            ) : (
              <View style={lmh.logoPlaceholder}>
                <Text style={lmh.logoAbbr}>{abbr(match.homeTeam)}</Text>
              </View>
            )}
            <Text style={lmh.teamName} numberOfLines={2}>{match.homeTeam}</Text>
          </View>

          <View style={lmh.scoreCol}>
            <Text style={[lmh.score, { color: '#FF4757' }]}>
              {match.homeScore} - {match.awayScore}
            </Text>
            <View style={lmh.minRow}>
              <PulseDot color="#FF4757" size={5} />
              <Text style={lmh.minText}>{match.minute ?? 0}'</Text>
            </View>
          </View>

          <View style={[lmh.team, lmh.teamRight]}>
            {match.awayLogo ? (
              <Image source={{ uri: match.awayLogo }} style={lmh.teamLogo} contentFit="contain" />
            ) : (
              <View style={lmh.logoPlaceholder}>
                <Text style={lmh.logoAbbr}>{abbr(match.awayTeam)}</Text>
              </View>
            )}
            <Text style={lmh.teamName} numberOfLines={2}>{match.awayTeam}</Text>
          </View>
        </View>

        <Pressable onPress={onPress} style={lmh.pickBtn}>
          <FontAwesome5 name="brain" size={11} color="#FF4757" />
          <Text style={lmh.pickBtnText}>View AI Prediction</Text>
          <Ionicons name="chevron-forward" size={13} color="#FF4757" />
        </Pressable>
      </LinearGradient>
    </Pressable>
  );
}

const lmh = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: 10 },
  gradient: { padding: SPACING.md, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leagueLogo: { width: 16, height: 16, borderRadius: 3 },
  league: { flex: 1, fontSize: 11 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,71,87,0.15)', borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)',
    paddingHorizontal: 8, paddingVertical: 3,
  },
  liveText: { fontSize: 10, fontWeight: '800', color: '#FF4757', letterSpacing: 0.6 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { flex: 1, alignItems: 'center', gap: 5 },
  teamRight: {},
  teamLogo: { width: 52, height: 52, borderRadius: 8 },
  logoPlaceholder: {
    width: 52, height: 52, borderRadius: 8,
    backgroundColor: 'rgba(255,71,87,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  logoAbbr: { fontSize: 14, fontWeight: '800', color: '#FF4757' },
  teamName: { fontSize: 11, fontWeight: FONTS.semiBold, color: '#fff', textAlign: 'center', lineHeight: 15 },
  scoreCol: { alignItems: 'center', gap: 5 },
  score: { fontSize: 30, fontWeight: '900', lineHeight: 34 },
  minRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  minText: { fontSize: 11, fontWeight: '700', color: '#FF4757' },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: 'rgba(255,71,87,0.3)', backgroundColor: 'rgba(255,71,87,0.08)',
    paddingVertical: 9,
  },
  pickBtnText: { fontSize: 13, fontWeight: FONTS.bold, color: '#FF4757' },
});

// ─── Sport Section Header ─────────────────────────────────────────────────────
function SportHeader({ sport, count, expanded, onToggle, isFinished, C, onNavigate }: {
  sport: string; count: number; expanded: boolean; onToggle: () => void;
  isFinished?: boolean; C: AppColors; onNavigate: (s: string) => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        sph.wrap,
        { backgroundColor: C.card, borderColor: C.border },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <Pressable onPress={() => onNavigate(sport)} hitSlop={4} style={sph.emojiBtn}>
        <Text style={sph.emoji}>{getSportIcon(sport)}</Text>
      </Pressable>
      <Text style={[sph.label, { color: C.textPrimary }]}>{sport}</Text>
      <View style={[sph.countBadge, {
        backgroundColor: isFinished ? C.surface : '#FF475718',
        borderColor: isFinished ? C.border : '#FF475733',
      }]}>
        <Text style={[sph.countText, { color: isFinished ? C.textMuted : '#FF4757' }]}>{count}</Text>
      </View>
      {isFinished ? (
        <View style={[sph.statusBadge, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="checkmark-circle" size={10} color={C.textMuted} />
          <Text style={[sph.statusText, { color: C.textMuted }]}>FT</Text>
        </View>
      ) : (
        <View style={[sph.statusBadge, { backgroundColor: '#FF475718', borderColor: '#FF475733' }]}>
          <PulseDot color="#FF4757" size={5} />
          <Text style={[sph.statusText, { color: '#FF4757' }]}>LIVE</Text>
        </View>
      )}
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
    </Pressable>
  );
}

const sph = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  emojiBtn: { padding: 2 },
  emoji: { fontSize: 18 },
  label: { flex: 1, fontSize: 15, fontWeight: FONTS.bold },
  countBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  countText: { fontSize: 12, fontWeight: '900' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
  },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
});

// ─── Source / Connection Indicator ───────────────────────────────────────────
function SourcePill({ source, liveCount, C }: { source: DataSource; liveCount: number; C: AppColors }) {
  const MAP: Record<DataSource, { label: string; color: string }> = {
    sse:      { label: `⚡ SSE · live delta updates`, color: '#22C55E' },
    polling:  { label: `🔄 Polling · 10s refresh`, color: C.accentBlue },
    supabase: { label: `🗄 Supabase · on demand`, color: C.accentBlue },
    loading:  { label: 'Connecting...', color: C.textMuted },
  };
  const m = MAP[source] ?? MAP.loading;
  return (
    <View style={[sp.wrap, { backgroundColor: `${m.color}14`, borderColor: `${m.color}33` }]}>
      {source !== 'loading' ? (
        <PulseDot color={m.color} size={6} />
      ) : (
        <ActivityIndicator size={8} color={m.color} />
      )}
      <Text style={[sp.text, { color: m.color }]}>{m.label}</Text>
      {liveCount > 0 ? (
        <View style={[sp.countBadge, { backgroundColor: `${m.color}22` }]}>
          <Text style={[sp.countText, { color: m.color }]}>{liveCount} live</Text>
        </View>
      ) : null}
    </View>
  );
}

const sp = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start',
  },
  text: { fontSize: 10, fontWeight: FONTS.semiBold },
  countBadge: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 1 },
  countText: { fontSize: 9, fontWeight: FONTS.extraBold },
});

// ─── Last Updated bar ─────────────────────────────────────────────────────────
function UpdatedBar({ lastUpdated, source, C }: {
  lastUpdated: number; source: DataSource; C: AppColors;
}) {
  const [ago, setAgo] = useState('just now');
  useEffect(() => {
    const update = () => {
      if (!lastUpdated) return;
      const d = Math.floor((Date.now() - lastUpdated) / 1000);
      setAgo(
        d < 5 ? 'just now' : d < 60 ? `${d}s ago` : `${Math.floor(d / 60)}m ago`
      );
    };
    update();
    const id = setInterval(update, 5_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const srcColor = source === 'sse' ? '#22C55E' : C.accentBlue;
  return (
    <View style={[rb.wrap, { borderTopColor: C.border }]}>
      <View style={rb.left}>
        <Ionicons name="time-outline" size={11} color={C.textMuted} />
        <Text style={[rb.text, { color: C.textMuted }]}>Synced {ago}</Text>
      </View>
      <View style={rb.right}>
        {source === 'sse' ? (
          <>
            <PulseDot color={srcColor} size={5} />
            <Text style={[rb.text, { color: srcColor }]}>Live stream active</Text>
          </>
        ) : source === 'polling' ? (
          <>
            <Ionicons name="sync-outline" size={11} color={srcColor} />
            <Text style={[rb.text, { color: srcColor }]}>Auto-refresh every 10s</Text>
          </>
        ) : (
          <Text style={[rb.text, { color: C.textMuted }]}>Pull to refresh</Text>
        )}
      </View>
    </View>
  );
}

const rb = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 10, borderTopWidth: 1,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 10 },
});

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ sport, C }: { sport: string; C: AppColors }) {
  return (
    <View style={[es.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[es.iconWrap, { backgroundColor: 'rgba(255,71,87,0.08)', borderColor: 'rgba(255,71,87,0.15)' }]}>
        <Text style={{ fontSize: 36 }}>📺</Text>
      </View>
      <Text style={[es.title, { color: C.textSecondary }]}>
        {sport !== 'All' ? `No Live ${sport}` : 'No Live Matches'}
      </Text>
      <Text style={[es.body, { color: C.textMuted }]}>
        No matches in progress right now.{'\n'}Check back soon or pull to refresh.
      </Text>
    </View>
  );
}

const es = StyleSheet.create({
  wrap: {
    alignItems: 'center', borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: 44, paddingHorizontal: 28, gap: 12,
    marginHorizontal: SPACING.md,
  },
  iconWrap: { width: 80, height: 80, borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  body: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LiveScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const [sport, setSport] = useState('All');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

  const {
    liveMatches,
    finishedMatches,
    loading,
    refreshing,
    onRefresh,
    lastUpdated,
    liveCount,
    dataSource,
  } = useLiveTab(sport, selectedDate);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedFt, setExpandedFt] = useState<Record<string, boolean>>({});

  // Filter by selected sport chip
  const filteredLive = useMemo(() =>
    sport === 'All' ? liveMatches : liveMatches.filter(m =>
      dbSportToDisplay(m.sport) === sport ||
      m.sport.toLowerCase().replace(/[\s-]+/g, '') === sport.toLowerCase().replace(/[\s-]+/g, '')
    ),
    [liveMatches, sport]
  );

  const filteredFt = useMemo(() =>
    sport === 'All' ? finishedMatches : finishedMatches.filter(m =>
      dbSportToDisplay(m.sport) === sport ||
      m.sport.toLowerCase().replace(/[\s-]+/g, '') === sport.toLowerCase().replace(/[\s-]+/g, '')
    ),
    [finishedMatches, sport]
  );

  const liveGroups = useMemo(() =>
    sport === 'All' ? groupBySport(filteredLive) : [],
    [filteredLive, sport]
  );
  const ftGroups = useMemo(() =>
    sport === 'All' ? groupBySport(filteredFt) : [],
    [filteredFt, sport]
  );

  // Auto-expand new live sport groups, collapse finished by default
  useEffect(() => {
    const defs: Record<string, boolean> = {};
    liveGroups.forEach(g => { if (!(g.sport in expanded)) defs[g.sport] = true; });
    if (Object.keys(defs).length > 0) setExpanded(p => ({ ...p, ...defs }));
  }, [liveGroups.map(g => g.sport).join(',')]);

  useEffect(() => {
    const defs: Record<string, boolean> = {};
    ftGroups.forEach(g => { if (!(g.sport in expandedFt)) defs[g.sport] = false; });
    if (Object.keys(defs).length > 0) setExpandedFt(p => ({ ...p, ...defs }));
  }, [ftGroups.map(g => g.sport).join(',')]);

  const toggle = useCallback((s: string) =>
    setExpanded(p => ({ ...p, [s]: !p[s] })), []);
  const toggleFt = useCallback((s: string) =>
    setExpandedFt(p => ({ ...p, [s]: !p[s] })), []);

  const navigateSport = useCallback((s: string) => {
    router.push({
      pathname: '/sports/[sport]',
      params: { sport: s.toLowerCase().replace(/\s+/g, '-') },
    } as any);
  }, [router]);

  const featuredLive = filteredLive[0] ?? null;
  const hasAny = filteredLive.length > 0 || filteredFt.length > 0;

  // Header entrance animation
  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1, duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <View style={[ls.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={[ls.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <View style={ls.titleRow}>
            <PulseDot
              color={filteredLive.length > 0 ? '#FF4757' : C.textMuted}
              size={10}
            />
            <Text style={[ls.title, { color: C.textPrimary }]}>Live Scores</Text>
          </View>
          <Text style={[ls.subtitle, { color: C.textSecondary }]}>
            {filteredLive.length > 0
              ? `${filteredLive.length} live · ${dataSource === 'sse' ? 'SSE stream' : 'auto-refresh'}`
              : filteredFt.length > 0
              ? `${filteredFt.length} finished today`
              : 'No live matches'}
          </Text>
        </View>

        {/* ── Date navigation bar ──────────────────────────────── */}
        <DateNavBar selectedDate={selectedDate} onSelect={setSelectedDate} C={C} />

      {/* ── Sport chips ─────────────────────────────────────── */}
        <View style={[ls.chipWrap, { borderBottomColor: C.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ls.chips}
          >
            {SPORTS.map(s => (
              <Pressable
                key={s}
                style={[
                  ls.chip,
                  { backgroundColor: C.card, borderColor: C.border },
                  sport === s
                    ? { backgroundColor: C.primaryGlow, borderColor: C.primary }
                    : null,
                ]}
                onPress={() => setSport(s)}
                onLongPress={() => { if (s !== 'All') navigateSport(s); }}
              >
                <Text style={ls.chipEmoji}>{getSportIcon(s)}</Text>
                <Text style={[
                  ls.chipLabel,
                  { color: sport === s ? C.primary : C.textSecondary },
                  sport === s ? { fontWeight: FONTS.bold } : null,
                ]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </SafeAreaView>

      {/* ── Content ────────────────────────────────────────────── */}
      {loading && !hasAny ? (
        <View style={ls.loaderWrap}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[ls.loaderText, { color: C.textMuted }]}>Connecting to live scores...</Text>
        </View>
      ) : !hasAny ? (
        <ScrollView
          contentContainerStyle={ls.emptyScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
          }
        >
          <EmptyState sport={sport} C={C} />
        </ScrollView>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={ls.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
          }
        >
          {/* Connection status pill */}
          <View style={{ marginBottom: 12 }}>
            <SourcePill source={dataSource} liveCount={liveCount} C={C} />
          </View>

          {/* Featured live hero card */}
          {featuredLive ? (
            <LiveMatchHero
              match={featuredLive}
              C={C}
              onPress={() =>
                router.push({
                  pathname: '/ai-pick/[id]',
                  params: { id: featuredLive.id },
                } as any)
              }
            />
          ) : null}

          {/* ── Live matches ──────────────────────────────────── */}
          {sport === 'All' ? (
            liveGroups.map(group => (
              <View key={group.sport}>
                <SportHeader
                  sport={group.sport}
                  count={group.matches.length}
                  expanded={!!expanded[group.sport]}
                  onToggle={() => toggle(group.sport)}
                  C={C}
                  onNavigate={navigateSport}
                />
                {expanded[group.sport]
                  ? group.matches.map(m => <MatchCard key={m.id} match={m} />)
                  : null}
              </View>
            ))
          ) : (
            filteredLive
              .slice(featuredLive ? 1 : 0)
              .map(m => <MatchCard key={m.id} match={m} />)
          )}

          {/* ── Finished today ────────────────────────────────── */}
          {filteredFt.length > 0 ? (
            <View>
              <View style={[ls.ftBanner, { backgroundColor: C.card, borderColor: C.border }]}>
                <Ionicons name="checkmark-circle" size={18} color={C.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[ls.ftTitle, { color: C.textSecondary }]}>FULL TIME</Text>
                  <Text style={[ls.ftCount, { color: C.textPrimary }]}>
                    {filteredFt.length} finished match{filteredFt.length !== 1 ? 'es' : ''} today
                  </Text>
                </View>
              </View>

              {sport === 'All' ? (
                ftGroups.map(group => (
                  <View key={group.sport}>
                    <SportHeader
                      sport={group.sport}
                      count={group.matches.length}
                      expanded={!!expandedFt[group.sport]}
                      onToggle={() => toggleFt(group.sport)}
                      isFinished
                      C={C}
                      onNavigate={navigateSport}
                    />
                    {expandedFt[group.sport]
                      ? group.matches.map(m => <MatchCard key={m.id} match={m} />)
                      : null}
                  </View>
                ))
              ) : (
                filteredFt.map(m => <MatchCard key={m.id} match={m} />)
              )}
            </View>
          ) : null}

          <UpdatedBar lastUpdated={lastUpdated} source={dataSource} C={C} />
          <View style={{ height: 48 }} />
        </ScrollView>
      )}
    </View>
  );
}

const ls = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: SPACING.md, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 3 },
  title: { fontSize: 22, fontWeight: FONTS.bold },
  subtitle: { fontSize: 12, marginLeft: 20 },
  chipWrap: { paddingVertical: 8, borderBottomWidth: 1 },
  chips: { paddingHorizontal: SPACING.md, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipEmoji: { fontSize: 14 },
  chipLabel: { fontSize: 13, fontWeight: FONTS.medium },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { fontSize: 14 },
  emptyScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
  listContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 40 },
  ftBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, marginBottom: 10,
  },
  ftTitle: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  ftCount: { fontSize: 13, fontWeight: FONTS.semiBold },
});
