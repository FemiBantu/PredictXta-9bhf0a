/**
 * fetch-odds — Fetches live and pre-match betting odds from API-Football
 * and upserts them into the `odds` table.
 *
 * Supported: Football (API-Football odds endpoint)
 * Rate-limit friendly: designed to run every 2–5 minutes for live matches,
 * every 30 min for upcoming fixtures.
 *
 * Request body (optional):
 * { mode: 'live' | 'today' | 'all', fixtureId?: number }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

// Bookmaker priority order — we pick the first available
const BOOKMAKER_PRIORITY = ['Bet365', 'Bwin', 'William Hill', '1xBet', 'Unibet', 'Betfair', '10Bet'];

// ─── API helper ────────────────────────────────────────────────────────────────
async function apifootball(path: string, apiKey: string): Promise<any[]> {
  const start = Date.now();
  try {
    const res = await fetch(`${API_FOOTBALL_BASE}${path}`, {
      headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
    });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      console.error(`API-Football odds ${path} → ${res.status} (${elapsed}ms)`);
      return [];
    }
    const json = await res.json();
    console.log(`API-Football odds ${path} → ${(json.response ?? []).length} results (${elapsed}ms)`);
    return json.response ?? [];
  } catch (e) {
    console.error(`API-Football odds fetch error [${path}]:`, e);
    return [];
  }
}

// ─── Track API usage ───────────────────────────────────────────────────────────
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
        error_count: (existing.error_count ?? 0) + (success ? 0 : 1),
        last_called: new Date().toISOString(),
        last_error: success ? null : (errorMsg ?? null),
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider,
        endpoint,
        request_count: 1,
        success_count: success ? 1 : 0,
        error_count: success ? 0 : 1,
        last_called: new Date().toISOString(),
        last_error: success ? null : (errorMsg ?? null),
        date: today,
      });
    }
  } catch { /* non-blocking */ }
}

// ─── Parse API-Football odds response ─────────────────────────────────────────
interface OddsRow {
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

function parseOddsResponse(item: any): OddsRow | null {
  const fixtureId = item?.fixture?.id;
  if (!fixtureId) return null;

  const externalId = `football-${fixtureId}`;
  const bookmakers: any[] = item.bookmakers ?? [];

  // Find best bookmaker by priority
  let chosen = bookmakers.find((b) => BOOKMAKER_PRIORITY.includes(b.name));
  if (!chosen && bookmakers.length > 0) chosen = bookmakers[0];
  if (!chosen) return null;

  const bets: any[] = chosen.bets ?? [];

  // Helper: find bet values by name
  const getBet = (name: string): any[] => {
    const bet = bets.find((b) => b.name?.toLowerCase().includes(name.toLowerCase()));
    return bet?.values ?? [];
  };

  // Match Winner (1X2)
  const winner = getBet('Match Winner');
  const homeWin = parseFloat(winner.find((v: any) => v.value === 'Home')?.odd ?? '') || null;
  const draw = parseFloat(winner.find((v: any) => v.value === 'Draw')?.odd ?? '') || null;
  const awayWin = parseFloat(winner.find((v: any) => v.value === 'Away')?.odd ?? '') || null;

  // Over/Under 2.5
  const ou = getBet('Goals Over/Under');
  const over25 = parseFloat(ou.find((v: any) => v.value === 'Over 2.5')?.odd ?? '') || null;
  const under25 = parseFloat(ou.find((v: any) => v.value === 'Under 2.5')?.odd ?? '') || null;

  // BTTS
  const btts = getBet('Both Teams Score');
  const bttsYes = parseFloat(btts.find((v: any) => v.value === 'Yes')?.odd ?? '') || null;
  const bttsNo = parseFloat(btts.find((v: any) => v.value === 'No')?.odd ?? '') || null;

  // Asian Handicap (optional)
  const ah = getBet('Asian Handicap');
  const homeHcp = parseFloat(ah.find((v: any) => v.value?.includes('Home'))?.odd ?? '') || null;
  const awayHcp = parseFloat(ah.find((v: any) => v.value?.includes('Away'))?.odd ?? '') || null;

  // Skip if no meaningful odds found
  if (!homeWin && !awayWin) return null;

  return {
    external_match_id: externalId,
    bookmaker: chosen.name,
    home_win: homeWin,
    draw,
    away_win: awayWin,
    over_2_5: over25,
    under_2_5: under25,
    btts_yes: bttsYes,
    btts_no: bttsNo,
    home_handicap: homeHcp,
    away_handicap: awayHcp,
    handicap_line: homeHcp ? 0 : null,
  };
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

    let mode = 'today';
    let fixtureId: number | null = null;
    try {
      const body = await req.json();
      mode = body?.mode ?? 'today';
      fixtureId = body?.fixtureId ? Number(body.fixtureId) : null;
    } catch { /* use defaults */ }

    console.log(`fetch-odds: mode=${mode}, fixtureId=${fixtureId ?? 'none'}`);

    const today = new Date().toISOString().split('T')[0];
    let oddsData: any[] = [];

    if (fixtureId) {
      // Fetch odds for a specific fixture
      oddsData = await apifootball(`/odds?fixture=${fixtureId}`, apiKey);
      await trackUsage(supabase, 'api-football', '/odds?fixture', oddsData.length > 0, oddsData.length === 0 ? 'No odds returned' : undefined);
    } else if (mode === 'live') {
      // Live odds only
      oddsData = await apifootball(`/odds/live`, apiKey);
      await trackUsage(supabase, 'api-football', '/odds/live', oddsData.length > 0, oddsData.length === 0 ? 'No live odds' : undefined);
    } else {
      // Today's odds (pre-match + in-play)
      oddsData = await apifootball(`/odds?date=${today}`, apiKey);
      await trackUsage(supabase, 'api-football', '/odds?date', oddsData.length > 0, oddsData.length === 0 ? 'No odds for today' : undefined);
    }

    if (oddsData.length === 0) {
      // Empty result is not an error — API is reachable but no odds for this date
      await trackUsage(supabase, 'api-football', '/odds', true);
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No odds returned from API (no data for this date)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse all odds rows
    const parsedRows: OddsRow[] = [];
    for (const item of oddsData) {
      const row = parseOddsResponse(item);
      if (row) parsedRows.push(row);
    }

    console.log(`Parsed ${parsedRows.length}/${oddsData.length} odds rows`);

    if (parsedRows.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No parseable odds found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve match_id from external_id → id mapping
    const externalIds = [...new Set(parsedRows.map((r) => r.external_match_id))];
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id, external_id')
      .in('external_id', externalIds);

    const extToMatchId = new Map<string, string>();
    for (const m of (matchRows ?? [])) {
      extToMatchId.set(m.external_id, m.id);
    }

    // Build upsert rows with resolved match_id
    const upsertRows = parsedRows
      .map((row) => {
        const matchId = extToMatchId.get(row.external_match_id);
        if (!matchId) return null;
        return {
          ...row,
          match_id: matchId,
          last_updated: new Date().toISOString(),
        };
      })
      .filter(Boolean) as any[];

    if (upsertRows.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No matching fixture IDs in database' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert in batches of 50
    let upserted = 0;
    const BATCH = 50;
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('odds')
        .upsert(batch, { onConflict: 'match_id,bookmaker', ignoreDuplicates: false })
        .select('id');
      if (error) console.error('Odds upsert error:', error.message);
      else upserted += data?.length ?? 0;
    }

    console.log(`Upserted ${upserted} odds rows`);

    return new Response(
      JSON.stringify({ success: true, fetched: oddsData.length, parsed: parsedRows.length, upserted, mode }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    await trackUsage(supabase, 'api-football', '/odds', false, String(err));
    console.error('fetch-odds error:', err);
    return new Response(
      JSON.stringify({ error: `Internal error: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
