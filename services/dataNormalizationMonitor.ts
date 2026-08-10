/**
 * services/dataNormalizationMonitor.ts
 *
 * Phase 10: Real-time monitoring & alerting service.
 * Tracks data integrity metrics, fires alerts on threshold breaches,
 * and provides a live dashboard API for the admin panel.
 */

import { getSupabaseClient } from '@/template';
import {
  checkProviderHealth,
  generatePipelineHealthReport,
  runNormalizationPipeline,
  resolveTeamName,
  resolveLeagueName,
  runDataQualityGate,
  validateExternalIdSport,
  sportHasCanonicalTeamRegistry,
  normalizeSportId,
  type ProviderHealthStatus,
  type PipelineHealthReport,
} from './dataIntegrityEngine';

// ─── Alert thresholds ─────────────────────────────────────────────────────────
const THRESHOLDS = {
  DUPLICATE_RATE:        0.001,  // > 0.1%
  MAPPING_ACCURACY:      0.99,   // < 99%
  MISSING_DETAILS_RATE:  0.005,  // > 0.5%
  PROVIDER_FAILURE_RATE: 0.05,   // > 5% error rate
  CROSS_SPORT_ZERO:      0,      // zero tolerance
};

// ─── Monitoring State (in-memory) ─────────────────────────────────────────────
let _lastHealthReport: PipelineHealthReport | null = null;
let _lastProviderStatuses: ProviderHealthStatus[] = [];
let _alertDedupeSet = new Set<string>();  // 30-min dedup window
let _alertDedupeExpiry: number = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10A: LIVE DATA QUALITY SCAN
// Queries the DB and computes quality metrics across all matches.
// ─────────────────────────────────────────────────────────────────────────────

export interface DataQualityScanResult {
  totalMatches: number;
  duplicateCount: number;
  crossSportIssues: number;
  missingTeamNames: number;
  missingLeagues: number;
  invalidStatuses: number;
  tdbRecordsWithWrongSport: number;
  unmappedTeams: number;
  qualityGatePassRate: number;
  sportBreakdown: Record<string, { total: number; issues: number }>;
  providerBreakdown: Record<string, number>;
  /** Records from individual-player sports excluded from team mapping accuracy */
  individualSportRecords: number;
  topIssues: string[];
  scanDurationMs: number;
  scannedAt: string;
}

export async function runDataQualityScan(): Promise<DataQualityScanResult> {
  const start = Date.now();
  const supabase = getSupabaseClient();
  const issues: string[] = [];

  try {
    // Fetch recent matches for scan (last 7 days + upcoming)
    const windowStart = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data: rawMatches, error } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, status, match_time, external_id, source_provider, minute')
      .gte('match_time', windowStart)
      .order('match_time', { ascending: false })
      .limit(500);

    if (error || !rawMatches) {
      return buildEmptyScan(start);
    }

    const records = rawMatches as Record<string, unknown>[];
    let duplicateCount = 0;
    let crossSportIssues = 0;
    let missingTeamNames = 0;
    let missingLeagues = 0;
    let invalidStatuses = 0;
    let unmappedTeams = 0;
    let qualityGatePassed = 0;
    const sportBreakdown: Record<string, { total: number; issues: number }> = {};
    const providerBreakdown: Record<string, number> = {};
    const seenUnifiedIds = new Set<string>();

    for (const r of records) {
      const sport = String(r.sport ?? '');
      const extId = String(r.external_id ?? '');
      const provider = String(r.source_provider ?? 'unknown');

      // Sport breakdown
      if (!sportBreakdown[sport]) sportBreakdown[sport] = { total: 0, issues: 0 };
      sportBreakdown[sport].total++;

      // Provider breakdown
      providerBreakdown[provider] = (providerBreakdown[provider] ?? 0) + 1;

      // Quality gate
      const qResult = runDataQualityGate(r as Parameters<typeof runDataQualityGate>[0]);
      if (qResult.passed) {
        qualityGatePassed++;
      } else {
        sportBreakdown[sport].issues++;
        for (const f of qResult.failures.slice(0, 2)) {
          issues.push(`[${extId || 'no-id'}] ${f}`);
        }
      }

      // Missing team names
      const home = String(r.home_team ?? '');
      const away = String(r.away_team ?? '');
      if (!home || home.length < 2) { missingTeamNames++; sportBreakdown[sport].issues++; }
      if (!away || away.length < 2) { missingTeamNames++; }

      // Missing league
      if (!r.league || String(r.league).length < 2) { missingLeagues++; }

      // Invalid status
      if (!['live', 'upcoming', 'finished'].includes(String(r.status ?? ''))) { invalidStatuses++; }

      // Cross-sport contamination
      if (extId && sport && !validateExternalIdSport(extId, sport)) {
        crossSportIssues++;
        issues.push(`Cross-sport: external_id="${extId}" vs sport="${sport}"`);
        sportBreakdown[sport].issues++;
      }

      // Unmapped team names — ONLY count for sports with a canonical team registry.
      // Individual-player sports (tennis, table-tennis, MMA, boxing) use player
      // names that are NOT in the registry and must NOT be penalized as unmapped.
      const homeResolved = resolveTeamName(home, sport);
      const awayResolved = resolveTeamName(away, sport);
      if (sportHasCanonicalTeamRegistry(sport)) {
        if (homeResolved === home && home.length > 3) unmappedTeams++;
        if (awayResolved === away && away.length > 3) unmappedTeams++;
      }

      // Duplicate detection (simplified — by home+away+date)
      const uid = `${sport}_${home.toLowerCase()}_${away.toLowerCase()}_${String(r.match_time ?? '').substring(0, 10)}`;
      if (seenUnifiedIds.has(uid)) {
        duplicateCount++;
        issues.push(`Potential duplicate: ${home} vs ${away} (${r.match_time})`);
      } else {
        seenUnifiedIds.add(uid);
      }
    }

    const total = records.length;
    const qualityGatePassRate = total > 0 ? qualityGatePassed / total : 1;

    // Count records from individual-player sports (tennis, table-tennis, MMA, boxing)
    // These are excluded from team mapping accuracy calculations.
    const individualSportRecords = records.filter((r) =>
      !sportHasCanonicalTeamRegistry(String(r.sport ?? ''))
    ).length;

    return {
      totalMatches: total,
      duplicateCount,
      crossSportIssues,
      missingTeamNames,
      missingLeagues,
      invalidStatuses,
      tdbRecordsWithWrongSport: crossSportIssues,
      unmappedTeams: Math.floor(unmappedTeams / 2),
      qualityGatePassRate,
      sportBreakdown,
      providerBreakdown,
      individualSportRecords,
      topIssues: [...new Set(issues)].slice(0, 10),
      scanDurationMs: Date.now() - start,
      scannedAt: new Date().toISOString(),
    };
  } catch {
    return buildEmptyScan(start);
  }
}

function buildEmptyScan(start: number): DataQualityScanResult {
  return {
    totalMatches: 0, duplicateCount: 0, crossSportIssues: 0,
    missingTeamNames: 0, missingLeagues: 0, invalidStatuses: 0,
    tdbRecordsWithWrongSport: 0, unmappedTeams: 0, qualityGatePassRate: 1,
    sportBreakdown: {}, providerBreakdown: {}, individualSportRecords: 0, topIssues: [],
    scanDurationMs: Date.now() - start, scannedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10B: PROVIDER HEALTH MONITORING
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshProviderHealth(): Promise<ProviderHealthStatus[]> {
  _lastProviderStatuses = await checkProviderHealth();
  return _lastProviderStatuses;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10C: ALERT FIRING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function fireAlert(
  alertType: string,
  severity: 'critical' | 'warning' | 'info',
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // 30-minute deduplication
  const now = Date.now();
  if (now > _alertDedupeExpiry) {
    _alertDedupeSet.clear();
    _alertDedupeExpiry = now + 30 * 60_000;
  }
  const dedupeKey = `${alertType}_${severity}`;
  if (_alertDedupeSet.has(dedupeKey)) return;
  _alertDedupeSet.add(dedupeKey);

  try {
    const supabase = getSupabaseClient();
    await supabase.from('pipeline_alerts').insert({
      alert_type: alertType,
      severity,
      message,
      details,
      resolved: false,
    });
  } catch { /* non-blocking */ }
}

export async function checkAndFireAlerts(scan: DataQualityScanResult): Promise<void> {
  const total = scan.totalMatches;
  if (total === 0) return;

  const duplicateRate = scan.duplicateCount / total;
  const missingRate   = scan.missingTeamNames / (total * 2);

  if (duplicateRate > THRESHOLDS.DUPLICATE_RATE) {
    await fireAlert(
      'duplicate_matches',
      'critical',
      `Duplicate match rate ${(duplicateRate * 100).toFixed(2)}% exceeds threshold ${(THRESHOLDS.DUPLICATE_RATE * 100).toFixed(1)}%`,
      { duplicateCount: scan.duplicateCount, totalMatches: total, rate: duplicateRate },
    );
  }

  if (scan.crossSportIssues > THRESHOLDS.CROSS_SPORT_ZERO) {
    await fireAlert(
      'cross_sport_contamination',
      'critical',
      `${scan.crossSportIssues} cross-sport contamination records detected — zero tolerance`,
      { count: scan.crossSportIssues, examples: scan.topIssues.filter(i => i.includes('Cross-sport')).slice(0, 3) },
    );
  }

  if (missingRate > THRESHOLDS.MISSING_DETAILS_RATE) {
    await fireAlert(
      'missing_match_details',
      'warning',
      `Missing team name rate ${(missingRate * 100).toFixed(2)}% exceeds threshold`,
      { missingTeamNames: scan.missingTeamNames, totalMatches: total },
    );
  }

  if (scan.qualityGatePassRate < 0.90) {
    await fireAlert(
      'quality_gate_failures',
      'warning',
      `Quality gate pass rate ${(scan.qualityGatePassRate * 100).toFixed(1)}% is critically low`,
      { passRate: scan.qualityGatePassRate },
    );
  }

  // Provider health alerts
  for (const provider of _lastProviderStatuses) {
    if (!provider.isHealthy && provider.requestsToday > 0) {
      await fireAlert(
        'provider_failure',
        'warning',
        `Provider ${provider.provider} has ${(provider.errorRate * 100).toFixed(0)}% error rate today`,
        { provider: provider.provider, errorRate: provider.errorRate, requests: provider.requestsToday },
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10D: COMPREHENSIVE HEALTH DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export interface DataIntegrityDashboard {
  scan: DataQualityScanResult;
  providerHealth: ProviderHealthStatus[];
  healthReport: PipelineHealthReport;
  activeAlerts: Array<{
    id: string;
    alertType: string;
    severity: string;
    message: string;
    createdAt: string;
  }>;
  summary: {
    overallStatus: 'healthy' | 'degraded' | 'critical';
    score: number;
    criticalIssues: number;
    warnings: number;
    lastUpdated: string;
  };
}

export async function getDataIntegrityDashboard(): Promise<DataIntegrityDashboard> {
  const [scan, providers] = await Promise.all([
    runDataQualityScan(),
    refreshProviderHealth(),
  ]);

  // Fire any needed alerts
  await checkAndFireAlerts(scan);

  // Build health report
  const providerStatuses: Record<string, boolean> = {};
  for (const p of providers) {
    providerStatuses[p.provider] = p.isHealthy;
  }

  const healthReport = generatePipelineHealthReport({
    totalRecords: scan.totalMatches,
    duplicateCount: scan.duplicateCount,
    unmappedTeams: scan.unmappedTeams,
    missingDetails: scan.missingTeamNames,
    crossSportIssues: scan.crossSportIssues,
    qualityGatePassed: Math.round(scan.qualityGatePassRate * scan.totalMatches),
    providerStatuses: providerStatuses as Record<'api-football' | 'api-sports' | 'thesportsdb', boolean>,
    individualSportRecords: scan.individualSportRecords,
  });

  _lastHealthReport = healthReport;

  // Fetch active alerts
  let activeAlerts: DataIntegrityDashboard['activeAlerts'] = [];
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('pipeline_alerts')
      .select('id, alert_type, severity, message, created_at')
      .eq('resolved', false)
      .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    activeAlerts = (data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id ?? ''),
      alertType: String(a.alert_type ?? ''),
      severity: String(a.severity ?? ''),
      message: String(a.message ?? ''),
      createdAt: String(a.created_at ?? ''),
    }));
  } catch { /* non-blocking */ }

  const criticalIssues = healthReport.alerts.filter(a => a.severity === 'critical').length;
  const warnings       = healthReport.alerts.filter(a => a.severity === 'warning').length;
  const overallStatus  = criticalIssues > 0 ? 'critical' : warnings > 0 ? 'degraded' : 'healthy';

  return {
    scan,
    providerHealth: providers,
    healthReport,
    activeAlerts,
    summary: {
      overallStatus,
      score: healthReport.overallHealthScore,
      criticalIssues,
      warnings,
      lastUpdated: new Date().toISOString(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9: RENDERING VALIDATION
// Pre-flight check before showing a list of matches in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderValidationResult {
  passed: unknown[];
  rejected: unknown[];
  issues: string[];
  passRate: number;
}

export function validateMatchesForRender(matches: unknown[]): RenderValidationResult {
  const passed: unknown[] = [];
  const rejected: unknown[] = [];
  const issues: string[] = [];

  for (const match of matches) {
    const m = match as Record<string, unknown>;
    const result = runDataQualityGate(m as Parameters<typeof runDataQualityGate>[0]);
    if (result.passed) {
      passed.push(match);
    } else {
      rejected.push(match);
      issues.push(`[${m.id ?? 'no-id'}] ${result.failures.join('; ')}`);
    }
  }

  return {
    passed,
    rejected,
    issues,
    passRate: matches.length > 0 ? passed.length / matches.length : 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6: MISMATCH DETECTION — find misassigned matches in DB
// ─────────────────────────────────────────────────────────────────────────────

export interface MismatchReport {
  wrongSportCount: number;
  wrongLeagueCount: number;
  correctedNames: Array<{ id: string; field: string; original: string; canonical: string }>;
  totalScanned: number;
}

export async function detectAndLogMismatches(): Promise<MismatchReport> {
  const supabase = getSupabaseClient();
  const correctedNames: MismatchReport['correctedNames'] = [];
  let wrongSportCount = 0;
  let wrongLeagueCount = 0;

  try {
    const { data } = await supabase
      .from('matches')
      .select('id, home_team, away_team, league, sport, external_id')
      .gte('match_time', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .limit(200);

    const records = data ?? [];

    for (const r of records as Record<string, unknown>[]) {
      const id = String(r.id ?? '');
      const sport = String(r.sport ?? '');
      const extId = String(r.external_id ?? '');

      // Check cross-sport contamination
      if (extId && sport && !validateExternalIdSport(extId, sport)) {
        wrongSportCount++;
      }

      // Check team name canonicalization
      const home = String(r.home_team ?? '');
      const away = String(r.away_team ?? '');
      const homeCanon = resolveTeamName(home, sport);
      const awayCanon = resolveTeamName(away, sport);
      if (homeCanon !== home) correctedNames.push({ id, field: 'home_team', original: home, canonical: homeCanon });
      if (awayCanon !== away) correctedNames.push({ id, field: 'away_team', original: away, canonical: awayCanon });

      // Check league canonicalization
      const league = String(r.league ?? '');
      const leagueCanon = resolveLeagueName(league);
      if (leagueCanon !== league) {
        correctedNames.push({ id, field: 'league', original: league, canonical: leagueCanon });
        wrongLeagueCount++;
      }
    }

    return {
      wrongSportCount,
      wrongLeagueCount,
      correctedNames: correctedNames.slice(0, 50),
      totalScanned: records.length,
    };
  } catch {
    return { wrongSportCount: 0, wrongLeagueCount: 0, correctedNames: [], totalScanned: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: Quick status for home screen badge
// ─────────────────────────────────────────────────────────────────────────────

export function getLastHealthReport(): PipelineHealthReport | null {
  return _lastHealthReport;
}

export function getLastProviderStatuses(): ProviderHealthStatus[] {
  return _lastProviderStatuses;
}
