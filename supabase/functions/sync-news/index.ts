/**
 * sync-news — Fetch sports news, previews, and editorial content
 *
 * Data sources (priority order):
 *   1. TheSportsDB — primary source for all sports news, event previews,
 *      team news, league previews (today + tomorrow)
 *   2. API-Football — football fixture previews, match reports (secondary)
 *
 * NOTE: Highlightly API has been permanently removed. All news content is
 * now sourced exclusively from TheSportsDB (primary) and API-Football (secondary).
 *
 * Stores in `news_articles`, deduplicates by `external_id`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { invalidateSyncCache } from '../_shared/cloudflare.ts';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

// TheSportsDB v2 base (no key in URL — uses auth header or public access)
const TSDB_V2_BASE = 'https://www.thesportsdb.com/api/v2/json';
// v1 base kept ONLY for /eventsday.php (no v2 day-based equivalent)
function getSportsDbV1Base() {
  return `https://www.thesportsdb.com/api/v1/json/${Deno.env.get('SPORTSDB_KEY') ?? '3'}`;
}
function tsdbV2Headers(): Record<string, string> {
  const key = Deno.env.get('SPORTSDB_KEY');
  if (key && key !== '3') return { Authorization: `Bearer ${key}` };
  return {};
}

// Sports to fetch news/previews for via TheSportsDB
// These are internal DB sport keys (not v1 display names)
const TSDB_SPORTS = [
  'football', 'basketball', 'tennis', 'cricket', 'baseball',
  'hockey', 'rugby', 'american-football', 'mma',
  'handball', 'volleyball', 'formula1', 'motorsports',
  'esports', 'darts', 'snooker', 'athletics', 'cycling',
] as const;

// Map internal DB sport key → v1 eventsday slug (still used for day lookups)
const SPORT_TO_V1_SLUG: Record<string, string> = {
  football:           'Soccer',
  basketball:         'Basketball',
  tennis:             'Tennis',
  cricket:            'Cricket',
  baseball:           'Baseball',
  hockey:             'Ice+Hockey',
  rugby:              'Rugby+League',
  'american-football':'American+Football',
  mma:                'Mixed+Martial+Arts',
  boxing:             'Boxing',
  handball:           'Handball',
  volleyball:         'Volleyball',
  formula1:           'Motorsport',
  motorsports:        'Motorsport',
  'table-tennis':     'Table+Tennis',
  badminton:          'Badminton',
  snooker:            'Snooker',
  darts:              'Darts',
  cycling:            'Cycling',
  athletics:          'Athletics',
  esports:            'ESports',
};

// Map internal DB sport key → v2 livescore slug
const SPORT_TO_V2_SLUG: Record<string, string> = {
  football:           'soccer',
  basketball:         'basketball',
  tennis:             'tennis',
  cricket:            'cricket',
  baseball:           'baseball',
  hockey:             'ice_hockey',
  rugby:              'rugby',
  'american-football':'american_football',
  mma:                'mma',
  boxing:             'boxing',
  handball:           'handball',
  volleyball:         'volleyball',
  formula1:           'motorsport',
  motorsports:        'motorsport',
};

// Top league IDs for v2 /schedule/previous/league/{id} (recent results = news)
const RECENT_LEAGUE_IDS: Record<string, number[]> = {
  football:    [4328, 4335, 4332, 4331, 4334],  // EPL, La Liga, Bundesliga, Serie A, Ligue 1
  basketball:  [4387],                           // NBA
  tennis:      [4424, 4425],                     // ATP, WTA
  cricket:     [4418],                           // IPL
};

// ─── Tracking helper ──────────────────────────────────────────────────────────
async function trackUsage(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  endpoint: string,
  count: number,
  error?: string,
) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const success = !error;
    const { data: existing } = await supabase
      .from('api_usage')
      .select('id, request_count, success_count, error_count')
      .eq('provider_name', provider)
      .eq('endpoint', endpoint)
      .eq('date', today)
      .maybeSingle();
    if (existing) {
      await supabase.from('api_usage').update({
        request_count: (existing.request_count ?? 0) + 1,
        success_count: (existing.success_count ?? 0) + (success ? 1 : 0),
        error_count:   (existing.error_count ?? 0)   + (success ? 0 : 1),
        last_called: new Date().toISOString(),
        last_error: success ? null : (error ?? null),
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider,
        endpoint,
        request_count: 1,
        success_count: success ? 1 : 0,
        error_count:   success ? 0 : 1,
        last_called: new Date().toISOString(),
        last_error: success ? null : (error ?? null),
        date: today,
      });
    }
  } catch { /* non-blocking */ }
}

async function logSync(
  supabase: ReturnType<typeof createClient>,
  jobName: string,
  status: 'success' | 'error',
  records: number,
  durationMs: number,
  errorMessage?: string,
) {
  try {
    await supabase.from('sync_logs').insert({
      job_name: jobName,
      status,
      records_affected: records,
      duration_ms: durationMs,
      error_message: errorMessage ?? null,
    });
  } catch { /* non-blocking */ }
}

// ─── TheSportsDB v2 fetch helper ─────────────────────────────────────────────
async function tsdbV2Fetch(path: string): Promise<any[]> {
  try {
    const res = await fetch(`${TSDB_V2_BASE}${path}`, {
      headers: { ...tsdbV2Headers(), Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[sync-news] TheSportsDB v2 ${path} → HTTP ${res.status}`);
      return [];
    }
    const json = await res.json().catch(() => ({}));
    // v2 response keys: livescores (livescore endpoints), events (schedule endpoints)
    return json.livescores ?? json.events ?? json.results ?? [];
  } catch (err) {
    console.warn(`[sync-news] TheSportsDB v2 ${path} error:`, err);
    return [];
  }
}

// ─── TheSportsDB v1 eventsday helper (still needed — no v2 day-based endpoint) ─
async function tsdbV1Eventsday(sportV1Slug: string, date: string): Promise<any[]> {
  try {
    const res = await fetch(
      `${getSportsDbV1Base()}/eventsday.php?d=${date}&s=${encodeURIComponent(sportV1Slug)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return json.events ?? [];
  } catch { return []; }
}

// ─── TheSportsDB v2 — recent results from league schedule ────────────────────
// v2: /schedule/previous/league/{idLeague} — returns past 10 events for a league
async function fetchTsdbV2RecentResults(sport: string): Promise<any[]> {
  const leagueIds = RECENT_LEAGUE_IDS[sport] ?? [];
  const results: any[] = [];
  const seen = new Set<string>();
  for (const id of leagueIds.slice(0, 2)) {
    for (const e of await tsdbV2Fetch(`/schedule/previous/league/${id}`)) {
      if (e.idEvent && !seen.has(e.idEvent)) { results.push(e); seen.add(e.idEvent); }
    }
  }
  return results;
}

// ─── TheSportsDB v2 — upcoming from league schedule ──────────────────────────
// v2: /schedule/next/league/{idLeague} — returns next 10 events for a league
async function fetchTsdbV2Upcoming(sport: string): Promise<any[]> {
  const leagueIds = RECENT_LEAGUE_IDS[sport] ?? [];
  const results: any[] = [];
  const seen = new Set<string>();
  for (const id of leagueIds.slice(0, 2)) {
    for (const e of await tsdbV2Fetch(`/schedule/next/league/${id}`)) {
      if (e.idEvent && !seen.has(e.idEvent)) { results.push(e); seen.add(e.idEvent); }
    }
  }
  return results;
}

// ─── Map TheSportsDB event → news article row ─────────────────────────────────
function mapTsdbEventToNews(e: any, sportDb: string): Record<string, unknown> {
  return {
    external_id: `tsdb-news-${e.idEvent}`,
    source: 'thesportsdb',
    sport: sportDb,
    title: e.strEvent ?? `${e.strHomeTeam ?? ''} vs ${e.strAwayTeam ?? ''}`,
    summary: e.strDescriptionEN ?? e.strDescriptionLocal ?? null,
    content: null,
    author: 'TheSportsDB',
    url: e.strVideo ?? null,
    image_url: e.strThumb ?? e.strBanner ?? e.strFanart ?? null,
    tags: [sportDb, 'preview'],
    category: (e.strStatus ?? '').toLowerCase().includes('finish') ? 'result' : 'preview',
    home_team: e.strHomeTeam ?? null,
    away_team: e.strAwayTeam ?? null,
    league: e.strLeague ?? null,
    published_at: e.dateEvent
      ? `${e.dateEvent}T${e.strTime ?? '12:00:00'}Z`
      : new Date().toISOString(),
  };
}

// ─── TheSportsDB — primary news source ───────────────────────────────────────
// Strategy:
//   1. v2 /schedule/next/league/{id}     → upcoming event previews
//   2. v2 /schedule/previous/league/{id} → recent match results
//   3. v1 /eventsday.php (today/tomorrow/yesterday) → fallback day-based
async function fetchTheSportsDbNews(sport: string, limit: number): Promise<Record<string, unknown>[]> {
  const sportDb  = sport; // already in DB key format
  const v1Slug   = SPORT_TO_V1_SLUG[sport] ?? sport;
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().split('T')[0];
  const yesterday= new Date(Date.now() - 24 * 3600_000).toISOString().split('T')[0];

  const allEvents: any[] = [];
  const seen = new Set<string>();
  const addEvents = (events: any[]) => {
    for (const e of events) {
      if (e.idEvent && !seen.has(e.idEvent)) { allEvents.push(e); seen.add(e.idEvent); }
    }
  };

  try {
    // Priority 1: v2 schedule endpoints for known leagues
    addEvents(await fetchTsdbV2Upcoming(sport));
    addEvents(await fetchTsdbV2RecentResults(sport));

    // Priority 2: v1 eventsday.php for today/tomorrow/yesterday (day-based — no v2 equivalent)
    const [todayRes, tomorrowRes, yestRes] = await Promise.allSettled([
      tsdbV1Eventsday(v1Slug, today),
      tsdbV1Eventsday(v1Slug, tomorrow),
      tsdbV1Eventsday(v1Slug, yesterday),
    ]);
    for (const r of [todayRes, tomorrowRes, yestRes]) {
      if (r.status === 'fulfilled') addEvents(r.value);
    }

    if (allEvents.length === 0) return [];
    return allEvents.slice(0, limit).map((e) => mapTsdbEventToNews(e, sportDb));
  } catch (err) {
    console.warn(`[sync-news] TheSportsDB/${sport} error:`, err);
    return [];
  }
}

// ─── TheSportsDB v2 — league news feed ───────────────────────────────────────
// Uses v2 /schedule/previous/league/{id} (replaces deprecated v1 /eventspastleague.php)
async function fetchTheSportsDbLeagueNews(leagueId: string): Promise<Record<string, unknown>[]> {
  try {
    // v2 endpoint: /schedule/previous/league/{idLeague}
    const events = await tsdbV2Fetch(`/schedule/previous/league/${leagueId}`);
    return events.slice(0, 10).map((e: any) => ({
      external_id: `tsdb-league-${e.idEvent}`,
      source: 'thesportsdb',
      sport: 'football',
      title: e.strEvent ?? `${e.strHomeTeam ?? ''} vs ${e.strAwayTeam ?? ''} Result`,
      summary: e.strDescriptionEN ?? null,
      content: null,
      author: 'TheSportsDB',
      url: e.strVideo ?? null,
      image_url: e.strThumb ?? e.strBanner ?? null,
      tags: ['football', 'result'],
      category: 'result',
      home_team: e.strHomeTeam ?? null,
      away_team: e.strAwayTeam ?? null,
      league: e.strLeague ?? null,
      published_at: e.dateEvent
        ? `${e.dateEvent}T${e.strTime ?? '12:00:00'}Z`
        : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

// ─── API-Football — fixture previews (secondary/football-only) ───────────────
async function fetchApiFootballPreviews(apiKey: string, limit: number): Promise<Record<string, unknown>[]> {
  if (!apiKey) return [];
  try {
    const today = new Date().toISOString().split('T')[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    let res: Response;
    try {
      res = await fetch(`${API_FOOTBALL_BASE}/fixtures?date=${today}&status=NS`, {
        headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn(`[sync-news] API-Football HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const fixtures: any[] = (json.response ?? []).slice(0, limit);
    console.log(`[sync-news] API-Football previews: ${fixtures.length}`);

    return fixtures.map((f: any) => ({
      external_id: `apif-preview-${f.fixture.id}`,
      source: 'api-football',
      sport: 'football',
      title: `${f.teams.home.name} vs ${f.teams.away.name} Preview`,
      summary: `${f.league.name} · ${f.teams.home.name} host ${f.teams.away.name}`,
      content: null,
      author: 'API-Football',
      url: null,
      image_url: f.teams.home.logo ?? null,
      tags: ['football', 'preview', (f.league.country ?? '').toLowerCase()].filter(Boolean),
      category: 'preview',
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      league: f.league.name,
      published_at: f.fixture.date ?? new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('[sync-news] API-Football previews error:', e);
    return [];
  }
}

// ─── API-Football — finished match reports (secondary) ───────────────────────
async function fetchApiFootballResults(apiKey: string, limit: number): Promise<Record<string, unknown>[]> {
  if (!apiKey) return [];
  try {
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().split('T')[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    let res: Response;
    try {
      res = await fetch(`${API_FOOTBALL_BASE}/fixtures?date=${yesterday}&status=FT`, {
        headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return [];
    const json = await res.json();
    const fixtures: any[] = (json.response ?? []).slice(0, limit);

    return fixtures.map((f: any) => ({
      external_id: `apif-result-${f.fixture.id}`,
      source: 'api-football',
      sport: 'football',
      title: `${f.teams.home.name} ${f.goals.home ?? 0}-${f.goals.away ?? 0} ${f.teams.away.name}`,
      summary: `Full-time result: ${f.league.name}`,
      content: null,
      author: 'API-Football',
      url: null,
      image_url: f.teams.home.logo ?? null,
      tags: ['football', 'result'],
      category: 'result',
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      league: f.league.name,
      published_at: f.fixture.date ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

// ─── Upsert news articles ─────────────────────────────────────────────────────
async function upsertNews(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const BATCH = 50;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('news_articles')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id');
    if (error) console.error('[sync-news] upsert error:', error.message);
    else total += data?.length ?? 0;
  }
  return total;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startMs = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const apiFootballKey = Deno.env.get('API_FOOTBALL_KEY') ?? '';

    let body: { sports?: string[]; limit?: number } = {};
    try { body = await req.json(); } catch { /* defaults */ }

    const sports: string[] = body.sports ?? [...TSDB_SPORTS];
    const limit = body.limit ?? 20;

    console.log(`[sync-news] TheSportsDB primary + API-Football secondary`);
    console.log(`[sync-news] sports=[${sports.join(',')}] limit=${limit}`);

    const allRows: Record<string, unknown>[] = [];
    let fetchErrors = 0;

    // Primary: TheSportsDB all sports in parallel
    const tsdbFetchers = sports.map((sport) => fetchTheSportsDbNews(sport, limit));

    // Secondary: API-Football football previews + results
    const apifFetchers = apiFootballKey ? [
      fetchApiFootballPreviews(apiFootballKey, limit),
      fetchApiFootballResults(apiFootballKey, Math.floor(limit / 2)),
    ] : [];

    // Optional: Top league news from TheSportsDB
    const topLeagueIds = ['4328', '4335', '4332', '4331', '4334']; // EPL, La Liga, Bundesliga, Serie A, Ligue 1
    const leagueFetchers = topLeagueIds.map(id => fetchTheSportsDbLeagueNews(id));

    const allFetchers = [...tsdbFetchers, ...apifFetchers, ...leagueFetchers];
    const results = await Promise.allSettled(allFetchers);

    for (const r of results) {
      if (r.status === 'fulfilled') allRows.push(...r.value);
      else { fetchErrors++; console.error('[sync-news] fetcher failed:', r.reason); }
    }

    // Deduplicate by external_id
    const seen = new Set<string>();
    const unique = allRows.filter((r) => {
      const id = r.external_id as string;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    console.log(`[sync-news] total unique: ${unique.length} (from ${allRows.length}) errors=${fetchErrors}`);

    const upserted = await upsertNews(supabase, unique);
    const elapsed = Date.now() - startMs;

    const tsdbCount = allRows.filter(r => r.source === 'thesportsdb').length;
    const afCount   = allRows.filter(r => r.source === 'api-football').length;

    await trackUsage(supabase, 'thesportsdb', '/v2/schedule + /eventsday (news)', tsdbCount,
      tsdbCount === 0 ? 'No news returned from TheSportsDB' : undefined);

    if (apiFootballKey) {
      await trackUsage(supabase, 'api-football', '/fixtures (news)', afCount);
    }

    await logSync(
      supabase, 'news-sync',
      upserted > 0 || fetchErrors === 0 ? 'success' : 'error',
      upserted, elapsed,
      fetchErrors > 0 ? `${fetchErrors} fetcher(s) failed` : undefined,
    );

    if (upserted > 0) await invalidateSyncCache('sync-news');

    return new Response(
      JSON.stringify({
        success: true,
        fetched: allRows.length,
        unique: unique.length,
        upserted,
        fetchErrors,
        sources: { theSportsDb: tsdbCount, apiFootball: afCount },
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.error('[sync-news] fatal error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), elapsed_ms: elapsed }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
