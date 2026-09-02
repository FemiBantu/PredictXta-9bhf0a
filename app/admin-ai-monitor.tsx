/**
 * app/admin-ai-monitor.tsx — Phase 5 Admin AI Monitoring Dashboard
 *
 * Shows real-time production metrics for the PredictXta prediction engine:
 *   - AI provider circuit health (OpenAI, Claude, Gemini, Groq)
 *   - Prediction pipeline stats (generated, quality-gate score, DQ score)
 *   - Calibration accuracy per sport (Brier score, accuracy%, drift)
 *   - Active alerts from pipeline_alerts + ai_governance_log
 *   - Prediction job queue status breakdown
 *   - Feed cache freshness
 *
 * Admin-only: gated by useAdminRole()
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useAdminRole } from '@/hooks/useAdminRole';
import { getSupabaseClient } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProviderCircuit {
  provider: string;
  circuitOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}

interface AccuracyStat {
  sport: string;
  n: number;
  accuracy_pct: number;
  brier_avg: number;
}

interface Alert {
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
}

interface MonitoringData {
  infrastructure: Record<string, unknown>;
  fixtures: { live_count: number; upcoming_24h: number };
  predictions: {
    generated_last_24h: number;
    avg_confidence: number;
    avg_dq_score: number;
    avg_quality_gate: number;
    job_status_breakdown: Record<string, number>;
    ai_provider_breakdown: Record<string, { calls: number; avgLatency: number; approved: number }>;
  };
  accuracy: { by_sport: AccuracyStat[]; total_settled: number; calibration_drift_sports: string[] };
  alerts: { active: Alert[]; governance: unknown[] };
  generated_at: string;
  elapsed_ms: number;
}

export default function AdminAIMonitorScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdminRole();

  const [data, setData]         = useState<MonitoringData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const fetchMonitoring = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: result, error: fnError } = await supabase.functions.invoke('monitoring-dashboard', {
        body: {},
      });
      if (fnError) { setError('Monitoring unavailable'); return; }
      setData(result as MonitoringData);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!adminLoading && isAdmin) fetchMonitoring();
    else if (!adminLoading && !isAdmin) setLoading(false);
  }, [isAdmin, adminLoading]);

  const onRefresh = () => { setRefreshing(true); fetchMonitoring(); };

  const severityColor = (sev: string) => {
    if (sev === 'critical') return '#EF4444';
    if (sev === 'warning')  return '#F59E0B';
    return C.textMuted;
  };

  const circuitColor = (open: boolean) => open ? '#EF4444' : '#22C55E';

  if (adminLoading || loading) return (
    <SafeAreaView style={[s.container, { backgroundColor: C.bg }]} edges={['top']}>
      <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  if (!isAdmin) return (
    <SafeAreaView style={[s.container, { backgroundColor: C.bg }]} edges={['top']}>
      <Text style={[s.errorText, { color: C.accentRed }]}>Admin access required</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: C.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: C.text }]}>AI Monitor</Text>
        <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="refresh" size={22} color={C.primary} />
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={[s.errorText, { color: C.accentRed }]}>{error}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Last Updated */}
          {data && (
            <Text style={[s.lastUpdated, { color: C.textMuted }]}>
              Updated {data?.generated_at ? new Date(data.generated_at).toLocaleTimeString() : '—'} · {data?.elapsed_ms}ms
            </Text>
          )}

          {/* Fixture Counts */}
          {data?.fixtures && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>Fixtures</Text>
              <View style={s.row}>
                <MetricChip label="Live" value={data.fixtures.live_count} color="#EF4444" />
                <MetricChip label="Upcoming 24h" value={data.fixtures.upcoming_24h} color={C.primary} />
              </View>
            </View>
          )}

          {/* Prediction Pipeline */}
          {data?.predictions && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>Predictions (last 24h)</Text>
              <View style={s.row}>
                <MetricChip label="Generated"    value={data.predictions.generated_last_24h} color="#22C55E" />
                <MetricChip label="Avg Conf"     value={`${data.predictions.avg_confidence}%`} color={C.primary} />
                <MetricChip label="Avg DQ"       value={`${data.predictions.avg_dq_score}`}    color="#F59E0B" />
                <MetricChip label="Avg Gate"     value={`${data.predictions.avg_quality_gate}`} color="#8B5CF6" />
              </View>
              {/* Job status */}
              {Object.entries(data.predictions.job_status_breakdown).length > 0 && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[s.subTitle, { color: C.textMuted }]}>Job Queue</Text>
                  <View style={s.row}>
                    {Object.entries(data.predictions.job_status_breakdown).map(([status, count]) => (
                      <MetricChip
                        key={status}
                        label={status}
                        value={count as number}
                        color={status === 'published' ? '#22C55E' : status === 'failed' ? '#EF4444' : C.textMuted}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* AI Provider Breakdown */}
          {data?.predictions?.ai_provider_breakdown && Object.keys(data.predictions.ai_provider_breakdown).length > 0 && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>AI Providers (last 1h)</Text>
              {Object.entries(data.predictions.ai_provider_breakdown).map(([prov, stats]) => (
                <View key={prov} style={[s.providerRow, { borderBottomColor: C.border }]}>
                  <Text style={[s.provName, { color: C.text }]}>{prov.toUpperCase()}</Text>
                  <Text style={[s.provStat, { color: C.textMuted }]}>{stats.calls} calls</Text>
                  <Text style={[s.provStat, { color: C.textMuted }]}>{stats.avgLatency}ms avg</Text>
                  <Text style={[s.provStat, { color: stats.approved === stats.calls ? '#22C55E' : '#F59E0B' }]}>
                    {stats.approved}/{stats.calls} approved
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Accuracy by Sport */}
          {data?.accuracy?.by_sport && data.accuracy.by_sport.length > 0 && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>
                Accuracy (30d · {data.accuracy.total_settled} settled)
              </Text>
              {data.accuracy.calibration_drift_sports.length > 0 && (
                <Text style={[s.driftWarning, { color: '#F59E0B' }]}>
                  ⚠ Calibration drift: {data.accuracy.calibration_drift_sports.join(', ')}
                </Text>
              )}
              {data.accuracy.by_sport.slice(0, 8).map(stat => (
                <View key={stat.sport} style={[s.sportRow, { borderBottomColor: C.border }]}>
                  <Text style={[s.sportName, { color: C.text }]}>{stat.sport}</Text>
                  <Text style={[s.sportAcc, { color: stat.accuracy_pct >= 60 ? '#22C55E' : stat.accuracy_pct >= 50 ? '#F59E0B' : '#EF4444' }]}>
                    {stat.accuracy_pct}%
                  </Text>
                  <Text style={[s.sportBrier, { color: C.textMuted }]}>Brier {stat.brier_avg}</Text>
                  <Text style={[s.sportN, { color: C.textMuted }]}>n={stat.n}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Active Alerts */}
          {data?.alerts?.active && data.alerts.active.length > 0 && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>
                Active Alerts ({data.alerts.active.length})
              </Text>
              {data.alerts.active.slice(0, 5).map((alert, i) => (
                <View key={i} style={[s.alertRow, { borderLeftColor: severityColor(alert.severity) }]}>
                  <Text style={[s.alertType, { color: severityColor(alert.severity) }]}>
                    {alert.severity.toUpperCase()} · {alert.alert_type}
                  </Text>
                  <Text style={[s.alertMsg, { color: C.textMuted }]} numberOfLines={2}>{alert.message}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Infrastructure */}
          {data?.infrastructure && (
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.cardTitle, { color: C.text }]}>Infrastructure</Text>
              {Object.entries(data.infrastructure.ai_providers as Record<string, string> ?? {}).map(([p, status]) => (
                <View key={p} style={s.infraRow}>
                  <Text style={[s.infraName, { color: C.text }]}>{p}</Text>
                  <Text style={[s.infraStatus, { color: status === 'configured' ? '#22C55E' : '#EF4444' }]}>
                    {status}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetricChip({ label, value, color }: { label: string; value: number | string; color: string }) {
  const { colors: C } = useTheme();
  return (
    <View style={[chip.wrap, { backgroundColor: color + '18', borderColor: color + '30' }]}>
      <Text style={[chip.value, { color }]}>{value}</Text>
      <Text style={[chip.label, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap:  { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: 'center', margin: 4 },
  value: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 11, marginTop: 2 },
});

const s = StyleSheet.create({
  container:   { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  scroll:      { paddingHorizontal: 16, paddingTop: 8 },
  lastUpdated: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  card:        { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle:   { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  subTitle:    { fontSize: 12, marginBottom: 6 },
  row:         { flexDirection: 'row', flexWrap: 'wrap' },
  providerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1 },
  provName:    { fontSize: 13, fontWeight: '600', flex: 1 },
  provStat:    { fontSize: 12, marginLeft: 8 },
  sportRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  sportName:   { flex: 1, fontSize: 13, fontWeight: '500' },
  sportAcc:    { fontSize: 14, fontWeight: '700', width: 44 },
  sportBrier:  { fontSize: 11, width: 64 },
  sportN:      { fontSize: 11, width: 44 },
  driftWarning:{ fontSize: 12, marginBottom: 8, fontWeight: '600' },
  alertRow:    { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  alertType:   { fontSize: 12, fontWeight: '700' },
  alertMsg:    { fontSize: 12, marginTop: 2 },
  infraRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infraName:   { fontSize: 13, fontWeight: '500' },
  infraStatus: { fontSize: 13, fontWeight: '600' },
  errorText:   { textAlign: 'center', marginTop: 40, fontSize: 14, padding: 16 },
});
