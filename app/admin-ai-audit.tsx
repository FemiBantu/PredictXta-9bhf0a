
/**
 * app/admin-ai-audit.tsx — Enterprise AI Governance & MLOps Dashboard
 *
 * Displays:
 * - Platform accuracy metrics (overall, by sport, by risk level)
 * - Model registry with weights, calibration, drift alerts
 * - Quality gate pass/fail stats
 * - Scheduled job status with manual trigger
 * - Prediction outcome trends (7d, 30d)
 * - Per-sport data quality scores
 * - Admin actions: rebalance weights, trigger sync, clear cache
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAdminRole } from '@/hooks/useAdminRole';
import { fetchPlatformAccuracy, getAccuracyColor, type PlatformAccuracyStats } from '@/services/accuracyService';
import { AccuracyBadge } from '@/components/feature/AccuracyBadge';
import type { AppColors } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ModelRow {
  model_id: string; display_name: string; provider: string;
  current_weight: number; rolling_accuracy: number; brier_score: number;
  total_predictions: number; correct_predictions: number;
  calibration_drift: number; drift_warning: boolean;
  is_active: boolean; updated_at: string;
}

interface ScheduledJob {
  job_name: string; last_run_at: string | null;
  last_status: string; run_count: number; notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return 'Unknown'; }
}

function statusColor(status: string): string {
  if (status === 'success') return '#22C55E';
  if (status === 'failed' || status === 'error') return '#EF4444';
  if (status === 'running') return '#3B82F6';
  return '#F59E0B';
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, icon, color, C }: { title: string; icon: string; color: string; C: AppColors }) {
  return (
    <View style={[sh.row, { borderBottomColor: C.border }]}>
      <View style={[sh.iconBox, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <Text style={[sh.title, { color: C.textPrimary }]}>{title}</Text>
    </View>
  );
}
const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: 1, marginBottom: 12 },
  iconBox: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: FONTS.bold, flex: 1, letterSpacing: 0.3 },
});

// ─── Stat Cell ────────────────────────────────────────────────────────────────
function StatCell({ label, value, color, C }: { label: string; value: string; color?: string; C: AppColors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
      <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold, color: color ?? C.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

// ─── Action Button ────────────────────────────────────────────────────────────
function ActionBtn({ label, icon, onPress, loading, color, C }: {
  label: string; icon: string; onPress: () => void; loading: boolean; color: string; C: AppColors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [act.btn, { backgroundColor: `${color}14`, borderColor: `${color}33` }, pressed ? { opacity: 0.75 } : null, loading ? { opacity: 0.5 } : null]}
      onPress={onPress} disabled={loading}
    >
      {loading ? <ActivityIndicator size={13} color={color} /> : <Ionicons name={icon as any} size={13} color={color} />}
      <Text style={[act.label, { color }]}>{label}</Text>
    </Pressable>
  );
}
const act = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flex: 1 },
  label: { fontSize: 11, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminAIAuditScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  const [refreshing, setRefreshing] = useState(false);

  const [accuracy, setAccuracy] = useState<PlatformAccuracyStats | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});
  const [sportCounts, setSportCounts] = useState<Record<string, number>>({});

  const loadAll = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const [accResult, modelsResult, jobsResult, sportsResult] = await Promise.allSettled([
        fetchPlatformAccuracy(force),
        supabase.from('model_registry').select('*').order('current_weight', { ascending: false }),
        supabase.from('scheduled_jobs').select('*').order('last_run_at', { ascending: false }),
        supabase.from('matches').select('sport').then(({ data }) => {
          const map: Record<string, number> = {};
          for (const row of (data ?? [])) {
            map[row.sport] = (map[row.sport] ?? 0) + 1;
          }
          return map;
        }),
      ]);
      if (accResult.status === 'fulfilled') setAccuracy(accResult.value);
      if (modelsResult.status === 'fulfilled') setModels((modelsResult.value.data ?? []) as ModelRow[]);
      if (jobsResult.status === 'fulfilled') setJobs((jobsResult.value.data ?? []) as ScheduledJob[]);
      if (sportsResult.status === 'fulfilled') setSportCounts(sportsResult.value as Record<string, number>);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, []);

  const onRefresh = useCallback(async () => { setRefreshing(true); await loadAll(true); setRefreshing(false); }, [loadAll]);

  const triggerAction = useCallback(async (key: string, fn: () => Promise<void>) => {
    setTriggering((p) => ({ ...p, [key]: true }));
    try { await fn(); await loadAll(true); } finally { setTriggering((p) => ({ ...p, [key]: false })); }
  }, [loadAll]);

  const rebalanceWeights = useCallback(() => triggerAction('rebalance', async () => {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('rebalance-weights', { body: {} });
  }), [triggerAction]);

  const resolveOutcomes = useCallback(() => triggerAction('resolve', async () => {
    const supabase = getSupabaseClient();
    await supabase.rpc('auto_resolve_and_track_predictions');
  }), [triggerAction]);

  const syncStandings = useCallback(() => triggerAction('standings', async () => {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('sync-standings', { body: { sport: 'football' } });
  }), [triggerAction]);

  if (adminLoading || loading) return (
    <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={C.primary} />
    </View>
  );

  if (!isAdmin) return (
    <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
      <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
      <Text style={{ fontSize: 16, color: C.textMuted, textAlign: 'center' }}>Admin access required</Text>
      <Pressable onPress={() => router.back()} style={[s.backBtn, { backgroundColor: C.primary }]}>
        <Text style={{ color: C.textInverse, fontWeight: FONTS.bold }}>Go Back</Text>
      </Pressable>
    </View>
  );

  const acc = accuracy?.overall;
  const accColor = acc ? getAccuracyColor(acc.accuracyPct) : C.textMuted;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="arrow-back" size={22} color={C.textPrimary} /></Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[s.title, { color: C.textPrimary }]}>AI Governance</Text>
            <Text style={[s.subtitle, { color: C.textMuted }]}>MLOps & Accuracy Dashboard</Text>
          </View>
          <AccuracyBadge compact />
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* ── Accuracy Deep-Link Banner ───────────────────────────── */}
        <Pressable
          style={({ pressed }) => ([{
            flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
            borderRadius: RADIUS.lg, borderWidth: 1, padding: 12,
            backgroundColor: acc ? `${accColor}08` : C.surface,
            borderColor: acc ? `${accColor}22` : C.border,
            opacity: pressed ? 0.75 : 1,
          }])}
          onPress={() => router.push('/accuracy' as any)}
        >
          <View style={[{ width: 36, height: 36, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, backgroundColor: `${accColor}14`, borderColor: `${accColor}30` }]}>
            <Ionicons name="stats-chart" size={16} color={accColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.textPrimary }}>Full Accuracy Dashboard</Text>
            <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>Animated per-sport charts, league table, calibration drift</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </Pressable>

        {/* ── Platform Accuracy ────────────────────────────── */}
        <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <SectionHeader title="Platform Accuracy" icon="shield-checkmark-outline" color={accColor} C={C} />
          {acc ? (
            <>
              <LinearGradient colors={[`${accColor}0A`, `${accColor}03`]} style={s.accGradient}>
                <View style={s.metricsRow}>
                  <StatCell label="Overall" value={`${acc.accuracyPct}%`} color={accColor} C={C} />
                  <View style={[s.divider, { backgroundColor: C.border }]} />
                  <StatCell label="Correct" value={String(acc.correct)} color="#22C55E" C={C} />
                  <View style={[s.divider, { backgroundColor: C.border }]} />
                  <StatCell label="Total" value={String(acc.total)} C={C} />
                  <View style={[s.divider, { backgroundColor: C.border }]} />
                  <StatCell label="Avg Conf" value={`${acc.avgConfidence}%`} color={C.accentBlue} C={C} />
                </View>
                <View style={[s.calibBar, { backgroundColor: C.surface }]}>
                  <View style={[s.calibFill, { width: `${Math.min(100, acc.accuracyPct)}%`, backgroundColor: accColor }]} />
                </View>
                <View style={s.rowSpaceBetween}>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>Calibration drift: {acc.calibrationDrift.toFixed(1)}%</Text>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>7d: {accuracy?.recentTrend.last7d.pct}% | 30d: {accuracy?.recentTrend.last30d.pct}%</Text>
                </View>
              </LinearGradient>

              {/* Risk breakdown */}
              <View style={s.metricsRow}>
                {[
                  { label: 'High Conf', data: accuracy?.byRisk.low, color: '#22C55E' },
                  { label: 'Med Conf',  data: accuracy?.byRisk.medium, color: '#F59E0B' },
                  { label: 'Low Conf',  data: accuracy?.byRisk.high, color: '#EF4444' },
                ].map((r) => r.data ? (
                  <View key={r.label} style={[s.riskCell, { backgroundColor: `${r.color}0A`, borderColor: `${r.color}22` }]}>
                    <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: r.color }}>{r.data.pct}%</Text>
                    <Text style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase' }}>{r.label}</Text>
                    <Text style={{ fontSize: 9, color: C.textMuted }}>{r.data.correct}/{r.data.total}</Text>
                  </View>
                ) : null)}
              </View>

              {/* Per-sport accuracy */}
              {accuracy?.bySport && accuracy.bySport.length > 0 ? (
                <View style={s.sportGrid}>
                  {accuracy.bySport.slice(0, 8).map((sp) => {
                    const spColor = getAccuracyColor(sp.accuracyPct);
                    return (
                      <View key={sp.sport} style={[s.sportCell, { backgroundColor: C.surface, borderColor: C.border }]}>
                        <Text style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }} numberOfLines={1}>{sp.sport}</Text>
                        <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: spColor }}>{sp.accuracyPct}%</Text>
                        <Text style={{ fontSize: 9, color: C.textMuted }}>{sp.totalOutcomes}px</Text>
                        {sp.calibrationDrift > 10 ? <View style={[s.driftDot, { backgroundColor: '#F59E0B' }]} /> : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
              <Ionicons name="stats-chart-outline" size={32} color={C.textMuted} />
              <Text style={{ color: C.textMuted, textAlign: 'center' }}>No resolved predictions yet.{'\n'}Run "Resolve Outcomes" below.</Text>
            </View>
          )}
        </View>

        {/* ── Admin Actions ──────────────────────────────────── */}
        <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <SectionHeader title="Admin Actions" icon="flash-outline" color={C.primary} C={C} />
          <View style={s.actionsGrid}>
            <ActionBtn label="Resolve Outcomes" icon="checkmark-done-outline" onPress={resolveOutcomes} loading={triggering['resolve'] ?? false} color="#22C55E" C={C} />
            <ActionBtn label="Rebalance Weights" icon="scale-outline" onPress={rebalanceWeights} loading={triggering['rebalance'] ?? false} color={C.primary} C={C} />
          </View>
          <View style={s.actionsGrid}>
            <ActionBtn label="Sync Standings" icon="podium-outline" onPress={syncStandings} loading={triggering['standings'] ?? false} color={C.accentBlue} C={C} />
            <ActionBtn label="Admin Panel" icon="settings-outline" onPress={() => router.push('/admin' as any)} loading={false} color={C.accentAmber} C={C} />
          </View>
        </View>

        {/* ── Model Registry ─────────────────────────────────── */}
        <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <SectionHeader title="Model Registry" icon="cube-outline" color={C.accentBlue} C={C} />
          {models.length === 0 ? (
            <Text style={{ color: C.textMuted, textAlign: 'center', paddingVertical: 16 }}>No models registered</Text>
          ) : models.map((m) => {
            const wPct = Math.round(m.current_weight * 100);
            const accPct = Math.round(m.rolling_accuracy * 100);
            const accC = getAccuracyColor(accPct);
            return (
              <View key={m.model_id} style={[s.modelRow, { borderBottomColor: C.border }]}>
                <View style={[s.modelIcon, { backgroundColor: m.is_active ? `${C.primary}12` : C.surface, borderColor: m.is_active ? `${C.primary}33` : C.border }]}>
                  <FontAwesome5 name="brain" size={10} color={m.is_active ? C.primary : C.textMuted} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.textPrimary }}>{m.display_name}</Text>
                    {m.drift_warning ? <View style={[s.driftPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}><Text style={{ fontSize: 8, color: '#F59E0B', fontWeight: FONTS.bold }}>DRIFT</Text></View> : null}
                    {!m.is_active ? <View style={[s.driftPill, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}><Text style={{ fontSize: 8, color: '#EF4444', fontWeight: FONTS.bold }}>INACTIVE</Text></View> : null}
                  </View>
                  <Text style={{ fontSize: 10, color: C.textMuted }}>{m.provider} · {m.total_predictions} predictions · updated {fmtDate(m.updated_at)}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ fontSize: 10, color: accC, fontWeight: FONTS.semiBold }}>Acc: {accPct}%</Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>Brier: {m.brier_score.toFixed(3)}</Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>Drift: {m.calibration_drift.toFixed(1)}%</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: C.primary }}>{wPct}%</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>weight</Text>
                  <View style={[s.weightBar, { backgroundColor: C.surface }]}>
                    <View style={[s.weightFill, { width: `${wPct}%`, backgroundColor: C.primary }]} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Scheduled Jobs ─────────────────────────────────── */}
        <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <SectionHeader title="Scheduled Jobs" icon="time-outline" color={C.accentAmber} C={C} />
          {jobs.slice(0, 12).map((job) => {
            const sc = statusColor(job.last_status);
            return (
              <View key={job.job_name} style={[s.jobRow, { borderBottomColor: C.border }]}>
                <View style={[s.jobDot, { backgroundColor: sc }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{job.job_name}</Text>
                  {job.notes ? <Text style={{ fontSize: 10, color: C.textMuted }} numberOfLines={1}>{job.notes}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ fontSize: 10, color: sc, fontWeight: FONTS.semiBold }}>{job.last_status.toUpperCase()}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>{fmtDate(job.last_run_at)}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>×{job.run_count}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Data Coverage ──────────────────────────────────── */}
        <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <SectionHeader title="Data Coverage" icon="server-outline" color={C.accentPurple} C={C} />
          <View style={s.sportGrid}>
            {Object.entries(sportCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([sport, count]) => (
              <View key={sport} style={[s.sportCell, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }} numberOfLines={1}>{sport}</Text>
                <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: count > 50 ? C.primary : count > 10 ? C.accentAmber : C.accentRed }}>{count}</Text>
                <Text style={{ fontSize: 9, color: C.textMuted }}>matches</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 11, marginTop: 1 },
  backBtn: { borderRadius: RADIUS.full, paddingHorizontal: 20, paddingVertical: 10 },
  scroll: { padding: SPACING.md, gap: 12 },
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, gap: 12 },
  accGradient: { borderRadius: RADIUS.lg, padding: 12, gap: 8 },
  metricsRow: { flexDirection: 'row', alignItems: 'center' },
  divider: { width: 1, height: 30, marginHorizontal: 4 },
  calibBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  calibFill: { height: '100%', borderRadius: 2 },
  rowSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  riskCell: { flex: 1, alignItems: 'center', gap: 2, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 10, marginHorizontal: 4 },
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sportCell: { width: '22%', minWidth: 72, alignItems: 'center', gap: 2, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 6, position: 'relative' },
  driftDot: { position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3 },
  actionsGrid: { flexDirection: 'row', gap: 8 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  modelIcon: { width: 32, height: 32, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  driftPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  weightBar: { width: 48, height: 3, borderRadius: 2, overflow: 'hidden' },
  weightFill: { height: '100%', borderRadius: 2 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  jobDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
});
