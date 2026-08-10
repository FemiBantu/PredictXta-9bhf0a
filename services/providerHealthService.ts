/**
 * services/providerHealthService.ts — Provider Health Monitor v3
 *
 * Data Architecture (Highlightly permanently removed):
 *   Football:         API-Football (primary) → TheSportsDB (secondary)
 *   All other sports: TheSportsDB (primary) → API-Football where supported
 *   News/Highlights:  TheSportsDB (primary) → API-Football (secondary)
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ProviderStatus = 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE' | 'UNKNOWN';

export interface ProviderHealthSummary {
  provider: string;
  displayName: string;
  status: ProviderStatus;
  errorRatePct: number;
  totalRequestsToday: number;
  totalErrorsToday: number;
  avgResponseMs: number | null;
  lastError: string | null;
  lastCalledAt: string | null;
  sports: string[];
  isPrimary: boolean;
}

export interface ProviderHealthReport {
  providers: ProviderHealthSummary[];
  overallStatus: ProviderStatus;
  healthScore: number;
  criticalProviders: string[];
  generatedAt: string;
  recommendations: string[];
}

// ─── Provider metadata (Highlightly removed) ─────────────────────────────────
const PROVIDER_META: Record<string, { displayName: string; sports: string[]; isPrimary: boolean }> = {
  'api-football': {
    displayName: 'API-Football',
    sports: ['football'],
    isPrimary: true,
  },
  'api-sports': {
    displayName: 'API-Sports (Multi)',
    sports: ['basketball', 'tennis', 'baseball', 'hockey', 'handball', 'volleyball', 'rugby', 'american-football'],
    isPrimary: true,
  },
  'thesportsdb': {
    displayName: 'TheSportsDB',
    sports: ['all non-football sports', 'news', 'highlights', 'boxing', 'formula1', 'motorsports', 'esports', 'darts', 'snooker', 'cycling', 'athletics'],
    isPrimary: true,
  },
};

function getStatus(errorRatePct: number, totalRequests: number): ProviderStatus {
  if (totalRequests === 0) return 'UNKNOWN';
  if (errorRatePct < 5)   return 'HEALTHY';  // matches v_provider_health_today view
  if (errorRatePct < 10)  return 'WARNING';
  if (errorRatePct < 20)  return 'DEGRADED';
  if (errorRatePct < 40)  return 'CRITICAL';
  return 'OFFLINE';
}

// ─── Fetch provider health from DB ───────────────────────────────────────────
export async function fetchProviderHealth(days = 1): Promise<ProviderHealthReport> {
  try {
    const supabase = getSupabaseClient();

    // Try the optimized view first
    const { data: viewData, error: viewError } = await supabase
      .from('v_provider_health_today')
      .select('*');

    // Fallback to raw table if view fails
    let rawData: Record<string, unknown>[] = [];
    if (!viewError && viewData && viewData.length > 0) {
      rawData = viewData as Record<string, unknown>[];
    } else {
      const since = new Date(Date.now() - days * 24 * 3600_000).toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('api_usage')
        .select('provider_name, request_count, success_count, error_count, last_called, last_error, avg_response_ms')
        .gte('date', since);
      if (error || !data) return buildEmptyReport();
      rawData = data as Record<string, unknown>[];
    }

    // Aggregate by provider
    const providerMap = new Map<string, {
      requests: number; successes: number; errors: number;
      lastCalled: string | null; lastError: string | null; avgMs: number | null;
      errorRatePct: number;
    }>();

    for (const row of rawData) {
      const name = String(row.provider_name ?? '');
      if (row.error_rate_pct !== undefined) {
        // Pre-aggregated view row
        providerMap.set(name, {
          requests:     Number(row.total_requests ?? 0),
          successes:    Number(row.total_successes ?? 0),
          errors:       Number(row.total_errors ?? 0),
          lastCalled:   row.last_called ? String(row.last_called) : null,
          lastError:    row.last_error ? String(row.last_error) : null,
          avgMs:        row.avg_response_ms ? Number(row.avg_response_ms) : null,
          errorRatePct: Number(row.error_rate_pct ?? 0),
        });
      } else {
        // Raw table row — aggregate
        const existing = providerMap.get(name) ?? { requests: 0, successes: 0, errors: 0, lastCalled: null, lastError: null, avgMs: null, errorRatePct: 0 };
        existing.requests  += Number(row.request_count ?? 0);
        existing.successes += Number(row.success_count ?? 0);
        existing.errors    += Number(row.error_count ?? 0);
        if (row.last_called && (!existing.lastCalled || String(row.last_called) > existing.lastCalled)) {
          existing.lastCalled = String(row.last_called);
        }
        if (row.last_error) existing.lastError = String(row.last_error);
        if (row.avg_response_ms && !existing.avgMs) existing.avgMs = Number(row.avg_response_ms);
        existing.errorRatePct = existing.requests > 0 ? (existing.errors / existing.requests) * 100 : 0;
        providerMap.set(name, existing);
      }
    }

    const providers: ProviderHealthSummary[] = Object.keys(PROVIDER_META).map((provider) => {
      const stats = providerMap.get(provider) ?? { requests: 0, successes: 0, errors: 0, lastCalled: null, lastError: null, avgMs: null, errorRatePct: 0 };
      const meta = PROVIDER_META[provider];
      return {
        provider,
        displayName: meta.displayName,
        status: getStatus(stats.errorRatePct, stats.requests),
        errorRatePct: Math.round(stats.errorRatePct * 10) / 10,
        totalRequestsToday: stats.requests,
        totalErrorsToday: stats.errors,
        avgResponseMs: stats.avgMs,
        lastError: stats.lastError,
        lastCalledAt: stats.lastCalled,
        sports: meta.sports,
        isPrimary: meta.isPrimary,
      };
    });

    // Health score calculation (weighted: critical = -25, degraded = -10, warning = -3)
    const primaryProviders = providers.filter((p) => p.isPrimary);
    const critical = primaryProviders.filter((p) => p.status === 'CRITICAL' || p.status === 'OFFLINE');
    const degraded = primaryProviders.filter((p) => p.status === 'DEGRADED');
    const warning  = primaryProviders.filter((p) => p.status === 'WARNING');
    let score = 100;
    score -= critical.length * 25;
    score -= degraded.length * 10;
    score -= warning.length  * 3;
    score = Math.max(0, Math.min(100, score));

    const overallStatuses = primaryProviders.map((p) => p.status);
    let overallStatus: ProviderStatus = 'HEALTHY';
    if (overallStatuses.some((s) => s === 'OFFLINE'))   overallStatus = 'OFFLINE';
    else if (overallStatuses.some((s) => s === 'CRITICAL'))  overallStatus = 'CRITICAL';
    else if (overallStatuses.some((s) => s === 'DEGRADED'))  overallStatus = 'DEGRADED';
    else if (overallStatuses.some((s) => s === 'WARNING'))   overallStatus = 'WARNING';

    return {
      providers,
      overallStatus,
      healthScore: score,
      criticalProviders: critical.map((p) => p.provider),
      generatedAt: new Date().toISOString(),
      recommendations: buildRecommendations(providers),
    };
  } catch {
    return buildEmptyReport();
  }
}

function buildEmptyReport(): ProviderHealthReport {
  return {
    providers: Object.keys(PROVIDER_META).map((provider) => ({
      provider,
      displayName: PROVIDER_META[provider].displayName,
      status: 'UNKNOWN' as ProviderStatus,
      errorRatePct: 0,
      totalRequestsToday: 0,
      totalErrorsToday: 0,
      avgResponseMs: null,
      lastError: null,
      lastCalledAt: null,
      sports: PROVIDER_META[provider].sports,
      isPrimary: PROVIDER_META[provider].isPrimary,
    })),
    overallStatus: 'UNKNOWN',
    healthScore: 100,
    criticalProviders: [],
    generatedAt: new Date().toISOString(),
    recommendations: ['No API usage data recorded yet — trigger a data sync to begin tracking.'],
  };
}

function buildRecommendations(providers: ProviderHealthSummary[]): string[] {
  const recs: string[] = [];
  for (const p of providers) {
    if (p.status === 'OFFLINE') {
      recs.push(`🔴 ${p.displayName}: OFFLINE — All requests failing. Check API key in Supabase Secrets panel.`);
    } else if (p.status === 'CRITICAL') {
      recs.push(`🟠 ${p.displayName}: CRITICAL (${p.errorRatePct}% error rate). ${p.lastError ? `Last error: ${p.lastError.substring(0, 80)}` : ''}`);
    } else if (p.status === 'DEGRADED') {
      recs.push(`🟡 ${p.displayName}: DEGRADED (${p.errorRatePct}% error rate) — may be hitting quota limits.`);
    }
    if (p.provider === 'api-football' && (p.status === 'CRITICAL' || p.status === 'OFFLINE')) {
      recs.push('API-Football: Verify API_FOOTBALL_KEY at dashboard.api-football.com. Check monthly quota (free plan = 100 req/day). TheSportsDB is active as fallback for football.');
    }
    if (p.provider === 'api-sports' && (p.status === 'CRITICAL' || p.status === 'OFFLINE')) {
      recs.push('API-Sports: Same API_FOOTBALL_KEY used for all api-sports.io domains. Verify key covers basketball/tennis/MMA subscription tier. TheSportsDB is active as fallback.');
    }
    if (p.provider === 'thesportsdb' && (p.status === 'CRITICAL' || p.status === 'OFFLINE')) {
      recs.push('TheSportsDB: This is the primary provider for all non-football sports and news/highlights. Verify SPORTSDB_KEY in Supabase Secrets. Free tier: api.v1 endpoints are public (key=3).');
    }
    if (p.status === 'UNKNOWN' && p.isPrimary) {
      recs.push(`${p.displayName}: No usage recorded today — trigger a sync via Admin → Data Integrity → Run Sync.`);
    }
  }
  if (recs.length === 0) recs.push('✅ All providers operating within acceptable thresholds.');
  return recs;
}

// ─── Phase 12: Auto-healing — reset stuck circuit breakers ───────────────────
export async function triggerAutoHeal(): Promise<{ healed: boolean; message: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('fetch-matches', {
      body: { mode: 'today', sport: 'football', resetCircuits: true },
    });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await error.context?.text()) || msg; } catch { /* ignore */ }
      }
      return { healed: false, message: `Auto-heal failed: ${msg}` };
    }
    return { healed: true, message: `Auto-heal triggered — fetched ${data?.fetched ?? 0} fixtures, reset all provider circuits` };
  } catch (e) {
    return { healed: false, message: `Auto-heal error: ${String(e)}` };
  }
}

// ─── Quick health check (for feed status bar) ─────────────────────────────────
export async function getProviderStatusSummary(): Promise<{
  isHealthy: boolean;
  degradedProviders: string[];
  healthScore: number;
}> {
  try {
    const report = await fetchProviderHealth(1);
    return {
      isHealthy: report.overallStatus === 'HEALTHY' || report.overallStatus === 'WARNING' || report.overallStatus === 'UNKNOWN',
      degradedProviders: report.providers
        .filter((p) => p.status === 'DEGRADED' || p.status === 'CRITICAL' || p.status === 'OFFLINE')
        .map((p) => p.displayName),
      healthScore: report.healthScore,
    };
  } catch {
    return { isHealthy: true, degradedProviders: [], healthScore: 100 };
  }
}

// ─── Status color + label helpers (for UI) ────────────────────────────────────
export function statusToColor(status: ProviderStatus): string {
  switch (status) {
    case 'HEALTHY':  return '#22C55E';
    case 'WARNING':  return '#F59E0B';
    case 'DEGRADED': return '#F97316';
    case 'CRITICAL': return '#EF4444';
    case 'OFFLINE':  return '#9CA3AF';
    default:         return '#6B7280';
  }
}

export function statusToLabel(status: ProviderStatus): string {
  switch (status) {
    case 'HEALTHY':  return 'Healthy';
    case 'WARNING':  return 'Warning';
    case 'DEGRADED': return 'Degraded';
    case 'CRITICAL': return 'Critical';
    case 'OFFLINE':  return 'Offline';
    default:         return 'Unknown';
  }
}
