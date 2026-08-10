/**
 * Prediction Leaderboard
 *
 * Ranks users by correct predictions from the challenge_results table.
 * Tabs: Weekly (current week_key) | All-Time (aggregated totals)
 * Features: trophy podium for top 3, win rate %, pull-to-refresh.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, RefreshControl, Animated, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getSupabaseClient, useAuth } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  userId: string;
  username: string;
  correctCount: number;
  totalPicks: number;
  winRate: number;       // correctCount / totalPicks * 100
  perfectDays: number;
  weekKey: string;       // e.g. "2025-W22" — most recent for all-time
  streak: number;        // consecutive perfect challenge days
}

// ─── Week Key Helpers ─────────────────────────────────────────────────────────
function getCurrentWeekKey(): string {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function formatWeekKey(key: string): string {
  // "2025-W22" → "Week 22, 2025"
  const m = key.match(/^(\d{4})-W(\d+)$/);
  if (m) return `Week ${parseInt(m[2])}, ${m[1]}`;
  return key;
}

// ─── Streak Computation ───────────────────────────────────────────────────────
async function fetchUserStreaks(): Promise<Map<string, number>> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('challenge_results')
      .select('user_id, date, is_perfect')
      .order('date', { ascending: false })
      .limit(5000);
    if (!data) return new Map();
    const userDates = new Map<string, Array<{ date: string; isPerfect: boolean }>>();
    for (const row of data as Record<string, unknown>[]) {
      const uid = row.user_id as string;
      if (!userDates.has(uid)) userDates.set(uid, []);
      userDates.get(uid)!.push({ date: row.date as string, isPerfect: (row.is_perfect as boolean) ?? false });
    }
    const streakMap = new Map<string, number>();
    userDates.forEach((entries, uid) => {
      let streak = 0;
      for (const entry of entries) { if (entry.isPerfect) streak++; else break; }
      streakMap.set(uid, streak);
    });
    return streakMap;
  } catch { return new Map(); }
}

// ─── Data Fetchers ────────────────────────────────────────────────────────────
async function fetchWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const supabase = getSupabaseClient();
    const weekKey = getCurrentWeekKey();

    const { data, error } = await supabase
      .from('challenge_results')
      .select('user_id, username, correct_count, total_picks, is_perfect, week_key')
      .eq('week_key', weekKey)
      .order('correct_count', { ascending: false })
      .limit(100);

    if (error || !data || data.length === 0) return [];

    const streakMap = await fetchUserStreaks();

    // Group by user (keep best result per user per week)
    const userMap = new Map<string, LeaderboardEntry>();
    for (const row of data as Record<string, unknown>[]) {
      const uid = row.user_id as string;
      const cc = Number(row.correct_count ?? 0);
      const tp = Number(row.total_picks ?? 3);
      const wr = tp > 0 ? Math.round((cc / tp) * 100) : 0;
      const existing = userMap.get(uid);
      if (!existing || cc > existing.correctCount) {
        userMap.set(uid, {
          userId: uid,
          username: (row.username as string) || 'Anonymous',
          correctCount: cc,
          totalPicks: tp,
          winRate: wr,
          perfectDays: (row.is_perfect as boolean) ? 1 : 0,
          weekKey: row.week_key as string,
          streak: streakMap.get(uid) ?? 0,
        });
      }
    }

    return Array.from(userMap.values()).sort((a, b) => {
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      return b.winRate - a.winRate;
    });
  } catch (e) {
    console.warn('[leaderboard] fetchWeekly error:', e);
    return [];
  }
}

async function fetchAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('challenge_results')
      .select('user_id, username, correct_count, total_picks, is_perfect, week_key')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error || !data || data.length === 0) return [];

    // Aggregate by user across all entries
    const userMap = new Map<string, {
      userId: string;
      username: string;
      totalCorrect: number;
      totalPicks: number;
      perfectDays: number;
      latestWeekKey: string;
    }>();

    for (const row of data as Record<string, unknown>[]) {
      const uid = row.user_id as string;
      const cc = Number(row.correct_count ?? 0);
      const tp = Number(row.total_picks ?? 3);
      const perf = (row.is_perfect as boolean) ? 1 : 0;
      const wk = (row.week_key as string) ?? '';
      const uname = (row.username as string) || 'Anonymous';

      if (!userMap.has(uid)) {
        userMap.set(uid, {
          userId: uid,
          username: uname,
          totalCorrect: 0,
          totalPicks: 0,
          perfectDays: 0,
          latestWeekKey: wk,
        });
      }
      const agg = userMap.get(uid)!;
      agg.totalCorrect += cc;
      agg.totalPicks += tp;
      agg.perfectDays += perf;
      // Keep most recent week_key (first encountered since ordered by created_at desc)
      if (!agg.latestWeekKey) agg.latestWeekKey = wk;
      // Update username if it's more recent (non-anonymous)
      if (uname !== 'Anonymous') agg.username = uname;
    }

    const streakMap = await fetchUserStreaks();

    return Array.from(userMap.values())
      .map((u) => ({
        userId: u.userId,
        username: u.username,
        correctCount: u.totalCorrect,
        totalPicks: u.totalPicks,
        winRate: u.totalPicks > 0 ? Math.round((u.totalCorrect / u.totalPicks) * 100) : 0,
        perfectDays: u.perfectDays,
        weekKey: u.latestWeekKey,
        streak: streakMap.get(u.userId) ?? 0,
      }))
      .sort((a, b) => {
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        return b.winRate - a.winRate;
      });
  } catch (e) {
    console.warn('[leaderboard] fetchAllTime error:', e);
    return [];
  }
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#6366F1', '#EC4899', '#22C55E', '#F59E0B',
  '#14B8A6', '#A855F7', '#EF4444', '#3B82F6',
];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash * 31;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function medalEmoji(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

function rankBorderColor(rank: number): string {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return 'transparent';
}

// ─── Trophy Podium ────────────────────────────────────────────────────────────
function TrophyPodium({ entries, C }: { entries: LeaderboardEntry[]; C: AppColors }) {
  if (entries.length < 1) return null;

  const order = entries.length >= 3
    ? [entries[1], entries[0], entries[2]]   // 2nd | 1st | 3rd
    : entries.length === 2
    ? [entries[1], entries[0], null]
    : [null, entries[0], null];

  const podiumHeights = [72, 100, 56]; // 2nd | 1st | 3rd
  const podiumRanks   = [2, 1, 3];

  return (
    <View style={[pod.container, { backgroundColor: C.card, borderColor: C.border }]}>
      <LinearGradient
        colors={[`${C.primary}18`, 'transparent']}
        style={pod.gradient}
      />
      <View style={pod.stageRow}>
        {order.map((entry, i) => {
          const rank = podiumRanks[i];
          const h = podiumHeights[i];
          const isCenter = i === 1;
          if (!entry) return <View key={`empty-${i}`} style={pod.slot} />;
          const ac = avatarColor(entry.username);
          const bc = rankBorderColor(rank);
          return (
            <View key={entry.userId} style={[pod.slot, isCenter ? pod.slotCenter : null]}>
              {/* Medal */}
              <Text style={pod.medal}>{medalEmoji(rank)}</Text>
              {/* Avatar */}
              <View style={[
                pod.avatar,
                isCenter ? pod.avatarLg : pod.avatarSm,
                { backgroundColor: ac, borderColor: bc },
              ]}>
                <Text style={[pod.avatarText, isCenter ? pod.avatarTextLg : pod.avatarTextSm]}>
                  {entry.username[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
              {/* Name */}
              <Text style={[pod.name, { color: C.textPrimary }]} numberOfLines={1}>
                {entry.username}
              </Text>
              {/* Stats */}
              <Text style={[pod.correct, { color: C.primary }]}>
                {entry.correctCount}
                <Text style={[pod.correctSuffix, { color: C.textMuted }]}> correct</Text>
              </Text>
              <Text style={[pod.winRate, {
                color: entry.winRate >= 80 ? '#22C55E' : entry.winRate >= 60 ? '#F59E0B' : C.textMuted,
              }]}>
                {entry.winRate}%
              </Text>
              {/* Podium block */}
              <View style={[pod.block, { height: h, backgroundColor: `${bc}22`, borderColor: `${bc}44` }]}>
                <Text style={[pod.blockRank, { color: bc }]}>#{rank}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const pod = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.md,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.md,
  },
  slot: { flex: 1, alignItems: 'center', gap: 4 },
  slotCenter: { paddingBottom: 0 },
  medal: { fontSize: 22, marginBottom: 2 },
  avatar: {
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  avatarSm: { width: 44, height: 44 },
  avatarLg: { width: 58, height: 58 },
  avatarText: { fontWeight: FONTS.extraBold, color: '#fff' },
  avatarTextSm: { fontSize: 16 },
  avatarTextLg: { fontSize: 22 },
  name: { fontSize: 11, fontWeight: FONTS.bold, textAlign: 'center', maxWidth: 90, marginTop: 4 },
  correct: { fontSize: 15, fontWeight: FONTS.extraBold },
  correctSuffix: { fontSize: 10, fontWeight: FONTS.regular },
  winRate: { fontSize: 12, fontWeight: FONTS.bold },
  block: {
    width: '90%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
    marginTop: 8,
  },
  blockRank: { fontSize: 11, fontWeight: FONTS.extraBold },
});

// ─── Streak Badge ─────────────────────────────────────────────────────────────
function StreakBadge({ streak, C }: { streak: number; C: AppColors }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (streak < 2) return;
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    p.start();
    return () => p.stop();
  }, [streak]);
  if (streak < 2) return null;
  return (
    <Animated.View style={[stbadge.wrap, { opacity: op }]}>
      <Text style={stbadge.fire}>🔥</Text>
      <Text style={stbadge.days}>{streak}d</Text>
    </Animated.View>
  );
}
const stbadge = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: '#F59E0B18', borderColor: '#F59E0B55',
  },
  fire: { fontSize: 9 },
  days: { fontSize: 10, fontWeight: FONTS.extraBold, color: '#F59E0B', letterSpacing: 0.2 },
});

// ─── Win Rate Bar ─────────────────────────────────────────────────────────────
function WinRateBar({ rate, color, C }: { rate: number; color: string; C: AppColors }) {
  const animW = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(animW, {
      toValue: rate,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [rate]);
  return (
    <View style={[wrb.track, { backgroundColor: C.border }]}>
      <Animated.View
        style={[
          wrb.fill,
          {
            width: animW.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}
const wrb = StyleSheet.create({
  track: { flex: 1, height: 5, borderRadius: RADIUS.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: RADIUS.full },
});

// ─── Leaderboard Row ──────────────────────────────────────────────────────────
function LeaderRow({ entry, rank, isMe, index, tab, C }: {
  entry: LeaderboardEntry;
  rank: number;
  isMe: boolean;
  index: number;
  tab: 'weekly' | 'alltime';
  C: AppColors;
}) {
  const op  = useRef(new Animated.Value(0)).current;
  const ty  = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 280, delay: Math.min(index * 35, 400), useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration: 280, delay: Math.min(index * 35, 400), useNativeDriver: true }),
    ]).start();
  }, []);

  const ac = avatarColor(entry.username);
  const bc = rankBorderColor(rank);
  const wr = entry.winRate;
  const wrColor = wr >= 80 ? '#22C55E' : wr >= 60 ? '#F59E0B' : C.textMuted;

  return (
    <Animated.View style={{ opacity: op, transform: [{ translateY: ty }] }}>
      <View style={[
        row.wrap,
        { backgroundColor: isMe ? `${C.primary}0D` : C.bg, borderColor: isMe ? `${C.primary}33` : 'transparent' },
      ]}>
        {/* Rank */}
        <View style={row.rankCol}>
          {rank <= 3 ? (
            <Text style={row.medal}>{medalEmoji(rank)}</Text>
          ) : (
            <Text style={[row.rankNum, { color: C.textMuted }]}>#{rank}</Text>
          )}
        </View>

        {/* Avatar */}
        <View style={[row.avatar, { backgroundColor: ac, borderColor: bc, borderWidth: rank <= 3 ? 2 : 0 }]}>
          <Text style={row.avatarText}>{entry.username[0]?.toUpperCase() ?? '?'}</Text>
        </View>

        {/* Name + bar */}
        <View style={row.infoCol}>
          <View style={row.nameRow}>
            <Text style={[row.username, { color: C.textPrimary }]} numberOfLines={1}>
              {entry.username}
            </Text>
            {isMe ? (
              <View style={[row.youBadge, { backgroundColor: `${C.primary}22`, borderColor: `${C.primary}55` }]}>
                <Text style={[row.youText, { color: C.primary }]}>YOU</Text>
              </View>
            ) : null}
            {entry.perfectDays > 0 ? (
              <View style={row.perfectBadge}>
                <Text style={row.perfectText}>⭐ {entry.perfectDays}x</Text>
              </View>
            ) : null}
            <StreakBadge streak={entry.streak ?? 0} C={C} />
          </View>
          <View style={row.barRow}>
            <WinRateBar rate={wr} color={ac} C={C} />
            <Text style={[row.winRateLabel, { color: wrColor }]}>{wr}%</Text>
          </View>
          {tab === 'weekly' ? (
            <Text style={[row.weekLabel, { color: C.textMuted }]}>{formatWeekKey(entry.weekKey)}</Text>
          ) : (
            <Text style={[row.weekLabel, { color: C.textMuted }]}>{entry.totalPicks} total picks</Text>
          )}
        </View>

        {/* Correct count */}
        <View style={row.statCol}>
          <Text style={[row.correctNum, { color: C.primary }]}>{entry.correctCount}</Text>
          <Text style={[row.correctLabel, { color: C.textMuted }]}>correct</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const row = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    marginBottom: -StyleSheet.hairlineWidth,
  },
  rankCol: { width: 36, alignItems: 'center' },
  medal: { fontSize: 20 },
  rankNum: { fontSize: 13, fontWeight: FONTS.bold },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontSize: 16, fontWeight: FONTS.extraBold, color: '#fff' },
  infoCol: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  username: { fontSize: 14, fontWeight: FONTS.semiBold, flex: 1 },
  youBadge: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  youText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  perfectBadge: {
    backgroundColor: '#F59E0B18',
    borderRadius: RADIUS.full,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  perfectText: { fontSize: 9, color: '#F59E0B', fontWeight: FONTS.bold },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winRateLabel: { fontSize: 11, fontWeight: FONTS.bold, width: 34, textAlign: 'right' },
  weekLabel: { fontSize: 10, marginTop: 1 },
  statCol: { alignItems: 'flex-end', gap: 2, minWidth: 52 },
  correctNum: { fontSize: 22, fontWeight: FONTS.extraBold, lineHeight: 24 },
  correctLabel: { fontSize: 9, fontWeight: FONTS.medium },
});

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ tab, C }: { tab: 'weekly' | 'alltime'; C: AppColors }) {
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }).start();
  }, []);
  return (
    <View style={empty.root}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Text style={empty.emoji}>🏆</Text>
      </Animated.View>
      <Text style={[empty.title, { color: C.textPrimary }]}>
        {tab === 'weekly' ? 'No weekly results yet' : 'No all-time data yet'}
      </Text>
      <Text style={[empty.body, { color: C.textMuted }]}>
        {tab === 'weekly'
          ? `Play the Daily Challenge to appear on this week's leaderboard.`
          : 'Complete Daily Challenges to build your all-time ranking.'}
      </Text>
    </View>
  );
}
const empty = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 60, paddingHorizontal: SPACING.xl, gap: 12 },
  emoji: { fontSize: 64 },
  title: { fontSize: 20, fontWeight: FONTS.extraBold, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});

// ─── Stat Chip ────────────────────────────────────────────────────────────────
function StatChip({ icon, label, value, color, C }: {
  icon: string; label: string; value: string | number; color: string; C: AppColors;
}) {
  return (
    <View style={[chip.wrap, { backgroundColor: `${color}14`, borderColor: `${color}33` }]}>
      <Text style={chip.icon}>{icon}</Text>
      <Text style={[chip.val, { color }]}>{value}</Text>
      <Text style={[chip.lbl, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}
const chip = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', gap: 3,
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 8,
  },
  icon: { fontSize: 18 },
  val: { fontSize: 18, fontWeight: FONTS.extraBold, lineHeight: 20 },
  lbl: { fontSize: 10, fontWeight: FONTS.medium },
});

// ─── Tab Button ───────────────────────────────────────────────────────────────
type Tab = 'weekly' | 'alltime';

function TabButton({ id, label, icon, active, onPress, C }: {
  id: Tab; label: string; icon: string; active: boolean; onPress: () => void; C: AppColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        tb.btn,
        active
          ? { backgroundColor: C.primary, borderColor: C.primary }
          : { backgroundColor: C.card, borderColor: C.border },
        pressed && !active ? { opacity: 0.75 } : null,
      ]}
    >
      <Text style={tb.icon}>{icon}</Text>
      <Text style={[tb.label, { color: active ? C.textInverse : C.textSecondary }, active ? tb.labelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}
const tb = StyleSheet.create({
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: RADIUS.full, borderWidth: 1,
    paddingVertical: 9, paddingHorizontal: 14, height: 40,
  },
  icon: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: FONTS.semiBold },
  labelActive: { fontWeight: FONTS.bold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LeaderboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors: C } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>('weekly');
  const [weeklyData, setWeeklyData]   = useState<LeaderboardEntry[]>([]);
  const [alltimeData, setAlltimeData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [weeklyLoaded, setWeeklyLoaded]   = useState(false);
  const [alltimeLoaded, setAlltimeLoaded] = useState(false);

  // Load data for the active tab
  const loadTab = useCallback(async (tab: Tab, silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (tab === 'weekly') {
        const d = await fetchWeeklyLeaderboard();
        setWeeklyData(d);
        setWeeklyLoaded(true);
      } else {
        const d = await fetchAllTimeLeaderboard();
        setAlltimeData(d);
        setAlltimeLoaded(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadTab('weekly');
  }, []);

  // Load all-time when switching to that tab for the first time
  useEffect(() => {
    if (activeTab === 'alltime' && !alltimeLoaded) {
      loadTab('alltime');
    }
    if (activeTab === 'weekly' && !weeklyLoaded) {
      loadTab('weekly');
    }
  }, [activeTab, alltimeLoaded, weeklyLoaded]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTab(activeTab, true);
  }, [activeTab, loadTab]);

  const handleTabSwitch = useCallback((tab: Tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    const alreadyLoaded = tab === 'weekly' ? weeklyLoaded : alltimeLoaded;
    if (!alreadyLoaded) setLoading(true);
  }, [activeTab, weeklyLoaded, alltimeLoaded]);

  const entries = activeTab === 'weekly' ? weeklyData : alltimeData;
  const top3 = entries.slice(0, 3);
  const rest  = entries.slice(3);

  const myEntry = user ? entries.find((e) => e.userId === user.id) : null;
  const myRank  = user ? entries.findIndex((e) => e.userId === user.id) + 1 : 0;

  // Aggregate stats for the banner chips
  const totalParticipants = entries.length;
  const topWinRate = entries.length > 0
    ? Math.max(...entries.slice(0, 10).map((e) => e.winRate))
    : 0;
  const perfectCount = entries.filter((e) => e.perfectDays > 0).length;

  const weekKey = activeTab === 'weekly' ? getCurrentWeekKey() : null;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Leaderboard</Text>
            {weekKey && activeTab === 'weekly' ? (
              <Text style={[s.headerSub, { color: C.textMuted }]}>{formatWeekKey(weekKey)}</Text>
            ) : activeTab === 'alltime' ? (
              <Text style={[s.headerSub, { color: C.textMuted }]}>All-Time Rankings</Text>
            ) : null}
          </View>
          <Pressable onPress={() => router.push('/challenge' as any)} style={s.challengeBtn} hitSlop={8}>
            <FontAwesome5 name="bolt" size={14} color={C.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Tab bar */}
      <View style={[s.tabBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <TabButton
          id="weekly" label="This Week" icon="📅"
          active={activeTab === 'weekly'}
          onPress={() => handleTabSwitch('weekly')} C={C}
        />
        <TabButton
          id="alltime" label="All-Time" icon="🏆"
          active={activeTab === 'alltime'}
          onPress={() => handleTabSwitch('alltime')} C={C}
        />
      </View>

      {loading && !refreshing ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[s.loadingText, { color: C.textMuted }]}>Loading rankings...</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item, idx) => `${activeTab}-${item.userId}-${idx}`}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
          }
          ListHeaderComponent={
            <View>
              {/* Stats chips */}
              {entries.length > 0 ? (
                <View style={[s.statsRow, { borderBottomColor: C.border }]}>
                  <StatChip icon="👥" label="Players" value={totalParticipants} color="#6366F1" C={C} />
                  <StatChip icon="🎯" label="Top Win Rate" value={`${topWinRate}%`} color="#22C55E" C={C} />
                  <StatChip icon="⭐" label="Perfect Days" value={perfectCount} color="#F59E0B" C={C} />
                </View>
              ) : null}

              {/* My rank card */}
              {myEntry && myRank > 0 ? (
                <View style={[s.myRankCard, { backgroundColor: `${C.primary}0D`, borderColor: `${C.primary}33` }]}>
                  <View style={s.myRankLeft}>
                    <View style={[s.myRankAvatar, { backgroundColor: avatarColor(myEntry.username) }]}>
                      <Text style={s.myRankAvatarText}>{myEntry.username[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                    <View style={s.myRankInfo}>
                      <Text style={[s.myRankUsername, { color: C.textPrimary }]}>{myEntry.username}</Text>
                      <Text style={[s.myRankSub, { color: C.textMuted }]}>
                        {myEntry.correctCount} correct · {myEntry.winRate}% win rate
                      </Text>
                    </View>
                  </View>
                  <View style={[s.myRankBadge, { backgroundColor: C.primary }]}>
                    <Text style={[s.myRankNum, { color: C.textInverse }]}>#{myRank}</Text>
                  </View>
                </View>
              ) : null}

              {/* Podium */}
              {top3.length > 0 ? (
                <>
                  <View style={s.podiumLabel}>
                    <View style={[s.divLine, { backgroundColor: C.border }]} />
                    <Text style={[s.divText, { color: C.textMuted }]}>🏆 TOP 3</Text>
                    <View style={[s.divLine, { backgroundColor: C.border }]} />
                  </View>
                  <TrophyPodium entries={top3} C={C} />
                </>
              ) : null}

              {/* Divider before list */}
              {rest.length > 0 ? (
                <View style={s.podiumLabel}>
                  <View style={[s.divLine, { backgroundColor: C.border }]} />
                  <Text style={[s.divText, { color: C.textMuted }]}>ALL RANKINGS</Text>
                  <View style={[s.divLine, { backgroundColor: C.border }]} />
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <LeaderRow
              entry={item}
              rank={index + 4}
              isMe={item.userId === user?.id}
              index={index}
              tab={activeTab}
              C={C}
            />
          )}
          ListEmptyComponent={
            entries.length === 0 ? <EmptyState tab={activeTab} C={C} /> : null
          }
          ListFooterComponent={<View style={{ height: 40 }} />}
          contentContainerStyle={entries.length === 0 ? { flexGrow: 1 } : undefined}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1 },
  headerTitle: { fontSize: 18, fontWeight: FONTS.bold },
  headerSub: { fontSize: 11, fontWeight: FONTS.medium },
  challengeBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  statsRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  myRankCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: 4,
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: SPACING.md, paddingVertical: 12,
  },
  myRankLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  myRankAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  myRankAvatarText: { fontSize: 16, fontWeight: FONTS.extraBold, color: '#fff' },
  myRankInfo: { flex: 1 },
  myRankUsername: { fontSize: 14, fontWeight: FONTS.bold },
  myRankSub: { fontSize: 11, marginTop: 2 },
  myRankBadge: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 12, paddingVertical: 6,
    minWidth: 48, alignItems: 'center',
  },
  myRankNum: { fontSize: 15, fontWeight: FONTS.extraBold },
  podiumLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.md, marginBottom: SPACING.sm,
  },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 0.6 },
});
