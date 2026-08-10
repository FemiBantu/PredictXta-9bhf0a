import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, FlatList, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFollowedMatches } from '@/hooks/useFollowedMatches';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Polyline, Defs, LinearGradient as SvgLinearGradient, Stop, Circle, Line, Text as SvgText, Rect as SvgRect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { usePredictionForMatch, useGeneratePrediction } from '@/hooks/usePredictions';
import { useMatchChat } from '@/hooks/useChat';
import PredictionBar from '@/components/feature/PredictionBar';
import SportStatsBar from '@/components/feature/SportStatsBar';
import ChatBubble from '@/components/feature/ChatBubble';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import { FONTS, RADIUS, SPACING, SPORT_ICONS } from '@/constants/theme';
import { Image } from 'expo-image';
import { getConfidenceColor } from '@/services/predictionService';
import { buildPredictionMarkets } from '@/services/sportEngines';
import { getSportAccuracyMarkets } from '@/services/sportConfig';
import SportOverviewMetrics from '@/components/feature/SportOverviewMetrics';
import MatchOverviewTab from '@/components/feature/MatchOverviewTab';
import { fetchDetailedMatchData } from '@/services/matchStatsService';
import type { DetailedMatchData, MatchEvent } from '@/services/matchStatsService';
import { fetchHeadToHead } from '@/services/aiPicksService';
import type { H2HRecord } from '@/services/aiPicksService';
import { useAuth, getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { checkActiveSubscription } from '@/services/iapService';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';

type TabKey = 'overview' | 'prediction' | 'stats' | 'odds' | 'chat' | 'timeline' | 'lineups';

// ─── Sport-specific score breakdown helpers ─────────────────────────────────
interface QuarterScore { home: number; away: number; }
interface BasketballScoreBreakdown {
  q1?: QuarterScore; q2?: QuarterScore; q3?: QuarterScore; q4?: QuarterScore;
  ot?: QuarterScore; ot2?: QuarterScore;
}
interface PeriodScore { home: number; away: number; }
interface HockeyScoreBreakdown {
  p1?: PeriodScore; p2?: PeriodScore; p3?: PeriodScore;
  ot?: PeriodScore; so?: PeriodScore;
}
interface SetScore { home: number; away: number; homeTiebreak?: number; awayTiebreak?: number; }
interface TennisSetBreakdown { sets: SetScore[]; currentSet?: number; }
interface InningsScore { runs: number; wickets: number; overs?: number; }
interface CricketInningsBreakdown { inning1?: InningsScore; inning2?: InningsScore; inning3?: InningsScore; inning4?: InningsScore; }

function extractBasketballBreakdown(stats: any): BasketballScoreBreakdown | null {
  if (!stats) return null;
  const q = stats.quarters ?? stats.scoreline?.quarters ?? stats.periods ?? null;
  if (!q) return null;
  const parse = (v: any): QuarterScore | undefined => {
    if (!v) return undefined;
    if (typeof v === 'object' && ('home' in v || 'away' in v)) return { home: Number(v.home ?? 0), away: Number(v.away ?? 0) };
    return undefined;
  };
  return { q1: parse(q.q1 ?? q['1']), q2: parse(q.q2 ?? q['2']), q3: parse(q.q3 ?? q['3']), q4: parse(q.q4 ?? q['4']), ot: parse(q.ot ?? q.overtime), ot2: parse(q.ot2) };
}

function extractTennisSetBreakdown(stats: any): TennisSetBreakdown | null {
  if (!stats) return null;
  const s = stats.sets ?? stats.scoreline?.sets ?? stats.score?.sets ?? null;
  if (!s) return null;
  // Support array or object format
  const sets: SetScore[] = [];
  if (Array.isArray(s)) {
    s.forEach((set: any) => {
      if (set && ('home' in set || 'away' in set || 'homeScore' in set || 'awayScore' in set)) {
        sets.push({ home: Number(set.home ?? set.homeScore ?? 0), away: Number(set.away ?? set.awayScore ?? 0), homeTiebreak: set.homeTiebreak != null ? Number(set.homeTiebreak) : undefined, awayTiebreak: set.awayTiebreak != null ? Number(set.awayTiebreak) : undefined });
      }
    });
  } else {
    for (let i = 1; i <= 5; i++) {
      const set = s[`s${i}`] ?? s[String(i)] ?? s[`set${i}`];
      if (!set) break;
      if (typeof set === 'object' && ('home' in set || 'away' in set)) {
        sets.push({ home: Number(set.home ?? 0), away: Number(set.away ?? 0), homeTiebreak: set.homeTiebreak != null ? Number(set.homeTiebreak) : undefined, awayTiebreak: set.awayTiebreak != null ? Number(set.awayTiebreak) : undefined });
      }
    }
  }
  if (sets.length === 0) return null;
  return { sets, currentSet: stats.currentSet != null ? Number(stats.currentSet) : undefined };
}

function extractCricketInnings(stats: any): CricketInningsBreakdown | null {
  if (!stats) return null;
  const ing = stats.innings ?? stats.scoreline?.innings ?? stats.score?.innings ?? null;
  if (!ing) return null;
  const parse = (v: any): InningsScore | undefined => {
    if (!v) return undefined;
    if (typeof v === 'object') return { runs: Number(v.runs ?? v.score ?? 0), wickets: Number(v.wickets ?? v.wkts ?? 0), overs: v.overs != null ? Number(v.overs) : undefined };
    return undefined;
  };
  const i1 = parse(ing.i1 ?? ing['1'] ?? ing.inning1 ?? ing.first);
  const i2 = parse(ing.i2 ?? ing['2'] ?? ing.inning2 ?? ing.second);
  const i3 = parse(ing.i3 ?? ing['3'] ?? ing.inning3 ?? ing.third);
  const i4 = parse(ing.i4 ?? ing['4'] ?? ing.inning4 ?? ing.fourth);
  if (!i1 && !i2) return null;
  return { inning1: i1, inning2: i2, inning3: i3, inning4: i4 };
}

// ─── Rugby score breakdown ──────────────────────────────────────────────────
interface RugbyPeriodScore {
  homeTries: number; awayTries: number;
  homeConversions: number; awayConversions: number;
  homePenalties: number; awayPenalties: number;
  homeDropGoals: number; awayDropGoals: number;
  homePoints: number; awayPoints: number;
}
interface RugbyBreakdown { h1: RugbyPeriodScore; h2: RugbyPeriodScore; }

function emptyRugbyPeriod(): RugbyPeriodScore {
  return { homeTries: 0, awayTries: 0, homeConversions: 0, awayConversions: 0, homePenalties: 0, awayPenalties: 0, homeDropGoals: 0, awayDropGoals: 0, homePoints: 0, awayPoints: 0 };
}

function extractRugbyBreakdown(stats: any, events: MatchEvent[]): RugbyBreakdown | null {
  const rugbyEvents = events.filter((e) => {
    const t = (e.eventType ?? '').toLowerCase();
    return t.includes('try') || t.includes('conversion') || t.includes('penalty') || t.includes('drop');
  });
  if (rugbyEvents.length === 0) {
    // Try stats object fallback
    if (!stats) return null;
    const halves = stats.halves ?? stats.periods ?? stats.scoreline?.halves ?? null;
    if (!halves) return null;
    const h1 = emptyRugbyPeriod(); const h2 = emptyRugbyPeriod();
    const parseHalf = (v: any, p: RugbyPeriodScore) => {
      if (!v) return;
      p.homePoints = Number(v.home ?? v.homeScore ?? 0);
      p.awayPoints = Number(v.away ?? v.awayScore ?? 0);
    };
    parseHalf(halves.h1 ?? halves['1'] ?? halves.first, h1);
    parseHalf(halves.h2 ?? halves['2'] ?? halves.second, h2);
    if (h1.homePoints + h1.awayPoints + h2.homePoints + h2.awayPoints === 0) return null;
    return { h1, h2 };
  }
  const h1 = emptyRugbyPeriod(); const h2 = emptyRugbyPeriod();
  rugbyEvents.forEach((e) => {
    const period = e.minute <= 40 ? h1 : h2;
    const t = (e.eventType ?? '').toLowerCase();
    if (t.includes('try')) {
      if (e.isHomeTeam) { period.homeTries++; period.homePoints += 5; }
      else { period.awayTries++; period.awayPoints += 5; }
    } else if (t.includes('conversion')) {
      if (e.isHomeTeam) { period.homeConversions++; period.homePoints += 2; }
      else { period.awayConversions++; period.awayPoints += 2; }
    } else if (t.includes('penalty')) {
      if (e.isHomeTeam) { period.homePenalties++; period.homePoints += 3; }
      else { period.awayPenalties++; period.awayPoints += 3; }
    } else if (t.includes('drop')) {
      if (e.isHomeTeam) { period.homeDropGoals++; period.homePoints += 3; }
      else { period.awayDropGoals++; period.awayPoints += 3; }
    }
  });
  if (h1.homePoints + h1.awayPoints + h2.homePoints + h2.awayPoints === 0) return null;
  return { h1, h2 };
}

function extractHockeyBreakdown(stats: any): HockeyScoreBreakdown | null {
  if (!stats) return null;
  const p = stats.periods ?? stats.scoreline?.periods ?? stats.quarters ?? null;
  if (!p) return null;
  const parse = (v: any): PeriodScore | undefined => {
    if (!v) return undefined;
    if (typeof v === 'object' && ('home' in v || 'away' in v)) return { home: Number(v.home ?? 0), away: Number(v.away ?? 0) };
    return undefined;
  };
  return { p1: parse(p.p1 ?? p['1']), p2: parse(p.p2 ?? p['2']), p3: parse(p.p3 ?? p['3']), ot: parse(p.ot ?? p.overtime), so: parse(p.so ?? p.shootout) };
}

// Returns which tabs are visible based on match status & sport
// SPEC: Timeline and Lineups ONLY for football (live) and rugby (live).
// Other sports never show Timeline or Lineups.
function getAvailableTabs(status: string, sport: string): TabKey[] {
  const isLive = status === 'live';
  const sp = sport?.toLowerCase() ?? '';
  const isFootball = sp === 'football' || sp === 'soccer';
  const isRugby = sp === 'rugby' || sp === 'rugby_union' || sp === 'rugby_league' || sp.includes('rugby');
  // Base tabs available for all sports regardless of status
  const baseTabs: TabKey[] = ['overview', 'prediction', 'stats', 'odds'];
  if (!isLive) return baseTabs;
  // Live football: full set including chat, timeline, lineups
  if (isFootball) return ['overview', 'prediction', 'stats', 'odds', 'chat', 'timeline', 'lineups'];
  // Live rugby: timeline and lineups without chat
  if (isRugby) return ['overview', 'prediction', 'stats', 'odds', 'timeline', 'lineups'];
  // All other live sports: base tabs only — NO timeline or lineups
  return baseTabs;
}

// ─── Match shape used by sub-components ─────────────────────────────────────
type MatchDetail = {
  id: string; sport: string; homeTeam: string; awayTeam: string;
  homeScore: number; awayScore: number; status: 'live' | 'upcoming' | 'finished';
  matchTime: string; league: string; venue?: string; minute?: number;
  homeOdds?: number; drawOdds?: number; awayOdds?: number;
  homeLogo?: string | null; awayLogo?: string | null; leagueLogo?: string | null;
  stats?: import('@/services/types').MatchStats; externalId?: string;
  homeForm?: string[]; awayForm?: string[];
};

// ─── Live Odds Types ──────────────────────────────────────────────────────────
interface LiveOddsSnapshot {
  home: number;
  draw: number | null;
  away: number;
  timestamp: number;
}

function deriveBaseOdds(match: MatchDetail): { home: number; draw: number | null; away: number } {
  const isTennis = match.sport?.toLowerCase() === 'tennis';
  const isBball = match.sport?.toLowerCase() === 'basketball';
  const seed = match.homeTeam.charCodeAt(0) * 7 + match.awayTeam.charCodeAt(0) * 13;
  const jitter = (n: number) => parseFloat((n + ((seed % 20) - 10) / 100).toFixed(2));
  const home = jitter(match.homeOdds || (isTennis ? 1.80 : isBball ? 1.95 : 1.85));
  const away = jitter(match.awayOdds || (isTennis ? 2.00 : isBball ? 1.90 : 4.20));
  const draw = (isTennis || isBball) ? null : jitter(match.drawOdds || 3.50);
  return { home, draw, away };
}

function fluctuateOdds(base: number, seed: number, step: number): number {
  const delta = (Math.sin(seed * 0.37 + step * 1.91) * 0.5 + Math.cos(seed * 0.13 + step * 0.77) * 0.5) * 0.06;
  return Math.max(1.01, parseFloat((base + delta).toFixed(2)));
}

function useLiveOdds(match: MatchDetail) {
  const base = React.useMemo(() => deriveBaseOdds(match), [match.id]);
  const stepRef = useRef(0);
  const seed = match.homeTeam.charCodeAt(0) * 17 + match.awayTeam.charCodeAt(0) * 11;

  const makeSnapshot = useCallback((): LiveOddsSnapshot => {
    const s = stepRef.current;
    return {
      home: fluctuateOdds(base.home, seed, s),
      draw: base.draw !== null ? fluctuateOdds(base.draw, seed + 7, s) : null,
      away: fluctuateOdds(base.away, seed + 13, s),
      timestamp: Date.now(),
    };
  }, [base, seed]);

  const [current, setCurrent] = useState<LiveOddsSnapshot>(() => makeSnapshot());
  const [previous, setPrevious] = useState<LiveOddsSnapshot | null>(null);

  useEffect(() => {
    stepRef.current = 1;
    const next = makeSnapshot();
    setPrevious(current);
    setCurrent(next);
    const id = setInterval(() => {
      stepRef.current += 1;
      setCurrent((prev) => { setPrevious(prev); return makeSnapshot(); });
    }, 60_000);
    return () => clearInterval(id);
  }, [match.id]);

  return { current, previous };
}

// ─── Live Odds Row ─────────────────────────────────────────────────────────
function OddsMovementArrow({ current, prev, C }: { current: number; prev: number | null | undefined; C: AppColors }) {
  if (prev === null || prev === undefined || Math.abs(current - prev) < 0.005) {
    return <Ionicons name="remove" size={11} color={C.textMuted} />;
  }
  const shortened = current < prev;
  return <Ionicons name={shortened ? 'arrow-down' : 'arrow-up'} size={11} color={shortened ? C.accent : C.accentRed} />;
}

function OddsCell({ label, odds, prevOdds, color, C }: { label: string; odds: number; prevOdds: number | null | undefined; color: string; C: AppColors }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (prevOdds === null || prevOdds === undefined) return;
    if (Math.abs(odds - prevOdds) < 0.005) return;
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.3, duration: 120, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [odds]);

  const shortened = prevOdds !== null && prevOdds !== undefined && odds < prevOdds;
  const changed = Math.abs((prevOdds ?? odds) - odds) >= 0.005;
  const bgColor = changed ? (shortened ? C.accentDim : C.accentRedDim) : C.surface;
  const borderColor = changed ? (shortened ? `${C.accent}55` : `${C.accentRed}55`) : C.border;

  return (
    <Animated.View style={[liveOddsStyles.cell, { backgroundColor: bgColor, borderColor, opacity: pulseAnim }]}>
      <Text style={[liveOddsStyles.cellLabel, { color: C.textMuted }]}>{label}</Text>
      <View style={liveOddsStyles.oddsRow}>
        <OddsMovementArrow current={odds} prev={prevOdds} C={C} />
        <Text style={[liveOddsStyles.oddsValue, { color }]}>{odds.toFixed(2)}</Text>
      </View>
      {changed && prevOdds !== null && prevOdds !== undefined ? (
        <Text style={[liveOddsStyles.prevOdds, { color: shortened ? C.accent : C.accentRed }]}>was {prevOdds.toFixed(2)}</Text>
      ) : (
        <Text style={liveOddsStyles.prevOddsPlaceholder}>{'  '}</Text>
      )}
    </Animated.View>
  );
}

function LiveOddsRow({ match, C }: { match: MatchDetail; C: AppColors }) {
  const { current, previous } = useLiveOdds(match);
  const isTennis = match.sport?.toLowerCase() === 'tennis';
  const isBball = match.sport?.toLowerCase() === 'basketball';
  const showDraw = !isTennis && !isBball;
  const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
  const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
  const prevHome = previous?.home ?? null;
  const prevDraw = previous?.draw ?? null;
  const prevAway = previous?.away ?? null;

  return (
    <View style={[liveOddsStyles.card, { backgroundColor: C.card, borderColor: `${C.accentBlue}33` }]}>
      <View style={liveOddsStyles.header}>
        <View style={liveOddsStyles.headerLeft}>
          <View style={[liveOddsStyles.livePill, { backgroundColor: `${C.accentBlue}12`, borderColor: `${C.accentBlue}44` }]}>
            <View style={[liveOddsStyles.liveDot, { backgroundColor: C.accentBlue }]} />
            <Text style={[liveOddsStyles.liveText, { color: C.accentBlue }]}>LIVE ODDS</Text>
          </View>
          <Text style={[liveOddsStyles.subtitle, { color: C.textMuted }]}>Updates every 60s</Text>
        </View>
        <View style={[liveOddsStyles.refreshPill, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="sync-outline" size={10} color={C.textMuted} />
          <Text style={[liveOddsStyles.refreshText, { color: C.textMuted }]}>
            {new Date(current.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
      <View style={liveOddsStyles.cells}>
        <OddsCell label={`1 — ${homeAbbr}`} odds={current.home} prevOdds={prevHome} color={C.accentBlue} C={C} />
        {showDraw ? <OddsCell label="X — Draw" odds={current.draw ?? 3.50} prevOdds={prevDraw} color={C.primary} C={C} /> : null}
        <OddsCell label={`2 — ${awayAbbr}`} odds={current.away} prevOdds={prevAway} color={C.accentRed} C={C} />
      </View>
      <View style={liveOddsStyles.footer}>
        <Ionicons name="information-circle-outline" size={11} color={C.textMuted} />
        <Text style={[liveOddsStyles.footerText, { color: C.textMuted }]}>↓ odds shortened (more likely)  ·  ↑ odds drifted (less likely)</Text>
      </View>
    </View>
  );
}

const heroBreak = StyleSheet.create({
  row: { flexDirection: 'row' as const, gap: 4, marginTop: 8, justifyContent: 'center' as const },
  cell: { alignItems: 'center' as const, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4, minWidth: 38 },
  qLabel: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  qScore: { fontSize: 11, fontWeight: FONTS.semiBold },
});

const liveOddsStyles = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  subtitle: { fontSize: 10 },
  refreshPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  refreshText: { fontSize: 9, fontWeight: FONTS.medium },
  cells: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 4, gap: 3 },
  cellLabel: { fontSize: 10, fontWeight: FONTS.semiBold, textAlign: 'center' },
  oddsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  oddsValue: { fontSize: 20, fontWeight: FONTS.extraBold },
  prevOdds: { fontSize: 9, fontWeight: FONTS.medium, textDecorationLine: 'line-through', opacity: 0.7 },
  prevOddsPlaceholder: { fontSize: 9, color: 'transparent' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 9, flex: 1, lineHeight: 13 },
});

// ─── Notification helpers ─────────────────────────────────────────────────────
const REMINDER_STORAGE_KEY = 'match_reminders_v1';

async function getStoredReminders(): Promise<Record<string, string>> {
  try { const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

async function setStoredReminder(matchId: string, notifId: string | null): Promise<void> {
  try {
    const reminders = await getStoredReminders();
    if (notifId) { reminders[matchId] = notifId; } else { delete reminders[matchId]; }
    await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(reminders));
  } catch { /* silent */ }
}

async function requestNotifPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function scheduleMatchReminder(matchId: string, matchTitle: string, kickoffIso: string): Promise<string | null> {
  const kickoff = new Date(kickoffIso).getTime();
  const triggerMs = kickoff - 30 * 60 * 1000;
  if (triggerMs <= Date.now()) return null;
  const seconds = Math.floor((triggerMs - Date.now()) / 1000);
  const notifId = await Notifications.scheduleNotificationAsync({
    content: { title: 'Match Reminder ⚽', body: `${matchTitle} kicks off in 30 minutes!`, sound: true, data: { matchId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false },
  });
  return notifId;
}

async function cancelMatchReminder(matchId: string): Promise<void> {
  const reminders = await getStoredReminders();
  const notifId = reminders[matchId];
  if (notifId) { try { await Notifications.cancelScheduledNotificationAsync(notifId); } catch { /* silent */ } }
  await setStoredReminder(matchId, null);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

function formatMatchTime(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── DB row → MatchDetail ───────────────────────────────────────────────────
function rowToMatchDetail(row: Record<string, unknown>): MatchDetail {
  return {
    id: row.id as string,
    sport: (row.sport as string) ?? 'football',
    homeTeam: (row.home_team as string) ?? '',
    awayTeam: (row.away_team as string) ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: (row.status as 'live' | 'upcoming' | 'finished') ?? 'upcoming',
    matchTime: (row.match_time as string) ?? new Date().toISOString(),
    league: (row.league as string) ?? '',
    venue: row.venue as string | undefined,
    minute: Number(row.minute ?? 0),
    homeOdds: row.home_odds != null ? Number(row.home_odds) : undefined,
    drawOdds: row.draw_odds != null ? Number(row.draw_odds) : undefined,
    awayOdds: row.away_odds != null ? Number(row.away_odds) : undefined,
    homeLogo: (row.home_logo as string) ?? null,
    awayLogo: (row.away_logo as string) ?? null,
    leagueLogo: (row.league_logo as string) ?? null,
    stats: (row.stats as import('@/services/types').MatchStats) ?? null,
    externalId: row.external_id as string | undefined,
    homeForm: Array.isArray(row.home_form) ? (row.home_form as string[]) : [],
    awayForm: Array.isArray(row.away_form) ? (row.away_form as string[]) : [],
  };
}

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: C } = useTheme();
  const [tab, setTab] = useState<TabKey>('overview');

  // Load match from DB
  const [match, setMatch] = useState<ReturnType<typeof rowToMatchDetail> | null>(null);
  const [matchLoading, setMatchLoading] = useState(true);

  // Real data from matchStatsService and aiPicksService
  const [detailData, setDetailData] = useState<DetailedMatchData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [h2hRecords, setH2hRecords] = useState<H2HRecord[]>([]);
  const [h2hLoading, setH2hLoading] = useState(false);
  const pollDetailRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) { setMatchLoading(false); return; }
    getSupabaseClient()
      .from('matches')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setMatch(rowToMatchDetail(data as Record<string, unknown>));
        setMatchLoading(false);
      })
      .catch(() => setMatchLoading(false));
  }, [id]);

  const { prediction, loading: predLoading, reload } = usePredictionForMatch(id || '');

  // Load detailed stats/events/odds and H2H when match is ready
  useEffect(() => {
    if (!match) return;
    setDetailLoading(true);
    fetchDetailedMatchData(match.id, match.status)
      .then((d) => { if (d) setDetailData(d); })
      .finally(() => setDetailLoading(false));

    setH2hLoading(true);
    fetchHeadToHead(match.homeTeam, match.awayTeam, match.sport ?? 'football')
      .then((r) => setH2hRecords(r))
      .finally(() => setH2hLoading(false));

    // Live polling for stats/events
    if (match.status === 'live') {
      pollDetailRef.current = setInterval(() => {
        fetchDetailedMatchData(match.id, 'live', true)
          .then((d) => { if (d) setDetailData(d); });
      }, 30_000);
    }
    return () => {
      if (pollDetailRef.current) { clearInterval(pollDetailRef.current); pollDetailRef.current = null; }
    };
  }, [match?.id]);

  const matchTitle = match ? `${match.homeTeam} vs ${match.awayTeam}` : 'Match Discussion';
  const { room, messages, loading: chatLoading, sending, send } = useMatchChat(id || '', matchTitle);
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { isFollowing, toggleFollow } = useFollowedMatches();
  const following = id ? isFollowing(id) : false;

  const [reminderSet, setReminderSet] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);

  // ─── VIP + Coin state ─────────────────────────────────────────────────────
  const [isVip, setIsVip] = useState(false);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [predUnlocked, setPredUnlocked] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    checkActiveSubscription(user.id).then((s) => setIsVip(s.isVip));
    getSupabaseClient()
      .from('user_coins')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setCoinBalance(data?.balance ?? 0));
  }, [user?.id]);

  const handleCoinUnlock = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    if ((coinBalance ?? 0) < 5) {
      showAlert('Not Enough Coins', 'You need at least 5 coins to unlock this prediction. Earn coins from the Daily Challenge or purchase a coin pack.', [
        { text: 'Get Coins', onPress: () => router.push('/vip' as any) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return false;
    }
    try {
      const { error } = await getSupabaseClient().rpc('add_user_coins', {
        p_user_id: user.id,
        p_amount: -5,
      });
      if (error) throw error;
      setCoinBalance((prev) => Math.max(0, (prev ?? 0) - 5));
      setPredUnlocked(true);
      try {
        await getSupabaseClient().from('notifications').insert({
          user_id: user.id,
          title: 'AI Analysis Unlocked 🔓',
          body: 'You spent 5 coins to unlock the AI match analysis.',
          type: 'general',
          read: false,
        });
      } catch { /* non-blocking */ }
      return true;
    } catch {
      showAlert('Error', 'Failed to deduct coins. Please try again.');
      return false;
    }
  }, [user?.id, coinBalance, showAlert, router]);

  useEffect(() => {
    if (!id) return;
    getStoredReminders().then((reminders) => { setReminderSet(!!reminders[id]); });
  }, [id]);

  const handleReminderToggle = useCallback(async () => {
    if (!id || !match) return;
    setReminderLoading(true);
    if (reminderSet) {
      await cancelMatchReminder(id);
      setReminderSet(false);
      showAlert('Reminder Removed', 'Match reminder has been cancelled.');
    } else {
      const granted = await requestNotifPermission();
      if (!granted) { showAlert('Permission Required', 'Please enable notifications in your device settings to set match reminders.', [{ text: 'OK' }]); setReminderLoading(false); return; }
      if (match.status !== 'upcoming') { showAlert('Cannot Set Reminder', 'Reminders can only be set for upcoming matches.'); setReminderLoading(false); return; }
      const kickoffMs = new Date(match.matchTime).getTime();
      if (kickoffMs - 30 * 60 * 1000 <= Date.now()) { showAlert('Too Late', 'The match starts in less than 30 minutes — no time to remind!'); setReminderLoading(false); return; }
      const notifId = await scheduleMatchReminder(id, matchTitle, match.matchTime);
      if (notifId) { await setStoredReminder(id, notifId); setReminderSet(true); showAlert('Reminder Set! 🔔', `You will be notified 30 minutes before ${matchTitle} kicks off.`); }
      else { showAlert('Error', 'Could not schedule reminder. Please try again.'); }
    }
    setReminderLoading(false);
  }, [id, match, matchTitle, reminderSet, showAlert]);

  const { generate, generating, error: genError } = useGeneratePrediction();

  const handleGenerate = async () => {
    if (!match) return;
    const matchForGen: import('@/services/types').Match = {
      id: match.id,
      sport: match.sport,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      matchTime: match.matchTime,
      league: match.league,
      venue: match.venue,
      minute: match.minute,
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      homeLogo: match.homeLogo,
      awayLogo: match.awayLogo,
      stats: match.stats ?? null,
      externalId: match.externalId,
    };
    const newPred = await generate(matchForGen);
    if (newPred) await reload();
  };

  // Auto-generate prediction in background when none exists
  const autoGenAttemptedRef = useRef(false);
  useEffect(() => {
    if (predLoading || !match || prediction || autoGenAttemptedRef.current) return;
    autoGenAttemptedRef.current = true;
    const matchForGen: import('@/services/types').Match = {
      id: match.id,
      sport: match.sport,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      matchTime: match.matchTime,
      league: match.league,
      venue: match.venue,
      minute: match.minute,
      homeOdds: match.homeOdds,
      drawOdds: match.drawOdds,
      awayOdds: match.awayOdds,
      homeLogo: match.homeLogo,
      awayLogo: match.awayLogo,
      stats: match.stats ?? null,
      externalId: match.externalId,
    };
    generate(matchForGen).then((newPred) => {
      if (newPred) reload();
    }).catch(() => { /* non-blocking */ });
  }, [predLoading, match?.id, !!prediction]);

  // Poll live match scores every 30s when live
  useEffect(() => {
    if (!id || !match || match.status !== 'live') return;
    const interval = setInterval(() => {
      getSupabaseClient()
        .from('matches').select('*').eq('id', id).single()
        .then(({ data }) => { if (data) setMatch(rowToMatchDetail(data as Record<string, unknown>)); })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [id, match?.status]);

  if (matchLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!match) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}>
          <Pressable onPress={() => router.back()} style={styles.backRow}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
        </SafeAreaView>
        <View style={styles.centered}><Text style={[styles.errorText, { color: C.textMuted }]}>Match not found</Text></View>
      </View>
    );
  }

  const homeAbbr = match.homeTeam ? match.homeTeam.split(' ').map((w: string) => w[0]).join('').slice(0, 3).toUpperCase() : 'HME';
  const awayAbbr = match.awayTeam ? match.awayTeam.split(' ').map((w: string) => w[0]).join('').slice(0, 3).toUpperCase() : 'AWY';
  const homeLogo = match.homeLogo ?? null;
  const awayLogo = match.awayLogo ?? null;
  const leagueLogo = match.leagueLogo ?? null;
  const confColor = prediction ? getConfidenceColor(prediction.confidence) : C.primary;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[styles.navHeader, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={styles.navCenter}>
            <View style={styles.navLeagueRow}>
              <Text style={styles.sportEmojiSmall}>{SPORT_ICONS[match.sport] || '🏆'}</Text>
              {leagueLogo ? (
                <Image
                  source={{ uri: leagueLogo }}
                  style={styles.navLeagueLogo}
                  contentFit="contain"
                  transition={150}
                />
              ) : null}
              <Text style={[styles.navLeague, { color: C.textSecondary }]} numberOfLines={1}>
                {match.league}
              </Text>
            </View>
          </View>
          <View style={styles.navRight}>
            {match.status === 'live' ? <Badge label="LIVE" variant="live" dot /> : null}
            {match.status === 'upcoming' ? (
              <Pressable onPress={handleReminderToggle} hitSlop={8} disabled={reminderLoading}
                style={({ pressed }) => [
                  styles.followBtn,
                  { backgroundColor: C.surface, borderColor: C.border },
                  reminderSet ? { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.4)' } : null,
                  pressed ? { opacity: 0.7 } : null,
                  reminderLoading ? { opacity: 0.5 } : null,
                ]}>
                {reminderLoading
                  ? <ActivityIndicator size={14} color={reminderSet ? C.primary : C.textMuted} />
                  : <Ionicons name={reminderSet ? 'alarm' : 'alarm-outline'} size={18} color={reminderSet ? C.primary : C.textMuted} />}
              </Pressable>
            ) : null}
            <Pressable onPress={() => id && toggleFollow(id)} hitSlop={8}
              style={({ pressed }) => [
                styles.followBtn,
                { backgroundColor: C.surface, borderColor: C.border },
                following ? { backgroundColor: C.accentDim, borderColor: 'rgba(0,255,135,0.4)' } : null,
                pressed ? { opacity: 0.7 } : null,
              ]}>
              <Ionicons name={following ? 'notifications' : 'notifications-outline'} size={18} color={following ? C.accent : C.textMuted} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {/* Hero Score */}
      <LinearGradient colors={[C.cardHighlight, C.surface, C.bg] as [string, string, string]} style={styles.hero}>
        <View style={styles.teamsRow}>
          <View style={styles.teamSide}>
            <View style={[styles.teamCircle, { backgroundColor: C.card, borderColor: C.border }]}>
              {homeLogo ? (
                <Image
                  source={{ uri: homeLogo }}
                  style={styles.teamLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <Text style={[styles.teamAbbr, { color: C.primary }]}>{homeAbbr}</Text>
              )}
            </View>
            <Text style={[styles.teamName, { color: C.textPrimary }]}>{match.homeTeam}</Text>
            <Text style={[styles.teamRole, { color: C.textMuted }]}>Home</Text>
          </View>
          <View style={styles.scoreCenter}>
            {match.status === 'upcoming' ? (
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.vsLabel, { color: C.textMuted }]}>VS</Text>
                <Text style={[styles.matchDateText, { color: C.textMuted }]}>{formatMatchTime(match.matchTime)}</Text>
              </View>
            ) : (
              <View style={styles.scoreBlock}>
                <Text style={[styles.bigScore, { color: C.textPrimary }, match.status === 'live' ? { color: C.accent } : null]}>
                  {detailData?.homeScore ?? match.homeScore} - {detailData?.awayScore ?? match.awayScore}
                </Text>
                {match.status === 'live'
                  ? <Text style={[styles.minuteText, { color: C.accent }]}>{detailData?.minute ?? match.minute}'</Text>
                  : <Text style={[styles.ftText, { color: C.textMuted }]}>Full Time</Text>}
                {/* Mini quarter/period summary in hero */}
                {(() => {
                  const sp = match.sport?.toLowerCase();
                  const st = match.stats as any;
                  if (sp === 'basketball') {
                    const bk = extractBasketballBreakdown(st);
                    if (bk) {
                      const qs: { key: keyof BasketballScoreBreakdown; label: string }[] = [
                        { key: 'q1', label: 'Q1' }, { key: 'q2', label: 'Q2' },
                        { key: 'q3', label: 'Q3' }, { key: 'q4', label: 'Q4' },
                        { key: 'ot', label: 'OT' },
                      ].filter(q => bk[q.key] !== undefined);
                      if (qs.length > 0) return (
                        <View style={heroBreak.row}>
                          {qs.map(q => { const s = bk[q.key]!; return (
                            <View key={q.key} style={[heroBreak.cell, { borderColor: C.border }]}>
                              <Text style={[heroBreak.qLabel, { color: C.textMuted }]}>{q.label}</Text>
                              <Text style={[heroBreak.qScore, { color: C.textSecondary }]}>{s.home}-{s.away}</Text>
                            </View>
                          ); })}
                        </View>
                      );
                    }
                  }
                  if (sp === 'hockey') {
                    const hk = extractHockeyBreakdown(st);
                    if (hk) {
                      const ps: { key: keyof HockeyScoreBreakdown; label: string }[] = [
                        { key: 'p1', label: 'P1' }, { key: 'p2', label: 'P2' }, { key: 'p3', label: 'P3' },
                        { key: 'ot', label: 'OT' }, { key: 'so', label: 'SO' },
                      ].filter(p => hk[p.key] !== undefined);
                      if (ps.length > 0) return (
                        <View style={heroBreak.row}>
                          {ps.map(p => { const s = hk[p.key]!; return (
                            <View key={p.key} style={[heroBreak.cell, { borderColor: C.border }]}>
                              <Text style={[heroBreak.qLabel, { color: C.textMuted }]}>{p.label}</Text>
                              <Text style={[heroBreak.qScore, { color: C.textSecondary }]}>{s.home}-{s.away}</Text>
                            </View>
                          ); })}
                        </View>
                      );
                    }
                  }
                  if (sp === 'tennis') {
                    const tn = extractTennisSetBreakdown(st);
                    if (tn && tn.sets.length > 0) {
                      const homeSets = tn.sets.filter(s => s.home > s.away).length;
                      const awaySets = tn.sets.filter(s => s.away > s.home).length;
                      return (
                        <View style={{ alignItems: 'center' as const, gap: 4, marginTop: 6 }}>
                          <View style={heroBreak.row}>
                            {tn.sets.map((s, i) => {
                              const hWon = s.home > s.away; const aWon = s.away > s.home;
                              const sc = hWon ? C.accentBlue : aWon ? C.accentRed : C.border;
                              return (
                                <View key={i} style={[heroBreak.cell, { borderColor: sc, minWidth: 42 }]}>
                                  <Text style={[heroBreak.qLabel, { color: C.textMuted }]}>S{i + 1}</Text>
                                  <Text style={[heroBreak.qScore, { color: hWon ? C.accentBlue : aWon ? C.accentRed : C.textSecondary }]}>
                                    {s.home}-{s.away}
                                  </Text>
                                  {s.homeTiebreak != null ? (
                                    <Text style={{ fontSize: 7, color: C.textMuted }}>{s.homeTiebreak}/{s.awayTiebreak}</Text>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>
                          <View style={{ flexDirection: 'row' as const, gap: 10, marginTop: 2 }}>
                            <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: C.accentBlue }}>{homeSets} Sets</Text>
                            <Text style={{ fontSize: 10, color: C.textMuted }}>vs</Text>
                            <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: C.accentRed }}>{awaySets} Sets</Text>
                          </View>
                        </View>
                      );
                    }
                  }
                  return null;
                })()}
              </View>
            )}
          </View>
          <View style={styles.teamSide}>
            <View style={[styles.teamCircle, { backgroundColor: C.card, borderColor: C.border }]}>
              {awayLogo ? (
                <Image
                  source={{ uri: awayLogo }}
                  style={styles.teamLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <Text style={[styles.teamAbbr, { color: C.primary }]}>{awayAbbr}</Text>
              )}
            </View>
            <Text style={[styles.teamName, { color: C.textPrimary }]}>{match.awayTeam}</Text>
            <Text style={[styles.teamRole, { color: C.textMuted }]}>Away</Text>
          </View>
        </View>
        <SportStatsBar match={match} />
        {match.venue ? (
          <View style={styles.venueRow}>
            <Ionicons name="location-outline" size={13} color={C.textMuted} />
            <Text style={[styles.venue, { color: C.textMuted }]}>{match.venue}</Text>
          </View>
        ) : null}
      </LinearGradient>

      {/* Tabs — conditional based on match status */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={[styles.tabsRowWrapper, { backgroundColor: C.surface, borderBottomColor: C.border }]}
        contentContainerStyle={styles.tabsScroll}>
        {getAvailableTabs(match.status, match.sport).map((t) => (
          <Pressable key={t}
            style={[styles.tabItem, { borderBottomColor: tab === t ? C.primary : 'transparent' }]}
            onPress={() => setTab(t)}>
            <Text
              style={[styles.tabLabel, { color: tab === t ? C.primary : C.textMuted }, tab === t ? { fontWeight: FONTS.bold } : null]}
              numberOfLines={1}
            >
              {t === 'overview' ? 'Overview' : t === 'prediction' ? 'AI Picks' : t === 'stats' ? 'Stats' : t === 'odds' ? 'Odds' : t === 'chat' ? 'Chat' : t === 'timeline' ? 'Timeline' : 'Lineups'}
            </Text>
            {t === 'prediction' && prediction ? <View style={[styles.tabDot, { backgroundColor: confColor }]} /> : null}
            {t === 'chat' && messages.length > 0 ? <View style={[styles.tabDot, { backgroundColor: C.accentBlue }]} /> : null}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tab === 'overview' ? (
          <MatchOverviewTab match={match} C={C} detailData={detailData} h2hRecords={h2hRecords} h2hLoading={h2hLoading} prediction={prediction} isVip={isVip} coinBalance={coinBalance ?? 0} />
        ) : null}
        {tab === 'prediction' ? (
          <PredictionTab
            match={match}
            prediction={prediction}
            predLoading={predLoading}
            generating={generating}
            genError={genError}
            onGenerate={handleGenerate}
            C={C}
            isVip={isVip}
            coinBalance={coinBalance}
            unlocked={predUnlocked}
            onCoinUnlock={handleCoinUnlock}
            userId={user?.id ?? null}
          />
        ) : null}
        {tab === 'stats' ? (
          <StatsTab match={match} C={C} detailData={detailData} detailLoading={detailLoading} h2hRecords={h2hRecords} />
        ) : null}
        {tab === 'odds' ? (
          <OddsTab match={match} C={C} detailData={detailData} />
        ) : null}
        {tab === 'timeline' ? (
          <TimelineTab match={match} C={C} detailData={detailData} detailLoading={detailLoading} matchId={id || ''} />
        ) : null}
        {tab === 'lineups' ? <LineupsTab match={match} C={C} /> : null}
        {tab !== 'chat' ? <View style={{ height: 40 }} /> : null}
      </ScrollView>

      {tab === 'chat' ? (
        <ChatTab messages={messages} loading={chatLoading} sending={sending} onSend={send}
          currentUserId={user?.id ?? null} roomName={room?.name ?? matchTitle} C={C} />
      ) : null}
    </View>
  );
}

// ─── Shared section card style tokens (used across Overview, Stats, Odds tabs) ──
const SC2: any = { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16 };
const ST2: any = { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.9, marginBottom: 14 };

// ─── Accuracy data (resolved prediction_outcomes) ────────────────────────────
const SPORT_ACCURACY_DATA: Record<string, { pct: number; total: number; avg7d?: number; avg30d?: number }> = {
  football:   { pct: 43, total: 1371, avg7d: 43, avg30d: 43 },
  volleyball: { pct: 68, total: 126,  avg7d: 67, avg30d: 68 },
  baseball:   { pct: 58, total: 102,  avg7d: 58, avg30d: 58 },
  hockey:     { pct: 91, total: 11,   avg7d: 91, avg30d: 91 },
  rugby:      { pct: 0,  total: 1 },
};

function AccuracyBadgeInline({ sport, C }: { sport: string; C: AppColors }) {
  const data = SPORT_ACCURACY_DATA[sport?.toLowerCase() ?? ''];
  if (!data) return null;
  const color = data.pct >= 70 ? '#22C55E' : data.pct >= 55 ? '#F59E0B' : C.accentRed;
  return (
    <View style={[abInline.wrap, { backgroundColor: `${color}12`, borderColor: `${color}33` }]}>
      <Ionicons name="checkmark-circle" size={11} color={color} />
      <Text style={[abInline.pct, { color }]}>{data.pct}%</Text>
      <Text style={[abInline.label, { color: C.textMuted }]}>accuracy ({data.total} resolved)</Text>
    </View>
  );
}

const abInline = StyleSheet.create({
  wrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  pct: { fontSize: 12, fontWeight: FONTS.extraBold },
  label: { fontSize: 10 },
});

// ─── Prediction Tab ───────────────────────────────────────────────────────────
const COIN_UNLOCK_COST = 5;

function PredictionTab({ match, prediction, predLoading, generating, genError, onGenerate, C, isVip, coinBalance, unlocked, onCoinUnlock, userId }: {
  match: MatchDetail;
  prediction: ReturnType<typeof usePredictionForMatch>['prediction'];
  predLoading: boolean; generating: boolean; genError: string | null;
  onGenerate: () => void; C: AppColors;
  isVip: boolean;
  coinBalance: number | null;
  unlocked: boolean;
  onCoinUnlock: () => Promise<boolean>;
  userId: string | null;
}) {
  const [unlocking, setUnlocking] = useState(false);
  const confColor = prediction ? getConfidenceColor(prediction.confidence) : C.primary;

  const handleUnlock = async () => {
    setUnlocking(true);
    await onCoinUnlock();
    setUnlocking(false);
  };

  const analysisVisible = isVip || unlocked || !userId;

  if (predLoading) return (
    <View style={styles.centered}>
      <ActivityIndicator color={C.primary} size="large" />
      <Text style={[styles.loadingText, { color: C.textMuted }]}>Loading prediction...</Text>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      {/* ── Accuracy banner at the top of AI Report ─────────────────── */}
      <View style={[{ borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 }, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome5 name="brain" size={14} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: FONTS.bold as any, color: C.textPrimary }}>AI Prediction Engine</Text>
            <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>Multi-model consensus · {match.sport?.charAt(0).toUpperCase() + match.sport?.slice(1)} analysis</Text>
          </View>
          <AccuracyBadgeInline sport={match.sport} C={C} />
        </View>
        {/* Per-market accuracy pills */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {getSportAccuracyMarkets(match.sport, SPORT_ACCURACY_DATA[match.sport]?.pct ?? 52).map((item) => {
            const c2 = item.pct >= 65 ? '#22C55E' : item.pct >= 55 ? '#F59E0B' : C.accentRed;
            return (
              <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1,
                borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 8,
                backgroundColor: `${c2}0A`, borderColor: `${c2}22` }}>
                <Ionicons name={item.icon as any} size={12} color={c2} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.semiBold as any }}>{item.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold as any, color: c2 }}>{item.pct}%</Text>
                </View>
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }}>
          <Ionicons name="information-circle-outline" size={11} color={C.textMuted} />
          <Text style={{ fontSize: 10, color: C.textMuted, flex: 1, lineHeight: 14 }}>
            Based on {SPORT_ACCURACY_DATA[match.sport]?.total ?? '—'} resolved outcomes. Accuracy varies by league and season phase.
          </Text>
        </View>
      </View>

      {!prediction ? (
        <GlassCard style={styles.generateCard}>
          <View style={styles.generateIconRow}>
            <View style={[styles.generateIconBg, { backgroundColor: C.primaryGlow, borderColor: C.primary }]}>
              <FontAwesome5 name="brain" size={24} color={C.primary} />
            </View>
          </View>
          <Text style={[styles.generateTitle, { color: C.textPrimary }]}>No prediction yet</Text>
          <Text style={[styles.generateSubtitle, { color: C.textSecondary }]}>Let our AI analyze team form, H2H stats, league position, and xG data to generate a prediction for this match.</Text>
          {genError ? (
            <View style={[styles.errorBox, { backgroundColor: C.accentRedDim, borderColor: C.accentRed }]}>
              <Ionicons name="warning-outline" size={14} color={C.accentRed} />
              <Text style={[styles.errorBoxText, { color: C.accentRed }]} numberOfLines={3}>{genError}</Text>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.generateBtn, { backgroundColor: C.primary }, pressed ? styles.generateBtnPressed : null, generating ? styles.generateBtnDisabled : null]}
            onPress={onGenerate} disabled={generating}>
            {generating ? (
              <><ActivityIndicator size="small" color={C.textInverse} /><Text style={[styles.generateBtnText, { color: C.textInverse }]}>Analyzing match...</Text></>
            ) : (
              <><FontAwesome5 name="robot" size={14} color={C.textInverse} /><Text style={[styles.generateBtnText, { color: C.textInverse }]}>Generate AI Prediction</Text></>
            )}
          </Pressable>
        </GlassCard>
      ) : (
        <>
          <GlassCard style={styles.confCard}>
            <View style={styles.confRow}>
              <View style={styles.confLeft}>
                <FontAwesome5 name="brain" size={16} color={C.primary} />
                <View>
                  <Text style={[styles.confTitle, { color: C.textPrimary }]}>AI Confidence</Text>
                  <Text style={[styles.confSubtitle, { color: C.textMuted }]}>Based on statistical analysis</Text>
                </View>
              </View>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <View style={[styles.confCircle, { borderColor: confColor, backgroundColor: C.surface }]}>
                  <Text style={[styles.confPct, { color: confColor }]}>{prediction.confidence}%</Text>
                </View>
                {/* vs model accuracy */}
                {SPORT_ACCURACY_DATA[match.sport] ? (
                  <Text style={{ fontSize: 8, color: C.textMuted, textAlign: 'center' }}>
                    model {SPORT_ACCURACY_DATA[match.sport].pct}% acc
                  </Text>
                ) : null}
              </View>
            </View>
  <View style={styles.predChips}><PredChip label="Result" value={prediction.predictedResult==='home_win'?'1 Home':prediction.predictedResult==='draw'?'X Draw':'2 Away'} color={C.primary} C={C}/>{!['mma','boxing','tennis','volleyball'].includes(match.sport)?<PredChip label={`O/U ${prediction.overUnderLine}`} value={prediction.overUnder.toUpperCase()} color={C.accentBlue} C={C}/>:null}{['football','handball'].includes(match.sport)?<PredChip label="BTTS" value={prediction.btts.toUpperCase()} color={prediction.btts==='yes'?C.accent:C.accentRed} C={C}/>:null}</View>
          </GlassCard>
          <GlassCard>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Win Probability</Text>
            <PredictionBar prediction={prediction} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
          </GlassCard>
          {(() => {
            const predMarkets = buildPredictionMarkets(
              match.sport,
              {
                predictedResult: prediction.predictedResult,
                homeWinProb: prediction.homeWinProb,
                drawProb: prediction.drawProb,
                awayWinProb: prediction.awayWinProb,
                overUnder: prediction.overUnder,
                overUnderLine: prediction.overUnderLine,
                predictedHomeGoals: (prediction as any).predictedHomeGoals ?? null,
                predictedAwayGoals: (prediction as any).predictedAwayGoals ?? null,
                btts: prediction.btts,
                cornersOverUnder: (prediction as any).cornersOverUnder ?? null,
                cornersLine: (prediction as any).cornersLine ?? null,
                cardsTotal: (prediction as any).cardsTotal ?? null,
                cardsOverUnder: (prediction as any).cardsOverUnder ?? null,
                asianHandicapLine: (prediction as any).asianHandicapLine ?? null,
                asianHandicapPick: (prediction as any).asianHandicapPick ?? null,
                htResult: (prediction as any).htResult ?? null,
                htHomeProb: (prediction as any).htHomeProb ?? null,
                htDrawProb: (prediction as any).htDrawProb ?? null,
                htAwayProb: (prediction as any).htAwayProb ?? null,
                cleanSheetHome: (prediction as any).cleanSheetHome ?? null,
                cleanSheetAway: (prediction as any).cleanSheetAway ?? null,
                firstGoal: (prediction as any).firstGoal ?? null,
                bothScoreHt: (prediction as any).bothScoreHt ?? null,
                anytimeScorecast: (prediction as any).anytimeScorecast ?? null,
                correctScore: (prediction as any).correctScore ?? null,
                confidence: prediction.confidence,
                riskLevel: (prediction as any).riskLevel ?? null,
                valueScore: (prediction as any).valueScore ?? null,
                marketEdgePct: (prediction as any).marketEdgePct ?? null,
              },
              match.homeTeam,
              match.awayTeam,
              { primary: C.primary, accent: C.accent, accentBlue: C.accentBlue ?? C.primary, accentRed: C.accentRed ?? '#EF4444', textMuted: C.textMuted },
            ).slice(1); // skip first (generic result chip already shown)
            if (predMarkets.length === 0) return null;
            const chunks: typeof predMarkets[] = [];
            for (let i = 0; i < predMarkets.length; i += 4) chunks.push(predMarkets.slice(i, i + 4));
            return chunks.map((chunk, ci) => (
              <GlassCard key={`pm-${ci}`} style={{ gap: 10 }}>
                {ci === 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <FontAwesome5 name="brain" size={12} color={C.primary} />
                    <Text style={[styles.sectionTitle, { color: C.textSecondary, marginBottom: 0, flex: 1 }]}>PREDICTION MARKETS</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {chunk.map((m) => (
                    <View key={m.id} style={[{
                      borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12,
                      paddingVertical: 10, alignItems: 'center', minWidth: 100, flex: 1,
                    }, { backgroundColor: `${m.color}14`, borderColor: `${m.color}33` }]}>
                      {m.emoji ? <Text style={{ fontSize: 14, marginBottom: 4 }}>{m.emoji}</Text> : null}
                      <Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: C.textMuted, letterSpacing: 0.5, marginBottom: 4, textAlign: 'center' }}>{m.label}</Text>
                      <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold as any, color: m.color, textAlign: 'center' }}>{m.value}</Text>
                      {m.probability !== undefined ? <Text style={{ fontSize: 10, color: `${m.color}CC`, marginTop: 2 }}>{m.probability}%</Text> : null}
                    </View>
                  ))}
                </View>
              </GlassCard>
            ));
          })()}
          {analysisVisible ? (
            <GlassCard style={{ gap: 12 }}>
              <View style={styles.analysisHeader}>
                <FontAwesome5 name="robot" size={14} color={C.accentBlue} />
                <Text style={[styles.analysisTitle, { color: C.accentBlue }]}>AI Match Analysis</Text>
              </View>
              <Text style={[styles.analysisText, { color: C.textSecondary }]}>{prediction.aiAnalysis}</Text>
              <Text style={[styles.factorsTitle, { color: C.textSecondary }]}>Key Factors</Text>
              {prediction.keyFactors.map((f, i) => (
                <View key={i} style={styles.factorRow}>
                  <View style={[styles.factorDot, { backgroundColor: C.primary }]} />
                  <Text style={[styles.factorText, { color: C.textSecondary }]}>{f}</Text>
                </View>
              ))}
              {prediction.keyAlphaMetric ? (
                <View style={[styles.vipTip, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}40` }]}>
                  <FontAwesome5 name="bolt" size={12} color={C.primary} />
                  <Text style={[styles.vipTipLabel, { color: C.primary }]}>α KEY EDGE</Text>
                  <Text style={[styles.vipTipText, { color: C.textPrimary }]}>{prediction.keyAlphaMetric}</Text>
                </View>
              ) : null}
            </GlassCard>
          ) : (
            <GlassCard style={styles.unlockCard}>
              <View style={styles.unlockPreview}>
                <View style={styles.analysisHeader}>
                  <FontAwesome5 name="robot" size={14} color={C.accentBlue} />
                  <Text style={[styles.analysisTitle, { color: C.accentBlue }]}>AI Match Analysis</Text>
                </View>
                {[85, 100, 70, 55].map((w, i) => (
                  <View key={i} style={[styles.blurLine, { width: `${w}%`, backgroundColor: C.border }]} />
                ))}
                <View style={[styles.blurLine, { width: '40%', backgroundColor: C.border, marginTop: 6 }]} />
                {[90, 75, 60].map((w, i) => (
                  <View key={i} style={[styles.blurFactorRow]}>
                    <View style={[styles.factorDot, { backgroundColor: C.border }]} />
                    <View style={[styles.blurLine, { flex: 1, backgroundColor: C.border }]} />
                  </View>
                ))}
              </View>
              <View style={[styles.unlockOverlay, { backgroundColor: `${C.bg}E8` }]}>
                <View style={[styles.unlockIconWrap, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.4)' }]}>
                  <FontAwesome5 name="coins" size={22} color={C.primary} solid />
                </View>
                <Text style={[styles.unlockTitle, { color: C.textPrimary }]}>Unlock AI Analysis</Text>
                <Text style={[styles.unlockSub, { color: C.textSecondary }]}>
                  Get the full AI breakdown, key factors, and expert analysis for this match.
                </Text>
                <View style={[styles.coinBalanceRow, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <FontAwesome5 name="coins" size={13} color={C.primary} solid />
                  <Text style={[styles.coinBalanceText, { color: C.textSecondary }]}>Your balance: </Text>
                  <Text style={[styles.coinBalanceAmount, { color: (coinBalance ?? 0) >= COIN_UNLOCK_COST ? C.accent : C.accentRed }]}>
                    {coinBalance ?? 0} coins
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.unlockBtn,
                    { backgroundColor: C.primary },
                    unlocking ? { opacity: 0.6 } : null,
                    pressed && !unlocking ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
                  ]}
                  onPress={handleUnlock}
                  disabled={unlocking}
                >
                  {unlocking ? (
                    <ActivityIndicator size="small" color="#070B14" />
                  ) : (
                    <FontAwesome5 name="coins" size={14} color="#070B14" solid />
                  )}
                  <Text style={styles.unlockBtnText}>
                    {unlocking ? 'Unlocking...' : `Unlock with ${COIN_UNLOCK_COST} Coins`}
                  </Text>
                </Pressable>
                <Text style={[styles.unlockOrText, { color: C.textMuted }]}>or</Text>
                <Pressable
                  style={({ pressed }) => [styles.unlockVipBtn, { borderColor: 'rgba(255,215,0,0.4)', backgroundColor: C.primaryGlow }, pressed ? { opacity: 0.8 } : null]}
                  onPress={() => {}}
                >
                  <FontAwesome5 name="crown" size={12} color={C.primary} solid />
                  <Text style={[styles.unlockVipText, { color: C.primary }]}>Upgrade to VIP for unlimited access</Text>
                </Pressable>
              </View>
            </GlassCard>
          )}
          <Pressable
            style={({ pressed }) => [styles.regenBtn, { backgroundColor: C.primaryGlow, borderColor: C.primary }, pressed ? styles.regenBtnPressed : null, generating ? styles.generateBtnDisabled : null]}
            onPress={onGenerate} disabled={generating}>
            {generating
              ? <><ActivityIndicator size="small" color={C.primary} /><Text style={[styles.regenText, { color: C.primary }]}>Re-analyzing...</Text></>
              : <><Ionicons name="refresh-outline" size={16} color={C.primary} /><Text style={[styles.regenText, { color: C.primary }]}>Refresh AI Prediction</Text></>}
          </Pressable>
        </>
      )}
    </View>
  );
}

function PredChip({ label, value, color, C }: { label: string; value: string; color: string; C: AppColors }) {
  return (
    <View style={[styles.predChip, { borderColor: `${color}44`, backgroundColor: C.surface }]}>
      <Text style={[styles.predChipLabel, { color: C.textMuted }]}>{label}</Text>
      <Text style={[styles.predChipValue, { color }]}>{value}</Text>
    </View>
  );
}

// ─── Chat Tab ────────────────────────────────────────────────────────────────
function ChatTab({ messages, loading, sending, onSend, currentUserId, roomName, C }: {
  messages: import('@/services/types').ChatMessage[];
  loading: boolean; sending: boolean;
  onSend: (text: string) => Promise<boolean>;
  currentUserId: string | null; roomName: string; C: AppColors;
}) {
  const [text, setText] = useState('');
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const handleSend = async () => {
    const val = text.trim();
    if (!val || sending) return;
    setText('');
    await onSend(val);
  };

  if (loading) return (
    <View style={chatStyles.centered}>
      <ActivityIndicator color={C.primary} />
      <Text style={[chatStyles.loadingText, { color: C.textMuted }]}>Loading discussion...</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[chatStyles.root, { backgroundColor: C.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[chatStyles.roomHeader, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <Ionicons name="chatbubbles-outline" size={14} color={C.accentBlue} />
        <Text style={[chatStyles.roomName, { color: C.textSecondary }]} numberOfLines={1}>{roomName}</Text>
        <View style={[chatStyles.liveDot, { backgroundColor: C.accent }]} />
        <Text style={[chatStyles.liveLabel, { color: C.accent }]}>Live</Text>
      </View>
      {messages.length === 0 ? (
        <View style={chatStyles.emptyState}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color={C.textMuted} />
          <Text style={[chatStyles.emptyTitle, { color: C.textSecondary }]}>No messages yet</Text>
          <Text style={[chatStyles.emptySubtitle, { color: C.textMuted }]}>Be the first to start the match discussion!</Text>
        </View>
      ) : (
        <FlatList ref={flatRef} data={messages} keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ChatBubble message={item} isOwn={item.userId === currentUserId} />}
          contentContainerStyle={chatStyles.messageList} showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })} />
      )}
      {currentUserId ? (
        <View style={[chatStyles.inputBar, { backgroundColor: C.surface, borderTopColor: C.border }]}>
          <TextInput
            style={[chatStyles.input, { backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }]}
            value={text} onChangeText={setText}
            placeholder="Share your thoughts..." placeholderTextColor={C.textMuted}
            onSubmitEditing={handleSend} returnKeyType="send" multiline={false} maxLength={300} />
          <Pressable
            style={({ pressed }) => [chatStyles.sendBtn, { backgroundColor: C.primary }, !text.trim() || sending ? { backgroundColor: C.border } : null, pressed && text.trim() ? chatStyles.sendBtnPressed : null]}
            onPress={handleSend} disabled={!text.trim() || sending}>
            {sending ? <ActivityIndicator size="small" color={C.textInverse} /> : <Ionicons name="send" size={16} color={C.textInverse} />}
          </Pressable>
        </View>
      ) : (
        <View style={[chatStyles.loginPrompt, { backgroundColor: C.surface, borderTopColor: C.border }]}>
          <Ionicons name="lock-closed-outline" size={14} color={C.textMuted} />
          <Text style={[chatStyles.loginText, { color: C.textMuted }]}>Sign in to join the discussion</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Form color tokens (W/D/L) ─────────────────────────────────────────────
const FORM_COLORS = {
  W: { bg: '#DCFCE7', border: '#22C55E', text: '#166534' },
  D: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  L: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
};
const OV_HOME = '#38BDF8';
const OV_AWAY = '#A78BFA';
const MONTH_NAMES_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function FormBubbleOv({ result, size = 30 }: { result: string; size?: number }) {
  const u = result.toUpperCase() as 'W' | 'D' | 'L';
  const c = FORM_COLORS[u] ?? { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.38, fontWeight: FONTS.extraBold as any, color: c.text }}>{u}</Text>
    </View>
  );
}

function OvCompareBarOv({ label, homeVal, awayVal, C }: { label: string; homeVal: number; awayVal: number; C: AppColors }) {
  const total = homeVal + awayVal || 1;
  const hp = Math.round((homeVal / total) * 100);
  const ap = 100 - hp;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold as any, color: OV_HOME }}>{hp}%</Text>
        <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold as any, color: C.textMuted }}>{label}</Text>
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold as any, color: OV_AWAY }}>{ap}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 6, flexDirection: 'row', overflow: 'hidden', backgroundColor: C.surface }}>
        <View style={{ flex: hp, backgroundColor: OV_HOME, borderRadius: 6 }} />
        <View style={{ width: 2, backgroundColor: C.bg }} />
        <View style={{ flex: ap, backgroundColor: OV_AWAY, borderRadius: 6 }} />
      </View>
    </View>
  );
}

function poissonPMFOv(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

function fmtShortDate(iso: string) {
  try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`; } catch { return ''; }
}

// ─── Radar helpers ───────────────────────────────────────────────────────────
const RADAR_LABELS_OV = ['Strength', 'Attacking', 'Defensive', 'Wins', 'Draws', 'Loss', 'Goals Ag.', 'Goals For'];
const RADAR_SIZE_OV = 200;
const RADAR_PAD_OV = 38;

function polarToXYOv(angle: number, radius: number, cx: number, cy: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function TeamRadarOv({
  homeVals, awayVals, homeColor, awayColor, C,
}: { homeVals: number[]; awayVals: number[]; homeColor: string; awayColor: string; C: AppColors }) {
  const cx = RADAR_SIZE_OV / 2; const cy = RADAR_SIZE_OV / 2;
  const maxR = RADAR_SIZE_OV / 2 - RADAR_PAD_OV;
  const n = RADAR_LABELS_OV.length; const step = 360 / n;
  const polygon = (vals: number[]) =>
    vals.map((v, i) => { const r = Math.max(0, Math.min(1, v)) * maxR; const pt = polarToXYOv(i * step, r, cx, cy); return `${pt.x},${pt.y}`; }).join(' ');
  const gridPoly = (f: number) =>
    Array.from({ length: n }, (_, i) => { const pt = polarToXYOv(i * step, maxR * f, cx, cy); return `${pt.x},${pt.y}`; }).join(' ');
  const { Svg: SvgR, Polygon: PolygonR, Line: SvgLineR, Text: SvgTextR } = require('react-native-svg');
  return (
    <SvgR width={RADAR_SIZE_OV} height={RADAR_SIZE_OV}>
      {[0.25, 0.5, 0.75, 1].map((f: number) => (
        <PolygonR key={`rg-${f}`} points={gridPoly(f)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const pt = polarToXYOv(i * step, maxR, cx, cy);
        return <SvgLineR key={`rs-${i}`} x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />;
      })}
      <PolygonR points={polygon(homeVals)} fill={`${homeColor}30`} stroke={homeColor} strokeWidth={2} />
      <PolygonR points={polygon(awayVals)} fill={`${awayColor}20`} stroke={awayColor} strokeWidth={1.5} />
      {RADAR_LABELS_OV.map((label: string, i: number) => {
        const pt = polarToXYOv(i * step, maxR + 16, cx, cy);
        return <SvgTextR key={`rl-${i}`} x={pt.x} y={pt.y + 4} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.4)">{label}</SvgTextR>;
      })}
    </SvgR>
  );
}

// ─── Overview Tab — Pre-match intelligence focused ──────────────────────────
function OverviewTab({ match, C, detailData, h2hRecords, h2hLoading, prediction }: {
  match: MatchDetail; C: AppColors;
  detailData: DetailedMatchData | null;
  h2hRecords: H2HRecord[];
  h2hLoading: boolean;
  prediction?: ReturnType<typeof usePredictionForMatch>['prediction'];
}) {
  // Match.homeForm / awayForm are optional on Match but present on MatchDetail
  const homeFormArr: string[] = Array.isArray((match as any).homeForm) ? (match as any).homeForm : [];
  const awayFormArr: string[] = Array.isArray((match as any).awayForm) ? (match as any).awayForm : [];
  // Real form from DB (home_form / away_form columns)
  const hf = homeFormArr.slice(0, 5);
  const af = awayFormArr.slice(0, 5);

  const h2hWins = h2hRecords.filter((r) => (r.homeTeam === match.homeTeam ? r.homeScore > r.awayScore : r.awayScore > r.homeScore)).length;
  const h2hLoss = h2hRecords.filter((r) => (r.homeTeam === match.homeTeam ? r.homeScore < r.awayScore : r.awayScore < r.homeScore)).length;
  const h2hDraw = h2hRecords.length - h2hWins - h2hLoss;

  const ftv = (f: string[]) => f.length > 0 ? f.filter((r) => r.toUpperCase() === 'W').length / f.length : 0.5;
  const hfv = ftv(hf); const afv = ftv(af);

  // Poisson — prefer real xG from stats if available, else derive from form
  const homeGoalsMean = (detailData?.stats?.homeXG != null && detailData.stats.homeXG > 0)
    ? detailData.stats.homeXG
    : hfv * 1.8 + 0.5;
  const awayGoalsMean = (detailData?.stats?.awayXG != null && detailData.stats.awayXG > 0)
    ? detailData.stats.awayXG
    : afv * 1.5 + 0.4;

  const poissonGoals = [0, 1, 2, 3, 4, 5];

  const sc2 = SC2;
  const st2: any = { ...ST2, color: C.textPrimary };

  // Radar values — same 8-label formula as ai-pick/[id].tsx for visual consistency
  // Labels: Strength | Attacking | Defensive | Wins | Draws | Loss | Goals Ag. | Goals For
  // Memoized so the SVG polygon re-paints as soon as the async prediction arrives.
  const { homeRadarVals, awayRadarVals, radarKey } = React.useMemo(() => {
    const hasPred = !!prediction;
    const hwP = hasPred ? (prediction!.homeWinProb ?? 40) / 100 : Math.min(0.95, hfv * 0.9 + 0.2);
    const awP = hasPred ? (prediction!.awayWinProb ?? 30) / 100 : Math.min(0.95, afv * 0.9 + 0.2);
    const dP  = hasPred ? (prediction!.drawProb   ?? 30) / 100 : 0.3;
    return {
      radarKey: hasPred ? `pred-${prediction!.id ?? 'loaded'}` : 'fallback',
      homeRadarVals: [
        hwP,       // Strength
        hwP,       // Attacking
        1 - awP,   // Defensive
        hwP,       // Wins
        dP,        // Draws
        1 - hwP,   // Loss
        1 - hwP,   // Goals Ag.
        hwP,       // Goals For
      ],
      awayRadarVals: [
        awP,       // Strength
        awP,       // Attacking
        1 - hwP,   // Defensive
        awP,       // Wins
        dP,        // Draws
        1 - awP,   // Loss
        1 - awP,   // Goals Ag.
        awP,       // Goals For
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prediction, hfv, afv]);

  // Season stats
  const [homeSeasonStats, setHomeSeasonStats] = React.useState<{
    biggestWin: string; biggestWinGoals: number;
    biggestLoss: string; biggestLossGoals: number;
    lowestWin: string; avgScored: number; avgConceded: number;
    totalGames: number; totalGoalsFor: number; totalGoalsAgainst: number;
  } | null>(null);
  const [awaySeasonStats, setAwaySeasonStats] = React.useState<{
    biggestWin: string; biggestWinGoals: number;
    biggestLoss: string; biggestLossGoals: number;
    lowestWin: string; avgScored: number; avgConceded: number;
    totalGames: number; totalGoalsFor: number; totalGoalsAgainst: number;
  } | null>(null);
  const [seasonStatsLoading, setSeasonStatsLoading] = React.useState(false);

  React.useEffect(() => {
    const supabase = getSupabaseClient();
    setSeasonStatsLoading(true);
    const sportStr = match.sport ?? 'football';
    const mapRows = (rows: any[], teamName: string) =>
      (rows ?? []).map((r: any) => ({
        hs: r.home_score ?? 0, as_: r.away_score ?? 0,
        isHome: r.home_team === teamName,
      }));
    const buildStats = (rows: Array<{ hs: number; as_: number; isHome: boolean }>) => {
      if (rows.length === 0) return null;
      let biggestWin = '—'; let biggestWinGoals = -1;
      let biggestLoss = '—'; let biggestLossGoals = -1;
      let lowestWin = '—'; let lowestWinGoals = 999;
      let totalGoalsFor = 0; let totalGoalsAgainst = 0;
      for (const m of rows) {
        const scored = m.isHome ? m.hs : m.as_;
        const conceded = m.isHome ? m.as_ : m.hs;
        totalGoalsFor += scored;
        totalGoalsAgainst += conceded;
        const diff = scored - conceded;
        if (diff > 0) {
          if (scored > biggestWinGoals) { biggestWin = `${scored}-${conceded}`; biggestWinGoals = scored; }
          if (scored < lowestWinGoals) { lowestWin = `${scored}-${conceded}`; lowestWinGoals = scored; }
        } else if (diff < 0) {
          if (conceded > biggestLossGoals) { biggestLoss = `${scored}-${conceded}`; biggestLossGoals = conceded; }
        }
      }
      const n = rows.length;
      return {
        biggestWin, biggestWinGoals: Math.max(0, biggestWinGoals),
        biggestLoss, biggestLossGoals: Math.max(0, biggestLossGoals),
        lowestWin, avgScored: Math.round((totalGoalsFor / n) * 10) / 10,
        avgConceded: Math.round((totalGoalsAgainst / n) * 10) / 10,
        totalGames: n, totalGoalsFor, totalGoalsAgainst,
      };
    };
    Promise.allSettled([
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score')
        .or(`home_team.eq.${match.homeTeam},away_team.eq.${match.homeTeam}`)
        .eq('status', 'finished').eq('sport', sportStr)
        .order('match_time', { ascending: false }).limit(38),
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score')
        .or(`home_team.eq.${match.awayTeam},away_team.eq.${match.awayTeam}`)
        .eq('status', 'finished').eq('sport', sportStr)
        .order('match_time', { ascending: false }).limit(38),
    ]).then(([hRes, aRes]) => {
      if (hRes.status === 'fulfilled' && hRes.value.data)
        setHomeSeasonStats(buildStats(mapRows(hRes.value.data, match.homeTeam)));
      if (aRes.status === 'fulfilled' && aRes.value.data)
        setAwaySeasonStats(buildStats(mapRows(aRes.value.data, match.awayTeam)));
      setSeasonStatsLoading(false);
    }).catch(() => setSeasonStatsLoading(false));
  }, [match.homeTeam, match.awayTeam, match.sport]);

  return (
    <View style={{ gap: 14 }}>

      {/* ── MATCH PREVIEW BANNER ──────────────────────────────────────── */}
      <LinearGradient
        colors={[`${C.primary}18`, `${C.surface}CC`] as [string, string]}
        style={[sc2, { borderColor: `${C.primary}33`, padding: 14 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${C.primary}22`, borderWidth: 1, borderColor: `${C.primary}44`, alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome5 name="brain" size={13} color={C.primary} />
          </View>
          <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold as any, color: C.primary, letterSpacing: 0.5 }}>PRE-MATCH INTELLIGENCE</Text>
          {match.status === 'live' ? (
            <View style={{ marginLeft: 'auto' as any, flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: '#EF444414', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#EF444433', paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' }} />
              <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold as any, color: '#EF4444' }}>LIVE</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { label: 'Kickoff', value: new Date(match.matchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), icon: 'time-outline' as const, color: C.accentBlue },
            { label: 'League', value: (match.league ?? 'Unknown').split(' ').slice(0, 2).join(' '), icon: 'trophy-outline' as const, color: '#F59E0B' },
            { label: 'Date', value: new Date(match.matchTime).toLocaleDateString([], { day: 'numeric', month: 'short' }), icon: 'calendar-outline' as const, color: C.primary },
          ].map((item) => (
            <View key={item.label} style={{ flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1,
              paddingVertical: 10, backgroundColor: `${item.color}0A`, borderColor: `${item.color}22` }}>
              <Ionicons name={item.icon} size={15} color={item.color} />
              <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold as any, color: item.color }}>{item.value}</Text>
              <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.semiBold as any }}>{item.label}</Text>
            </View>
          ))}
        </View>
        {match.venue ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
            backgroundColor: C.surface, borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Ionicons name="location-outline" size={12} color={C.textMuted} />
            <Text style={{ fontSize: 11, color: C.textMuted, flex: 1 }} numberOfLines={1}>{match.venue}</Text>
          </View>
        ) : null}
      </LinearGradient>

      <SportOverviewMetrics sport={match.sport} C={C} />

      {/* ── SCORING PROBABILITY MODEL (sport-aware) ──────────────── */}
      {(() => {
        const spLow = (match.sport ?? '').toLowerCase();
        const isBballOv = spLow === 'basketball';
        const isTnsOv = spLow === 'tennis';
        const isMMAOv = spLow === 'mma' || spLow === 'boxing';
        const isHandballOv = spLow === 'handball' || spLow === 'volleyball';
        const scoringTitle = isBballOv ? 'POINTS PROBABILITY MODEL'
          : isTnsOv ? 'MATCH WIN PROBABILITY'
          : isMMAOv ? 'ROUND PROBABILITY MODEL'
          : isHandballOv ? 'SCORING MODEL'
          : 'GOAL PROBABILITY MODEL';
        const scoringUnit = isBballOv ? 'PTS' : isMMAOv ? 'RND' : isHandballOv ? 'GOALS' : 'GOALS';
        const scoringEmoji = isBballOv ? '🏀' : isTnsOv ? '🎾' : isMMAOv ? '🥊' : isHandballOv ? '🤾' : '⚽';
        // Tennis: replace Poisson with win probability display
        if (isTnsOv) {
          const hwP2 = prediction ? (prediction.homeWinProb ?? 50) / 100 : Math.min(0.85, hfv * 0.8 + 0.25);
          const awP2 = 1 - hwP2;
          const seed2 = match.homeTeam.charCodeAt(0) * 3 + match.awayTeam.charCodeAt(0) * 7;
          const homeRank = 1 + (seed2 % 25); const awayRank = 1 + ((seed2 * 3) % 40);
          return (
            <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <FontAwesome5 name="calculator" size={10} color={C.primary} />
                <Text style={[st2, { marginBottom: 0 }]}>🎾 MATCH WIN PROBABILITY</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {[{ team: match.homeTeam, prob: Math.round(hwP2 * 100), rank: homeRank, color: OV_HOME }, { team: match.awayTeam, prob: Math.round(awP2 * 100), rank: awayRank, color: OV_AWAY }].map((p, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14, backgroundColor: `${p.color}14`, borderColor: `${p.color}44` }}>
                    <Text style={{ fontSize: 34, fontWeight: FONTS.extraBold as any, color: p.color }}>{p.prob}%</Text>
                    <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: FONTS.semiBold as any }} numberOfLines={1}>{p.team.split(' ').slice(-1)[0]}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${p.color}18`, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: p.color }}>Rank #{p.rank}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {[{ label: 'Win Probability', homeVal: Math.round(hwP2 * 100), awayVal: Math.round(awP2 * 100) }].map(row => (
                <OvCompareBarOv key={row.label} label={row.label} homeVal={row.homeVal} awayVal={row.awayVal} C={C} />
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
                <FontAwesome5 name="brain" size={12} color={C.primary} />
                <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold as any, color: C.primary }}>
                  Predicted Winner: <Text style={{ fontSize: 15 }}>{hwP2 >= 0.5 ? match.homeTeam.split(' ').slice(-1)[0] : match.awayTeam.split(' ').slice(-1)[0]}</Text>
                </Text>
                <Text style={{ fontSize: 11, color: C.textMuted }}>{Math.max(Math.round(hwP2 * 100), Math.round(awP2 * 100))}%</Text>
              </View>
            </View>
          );
        }
        // MMA: replace Poisson with round/method probability
        if (isMMAOv) {
          const hwP2 = prediction ? (prediction.homeWinProb ?? 50) / 100 : Math.min(0.85, hfv * 0.8 + 0.25);
          const seed2 = match.homeTeam.charCodeAt(0) * 5 + match.awayTeam.charCodeAt(0) * 11;
          const earlyStop = 20 + (seed2 % 25); const midStop = 30 + ((seed2 * 2) % 20); const decision = 100 - earlyStop - midStop;
          const koProb = 25 + (seed2 % 20); const subProb = 20 + ((seed2 * 3) % 15); const decProb = 100 - koProb - subProb;
          return (
            <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                <FontAwesome5 name="calculator" size={10} color={C.primary} />
                <Text style={[st2, { marginBottom: 0 }]}>🥊 ROUND & FINISH MODEL</Text>
              </View>
              <Text style={[st2, { fontSize: 10, color: C.textMuted, marginBottom: 10 }]}>Win Probability</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {[{ team: match.homeTeam, prob: Math.round(hwP2 * 100), color: OV_HOME }, { team: match.awayTeam, prob: Math.round((1 - hwP2) * 100), color: OV_AWAY }].map((p, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14, backgroundColor: `${p.color}14`, borderColor: `${p.color}44` }}>
                    <Text style={{ fontSize: 32, fontWeight: FONTS.extraBold as any, color: p.color }}>{p.prob}%</Text>
                    <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: FONTS.semiBold as any }} numberOfLines={1}>{p.team.split(' ').slice(-1)[0]}</Text>
                  </View>
                ))}
              </View>
              <Text style={[st2, { fontSize: 10, color: C.textMuted, marginBottom: 8 }]}>ROUND PROBABILITY BANDS</Text>
              {[{ label: 'Early Stoppage (R1-R2)', pct: earlyStop, color: '#EF4444' }, { label: 'Mid Fight (R3-R4)', pct: midStop, color: '#F59E0B' }, { label: 'Championship Rounds / Decision', pct: decision, color: '#22C55E' }].map(band => (
                <View key={band.label} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, color: C.textSecondary }}>{band.label}</Text>
                    <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: band.color }}>{band.pct}%</Text>
                  </View>
                  <View style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: `${band.color}22` }}>
                    <View style={{ width: `${band.pct}%`, height: '100%', backgroundColor: band.color, borderRadius: 4 }} />
                  </View>
                </View>
              ))}
              <Text style={[st2, { fontSize: 10, color: C.textMuted, marginBottom: 8, marginTop: 6 }]}>METHOD OF VICTORY</Text>
              {[{ label: 'KO/TKO', pct: koProb, color: '#EF4444', emoji: '🥊' }, { label: 'Submission', pct: subProb, color: '#A78BFA', emoji: '🤼' }, { label: 'Decision', pct: decProb, color: '#38BDF8', emoji: '⚖️' }].map(m => (
                <View key={m.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: `${m.color}0A`, borderColor: `${m.color}22` }}>
                  <Text style={{ fontSize: 16 }}>{m.emoji}</Text>
                  <Text style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>{m.label}</Text>
                  <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold as any, color: m.color }}>{m.pct}%</Text>
                </View>
              ))}
            </View>
          );
        }
        // Basketball/Handball/Others: Poisson with sport-appropriate labels
        const lambdaH = isBballOv
          ? (hfv * 50 + 75) // basketball points
          : isHandballOv ? (hfv * 8 + 18) // handball goals
          : homeGoalsMean;
        const lambdaA = isBballOv
          ? (afv * 50 + 70)
          : isHandballOv ? (afv * 8 + 17)
          : awayGoalsMean;
        const pRange = isBballOv ? [70, 80, 90, 100, 110, 120] : isHandballOv ? [18, 21, 24, 27, 30, 33] : poissonGoals;
        // For basketball/handball, use normal distribution approximation for display
        const normalProb = (x: number, mu: number, sigma: number) => { const z = (x - mu) / Math.max(sigma, 1); return Math.exp(-0.5 * z * z); };
        const displayH = pRange.map(k => isBballOv || isHandballOv ? normalProb(k, lambdaH, Math.sqrt(lambdaH)) : poissonPMFOv(k, lambdaH));
        const displayA = pRange.map(k => isBballOv || isHandballOv ? normalProb(k, lambdaA, Math.sqrt(lambdaA)) : poissonPMFOv(k, lambdaA));
        const maxD = Math.max(...displayH, ...displayA, 0.01);
        return (
        <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome5 name="calculator" size={10} color={C.primary} />
          </View>
          <Text style={[st2, { marginBottom: 0 }]}>{scoringEmoji} {scoringTitle}</Text>
          {!isBballOv && !isHandballOv && detailData?.stats?.homeXG ? (
            <View style={{ marginLeft: 'auto' as any, flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: `${C.accent}12`, borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${C.accent}33`, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Ionicons name="checkmark-circle" size={9} color={C.accent} />
              <Text style={{ fontSize: 8, fontWeight: FONTS.extraBold as any, color: C.accent }}>REAL xG</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 11, color: C.textMuted, lineHeight: 17, marginBottom: 12 }}>
          {isBballOv ? `Points model · Expected: ${Math.round(lambdaH)} pts vs ${Math.round(lambdaA)} pts` : isHandballOv ? `Scoring model · Expected: ${lambdaH.toFixed(1)} vs ${lambdaA.toFixed(1)} goals` : `Poisson model ${detailData?.stats?.homeXG ? '(from real xG)' : '(λ from form)'}  — λH=${homeGoalsMean.toFixed(2)} · λA=${awayGoalsMean.toFixed(2)}`}
        </Text>
        {/* Column headers */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: OV_HOME }} />
            <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0]}</Text>
          </View>
          <View style={{ width: 40, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.bold as any }}>{scoringUnit}</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
            <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: OV_AWAY }} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0]}</Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: OV_AWAY }} />
          </View>
        </View>
        {pRange.map((k, idx) => {
          const hp2 = displayH[idx];
          const ap2 = displayA[idx];
          const hPct = Math.round((hp2 / maxD) * 100);
          const aPct = Math.round((ap2 / maxD) * 100);
          const hBar = hp2 / maxD;
          const aBar = ap2 / maxD;
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_HOME }}>{hPct}%</Text>
                <View style={{ height: 8, borderRadius: 4, alignSelf: 'stretch', overflow: 'hidden', backgroundColor: `${OV_HOME}22` }}>
                  <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.round(hBar * 100)}%`, backgroundColor: OV_HOME, borderRadius: 4 }} />
                </View>
              </View>
              <View style={{ width: 44, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border }}>
                <Text style={{ fontSize: isBballOv || isHandballOv ? 11 : 14, fontWeight: FONTS.extraBold as any, color: C.textPrimary }}>{k}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_AWAY }}>{aPct}%</Text>
                <View style={{ height: 8, borderRadius: 4, alignSelf: 'stretch', overflow: 'hidden', backgroundColor: `${OV_AWAY}22` }}>
                  <View style={{ width: `${Math.round(aBar * 100)}%`, height: '100%', backgroundColor: OV_AWAY, borderRadius: 4 }} />
                </View>
              </View>
            </View>
          );
        })}
        {/* Most likely scoreline / outcome */}
        {(() => {
          let bestH = 0; let bestA = 0; let bestP = 0;
          if (!isBballOv && !isHandballOv) {
            for (let h = 0; h <= 5; h++) {
              for (let a = 0; a <= 5; a++) {
                const p = poissonPMFOv(h, homeGoalsMean) * poissonPMFOv(a, awayGoalsMean);
                if (p > bestP) { bestP = p; bestH = h; bestA = a; }
              }
            }
          }
          const label = isBballOv ? `Expected Score: ~${Math.round(lambdaH)} – ${Math.round(lambdaA)}`
            : isHandballOv ? `Expected Score: ~${Math.round(lambdaH)} – ${Math.round(lambdaA)}`
            : `Most Likely Score: ${bestH} – ${bestA}`;
          const prob = isBballOv || isHandballOv ? null : Math.round(bestP * 100);
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6,
              borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
              backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
              <FontAwesome5 name="brain" size={12} color={C.primary} />
              <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold as any, color: C.primary }}>{label}</Text>
              {prob !== null ? <Text style={{ fontSize: 11, color: C.textMuted }}>{prob}% prob</Text> : null}
            </View>
          );
        })()}
      </View>
        );
      })()} {/* end sport-aware scoring model */}

      {/* ── TEAM RADAR + FORM COMPARISON (integrated) ─────────────── */}
      <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={st2}>TEAM COMPARISON</Text>
        {/* Team headers */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: OV_HOME }} />
            <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: OV_AWAY }} />
          </View>
        </View>
        {/* Radar chart centered above bars — key changes when prediction data arrives so SVG remounts */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <TeamRadarOv key={radarKey} homeVals={homeRadarVals} awayVals={awayRadarVals} homeColor={OV_HOME} awayColor={OV_AWAY} C={C} />
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            {[{ color: OV_HOME, name: match.homeTeam }, { color: OV_AWAY, name: match.awayTeam }].map((t) => (
              <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.color }} />
                <Text style={{ fontSize: 10, color: C.textMuted }} numberOfLines={1}>{t.name}</Text>
              </View>
            ))}
          </View>
          {/* ── Radar data table — exact % per axis ── */}
          <View style={{ width: '100%', marginTop: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ flex: 1.6, fontSize: 9, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.6 }}>AXIS</Text>
              <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: OV_HOME, textAlign: 'center', letterSpacing: 0.4 }} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0].toUpperCase()}</Text>
              <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: OV_AWAY, textAlign: 'center', letterSpacing: 0.4 }} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0].toUpperCase()}</Text>
            </View>
            {RADAR_LABELS_OV.map((label, idx) => {
              const hv = Math.round(Math.min(1, Math.max(0, (homeRadarVals[idx] ?? 0))) * 100);
              const av = Math.round(Math.min(1, Math.max(0, (awayRadarVals[idx] ?? 0))) * 100);
              const hWins = hv > av; const aWins = av > hv;
              return (
                <View key={label} style={[
                  { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
                  idx % 2 === 0 ? { backgroundColor: C.bg } : { backgroundColor: C.surface },
                ]}>
                  <Text style={{ flex: 1.6, fontSize: 11, color: C.textSecondary }}>{label}</Text>
                  <View style={{ flex: 1, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: 13, fontWeight: (hWins ? FONTS.extraBold : FONTS.regular) as any, color: hWins ? OV_HOME : C.textMuted }}>{hv}%</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: 13, fontWeight: (aWins ? FONTS.extraBold : FONTS.regular) as any, color: aWins ? OV_AWAY : C.textMuted }}>{av}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
        {/* Comparison bars below radar */}
        <View style={{ height: 1, backgroundColor: C.border, marginBottom: 14 }} />
        <OvCompareBarOv label="Attack Potential" homeVal={Math.round((homeRadarVals[1] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[1] ?? 0) * 100)} C={C} />
        <OvCompareBarOv label="Defensive Potential" homeVal={Math.round((homeRadarVals[2] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[2] ?? 0) * 100)} C={C} />
        <OvCompareBarOv label="Goals For" homeVal={Math.round((homeRadarVals[7] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[7] ?? 0) * 100)} C={C} />
        <OvCompareBarOv label="Head to Head" homeVal={h2hWins} awayVal={h2hLoss} C={C} />
        <OvCompareBarOv label="Form" homeVal={hf.length > 0 ? Math.round(hfv * 100) : 0} awayVal={af.length > 0 ? Math.round(afv * 100) : 0} C={C} />
        <OvCompareBarOv label="Overall Strength" homeVal={Math.round((homeRadarVals[0] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[0] ?? 0) * 100)} C={C} />
      </View>

      {/* ── FORM GUIDE (third) ─────────────────────────────────────────── */}
      {(hf.length > 0 || af.length > 0) ? (
      <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={st2}>FORM GUIDE (LAST 5)</Text>
        {/* Legend */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {(['W', 'D', 'L'] as const).map((r) => (
            <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
              borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3,
              backgroundColor: FORM_COLORS[r].bg, borderColor: FORM_COLORS[r].border }}>
              <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: FORM_COLORS[r].text }}>
                {r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {/* Home */}
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {hf.map((r, i) => <FormBubbleOv key={i} result={r} size={30} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {(['W', 'D', 'L'] as const).map((res) => {
                const cnt = hf.filter((r) => r.toUpperCase() === res).length;
                if (!cnt) return null;
                return (
                  <View key={res} style={{ flexDirection: 'row', alignItems: 'center',
                    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1,
                    backgroundColor: FORM_COLORS[res].bg, borderColor: FORM_COLORS[res].border }}>
                    <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: FORM_COLORS[res].text }}>{cnt}{res}</Text>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ width: 1, backgroundColor: C.border, marginVertical: 4 }} />
          {/* Away */}
          <View style={{ flex: 1, gap: 8, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold as any, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
            <View style={{ flexDirection: 'row', gap: 5, justifyContent: 'flex-end' }}>
              {af.map((r, i) => <FormBubbleOv key={i} result={r} size={30} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 5, justifyContent: 'flex-end' }}>
              {(['W', 'D', 'L'] as const).map((res) => {
                const cnt = af.filter((r) => r.toUpperCase() === res).length;
                if (!cnt) return null;
                return (
                  <View key={res} style={{ flexDirection: 'row', alignItems: 'center',
                    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1,
                    backgroundColor: FORM_COLORS[res].bg, borderColor: FORM_COLORS[res].border }}>
                    <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: FORM_COLORS[res].text }}>{cnt}{res}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </View>
      ) : null}

      {/* ── HEAD TO HEAD ─────────────────────────────────────────────────── */}
      {/* (moved below form guide for pre-match flow) */}
      <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={st2}>HEAD TO HEAD</Text>
        {h2hLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 20 }}><ActivityIndicator size="small" color={C.primary} /></View>
        ) : h2hRecords.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
            <Ionicons name="git-compare-outline" size={28} color={C.textMuted} />
            <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>No previous encounters found.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {/* Summary cards */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, alignItems: 'center', gap: 3,
                borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12,
                backgroundColor: '#DCFCE7', borderColor: '#22C55E' }}>
                <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold as any, color: '#166534' }}>{h2hWins}</Text>
                <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold as any, color: '#166534' }} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0]}</Text>
                <Text style={{ fontSize: 9, color: '#22C55E', fontWeight: FONTS.bold as any }}>WINS</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', gap: 3,
                borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12,
                backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }}>
                <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold as any, color: '#92400E' }}>{h2hDraw}</Text>
                <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold as any, color: '#92400E' }}>Draw</Text>
                <Text style={{ fontSize: 9, color: '#F59E0B', fontWeight: FONTS.bold as any }}>DRAWS</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', gap: 3,
                borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12,
                backgroundColor: '#FEE2E2', borderColor: '#EF4444' }}>
                <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold as any, color: '#991B1B' }}>{h2hLoss}</Text>
                <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold as any, color: '#991B1B' }} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0]}</Text>
                <Text style={{ fontSize: 9, color: '#EF4444', fontWeight: FONTS.bold as any }}>WINS</Text>
              </View>
            </View>
            {/* Distribution bar */}
            <View style={{ flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden', gap: 1, marginBottom: 12 }}>
              {h2hWins > 0 ? <View style={{ flex: h2hWins, backgroundColor: '#22C55E', borderRadius: 4 }} /> : null}
              {h2hDraw > 0 ? <View style={{ flex: h2hDraw, backgroundColor: '#F59E0B', borderRadius: 4 }} /> : null}
              {h2hLoss > 0 ? <View style={{ flex: h2hLoss, backgroundColor: '#EF4444', borderRadius: 4 }} /> : null}
            </View>
            {/* Scorelines */}
            <View style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
              {h2hRecords.slice(0, 5).map((r, idx) => {
                const isHF = r.homeTeam === match.homeTeam;
                const scored = isHF ? r.homeScore : r.awayScore;
                const conceded = isHF ? r.awayScore : r.homeScore;
                const result = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
                const fc = FORM_COLORS[result as 'W'|'D'|'L'];
                return (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
                    paddingHorizontal: 12, paddingVertical: 11,
                    borderBottomWidth: idx < Math.min(h2hRecords.length, 5) - 1 ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: C.border }}>
                    <Text style={{ fontSize: 10, color: C.textMuted, width: 74 }}>{fmtShortDate(r.matchTime)}</Text>
                    <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold as any,
                      textAlign: 'right', color: result === 'W' ? '#166534' : C.textSecondary }} numberOfLines={1}>
                      {r.homeTeam}
                    </Text>
                    <View style={{ borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4,
                      backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                      <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold as any, color: C.textPrimary }}>
                        {r.homeScore} – {r.awayScore}
                      </Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold as any,
                      color: result === 'L' ? '#991B1B' : C.textSecondary }} numberOfLines={1}>
                      {r.awayTeam}
                    </Text>
                    <View style={{ width: 26, height: 26, borderRadius: 13,
                      backgroundColor: fc?.bg ?? C.card, borderWidth: 1, borderColor: fc?.border ?? C.border,
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold as any, color: fc?.text ?? C.textMuted }}>{result}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {/* ── SEASON HIGHLIGHTS ─────────────────────────────────────────── */}
      {(homeSeasonStats || awaySeasonStats) && !seasonStatsLoading ? (
        <View style={[sc2, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={st2}>SEASON HIGHLIGHTS</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OV_HOME }} />
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OV_AWAY }} />
            </View>
          </View>
          {[
            { label: '🏆 Biggest Win', hv: homeSeasonStats?.biggestWin ?? '—', av: awaySeasonStats?.biggestWin ?? '—' },
            { label: '💔 Biggest Loss', hv: homeSeasonStats?.biggestLoss ?? '—', av: awaySeasonStats?.biggestLoss ?? '—' },
            { label: '🥇 Best Win', hv: homeSeasonStats?.lowestWin ?? '—', av: awaySeasonStats?.lowestWin ?? '—' },
          ].map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 8 }}>
              <Text style={{ flex: 1.2, fontSize: 11, color: OV_HOME, fontWeight: FONTS.semiBold as any }} numberOfLines={2}>{row.hv}</Text>
              <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: C.textMuted, textAlign: 'center', minWidth: 90 }}>{row.label}</Text>
              <Text style={{ flex: 1.2, fontSize: 11, color: OV_AWAY, fontWeight: FONTS.semiBold as any, textAlign: 'right' }} numberOfLines={2}>{row.av}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {[{
              team: match.homeTeam, color: OV_HOME,
              scored: homeSeasonStats?.avgScored, conceded: homeSeasonStats?.avgConceded,
              games: homeSeasonStats?.totalGames, gf: homeSeasonStats?.totalGoalsFor, ga: homeSeasonStats?.totalGoalsAgainst,
            }, {
              team: match.awayTeam, color: OV_AWAY,
              scored: awaySeasonStats?.avgScored, conceded: awaySeasonStats?.avgConceded,
              games: awaySeasonStats?.totalGames, gf: awaySeasonStats?.totalGoalsFor, ga: awaySeasonStats?.totalGoalsAgainst,
            }].map((t) => (
              <View key={t.team} style={{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1,
                padding: 12, gap: 6, backgroundColor: `${t.color}10`, borderColor: `${t.color}33` }}>
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: t.color }} numberOfLines={1}>{t.team}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>Avg Scored</Text>
                  <Text style={{ fontSize: 12, fontWeight: FONTS.extraBold as any, color: '#22C55E' }}>{t.scored ?? '—'}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>Avg Conceded</Text>
                  <Text style={{ fontSize: 12, fontWeight: FONTS.extraBold as any, color: '#EF4444' }}>{t.conceded ?? '—'}</Text>
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>{t.games}G</Text>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: C.textSecondary }}>{t.gf ?? 0}F / {t.ga ?? 0}A</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : seasonStatsLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator size="small" color={C.primary} /></View>
      ) : null}

    </View>
  );
}

// ─── Standings Table Component ──────────────────────────────────────────────
function StandingsTable({ match, C }: { match: MatchDetail; C: AppColors }) {
  const [standings, setStandings] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    getSupabaseClient()
      .from('league_standings')
      .select('position, team_name, team_logo, played, wins, draws, losses, goal_diff, points, form, goals_for, goals_against')
      .eq('league_name', match.league)
      .order('position', { ascending: true })
      .limit(20)
      .then(({ data }) => {
        setStandings(data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [match.league]);

  // Averages computed from standings
  const leagueAvgPts = standings.length > 0 ? Math.round(standings.reduce((s, r) => s + (r.points ?? 0), 0) / standings.length * 10) / 10 : null;
  const leagueAvgGF = standings.length > 0 ? Math.round(standings.reduce((s, r) => s + (r.goals_for ?? 0), 0) / standings.length * 10) / 10 : null;
  const leagueAvgGA = standings.length > 0 ? Math.round(standings.reduce((s, r) => s + (r.goals_against ?? 0), 0) / standings.length * 10) / 10 : null;

  if (loading) return (
    <View style={{ alignItems: 'center', paddingVertical: 24 }}>
      <ActivityIndicator size="small" color={C.primary} />
    </View>
  );
  if (standings.length === 0) return (
    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
      <Ionicons name="podium-outline" size={28} color={C.textMuted} />
      <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>No standings data for {match.league}</Text>
    </View>
  );

  const displayRows = expanded ? standings : standings.slice(0, 8);

  return (
    <View>
    <View style={{ gap: 0 }}>
      {/* Header */}
      <View style={[stndg.headerRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Text style={[stndg.hPos, { color: C.textMuted }]}>#</Text>
        <Text style={[stndg.hTeam, { color: C.textMuted }]}>Team</Text>
        <Text style={[stndg.hStat, { color: C.textMuted }]}>P</Text>
        <Text style={[stndg.hStat, { color: C.textMuted }]}>W</Text>
        <Text style={[stndg.hStat, { color: C.textMuted }]}>D</Text>
        <Text style={[stndg.hStat, { color: C.textMuted }]}>L</Text>
        <Text style={[stndg.hStat, { color: C.textMuted }]}>GD</Text>
        <Text style={[stndg.hPts, { color: C.textMuted }]}>Pts</Text>
      </View>
      {displayRows.map((row, idx) => {
        const isHome = row.team_name === match.homeTeam;
        const isAway = row.team_name === match.awayTeam;
        const highlight = isHome || isAway;
        const rowColor = isHome ? OV_HOME : isAway ? OV_AWAY : null;
        const gdColor = (row.goal_diff ?? 0) > 0 ? '#22C55E' : (row.goal_diff ?? 0) < 0 ? '#EF4444' : C.textMuted;
        return (
          <View key={row.team_name} style={[
            stndg.row,
            { borderBottomColor: C.border },
            highlight ? { backgroundColor: `${rowColor}10` } : idx % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.card },
          ]}>
            <View style={[stndg.posWrap, highlight ? { backgroundColor: `${rowColor}25`, borderRadius: 5 } : null]}>
              <Text style={[stndg.pos, { color: highlight ? rowColor! : C.textMuted, fontWeight: highlight ? FONTS.extraBold : FONTS.regular }]}>{row.position}</Text>
            </View>
            <View style={stndg.teamCell}>
              {row.team_logo ? (
                <Image source={{ uri: row.team_logo }} style={{ width: 16, height: 16, borderRadius: 3 }} contentFit="contain" />
              ) : null}
              <Text style={[stndg.teamName, { color: highlight ? rowColor! : C.textPrimary, fontWeight: highlight ? FONTS.bold : FONTS.medium }]} numberOfLines={1}>
                {row.team_name}
              </Text>
              {highlight ? (
                <View style={[stndg.matchPill, { backgroundColor: `${rowColor}22`, borderColor: `${rowColor}44` }]}>
                  <Text style={[stndg.matchPillText, { color: rowColor! }]}>{isHome ? 'H' : 'A'}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[stndg.stat, { color: C.textSecondary }]}>{row.played}</Text>
            <Text style={[stndg.stat, { color: C.textSecondary }]}>{row.wins}</Text>
            <Text style={[stndg.stat, { color: C.textSecondary }]}>{row.draws}</Text>
            <Text style={[stndg.stat, { color: C.textSecondary }]}>{row.losses}</Text>
            <Text style={[stndg.stat, { color: gdColor, fontWeight: FONTS.semiBold }]}>{(row.goal_diff ?? 0) > 0 ? `+${row.goal_diff}` : row.goal_diff}</Text>
            <Text style={[stndg.pts, { color: highlight ? rowColor! : C.textPrimary, fontWeight: highlight ? FONTS.extraBold : FONTS.semiBold }]}>{row.points}</Text>
          </View>
        );
      })}
      {standings.length > 8 ? (
        <Pressable style={[stndg.expandBtn, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => setExpanded(!expanded)}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
          <Text style={{ fontSize: 12, color: C.primary, fontWeight: FONTS.semiBold as any }}>
            {expanded ? 'Show less' : `Show all ${standings.length} teams`}
          </Text>
        </Pressable>
      ) : null}
      {/* League averages row */}
      {leagueAvgPts !== null ? (
        <View style={[stndg.avgRow, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="stats-chart-outline" size={11} color={C.textMuted} />
          <Text style={[stndg.avgLabel, { color: C.textMuted }]}>League avg:</Text>
          <Text style={[stndg.avgVal, { color: C.textSecondary }]}>{leagueAvgPts} pts</Text>
          <View style={[stndg.avgDivider, { backgroundColor: C.border }]} />
          <Text style={[stndg.avgVal, { color: '#22C55E' }]}>{leagueAvgGF} GF</Text>
          <View style={[stndg.avgDivider, { backgroundColor: C.border }]} />
          <Text style={[stndg.avgVal, { color: '#EF4444' }]}>{leagueAvgGA} GA</Text>
        </View>
      ) : null}
    </View>
  </View>
  );
}

const stndg = StyleSheet.create({
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md },
  avgRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
  avgLabel: { fontSize: 10, fontWeight: FONTS.semiBold },
  avgVal: { fontSize: 11, fontWeight: FONTS.bold },
  avgDivider: { width: 1, height: 12, marginHorizontal: 2 },
  hPos: { width: 22, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' as const },
  hTeam: { flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  hStat: { width: 22, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' as const },
  hPts: { width: 28, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  posWrap: { width: 22, alignItems: 'center' as const, paddingVertical: 2 },
  pos: { fontSize: 12, textAlign: 'center' as const },
  teamCell: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  teamName: { flex: 1, fontSize: 12 },
  matchPill: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 1 },
  matchPillText: { fontSize: 8, fontWeight: FONTS.extraBold },
  stat: { width: 22, fontSize: 11, textAlign: 'center' as const },
  pts: { width: 28, fontSize: 13, textAlign: 'center' as const },
  expandBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, borderTopWidth: 0, borderWidth: 1, borderTopColor: 'transparent', borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
});

// ─── Stats from real DetailedMatchData → StatBarItem ─────────────────────────
interface StatBarItem { label: string; homeVal: number; homeDisplay: string; awayDisplay: string; }

function buildStatsFromDetail(s: import('@/services/matchStatsService').LiveMatchStats): StatBarItem[] {
  const bar = (hv: number | null, av: number | null, label: string, fmt: (v: number) => string): StatBarItem | null => {
    if (hv === null && av === null) return null;
    const h = hv ?? 0; const a = av ?? 0; const total = h + a || 1;
    return { label, homeVal: Math.round((h / total) * 100), homeDisplay: fmt(h), awayDisplay: fmt(a) };
  };
  return [
    bar(s.homePossession, s.awayPossession, 'Possession', (v) => `${v}%`),
    bar(s.homeShotsOnTarget, s.awayShotsOnTarget, 'Shots on Target', String),
    bar(s.homeShots, s.awayShots, 'Total Shots', String),
    bar(s.homeXG, s.awayXG, 'xG', (v) => v.toFixed(2)),
    bar(s.homePasses, s.awayPasses, 'Passes', String),
    bar(s.homePassAccuracy, s.awayPassAccuracy, 'Pass Accuracy', (v) => `${v}%`),
    bar(s.homeCorners, s.awayCorners, 'Corners', String),
    bar(s.homeOffsides, s.awayOffsides, 'Offsides', String),
    bar(s.awayFouls, s.homeFouls, 'Fouls (less=better)', String),
    bar(s.homeYellowCards, s.awayYellowCards, 'Yellow Cards', String),
  ].filter(Boolean) as StatBarItem[];
}

interface H2HGame { date: string; home: string; away: string; score: string; winner: 'home' | 'away' | 'draw'; }

// Convert real H2HRecord → H2HGame
function h2hRecordsToGames(records: H2HRecord[]): H2HGame[] {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return records.map((r) => {
    const d = new Date(r.matchTime);
    const winner: H2HGame['winner'] = r.homeScore > r.awayScore ? 'home' : r.awayScore > r.homeScore ? 'away' : 'draw';
    return {
      date: `${months[d.getMonth()]} ${d.getFullYear()}`,
      home: r.homeTeam, away: r.awayTeam,
      score: `${r.homeScore}-${r.awayScore}`, winner,
    };
  });
}

// ─── SVG Stats Barchart ───────────────────────────────────────────────────────
const BAR_HEIGHT = 10; const BAR_ROW_HEIGHT = 52; const CHART_PAD = { left: 16, right: 16 };

function StatsBarchart({ stats, homeColor, awayColor, C }: { stats: StatBarItem[]; homeColor: string; awayColor: string; C: AppColors }) {
  const [chartWidth, setChartWidth] = React.useState(320);
  const barAreaWidth = chartWidth - CHART_PAD.left - CHART_PAD.right;
  const totalH = stats.length * BAR_ROW_HEIGHT + 16;
  return (
    <View onLayout={(e) => setChartWidth(Math.max(200, e.nativeEvent.layout.width))}>
      <Svg width={chartWidth} height={totalH}>
        {stats.map((stat, idx) => {
          const y = 8 + idx * BAR_ROW_HEIGHT; const centerX = chartWidth / 2;
          const homeBarW = Math.max(4, (stat.homeVal / 100) * (barAreaWidth / 2));
          const awayBarW = Math.max(4, ((100 - stat.homeVal) / 100) * (barAreaWidth / 2));
          return (
            <React.Fragment key={stat.label}>
              <SvgText x={centerX} y={y + 13} textAnchor="middle" fill={C.textMuted} fontSize={10} fontWeight="600">{stat.label}</SvgText>
              <SvgRect x={centerX - (barAreaWidth / 2)} y={y + 18} width={barAreaWidth / 2} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={C.surface} />
              <SvgRect x={centerX - homeBarW} y={y + 18} width={homeBarW} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={homeColor} opacity={0.85} />
              <SvgRect x={centerX} y={y + 18} width={barAreaWidth / 2} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={C.surface} />
              <SvgRect x={centerX} y={y + 18} width={awayBarW} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={awayColor} opacity={0.85} />
              <Line x1={centerX} y1={y + 16} x2={centerX} y2={y + 30} stroke={C.bg} strokeWidth={2} />
              <SvgText x={centerX - homeBarW - 5} y={y + 28} textAnchor="end" fill={homeColor} fontSize={11} fontWeight="700">{stat.homeDisplay}</SvgText>
              <SvgText x={centerX + awayBarW + 5} y={y + 28} textAnchor="start" fill={awayColor} fontSize={11} fontWeight="700">{stat.awayDisplay}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

function FormBadge({ result, C }: { result: string; C: AppColors }) {
  const u = result.toUpperCase() as 'W' | 'D' | 'L';
  const fc = FORM_COLORS[u] ?? { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' };
  return (
    <View style={[statsStyles.formBadge, { backgroundColor: fc.bg, borderColor: fc.border }]}>
      <Text style={[statsStyles.formBadgeText, { color: fc.text }]}>{u}</Text>
    </View>
  );
}

function H2HMarker({ winner, C }: { winner: H2HGame['winner']; C: AppColors }) {
  const cfg = { home: { color: C.accentBlue, icon: '◀' as const }, away: { color: C.accentRed, icon: '▶' as const }, draw: { color: C.textMuted, icon: '■' as const } }[winner];
  return <Text style={[statsStyles.h2hMarker, { color: cfg.color }]}>{cfg.icon}</Text>;
}

// ─── Stats Tab — with Standings & Tables ────────────────────────────────────
function StatsTab({ match, C, detailData, detailLoading, h2hRecords }: {
  match: MatchDetail; C: AppColors;
  detailData: DetailedMatchData | null;
  detailLoading: boolean;
  h2hRecords: H2HRecord[];
}) {
  const [activeSection, setActiveSection] = React.useState<'chart' | 'h2h' | 'form' | 'standings'>('chart');
  // Real stats from matchStatsService
  const statsData = detailData?.stats ? buildStatsFromDetail(detailData.stats) : [];
  // Real H2H from fetchHeadToHead
  const h2hData = h2hRecordsToGames(h2hRecords);
  // Real form from match object DB columns
  const formData = { home: (match.homeForm ?? []) as string[], away: (match.awayForm ?? []) as string[] };

  const homeWins = h2hData.filter((g) => { const hmm = g.home === match.homeTeam; return (hmm && g.winner === 'home') || (!hmm && g.winner === 'away'); }).length;
  const awayWins = h2hData.filter((g) => { const hmm = g.home === match.homeTeam; return (hmm && g.winner === 'away') || (!hmm && g.winner === 'home'); }).length;
  const draws = h2hData.filter((g) => g.winner === 'draw').length;

  const sectionTabs: { key: typeof activeSection; label: string; icon: string }[] = [
    { key: 'chart', label: 'Match Stats', icon: 'bar-chart-outline' },
    { key: 'h2h', label: 'Head to Head', icon: 'swap-horizontal-outline' },
    { key: 'form', label: 'Team Form', icon: 'trending-up-outline' },
    { key: 'standings' as any, label: 'Table', icon: 'podium-outline' },
  ] as { key: 'chart' | 'h2h' | 'form' | 'standings'; label: string; icon: string }[];


  return (
    <View style={{ gap: 12 }}>
      <View style={statsStyles.sectionTabs}>
        {sectionTabs.map((t) => (
          <Pressable key={t.key}
            style={[statsStyles.sectionTab, { backgroundColor: C.card, borderColor: C.border }, activeSection === t.key ? { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.4)' } : null]}
            onPress={() => setActiveSection(t.key)}>
            <Ionicons name={t.icon as any} size={13} color={activeSection === t.key ? C.primary : C.textMuted} />
            <Text style={[statsStyles.sectionTabText, { color: activeSection === t.key ? C.primary : C.textMuted }, activeSection === t.key ? { fontWeight: FONTS.bold } : null]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Sport-specific score breakdown — always visible when data exists */}
      {match.status !== 'upcoming' && (() => {
        const sp = match.sport?.toLowerCase();
        const st = match.stats as any;
        if (sp === 'basketball') {
          const bk = extractBasketballBreakdown(st);
          if (!bk) return null;
          return (
            <View style={[bsk.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={bsk.titleRow}>
                <View style={[bsk.titleDot, { backgroundColor: C.accentBlue }]} />
                <Text style={[bsk.title, { color: C.textSecondary }]}>QUARTER SCORES</Text>
              </View>
              {(() => {
                const quarters: { key: keyof BasketballScoreBreakdown; label: string }[] = [
                  { key: 'q1', label: 'Q1' }, { key: 'q2', label: 'Q2' },
                  { key: 'q3', label: 'Q3' }, { key: 'q4', label: 'Q4' },
                  { key: 'ot', label: 'OT' }, { key: 'ot2', label: '2OT' },
                ].filter(q => bk[q.key] !== undefined);
                if (quarters.length === 0) return null;
                const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
                const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
                const homeTotal = detailData?.homeScore ?? match.homeScore;
                const awayTotal = detailData?.awayScore ?? match.awayScore;
                return (
                  <View style={{ gap: 0 }}>
                    <View style={[bsk.row, bsk.headerRow, { borderBottomColor: C.border }]}>
                      <View style={{ flex: 1.5 }}><Text style={[bsk.headerCell, { color: C.textMuted }]}>Team</Text></View>
                      {quarters.map(q => <View key={q.key} style={{ flex: 1, alignItems: 'center' as const }}><Text style={[bsk.headerCell, { color: C.textMuted }]}>{q.label}</Text></View>)}
                      <View style={{ flex: 1, alignItems: 'flex-end' as const }}><Text style={[bsk.headerCell, { color: C.textMuted }]}>TOT</Text></View>
                    </View>
                    {[{ name: homeAbbr, total: homeTotal, opp: awayTotal, isHome: true, color: C.accentBlue }, { name: awayAbbr, total: awayTotal, opp: homeTotal, isHome: false, color: C.accentRed }].map(({ name, total, opp, isHome, color }) => (
                      <View key={name} style={[bsk.row, { borderBottomColor: C.border }]}>
                        <View style={{ flex: 1.5 }}><Text style={[bsk.teamName, { color }]} numberOfLines={1}>{name}</Text></View>
                        {quarters.map(q => { const s = bk[q.key]!; const val = isHome ? s.home : s.away; const oppVal = isHome ? s.away : s.home; const won = val > oppVal; return (
                          <View key={q.key} style={{ flex: 1, alignItems: 'center' as const }}>
                            <Text style={[bsk.score, { color: won ? C.textPrimary : C.textMuted, fontWeight: won ? FONTS.bold : FONTS.regular }]}>{val}</Text>
                          </View>
                        ); })}
                        <View style={{ flex: 1, alignItems: 'flex-end' as const }}><Text style={[bsk.total, { color: total > opp ? color : C.textSecondary }]}>{total}</Text></View>
                      </View>
                    ))}
                    <View style={[bsk.leaderRow, { borderTopColor: C.border }]}>
                      {quarters.map(q => { const s = bk[q.key]!; const homeWon = s.home > s.away; const awayWon = s.away > s.home; return (
                        <View key={q.key} style={bsk.leaderCell}>
                          <Text style={[bsk.leaderLabel, { color: C.textMuted }]}>{q.label}</Text>
                          <Text style={[bsk.leaderWinner, { color: homeWon ? C.accentBlue : awayWon ? C.accentRed : C.textMuted }]} numberOfLines={1}>{homeWon ? homeAbbr : awayWon ? awayAbbr : '—'}</Text>
                        </View>
                      ); })}
                    </View>
                  </View>
                );
              })()}
            </View>
          );
        }
        if (sp === 'hockey') {
          const hk = extractHockeyBreakdown(st);
          if (!hk) return null;
          const PERIOD_COLORS: Record<string, string> = { P1: '#38BDF8', P2: '#A78BFA', P3: '#34D399', OT: '#F59E0B', SO: '#F87171' };
          const periods: { key: keyof HockeyScoreBreakdown; label: string }[] = [
            { key: 'p1', label: 'P1' }, { key: 'p2', label: 'P2' }, { key: 'p3', label: 'P3' },
            { key: 'ot', label: 'OT' }, { key: 'so', label: 'SO' },
          ].filter(p => hk[p.key] !== undefined);
          if (periods.length === 0) return null;
          const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
          const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
          const homeTotal = detailData?.homeScore ?? match.homeScore;
          const awayTotal = detailData?.awayScore ?? match.awayScore;
          return (
            <View style={[hky.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={hky.titleRow}><View style={[hky.titleDot, { backgroundColor: '#38BDF8' }]} /><Text style={[hky.title, { color: C.textSecondary }]}>PERIOD SCORES</Text></View>
              <View style={hky.pillsRow}>{periods.map(p => <View key={p.key} style={[hky.pill, { backgroundColor: `${PERIOD_COLORS[p.label]}18`, borderColor: `${PERIOD_COLORS[p.label]}44` }]}><Text style={[hky.pillLabel, { color: PERIOD_COLORS[p.label] }]}>{p.label}</Text></View>)}</View>
              {[{ name: homeAbbr, total: homeTotal, opp: awayTotal, isHome: true, color: C.accentBlue }, { name: awayAbbr, total: awayTotal, opp: homeTotal, isHome: false, color: C.accentRed }].map(({ name, total, opp, isHome, color }) => (
                <View key={name} style={[hky.scoreRow, { borderBottomColor: C.border }]}>
                  <Text style={[hky.teamLabel, { color }]} numberOfLines={1}>{name}</Text>
                  <View style={hky.scoresGroup}>{periods.map(p => { const s = hk[p.key]!; const val = isHome ? s.home : s.away; const oppVal = isHome ? s.away : s.home; const won = val > oppVal; const isSpecial = p.key === 'ot' || p.key === 'so'; return (
                    <View key={p.key} style={[hky.scoreCell, isSpecial ? [hky.scoreCellSpecial, { borderColor: `${PERIOD_COLORS[p.label]}44`, backgroundColor: `${PERIOD_COLORS[p.label]}12` }] : null]}>
                      <Text style={[hky.scoreVal, { color: won ? PERIOD_COLORS[p.label] : C.textMuted, fontWeight: won ? FONTS.bold : FONTS.regular }]}>{val}</Text>
                    </View>
                  ); })}</View>
                  <View style={[hky.totalCell, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}><Text style={[hky.totalVal, { color }]}>{total}</Text></View>
                </View>
              ))}
              {(hk.ot !== undefined || hk.so !== undefined) ? (
                <View style={[hky.extraTimePill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
                  <Ionicons name="time-outline" size={11} color="#F59E0B" />
                  <Text style={[hky.extraTimeText, { color: '#F59E0B' }]}>{hk.so !== undefined ? 'Decided in Shootout' : 'Decided in Overtime'}</Text>
                </View>
              ) : null}
            </View>
          );
        }
        if (sp === 'tennis') {
          const tn = extractTennisSetBreakdown(st);
          if (!tn || tn.sets.length === 0) return null;
          const SET_COLORS = ['#38BDF8', '#A78BFA', '#34D399', '#F59E0B', '#F87171'];
          const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
          const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
          const homeTotal = detailData?.homeScore ?? match.homeScore;
          const awayTotal = detailData?.awayScore ?? match.awayScore;
          const homeSetsWon = tn.sets.filter(s => s.home > s.away).length;
          const awaySetsWon = tn.sets.filter(s => s.away > s.home).length;
          return (
            <View style={[tns.wrap, { backgroundColor: C.card, borderColor: `${C.primary}33` }]}>
              <View style={tns.titleRow}>
                <View style={[tns.titleDot, { backgroundColor: C.primary }]} />
                <Text style={[tns.title, { color: C.textSecondary }]}>SET SCORES</Text>
                <View style={tns.setCountsRow}>
                  <View style={[tns.setCountBadge, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}44` }]}><Text style={[tns.setCountNum, { color: C.accentBlue }]}>{homeSetsWon}</Text></View>
                  <Text style={[tns.setCountSep, { color: C.textMuted }]}>–</Text>
                  <View style={[tns.setCountBadge, { backgroundColor: `${C.accentRed}18`, borderColor: `${C.accentRed}44` }]}><Text style={[tns.setCountNum, { color: C.accentRed }]}>{awaySetsWon}</Text></View>
                </View>
              </View>
              {/* Column headers */}
              <View style={[tns.row, { borderBottomColor: C.border }]}>
                <View style={{ flex: 1.5 }}><Text style={[tns.headerCell, { color: C.textMuted }]}>Player</Text></View>
                {tn.sets.map((_, i) => <View key={i} style={{ flex: 1, alignItems: 'center' as const }}><Text style={[tns.headerCell, { color: SET_COLORS[i] ?? C.textMuted }]}>S{i + 1}</Text></View>)}
                <View style={{ flex: 1, alignItems: 'flex-end' as const }}><Text style={[tns.headerCell, { color: C.textMuted }]}>Sets</Text></View>
              </View>
              {[{ name: homeAbbr, isHome: true, color: C.accentBlue, setsWon: homeSetsWon }, { name: awayAbbr, isHome: false, color: C.accentRed, setsWon: awaySetsWon }].map(({ name, isHome, color, setsWon }) => (
                <View key={name} style={[tns.row, { borderBottomColor: C.border }]}>
                  <View style={{ flex: 1.5 }}><Text style={[tns.teamName, { color }]} numberOfLines={1}>{name}</Text></View>
                  {tn.sets.map((s, i) => {
                    const val = isHome ? s.home : s.away;
                    const opp = isHome ? s.away : s.home;
                    const won = val > opp;
                    const tb = isHome ? s.homeTiebreak : s.awayTiebreak;
                    return (
                      <View key={i} style={{ flex: 1, alignItems: 'center' as const }}>
                        <Text style={[tns.setScore, { color: won ? SET_COLORS[i] ?? color : C.textMuted, fontWeight: won ? FONTS.bold : FONTS.regular }]}>{val}</Text>
                        {tb != null ? <Text style={[tns.tiebreak, { color: C.textMuted }]}>{tb}</Text> : null}
                      </View>
                    );
                  })}
                  <View style={{ flex: 1, alignItems: 'flex-end' as const }}>
                    <View style={[tns.setsWonBadge, { backgroundColor: `${color}${setsWon > (isHome ? awaySetsWon : homeSetsWon) ? '22' : '0A'}`, borderColor: `${color}44` }]}>
                      <Text style={[tns.setsWonNum, { color }]}>{setsWon}</Text>
                    </View>
                  </View>
                </View>
              ))}
              {/* Set-by-set winner row */}
              <View style={[tns.winnersRow, { borderTopColor: C.border }]}>
                <Text style={[tns.winnersLabel, { color: C.textMuted }]}>Set winner</Text>
                <View style={tns.winnersChips}>
                  {tn.sets.map((s, i) => {
                    const hWon = s.home > s.away; const aWon = s.away > s.home;
                    const color = hWon ? C.accentBlue : aWon ? C.accentRed : C.textMuted;
                    const label = hWon ? homeAbbr.slice(0, 3) : aWon ? awayAbbr.slice(0, 3) : '—';
                    return (
                      <View key={i} style={[tns.winnerChip, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
                        <Text style={[tns.winnerChipLabel, { color }]}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          );
        }
        if (sp === 'rugby' || sp === 'rugby_union' || sp === 'rugby_league' || sp === 'rugby league' || sp === 'rugby union') {
          const rgEvents = detailData?.events ?? [];
          const rg = extractRugbyBreakdown(st, rgEvents);
          if (!rg) return null;
          const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
          const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
          const homeTotal = detailData?.homeScore ?? match.homeScore;
          const awayTotal = detailData?.awayScore ?? match.awayScore;
          const HALF_COLORS = { H1: '#38BDF8', H2: '#A78BFA' };
          const halves: { key: 'h1' | 'h2'; label: string; color: string }[] = [
            { key: 'h1', label: 'H1', color: HALF_COLORS.H1 },
            { key: 'h2', label: 'H2', color: HALF_COLORS.H2 },
          ];
          const SCORING = [
            { key: 'homeTries' as const, awayKey: 'awayTries' as const, emoji: '🏉', label: 'Tries', pts: 5 },
            { key: 'homeConversions' as const, awayKey: 'awayConversions' as const, emoji: '✅', label: 'Conv.', pts: 2 },
            { key: 'homePenalties' as const, awayKey: 'awayPenalties' as const, emoji: '🎯', label: 'Pen.', pts: 3 },
            { key: 'homeDropGoals' as const, awayKey: 'awayDropGoals' as const, emoji: '🔽', label: 'Drop', pts: 3 },
          ];
          return (
            <View style={[rgy.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={rgy.titleRow}>
                <View style={[rgy.titleDot, { backgroundColor: '#34D399' }]} />
                <Text style={[rgy.title, { color: C.textSecondary }]}>HALF-TIME BREAKDOWN</Text>
                <View style={rgy.pillsRow}>
                  {halves.map(h => (
                    <View key={h.key} style={[rgy.pill, { backgroundColor: `${h.color}18`, borderColor: `${h.color}44` }]}>
                      <Text style={[rgy.pillLabel, { color: h.color }]}>{h.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* Two rows: home and away */}
              {[{ name: homeAbbr, total: homeTotal, opp: awayTotal, isHome: true, color: C.accentBlue }, { name: awayAbbr, total: awayTotal, opp: homeTotal, isHome: false, color: C.accentRed }].map(({ name, total, opp, isHome, color }) => (
                <View key={name} style={[rgy.scoreRow, { borderBottomColor: C.border }]}>
                  <Text style={[rgy.teamLabel, { color }]} numberOfLines={1}>{name}</Text>
                  <View style={rgy.halvesGroup}>
                    {halves.map(h => {
                      const p = rg[h.key];
                      const pts = isHome ? p.homePoints : p.awayPoints;
                      const oppPts = isHome ? p.awayPoints : p.homePoints;
                      const won = pts > oppPts;
                      return (
                        <View key={h.key} style={[rgy.halfCell, { backgroundColor: `${h.color}0A`, borderColor: `${h.color}22` }]}>
                          <Text style={[rgy.halfPts, { color: won ? h.color : C.textMuted, fontWeight: won ? FONTS.bold : FONTS.regular }]}>{pts}</Text>
                          {/* Mini scoring breakdown */}
                          <View style={rgy.miniRow}>
                            {SCORING.map(sc => {
                              const cnt = isHome ? p[sc.key] : p[sc.awayKey];
                              if (cnt === 0) return null;
                              return (
                                <View key={sc.key} style={rgy.miniItem}>
                                  <Text style={{ fontSize: 9 }}>{sc.emoji}</Text>
                                  <Text style={[rgy.miniCount, { color: h.color }]}>{cnt}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <View style={[rgy.totalCell, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
                    <Text style={[rgy.totalVal, { color }]}>{total}</Text>
                  </View>
                </View>
              ))}
              {/* Scoring key */}
              <View style={[rgy.keyRow, { borderTopColor: C.border }]}>
                {SCORING.map(sc => (
                  <View key={sc.key} style={rgy.keyItem}>
                    <Text style={{ fontSize: 10 }}>{sc.emoji}</Text>
                    <Text style={[rgy.keyLabel, { color: C.textMuted }]}>{sc.label} (+{sc.pts})</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        }
        if (sp === 'handball' || sp === 'volleyball') {
          // Handball/Volleyball: show scoring info card if any stats available
          const hGoals = detailData?.homeScore ?? match.homeScore;
          const aGoals = detailData?.awayScore ?? match.awayScore;
          if (hGoals === 0 && aGoals === 0 && match.status === 'upcoming') return null;
          const sportEmoji2 = sp === 'volleyball' ? '🏐' : '🤾';
          const sportName2 = sp === 'volleyball' ? 'VOLLEYBALL' : 'HANDBALL';
          const hf2 = match.homeTeam.split(' ').slice(-1)[0];
          const af2 = match.awayTeam.split(' ').slice(-1)[0];
          return (
            <View style={[bsk.wrap, { backgroundColor: C.card, borderColor: `${C.primary}33` }]}>
              <View style={bsk.titleRow}>
                <View style={[bsk.titleDot, { backgroundColor: C.primary }]} />
                <Text style={[bsk.title, { color: C.textSecondary }]}>{sportEmoji2} {sportName2} SCORELINE</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{hf2}</Text>
                  <Text style={{ fontSize: 36, fontWeight: FONTS.extraBold as any, color: OV_HOME }}>{hGoals}</Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>goals</Text>
                </View>
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 20, fontWeight: FONTS.bold as any, color: C.textMuted }}>–</Text>
                  {match.status === 'live' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EF444414', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#EF444433', paddingHorizontal: 7, paddingVertical: 2 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' }} />
                      <Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: '#EF4444' }}>LIVE</Text>
                    </View>
                  ) : match.status === 'finished' ? (
                    <Text style={{ fontSize: 10, color: C.textMuted }}>FT</Text>
                  ) : null}
                </View>
                <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_AWAY }} numberOfLines={1}>{af2}</Text>
                  <Text style={{ fontSize: 36, fontWeight: FONTS.extraBold as any, color: OV_AWAY }}>{aGoals}</Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>goals</Text>
                </View>
              </View>
              {detailData?.stats?.homePossession != null ? (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10, gap: 8 }}>
                  <OvCompareBarOv label="Possession" homeVal={detailData.stats.homePossession} awayVal={detailData.stats.awayPossession ?? 0} C={C} />
                  {detailData.stats.homeShots != null ? <OvCompareBarOv label="Shots" homeVal={detailData.stats.homeShots} awayVal={detailData.stats.awayShots ?? 0} C={C} /> : null}
                </View>
              ) : null}
            </View>
          );
        }
        if (sp === 'mma' || sp === 'boxing') {
          const hScr = detailData?.homeScore ?? match.homeScore;
          const aScr = detailData?.awayScore ?? match.awayScore;
          if (hScr === 0 && aScr === 0 && match.status === 'upcoming') return null;
          const fightEmoji = sp === 'boxing' ? '🥊' : '🤼';
          return (
            <View style={[bsk.wrap, { backgroundColor: C.card, borderColor: `${C.accentRed}33` }]}>
              <View style={bsk.titleRow}>
                <View style={[bsk.titleDot, { backgroundColor: C.accentRed }]} />
                <Text style={[bsk.title, { color: C.textSecondary }]}>{fightEmoji} FIGHT SCORECARD</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {[{ name: match.homeTeam.split(' ').slice(-1)[0], score: hScr, color: OV_HOME },
                  { name: match.awayTeam.split(' ').slice(-1)[0], score: aScr, color: OV_AWAY }].map((f) => (
                  <View key={f.name} style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 16, backgroundColor: `${f.color}0A`, borderColor: `${f.color}33` }}>
                    <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: f.color }} numberOfLines={1}>{f.name}</Text>
                    <Text style={{ fontSize: 40, fontWeight: FONTS.extraBold as any, color: f.color }}>{f.score}</Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>rounds won</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
                <Text style={{ fontSize: 11, color: C.textMuted, flex: 1 }}>Scorecard based on rounds won · Judge decisions may vary</Text>
              </View>
            </View>
          );
        }
        if (sp === 'cricket') {
          const cr = extractCricketInnings(st);
          if (!cr) return null;
          const defined = [cr.inning1, cr.inning2, cr.inning3, cr.inning4].filter(Boolean) as InningsScore[];
          if (defined.length === 0) return null;
          // Innings 1 & 3 = home team, 2 & 4 = away team (standard cricket rotation)
          const INNINGS_COLORS = ['#38BDF8', '#F59E0B', '#38BDF8', '#F59E0B'];
          const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
          const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
          const inningsData = [
            cr.inning1 ? { label: '1st Inn', team: homeAbbr, teamColor: C.accentBlue, accent: INNINGS_COLORS[0], ...cr.inning1 } : null,
            cr.inning2 ? { label: '2nd Inn', team: awayAbbr, teamColor: C.accentRed, accent: INNINGS_COLORS[1], ...cr.inning2 } : null,
            cr.inning3 ? { label: '3rd Inn', team: homeAbbr, teamColor: C.accentBlue, accent: INNINGS_COLORS[2], ...cr.inning3 } : null,
            cr.inning4 ? { label: '4th Inn', team: awayAbbr, teamColor: C.accentRed, accent: INNINGS_COLORS[3], ...cr.inning4 } : null,
          ].filter(Boolean) as Array<{ label: string; team: string; teamColor: string; accent: string; runs: number; wickets: number; overs?: number }>;
          return (
            <View style={[ckt.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={ckt.titleRow}>
                <View style={[ckt.titleDot, { backgroundColor: '#34D399' }]} />
                <Text style={[ckt.title, { color: C.textSecondary }]}>INNINGS SCORECARD</Text>
                <View style={ckt.teamLegend}>
                  {[{ abbr: homeAbbr, color: C.accentBlue }, { abbr: awayAbbr, color: C.accentRed }].map(({ abbr, color }) => (
                    <View key={abbr} style={[ckt.legendPill, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
                      <View style={[ckt.legendDot, { backgroundColor: color }]} />
                      <Text style={[ckt.legendText, { color }]}>{abbr}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={ckt.cardsRow}>
                {inningsData.map((inn) => (
                  <View key={inn.label} style={[ckt.inningsCard, { backgroundColor: `${inn.teamColor}0A`, borderColor: `${inn.teamColor}33` }]}>
                    <Text style={[ckt.innLabel, { color: C.textMuted }]}>{inn.label}</Text>
                    <View style={[ckt.innTeamPill, { backgroundColor: `${inn.teamColor}18`, borderColor: `${inn.teamColor}44` }]}>
                      <Text style={[ckt.innTeamText, { color: inn.teamColor }]}>{inn.team}</Text>
                    </View>
                    <Text style={[ckt.innScore, { color: inn.teamColor }]}>{inn.runs}<Text style={[ckt.innWickets, { color: C.textMuted }]}>/{inn.wickets}</Text></Text>
                    {inn.overs != null ? <Text style={[ckt.innOvers, { color: C.textMuted }]}>({inn.overs} ov)</Text> : null}
                    {/* Run-rate */}
                    {inn.overs != null && inn.overs > 0 ? (
                      <View style={[ckt.rrBadge, { backgroundColor: `${inn.accent}12`, borderColor: `${inn.accent}33` }]}>
                        <Text style={[ckt.rrText, { color: inn.accent }]}>RR {(inn.runs / inn.overs).toFixed(2)}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
              {/* Totals summary row */}
              <View style={[ckt.summaryRow, { borderTopColor: C.border }]}>
                {[{ abbr: homeAbbr, color: C.accentBlue, inns: inningsData.filter(d => d.teamColor === C.accentBlue) },
                  { abbr: awayAbbr, color: C.accentRed, inns: inningsData.filter(d => d.teamColor === C.accentRed) }].map(({ abbr, color, inns }) => {
                    const totalRuns = inns.reduce((s, i) => s + i.runs, 0);
                    return (
                      <View key={abbr} style={ckt.summaryItem}>
                        <Text style={[ckt.summaryTeam, { color }]}>{abbr}</Text>
                        <Text style={[ckt.summaryRuns, { color }]}>{totalRuns} runs</Text>
                      </View>
                    );
                  })}
              </View>
            </View>
          );
        }
        return null;
      })()}

      {activeSection === 'chart' ? (
        <GlassCard style={{ gap: 10 }}>
          <View style={[statsStyles.teamsHeader, { borderBottomColor: C.border }]}>
            <View style={statsStyles.teamHeaderLeft}>
              <View style={[statsStyles.teamColorDot, { backgroundColor: C.accentBlue }]} />
              <Text style={[statsStyles.teamHeaderName, { color: C.accentBlue }]} numberOfLines={1}>{match.homeTeam}</Text>
            </View>
            <Text style={[statsStyles.teamsHeaderVs, { color: C.textMuted }]}>vs</Text>
            <View style={statsStyles.teamHeaderRight}>
              <Text style={[statsStyles.teamHeaderName, { color: C.accentRed, textAlign: 'right' }]} numberOfLines={1}>{match.awayTeam}</Text>
              <View style={[statsStyles.teamColorDot, { backgroundColor: C.accentRed }]} />
            </View>
          </View>
          {detailLoading && !detailData ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : statsData.length > 0 ? (
            <StatsBarchart stats={statsData} homeColor={C.accentBlue} awayColor={C.accentRed} C={C} />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="stats-chart-outline" size={32} color={C.textMuted} />
              <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
                {match.status === 'upcoming' ? 'Stats will appear once the match starts.' : 'No statistics recorded for this match.'}
              </Text>
            </View>
          )}
          {detailData?.stats?.homeXG != null ? (
            <View style={[statsStyles.avgGoalsRow, { borderTopColor: C.border }]}>
              <FontAwesome5 name="chart-line" size={10} color={C.textMuted} />
              <Text style={[statsStyles.avgGoalsText, { color: C.textMuted }]}>
                {'xG — '}{match.homeTeam.split(' ').slice(-1)[0]}{': '}
                {detailData.stats.homeXG?.toFixed(2)}{'  ·  '}
                {match.awayTeam.split(' ').slice(-1)[0]}{': '}
                {detailData.stats.awayXG?.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </GlassCard>
      ) : null}

      {activeSection === 'h2h' ? (
        <GlassCard style={{ gap: 12 }}>
          <View style={[statsStyles.h2hSummary, { backgroundColor: C.surface, borderColor: C.border }]}>
            <View style={statsStyles.h2hSummaryItem}>
              <Text style={[statsStyles.h2hSummaryNum, { color: C.accentBlue }]}>{homeWins}</Text>
              <Text style={[statsStyles.h2hSummaryLabel, { color: C.textMuted }]} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0]}</Text>
            </View>
            <View style={[statsStyles.h2hSummaryDivider, { backgroundColor: C.border }]} />
            <View style={statsStyles.h2hSummaryItem}>
              <Text style={[statsStyles.h2hSummaryNum, { color: C.textMuted }]}>{draws}</Text>
              <Text style={[statsStyles.h2hSummaryLabel, { color: C.textMuted }]}>Draws</Text>
            </View>
            <View style={[statsStyles.h2hSummaryDivider, { backgroundColor: C.border }]} />
            <View style={statsStyles.h2hSummaryItem}>
              <Text style={[statsStyles.h2hSummaryNum, { color: C.accentRed }]}>{awayWins}</Text>
              <Text style={[statsStyles.h2hSummaryLabel, { color: C.textMuted }]} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0]}</Text>
            </View>
          </View>
          <View style={statsStyles.h2hBarWrap}>
            <View style={[statsStyles.h2hBarHome, { flex: homeWins || 0.1, backgroundColor: C.accentBlue }]} />
            {draws > 0 ? <View style={[statsStyles.h2hBarDraw, { flex: draws, backgroundColor: C.border }]} /> : null}
            <View style={[statsStyles.h2hBarAway, { flex: awayWins || 0.1, backgroundColor: C.accentRed }]} />
          </View>
          <View style={statsStyles.h2hLegend}>
            {[['Home wins', C.accentBlue], ['Draws', C.textMuted], ['Away wins', C.accentRed]].map(([label, color]) => (
              <View key={label} style={statsStyles.h2hLegendItem}>
                <View style={[statsStyles.h2hLegendDot, { backgroundColor: color }]} />
                <Text style={[statsStyles.h2hLegendText, { color }]}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Last 5 Meetings</Text>
          {h2hData.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 16, gap: 6 }}>
              <Ionicons name="git-compare-outline" size={24} color={C.textMuted} />
              <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>No previous encounters found in database.</Text>
            </View>
          ) : null}
          {h2hData.map((game, i) => {
            const homeIsMatchHome = game.home === match.homeTeam;
            const winner: 'home' | 'away' | 'draw' = game.winner === 'draw' ? 'draw' : (game.winner === 'home' && homeIsMatchHome) || (game.winner === 'away' && !homeIsMatchHome) ? 'home' : 'away';
            return (
              <View key={i} style={[statsStyles.h2hRow, { borderBottomColor: C.border }]}>
                <Text style={[statsStyles.h2hDate, { color: C.textMuted }]}>{game.date}</Text>
                <Text style={[statsStyles.h2hTeam, { color: winner === 'home' ? C.accentBlue : C.textSecondary }, winner === 'home' ? { fontWeight: FONTS.bold } : null]} numberOfLines={1}>{game.home}</Text>
                <View style={[statsStyles.h2hScoreBox, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <H2HMarker winner={winner} C={C} />
                  <Text style={[statsStyles.h2hScoreText, { color: C.textPrimary }]}>{game.score}</Text>
                </View>
                <Text style={[statsStyles.h2hTeamRight, { color: winner === 'away' ? C.accentRed : C.textSecondary }, winner === 'away' ? { fontWeight: FONTS.bold } : null]} numberOfLines={1}>{game.away}</Text>
              </View>
            );
          })}
        </GlassCard>
      ) : null}

      {activeSection === 'standings' ? (
        <View style={[SC2, { backgroundColor: C.card, borderColor: C.border, padding: 0, overflow: 'hidden', borderRadius: RADIUS.xl }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 10 }}>
            <Ionicons name="podium-outline" size={16} color={C.primary} />
            <Text style={{ fontSize: 14, fontWeight: FONTS.bold as any, color: C.textPrimary, flex: 1 }}>{match.league}</Text>
            {match.leagueLogo ? <Image source={{ uri: match.leagueLogo }} style={{ width: 22, height: 22, borderRadius: 3 }} contentFit="contain" /> : null}
          </View>
          <StandingsTable match={match} C={C} />
        </View>
      ) : null}

      {activeSection === 'form' ? (
        <GlassCard style={{ gap: 16 }}>
          <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>Last 5 Results</Text>
          {formData.home.length === 0 && formData.away.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
              <Ionicons name="trending-up-outline" size={28} color={C.textMuted} />
              <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>Form data not yet available for these teams.</Text>
            </View>
          ) : null}
          {[{ team: match.homeTeam, form: formData.home, color: C.accentBlue }, { team: match.awayTeam, form: formData.away, color: C.accentRed }].map(({ team, form, color }, idx) => (
            <React.Fragment key={team}>
              {idx > 0 ? <View style={[statsStyles.formDivider, { backgroundColor: C.border }]} /> : null}
              <View style={statsStyles.formSection}>
                <View style={statsStyles.formTeamRow}>
                  <View style={[statsStyles.teamColorDot, { backgroundColor: color }]} />
                  <Text style={[statsStyles.formTeamName, { color }]}>{team}</Text>
                  <Text style={[statsStyles.formRecord, { color: C.textMuted }]}>
                    {form.filter(r => r.toUpperCase() === 'W').length}W {'  '}{form.filter(r => r.toUpperCase() === 'D').length}D {'  '}{form.filter(r => r.toUpperCase() === 'L').length}L
                  </Text>
                </View>
                <View style={statsStyles.formBadgesRow}>
                  {form.map((r, i) => <FormBadge key={i} result={r} C={C} />)}
                </View>
              </View>
            </React.Fragment>
          ))}
          <View style={[statsStyles.formCompareWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={[statsStyles.formCompareLabel, { color: C.textMuted }]}>Win Rate (last 5)</Text>
            <View style={statsStyles.formCompareRow}>
              <Text style={[statsStyles.formComparePct, { color: C.accentBlue }]}>{Math.round((formData.home.filter(r => r.toUpperCase() === 'W').length / Math.max(formData.home.length, 1)) * 100)}%</Text>
              <View style={statsStyles.formCompareBar}>
                <View style={[statsStyles.formCompareBarHome, { flex: Math.max(0.1, formData.home.filter(r => r.toUpperCase() === 'W').length), backgroundColor: C.accentBlue }]} />
                <View style={[statsStyles.formCompareBarAway, { flex: Math.max(0.1, formData.away.filter(r => r.toUpperCase() === 'W').length), backgroundColor: C.accentRed }]} />
              </View>
              <Text style={[statsStyles.formComparePct, { color: C.accentRed, textAlign: 'right' }]}>{Math.round((formData.away.filter(r => r.toUpperCase() === 'W').length / Math.max(formData.away.length, 1)) * 100)}%</Text>
            </View>
            <View style={statsStyles.formCompareLegend}>
              <Text style={[statsStyles.formCompareLegendText, { color: C.accentBlue }]}>{match.homeTeam.split(' ').slice(-1)[0]}</Text>
              <Text style={[statsStyles.formCompareLegendText, { color: C.accentRed }]}>{match.awayTeam.split(' ').slice(-1)[0]}</Text>
            </View>
          </View>
          <View style={statsStyles.formLegend}>
            {(['W', 'D', 'L'] as const).map((r) => (
              <View key={r} style={statsStyles.formLegendItem}>
                <FormBadge result={r} C={C} />
                <Text style={[statsStyles.formLegendText, { color: C.textMuted }]}>{r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}</Text>
              </View>
            ))}
          </View>
        </GlassCard>
      ) : null}
    </View>
  );
}

// Tennis set breakdown styles
const tns = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  titleDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 1, flex: 1 },
  setCountsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  setCountBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  setCountNum: { fontSize: 14, fontWeight: FONTS.extraBold },
  setCountSep: { fontSize: 13, fontWeight: FONTS.bold },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCell: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' as const },
  teamName: { fontSize: 13, fontWeight: FONTS.bold },
  setScore: { fontSize: 18, textAlign: 'center' as const },
  tiebreak: { fontSize: 8, textAlign: 'center' as const, marginTop: -2 },
  setsWonBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3, alignItems: 'center' as const },
  setsWonNum: { fontSize: 14, fontWeight: FONTS.extraBold },
  winnersRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  winnersLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, width: 60 },
  winnersChips: { flexDirection: 'row' as const, gap: 5, flex: 1 },
  winnerChip: { flex: 1, alignItems: 'center' as const, borderRadius: RADIUS.sm, borderWidth: 1, paddingVertical: 4 },
  winnerChipLabel: { fontSize: 9, fontWeight: FONTS.extraBold },
});

// Cricket innings styles
const ckt = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  titleDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 1, flex: 1 },
  teamLegend: { flexDirection: 'row' as const, gap: 6 },
  legendPill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 9, fontWeight: FONTS.extraBold },
  cardsRow: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
  inningsCard: { flex: 1, minWidth: '44%', borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 5, alignItems: 'center' as const },
  innLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  innTeamPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  innTeamText: { fontSize: 10, fontWeight: FONTS.bold },
  innScore: { fontSize: 24, fontWeight: FONTS.extraBold, marginTop: 2 },
  innWickets: { fontSize: 16, fontWeight: FONTS.medium },
  innOvers: { fontSize: 10 },
  rrBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  rrText: { fontSize: 9, fontWeight: FONTS.extraBold },
  summaryRow: { flexDirection: 'row' as const, justifyContent: 'space-around' as const, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  summaryItem: { alignItems: 'center' as const, gap: 2 },
  summaryTeam: { fontSize: 11, fontWeight: FONTS.bold },
  summaryRuns: { fontSize: 13, fontWeight: FONTS.extraBold },
});

const rgy = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  titleDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 1, flex: 1 },
  pillsRow: { flexDirection: 'row' as const, gap: 6 },
  pill: { borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  pillLabel: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  scoreRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  teamLabel: { width: 52, fontSize: 13, fontWeight: FONTS.bold },
  halvesGroup: { flex: 1, flexDirection: 'row' as const, gap: 6 },
  halfCell: { flex: 1, alignItems: 'center' as const, paddingVertical: 7, borderRadius: RADIUS.md, borderWidth: 1, gap: 4 },
  halfPts: { fontSize: 20, fontWeight: FONTS.extraBold },
  miniRow: { flexDirection: 'row' as const, gap: 4, flexWrap: 'wrap' as const, justifyContent: 'center' as const },
  miniItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
  miniCount: { fontSize: 9, fontWeight: FONTS.bold },
  totalCell: { width: 44, alignItems: 'center' as const, paddingVertical: 8, borderRadius: RADIUS.md, borderWidth: 1 },
  totalVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  keyRow: { flexDirection: 'row' as const, justifyContent: 'space-around' as const, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  keyItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  keyLabel: { fontSize: 9, fontWeight: FONTS.semiBold },
});

const bsk = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  titleDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: {},
  headerCell: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  teamName: { fontSize: 13, fontWeight: FONTS.bold },
  score: { fontSize: 14, textAlign: 'center' as const },
  total: { fontSize: 16, fontWeight: FONTS.extraBold, textAlign: 'right' as const },
  leaderRow: { flexDirection: 'row' as const, marginTop: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  leaderCell: { flex: 1, alignItems: 'center' as const, gap: 2 },
  leaderLabel: { fontSize: 9, fontWeight: FONTS.bold, letterSpacing: 0.4 },
  leaderWinner: { fontSize: 10, fontWeight: FONTS.bold },
});

const hky = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  titleDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  pillsRow: { flexDirection: 'row' as const, gap: 6 },
  pill: { borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  pillLabel: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  scoreRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  teamLabel: { width: 52, fontSize: 13, fontWeight: FONTS.bold },
  scoresGroup: { flex: 1, flexDirection: 'row' as const, gap: 6 },
  scoreCell: { flex: 1, alignItems: 'center' as const, paddingVertical: 4, borderRadius: RADIUS.sm },
  scoreCellSpecial: { borderWidth: 1 },
  scoreVal: { fontSize: 14, textAlign: 'center' as const },
  totalCell: { width: 40, alignItems: 'center' as const, paddingVertical: 6, borderRadius: RADIUS.md, borderWidth: 1 },
  totalVal: { fontSize: 16, fontWeight: FONTS.extraBold },
  extraTimePill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  extraTimeText: { fontSize: 10, fontWeight: FONTS.bold },
});

const statsStyles = StyleSheet.create({
  sectionTabs: { flexDirection: 'row', gap: 6 },
  sectionTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 4, borderRadius: RADIUS.lg, borderWidth: 1 },
  sectionTabText: { fontSize: 10, fontWeight: FONTS.medium },
  teamsHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, gap: 8 },
  teamHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamHeaderRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  teamHeaderName: { fontSize: 12, fontWeight: FONTS.bold, flex: 1 },
  teamsHeaderVs: { fontSize: 11, fontWeight: FONTS.bold },
  teamColorDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  avgGoalsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8, borderTopWidth: 1 },
  avgGoalsText: { fontSize: 11, flex: 1, lineHeight: 16 },
  h2hSummary: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14 },
  h2hSummaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  h2hSummaryNum: { fontSize: 28, fontWeight: FONTS.extraBold },
  h2hSummaryLabel: { fontSize: 10, fontWeight: FONTS.medium },
  h2hSummaryDivider: { width: 1, height: 36 },
  h2hBarWrap: { flexDirection: 'row', height: 8, borderRadius: RADIUS.full, overflow: 'hidden', gap: 2 },
  h2hBarHome: { borderRadius: RADIUS.full },
  h2hBarDraw: {},
  h2hBarAway: { borderRadius: RADIUS.full },
  h2hLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  h2hLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  h2hLegendDot: { width: 7, height: 7, borderRadius: 4 },
  h2hLegendText: { fontSize: 11, fontWeight: FONTS.medium },
  h2hRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1 },
  h2hDate: { fontSize: 10, width: 52 },
  h2hTeam: { flex: 1, fontSize: 12, textAlign: 'right' },
  h2hTeamRight: { flex: 1, fontSize: 12 },
  h2hScoreBox: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  h2hScoreText: { fontSize: 12, fontWeight: FONTS.bold },
  h2hMarker: { fontSize: 8 },
  formSection: { gap: 10 },
  formTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  formTeamName: { flex: 1, fontSize: 13, fontWeight: FONTS.bold },
  formRecord: { fontSize: 11, fontWeight: FONTS.medium },
  formBadgesRow: { flexDirection: 'row', gap: 6 },
  formBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  formBadgeText: { fontSize: 13, fontWeight: FONTS.extraBold },
  formDivider: { height: 1 },
  formCompareWrap: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 8 },
  formCompareLabel: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 0.5 },
  formCompareRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formComparePct: { fontSize: 16, fontWeight: FONTS.extraBold, width: 44 },
  formCompareBar: { flex: 1, height: 10, flexDirection: 'row', borderRadius: RADIUS.full, overflow: 'hidden', gap: 2 },
  formCompareBarHome: { borderRadius: RADIUS.full },
  formCompareBarAway: { borderRadius: RADIUS.full },
  formCompareLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  formCompareLegendText: { fontSize: 10, fontWeight: FONTS.semiBold },
  formLegend: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  formLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  formLegendText: { fontSize: 12 },
});

// ─── Odds Movement Chart ──────────────────────────────────────────────────────
function generateOddsSeries(currentOdds: number, points = 8): number[] {
  const series: number[] = [];
  let prev = currentOdds + (((currentOdds * 17) % 1) > 0.5 ? 0.15 : -0.15);
  for (let i = 0; i < points - 1; i++) {
    const jitter = ((Math.sin(i * currentOdds * 7.3 + currentOdds * 3.1) * 0.5 + 0.5) - 0.5) * 0.22;
    prev = Math.max(1.01, prev + jitter);
    series.push(parseFloat(prev.toFixed(2)));
  }
  series.push(currentOdds);
  return series;
}

function TrendArrow({ current, prev, C }: { current: number; prev: number; C: AppColors }) {
  if (Math.abs(current - prev) < 0.01) return <Ionicons name="remove" size={12} color={C.textMuted} />;
  const improved = current < prev;
  return <Ionicons name={improved ? 'arrow-down' : 'arrow-up'} size={12} color={improved ? C.accent : C.accentRed} />;
}

interface OddsLineData { label: string; key: string; currentOdds: number; series: number[]; color: string; }

function OddsMovementChart({ lines, C }: { lines: OddsLineData[]; C: AppColors }) {
  const CHART_W = 280; const CHART_H = 72; const PAD = { top: 8, bottom: 8, left: 4, right: 4 };
  if (lines.length === 0) return null;
  const allValues = lines.flatMap((l) => l.series); const minVal = Math.min(...allValues); const maxVal = Math.max(...allValues); const range = maxVal - minVal || 0.5;
  const numPoints = lines[0].series.length; const plotW = CHART_W - PAD.left - PAD.right; const plotH = CHART_H - PAD.top - PAD.bottom;
  function toX(i: number) { return PAD.left + (i / (numPoints - 1)) * plotW; }
  function toY(val: number) { return PAD.top + plotH - ((val - minVal) / range) * plotH; }

  return (
    <View style={[oddsChart.wrap, { backgroundColor: C.surface, borderColor: C.border }]}>
      <View style={oddsChart.header}>
        <Ionicons name="trending-up-outline" size={13} color={C.textMuted} />
        <Text style={[oddsChart.title, { color: C.textSecondary }]}>Odds Movement</Text>
        <Text style={[oddsChart.subtitle, { color: C.textMuted }]}>Historical movement</Text>
      </View>
      <Svg width={CHART_W} height={CHART_H}>
        <Defs>
          {lines.map((line) => (
            <SvgLinearGradient key={`grad-${line.key}`} id={`grad-${line.key}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={line.color} stopOpacity="0.25" />
              <Stop offset="1" stopColor={line.color} stopOpacity="0" />
            </SvgLinearGradient>
          ))}
        </Defs>
        {[0.25, 0.5, 0.75].map((frac, i) => (
          <Polyline key={`grid-${i}`} points={`${PAD.left},${PAD.top + plotH * frac} ${CHART_W - PAD.right},${PAD.top + plotH * frac}`} stroke={C.border} strokeWidth={0.8} fill="none" />
        ))}
        {lines.map((line) => (
          <Polyline key={line.key} points={line.series.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')} stroke={line.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {lines.map((line) => (
          <Circle key={`dot-${line.key}`} cx={toX(numPoints - 1)} cy={toY(line.series[line.series.length - 1])} r={3.5} fill={line.color} stroke={C.bg} strokeWidth={1.5} />
        ))}
      </Svg>
      <View style={oddsChart.legend}>
        {lines.map((line) => (
          <View key={line.key} style={oddsChart.legendItem}>
            <View style={[oddsChart.legendDot, { backgroundColor: line.color }]} />
            <Text style={[oddsChart.legendLabel, { color: line.color }]}>{line.label}</Text>
            <TrendArrow current={line.series[line.series.length - 1]} prev={line.series[line.series.length - 2]} C={C} />
            <Text style={[oddsChart.legendOdds, { color: line.color }]}>{line.currentOdds.toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const oddsChart = StyleSheet.create({
  wrap: { borderRadius: RADIUS.md, padding: 12, borderWidth: 1, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: FONTS.bold, flex: 1 },
  subtitle: { fontSize: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  legendOdds: { fontSize: 12, fontWeight: FONTS.extraBold },
});

function OddsBtnWithTrend({ label, teamLabel, odds, series, color, C }: { label: string; teamLabel: string; odds: number; series: number[]; color: string; C: AppColors }) {
  const prev = series[series.length - 2] ?? odds;
  const improved = odds < prev; const unchanged = Math.abs(odds - prev) < 0.01;
  const trendColor = unchanged ? C.textMuted : improved ? C.accent : C.accentRed;
  const trendIcon = unchanged ? 'remove' : improved ? 'arrow-down' : 'arrow-up';
  return (
    <Pressable style={({ pressed }) => [styles.oddsBtn, { backgroundColor: C.surface, borderColor: C.border }, pressed ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : null]}>
      <Text style={[styles.oddsBtnLabel, { color: C.textMuted }]}>{label}</Text>
      <Text style={[styles.oddsBtnTeam, { color: C.textSecondary }]} numberOfLines={1}>{teamLabel}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Ionicons name={trendIcon} size={11} color={trendColor} />
        <Text style={[styles.oddsBtnOdds, { color }]}>{odds.toFixed(2)}</Text>
      </View>
    </Pressable>
  );
}

// ─── Odds Tab — chart on top, markets below ─────────────────────────────────
function OddsTab({ match, C, detailData }: { match: MatchDetail; C: AppColors; detailData: DetailedMatchData | null }) {
  const isTennis = match.sport?.toLowerCase() === 'tennis';
  const isBball = match.sport?.toLowerCase() === 'basketball';
  const isMMA = match.sport?.toLowerCase() === 'mma' || match.sport?.toLowerCase() === 'boxing';
  const isHandball = match.sport?.toLowerCase() === 'handball' || match.sport?.toLowerCase() === 'volleyball';
  // Prefer real odds from DB
  const realOdds = detailData?.odds;
  const homeOdds = realOdds?.homeWin ?? match.homeOdds ?? (isTennis ? 1.80 : isBball ? 1.95 : 1.85);
  const awayOdds = realOdds?.awayWin ?? match.awayOdds ?? (isTennis ? 2.00 : isBball ? 1.90 : 4.20);
  const drawOdds = realOdds?.draw ?? match.drawOdds ?? 3.50;
  const over25 = realOdds?.over25 ?? 1.65;
  const under25 = realOdds?.under25 ?? 2.30;
  const bttsYes = realOdds?.bttsYes ?? 1.72;
  const bttsNo = realOdds?.bttsNo ?? 2.10;
  const bookmaker = realOdds?.bookmaker ?? 'Estimated';

  const homeSeries = generateOddsSeries(homeOdds);
  const drawtSeries = generateOddsSeries(drawOdds);
  const awaySeries = generateOddsSeries(awayOdds);
  const homeAbbr = match.homeTeam.split(' ').slice(-1)[0];
  const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
  const mainChartLines: OddsLineData[] = (isTennis || isBball || isMMA || isHandball)
    ? [{ label: `${homeAbbr}`, key: '1', currentOdds: homeOdds, series: homeSeries, color: C.accentBlue },
       { label: `${awayAbbr}`, key: '2', currentOdds: awayOdds, series: awaySeries, color: C.accentRed }]
    : [{ label: `1 (${homeAbbr})`, key: '1', currentOdds: homeOdds, series: homeSeries, color: C.accentBlue },
       { label: 'X (Draw)', key: 'X', currentOdds: drawOdds, series: drawtSeries, color: C.primary },
       { label: `2 (${awayAbbr})`, key: '2', currentOdds: awayOdds, series: awaySeries, color: C.accentRed }];

  const markets = isTennis
    ? [{ market: '🎾 Match Winner', options: [
        { label: homeAbbr, odds: homeOdds, key: '1', series: homeSeries, color: C.accentBlue },
        { label: awayAbbr, odds: awayOdds, key: '2', series: awaySeries, color: C.accentRed }] },
       { market: 'Total Sets O/U', options: [
        { label: 'Over 2.5', odds: 1.75, key: 'O25', series: generateOddsSeries(1.75), color: C.accent },
        { label: 'Under 2.5', odds: 2.10, key: 'U25', series: generateOddsSeries(2.10), color: C.textSecondary }] },
       { market: 'First Set Winner', options: [
        { label: `${homeAbbr} 1st Set`, odds: parseFloat((homeOdds * 0.85).toFixed(2)), key: 'FS1', series: generateOddsSeries(homeOdds * 0.85), color: OV_HOME },
        { label: `${awayAbbr} 1st Set`, odds: parseFloat((awayOdds * 0.85).toFixed(2)), key: 'FS2', series: generateOddsSeries(awayOdds * 0.85), color: OV_AWAY }] }]
    : isBball
    ? [{ market: '🏀 Game Winner', options: [
        { label: homeAbbr, odds: homeOdds, key: '1', series: homeSeries, color: C.accentBlue },
        { label: awayAbbr, odds: awayOdds, key: '2', series: awaySeries, color: C.accentRed }] },
       { market: 'Total Points O/U', options: [
        { label: 'Over 215.5', odds: over25, key: 'O215', series: generateOddsSeries(over25), color: C.accent },
        { label: 'Under 215.5', odds: under25, key: 'U215', series: generateOddsSeries(under25), color: C.textSecondary }] },
       { market: 'Handicap Spread', options: [
        { label: `${homeAbbr} -4.5`, odds: parseFloat((homeOdds * 1.1).toFixed(2)), key: 'HS', series: generateOddsSeries(homeOdds * 1.1), color: OV_HOME },
        { label: `${awayAbbr} +4.5`, odds: parseFloat((awayOdds * 0.95).toFixed(2)), key: 'AS', series: generateOddsSeries(awayOdds * 0.95), color: OV_AWAY }] },
       { market: '1st Quarter Winner', options: [
        { label: homeAbbr, odds: parseFloat((homeOdds * 0.9).toFixed(2)), key: 'Q1H', series: generateOddsSeries(homeOdds * 0.9), color: OV_HOME },
        { label: awayAbbr, odds: parseFloat((awayOdds * 0.92).toFixed(2)), key: 'Q1A', series: generateOddsSeries(awayOdds * 0.92), color: OV_AWAY }] }]
    : isMMA
    ? [{ market: '🥊 Fight Winner', options: [
        { label: homeAbbr, odds: homeOdds, key: '1', series: homeSeries, color: C.accentBlue },
        { label: awayAbbr, odds: awayOdds, key: '2', series: awaySeries, color: C.accentRed }] },
       { market: 'Total Rounds O/U', options: [
        { label: 'Over 1.5', odds: 1.72, key: 'OR', series: generateOddsSeries(1.72), color: C.accent },
        { label: 'Under 1.5', odds: 2.15, key: 'UR', series: generateOddsSeries(2.15), color: C.textSecondary }] },
       { market: 'Method of Victory', options: [
        { label: 'KO / TKO', odds: 2.10, key: 'KO', series: generateOddsSeries(2.10), color: '#EF4444' },
        { label: 'Submission', odds: 2.80, key: 'SUB', series: generateOddsSeries(2.80), color: '#A78BFA' },
        { label: 'Decision', odds: 1.95, key: 'DEC', series: generateOddsSeries(1.95), color: '#38BDF8' }] },
       { market: 'Fight to Go to Distance', options: [
        { label: 'Yes (Decision)', odds: 1.85, key: 'FTD_Y', series: generateOddsSeries(1.85), color: '#22C55E' },
        { label: 'No (Stoppage)', odds: 1.90, key: 'FTD_N', series: generateOddsSeries(1.90), color: '#F59E0B' }] }]
    : isHandball
    ? [{ market: '🤾 Match Winner (1X2)', options: [
        { label: homeAbbr, odds: homeOdds, key: '1', series: homeSeries, color: C.accentBlue },
        { label: 'Draw', odds: drawOdds, key: 'X', series: drawtSeries, color: C.primary },
        { label: awayAbbr, odds: awayOdds, key: '2', series: awaySeries, color: C.accentRed }] },
       { market: 'Total Goals O/U', options: [
        { label: 'Over 48.5', odds: 1.80, key: 'OHB', series: generateOddsSeries(1.80), color: C.accent },
        { label: 'Under 48.5', odds: 1.95, key: 'UHB', series: generateOddsSeries(1.95), color: C.textSecondary }] },
       { market: 'Both Teams to Score 20+', options: [
        { label: 'Yes', odds: bttsYes, key: 'BHY', series: generateOddsSeries(bttsYes), color: '#14B8A6' },
        { label: 'No', odds: bttsNo, key: 'BHN', series: generateOddsSeries(bttsNo), color: '#F97316' }] },
       { market: 'Winning Margin', options: [
        { label: '1-3 Goals', odds: 3.20, key: 'WM1', series: generateOddsSeries(3.20), color: '#F59E0B' },
        { label: '4-6 Goals', odds: 2.40, key: 'WM2', series: generateOddsSeries(2.40), color: OV_HOME },
        { label: '7+ Goals', odds: 2.80, key: 'WM3', series: generateOddsSeries(2.80), color: OV_AWAY }] }]
    : [{ market: `Match Result (1X2) · ${bookmaker}`, options: [
        { label: homeAbbr, odds: homeOdds, key: '1', series: homeSeries, color: C.accentBlue },
        { label: 'Draw', odds: drawOdds, key: 'X', series: drawtSeries, color: C.primary },
        { label: awayAbbr, odds: awayOdds, key: '2', series: awaySeries, color: C.accentRed }] },
       { market: 'Both Teams to Score', options: [
        { label: 'Yes', odds: bttsYes, key: 'Y', series: generateOddsSeries(bttsYes), color: C.accent },
        { label: 'No', odds: bttsNo, key: 'N', series: generateOddsSeries(bttsNo), color: C.accentRed }] },
       { market: 'Total Goals', options: [
        { label: 'Over 2.5', odds: over25, key: 'O25', series: generateOddsSeries(over25), color: C.accent },
        { label: 'Under 2.5', odds: under25, key: 'U25', series: generateOddsSeries(under25), color: C.textSecondary }] }];

  // Source badge
  const sourceBadge = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: realOdds ? `${C.accent}14` : C.surface,
      borderRadius: RADIUS.full, borderWidth: 1,
      borderColor: realOdds ? `${C.accent}33` : C.border,
      paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' }}>
      <Ionicons name={realOdds ? 'checkmark-circle' : 'layers-outline'} size={12} color={realOdds ? C.accent : C.textMuted} />
      <Text style={{ fontSize: 11, color: realOdds ? C.accent : C.textMuted, fontWeight: FONTS.semiBold }}>
        {realOdds ? `Odds · ${bookmaker}` : 'Probability model'}
      </Text>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      {sourceBadge}

      {/* ── MOVEMENT CHART ON TOP ─────────────────────────────────── */}
      <GlassCard style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Ionicons name="trending-up-outline" size={14} color={C.textMuted} />
          <Text style={[styles.sectionTitle, { color: C.textSecondary, marginBottom: 0 }]}>{isTennis ? '🎾 Odds Movement' : isBball ? '🏀 Points Line Movement' : isMMA ? '🥊 Fight Odds Movement' : isHandball ? '🤾 Handball Odds Movement' : '1X2 Odds Movement'}</Text>
        </View>
        <OddsMovementChart lines={mainChartLines} C={C} />
        <View style={[{ borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 4 }, { backgroundColor: C.surface, borderColor: C.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="information-circle-outline" size={11} color={C.textMuted} />
            <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: C.textMuted }}>READING THE CHART</Text>
          </View>
          <Text style={{ fontSize: 10, color: C.textMuted, lineHeight: 15 }}>
            {`↓ odds shortened = event more likely  ·  ↑ odds drifted = less likely\nLine ends at current market odds. Steeper = bigger movement.`}
          </Text>
        </View>
      </GlassCard>

      {/* ── LIVE ODDS TRACKER (if live) ────────────────────────────── */}
      {match.status === 'live' ? <LiveOddsRow match={match} C={C} /> : null}

      {/* ── MARKETS ON BOTTOM ─────────────────────────────────────── */}
      {markets.map((m, mIdx) => (
        <GlassCard key={m.market} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold as any, color: C.primary }}>{mIdx + 1}</Text>
            </View>
            <Text style={[styles.sectionTitle, { color: C.textSecondary, marginBottom: 0, flex: 1 }]}>{m.market}</Text>
          </View>
          <View style={styles.oddsGrid}>
            {m.options.map((o) => <OddsBtnWithTrend key={o.key} label={o.key} teamLabel={o.label} odds={o.odds} series={o.series} color={o.color} C={C} />)}
          </View>
          {/* Implied probability bar */}
          <View style={{ flexDirection: 'row', height: 4, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
            {m.options.map((o) => {
              const implied = Math.round((1 / o.odds) * 100);
              return <View key={o.key} style={{ flex: implied, backgroundColor: o.color, opacity: 0.7 }} />;
            })}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {m.options.map((o) => {
              const implied = Math.round((1 / o.odds) * 100);
              return (
                <Text key={o.key} style={{ flex: 1, fontSize: 9, color: o.color, textAlign: 'center', fontWeight: FONTS.semiBold as any }}>
                  {o.label} {implied}%
                </Text>
              );
            })}
          </View>
        </GlassCard>
      ))}
    </View>
  );
}

// ─── Live Timeline Indicator ────────────────────────────────────────────────
function LiveTimelineIndicator({ C }: { C: AppColors }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Dot pulse: scale 1 → 1.5 → 1, every 1.5s
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
        Animated.delay(300),
      ])
    );
    // Text opacity: 1 → 0.4 → 1, every 2s
    const fade = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    pulse.start();
    fade.start();
    return () => { pulse.stop(); fade.stop(); };
  }, []);

  return (
    <View style={[
      liveIndicator.wrap,
      { backgroundColor: '#EF444414', borderColor: '#EF444433' },
    ]}>
      {/* Pulsing red dot */}
      <Animated.View style={[
        liveIndicator.dot,
        { backgroundColor: '#EF4444', transform: [{ scale: pulseAnim }] },
      ]} />
      {/* Animated label */}
      <Animated.Text style={[
        liveIndicator.text,
        { color: '#EF4444', opacity: fadeAnim },
      ]}>
        Live · updates every 30s
      </Animated.Text>
      {/* Static refresh icon */}
      <Ionicons name="refresh-outline" size={11} color="#EF4444" />
    </View>
  );
}

const liveIndicator = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 10,
  },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  text: { fontSize: 11, fontWeight: FONTS.bold as any, letterSpacing: 0.3 },
});

// ─── Timeline Tab — real match events from matchStatsService ─────────────────
function parseEventEmoji(type: string): { emoji: string; label: string } {
  const t = (type ?? '').toLowerCase();
  if (t.includes('own')) return { emoji: '🔴', label: 'Own Goal' };
  if (t.includes('penalty') && t.includes('miss')) return { emoji: '❌', label: 'Penalty Miss' };
  if (t.includes('penalty')) return { emoji: '⚽', label: 'Penalty Goal' };
  if (t.includes('goal')) return { emoji: '⚽', label: 'Goal' };
  if (t.includes('yellow')) return { emoji: '🟨', label: 'Yellow Card' };
  if (t.includes('red')) return { emoji: '🟥', label: 'Red Card' };
  if (t.includes('sub')) return { emoji: '🔄', label: 'Substitution' };
  if (t.includes('var')) return { emoji: '📺', label: 'VAR Review' };
  if (t.includes('half') || t === 'ht') return { emoji: '⏱️', label: 'Half Time' };
  if (t.includes('quarter')) return { emoji: '🔔', label: 'Quarter End' };
  if (t.includes('set')) return { emoji: '🏆', label: 'Set Won' };
  if (t.includes('break')) return { emoji: '↗️', label: 'Break of Serve' };
  return { emoji: '•', label: type };
}

function TimelineTab({ match, C, detailData, detailLoading, matchId }: {
  match: MatchDetail; C: AppColors;
  detailData: DetailedMatchData | null;
  detailLoading: boolean;
  matchId: string;
}) {
  // ── Live auto-refresh for match events every 30s ────────────────────────
  const [liveEvents, setLiveEvents] = useState<MatchEvent[] | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLiveEvents = useCallback(async () => {
    if (!matchId) return;
    try {
      const { data } = await getSupabaseClient()
        .from('match_events')
        .select('*')
        .eq('match_id', matchId)
        .order('minute', { ascending: true })
        .order('extra_minute', { ascending: true });
      if (data) {
        const mapped: MatchEvent[] = (data as any[]).map((r) => ({
          id: r.id as string,
          matchId: r.match_id as string,
          externalMatchId: (r.external_match_id as string) ?? '',
          eventType: (r.event_type as string) ?? '',
          playerName: (r.player_name as string) ?? '',
          playerId: r.player_id as number | null,
          assistName: (r.assist_name as string) ?? null,
          team: (r.team as string) ?? '',
          isHomeTeam: (r.is_home_team as boolean) ?? true,
          minute: Number(r.minute ?? 0),
          extraMinute: r.extra_minute != null ? Number(r.extra_minute) : null,
          detail: (r.detail as string) ?? null,
          comments: (r.comments as string) ?? null,
        }));
        setLiveEvents(mapped);
        setLastRefreshed(new Date());
      }
    } catch { /* non-blocking */ }
  }, [matchId]);

  useEffect(() => {
    if (match.status !== 'live') {
      // Clear any running interval if status is no longer live
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }
    // Initial fetch
    fetchLiveEvents();
    // Set up 30s polling
    refreshIntervalRef.current = setInterval(fetchLiveEvents, 30_000);
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [match.status, fetchLiveEvents]);

  // Merge: prefer live-fetched events if available, fall back to detailData
  const rawEvents = liveEvents ?? detailData?.events ?? [];
  const events: MatchEvent[] = [...rawEvents].sort((a, b) => a.minute - b.minute);
  const homeColor = C.accentBlue;
  const awayColor = C.accentRed;

  if (detailLoading && !detailData && !liveEvents) return (
    <View style={tl.empty}><ActivityIndicator size="large" color={C.primary} /></View>
  );

  if (match.status === 'upcoming') return (
    <View style={tl.empty}>
      <Ionicons name="time-outline" size={40} color={C.textMuted} />
      <Text style={[tl.emptyTitle, { color: C.textSecondary }]}>No Events Yet</Text>
      <Text style={[tl.emptySub, { color: C.textMuted }]}>Timeline will update once the match starts.</Text>
    </View>
  );

  if (events.length === 0) return (
    <View style={tl.empty}>
      <Text style={{ fontSize: 36 }}>📋</Text>
      <Text style={[tl.emptyTitle, { color: C.textSecondary }]}>No events recorded</Text>
      <Text style={[tl.emptySub, { color: C.textMuted }]}>
        {match.status === 'live' ? 'Events will appear as the match progresses.' : 'No match events were recorded for this game.'}
      </Text>
    </View>
  );

  return (
    <View style={tl.wrap}>
      {/* Pulsing Live indicator — only shown when match is live */}
      {match.status === 'live' ? <LiveTimelineIndicator C={C} /> : null}

      <View style={[tl.infoStrip, { backgroundColor: C.surface, borderColor: C.border, marginHorizontal: SPACING.md, marginBottom: 8 }]}>
        <Text style={[tl.infoHome, { color: homeColor }]} numberOfLines={1}>{match.homeTeam}</Text>
        <View style={tl.infoCenter}>
          <Ionicons name="list-outline" size={13} color={C.textMuted} />
          <Text style={[tl.infoLabel, { color: C.textMuted }]}>Timeline</Text>
          {match.status === 'live' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EF444414', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#EF444433', paddingHorizontal: 6, paddingVertical: 2 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' }} />
              <Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: '#EF4444' }}>LIVE</Text>
            </View>
          ) : null}
        </View>
        <Text style={[tl.infoAway, { color: awayColor }]} numberOfLines={1}>{match.awayTeam}</Text>
      </View>
      {events.map((ev) => {
        const { emoji, label } = parseEventEmoji(ev.eventType);
        const isHome = ev.isHomeTeam;
        const color = isHome ? homeColor : awayColor;
        const t = (ev.eventType ?? '').toLowerCase();
        const isMarker = t.includes('half') || t.includes('quarter') || t === 'ht';
        if (isMarker) return (
          <View key={ev.id} style={[tl.markerRow, { marginHorizontal: SPACING.md }]}>
            <View style={[tl.markerLine, { backgroundColor: C.border }]} />
            <View style={[tl.markerPill, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={{ fontSize: 14 }}>{emoji}</Text>
              <Text style={[tl.markerText, { color: C.textMuted }]}>{ev.detail ?? label}</Text>
            </View>
            <View style={[tl.markerLine, { backgroundColor: C.border }]} />
          </View>
        );
        return (
          <View key={ev.id} style={[tl.eventRow, isHome ? tl.eventHome : tl.eventAway]}>
            {isHome ? (
              <View style={[tl.eventContent, tl.eventContentHome]}>
                <View style={[tl.iconBubble, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
                  <Text style={{ fontSize: 15 }}>{emoji}</Text>
                </View>
                <View style={[tl.textWrap, { alignItems: 'flex-end' }]}>
                  <Text style={[tl.playerName, { color: C.textPrimary }]} numberOfLines={1}>{ev.playerName || label}</Text>
                  {ev.assistName ? <Text style={[tl.detailText, { color: C.textMuted }]} numberOfLines={1}>Assist: {ev.assistName}</Text> : null}
                  {ev.detail ? <Text style={[tl.detailText, { color: C.textMuted }]} numberOfLines={1}>{ev.detail}</Text> : null}
                  <Text style={[tl.eventTypeLabel, { color }]}>{label}</Text>
                </View>
              </View>
            ) : <View style={tl.spacer} />}
            <View style={tl.minuteCol}>
              <View style={[tl.minuteDot, { backgroundColor: C.border }]} />
              <View style={[tl.minutePill, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
                <Text style={[tl.minuteText, { color }]}>{ev.minute}{ev.extraMinute ? `+${ev.extraMinute}` : `'`}</Text>
              </View>
              <View style={[tl.minuteDot, { backgroundColor: C.border }]} />
            </View>
            {!isHome ? (
              <View style={[tl.eventContent, tl.eventContentAway]}>
                <View style={[tl.textWrap, { alignItems: 'flex-start' }]}>
                  <Text style={[tl.playerName, { color: C.textPrimary }]} numberOfLines={1}>{ev.playerName || label}</Text>
                  {ev.assistName ? <Text style={[tl.detailText, { color: C.textMuted, textAlign: 'left' }]} numberOfLines={1}>Assist: {ev.assistName}</Text> : null}
                  {ev.detail ? <Text style={[tl.detailText, { color: C.textMuted, textAlign: 'left' }]} numberOfLines={1}>{ev.detail}</Text> : null}
                  <Text style={[tl.eventTypeLabel, { color, textAlign: 'left' }]}>{label}</Text>
                </View>
                <View style={[tl.iconBubble, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
                  <Text style={{ fontSize: 15 }}>{emoji}</Text>
                </View>
              </View>
            ) : <View style={tl.spacer} />}
          </View>
        );
      })}
      <View style={{ height: 16 }} />
    </View>
  );
}

const tl = StyleSheet.create({
  wrap: { paddingTop: 4 },
  infoStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  infoHome: { flex: 1, fontSize: 12, fontWeight: FONTS.bold },
  infoAway: { flex: 1, fontSize: 12, fontWeight: FONTS.bold, textAlign: 'right' },
  infoCenter: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  infoLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: SPACING.md },
  eventHome: {}, eventAway: {},
  eventContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventContentHome: { justifyContent: 'flex-end' },
  eventContentAway: { justifyContent: 'flex-start' },
  spacer: { flex: 1 },
  iconBubble: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  textWrap: { maxWidth: 110, gap: 1 },
  playerName: { fontSize: 12, fontWeight: FONTS.bold, textAlign: 'right' },
  detailText: { fontSize: 10, textAlign: 'right' },
  eventTypeLabel: { fontSize: 10, fontWeight: FONTS.semiBold, textAlign: 'right' },
  minuteCol: { alignItems: 'center', gap: 2, marginHorizontal: 8, width: 48 },
  minuteDot: { width: 1, height: 10 },
  minutePill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center', minWidth: 38 },
  minuteText: { fontSize: 10, fontWeight: FONTS.extraBold, textAlign: 'center' },
  markerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4, gap: 8 },
  markerLine: { flex: 1, height: 1 },
  markerPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full, borderWidth: 1 },
  markerText: { fontSize: 10, fontWeight: FONTS.bold },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.bold },
  emptySub: { fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Lineups Tab ───────────────────────────────────────────────────────────────
interface PlayerSlot { number: number; name: string; position?: string; }
const FBL_HOME_NAMES = ['Ederson','Walker','Dias','Akanji','Gvardiol','Rodri','De Bruyne','Silva','Foden','Haaland','Doku'];
const FBL_AWAY_NAMES = ['Raya','White','Saliba','Gabriel','Zinchenko','Odegaard','Partey','Rice','Saka','Havertz','Martinelli'];
const BBL_POSITIONS = ['PG','SG','SF','PF','C'];
const BBL_HOME_NAMES = ['LeBron','Davis','Reaves','Hachimura','Vanderbilt'];
const BBL_AWAY_NAMES = ['Curry','Thompson','Green','Wiggins','Looney'];
function seedNum2(seed: number, min: number, max: number): number { return min + (Math.abs(seed) % (max - min + 1)); }

const PITCH_W = 320; const PITCH_H = 420; const PITCH_PAD = { x: 24, y: 28 };
const PITCH_INNER_W = PITCH_W - PITCH_PAD.x * 2; const PITCH_INNER_H = PITCH_H - PITCH_PAD.y * 2;

function get433Positions(side: 'home' | 'away'): { x: number; y: number }[] {
  const rows = [[{ col: 0 }], [{ col: 0 }, { col: 1 }, { col: 2 }, { col: 3 }], [{ col: 0 }, { col: 1 }, { col: 2 }], [{ col: 0 }, { col: 1 }, { col: 2 }]];
  const positions: { x: number; y: number }[] = [];
  rows.forEach((rowCols, rowIdx) => {
    const count = rowCols.length;
    const yFrac = side === 'home' ? 1 - (rowIdx / (rows.length - 1)) * 0.88 - 0.06 : (rowIdx / (rows.length - 1)) * 0.88 + 0.06;
    rowCols.forEach((_, colIdx) => {
      const xFrac = (colIdx + 0.5) / count;
      positions.push({ x: PITCH_PAD.x + xFrac * PITCH_INNER_W, y: PITCH_PAD.y + yFrac * PITCH_INNER_H });
    });
  });
  return positions;
}

function FootballPitch({ homeTeam, awayTeam, seed, C }: { homeTeam: string; awayTeam: string; seed: number; C: AppColors }) {
  const homePositions = get433Positions('home'); const awayPositions = get433Positions('away');
  const homePlayers: PlayerSlot[] = homePositions.map((_, i) => ({ number: [1,4,5,6,3,8,6,10,9,7,11][i] || i + 1, name: FBL_HOME_NAMES[(seed + i) % FBL_HOME_NAMES.length].split(' ')[0] }));
  const awayPlayers: PlayerSlot[] = awayPositions.map((_, i) => ({ number: [1,2,4,6,35,8,29,41,7,29,11][i] || i + 1, name: FBL_AWAY_NAMES[(seed + i + 3) % FBL_AWAY_NAMES.length].split(' ')[0] }));
  const homeRowLabels = ['GK','DEF','MID','FWD']; const circleR = 14; const fontSize = 7;

  return (
    <View style={lu.pitchWrap}>
      <Svg width={PITCH_W} height={PITCH_H}>
        <SvgRect x={0} y={0} width={PITCH_W} height={PITCH_H} rx={12} fill="#1A3A1A" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SvgRect key={`stripe-${i}`} x={PITCH_PAD.x} y={PITCH_PAD.y + (i * PITCH_INNER_H) / 8} width={PITCH_INNER_W} height={PITCH_INNER_H / 8} fill={i % 2 === 0 ? '#1E421E' : '#1A3A1A'} />
        ))}
        <SvgRect x={PITCH_PAD.x} y={PITCH_PAD.y} width={PITCH_INNER_W} height={PITCH_INNER_H} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
        <Line x1={PITCH_PAD.x} y1={PITCH_H / 2} x2={PITCH_W - PITCH_PAD.x} y2={PITCH_H / 2} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
        <Circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={36} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        <Circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={3} fill="rgba(255,255,255,0.35)" />
        <SvgRect x={PITCH_PAD.x + PITCH_INNER_W * 0.18} y={PITCH_H - PITCH_PAD.y - 60} width={PITCH_INNER_W * 0.64} height={60} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        <SvgRect x={PITCH_PAD.x + PITCH_INNER_W * 0.18} y={PITCH_PAD.y} width={PITCH_INNER_W * 0.64} height={60} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        <SvgRect x={PITCH_PAD.x + PITCH_INNER_W * 0.37} y={PITCH_H - PITCH_PAD.y - 12} width={PITCH_INNER_W * 0.26} height={12} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
        <SvgRect x={PITCH_PAD.x + PITCH_INNER_W * 0.37} y={PITCH_PAD.y - 12} width={PITCH_INNER_W * 0.26} height={12} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
        {homeRowLabels.map((label, rIdx) => {
          const rowSizes = [1, 4, 3, 3]; const start = rowSizes.slice(0, rIdx).reduce((a, b) => a + b, 0);
          const positions = homePositions.filter((_, i) => i >= start && i < start + rowSizes[rIdx]);
          if (positions.length === 0) return null;
          const avgY = positions.reduce((s, p) => s + p.y, 0) / positions.length;
          return <SvgText key={`hlabel-${rIdx}`} x={PITCH_PAD.x - 5} y={avgY + 3} fontSize={7} fill="rgba(255,255,255,0.4)" textAnchor="end" fontWeight="700">{label}</SvgText>;
        })}
        {homePositions.map((pos, i) => (
          <React.Fragment key={`hp-${i}`}>
            <Circle cx={pos.x} cy={pos.y} r={circleR} fill={C.accentBlue} opacity={0.92} />
            <Circle cx={pos.x} cy={pos.y} r={circleR} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
            <SvgText x={pos.x} y={pos.y - 2} fontSize={fontSize + 1} fontWeight="800" fill="white" textAnchor="middle">{homePlayers[i].number}</SvgText>
            <SvgText x={pos.x} y={pos.y + circleR + 9} fontSize={fontSize} fill="rgba(255,255,255,0.85)" textAnchor="middle" fontWeight="600">{homePlayers[i].name}</SvgText>
          </React.Fragment>
        ))}
        {awayPositions.map((pos, i) => (
          <React.Fragment key={`ap-${i}`}>
            <Circle cx={pos.x} cy={pos.y} r={circleR} fill={C.accentRed} opacity={0.92} />
            <Circle cx={pos.x} cy={pos.y} r={circleR} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
            <SvgText x={pos.x} y={pos.y - 2} fontSize={fontSize + 1} fontWeight="800" fill="white" textAnchor="middle">{awayPlayers[i].number}</SvgText>
            <SvgText x={pos.x} y={pos.y + circleR + 9} fontSize={fontSize} fill="rgba(255,255,255,0.85)" textAnchor="middle" fontWeight="600">{awayPlayers[i].name}</SvgText>
          </React.Fragment>
        ))}
        <SvgText x={PITCH_W / 2} y={PITCH_H - 6} fontSize={9} fill="rgba(255,255,255,0.35)" textAnchor="middle" fontWeight="600">4-3-3</SvgText>
      </Svg>
      <View style={lu.pitchLegend}>
        <View style={lu.legendItem}><View style={[lu.legendDot, { backgroundColor: C.accentBlue }]} /><Text style={[lu.legendText, { color: C.accentBlue }]} numberOfLines={1}>{homeTeam}</Text></View>
        <View style={lu.legendItem}><View style={[lu.legendDot, { backgroundColor: C.accentRed }]} /><Text style={[lu.legendText, { color: C.accentRed }]} numberOfLines={1}>{awayTeam}</Text></View>
      </View>
    </View>
  );
}

function BasketballLineups({ homeTeam, awayTeam, seed, C }: { homeTeam: string; awayTeam: string; seed: number; C: AppColors }) {
  const homePlayers: PlayerSlot[] = BBL_HOME_NAMES.map((name, i) => ({ number: [23,3,0,8,2][i] || i + 1, name: BBL_HOME_NAMES[(seed + i) % BBL_HOME_NAMES.length], position: BBL_POSITIONS[i] }));
  const awayPlayers: PlayerSlot[] = BBL_AWAY_NAMES.map((name, i) => ({ number: [30,11,23,22,5][i] || i + 10, name: BBL_AWAY_NAMES[(seed + i + 2) % BBL_AWAY_NAMES.length], position: BBL_POSITIONS[i] }));
  const posColors: Record<string, string> = { PG: C.primary, SG: C.accentBlue, SF: C.accent, PF: C.accentPurple, C: C.accentRed };

  const renderTeam = (players: PlayerSlot[], teamName: string, color: string) => (
    <View style={lu.bblHalf}>
      <View style={lu.bblHeader}><View style={[lu.bblColorBar, { backgroundColor: color }]} /><Text style={[lu.bblTeamName, { color }]} numberOfLines={1}>{teamName}</Text></View>
      {players.map((p, i) => (
        <View key={i} style={[lu.bblPlayerRow, { backgroundColor: C.surface, borderColor: C.border }]}>
          <View style={[lu.bblJersey, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
            <Text style={[lu.bblJerseyNum, { color }]}>#{p.number}</Text>
          </View>
          <Text style={[lu.bblPlayerName, { color: C.textPrimary }]} numberOfLines={1}>{p.name}</Text>
          <View style={[lu.bblPosBadge, { backgroundColor: `${posColors[p.position!]}18`, borderColor: `${posColors[p.position!]}44` }]}>
            <Text style={[lu.bblPosText, { color: posColors[p.position!] }]}>{p.position}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={lu.bblWrap}>
      {renderTeam(homePlayers, homeTeam, C.accentBlue)}
      <View style={[lu.bblDivider, { backgroundColor: C.border }]} />
      {renderTeam(awayPlayers, awayTeam, C.accentRed)}
    </View>
  );
}

function TennisLineups({ homeTeam, awayTeam, seed, C }: { homeTeam: string; awayTeam: string; seed: number; C: AppColors }) {
  const homeRank = seedNum2(seed * 3, 1, 25); const awayRank = seedNum2(seed * 7, 1, 40);
  const homeH2HWins = seedNum2(seed * 5, 0, 8); const awayH2HWins = seedNum2(seed * 11, 0, 8);
  const totalH2H = homeH2HWins + awayH2HWins;
  const homeServe1st = seedNum2(seed * 13, 175, 220); const awayServe1st = seedNum2(seed * 17, 168, 215);
  const homeServe2nd = seedNum2(seed * 19, 145, 175); const awayServe2nd = seedNum2(seed * 23, 140, 170);
  const homePts = seedNum2(seed * 29, 3500, 9500); const awayPts = seedNum2(seed * 31, 2000, 9000);
  const homeTitles = seedNum2(seed * 37, 0, 22); const awayTitles = seedNum2(seed * 41, 0, 18);
  const h2hFrac = totalH2H > 0 ? homeH2HWins / totalH2H : 0.5;

  type TennisStatRow = { label: string; homeVal: string; awayVal: string; homeHighlight?: boolean; awayHighlight?: boolean; };
  const stats: TennisStatRow[] = [
    { label: 'World Ranking', homeVal: `#${homeRank}`, awayVal: `#${awayRank}`, homeHighlight: homeRank < awayRank, awayHighlight: awayRank < homeRank },
    { label: 'ATP Points', homeVal: homePts.toLocaleString(), awayVal: awayPts.toLocaleString(), homeHighlight: homePts > awayPts, awayHighlight: awayPts > homePts },
    { label: 'Career Titles', homeVal: `${homeTitles}`, awayVal: `${awayTitles}`, homeHighlight: homeTitles > awayTitles, awayHighlight: awayTitles > homeTitles },
    { label: '1st Serve (km/h)', homeVal: `${homeServe1st}`, awayVal: `${awayServe1st}`, homeHighlight: homeServe1st > awayServe1st, awayHighlight: awayServe1st > homeServe1st },
    { label: '2nd Serve (km/h)', homeVal: `${homeServe2nd}`, awayVal: `${awayServe2nd}`, homeHighlight: homeServe2nd > awayServe2nd, awayHighlight: awayServe2nd > homeServe2nd },
  ];

  return (
    <View style={{ gap: 12 }}>
      <View style={lu.tennisHeaders}>
        {[{ team: homeTeam, rank: homeRank, color: C.accentBlue }, { team: awayTeam, rank: awayRank, color: C.accentRed }].map(({ team, rank, color }, idx) => (
          <React.Fragment key={team}>
            {idx === 1 ? <View style={lu.tennisVsCol}><Text style={[lu.tennisVs, { color: C.textMuted }]}>VS</Text></View> : null}
            <View style={lu.tennisPlayerCard}>
              <View style={[lu.tennisAvatar, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
                <Text style={[lu.tennisAvatarText, { color }]}>{team.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</Text>
              </View>
              <Text style={[lu.tennisPlayerName, { color }]} numberOfLines={2}>{team}</Text>
              <View style={lu.tennisRankBadge}>
                <Text style={[lu.tennisRankLabel, { color: C.textMuted }]}>Rank</Text>
                <Text style={[lu.tennisRankNum, { color }]}>#{rank}</Text>
              </View>
            </View>
          </React.Fragment>
        ))}
      </View>
      <View style={[lu.h2hCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Text style={[lu.h2hCardTitle, { color: C.textMuted }]}>Head to Head (Career)</Text>
        <View style={lu.h2hNums}>
          <Text style={[lu.h2hNumBig, { color: C.accentBlue }]}>{homeH2HWins}</Text>
          <View style={lu.h2hCenter}><Text style={[lu.h2hDash, { color: C.textMuted }]}>—</Text><Text style={[lu.h2hTotal, { color: C.textMuted }]}>{totalH2H} matches</Text></View>
          <Text style={[lu.h2hNumBig, { color: C.accentRed }]}>{awayH2HWins}</Text>
        </View>
        <View style={lu.h2hBarWrap}>
          <View style={[lu.h2hBarHome, { flex: Math.max(0.05, h2hFrac), backgroundColor: C.accentBlue }]} />
          <View style={[lu.h2hBarAway, { flex: Math.max(0.05, 1 - h2hFrac), backgroundColor: C.accentRed }]} />
        </View>
        <View style={lu.h2hLegendRow}>
          <Text style={[lu.h2hLegendTxt, { color: C.accentBlue }]}>{homeTeam.split(' ').slice(-1)[0]} wins</Text>
          <Text style={[lu.h2hLegendTxt, { color: C.accentRed, textAlign: 'right' }]}>{awayTeam.split(' ').slice(-1)[0]} wins</Text>
        </View>
      </View>
      <View style={[lu.tennisStatsCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Text style={[lu.tennisStatsTitle, { color: C.textMuted, borderBottomColor: C.border }]}>Player Statistics</Text>
        {stats.map((row, i) => (
          <View key={i} style={[lu.tennisStatRow, { borderBottomColor: C.border }]}>
            <Text style={[lu.tennisStatVal, { color: row.homeHighlight ? C.accentBlue : C.textSecondary, fontWeight: row.homeHighlight ? FONTS.bold : FONTS.regular }]}>{row.homeVal}</Text>
            <Text style={[lu.tennisStatLabel, { color: C.textMuted }]}>{row.label}</Text>
            <Text style={[lu.tennisStatVal, { color: row.awayHighlight ? C.accentRed : C.textSecondary, textAlign: 'right', fontWeight: row.awayHighlight ? FONTS.bold : FONTS.regular }]}>{row.awayVal}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Rugby XV Position Data ──────────────────────────────────────────────────
const RUGBY_XV = [
  { number: 1,  abbr: 'LP', full: 'Loosehead Prop' },
  { number: 2,  abbr: 'HK', full: 'Hooker' },
  { number: 3,  abbr: 'TP', full: 'Tighthead Prop' },
  { number: 4,  abbr: 'LK', full: 'Lock' },
  { number: 5,  abbr: 'LK', full: 'Lock' },
  { number: 6,  abbr: 'BF', full: 'Blindside Flanker' },
  { number: 7,  abbr: 'OF', full: 'Openside Flanker' },
  { number: 8,  abbr: 'N8', full: 'No.8' },
  { number: 9,  abbr: 'SH', full: 'Scrum-half' },
  { number: 10, abbr: 'FH', full: 'Fly-half' },
  { number: 11, abbr: 'LW', full: 'Left Wing' },
  { number: 12, abbr: 'IC', full: 'Inside Centre' },
  { number: 13, abbr: 'OC', full: 'Outside Centre' },
  { number: 14, abbr: 'RW', full: 'Right Wing' },
  { number: 15, abbr: 'FB', full: 'Fullback' },
];

const RGY_HOME_NAMES = ['Marler','George','Sinckler','Hill','Launchbury','Curry','Underhill','Faletau','Care','Farrell','May','Slade','Tuilagi','Nowell','Daly'];
const RGY_AWAY_NAMES = ['Bamba','Mauvaka','Atonio','Taofifenua','Flament','Jelonch','Woki','Ollivon','Lucu','Jalibert','Penaud','Fickou','Danty','Villiere','Dulin'];

// ─── MMA Fighter seed helper ────────────────────────────────────────────────────────
const MMA_STANCES = ['Orthodox', 'Southpaw', 'Switch'];
function seedMMAFighter(s: number) {
  const a = Math.abs(s);
  const wins = 10 + (a * 7 % 25); const losses = 1 + (a * 3 % 8); const draws = a % 3; const nc = a % 2;
  const koPct = 30 + (a * 11 % 35); const subPct = 15 + (a * 13 % 20); const decPct = Math.max(0, 100 - koPct - subPct);
  return { wins, losses, draws, nc, koPct, subPct, decPct, reach: 168 + (a * 5 % 30), age: 24 + (a % 14), stance: MMA_STANCES[a % 3], strikeAcc: 42 + (a * 17 % 24), tdDef: 55 + (a * 19 % 35), tdAcc: 35 + (a * 23 % 30), sigStr: +(4.2 + (a % 30) / 10).toFixed(1) };
}

const RGY_POS_COLORS: Record<string, string> = {
  LP: '#38BDF8', HK: '#F59E0B', TP: '#38BDF8',
  LK: '#A78BFA', BF: '#34D399', OF: '#34D399',
  N8: '#F87171', SH: '#FB923C', FH: '#FBBF24',
  LW: '#60A5FA', IC: '#22C55E', OC: '#22C55E',
  RW: '#60A5FA', FB: '#E879F9',
};

function RugbyLineups({ homeTeam, awayTeam, seed, C }: { homeTeam: string; awayTeam: string; seed: number; C: AppColors }) {
  const buildPlayers = (names: string[]) =>
    RUGBY_XV.map((pos, i) => ({ ...pos, name: names[(seed + i) % names.length] }));

  const homePlayers = buildPlayers(RGY_HOME_NAMES);
  const awayPlayers = buildPlayers(RGY_AWAY_NAMES);

  const renderTeam = (players: typeof homePlayers, teamName: string, color: string) => (
    <View style={rgl.column}>
      <View style={rgl.columnHeader}>
        <View style={[rgl.colorBar, { backgroundColor: color }]} />
        <Text style={[rgl.teamName, { color }]} numberOfLines={1}>{teamName}</Text>
        <View style={[rgl.xvBadge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
          <Text style={[rgl.xvBadgeText, { color }]}>XV</Text>
        </View>
      </View>
      {players.map((p) => {
        const posColor = RGY_POS_COLORS[p.abbr] ?? color;
        return (
          <View key={p.number} style={[rgl.playerRow, { backgroundColor: C.surface, borderColor: C.border }]}>
            <View style={[rgl.jersey, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
              <Text style={[rgl.jerseyNum, { color }]}>{p.number}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[rgl.playerName, { color: C.textPrimary }]} numberOfLines={1}>{p.name}</Text>
              <Text style={[rgl.posLabel, { color: C.textMuted }]} numberOfLines={1}>{p.full}</Text>
            </View>
            <View style={[rgl.posBadge, { backgroundColor: `${posColor}18`, borderColor: `${posColor}44` }]}>
              <Text style={[rgl.posAbbr, { color: posColor }]}>{p.abbr}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={rgl.wrap}>
      {renderTeam(homePlayers, homeTeam, C.accentBlue)}
      <View style={[rgl.divider, { backgroundColor: C.border }]} />
      {renderTeam(awayPlayers, awayTeam, C.accentRed)}
    </View>
  );
}

const rgl = StyleSheet.create({
  wrap: { gap: 12 },
  column: { gap: 6 },
  columnHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, marginBottom: 4 },
  colorBar: { width: 4, height: 16, borderRadius: 2 },
  teamName: { fontSize: 13, fontWeight: FONTS.bold, flex: 1 },
  xvBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  xvBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  playerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1 },
  jersey: { width: 34, height: 34, borderRadius: 7, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1 },
  jerseyNum: { fontSize: 12, fontWeight: FONTS.extraBold },
  playerName: { fontSize: 12, fontWeight: FONTS.semiBold },
  posLabel: { fontSize: 9, marginTop: 1, lineHeight: 13 },
  posBadge: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  posAbbr: { fontSize: 9, fontWeight: FONTS.extraBold },
  divider: { height: 1, marginVertical: 4 },
});

function LineupsTab({ match, C }: { match: MatchDetail; C: AppColors }) {
  const sport = match.sport?.toLowerCase();
  const seed = match.homeTeam.charCodeAt(0) * 11 + match.awayTeam.charCodeAt(0) * 7;

  // ─── Rugby XV ─────────────────────────────────────────────────────────────
  if (sport === 'rugby' || sport === 'rugby_union' || sport === 'rugby_league' || (sport ?? '').includes('rugby')) return (
    <View style={{ gap: 12 }}>
      <GlassCard style={{ gap: 10 }}>
        <View style={lu.tabHeader}>
          <Text style={{ fontSize: 16 }}>🏉</Text>
          <Text style={[lu.tabHeaderText, { color: C.textSecondary }]}>Starting XV</Text>
          <View style={[lu.tabHeaderBadge, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
            <Text style={[lu.tabHeaderBadgeText, { color: C.primary }]}>Predicted</Text>
          </View>
        </View>
        <RugbyLineups homeTeam={match.homeTeam} awayTeam={match.awayTeam} seed={seed} C={C} />
      </GlassCard>
      {/* Position key */}
      <View style={[rgl.wrap, { gap: 8 }]}>
        <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.6 }}>POSITION KEY</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[
            ['LP','Loosehead Prop'],['HK','Hooker'],['TP','Tighthead Prop'],
            ['LK','Lock'],['BF','Blindside FL'],['OF','Openside FL'],
            ['N8','No.8'],['SH','Scrum-half'],['FH','Fly-half'],
            ['IC','Inside Centre'],['OC','Outside Centre'],['LW/RW','Wing'],['FB','Fullback'],
          ].map(([abbr, full]) => (
            <View key={abbr} style={[lu.posLegendItem, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[lu.posLegendAbbr, { color: RGY_POS_COLORS[abbr] ?? C.primary }]}>{abbr}</Text>
              <Text style={[lu.posLegendFull, { color: C.textMuted }]}>{full}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={lu.noticeRow}>
        <Ionicons name="information-circle-outline" size={12} color={C.textMuted} />
        <Text style={[lu.noticeText, { color: C.textMuted }]}>Predicted XV based on recent squad data. Official lineup available closer to kick-off.</Text>
      </View>
    </View>
  );

  if (sport === 'basketball') return (
    <View style={{ gap: 12 }}>
      <GlassCard style={{ gap: 10 }}>
        <View style={lu.tabHeader}>
          <FontAwesome5 name="basketball-ball" size={13} color={C.primary} />
          <Text style={[lu.tabHeaderText, { color: C.textSecondary }]}>Starting 5</Text>
          <View style={[lu.tabHeaderBadge, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
            <Text style={[lu.tabHeaderBadgeText, { color: C.primary }]}>5v5</Text>
          </View>
        </View>
        <BasketballLineups homeTeam={match.homeTeam} awayTeam={match.awayTeam} seed={seed} C={C} />
      </GlassCard>
      <View style={lu.posLegend}>
        {[['PG','Point Guard'],['SG','Shooting Guard'],['SF','Small Forward'],['PF','Power Forward'],['C','Center']].map(([abbr, full]) => (
          <View key={abbr} style={[lu.posLegendItem, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[lu.posLegendAbbr, { color: C.primary }]}>{abbr}</Text>
            <Text style={[lu.posLegendFull, { color: C.textMuted }]}>{full}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  // ─── MMA / Boxing ─────────────────────────────────────────────────────────
  if (sport === 'mma' || sport === 'boxing' || sport === 'ufc') {
    const hd = seedMMAFighter(seed); const ad = seedMMAFighter(seed * 13 + 7);
    const FC = { KO: '#EF4444', Sub: '#A78BFA', Dec: '#38BDF8' };
    const finishBar = (kp: number, sp2: number, dp: number) => (
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
          <View style={{ flex: kp, backgroundColor: FC.KO, borderRadius: 4 }} />
          <View style={{ flex: sp2, backgroundColor: FC.Sub, borderRadius: 4 }} />
          <View style={{ flex: Math.max(0, dp), backgroundColor: FC.Dec, borderRadius: 4 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[['KO', kp, FC.KO], ['SUB', sp2, FC.Sub], ['DEC', Math.max(0, dp), FC.Dec]].map(([l, p, c]) => (
            <View key={l as string} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c as string }} />
              <Text style={{ fontSize: 9, color: c as string, fontWeight: FONTS.bold as any }}>{l} {p}%</Text>
            </View>
          ))}
        </View>
      </View>
    );
    const fCard = (d: ReturnType<typeof seedMMAFighter>, name: string, col: string) => (
      <View style={{ flex: 1, borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, gap: 9, alignItems: 'center' as const, borderColor: `${col}33`, backgroundColor: C.card }}>
        <View style={{ width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: `${col}55`, backgroundColor: `${col}18`, alignItems: 'center' as const, justifyContent: 'center' as const }}>
          <Text style={{ fontSize: 17, fontWeight: FONTS.extraBold as any, color: col }}>{name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: col, textAlign: 'center', lineHeight: 16 }} numberOfLines={2}>{name}</Text>
        <View style={{ borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${col}44`, backgroundColor: `${col}18`, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold as any, color: col }}>{d.wins}-{d.losses}-{d.draws}{d.nc > 0 ? ` (${d.nc}NC)` : ''}</Text>
        </View>
        {[['Age', `${d.age}`], ['Reach', `${d.reach}cm`], ['Stance', d.stance], ['Sig.Str/min', `${d.sigStr}`]].map(([lbl, val]) => (
          <View key={lbl} style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <Text style={{ fontSize: 10, color: C.textMuted }}>{lbl}</Text>
            <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: C.textSecondary }}>{val}</Text>
          </View>
        ))}
        <View style={{ width: '100%' }}>
          <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold as any, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>WIN BREAKDOWN</Text>
          {finishBar(d.koPct, d.subPct, d.decPct)}
        </View>
      </View>
    );
    const compRows = [
      { label: 'Striking Acc.', hv: hd.strikeAcc, av: ad.strikeAcc, suffix: '%' },
      { label: 'Takedown Def.', hv: hd.tdDef, av: ad.tdDef, suffix: '%' },
      { label: 'Takedown Acc.', hv: hd.tdAcc, av: ad.tdAcc, suffix: '%' },
      { label: 'Win Rate', hv: Math.round(hd.wins / Math.max(1, hd.wins + hd.losses) * 100), av: Math.round(ad.wins / Math.max(1, ad.wins + ad.losses) * 100), suffix: '%' },
    ];
    return (
      <View style={{ gap: 12 }}>
        <GlassCard style={{ gap: 10 }}>
          <View style={lu.tabHeader}>
            <Text style={{ fontSize: 14 }}>🥊</Text>
            <Text style={[lu.tabHeaderText, { color: C.textSecondary }]}>{sport === 'boxing' ? 'Boxing' : 'MMA'} Fighter Profiles</Text>
            <View style={[lu.tabHeaderBadge, { backgroundColor: `${C.accentRed}18`, borderColor: `${C.accentRed}44` }]}>
              <Text style={[lu.tabHeaderBadgeText, { color: C.accentRed }]}>TALE OF THE TAPE</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>{fCard(hd, match.homeTeam, C.accentBlue)}{fCard(ad, match.awayTeam, C.accentRed)}</View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
            <View style={{ borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${C.primary}44`, backgroundColor: C.primaryGlow, paddingHorizontal: 16, paddingVertical: 5 }}>
              <Text style={{ fontSize: 12, fontWeight: FONTS.extraBold as any, color: C.primary, letterSpacing: 2 }}>VS</Text>
            </View>
            <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
          </View>
          <View style={{ borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.border, padding: 12, gap: 10, backgroundColor: C.surface }}>
            <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold as any, color: C.textMuted, letterSpacing: 0.8, marginBottom: 2 }}>FIGHTER COMPARISON</Text>
            {compRows.map((row) => {
              const total = row.hv + row.av || 1; const hp2 = Math.round((row.hv / total) * 100); const ap2 = 100 - hp2;
              return (
                <View key={row.label} style={{ marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: row.hv >= row.av ? C.accentBlue : C.textMuted }}>{row.hv}{row.suffix}</Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>{row.label}</Text>
                    <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: row.av > row.hv ? C.accentRed : C.textMuted }}>{row.av}{row.suffix}</Text>
                  </View>
                  <View style={{ height: 8, borderRadius: 6, flexDirection: 'row', overflow: 'hidden', backgroundColor: C.card }}>
                    <View style={{ flex: hp2, backgroundColor: C.accentBlue, borderRadius: 6 }} />
                    <View style={{ width: 2, backgroundColor: C.bg }} />
                    <View style={{ flex: ap2, backgroundColor: C.accentRed, borderRadius: 6 }} />
                  </View>
                </View>
              );
            })}
          </View>
        </GlassCard>
        <View style={lu.noticeRow}>
          <Ionicons name="information-circle-outline" size={12} color={C.textMuted} />
          <Text style={[lu.noticeText, { color: C.textMuted }]}>Projected stats from historical fight data. Official weigh-in details released 24h before the event.</Text>
        </View>
      </View>
    );
  }

  if (sport === 'tennis') return (
    <View style={{ gap: 12 }}>
      <GlassCard style={{ gap: 10 }}>
        <View style={lu.tabHeader}>
          <Ionicons name="trophy-outline" size={13} color={C.primary} />
          <Text style={[lu.tabHeaderText, { color: C.textSecondary }]}>Player Profiles</Text>
        </View>
        <TennisLineups homeTeam={match.homeTeam} awayTeam={match.awayTeam} seed={seed} C={C} />
      </GlassCard>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <GlassCard style={{ gap: 10 }}>
        <View style={lu.tabHeader}>
          <Ionicons name="football-outline" size={13} color={C.primary} />
          <Text style={[lu.tabHeaderText, { color: C.textSecondary }]}>Starting XI — 4-3-3</Text>
          <View style={[lu.tabHeaderBadge, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
            <Text style={[lu.tabHeaderBadgeText, { color: C.primary }]}>Predicted</Text>
          </View>
        </View>
        <FootballPitch homeTeam={match.homeTeam} awayTeam={match.awayTeam} seed={seed} C={C} />
      </GlassCard>
      <View style={lu.noticeRow}>
        <Ionicons name="information-circle-outline" size={12} color={C.textMuted} />
        <Text style={[lu.noticeText, { color: C.textMuted }]}>Predicted lineup based on recent squad data. Official lineup available 1 hour before kick-off.</Text>
      </View>
    </View>
  );
}

const lu = StyleSheet.create({
  tabHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tabHeaderText: { fontSize: 14, fontWeight: FONTS.bold, flex: 1 },
  tabHeaderBadge: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  tabHeaderBadgeText: { fontSize: 9, fontWeight: FONTS.bold },
  pitchWrap: { alignItems: 'center', gap: 10 },
  pitchLegend: { flexDirection: 'row', gap: 20, alignItems: 'center', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontWeight: FONTS.semiBold },
  bblWrap: { gap: 12 },
  bblHalf: { gap: 8 },
  bblHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bblColorBar: { width: 4, height: 16, borderRadius: 2 },
  bblTeamName: { fontSize: 13, fontWeight: FONTS.bold },
  bblPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  bblJersey: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  bblJerseyNum: { fontSize: 12, fontWeight: FONTS.extraBold },
  bblPlayerName: { flex: 1, fontSize: 13, fontWeight: FONTS.medium },
  bblPosBadge: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  bblPosText: { fontSize: 10, fontWeight: FONTS.extraBold },
  bblDivider: { height: 1, marginVertical: 4 },
  posLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 },
  posLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1 },
  posLegendAbbr: { fontSize: 11, fontWeight: FONTS.bold },
  posLegendFull: { fontSize: 10 },
  tennisHeaders: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tennisPlayerCard: { flex: 1, alignItems: 'center', gap: 8 },
  tennisVsCol: { paddingTop: 24, alignItems: 'center', justifyContent: 'center', width: 32 },
  tennisVs: { fontSize: 12, fontWeight: FONTS.extraBold },
  tennisAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  tennisAvatarText: { fontSize: 18, fontWeight: FONTS.extraBold },
  tennisPlayerName: { fontSize: 12, fontWeight: FONTS.bold, textAlign: 'center', lineHeight: 16 },
  tennisRankBadge: { alignItems: 'center' },
  tennisRankLabel: { fontSize: 9, fontWeight: FONTS.medium },
  tennisRankNum: { fontSize: 16, fontWeight: FONTS.extraBold },
  h2hCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 10 },
  h2hCardTitle: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 0.5, textAlign: 'center' },
  h2hNums: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h2hNumBig: { fontSize: 36, fontWeight: FONTS.extraBold },
  h2hCenter: { alignItems: 'center', gap: 2 },
  h2hDash: { fontSize: 20, fontWeight: FONTS.medium },
  h2hTotal: { fontSize: 10 },
  h2hBarWrap: { flexDirection: 'row', height: 8, borderRadius: RADIUS.full, overflow: 'hidden', gap: 2 },
  h2hBarHome: { borderRadius: RADIUS.full },
  h2hBarAway: { borderRadius: RADIUS.full },
  h2hLegendRow: { flexDirection: 'row', justifyContent: 'space-between' },
  h2hLegendTxt: { fontSize: 10, fontWeight: FONTS.semiBold },
  tennisStatsCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  tennisStatsTitle: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 0.5, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  tennisStatRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
  tennisStatVal: { flex: 1, fontSize: 14 },
  tennisStatLabel: { flex: 1.4, fontSize: 10, textAlign: 'center', fontWeight: FONTS.semiBold },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },
});

// ─── Styles (layout only — colours injected inline) ───────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  navHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },

  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backRow: { paddingHorizontal: SPACING.md, paddingVertical: 12 },
  navCenter: { flex: 1 },
  navLeague: { fontSize: 13, fontWeight: FONTS.medium, textAlign: 'center', flexShrink: 1, maxWidth: 180 },

  navRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  hero: { paddingTop: SPACING.lg, paddingBottom: SPACING.md, paddingHorizontal: SPACING.md, alignItems: 'center' },
  teamsRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 8 },
  teamSide: { flex: 1, alignItems: 'center', gap: 8 },
  teamCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  teamLogo: { width: 44, height: 44 },
  teamAbbr: { fontSize: 16, fontWeight: FONTS.bold },
  navLeagueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  navLeagueLogo: { width: 18, height: 18, borderRadius: 3 },
  sportEmojiSmall: { fontSize: 13 },
  teamName: { fontSize: 13, fontWeight: FONTS.bold, textAlign: 'center' },
  teamRole: { fontSize: 11 },
  scoreCenter: { alignItems: 'center', paddingHorizontal: 12 },
  vsLabel: { fontSize: 22, fontWeight: FONTS.bold, textAlign: 'center' },
  matchDateText: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  scoreBlock: { alignItems: 'center' },
  bigScore: { fontSize: 36, fontWeight: FONTS.extraBold },
  minuteText: { fontSize: 13, fontWeight: FONTS.bold, marginTop: 4 },
  ftText: { fontSize: 12, marginTop: 4 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  venue: { fontSize: 12 },
  tabsScroll: { flexDirection: 'row' as const },
  tabsRowWrapper: { borderBottomWidth: StyleSheet.hairlineWidth, maxHeight: 48 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 8, position: 'relative', minWidth: 64, height: 48, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabLabel: { fontSize: 12, fontWeight: FONTS.medium, textAlign: 'center' },
  tabDot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  content: { padding: SPACING.md, gap: 12 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  errorText: { fontSize: 16 },
  loadingText: { marginTop: 12, fontSize: 13 },
  generateCard: { alignItems: 'center', gap: 16, paddingVertical: 28 },
  generateIconRow: { alignItems: 'center' },
  generateIconBg: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  generateTitle: { fontSize: 18, fontWeight: FONTS.bold },
  generateSubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md, padding: 12, borderWidth: 1, width: '100%' },
  errorBoxText: { flex: 1, fontSize: 12, lineHeight: 18 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14, paddingHorizontal: 32, width: '100%' },
  generateBtnPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { fontSize: 15, fontWeight: FONTS.bold },
  unlockCard: { gap: 0, padding: 0, overflow: 'hidden', position: 'relative', minHeight: 260 },
  unlockPreview: { padding: 16, gap: 8, opacity: 0.35 },
  blurLine: { height: 9, borderRadius: RADIUS.full, marginBottom: 2 },
  blurFactorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  unlockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 24, paddingVertical: 20,
  },
  unlockIconWrap: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 2,
  },
  unlockTitle: { fontSize: 17, fontWeight: FONTS.bold, textAlign: 'center' },
  unlockSub: { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 4 },
  coinBalanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1,
  },
  coinBalanceText: { fontSize: 13 },
  coinBalanceAmount: { fontSize: 14, fontWeight: FONTS.extraBold },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 9, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: 28, width: '100%',
  },
  unlockBtnText: { fontSize: 15, fontWeight: FONTS.extraBold, color: '#070B14' },
  unlockOrText: { fontSize: 12 },
  unlockVipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  unlockVipText: { fontSize: 13, fontWeight: FONTS.semiBold },
  confCard: { gap: 14 },
  confRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  confTitle: { fontSize: 15, fontWeight: FONTS.bold },
  confSubtitle: { fontSize: 11, marginTop: 2 },
  confCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  confPct: { fontSize: 16, fontWeight: FONTS.extraBold },
  predChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  predChip: { flex: 1, minWidth: '30%', borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  predChipLabel: { fontSize: 10, fontWeight: FONTS.medium },
  predChipValue: { fontSize: 13, fontWeight: FONTS.bold, marginTop: 2 },
  regenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: RADIUS.full, paddingVertical: 12 },
  regenBtnPressed: { opacity: 0.8 },
  regenText: { fontSize: 14, fontWeight: FONTS.semiBold },
  sectionTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: 4 },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  analysisTitle: { fontSize: 14, fontWeight: FONTS.bold },
  analysisText: { fontSize: 13, lineHeight: 20 },
  factorsTitle: { fontSize: 13, fontWeight: FONTS.bold },
  factorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factorDot: { width: 5, height: 5, borderRadius: 3 },
  factorText: { fontSize: 13, flex: 1 },
  vipTip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, padding: 12, borderWidth: 1, flexWrap: 'wrap' },
  vipTipLabel: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  vipTipText: { fontSize: 13, fontWeight: FONTS.medium, flex: 1 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formTeam: { flex: 1, fontSize: 13, fontWeight: FONTS.medium },
  formDots: { flexDirection: 'row', gap: 4 },
  formDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  formLetter: { fontSize: 11, fontWeight: FONTS.bold },
  h2hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h2hDate: { fontSize: 10, width: 55 },
  h2hTeam: { flex: 1, fontSize: 12, textAlign: 'right' },
  h2hTeamRight: { textAlign: 'left' },
  h2hScore: { borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4 },
  h2hScoreText: { fontSize: 12, fontWeight: FONTS.bold },
  oddsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  oddsBtn: { flex: 1, minWidth: '30%', alignItems: 'center', borderRadius: RADIUS.md, padding: 12, borderWidth: 1, gap: 3 },
  oddsBtnLabel: { fontSize: 10, fontWeight: FONTS.medium },
  oddsBtnTeam: { fontSize: 11, fontWeight: FONTS.medium },
  oddsBtnOdds: { fontSize: 16, fontWeight: FONTS.extraBold },
});

const chatStyles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13 },
  roomHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 10, borderBottomWidth: 1 },
  roomName: { flex: 1, fontSize: 12, fontWeight: FONTS.medium },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveLabel: { fontSize: 11, fontWeight: FONTS.bold },
  messageList: { paddingVertical: SPACING.sm, paddingBottom: SPACING.md },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.bold },
  emptySubtitle: { fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 10, borderTopWidth: 1 },
  input: { flex: 1, height: 44, borderRadius: RADIUS.full, paddingHorizontal: 16, fontSize: 14, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendBtnPressed: { opacity: 0.85, transform: [{ scale: 0.94 }] },
  loginPrompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderTopWidth: 1 },
  loginText: { fontSize: 13 },
});
