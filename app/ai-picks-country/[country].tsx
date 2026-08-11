/**
 * AI Picks — Country Page
 * Shows all leagues for a specific country on a given date/sport filter.
 * Leagues are collapsible and collapse by default (matching the main tab behaviour).
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { useAIPicks } from '@/hooks/useAIPicks';
import type { AIPicksLeague, AIPick } from '@/services/aiPicksService';

// ─── Pulsing LIVE Badge ───────────────────────────────────────────────────────
function PulsingLiveBadge({ count }: { count: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    p.start(); return () => p.stop();
  }, [op]);
  return (
    <View style={styles.liveBadge}>
      <Animated.View style={[styles.liveDot, { opacity: op }]} />
      <Text style={styles.liveLabel}>LIVE</Text>
      {count > 1 ? (
        <View style={styles.liveCount}>
          <Text style={styles.liveCountText}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Inline Match Row ─────────────────────────────────────────────────────────
function MatchRow({ match, C }: { match: AIPick; C: AppColors }) {
  const router = useRouter();
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';

  const fmtKO = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return '--:--'; }
  };

  const handlePress = useCallback(() => {
    router.push({
      pathname: '/ai-pick/[id]',
      params: { id: match.matchId, matchJson: JSON.stringify(match) },
    } as any);
  }, [match.matchId]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        mr.row,
        { backgroundColor: C.surface, borderColor: C.border },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      {/* Left accent stripe */}
      <View style={[mr.stripe, {
        backgroundColor: isLive ? '#FF4757' : isFinished ? C.primary : match.hasPrediction ? '#22C55E' : C.border,
      }]} />

      {/* Time / live minute */}
      <View style={mr.timeBlock}>
        {isLive ? (
          <View style={mr.liveRow}>
            <View style={mr.liveDot} />
            <Text style={mr.liveMin}>{match.minute}'</Text>
          </View>
        ) : isFinished ? (
          <Text style={[mr.time, { color: C.primary }]}>FT</Text>
        ) : (
          <Text style={[mr.time, { color: C.textMuted }]}>{fmtKO(match.matchTime)}</Text>
        )}
      </View>

      {/* Teams */}
      <View style={mr.teams}>
        <Text style={[mr.teamText, { color: C.textPrimary }]} numberOfLines={1}>{match.homeTeam}</Text>
        <Text style={[mr.teamText, { color: C.textPrimary }]} numberOfLines={1}>{match.awayTeam}</Text>
      </View>

      {/* Score / VS */}
      <View style={mr.scoreWrap}>
        {(isLive || isFinished) ? (
          <>
            <Text style={[mr.score, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.homeScore}</Text>
            <Text style={[mr.scoreSep, { color: C.textMuted }]}>-</Text>
            <Text style={[mr.score, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.awayScore}</Text>
          </>
        ) : (
          <Text style={[mr.vs, { color: C.textMuted }]}>VS</Text>
        )}
      </View>

      {/* AI confidence badge */}
      {match.confidence ? (
        <View style={[mr.confBadge, {
          backgroundColor: match.confidence >= 80 ? '#22C55E14' : '#EAB30814',
          borderColor: match.confidence >= 80 ? '#22C55E44' : '#EAB30844',
        }]}>
          <Text style={[mr.confText, { color: match.confidence >= 80 ? '#22C55E' : '#EAB308' }]}>
            {match.confidence}%
          </Text>
        </View>
      ) : (
        <View style={{ width: 40 }} />
      )}

      <Ionicons name="chevron-forward" size={12} color={C.textMuted} />
    </Pressable>
  );
}

const mr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: RADIUS.md, borderWidth: 1,
    marginBottom: 5, overflow: 'hidden', minHeight: 46,
  },
  stripe: { width: 3, alignSelf: 'stretch' },
  timeBlock: { width: 38, alignItems: 'center', paddingHorizontal: 4 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4757' },
  liveMin: { fontSize: 9, fontWeight: '800' as any, color: '#FF4757' },
  time: { fontSize: 10, fontWeight: FONTS.semiBold },
  teams: { flex: 1, paddingVertical: 8, gap: 4, paddingHorizontal: 6 },
  teamText: { fontSize: 12, fontWeight: FONTS.semiBold },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 52, justifyContent: 'center' },
  score: { fontSize: 14, fontWeight: FONTS.extraBold },
  scoreSep: { fontSize: 12, fontWeight: FONTS.bold },
  vs: { fontSize: 11, fontWeight: FONTS.bold },
  confBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, marginHorizontal: 4 },
  confText: { fontSize: 9, fontWeight: FONTS.bold },
});

// ─── Collapsible League Section ───────────────────────────────────────────────
function CollapsibleLeagueSection({ league, dateOffset, sport, C }: {
  league: AIPicksLeague; dateOffset: number; sport: string; C: AppColors;
}) {
  const router = useRouter();
  // Collapsed by default — matches the main predictions tab InlineLeagueSection behaviour
  const [expanded, setExpanded] = useState(false);

  const liveCount = league.matches.filter((m) => m.status === 'live').length;
  const predCount = league.matches.filter((m) => m.hasPrediction).length;

  const handleNavigate = useCallback(() => {
    router.push({
      pathname: '/ai-picks-league/[leagueKey]',
      params: {
        leagueKey: encodeURIComponent(league.id),
        leagueJson: JSON.stringify(league),
        dateOffset: String(dateOffset),
        sport,
      },
    } as any);
  }, [league.id, dateOffset, sport]);

  return (
    <View style={cls.wrap}>
      {/* Header — tap anywhere to expand / collapse */}
      <Pressable
        style={({ pressed }) => [
          cls.header,
          { backgroundColor: C.card, borderColor: expanded ? `${C.primary}44` : C.border },
          pressed ? { opacity: 0.8 } : null,
        ]}
        onPress={() => setExpanded((v) => !v)}
      >
        {/* League logo */}
        <View style={cls.logoWrap}>
          {league.leagueLogo ? (
            <Image source={{ uri: league.leagueLogo }} style={cls.logo} contentFit="contain" />
          ) : (
            <View style={[cls.logoFallback, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <Text style={cls.logoEmoji}>🏆</Text>
            </View>
          )}
        </View>

        {/* League info */}
        <View style={cls.info}>
          <Text style={[cls.name, { color: C.textPrimary }]} numberOfLines={1}>{league.leagueName}</Text>
          <View style={cls.meta}>
            <Text style={[cls.metaText, { color: C.textMuted }]}>
              {league.matches.length} match{league.matches.length !== 1 ? 'es' : ''}
            </Text>
            {predCount > 0 ? (
              <View style={[cls.predBadge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
                <FontAwesome5 name="brain" size={8} color={C.primary} />
                <Text style={[cls.predText, { color: C.primary }]}>{predCount} picks</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Right: badges + chevron toggle */}
        <View style={cls.right}>
          {liveCount > 0 ? <PulsingLiveBadge count={liveCount} /> : null}
          {league.isFavorite ? <FontAwesome5 name="star" size={9} color={C.primary} solid /> : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
        </View>
      </Pressable>

      {/* Expanded: inline match rows + "Full League Analysis" nav */}
      {expanded ? (
        <View style={cls.matchList}>
          {league.matches.map((match) => (
            <MatchRow key={match.matchId} match={match} C={C} />
          ))}
          <Pressable
            onPress={handleNavigate}
            style={({ pressed }) => [
              cls.viewAllBtn,
              { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` },
              pressed ? { opacity: 0.8 } : null,
            ]}
          >
            <FontAwesome5 name="brain" size={10} color={C.primary} />
            <Text style={[cls.viewAllText, { color: C.primary }]}>Full League Analysis</Text>
            <Ionicons name="chevron-forward" size={12} color={C.primary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const cls = StyleSheet.create({
  wrap: { marginBottom: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: SPACING.md, paddingVertical: 11,
  },
  logoWrap: { flexShrink: 0 },
  logo: { width: 28, height: 28, borderRadius: 6 },
  logoFallback: {
    width: 28, height: 28, borderRadius: 7, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  logoEmoji: { fontSize: 14 },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: FONTS.semiBold },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaText: { fontSize: 10 },
  predBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2,
  },
  predText: { fontSize: 9, fontWeight: FONTS.semiBold },
  right: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  matchList: { marginTop: 4, gap: 0 },
  viewAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 6,
  },
  viewAllText: { fontSize: 12, fontWeight: FONTS.bold, flex: 1, textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AIPicksCountryScreen() {
  const { country, dateOffset: dateOffsetStr, sport: sportParam } = useLocalSearchParams<{
    country: string; dateOffset: string; sport: string;
  }>();
  const router = useRouter();
  const { colors: C } = useTheme();

  const dateOffset = parseInt(dateOffsetStr ?? '0', 10) || 0;
  const sport = sportParam ?? 'All';
  const countryName = decodeURIComponent(country ?? '');

  const { leagues: allLeagues, loading, refreshing, refresh } = useAIPicks(dateOffset, sport);

  // Filter leagues to this country only
  const countryLeagues = useMemo(
    () => allLeagues.filter((l) => l.country === countryName),
    [allLeagues, countryName],
  );

  const totalMatches = useMemo(() =>
    countryLeagues.reduce((a, l) => a + l.matches.length, 0), [countryLeagues]);
  const liveMatches = useMemo(() =>
    countryLeagues.reduce((a, l) => a + l.matches.filter((m) => m.status === 'live').length, 0), [countryLeagues]);
  const predMatches = useMemo(() =>
    countryLeagues.reduce((a, l) => a + l.matches.filter((m) => m.hasPrediction).length, 0), [countryLeagues]);

  // Get flag from first available league
  const flag = countryLeagues[0]?.flag ?? '🌍';

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.flag}>{flag}</Text>
            <Text style={[s.title, { color: C.textPrimary }]} numberOfLines={1}>{countryName}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Stats strip */}
      {!loading && totalMatches > 0 ? (
        <View style={[s.statsStrip, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          {[
            { icon: '⚡', val: liveMatches, label: 'Live', color: '#EF4444' },
            { icon: '📅', val: totalMatches, label: 'Matches', color: C.primary },
            { icon: '🧠', val: predMatches, label: 'AI Picks', color: '#4ECDC4' },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 ? <View style={[s.statsDivider, { backgroundColor: C.border }]} /> : null}
              <View style={s.statItem}>
                <Text style={s.statIcon}>{item.icon}</Text>
                <Text style={[s.statVal, { color: item.color }]}>{item.val}</Text>
                <Text style={[s.statLabel, { color: C.textMuted }]}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[s.loadingText, { color: C.textMuted }]}>Loading leagues...</Text>
        </View>
      ) : countryLeagues.length === 0 ? (
        <View style={s.centered}>
          <Text style={{ fontSize: 48 }}>{flag}</Text>
          <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No leagues found</Text>
          <Text style={[s.emptyBody, { color: C.textMuted }]}>
            No matches scheduled for {countryName} today.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />
          }
        >
          <Text style={[s.sectionTitle, { color: C.textSecondary }]}>
            {countryLeagues.length} league{countryLeagues.length !== 1 ? 's' : ''}
          </Text>
          {countryLeagues.map((league) => (
            <CollapsibleLeagueSection
              key={league.id}
              league={league}
              dateOffset={dateOffset}
              sport={sport}
              C={C}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,71,87,0.12)', borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF4757' },
  liveLabel: { fontSize: 10, fontWeight: '800' as any, color: '#FF4757', letterSpacing: 0.5 },
  liveCount: {
    backgroundColor: '#FF4757', borderRadius: 99,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  liveCountText: { fontSize: 9, fontWeight: '800' as any, color: '#fff', lineHeight: 13 },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  flag: { fontSize: 24 },
  title: { fontSize: 18, fontWeight: FONTS.extraBold },
  statsStrip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statIcon: { fontSize: 16 },
  statVal: { fontSize: 20, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 10 },
  statsDivider: { width: 1, height: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center', paddingHorizontal: 32, lineHeight: 20 },
  content: { paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 12, fontWeight: FONTS.semiBold, marginBottom: 12,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
});
