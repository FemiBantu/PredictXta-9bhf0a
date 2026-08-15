/**
 * dataValidator.ts — Enterprise Data Validation Layer
 *
 * Validates all incoming data before storage:
 *   - Match fixtures (from REST polling)
 *   - Live score updates (from WebSocket / Firebase)
 *   - Odds data (from WebSocket / REST)
 *   - Match events / webhooks
 *   - Prediction objects (from AI engine)
 *
 * Returns a typed ValidationResult with:
 *   - isValid: boolean
 *   - dqScore: 0–100 (data quality score)
 *   - errors: string[]
 *   - warnings: string[]
 *   - sanitised: T (cleaned + normalised object)
 */

export interface ValidationResult<T = unknown> {
  isValid: boolean;
  dqScore: number;          // 0–100
  errors: string[];
  warnings: string[];
  sanitised: T;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function isValidIso(v: unknown): boolean {
  if (!isNonEmptyString(v)) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}
function isValidOdds(v: unknown): boolean {
  const n = Number(v);
  return isFinite(n) && n >= 1.01 && n <= 1000;
}
function isValidScore(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 50;
}
function isValidProbability(v: unknown): boolean {
  const n = Number(v);
  return isFinite(n) && n >= 0 && n <= 1;
}
function isValidConfidence(v: unknown): boolean {
  const n = Number(v);
  return isFinite(n) && n >= 0 && n <= 100;
}
function clampScore(v: unknown): number {
  const n = Number(v ?? 0);
  return Math.max(0, Math.min(50, isNaN(n) ? 0 : Math.round(n)));
}
function clampProb(v: unknown): number {
  const n = Number(v ?? 0);
  return Math.max(0, Math.min(1, isNaN(n) ? 0 : n));
}
function sanitiseString(v: unknown, maxLen = 255): string {
  if (!isNonEmptyString(v)) return '';
  return String(v).trim().slice(0, maxLen);
}
function sanitiseUrl(v: unknown): string | null {
  if (!isNonEmptyString(v)) return null;
  try { const u = new URL(v); return u.href; } catch { return null; }
}

// ─── Supported enums ────────────────────────────────────────────────────────
const VALID_SPORTS = new Set([
  'football', 'basketball', 'tennis', 'cricket', 'mma', 'baseball',
  'hockey', 'rugby', 'volleyball', 'american_football', 'golf',
  'cycling', 'formula1', 'esports',
]);
const VALID_MATCH_STATUSES = new Set(['upcoming', 'live', 'finished', 'postponed', 'cancelled']);
const VALID_EVENT_TYPES = new Set([
  'goal', 'own_goal', 'penalty_goal', 'penalty_miss', 'yellow_card', 'red_card',
  'second_yellow', 'substitution', 'var_review', 'var_overturned', 'halftime',
  'fulltime', 'extratime_start', 'extratime_end', 'penalty_shootout',
  'injury_time', 'quarter_end', 'break_of_serve', 'set_won',
]);

// ─── Match Fixture Validator ────────────────────────────────────────────────
export interface RawMatchInput {
  id?: unknown;
  external_id?: unknown;
  sport?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  home_score?: unknown;
  away_score?: unknown;
  status?: unknown;
  match_time?: unknown;
  league?: unknown;
  league_id?: unknown;
  home_logo?: unknown;
  away_logo?: unknown;
  league_logo?: unknown;
  venue?: unknown;
  minute?: unknown;
  round?: unknown;
  country?: unknown;
  source_provider?: unknown;
}

export interface SanitisedMatch {
  external_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: string;
  match_time: string;
  league: string;
  league_id: number | null;
  home_logo: string | null;
  away_logo: string | null;
  league_logo: string | null;
  venue: string | null;
  minute: number;
  round: string | null;
  country: string | null;
  source_provider: string;
}

export function validateMatch(raw: RawMatchInput): ValidationResult<SanitisedMatch> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let dqScore = 100;

  // Required fields
  const homeTeam = sanitiseString(raw.home_team, 100);
  const awayTeam = sanitiseString(raw.away_team, 100);
  const sport = sanitiseString(raw.sport, 50).toLowerCase();
  const matchTime = sanitiseString(raw.match_time, 50);
  const externalId = sanitiseString(raw.external_id, 100);

  if (!homeTeam) { errors.push('home_team is required'); dqScore -= 25; }
  if (!awayTeam) { errors.push('away_team is required'); dqScore -= 25; }
  if (homeTeam === awayTeam && homeTeam !== '') {
    errors.push('home_team and away_team must be different');
    dqScore -= 15;
  }
  if (!matchTime || !isValidIso(matchTime)) {
    errors.push('match_time must be a valid ISO timestamp');
    dqScore -= 15;
  }
  if (!sport || !VALID_SPORTS.has(sport)) {
    warnings.push(`Unknown sport "${sport}" — defaulting to football`);
    dqScore -= 5;
  }

  // Optional validations
  const status = sanitiseString(raw.status, 20).toLowerCase() || 'upcoming';
  if (!VALID_MATCH_STATUSES.has(status)) {
    warnings.push(`Unknown status "${status}" — defaulting to upcoming`);
    dqScore -= 5;
  }

  const homeScore = clampScore(raw.home_score);
  const awayScore = clampScore(raw.away_score);

  if (raw.home_score !== undefined && !isValidScore(raw.home_score)) {
    warnings.push(`Invalid home_score "${raw.home_score}" — clamped to ${homeScore}`);
    dqScore -= 3;
  }
  if (raw.away_score !== undefined && !isValidScore(raw.away_score)) {
    warnings.push(`Invalid away_score "${raw.away_score}" — clamped to ${awayScore}`);
    dqScore -= 3;
  }

  const homeLogo = sanitiseUrl(raw.home_logo);
  const awayLogo = sanitiseUrl(raw.away_logo);
  const leagueLogo = sanitiseUrl(raw.league_logo);

  if (raw.home_logo && !homeLogo) { warnings.push('home_logo URL is invalid'); dqScore -= 2; }
  if (raw.away_logo && !awayLogo) { warnings.push('away_logo URL is invalid'); dqScore -= 2; }

  if (!externalId) { warnings.push('external_id missing — deduplication may fail'); dqScore -= 5; }

  const sanitised: SanitisedMatch = {
    external_id: externalId || `generated-${homeTeam}-${awayTeam}-${matchTime}`.replace(/\s/g, '_'),
    sport: VALID_SPORTS.has(sport) ? sport : 'football',
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    status: VALID_MATCH_STATUSES.has(status) ? status : 'upcoming',
    match_time: matchTime,
    league: sanitiseString(raw.league, 100) || 'Unknown League',
    league_id: raw.league_id != null ? Number(raw.league_id) || null : null,
    home_logo: homeLogo,
    away_logo: awayLogo,
    league_logo: leagueLogo,
    venue: sanitiseString(raw.venue, 150) || null,
    minute: Math.max(0, Math.min(120, Number(raw.minute ?? 0) || 0)),
    round: sanitiseString(raw.round, 50) || null,
    country: sanitiseString(raw.country, 50) || null,
    source_provider: sanitiseString(raw.source_provider, 50) || 'unknown',
  };

  return {
    isValid: errors.length === 0,
    dqScore: Math.max(0, dqScore),
    errors,
    warnings,
    sanitised,
  };
}

// ─── Odds Validator ──────────────────────────────────────────────────────────
export interface RawOddsInput {
  match_id?: unknown;
  external_match_id?: unknown;
  bookmaker?: unknown;
  home_win?: unknown;
  draw?: unknown;
  away_win?: unknown;
  over_2_5?: unknown;
  under_2_5?: unknown;
  btts_yes?: unknown;
  btts_no?: unknown;
  home_handicap?: unknown;
  away_handicap?: unknown;
  handicap_line?: unknown;
}

export interface SanitisedOdds {
  external_match_id: string;
  bookmaker: string;
  home_win: number | null;
  draw: number | null;
  away_win: number | null;
  over_2_5: number | null;
  under_2_5: number | null;
  btts_yes: number | null;
  btts_no: number | null;
  home_handicap: number | null;
  away_handicap: number | null;
  handicap_line: number | null;
}

export function validateOdds(raw: RawOddsInput): ValidationResult<SanitisedOdds> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let dqScore = 100;

  const externalMatchId = sanitiseString(raw.external_match_id, 100);
  if (!externalMatchId && !raw.match_id) {
    errors.push('external_match_id or match_id required');
    dqScore -= 30;
  }

  const bookmaker = sanitiseString(raw.bookmaker, 50) || 'Unknown';

  function safeOdds(v: unknown, field: string): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (!isValidOdds(v)) {
      warnings.push(`${field} odds ${v} out of range [1.01–1000] — set to null`);
      dqScore -= 2;
      return null;
    }
    return parseFloat(Number(v).toFixed(3));
  }

  const homeWin = safeOdds(raw.home_win, 'home_win');
  const draw = safeOdds(raw.draw, 'draw');
  const awayWin = safeOdds(raw.away_win, 'away_win');

  if (!homeWin && !awayWin) {
    errors.push('At least home_win and away_win odds are required');
    dqScore -= 20;
  }

  // Sanity: home win can't be same as away win for a major mismatch
  if (homeWin && awayWin && Math.abs(homeWin - awayWin) > 50) {
    warnings.push('Extreme odds spread detected — verify data accuracy');
    dqScore -= 5;
  }

  const sanitised: SanitisedOdds = {
    external_match_id: externalMatchId,
    bookmaker,
    home_win: homeWin,
    draw,
    away_win: awayWin,
    over_2_5: safeOdds(raw.over_2_5, 'over_2_5'),
    under_2_5: safeOdds(raw.under_2_5, 'under_2_5'),
    btts_yes: safeOdds(raw.btts_yes, 'btts_yes'),
    btts_no: safeOdds(raw.btts_no, 'btts_no'),
    home_handicap: safeOdds(raw.home_handicap, 'home_handicap'),
    away_handicap: safeOdds(raw.away_handicap, 'away_handicap'),
    handicap_line: raw.handicap_line != null ? parseFloat(Number(raw.handicap_line).toFixed(1)) : null,
  };

  return {
    isValid: errors.length === 0,
    dqScore: Math.max(0, dqScore),
    errors,
    warnings,
    sanitised,
  };
}

// ─── Match Event Validator (webhooks) ────────────────────────────────────────
export interface RawEventInput {
  match_id?: unknown;
  external_match_id?: unknown;
  event_type?: unknown;
  player_name?: unknown;
  player_id?: unknown;
  assist_name?: unknown;
  team?: unknown;
  is_home_team?: unknown;
  minute?: unknown;
  extra_minute?: unknown;
  detail?: unknown;
  comments?: unknown;
}

export interface SanitisedEvent {
  external_match_id: string;
  event_type: string;
  player_name: string;
  player_id: number | null;
  assist_name: string | null;
  team: string;
  is_home_team: boolean;
  minute: number;
  extra_minute: number | null;
  detail: string | null;
  comments: string | null;
}

export function validateMatchEvent(raw: RawEventInput): ValidationResult<SanitisedEvent> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let dqScore = 100;

  const externalMatchId = sanitiseString(raw.external_match_id, 100);
  if (!externalMatchId && !raw.match_id) {
    errors.push('external_match_id or match_id required');
    dqScore -= 25;
  }

  const rawType = sanitiseString(raw.event_type, 50).toLowerCase().replace(/[\s-]/g, '_');
  let eventType = rawType;

  if (!VALID_EVENT_TYPES.has(rawType)) {
    warnings.push(`Unknown event_type "${rawType}" — stored as-is`);
    dqScore -= 5;
  }

  const minute = Math.max(0, Math.min(120, Number(raw.minute ?? 0) || 0));
  if (minute === 0 && raw.minute !== 0 && raw.minute !== '0') {
    warnings.push('Invalid minute — defaulted to 0');
    dqScore -= 3;
  }

  const sanitised: SanitisedEvent = {
    external_match_id: externalMatchId,
    event_type: eventType,
    player_name: sanitiseString(raw.player_name, 100),
    player_id: raw.player_id != null ? Number(raw.player_id) || null : null,
    assist_name: sanitiseString(raw.assist_name, 100) || null,
    team: sanitiseString(raw.team, 100),
    is_home_team: raw.is_home_team !== false && raw.is_home_team !== 'false' && raw.is_home_team !== 0,
    minute,
    extra_minute: raw.extra_minute != null ? Math.max(0, Number(raw.extra_minute) || 0) : null,
    detail: sanitiseString(raw.detail, 255) || null,
    comments: sanitiseString(raw.comments, 500) || null,
  };

  return {
    isValid: errors.length === 0,
    dqScore: Math.max(0, dqScore),
    errors,
    warnings,
    sanitised,
  };
}

// ─── Prediction Quality Validator ────────────────────────────────────────────
export interface RawPredictionInput {
  match_id?: unknown;
  home_win_prob?: unknown;
  draw_prob?: unknown;
  away_win_prob?: unknown;
  predicted_result?: unknown;
  confidence?: unknown;
  over_under?: unknown;
  over_under_line?: unknown;
  btts?: unknown;
  ai_analysis?: unknown;
  key_factors?: unknown;
  risk_level?: unknown;
  value_score?: unknown;
  correct_score?: unknown;
  predicted_home_goals?: unknown;
  predicted_away_goals?: unknown;
}

export interface SanitisedPrediction {
  match_id: string;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  predicted_result: 'home_win' | 'draw' | 'away_win';
  confidence: number;
  over_under: 'over' | 'under';
  over_under_line: number;
  btts: 'yes' | 'no';
  ai_analysis: string;
  key_factors: string[];
  risk_level: string;
  value_score: number;
  correct_score: string | null;
  predicted_home_goals: number | null;
  predicted_away_goals: number | null;
  dq_score: number;
  warning_flags: string[];
}

export function validatePrediction(raw: RawPredictionInput): ValidationResult<SanitisedPrediction> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let dqScore = 100;
  const warningFlags: string[] = [];

  const matchId = sanitiseString(raw.match_id, 100);
  if (!matchId) { errors.push('match_id is required'); dqScore -= 30; }

  // Probability validation
  const hw = clampProb(raw.home_win_prob);
  const dp = clampProb(raw.draw_prob);
  const ap = clampProb(raw.away_win_prob);
  const probSum = hw + dp + ap;

  if (probSum < 0.85 || probSum > 1.15) {
    warnings.push(`Probabilities sum to ${probSum.toFixed(3)} (expected ~1.0)`);
    warningFlags.push('prob_sum_anomaly');
    dqScore -= 10;
  }

  if (!isValidProbability(raw.home_win_prob)) { warnings.push('home_win_prob out of range'); dqScore -= 5; }
  if (!isValidProbability(raw.draw_prob)) { warnings.push('draw_prob out of range'); dqScore -= 5; }
  if (!isValidProbability(raw.away_win_prob)) { warnings.push('away_win_prob out of range'); dqScore -= 5; }

  const confidence = Number(raw.confidence ?? 0);
  if (!isValidConfidence(raw.confidence)) {
    warnings.push(`confidence ${confidence} out of range [0–100]`);
    dqScore -= 5;
  }

  // Hallucination detection: AI analysis must not contain invented stats
  const analysis = sanitiseString(raw.ai_analysis, 2000);
  const HALLUCINATION_PATTERNS = [
    /\b(\d{1,3})%\s+(?:win|chance|probability)\b/gi,   // fabricated percentages
    /\bwon\s+\d+\s+of\s+(?:their\s+)?\d+\s+matches\b/gi, // invented records
    /\b(?:goals|xg)\s+of\s+\d+\.\d+\b/gi,               // invented xG values
  ];

  let hallucinationCount = 0;
  for (const pattern of HALLUCINATION_PATTERNS) {
    const matches = analysis.match(pattern);
    if (matches && matches.length > 3) { hallucinationCount++; }
  }
  if (hallucinationCount > 1) {
    warnings.push('High statistical claim density — verify against Verified Facts Object');
    warningFlags.push('hallucination_risk');
    dqScore -= 8;
  }

  // Key factors check
  const keyFactors = Array.isArray(raw.key_factors)
    ? (raw.key_factors as unknown[]).map((f) => sanitiseString(f, 200)).filter(Boolean)
    : [];
  if (keyFactors.length === 0) { warnings.push('No key_factors provided'); dqScore -= 5; }

  const predictedResult = ['home_win', 'draw', 'away_win'].includes(sanitiseString(raw.predicted_result))
    ? (sanitiseString(raw.predicted_result) as 'home_win' | 'draw' | 'away_win')
    : 'home_win';

  const sanitised: SanitisedPrediction = {
    match_id: matchId,
    home_win_prob: hw,
    draw_prob: dp,
    away_win_prob: ap,
    predicted_result: predictedResult,
    confidence: Math.max(0, Math.min(100, confidence)),
    over_under: ['over', 'under'].includes(sanitiseString(raw.over_under)) ? (sanitiseString(raw.over_under) as 'over' | 'under') : 'over',
    over_under_line: parseFloat(Number(raw.over_under_line ?? 2.5).toFixed(1)),
    btts: ['yes', 'no'].includes(sanitiseString(raw.btts)) ? (sanitiseString(raw.btts) as 'yes' | 'no') : 'no',
    ai_analysis: analysis,
    key_factors: keyFactors,
    risk_level: sanitiseString(raw.risk_level, 20) || 'Medium',
    value_score: Math.max(0, Math.min(100, Number(raw.value_score ?? 50) || 50)),
    correct_score: sanitiseString(raw.correct_score, 10) || null,
    predicted_home_goals: raw.predicted_home_goals != null ? parseFloat(Number(raw.predicted_home_goals).toFixed(1)) : null,
    predicted_away_goals: raw.predicted_away_goals != null ? parseFloat(Number(raw.predicted_away_goals).toFixed(1)) : null,
    dq_score: Math.max(0, dqScore),
    warning_flags: warningFlags,
  };

  return {
    isValid: errors.length === 0 && dqScore >= 50,
    dqScore: Math.max(0, dqScore),
    errors,
    warnings,
    sanitised,
  };
}

// ─── Batch validator helper ─────────────────────────────────────────────────
export function batchValidateMatches(rows: RawMatchInput[]): {
  valid: SanitisedMatch[];
  rejected: Array<{ row: RawMatchInput; errors: string[] }>;
  avgDqScore: number;
} {
  const valid: SanitisedMatch[] = [];
  const rejected: Array<{ row: RawMatchInput; errors: string[] }> = [];
  let totalDq = 0;

  for (const row of rows) {
    const result = validateMatch(row);
    if (result.isValid) {
      valid.push(result.sanitised);
      totalDq += result.dqScore;
    } else {
      rejected.push({ row, errors: result.errors });
    }
  }

  return {
    valid,
    rejected,
    avgDqScore: valid.length > 0 ? Math.round(totalDq / valid.length) : 0,
  };
}

export function batchValidateOdds(rows: RawOddsInput[]): {
  valid: SanitisedOdds[];
  rejected: Array<{ row: RawOddsInput; errors: string[] }>;
} {
  const valid: SanitisedOdds[] = [];
  const rejected: Array<{ row: RawOddsInput; errors: string[] }> = [];
  for (const row of rows) {
    const result = validateOdds(row);
    if (result.isValid) valid.push(result.sanitised);
    else rejected.push({ row, errors: result.errors });
  }
  return { valid, rejected };
}
