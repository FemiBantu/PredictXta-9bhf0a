/**
 * selfHealingService.ts — Enterprise Self-Healing & Health Monitor (v2)
 *
 * Monitors critical platform systems every 5 minutes and auto-recovers
 * from API failures, stale caches, and prediction gaps.
 *
 * Features:
 * - API connectivity health checks with exponential backoff
 * - Feed cache staleness detection & auto-rebuild
 * - Prediction gap detection & auto-fill
 * - Platform alert suppression (deduplicates repeated alerts)
 * - Memory-safe: one interval, no leaks
 */

import { getSupabaseClient } from '@/template';
import { invalidateFeedCache } from './feedEngine';

// ─── Configuration ────────────────────────────────────────────────────────────
const HEALTH_INTERVAL_MS   = 5 * 60 * 1000;   // 5 minutes between cycles
const CACHE_STALE_THRESHOLD = 30 * 60 * 1000; // 30 min = stale
const PREDICTION_GAP_LIMIT  = 5;               // max matches allowed without predictions
const MAX_BACKOFF_MS         = 16 * 60 * 1000; // 16 min max backoff per provider
const ALERT_SUPPRESS_MS      = 30 * 60 * 1000; // 30 min suppression per alert key

// ─── Module-level state ────────────────────────────────────────────────────────
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _isRunning = false;

/** Per-provider exponential backoff state */
const _backoff: Record<string, { failures: number; nextRetryAt: number }> = {};

/** Alert suppression map: key → last-alerted timestamp */
const _alertSuppression: Record<string, number> = {};

/** Recovery event log (last 20 events) */
const _recoveryLog: Array<{ ts: string; event: string; detail?: string }> = [];

function log(event: string, detail?: string) {
  const entry = { ts: new Date().toISOString(), event, detail };
  _recoveryLog.unshift(entry);
  if (_recoveryLog.length > 20) _recoveryLog.pop();
  if (__DEV__) console.log('[SelfHealing]', event, detail ?? '');
}

function shouldAlert(key: string): boolean {
  const last = _alertSuppression[key] ?? 0;
  if (Date.now() - last < ALERT_SUPPRESS_MS) return false;
  _alertSuppression[key] = Date.now();
  return true;
}

function getBackoff(provider: string): number {
  const state = _backoff[provider] ?? { failures: 0, nextRetryAt: 0 };
  return Math.min(1000 * Math.pow(2, state.failures), MAX_BACKOFF_MS);
}

function recordFailure(provider: string) {
  const state = _backoff[provider] ?? { failures: 0, nextRetryAt: 0 };
  state.failures = Math.min(state.failures + 1, 10);
  state.nextRetryAt = Date.now() + getBackoff(provider);
  _backoff[provider] = state;
}

function recordSuccess(provider: string) {
  _backoff[provider] = { failures: 0, nextRetryAt: 0 };
}

function isInBackoff(provider: string): boolean {
  const state = _backoff[provider];
  if (!state) return false;
  return state.failures > 0 && Date.now() < state.nextRetryAt;
}

// ─── Health Checks ─────────────────────────────────────────────────────────────

/** Check Supabase DB connectivity */
async function checkDatabaseHealth(): Promise<boolean> {
  if (isInBackoff('supabase')) return true; // assume OK during backoff
  try {
    const start = Date.now();
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('feed_cache_meta')
      .select('sport', { count: 'exact', head: true })
      .limit(1);
    const latency = Date.now() - start;
    if (error) throw error;
    recordSuccess('supabase');
    if (latency > 3000 && shouldAlert('db_slow')) {
      log('DB_SLOW', `Query latency ${latency}ms (threshold: 3000ms)`);
    }
    return true;
  } catch (e) {
    recordFailure('supabase');
    if (shouldAlert('db_unreachable')) {
      log('DB_UNREACHABLE', String(e).slice(0, 120));
    }
    return false;
  }
}

/** Check for stale feed cache and invalidate if needed */
async function checkFeedFreshness(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('feed_cache_meta')
      .select('sport, last_generated')
      .eq('sport', 'football')
      .maybeSingle();

    if (!data?.last_generated) {
      if (shouldAlert('feed_meta_missing')) {
        log('FEED_META_MISSING', 'feed_cache_meta has no football row');
      }
      return;
    }

    const age = Date.now() - new Date(data.last_generated).getTime();
    if (age > CACHE_STALE_THRESHOLD) {
      invalidateFeedCache();
      log('FEED_CACHE_INVALIDATED', `Age was ${Math.round(age / 60000)}min (threshold: ${CACHE_STALE_THRESHOLD / 60000}min)`);
    }
  } catch { /* non-blocking */ }
}

/** Check for prediction gaps on live/upcoming matches */
async function checkPredictionCoverage(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const plus6h = new Date(Date.now() + 6 * 3600_000).toISOString();

    // Count upcoming matches in next 6h without any prediction
    const { count: matchCount } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['upcoming', 'live'])
      .gte('match_time', now)
      .lte('match_time', plus6h);

    if (!matchCount || matchCount === 0) return;

    const { count: predCount } = await supabase
      .from('predictions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString());

    const gap = (matchCount ?? 0) - (predCount ?? 0);
    if (gap > PREDICTION_GAP_LIMIT && shouldAlert('prediction_gap')) {
      log('PREDICTION_GAP', `${gap} matches in next 6h have no prediction`);
      // Trigger auto-generation via edge function
      await triggerPredictionBackfill().catch(() => {});
    }
  } catch { /* non-blocking */ }
}

/** Trigger prediction backfill edge function */
async function triggerPredictionBackfill(): Promise<void> {
  if (isInBackoff('predictions')) return;
  try {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('generate-prediction', {
      body: { backfill: true, limit: 10, sport: 'football' },
    });
    recordSuccess('predictions');
    log('PREDICTION_BACKFILL_TRIGGERED');
  } catch (e) {
    recordFailure('predictions');
    log('PREDICTION_BACKFILL_FAILED', String(e).slice(0, 100));
  }
}

/** Log a pipeline alert to DB for admin visibility */
async function logPipelineAlert(type: string, message: string, severity: 'info' | 'warning' | 'critical' = 'warning'): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('pipeline_alerts').insert({
      alert_type: type,
      severity,
      message,
      details: { source: 'self-healing-service', ts: new Date().toISOString() },
      resolved: false,
    });
  } catch { /* non-blocking */ }
}

// ─── Main Health Cycle ────────────────────────────────────────────────────────

async function runHealthCycle(): Promise<void> {
  if (_isRunning) return; // prevent overlapping cycles
  _isRunning = true;
  try {
    // 1. Database health
    const dbOk = await checkDatabaseHealth();
    if (!dbOk) {
      await logPipelineAlert('db_unreachable', 'Supabase database unreachable during health check', 'critical');
      return; // no point running other checks
    }

    // 2. Feed freshness
    await checkFeedFreshness();

    // 3. Prediction coverage
    await checkPredictionCoverage();

  } catch (e) {
    log('HEALTH_CYCLE_ERROR', String(e).slice(0, 120));
  } finally {
    _isRunning = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start the self-healing service. Safe to call multiple times (idempotent). */
export function startSelfHealing(): void {
  if (_intervalId !== null) return; // already running
  log('STARTED', `interval=${HEALTH_INTERVAL_MS / 1000}s`);
  // Run first cycle after a short delay (don't block app startup)
  const firstRunTimer = setTimeout(() => runHealthCycle(), 10_000);
  _intervalId = setInterval(runHealthCycle, HEALTH_INTERVAL_MS);
  // Cleanup on double-start
  (_intervalId as any).__firstRunTimer = firstRunTimer;
}

/** Stop the self-healing service. */
export function stopSelfHealing(): void {
  if (_intervalId === null) return;
  clearTimeout((_intervalId as any).__firstRunTimer);
  clearInterval(_intervalId);
  _intervalId = null;
  log('STOPPED');
}

/** Force an immediate health cycle (useful for admin panel). */
export function triggerHealthCycle(): void {
  runHealthCycle();
}

/** Get the last 20 recovery events for display in admin/audit panels. */
export function getRecoveryLog(): ReadonlyArray<{ ts: string; event: string; detail?: string }> {
  return _recoveryLog;
}

/** Get current backoff state (for diagnostics). */
export function getBackoffState(): Record<string, { failures: number; nextRetryAt: number }> {
  return { ..._backoff };
}

export default {
  start: startSelfHealing,
  stop: stopSelfHealing,
  trigger: triggerHealthCycle,
  getLog: getRecoveryLog,
};
