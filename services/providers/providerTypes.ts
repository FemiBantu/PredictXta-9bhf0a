/**
 * services/providers/providerTypes.ts
 *
 * Canonical internal data types — Phase 3.
 *
 * The frontend MUST ONLY consume these canonical types.
 * Provider-specific response shapes are NEVER exposed outside adapters.
 *
 * Architecture:
 *   Provider API → Adapter → CanonicalMatch | CanonicalOdds | CanonicalStanding
 *                          → Validation → DB/Cache → Frontend
 */

// ─── Canonical match status ────────────────────────────────────────────────────
export type CanonicalStatus =
  | 'NOT_STARTED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'HALFTIME'
  | 'PAUSED'
  | 'FINISHED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'ABANDONED'
  | 'SUSPENDED';

/** DB storage values — all provider statuses map to one of these */
export type DbMatchStatus = 'live' | 'upcoming' | 'finished';

// ─── Canonical match ───────────────────────────────────────────────────────────
export interface CanonicalMatch {
  /** PredictXta canonical UUID (generated or from DB) */
  id?: string;

  /** Provider-namespaced external ID (e.g. 'football-12345', 'basketball-tsdb-99') */
  externalId: string;

  /** Source provider that supplied this record */
  sourceProvider: 'api-football' | 'api-sports' | 'thesportsdb';

  /** Canonical PredictXta sport key */
  sport: string;

  /** Canonical home team name */
  homeTeam: string;

  /** Canonical away team name */
  awayTeam: string;

  /** Current home score */
  homeScore: number;

  /** Current away score */
  awayScore: number;

  /** DB storage status */
  status: DbMatchStatus;

  /** Canonical status (more granular than DB storage status) */
  canonicalStatus?: CanonicalStatus;

  /** UTC ISO timestamp */
  matchTime: string;

  /** Canonical league name */
  league: string;

  /** Provider league ID (not PredictXta canonical ID) */
  leagueId?: number | null;

  /** Country for league */
  country?: string | null;

  /** Venue name */
  venue?: string | null;

  /** Live match minute */
  minute?: number;

  /** Competition round */
  round?: string | null;

  /** Home team badge URL */
  homeLogo?: string | null;

  /** Away team badge URL */
  awayLogo?: string | null;

  /** League logo URL */
  leagueLogo?: string | null;

  /** Sport-specific statistics (format varies by sport) */
  stats?: Record<string, unknown> | null;

  /** Recent form — last 5 results e.g. ['W','W','D','L','W'] */
  homeForm?: string[];

  /** Recent form */
  awayForm?: string[];

  /** Last time this record was updated */
  lastUpdated: string;

  /** Unified match ID for deduplication */
  unifiedMatchId?: string;
}

// ─── Canonical odds ────────────────────────────────────────────────────────────
export type OddsMarket =
  | '1X2'           // football win/draw/win
  | 'MONEYLINE'     // non-football home/away
  | 'DOUBLE_CHANCE'
  | 'BTTS'          // both teams to score
  | 'OVER_UNDER'    // total goals/points
  | 'ASIAN_HANDICAP'
  | 'SPREAD'        // basketball/american football
  | 'TOTAL_POINTS'
  | 'MATCH_WINNER'  // tennis/boxing/mma
  | 'SET_WINNER'
  | 'TOTAL_GAMES'
  | 'TEAM_RUNS'     // cricket
  | 'INNINGS_RUNS'
  | 'CUSTOM';

export interface CanonicalOdds {
  matchId: string;
  externalMatchId: string;
  bookmaker: string;
  market: OddsMarket;
  homeWin?: number | null;
  draw?: number | null;
  awayWin?: number | null;
  over25?: number | null;
  under25?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  handicapLine?: number | null;
  homeHandicap?: number | null;
  awayHandicap?: number | null;
  provider: 'api-football' | 'api-sports' | 'thesportsdb';
  retrievedAt: string;
  lastUpdated: string;
}

// ─── Canonical standing ────────────────────────────────────────────────────────
export interface CanonicalStanding {
  leagueId: number;
  leagueName: string;
  season: number;
  sport: string;
  teamName: string;
  teamLogo?: string | null;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form?: string | null;
  description?: string | null;
}

// ─── Canonical event ───────────────────────────────────────────────────────────
export type CanonicalEventType =
  | 'GOAL'
  | 'OWN_GOAL'
  | 'PENALTY_GOAL'
  | 'PENALTY_MISS'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'SECOND_YELLOW'
  | 'SUBSTITUTION'
  | 'VAR_REVIEW'
  | 'WICKET'          // cricket
  | 'BOUNDARY'        // cricket
  | 'ROUND_END'       // boxing/mma
  | 'KNOCKOUT'        // boxing/mma
  | 'POINT'           // volleyball/handball
  | 'CUSTOM';

export interface CanonicalMatchEvent {
  matchId: string;
  externalMatchId: string;
  eventType: CanonicalEventType;
  playerName?: string;
  playerId?: number | null;
  assistName?: string | null;
  team: string;
  isHomeTeam?: boolean;
  minute: number;
  extraMinute?: number | null;
  detail?: string | null;
  comments?: string | null;
}

// ─── Canonical lineup ──────────────────────────────────────────────────────────
export interface CanonicalLineup {
  matchId: string;
  teamName: string;
  isHomeTeam: boolean;
  formation?: string | null;
  coach?: string | null;
  startingXI: Array<{
    playerId?: number | null;
    playerName: string;
    position?: string | null;
    number?: number | null;
  }>;
  substitutes: Array<{
    playerId?: number | null;
    playerName: string;
    position?: string | null;
    number?: number | null;
  }>;
}

// ─── Canonical statistic ───────────────────────────────────────────────────────
export interface CanonicalMatchStat {
  matchId: string;
  teamName: string;
  isHomeTeam: boolean;
  sport: string;
  // Football
  possession?: number | null;
  shotsTotal?: number | null;
  shotsOnTarget?: number | null;
  corners?: number | null;
  fouls?: number | null;
  yellowCards?: number | null;
  redCards?: number | null;
  offsides?: number | null;
  // Basketball
  rebounds?: number | null;
  assists?: number | null;
  turnovers?: number | null;
  fieldGoalPct?: number | null;
  threePointPct?: number | null;
  freeThrowPct?: number | null;
  // Tennis
  aces?: number | null;
  doubleFaults?: number | null;
  breakPoints?: number | null;
  serveWinPct?: number | null;
  // Cricket
  runs?: number | null;
  wickets?: number | null;
  overs?: number | null;
  // Custom (sport-specific overflow)
  custom?: Record<string, unknown> | null;
}

// ─── Fetch state (frontend contract) ──────────────────────────────────────────
export type FetchState = 'LOADING' | 'AVAILABLE' | 'PARTIAL' | 'STALE' | 'UNAVAILABLE' | 'ERROR';

export interface DataWithState<T> {
  data: T | null;
  state: FetchState;
  provider?: string;
  lastUpdated?: string;
  error?: string;
}

// ─── Entity mapping types ──────────────────────────────────────────────────────
export type EntityType = 'sport' | 'country' | 'league' | 'season' | 'team' | 'player' | 'venue' | 'match';

export interface ProviderEntityMapping {
  provider: string;
  entityType: EntityType;
  providerId: string;
  predictxtaId: string;
  confidence: number; // 0-100
  lastVerifiedAt: string;
}

// ─── Ingestion result ──────────────────────────────────────────────────────────
export interface IngestionResult {
  provider: string;
  sport: string;
  fetched: number;
  normalized: number;
  upserted: number;
  rejected: number;
  duplicatesRemoved: number;
  errors: string[];
  durationMs: number;
  dataQualityScore?: number;
}
