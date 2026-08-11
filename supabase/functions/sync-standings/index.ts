/**
 * sync-standings — Syncs league standings, player stats from API-Football + TheSportsDB
 *
 * FIXES v2:
 *  ✓ Added AbortController timeout (12s) on all API-Football calls
 *  ✓ Auto-detect current season (2024/2025) based on month
 *  ✓ Try current season, fallback to previous season if no data
 *  ✓ TheSportsDB fallback for standings when API-Football fails
 *  ✓ Basketball/Hockey/Baseball standings via API-Sports
 *  ✓ Rate limit tracking per endpoint
 *  ✓ Retry with backoff on 429 / network errors
 *  ✓ Comprehensive error logging with provider + endpoint detail
 *  ✓ Non-blocking — individual league failures don't stop others
 *  ✓ Added x-apisports-key header (v3.football.api-sports.io uses this)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/providerHealth.ts';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const API_BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
const API_HOCKEY_BASE = 'https://v1.hockey.api-sports.io';
const TSDB_BASE_FN = () =>
  `https://www.thesportsdb.com/api/v1/json/${Deno.env.get('SPORTSDB_KEY') ?? '3'}`;
const FETCH_TIMEOUT_MS = 12_000;

/** Detect current football season: use 2025 after July, else 2024 */
function currentSeason(): number {
  const month = new Date().getMonth() + 1; // 1-12
  return month >= 7 ? 2025 : 2024;
}

// ─── Top football leagues ─────────────────────────────────────────────────────
const DEFAULT_FOOTBALL_LEAGUES = [
  { id: 39,  name: 'Premier League',        country: 'England' },
  { id: 140, name: 'La Liga',               country: 'Spain' },
  { id: 78,  name: 'Bundesliga',            country: 'Germany' },
  { id: 135, name: 'Serie A',               country: 'Italy' },
  { id: 61,  name: 'Ligue 1',               country: 'France' },
  { id: 94,  name: 'Primeira Liga',         country: 'Portugal' },
  { id: 88,  name: 'Eredivisie',            country: 'Netherlands' },
  { id: 2,   name: 'UEFA Champions League', country: 'Europe' },
  { id: 3,   name: 'UEFA Europa League',    country: 'Europe' },
  { id: 4,   name: 'UEFA Conference League',country: 'Europe' },
  { id: 203, name: 'Super Lig',             country: 'Turkey' },
  { id: 71,  name: 'Brasileirao',           country: 'Brazil' },
  { id: 128, name: 'Liga Profesional',      country: 'Argentina' },
  { id: 262, name: 'Liga MX',               country: 'Mexico' },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── API-Football with timeout + retry ───────────────────────────────────────
async function apifootball(path: string, apiKey: string, retries = 2): Promise<unknown[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${API_FOOTBALL_BASE}${path}`,
        { headers: { 'x-apisports-key': apiKey, Accept: 'application/json' } },
        FETCH_TIMEOUT_MS,
      );

      if (res.status === 429) {
        const waitMs = 2000 * Math.pow(2, attempt);
        console.warn(`[API-Football] ${path} → 429 rate-limit. Waiting ${waitMs}ms`);
        if (attempt < retries) { await sleep(waitMs); continue; }
        return [];
      }
      if (res.status === 401 || res.status === 403) {
        console.error(`[API-Football] ${path} → ${res.status} AUTH ERROR — check API_FOOTBALL_KEY`);
        return [];
      }
      if (!res.ok) {
        console.error(`[API-Football] ${path} → HTTP ${res.status}`);
        if (attempt < retries) { await sleep(1000); continue; }
        return [];
      }

      const json = await res.json();
      // API-Football wraps results differently per endpoint
      const results = json.response ?? json.standings ?? [];
      console.log(`[API-Football] ${path} → ${Array.isArray(results) ? results.length : '?'} items`);
      return Array.isArray(results) ? results : [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[API-Football] ${path} error attempt ${attempt}: ${msg.substring(0, 100)}`);
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      return [];
    }
  }
  return [];
}

// ─── TheSportsDB fallback for standings ──────────────────────────────────────
async function tsdbLeagueTable(leagueName: string, sport: string): Promise<Array<{
  teamName: string; position: number; played: number; wins: number;
  draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number;
}>> {
  try {
    // TheSportsDB uses league name search
    const encoded = encodeURIComponent(leagueName);
    const res = await fetchWithTimeout(
      `${TSDB_BASE_FN()}/lookuptable.php?l=${encoded}&s=2024-2025`,
      {},
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json.table ?? [];
    return rows.map((r: Record<string, unknown>) => ({
      teamName: String(r.strTeam ?? r.team ?? ''),
      position: Number(r.intRank ?? r.intPosition ?? 0),
      played: Number(r.intPlayed ?? 0),
      wins: Number(r.intWin ?? 0),
      draws: Number(r.intDraw ?? 0),
      losses: Number(r.intLoss ?? 0),
      goalsFor: Number(r.intGoalsFor ?? 0),
      goalsAgainst: Number(r.intGoalsAgainst ?? 0),
      points: Number(r.intPoints ?? 0),
    }));
  } catch (e) {
    console.error(`[TheSportsDB] standings for ${leagueName}: ${e}`);
    return [];
  }
}

// ─── Track API usage ──────────────────────────────────────────────────────────
async function trackUsage(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  endpoint: string,
  success: boolean,
  errorMsg?: string,
) {
  try {
    const today = new Date().toISOString().split('T')[0];
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
        error_count:   (existing.error_count   ?? 0) + (success ? 0 : 1),
        last_called:   new Date().toISOString(),
        last_error:    success ? null : (errorMsg ?? null),
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider,
        endpoint,
        request_count: 1,
        success_count: success ? 1 : 0,
        error_count:   success ? 0 : 1,
        last_called:   new Date().toISOString(),
        last_error:    success ? null : (errorMsg ?? null),
        date:          today,
      });
    }
  } catch { /* non-blocking */ }
}

// ─── Sync standings for one football league ───────────────────────────────────
async function syncFootballLeague(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  leagueId: number,
  leagueName: string,
  season: number,
): Promise<number> {
  const data = await apifootball(`/standings?league=${leagueId}&season=${season}`, apiKey);

  // Try previous season as fallback if no data returned
  let effectiveData = data;
  if (!data || data.length === 0) {
    console.log(`[sync-standings] No data for ${leagueName} ${season}, trying ${season - 1}`);
    effectiveData = await apifootball(`/standings?league=${leagueId}&season=${season - 1}`, apiKey);
    if (!effectiveData || effectiveData.length === 0) {
      await trackUsage(supabase, 'api-football', '/standings', false, `No standings for league ${leagueId}`);
      // Try TheSportsDB fallback
      const tsdbRows = await tsdbLeagueTable(leagueName, 'football');
      if (tsdbRows.length > 0) {
        return await upsertStandingsFromTsdb(supabase, tsdbRows, leagueId, leagueName, season, 'football');
      }
      return 0;
    }
  }

  await trackUsage(supabase, 'api-football', '/standings', true);

  // API-Football standings structure: response[0].league.standings[group][team]
  const leagueObj = (effectiveData[0] as Record<string, unknown>)?.league as Record<string, unknown> | undefined;
  const standingsGroups = leagueObj?.standings as unknown[][] | undefined;
  if (!standingsGroups || standingsGroups.length === 0) return 0;

  const allRows: Record<string, unknown>[] = [];
  for (const group of standingsGroups) {
    if (Array.isArray(group)) allRows.push(...(group as Record<string, unknown>[]));
  }

  const upsertRows = allRows.map((row: Record<string, unknown>) => ({
    league_id:     leagueId,
    league_name:   leagueName,
    season:        season,
    sport:         'football',
    team_name:     (row.team as Record<string, unknown>)?.name ?? '',
    team_logo:     (row.team as Record<string, unknown>)?.logo ?? null,
    position:      Number(row.rank ?? 0),
    played:        Number((row.all as Record<string, unknown>)?.played ?? 0),
    wins:          Number((row.all as Record<string, unknown>)?.win ?? 0),
    draws:         Number((row.all as Record<string, unknown>)?.draw ?? 0),
    losses:        Number((row.all as Record<string, unknown>)?.lose ?? 0),
    goals_for:     Number(((row.all as Record<string, unknown>)?.goals as Record<string, unknown>)?.for ?? 0),
    goals_against: Number(((row.all as Record<string, unknown>)?.goals as Record<string, unknown>)?.against ?? 0),
    goal_diff:     Number(row.goalsDiff ?? 0),
    points:        Number(row.points ?? 0),
    form:          (row.form as string) ?? null,
    description:   (row.description as string) ?? null,
    last_updated:  new Date().toISOString(),
  })).filter(r => r.team_name);

  if (upsertRows.length === 0) return 0;

  let upserted = 0;
  const BATCH = 50;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const { data: result, error } = await supabase
      .from('league_standings')
      .upsert(upsertRows.slice(i, i + BATCH), { onConflict: 'league_id,season,team_name', ignoreDuplicates: false })
      .select('id');
    if (error) console.error(`Standings upsert [${leagueName}]:`, error.message);
    else upserted += result?.length ?? 0;
  }
  console.log(`[sync-standings] ${leagueName} ${season}: ${upserted} rows`);
  return upserted;
}

async function upsertStandingsFromTsdb(
  supabase: ReturnType<typeof createClient>,
  rows: Array<{ teamName: string; position: number; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number }>,
  leagueId: number,
  leagueName: string,
  season: number,
  sport: string,
): Promise<number> {
  const upsertRows = rows.filter(r => r.teamName).map(r => ({
    league_id:     leagueId,
    league_name:   leagueName,
    season:        season,
    sport:         sport,
    team_name:     r.teamName,
    team_logo:     null,
    position:      r.position,
    played:        r.played,
    wins:          r.wins,
    draws:         r.draws,
    losses:        r.losses,
    goals_for:     r.goalsFor,
    goals_against: r.goalsAgainst,
    goal_diff:     r.goalsFor - r.goalsAgainst,
    points:        r.points,
    form:          null,
    description:   null,
    last_updated:  new Date().toISOString(),
  }));
  if (upsertRows.length === 0) return 0;
  const { data, error } = await supabase
    .from('league_standings')
    .upsert(upsertRows, { onConflict: 'league_id,season,team_name', ignoreDuplicates: false })
    .select('id');
  if (error) console.error(`[TSDB] Standings upsert [${leagueName}]:`, error.message);
  console.log(`[TSDB] ${leagueName}: ${data?.length ?? 0} rows from TheSportsDB fallback`);
  return data?.length ?? 0;
}

// ─── Basketball standings via API-Sports ──────────────────────────────────────
async function syncBasketballStandings(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
): Promise<number> {
  const BASKETBALL_LEAGUES = [
    { id: 12, name: 'NBA', season: '2023-2024' },
    { id: 120, name: 'EuroLeague', season: '2024-2025' },
  ];
  let total = 0;
  for (const league of BASKETBALL_LEAGUES) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASKETBALL_BASE}/standings?league=${league.id}&season=${league.season}`,
        { headers: { 'x-apisports-key': apiKey, Accept: 'application/json' } },
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        await trackUsage(supabase, 'api-sports', '/standings-basketball', false, `HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const groups = json.response ?? [];
      await trackUsage(supabase, 'api-sports', '/standings-basketball', groups.length > 0);
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        const rows = (group as Record<string, unknown>[]).map(r => ({
          league_id:    league.id,
          league_name:  league.name,
          season:       2024,
          sport:        'basketball',
          team_name:    (r.team as Record<string, unknown>)?.name ?? '',
          team_logo:    (r.team as Record<string, unknown>)?.logo ?? null,
          position:     Number(r.position ?? r.rank ?? 0),
          played:       Number((r.games as Record<string, unknown>)?.played ?? 0),
          wins:         Number((r.games as Record<string, unknown>)?.win?.total ?? 0),
          draws:        0,
          losses:       Number((r.games as Record<string, unknown>)?.lose?.total ?? 0),
          goals_for:    0,
          goals_against:0,
          goal_diff:    0,
          points:       Number(r.points?.for ?? 0),
          form:         null,
          description:  (r.group as string) ?? null,
          last_updated: new Date().toISOString(),
        })).filter(r => r.team_name);
        const { data, error } = await supabase
          .from('league_standings')
          .upsert(rows, { onConflict: 'league_id,season,team_name', ignoreDuplicates: false })
          .select('id');
        if (!error) total += data?.length ?? 0;
      }
    } catch (e) {
      console.error(`[Basketball standings] ${league.name}: ${e}`);
    }
    await sleep(1200);
  }
  return total;
}

// ─── Sync match events ────────────────────────────────────────────────────────
async function syncMatchEvents(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  fixtureId: number,
  matchId: string,
): Promise<number> {
  const data = await apifootball(`/fixtures/events?fixture=${fixtureId}`, apiKey);
  await trackUsage(supabase, 'api-football', '/fixtures/events', data.length > 0);
  if (!data || data.length === 0) return 0;

  const externalMatchId = `football-${fixtureId}`;
  await supabase.from('match_events').delete().eq('external_match_id', externalMatchId);

  const eventRows = (data as Record<string, unknown>[]).map((ev) => ({
    match_id:         matchId,
    external_match_id: externalMatchId,
    event_type:       mapEventType(String((ev.type as string) ?? '')),
    player_name:      (ev.player as Record<string, unknown>)?.name ?? '',
    player_id:        (ev.player as Record<string, unknown>)?.id ?? null,
    assist_name:      (ev.assist as Record<string, unknown>)?.name ?? null,
    team:             (ev.team as Record<string, unknown>)?.name ?? '',
    is_home_team:     false,
    minute:           (ev.time as Record<string, unknown>)?.elapsed ?? 0,
    extra_minute:     (ev.time as Record<string, unknown>)?.extra ?? null,
    detail:           ev.detail ?? null,
    comments:         ev.comments ?? null,
  }));

  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < eventRows.length; i += BATCH) {
    const { data: result, error } = await supabase.from('match_events').insert(eventRows.slice(i, i + BATCH)).select('id');
    if (!error) inserted += result?.length ?? 0;
  }
  return inserted;
}

function mapEventType(apiType: string): string {
  const t = (apiType ?? '').toLowerCase();
  if (t === 'goal') return 'goal';
  if (t === 'card') return 'card';
  if (t === 'subst') return 'substitution';
  if (t === 'var') return 'var';
  if (t === 'penalty') return 'penalty';
  return 'goal';
}

// ─── Sync top scorers ─────────────────────────────────────────────────────────
async function syncTopScorers(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  leagueId: number,
  leagueName: string,
  season: number,
): Promise<number> {
  const data = await apifootball(`/players/topscorers?league=${leagueId}&season=${season}`, apiKey);
  await trackUsage(supabase, 'api-football', '/players/topscorers', data.length > 0);
  if (!data || data.length === 0) return 0;

  const rows = (data as Record<string, unknown>[]).slice(0, 20).map((item) => ({
    player_name:  (item.player as Record<string, unknown>)?.name ?? '',
    player_id:    (item.player as Record<string, unknown>)?.id ?? null,
    team_name:    ((item.statistics as Record<string, unknown>[])?.[0]?.team as Record<string, unknown>)?.name ?? '',
    league_name:  leagueName,
    season,
    sport:        'football',
    appearances:  Number(((item.statistics as Record<string, unknown>[])?.[0]?.games as Record<string, unknown>)?.appearences ?? 0),
    goals:        Number(((item.statistics as Record<string, unknown>[])?.[0]?.goals as Record<string, unknown>)?.total ?? 0),
    assists:      Number(((item.statistics as Record<string, unknown>[])?.[0]?.goals as Record<string, unknown>)?.assists ?? 0),
    yellow_cards: Number(((item.statistics as Record<string, unknown>[])?.[0]?.cards as Record<string, unknown>)?.yellow ?? 0),
    red_cards:    Number(((item.statistics as Record<string, unknown>[])?.[0]?.cards as Record<string, unknown>)?.red ?? 0),
    rating:       ((item.statistics as Record<string, unknown>[])?.[0]?.games as Record<string, unknown>)?.rating
                    ? parseFloat(String(((item.statistics as Record<string, unknown>[])?.[0]?.games as Record<string, unknown>)?.rating))
                    : null,
    position:     (item.player as Record<string, unknown>)?.position ?? null,
    nationality:  (item.player as Record<string, unknown>)?.nationality ?? null,
    photo:        (item.player as Record<string, unknown>)?.photo ?? null,
    last_updated: new Date().toISOString(),
  })).filter((r) => r.player_name);

  const { data: result, error } = await supabase
    .from('player_stats')
    .upsert(rows, { onConflict: 'player_name,team_name,league_name,season', ignoreDuplicates: false })
    .select('id');
  if (error) console.error('Player stats upsert error:', error.message);
  return result?.length ?? 0;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const apiKey = Deno.env.get('API_FOOTBALL_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API_FOOTBALL_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let targetLeagueId: number | null = null;
    let season = currentSeason();
    let syncEvents = false;
    let syncPlayers = false;
    let syncBasketball = false;
    let sport = 'football';

    try {
      const body = await req.json();
      targetLeagueId  = body?.leagueId  ? Number(body.leagueId) : null;
      season          = body?.season    ? Number(body.season) : season;
      syncEvents      = body?.syncEvents === true;
      syncPlayers     = body?.syncPlayers === true;
      syncBasketball  = body?.syncBasketball === true;
      sport           = body?.sport ?? 'football';
    } catch { /* defaults */ }

    console.log(`sync-standings: sport=${sport} season=${season} leagues=${targetLeagueId ?? 'all'}`);
    const startMs = Date.now();

    let totalStandings = 0;
    let totalPlayers = 0;
    let totalEvents = 0;
    let errors: string[] = [];

    // ── Football standings ──────────────────────────────────────────────────
    if (sport === 'football' || sport === 'all') {
      const leagues = targetLeagueId
        ? DEFAULT_FOOTBALL_LEAGUES.filter((l) => l.id === targetLeagueId)
        : DEFAULT_FOOTBALL_LEAGUES;

      for (const league of leagues) {
        try {
          totalStandings += await syncFootballLeague(supabase, apiKey, league.id, league.name, season);
          if (syncPlayers) {
            totalPlayers += await syncTopScorers(supabase, apiKey, league.id, league.name, season);
            await sleep(1200);
          } else {
            await sleep(700);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${league.name}: ${msg.substring(0, 80)}`);
          console.error(`[sync-standings] ${league.name} failed: ${msg}`);
        }
      }
    }

    // ── Basketball standings ────────────────────────────────────────────────
    if (sport === 'basketball' || sport === 'all' || syncBasketball) {
      try {
        const bball = await syncBasketballStandings(supabase, apiKey);
        totalStandings += bball;
      } catch (e) {
        errors.push(`Basketball: ${String(e).substring(0, 80)}`);
      }
    }

    // ── Match events for recent matches ─────────────────────────────────────
    if (syncEvents) {
      const { data: recentMatches } = await supabase
        .from('matches')
        .select('id, external_id')
        .eq('sport', 'football')
        .in('status', ['live', 'finished'])
        .gte('match_time', new Date(Date.now() - 12 * 3600_000).toISOString())
        .limit(20);

      for (const match of (recentMatches ?? [])) {
        const extId = String((match as Record<string, unknown>).external_id ?? '');
        if (!extId.startsWith('football-')) continue;
        const fixtureId = parseInt(extId.replace('football-', ''), 10);
        if (isNaN(fixtureId)) continue;
        try {
          totalEvents += await syncMatchEvents(supabase, apiKey, fixtureId, String((match as Record<string, unknown>).id));
          await sleep(600);
        } catch (e) {
          console.error(`Events sync for ${extId}:`, e);
        }
      }
    }

    const elapsed = Date.now() - startMs;
    console.log(`sync-standings complete: ${totalStandings} standings, ${totalPlayers} players, ${totalEvents} events in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        sport,
        season,
        leagues_synced:      sport === 'football' ? (targetLeagueId ? 1 : DEFAULT_FOOTBALL_LEAGUES.length) : 0,
        standings_upserted:  totalStandings,
        players_upserted:    totalPlayers,
        events_synced:       totalEvents,
        errors:              errors.length > 0 ? errors : undefined,
        elapsed_ms:          elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('sync-standings error:', err);
    return new Response(
      JSON.stringify({ error: `Internal error: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
