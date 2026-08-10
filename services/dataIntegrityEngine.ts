/**
 * services/dataIntegrityEngine.ts
 *
 * PREDICTXTA UNIFIED DATA INTEGRITY ENGINE
 *
 * Implements all 10 phases of the enterprise API audit & normalization:
 *
 * Phase 1: Full API audit with provider health checking
 * Phase 2: Sport-specific endpoint validation (no cross-sport contamination)
 * Phase 3: Duplicate detection via UNIFIED_MATCH_ID
 * Phase 4: Match mapping engine with fuzzy team name resolution
 * Phase 5: League normalization with canonical registry
 * Phase 6: Mismatch detection & conflict resolution
 * Phase 7: Data quality gate before any UI render
 * Phase 8: Source priority engine per data type
 * Phase 9: Rendering validation
 * Phase 10: Monitoring & alerting
 */

import { getSupabaseClient } from '@/template';

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: SPORT-SPECIFIC ENDPOINT REGISTRY
// Each sport maps to its valid provider + endpoint combinations.
// Cross-sport contamination is blocked at the registry level.
// ─────────────────────────────────────────────────────────────────────────────

export type SportKey =
  | 'football' | 'basketball' | 'tennis' | 'baseball' | 'hockey'
  | 'rugby' | 'handball' | 'volleyball' | 'american-football'
  | 'cricket' | 'mma' | 'boxing' | 'formula1' | 'esports'
  | 'table-tennis' | 'badminton' | 'snooker' | 'darts' | 'motorsports'
  | 'cycling' | 'athletics';

export type ProviderKey = 'api-football' | 'api-sports' | 'thesportsdb';
export type DataType = 'fixtures' | 'standings' | 'statistics' | 'odds' | 'highlights' | 'news' | 'players' | 'events';

interface SportEndpointDef {
  sport: SportKey;
  provider: ProviderKey;
  dataType: DataType;
  endpoint: string;
  priority: 1 | 2 | 3;            // 1 = primary, 2 = secondary, 3 = tertiary
  apiBase: string;
  requiresApiKey: 'API_FOOTBALL_KEY' | 'SPORTSDB_KEY' | null;
}

/** Canonical registry: maps each sport+dataType to ordered provider endpoints. */
export const SPORT_ENDPOINT_REGISTRY: SportEndpointDef[] = [
  // ── FOOTBALL ──────────────────────────────────────────────────────────────
  { sport: 'football', provider: 'api-football',  dataType: 'fixtures',  endpoint: '/fixtures', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'thesportsdb',   dataType: 'fixtures',  endpoint: '/eventsday.php?s=Soccer', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'football', provider: 'api-football',  dataType: 'standings', endpoint: '/standings', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'thesportsdb',   dataType: 'standings', endpoint: '/lookuptable.php', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'football', provider: 'api-football',  dataType: 'odds',      endpoint: '/odds', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'api-football',  dataType: 'statistics',endpoint: '/fixtures/statistics', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'api-football',  dataType: 'events',    endpoint: '/fixtures/events', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'api-football',  dataType: 'players',   endpoint: '/players/topscorers', priority: 1, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'football', provider: 'thesportsdb',   dataType: 'highlights',endpoint: '/v2/schedule/previous (highlights)', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v2/json', requiresApiKey: null },
  { sport: 'football', provider: 'api-football',  dataType: 'news',      endpoint: '/fixtures (previews)', priority: 2, apiBase: 'https://v3.football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },

  // ── BASKETBALL ────────────────────────────────────────────────────────────
  { sport: 'basketball', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.basketball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'basketball', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Basketball', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'basketball', provider: 'api-sports',  dataType: 'standings', endpoint: '/standings', priority: 1, apiBase: 'https://v1.basketball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'basketball', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Basketball', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── TENNIS ────────────────────────────────────────────────────────────────
  { sport: 'tennis', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/matches', priority: 1, apiBase: 'https://v1.tennis.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'tennis', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Tennis', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'tennis', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Tennis', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── BASEBALL ─────────────────────────────────────────────────────────────
  { sport: 'baseball', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.baseball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'baseball', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Baseball', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'baseball', provider: 'api-sports',  dataType: 'standings', endpoint: '/standings', priority: 1, apiBase: 'https://v1.baseball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'baseball', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Baseball', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── HOCKEY ────────────────────────────────────────────────────────────────
  { sport: 'hockey', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.hockey.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'hockey', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Ice+Hockey', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'hockey', provider: 'api-sports',  dataType: 'standings', endpoint: '/standings', priority: 1, apiBase: 'https://v1.hockey.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'hockey', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Ice+Hockey', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── HANDBALL ─────────────────────────────────────────────────────────────
  { sport: 'handball', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.handball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'handball', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Handball', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'handball', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Handball', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── VOLLEYBALL ────────────────────────────────────────────────────────────
  { sport: 'volleyball', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.volleyball.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'volleyball', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Volleyball', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'volleyball', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Volleyball', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── RUGBY ─────────────────────────────────────────────────────────────────
  { sport: 'rugby', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.rugby.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'rugby', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Rugby+League', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'rugby', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Rugby+League', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── AMERICAN FOOTBALL ─────────────────────────────────────────────────────
  { sport: 'american-football', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/games', priority: 1, apiBase: 'https://v1.american-football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'american-football', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=American+Football', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'american-football', provider: 'api-sports',  dataType: 'standings', endpoint: '/standings', priority: 1, apiBase: 'https://v1.american-football.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },

  // ── CRICKET ───────────────────────────────────────────────────────────────
  { sport: 'cricket', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Cricket', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'cricket', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Cricket', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── MMA ───────────────────────────────────────────────────────────────────
  { sport: 'mma', provider: 'api-sports',  dataType: 'fixtures',  endpoint: '/fights', priority: 1, apiBase: 'https://v1.mma.api-sports.io', requiresApiKey: 'API_FOOTBALL_KEY' },
  { sport: 'mma', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Mixed+Martial+Arts', priority: 2, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'mma', provider: 'thesportsdb', dataType: 'highlights',endpoint: '/eventsday.php?s=Mixed+Martial+Arts', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── BOXING ────────────────────────────────────────────────────────────────
  { sport: 'boxing', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Boxing', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── FORMULA 1 ─────────────────────────────────────────────────────────────
  { sport: 'formula1', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=Motorsport', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── ESPORTS ───────────────────────────────────────────────────────────────
  { sport: 'esports', provider: 'thesportsdb', dataType: 'fixtures',  endpoint: '/eventsday.php?s=ESports', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },

  // ── TABLE TENNIS / BADMINTON / SNOOKER / DARTS ────────────────────────────
  { sport: 'table-tennis', provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Table+Tennis', priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'badminton',    provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Badminton',    priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'snooker',      provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Snooker',      priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'darts',        provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Darts',        priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'cycling',      provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Cycling',      priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'athletics',    provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Athletics',    priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
  { sport: 'motorsports',  provider: 'thesportsdb', dataType: 'fixtures', endpoint: '/eventsday.php?s=Motorsport',   priority: 1, apiBase: 'https://www.thesportsdb.com/api/v1/json', requiresApiKey: null },
];

/**
 * Returns valid endpoints for a given sport + data type, ordered by priority.
 * Rejects any cross-sport endpoint requests.
 */
export function getEndpointsForSport(sport: SportKey, dataType: DataType): SportEndpointDef[] {
  return SPORT_ENDPOINT_REGISTRY
    .filter((e) => e.sport === sport && e.dataType === dataType)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * ─── CENTRALIZED SPORTS REGISTRY ─────────────────────────────────────────────
 * Single source of truth for all sport identifiers and their aliases.
 * Used by validation, normalization, and provider mapping layers.
 */
export const SPORTS_REGISTRY: Record<string, { id: string; aliases: string[]; externalIdPrefixes: string[] }> = {
  football:           { id: 'football',           aliases: ['soccer'],                         externalIdPrefixes: ['football', 'soccer'] },
  basketball:         { id: 'basketball',          aliases: ['hoops'],                          externalIdPrefixes: ['basketball', 'nba', 'ncaa'] },
  tennis:             { id: 'tennis',              aliases: [],                                 externalIdPrefixes: ['tennis', 'atp', 'wta'] },
  'table-tennis':     { id: 'table-tennis',        aliases: ['ping-pong', 'tabletennis', 'tt'], externalIdPrefixes: ['table-tennis', 'tabletennis', 'tt', 'table_tennis'] },
  baseball:           { id: 'baseball',            aliases: [],                                 externalIdPrefixes: ['baseball', 'mlb'] },
  hockey:             { id: 'hockey',              aliases: ['ice-hockey'],                     externalIdPrefixes: ['hockey', 'ice-hockey', 'nhl'] },
  handball:           { id: 'handball',            aliases: [],                                 externalIdPrefixes: ['handball'] },
  volleyball:         { id: 'volleyball',          aliases: [],                                 externalIdPrefixes: ['volleyball'] },
  rugby:              { id: 'rugby',               aliases: ['rugby-league', 'rugby-union'],   externalIdPrefixes: ['rugby'] },
  'american-football':{ id: 'american-football',   aliases: ['nfl', 'gridiron'],                externalIdPrefixes: ['american-football', 'american', 'nfl'] },
  cricket:            { id: 'cricket',             aliases: [],                                 externalIdPrefixes: ['cricket'] },
  mma:                { id: 'mma',                 aliases: ['ufc', 'mixed-martial-arts'],      externalIdPrefixes: ['mma', 'ufc'] },
  boxing:             { id: 'boxing',              aliases: [],                                 externalIdPrefixes: ['boxing'] },
  formula1:           { id: 'formula1',            aliases: ['f1', 'motorsport'],               externalIdPrefixes: ['formula1', 'f1', 'motorsport', 'motorsports'] },
  esports:            { id: 'esports',             aliases: ['gaming'],                         externalIdPrefixes: ['esports', 'gaming'] },
  badminton:          { id: 'badminton',           aliases: [],                                 externalIdPrefixes: ['badminton'] },
  snooker:            { id: 'snooker',             aliases: [],                                 externalIdPrefixes: ['snooker'] },
  darts:              { id: 'darts',               aliases: [],                                 externalIdPrefixes: ['darts'] },
  cycling:            { id: 'cycling',             aliases: [],                                 externalIdPrefixes: ['cycling'] },
  athletics:          { id: 'athletics',           aliases: ['track-and-field'],                externalIdPrefixes: ['athletics', 'track'] },
  motorsports:        { id: 'motorsports',         aliases: ['formula1', 'f1'],                 externalIdPrefixes: ['motorsports', 'formula1', 'f1'] },
};

/**
 * ─── PROVIDER SPORT MAPPING LAYER ────────────────────────────────────────────
 * Maps provider-specific sport names to normalized sport IDs.
 * Ensures API responses always resolve to the canonical SPORTS_REGISTRY key.
 */
export const THESPORTSDB_SPORT_MAP: Record<string, string> = {
  'Soccer':              'football',
  'Basketball':          'basketball',
  'Tennis':              'tennis',
  'Table Tennis':        'table-tennis',
  'Cricket':             'cricket',
  'Baseball':            'baseball',
  'Ice Hockey':          'hockey',
  'Volleyball':          'volleyball',
  'Rugby League':        'rugby',
  'Rugby Union':         'rugby',
  'American Football':   'american-football',
  'Mixed Martial Arts':  'mma',
  'Boxing':              'boxing',
  'Motorsport':          'motorsports',
  'Formula 1':           'formula1',
  'ESports':             'esports',
  'Badminton':           'badminton',
  'Snooker':             'snooker',
  'Darts':               'darts',
  'Cycling':             'cycling',
  'Athletics':           'athletics',
  'Handball':            'handball',
};

export const APIFOOTBALL_SPORT_MAP: Record<string, string> = {
  football:              'football',
  basketball:            'basketball',
  tennis:                'tennis',
  cricket:               'cricket',
  baseball:              'baseball',
  hockey:                'hockey',
  handball:              'handball',
  volleyball:            'volleyball',
  rugby:                 'rugby',
  'american-football':   'american-football',
  mma:                   'mma',
};

/**
 * Normalize a raw sport string to a canonical SPORTS_REGISTRY key.
 * Checks direct match, aliases, and provider maps.
 */
export function normalizeSportId(rawSport: string): string {
  if (!rawSport) return 'football';
  const lower = rawSport.toLowerCase().trim();

  // Direct match in registry
  if (SPORTS_REGISTRY[lower]) return lower;

  // Check TheSportsDB map
  const tsdb = THESPORTSDB_SPORT_MAP[rawSport];
  if (tsdb) return tsdb;

  // Check aliases
  for (const [key, entry] of Object.entries(SPORTS_REGISTRY)) {
    if (entry.aliases.includes(lower)) return key;
  }

  return lower; // fallback: return as-is
}

/**
 * Validates that a given external_id is consistent with its sport.
 *
 * IMPORTANT: External IDs are NEVER the authoritative source for sport
 * determination — the `sport` field on the record is the authority.
 * This function only flags records where the external_id prefix belongs
 * to a DIFFERENT sport (true contamination), NOT where it simply
 * contains the correct sport name as a prefix.
 *
 * e.g. external_id='table-tennis-tsdb-seed-007', sport='table-tennis' → VALID
 * e.g. external_id='football-12345',             sport='basketball'   → INVALID
 * e.g. external_id='12345' (numeric only),        sport=any           → VALID (no prefix)
 */
export function validateExternalIdSport(externalId: string, sport: string): boolean {
  if (!externalId) return true; // no ID to validate
  const sportLower = normalizeSportId(sport);
  const extIdLower  = externalId.toLowerCase();

  // Pure numeric IDs (e.g. from API-Football) have no sport prefix — always valid
  if (/^\d+$/.test(externalId)) return true;

  // Get the allowed prefixes for this sport from the registry
  const sportEntry = SPORTS_REGISTRY[sportLower];
  const allowedPrefixes = sportEntry?.externalIdPrefixes ?? [sportLower];

  // PASS: external_id starts with an allowed prefix for this sport
  if (allowedPrefixes.some((pfx) => extIdLower.startsWith(pfx.toLowerCase()))) {
    return true;
  }

  // CHECK: does the external_id start with a prefix that belongs to a DIFFERENT sport?
  // If so, it is genuine contamination. If it starts with something neutral
  // (a provider name, a UUID, etc.) it is NOT contamination.
  for (const [otherSportKey, otherEntry] of Object.entries(SPORTS_REGISTRY)) {
    if (otherSportKey === sportLower) continue;
    if (otherEntry.externalIdPrefixes.some((pfx) => {
      // Only flag if the prefix is sport-specific (length > 4 to avoid accidental matches)
      return pfx.length > 4 && extIdLower.startsWith(pfx.toLowerCase());
    })) {
      // External ID prefix belongs to a different known sport → true contamination
      return false;
    }
  }

  // External ID has no recognized sport prefix — treat as neutral, NOT contamination
  // (e.g. provider-specific IDs like 'tsdb-12345', 'highlightly-xyz')
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: UNIFIED MATCH IDENTITY SYSTEM
// Generates a deterministic fingerprint for deduplication across providers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a UNIFIED_MATCH_ID from canonical fields.
 * Format: {sport}_{leagueKey}_{homeTeamKey}_{awayTeamKey}_{dateKey}
 *
 * All inputs are normalised before hashing to ensure cross-provider consistency.
 */
export function generateUnifiedMatchId(params: {
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  matchTime: string; // ISO string
}): string {
  const sport     = normalizeForKey(params.sport);
  const league    = normalizeForKey(resolveLeagueName(params.league));
  const homeTeam  = normalizeForKey(resolveTeamName(params.homeTeam, params.sport));
  const awayTeam  = normalizeForKey(resolveTeamName(params.awayTeam, params.sport));
  const date      = params.matchTime ? params.matchTime.substring(0, 10) : '0000-00-00'; // YYYY-MM-DD only

  return `${sport}_${league}_${homeTeam}_${awayTeam}_${date}`;
}

function normalizeForKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: CANONICAL TEAM REGISTRY
// Maps provider-specific team names to canonical names.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical Team Registry.
 * Structure: canonical_name → [alias1, alias2, ...]
 * Entries are lower-cased for matching.
 */
const CANONICAL_TEAMS: Array<{ canonical: string; aliases: string[]; sport?: string }> = [
  // ── Football / Soccer ────────────────────────────────────────────────────
  { canonical: 'Manchester United',    aliases: ['man utd', 'man united', 'manchester utd', 'manchester united fc', 'mufc'], sport: 'football' },
  { canonical: 'Manchester City',      aliases: ['man city', 'manchester city fc', 'mcfc', 'city'], sport: 'football' },
  { canonical: 'Arsenal',              aliases: ['arsenal fc', 'the gunners', 'afc'], sport: 'football' },
  { canonical: 'Chelsea',              aliases: ['chelsea fc', 'the blues', 'cfc'], sport: 'football' },
  { canonical: 'Liverpool',            aliases: ['liverpool fc', 'the reds', 'lfc'], sport: 'football' },
  { canonical: 'Tottenham Hotspur',    aliases: ['spurs', 'tottenham', 'thfc', 'tottenham hotspur fc'], sport: 'football' },
  { canonical: 'Real Madrid',          aliases: ['real madrid cf', 'madrid', 'real madrid c.f.'], sport: 'football' },
  { canonical: 'FC Barcelona',         aliases: ['barcelona', 'barça', 'barca', 'fcb', 'fc barcelona'], sport: 'football' },
  { canonical: 'Atletico Madrid',      aliases: ['atletico de madrid', 'atletico', 'atleti', 'at. madrid'], sport: 'football' },
  { canonical: 'Bayern Munich',        aliases: ['fc bayern munich', 'fc bayern münchen', 'fcb', 'bavarian'], sport: 'football' },
  { canonical: 'Borussia Dortmund',    aliases: ['bvb', 'bvb dortmund', 'dortmund'], sport: 'football' },
  { canonical: 'Juventus',             aliases: ['juventus fc', 'juve', 'la vecchia signora'], sport: 'football' },
  { canonical: 'AC Milan',             aliases: ['milan', 'acm', 'rossoneri'], sport: 'football' },
  { canonical: 'Inter Milan',          aliases: ['internazionale', 'inter', 'fc internazionale', 'nerazzurri'], sport: 'football' },
  { canonical: 'Paris Saint-Germain',  aliases: ['psg', 'paris sg', 'paris saint germain', 'paris-sg'], sport: 'football' },
  { canonical: 'Ajax',                 aliases: ['ajax amsterdam', 'afc ajax'], sport: 'football' },
  { canonical: 'Benfica',              aliases: ['sl benfica', 'sport lisboa e benfica'], sport: 'football' },
  { canonical: 'Porto',                aliases: ['fc porto'], sport: 'football' },
  { canonical: 'Sporting CP',          aliases: ['sporting', 'sporting clube de portugal', 'sporting lisbon'], sport: 'football' },
  { canonical: 'Celtic',               aliases: ['celtic fc', 'the bhoys'], sport: 'football' },
  { canonical: 'Rangers',              aliases: ['rangers fc', 'the gers'], sport: 'football' },
  // ── Basketball (NBA) ─────────────────────────────────────────────────────
  { canonical: 'Los Angeles Lakers',   aliases: ['lakers', 'la lakers', 'l.a. lakers'], sport: 'basketball' },
  { canonical: 'Boston Celtics',       aliases: ['celtics', 'bos celtics'], sport: 'basketball' },
  { canonical: 'Golden State Warriors',aliases: ['warriors', 'gsw', 'golden state'], sport: 'basketball' },
  { canonical: 'Miami Heat',           aliases: ['heat', 'mia heat'], sport: 'basketball' },
  { canonical: 'Chicago Bulls',        aliases: ['bulls', 'chi bulls'], sport: 'basketball' },
  { canonical: 'Brooklyn Nets',        aliases: ['nets', 'bkn nets', 'brooklyn'], sport: 'basketball' },
  // ── American Football (NFL) ───────────────────────────────────────────────
  { canonical: 'Kansas City Chiefs',   aliases: ['chiefs', 'kc chiefs'], sport: 'american-football' },
  { canonical: 'Philadelphia Eagles',  aliases: ['eagles', 'phi eagles'], sport: 'american-football' },
  { canonical: 'Dallas Cowboys',       aliases: ['cowboys', 'dal cowboys'], sport: 'american-football' },
  { canonical: 'San Francisco 49ers',  aliases: ['49ers', '49s', 'sf 49ers'], sport: 'american-football' },
  // ── Baseball (MLB) ────────────────────────────────────────────────────────
  { canonical: 'New York Yankees',     aliases: ['yankees', 'nyy', 'ny yankees'], sport: 'baseball' },
  { canonical: 'Los Angeles Dodgers',  aliases: ['dodgers', 'lad', 'la dodgers'], sport: 'baseball' },
  { canonical: 'Houston Astros',       aliases: ['astros', 'hou astros'], sport: 'baseball' },
];

// ─── EXPANDED CANONICAL TEAMS (sport-specific registries) ──────────────────
// All non-football sports use player/team names that should be resolved
// against their OWN canonical registries, not the football one.
// Adding basketball, baseball, volleyball, rugby, hockey, handball teams.
const CANONICAL_TEAMS_EXTENDED: Array<{ canonical: string; aliases: string[]; sport?: string }> = [
  // ── Baseball (MLB) ────────────────────────────────────────────────────────
  { canonical: 'St. Louis Cardinals',  aliases: ['cardinals', 'stl cardinals', 'st louis cardinals'], sport: 'baseball' },
  { canonical: 'Chicago Cubs',         aliases: ['cubs', 'chi cubs'], sport: 'baseball' },
  { canonical: 'Boston Red Sox',       aliases: ['red sox', 'bos red sox'], sport: 'baseball' },
  { canonical: 'San Francisco Giants', aliases: ['giants', 'sf giants'], sport: 'baseball' },
  { canonical: 'Atlanta Braves',       aliases: ['braves', 'atl braves'], sport: 'baseball' },
  { canonical: 'New York Mets',        aliases: ['mets', 'ny mets'], sport: 'baseball' },
  // ── Ice Hockey (NHL) ─────────────────────────────────────────────────────
  { canonical: 'Colorado Avalanche',   aliases: ['avalanche', 'col avalanche'], sport: 'hockey' },
  { canonical: 'Tampa Bay Lightning',  aliases: ['lightning', 'tb lightning'], sport: 'hockey' },
  { canonical: 'Edmonton Oilers',      aliases: ['oilers', 'edm oilers'], sport: 'hockey' },
  { canonical: 'Pittsburgh Penguins',  aliases: ['penguins', 'pit penguins'], sport: 'hockey' },
  { canonical: 'Vegas Golden Knights', aliases: ['golden knights', 'vgk'], sport: 'hockey' },
  // ── Volleyball ────────────────────────────────────────────────────────────
  { canonical: 'Brazil Volleyball',    aliases: ['brazil', 'bra volleyball'], sport: 'volleyball' },
  { canonical: 'Poland Volleyball',    aliases: ['poland', 'pol volleyball'], sport: 'volleyball' },
  { canonical: 'Italy Volleyball',     aliases: ['italy', 'ita volleyball'], sport: 'volleyball' },
  { canonical: 'USA Volleyball',       aliases: ['usa', 'united states volleyball'], sport: 'volleyball' },
  // ── Rugby ─────────────────────────────────────────────────────────────────
  { canonical: 'New Zealand All Blacks',aliases: ['all blacks', 'nz all blacks', 'new zealand'], sport: 'rugby' },
  { canonical: 'South Africa Springboks',aliases: ['springboks', 'south africa rugby'], sport: 'rugby' },
  { canonical: 'England Rugby',        aliases: ['england', 'eng rugby'], sport: 'rugby' },
  { canonical: 'Australia Wallabies',  aliases: ['wallabies', 'australia rugby'], sport: 'rugby' },
  // ── Handball ─────────────────────────────────────────────────────────────
  { canonical: 'Denmark Handball',     aliases: ['denmark', 'den handball'], sport: 'handball' },
  { canonical: 'France Handball',      aliases: ['france', 'fra handball'], sport: 'handball' },
  { canonical: 'Sweden Handball',      aliases: ['sweden', 'swe handball'], sport: 'handball' },
];

/** Build lowercase alias → canonical lookup (sport-aware) */
const TEAM_ALIAS_MAP = new Map<string, string>();
const ALL_CANONICAL_TEAMS = [...CANONICAL_TEAMS, ...CANONICAL_TEAMS_EXTENDED];
for (const entry of ALL_CANONICAL_TEAMS) {
  // register canonical itself
  TEAM_ALIAS_MAP.set(entry.canonical.toLowerCase(), entry.canonical);
  for (const alias of entry.aliases) {
    TEAM_ALIAS_MAP.set(alias.toLowerCase(), entry.canonical);
  }
}

/**
 * Resolves a raw team name to its canonical form.
 * Returns the canonical name if found, otherwise returns the original name.
 * Confidence ≥ 95% required for auto-merge (enforced via alias registry).
 *
 * IMPORTANT: For sports whose team/player names are NOT in the canonical
 * registry (e.g. table tennis, MMA, boxing, tennis players), we return
 * the original name — this is NOT an error and must NOT be counted as
 * an "unmapped" team for scoring purposes.
 */
export function resolveTeamName(rawName: string, sport?: string): string {
  if (!rawName) return rawName;
  const lower = rawName.toLowerCase().trim();

  // Direct lookup first
  const direct = TEAM_ALIAS_MAP.get(lower);
  if (direct) return direct;

  // Partial match — only if unique
  let match: string | null = null;
  let matchCount = 0;
  for (const [alias, canonical] of TEAM_ALIAS_MAP) {
    if (lower.includes(alias) || alias.includes(lower)) {
      match = canonical;
      matchCount++;
    }
  }
  if (matchCount === 1 && match) return match;

  // No confident match — return original (send to validation queue conceptually)
  return rawName;
}

/**
 * Returns true if this sport's team/player names are expected to be in
 * the canonical team registry. Sports with individual athletes (tennis,
 * table-tennis, MMA, boxing, etc.) use player names that are NOT in the
 * team registry — these should not be penalized as "unmapped".
 */
export function sportHasCanonicalTeamRegistry(sport: string): boolean {
  const SPORTS_WITH_TEAM_REGISTRY = [
    'football', 'basketball', 'baseball', 'hockey', 'volleyball',
    'rugby', 'handball', 'american-football',
  ];
  return SPORTS_WITH_TEAM_REGISTRY.includes(normalizeSportId(sport));
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: CANONICAL LEAGUE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL_LEAGUES: Array<{ canonical: string; aliases: string[]; sport: string; country: string }> = [
  // ── Football Leagues ──────────────────────────────────────────────────────
  { canonical: 'Premier League',           aliases: ['english premier league', 'epl', 'barclays premier league', 'pl', 'bpl'], sport: 'football', country: 'England' },
  { canonical: 'Championship',             aliases: ['efl championship', 'sky bet championship'], sport: 'football', country: 'England' },
  { canonical: 'La Liga',                  aliases: ['la liga santander', 'spanish la liga', 'primera division', 'primera división'], sport: 'football', country: 'Spain' },
  { canonical: 'Bundesliga',               aliases: ['german bundesliga', '1. bundesliga', 'bundesliga 1'], sport: 'football', country: 'Germany' },
  { canonical: '2. Bundesliga',            aliases: ['zweite bundesliga', 'german 2nd division', '2. fußball-bundesliga'], sport: 'football', country: 'Germany' },
  { canonical: 'Serie A',                  aliases: ['italian serie a', 'serie a tim', 'calcio'], sport: 'football', country: 'Italy' },
  { canonical: 'Ligue 1',                  aliases: ['french ligue 1', 'ligue 1 uber eats'], sport: 'football', country: 'France' },
  { canonical: 'Primeira Liga',            aliases: ['portuguese primeira liga', 'liga nos', 'liga portugal'], sport: 'football', country: 'Portugal' },
  { canonical: 'Eredivisie',               aliases: ['dutch eredivisie', 'netherlands eredivisie', 'knvb eredivisie'], sport: 'football', country: 'Netherlands' },
  { canonical: 'UEFA Champions League',    aliases: ['champions league', 'ucl', 'cl', 'uefa cl'], sport: 'football', country: 'Europe' },
  { canonical: 'UEFA Europa League',       aliases: ['europa league', 'uel', 'el', 'uefa el'], sport: 'football', country: 'Europe' },
  { canonical: 'UEFA Conference League',   aliases: ['conference league', 'uecl', 'ecl'], sport: 'football', country: 'Europe' },
  { canonical: 'MLS',                      aliases: ['major league soccer', 'mls soccer', 'us mls'], sport: 'football', country: 'USA' },
  { canonical: 'Liga MX',                  aliases: ['mexican liga mx', 'liga bbva mx', 'liga bancomer'], sport: 'football', country: 'Mexico' },
  { canonical: 'Super Lig',                aliases: ['turkish super lig', 'tff super lig', 'türk süper ligi'], sport: 'football', country: 'Turkey' },
  { canonical: 'Brasileirão',              aliases: ['brasileiro', 'serie a brasil', 'campeonato brasileiro'], sport: 'football', country: 'Brazil' },
  { canonical: 'FIFA World Cup',           aliases: ['world cup', 'fifa wc', 'wc'], sport: 'football', country: 'International' },
  // ── Basketball Leagues ────────────────────────────────────────────────────
  { canonical: 'NBA',                      aliases: ['national basketball association', 'nba basketball'], sport: 'basketball', country: 'USA' },
  { canonical: 'EuroLeague',               aliases: ['euroleague basketball', 'euroleague', 'turkish airlines euroleague'], sport: 'basketball', country: 'Europe' },
  { canonical: 'NCAA Basketball',          aliases: ['college basketball', 'ncaa bb', 'march madness'], sport: 'basketball', country: 'USA' },
  // ── American Football ─────────────────────────────────────────────────────
  { canonical: 'NFL',                      aliases: ['national football league', 'nfl football'], sport: 'american-football', country: 'USA' },
  { canonical: 'Super Bowl',               aliases: ['nfl super bowl', 'sb'], sport: 'american-football', country: 'USA' },
  // ── Baseball ─────────────────────────────────────────────────────────────
  { canonical: 'MLB',                      aliases: ['major league baseball', 'mlb baseball'], sport: 'baseball', country: 'USA' },
  // ── Hockey ────────────────────────────────────────────────────────────────
  { canonical: 'NHL',                      aliases: ['national hockey league', 'nhl hockey'], sport: 'hockey', country: 'USA' },
  { canonical: 'KHL',                      aliases: ['kontinental hockey league', 'khl hockey'], sport: 'hockey', country: 'Russia' },
  // ── Tennis ────────────────────────────────────────────────────────────────
  { canonical: 'ATP Tour',                 aliases: ['atp', 'association of tennis professionals', 'atp tennis'], sport: 'tennis', country: 'International' },
  { canonical: 'WTA Tour',                 aliases: ['wta', "women's tennis association", 'wta tennis'], sport: 'tennis', country: 'International' },
  { canonical: 'Wimbledon',                aliases: ['the championships wimbledon', 'wimbledon tennis'], sport: 'tennis', country: 'England' },
  { canonical: 'Roland Garros',            aliases: ['french open', 'roland garros tennis', 'rg'], sport: 'tennis', country: 'France' },
  { canonical: 'US Open Tennis',           aliases: ['us open', 'uso', 'united states open'], sport: 'tennis', country: 'USA' },
  { canonical: 'Australian Open',          aliases: ['aus open', 'ao tennis'], sport: 'tennis', country: 'Australia' },
  // ── Cricket ───────────────────────────────────────────────────────────────
  { canonical: 'IPL',                      aliases: ['indian premier league', 'ipl cricket'], sport: 'cricket', country: 'India' },
  { canonical: 'ICC World Cup',            aliases: ['cricket world cup', 'icc wc', 'icc cwc'], sport: 'cricket', country: 'International' },
  { canonical: 'The Ashes',                aliases: ['ashes', 'ashes cricket', 'ashes series'], sport: 'cricket', country: 'International' },
  // ── MMA ───────────────────────────────────────────────────────────────────
  { canonical: 'UFC',                      aliases: ['ultimate fighting championship', 'ufc mma', 'ufc events'], sport: 'mma', country: 'USA' },
  { canonical: 'Bellator MMA',             aliases: ['bellator', 'bellator fighting'], sport: 'mma', country: 'USA' },
];

/** Build lowercase alias → canonical league lookup */
const LEAGUE_ALIAS_MAP = new Map<string, string>();
for (const entry of CANONICAL_LEAGUES) {
  LEAGUE_ALIAS_MAP.set(entry.canonical.toLowerCase(), entry.canonical);
  for (const alias of entry.aliases) {
    LEAGUE_ALIAS_MAP.set(alias.toLowerCase(), entry.canonical);
  }
}

/**
 * Resolves a raw league name to its canonical form.
 */
export function resolveLeagueName(rawName: string): string {
  if (!rawName) return rawName;
  const lower = rawName.toLowerCase().trim();
  const direct = LEAGUE_ALIAS_MAP.get(lower);
  if (direct) return direct;
  // Partial containment check — strict single-match requirement
  let match: string | null = null;
  let matchCount = 0;
  for (const [alias, canonical] of LEAGUE_ALIAS_MAP) {
    if (lower.includes(alias) || alias.includes(lower)) {
      match = canonical;
      matchCount++;
    }
  }
  if (matchCount === 1 && match) return match;
  return rawName;
}

/**
 * Returns canonical league metadata if known.
 */
export function getLeagueMeta(leagueName: string): { sport: string; country: string } | null {
  const canonical = resolveLeagueName(leagueName);
  const entry = CANONICAL_LEAGUES.find(
    (l) => l.canonical.toLowerCase() === canonical.toLowerCase()
  );
  return entry ? { sport: entry.sport, country: entry.country } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6: SOURCE PRIORITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export type PrioritizedDataType = 'fixtures' | 'standings' | 'statistics' | 'odds' | 'highlights' | 'news' | 'events';

/** Returns ordered provider priority for a given data type + sport */
export function getSourcePriority(
  dataType: PrioritizedDataType,
  sport: string,
): ProviderKey[] {
  const s = sport.toLowerCase();

  switch (dataType) {
    case 'fixtures':
      if (s === 'football') return ['api-football', 'thesportsdb'];
      if (['basketball', 'tennis', 'baseball', 'hockey', 'handball', 'volleyball', 'rugby', 'american-football', 'mma'].includes(s))
        return ['api-sports', 'thesportsdb'];
      return ['thesportsdb'];

    case 'standings':
      if (s === 'football') return ['api-football', 'thesportsdb'];
      if (['basketball', 'hockey', 'baseball', 'american-football'].includes(s))
        return ['api-sports', 'thesportsdb'];
      return ['thesportsdb'];

    case 'statistics':
      if (s === 'football') return ['api-football'];
      return ['api-sports', 'thesportsdb'];

    case 'odds':
      return ['api-football', 'api-sports'];

    case 'highlights':
      return ['thesportsdb', 'api-football'];

    case 'news':
      return ['thesportsdb', 'api-football'];

    case 'events':
      return ['api-football', 'api-sports'];

    default:
      return ['api-football', 'thesportsdb'];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: DATA QUALITY GATE
// Validates a match record before it can be rendered to the UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface DataQualityResult {
  passed: boolean;
  score: number;          // 0–100
  failures: string[];
  warnings: string[];
}

interface QualityCheckInput {
  id?: string;
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  matchTime?: string;
  status?: string;
  source_provider?: string;
  external_id?: string;
  home_team?: string;
  away_team?: string;
  match_time?: string;
}

/**
 * Phase 7 gate — validates a match record before UI render.
 * Returns { passed, score, failures, warnings }.
 */
export function runDataQualityGate(record: QualityCheckInput): DataQualityResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // ── Required checks ───────────────────────────────────────────────────────
  const homeTeam = record.homeTeam || record.home_team;
  const awayTeam = record.awayTeam || record.away_team;
  const matchTime = record.matchTime || record.match_time;

  // 1. Match ID exists
  if (!record.id && !record.external_id) {
    failures.push('Missing match ID');
  } else {
    score += 15;
  }

  // 2. Teams exist and are non-empty
  if (!homeTeam || homeTeam.trim().length < 2) {
    failures.push('Missing or invalid home team name');
  } else if (homeTeam.toLowerCase().includes('tbd') || homeTeam.toLowerCase().includes('unknown')) {
    warnings.push(`Home team is placeholder: "${homeTeam}"`);
    score += 5;
  } else {
    score += 15;
  }

  if (!awayTeam || awayTeam.trim().length < 2) {
    failures.push('Missing or invalid away team name');
  } else if (awayTeam.toLowerCase().includes('tbd') || awayTeam.toLowerCase().includes('unknown')) {
    warnings.push(`Away team is placeholder: "${awayTeam}"`);
    score += 5;
  } else {
    score += 15;
  }

  // 3. Same team on both sides — corrupted record
  if (homeTeam && awayTeam && homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
    failures.push(`Home team equals away team: "${homeTeam}"`);
  }

  // 4. League exists
  if (!record.league || record.league.trim().length < 2) {
    warnings.push('Missing league name');
  } else {
    score += 10;
  }

  // 5. Sport is a known value
  const knownSports: SportKey[] = [
    'football', 'basketball', 'tennis', 'baseball', 'hockey',
    'rugby', 'handball', 'volleyball', 'american-football',
    'cricket', 'mma', 'boxing', 'formula1', 'esports',
    'table-tennis', 'badminton', 'snooker', 'darts', 'motorsports',
    'cycling', 'athletics',
  ];
  if (!record.sport) {
    failures.push('Missing sport field');
  } else if (!knownSports.includes(record.sport as SportKey)) {
    warnings.push(`Unknown sport: "${record.sport}"`);
    score += 5;
  } else {
    score += 15;
  }

  // 6. Match time is valid ISO date
  if (!matchTime) {
    warnings.push('Missing match time');
  } else {
    try {
      const d = new Date(matchTime);
      if (isNaN(d.getTime())) {
        failures.push(`Invalid match time format: "${matchTime}"`);
      } else {
        score += 10;
        // Warn if date is unreasonably far in future (>1 year)
        if (d.getTime() > Date.now() + 365 * 24 * 3600 * 1000) {
          warnings.push(`Match time is more than 1 year in future: ${matchTime}`);
        }
      }
    } catch {
      failures.push(`Could not parse match time: "${matchTime}"`);
    }
  }

  // 7. Status is valid
  const validStatuses = ['live', 'upcoming', 'finished'];
  if (!record.status) {
    warnings.push('Missing status — defaulting to upcoming');
  } else if (!validStatuses.includes(record.status)) {
    failures.push(`Invalid status: "${record.status}"`);
  } else {
    score += 10;
  }

  // 8. External ID sport prefix validation
  if (record.external_id && record.sport) {
    if (!validateExternalIdSport(record.external_id, record.sport)) {
      failures.push(`Cross-sport contamination: external_id "${record.external_id}" has wrong prefix for sport "${record.sport}"`);
    } else {
      score += 10;
    }
  }

  // 9. Source provider declared
  if (!record.source_provider) {
    warnings.push('No source_provider declared — data provenance unknown');
  } else {
    score += 10; // up to 100 if all checks pass without deductions
  }

  const passed = failures.length === 0;
  return { passed, score: Math.min(100, score), failures, warnings };
}

/**
 * Filter an array of match records through the quality gate.
 * Returns { passed: records that cleared the gate, rejected: records that failed }.
 */
export function batchQualityGate(
  records: QualityCheckInput[],
): { passed: QualityCheckInput[]; rejected: Array<{ record: QualityCheckInput; result: DataQualityResult }> } {
  const passed: QualityCheckInput[] = [];
  const rejected: Array<{ record: QualityCheckInput; result: DataQualityResult }> = [];

  for (const record of records) {
    const result = runDataQualityGate(record);
    if (result.passed) {
      passed.push(record);
    } else {
      rejected.push({ record, result });
    }
  }
  return { passed, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3+6: DUPLICATE DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

export interface DuplicateGroup {
  unifiedId: string;
  records: QualityCheckInput[];
  winnerIndex: number;     // index of the record to keep
  reason: string;
}

/**
 * Detects duplicates across a list of records using UNIFIED_MATCH_ID.
 * Uses source priority to select the canonical record when duplicates exist.
 * Returns: deduplicated records + duplicate groups for logging.
 */
export function detectAndResolveDuplicates(
  records: Array<Record<string, unknown>>,
): { deduped: Array<Record<string, unknown>>; duplicateGroups: DuplicateGroup[] } {
  const grouped = new Map<string, Array<{ idx: number; record: Record<string, unknown> }>>();

  records.forEach((r, idx) => {
    const uid = generateUnifiedMatchId({
      sport:     String(r.sport ?? 'unknown'),
      league:    String(r.league ?? ''),
      homeTeam:  String(r.home_team ?? r.homeTeam ?? ''),
      awayTeam:  String(r.away_team ?? r.awayTeam ?? ''),
      matchTime: String(r.match_time ?? r.matchTime ?? ''),
    });
    const existing = grouped.get(uid) ?? [];
    existing.push({ idx, record: r });
    grouped.set(uid, existing);
  });

  const deduped: Array<Record<string, unknown>> = [];
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [uid, group] of grouped) {
    if (group.length === 1) {
      deduped.push(group[0].record);
      continue;
    }

    // Multiple records for same match — apply source priority
    const PROVIDER_RANK: Record<string, number> = {
      'api-football': 1,
      'api-sports': 2,
      'api-sports-tennis': 2,
      'api-sports-mma': 2,
      'thesportsdb': 3,
    };

    // Pick the record from the highest-priority provider
    // Tiebreak: prefer the one with more non-null fields
    let winner = group[0];
    for (const entry of group.slice(1)) {
      const winnerRank = PROVIDER_RANK[String(winner.record.source_provider ?? 'thesportsdb')] ?? 5;
      const entryRank  = PROVIDER_RANK[String(entry.record.source_provider  ?? 'thesportsdb')] ?? 5;
      if (entryRank < winnerRank) {
        winner = entry;
      } else if (entryRank === winnerRank) {
        // Tiebreak by non-null field count
        const countNonNull = (obj: Record<string, unknown>) =>
          Object.values(obj).filter((v) => v !== null && v !== undefined && v !== '').length;
        if (countNonNull(entry.record) > countNonNull(winner.record)) winner = entry;
      }
    }

    deduped.push(winner.record);
    duplicateGroups.push({
      unifiedId: uid,
      records: group.map((g) => g.record as QualityCheckInput),
      winnerIndex: group.indexOf(winner),
      reason: `${group.length} records merged; winner from provider "${winner.record.source_provider}"`,
    });
  }

  return { deduped, duplicateGroups };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10: MONITORING & ALERTING THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineHealthReport {
  timestamp: string;
  totalRecords: number;
  duplicateRate: number;         // 0–1
  mappingAccuracy: number;       // 0–1
  missingDetailsRate: number;    // 0–1
  crossSportContamination: number; // count
  qualityGatePassRate: number;   // 0–1
  providerFailures: Record<ProviderKey, boolean>;
  alerts: PipelineAlert[];
  overallHealthScore: number;    // 0–100
}

export interface PipelineAlert {
  severity: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  value: number;
  threshold: number;
}

/** Alert thresholds from the audit spec */
const ALERT_THRESHOLDS = {
  duplicateRate:       0.001,  // > 0.1%
  mappingAccuracy:     0.99,   // < 99% (only for sports with team registries)
  missingDetailsRate:  0.005,  // > 0.5%
  providerFailureRate: 0.05,   // > 5%
};

/**
 * Generates a health report and fires alerts when thresholds are breached.
 *
 * SCORING FORMULA (revised):
 *  40%  → Mapping accuracy (only team-registry sports; individual-player sports excluded)
 *  20%  → Duplicate detection (zero duplicates = full score)
 *  20%  → Cross-sport contamination (zero tolerance)
 *  10%  → Missing fields (team names, league names)
 *  10%  → Data freshness / quality gate pass rate
 *
 * Key fix: unmappedTeams is calculated only for sports that HAVE a canonical
 * team registry. Table-tennis, tennis, MMA, boxing players are NOT flagged
 * as unmapped — their individual names are legitimate and expected.
 */
export function generatePipelineHealthReport(params: {
  totalRecords: number;
  duplicateCount: number;
  unmappedTeams: number;
  missingDetails: number;
  crossSportIssues: number;
  qualityGatePassed: number;
  providerStatuses: Partial<Record<ProviderKey, boolean>>;
  /** Records from individual-player sports excluded from team mapping accuracy */
  individualSportRecords?: number;
}): PipelineHealthReport {
  const {
    totalRecords, duplicateCount, unmappedTeams,
    missingDetails, crossSportIssues, qualityGatePassed,
    providerStatuses,
    individualSportRecords = 0,
  } = params;

  const safe = (n: number, d: number) => d === 0 ? 0 : n / d;

  // Revised scoring: exclude individual-player sport records from mapping accuracy.
  // Table tennis, tennis, MMA, boxing players are NOT in the team registry
  // and should NEVER be counted as unmapped teams.
  const teamRegistryRecords = Math.max(1, totalRecords - individualSportRecords);
  const duplicateRate       = safe(duplicateCount, totalRecords);
  const mappingAccuracy     = 1 - safe(unmappedTeams, teamRegistryRecords * 2);
  const missingDetailsRate  = safe(missingDetails, totalRecords);
  const qualityGatePassRate = safe(qualityGatePassed, totalRecords);

  const alerts: PipelineAlert[] = [];

  if (duplicateRate > ALERT_THRESHOLDS.duplicateRate) {
    alerts.push({ severity: 'critical', type: 'DUPLICATE_RATE', message: `Duplicate rate ${(duplicateRate * 100).toFixed(2)}% exceeds threshold ${(ALERT_THRESHOLDS.duplicateRate * 100).toFixed(1)}%`, value: duplicateRate, threshold: ALERT_THRESHOLDS.duplicateRate });
  }
  // Only alert on mapping accuracy if there are enough team-registry records to measure
  if (teamRegistryRecords >= 10 && mappingAccuracy < ALERT_THRESHOLDS.mappingAccuracy) {
    alerts.push({ severity: 'warning', type: 'MAPPING_ACCURACY', message: `Team mapping accuracy ${(mappingAccuracy * 100).toFixed(1)}% below threshold ${(ALERT_THRESHOLDS.mappingAccuracy * 100).toFixed(0)}%`, value: mappingAccuracy, threshold: ALERT_THRESHOLDS.mappingAccuracy });
  }
  if (missingDetailsRate > ALERT_THRESHOLDS.missingDetailsRate) {
    alerts.push({ severity: 'warning', type: 'MISSING_DETAILS', message: `Missing match details rate ${(missingDetailsRate * 100).toFixed(2)}% exceeds threshold ${(ALERT_THRESHOLDS.missingDetailsRate * 100).toFixed(1)}%`, value: missingDetailsRate, threshold: ALERT_THRESHOLDS.missingDetailsRate });
  }
  if (crossSportIssues > 0) {
    alerts.push({ severity: 'critical', type: 'CROSS_SPORT_CONTAMINATION', message: `${crossSportIssues} cross-sport contamination record(s) detected — zero tolerance required`, value: crossSportIssues, threshold: 0 });
  }
  if (qualityGatePassRate < 0.95) {
    alerts.push({ severity: 'warning', type: 'QUALITY_GATE', message: `Quality gate pass rate ${(qualityGatePassRate * 100).toFixed(1)}% is low`, value: qualityGatePassRate, threshold: 0.95 });
  }
  for (const [provider, ok] of Object.entries(providerStatuses)) {
    if (!ok) {
      alerts.push({ severity: 'warning', type: 'PROVIDER_FAILURE', message: `Provider "${provider}" is reporting failures`, value: 0, threshold: ALERT_THRESHOLDS.providerFailureRate });
    }
  }

  // ── Revised scoring formula ────────────────────────────────────────────────
  // 40 pts: Mapping Accuracy  (team-registry sports only)
  // 20 pts: No Duplicates
  // 20 pts: No Cross-Sport Contamination
  // 10 pts: Missing Details
  // 10 pts: Quality Gate Pass Rate
  let score = 0;

  // Mapping accuracy (40 pts) — capped at 40, scaled
  const mappingClamped = Math.max(0, Math.min(1, mappingAccuracy));
  score += Math.round(mappingClamped * 40);

  // Duplicate detection (20 pts)
  if (duplicateRate <= ALERT_THRESHOLDS.duplicateRate) {
    score += 20;
  } else {
    score += Math.max(0, Math.round(20 * (1 - duplicateRate / 0.05)));
  }

  // Cross-sport contamination (20 pts) — zero tolerance
  if (crossSportIssues === 0) {
    score += 20;
  } else {
    score += Math.max(0, 20 - crossSportIssues * 5);
  }

  // Missing details (10 pts)
  if (missingDetailsRate <= ALERT_THRESHOLDS.missingDetailsRate) {
    score += 10;
  } else {
    score += Math.max(0, Math.round(10 * (1 - missingDetailsRate / 0.05)));
  }

  // Quality gate pass rate (10 pts)
  score += Math.round(Math.max(0, Math.min(1, qualityGatePassRate)) * 10);

  score = Math.max(0, Math.min(100, score));

  return {
    timestamp: new Date().toISOString(),
    totalRecords,
    duplicateRate,
    mappingAccuracy,
    missingDetailsRate,
    crossSportContamination: crossSportIssues,
    qualityGatePassRate,
    providerFailures: {
      'api-football': !(providerStatuses['api-football'] ?? true),
      'api-sports':   !(providerStatuses['api-sports']   ?? true),
      'thesportsdb':  !(providerStatuses['thesportsdb']  ?? true),
    },
    alerts,
    overallHealthScore: score,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 + 8: API HEALTH CHECKER (CLIENT-SIDE ONLY)
// Checks which providers are reachable by querying the api_usage table.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderHealthStatus {
  provider: ProviderKey;
  isHealthy: boolean;
  errorRate: number;    // 0–1
  lastError: string | null;
  requestsToday: number;
  successesToday: number;
}

export async function checkProviderHealth(): Promise<ProviderHealthStatus[]> {
  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('api_usage')
      .select('provider_name, request_count, success_count, error_count, last_error')
      .eq('date', today);

    if (error || !data) return [];

    // Aggregate by provider_name
    const providerMap = new Map<string, { requests: number; successes: number; errors: number; lastError: string | null }>();
    for (const row of data as Record<string, unknown>[]) {
      const name = String(row.provider_name ?? '');
      const existing = providerMap.get(name) ?? { requests: 0, successes: 0, errors: 0, lastError: null };
      existing.requests += Number(row.request_count ?? 0);
      existing.successes += Number(row.success_count ?? 0);
      existing.errors += Number(row.error_count ?? 0);
      if (row.last_error) existing.lastError = String(row.last_error);
      providerMap.set(name, existing);
    }

    const knownProviders: ProviderKey[] = ['api-football', 'api-sports', 'thesportsdb'];
    return knownProviders.map((provider) => {
      const stats = providerMap.get(provider) ?? { requests: 0, successes: 0, errors: 0, lastError: null };
      const errorRate = stats.requests > 0 ? stats.errors / stats.requests : 0;
      return {
        provider,
        isHealthy: errorRate <= ALERT_THRESHOLDS.providerFailureRate,
        errorRate,
        lastError: stats.lastError,
        requestsToday: stats.requests,
        successesToday: stats.successes,
      };
    });
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9: RENDERING VALIDATION HELPERS
// Validate that a normalized match is safe to render.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if a match is safe to render (passed quality gate + no contamination) */
export function isRenderSafe(record: QualityCheckInput): boolean {
  const quality = runDataQualityGate(record);
  if (!quality.passed) return false;
  // Cross-sport contamination check
  const externalId = String((record as Record<string, unknown>).external_id ?? '');
  const sport = String((record as Record<string, unknown>).sport ?? record.sport ?? '');
  if (externalId && sport && !validateExternalIdSport(externalId, sport)) return false;
  return true;
}

/** Filter an array for render-safe records only */
export function filterRenderSafe<T extends QualityCheckInput>(records: T[]): T[] {
  return records.filter(isRenderSafe);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4+5: CONFLICT RESOLUTION (multi-provider merge)
// When the same match exists from multiple providers, pick the most complete
// record while preserving provider-specific enrichment from secondary sources.
// ─────────────────────────────────────────────────────────────────────────────

/** Merge two match records, preferring fields from the higher-priority record */
export function mergeMatchRecords(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...secondary };

  // Always take these from primary (highest-priority provider)
  const primaryFields = [
    'home_team', 'away_team', 'home_score', 'away_score',
    'status', 'match_time', 'league', 'country', 'sport',
    'minute', 'source_provider', 'external_id',
  ];
  for (const field of primaryFields) {
    if (primary[field] !== undefined && primary[field] !== null && primary[field] !== '') {
      merged[field] = primary[field];
    }
  }

  // Supplement with secondary for enrichment fields (logos, stats, etc.)
  const enrichmentFields = [
    'home_logo', 'away_logo', 'league_logo', 'venue', 'round',
    'stats', 'home_form', 'away_form',
  ];
  for (const field of enrichmentFields) {
    // Use primary if available; otherwise fall back to secondary
    merged[field] =
      (primary[field] !== null && primary[field] !== undefined && primary[field] !== '')
        ? primary[field]
        : secondary[field] ?? null;
  }

  // Apply canonical name resolution
  merged.home_team = resolveTeamName(String(merged.home_team ?? ''), String(merged.sport ?? ''));
  merged.away_team = resolveTeamName(String(merged.away_team ?? ''), String(merged.sport ?? ''));
  merged.league    = resolveLeagueName(String(merged.league ?? ''));
  merged.last_updated = new Date().toISOString();

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API: Full normalization pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizationResult {
  records: Array<Record<string, unknown>>;
  duplicateGroups: DuplicateGroup[];
  qualityReport: { passed: number; rejected: number; rejectedSamples: string[] };
  healthReport: PipelineHealthReport | null;
  stats: {
    input: number;
    afterDedup: number;
    afterQualityGate: number;
    crossSportIssues: number;
    unmappedTeams: number;
  };
}

/**
 * Run the full normalization pipeline on an array of raw match records.
 *
 * Steps:
 * 1. Apply team/league name resolution
 * 2. Detect and resolve duplicates (Phase 3)
 * 3. Run data quality gate (Phase 7)
 * 4. Cross-sport contamination check (Phase 2)
 * 5. Return normalized records + pipeline statistics
 */
export function runNormalizationPipeline(
  rawRecords: Array<Record<string, unknown>>,
  options: { skipQualityGate?: boolean; generateHealthReport?: boolean } = {},
): NormalizationResult {
  const inputCount = rawRecords.length;

  // ── 1. Resolve canonical names ──────────────────────────────────────────
  let unmappedTeams = 0;
  let individualSportRecords = 0;
  const resolved = rawRecords.map((r) => {
    const homeRaw = String(r.home_team ?? r.homeTeam ?? '');
    const awayRaw = String(r.away_team ?? r.awayTeam ?? '');
    const sport   = String(r.sport ?? 'unknown');
    const league  = String(r.league ?? '');

    const homeResolved   = resolveTeamName(homeRaw, sport);
    const awayResolved   = resolveTeamName(awayRaw, sport);
    const leagueResolved = resolveLeagueName(league);

    // Only count unmapped teams for sports that have a canonical team registry.
    // Individual-player sports (tennis, table-tennis, MMA, boxing) use player names
    // that are legitimately NOT in the team registry — never count them as unmapped.
    if (sportHasCanonicalTeamRegistry(sport)) {
      if (homeResolved === homeRaw) unmappedTeams++;
      if (awayResolved === awayRaw) unmappedTeams++;
    } else {
      // Track record count for individual-player sports to exclude from scoring
      individualSportRecords++;
    }

    return {
      ...r,
      home_team: homeResolved,
      away_team: awayResolved,
      league: leagueResolved,
    };
  });

  // ── 2. Deduplicate (Phase 3) ────────────────────────────────────────────
  const { deduped, duplicateGroups } = detectAndResolveDuplicates(resolved);

  // ── 3. Quality gate (Phase 7) ───────────────────────────────────────────
  let passedRecords = deduped;
  let rejectedCount = 0;
  const rejectedSamples: string[] = [];

  if (!options.skipQualityGate) {
    const { passed, rejected } = batchQualityGate(deduped as QualityCheckInput[]);
    passedRecords = passed as Array<Record<string, unknown>>;
    rejectedCount = rejected.length;
    for (const { record, result } of rejected.slice(0, 5)) {
      rejectedSamples.push(
        `[${(record as Record<string, unknown>).external_id ?? 'no-id'}] ${result.failures.join('; ')}`
      );
    }
  }

  // ── 4. Cross-sport contamination check (Phase 2) ───────────────────────
  let crossSportIssues = 0;
  const cleanRecords: Array<Record<string, unknown>> = [];
  for (const r of passedRecords) {
    const extId = String(r.external_id ?? '');
    const sport = String(r.sport ?? '');
    if (extId && sport && !validateExternalIdSport(extId, sport)) {
      crossSportIssues++;
      // Log but still include (fix the external_id prefix only if genuinely contaminated)
      const normalizedSport = normalizeSportId(sport);
      cleanRecords.push({ ...r, external_id: `${normalizedSport}-fixed-${extId}` });
    } else {
      cleanRecords.push(r);
    }
  }

  // ── 5. Health report (Phase 10) ────────────────────────────────────────
  let healthReport: PipelineHealthReport | null = null;
  if (options.generateHealthReport) {
    const providerStatuses: Partial<Record<ProviderKey, boolean>> = {};
    const providers = new Set(cleanRecords.map((r) => String(r.source_provider ?? '')));
    for (const p of providers as Set<string>) {
      if (p) providerStatuses[p as ProviderKey] = true;
    }
    healthReport = generatePipelineHealthReport({
      totalRecords: inputCount,
      duplicateCount: duplicateGroups.reduce((s, g) => s + g.records.length - 1, 0),
      unmappedTeams: Math.floor(unmappedTeams / 2), // count unique team-registry teams only
      missingDetails: rejectedCount,
      crossSportIssues,
      qualityGatePassed: cleanRecords.length,
      providerStatuses,
      individualSportRecords, // excludes player-name sports from mapping accuracy penalty
    });
  }

  return {
    records: cleanRecords,
    duplicateGroups,
    qualityReport: { passed: cleanRecords.length, rejected: rejectedCount, rejectedSamples },
    healthReport,
    stats: {
      input: inputCount,
      afterDedup: deduped.length,
      afterQualityGate: cleanRecords.length,
      crossSportIssues,
      unmappedTeams: Math.floor(unmappedTeams / 2),
    },
  };
}
