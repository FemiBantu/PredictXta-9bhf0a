import { getSupabaseClient } from '@/template';
import { getUTCRangeForLocalDate } from './dateUtils';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Match } from './types';
import { cacheLogosFromMatches } from './logoCache';
import { SPORT_API_KEY } from '@/constants/theme';

// ─── Normalize a UI sport label or any string to DB key ───────────────────────
// DB stores: 'football', 'basketball', 'american-football', 'formula1', 'table-tennis', etc.
// UI sends: 'Football', 'American Football', 'Formula 1', 'Table Tennis', 'All'
// This ensures the DB query always uses the correct key.
function normalizeSportForDB(sport: string | undefined): string | null {
  if (!sport || sport === 'All' || sport === 'all') return null;
  // Use SPORT_API_KEY map first (handles all UI labels correctly)
  const mapped = SPORT_API_KEY[sport];
  if (mapped && mapped !== 'all') return mapped;
  // Fallback: lowercase + spaces to hyphens
  return sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Logging helpers ──────────────────────────────────────────────────────────
const LOG = __DEV__;
function log(stage: string, ...args: unknown[]) {
  if (LOG) console.log(`[matchService][${stage}]`, ...args);
}
function warn(stage: string, ...args: unknown[]) {
  console.warn(`[matchService][${stage}]`, ...args);
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Retries an async operation up to `maxRetries` times with a fixed delay.
// Only retries on network-level / transient failures; non-2xx (FunctionsHttpError)
// from the edge function are NOT retried (they are deterministic errors).
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Do not retry on deterministic HTTP errors from the function itself
      if (err instanceof FunctionsHttpError) throw err;
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastError;
}

// Map snake_case DB rows → camelCase Match
function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    sport: (row.sport as string) || 'football',
    homeTeam: (row.home_team as string) ?? '',
    awayTeam: (row.away_team as string) ?? '',
    homeScore: (row.home_score as number) ?? 0,
    awayScore: (row.away_score as number) ?? 0,
    status: (row.status as 'live' | 'upcoming' | 'finished') ?? 'upcoming',
    matchTime: (row.match_time as string) ?? '',
    league: (row.league as string) || '',
    country: (row.country as string) ?? undefined,
    venue: row.venue as string | undefined,
    minute: (row.minute as number) ?? 0,
    round: (row.round as string) ?? undefined,
    homeOdds: row.home_odds as number | undefined,
    drawOdds: row.draw_odds as number | undefined,
    awayOdds: row.away_odds as number | undefined,
    homeLogo: (row.home_logo as string) || null,
    awayLogo: (row.away_logo as string) || null,
    leagueLogo: (row.league_logo as string) || null,
    stats: (row.stats as import('./types').MatchStats) ?? null,
    externalId: row.external_id as string | undefined,
  };
}

// ─── Supported sports type (13 verified sports only) ────────────────────────
// Only these sports have verified API coverage. Removed: boxing, motorsports,
// table-tennis, badminton, snooker, darts, cycling, athletics, esports.
export type SupportedSport =
  | 'football' | 'basketball' | 'tennis' | 'cricket' | 'baseball'
  | 'hockey' | 'rugby' | 'handball' | 'volleyball' | 'american-football'
  | 'mma' | 'formula1' | 'afl' | 'all';

// Trigger the edge function to fetch fresh data from API-Football + TheSportsDB
export async function syncMatchesFromApi(
  mode: 'today' | 'live' | 'all' = 'today',
  sport: SupportedSport = 'all',
): Promise<{ fetched: number; inserted: number } | null> {
  try {
    log('API Request', `→ fetch-matches | mode=${mode} sport=${sport}`);
    const supabase = getSupabaseClient();
    const { data, error } = await withRetry(() =>
      supabase.functions.invoke('fetch-matches', { body: { mode, sport } }),
    );
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const text = await error.context?.text();
          msg = text || msg;
        } catch {
          // ignore
        }
      }
      warn('API Response', `fetch-matches error: ${msg}`);
      return null;
    }
    log('API Response', `← fetch-matches | fetched=${data?.fetched ?? 0} inserted=${data?.inserted ?? 0}`);
    return data as { fetched: number; inserted: number };
  } catch (e) {
    warn('syncMatchesFromApi', e);
    return null;
  }
}

// Fetch matches from DB (with optional sport filter)
// Returns live matches, today's matches, recently finished (24h), and upcoming (next 7 days)
export async function fetchMatches(sport?: string): Promise<Match[]> {
  try {
    log('Database Read', `Fetching matches from DB | sport=${sport ?? 'All'}`);
    const supabase = getSupabaseClient();

    // Window: 24 hours ago → 7 days ahead
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const windowEnd   = new Date(Date.now() + 7  * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('matches')
      .select('*')
      .gte('match_time', windowStart)
      .lte('match_time', windowEnd)
      .order('match_time', { ascending: true })
      .limit(200);

    const dbSportKey = normalizeSportForDB(sport);
    if (dbSportKey) {
      query = query.eq('sport', dbSportKey);
    }

    // Also fetch any currently live matches regardless of match_time window
    let liveQuery = supabase
      .from('matches')
      .select('*')
      .eq('status', 'live')
      .order('minute', { ascending: false })
      .limit(50);
    if (dbSportKey) liveQuery = liveQuery.eq('sport', dbSportKey);

    const [windowResult, liveResult] = await Promise.all([
      query,
      liveQuery,
    ]);

    if (windowResult.error) {
      warn('Database Read', 'fetchMatches window query error:', windowResult.error.message);
    }
    if (liveResult.error) {
      warn('Database Read', 'fetchMatches live query error:', liveResult.error.message);
    }

    const windowData = (windowResult.data ?? []) as Record<string, unknown>[];
    const liveData   = (liveResult.data  ?? []) as Record<string, unknown>[];

    // Merge, deduplicating by id (live rows take priority)
    const seenIds = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const r of [...liveData, ...windowData]) {
      const id = r.id as string;
      if (!seenIds.has(id)) { seenIds.add(id); merged.push(r); }
    }

    // No further client-side filter needed — DB query was already scoped
    const filtered = merged;

    const mapped = filtered.map(rowToMatch);
    cacheLogosFromMatches(mapped);
    log('UI Render', `fetchMatches returning ${mapped.length} matches (${mapped.filter(m => m.status === 'live').length} live)`);
    return mapped;
  } catch (e) {
    warn('fetchMatches', 'Unexpected error:', e);
    return [];
  }
}

// Fetch only live matches from DB
export async function fetchLiveMatches(): Promise<Match[]> {
  try {
    log('Database Read', 'Fetching live-only matches from DB');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'live')
      .order('match_time', { ascending: true });

    if (error) {
      warn('Database Read', 'fetchLiveMatches error:', error.message);
      return [];
    }
    if (!data) return [];
    const mapped = (data as Record<string, unknown>[]).map(rowToMatch);
    cacheLogosFromMatches(mapped);
    log('Database Read', `Live matches: ${mapped.length}`);
    return mapped;
  } catch (e) {
    warn('fetchLiveMatches', e);
    return [];
  }
}

/**
 * Fetch matches for a specific LOCAL calendar date.
 *
 * Uses UTC boundaries derived from the device's local timezone so that
 * a match at 23:30 UTC on Aug 7 appears on Aug 8 for UTC+1 users.
 *
 * @param localDate   A Date object representing the target local calendar day
 * @param sport       Optional sport filter
 */
export async function fetchMatchesByDate(
  localDate: Date,
  sport?: string,
): Promise<Match[]> {
  try {
    const { utcStart, utcEnd } = getUTCRangeForLocalDate(localDate);
    log('Database Read', `fetchMatchesByDate | date=${localDate.toDateString()} utcStart=${utcStart} utcEnd=${utcEnd} sport=${sport ?? 'All'}`);

    const supabase = getSupabaseClient();
    const dbSportKey = normalizeSportForDB(sport);

    let query = supabase
      .from('matches')
      .select('*')
      .gte('match_time', utcStart)
      .lt('match_time', utcEnd)
      .order('match_time', { ascending: true })
      .limit(200);

    if (dbSportKey) query = query.eq('sport', dbSportKey);

    // Also include any currently live matches for this sport (regardless of time boundary)
    let liveQuery = supabase
      .from('matches')
      .select('*')
      .eq('status', 'live')
      .order('minute', { ascending: false })
      .limit(50);
    if (dbSportKey) liveQuery = liveQuery.eq('sport', dbSportKey);

    const [dayResult, liveResult] = await Promise.all([query, liveQuery]);

    if (dayResult.error) warn('fetchMatchesByDate', 'query error:', dayResult.error.message);
    if (liveResult.error) warn('fetchMatchesByDate', 'live query error:', liveResult.error.message);

    const dayData  = (dayResult.data  ?? []) as Record<string, unknown>[];
    const liveData = (liveResult.data ?? []) as Record<string, unknown>[];

    // Merge: live matches take priority, deduplicate by id
    const seenIds = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const r of [...liveData, ...dayData]) {
      const id = r.id as string;
      if (!seenIds.has(id)) { seenIds.add(id); merged.push(r); }
    }

    const mapped = merged.map(rowToMatch);
    cacheLogosFromMatches(mapped);
    log('UI Render', `fetchMatchesByDate returning ${mapped.length} matches for ${localDate.toDateString()}`);
    return mapped;
  } catch (e) {
    warn('fetchMatchesByDate', 'Unexpected error:', e);
    return [];
  }
}

export async function fetchMatchById(id: string): Promise<Match | null> {
  try {
    log('Database Read', `Fetching match by id=${id}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      warn('Database Read', `fetchMatchById error for id=${id}:`, error.message);
      return null;
    }
    if (!data) return null;
    const match = rowToMatch(data as Record<string, unknown>);
    cacheLogosFromMatches([match]);
    log('Database Read', `Match found: ${match.homeTeam} vs ${match.awayTeam} (${match.status})`);
    return match;
  } catch (e) {
    warn('fetchMatchById', e);
    return null;
  }
}


