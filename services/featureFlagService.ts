/**
 * services/featureFlagService.ts — PredictXta Phase 7 Feature Flag & Kill Switch Service
 *
 * Provides runtime feature-flag resolution with:
 *   - Local cache (5-minute TTL) to minimise DB queries
 *   - Kill switches for all major features
 *   - A/B experiment variant assignment
 *   - Graceful degradation (defaults to enabled when flag not found)
 *
 * SECURITY: Flags are fetched from the `feature_flags` table via anon key.
 * Kill switches are ENABLED=true by default to prevent service disruption on DB failure.
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Flag definitions ─────────────────────────────────────────────────────────
export type FlagKey =
  | 'prediction_generation'
  | 'live_predictions'
  | 'ai_reports'
  | 'push_notifications'
  | 'sport_football'
  | 'sport_basketball'
  | 'sport_tennis'
  | 'sport_cricket'
  | 'sport_mma'
  | 'sport_esports'
  | 'provider_api_football'
  | 'provider_thesportsdb'
  | 'provider_openai'
  | 'provider_anthropic'
  | 'provider_groq'
  | 'vip_predictions'
  | 'expert_slips'
  | 'daily_challenge'
  | 'market_odds_display'
  | 'model_openai';

// All flags default to ENABLED — fail-safe for production
const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  prediction_generation:  true,
  live_predictions:       true,
  ai_reports:             true,
  push_notifications:     true,
  sport_football:         true,
  sport_basketball:       true,
  sport_tennis:           true,
  sport_cricket:          true,
  sport_mma:              true,
  sport_esports:          true,
  provider_api_football:  true,
  provider_thesportsdb:   true,
  provider_openai:        true,
  provider_anthropic:     true,
  provider_groq:          true,
  vip_predictions:        true,
  expert_slips:           true,
  daily_challenge:        true,
  market_odds_display:    true,
  model_openai:           true,
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_KEY = '@predictxta/feature_flags_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface FlagCache {
  flags: Partial<Record<FlagKey, { enabled: boolean; rollout_pct: number }>>;
  fetchedAt: number;
}

let _memCache: FlagCache | null = null;

async function loadCache(): Promise<FlagCache | null> {
  if (_memCache && Date.now() - _memCache.fetchedAt < CACHE_TTL_MS) return _memCache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: FlagCache = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS * 2) return null; // stale
    _memCache = parsed;
    return parsed;
  } catch { return null; }
}

async function saveCache(flags: FlagCache): Promise<void> {
  _memCache = flags;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flags));
  } catch { /* non-blocking */ }
}

// ─── Fetch all flags from DB ──────────────────────────────────────────────────
async function fetchFlags(): Promise<FlagCache> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_key, enabled, rollout_pct')
    .eq('target_env', 'production')
    .limit(100);

  if (error || !data) {
    // Return defaults on failure — never disable features due to DB error
    const defaults: FlagCache = {
      flags: {},
      fetchedAt: Date.now(),
    };
    return defaults;
  }

  const flags: FlagCache['flags'] = {};
  for (const row of data as Array<{ flag_key: string; enabled: boolean; rollout_pct: number }>) {
    flags[row.flag_key as FlagKey] = {
      enabled: row.enabled,
      rollout_pct: row.rollout_pct,
    };
  }

  return { flags, fetchedAt: Date.now() };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * isEnabled — check if a feature flag is enabled.
 * Returns true by default (fail-safe) when flag not found or DB is unavailable.
 *
 * @param flag - The flag key to check
 * @param userId - Optional user ID for rollout percentage bucketing
 */
export async function isEnabled(flag: FlagKey, userId?: string): Promise<boolean> {
  try {
    // Try cache first
    let cache = await loadCache();

    // Refresh if stale
    if (!cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
      cache = await fetchFlags();
      await saveCache(cache);
    }

    const entry = cache.flags[flag];
    if (!entry) return FLAG_DEFAULTS[flag] ?? true; // default to enabled

    if (!entry.enabled) return false;

    // Rollout percentage bucketing (deterministic by userId)
    if (entry.rollout_pct < 100 && userId) {
      const hash = simpleHash(flag + ':' + userId);
      return (hash % 100) < entry.rollout_pct;
    }

    return entry.enabled;
  } catch {
    // Never block a feature due to flag service failure
    return FLAG_DEFAULTS[flag] ?? true;
  }
}

/**
 * isEnabledSync — synchronous check using in-memory cache.
 * Returns true if no cache is available.
 */
export function isEnabledSync(flag: FlagKey): boolean {
  if (!_memCache) return FLAG_DEFAULTS[flag] ?? true;
  const entry = _memCache.flags[flag];
  if (!entry) return FLAG_DEFAULTS[flag] ?? true;
  return entry.enabled;
}

/**
 * refreshFlags — force-refresh the flag cache.
 */
export async function refreshFlags(): Promise<void> {
  const cache = await fetchFlags();
  await saveCache(cache);
}

/**
 * getAllFlags — return all flag states (for admin debug display).
 */
export async function getAllFlags(): Promise<Array<{ key: FlagKey; enabled: boolean; rollout_pct: number }>> {
  const cache = await fetchFlags();
  return (Object.keys(FLAG_DEFAULTS) as FlagKey[]).map((key) => ({
    key,
    enabled: cache.flags[key]?.enabled ?? FLAG_DEFAULTS[key] ?? true,
    rollout_pct: cache.flags[key]?.rollout_pct ?? 100,
  }));
}

// ─── Deterministic hash for rollout bucketing ─────────────────────────────────
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Experiment variant assignment ────────────────────────────────────────────
export interface ExperimentAssignment {
  experimentKey: string;
  variant: string | null;
  inExperiment: boolean;
}

/**
 * getExperimentVariant — deterministically assign a user to an experiment variant.
 * Returns null variant if user is not in the experiment's traffic bucket.
 */
export async function getExperimentVariant(
  experimentKey: string,
  userId: string,
): Promise<ExperimentAssignment> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('experiments')
      .select('status, variants, traffic_pct')
      .eq('experiment_key', experimentKey)
      .eq('status', 'running')
      .maybeSingle();

    if (!data) return { experimentKey, variant: null, inExperiment: false };

    // Check if user is in traffic bucket
    const trafficHash = simpleHash(experimentKey + ':traffic:' + userId) % 100;
    if (trafficHash >= data.traffic_pct) {
      return { experimentKey, variant: null, inExperiment: false };
    }

    // Assign to variant
    const variants = data.variants as Array<{ key: string; weight: number }>;
    if (!variants || variants.length === 0) {
      return { experimentKey, variant: null, inExperiment: false };
    }

    const variantHash = simpleHash(experimentKey + ':variant:' + userId) % 100;
    let cumWeight = 0;
    for (const v of variants) {
      cumWeight += v.weight ?? (100 / variants.length);
      if (variantHash < cumWeight) {
        return { experimentKey, variant: v.key, inExperiment: true };
      }
    }

    return { experimentKey, variant: variants[0].key, inExperiment: true };
  } catch {
    return { experimentKey, variant: null, inExperiment: false };
  }
}

export default { isEnabled, isEnabledSync, refreshFlags, getAllFlags, getExperimentVariant };
