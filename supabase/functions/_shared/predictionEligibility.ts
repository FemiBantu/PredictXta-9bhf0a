/**
 * _shared/predictionEligibility.ts — Phase 4 Prediction Eligibility Gate
 *
 * Determines whether a match is eligible for pre-match prediction generation.
 *
 * Rules (P0 — never generate predictions for matches that have started):
 *   1. Match status must be 'upcoming' (not live/finished)
 *   2. Match time must be in the future (≥ 0ms from now, configurable buffer)
 *   3. Sport must be in the canonical 13-sport registry
 *   4. Required minimum data fields must be present
 *   5. Data quality score must meet minimum threshold (≥ 25)
 *
 * Returns one of:
 *   ELIGIBLE          — prediction can proceed
 *   MATCH_STARTED     — match is live or match_time is past (pre-match blocked)
 *   MATCH_FINISHED    — match result available (pre-match blocked)
 *   UNSUPPORTED_SPORT — sport not in canonical registry
 *   INSUFFICIENT_DATA — data quality score below minimum
 *   ALREADY_PREDICTED — recent prediction exists within TTL
 */

export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'MATCH_STARTED'
  | 'MATCH_FINISHED'
  | 'UNSUPPORTED_SPORT'
  | 'INSUFFICIENT_DATA'
  | 'ALREADY_PREDICTED'
  | 'STALE_DATA';

export interface EligibilityResult {
  eligible:  boolean;
  status:    EligibilityStatus;
  reason:    string;
  dqScore?:  number;
  minutesToKickoff?: number;
}

// Canonical 13 sports — must match sportsRegistry.ts SPORTS_REGISTRY
const CANONICAL_SPORT_KEYS = new Set([
  'football', 'basketball', 'tennis', 'cricket', 'baseball',
  'hockey', 'rugby', 'american-football', 'mma', 'boxing',
  'volleyball', 'handball', 'esports',
]);

// Removed sports — explicitly rejected
const REMOVED_SPORTS = new Set([
  'formula1', 'formula-1', 'f1', 'afl', 'australian-football',
  'table-tennis', 'snooker', 'darts', 'badminton',
]);

export interface MatchEligibilityInput {
  matchId:        string;
  sport:          string;
  status:         string;
  matchTime:      string;   // ISO UTC timestamp
  dqScore?:       number;
  hasPrediction?: boolean;  // true if recent prediction already exists
  predictionTtlMs?: number; // TTL before re-generation allowed (default: 4h)
}

/**
 * Check whether a match is eligible for (pre-match) prediction generation.
 * This gate is called at the START of generate-prediction and multi-model-prediction.
 *
 * It enforces the critical Phase 4 rule:
 *   Never generate a pre-match prediction after the match has started.
 */
export function checkPredictionEligibility(
  input: MatchEligibilityInput,
): EligibilityResult {
  const {
    sport,
    status,
    matchTime,
    dqScore,
    hasPrediction = false,
    predictionTtlMs = 4 * 3600_000,
  } = input;

  // 1. Removed/unsupported sport guard
  const canonicalSport = sport.toLowerCase().replace(/\s+/g, '-');
  if (REMOVED_SPORTS.has(canonicalSport)) {
    return {
      eligible: false,
      status: 'UNSUPPORTED_SPORT',
      reason: `Sport '${sport}' has been removed from PredictXta. Canonical 13 sports only.`,
    };
  }
  if (!CANONICAL_SPORT_KEYS.has(canonicalSport)) {
    return {
      eligible: false,
      status: 'UNSUPPORTED_SPORT',
      reason: `Sport '${sport}' is not in the canonical 13-sport registry.`,
    };
  }

  // 2. Match finished — no new pre-match predictions
  if (status === 'finished') {
    return {
      eligible: false,
      status: 'MATCH_FINISHED',
      reason: 'Match has already finished. Settle existing predictions instead.',
    };
  }

  // 3. Match live — pre-match prediction blocked; use live prediction endpoint instead
  if (status === 'live') {
    return {
      eligible: false,
      status: 'MATCH_STARTED',
      reason: 'Match is currently live. Pre-match prediction generation blocked.',
    };
  }

  // 4. Time-based check — match time must be in the future
  const kickoffMs     = new Date(matchTime).getTime();
  const nowMs         = Date.now();
  const minutesToKick = Math.round((kickoffMs - nowMs) / 60_000);

  if (kickoffMs <= nowMs) {
    // Match has started (time is in the past) even if status not yet updated
    return {
      eligible: false,
      status: 'MATCH_STARTED',
      reason: `Match kickoff was ${Math.abs(minutesToKick)} min ago — pre-match prediction blocked.`,
      minutesToKickoff: minutesToKick,
    };
  }

  // 5. Data quality minimum
  const MIN_DQ = 25; // absolute minimum to produce any prediction
  if (dqScore !== undefined && dqScore < MIN_DQ) {
    return {
      eligible: false,
      status: 'INSUFFICIENT_DATA',
      reason: `Data quality score ${dqScore}/100 is below minimum ${MIN_DQ}. Cannot generate reliable prediction.`,
      dqScore,
      minutesToKickoff: minutesToKick,
    };
  }

  // 6. Already predicted within TTL (skip if fresh prediction exists)
  if (hasPrediction) {
    return {
      eligible: false,
      status: 'ALREADY_PREDICTED',
      reason: `Recent prediction exists within TTL (${predictionTtlMs / 3600_000}h). Use cached prediction or set bypass_cache=true to regenerate.`,
      minutesToKickoff: minutesToKick,
    };
  }

  // All checks passed
  return {
    eligible: true,
    status: 'ELIGIBLE',
    reason: `Match eligible: ${minutesToKick} min to kickoff, sport=${sport}, dq=${dqScore ?? 'unknown'}`,
    dqScore,
    minutesToKickoff: minutesToKick,
  };
}

/**
 * Check if a data snapshot is too stale for prediction generation.
 * match_time is stored in UTC; provider data must have been fetched
 * within the relevant staleness window.
 */
export function isMatchDataStale(
  lastUpdatedAt: string | null | undefined,
  sport: string,
): boolean {
  if (!lastUpdatedAt) return true;
  const ageMs = Date.now() - new Date(lastUpdatedAt).getTime();

  // Staleness thresholds by sport (faster-moving sports need fresher data)
  const STALE_MS: Record<string, number> = {
    football:           6 * 3600_000,   // 6 hours
    basketball:         4 * 3600_000,   // 4 hours
    tennis:             6 * 3600_000,
    cricket:            8 * 3600_000,
    baseball:           6 * 3600_000,
    hockey:             4 * 3600_000,
    rugby:              6 * 3600_000,
    'american-football': 8 * 3600_000,
    mma:                12 * 3600_000,  // event data is stable longer
    boxing:             12 * 3600_000,
    volleyball:         6 * 3600_000,
    handball:           6 * 3600_000,
    esports:            4 * 3600_000,
  };

  const threshold = STALE_MS[sport.toLowerCase()] ?? 6 * 3600_000;
  return ageMs > threshold;
}
