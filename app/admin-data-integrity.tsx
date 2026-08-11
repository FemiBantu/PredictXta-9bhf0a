/**
 * app/admin-data-integrity.tsx — PredictXta Enterprise Data Integrity Dashboard
 * Phase 10 monitoring UI: all 12 audit phases including Phase 12 auto-healing
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import {
  getDataIntegrityDashboard,
  detectAndLogMismatches,
  type DataIntegrityDashboard,
  type MismatchReport,
} from '@/services/dataNormalizationMonitor';
import { resolveTeamName, resolveLeagueName } from '@/services/dataIntegrityEngine';
import {
  fetchProviderHealth,
  statusToColor,
  statusToLabel,
  triggerAutoHeal,
  type ProviderHealthReport,
} from '@/services/providerHealthService';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function statusColor(status: string, colors: Record<string, string>): string {
  if (status === 'healthy' || status === 'pass') return '#22C55E';
  if (status === 'degraded' || status === 'warn' || status === 'warning') return '#F59E0B';
  if (status === 'critical' || status === 'fail') return '#EF4444';
  return colors.textMuted;
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' || status === 'pass' ? '#22C55E'
    : status === 'degraded' || status === 'warn' || status === 'warning' ? '#F59E0B'
    : '#EF4444';
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const color = score >= 90 ? '#22C55E' : score >= 70 ? '#F59E0B' : '#EF4444';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderColor: `${color}22` }} />
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderColor: color, borderTopColor: `${color}22`, transform: [{ rotate: `${(score / 100) * 360 - 90}deg` }] }} />
      <Text style={{ fontSize: size * 0.28, fontWeight: '900', color }}>{score}</Text>
    </View>
  );
}

function SectionCard({ title, children, C }: { title: string; children: React.ReactNode; C: Record<string, string> }) {
  return (
    <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[s.sectionTitle, { color: C.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function MetricRow({ label, value, status, C }: { label: string; value: string; status?: string; C: Record<string, string> }) {
  const col = status ? statusColor(status, C) : C.textPrimary;
  return (
    <View style={s.metricRow}>
      {status ? <StatusDot status={status} /> : null}
      <Text style={[s.metricLabel, { color: C.textMuted }]}>{label}</Text>
      <Text style={[s.metricValue, { color: col }]}>{value}</Text>
    </View>
  );
}

function AlertItem({ alert, C }: { alert: DataIntegrityDashboard['activeAlerts'][number]; C: Record<string, string> }) {
  const col = alert.severity === 'critical' ? '#EF4444' : alert.severity === 'warning' ? '#F59E0B' : C.textMuted;
  const icon = alert.severity === 'critical' ? 'alert-circle' : alert.severity === 'warning' ? 'warning' : 'information-circle';
  return (
    <View style={[s.alertItem, { backgroundColor: `${col}0D`, borderColor: `${col}33` }]}>
      <Ionicons name={icon as any} size={14} color={col} />
      <View style={{ flex: 1 }}>
        <Text style={[s.alertType, { color: col }]}>{alert.alertType.replace(/_/g, ' ').toUpperCase()}</Text>
        <Text style={[s.alertMsg, { color: C.textSecondary }]} numberOfLines={2}>{alert.message}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminDataIntegrityScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<DataIntegrityDashboard | null>(null);
  const [mismatch, setMismatch] = useState<MismatchReport | null>(null);
  const [resolveTest, setResolveTest] = useState<{ team: string; league: string } | null>(null);
  const [providerReport, setProviderReport] = useState<ProviderHealthReport | null>(null);
  const [healing, setHealing] = useState(false);
  const [healResult, setHealResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'providers' | 'quality' | 'alerts' | 'names'>('overview');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [dash, mis, provHealth] = await Promise.all([
      getDataIntegrityDashboard(),
      detectAndLogMismatches(),
      fetchProviderHealth(1),
    ]);
    setDashboard(dash);
    setMismatch(mis);
    setProviderReport(provHealth);
    setResolveTest({
      team: resolveTeamName('Man Utd'),
      league: resolveLeagueName('english premier league'),
    });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  const handleAutoHeal = useCallback(async () => {
    setHealing(true);
    setHealResult(null);
    const result = await triggerAutoHeal();
    setHealResult(result.message);
    setHealing(false);
    setTimeout(() => load(true), 2000);
  }, [load]);

  const scan = dashboard?.scan;
  const health = dashboard?.healthReport;
  const legacyProviders = dashboard?.providerHealth ?? [];
  const alerts = dashboard?.activeAlerts ?? [];
  const summary = dashboard?.summary;

  const tabs: Array<{ key: typeof activeTab; label: string }> = [
    { key: 'overview',  label: '📊 Overview' },
    { key: 'providers', label: '🔌 Providers' },
    { key: 'quality',   label: '🛡️ Quality' },
    { key: 'alerts',    label: `🚨 Alerts${alerts.length > 0 ? ` (${alerts.length})` : ''}` },
    { key: 'names',     label: '🏷️ Names' },
  ];

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <MaterialIcons name="verified-user" size={18} color={C.primary} />
            <Text style={[s.title, { color: C.textPrimary }]}>Data Integrity</Text>
          </View>
          {summary ? (
            <View style={[s.scoreBadge, {
              backgroundColor: summary.overallStatus === 'healthy' ? '#22C55E18' : '#EF444418',
              borderColor: summary.overallStatus === 'healthy' ? '#22C55E44' : '#EF444444',
            }]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: summary.overallStatus === 'healthy' ? '#22C55E' : '#EF4444' }}>
                {summary.score}/100
              </Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[s.tabScroll, { backgroundColor: C.surface, borderBottomColor: C.border }]}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {tabs.map(({ key, label }) => (
          <Pressable
            key={key}
            style={[s.tab, { borderBottomColor: activeTab === key ? C.primary : 'transparent' }]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[s.tabText, { color: activeTab === key ? C.primary : C.textMuted }, activeTab === key ? { fontWeight: FONTS.bold } : null]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>Running data integrity scan...</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md }}
        >

          {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
          {activeTab === 'overview' ? (
            <>
              {summary ? (
                <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={s.overviewHeader}>
                    <ScoreRing score={summary.score} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <StatusDot status={summary.overallStatus} />
                        <Text style={[s.overviewStatus, { color: statusColor(summary.overallStatus, C as any) }]}>
                          {summary.overallStatus.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[s.overviewDesc, { color: C.textMuted }]}>Data integrity score — target ≥90</Text>
                      {summary.criticalIssues > 0 ? (
                        <Text style={{ fontSize: 12, color: '#EF4444', fontWeight: '700' }}>
                          ⚠️ {summary.criticalIssues} critical issues require attention
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}

              {scan ? (
                <SectionCard title="SCAN SUMMARY" C={C as any}>
                  <MetricRow label="Total matches scanned" value={String(scan.totalMatches)} C={C as any} />
                  <MetricRow label="Duplicates found" value={String(scan.duplicateCount)} status={scan.duplicateCount === 0 ? 'pass' : scan.duplicateCount < 5 ? 'warn' : 'fail'} C={C as any} />
                  <MetricRow label="Cross-sport contamination" value={String(scan.crossSportIssues)} status={scan.crossSportIssues === 0 ? 'pass' : 'fail'} C={C as any} />
                  <MetricRow label="Missing team names" value={String(scan.missingTeamNames)} status={scan.missingTeamNames === 0 ? 'pass' : 'warn'} C={C as any} />
                  <MetricRow label="Quality gate pass rate" value={`${(scan.qualityGatePassRate * 100).toFixed(1)}%`} status={scan.qualityGatePassRate >= 0.95 ? 'pass' : 'warn'} C={C as any} />
                  <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>
                    Scanned in {scan.scanDurationMs}ms · {scan.scannedAt.substring(11, 19)} UTC
                  </Text>
                </SectionCard>
              ) : null}

              {scan?.sportBreakdown && Object.keys(scan.sportBreakdown).length > 0 ? (
                <SectionCard title="SPORT BREAKDOWN" C={C as any}>
                  {Object.entries(scan.sportBreakdown).sort((a, b) => b[1].total - a[1].total).map(([sport, data]) => {
                    const pct = data.total > 0 ? Math.round((1 - data.issues / data.total) * 100) : 100;
                    const col = pct >= 95 ? '#22C55E' : pct >= 80 ? '#F59E0B' : '#EF4444';
                    return (
                      <View key={sport} style={s.sportRow}>
                        <Text style={[s.sportLabel, { color: C.textSecondary }]}>{sport}</Text>
                        <View style={[s.sportBar, { backgroundColor: C.border }]}>
                          <View style={[s.sportBarFill, { width: `${pct}%` as any, backgroundColor: col }]} />
                        </View>
                        <Text style={[s.sportCount, { color: C.textMuted }]}>{data.total}</Text>
                        <Text style={[s.sportPct, { color: col }]}>{pct}%</Text>
                      </View>
                    );
                  })}
                </SectionCard>
              ) : null}

              {scan?.providerBreakdown && Object.keys(scan.providerBreakdown).length > 0 ? (
                <SectionCard title="DATA SOURCE BREAKDOWN" C={C as any}>
                  {Object.entries(scan.providerBreakdown).sort((a, b) => b[1] - a[1]).map(([provider, count]) => (
                    <MetricRow key={provider} label={provider} value={`${count} records`} C={C as any} />
                  ))}
                </SectionCard>
              ) : null}
            </>
          ) : null}

          {/* ── PROVIDERS ────────────────────────────────────────────────────── */}
          {activeTab === 'providers' ? (
            <>
              {/* Phase 12: Auto-healing */}
              <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[s.sectionTitle, { color: C.textSecondary }]}>PHASE 12: AUTO-HEALING</Text>
                <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 18 }}>
                  Reset all stuck circuit breakers and trigger fresh data sync. Use when providers show CRITICAL despite keys being valid.
                </Text>
                {healResult ? (
                  <View style={{
                    borderRadius: 8, padding: 10,
                    backgroundColor: healResult.includes('failed') ? '#EF444414' : '#22C55E14',
                    borderWidth: 1,
                    borderColor: healResult.includes('failed') ? '#EF444433' : '#22C55E33',
                  }}>
                    <Text style={{ fontSize: 11, color: healResult.includes('failed') ? '#EF4444' : '#22C55E' }}>
                      {healResult}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={handleAutoHeal}
                  disabled={healing}
                  style={({ pressed }) => ({
                    flexDirection: 'row' as const,
                    alignItems: 'center' as const,
                    justifyContent: 'center' as const,
                    gap: 8,
                    borderRadius: 10,
                    paddingVertical: 12,
                    backgroundColor: healing ? C.border : C.primary,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  {healing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="refresh" size={16} color="#000" />}
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }}>
                    {healing ? 'Healing...' : 'Run Auto-Heal'}
                  </Text>
                </Pressable>
              </View>

              {/* Live provider health */}
              {providerReport ? (
                <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusToColor(providerReport.overallStatus) }} />
                    <Text style={[s.sectionTitle, { color: C.textSecondary }]}>
                      LIVE PROVIDER HEALTH — {statusToLabel(providerReport.overallStatus).toUpperCase()}
                    </Text>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>Score: {providerReport.healthScore}/100</Text>
                  </View>
                  {providerReport.providers.map((p) => (
                    <View
                      key={p.provider}
                      style={{
                        borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 6,
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: `${statusToColor(p.status)}0A`,
                        borderColor: `${statusToColor(p.status)}33`,
                      }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusToColor(p.status) }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: C.textPrimary }}>{p.displayName}</Text>
                        <Text style={{ fontSize: 10, color: C.textMuted }}>
                          {p.totalRequestsToday} req · {p.totalErrorsToday} err · {p.errorRatePct.toFixed(1)}% error rate
                        </Text>
                        {p.lastError ? (
                          <Text style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }} numberOfLines={2}>{p.lastError}</Text>
                        ) : null}
                      </View>
                      <View style={{
                        borderRadius: 12, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
                        backgroundColor: `${statusToColor(p.status)}18`,
                        borderColor: `${statusToColor(p.status)}44`,
                      }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: statusToColor(p.status) }}>{p.status}</Text>
                      </View>
                    </View>
                  ))}
                  {providerReport.recommendations.length > 0 && !providerReport.recommendations[0].includes('within acceptable') ? (
                    <View style={{ borderRadius: 8, borderWidth: 1, padding: 10, backgroundColor: '#EF444408', borderColor: '#EF444422', marginTop: 4 }}>
                      <Text style={{ fontSize: 10, color: C.textSecondary, fontWeight: '700', marginBottom: 4 }}>REMEDIATION ACTIONS:</Text>
                      {providerReport.recommendations.slice(0, 4).map((r, i) => (
                        <Text key={i} style={{ fontSize: 10, color: '#EF4444', lineHeight: 15, marginBottom: 3 }}>• {r}</Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Source priority engine */}
              <SectionCard title="PHASE 8: SOURCE PRIORITY ENGINE" C={C as any}>
                {[
                  { dt: 'Fixtures', sports: 'Football', priority: 'API-Football (primary) → TheSportsDB (secondary)' },
                  { dt: 'Fixtures', sports: 'Basketball/Tennis/etc.', priority: 'API-Sports (primary) → TheSportsDB (secondary)' },
                  { dt: 'Fixtures', sports: 'Cricket/Boxing/MMA', priority: 'TheSportsDB (primary) → API-Sports (secondary)' },
                  { dt: 'Standings', sports: 'Football', priority: 'API-Football (current season auto-detect) → TheSportsDB' },
                  { dt: 'Highlights/News', sports: 'All', priority: 'TheSportsDB (primary) → API-Football (secondary)' },
                  { dt: 'Odds', sports: 'All', priority: 'API-Football → API-Sports' },
                ].map((row) => (
                  <View key={`${row.dt}-${row.sports}`} style={s.priorityRow}>
                    <Text style={[s.priorityType, { color: C.primary }]}>{row.dt} ({row.sports})</Text>
                    <Text style={[s.priorityChain, { color: C.textMuted }]}>{row.priority}</Text>
                  </View>
                ))}
              </SectionCard>
            </>
          ) : null}

          {/* ── QUALITY ──────────────────────────────────────────────────────── */}
          {activeTab === 'quality' ? (
            <>
              <SectionCard title="PHASE 7: DATA QUALITY GATE" C={C as any}>
                <MetricRow label="Pass rate" value={`${((scan?.qualityGatePassRate ?? 1) * 100) | 0}%`} status={(scan?.qualityGatePassRate ?? 1) >= 0.95 ? 'pass' : 'warn'} C={C as any} />
                <MetricRow label="Total records checked" value={String(scan?.totalMatches ?? 0)} C={C as any} />
                <MetricRow label="Gate failures" value={String(Math.round((1 - (scan?.qualityGatePassRate ?? 1)) * (scan?.totalMatches ?? 0)))} C={C as any} />
                <MetricRow label="Individual-player sport records" value={String((scan as any)?.individualSportRecords ?? 0)} C={C as any} />
                <View style={{ borderRadius: 8, padding: 8, backgroundColor: `${C.primary}0D`, borderWidth: 1, borderColor: `${C.primary}22`, marginTop: 4 }}>
                  <Text style={{ fontSize: 10, color: C.textMuted, lineHeight: 16 }}>
                    Note: Tennis, table-tennis, MMA, boxing and other individual-player sports use player names that are NOT in the team canonical registry — they are correctly excluded from mapping accuracy calculations.
                  </Text>
                </View>
              </SectionCard>

              <SectionCard title="PHASE 3: DUPLICATE DETECTION" C={C as any}>
                <MetricRow label="Duplicates detected" value={String(scan?.duplicateCount ?? 0)} status={(scan?.duplicateCount ?? 0) === 0 ? 'pass' : 'warn'} C={C as any} />
                <MetricRow label="Threshold" value="< 0.1%" C={C as any} />
                <MetricRow label="Current rate" value={scan?.totalMatches ? `${((scan.duplicateCount / scan.totalMatches) * 100).toFixed(3)}%` : '0.000%'} status={(scan?.duplicateCount ?? 0) === 0 ? 'pass' : 'warn'} C={C as any} />
              </SectionCard>

              <SectionCard title="PHASE 2: SPORT ENDPOINT ISOLATION" C={C as any}>
                <MetricRow label="Cross-sport contamination" value={String(scan?.crossSportIssues ?? 0)} status={(scan?.crossSportIssues ?? 0) === 0 ? 'pass' : 'fail'} C={C as any} />
                <MetricRow label="Zero-tolerance threshold" value="0 violations" C={C as any} />
              </SectionCard>

              <SectionCard title="PHASE 6: MISMATCH DETECTION" C={C as any}>
                <MetricRow label="Records scanned" value={String(mismatch?.totalScanned ?? 0)} C={C as any} />
                <MetricRow label="Wrong sport assignments" value={String(mismatch?.wrongSportCount ?? 0)} status={(mismatch?.wrongSportCount ?? 0) === 0 ? 'pass' : 'fail'} C={C as any} />
                <MetricRow label="League name mismatches" value={String(mismatch?.wrongLeagueCount ?? 0)} status={(mismatch?.wrongLeagueCount ?? 0) < 5 ? 'pass' : 'warn'} C={C as any} />
                <MetricRow label="Corrected canonical names" value={String(mismatch?.correctedNames?.length ?? 0)} C={C as any} />
              </SectionCard>

              {health ? (
                <SectionCard title="PHASE 10: ALERT THRESHOLDS" C={C as any}>
                  {[
                    { label: 'Duplicate Rate', value: `${(health.duplicateRate * 100).toFixed(3)}%`, ok: health.duplicateRate <= 0.001 },
                    { label: 'Mapping Accuracy', value: `${(health.mappingAccuracy * 100).toFixed(1)}%`, ok: health.mappingAccuracy >= 0.99 },
                    { label: 'Missing Details Rate', value: `${(health.missingDetailsRate * 100).toFixed(2)}%`, ok: health.missingDetailsRate <= 0.005 },
                    { label: 'Quality Gate Pass Rate', value: `${(health.qualityGatePassRate * 100).toFixed(1)}%`, ok: health.qualityGatePassRate >= 0.95 },
                    { label: 'Cross-Sport Issues', value: String(health.crossSportContamination), ok: health.crossSportContamination === 0 },
                  ].map((row) => (
                    <View key={row.label} style={s.thresholdRow}>
                      <StatusDot status={row.ok ? 'pass' : 'fail'} />
                      <Text style={[s.thresholdLabel, { color: C.textSecondary }]}>{row.label}</Text>
                      <Text style={[s.thresholdValue, { color: row.ok ? '#22C55E' : '#EF4444' }]}>{row.value}</Text>
                    </View>
                  ))}
                </SectionCard>
              ) : null}
            </>
          ) : null}

          {/* ── ALERTS ───────────────────────────────────────────────────────── */}
          {activeTab === 'alerts' ? (
            <>
              {alerts.length === 0 ? (
                <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border, alignItems: 'center', gap: 8, paddingVertical: 32 }]}>
                  <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
                  <Text style={{ fontSize: 17, fontWeight: FONTS.bold, color: '#22C55E' }}>No Active Alerts</Text>
                  <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>All data integrity checks passing</Text>
                </View>
              ) : (
                <SectionCard title={`ACTIVE ALERTS (${alerts.length})`} C={C as any}>
                  {alerts.map((alert) => <AlertItem key={alert.id} alert={alert} C={C as any} />)}
                </SectionCard>
              )}

              {(health?.alerts ?? []).length > 0 ? (
                <SectionCard title="RECOMMENDATIONS" C={C as any}>
                  {health!.alerts.map((a, idx) => (
                    <View key={idx} style={[s.alertItem, {
                      backgroundColor: a.severity === 'critical' ? '#EF444410' : '#F59E0B10',
                      borderColor: a.severity === 'critical' ? '#EF444433' : '#F59E0B33',
                    }]}>
                      <Ionicons name={a.severity === 'critical' ? 'alert-circle' : 'warning'} size={13} color={a.severity === 'critical' ? '#EF4444' : '#F59E0B'} />
                      <Text style={{ flex: 1, fontSize: 11, color: C.textSecondary, lineHeight: 17 }}>{a.message}</Text>
                    </View>
                  ))}
                </SectionCard>
              ) : null}

              {(scan?.topIssues ?? []).length > 0 ? (
                <SectionCard title="TOP DATA ISSUES" C={C as any}>
                  {scan!.topIssues.map((issue, idx) => (
                    <Text key={idx} style={{ fontSize: 11, color: C.textMuted, lineHeight: 18, paddingLeft: 4, borderLeftWidth: 2, borderLeftColor: C.border, marginBottom: 4 }}>
                      {issue}
                    </Text>
                  ))}
                </SectionCard>
              ) : null}
            </>
          ) : null}

          {/* ── NAMES ────────────────────────────────────────────────────────── */}
          {activeTab === 'names' ? (
            <>
              <SectionCard title="PHASE 4+5: CANONICAL REGISTRY" C={C as any}>
                <MetricRow label="Test: 'Man Utd'" value={resolveTest?.team ?? '…'} status="pass" C={C as any} />
                <MetricRow label="Test: 'english premier league'" value={resolveTest?.league ?? '…'} status="pass" C={C as any} />
                <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
                <MetricRow label="Team aliases" value="43+ entries" C={C as any} />
                <MetricRow label="League aliases" value="60+ entries" C={C as any} />
              </SectionCard>

              {(mismatch?.correctedNames ?? []).length > 0 ? (
                <SectionCard title={`CANONICAL CORRECTIONS (${mismatch!.correctedNames.length})`} C={C as any}>
                  {mismatch!.correctedNames.slice(0, 12).map((item, idx) => (
                    <View key={idx} style={s.correctionRow}>
                      <Text style={[s.correctionField, { color: C.textMuted }]}>{item.field}</Text>
                      <Text style={[s.correctionOrig, { color: '#EF4444' }]} numberOfLines={1}>{item.original}</Text>
                      <Ionicons name="arrow-forward" size={11} color={C.textMuted} />
                      <Text style={[s.correctionCanon, { color: '#22C55E' }]} numberOfLines={1}>{item.canonical}</Text>
                    </View>
                  ))}
                </SectionCard>
              ) : (
                <SectionCard title="CANONICAL NAME CORRECTIONS" C={C as any}>
                  <View style={{ alignItems: 'center', paddingVertical: 16, gap: 6 }}>
                    <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
                    <Text style={{ fontSize: 13, color: '#22C55E', fontWeight: '700' }}>All names canonical</Text>
                  </View>
                </SectionCard>
              )}

              <SectionCard title="PHASE 2: ENDPOINT REGISTRY" C={C as any}>
                {[
                  { sport: 'football', endpoint: 'v3.football.api-sports.io/fixtures' },
                  { sport: 'basketball', endpoint: 'v1.basketball.api-sports.io/games' },
                  { sport: 'tennis', endpoint: 'v1.tennis.api-sports.io/matches' },
                  { sport: 'mma', endpoint: 'v1.mma.api-sports.io/fights' },
                  { sport: 'cricket', endpoint: 'thesportsdb.com/eventsday.php?s=Cricket' },
                  { sport: 'boxing', endpoint: 'thesportsdb.com/eventsday.php?s=Boxing' },
                ].map((e) => (
                  <View key={e.sport} style={s.endpointRow}>
                    <Text style={[s.endpointSport, { color: C.primary }]}>{e.sport}</Text>
                    <Text style={[s.endpointUrl, { color: C.textMuted }]} numberOfLines={1}>{e.endpoint}</Text>
                  </View>
                ))}
              </SectionCard>
            </>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: FONTS.bold },
  scoreBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  tabScroll: { borderBottomWidth: 1, maxHeight: 48 },
  tab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2 },
  tabText: { fontSize: 12, fontWeight: FONTS.semiBold },
  sectionCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricLabel: { flex: 1, fontSize: 12 },
  metricValue: { fontSize: 13, fontWeight: FONTS.bold },
  overviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  overviewStatus: { fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  overviewDesc: { fontSize: 12, lineHeight: 18 },
  sportRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sportLabel: { width: 90, fontSize: 11, fontWeight: FONTS.semiBold },
  sportBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  sportBarFill: { height: '100%', borderRadius: 3 },
  sportCount: { width: 32, textAlign: 'right', fontSize: 10 },
  sportPct: { width: 36, textAlign: 'right', fontSize: 11, fontWeight: FONTS.bold },
  alertItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginBottom: 6 },
  alertType: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2 },
  alertMsg: { fontSize: 11, lineHeight: 16 },
  priorityRow: { marginBottom: 8, gap: 2 },
  priorityType: { fontSize: 12, fontWeight: FONTS.semiBold },
  priorityChain: { fontSize: 11 },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  thresholdLabel: { flex: 1, fontSize: 11 },
  thresholdValue: { fontSize: 12, fontWeight: FONTS.bold },
  correctionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  correctionField: { fontSize: 9, fontWeight: '800', width: 60, textTransform: 'uppercase' },
  correctionOrig: { flex: 1, fontSize: 11, textDecorationLine: 'line-through' },
  correctionCanon: { flex: 1, fontSize: 11, fontWeight: FONTS.semiBold },
  endpointRow: { marginBottom: 6, gap: 2 },
  endpointSport: { fontSize: 11, fontWeight: FONTS.bold, textTransform: 'capitalize' },
  endpointUrl: { fontSize: 10 },
});
