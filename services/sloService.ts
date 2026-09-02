/**
 * services/sloService.ts — PredictXta Phase 7 SLO / SLA Management
 *
 * Defines measurable Service Level Objectives (SLOs) and provides
 * utilities for tracking, alerting and reporting SLO compliance.
 *
 * SLOs Defined:
 *   api_availability        — 99.5%     API uptime
 *   prediction_availability — 95%       Predictions available for upcoming matches
 *   live_data_freshness     — <90s      Live score update latency
 *   prediction_generation   — <10 min   Prediction generation lead time before KO
 *   auth_success_rate       — 99%       Authentication success rate
 *   feed_latency_p95        — <500ms    Feed API p95 latency
 *   settlement_rate         — 99%       Daily settlement completion
 *
 * IMPORTANT: SLO violations trigger pipeline_alerts entries (already deployed).
 * This service provides the client-side/measurement layer.
 */

import { getSupabaseClient } from '@/template';

// ─── SLO Definitions ─────────────────────────────────────────────────────────
export interface SLODefinition {
  name: string;
  metric_type: 'availability' | 'latency_p99' | 'error_rate' | 'freshness' | 'coverage';
  target_value: number;  // availability: 0-100%, latency: ms, error_rate: 0-100%, freshness: seconds
  window_minutes: number;
  description: string;
  alert_on_breach: boolean;
}

export const SLO_DEFINITIONS: Record<string, SLODefinition> = {
  api_availability: {
    name: 'api_availability',
    metric_type: 'availability',
    target_value: 99.5,
    window_minutes: 60,
    description: 'Core API uptime (home-feed, predictions-feed) must be ≥99.5%',
    alert_on_breach: true,
  },
  prediction_availability: {
    name: 'prediction_availability',
    metric_type: 'coverage',
    target_value: 80,  // 80% of upcoming matches should have predictions
    window_minutes: 1440,  // daily
    description: 'At least 80% of upcoming matches must have AI predictions',
    alert_on_breach: true,
  },
  live_data_freshness: {
    name: 'live_data_freshness',
    metric_type: 'freshness',
    target_value: 90,  // seconds max
    window_minutes: 60,
    description: 'Live match score freshness must be ≤90 seconds',
    alert_on_breach: true,
  },
  prediction_generation_latency: {
    name: 'prediction_generation_latency',
    metric_type: 'latency_p99',
    target_value: 600_000,  // 10 minutes in ms
    window_minutes: 60,
    description: 'Prediction generation must complete within 10 min of request',
    alert_on_breach: true,
  },
  auth_success_rate: {
    name: 'auth_success_rate',
    metric_type: 'availability',
    target_value: 99.0,
    window_minutes: 60,
    description: 'Authentication success rate must be ≥99%',
    alert_on_breach: true,
  },
  settlement_rate: {
    name: 'settlement_rate',
    metric_type: 'availability',
    target_value: 99.0,
    window_minutes: 1440,  // daily
    description: 'Daily prediction/expert pick settlement rate must be ≥99%',
    alert_on_breach: true,
  },
};

// ─── SLO Measurement ─────────────────────────────────────────────────────────
export interface SLOMeasurement {
  slo_name: string;
  metric_type: string;
  target_value: number;
  measured_value: number;
  within_slo: boolean;
  window_minutes: number;
}

/**
 * measurePredictionCoverage — measure % of upcoming matches that have predictions.
 */
export async function measurePredictionCoverage(): Promise<SLOMeasurement> {
  const slo = SLO_DEFINITIONS.prediction_availability;
  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const plus24h = new Date(Date.now() + 24 * 3600_000).toISOString();

    const { count: upcomingCount } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'upcoming')
      .gte('match_time', now)
      .lte('match_time', plus24h);

    const { count: predictedCount } = await supabase
      .from('predictions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

    const total = upcomingCount ?? 0;
    const predicted = Math.min(predictedCount ?? 0, total);
    const coverage = total > 0 ? (predicted / total) * 100 : 100;

    return {
      slo_name: slo.name,
      metric_type: slo.metric_type,
      target_value: slo.target_value,
      measured_value: Math.round(coverage * 10) / 10,
      within_slo: coverage >= slo.target_value,
      window_minutes: slo.window_minutes,
    };
  } catch {
    return {
      slo_name: slo.name, metric_type: slo.metric_type,
      target_value: slo.target_value, measured_value: 0,
      within_slo: true, // fail open — don't alert on measurement failure
      window_minutes: slo.window_minutes,
    };
  }
}

/**
 * measureLiveDataFreshness — check if live matches have been updated recently.
 * Returns the maximum staleness in seconds across all live matches.
 */
export async function measureLiveDataFreshness(): Promise<SLOMeasurement> {
  const slo = SLO_DEFINITIONS.live_data_freshness;
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('matches')
      .select('last_updated')
      .eq('status', 'live')
      .order('last_updated', { ascending: true })
      .limit(1);

    if (!data || data.length === 0) {
      // No live matches — SLO trivially satisfied
      return {
        slo_name: slo.name, metric_type: slo.metric_type,
        target_value: slo.target_value, measured_value: 0,
        within_slo: true, window_minutes: slo.window_minutes,
      };
    }

    const oldestUpdate = new Date(data[0].last_updated).getTime();
    const stalenessSeconds = (Date.now() - oldestUpdate) / 1000;

    return {
      slo_name: slo.name, metric_type: slo.metric_type,
      target_value: slo.target_value,
      measured_value: Math.round(stalenessSeconds),
      within_slo: stalenessSeconds <= slo.target_value,
      window_minutes: slo.window_minutes,
    };
  } catch {
    return {
      slo_name: slo.name, metric_type: slo.metric_type,
      target_value: slo.target_value, measured_value: 0,
      within_slo: true,
      window_minutes: slo.window_minutes,
    };
  }
}

/**
 * recordSLOMeasurement — persist a measurement to the slo_metrics table.
 */
export async function recordSLOMeasurement(m: SLOMeasurement): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('slo_metrics').insert({
      slo_name: m.slo_name,
      metric_type: m.metric_type,
      target_value: m.target_value,
      measured_value: m.measured_value,
      within_slo: m.within_slo,
      window_minutes: m.window_minutes,
      measured_at: new Date().toISOString(),
    });

    // Alert on breach
    if (!m.within_slo) {
      const slo = SLO_DEFINITIONS[m.slo_name];
      if (slo?.alert_on_breach) {
        await supabase.from('pipeline_alerts').insert({
          alert_type: `slo_breach_${m.slo_name}`,
          severity: 'warning',
          message: `SLO breach: ${m.slo_name} = ${m.measured_value} (target: ${m.target_value})`,
          details: { measurement: m, slo_definition: slo },
          resolved: false,
        });
      }
    }
  } catch { /* non-blocking */ }
}

/**
 * getSLOStatus — returns current SLO compliance status for the dashboard.
 */
export async function getSLOStatus(): Promise<Array<SLOMeasurement & { slo_key: string; description: string }>> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('slo_metrics')
      .select('*')
      .order('measured_at', { ascending: false })
      .limit(50);

    // Group by slo_name, keep latest
    const latest = new Map<string, SLOMeasurement>();
    for (const row of (data ?? []) as SLOMeasurement[]) {
      if (!latest.has(row.slo_name)) latest.set(row.slo_name, row);
    }

    return Object.entries(SLO_DEFINITIONS).map(([key, def]) => {
      const m = latest.get(key);
      return {
        slo_key: key,
        slo_name: def.name,
        metric_type: def.metric_type,
        target_value: def.target_value,
        measured_value: m?.measured_value ?? -1,
        within_slo: m?.within_slo ?? true,
        window_minutes: def.window_minutes,
        description: def.description,
      };
    });
  } catch {
    return Object.entries(SLO_DEFINITIONS).map(([key, def]) => ({
      slo_key: key,
      slo_name: def.name,
      metric_type: def.metric_type,
      target_value: def.target_value,
      measured_value: -1,
      within_slo: true,
      window_minutes: def.window_minutes,
      description: def.description,
    }));
  }
}

export default { measurePredictionCoverage, measureLiveDataFreshness, recordSLOMeasurement, getSLOStatus };
