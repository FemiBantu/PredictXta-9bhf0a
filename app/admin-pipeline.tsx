/**
 * app/admin-pipeline.tsx
 *
 * PredictXta Pipeline Monitor & Control Dashboard
 *
 * Features:
 * - Real-time pipeline stage status with run/abort controls
 * - API provider health cards (success rate, last error, status badge)
 * - Sports coverage grid (fixtures, predictions, odds per sport)
 * - Next-day readiness scorecard
 * - Acceptance test checklist
 * - Manual trigger buttons for each pipeline stage
 * - Auto-refresh every 60 seconds
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { useAuth, getSupabaseClient } from '@/template';
import { useAdminRole } from '@/hooks/useAdminRole';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiHealth {
  provider: string;
  total_requests: number;
  success_rate_pct: number;
  error_rate_pct: number;
  last_called: string | null;
  last_error: string | null;
  status: 'healthy' | 'degraded' | 'critical' | 'never_called';
}

interface SportCoverage {
  sport: string;
  upcoming: number;  // maps to upcoming_future in v_sport_coverage
  live: number;      // maps to live_now
  finished: number;
  total: number;
  last_sync: string | null;
  hours_since_sync: number;
  sync_freshness: 'fresh' | 'ok' | 'stale' | 'very_stale';
  status: 'has_data' | 'no_data';
  // direct from v_sport_coverage
  coverage_status?: 'FULL' | 'PARTIAL' | 'HISTORICAL' | 'MISSING';
}

interface PredictionMetrics {
  recent_24h: number;
  avg_confidence: number;
  accuracy_7d: number | null;
  outcomes_tracked_7d: number;
  risk_distribution: Record<string, number>;
}

interface NextDayReadiness {
  target_date: string;
  total_fixtures: number;
  prediction_coverage_pct: number;
  sports_with_fixtures: Record<string, number>;
  readiness_targets: Array<{ metric: string; target: boolean; value: unknown }>;
  is_ready: boolean;
}

interface AcceptanceCheck {
  name: string;
  passed: boolean;
  value: string;
}

interface PipelineStageLog {
  stage: string;
  status: string;
  duration_ms: number;
  records_affected: number;
  error_message: string | null;
  completed_at: string | null;
}

interface SyncResult {
  success: boolean;
  fetched?: number;
  inserted?: number;
  elapsed_ms?: number;
  breakdown?: Record<string, number>;
  error?: string;
}

interface CronJob {
  job_name: string;
  cron_expression: string;
  description: string;
  edge_function: string | null;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string;
}

interface DashboardData {
  generated_at: string;
  api_health: ApiHealth[];
  sports_coverage: SportCoverage[];
  prediction_metrics: PredictionMetrics;
  next_day_readiness: NextDayReadiness;
  acceptance_report: { checks: AcceptanceCheck[]; overall_score: number; deployment_ready: boolean };
  pipeline: { stages: PipelineStageLog[]; unresolved_alerts: Array<Record<string, unknown>> };
  odds_coverage: { by_sport: Array<{ sport: string; upcoming_matches: number; coverage_pct: number }> };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '--:--'; }
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(status: string, C: AppColors): string {
  switch (status) {
    case 'healthy': case 'success': case 'fresh': return '#22C55E';
    case 'degraded': case 'partial': case 'ok': return '#F59E0B';
    case 'critical': case 'failed': case 'stale': return '#EF4444';
    case 'very_stale': return '#DC2626';
    case 'never_called': return C.textMuted;
    default: return C.textMuted;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'healthy': case 'success': case 'fresh': return 'checkmark-circle';
    case 'degraded': case 'partial': case 'ok': return 'warning-outline';
    case 'critical': case 'failed': return 'close-circle';
    default: return 'ellipse-outline';
  }
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon, children, C, badge, badgeColor }: {
  title: string; icon: string; children: React.ReactNode; C: AppColors;
  badge?: string; badgeColor?: string;
}) {
  return (
    <View style={[sc.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={sc.header}>
        <View style={[sc.iconWrap, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
          <Ionicons name={icon as any} size={13} color={C.primary} />
        </View>
        <Text style={[sc.title, { color: C.textPrimary }]}>{title}</Text>
        {badge ? (
          <View style={[sc.badge, { backgroundColor: `${badgeColor ?? C.primary}18`, borderColor: `${badgeColor ?? C.primary}44` }]}>
            <Text style={[sc.badgeText, { color: badgeColor ?? C.primary }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}
const sc = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconWrap: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: FONTS.bold, flex: 1 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: FONTS.extraBold },
});

// ─── API Provider Health Card ─────────────────────────────────────────────────
function ApiProviderRow({ api, C }: { api: ApiHealth; C: AppColors }) {
  const color = statusColor(api.status, C);
  return (
    <View style={[apr.row, { borderBottomColor: C.border }]}>
      <View style={[apr.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[apr.name, { color: C.textPrimary }]}>{api.provider}</Text>
        {api.last_error ? (
          <Text style={[apr.error, { color: C.accentRed }]} numberOfLines={1}>{api.last_error}</Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[apr.rate, { color }]}>{api.success_rate_pct}%</Text>
        <Text style={[apr.meta, { color: C.textMuted }]}>{api.total_requests} req</Text>
      </View>
      <View style={[apr.badge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
        <Text style={[apr.badgeText, { color }]}>{api.status.replace('_', ' ').toUpperCase()}</Text>
      </View>
    </View>
  );
}
const apr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  name: { fontSize: 12, fontWeight: FONTS.semiBold },
  error: { fontSize: 10, marginTop: 1 },
  rate: { fontSize: 15, fontWeight: FONTS.extraBold },
  meta: { fontSize: 9 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
});

// ─── Sport Coverage Row ───────────────────────────────────────────────────────
const SPORT_EMOJIS: Record<string, string> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
  baseball: '⚾', hockey: '🏒', rugby: '🏉', handball: '🤾',
  volleyball: '🏐', mma: '🥊', boxing: '🥊', 'american-football': '🏈',
  esports: '🎮', formula1: '🏎️', motorsports: '🏎️', 'table-tennis': '🏓',
  badminton: '🏸', snooker: '🎱', darts: '🎯', cycling: '🚴',
  athletics: '🏃', afl: '🏉',
};

function coverageStatusColor(status: string | undefined, C: AppColors): string {
  switch (status) {
    case 'FULL':       return '#22C55E';
    case 'PARTIAL':    return '#F59E0B';
    case 'HISTORICAL': return C.accentBlue ?? '#60A5FA';
    case 'MISSING':    return '#EF4444';
    default:           return C.textMuted;
  }
}

function SportCoverageRow({ sport, C }: { sport: SportCoverage; C: AppColors }) {
  const cs = sport.coverage_status;
  const color = coverageStatusColor(cs, C);
  const emoji = SPORT_EMOJIS[sport.sport] ?? '🏆';
  const displayName = sport.sport
    .split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return (
    <View style={[scr.row, { borderBottomColor: C.border }]}>
      <Text style={scr.emoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[scr.name, { color: C.textPrimary }]}>{displayName}</Text>
        <Text style={[scr.meta, { color: C.textMuted }]}>
          {sport.upcoming} upcoming · {sport.live} live · {sport.total} total
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <View style={[scr.freshBadge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
          <Text style={[scr.freshText, { color }]}>{cs ?? 'UNKNOWN'}</Text>
        </View>
        {sport.last_sync ? (
          <Text style={[scr.syncTime, { color: C.textMuted }]}>{fmtTime(sport.last_sync)}</Text>
        ) : (
          <Text style={[scr.syncTime, { color: '#EF4444' }]}>Never synced</Text>
        )}
      </View>
    </View>
  );
}
const scr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  emoji: { fontSize: 20, width: 28, textAlign: 'center' },
  name: { fontSize: 12, fontWeight: FONTS.semiBold },
  meta: { fontSize: 10, marginTop: 1 },
  freshBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  freshText: { fontSize: 9, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  syncTime: { fontSize: 9 },
});

// ─── Pipeline Stage Row ───────────────────────────────────────────────────────
function PipelineStageRow({ stage, C, onTrigger, triggering }: {
  stage: PipelineStageLog | null;
  C: AppColors;
  stageName: string;
  onTrigger: () => void;
  triggering: boolean;
}) {
  const s = stage;
  const color = s ? statusColor(s.status, C) : C.textMuted;
  return (
    <View style={[psr.row, { borderBottomColor: C.border }]}>
      <Ionicons name={s ? statusIcon(s.status) as any : 'ellipse-outline'} size={14} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[psr.name, { color: C.textPrimary }]}>{s?.stage ?? 'Not run'}</Text>
        {s?.error_message ? (
          <Text style={[psr.error, { color: C.accentRed }]} numberOfLines={1}>{s.error_message}</Text>
        ) : s ? (
          <Text style={[psr.meta, { color: C.textMuted }]}>
            {s.records_affected} records · {fmtDuration(s.duration_ms ?? 0)}
          </Text>
        ) : null}
      </View>
      {s ? (
        <View style={[psr.badge, { backgroundColor: `${color}14`, borderColor: `${color}33` }]}>
          <Text style={[psr.badgeText, { color }]}>{s.status.toUpperCase()}</Text>
        </View>
      ) : null}
      <Pressable onPress={onTrigger} disabled={triggering} hitSlop={8}
        style={({ pressed }) => [psr.btn, { borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}>
        {triggering
          ? <ActivityIndicator size="small" color={C.primary} />
          : <Ionicons name="play" size={12} color={C.primary} />}
      </Pressable>
    </View>
  );
}
const psr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 12, fontWeight: FONTS.semiBold },
  error: { fontSize: 10, marginTop: 1 },
  meta: { fontSize: 10, marginTop: 1 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontWeight: FONTS.extraBold },
  btn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ─── Readiness Score Ring ─────────────────────────────────────────────────────
function ReadinessScore({ score, isReady, C }: { score: number; isReady: boolean; C: AppColors }) {
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#F59E0B' : '#EF4444';
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View style={[rs.circle, { borderColor: color, backgroundColor: `${color}14` }]}>
        <Text style={[rs.score, { color }]}>{score}</Text>
        <Text style={[rs.label, { color: C.textMuted }]}>/ 100</Text>
      </View>
      <View style={[rs.pill, { backgroundColor: `${color}14`, borderColor: `${color}44` }]}>
        <Ionicons name={isReady ? 'checkmark-circle' : 'warning-outline'} size={10} color={color} />
        <Text style={[rs.pillText, { color }]}>{isReady ? 'READY' : 'NOT READY'}</Text>
      </View>
    </View>
  );
}
const rs = StyleSheet.create({
  circle: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 26, fontWeight: FONTS.extraBold },
  label: { fontSize: 9, marginTop: -4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminPipelineScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminRole(user?.id);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggeringStage, setTriggeringStage] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [dbCoverage, setDbCoverage] = useState<SportCoverage[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronExpanded, setCronExpanded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch pipeline_schedule table for cron job status ──────────────────────
  const fetchCronJobs = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: rows } = await supabase
        .from('pipeline_schedule')
        .select('job_name, cron_expression, description, edge_function, is_active, last_run_at, next_run_at, run_count, last_status')
        .order('next_run_at', { ascending: true });
      setCronJobs((rows ?? []) as CronJob[]);
    } catch { /* non-blocking */ }
  }, []);

  // ── Fetch coverage directly from v_sport_coverage DB view ─────────────────
  const fetchDbCoverage = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: rows, error: err } = await supabase
        .from('v_sport_coverage')
        .select('*');
      if (err) throw err;
      const mapped: SportCoverage[] = (rows ?? []).map((r: any) => ({
        sport: r.sport ?? '',
        upcoming: Number(r.upcoming_future ?? 0),
        live: Number(r.live_now ?? 0),
        finished: Number(r.finished ?? 0),
        total: Number(r.total ?? 0),
        last_sync: r.last_synced ?? null,
        hours_since_sync: r.last_synced
          ? Math.floor((Date.now() - new Date(r.last_synced).getTime()) / 3_600_000)
          : 9999,
        sync_freshness: (() => {
          const h = r.last_synced
            ? Math.floor((Date.now() - new Date(r.last_synced).getTime()) / 3_600_000)
            : 9999;
          return h < 4 ? 'fresh' : h < 12 ? 'ok' : h < 48 ? 'stale' : 'very_stale';
        })() as any,
        status: (Number(r.total ?? 0) > 0 ? 'has_data' : 'no_data') as any,
        coverage_status: (r.coverage_status ?? 'MISSING') as any,
      }));
      setDbCoverage(mapped);
    } catch { /* non-blocking */ }
  }, []);

  // ── Trigger fetch-matches for all sports ─────────────────────────────────
  const triggerSyncAllSports = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const supabase = getSupabaseClient();
      // Uses midnight-preload stage:'fixtures' which runs 21 sports in parallel.
      // Direct fetch-matches with sport:'all' always 499s (TSDB throttle ~63s > 55s timeout).
      const { data: resp, error: err } = await supabase.functions.invoke('midnight-preload', {
        body: { stage: 'fixtures' },
      });
      if (err) {
        let msg = err.message;
        if (err instanceof FunctionsHttpError) {
          try { const t = await err.context?.text(); msg = t || msg; } catch { /* */ }
        }
        setSyncResult({ success: false, error: msg });
      } else {
        const r = resp as Record<string, unknown>;
        const summary = r?.summary as Record<string, unknown> | undefined;
        const stages = r?.stages as Array<Record<string, unknown>> | undefined;
        const fixtureStage = stages?.find(s => s.stage === 'fixtures');
        const records = Number(fixtureStage?.records ?? summary?.totalRecords ?? 0);
        setSyncResult({
          success: r?.success === true || r?.overallStatus === 'success' || r?.overallStatus === 'partial',
          fetched: records,
          inserted: records,
          elapsed_ms: Number(r?.totalDurationMs ?? 0),
        });
        setTimeout(() => { fetchDbCoverage(); fetchDashboard(true); }, 3000);
      }
    } catch (e: any) {
      setSyncResult({ success: false, error: e?.message });
    } finally {
      setSyncing(false);
    }
  }, [fetchDbCoverage]);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: resp, error: err } = await supabase.functions.invoke('monitoring-dashboard', {
        body: { section: 'all' },
      });
      if (err) {
        let msg = err.message;
        if (err instanceof FunctionsHttpError) {
          try { const t = await err.context?.text(); msg = t || msg; } catch { /* */ }
        }
        throw new Error(msg);
      }
      setData(resp as DashboardData);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchDbCoverage();
    fetchCronJobs();
    intervalRef.current = setInterval(() => { fetchDashboard(true); fetchDbCoverage(); fetchCronJobs(); }, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const triggerStage = useCallback(async (stage: string) => {
    setTriggeringStage(stage);
    setTriggerResult(null);
    try {
      const supabase = getSupabaseClient();
      const { data: resp, error: err } = await supabase.functions.invoke('daily-scheduler', {
        body: { mode: 'stage', stage },
      });
      if (err) {
        let msg = err.message;
        if (err instanceof FunctionsHttpError) {
          try { const t = await err.context?.text(); msg = t || msg; } catch { /* */ }
        }
        setTriggerResult(`❌ ${stage}: ${msg}`);
      } else {
        const r = resp as Record<string, unknown>;
        const report = r?.report as Record<string, unknown>;
        const stages = (report?.stages as Array<Record<string, unknown>>) ?? [];
        const stageResult = stages.find(s => s.stage === stage);
        setTriggerResult(`✅ ${stage}: ${stageResult?.status ?? 'triggered'} — ${stageResult?.records_affected ?? 0} records`);
        fetchDashboard(true);
      }
    } catch (e: any) {
      setTriggerResult(`❌ ${stage}: ${e?.message}`);
    } finally {
      setTriggeringStage(null);
    }
  }, [fetchDashboard]);

  const triggerFullPipeline = useCallback(async () => {
    setTriggeringStage('full');
    setTriggerResult(null);
    try {
      const supabase = getSupabaseClient();
      const { data: resp, error: err } = await supabase.functions.invoke('midnight-preload', {
        body: { stage: 'all' },
      });
      if (err) {
        let msg = err.message;
        if (err instanceof FunctionsHttpError) {
          try { const t = await err.context?.text(); msg = t || msg; } catch { /* */ }
        }
        setTriggerResult(`❌ Pipeline: ${msg}`);
      } else {
        const r = resp as Record<string, unknown>;
        const summary = r?.summary as Record<string, unknown> | undefined;
        const failed = Number(summary?.failedStages ?? 0);
        const total = Number(summary?.totalRecords ?? 0);
        setTriggerResult(
          `✅ Pipeline: ${r?.overallStatus ?? 'complete'} — ${total} records, ${failed} failure(s) in ${((Number(r?.totalDurationMs ?? 0)) / 1000).toFixed(1)}s`,
        );
        setTimeout(() => { fetchDashboard(true); fetchDbCoverage(); }, 2000);
      }
    } catch (e: any) {
      setTriggerResult(`❌ Pipeline: ${e?.message}`);
    } finally {
      setTriggeringStage(null);
    }
  }, [fetchDashboard]);

  const PIPELINE_STAGES = [
    { key: 'fetch_fixtures', label: 'Fetch Fixtures' },
    { key: 'validate_fixtures', label: 'Validate Fixtures' },
    { key: 'fetch_odds', label: 'Fetch Odds' },
    { key: 'fetch_standings', label: 'Sync Standings' },
    { key: 'generate_predictions', label: 'Generate Predictions' },
    { key: 'quality_gate', label: 'Quality Gate' },
    { key: 'cache_warm', label: 'Warm Cache' },
    { key: 'generate_challenge', label: 'Daily Challenge' },
  ];

  const stageMap = new Map<string, PipelineStageLog>(
    (data?.pipeline?.stages ?? []).map(s => [s.stage, s])
  );

  if (adminLoading || loading) {
    return (
      <View style={[s.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}>
          <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
            </Pressable>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Pipeline Monitor</Text>
            <View style={{ width: 32 }} />
          </View>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.textMuted, marginTop: 12, fontSize: 13 }}>Loading dashboard...</Text>
        </View>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <Ionicons name="lock-closed" size={48} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: 15 }}>Admin access required</Text>
        <Pressable onPress={() => router.back()} style={[s.btn, { backgroundColor: C.primary }]}>
          <Text style={[s.btnText, { color: C.textInverse }]}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Pipeline Monitor</Text>
            {data?.generated_at ? (
              <Text style={{ fontSize: 9, color: C.textMuted, marginTop: 1 }}>Updated {fmtTime(data.generated_at)}</Text>
            ) : null}
          </View>
          <Pressable onPress={() => fetchDashboard(true)} hitSlop={8} disabled={refreshing}>
            {refreshing ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="refresh" size={20} color={C.primary} />}
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchDashboard(true)} tintColor={C.primary} />}
      >
        {error ? (
          <View style={[s.errorBanner, { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}33` }]}>
            <Ionicons name="warning-outline" size={14} color={C.accentRed} />
            <Text style={[s.errorText, { color: C.accentRed }]}>{error}</Text>
          </View>
        ) : null}

        {triggerResult ? (
          <View style={[s.resultBanner, { backgroundColor: triggerResult.startsWith('✅') ? '#22C55E14' : `${C.accentRed}14`, borderColor: triggerResult.startsWith('✅') ? '#22C55E33' : `${C.accentRed}33` }]}>
            <Text style={{ fontSize: 12, color: triggerResult.startsWith('✅') ? '#22C55E' : C.accentRed, fontWeight: FONTS.semiBold }}>{triggerResult}</Text>
            <Pressable onPress={() => setTriggerResult(null)} hitSlop={8}>
              <Ionicons name="close" size={14} color={C.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {syncResult ? (
          <View style={[s.resultBanner, {
            backgroundColor: syncResult.success ? '#22C55E14' : `${C.accentRed}14`,
            borderColor: syncResult.success ? '#22C55E33' : `${C.accentRed}33`,
          }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: syncResult.success ? '#22C55E' : C.accentRed }}>
                {syncResult.success
                  ? `✅ Sync complete — ${syncResult.inserted ?? 0} upserted, ${syncResult.fetched ?? 0} fetched in ${((syncResult.elapsed_ms ?? 0)/1000).toFixed(1)}s`
                  : `❌ Sync failed: ${syncResult.error}`}
              </Text>
              {syncResult.success && syncResult.breakdown ? (
                <Text style={{ fontSize: 10, color: '#22C55E', marginTop: 3 }}>
                  {Object.entries(syncResult.breakdown)
                    .filter(([,v]) => v > 0)
                    .map(([k,v]) => `${k}:${v}`)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => setSyncResult(null)} hitSlop={8}>
              <Ionicons name="close" size={14} color={C.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {/* ── Action buttons row ── */}
        <View style={s.actionRow}>
          {/* Full pipeline trigger */}
          <Pressable
            onPress={triggerFullPipeline}
            disabled={triggeringStage === 'full' || syncing}
            style={({ pressed }) => [
              s.bigBtn, { flex: 1 },
              { backgroundColor: triggeringStage === 'full' ? C.card : C.primary, borderColor: C.primary },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            {triggeringStage === 'full'
              ? <ActivityIndicator size="small" color={C.textInverse} />
              : <FontAwesome5 name="play-circle" size={14} color={C.textInverse} />}
            <Text style={[s.bigBtnText, { fontSize: 13, color: triggeringStage === 'full' ? C.textMuted : C.textInverse }]}>
              {triggeringStage === 'full' ? 'Running...' : 'Run Pipeline'}
            </Text>
          </Pressable>

          {/* Sync all sports button */}
          <Pressable
            onPress={triggerSyncAllSports}
            disabled={syncing || triggeringStage === 'full'}
            style={({ pressed }) => [
              s.bigBtn, { flex: 1,
                backgroundColor: syncing ? C.card : '#22C55E',
                borderColor: '#22C55E',
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            {syncing
              ? <ActivityIndicator size="small" color="#22C55E" />
              : <Ionicons name="sync" size={14} color="#fff" />}
            <Text style={[s.bigBtnText, { fontSize: 13, color: syncing ? C.textMuted : '#fff' }]}>
              {syncing ? 'Syncing...' : 'Sync All Sports'}
            </Text>
          </Pressable>
        </View>

        {/* ── Readiness Score ── */}
        {data?.next_day_readiness ? (
          <SectionCard title="Next-Day Readiness" icon="calendar-outline" C={C}
            badge={data.next_day_readiness.target_date}
            badgeColor={data.next_day_readiness.is_ready ? '#22C55E' : '#F59E0B'}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <ReadinessScore
                score={data.acceptance_report?.overall_score ?? 0}
                isReady={data.next_day_readiness.is_ready}
                C={C}
              />
              <View style={{ flex: 1, gap: 6 }}>
                {(data.acceptance_report?.checks ?? []).map((check) => (
                  <View key={check.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Ionicons
                      name={check.passed ? 'checkmark-circle' : 'ellipse-outline'}
                      size={13}
                      color={check.passed ? '#22C55E' : C.textMuted}
                    />
                    <Text style={{ fontSize: 11, color: check.passed ? C.textSecondary : C.textMuted, flex: 1 }} numberOfLines={1}>
                      {check.name}
                    </Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>{String(check.value)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </SectionCard>
        ) : null}

        {/* ── Pipeline Stages ── */}
        <SectionCard title="Pipeline Stages" icon="git-network-outline" C={C}>
          {PIPELINE_STAGES.map((ps) => (
            <PipelineStageRow
              key={ps.key}
              stageName={ps.key}
              stage={stageMap.get(ps.key) ?? null}
              C={C}
              onTrigger={() => triggerStage(ps.key)}
              triggering={triggeringStage === ps.key}
            />
          ))}
        </SectionCard>

        {/* ── API Health ── */}
        {data?.api_health && data.api_health.length > 0 ? (
          <SectionCard title="API Provider Health" icon="cloud-outline" C={C}
            badge={`${data.api_health.filter(a => a.status === 'healthy').length}/${data.api_health.length} OK`}
            badgeColor={data.api_health.some(a => a.status === 'critical') ? '#EF4444' : '#22C55E'}
          >
            {data.api_health.slice(0, 8).map((api) => (
              <ApiProviderRow key={api.provider} api={api} C={C} />
            ))}
          </SectionCard>
        ) : null}

        {/* ── Prediction Metrics ── */}
        {data?.prediction_metrics ? (
          <SectionCard title="Prediction Metrics" icon="analytics-outline" C={C}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { label: 'Last 24h', value: String(data.prediction_metrics.recent_24h), color: C.primary },
                { label: 'Avg Conf', value: `${data.prediction_metrics.avg_confidence}%`, color: '#22C55E' },
                { label: '7d Accuracy', value: data.prediction_metrics.accuracy_7d !== null ? `${data.prediction_metrics.accuracy_7d}%` : 'N/A', color: '#F59E0B' },
                { label: 'Outcomes', value: String(data.prediction_metrics.outcomes_tracked_7d), color: C.textSecondary },
              ].map((m) => (
                <View key={m.label} style={[pmRow.cell, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Text style={[pmRow.val, { color: m.color }]}>{m.value}</Text>
                  <Text style={[pmRow.lbl, { color: C.textMuted }]}>{m.label}</Text>
                </View>
              ))}
            </View>
          </SectionCard>
        ) : null}

        {/* ── Sports Coverage (from v_sport_coverage view) ── */}
        <SectionCard
          title="Sports Coverage (22 Sports)"
          icon="football-outline"
          C={C}
          badge={dbCoverage.length > 0
            ? `${dbCoverage.filter(s => s.coverage_status === 'FULL').length} FULL · ${dbCoverage.filter(s => s.coverage_status === 'MISSING').length} MISSING`
            : data?.sports_coverage ? `${data.sports_coverage.filter(s => s.status === 'has_data').length} sports` : undefined}
          badgeColor={dbCoverage.some(s => s.coverage_status === 'MISSING') ? '#EF4444' : '#22C55E'}
        >
          {(dbCoverage.length > 0 ? dbCoverage : (data?.sports_coverage ?? [])).map((sport) => (
            <SportCoverageRow key={sport.sport} sport={sport} C={C} />
          ))}
          {dbCoverage.length === 0 && (data?.sports_coverage ?? []).length === 0 ? (
            <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>Loading coverage...</Text>
          ) : null}
        </SectionCard>

        {/* ── Alerts ── */}
        {data?.pipeline?.unresolved_alerts && data.pipeline.unresolved_alerts.length > 0 ? (
          <SectionCard title={`Active Alerts (${data.pipeline.unresolved_alerts.length})`} icon="warning-outline" C={C}
            badge={String(data.pipeline.unresolved_alerts.length)}
            badgeColor='#EF4444'
          >
            {data.pipeline.unresolved_alerts.slice(0, 5).map((alert, i) => (
              <View key={i} style={[alertRow.row, { borderBottomColor: C.border }]}>
                <View style={[alertRow.dot, {
                  backgroundColor: (alert.severity as string) === 'critical' ? '#EF4444' : '#F59E0B',
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[alertRow.type, { color: C.textPrimary }]}>{alert.alert_type as string}</Text>
                  <Text style={[alertRow.msg, { color: C.textMuted }]} numberOfLines={2}>{alert.message as string}</Text>
                </View>
                <Text style={{ fontSize: 8, color: C.textMuted }}>{fmtTime(alert.created_at as string)}</Text>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {/* ── Cron Schedule ── */}
        <SectionCard
          title={`Cron Schedule (${cronJobs.filter(j => j.is_active).length} active)`}
          icon="time-outline"
          C={C}
          badge={cronExpanded ? 'Collapse' : 'Expand'}
          badgeColor={C.primary}
        >
          <Pressable
            onPress={() => setCronExpanded(v => !v)}
            style={{ marginBottom: cronExpanded ? 8 : 0 }}
          >
            <Text style={{ fontSize: 11, color: C.textMuted }}>
              {cronExpanded
                ? 'Tap to collapse schedule details'
                : `${cronJobs.length} jobs registered — tap to view schedule`}
            </Text>
          </Pressable>

          {cronExpanded ? cronJobs.map((job) => {
            const isOk    = job.last_status === 'success' || job.last_status === 'pending';
            const color   = job.is_active ? (isOk ? '#22C55E' : '#EF4444') : C.textMuted;
            const lastRan = job.last_run_at
              ? (() => {
                  const d = Math.floor((Date.now() - new Date(job.last_run_at).getTime()) / 60_000);
                  return d < 60 ? `${d}m ago` : `${Math.floor(d / 60)}h ago`;
                })()
              : 'never';
            const nextRun = job.next_run_at
              ? (() => {
                  const d = Math.ceil((new Date(job.next_run_at).getTime() - Date.now()) / 60_000);
                  return d < 0 ? 'overdue' : d < 60 ? `in ${d}m` : `in ${Math.floor(d / 60)}h`;
                })()
              : '--';
            return (
              <View key={job.job_name} style={[cronRow.row, { borderBottomColor: C.border }]}>
                <View style={[cronRow.dot, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[cronRow.name, { color: C.textPrimary }]} numberOfLines={1}>
                    {job.job_name.replace('predictxta-', '')}
                  </Text>
                  <Text style={[cronRow.desc, { color: C.textMuted }]} numberOfLines={1}>
                    {job.description}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={[cronRow.cron, { color: C.primary }]}>{job.cron_expression}</Text>
                  <Text style={[cronRow.meta, { color: C.textMuted }]}>
                    last: {lastRan} · next: {nextRun}
                  </Text>
                  <Text style={[cronRow.meta, { color: C.textMuted }]}>
                    runs: {job.run_count}
                  </Text>
                </View>
                {!job.is_active ? (
                  <View style={[cronRow.badge, { backgroundColor: `${C.textMuted}18`, borderColor: `${C.textMuted}44` }]}>
                    <Text style={[cronRow.badgeText, { color: C.textMuted }]}>OFF</Text>
                  </View>
                ) : (
                  <View style={[cronRow.badge, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
                    <Text style={[cronRow.badgeText, { color }]}>{job.last_status.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            );
          }) : null}

          {cronExpanded && cronJobs.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
              <Ionicons name="warning-outline" size={24} color="#F59E0B" />
              <Text style={{ fontSize: 12, color: '#F59E0B', textAlign: 'center', fontWeight: FONTS.semiBold }}>
                No cron jobs found in pipeline_schedule
              </Text>
              <Text style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 17 }}>
                pg_cron must be enabled first:{`\n`}
                Dashboard → Database → Extensions → pg_cron{`\n`}
                Then run scripts/setup-cron-schedules.sql
              </Text>
            </View>
          ) : null}
        </SectionCard>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const pmRow = StyleSheet.create({
  cell: { flex: 1, alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 10 },
  val: { fontSize: 18, fontWeight: FONTS.extraBold },
  lbl: { fontSize: 9, marginTop: 2, fontWeight: FONTS.medium },
});

const cronRow = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0, marginTop: 2 },
  name: { fontSize: 12, fontWeight: FONTS.bold },
  desc: { fontSize: 10, marginTop: 1 },
  cron: { fontSize: 11, fontWeight: FONTS.semiBold, fontVariant: ['tabular-nums'] as any },
  meta: { fontSize: 9 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
});

const alertRow = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 3, flexShrink: 0 },
  type: { fontSize: 11, fontWeight: FONTS.bold },
  msg: { fontSize: 10, marginTop: 2, lineHeight: 15 },
});

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 12 },
  resultBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  bigBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 13, borderWidth: 1 },
  bigBtnText: { fontSize: 15, fontWeight: FONTS.extraBold },
  btn: { borderRadius: RADIUS.full, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { fontSize: 14, fontWeight: FONTS.bold },
});
