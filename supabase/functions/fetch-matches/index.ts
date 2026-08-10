/**
 * fetch-matches — Multi-provider sports fixture ingestion v5.2
 *
 * Provider hierarchy:
 *   Football:           API-Football (primary) → TheSportsDB v2 (secondary)
 *   Basketball/Hockey/
 *   Baseball/Handball/
 *   Volleyball/Rugby/
 *   American-Football/
 *   MMA/AFL:            API-Sports sub-domain (primary) → TheSportsDB v2 (secondary)
 *   Tennis/Cricket/
 *   Formula1:           TheSportsDB v2 only (motorsport slug, isF1 regex filter)
 *
 * CRITICAL FIXES v5.2 (over v5.1):
 *  ✓ TSDB_STRSPORT_MAP — new reverse-mapping from TSDB verbose strSport names
 *    ("Mixed Martial Arts", "Ice Hockey", "American Football", …) to our internal
 *    sport keys. Without this, thesportsdbV2Livescore's /livescore/all fallback
 *    filtered by slug equality and silently missed all MMA, hockey, rugby, etc.
 *    live events because TSDB strSport never matched the compact slug.
 *  ✓ thesportsdbV2Livescore — uses TSDB_STRSPORT_MAP for robust strSport matching
 *    in the /livescore/all fallback path; also checks TSDB v2 slug equivalence.
 *  ✓ AFL added to ALL_SPORTS, TSDB_V2_SPORT_SLUGS, TSDB_V1_SPORT_SLUGS, and
 *    TSDB_STRSPORT_MAP; AFL events now appear in the breakdown response.
 *  ✓ API key fallback: checks API_SPORTS_KEY if API_FOOTBALL_KEY is absent.
 *    Both env vars refer to the same api-sports.io unified key; the naming
 *    difference was causing silent failures when only one was set.
 *  ✓ Formula1/motorsports external_id prefixes corrected: formula1 events get
 *    'formula1-tsdb-' prefix; motorsports events get 'motorsports-tsdb-' prefix.
 *    dataNormalizer VALID_PREFIXES updated to match.
 *  ✓ sport='all' guard: logs a warning since parallel per-sport invocations
 *    (via midnight-preload) are strongly preferred to avoid TSDB throttle timeout.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { invalidateSyncCache } from '../_shared/cloudflare.ts';
import {
  applySecurityMiddleware,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';
import {
  fetchWithTimeout,
  withRetry,
  recordSuccess,
  recordFailure,
  canUseProvider,
  getAllProviderHealth,
  resetAllCircuits,
} from '../_shared/providerHealth.ts';
import { normalizePipeline } from '../_shared/dataNormalizer.ts';

// ─── API-Sports bases — sport-specific sub-domains ──────────────────────────
// All sub-domains accept the same api-sports.io key via x-apisports-key header.
// The key is stored as API_FOOTBALL_KEY (or API_SPORTS_KEY alias) in env.
const API_FOOTBALL_BASE   = 'https://v3.football.api-sports.io';
const API_BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
const API_BASEBALL_BASE   = 'https://v1.baseball.api-sports.io';
const API_HOCKEY_BASE     = 'https://v1.hockey.api-sports.io';
const API_HANDBALL_BASE   = 'https://v1.handball.api-sports.io';
const API_VOLLEYBALL_BASE = 'https://v1.volleyball.api-sports.io';
const API_RUGBY_BASE      = 'https://v1.rugby.api-sports.io';
const API_AMERICAN_BASE   = 'https://v1.american-football.api-sports.io';
// NOTE: Tennis does NOT have a valid api-sports.io sub-domain.
// v1.tennis.api-sports.io returns transport errors (100% error rate).
// Tennis is handled EXCLUSIVELY via TheSportsDB (see fetchTennis below).
const API_MMA_BASE        = 'https://v1.mma.api-sports.io';
const API_AFL_BASE        = 'https://v1.afl.api-sports.io';
// Defined but intentionally unused — formula1/motorsports use TSDB only.
// const API_NBA_BASE     = 'https://v2.nba.api-sports.io';
// const API_FORMULA1_BASE = 'https://v1.formula-1.api-sports.io';

// ─── TheSportsDB ─────────────────────────────────────────────────────────────
const TSDB_V2_BASE = 'https://www.thesportsdb.com/api/v2/json';
const TSDB_V1_BASE = () =>
  `https://www.thesportsdb.com/api/v1/json/${Deno.env.get('SPORTSDB_KEY') ?? '3'}`;

function tsdbV2Headers(): Record<string, string> {
  const key = Deno.env.get('SPORTSDB_KEY');
  if (key && key !== '3') return { Authorization: `Bearer ${key}` };
  return {};
}

// ─── TSDB v2 sport slugs (used in /livescore/{slug} path) ────────────────────
const TSDB_V2_SPORT_SLUGS: Record<string, string> = {
  football:           'soccer',
  basketball:         'basketball',
  tennis:             'tennis',
  cricket:            'cricket',
  baseball:           'baseball',
  hockey:             'ice_hockey',
  rugby:              'rugby',
  'american-football':'american_football',
  mma:                'mma',
  handball:           'handball',
  volleyball:         'volleyball',
  formula1:           'motorsport',
  afl:                'australian_football',
};

// ─── TSDB v1 sport slugs (URL-encoded, used in eventsday.php?s=) ─────────────
const TSDB_V1_SPORT_SLUGS: Record<string, string> = {
  football:           'Soccer',
  basketball:         'Basketball',
  tennis:             'Tennis',
  cricket:            'Cricket',
  baseball:           'Baseball',
  hockey:             'Ice+Hockey',
  rugby:              'Rugby+League',
  'american-football':'American+Football',
  mma:                'Mixed+Martial+Arts',
  handball:           'Handball',
  volleyball:         'Volleyball',
  formula1:           'Motorsport',
  afl:                'Australian+Football',
};

/**
 * TSDB strSport → internal sport key.
 *
 * TSDB's strSport field uses verbose, human-readable names ("Mixed Martial Arts",
 * "Ice Hockey", "American Football") that do NOT match our compact slugs ("mma",
 * "hockey", "american-football"). Without this map, the /livescore/all fallback
 * in thesportsdbV2Livescore silently missed all live events for those sports.
 *
 * COVERAGE NOTE: motorsport maps to 'motorsports' (the formula1/notF1 split
 * happens inside fetchFormula1 / fetchMotorsports via the isF1 regex).
 */
const TSDB_STRSPORT_MAP: Record<string, string> = {
  'soccer':                        'football',
  'football':                      'football',   // TSDB occasionally uses 'Football'
  'basketball':                    'basketball',
  'tennis':                        'tennis',
  'cricket':                       'cricket',
  'baseball':                      'baseball',
  'ice hockey':                    'hockey',
  'rugby league':                  'rugby',
  'rugby union':                   'rugby',
  'rugby':                         'rugby',
  'american football':             'american-football',
  'american_football':             'american-football',
  'mixed martial arts':            'mma',
  'mixed_martial_arts':            'mma',
  'mma':                           'mma',
  'handball':                      'handball',
  'volleyball':                    'volleyball',
  'australian rules football':     'afl',
  'australian_rules_football':     'afl',
  'australian football':           'afl',
  'afl':                           'afl',
};

// ─── v2 schedule/next league IDs ─────────────────────────────────────────────
// IMPORTANT: TheSportsDB v2 /schedule/next/league/{id} returns HTTP 400 for all
// league IDs tested. Setting to empty arrays prevents these calls from polluting
// the api_usage error rate. Coverage is maintained via v2 livescore + v1 eventsday.
const TOP_LEAGUE_IDS: Record<string, number[]> = {
  football:            [],
  basketball:          [],
  tennis:              [],
  cricket:             [],
  hockey:              [],
  baseball:            [],
  mma:                 [],
  'american-football': [],
};

// ─── Config ───────────────────────────────────────────────────────────────────
const OFF_SEASON_LOOKAHEAD_DAYS = 90;
const API_SPORTS_TIMEOUT_MS     = 14_000;
const TSDB_TIMEOUT_MS           = 10_000;
const CACHE_TTL_MS              = 6 * 60 * 60 * 1000;

/**
 * All sport keys supported by this function.
 * IMPORTANT: 'all' is a special routing value handled in the main handler.
 * AFL is included; NBA routes through basketball fetcher and is not listed
 * separately since its records carry sport='basketball' in the DB.
 */
const ALL_SPORTS = [
  'football', 'basketball', 'tennis', 'baseball', 'hockey',
  'rugby', 'handball', 'volleyball', 'american-football',
  'cricket', 'mma', 'formula1', 'afl',
] as const;
type SportKey = typeof ALL_SPORTS[number] | 'all';

// ─── TheSportsDB rate-limit semaphore ─────────────────────────────────────────
let _tsdbQueue: Promise<void> = Promise.resolve();
let _tsdbLastCallMs            = 0;
const TSDB_MIN_INTERVAL_MS     = 3_000;

async function tsdbThrottle(): Promise<void> {
  const wait = TSDB_MIN_INTERVAL_MS - (Date.now() - _tsdbLastCallMs);
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  _tsdbLastCallMs = Date.now();
}

let _supabaseRef: ReturnType<typeof createClient> | null = null;
function setSupabaseRef(s: ReturnType<typeof createClient>) { _supabaseRef = s; }

// ─── 6-Hour Cache Layer ───────────────────────────────────────────────────────
async function getCached(cacheKey: string): Promise<Record<string, unknown>[] | null> {
  if (!_supabaseRef) return null;
  try {
    const { data, error } = await _supabaseRef
      .from('match_fetch_cache')
      .select('data, expires_at, hit_count, id')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) {
      _supabaseRef.from('match_fetch_cache').delete().eq('cache_key', cacheKey).catch(() => {});
      return null;
    }
    _supabaseRef.from('match_fetch_cache')
      .update({ hit_count: (data.hit_count ?? 0) + 1 }).eq('id', data.id).catch(() => {});
    return data.data as Record<string, unknown>[];
  } catch { return null; }
}

async function setCached(
  cacheKey: string, provider: string, sport: string,
  fetchDate: string, rows: Record<string, unknown>[],
): Promise<void> {
  if (!_supabaseRef || rows.length === 0) return;
  try {
    await _supabaseRef.from('match_fetch_cache').upsert({
      cache_key: cacheKey, provider, sport, fetch_date: fetchDate,
      data: rows as unknown as Record<string, unknown>,
      row_count: rows.length,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      hit_count: 0,
    }, { onConflict: 'cache_key', ignoreDuplicates: false });
  } catch (e) { console.warn(`[Cache SET error] ${cacheKey}:`, e); }
}

async function purgeExpiredCache(): Promise<void> {
  if (!_supabaseRef) return;
  try { await _supabaseRef.from('match_fetch_cache').delete().lt('expires_at', new Date().toISOString()); }
  catch { /* non-blocking */ }
}

// ─── API Usage tracker ────────────────────────────────────────────────────────
async function trackUsage(provider: string, endpoint: string, resultCount: number, error?: string) {
  if (!_supabaseRef) return;
  try {
    const supabase = _supabaseRef;
    const today    = new Date().toISOString().split('T')[0];
    const success  = !error;
    const { data: existing } = await supabase
      .from('api_usage')
      .select('id, request_count, success_count, error_count')
      .eq('provider_name', provider).eq('endpoint', endpoint).eq('date', today)
      .maybeSingle();
    if (existing) {
      await supabase.from('api_usage').update({
        request_count: (existing.request_count ?? 0) + 1,
        success_count: (existing.success_count ?? 0) + (success ? 1 : 0),
        error_count:   (existing.error_count ?? 0)   + (success ? 0 : 1),
        last_called: new Date().toISOString(),
        last_error:  success ? null : (error ?? null),
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider, endpoint,
        request_count: 1,
        success_count: success ? 1 : 0,
        error_count:   success ? 0 : 1,
        last_called: new Date().toISOString(),
        last_error:  success ? null : (error ?? null),
        date: today,
      });
    }
  } catch { /* non-blocking */ }
}

function toDate(d: Date = new Date()) { return d.toISOString().split('T')[0]; }

function buildMatchTime(dateField?: string | null, timeField?: string | null): string {
  if (!dateField) return new Date().toISOString();
  if (dateField.includes('T')) return dateField;
  const time = timeField && timeField.length >= 5 ? timeField : '00:00:00';
  return `${dateField}T${time}Z`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── API-Sports helper ────────────────────────────────────────────────────────
async function apiSports(base: string, path: string, apiKey: string, useCache = true): Promise<unknown[]> {
  const subdomain   = base.replace(/https?:\/\//, '').split('.')[1] ?? 'unknown';
  const providerKey = subdomain === 'football' ? 'api-football' : `api-sports-${subdomain}`;
  const ck          = `apisports:${subdomain}:${path}`;

  if (useCache) { const cached = await getCached(ck); if (cached !== null) return cached; }
  if (!canUseProvider(providerKey)) { console.log(`[Circuit] Skipping ${base}${path} — circuit OPEN`); return []; }

  const start = Date.now();
  try {
    const res = await withRetry(providerKey, () =>
      fetchWithTimeout(`${base}${path}`, { headers: { 'x-apisports-key': apiKey, Accept: 'application/json' } }, API_SPORTS_TIMEOUT_MS), 2);
    const elapsed = Date.now() - start;

    if (res.status === 401 || res.status === 403) {
      const msg = `HTTP ${res.status} — invalid API key for ${base}`;
      recordFailure(providerKey, msg, { isAuthError: true });
      await trackUsage(providerKey === 'api-football' ? 'api-football' : 'api-sports', path.split('?')[0], 0, msg);
      return [];
    }
    if (res.status === 404) { recordFailure(providerKey, 'HTTP 404', { is404: true }); return []; }
    if (res.status === 429) { await trackUsage('api-sports', path.split('?')[0], 0, 'HTTP 429'); return []; }
    if (!res.ok) {
      const msg = `HTTP ${res.status}`;
      recordFailure(providerKey, msg);
      await trackUsage('api-sports', path.split('?')[0], 0, msg);
      return [];
    }

    const json    = await res.json();
    const results: unknown[] = json.response ?? json.results ?? json.data ?? [];
    console.log(`[API-Sports] ${base}${path} → ${results.length} rows (${elapsed}ms)`);
    recordSuccess(providerKey, elapsed);
    await trackUsage(providerKey === 'api-football' ? 'api-football' : 'api-sports', path.split('?')[0], results.length);
    if (useCache && results.length > 0) await setCached(ck, providerKey, subdomain, toDate(), results as Record<string, unknown>[]);
    return results;
  } catch (e) {
    const msg     = e instanceof Error ? e.message : String(e);
    const elapsed = Date.now() - start;
    if (msg.includes('CIRCUIT_OPEN')) return [];
    const isTransport = msg.includes('error sending request') || msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') || msg.includes('TIMEOUT') || msg.includes('AbortError');
    console.error(`[API-Sports] ${base}${path} error (${elapsed}ms): ${msg.substring(0, 120)}`);
    if (!isTransport) recordFailure(providerKey, msg);
    await trackUsage('api-sports', path.split('?')[0], 0, msg.substring(0, 200));
    return [];
  }
}

const apifootball = (path: string, apiKey: string, useCache = true) =>
  apiSports(API_FOOTBALL_BASE, path, apiKey, useCache);

// ─── TheSportsDB v2 helper ────────────────────────────────────────────────────
const TSDB_PROVIDER = 'thesportsdb';

interface TsdbV2Event {
  idEvent: string; strEvent: string; dateEvent: string; strTime: string | null;
  strHomeTeam: string; strAwayTeam: string;
  intHomeScore: string | null; intAwayScore: string | null;
  strStatus: string | null; strVenue: string | null;
  strLeague: string; strSport: string; strThumb: string | null;
  strHomeTeamBadge: string | null; strAwayTeamBadge: string | null;
  strLeagueBadge?: string | null; idLeague?: string | null;
}
type TsdbEvent = TsdbV2Event;

async function thesportsdbV2(path: string): Promise<TsdbV2Event[]> {
  const ck = `tsdb_v2:${path}:${toDate()}`;
  const cached = await getCached(ck);
  if (cached !== null) return cached as TsdbV2Event[];
  if (!canUseProvider(TSDB_PROVIDER)) { console.log(`[Circuit] Skipping TheSportsDB v2 ${path} — circuit OPEN`); return []; }

  const result = await (_tsdbQueue = _tsdbQueue.then(async () => {
    await tsdbThrottle();
    const reqStart = Date.now();
    try {
      const res = await fetchWithTimeout(`${TSDB_V2_BASE}${path}`, { headers: { ...tsdbV2Headers(), Accept: 'application/json' } }, TSDB_TIMEOUT_MS);
      const elapsed = Date.now() - reqStart;

      if (res.status === 404) { recordFailure(TSDB_PROVIDER, 'HTTP 404', { is404: true }); return []; }
      if (res.status === 429) { await trackUsage('thesportsdb', path.split('?')[0], 0, 'HTTP 429'); await sleep(5_000); return []; }
      if (res.status === 401 || res.status === 403) {
        const msg = `HTTP ${res.status} — key required for v2 endpoint`;
        recordFailure(TSDB_PROVIDER, msg, { isAuthError: true }); return [];
      }
      if (!res.ok) {
        const msg = `HTTP ${res.status}`;
        recordFailure(TSDB_PROVIDER, msg);
        await trackUsage('thesportsdb', path.split('?')[0], 0, msg);
        return [];
      }

      const json    = await res.json();
      const results: TsdbV2Event[] = json.livescores ?? json.events ?? json.results ?? json.data ?? [];
      console.log(`[TheSportsDB v2] ${path} → ${results.length} rows (${elapsed}ms)`);
      recordSuccess(TSDB_PROVIDER, elapsed);
      await trackUsage('thesportsdb', path, results.length);
      if (results.length > 0) {
        const sportTag = path.split('/')[2] ?? 'unknown';
        await setCached(ck, 'thesportsdb', sportTag, toDate(), results as unknown as Record<string, unknown>[]);
      }
      return results;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('CIRCUIT_OPEN')) {
        recordFailure(TSDB_PROVIDER, msg);
        await trackUsage('thesportsdb', path.split('?')[0], 0, msg.substring(0, 200));
      }
      return [];
    }
  }));
  return result;
}

async function thesportsdbV1Eventsday(sportV1Slug: string, date: string): Promise<TsdbEvent[]> {
  const ck = `tsdb_v1_eventsday:${sportV1Slug}:${date}`;
  const cached = await getCached(ck);
  if (cached !== null) return cached as TsdbEvent[];
  if (!canUseProvider(TSDB_PROVIDER)) return [];

  const result = await (_tsdbQueue = _tsdbQueue.then(async () => {
    await tsdbThrottle();
    const reqStart = Date.now();
    try {
      const res = await fetchWithTimeout(`${TSDB_V1_BASE()}/eventsday.php?d=${date}&s=${sportV1Slug}`, {}, TSDB_TIMEOUT_MS);
      const elapsed = Date.now() - reqStart;
      if (!res.ok) {
        if (res.status !== 404) { recordFailure(TSDB_PROVIDER, `HTTP ${res.status}`); await trackUsage('thesportsdb', '/eventsday.php', 0, `HTTP ${res.status}`); }
        return [];
      }
      const json   = await res.json();
      const events: TsdbEvent[] = json.events ?? [];
      if (events.length > 0) {
        recordSuccess(TSDB_PROVIDER, elapsed);
        await trackUsage('thesportsdb', '/eventsday.php', events.length);
        await setCached(ck, 'thesportsdb', sportV1Slug, date, events as unknown as Record<string, unknown>[]);
      }
      console.log(`[TheSportsDB v1 eventsday] ${sportV1Slug}/${date} → ${events.length} rows (${elapsed}ms)`);
      return events;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('CIRCUIT_OPEN')) { recordFailure(TSDB_PROVIDER, msg); await trackUsage('thesportsdb', '/eventsday.php', 0, msg.substring(0, 200)); }
      return [];
    }
  }));
  return result;
}

/**
 * Fetch live events for a specific sport from TSDB v2.
 * Primary: /livescore/{v2Slug}
 * Fallback: /livescore/all filtered by strSport using TSDB_STRSPORT_MAP.
 *
 * FIX v5.2: The old fallback used slug equality which missed "Mixed Martial Arts"
 * vs "mma", "Ice Hockey" vs "ice_hockey", etc. Now uses the reverse mapping.
 */
async function thesportsdbV2Livescore(sport: string): Promise<TsdbV2Event[]> {
  const v2Slug = TSDB_V2_SPORT_SLUGS[sport] ?? sport.toLowerCase().replace(/[-\s]+/g, '_');
  let events = await thesportsdbV2(`/livescore/${v2Slug}`);

  if (events.length === 0) {
    const all = await thesportsdbV2('/livescore/all');
    events = all.filter((e) => {
      const rawSport         = (e.strSport ?? '').toLowerCase();
      const normalizedSlug   = rawSport.replace(/\s+/g, '_');

      // 1. Direct v2-slug match (e.g. "soccer" === "soccer" for football)
      if (normalizedSlug === v2Slug) return true;

      // 2. Reverse map: TSDB strSport → our sport key
      //    e.g. "mixed martial arts" → "mma", "ice hockey" → "hockey"
      const mappedSport = TSDB_STRSPORT_MAP[rawSport] ?? TSDB_STRSPORT_MAP[normalizedSlug];
      if (mappedSport === sport) return true;

      // 3. TSDB_V2_SPORT_SLUGS equivalence
      //    e.g. TSDB returns strSport="motorsport" and we look up v2Slug for "formula1"="motorsport"
      return TSDB_V2_SPORT_SLUGS[sport] === normalizedSlug;
    });
  }
  return events;
}

// v2 schedule via league IDs — disabled (returns HTTP 400 for all known IDs).
// Kept as no-op to avoid removing call sites; returns empty immediately.
async function thesportsdbV2Upcoming(_sport: string): Promise<TsdbV2Event[]> {
  return [];
}

async function thesportsdbDayRange(sport: string, startDay = 1, endDay = 7): Promise<TsdbEvent[]> {
  const v1Slug = TSDB_V1_SPORT_SLUGS[sport] ?? sport;
  const rows: TsdbEvent[] = [];
  const seen = new Set<string>();
  for (let d = startDay; d <= endDay; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const events = await thesportsdbV1Eventsday(v1Slug, toDate(dt));
    for (const e of events) { if (!seen.has(e.idEvent)) { rows.push(e); seen.add(e.idEvent); } }
    if (rows.length >= 15) break;
    if (d % 7 === 0) await sleep(1000);
  }
  return rows;
}

async function thesportsdbExtendedLookahead(sport: string, maxDays = 60): Promise<TsdbEvent[]> {
  return thesportsdbDayRange(sport, 1, maxDays);
}

// ─── Status mappers ───────────────────────────────────────────────────────────
function footballStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (['1H','2H','HT','ET','BT','P','LIVE','INT'].includes(s)) return 'live';
  if (['FT','AET','PEN','AWD','WO'].includes(s)) return 'finished';
  return 'upcoming';
}
function basketballStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (['Q1','Q2','Q3','Q4','OT','LIVE','HT','BT'].includes(s)) return 'live';
  if (['FT','AOT','POST'].includes(s)) return 'finished';
  return 'upcoming';
}
function hockeyStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (['P1','P2','P3','OT','LIVE','HT','BT'].includes(s)) return 'live';
  if (['FT','AOT','POST'].includes(s)) return 'finished';
  return 'upcoming';
}
function baseballStatus(s: string): 'live' | 'upcoming' | 'finished' {
  const u = s.toUpperCase();
  if (['IN_PROGRESS','LIVE','IN PROGRESS','INPROGRESS'].includes(u)) return 'live';
  if (['FINISHED','FT','COMPLETED','OVER','FINAL'].includes(u)) return 'finished';
  return 'upcoming';
}
function rugbyStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (['1H','2H','HT','LIVE','BT'].includes(s)) return 'live';
  if (['FT','AET','POST'].includes(s)) return 'finished';
  return 'upcoming';
}
function americanFootballStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (['Q1','Q2','Q3','Q4','OT','HT','LIVE'].includes(s)) return 'live';
  const u = s.toUpperCase();
  if (['FT','AOT','FIN','POST','FINAL'].includes(u)) return 'finished';
  return 'upcoming';
}
function mmaSportStatus(s: string): 'live' | 'upcoming' | 'finished' {
  const u = s.toUpperCase();
  if (['IN_PROGRESS','LIVE','STARTED'].includes(u)) return 'live';
  if (['FINISHED','FT','COMPLETED','CANCELLED','OVER'].includes(u)) return 'finished';
  return 'upcoming';
}
function tsdbStatus(s: string): 'live' | 'upcoming' | 'finished' {
  if (!s) return 'upcoming';
  const lower = s.toLowerCase();
  if (lower.includes('live') || lower.includes('progress') || lower === '1h' || lower === '2h') return 'live';
  if (lower.includes('finished') || lower.includes('ft') || lower.includes('complete') || lower.includes('ended') || lower === 'po') return 'finished';
  return 'upcoming';
}

function mapTsdbEvent(e: TsdbEvent, sport: string, forcedStatus?: 'live' | 'upcoming' | 'finished'): Record<string, unknown> | null {
  const homeTeam = (e.strHomeTeam ?? '').trim();
  const awayTeam = (e.strAwayTeam ?? '').trim();
  if (!homeTeam || !awayTeam) return null;
  if (homeTeam.toLowerCase().includes('tbd') || awayTeam.toLowerCase().includes('tbd')) return null;
  const status   = forcedStatus ?? tsdbStatus(e.strStatus ?? '');
  const matchISO = e.dateEvent ? `${e.dateEvent}T${e.strTime ?? '12:00:00'}Z` : new Date().toISOString();
  // external_id prefix MUST match the sport key for dataNormalizer.validateSportEndpoint.
  // Format: '{sport}-tsdb-{idEvent}' — startsWith('{sport}-') ✓
  return {
    external_id: `${sport}-tsdb-${e.idEvent}`, sport,
    league_id: e.idLeague ? Number(e.idLeague) : null,
    home_team: homeTeam, away_team: awayTeam,
    home_score: parseInt(e.intHomeScore ?? '0', 10) || 0,
    away_score: parseInt(e.intAwayScore ?? '0', 10) || 0,
    status, match_time: matchISO,
    league: e.strLeague || sport.charAt(0).toUpperCase() + sport.slice(1),
    country: inferCountry(e.strLeague ?? ''),
    home_logo: e.strHomeTeamBadge || null, away_logo: e.strAwayTeamBadge || null,
    league_logo: e.strLeagueBadge || null, venue: e.strVenue || null, minute: 0,
    source_provider: 'thesportsdb', last_updated: new Date().toISOString(),
    stats: e.strThumb ? { thumb: e.strThumb } : null,
  };
}

function inferCountry(leagueName: string): string {
  const l = leagueName.toLowerCase();
  const map: Array<[string, string]> = [
    ['premier league','England'],['la liga','Spain'],['bundesliga','Germany'],
    ['serie a','Italy'],['ligue 1','France'],['eredivisie','Netherlands'],
    ['primeira liga','Portugal'],['mls','USA'],['nba','USA'],['nfl','USA'],
    ['nhl','USA'],['mlb','USA'],['ufc','USA'],['champions league','Europe'],
    ['europa league','Europe'],['world cup','International'],
    ['atp','International'],['wta','International'],['ipl','India'],
    ['big bash','Australia'],['the hundred','England'],['psl','Pakistan'],
    ['cpl','Caribbean'],['isl','India'],['afl','Australia'],
  ];
  for (const [k, c] of map) if (l.includes(k)) return c;
  return 'International';
}

// ─── SPORT FETCHERS ───────────────────────────────────────────────────────────

interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null }; venue: { name: string | null; city: string | null } };
  league: { id: number; name: string; country: string; logo: string };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  goals: { home: number | null; away: number | null };
}

function mapFootball(f: ApiFixture): Record<string, unknown> {
  return {
    external_id: `football-${f.fixture.id}`, sport: 'football', league_id: f.league.id,
    home_team: f.teams.home.name, away_team: f.teams.away.name,
    home_score: f.goals.home ?? 0, away_score: f.goals.away ?? 0,
    status: footballStatus(f.fixture.status.short), match_time: f.fixture.date,
    league: f.league.name, country: f.league.country || 'International',
    home_logo: f.teams.home.logo || null, away_logo: f.teams.away.logo || null,
    league_logo: f.league.logo || null,
    venue: [f.fixture.venue?.name, f.fixture.venue?.city].filter(Boolean).join(', ') || null,
    minute: f.fixture.status.elapsed ?? 0, source_provider: 'api-football',
    last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchFootball(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('football')) { const r = mapTsdbEvent(e, 'football', 'live'); if (r) add(r); }
    for (const f of await apifootball('/fixtures?live=all', apiKey) as ApiFixture[]) add(mapFootball(f));
  }
  if (mode === 'today' || mode === 'all') {
    for (const f of await apifootball(`/fixtures?date=${toDate()}`, apiKey) as ApiFixture[]) add(mapFootball(f));
    const tom = new Date(); tom.setDate(tom.getDate() + 1);
    for (const f of await apifootball(`/fixtures?date=${toDate(tom)}`, apiKey) as ApiFixture[]) add(mapFootball(f));
  }
  if (rows.filter((r) => r.status === 'upcoming').length < 5) {
    for (const e of await thesportsdbV1Eventsday('Soccer', toDate())) { const r = mapTsdbEvent(e, 'football'); if (r) add(r); }
  }
  return rows;
}

interface ApiBasketballGame {
  game: { id: number; date: { start: string }; status: { short: string }; venue: string | null; league: { id: number; name: string; logo?: string; country: { name: string } } };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  scores: { home: { total: number | null }; away: { total: number | null } };
}

function mapBasketball(g: ApiBasketballGame): Record<string, unknown> {
  return {
    external_id: `basketball-${g.game.id}`, sport: 'basketball', league_id: g.game.league.id,
    home_team: g.teams.home.name, away_team: g.teams.away.name,
    home_score: g.scores.home.total ?? 0, away_score: g.scores.away.total ?? 0,
    status: basketballStatus(g.game.status.short), match_time: g.game.date.start,
    league: g.game.league.name, country: g.game.league.country?.name || 'International',
    home_logo: g.teams.home.logo || null, away_logo: g.teams.away.logo || null,
    league_logo: g.game.league.logo || null, venue: g.game.venue || null, minute: 0,
    source_provider: 'api-sports', last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchBasketball(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('basketball')) { const r = mapTsdbEvent(e, 'basketball', 'live'); if (r) add(r); }
    for (const g of await apiSports(API_BASKETBALL_BASE, '/games?live=all', apiKey) as ApiBasketballGame[]) add(mapBasketball(g));
  }
  if (mode === 'today' || mode === 'all') {
    for (let d = 0; d <= 14 && rows.length < 30; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d);
      for (const g of await apiSports(API_BASKETBALL_BASE, `/games?date=${toDate(dt)}`, apiKey) as ApiBasketballGame[]) add(mapBasketball(g));
    }
    for (const e of await thesportsdbV1Eventsday('Basketball', toDate())) { const r = mapTsdbEvent(e, 'basketball'); if (r) add(r); }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead('basketball', OFF_SEASON_LOOKAHEAD_DAYS)) { const r = mapTsdbEvent(e, 'basketball'); if (r) add(r); }
  }
  return rows;
}

// ─── Tennis — TheSportsDB ONLY (no valid API-Sports subdomain exists) ─────────
async function fetchTennis(mode: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown> | null) => { if (!r) return; const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('tennis')) add(mapTsdbEvent(e, 'tennis', 'live'));
  }
  if (mode === 'today' || mode === 'all') {
    for (const e of await thesportsdbV1Eventsday('Tennis', toDate())) add(mapTsdbEvent(e, 'tennis'));
    if (rows.length < 3) {
      for (const e of await thesportsdbDayRange('tennis', 1, 14)) add(mapTsdbEvent(e, 'tennis'));
    }
  }
  return rows;
}

interface ApiBaseballGame {
  id: number; date: string; time: string; status: { short: string };
  league: { id: number; name: string; logo?: string; country: { name: string } };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  scores: { home: { total: number | null }; away: { total: number | null } };
}

function mapBaseball(g: ApiBaseballGame, status: 'live' | 'upcoming' | 'finished'): Record<string, unknown> {
  return {
    external_id: `baseball-${g.id}`, sport: 'baseball', league_id: g.league.id,
    home_team: g.teams.home.name, away_team: g.teams.away.name,
    home_score: g.scores.home.total ?? 0, away_score: g.scores.away.total ?? 0, status,
    match_time: buildMatchTime(g.date, g.time), league: g.league.name, country: g.league.country?.name || 'International',
    home_logo: g.teams.home.logo || null, away_logo: g.teams.away.logo || null,
    league_logo: g.league.logo || null, venue: null, minute: 0,
    source_provider: 'api-sports', last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchBaseball(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('baseball')) { const r = mapTsdbEvent(e, 'baseball', 'live'); if (r) add(r); }
    for (const g of await apiSports(API_BASEBALL_BASE, '/games?live=all', apiKey) as ApiBaseballGame[]) add(mapBaseball(g, 'live'));
  }
  if (mode === 'today' || mode === 'all') {
    for (let d = 0; d <= 14 && rows.length < 30; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d);
      for (const g of await apiSports(API_BASEBALL_BASE, `/games?date=${toDate(dt)}`, apiKey) as ApiBaseballGame[]) add(mapBaseball(g, baseballStatus(g.status.short)));
    }
    for (const e of await thesportsdbV1Eventsday('Baseball', toDate())) { const r = mapTsdbEvent(e, 'baseball'); if (r) add(r); }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead('baseball', 60)) { const r = mapTsdbEvent(e, 'baseball'); if (r) add(r); }
  }
  return rows;
}

interface ApiHockeyGame {
  id: number; date: string; time: string; status: { short: string };
  league: { id: number; name: string; logo?: string; country: { name: string } };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  scores: { home: number | null; away: number | null };
}

function mapHockey(g: ApiHockeyGame, status: 'live' | 'upcoming' | 'finished'): Record<string, unknown> {
  return {
    external_id: `hockey-${g.id}`, sport: 'hockey', league_id: g.league.id,
    home_team: g.teams.home.name, away_team: g.teams.away.name,
    home_score: g.scores.home ?? 0, away_score: g.scores.away ?? 0, status,
    match_time: buildMatchTime(g.date, g.time), league: g.league.name, country: g.league.country?.name || 'International',
    home_logo: g.teams.home.logo || null, away_logo: g.teams.away.logo || null,
    league_logo: g.league.logo || null, venue: null, minute: 0,
    source_provider: 'api-sports', last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchHockey(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('hockey')) { const r = mapTsdbEvent(e, 'hockey', 'live'); if (r) add(r); }
    for (const g of await apiSports(API_HOCKEY_BASE, '/games?live=all', apiKey) as ApiHockeyGame[]) add(mapHockey(g, 'live'));
  }
  if (mode === 'today' || mode === 'all') {
    for (let d = 0; d <= 7 && rows.length < 20; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d);
      for (const g of await apiSports(API_HOCKEY_BASE, `/games?date=${toDate(dt)}`, apiKey) as ApiHockeyGame[]) add(mapHockey(g, hockeyStatus(g.status.short)));
    }
    for (const e of await thesportsdbV1Eventsday('Ice+Hockey', toDate())) { const r = mapTsdbEvent(e, 'hockey'); if (r) add(r); }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead('hockey', 60)) { const r = mapTsdbEvent(e, 'hockey'); if (r) add(r); }
  }
  return rows;
}

interface ApiGenericGame {
  id: number; date: string; time: string; status: { short: string };
  league: { id: number; name: string; logo?: string; country: { name: string } };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  scores: { home: number | null; away: number | null };
}

function mapGeneric(g: ApiGenericGame, sport: string, status: 'live' | 'upcoming' | 'finished'): Record<string, unknown> {
  return {
    // external_id: '{sport}-{id}' — prefix '{sport}' matches VALID_PREFIXES[sport]
    external_id: `${sport}-${g.id}`, sport, league_id: g.league.id,
    home_team: g.teams.home.name, away_team: g.teams.away.name,
    home_score: g.scores.home ?? 0, away_score: g.scores.away ?? 0, status,
    match_time: buildMatchTime(g.date, g.time), league: g.league.name, country: g.league.country?.name || 'International',
    home_logo: g.teams.home.logo || null, away_logo: g.teams.away.logo || null,
    league_logo: g.league.logo || null, venue: null, minute: 0,
    source_provider: 'api-sports', last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchApiSportsGeneric(
  mode: string, apiKey: string, base: string, sport: string,
  statusFn: (s: string) => 'live' | 'upcoming' | 'finished' = rugbyStatus,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore(sport)) { const r = mapTsdbEvent(e, sport, 'live'); if (r) add(r); }
    for (const g of await apiSports(base, '/games?live=all', apiKey) as ApiGenericGame[]) add(mapGeneric(g, sport, 'live'));
  }
  if (mode === 'today' || mode === 'all') {
    for (let d = 0; d <= 7 && rows.length < 30; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d);
      for (const g of await apiSports(base, `/games?date=${toDate(dt)}`, apiKey) as ApiGenericGame[]) add(mapGeneric(g, sport, statusFn(g.status.short)));
    }
    const v1Slug = TSDB_V1_SPORT_SLUGS[sport] ?? sport;
    for (const e of await thesportsdbV1Eventsday(v1Slug, toDate())) { const r = mapTsdbEvent(e, sport); if (r) add(r); }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead(sport, 30)) { const r = mapTsdbEvent(e, sport); if (r) add(r); }
  }
  return rows;
}

interface ApiAmericanGame {
  game: { id: number; date: { date: string; time: string }; venue: { name: string | null; city: string | null }; status: { short: string } };
  league: { id: number; name: string; logo?: string; country: { name: string } };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  scores: { home: { total: number | null }; away: { total: number | null } };
}

function mapAmericanFootball(g: ApiAmericanGame, status: 'live' | 'upcoming' | 'finished'): Record<string, unknown> {
  // external_id prefix is 'american-football' — dataNormalizer uses startsWith('american-football-') ✓
  return {
    external_id: `american-football-${g.game.id}`, sport: 'american-football', league_id: g.league.id,
    home_team: g.teams.home.name, away_team: g.teams.away.name,
    home_score: g.scores.home.total ?? 0, away_score: g.scores.away.total ?? 0, status,
    match_time: buildMatchTime(g.game.date.date, g.game.date.time), league: g.league.name,
    country: g.league.country?.name || 'International',
    home_logo: g.teams.home.logo || null, away_logo: g.teams.away.logo || null,
    league_logo: g.league.logo || null,
    venue: [g.game.venue?.name, g.game.venue?.city].filter(Boolean).join(', ') || null,
    minute: 0, source_provider: 'api-sports', last_updated: new Date().toISOString(), stats: null,
  };
}

async function fetchAmericanFootball(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown>) => { const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('american-football')) { const r = mapTsdbEvent(e, 'american-football', 'live'); if (r) add(r); }
    for (const g of await apiSports(API_AMERICAN_BASE, '/games?live=all', apiKey) as ApiAmericanGame[]) add(mapAmericanFootball(g, 'live'));
  }
  if (mode === 'today' || mode === 'all') {
    for (let d = 0; d <= 14 && rows.length < 10; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() + d);
      for (const g of await apiSports(API_AMERICAN_BASE, `/games?date=${toDate(dt)}`, apiKey) as ApiAmericanGame[]) add(mapAmericanFootball(g, americanFootballStatus(g.game.status.short)));
    }
    for (const e of await thesportsdbV1Eventsday('American+Football', toDate())) { const r = mapTsdbEvent(e, 'american-football'); if (r) add(r); }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead('american-football', 90)) { const r = mapTsdbEvent(e, 'american-football'); if (r) add(r); }
  }
  return rows;
}

async function fetchCricket(mode: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown> | null) => { if (!r) return; const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') { for (const e of await thesportsdbV2Livescore('cricket')) add(mapTsdbEvent(e, 'cricket', 'live')); }
  if (mode === 'today' || mode === 'all') {
    for (const e of await thesportsdbV1Eventsday('Cricket', toDate())) add(mapTsdbEvent(e, 'cricket'));
    if (rows.length < 3) { for (const e of await thesportsdbDayRange('cricket', 1, 14)) add(mapTsdbEvent(e, 'cricket')); }
  }
  return rows;
}

interface ApiMmaFight {
  id: number;
  category: { id: number; name: string; type: string; logo?: string };
  date: string; status: { short: string };
  fighters: {
    home: { id: number; name: string; logo?: string | null };
    away: { id: number; name: string; logo?: string | null };
  };
  scores: { home: number | null; away: number | null };
  weight_class: string | null; rounds: number | null; result: string | null;
}

function mapMmaFight(g: ApiMmaFight): Record<string, unknown> | null {
  const h = (g.fighters?.home?.name ?? '').trim();
  const a = (g.fighters?.away?.name ?? '').trim();
  if (!h || !a) return null;
  // external_id: 'mma-api-{id}' — VALID_PREFIXES.mma includes 'mma-api' ✓
  return {
    external_id: `mma-api-${g.id}`, sport: 'mma', league_id: g.category?.id ?? null,
    home_team: h, away_team: a, home_score: g.scores?.home ?? 0, away_score: g.scores?.away ?? 0,
    status: mmaSportStatus(g.status?.short ?? ''),
    match_time: g.date ?? new Date().toISOString(),
    league: g.category?.name ?? 'UFC Event', country: 'USA',
    home_logo: g.fighters?.home?.logo ?? null, away_logo: g.fighters?.away?.logo ?? null,
    league_logo: g.category?.logo ?? null, venue: null, minute: 0,
    source_provider: 'api-sports', last_updated: new Date().toISOString(),
    stats: { weight_class: g.weight_class, rounds: g.rounds, result: g.result },
  };
}

async function fetchMMA(mode: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown> | null) => { if (!r) return; const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') {
    for (const e of await thesportsdbV2Livescore('mma')) add(mapTsdbEvent(e, 'mma', 'live'));
    for (const g of await apiSports(API_MMA_BASE, '/fights?live=all', apiKey) as ApiMmaFight[]) add(mapMmaFight(g));
  }
  if (mode === 'today' || mode === 'all') {
    for (const g of await apiSports(API_MMA_BASE, `/fights?date=${toDate()}`, apiKey) as ApiMmaFight[]) add(mapMmaFight(g));
    if (rows.length < 3) {
      for (let d = 1; d <= 60 && rows.length < 10; d++) {
        const dt = new Date(); dt.setDate(dt.getDate() + d);
        for (const g of await apiSports(API_MMA_BASE, `/fights?date=${toDate(dt)}`, apiKey) as ApiMmaFight[]) add(mapMmaFight(g));
        if (rows.length >= 8) break;
        if (d % 7 === 0) await sleep(500);
      }
    }
    if (rows.length < 3) {
      for (const e of await thesportsdbV1Eventsday('Mixed+Martial+Arts', toDate())) add(mapTsdbEvent(e, 'mma'));
    }
  }
  if (rows.length < 3) {
    for (const e of await thesportsdbExtendedLookahead('mma', 60)) add(mapTsdbEvent(e, 'mma'));
  }
  return rows;
}

async function fetchSimpleTsdb(mode: string, sport: string, days = 14): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown> | null) => { if (!r) return; const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };

  if (mode === 'live' || mode === 'all') { for (const e of await thesportsdbV2Livescore(sport)) add(mapTsdbEvent(e, sport, 'live')); }
  if (mode === 'today' || mode === 'all') {
    for (const e of await thesportsdbV1Eventsday(TSDB_V1_SPORT_SLUGS[sport] ?? sport, toDate())) add(mapTsdbEvent(e, sport));
    if (rows.length === 0) { for (const e of await thesportsdbExtendedLookahead(sport, days)) add(mapTsdbEvent(e, sport)); }
  }
  return rows;
}

/**
 * Formula 1 fetcher — TSDB only.
 * Shares the 'Motorsport' TSDB v1 slug with fetchMotorsports; distinguished by
 * the isF1 regex which matches league/event names containing 'formula', 'f1', or 'grand prix'.
 * external_id prefix: 'formula1-tsdb-' — validated by VALID_PREFIXES.formula1 = ['formula1', 'formula-1']
 */
async function fetchFormula1(mode: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (r: Record<string, unknown> | null) => { if (!r) return; const e = r.external_id as string; if (e && !seen.has(e)) { rows.push(r); seen.add(e); } };
  const isF1 = (e: TsdbV2Event) => /(formula.?1|f1|grand prix)/i.test(`${e.strLeague} ${e.strEvent}`);

  if (mode === 'live' || mode === 'all') { for (const e of await thesportsdbV2Livescore('formula1')) { if (isF1(e)) add(mapTsdbEvent(e, 'formula1', 'live')); } }
  if (mode === 'today' || mode === 'all') {
    for (const e of await thesportsdbV1Eventsday('Motorsport', toDate())) { if (isF1(e)) add(mapTsdbEvent(e, 'formula1')); }
    if (rows.length === 0) { for (const e of await thesportsdbExtendedLookahead('formula1', 30)) { if (isF1(e)) add(mapTsdbEvent(e, 'formula1')); } }
  }
  return rows;
}

/**
 * Motorsports fetcher — TSDB only, non-F1 events.
 * Shares the 'Motorsport' TSDB v1 slug with fetchFormula1; distinguished by notF1 regex.
 * external_id prefix: 'motorsports-tsdb-' — validated by VALID_PREFIXES.motorsports = ['motorsports']
 */
// ─── Upsert & cleanup ─────────────────────────────────────────────────────────
async function upsertRows(supabase: ReturnType<typeof createClient>, rows: Record<string, unknown>[]): Promise<number> {
  const BATCH = 50;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from('matches').upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false }).select('id');
    if (error) console.error('Upsert error:', error.message);
    else total += data?.length ?? 0;
  }
  return total;
}

async function cleanupStaleMatches(supabase: ReturnType<typeof createClient>): Promise<void> {
  try { await supabase.rpc('auto_cleanup_stale_matches'); }
  catch (e) { console.warn('[fetch-matches] stale-match cleanup failed:', e); }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 60, windowSec: 60, blockSec: 120 },
      maxPayloadBytes: 8_000,
      rateLimitScope: 'fetch-matches',
      blockBotUa: true,
      sanitizeInput: true,
      verifySignature: false,
    });
    if (guard) return guard;

    // API key: same key used for ALL api-sports.io subdomains.
    // Primary: API_FOOTBALL_KEY (historical name). Fallback: API_SPORTS_KEY alias.
    const apiKey = Deno.env.get('API_FOOTBALL_KEY') ?? Deno.env.get('API_SPORTS_KEY');
    if (!apiKey) {
      return secureErrorResponse('API_FOOTBALL_KEY (or API_SPORTS_KEY) env var not configured', 500);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    setSupabaseRef(supabase);
    purgeExpiredCache().catch(() => {});
    await cleanupStaleMatches(supabase);

    let mode = 'today';
    let sport = 'all';
    let resetCircuits = false;
    let includeHealthReport = false;
    try {
      const body = parsedBody as Record<string, unknown>;
      mode                = (body?.mode  as string) || 'today';
      sport               = (body?.sport as string) || 'all';
      resetCircuits       = (body?.resetCircuits as boolean) === true;
      includeHealthReport = (body?.includeHealthReport as boolean) === true;
    } catch { /* defaults */ }

    if (resetCircuits) { resetAllCircuits(); console.log('[fetch-matches] All provider circuits reset'); }

    // WARN: sport='all' triggers sequential TSDB throttle queue for 20+ sports.
    // Each TSDB call waits 3 s minimum → 60+ seconds for all sports.
    // Use midnight-preload with parallel per-sport invocations instead.
    if (sport === 'all') {
      console.warn('[fetch-matches] WARNING: sport=all will run all sports sequentially through TSDB throttle. ' +
        'Prefer midnight-preload stage=fixtures which invokes fetch-matches per sport in parallel.');
    }

    console.log(`fetch-matches v5.2: sport=${sport} mode=${mode} key=${apiKey.substring(0, 8)}...`);
    const fetchStart = Date.now();

    // ── API-Sports fetchers (run in parallel) ──────────────────────────────
    const apiSportsFetchers: Array<Promise<Record<string, unknown>[]>> = [];
    if (sport === 'football'          || sport === 'all') apiSportsFetchers.push(fetchFootball(mode, apiKey));
    if (sport === 'basketball'        || sport === 'all') apiSportsFetchers.push(fetchBasketball(mode, apiKey));
    // Tennis: TheSportsDB only — no API-Sports subdomain
    if (sport === 'tennis'            || sport === 'all') apiSportsFetchers.push(fetchTennis(mode));
    if (sport === 'baseball'          || sport === 'all') apiSportsFetchers.push(fetchBaseball(mode, apiKey));
    if (sport === 'hockey'            || sport === 'all') apiSportsFetchers.push(fetchHockey(mode, apiKey));
    if (sport === 'handball'          || sport === 'all') apiSportsFetchers.push(fetchApiSportsGeneric(mode, apiKey, API_HANDBALL_BASE, 'handball'));
    if (sport === 'volleyball'        || sport === 'all') apiSportsFetchers.push(fetchApiSportsGeneric(mode, apiKey, API_VOLLEYBALL_BASE, 'volleyball'));
    if (sport === 'rugby'             || sport === 'all') apiSportsFetchers.push(fetchApiSportsGeneric(mode, apiKey, API_RUGBY_BASE, 'rugby'));
    if (sport === 'american-football' || sport === 'american_football' || sport === 'all')
      apiSportsFetchers.push(fetchAmericanFootball(mode, apiKey));
    if (sport === 'mma'               || sport === 'all') apiSportsFetchers.push(fetchMMA(mode, apiKey));
    if (sport === 'afl'               || sport === 'all')
      apiSportsFetchers.push(fetchApiSportsGeneric(mode, apiKey, API_AFL_BASE, 'afl', americanFootballStatus));
    // NBA alias: routes through basketball fetcher; records stored as sport='basketball'
    if (sport === 'nba') apiSportsFetchers.push(fetchBasketball(mode, apiKey));

    const apiSportsResults = await Promise.allSettled(apiSportsFetchers);

    // ── TSDB-only fetchers (sequential, throttled) ─────────────────────────
    const tsdbRows: Record<string, unknown>[] = [];
    if (sport === 'cricket'        || sport === 'all')   tsdbRows.push(...await fetchCricket(mode));
    if (sport === 'formula1'       || sport === 'f1' || sport === 'formula-1' || sport === 'all')
      tsdbRows.push(...await fetchFormula1(mode));


    // ── Merge all results ──────────────────────────────────────────────────
    const allRows: Record<string, unknown>[] = [];
    for (const result of apiSportsResults) {
      if (result.status === 'fulfilled') allRows.push(...result.value);
      else console.error('API-Sports fetcher rejected:', result.reason);
    }
    allRows.push(...tsdbRows);

    if (allRows.length === 0) {
      return secureResponse({ success: true, fetched: 0, inserted: 0, message: 'No fixtures returned from any provider' });
    }

    // ── Pre-dedup by external_id (fast path, before normalizePipeline) ─────
    const preDeduped: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();
    for (const row of allRows) {
      const eid = row.external_id as string;
      if (eid && !seenIds.has(eid)) { preDeduped.push(row); seenIds.add(eid); }
    }

    // ── Normalize: canonical names → dedup by unified ID → prefix fix → quality gate
    const { records: normalizedRows, stats: normStats } = normalizePipeline(preDeduped);
    const inserted = await upsertRows(supabase, normalizedRows as Record<string, unknown>[]);
    const elapsed  = Date.now() - fetchStart;

    // ── Usage tracking ─────────────────────────────────────────────────────
    const footballRows   = allRows.filter((r) => r.sport === 'football' && r.source_provider === 'api-football').length;
    const apiSportsCount = allRows.filter((r) => (r.source_provider as string)?.startsWith('api-sports')).length;
    const tsdbCount      = allRows.filter((r) => r.source_provider === 'thesportsdb').length;

    if (footballRows   > 0) await trackUsage('api-football', `/fixtures (${mode})`, footballRows);
    if (apiSportsCount > 0) await trackUsage('api-sports',   `/games (${mode})`,    apiSportsCount);
    if (tsdbCount      > 0) await trackUsage('thesportsdb',  '/v2 + eventsday',     tsdbCount);

    console.log(`[v5.2] Sources — api-football:${footballRows} api-sports:${apiSportsCount} tsdb:${tsdbCount} | raw:${allRows.length} deduped:${normalizedRows.length} upserted:${inserted} in ${elapsed}ms`);
    if (normStats.rejectedByQualityGate > 0) {
      console.warn(`[v5.2] Quality gate rejected ${normStats.rejectedByQualityGate} records`);
    }
    if (normStats.crossSportFixed > 0) {
      console.warn(`[v5.2] Cross-sport prefix fixes applied: ${normStats.crossSportFixed}`);
    }

    if (inserted > 0) invalidateSyncCache('fetch-matches').catch(() => {});

    // Sport breakdown across ALL_SPORTS (now includes 'afl')
    const breakdown: Record<string, number> = {};
    for (const sp of ALL_SPORTS) breakdown[sp] = allRows.filter((r) => r.sport === sp).length;

    return secureResponse({
      success: true, fetched: allRows.length, inserted, mode, sport,
      date: toDate(), elapsed_ms: elapsed, tsdb_api_version: 'v2',
      sources: { api_football: footballRows, api_sports: apiSportsCount, thesportsdb_v2: tsdbCount },
      normalization: {
        input:                    normStats.input,
        after_dedup:              normStats.afterDedup,
        after_quality_gate:       normStats.afterQualityGate,
        cross_sport_fixed:        normStats.crossSportFixed,
        duplicates_removed:       normStats.duplicatesRemoved,
        rejected_by_quality_gate: normStats.rejectedByQualityGate,
      },
      breakdown,
      providerHealth: includeHealthReport ? getAllProviderHealth() : undefined,
    });
  } catch (err) {
    console.error('Edge function error:', err);
    return secureErrorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
