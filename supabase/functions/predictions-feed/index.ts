/**
 * predictions-feed/index.ts
 *
 * Mobile-optimised predictions feed API for the PredictXta app screens.
 *
 * GET /functions/v1/predictions-feed
 *
 * Query params:
 *   sport       — football|basketball|tennis|…|all (default: all)
 *   status      — upcoming|live|finished|all       (default: all)
 *   date        — YYYY-MM-DD, or offsets: today|yesterday|tomorrow (default: today)
 *   page        — 1-based page number              (default: 1)
 *   limit       — items per page, max 50           (default: 20)
 *   sort        — confidence|time|value            (default: time)
 *   min_conf    — minimum confidence filter 0-100  (default: 0)
 *   result      — home_win|draw|away_win|all       (default: all)
 *   ou          — over|under|all                   (default: all)
 *   btts        — yes|no|all                       (default: all)
 *   league      — exact league name filter         (optional)
 *   country     — exact country name filter        (optional)
 *   is_vip      — true|false                       (default: false)
 *   include_outcome — true|false (attach resolved outcome badge) (default: true)
 *
 * Returns a compact, denormalised payload — each item has match + prediction
 * merged into a single flat object to minimise network round trips and
 * avoid N+1 joins on the client.
 *
 * Response shape:
 * {
 *   items: PredictionFeedItem[],
 *   pagination: { page, limit, total, hasNext, hasPrev },
 *   meta: { generatedAt, sport, status, date, sort, liveCount, predictedCount, outcomeStats }
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  secureHeaders,
  secureResponse,
  secureErrorResponse,
  applySecurityMiddleware,
} from '../_shared/security.ts';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PredictionFeedItem {
  // Match fields
  matchId:       string;
  sport:         string;
  homeTeam:      string;
  awayTeam:      string;
  homeLogo:      string | null;
  awayLogo:      string | null;
  leagueLogo:    string | null;
  league:        string;
  country:       string;
  status:        'upcoming' | 'live' | 'finished';
  matchTime:     string;
  minute:        number;
  homeScore:     number;
  awayScore:     number;
  homeForm:      string[];
  awayForm:      string[];
  round:         string | null;
  // Prediction fields
  predictionId:         string | null;
  hasPrediction:        boolean;
  homeWinProb:          number | null;
  drawProb:             number | null;
  awayWinProb:          number | null;
  predictedResult:      string | null;
  confidence:           number | null;
  overUnder:            string | null;
  overUnderLine:        number | null;
  btts:                 string | null;
  correctScore:         string | null;
  predictedHomeGoals:   number | null;
  predictedAwayGoals:   number | null;
  cornersOverUnder:     string | null;
  cornersLine:          number | null;
  cardsTotal:           number | null;
  cardsOverUnder:       string | null;
  asianHandicapLine:    number | null;
  asianHandicapPick:    string | null;
  htResult:             string | null;
  firstGoal:            string | null;
  keyFactors:           string[];
  aiAnalysis:           string | null;
  // VIP fields (null when is_vip = false)
  riskLevel:            string | null;
  valueScore:           number | null;
  marketEdgePct:        number | null;
  sharpSignal:          string | null;
  suggestedStake:       string | null;
  warningFlags:         string[];
  keyAlphaMetric:       string | null;
  // Outcome badge (when include_outcome=true and match is finished)
  outcomeResolved:      boolean;
  outcomeCorrect:       boolean | null;
  brierScore:           number | null;
  // Odds (best available)
  homeOdds:     number | null;
  drawOdds:     number | null;
  awayOdds:     number | null;
  bookmaker:    string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDate(raw: string | null): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const offsets: Record<string, number> = {
    today: 0, yesterday: -1, tomorrow: 1,
  };

  if (raw && raw in offsets) {
    const d = new Date(today);
    d.setDate(d.getDate() + offsets[raw]);
    return {
      start: d.toISOString(),
      end:   new Date(d.getTime() + 86_400_000).toISOString(),
    };
  }

  // Numeric offset (-3…+7)
  if (raw && /^-?\d+$/.test(raw)) {
    const offset = parseInt(raw, 10);
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return {
      start: d.toISOString(),
      end:   new Date(d.getTime() + 86_400_000).toISOString(),
    };
  }

  // YYYY-MM-DD
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + 'T00:00:00.000Z');
    return {
      start: d.toISOString(),
      end:   new Date(d.getTime() + 86_400_000).toISOString(),
    };
  }

  // Default: today
  return {
    start: today.toISOString(),
    end:   new Date(today.getTime() + 86_400_000).toISOString(),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    // Accept both GET (query string) and POST (body) for supabase.functions.invoke compatibility
    if (req.method !== 'GET' && req.method !== 'POST') return secureErrorResponse('Method not allowed', 405);

    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit:      { max: 120, windowSec: 60, blockSec: 30 },
      maxPayloadBytes: 4_096,
      rateLimitScope: 'predictions-feed',
      blockBotUa:      false,
      sanitizeInput:   false,
      verifySignature: false,
    });
    if (guard) return guard;

    const url = new URL(req.url);
    const bodyParams = (parsedBody as Record<string, unknown>) ?? {};
    // Helper: read from URL query string first, fall back to POST body
    const q = (k: string, def = '') => {
      const fromUrl = url.searchParams.get(k);
      if (fromUrl !== null) return fromUrl.trim().toLowerCase();
      const fromBody = bodyParams[k];
      if (fromBody !== undefined) return String(fromBody).trim().toLowerCase();
      return def;
    };
    const qRaw = (k: string, def: string | null = null): string | null => {
      const fromUrl = url.searchParams.get(k);
      if (fromUrl !== null) return fromUrl;
      const fromBody = bodyParams[k];
      if (fromBody !== undefined) return String(fromBody);
      return def;
    };

    // ── Parse query params ────────────────────────────────────────────────────
    const sport          = q('sport', 'all');
    const statusFilter   = q('status', 'all');
    const dateParam      = qRaw('date') ?? 'today';
    const page           = clamp(parseInt(qRaw('page') ?? '1', 10), 1, 200);
    const limit          = clamp(parseInt(qRaw('limit') ?? '20', 10), 1, 50);
    const sort           = q('sort', 'time');        // time|confidence|value
    const minConf        = clamp(parseInt(qRaw('min_conf') ?? '0', 10), 0, 100);
    const resultFilter   = q('result', 'all');       // home_win|draw|away_win|all
    const ouFilter       = q('ou', 'all');           // over|under|all
    const bttsFilter     = q('btts', 'all');         // yes|no|all
    const leagueFilter   = qRaw('league') ?? null;
    const countryFilter  = qRaw('country') ?? null;
    const isVip          = q('is_vip', 'false') === 'true';
    const includeOutcome = q('include_outcome', 'true') !== 'false';
    const offset         = (page - 1) * limit;

    const { start: dateStart, end: dateEnd } = parseDate(dateParam);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Build matches query ───────────────────────────────────────────────────
    let matchQ = supabase
      .from('matches')
      .select('id,sport,home_team,away_team,home_logo,away_logo,league_logo,league,country,status,match_time,home_score,away_score,minute,home_form,away_form,round', { count: 'exact' })
      .gte('match_time', dateStart)
      .lt('match_time', dateEnd);

    if (sport !== 'all')         matchQ = matchQ.eq('sport', sport);
    if (statusFilter !== 'all')  matchQ = matchQ.eq('status', statusFilter);
    if (leagueFilter)            matchQ = matchQ.ilike('league', `%${leagueFilter}%`);
    if (countryFilter)           matchQ = matchQ.ilike('country', `%${countryFilter}%`);

    // Sort order for matches
    if (sort === 'time' || sort === 'confidence' || sort === 'value') {
      // Live first, then by match_time
      matchQ = matchQ.order('status', { ascending: false }); // live > upcoming > finished
      matchQ = matchQ.order('match_time', { ascending: true });
    }

    const { data: matches, count: totalMatches, error: matchErr } = await matchQ;
    if (matchErr) return secureErrorResponse(`Matches query failed: ${matchErr.message}`, 500);

    const allMatches = (matches ?? []) as Record<string, unknown>[];
    if (allMatches.length === 0) {
      return secureResponse({
        items:      [],
        pagination: { page, limit, total: 0, hasNext: false, hasPrev: page > 1 },
        meta: {
          generatedAt:    new Date().toISOString(),
          sport, status: statusFilter, date: dateParam, sort,
          liveCount: 0, predictedCount: 0,
          outcomeStats:   { total: 0, correct: 0, accuracy_pct: 0 },
        },
      });
    }

    const matchIds = allMatches.map((m) => m.id as string);

    // ── Fetch predictions for these matches (batch) ───────────────────────────
    const { data: predRows } = await supabase
      .from('predictions')
      .select(`
        id,match_id,
        home_win_prob,draw_prob,away_win_prob,
        predicted_result,confidence,
        over_under,over_under_line,
        predicted_home_goals,predicted_away_goals,
        btts,correct_score,
        corners_over_under,corners_line,
        cards_total,cards_over_under,
        asian_handicap_line,asian_handicap_pick,
        ht_result,first_goal,
        ai_analysis,key_factors,
        risk_level,value_score,market_edge_pct,
        sharp_signal,suggested_stake,warning_flags,key_alpha_metric,
        created_at
      `)
      .in('match_id', matchIds)
      .order('created_at', { ascending: false });

    // Keep only the latest prediction per match
    const predByMatchId = new Map<string, Record<string, unknown>>();
    for (const p of ((predRows ?? []) as Record<string, unknown>[])) {
      const mid = p.match_id as string;
      if (!predByMatchId.has(mid)) predByMatchId.set(mid, p);
    }

    // ── Fetch outcomes for finished matches (batch, optional) ─────────────────
    const outcomeByMatchId = new Map<string, { is_correct: boolean; brier_score: number }>();
    if (includeOutcome) {
      const finishedIds = allMatches
        .filter((m) => m.status === 'finished')
        .map((m) => m.id as string);
      if (finishedIds.length > 0) {
        const { data: outcomeRows } = await supabase
          .from('prediction_outcomes')
          .select('match_id,is_correct,brier_score')
          .in('match_id', finishedIds);
        for (const o of ((outcomeRows ?? []) as Record<string, unknown>[])) {
          outcomeByMatchId.set(o.match_id as string, {
            is_correct:  o.is_correct as boolean,
            brier_score: Number(o.brier_score ?? 0.25),
          });
        }
      }
    }

    // ── Fetch best odds per match ─────────────────────────────────────────────
    const oddsByMatchId = new Map<string, { home: number; draw: number; away: number; bookmaker: string }>();
    {
      const { data: oddsRows } = await supabase
        .from('odds')
        .select('match_id,home_win,draw,away_win,bookmaker')
        .in('match_id', matchIds)
        .order('home_win', { ascending: true }); // best home odds first
      for (const o of ((oddsRows ?? []) as Record<string, unknown>[])) {
        const mid = o.match_id as string;
        if (!oddsByMatchId.has(mid)) {
          oddsByMatchId.set(mid, {
            home:       Number(o.home_win ?? 0),
            draw:       Number(o.draw ?? 0),
            away:       Number(o.away_win ?? 0),
            bookmaker:  String(o.bookmaker ?? ''),
          });
        }
      }
    }

    // ── Merge, apply prediction filters, and sort ─────────────────────────────
    let items: PredictionFeedItem[] = allMatches.map((m) => {
      const pred = predByMatchId.get(m.id as string) ?? null;
      const outcome = outcomeByMatchId.get(m.id as string) ?? null;
      const odds = oddsByMatchId.get(m.id as string) ?? null;

      return {
        // Match
        matchId:      m.id as string,
        sport:        (m.sport as string) ?? 'football',
        homeTeam:     (m.home_team as string) ?? '',
        awayTeam:     (m.away_team as string) ?? '',
        homeLogo:     (m.home_logo as string | null) ?? null,
        awayLogo:     (m.away_logo as string | null) ?? null,
        leagueLogo:   (m.league_logo as string | null) ?? null,
        league:       (m.league as string) ?? '',
        country:      (m.country as string) ?? 'International',
        status:       (m.status as 'upcoming' | 'live' | 'finished') ?? 'upcoming',
        matchTime:    (m.match_time as string) ?? '',
        minute:       Number(m.minute ?? 0),
        homeScore:    Number(m.home_score ?? 0),
        awayScore:    Number(m.away_score ?? 0),
        homeForm:     Array.isArray(m.home_form) ? (m.home_form as string[]) : [],
        awayForm:     Array.isArray(m.away_form) ? (m.away_form as string[]) : [],
        round:        (m.round as string | null) ?? null,
        // Prediction
        predictionId:        pred?.id as string | null ?? null,
        hasPrediction:       !!pred,
        homeWinProb:         pred ? Number(pred.home_win_prob) : null,
        drawProb:            pred ? Number(pred.draw_prob)     : null,
        awayWinProb:         pred ? Number(pred.away_win_prob) : null,
        predictedResult:     pred ? (pred.predicted_result as string) : null,
        confidence:          pred ? Number(pred.confidence)    : null,
        overUnder:           pred ? (pred.over_under as string) : null,
        overUnderLine:       pred ? Number(pred.over_under_line ?? 2.5) : null,
        btts:                pred ? (pred.btts as string) : null,
        correctScore:        pred ? (pred.correct_score as string | null) : null,
        predictedHomeGoals:  pred ? Number(pred.predicted_home_goals ?? 1.5) : null,
        predictedAwayGoals:  pred ? Number(pred.predicted_away_goals ?? 1.2) : null,
        cornersOverUnder:    pred ? (pred.corners_over_under as string | null) : null,
        cornersLine:         pred ? Number(pred.corners_line ?? 9.5) : null,
        cardsTotal:          pred ? Number(pred.cards_total ?? 3.5) : null,
        cardsOverUnder:      pred ? (pred.cards_over_under as string | null) : null,
        asianHandicapLine:   pred ? Number(pred.asian_handicap_line ?? 0) : null,
        asianHandicapPick:   pred ? (pred.asian_handicap_pick as string | null) : null,
        htResult:            pred ? (pred.ht_result as string | null) : null,
        firstGoal:           pred ? (pred.first_goal as string | null) : null,
        keyFactors:          pred && Array.isArray(pred.key_factors) ? (pred.key_factors as string[]) : [],
        aiAnalysis:          pred ? (pred.ai_analysis as string | null) : null,
        // VIP fields — strip if not VIP
        riskLevel:           isVip && pred ? (pred.risk_level as string | null) : null,
        valueScore:          isVip && pred ? (pred.value_score !== null ? Number(pred.value_score) : null) : null,
        marketEdgePct:       isVip && pred ? (pred.market_edge_pct !== null ? Number(pred.market_edge_pct) : null) : null,
        sharpSignal:         isVip && pred ? (pred.sharp_signal as string | null) : null,
        suggestedStake:      isVip && pred ? (pred.suggested_stake as string | null) : null,
        warningFlags:        isVip && pred && Array.isArray(pred.warning_flags) ? (pred.warning_flags as string[]) : [],
        keyAlphaMetric:      isVip && pred ? (pred.key_alpha_metric as string | null) : null,
        // Outcome badge
        outcomeResolved: !!outcome,
        outcomeCorrect:  outcome?.is_correct ?? null,
        brierScore:      outcome?.brier_score ?? null,
        // Odds
        homeOdds:  odds?.home ?? null,
        drawOdds:  odds?.draw ?? null,
        awayOdds:  odds?.away ?? null,
        bookmaker: odds?.bookmaker ?? null,
      } as PredictionFeedItem;
    });

    // ── Apply prediction-based filters ────────────────────────────────────────
    if (resultFilter !== 'all') items = items.filter((i) => i.predictedResult === resultFilter);
    if (ouFilter !== 'all')     items = items.filter((i) => i.overUnder === ouFilter);
    if (bttsFilter !== 'all')   items = items.filter((i) => i.btts === bttsFilter);
    if (minConf > 0)            items = items.filter((i) => (i.confidence ?? 0) >= minConf);

    // ── Apply sort ────────────────────────────────────────────────────────────
    if (sort === 'confidence') {
      items.sort((a, b) => {
        // Live first
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        return (b.confidence ?? 0) - (a.confidence ?? 0);
      });
    } else if (sort === 'value') {
      items.sort((a, b) => {
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        return (b.valueScore ?? 0) - (a.valueScore ?? 0);
      });
    }
    // 'time' is already ordered from DB

    // ── Paginate ──────────────────────────────────────────────────────────────
    const totalFiltered = items.length;
    const pageItems = items.slice(offset, offset + limit);

    // ── Outcome accuracy stats (for the current result set) ───────────────────
    const resolvedItems   = items.filter((i) => i.outcomeResolved);
    const correctItems    = resolvedItems.filter((i) => i.outcomeCorrect === true);
    const accuracyPct     = resolvedItems.length > 0
      ? Math.round((correctItems.length / resolvedItems.length) * 100)
      : 0;

    const liveCount       = items.filter((i) => i.status === 'live').length;
    const predictedCount  = items.filter((i) => i.hasPrediction).length;

    return secureResponse({
      items:      pageItems,
      pagination: {
        page,
        limit,
        total:   totalFiltered,
        hasNext: offset + limit < totalFiltered,
        hasPrev: page > 1,
      },
      meta: {
        generatedAt:  new Date().toISOString(),
        sport,
        status:       statusFilter,
        date:         dateParam,
        sort,
        liveCount,
        predictedCount,
        totalMatches: totalMatches ?? allMatches.length,
        outcomeStats: {
          total:        resolvedItems.length,
          correct:      correctItems.length,
          accuracy_pct: accuracyPct,
        },
      },
    });

  } catch {
    return secureErrorResponse('Internal server error', 500);
  }
});
