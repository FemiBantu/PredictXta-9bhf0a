/**
 * app/challenge-history.tsx
 * Challenge History — 30-day calendar view with streak tracking
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DayResult {
  date: string;          // YYYY-MM-DD
  correctCount: number;
  totalPicks: number;
  isPerfect: boolean;
  participated: boolean;
}

interface StreakInfo {
  current: number;
  best: number;
  totalDays: number;
  perfectDays: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function buildCalendarDays(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }
  return days;
}

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Day Cell ─────────────────────────────────────────────────────────────────
function DayCell({ date, result, isToday, C }: {
  date: Date;
  result?: DayResult;
  isToday: boolean;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const dayNum = date.getDate();
  const dayAbbr = DAY_NAMES[date.getDay()];
  const participated = result?.participated ?? false;
  const isPerfect = result?.isPerfect ?? false;
  const isFuture = date > new Date();

  const bgColor = isFuture ? C.surface
    : !participated ? C.card
    : isPerfect ? '#22C55E18'
    : result && result.correctCount > 0 ? C.primaryGlow
    : '#EF444418';

  const borderColor = isFuture ? C.border
    : isToday ? C.primary
    : !participated ? C.border
    : isPerfect ? '#22C55E44'
    : result && result.correctCount > 0 ? `${C.primary}44`
    : '#EF444444';

  const textColor = isFuture ? C.textMuted
    : !participated ? C.textSecondary
    : isPerfect ? '#22C55E'
    : result && result.correctCount > 0 ? C.primary
    : '#EF4444';

  return (
    <View style={[
      dc.cell,
      { backgroundColor: bgColor, borderColor },
      isToday ? dc.todayCell : null,
    ]}>
      <Text style={[dc.dayAbbr, { color: isFuture ? C.textMuted : C.textMuted }]}>{dayAbbr}</Text>
      <Text style={[dc.dayNum, { color: textColor }]}>{dayNum}</Text>
      {participated ? (
        <Text style={dc.resultEmoji}>
          {isPerfect ? '🏆' : (result?.correctCount ?? 0) >= 2 ? '✅' : '❌'}
        </Text>
      ) : isFuture ? (
        <Text style={dc.resultEmoji}>—</Text>
      ) : (
        <Text style={dc.resultEmoji}>○</Text>
      )}
      {participated && !isFuture ? (
        <Text style={[dc.score, { color: textColor }]}>
          {result?.correctCount}/{result?.totalPicks}
        </Text>
      ) : null}
    </View>
  );
}
const dc = StyleSheet.create({
  cell: {
    width: 42, alignItems: 'center', paddingVertical: 7,
    borderRadius: RADIUS.lg, borderWidth: 1, gap: 1,
  },
  todayCell: { borderWidth: 2 },
  dayAbbr: { fontSize: 8, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  dayNum: { fontSize: 14, fontWeight: FONTS.extraBold, lineHeight: 18 },
  resultEmoji: { fontSize: 10, lineHeight: 14 },
  score: { fontSize: 8, fontWeight: FONTS.bold },
});

// ─── Streak Card ──────────────────────────────────────────────────────────────
function StreakCard({ streak, C }: {
  streak: StreakInfo;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const items = [
    { icon: '🔥', val: streak.current, label: 'Current Streak', color: '#F97316' },
    { icon: '⭐', val: streak.best, label: 'Best Streak', color: C.vip ?? '#FFD700' },
    { icon: '📅', val: streak.totalDays, label: 'Days Played', color: C.primary },
    { icon: '🏆', val: streak.perfectDays, label: 'Perfect Days', color: '#22C55E' },
  ];
  return (
    <View style={[sc.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? <View style={[sc.divider, { backgroundColor: C.border }]} /> : null}
          <View style={sc.item}>
            <Text style={sc.icon}>{item.icon}</Text>
            <Text style={[sc.val, { color: item.color }]}>{item.val}</Text>
            <Text style={[sc.label, { color: C.textMuted }]} numberOfLines={2}>{item.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
const sc = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 16, marginBottom: 16 },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  icon: { fontSize: 20 },
  val: { fontSize: 22, fontWeight: FONTS.extraBold },
  label: { fontSize: 9, textAlign: 'center', fontWeight: FONTS.medium, lineHeight: 12 },
  divider: { width: 1, marginVertical: 8 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ChallengeHistoryScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  const [results, setResults] = useState<DayResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const calendarDays = useMemo(() => buildCalendarDays(), []);
  const todayStr = useMemo(() => formatDate(new Date()), []);

  const fetchHistory = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();
      const since = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

      const { data } = await supabase
        .from('challenge_results')
        .select('date, correct_count, total_picks, is_perfect')
        .eq('user_id', user.id)
        .gte('date', since)
        .order('date', { ascending: false })
        .limit(31);

      const mapped: DayResult[] = (data ?? []).map((r: any) => ({
        date: r.date,
        correctCount: r.correct_count ?? 0,
        totalPicks: r.total_picks ?? 3,
        isPerfect: r.is_perfect ?? false,
        participated: true,
      }));
      setResults(mapped);
    } catch { /* non-blocking */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.id]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Build map for O(1) calendar lookup
  const resultMap = useMemo(() => {
    const m = new Map<string, DayResult>();
    for (const r of results) m.set(r.date, r);
    return m;
  }, [results]);

  // Compute streak info
  const streakInfo = useMemo<StreakInfo>(() => {
    let current = 0;
    let best = 0;
    let run = 0;
    let totalDays = 0;
    let perfectDays = 0;
    const today = new Date();

    // Walk backwards from today
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = formatDate(d);
      const r = resultMap.get(key);
      if (r?.participated) {
        totalDays++;
        if (r.isPerfect) perfectDays++;
        run++;
        if (i === 0 || current > 0) current = run;
      } else {
        if (i > 0) run = 0;
      }
      best = Math.max(best, run);
    }
    return { current, best, totalDays, perfectDays };
  }, [resultMap]);

  // Group days by month for display
  const weekRows = useMemo(() => {
    const rows: Date[][] = [];
    const days = [...calendarDays];
    while (days.length) rows.push(days.splice(0, 7));
    return rows;
  }, [calendarDays]);

  // Monthly section labels
  const monthLabels = useMemo(() => {
    const labels: { weekIdx: number; label: string }[] = [];
    let lastMonth = -1;
    weekRows.forEach((row, idx) => {
      const firstDay = row[0];
      if (firstDay.getMonth() !== lastMonth) {
        lastMonth = firstDay.getMonth();
        labels.push({ weekIdx: idx, label: `${MONTH_NAMES[firstDay.getMonth()]} ${firstDay.getFullYear()}` });
      }
    });
    return labels;
  }, [weekRows]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistory();
  }, [fetchHistory]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>Challenge History</Text>
          <Pressable
            onPress={() => router.push('/challenge' as any)}
            style={[s.todayBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="trophy" size={11} color={C.primary} />
            <Text style={[s.todayBtnText, { color: C.primary }]}>Today</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={[s.loadingText, { color: C.textMuted }]}>Loading history…</Text>
          </View>
        ) : !user ? (
          <View style={s.centered}>
            <Text style={{ fontSize: 40 }}>🔒</Text>
            <Text style={[s.emptyTitle, { color: C.textPrimary }]}>Sign In Required</Text>
            <Text style={[s.emptyBody, { color: C.textMuted }]}>Sign in to track your challenge history and streaks.</Text>
            <Pressable
              style={[s.loginBtn, { backgroundColor: C.primary }]}
              onPress={() => router.push('/login' as any)}>
              <Text style={[s.loginBtnText, { color: C.textInverse }]}>Sign In</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Streak stats */}
            <StreakCard streak={streakInfo} C={C} />

            {/* Legend */}
            <View style={[s.legend, { backgroundColor: C.card, borderColor: C.border }]}>
              {[
                { emoji: '🏆', label: 'Perfect (3/3)', color: '#22C55E' },
                { emoji: '✅', label: '2+ Correct', color: C.primary },
                { emoji: '❌', label: '0–1 Correct', color: '#EF4444' },
                { emoji: '○', label: 'Missed', color: C.textMuted },
              ].map((item) => (
                <View key={item.label} style={s.legendItem}>
                  <Text style={s.legendEmoji}>{item.emoji}</Text>
                  <Text style={[s.legendLabel, { color: C.textMuted }]}>{item.label}</Text>
                </View>
              ))}
            </View>

            {/* Calendar */}
            <View style={[s.calendarWrap, { backgroundColor: C.card, borderColor: C.border }]}>
              {weekRows.map((row, rowIdx) => {
                const monthEntry = monthLabels.find((m) => m.weekIdx === rowIdx);
                return (
                  <React.Fragment key={rowIdx}>
                    {monthEntry ? (
                      <Text style={[s.monthLabel, { color: C.textSecondary }]}>{monthEntry.label}</Text>
                    ) : null}
                    <View style={s.weekRow}>
                      {row.map((day) => {
                        const key = formatDate(day);
                        const result = resultMap.get(key);
                        return (
                          <DayCell
                            key={key}
                            date={day}
                            result={result}
                            isToday={key === todayStr}
                            C={C}
                          />
                        );
                      })}
                    </View>
                  </React.Fragment>
                );
              })}
            </View>

            {/* Recent results list */}
            {results.length > 0 ? (
              <View style={{ marginTop: 16 }}>
                <Text style={[s.sectionTitle, { color: C.textSecondary }]}>Recent Results</Text>
                {results.slice(0, 14).map((r) => {
                  const d = new Date(r.date);
                  const label = r.date === todayStr ? 'Today'
                    : r.date === formatDate(new Date(Date.now() - 86400000)) ? 'Yesterday'
                    : `${DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
                  return (
                    <View key={r.date} style={[s.resultRow, { backgroundColor: C.card, borderColor: C.border }]}>
                      <View style={[s.resultIcon, {
                        backgroundColor: r.isPerfect ? '#22C55E18' : r.correctCount >= 2 ? C.primaryGlow : '#EF444418',
                        borderColor: r.isPerfect ? '#22C55E44' : r.correctCount >= 2 ? `${C.primary}44` : '#EF444444',
                      }]}>
                        <Text style={s.resultEmoji}>{r.isPerfect ? '🏆' : r.correctCount >= 2 ? '✅' : '❌'}</Text>
                      </View>
                      <View style={s.resultInfo}>
                        <Text style={[s.resultDate, { color: C.textPrimary }]}>{label}</Text>
                        <Text style={[s.resultMeta, { color: C.textMuted }]}>
                          {r.correctCount}/{r.totalPicks} correct
                          {r.isPerfect ? ' · Perfect Score 🌟' : ''}
                        </Text>
                      </View>
                      <View style={[s.scoreBadge, {
                        backgroundColor: r.isPerfect ? '#22C55E18' : r.correctCount >= 2 ? C.primaryGlow : '#EF444418',
                        borderColor: r.isPerfect ? '#22C55E44' : r.correctCount >= 2 ? `${C.primary}44` : '#EF444444',
                      }]}>
                        <Text style={[s.scoreBadgeText, {
                          color: r.isPerfect ? '#22C55E' : r.correctCount >= 2 ? C.primary : '#EF4444',
                        }]}>{r.correctCount}/{r.totalPicks}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={s.emptyHistory}>
                <Text style={{ fontSize: 40 }}>📅</Text>
                <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No History Yet</Text>
                <Text style={[s.emptyBody, { color: C.textMuted }]}>
                  Play the Daily Challenge to start building your history and streak!
                </Text>
                <Pressable
                  style={[s.loginBtn, { backgroundColor: C.primary }]}
                  onPress={() => router.push('/challenge' as any)}>
                  <FontAwesome5 name="trophy" size={12} color={C.textInverse} />
                  <Text style={[s.loginBtnText, { color: C.textInverse }]}>Play Today's Challenge</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  todayBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  todayBtnText: { fontSize: 12, fontWeight: FONTS.bold },

  content: { paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 48 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
  emptyHistory: { alignItems: 'center', paddingTop: 32, gap: 12 },

  loginBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.full, paddingHorizontal: 24, paddingVertical: 11, marginTop: 4 },
  loginBtnText: { fontSize: 14, fontWeight: FONTS.bold },

  legend: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10, paddingHorizontal: SPACING.sm, marginBottom: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: '45%', paddingHorizontal: 4, paddingVertical: 3 },
  legendEmoji: { fontSize: 13 },
  legendLabel: { fontSize: 10, fontWeight: FONTS.medium },

  calendarWrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, gap: 8 },
  monthLabel: { fontSize: 11, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4, marginBottom: 4 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },

  sectionTitle: { fontSize: 12, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 12, marginBottom: 8 },
  resultIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  resultEmoji: { fontSize: 18 },
  resultInfo: { flex: 1 },
  resultDate: { fontSize: 13, fontWeight: FONTS.semiBold },
  resultMeta: { fontSize: 11, marginTop: 2 },
  scoreBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  scoreBadgeText: { fontSize: 13, fontWeight: FONTS.extraBold },
});
