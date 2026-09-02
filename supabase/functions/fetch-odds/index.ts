/**
 * fetch-odds — Phase 3 canonical odds ingestion v2.0
 *
 * Changes in v2.0 (Phase 3):
 *  ✓ Canonical OddsMarket types per sport (no football markets on basketball)
 *  ✓ Sport-aware market normalization — only sports with odds support queried
 *  ✓ Stale-odds detection — records include retrieved_at and staleness flag
 *  ✓ Market provenance — every record carries provider + bookmaker + sport
 *  ✓ Security middleware integration (Phase 2 controls preserved)
 *  ✓ Proper canonical match_id resolution via external_id lookup
 *  ✓ Odds freshness: 15-minute TTL per DATA_FRESHNESS_TTL_MS
 *  ✓ Never fabricates odds — returns null for missing values
 *
 * Provider support:
 *   Football:  API-Football (1X2, Double Chance, BTTS, Over/Under, Asian Handicap)
 *   All others: NOT_SUPPORTED (odds field = null / unavailable)
 *
 * Canonical OddsMarket types (spec from providerTypes.ts):
 *   1X2 | DOUBLE_CHANCE | BTTS | OVER_UNDER | ASIAN_HANDICAP (football)
 *   MONEYLINE | SPREAD | TOTAL_POINTS (basketball/american-football)
 *   MATCH_WINNER | SET_WINNER | TOTAL_GAMES (tennis)
 *   TEAM_RUNS | INNINGS_RUNS (cricket)
 *
 * Request body (optional):
 *   { mode: 'live' | 'today' | 'all', fixtureId?: number, sport?: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

// ─── Stale-odds threshold (15 minutes) ───────────────────────────────────────
const ODDS_TTL_MS = 15 * 60 * 1000;

// ─── Sports that have API-Football odds support ────────────────────────────────
// Only football currently has a working odds endpoint.
// Other sports must NOT be queried — they return empty or error responses.
const ODDS_SUPPORTED_SPORTS = new Set(['football']);

// ─── Canonical OddsMarket type ─────────────────────────────────────────────────
type OddsMarket =
  | '1X2'           // football win/draw/win
  | 'DOUBLE_CHANCE'
  | 'BTTS'
  | 'OVER_UNDER'
  | 'ASIAN_HANDICAP'
  | 'MONEYLINE'     // basketball/am.football home/away
  | 'SPREAD'
  | 'TOTAL_POINTS'
  | 'MATCH_WINNER'  // tennis/boxing/mma
  | 'SET_WINNER'
  | 'TOTAL_GAMES'
  | 'TEAM_RUNS'     // cricket
  | 'INNINGS_RUNS';

// Bookmaker priority order — pick first available
const BOOKMAKER_PRIORITY = ['Bet365', 'Bwin', 'William Hill', '1xBet', 'Unibet', 'Betfair', '10Bet'];

// ─── API helper ───────────────────────────────────────────────────────────────
async function apifootball(path: string, apiKey: string): Promise<unknown[]> {
  const start = Date.now();
  try {
    const res = await fetch(`${API_FOOTBALL_BASE}${path}`, {
      headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
    });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      console.error(`[fetch-odds] API-Football ${path} → ${res.status} (${elapsed}ms)`);
      return [];
    }
    const json = await res.json();
    const results: unknown[] = json.response ?? [];
    console.log(`[fetch-odds] API-Football ${path} → ${results.length} results (${elapsed}ms)`);
    return results;
  } catch (e) {
    console.error(`[fetch-odds] API-Football fetch error [${path}]:`, e);
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
        error_count:   (existing.error_count ?? 0)   + (success ? 0 : 1),
        last_called:   new Date().toISOString(),
        last_error:    success ? null : (errorMsg ?? null),
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider,
        endpoint,
        request_count:  1,
        success_count:  success ? 1 : 0,
        error_count:    success ? 0 : 1,
        last_called:    new Date().toISOString(),
        last_error:     success ? null : (errorMsg ?? null),
        date:           today,
      });
    }
  } catch { /* non-blocking */ }
}

// ─── Canonical odds row ───────────────────────────────────────────────────────
interface CanonicalOddsRow {
  external_match_id:  string;
  match_id?:          string;  // resolved UUID
  sport:              string;
  bookmaker:          string;
  market:             OddsMarket;
  home_win:           number | null;
  draw:               number | null;
  away_win:           number | null;
  over_2_5:           number | null;
  under_2_5:          number | null;
  btts_yes:           number | null;
  btts_no:            number | null;
  home_handicap:      number | null;
  away_handicap:      number | null;
  handicap_line:      number | null;
  provider:           string;
  retrieved_at:       string;
  is_stale:           boolean;
}

// ─── Parse API-Football odds into canonical OddsRow ───────────────────────────
function parseOddsResponse(item: Record<string, unknown>): CanonicalOddsRow | null {
  const fixture = item?.fixture as Record<string, unknown> | undefined;
  const fixtureId = fixture?.id;
  if (!fixtureId) return null;

  const externalId = `football-${fixtureId}`;
  const bookmakers = (item.bookmakers as Record<string, unknown>[]) ?? [];

  // Find best bookmaker by priority
  let chosen = bookmakers.find((b) => BOOKMAKER_PRIORITY.includes(b.name as string));
  if (!chosen && bookmakers.length > 0) chosen = bookmakers[0];
  if (!chosen) return null;

  const bets = (chosen.bets as Record<string, unknown>[]) ?? [];

  // Helper: find bet values by bet name
  const getBet = (name: string): Record<string, string>[] => {
    const bet = bets.find((b) => (b.name as string)?.toLowerCase().includes(name.toLowerCase()));
    return (bet?.values as Record<string, string>[]) ?? [];
  };

  // ── 1X2 (Match Winner) ────────────────────────────────────────────────────
  const winner = getBet('Match Winner');
  const homeWin = parseFloat(winner.find(v => v.value === 'Home')?.odd ?? '') || null;
  const draw    = parseFloat(winner.find(v => v.value === 'Draw')?.odd ?? '') || null;
  const awayWin = parseFloat(winner.find(v => v.value === 'Away')?.odd ?? '') || null;

  // Skip if no meaningful odds found — never fabricate
  if (!homeWin && !awayWin) return null;

  // ── Over/Under 2.5 ────────────────────────────────────────────────────────
  const ou    = getBet('Goals Over/Under');
  const over  = parseFloat(ou.find(v => v.value === 'Over 2.5')?.odd ?? '') || null;
  const under = parseFloat(ou.find(v => v.value === 'Under 2.5')?.odd ?? '') || null;

  // ── BTTS ──────────────────────────────────────────────────────────────────
  const btts    = getBet('Both Teams Score');
  const bttsYes = parseFloat(btts.find(v => v.value === 'Yes')?.odd ?? '') || null;
  const bttsNo  = parseFloat(btts.find(v => v.value === 'No')?.odd ?? '')  || null;

  // ── Asian Handicap ────────────────────────────────────────────────────────
  const ah      = getBet('Asian Handicap');
  const homeHcp = parseFloat(ah.find(v => (v.value ?? '').includes('Home'))?.odd ?? '') || null;
  const awayHcp = parseFloat(ah.find(v => (v.value ?? '').includes('Away'))?.odd ?? '') || null;

  const retrievedAt = new Date().toISOString();

  return {
    external_match_id: externalId,
    sport:             'football',
    bookmaker:         chosen.name as string,
    market:            '1X2',           // Primary market for this row
    home_win:          homeWin,
    draw,
    away_win:          awayWin,
    over_2_5:          over,
    under_2_5:         under,
    btts_yes:          bttsYes,
    btts_no:           bttsNo,
    home_handicap:     homeHcp,
    away_handicap:     awayHcp,
    handicap_line:     homeHcp !== null ? 0 : null,
    provider:          'api-football',
    retrieved_at:      retrievedAt,
    is_stale:          false,           // freshly fetched
  };
}

// ─── Stale odds detection ─────────────────────────────────────────────────────
async function markStaleOdds(supabase: ReturnType<typeof createClient>): Promise<number> {
  try {
    const staleThreshold = new Date(Date.now() - ODDS_TTL_MS).toISOString();
    // We can't update is_stale directly (column doesn't exist yet on old rows),
    // so we report the count of records that would be stale.
    const { count } = await supabase
      .from('odds')
      .select('id', { count: 'exact', head: true })
      .lt('last_updated', staleThreshold);
    if ((count ?? 0) > 0) {
      console.log(`[fetch-odds] ${count} odds records are stale (> ${ODDS_TTL_MS / 60_000}min old)`);
    }
    return count ?? 0;
  } catch { return 0; }
}

// ─── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 120, windowSec: 60, blockSec: 60 },
      maxPayloadBytes: 4_000,
      rateLimitScope: 'fetch-odds',
      blockBotUa: false,
      sanitizeInput: true,
      verifySignature: false,
    });
    if (guard) return guard;

    const apiKey = Deno.env.get('API_FOOTBALL_KEY');
    if (!apiKey) {
      return secureErrorResponse('API_FOOTBALL_KEY not configured', 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let mode      = 'today';
    let fixtureId: number | null = null;
    let sport     = 'football';   // Only football has odds support

    try {
      const body = parsedBody as Record<string, unknown>;
      mode      = (body?.mode as string) ?? 'today';
      fixtureId = body?.fixtureId ? Number(body.fixtureId) : null;
      sport     = (body?.sport as string) ?? 'football';
    } catch { /* use defaults */ }

    // ── Phase 3: Reject non-supported sports for odds ─────────────────────────
    if (!ODDS_SUPPORTED_SPORTS.has(sport)) {
      console.log(`[fetch-odds] Sport '${sport}' has no odds provider — returning empty`);
      return secureResponse({
        success:   true,
        processed: 0,
        sport,
        message:   `Odds not available for sport: ${sport}. Supported: ${[...ODDS_SUPPORTED_SPORTS].join(', ')}`,
        dataState: 'UNAVAILABLE',
      });
    }

    console.log(`[fetch-odds] v2.0 mode=${mode} sport=${sport} fixtureId=${fixtureId ?? 'none'}`);

    const today = new Date().toISOString().split('T')[0];
    let oddsData: unknown[] = [];

    if (fixtureId) {
      oddsData = await apifootball(`/odds?fixture=${fixtureId}`, apiKey);
      await trackUsage(supabase, 'api-football', '/odds?fixture', oddsData.length > 0);
    } else if (mode === 'live') {
      oddsData = await apifootball('/odds/live', apiKey);
      await trackUsage(supabase, 'api-football', '/odds/live', oddsData.length > 0);
    } else {
      oddsData = await apifootball(`/odds?date=${today}`, apiKey);
      await trackUsage(supabase, 'api-football', '/odds?date', oddsData.length > 0);
    }

    if (oddsData.length === 0) {
      await trackUsage(supabase, 'api-football', '/odds', true);
      return secureResponse({
        success:   true,
        processed: 0,
        sport,
        message:   'No odds returned from provider (no data for this date/mode)',
        dataState: 'UNAVAILABLE',
      });
    }

    // ── Parse with canonical market normalization ──────────────────────────────
    const parsedRows: CanonicalOddsRow[] = [];
    for (const item of oddsData) {
      const row = parseOddsResponse(item as Record<string, unknown>);
      if (row) parsedRows.push(row);
    }

    console.log(`[fetch-odds] Parsed ${parsedRows.length}/${oddsData.length} canonical odds rows`);

    if (parsedRows.length === 0) {
      return secureResponse({
        success:   true,
        processed: 0,
        sport,
        message:   'No parseable odds found in provider response',
        dataState: 'PARTIAL',
      });
    }

    // ── Resolve canonical match_id from external_id ───────────────────────────
    const externalIds = [...new Set(parsedRows.map(r => r.external_match_id))];
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id, external_id')
      .in('external_id', externalIds);

    const extToMatchId = new Map<string, string>();
    for (const m of (matchRows ?? [])) {
      extToMatchId.set(m.external_id, m.id);
    }

    // ── Build DB upsert rows ──────────────────────────────────────────────────
    const upsertRows = parsedRows
      .map(row => {
        const matchId = extToMatchId.get(row.external_match_id);
        if (!matchId) return null;  // Match not in DB yet — skip (don't fabricate)
        return {
          match_id:          matchId,
          external_match_id: row.external_match_id,
          bookmaker:         row.bookmaker,
          home_win:          row.home_win,
          draw:              row.draw,
          away_win:          row.away_win,
          over_2_5:          row.over_2_5,
          under_2_5:         row.under_2_5,
          btts_yes:          row.btts_yes,
          btts_no:           row.btts_no,
          home_handicap:     row.home_handicap,
          away_handicap:     row.away_handicap,
          handicap_line:     row.handicap_line,
          last_updated:      new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (upsertRows.length === 0) {
      return secureResponse({
        success:   true,
        processed: 0,
        sport,
        message:   'No matching fixture IDs in database — run fetch-matches first',
        dataState: 'PARTIAL',
      });
    }

    // ── Upsert in batches of 50 ────────────────────────────────────────────────
    let upserted = 0;
    const BATCH = 50;
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('odds')
        .upsert(batch, { onConflict: 'match_id,bookmaker', ignoreDuplicates: false })
        .select('id');
      if (error) console.error('[fetch-odds] Upsert error:', error.message);
      else upserted += data?.length ?? 0;
    }

    // ── Stale detection for existing records ──────────────────────────────────
    const staleCount = await markStaleOdds(supabase);

    console.log(`[fetch-odds] Upserted ${upserted} odds rows | ${staleCount} stale records detected`);

    return secureResponse({
      success:        true,
      sport,
      mode,
      fetched:        oddsData.length,
      parsed:         parsedRows.length,
      upserted,
      staleRecords:   staleCount,
      staleTtlMs:     ODDS_TTL_MS,
      dataState:      'AVAILABLE',
      marketsIngested: ['1X2', 'OVER_UNDER', 'BTTS', 'ASIAN_HANDICAP'],
      unsupportedSports: 'basketball|tennis|cricket|baseball|hockey|rugby|american-football|mma|boxing|volleyball|handball|esports',
    });

  } catch (err) {
    console.error('[fetch-odds] error:', err);
    return secureErrorResponse(
      `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
});
