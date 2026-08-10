/**
 * sync-highlights — Fetches match highlights from TheSportsDB v2 (primary)
 * with API-Football as secondary source for match-linked highlight data.
 *
 * TheSportsDB API migration v2:
 *   OLD (v1): /api/v1/json/{key}/eventsday.php + /eventslive.php
 *   NEW (v2): /api/v2/json/schedule/previous/league/{id}  (recent results with media)
 *             /api/v1/json/{key}/eventsday.php             (day-based fallback, no v2 equiv)
 *
 * NOTE: Highlightly API has been permanently removed from this project.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

// TheSportsDB v2 base (no API key in URL path)
const TSDB_V2_BASE = 'https://www.thesportsdb.com/api/v2/json';
// v1 base ONLY for /eventsday.php (no v2 day-based equivalent exists)
function getSportsDbV1Base() {
  return `https://www.thesportsdb.com/api/v1/json/${Deno.env.get('SPORTSDB_KEY') ?? '3'}`;
}
function tsdbV2Headers(): Record<string, string> {
  const key = Deno.env.get('SPORTSDB_KEY');
  if (key && key !== '3') return { Authorization: `Bearer ${key}` };
  return {};
}

// Sports to fetch highlights for (internal DB key format)
const TSDB_SPORTS = [
  'football', 'basketball', 'tennis', 'cricket', 'baseball',
  'hockey', 'rugby', 'american-football', 'mma',
  'handball', 'volleyball',
] as const;

// Internal DB key → v1 display slug (for /eventsday.php day-based fallback)
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
  handball:           'Handball',
  volleyball:         'Volleyball',
};

// Top league IDs for v2 /schedule/previous/league/{id} (recent finished events)
const HIGHLIGHTS_LEAGUE_IDS: Record<string, number[]> = {
  football:   [4328, 4335, 4332, 4331, 4334],  // EPL, La Liga, Bundesliga, Serie A, Ligue 1
  basketball: [4387],                            // NBA
  tennis:     [4424, 4425],                      // ATP, WTA
  cricket:    [4418],                            // IPL
};

// ─── Usage tracker ────────────────────────────────────────────────────────────
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
  status: 'success' | 'error',
  recordsAffected: number,
  durationMs: number,
  errorMessage?: string,
) {
  try {
    await supabase.from('sync_logs').insert({
      job_name: 'highlight-sync',
      status,
      records_affected: recordsAffected,
      duration_ms: durationMs,
      error_message: errorMessage ?? null,
    });
  } catch { /* non-blocking */ }
}

// ─── TheSportsDB v2 highlights fetch ─────────────────────────────────────────
// Strategy:
//   1. v2 /schedule/previous/league/{id} — recent finished events with media
//   2. v1 /eventsday.php for today + yesterday fallback (no v2 day-based endpoint)
async function fetchTheSportsDbHighlights(sport: string, limit: number): Promise<Record<string, unknown>[]> {
  const v1Slug    = SPORT_TO_V1_SLUG[sport] ?? sport;
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().split('T')[0];

  const allEvents: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const addEvents = (events: any[]) => {
    for (const e of events) {
      if (e.idEvent && !seen.has(e.idEvent)) { allEvents.push(e); seen.add(e.idEvent); }
    }
  };

  try {
    // Priority 1: v2 /schedule/previous/league/{id} for known leagues
    // This replaces /eventspastleague.php (removed in v2) and /livescore.php (404 on free tier)
    const leagueIds = HIGHLIGHTS_LEAGUE_IDS[sport] ?? [];
    for (const id of leagueIds.slice(0, 2)) {
      try {
        const res = await fetch(`${TSDB_V2_BASE}/schedule/previous/league/${id}`, {
          headers: { ...tsdbV2Headers(), Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          // v2 schedule endpoints return events under "events" key
          addEvents(json.events ?? json.results ?? []);
        } else {
          console.log(`[sync-highlights] v2 schedule/previous/league/${id} → HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[sync-highlights] v2 league ${id} error:`, e);
      }
    }

    // Priority 2: v1 /eventsday.php for today + yesterday (fallback — no v2 day endpoint)
    for (const date of [today, yesterday]) {
      try {
        const res = await fetch(
          `${getSportsDbV1Base()}/eventsday.php?d=${date}&s=${encodeURIComponent(v1Slug)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          addEvents(json.events ?? []);
        }
      } catch { /* continue */ }
    }

    if (allEvents.length === 0) return [];

    // Filter to events with video/highlight content
    const withMedia = allEvents.filter((e: any) =>
      e.strVideo || e.strThumb || e.strBanner || e.strFanart
    );
    const source = withMedia.length > 0 ? withMedia : allEvents;

    return source.slice(0, limit).map((e: any) => ({
      external_id: `tsdb-hl-${e.idEvent}`,
      sport,
      title: e.strEvent ?? `${e.strHomeTeam ?? ''} vs ${e.strAwayTeam ?? ''} Highlights`,
      embed_url: e.strVideo ?? null,
      video_url: e.strVideo ?? null,
      thumbnail: e.strThumb ?? e.strBanner ?? e.strFanart ?? null,
      league: e.strLeague ?? null,
      home_team: e.strHomeTeam ?? null,
      away_team: e.strAwayTeam ?? null,
      event_date: e.dateEvent ?? null,
    }));
  } catch (err) {
    console.warn(`[sync-highlights] TheSportsDB/${sport} error:`, err);
    return [];
  }
}

// ─── API-Football recent finished matches as highlight candidates ─────────────
async function fetchApiFootballHighlights(apiKey: string, limit: number): Promise<Record<string, unknown>[]> {
  if (!apiKey) return [];
  try {
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().split('T')[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch(`${API_FOOTBALL_BASE}/fixtures?date=${yesterday}&status=FT`, {
        headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn(`[sync-highlights] API-Football HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const fixtures: any[] = (json.response ?? []).slice(0, limit);

    return fixtures.map((f: any) => ({
      external_id: `apif-hl-${f.fixture.id}`,
      sport: 'football',
      title: `${f.teams.home.name} ${f.goals.home ?? 0}-${f.goals.away ?? 0} ${f.teams.away.name} Highlights`,
      embed_url: null,
      video_url: null,
      thumbnail: f.teams.home.logo ?? null,
      league: f.league.name ?? null,
      home_team: f.teams.home.name ?? null,
      away_team: f.teams.away.name ?? null,
      event_date: f.fixture.date ? f.fixture.date.split('T')[0] : null,
    }));
  } catch (err) {
    console.warn('[sync-highlights] API-Football error:', err);
    return [];
  }
}

// ─── Upsert rows into highlights table ───────────────────────────────────────
async function upsertHighlights(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const BATCH = 25;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('highlights')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id');
    if (error) console.error('[sync-highlights] upsert error:', error.message);
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

    let limit = 20;
    let sports: string[] = [...TSDB_SPORTS];

    try {
      const body = await req.json();
      if (body?.limit) limit = Number(body.limit);
      if (Array.isArray(body?.sports)) sports = body.sports as string[];
    } catch { /* use defaults */ }

    console.log(`[sync-highlights] TheSportsDB v2 (primary) + API-Football (secondary)`);
    console.log(`[sync-highlights] sports=[${sports.join(',')}] limit=${limit}`);

    const allRows: Record<string, unknown>[] = [];
    const sportBreakdown: Record<string, number> = {};

    // Primary: TheSportsDB v2 for all sports
    const tsdbResults = await Promise.allSettled(
      sports.map((sport) => fetchTheSportsDbHighlights(sport, limit)),
    );

    tsdbResults.forEach((result, idx) => {
      const sport = sports[idx];
      if (result.status === 'fulfilled') {
        sportBreakdown[sport] = result.value.length;
        allRows.push(...result.value);
      } else {
        console.error(`[sync-highlights] TheSportsDB/${sport} failed:`, result.reason);
        sportBreakdown[sport] = 0;
      }
    });

    // Secondary: API-Football for football highlights
    const apifRows = await fetchApiFootballHighlights(apiFootballKey, limit);
    allRows.push(...apifRows);
    console.log(`[sync-highlights] API-Football secondary: ${apifRows.length} highlights`);

    // Deduplicate by external_id
    const seen = new Set<string>();
    const unique = allRows.filter((r) => {
      const id = r.external_id as string;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (unique.length === 0) {
      const msg = 'No highlights returned from TheSportsDB v2 or API-Football';
      console.warn(`[sync-highlights] ${msg}`);
      await trackUsage(supabase, 'thesportsdb', '/v2/schedule/previous (highlights)', 0, msg);
      await logSync(supabase, 'error', 0, Date.now() - startMs, msg);
      return new Response(
        JSON.stringify({ success: true, fetched: 0, upserted: 0, message: msg, sportBreakdown }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[sync-highlights] mapped ${unique.length} unique highlights`);

    const upserted = await upsertHighlights(supabase, unique);
    const elapsed  = Date.now() - startMs;

    console.log(`[sync-highlights] upserted ${upserted} rows in ${elapsed}ms`);

    const tsdbCount = unique.filter(r => (r.external_id as string)?.startsWith('tsdb-')).length;
    const apifCount = unique.filter(r => (r.external_id as string)?.startsWith('apif-')).length;

    await trackUsage(supabase, 'thesportsdb', '/v2/schedule/previous + /eventsday (highlights)', tsdbCount);
    if (apiFootballKey) {
      await trackUsage(supabase, 'api-football', '/fixtures (highlights)', apifCount);
    }
    await logSync(supabase, 'success', upserted, elapsed);

    return new Response(
      JSON.stringify({
        success: true,
        fetched: allRows.length,
        unique: unique.length,
        upserted,
        elapsed_ms: elapsed,
        tsdb_api_version: 'v2',
        sources: { theSportsDb: tsdbCount, apiFootball: apifCount },
        sportBreakdown,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const elapsed = Date.now() - startMs;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-highlights] fatal error:', msg);
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      await logSync(supabase, 'error', 0, elapsed, msg);
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: `Internal error: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
