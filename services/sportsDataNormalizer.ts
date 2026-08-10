/**
 * services/sportsDataNormalizer.ts
 *
 * Unified Sports Data Normalization Layer
 *
 * Converts raw API responses from any provider (API-Football, TheSportsDB,
 * Highlightly, Firebase RTDB) into the canonical UnifiedMatch schema.
 *
 * Architecture:
 *   Raw API Response → SportAdapter → UnifiedMatch → UI Components
 *
 * Supported sports:
 *   Football, Basketball, Tennis, Cricket, Baseball, Hockey,
 *   Rugby, MMA, Esports, American Football, Handball, Volleyball, Formula 1
 */

import type { Match, MatchStats } from './types';

// ─── Unified Match Schema ─────────────────────────────────────────────────────
export interface UnifiedMatch extends Match {
  /** Data quality score 0-100 — determines confidence ceiling */
  dataQualityScore: number;
  /** ELO rating estimate for home team */
  homeElo?: number;
  /** ELO rating estimate for away team */
  awayElo?: number;
  /** Recent form as W/D/L array */
  homeForm?: string[];
  awayForm?: string[];
  /** League table position */
  homeStandingsPos?: number;
  awayStandingsPos?: number;
  /** Season stats */
  homeGoalsScored?: number;
  awayGoalsScored?: number;
  homeGoalsConceded?: number;
  awayGoalsConceded?: number;
  /** H2H history */
  h2h?: H2HRecord[];
  /** Active injuries/suspensions */
  injuries?: string[];
  suspensions?: string[];
}

export interface H2HRecord {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date: string;
}

// ─── Sport Classification ─────────────────────────────────────────────────────
export interface SportConfig {
  /** Whether draws are possible */
  drawPossible: boolean;
  /** Whether 1st/2nd half markets apply */
  hasHalftime: boolean;
  /** Typical O/U line unit label */
  ouUnit: string;
  /** Default O/U line value */
  defaultOULine: number;
  /** Whether corners market applies */
  hasCorners: boolean;
  /** Whether cards market applies */
  hasCards: boolean;
  /** Whether BTTS applies */
  hasBTTS: boolean;
}

export const SPORT_CONFIGS: Record<string, SportConfig> = {
  football: { drawPossible: true, hasHalftime: true, ouUnit: 'goals', defaultOULine: 2.5, hasCorners: true, hasCards: true, hasBTTS: true },
  soccer: { drawPossible: true, hasHalftime: true, ouUnit: 'goals', defaultOULine: 2.5, hasCorners: true, hasCards: true, hasBTTS: true },
  basketball: { drawPossible: false, hasHalftime: true, ouUnit: 'points', defaultOULine: 215.5, hasCorners: false, hasCards: false, hasBTTS: false },
  tennis: { drawPossible: false, hasHalftime: false, ouUnit: 'sets', defaultOULine: 2.5, hasCorners: false, hasCards: false, hasBTTS: true },
  cricket: { drawPossible: true, hasHalftime: false, ouUnit: 'runs', defaultOULine: 320.5, hasCorners: false, hasCards: false, hasBTTS: false },
  baseball: { drawPossible: false, hasHalftime: true, ouUnit: 'runs', defaultOULine: 8.5, hasCorners: false, hasCards: false, hasBTTS: false },
  hockey: { drawPossible: false, hasHalftime: true, ouUnit: 'goals', defaultOULine: 5.5, hasCorners: false, hasCards: false, hasBTTS: false },
  rugby: { drawPossible: true, hasHalftime: true, ouUnit: 'points', defaultOULine: 42.5, hasCorners: false, hasCards: true, hasBTTS: true },
  mma: { drawPossible: false, hasHalftime: false, ouUnit: 'rounds', defaultOULine: 2.5, hasCorners: false, hasCards: false, hasBTTS: false },
  boxing: { drawPossible: false, hasHalftime: false, ouUnit: 'rounds', defaultOULine: 8.5, hasCorners: false, hasCards: false, hasBTTS: false },
  handball: { drawPossible: false, hasHalftime: true, ouUnit: 'goals', defaultOULine: 55.5, hasCorners: false, hasCards: true, hasBTTS: false },
  volleyball: { drawPossible: false, hasHalftime: false, ouUnit: 'sets', defaultOULine: 3.5, hasCorners: false, hasCards: false, hasBTTS: false },
  'american-football': { drawPossible: false, hasHalftime: true, ouUnit: 'points', defaultOULine: 48.5, hasCorners: false, hasCards: false, hasBTTS: false },
  formula1: { drawPossible: false, hasHalftime: false, ouUnit: 'positions', defaultOULine: 3.5, hasCorners: false, hasCards: false, hasBTTS: false },
  esports: { drawPossible: false, hasHalftime: false, ouUnit: 'maps', defaultOULine: 2.5, hasCorners: false, hasCards: false, hasBTTS: false },
};

export function getSportConfig(sport: string): SportConfig {
  return SPORT_CONFIGS[sport.toLowerCase()] ?? SPORT_CONFIGS['football'];
}

// ─── Data Quality Scorer ──────────────────────────────────────────────────────
/**
 * Compute a data quality score (0-100) for a match based on available enrichment.
 * Used to cap prediction confidence ceiling:
 *   DQ < 30 → max confidence 55%
 *   DQ < 50 → max confidence 68%
 *   DQ < 70 → max confidence 82%
 *   DQ ≥ 70 → uncapped
 */
export function computeDataQualityScore(match: Partial<UnifiedMatch>): number {
  let score = 35; // baseline for any match with team names
  if (match.homeTeam && match.awayTeam) score += 5;
  if (match.league) score += 3;
  if (match.homeForm && match.homeForm.length >= 3) score += 10;
  if (match.awayForm && match.awayForm.length >= 3) score += 10;
  if (match.h2h && match.h2h.length >= 2) score += 10;
  if (match.homeStandingsPos && match.awayStandingsPos) score += 8;
  if (match.homeGoalsScored !== undefined && match.awayGoalsScored !== undefined) score += 8;
  if (match.homeOdds && match.awayOdds) score += 10;
  if (match.injuries && match.injuries.length > 0) score += 4;
  if (match.stats && Object.keys(match.stats).length > 0) score += 5;
  return Math.min(100, score);
}

/**
 * Returns the maximum confidence level allowed for a given data quality score.
 */
export function getConfidenceCeiling(dqScore: number): number {
  if (dqScore < 30) return 55;
  if (dqScore < 50) return 68;
  if (dqScore < 70) return 82;
  return 95;
}

// ─── Status Normalizer ────────────────────────────────────────────────────────
export function normalizeMatchStatus(raw: string | undefined | null): 'live' | 'upcoming' | 'finished' {
  if (!raw) return 'upcoming';
  const s = raw.toLowerCase();
  if (['1h', '2h', 'ht', 'et', 'p', 'live', 'in_play', 'inprogress', 'in progress', 'halftime', 'half time', 'extra time'].includes(s)) return 'live';
  if (['ft', 'aet', 'pen', 'fin', 'finished', 'full time', 'fulltime', 'ended', 'complete', 'completed', 'match finished', 'after extra time', 'after penalties'].includes(s)) return 'finished';
  if (['ns', 'tbd', 'sched', 'scheduled', 'not started', 'upcoming', 'fixture'].includes(s)) return 'upcoming';
  return 'upcoming';
}

// ─── Date Normalizer ──────────────────────────────────────────────────────────
/**
 * Convert any date format to an ISO 8601 UTC string.
 * Handles: ISO, Unix timestamps, RFC3339, custom API formats.
 */
export function normalizeDateToISO(raw: string | number | null | undefined): string {
  if (!raw) return new Date().toISOString();

  // Unix timestamp (number or numeric string)
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d{10,13}$/.test(raw.trim()))) {
    const ts = typeof raw === 'number' ? raw : parseInt(raw, 10);
    const ms = ts < 1e12 ? ts * 1000 : ts; // convert seconds to ms
    return new Date(ms).toISOString();
  }

  // Already ISO-ish string
  if (typeof raw === 'string') {
    // Handle "2024-01-15T14:30:00+00:00" and similar
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch { /* fall through */ }

    // Handle "15/01/2024 14:30" (DD/MM/YYYY HH:MM)
    const ddmmyyyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/);
    if (ddmmyyyy) {
      const [, day, month, year, time] = ddmmyyyy;
      try {
        return new Date(`${year}-${month}-${day}T${time ?? '12:00'}:00Z`).toISOString();
      } catch { /* fall through */ }
    }
  }

  return new Date().toISOString();
}

// ─── API-Football Adapter ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptApiFootballMatch(raw: any): UnifiedMatch {
  const fixture = raw?.fixture ?? raw ?? {};
  const teams = raw?.teams ?? {};
  const goals = raw?.goals ?? raw?.score?.fulltime ?? {};
  const league = raw?.league ?? {};
  const stats = raw?.statistics ?? null;

  const homeScore = Number(goals?.home ?? goals?.home_goals ?? 0);
  const awayScore = Number(goals?.away ?? goals?.away_goals ?? 0);
  const status = normalizeMatchStatus(fixture?.status?.short ?? fixture?.status?.long ?? raw?.status);
  const matchTime = normalizeDateToISO(fixture?.date ?? raw?.date);

  const match: UnifiedMatch = {
    id: String(fixture?.id ?? raw?.id ?? Math.random()),
    sport: 'football',
    homeTeam: teams?.home?.name ?? raw?.homeTeam ?? 'Home Team',
    awayTeam: teams?.away?.name ?? raw?.awayTeam ?? 'Away Team',
    homeLogo: teams?.home?.logo ?? raw?.homeLogo ?? null,
    awayLogo: teams?.away?.logo ?? raw?.awayLogo ?? null,
    homeScore,
    awayScore,
    status,
    matchTime,
    league: league?.name ?? raw?.league ?? '',
    country: league?.country ?? raw?.country ?? '',
    venue: fixture?.venue?.name ?? raw?.venue ?? '',
    minute: Number(fixture?.status?.elapsed ?? raw?.minute ?? 0),
    round: raw?.league?.round ?? raw?.round ?? '',
    leagueLogo: league?.logo ?? null,
    homeOdds: raw?.odds?.home ?? null,
    drawOdds: raw?.odds?.draw ?? null,
    awayOdds: raw?.odds?.away ?? null,
    stats: stats ?? null,
    externalId: String(fixture?.id ?? ''),
    dataQualityScore: 0,
  };
  match.dataQualityScore = computeDataQualityScore(match);
  return match;
}

// ─── TheSportsDB Adapter ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptTheSportsDbEvent(raw: any): UnifiedMatch {
  const homeScore = raw?.intHomeScore !== null ? Number(raw.intHomeScore) : 0;
  const awayScore = raw?.intAwayScore !== null ? Number(raw.intAwayScore) : 0;
  const status = normalizeMatchStatus(raw?.strStatus ?? raw?.strProgress);
  const matchTime = normalizeDateToISO(
    raw?.strTimestamp ?? (raw?.dateEvent && raw?.strTime ? `${raw.dateEvent}T${raw.strTime}` : raw?.dateEvent),
  );

  // Infer sport from TheSportsDB sport field
  const rawSport = (raw?.strSport ?? 'Soccer').toLowerCase();
  const sportMap: Record<string, string> = {
    soccer: 'football', football: 'football',
    basketball: 'basketball', tennis: 'tennis',
    baseball: 'baseball', hockey: 'hockey', 'ice hockey': 'hockey',
    rugby: 'rugby', 'rugby league': 'rugby', 'rugby union': 'rugby',
    cricket: 'cricket', 'american football': 'american-football',
    handball: 'handball', volleyball: 'volleyball',
    mma: 'mma', 'mixed martial arts': 'mma', boxing: 'boxing',
    esports: 'esports', 'formula 1': 'formula1', 'motor sport': 'formula1',
  };
  const sport = sportMap[rawSport] ?? 'football';

  const match: UnifiedMatch = {
    id: String(raw?.idEvent ?? Math.random()),
    sport,
    homeTeam: raw?.strHomeTeam ?? 'Home Team',
    awayTeam: raw?.strAwayTeam ?? 'Away Team',
    homeLogo: raw?.strHomeTeamBadge ?? raw?.strThumb ?? null,
    awayLogo: raw?.strAwayTeamBadge ?? null,
    homeScore,
    awayScore,
    status,
    matchTime,
    league: raw?.strLeague ?? raw?.strLeagueBadge ?? '',
    country: raw?.strCountry ?? '',
    venue: raw?.strVenue ?? '',
    minute: 0,
    round: raw?.intRound ? `Round ${raw.intRound}` : '',
    leagueLogo: raw?.strLeagueBadge ?? null,
    stats: null,
    externalId: String(raw?.idEvent ?? ''),
    dataQualityScore: 0,
  };
  match.dataQualityScore = computeDataQualityScore(match);
  return match;
}

// ─── Firebase RTDB Adapter ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptFirebaseMatch(raw: any, id: string): UnifiedMatch {
  const match: UnifiedMatch = {
    id: id ?? String(raw?.id ?? Math.random()),
    sport: raw?.sport ?? 'football',
    homeTeam: raw?.home_team ?? raw?.homeTeam ?? 'Home Team',
    awayTeam: raw?.away_team ?? raw?.awayTeam ?? 'Away Team',
    homeLogo: raw?.home_logo ?? raw?.homeLogo ?? null,
    awayLogo: raw?.away_logo ?? raw?.awayLogo ?? null,
    homeScore: Number(raw?.home_score ?? raw?.homeScore ?? 0),
    awayScore: Number(raw?.away_score ?? raw?.awayScore ?? 0),
    status: normalizeMatchStatus(raw?.status),
    matchTime: normalizeDateToISO(raw?.match_time ?? raw?.matchTime ?? raw?.timestamp),
    league: raw?.league ?? '',
    country: raw?.country ?? '',
    venue: raw?.venue ?? '',
    minute: Number(raw?.minute ?? 0),
    round: raw?.round ?? '',
    leagueLogo: raw?.league_logo ?? raw?.leagueLogo ?? null,
    stats: raw?.stats ?? null,
    externalId: String(raw?.external_id ?? raw?.externalId ?? ''),
    dataQualityScore: 0,
  };
  match.dataQualityScore = computeDataQualityScore(match);
  return match;
}

// ─── Supabase DB Row Adapter ──────────────────────────────────────────────────
// Centralised row → Match mapper used by all services
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptSupabaseRow(row: any): UnifiedMatch {
  if (!row) throw new Error('adaptSupabaseRow: null row');

  // Parse odds from stats blob or dedicated columns
  const stats = row.stats as Record<string, unknown> | null;
  const homeOdds = row.home_odds ?? stats?.home_odds ?? null;
  const drawOdds = row.draw_odds ?? stats?.draw_odds ?? null;
  const awayOdds = row.away_odds ?? stats?.away_odds ?? null;

  const match: UnifiedMatch = {
    id: String(row.id),
    sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    homeLogo: row.home_logo ?? null,
    awayLogo: row.away_logo ?? null,
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: normalizeMatchStatus(row.status),
    matchTime: normalizeDateToISO(row.match_time),
    league: row.league ?? '',
    country: row.country ?? '',
    venue: row.venue ?? '',
    minute: Number(row.minute ?? 0),
    round: row.round ?? '',
    leagueLogo: row.league_logo ?? null,
    homeOdds: homeOdds ? Number(homeOdds) : undefined,
    drawOdds: drawOdds ? Number(drawOdds) : undefined,
    awayOdds: awayOdds ? Number(awayOdds) : undefined,
    stats: stats as MatchStats,
    externalId: row.external_id ?? '',
    dataQualityScore: 0,
    // Form arrays from DB columns
    homeForm: Array.isArray(row.home_form) ? row.home_form : [],
    awayForm: Array.isArray(row.away_form) ? row.away_form : [],
  };
  match.dataQualityScore = computeDataQualityScore(match);
  return match;
}

// ─── Batch Normalization ──────────────────────────────────────────────────────
/**
 * Normalize an array of raw match rows from any source.
 * Auto-detects source from the row structure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMatchBatch(rows: any[], source: 'supabase' | 'api-football' | 'thesportsdb' | 'firebase' = 'supabase'): UnifiedMatch[] {
  return rows
    .filter((r) => r != null)
    .map((r, i) => {
      try {
        switch (source) {
          case 'api-football': return adaptApiFootballMatch(r);
          case 'thesportsdb': return adaptTheSportsDbEvent(r);
          case 'firebase': return adaptFirebaseMatch(r, r.id ?? String(i));
          default: return adaptSupabaseRow(r);
        }
      } catch (e) {
        console.warn(`[normalizeMatchBatch] Failed to normalize row ${i}:`, e);
        return null;
      }
    })
    .filter((m): m is UnifiedMatch => m !== null);
}

// ─── Deduplication ────────────────────────────────────────────────────────────
/**
 * Deduplicate matches by externalId, then by id.
 * Prefers the more enriched record when duplicates exist.
 */
export function deduplicateMatches(matches: UnifiedMatch[]): UnifiedMatch[] {
  const byExtId = new Map<string, UnifiedMatch>();
  const byId = new Map<string, UnifiedMatch>();

  for (const m of matches) {
    // Prefer record with higher data quality score
    if (m.externalId) {
      const existing = byExtId.get(m.externalId);
      if (!existing || m.dataQualityScore > existing.dataQualityScore) {
        byExtId.set(m.externalId, m);
      }
    } else {
      const existing = byId.get(m.id);
      if (!existing || m.dataQualityScore > existing.dataQualityScore) {
        byId.set(m.id, m);
      }
    }
  }

  // Merge: externalId-keyed records take precedence over id-keyed
  const result = new Map<string, UnifiedMatch>();
  for (const m of [...byExtId.values(), ...byId.values()]) {
    if (!result.has(m.id)) result.set(m.id, m);
  }
  return [...result.values()];
}

// ─── Form Score Calculator ────────────────────────────────────────────────────
/**
 * Convert form array ['W','D','L','W','W'] to a 0-100 score.
 * Recent results weighted more heavily (last result counts most).
 */
export function calculateFormScore(form: string[]): number {
  if (!form || form.length === 0) return 50;
  const weights = [1, 1.2, 1.4, 1.6, 2]; // last element has highest weight
  const aligned = form.slice(-5).reverse(); // most recent first

  let total = 0, weightSum = 0;
  aligned.forEach((result, i) => {
    const w = weights[Math.min(i, weights.length - 1)];
    const pts = result.toUpperCase() === 'W' ? 3 : result.toUpperCase() === 'D' ? 1 : 0;
    total += pts * w;
    weightSum += 3 * w; // max possible
  });

  return Math.round((total / weightSum) * 100);
}

// ─── ELO Calculator ──────────────────────────────────────────────────────────
/**
 * Estimate win probability from ELO rating difference.
 */
export function eloWinProbability(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

/**
 * Estimate ELO from standings position (proxy when real ELO unavailable).
 * Assumes league of 20 teams with ~1700 base ELO.
 */
export function estimateEloFromPosition(pos: number, totalTeams = 20): number {
  const base = 1700;
  const spread = 300; // difference between 1st and last
  return Math.round(base + ((totalTeams - pos) / (totalTeams - 1)) * spread);
}

// ─── Match sorting helpers ────────────────────────────────────────────────────
export function sortMatchesByPriority(matches: UnifiedMatch[]): UnifiedMatch[] {
  const statusOrder: Record<string, number> = { live: 0, upcoming: 1, finished: 2 };
  return [...matches].sort((a, b) => {
    const sDiff = (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);
    if (sDiff !== 0) return sDiff;
    return new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime();
  });
}

// ─── Pipeline validation ──────────────────────────────────────────────────────
/**
 * Pipeline diagnostic counters — helps identify where records drop off.
 */
export interface PipelineDiagnostics {
  apiCount: number;
  normalizedCount: number;
  dedupedCount: number;
  renderCount: number;
  sportBreakdown: Record<string, number>;
  dataQualityAvg: number;
  droppedReasons: string[];
}

export function buildPipelineDiagnostics(
  apiCount: number,
  normalized: UnifiedMatch[],
  deduped: UnifiedMatch[],
  rendered: UnifiedMatch[],
): PipelineDiagnostics {
  const breakdown: Record<string, number> = {};
  let dqSum = 0;
  for (const m of deduped) {
    breakdown[m.sport] = (breakdown[m.sport] ?? 0) + 1;
    dqSum += m.dataQualityScore;
  }
  const dropped = apiCount - normalized.length;
  const dedupDropped = normalized.length - deduped.length;

  return {
    apiCount,
    normalizedCount: normalized.length,
    dedupedCount: deduped.length,
    renderCount: rendered.length,
    sportBreakdown: breakdown,
    dataQualityAvg: deduped.length > 0 ? Math.round(dqSum / deduped.length) : 0,
    droppedReasons: [
      dropped > 0 ? `${dropped} records failed normalization` : '',
      dedupDropped > 0 ? `${dedupDropped} records deduplicated` : '',
    ].filter(Boolean),
  };
}
