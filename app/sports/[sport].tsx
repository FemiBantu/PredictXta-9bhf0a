
/**
 * app/sports/[sport].tsx
 *
 * Dynamic Sport Page — /sports/football, /sports/basketball, /sports/mma, etc.
 *
 * MMA/Boxing get specialized UFC fight card layout (MmaFightCard component)
 * with event grouping, weight class badges, title fight highlights, fighter records.
 * All other sports use the standard MatchCard.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, Animated, Easing,
  Dimensions, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { getSupabaseClient } from '@/template';
import unifiedService from '@/services/unifiedSportsDataService';
import { getSportDef, getSportDisplayName, getSportAccentColor, getSportEmoji, isFightSport } from '@/services/sportsRegistry';
import { COLORS, FONTS, RADIUS, SPACING, getSportIcon, normalizeSportName, SPORT_API_KEY } from '@/constants/theme';
import { getPredChipConfig } from '@/services/sportConfig';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import MatchCard from '@/components/feature/MatchCard';
import MmaFightCard from '@/components/feature/MmaFightCard';
import type { MmaFight } from '@/components/feature/MmaFightCard';
import type { Match } from '@/services/types';
import { DisclaimerBanner } from '@/components/ui/DisclaimerBanner';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Type definitions ─────────────────────────────────────────────────────────
type TabKey = 'live' | 'upcoming' | 'results' | 'predictions' | 'standings' | 'news';

interface NewsArticle {
  id: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string | null;
  league: string | null;
  publishedAt: string;
}

interface Standing {
  position: number;
  teamName: string;
  teamLogo: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalDiff: number;
  points: number;
  form: string | null;
  description: string | null;
  leagueName: string;
}

interface Prediction {
  id: string;
  matchId: string;
  predictedResult: string;
  confidence: number;
  overUnder: string;
  overUnderLine: number;
  btts: string;
  aiAnalysis: string | null;
  riskLevel: string | null;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  status: string;
}

// ─── Sport-specific accent colors ────────────────────────────────────────────
const SPORT_ACCENTS: Record<string, string> = {
  football: '#6EDC1F',
  basketball: '#F97316',
  tennis: '#FBBF24',
  baseball: '#C084FC',
  hockey: '#38BDF8',
  rugby: '#34D399',
  handball: '#FB923C',
  volleyball: '#60A5FA',
  'american-football': '#F87171',
  cricket: '#A78BFA',
  mma: '#F43F5E',
  formula1: '#E11D48',
  afl: '#00B140',
  default: '#6EDC1F',
};

function getSportAccent(sportKey: string): string {
  return SPORT_ACCENTS[sportKey] ?? SPORT_ACCENTS.default;
}

// ─── DB row → MmaFight mapper ─────────────────────────────────────────────────
function rowToMmaFight(r: Record<string, unknown>): MmaFight {
  return {
    id: r.id as string,
    homeTeam: r.home_team as string,
    awayTeam: r.away_team as string,
    homeLogo: (r.home_logo as string) ?? null,
    awayLogo: (r.away_logo as string) ?? null,
    homeScore: Number(r.home_score ?? 0),
    awayScore: Number(r.away_score ?? 0),
    status: (r.status as MmaFight['status']) ?? 'upcoming',
    matchTime: r.match_time as string,
    league: (r.league as string) ?? 'MMA',
    minute: Number(r.minute ?? 0),
    stats: (r.stats as MmaFight['stats']) ?? null,
  };
}

// ─── DB row → Match mapper ────────────────────────────────────────────────────
function rowToMatch(r: Record<string, unknown>): Match {
  return {
    id: r.id as string,
    sport: (r.sport as string) ?? 'football',
    homeTeam: r.home_team as string,
    awayTeam: r.away_team as string,
    homeScore: Number(r.home_score ?? 0),
    awayScore: Number(r.away_score ?? 0),
    status: (r.status as Match['status']) ?? 'upcoming',
    matchTime: r.match_time as string,
    league: (r.league as string) ?? '',
    homeLogo: (r.home_logo as string) ?? undefined,
    awayLogo: (r.away_logo as string) ?? undefined,
    venue: (r.venue as string) ?? undefined,
    minute: Number(r.minute ?? 0),
  };
}

// ─── Skeleton block ───────────────────────────────────────────────────────────
function SkeletonBox({ w, h, r = 8, style }: { w: number | string; h: number; r?: number; style?: any }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    a.start();
    return () => a.stop();
  }, []);
  return (
    <Animated.View
      style={[{ width: w as any, height: h, borderRadius: r, backgroundColor: 'rgba(255,255,255,0.07)', opacity: pulse }, style]}
    />
  );
}

function SportPageSkeleton() {
  return (
    <View style={{ gap: 12, paddingHorizontal: SPACING.md, paddingTop: 12 }}>
      <SkeletonBox w="100%" h={160} r={RADIUS.xl} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4, 5].map((i) => <SkeletonBox key={i} w={72} h={34} r={RADIUS.full} />)}
      </View>
      {[1, 2, 3].map((i) => <SkeletonBox key={i} w="100%" h={90} r={RADIUS.lg} />)}
    </View>
  );
}

// ─── Stats Card (header metrics) ─────────────────────────────────────────────
function MetricCell({ value, label, color, C }: { value: string; label: string; color: string; C: AppColors }) {
  return (
    <View style={met.cell}>
      <Text style={[met.val, { color }]}>{value}</Text>
      <Text style={[met.lbl, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}
const met = StyleSheet.create({
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  val: { fontSize: 22, fontWeight: FONTS.extraBold, lineHeight: 26 },
  lbl: { fontSize: 9, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
});

// ─── Tab bar ──────────────────────────────────────────────────────────────────
const TAB_CONFIG: { key: TabKey; label: string; icon: string }[] = [
  { key: 'live', label: 'Live', icon: 'radio-outline' },
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar-outline' },
  { key: 'results', label: 'Results', icon: 'checkmark-circle-outline' },
  { key: 'predictions', label: 'AI Picks', icon: 'brain' },
  { key: 'standings', label: 'Rankings', icon: 'podium-outline' },
  { key: 'news', label: 'News', icon: 'newspaper-outline' },
];

function TabBar({ active, onChange, accentColor, C }: {
  active: TabKey; onChange: (t: TabKey) => void; accentColor: string; C: AppColors;
}) {
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const idx = TAB_CONFIG.findIndex((t) => t.key === active);
    scrollRef.current?.scrollTo({ x: Math.max(0, idx * 84 - 40), animated: true });
  }, [active]);
  return (
    <View style={[tb.wrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={tb.scroll}>
        {TAB_CONFIG.map((t) => {
          const isSel = t.key === active;
          return (
            <Pressable
              key={t.key}
              style={({ pressed }) => [
                tb.tab,
                isSel ? { borderBottomColor: accentColor } : { borderBottomColor: 'transparent' },
                pressed ? { opacity: 0.7 } : null,
              ]}
              onPress={() => onChange(t.key)}
              accessibilityLabel={t.label}
              accessibilityRole="tab"
            >
              {t.key === 'predictions'
                ? <FontAwesome5 name={t.icon as any} size={13} color={isSel ? accentColor : C.textMuted} />
                : <Ionicons name={t.icon as any} size={14} color={isSel ? accentColor : C.textMuted} />
              }
              <Text style={[tb.label, { color: isSel ? accentColor : C.textMuted }, isSel ? tb.labelActive : null]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
const tb = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  scroll: { flexDirection: 'row', paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2,
    minWidth: 72, justifyContent: 'center',
  },
  label: { fontSize: 12, fontWeight: FONTS.semiBold },
  labelActive: { fontWeight: FONTS.bold },
});

// ─── Live badge ────────────────────────────────────────────────────────────────
function LivePulseBadge({ count, accentColor }: { count: number; accentColor: string }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    a.start(); return () => a.stop();
  }, []);
  return (
    <View style={[liveBadge.wrap, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}44` }]}>
      <Animated.View style={[liveBadge.dot, { backgroundColor: accentColor, opacity: op }]} />
      <Text style={[liveBadge.text, { color: accentColor }]}>LIVE</Text>
      {count > 0 ? (
        <View style={[liveBadge.count, { backgroundColor: accentColor }]}>
          <Text style={liveBadge.countText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </View>
  );
}
const liveBadge = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  count: { borderRadius: 999, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#000' },
});

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, count, accentColor, C }: { title: string; count?: number; accentColor: string; C: AppColors }) {
  return (
    <View style={sec.row}>
      <Text style={[sec.title, { color: C.textPrimary }]}>{title}</Text>
      {count !== undefined ? (
        <View style={[sec.badge, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}33` }]}>
          <Text style={[sec.badgeText, { color: accentColor }]}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}
const sec = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: FONTS.extraBold },
});

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ emoji, title, subtitle, accentColor }: { emoji: string; title: string; subtitle: string; accentColor: string }) {
  const { colors: C } = useTheme();
  return (
    <View style={[empty.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[empty.iconWrap, { backgroundColor: `${accentColor}12`, borderColor: `${accentColor}22` }]}>
        <Text style={empty.emoji}>{emoji}</Text>
      </View>
      <Text style={[empty.title, { color: C.textSecondary }]}>{title}</Text>
      <Text style={[empty.sub, { color: C.textMuted }]}>{subtitle}</Text>
    </View>
  );
}
const empty = StyleSheet.create({
  wrap: { alignItems: 'center', borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 32, paddingHorizontal: SPACING.lg, gap: 10, marginHorizontal: SPACING.md },
  iconWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emoji: { fontSize: 32 },
  title: { fontSize: 17, fontWeight: FONTS.bold, textAlign: 'center' },
  sub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

// ─── News card ─────────────────────────────────────────────────────────────────
function NewsCard({ article, accentColor, C }: { article: NewsArticle; accentColor: string; C: AppColors }) {
  const timeAgo = useMemo(() => {
    try {
      const diff = Math.floor((Date.now() - new Date(article.publishedAt).getTime()) / 60_000);
      if (diff < 60) return `${diff}m ago`;
      if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
      return `${Math.floor(diff / 1440)}d ago`;
    } catch { return ''; }
  }, [article.publishedAt]);
  return (
    <View style={[nc.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {article.imageUrl ? (
        <Image source={{ uri: article.imageUrl }} style={nc.thumb} contentFit="cover" transition={200} />
      ) : (
        <View style={[nc.thumbPlaceholder, { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}22` }]}>
          <Text style={{ fontSize: 22 }}>📰</Text>
        </View>
      )}
      <View style={nc.body}>
        {article.league ? (
          <View style={[nc.leaguePill, { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}30` }]}>
            <Text style={[nc.leagueText, { color: accentColor }]} numberOfLines={1}>{article.league}</Text>
          </View>
        ) : null}
        <Text style={[nc.title, { color: C.textPrimary }]} numberOfLines={2}>{article.title}</Text>
        {article.summary ? (
          <Text style={[nc.summary, { color: C.textMuted }]} numberOfLines={2}>{article.summary}</Text>
        ) : null}
        <Text style={[nc.time, { color: C.textMuted }]}>{timeAgo}</Text>
      </View>
    </View>
  );
}
const nc = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: 10 },
  thumb: { width: 88, height: 88 },
  thumbPlaceholder: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1 },
  body: { flex: 1, padding: 10, gap: 4 },
  leaguePill: { alignSelf: 'flex-start', borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 2 },
  leagueText: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  title: { fontSize: 13, fontWeight: FONTS.bold, lineHeight: 18 },
  summary: { fontSize: 11, lineHeight: 16 },
  time: { fontSize: 10, marginTop: 2 },
});

// ─── Prediction row card ──────────────────────────────────────────────────────
function PredictionCard({ pred, accentColor, C, onPress, sportKey }: {
  pred: Prediction; accentColor: string; C: AppColors; onPress: () => void; sportKey: string;
}) {
  const confColor = pred.confidence >= 80 ? '#22C55E' : pred.confidence >= 65 ? '#F59E0B' : C.textMuted;
  const resultLabel = pred.predictedResult === 'home_win' ? '1 HOME WIN'
    : pred.predictedResult === 'draw' ? 'X DRAW' : '2 AWAY WIN';
  // Sport-aware chip visibility — BTTS only for football, handball, rugby
  const chipCfg = getPredChipConfig(sportKey);
  const showOverUnder = chipCfg.showOverUnder && !!pred.overUnder;
  const showBtts = chipCfg.showBTTS && !!pred.btts;
  return (
    <Pressable
      style={({ pressed }) => [pc.wrap, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.85, transform: [{ scale: 0.985 }] } : null]}
      onPress={onPress}
      accessibilityLabel={`Prediction: ${pred.homeTeam} vs ${pred.awayTeam}`}
    >
      <View style={[pc.stripe, { backgroundColor: accentColor }]} />
      <View style={pc.body}>
        <View style={pc.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={[pc.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>
              {pred.homeTeam} vs {pred.awayTeam}
            </Text>
            <Text style={[pc.league, { color: C.textMuted }]} numberOfLines={1}>{pred.league}</Text>
          </View>
          <View style={[pc.confBadge, { backgroundColor: `${confColor}14`, borderColor: `${confColor}33` }]}>
            <Text style={[pc.confVal, { color: confColor }]}>{pred.confidence}%</Text>
          </View>
        </View>
        <View style={pc.chips}>
          <View style={[pc.chip, { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}30` }]}>
            <FontAwesome5 name="brain" size={9} color={accentColor} />
            <Text style={[pc.chipText, { color: accentColor }]}>{resultLabel}</Text>
          </View>
          {showOverUnder ? (
            <View style={[pc.chip, {
              backgroundColor: pred.overUnder === 'over' ? '#22C55E18' : '#EF444418',
              borderColor: pred.overUnder === 'over' ? '#22C55E33' : '#EF444433',
            }]}>
              <Text style={[pc.chipText, { color: pred.overUnder === 'over' ? '#22C55E' : '#EF4444' }]}>
                {pred.overUnder?.toUpperCase()} {pred.overUnderLine ?? 2.5}
              </Text>
            </View>
          ) : null}
          {showBtts ? (
            <View style={[pc.chip, {
              backgroundColor: pred.btts === 'yes' ? '#14B8A618' : '#F9731618',
              borderColor: pred.btts === 'yes' ? '#14B8A633' : '#F9731633',
            }]}>
              <Text style={[pc.chipText, { color: pred.btts === 'yes' ? '#14B8A6' : '#F97316' }]}>
                BTTS {pred.btts?.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={pc.chevron} />
      </View>
    </Pressable>
  );
}
const pc = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: 10 },
  stripe: { width: 4 },
  body: { flex: 1, padding: 12, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  matchLabel: { fontSize: 13, fontWeight: FONTS.bold, lineHeight: 18 },
  league: { fontSize: 11 },
  confBadge: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  confVal: { fontSize: 14, fontWeight: FONTS.extraBold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: FONTS.bold },
  chevron: { position: 'absolute', right: 10, top: 12 },
});

// ─── Standings row ─────────────────────────────────────────────────────────────
function StandingRow({ standing, index, accentColor, C }: { standing: Standing; index: number; accentColor: string; C: AppColors }) {
  const FORM_COLORS: Record<string, string> = { W: '#22C55E', D: '#F59E0B', L: '#EF4444' };
  const descColor = standing.description?.toLowerCase().includes('champion') ? '#F59E0B'
    : standing.description?.toLowerCase().includes('relegat') ? '#EF4444'
      : standing.description?.toLowerCase().includes('europa') ? '#F97316'
        : null;
  return (
    <View style={[sr.row, { backgroundColor: index % 2 === 0 ? C.surface : C.card, borderBottomColor: C.border }]}>
      <View style={[sr.posBadge, descColor ? { backgroundColor: `${descColor}20` } : {}]}>
        <Text style={[sr.pos, { color: descColor ?? C.textMuted }]}>{standing.position}</Text>
      </View>
      {standing.teamLogo ? (
        <Image source={{ uri: standing.teamLogo }} style={sr.logo} contentFit="contain" />
      ) : (
        <View style={[sr.logoPlaceholder, { backgroundColor: `${accentColor}14` }]}>
          <Text style={{ fontSize: 10, color: accentColor, fontWeight: FONTS.extraBold }}>
            {standing.teamName.slice(0, 2).toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={[sr.teamName, { color: C.textPrimary }]} numberOfLines={1}>{standing.teamName}</Text>
      <View style={sr.stats}>
        <Text style={[sr.stat, { color: C.textMuted }]}>{standing.played}</Text>
        <Text style={[sr.stat, { color: '#22C55E' }]}>{standing.wins}</Text>
        <Text style={[sr.stat, { color: C.textMuted }]}>{standing.draws}</Text>
        <Text style={[sr.stat, { color: '#EF4444' }]}>{standing.losses}</Text>
        <Text style={[sr.stat, { color: standing.goalDiff > 0 ? '#22C55E' : standing.goalDiff < 0 ? '#EF4444' : C.textMuted }]}>
          {standing.goalDiff > 0 ? '+' : ''}{standing.goalDiff}
        </Text>
        <Text style={[sr.pts, { color: accentColor }]}>{standing.points}</Text>
      </View>
      {standing.form ? (
        <View style={sr.formRow}>
          {standing.form.split('').slice(-5).map((c, i) => (
            <View key={i} style={[sr.formDot, { backgroundColor: FORM_COLORS[c] ?? C.border }]}>
              <Text style={sr.formLetter}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, gap: 8 },
  posBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pos: { fontSize: 11, fontWeight: FONTS.extraBold, minWidth: 16, textAlign: 'center' },
  logo: { width: 22, height: 22, borderRadius: 4, flexShrink: 0 },
  logoPlaceholder: { width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  teamName: { flex: 1, fontSize: 12, fontWeight: FONTS.semiBold },
  stats: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  stat: { fontSize: 11, fontWeight: FONTS.medium, minWidth: 18, textAlign: 'center' },
  pts: { fontSize: 13, fontWeight: FONTS.extraBold, minWidth: 22, textAlign: 'center' },
  formRow: { flexDirection: 'row', gap: 3 },
  formDot: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  formLetter: { fontSize: 7, fontWeight: FONTS.extraBold, color: '#fff' },
});

// ─── Main Sport Page ──────────────────────────────────────────────────────────
export default function SportPage() {
  const { sport: sportParam } = useLocalSearchParams<{ sport: string }>();
  const router = useRouter();
  const { colors: C } = useTheme();

  const sportKey = useMemo(() => {
    const raw = Array.isArray(sportParam) ? sportParam[0] : (sportParam ?? 'football');
    return raw.toLowerCase().replace(/\s+/g, '-');
  }, [sportParam]);

  const displayName = useMemo(() => normalizeSportName(sportKey), [sportKey]);
  const sportIcon = useMemo(() => getSportIcon(sportKey), [sportKey]);
  const accentColor = useMemo(() => getSportAccentColor(sportKey) ?? getSportAccent(sportKey), [sportKey]);

  // Fight sports get specialized MMA fight card layout
  const isMma = isFightSport(sportKey);
  const sportDef = getSportDef(sportKey);

  const [activeTab, setActiveTab] = useState<TabKey>('live');

  // ── Data state ──────────────────────────────────────────────────────────────
  // For MMA: raw DB rows preserved so MmaFightCard can read stats JSONB
  const [mmaRawRows, setMmaRawRows] = useState<Record<string, unknown>[]>([]);

  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<Match[]>([]);
  const [recentResults, setRecentResults] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [news, setNews] = useState<NewsArticle[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set());

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch matches ──────────────────────────────────────────────────────────
  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [live, upcoming, recent] = await Promise.all([
        unifiedService.getLiveFixtures(sportKey),
        unifiedService.getUpcomingFixtures(sportKey, isMma ? 30 : 7),
        unifiedService.getRecentResults(sportKey, 24),
      ]);

      const toMatch = (f: import('@/services/unifiedSportsDataService').UnifiedFixture): Match => ({
        id: f.id, sport: f.sport, homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        homeScore: f.homeScore, awayScore: f.awayScore, status: f.status,
        matchTime: f.matchTime, league: f.league,
        homeLogo: f.homeLogo ?? undefined, awayLogo: f.awayLogo ?? undefined,
        leagueLogo: f.leagueLogo ?? undefined, venue: f.venue ?? undefined,
        minute: f.minute, stats: (f.stats as any) ?? null,
      });

      if (isMma) {
        const supabase = getSupabaseClient();
        const ids = [...live, ...upcoming, ...recent].map(f => f.id);
        const { data: rawRows } = ids.length > 0
          ? await supabase.from('matches').select('*').in('id', ids)
          : { data: [] };
        setMmaRawRows((rawRows ?? []) as Record<string, unknown>[]);
      }
      setLiveMatches(live.map(toMatch));
      setUpcomingMatches(upcoming.map(toMatch));
      setRecentResults(recent.map(toMatch));
      setLoadedTabs((prev) => new Set([...prev, 'live', 'upcoming', 'results']));
    } catch { /* non-blocking */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [sportKey, isMma]);

  const fetchPredictions = useCallback(async () => {
    try {
      const preds = await unifiedService.getPredictions(undefined, sportKey, 40);
      const mapped: Prediction[] = preds.map((p) => ({
        id: p.id, matchId: p.matchId,
        predictedResult: p.predictedResult,
        confidence: p.confidence,
        overUnder: p.overUnder,
        overUnderLine: p.overUnderLine,
        btts: p.btts,
        aiAnalysis: p.aiAnalysis ?? null,
        riskLevel: p.riskLevel ?? null,
        homeTeam: p.homeTeam ?? '',
        awayTeam: p.awayTeam ?? '',
        league: p.league ?? '',
        matchTime: p.matchTime ?? new Date().toISOString(),
        status: p.matchStatus ?? 'upcoming',
      }));
      setPredictions(mapped);
      setLoadedTabs((prev) => new Set([...prev, 'predictions']));
    } catch { /* non-blocking */ }
  }, [sportKey]);

  const fetchStandings = useCallback(async () => {
    try {
      const rows = await unifiedService.getStandings(sportKey);
      const mapped: Standing[] = rows.map((r) => ({
        position: r.position, teamName: r.teamName, teamLogo: r.teamLogo,
        played: r.played, wins: r.wins, draws: r.draws, losses: r.losses,
        goalDiff: r.goalDiff, points: r.points, form: r.form,
        description: r.description, leagueName: r.leagueName,
      }));
      setStandings(mapped);
      setLoadedTabs((prev) => new Set([...prev, 'standings']));
    } catch { /* non-blocking */ }
  }, [sportKey]);

  const fetchNews = useCallback(async () => {
    try {
      const articles = await unifiedService.getSportNews(sportKey, 20);
      const mapped: NewsArticle[] = articles.map((a) => ({
        id: a.id, title: a.title, summary: a.summary,
        imageUrl: a.imageUrl, url: a.url, league: a.league, publishedAt: a.publishedAt,
      }));
      setNews(mapped);
      setLoadedTabs((prev) => new Set([...prev, 'news']));
    } catch { /* non-blocking */ }
  }, [sportKey]);

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setLoadedTabs(new Set());
    setLiveMatches([]); setUpcomingMatches([]); setRecentResults([]);
    setPredictions([]); setStandings([]); setNews([]); setMmaRawRows([]);

    fetchMatches();
    fetchPredictions();
    fetchStandings();
    fetchNews();

    pollerRef.current = setInterval(() => fetchMatches(true), 30_000);
    return () => { if (pollerRef.current) clearInterval(pollerRef.current); };
  }, [sportKey, fetchMatches, fetchPredictions, fetchStandings, fetchNews]); // Added dependencies

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([fetchMatches(true), fetchPredictions(), fetchStandings(), fetchNews()]);
    setRefreshing(false);
  }, [fetchMatches, fetchPredictions, fetchStandings, fetchNews]);

  // ── Hero animation ────────────────────────────────────────────────────────
  const heroOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(heroOpacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [heroOpacity]); // Added dependency

  // ── Grouped standings by league ──────────────────────────────────────────
  const standingsByLeague = useMemo(() => {
    const map = new Map<string, Standing[]>();
    for (const s of standings) {
      if (!map.has(s.leagueName)) map.set(s.leagueName, []);
      map.get(s.leagueName)!.push(s);
    }
    map.forEach((rows) => rows.sort((a, b) => a.position - b.position));
    return map;
  }, [standings]);

  // ── MMA fight grouping by event ─────────────────────────────────────────
  const mmaGrouped = useMemo(() => {
    if (!isMma) return null;

    const byStatus = (status: string) =>
      mmaRawRows.filter((r) => r.status === status) as Record<string, unknown>[];

    const groupByEvent = (rows: Record<string, unknown>[]) => {
      const map = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) {
        const evt = (r.league as string) || 'UFC Event';
        if (!map.has(evt)) map.set(evt, []);
        map.get(evt)!.push(r);
      }
      return map;
    };

    return {
      live: byStatus('live'),
      upcoming: groupByEvent(
        byStatus('upcoming').sort((a, b) =>
          new Date(a.match_time as string).getTime() - new Date(b.match_time as string).getTime()
        )
      ),
      finished: byStatus('finished'),
    };
  }, [mmaRawRows, isMma]);

  // ── Tab content renderer ─────────────────────────────────────────────────
  const renderTabContent = () => {
    const icon = sportIcon;

    switch (activeTab) {
      case 'live':
        if (loading) return <SportPageSkeleton />;
        if (liveMatches.length === 0) {
          return (
            <EmptyState
              emoji={icon}
              title={isMma ? 'No Live Fights Right Now' : `No Live ${displayName} Right Now`}
              subtitle={isMma ? 'UFC events run every 1-2 weeks. Check the Upcoming tab for the next event card.' : 'Check back soon or pull down to refresh. Live matches update every 30 seconds.'}
              accentColor={accentColor}
            />
          );
        }
        if (isMma && mmaGrouped) {
          return (
            <View style={tab.content}>
              <SectionHeader title="Live Fights" count={mmaGrouped.live.length} accentColor={accentColor} C={C} />
              {mmaGrouped.live.map((r) => (
                <MmaFightCard key={r.id as string} fight={rowToMmaFight(r)} accentColor={accentColor} />
              ))}
            </View>
          );
        }
        return (
          <View style={tab.content}>
            <SectionHeader title={`Live ${displayName}`} count={liveMatches.length} accentColor={accentColor} C={C} />
            {liveMatches.map((m) => <MatchCard key={m.id} match={m} />)}
          </View>
        );

      case 'upcoming':
        if (loading) return <SportPageSkeleton />;
        if (upcomingMatches.length === 0) {
          return (
            <EmptyState
              emoji={icon}
              title={isMma ? 'No Upcoming UFC Events' : `No Upcoming ${displayName} Fixtures`}
              subtitle={isMma ? 'No fights scheduled in the next 30 days.' : 'No matches scheduled in the next 48 hours. Check back soon.'}
              accentColor={accentColor}
            />
          );
        }
        if (isMma && mmaGrouped) {
          return (
            <View style={{ gap: 16 }}>
              {Array.from(mmaGrouped.upcoming.entries()).map(([evtName, fights]) => (
                <View key={evtName}>
                  {/* Event banner */}
                  <View style={[mmaEv.header, { backgroundColor: C.card, borderColor: `${accentColor}33` }]}>
                    <View style={[mmaEv.iconWrap, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}30` }]}>
                      <Text style={mmaEv.evtIcon}>🥊</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[mmaEv.evtName, { color: C.textPrimary }]}>{evtName}</Text>
                      <Text style={[mmaEv.evtDate, { color: C.textMuted }]}>
                        {new Date(fights[0].match_time as string).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        {' · '}{fights.length} fight{fights.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={[mmaEv.countBadge, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}33` }]}>
                      <Text style={[mmaEv.countText, { color: accentColor }]}>{fights.length}</Text>
                    </View>
                  </View>
                  {fights.map((r) => (
                    <MmaFightCard key={r.id as string} fight={rowToMmaFight(r)} accentColor={accentColor} />
                  ))}
                </View>
              ))}
            </View>
          );
        }
        return (
          <View style={tab.content}>
            <SectionHeader title="Upcoming Fixtures" count={upcomingMatches.length} accentColor={accentColor} C={C} />
            {upcomingMatches.slice(0, 20).map((m) => <MatchCard key={m.id} match={m} />)}
          </View>
        );

      case 'results':
        if (loading) return <SportPageSkeleton />;
        if (recentResults.length === 0) {
          return (
            <EmptyState
              emoji={icon}
              title="No Recent Results"
              subtitle={isMma ? 'No UFC/MMA events in the last 24 hours.' : 'No finished matches in the last 24 hours.'}
              accentColor={accentColor}
            />
          );
        }
        if (isMma && mmaGrouped) {
          return (
            <View style={tab.content}>
              <SectionHeader title="Recent Fight Results" count={mmaGrouped.finished.length} accentColor={accentColor} C={C} />
              {mmaGrouped.finished.map((r) => (
                <MmaFightCard key={r.id as string} fight={rowToMmaFight(r)} accentColor={accentColor} />
              ))}
            </View>
          );
        }
        return (
          <View style={tab.content}>
            <SectionHeader title="Recent Results" count={recentResults.length} accentColor={accentColor} C={C} />
            {recentResults.slice(0, 20).map((m) => <MatchCard key={m.id} match={m} />)}
          </View>
        );

      case 'predictions':
        if (!loadedTabs.has('predictions') && loading) return <SportPageSkeleton />;
        if (predictions.length === 0) {
          return (
            <View>
              <EmptyState
                emoji="🧠"
                title={isMma ? 'No MMA AI Picks' : `No ${displayName} AI Picks`}
                subtitle={isMma ? 'AI fight predictions will appear here once UFC events are scheduled.' : 'AI predictions will appear here once matches are scheduled. Check back before kick-off.'}
                accentColor={accentColor}
              />
              <View style={{ marginTop: 12 }}><DisclaimerBanner compact /></View>
            </View>
          );
        }
        return (
          <View style={{ paddingTop: 4 }}>
            <SectionHeader title="AI Predictions" count={predictions.length} accentColor={accentColor} C={C} />
            {predictions.slice(0, 20).map((pred) => (
              <PredictionCard
                key={pred.id}
                pred={pred}
                accentColor={accentColor}
                C={C}
                sportKey={sportKey}
                onPress={() => router.push({ pathname: '/ai-pick/[id]', params: { id: pred.matchId } } as any)}
              />
            ))}
            <View style={{ marginTop: 8 }}><DisclaimerBanner compact /></View>
          </View>
        );

      case 'standings':
        if (!loadedTabs.has('standings') && loading) return <SportPageSkeleton />;
        if (standingsByLeague.size === 0) {
          return (
            <EmptyState
              emoji="🏆"
              title={isMma ? 'No MMA Rankings' : `No ${displayName} Standings`}
              subtitle={isMma ? 'UFC pound-for-pound and divisional rankings coming soon.' : 'League table data is synced daily. Check back soon.'}
              accentColor={accentColor}
            />
          );
        }
        return (
          <View style={{ paddingTop: 4, gap: 16 }}>
            {Array.from(standingsByLeague.entries()).map(([leagueName, rows]) => (
              <View key={leagueName}>
                <View style={[stand.leagueHeader, { backgroundColor: C.card, borderColor: C.border }]}>
                  <Text style={[stand.leagueName, { color: C.textPrimary }]}>{leagueName}</Text>
                </View>
                <View style={[stand.colHeader, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
                  <Text style={[stand.col, { width: 22 }]}>#</Text>
                  <View style={{ width: 22 }} />
                  <Text style={[stand.col, { flex: 1 }]}>Team</Text>
                  <Text style={[stand.col, { minWidth: 18 }]}>P</Text>
                  <Text style={[stand.col, { minWidth: 18 }]}>W</Text>
                  <Text style={[stand.col, { minWidth: 18 }]}>D</Text>
                  <Text style={[stand.col, { minWidth: 18 }]}>L</Text>
                  <Text style={[stand.col, { minWidth: 22 }]}>GD</Text>
                  <Text style={[stand.col, { minWidth: 22, color: accentColor, fontWeight: FONTS.extraBold }]}>Pts</Text>
                  <View style={{ width: 62 + 5 }} />
                </View>
                {rows.map((s, i) => (
                  <StandingRow key={`${s.teamName}-${i}`} standing={s} index={i} accentColor={accentColor} C={C} />
                ))}
              </View>
            ))}
          </View>
        );

      case 'news':
        if (!loadedTabs.has('news') && loading) return <SportPageSkeleton />;
        if (news.length === 0) {
          return (
            <EmptyState
              emoji="📰"
              title={`No ${displayName} News`}
              subtitle="Latest news and highlights will appear here. Check back soon."
              accentColor={accentColor}
            />
          );
        }
        return (
          <View style={{ paddingTop: 4 }}>
            <SectionHeader title="Latest News" count={news.length} accentColor={accentColor} C={C} />
            {news.map((a) => <NewsCard key={a.id} article={a} accentColor={accentColor} C={C} />)}
          </View>
        );

      default:
        return null;
    }
  };

  const totalLive = liveMatches.length;
  const totalUpcoming = upcomingMatches.length;
  const totalPreds = predictions.length;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [s.backBtn, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
            hitSlop={8}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerEmoji}>{sportIcon}</Text>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>{displayName}</Text>
          </View>
          <Pressable
            onPress={() => router.push('/(tabs)/predictions' as any)}
            style={({ pressed }) => [s.picksBtn, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}44` }, pressed ? { opacity: 0.75 } : null]}
            accessibilityLabel="View AI picks"
          >
            <FontAwesome5 name="brain" size={11} color={accentColor} />
            <Text style={[s.picksBtnText, { color: accentColor }]}>Picks</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Hero banner */}
      <Animated.View style={{ opacity: heroOpacity }}>
        <LinearGradient
          colors={[`${accentColor}22`, `${accentColor}06`, C.bg] as [string, string, string]}
          style={[s.heroBanner, { borderBottomColor: `${accentColor}22` }]}
        >
          <View style={s.heroLeft}>
            <View style={[s.heroIconRing, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}35` }]}>
              <Text style={s.heroEmoji}>{sportIcon}</Text>
            </View>
            <View>
              <Text style={[s.heroTitle, { color: C.textPrimary }]}>{displayName}</Text>
              <Text style={[s.heroSub, { color: C.textMuted }]}>
                {isMma ? 'Fight Cards · AI Picks · Results' : 'Live scores · Predictions · Stats'}
              </Text>
            </View>
          </View>
          {totalLive > 0 ? <LivePulseBadge count={totalLive} accentColor={accentColor} /> : null}
        </LinearGradient>
      </Animated.View>

      {/* Quick stats */}
      {!loading ? (
        <View style={[s.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
          <MetricCell value={String(totalLive)} label="Live" color={totalLive > 0 ? '#EF4444' : C.textMuted} C={C} />
          <View style={[s.statsDivider, { backgroundColor: C.border }]} />
          <MetricCell value={String(totalUpcoming)} label="Upcoming" color={accentColor} C={C} />
          <View style={[s.statsDivider, { backgroundColor: C.border }]} />
          <MetricCell value={String(recentResults.length)} label="Results" color={C.textSecondary} C={C} />
          <View style={[s.statsDivider, { backgroundColor: C.border }]} />
          <MetricCell value={String(totalPreds)} label="AI Picks" color={C.accentBlue} C={C} />
        </View>
      ) : (
        <View style={[s.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
          {[1, 2, 3, 4].map((i) => (
            <React.Fragment key={i}>
              {i > 1 ? <View style={[s.statsDivider, { backgroundColor: C.border }]} /> : null}
              <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <SkeletonBox w={36} h={22} r={4} />
                <SkeletonBox w={44} h={9} r={3} />
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} accentColor={accentColor} C={C} />

      {/* Tab content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, activeTab === 'standings' ? { paddingHorizontal: 0 } : {}]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
      >
        {renderTabContent()}
        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const tab = StyleSheet.create({
  content: { gap: SPACING.md }, // Adjusted to a sensible default, or remove if not needed elsewhere
});

// MMA event grouping header
const mmaEv = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.md, marginBottom: 6,
    borderRadius: RADIUS.xl, borderWidth: 1,
    paddingHorizontal: SPACING.md, paddingVertical: 14,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  evtIcon: { fontSize: 20 },
  evtName: { fontSize: 15, fontWeight: FONTS.bold },
  evtDate: { fontSize: 11, marginTop: 2 },
  countBadge: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0,
  },
  countText: { fontSize: 12, fontWeight: FONTS.extraBold },
});

const stand = StyleSheet.create({
  leagueHeader: { borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: SPACING.md, marginBottom: 0 },
  leagueName: { fontSize: 14, fontWeight: FONTS.bold },
  colHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, gap: 8 },
  col: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 10,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  headerEmoji: { fontSize: 22 },
  headerTitle: { fontSize: 18, fontWeight: FONTS.bold },
  picksBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  picksBtnText: { fontSize: 12, fontWeight: FONTS.bold },

  heroBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1,
  },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIconRing: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 22 },
  heroTitle: { fontSize: 18, fontWeight: FONTS.extraBold },
  heroSub: { fontSize: 11, marginTop: 2 },

  statsRow: {
    flexDirection: 'row', paddingVertical: 14,
    marginHorizontal: SPACING.md, marginTop: 12,
    borderRadius: RADIUS.lg, borderWidth: 1,
  },
  statsDivider: { width: 1, marginVertical: 4 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACING.md, paddingTop: 12, paddingBottom: 32 },
});
