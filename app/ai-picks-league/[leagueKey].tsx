/**
 * AI Picks — League Page
 * Shows all matches for a specific league, navigating to the AI Pick detail on tap.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import type { AIPicksLeague, AIPick } from '@/services/aiPicksService';
import { useAIPicks } from '@/hooks/useAIPicks';
import { getRiskColor } from '@/services/predictionService';
import { DisclaimerBanner } from '@/components/ui/DisclaimerBanner';
import { getSportFamily } from '@/services/sportConfig';

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return '--:--'; }
}
function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]}`;
  } catch { return ''; }
}

// ─── Pulsing LIVE Badge ───────────────────────────────────────────────────────
function PulsingLiveBadge({ count = 1 }: { count?: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    p.start(); return () => p.stop();
  }, [op]);
  return (
    <View style={badge.wrap}>
      <Animated.View style={[badge.dot, { opacity: op }]} />
      <Text style={badge.label}>LIVE</Text>
      {count > 1 ? (
        <View style={badge.count}>
          <Text style={badge.countText}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,71,87,0.12)', borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)', paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF4757' },
  label: { fontSize: 10, fontWeight: '800' as any, color: '#FF4757', letterSpacing: 0.5 },
  count: { backgroundColor: '#FF4757', borderRadius: 99, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontSize: 9, fontWeight: '800' as any, color: '#fff', lineHeight: 13 },
});

// ─── Team Logo ────────────────────────────────────────────────────────────────
function TeamLogo({ name, logoUrl, size = 36, C }: { name: string; logoUrl?: string | null; size?: number; C: AppColors }) {
  const abbr = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (logoUrl) {
    return <Image source={{ uri: logoUrl }} style={{ width: size, height: size, borderRadius: size / 4 }} contentFit="contain" transition={150} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${C.primary}22`, borderWidth: 1, borderColor: `${C.primary}44`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.3, fontWeight: FONTS.extraBold, color: C.primary }}>{abbr}</Text>
    </View>
  );
}

// ─── Section type & grouping helper ─────────────────────────────────────────
type MatchSection = {
  id: string;
  title: string;
  matches: AIPick[];
  hasLive: boolean;
  liveCount: number;
  predCount: number;
};

function groupMatchesIntoSections(matches: AIPick[]): MatchSection[] {
  const groups = new Map<string, AIPick[]>();

  for (const match of matches) {
    // Prefer a round/stage field if the API surfaces it on this match
    const roundField = (match as any).round as string | null | undefined;
    let key: string;

    if (roundField && roundField.trim().length > 0) {
      key = roundField.trim();
    } else {
      // Status-based fallback
      if (match.status === 'live') key = 'Live Now';
      else if (match.status === 'finished') key = 'Full Time';
      else key = 'Upcoming';
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(match);
  }

  // Ordering: Live Now → round keys (natural sort) → Upcoming → Full Time
  const STATUS_KEYS = ['Live Now', 'Upcoming', 'Full Time'];
  const roundKeys = [...groups.keys()]
    .filter(k => !STATUS_KEYS.includes(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const orderedKeys = [
    ...(['Live Now'].filter(k => groups.has(k))),
    ...roundKeys,
    ...(['Upcoming', 'Full Time'].filter(k => groups.has(k))),
  ];

  return orderedKeys.map(key => {
    const sectionMatches = groups.get(key) ?? [];
    const liveCount = sectionMatches.filter(m => m.status === 'live').length;
    return {
      id: key,
      title: key,
      matches: sectionMatches,
      hasLive: liveCount > 0,
      liveCount,
      predCount: sectionMatches.filter(m => m.hasPrediction).length,
    };
  });
}

// ─── Collapsible Round/Stage Section ─────────────────────────────────────────
function CollapsibleRoundSection({ section, C }: { section: MatchSection; C: AppColors }) {
  // Live Now sections auto-expand; every other section starts collapsed
  const [expanded, setExpanded] = useState(section.hasLive);

  return (
    <View style={rs.wrap}>
      <Pressable
        style={({ pressed }) => [
          rs.header,
          { backgroundColor: C.card, borderColor: expanded ? `${C.primary}44` : C.border },
          pressed ? { opacity: 0.8 } : null,
        ]}
        onPress={() => setExpanded(v => !v)}
      >
        <View style={rs.headerLeft}>
          <Text style={[rs.title, { color: C.textPrimary }]} numberOfLines={1}>
            {section.title}
          </Text>
          <Text style={[rs.subtitle, { color: C.textMuted }]}>
            {section.matches.length} match{section.matches.length !== 1 ? 'es' : ''}
            {section.predCount > 0
              ? ` · ${section.predCount} AI pick${section.predCount !== 1 ? 's' : ''}`
              : ''}
          </Text>
        </View>
        <View style={rs.right}>
          {section.hasLive ? <PulsingLiveBadge count={section.liveCount} /> : null}
          {section.predCount > 0 ? (
            <View style={[rs.brainBadge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <FontAwesome5 name="brain" size={9} color={C.primary} />
              <Text style={[rs.brainText, { color: C.primary }]}>{section.predCount}</Text>
            </View>
          ) : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
        </View>
      </Pressable>

      {expanded ? (
        <View style={rs.matchList}>
          {section.matches.map(match => (
            <MatchCard key={match.matchId} match={match} C={C} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const rs = StyleSheet.create({
  wrap: { marginBottom: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: SPACING.md, paddingVertical: 11,
  },
  headerLeft: { flex: 1, gap: 3, marginRight: 8 },
  title: { fontSize: 13, fontWeight: FONTS.semiBold },
  subtitle: { fontSize: 10 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brainBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3,
  },
  brainText: { fontSize: 9, fontWeight: FONTS.semiBold },
  matchList: { marginTop: 5 },
});

// ─── Match Card ───────────────────────────────────────────────────────────────
function MatchCard({ match, C }: { match: AIPick; C: AppColors }) {
  const router = useRouter();
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';

  const predLabel = match.predictedResult === 'home_win' ? match.homeTeam
    : match.predictedResult === 'away_win' ? match.awayTeam
    : match.predictedResult === 'draw' ? 'Draw' : null;
  const sportFamily = getSportFamily(match.sport);
  const isFight = sportFamily === 'mma' || sportFamily === 'boxing';
  const showBTTS = sportFamily === 'football' || sportFamily === 'handball';

  const handlePress = useCallback(() => {
    router.push({
      pathname: '/ai-pick/[id]',
      params: { id: match.matchId, matchJson: JSON.stringify(match) },
    } as any);
  }, [match]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        mc.card,
        { backgroundColor: C.card, borderColor: C.border },
        pressed ? mc.cardPressed : null,
      ]}
    >
      {/* Left accent stripe */}
      <View style={[mc.stripe, {
        backgroundColor: isLive ? '#FF4757' : isFinished ? C.primary : match.hasPrediction ? '#22C55E' : C.border,
      }]} />
      <View style={mc.body}>
        {/* Status row */}
        <View style={mc.statusRow}>
          {isLive ? <PulsingLiveBadge /> : isFinished ? (
            <View style={[mc.statusPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <Text style={[mc.statusText, { color: C.primary }]}>FT {match.homeScore} - {match.awayScore}</Text>
            </View>
          ) : (
            <View style={[mc.statusPill, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Ionicons name="time-outline" size={10} color={C.textMuted} />
              <Text style={[mc.statusText, { color: C.textMuted }]}>{fmtTime(match.matchTime)} · {fmtDate(match.matchTime)}</Text>
            </View>
          )}
          {match.hasPrediction && predLabel ? (
            <View style={[mc.predPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <FontAwesome5 name="brain" size={8} color={C.primary} />
              <Text style={[mc.predPillText, { color: C.primary }]} numberOfLines={1}>{predLabel}</Text>
            </View>
          ) : null}
          {match.riskLevel ? (() => {
            const rc = getRiskColor(match.riskLevel);
            return (
              <View style={[mc.riskPill, { backgroundColor: `${rc}18`, borderColor: `${rc}44` }]}>
                <Text style={[mc.riskText, { color: rc }]}>{match.riskLevel}</Text>
              </View>
            );
          })() : null}
          <View style={mc.chevronSpacer} />
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </View>

        {/* Teams + score */}
        <View style={mc.teamsRow}>
          <View style={mc.teamBlock}>
            <TeamLogo name={match.homeTeam} logoUrl={match.homeLogo} size={36} C={C} />
            <Text style={[mc.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.homeTeam}</Text>
          </View>
          <View style={mc.scoreBlock}>
            {isLive ? (
              <>
                <Text style={[mc.bigScore, { color: C.textPrimary }]}>{match.homeScore} - {match.awayScore}</Text>
                <View style={mc.liveMinRow}>
                  <View style={mc.liveMinDot} />
                  <Text style={mc.liveMinText}>{match.minute}'</Text>
                </View>
              </>
            ) : isFinished ? (
              <Text style={[mc.bigScore, { color: C.textPrimary }]}>{match.homeScore} - {match.awayScore}</Text>
            ) : (
              <View style={[mc.vsWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[mc.vsText, { color: C.textMuted }]}>VS</Text>
              </View>
            )}
            {match.confidence ? (
              <View style={[mc.confPill, { borderColor: match.confidence >= 80 ? '#22C55E44' : '#EAB30844' }]}>
                <Text style={[mc.confText, { color: match.confidence >= 80 ? '#22C55E' : '#EAB308' }]}>{match.confidence}%</Text>
              </View>
            ) : null}
          </View>
          <View style={[mc.teamBlock, mc.teamBlockRight]}>
            <TeamLogo name={match.awayTeam} logoUrl={match.awayLogo} size={36} C={C} />
            <Text style={[mc.teamName, mc.teamNameRight, { color: C.textPrimary }]} numberOfLines={2}>{match.awayTeam}</Text>
          </View>
        </View>

        {/* Quick prediction chips */}
        {match.hasPrediction ? (
          <View style={mc.chipsRow}>
            {match.predictedResult ? (
              <View style={[mc.chip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
                <Text style={[mc.chipText, { color: C.primary }]}>
                  {match.predictedResult === 'home_win' ? '1 HOME' : match.predictedResult === 'away_win' ? '2 AWAY' : 'X DRAW'}
                </Text>
              </View>
            ) : null}
            {!isFight && match.overUnder ? (
              <View style={[mc.chip, {
                backgroundColor: match.overUnder === 'over' ? '#22C55E18' : '#EF444418',
                borderColor: match.overUnder === 'over' ? '#22C55E44' : '#EF444444',
              }]}>
                <Text style={[mc.chipText, { color: match.overUnder === 'over' ? '#22C55E' : '#EF4444' }]}>
                  O/U {match.overUnderLine ?? 2.5} {match.overUnder.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {showBTTS && match.btts ? (
              <View style={[mc.chip, {
                backgroundColor: match.btts === 'yes' ? '#14B8A618' : '#F9731618',
                borderColor: match.btts === 'yes' ? '#14B8A644' : '#F9731644',
              }]}>
                <Text style={[mc.chipText, { color: match.btts === 'yes' ? '#14B8A6' : '#F97316' }]}>BTTS {match.btts.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const mc = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  stripe: { width: 4 },
  body: { flex: 1, paddingHorizontal: SPACING.md, paddingTop: 12, paddingBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: FONTS.semiBold },
  predPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  predPillText: { fontSize: 10, fontWeight: FONTS.semiBold, maxWidth: 90 },
  chevronSpacer: { flex: 1 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  teamBlock: { flex: 1, alignItems: 'flex-start', gap: 5 },
  teamBlockRight: { alignItems: 'flex-end' },
  teamName: { fontSize: 13, fontWeight: FONTS.semiBold, lineHeight: 18 },
  teamNameRight: { textAlign: 'right' },
  scoreBlock: { alignItems: 'center', gap: 4, minWidth: 80 },
  bigScore: { fontSize: 28, fontWeight: FONTS.extraBold },
  liveMinRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveMinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF4757' },
  liveMinText: { fontSize: 11, fontWeight: FONTS.bold, color: '#FF4757' },
  vsWrap: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  vsText: { fontSize: 14, fontWeight: FONTS.bold },
  confPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  confText: { fontSize: 10, fontWeight: FONTS.bold },
  riskPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  riskText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AIPicksLeagueScreen() {
  const params = useLocalSearchParams<{
    leagueKey: string; leagueJson: string; dateOffset: string; sport: string;
  }>();
  const router = useRouter();
  const { colors: C } = useTheme();

  const dateOffset = parseInt(params.dateOffset ?? '0', 10) || 0;
  const sport = params.sport ?? 'All';

  // Parse the passed league data as initial state
  const [league, setLeague] = useState<AIPicksLeague | null>(() => {
    if (params.leagueJson) {
      try { return JSON.parse(params.leagueJson as string) as AIPicksLeague; }
      catch { return null; }
    }
    return null;
  });

  // Use the full hook to get fresh data + allow pull-to-refresh
  const { leagues: allLeagues, loading, refreshing, refresh } = useAIPicks(dateOffset, sport);

  // Update league from fresh data when available
  const leagueKey = params.leagueKey ? decodeURIComponent(params.leagueKey as string) : '';
  React.useEffect(() => {
    if (allLeagues.length > 0) {
      const found = allLeagues.find((l) => l.id === leagueKey);
      if (found) setLeague(found);
    }
  }, [allLeagues, leagueKey]);

  const totalMatches = league?.matches.length ?? 0;
  const liveMatches = league?.matches.filter((m) => m.status === 'live').length ?? 0;
  const predMatches = league?.matches.filter((m) => m.hasPrediction).length ?? 0;

  // Group matches into collapsible round/stage sections
  const sections = useMemo(
    () => (league ? groupMatchesIntoSections(league.matches) : []),
    [league],
  );

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            {league?.leagueLogo ? (
              <Image source={{ uri: league.leagueLogo }} style={s.headerLogo} contentFit="contain" />
            ) : (
              <Text style={{ fontSize: 20 }}>🏆</Text>
            )}
            <Text style={[s.title, { color: C.textPrimary }]} numberOfLines={1}>
              {league?.leagueName ?? 'League'}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Hero gradient header */}
      <LinearGradient
        colors={[`${C.primary}14`, C.bg] as [string, string]}
        style={s.hero}
      >
        <View style={s.heroMeta}>
          <Text style={s.heroFlag}>{league?.flag ?? '🌍'}</Text>
          <Text style={[s.heroCountry, { color: C.textSecondary }]}>{league?.country}</Text>
          {league?.round ? (
            <View style={[s.roundPill, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[s.roundText, { color: C.textMuted }]}>{league.round}</Text>
            </View>
          ) : null}
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          {[
            { icon: '⚡', val: liveMatches, label: 'Live', color: '#EF4444' },
            { icon: '📅', val: totalMatches, label: 'Matches', color: C.primary },
            { icon: '🧠', val: predMatches, label: 'AI Picks', color: '#4ECDC4' },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 ? <View style={[s.statsDivider, { backgroundColor: `${C.border}88` }]} /> : null}
              <View style={s.statItem}>
                <Text style={s.statIcon}>{item.icon}</Text>
                <Text style={[s.statVal, { color: item.color }]}>{item.val}</Text>
                <Text style={[s.statLabel, { color: C.textMuted }]}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </LinearGradient>

      {/* Generating banner */}
      {loading && !league ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : !league || league.matches.length === 0 ? (
        <View style={s.centered}>
          <Text style={{ fontSize: 40 }}>🏆</Text>
          <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No matches found</Text>
          <Text style={[s.emptyBody, { color: C.textMuted }]}>No matches scheduled for this league today.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}
        >
          <Text style={[s.sectionLabel, { color: C.textSecondary }]}>
            {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
            {sections.length > 1 ? ` · ${sections.length} sections` : ''}
          </Text>
          {sections.map(section => (
            <CollapsibleRoundSection key={section.id} section={section} C={C} />
          ))}
          <View style={{ marginTop: 8, marginBottom: 8 }}>
            <DisclaimerBanner compact />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerLogo: { width: 24, height: 24, borderRadius: 4 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  hero: { paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 14, gap: 10 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroFlag: { fontSize: 20 },
  heroCountry: { fontSize: 13, fontWeight: FONTS.medium },
  roundPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 4 },
  roundText: { fontSize: 11, fontWeight: FONTS.semiBold },
  statsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statIcon: { fontSize: 15 },
  statVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 10 },
  statsDivider: { width: 1, height: 28 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center', paddingHorizontal: 32, lineHeight: 20 },
  content: { paddingHorizontal: SPACING.md, paddingTop: 12, paddingBottom: 40 },
  sectionLabel: { fontSize: 12, fontWeight: FONTS.semiBold, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
});
