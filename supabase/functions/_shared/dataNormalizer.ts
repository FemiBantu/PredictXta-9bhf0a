/**
 * _shared/dataNormalizer.ts  v2.0
 *
 * Edge-function-side data normalization utilities.
 * Implements Phases 2–8 of the PredictXta Data Integrity Audit:
 *
 * Phase 2: Sport-endpoint isolation (no cross-sport contamination)
 * Phase 3: UNIFIED_MATCH_ID deduplication
 * Phase 4: Canonical team name resolution
 * Phase 5: Canonical league name resolution
 * Phase 6: Source-priority conflict resolution
 * Phase 7: Data quality gate (validates before DB upsert)
 * Phase 8: Provider priority routing
 *
 * Used by: fetch-matches, sync-standings, resolve-prediction, pipeline-audit
 *
 * CRITICAL FIXES v2.0:
 *  ✓ validateSportEndpoint: replaced split('-')[0] with startsWith() prefix matching.
 *    The old approach extracted only the FIRST hyphen-segment, so 'american-football-12345'
 *    yielded prefix='american', which never matched VALID_PREFIXES['american-football'].
 *    Result: ALL american-football and table-tennis events were silently rejected by the
 *    quality gate — zero records ever reached the DB for those sports.
 *  ✓ VALID_PREFIXES: added 'afl', 'nba'; corrected 'formula1' ↔ 'motorsports' overlap.
 *  ✓ normalizePipeline: cross-sport prefix fix (Step 3) now runs BEFORE quality gate
 *    (Step 4), so fixable records are corrected rather than silently dropped.
 *  ✓ getSourcePriority: added 'afl' to API-Sports fixture tier.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: CANONICAL TEAM REGISTRY (edge-function copy)
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_ALIASES: Array<[string, string]> = [
  // key (lowercase alias) → canonical name
  ['man utd', 'Manchester United'], ['man united', 'Manchester United'], ['manchester utd', 'Manchester United'], ['mufc', 'Manchester United'],
  ['man city', 'Manchester City'], ['manchester city fc', 'Manchester City'], ['mcfc', 'Manchester City'],
  ['arsenal fc', 'Arsenal'], ['the gunners', 'Arsenal'],
  ['chelsea fc', 'Chelsea'], ['the blues', 'Chelsea'],
  ['liverpool fc', 'Liverpool'], ['the reds', 'Liverpool'],
  ['spurs', 'Tottenham Hotspur'], ['tottenham', 'Tottenham Hotspur'], ['thfc', 'Tottenham Hotspur'],
  ['real madrid cf', 'Real Madrid'], ['real madrid c.f.', 'Real Madrid'],
  ['barcelona', 'FC Barcelona'], ['barça', 'FC Barcelona'], ['barca', 'FC Barcelona'], ['fc barcelona', 'FC Barcelona'],
  ['atletico de madrid', 'Atletico Madrid'], ['atletico', 'Atletico Madrid'], ['atleti', 'Atletico Madrid'], ['at. madrid', 'Atletico Madrid'],
  ['fc bayern munich', 'Bayern Munich'], ['fc bayern münchen', 'Bayern Munich'], ['bavarian', 'Bayern Munich'],
  ['bvb', 'Borussia Dortmund'], ['bvb dortmund', 'Borussia Dortmund'],
  ['juventus fc', 'Juventus'], ['juve', 'Juventus'],
  ['milan', 'AC Milan'], ['acm', 'AC Milan'], ['rossoneri', 'AC Milan'],
  ['internazionale', 'Inter Milan'], ['inter', 'Inter Milan'], ['fc internazionale', 'Inter Milan'], ['nerazzurri', 'Inter Milan'],
  ['psg', 'Paris Saint-Germain'], ['paris sg', 'Paris Saint-Germain'], ['paris saint germain', 'Paris Saint-Germain'],
  ['ajax amsterdam', 'Ajax'], ['afc ajax', 'Ajax'],
  ['sl benfica', 'Benfica'], ['sport lisboa e benfica', 'Benfica'],
  ['fc porto', 'Porto'],
  ['sporting', 'Sporting CP'], ['sporting clube de portugal', 'Sporting CP'], ['sporting lisbon', 'Sporting CP'],
  ['celtic fc', 'Celtic'],
  ['rangers fc', 'Rangers'],
  // NBA
  ['lakers', 'Los Angeles Lakers'], ['la lakers', 'Los Angeles Lakers'],
  ['celtics', 'Boston Celtics'],
  ['warriors', 'Golden State Warriors'], ['gsw', 'Golden State Warriors'],
  ['heat', 'Miami Heat'],
  ['bulls', 'Chicago Bulls'],
  ['nets', 'Brooklyn Nets'],
  // NFL
  ['chiefs', 'Kansas City Chiefs'],
  ['eagles', 'Philadelphia Eagles'],
  ['cowboys', 'Dallas Cowboys'],
  ['49ers', 'San Francisco 49ers'],
  // MLB
  ['yankees', 'New York Yankees'], ['nyy', 'New York Yankees'],
  ['dodgers', 'Los Angeles Dodgers'], ['lad', 'Los Angeles Dodgers'],
  ['astros', 'Houston Astros'],
];

const TEAM_MAP = new Map<string, string>(TEAM_ALIASES);

export function resolveTeamName(raw: string): string {
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  const direct = TEAM_MAP.get(lower);
  if (direct) return direct;
  // Single partial-match fallback
  let match: string | null = null;
  let matchCount = 0;
  for (const [alias, canonical] of TEAM_MAP) {
    if (lower.includes(alias) && alias.length > 4) { match = canonical; matchCount++; }
  }
  return matchCount === 1 && match ? match : raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: CANONICAL LEAGUE REGISTRY (edge-function copy)
// ─────────────────────────────────────────────────────────────────────────────

const LEAGUE_ALIASES: Array<[string, string]> = [
  ['english premier league', 'Premier League'], ['epl', 'Premier League'], ['barclays premier league', 'Premier League'], ['bpl', 'Premier League'],
  ['la liga santander', 'La Liga'], ['spanish la liga', 'La Liga'], ['primera division', 'La Liga'], ['primera división', 'La Liga'],
  ['german bundesliga', 'Bundesliga'], ['1. bundesliga', 'Bundesliga'], ['bundesliga 1', 'Bundesliga'],
  ['italian serie a', 'Serie A'], ['serie a tim', 'Serie A'], ['calcio', 'Serie A'],
  ['french ligue 1', 'Ligue 1'], ['ligue 1 uber eats', 'Ligue 1'],
  ['portuguese primeira liga', 'Primeira Liga'], ['liga nos', 'Primeira Liga'], ['liga portugal', 'Primeira Liga'],
  ['dutch eredivisie', 'Eredivisie'], ['netherlands eredivisie', 'Eredivisie'],
  ['champions league', 'UEFA Champions League'], ['ucl', 'UEFA Champions League'], ['uefa cl', 'UEFA Champions League'],
  ['europa league', 'UEFA Europa League'], ['uel', 'UEFA Europa League'], ['uefa el', 'UEFA Europa League'],
  ['conference league', 'UEFA Conference League'], ['uecl', 'UEFA Conference League'],
  ['major league soccer', 'MLS'], ['mls soccer', 'MLS'],
  ['mexican liga mx', 'Liga MX'], ['liga bbva mx', 'Liga MX'],
  ['turkish super lig', 'Super Lig'], ['tff super lig', 'Super Lig'],
  ['brasileiro', 'Brasileirão'], ['serie a brasil', 'Brasileirão'], ['campeonato brasileiro', 'Brasileirão'],
  ['national basketball association', 'NBA'], ['nba basketball', 'NBA'],
  ['national football league', 'NFL'], ['nfl football', 'NFL'],
  ['major league baseball', 'MLB'], ['mlb baseball', 'MLB'],
  ['national hockey league', 'NHL'], ['nhl hockey', 'NHL'],
  ['association of tennis professionals', 'ATP Tour'], ['atp tennis', 'ATP Tour'],
  ["women's tennis association", 'WTA Tour'], ['wta tennis', 'WTA Tour'],
  ['the championships wimbledon', 'Wimbledon'],
  ['french open', 'Roland Garros'], ['roland garros tennis', 'Roland Garros'],
  ['us open', 'US Open Tennis'],
  ['aus open', 'Australian Open'],
  ['indian premier league', 'IPL'], ['ipl cricket', 'IPL'],
  ['cricket world cup', 'ICC World Cup'], ['icc wc', 'ICC World Cup'],
  ['ultimate fighting championship', 'UFC'], ['ufc mma', 'UFC'],
  ['australian football league', 'AFL'], ['afl football', 'AFL'],
];

const LEAGUE_MAP = new Map<string, string>(LEAGUE_ALIASES);

export function resolveLeagueName(raw: string): string {
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  const direct = LEAGUE_MAP.get(lower);
  if (direct) return direct;
  let match: string | null = null;
  let matchCount = 0;
  for (const [alias, canonical] of LEAGUE_MAP) {
    if ((lower.includes(alias) || alias.includes(lower)) && alias.length > 3) {
      match = canonical; matchCount++;
    }
  }
  return matchCount === 1 && match ? match : raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: UNIFIED MATCH IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').substring(0, 28);
}

export function generateUnifiedMatchId(r: Record<string, unknown>): string {
  const sport    = normalizeKey(resolveTeamName(String(r.sport ?? 'unknown')));
  const league   = normalizeKey(resolveLeagueName(String(r.league ?? '')));
  const home     = normalizeKey(resolveTeamName(String(r.home_team ?? '')));
  const away     = normalizeKey(resolveTeamName(String(r.away_team ?? '')));
  const dateStr  = String(r.match_time ?? '').substring(0, 10);
  return `${sport}_${league}_${home}_${away}_${dateStr}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: SPORT-ENDPOINT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid external_id prefixes per sport.
 * Each entry lists the prefix(es) that a record's external_id may legally start with.
 *
 * IMPORTANT: Prefixes are matched with startsWith(), NOT split('-')[0].
 * The old split approach incorrectly reduced 'american-football-12345' → 'american'
 * (missing match) and 'table-tennis-tsdb-99' → 'table' (missing match), causing every
 * american-football and table-tennis event to be silently dropped by the quality gate.
 */
const VALID_PREFIXES: Record<string, string[]> = {
  football:            ['football'],
  basketball:          ['basketball'],
  nba:                 ['nba', 'basketball'],           // NBA is a basketball sub-league
  tennis:              ['tennis', 'tennis-api'],
  baseball:            ['baseball'],
  hockey:              ['hockey'],
  handball:            ['handball'],
  volleyball:          ['volleyball'],
  rugby:               ['rugby'],
  'american-football': ['american-football'],           // hyphenated — needs startsWith
  cricket:             ['cricket'],
  mma:                 ['mma', 'mma-api'],
  // Boxing: 'boxing-api-{id}' (API-Sports) and 'boxing-tsdb-{id}' (TheSportsDB)
  boxing:              ['boxing'],
  // Esports: 'esports-{id}' (API-Sports) and 'esports-tsdb-{id}' (TheSportsDB)
  esports:             ['esports'],
  // formula1 — F1 grand prix events only (filtered via isF1 regex in fetchFormula1)
};

/**
 * Validates that an external_id's sport prefix matches the declared sport field.
 * Uses startsWith prefix matching to correctly handle hyphenated sports.
 *
 * Examples:
 *   validateSportEndpoint('american-football-123', 'american-football') → true  ✓
 *   validateSportEndpoint('table-tennis-tsdb-99',  'table-tennis')      → true  ✓
 *   validateSportEndpoint('football-123',           'basketball')        → false ✓ (contamination caught)
 *   validateSportEndpoint('mma-api-456',            'mma')              → true  ✓
 */
export function validateSportEndpoint(externalId: string, sport: string): boolean {
  if (!externalId || !sport) return true;
  const s = sport.toLowerCase();
  const allowed = VALID_PREFIXES[s] ?? [s];
  // startsWith(`${prefix}-`) handles all compound IDs:
  //   'american-football-12345'.startsWith('american-football-') → true ✓
  //   'table-tennis-tsdb-9'.startsWith('table-tennis-')          → true ✓
  //   'football-9'.startsWith('basketball-')                      → false ✓
  return allowed.some(
    (p) => externalId === p || externalId.startsWith(`${p}-`),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6: SOURCE PRIORITY CONFLICT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_RANK: Record<string, number> = {
  'api-football':        1,
  'api-sports':          2,
  'api-sports-tennis':   2,
  'api-sports-mma':      2,
  'thesportsdb':         3,
};

function providerRank(r: Record<string, unknown>): number {
  return PROVIDER_RANK[String(r.source_provider ?? 'thesportsdb')] ?? 5;
}

function nonNullCount(r: Record<string, unknown>): number {
  return Object.values(r).filter((v) => v !== null && v !== undefined && v !== '').length;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: DATA QUALITY GATE
// ─────────────────────────────────────────────────────────────────────────────

export interface QualityResult {
  passed: boolean;
  failures: string[];
}

export function qualityGate(r: Record<string, unknown>): QualityResult {
  const failures: string[] = [];
  const home  = String(r.home_team ?? '');
  const away  = String(r.away_team ?? '');
  const sport = String(r.sport ?? '');

  if (!home || home.trim().length < 2)           failures.push('Missing home_team');
  if (!away || away.trim().length < 2)           failures.push('Missing away_team');
  if (home.toLowerCase() === away.toLowerCase()) failures.push('home_team === away_team');
  if (!sport)                                    failures.push('Missing sport');
  if (!r.match_time)                             failures.push('Missing match_time');
  if (r.match_time) {
    const d = new Date(String(r.match_time));
    if (isNaN(d.getTime()))                      failures.push('Invalid match_time');
  }
  if (!['live','upcoming','finished'].includes(String(r.status ?? ''))) failures.push('Invalid status');
  if (!r.external_id && !r.id)                   failures.push('Missing identifier');
  // TBD placeholders rejected
  if (home.toLowerCase().includes('tbd'))        failures.push('home_team is TBD placeholder');
  if (away.toLowerCase().includes('tbd'))        failures.push('away_team is TBD placeholder');
  // Cross-sport contamination (runs AFTER prefix fix in normalizePipeline)
  if (r.external_id && !validateSportEndpoint(String(r.external_id), sport)) {
    failures.push(`Cross-sport contamination: ${r.external_id} vs sport=${sport}`);
  }
  return { passed: failures.length === 0, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Full normalization pipeline for edge functions
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineStats {
  input: number;
  afterResolve: number;
  afterDedup: number;
  afterQualityGate: number;
  crossSportFixed: number;
  duplicatesRemoved: number;
  rejectedByQualityGate: number;
}

export interface NormalizedOutput {
  records: Array<Record<string, unknown>>;
  stats: PipelineStats;
  duplicateLog: Array<{ unifiedId: string; keptProvider: string; droppedProviders: string[] }>;
  rejectedLog: Array<{ external_id: string; failures: string[] }>;
}

/**
 * Full normalization pipeline for edge functions.
 * Step order: Resolve → Dedup → CrossSportFix → QualityGate
 *
 * Cross-sport fix runs BEFORE the quality gate so fixable prefix mismatches
 * are corrected rather than silently rejected (v2.0 fix).
 */
export function normalizePipeline(rawRows: Array<Record<string, unknown>>): NormalizedOutput {
  const stats: PipelineStats = {
    input: rawRows.length,
    afterResolve: 0, afterDedup: 0, afterQualityGate: 0,
    crossSportFixed: 0, duplicatesRemoved: 0, rejectedByQualityGate: 0,
  };
  const duplicateLog: NormalizedOutput['duplicateLog'] = [];
  const rejectedLog: NormalizedOutput['rejectedLog']   = [];

  // ── Step 1: Resolve canonical names (Phase 4+5) ─────────────────────────
  const resolved = rawRows.map((r) => ({
    ...r,
    home_team: resolveTeamName(String(r.home_team ?? '')),
    away_team: resolveTeamName(String(r.away_team ?? '')),
    league:    resolveLeagueName(String(r.league ?? '')),
  }));
  stats.afterResolve = resolved.length;

  // ── Step 2: Deduplicate by UNIFIED_MATCH_ID (Phase 3) ──────────────────
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const r of resolved) {
    const uid = generateUnifiedMatchId(r);
    const g   = grouped.get(uid) ?? [];
    g.push(r);
    grouped.set(uid, g);
  }

  const deduped: Array<Record<string, unknown>> = [];
  for (const [uid, group] of grouped) {
    if (group.length === 1) { deduped.push(group[0]); continue; }

    // Sort: best provider first, then most complete record
    const sorted = [...group].sort((a, b) => {
      const rd = providerRank(a) - providerRank(b);
      return rd !== 0 ? rd : nonNullCount(b) - nonNullCount(a);
    });
    const winner  = sorted[0];
    const enriched = { ...winner };

    // Enrich winner with secondary provider's logo/venue fields
    for (const secondary of sorted.slice(1)) {
      for (const f of ['home_logo', 'away_logo', 'league_logo', 'venue', 'stats', 'round'] as const) {
        if ((enriched[f] === null || enriched[f] === undefined) && secondary[f] != null) {
          enriched[f] = secondary[f];
        }
      }
    }
    deduped.push(enriched);
    stats.duplicatesRemoved += group.length - 1;
    duplicateLog.push({
      unifiedId:        uid,
      keptProvider:     String(winner.source_provider ?? 'unknown'),
      droppedProviders: sorted.slice(1).map((r) => String(r.source_provider ?? 'unknown')),
    });
  }
  stats.afterDedup = deduped.length;

  // ── Step 3: Cross-sport external_id prefix fix (Phase 2) ────────────────
  // Runs BEFORE the quality gate so correctable prefix mismatches are fixed
  // rather than silently dropped. The quality gate below will still reject
  // records where the sport field itself is genuinely wrong after the prefix fix.
  const prefixCorrected: Array<Record<string, unknown>> = [];
  for (const r of deduped) {
    const extId = String(r.external_id ?? '');
    const sport = String(r.sport ?? '');
    if (extId && sport && !validateSportEndpoint(extId, sport)) {
      // Prefix mismatch — rewrite the external_id to carry the correct sport prefix.
      // e.g. a TSDB event with external_id 'football-tsdb-99' that was incorrectly
      // passed to the basketball fetcher becomes 'basketball-corrected-football-tsdb-99'.
      const correctedId = `${sport}-corrected-${extId}`;
      prefixCorrected.push({ ...r, external_id: correctedId, last_updated: new Date().toISOString() });
      stats.crossSportFixed++;
      console.warn(`[DataNorm] Cross-sport prefix fix: ${extId} → ${correctedId} (sport=${sport})`);
    } else {
      prefixCorrected.push(r);
    }
  }

  // ── Step 4: Quality gate (Phase 7) ─────────────────────────────────────
  const qualityPassed: Array<Record<string, unknown>> = [];
  for (const r of prefixCorrected) {
    const { passed, failures } = qualityGate(r);
    if (passed) {
      qualityPassed.push(r);
    } else {
      stats.rejectedByQualityGate++;
      rejectedLog.push({ external_id: String(r.external_id ?? r.id ?? ''), failures });
      console.warn(`[DataNorm] Quality gate rejected: ${r.external_id} — ${failures.join(', ')}`);
    }
  }
  stats.afterQualityGate = qualityPassed.length;

  return { records: qualityPassed, stats, duplicateLog, rejectedLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8: SOURCE PRIORITY ROUTER
// Returns the best available provider for a given data type + sport.
// ─────────────────────────────────────────────────────────────────────────────

export type DataType = 'fixtures' | 'standings' | 'statistics' | 'odds' | 'highlights' | 'news' | 'events';

export function getSourcePriority(sport: string, dataType: DataType): string[] {
  const s = sport.toLowerCase();
  switch (dataType) {
    case 'fixtures':
      if (s === 'football')  return ['api-football', 'thesportsdb'];
      if (['mma', 'basketball', 'nba', 'tennis', 'baseball', 'hockey',
           'handball', 'volleyball', 'rugby', 'american-football', 'boxing', 'esports'].includes(s))
        return ['api-sports', 'thesportsdb'];
      // cricket and formula1 use TheSportsDB exclusively
      return ['thesportsdb'];
    case 'standings':
      if (s === 'football')  return ['api-football', 'thesportsdb'];
      return ['api-sports', 'thesportsdb'];
    case 'statistics':
      if (s === 'football')  return ['api-football'];
      return ['api-sports', 'thesportsdb'];
    case 'odds':
      return ['api-football', 'api-sports'];
    case 'highlights':
    case 'news':
      return ['thesportsdb', 'api-football'];
    case 'events':
      return ['api-football', 'api-sports'];
    default:
      return ['api-football', 'thesportsdb'];
  }
}
