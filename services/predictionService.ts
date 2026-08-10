
/**
 * services/predictionService.ts
 *
 * Client-side prediction orchestration.
 * Calls generate-prediction edge function with enriched match data.
 * Reads from DB cache first to avoid redundant AI calls.
 *
 * Also exports legacy helpers used by hooks/usePredictions.ts:
 *   fetchPredictions, fetchPredictionByMatchId,
 *   generateAIPrediction, batchGeneratePredictions
 */

import { getSupabaseClient } from '@/template';
import type { Prediction, Match } from './types';

// ─── Confidence color helpers ─────────────────────────────────────────────────
// ─── VIP Intelligence helpers ────────────────────────────────────────────────
export function formatMarketEdge(edge: number): string {
  const sign = edge > 0 ? '+' : '';
  return `${sign}${edge.toFixed(1)}%`;
}

export function getSharpSignalLabel(signal: 'bullish' | 'neutral' | 'bearish' | string | null | undefined): string {
  switch (signal) {
    case 'bullish': return '📈 Sharp Money In';
    case 'bearish': return '📉 Sharp Money Out';
    case 'neutral': return '➡️ Neutral';
    default: return '—';
  }
}

export function getValueScoreColor(score: number): string {
  if (score >= 75) return '#22C55E';
  if (score >= 50) return '#F59E0B';
  if (score >= 25) return '#3B82F6';
  return '#6B7280';
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return '#6EDC1F'; // PredictXta green — high confidence
  if (confidence >= 65) return '#F59E0B'; // amber — moderate
  if (confidence >= 50) return '#4ECDC4'; // teal — speculative
  return '#6B7280'; // gray — low
}

export function getRiskColor(risk: 'Low' | 'Medium' | 'High' | undefined): string {
  switch (risk) {
    case 'Low': return '#22C55E';
    case 'Medium': return '#F59E0B';
    case 'High': return '#EF4444';
    default: return '#6B7280';
  }
}

// ─── Row → Prediction mapper ──────────────────────────────────────────────────
export function rowToPrediction(row: Record<string, unknown>): Prediction {
  const s = (k: string) => row[k] as string ?? '';
  const n = (k: string, def = 0) => row[k] != null ? Number(row[k]) : def;
  const b = (k: string) => Array.isArray(row[k]) ? row[k] as string[] : [];
  return {
    id: s('id'),
    matchId: s('match_id'),
    homeWinProb: n('home_win_prob'),
    drawProb: n('draw_prob'),
    awayWinProb: n('away_win_prob'),
    predictedResult: (row.predicted_result as 'home_win' | 'draw' | 'away_win') ?? 'home_win',
    confidence: n('confidence'),
    overUnder: (row.over_under as 'over' | 'under') ?? 'over',
    overUnderLine: n('over_under_line', 2.5),
    btts: (row.btts as 'yes' | 'no') ?? 'no',
    aiAnalysis: (row.ai_analysis as string) ?? '',
    keyFactors: b('key_factors'),
    createdAt: row.created_at as string | undefined,
    predictionVersion: row.prediction_version != null ? Number(row.prediction_version) : undefined,
    predictedHomeGoals: row.predicted_home_goals != null ? n('predicted_home_goals') : undefined,
    predictedAwayGoals: row.predicted_away_goals != null ? n('predicted_away_goals') : undefined,
    correctScore: row.correct_score as string | undefined,
    cornersOverUnder: row.corners_over_under as 'over' | 'under' | undefined,
    cornersLine: row.corners_line != null ? n('corners_line') : undefined,
    cardsTotal: row.cards_total != null ? n('cards_total') : undefined,
    cardsOverUnder: row.cards_over_under as 'over' | 'under' | undefined,
    asianHandicapLine: row.asian_handicap_line != null ? n('asian_handicap_line') : undefined,
    asianHandicapPick: row.asian_handicap_pick as 'home' | 'away' | undefined,
    htResult: row.ht_result as 'home_win' | 'draw' | 'away_win' | undefined,
    htHomeProb: row.ht_home_prob != null ? n('ht_home_prob') : undefined,
    htDrawProb: row.ht_draw_prob != null ? n('ht_draw_prob') : undefined,
    htAwayProb: row.ht_away_prob != null ? n('ht_away_prob') : undefined,
    cleanSheetHome: row.clean_sheet_home as 'yes' | 'no' | undefined,
    cleanSheetAway: row.clean_sheet_away as 'yes' | 'no' | undefined,
    firstGoal: row.first_goal as 'home' | 'away' | 'no_goal' | undefined,
    bothScoreHt: row.both_score_ht as 'yes' | 'no' | undefined,
    anytimeScorecast: row.anytime_scorecast as string | undefined,
    riskLevel: row.risk_level as 'Low' | 'Medium' | 'High' | undefined,
    valueScore: row.value_score != null ? n('value_score') : undefined,
    marketEdgePct: row.market_edge_pct != null ? n('market_edge_pct') : undefined,
    sharpSignal: row.sharp_signal as 'bullish' | 'neutral' | 'bearish' | undefined,
    suggestedStake: row.suggested_stake as 'low' | 'medium' | 'high' | undefined,
    predictionSummary: row.prediction_summary as string | undefined,
    keyAlphaMetric: row.key_alpha_metric as string | undefined,
    warningFlags: b('warning_flags'),
  };
}

// ─── Generate prediction for a match ──────────────────────────────────────────
interface GenerateOptions {
  userId?: string;
  bypassCache?: boolean;
}

interface GenerateResult {
  prediction: Prediction | null;
  source: 'cache' | 'ai' | 'error';
  error?: string;
  insufficient_data?: boolean;
}

export async function generatePrediction(
  match: Match,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const { userId, bypassCache = false } = options;
  const supabase = getSupabaseClient();

  // 1. Check DB cache first (predictions generated in last 6 hours)
  if (!bypassCache) {
    try {
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: cached } = await supabase
        .from('predictions')
        .select('*')
        .eq('match_id', match.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached) {
        return { prediction: rowToPrediction(cached), source: 'cache' };
      }
    } catch { /* non-blocking cache miss */ }
  }

  // 2. Enrich match with form/H2H/standings from DB
  const enriched = await enrichMatchData(match);

  // 3. Call edge function
  try {
    const { data: session } = await supabase.auth.getSession();
    // Use session token if available; otherwise use the supabase client's anon key
    const anonKey = (supabase as any)?.supabaseKey as string ?? '';
    const authHeader = session?.session?.access_token
      ? `Bearer ${session.session.access_token}`
      : `Bearer ${anonKey}`;

    const response = await supabase.functions.invoke('generate-prediction', {
      body: { match: enriched, user_id: userId },
      headers: { 'Authorization': authHeader },
    });

    if (response.error) {
      const errMsg = response.error?.message ?? 'Prediction service unavailable';
      return { prediction: null, source: 'error', error: errMsg };
    }

    const result = response.data;

    if (result.insufficient_data) {
      return { prediction: null, source: 'error', insufficient_data: true, error: result.message };
    }

    if (!result.success || !result.prediction) {
      return { prediction: null, source: 'error', error: result.error ?? 'AI generation failed' };
    }

    const prediction = rowToPrediction(result.prediction);
    return { prediction, source: 'ai' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { prediction: null, source: 'error', error: msg };
  }
}

// ─── Enrich match data before prediction ──────────────────────────────────────
/**
 * Exported so multiModelPredictionService can reuse the same enrichment logic.
 */
export async function enrichMatchDataForPrediction(match: Match): Promise<Record<string, unknown>> {
  return enrichMatchData(match);
}

// ─── Enrichment helpers ─────────────────────────────────────────────────────

/**
 * Compute W/D/L form string from a list of recent finished matches.
 * Returns e.g. ['W','D','L','W','W'] ordered oldest → newest.
 */
function buildFormArray(matches: any[], teamName: string): string[] {
  return matches.slice(0, 5).map((m: any) => {
    const isHome = m.home_team === teamName;
    const scored = isHome ? Number(m.home_score ?? 0) : Number(m.away_score ?? 0);
    const conceded = isHome ? Number(m.away_score ?? 0) : Number(m.home_score ?? 0);
    if (scored > conceded) return 'W';
    if (scored < conceded) return 'L';
    return 'D';
  }).reverse();
}

/**
 * Derive implicit odds from win probabilities when bookmaker odds are absent.
 */
function impliedOdds(prob: number): number {
  return prob > 0 ? Math.round((1 / prob) * 100) / 100 : 0;
}

// ─── Main enrichment function ────────────────────────────────────────────────

async function enrichMatchData(match: Match): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();

  // ── Layer 0: Base match fields ─────────────────────────────────────────────
  const enriched: Record<string, unknown> = {
    id: match.id,
    sport: match.sport ?? 'football',
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league: match.league,
    country: match.country ?? null,
    venue: match.venue ?? null,
    status: match.status,
    minute: match.minute ?? 0,
    homeScore: match.homeScore ?? 0,
    awayScore: match.awayScore ?? 0,
    // Pass any odds already on the match object as a fallback
    homeOdds: match.homeOdds ?? null,
    drawOdds: match.drawOdds ?? null,
    awayOdds: match.awayOdds ?? null,
    stats: match.stats ?? null,
    // Pass pre-stored form arrays from the matches table (populated by fetch-matches)
    homeForm: Array.isArray((match as any).homeForm) && (match as any).homeForm.length > 0
      ? (match as any).homeForm
      : [],
    awayForm: Array.isArray((match as any).awayForm) && (match as any).awayForm.length > 0
      ? (match as any).awayForm
      : [],
  };

  try {
    // ── Layers 1-4: All DB enrichment calls in parallel ──────────────────────
    const [
      standingsResult,
      recentHomeResult,
      recentAwayResult,
      oddsResult,
      homePlayerStatsResult,
      awayPlayerStatsResult,
      matchFormResult,
    ] = await Promise.allSettled([
      // Layer 1a: League standings
      supabase.from('league_standings')
        .select('team_name, position, played, wins, draws, losses, goals_for, goals_against, goal_diff, points, form')
        .eq('league_name', match.league)
        .order('position', { ascending: true })
        .limit(25),

      // Layer 1b: Recent home team matches (for form + H2H)
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score, status, match_time, league')
        .or(`home_team.eq.${match.homeTeam},away_team.eq.${match.homeTeam}`)
        .eq('status', 'finished')
        .order('match_time', { ascending: false })
        .limit(15),

      // Layer 1c: Recent away team matches (for form + H2H)
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score, status, match_time, league')
        .or(`home_team.eq.${match.awayTeam},away_team.eq.${match.awayTeam}`)
        .eq('status', 'finished')
        .order('match_time', { ascending: false })
        .limit(15),

      // Layer 2: Bookmaker odds for this match
      supabase.from('odds')
        .select('bookmaker, home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, home_handicap, away_handicap, handicap_line, last_updated')
        .eq('match_id', match.id)
        .order('last_updated', { ascending: false })
        .limit(3),

      // Layer 3a: Top home team player stats (key performers & availability proxy)
      supabase.from('player_stats')
        .select('player_name, position, appearances, goals, assists, yellow_cards, red_cards, rating')
        .eq('team_name', match.homeTeam)
        .order('rating', { ascending: false })
        .limit(8),

      // Layer 3b: Top away team player stats
      supabase.from('player_stats')
        .select('player_name, position, appearances, goals, assists, yellow_cards, red_cards, rating')
        .eq('team_name', match.awayTeam)
        .order('rating', { ascending: false })
        .limit(8),

      // Layer 4: Direct home_form / away_form from the match row in DB
      // (some sync jobs populate these columns directly)
      supabase.from('matches')
        .select('home_form, away_form, venue, country, round')
        .eq('id', match.id)
        .maybeSingle(),
    ]);

    // ── Process Layer 4: DB form arrays (override empty client-side values) ──
    if (matchFormResult.status === 'fulfilled' && matchFormResult.value.data) {
      const row = matchFormResult.value.data as any;
      if (Array.isArray(row.home_form) && row.home_form.length > 0) {
        enriched.homeForm = row.home_form;
      }
      if (Array.isArray(row.away_form) && row.away_form.length > 0) {
        enriched.awayForm = row.away_form;
      }
      // Also patch venue/country/round from the live DB row if missing
      if (!enriched.venue && row.venue) enriched.venue = row.venue;
      if (!enriched.country && row.country) enriched.country = row.country;
      if (row.round) enriched.round = row.round;
    }

    // ── Process Layer 1a: Standings ─────────────────────────────────────────
    if (standingsResult.status === 'fulfilled' && standingsResult.value.data) {
      const standings = standingsResult.value.data as any[];
      const homeRow = standings.find((r) => r.team_name === match.homeTeam);
      const awayRow = standings.find((r) => r.team_name === match.awayTeam);

      if (homeRow) {
        enriched.homeStandingsPos    = homeRow.position;
        enriched.homeStandingsPts    = homeRow.points;
        enriched.homeStandingsPlayed = homeRow.played;
        enriched.homeStandingsWins   = homeRow.wins;
        enriched.homeStandingsDraws  = homeRow.draws;
        enriched.homeStandingsLosses = homeRow.losses;
        enriched.homeGoalsScored     = homeRow.goals_for;
        enriched.homeGoalsConceded   = homeRow.goals_against;
        enriched.homeGoalDiff        = homeRow.goal_diff;
        // League-sourced form string (e.g. 'WWDLW')
        if (homeRow.form && typeof homeRow.form === 'string' && homeRow.form.length > 0) {
          enriched.homeLeagueForm = homeRow.form;
        }
      }
      if (awayRow) {
        enriched.awayStandingsPos    = awayRow.position;
        enriched.awayStandingsPts    = awayRow.points;
        enriched.awayStandingsPlayed = awayRow.played;
        enriched.awayStandingsWins   = awayRow.wins;
        enriched.awayStandingsDraws  = awayRow.draws;
        enriched.awayStandingsLosses = awayRow.losses;
        enriched.awayGoalsScored     = awayRow.goals_for;
        enriched.awayGoalsConceded   = awayRow.goals_against;
        enriched.awayGoalDiff        = awayRow.goal_diff;
        if (awayRow.form && typeof awayRow.form === 'string' && awayRow.form.length > 0) {
          enriched.awayLeagueForm = awayRow.form;
        }
      }
      // Standings gap (positive = home team is above away team)
      if (homeRow && awayRow) {
        enriched.standingsGap = (awayRow.position ?? 0) - (homeRow.position ?? 0);
      }
      // Total teams in league (context for position quality)
      enriched.leagueTeamsCount = standings.length;
    }

    // ── Process Layers 1b/1c: Recent results → form arrays + H2H ────────────
    const homeMatches = recentHomeResult.status === 'fulfilled'
      ? (recentHomeResult.value.data ?? []) as any[]
      : [];
    const awayMatches = recentAwayResult.status === 'fulfilled'
      ? (recentAwayResult.value.data ?? []) as any[]
      : [];

    // Only overwrite form if DB columns were empty
    if ((enriched.homeForm as any[]).length === 0 && homeMatches.length > 0) {
      enriched.homeForm = buildFormArray(homeMatches, match.homeTeam);
    }
    if ((enriched.awayForm as any[]).length === 0 && awayMatches.length > 0) {
      enriched.awayForm = buildFormArray(awayMatches, match.awayTeam);
    }

    // Derived form stats
    const hf = enriched.homeForm as string[];
    const af = enriched.awayForm as string[];
    if (hf.length > 0) {
      enriched.homeFormWins   = hf.filter((r) => r === 'W').length;
      enriched.homeFormDraws  = hf.filter((r) => r === 'D').length;
      enriched.homeFormLosses = hf.filter((r) => r === 'L').length;
      enriched.homeFormPts    = hf.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    }
    if (af.length > 0) {
      enriched.awayFormWins   = af.filter((r) => r === 'W').length;
      enriched.awayFormDraws  = af.filter((r) => r === 'D').length;
      enriched.awayFormLosses = af.filter((r) => r === 'L').length;
      enriched.awayFormPts    = af.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
    }

    // H2H — from combined recent results for both teams
    const h2hCandidates = [...homeMatches, ...awayMatches].filter(
      (m: any) =>
        (m.home_team === match.homeTeam && m.away_team === match.awayTeam) ||
        (m.home_team === match.awayTeam && m.away_team === match.homeTeam),
    );
    if (h2hCandidates.length > 0) {
      enriched.h2h = h2hCandidates.slice(0, 6).map((m: any) => ({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeScore: m.home_score,
        awayScore: m.away_score,
        date: m.match_time,
        league: m.league,
      }));
      // H2H summary
      const homeWins = h2hCandidates.filter((m: any) => (
        (m.home_team === match.homeTeam && m.home_score > m.away_score) ||
        (m.away_team === match.homeTeam && m.away_score > m.home_score)
      )).length;
      const awayWins = h2hCandidates.filter((m: any) => (
        (m.home_team === match.awayTeam && m.home_score > m.away_score) ||
        (m.away_team === match.awayTeam && m.away_score > m.home_score)
      )).length;
      enriched.h2hHomeWins = homeWins;
      enriched.h2hAwayWins = awayWins;
      enriched.h2hDraws    = h2hCandidates.length - homeWins - awayWins;
    }

    // Avg goals (last 5 matches each team)
    const avgGoals = (matches: any[], teamName: string): { scored: number; conceded: number } => {
      const last5 = matches.slice(0, 5);
      if (last5.length === 0) return { scored: 0, conceded: 0 };
      let scored = 0; let conceded = 0;
      for (const m of last5) {
        const isHome = m.home_team === teamName;
        scored   += isHome ? Number(m.home_score ?? 0) : Number(m.away_score ?? 0);
        conceded += isHome ? Number(m.away_score ?? 0) : Number(m.home_score ?? 0);
      }
      return {
        scored:   Math.round((scored   / last5.length) * 100) / 100,
        conceded: Math.round((conceded / last5.length) * 100) / 100,
      };
    };
    if (homeMatches.length > 0) {
      const hg = avgGoals(homeMatches, match.homeTeam);
      enriched.homeAvgGoalsScored   = hg.scored;
      enriched.homeAvgGoalsConceded = hg.conceded;
    }
    if (awayMatches.length > 0) {
      const ag = avgGoals(awayMatches, match.awayTeam);
      enriched.awayAvgGoalsScored   = ag.scored;
      enriched.awayAvgGoalsConceded = ag.conceded;
    }

    // ── Process Layer 2: Bookmaker odds ────────────────────────────────────
    if (oddsResult.status === 'fulfilled' && oddsResult.value.data && oddsResult.value.data.length > 0) {
      // Use the most recently updated bookmaker row as primary odds source
      const oddsRow = oddsResult.value.data[0] as any;
      enriched.bookmaker    = oddsRow.bookmaker ?? 'unknown';
      enriched.oddsHomeWin  = oddsRow.home_win  != null ? Number(oddsRow.home_win)  : (enriched.homeOdds ?? null);
      enriched.oddsDraw     = oddsRow.draw       != null ? Number(oddsRow.draw)       : (enriched.drawOdds ?? null);
      enriched.oddsAwayWin  = oddsRow.away_win  != null ? Number(oddsRow.away_win)  : (enriched.awayOdds ?? null);
      enriched.oddsOver25   = oddsRow.over_2_5  != null ? Number(oddsRow.over_2_5)  : null;
      enriched.oddsUnder25  = oddsRow.under_2_5 != null ? Number(oddsRow.under_2_5) : null;
      enriched.oddsBttsYes  = oddsRow.btts_yes  != null ? Number(oddsRow.btts_yes)  : null;
      enriched.oddsBttsNo   = oddsRow.btts_no   != null ? Number(oddsRow.btts_no)   : null;
      enriched.handicapLine = oddsRow.handicap_line != null ? Number(oddsRow.handicap_line) : null;
      enriched.homeHandicap = oddsRow.home_handicap != null ? Number(oddsRow.home_handicap) : null;
      enriched.awayHandicap = oddsRow.away_handicap != null ? Number(oddsRow.away_handicap) : null;

      // Implied probabilities from market odds (removes vig via normalisation)
      const rawHome = enriched.oddsHomeWin ? 1 / (enriched.oddsHomeWin as number) : 0;
      const rawDraw = enriched.oddsDraw     ? 1 / (enriched.oddsDraw as number) : 0;
      const rawAway = enriched.oddsAwayWin ? 1 / (enriched.oddsAwayWin as number) : 0;
      const vig = rawHome + rawDraw + rawAway || 1;
      if (vig > 0) {
        enriched.impliedHomeWinProb = Math.round((rawHome / vig) * 1000) / 10;
        enriched.impliedDrawProb    = Math.round((rawDraw / vig) * 1000) / 10;
        enriched.impliedAwayWinProb = Math.round((rawAway / vig) * 1000) / 10;
      }

      // Market favourite
      enriched.marketFavourite =
        (enriched.oddsHomeWin as number) < (enriched.oddsAwayWin as number) ? 'home'
        : (enriched.oddsAwayWin as number) < (enriched.oddsHomeWin as number) ? 'away'
        : 'draw';

      // Over/Under market consensus
      if (enriched.oddsOver25 && enriched.oddsUnder25) {
        enriched.marketOverUnderFavour =
          (enriched.oddsOver25 as number) < (enriched.oddsUnder25 as number) ? 'over' : 'under';
      }

      // All bookmaker snapshots for multi-book analysis
      enriched.allOddsSnapshots = (oddsResult.value.data as any[]).map((r) => ({
        bookmaker: r.bookmaker,
        home: Number(r.home_win ?? 0),
        draw: Number(r.draw ?? 0),
        away: Number(r.away_win ?? 0),
        over25: Number(r.over_2_5 ?? 0),
        under25: Number(r.under_2_5 ?? 0),
      }));
    } else {
      // No bookmaker data — populate homeOdds/drawOdds/awayOdds from match object if present
      if (match.homeOdds) enriched.oddsHomeWin = match.homeOdds;
      if (match.drawOdds) enriched.oddsDraw    = match.drawOdds;
      if (match.awayOdds) enriched.oddsAwayWin = match.awayOdds;
    }

    // ── Process Layer 3: Player stats ──────────────────────────────────────
    const mapPlayerStats = (rows: any[]) => rows.map((r) => ({
      name:        r.player_name,
      position:    r.position ?? 'Unknown',
      appearances: Number(r.appearances ?? 0),
      goals:       Number(r.goals ?? 0),
      assists:     Number(r.assists ?? 0),
      yellowCards: Number(r.yellow_cards ?? 0),
      redCards:    Number(r.red_cards ?? 0),
      rating:      r.rating != null ? Number(r.rating) : null,
      // Suspension risk: 5+ yellows or any red card flags the player as a risk
      suspensionRisk: Number(r.red_cards ?? 0) > 0 || Number(r.yellow_cards ?? 0) >= 5,
    }));

    if (homePlayerStatsResult.status === 'fulfilled' && homePlayerStatsResult.value.data?.length > 0) {
      const homePlayers = mapPlayerStats(homePlayerStatsResult.value.data as any[]);
      enriched.homePlayerStats     = homePlayers;
      enriched.homeTopScorer       = homePlayers.reduce((best, p) => (!best || p.goals > best.goals) ? p : best, null as any);
      enriched.homeTopAssister     = homePlayers.reduce((best, p) => (!best || p.assists > best.assists) ? p : best, null as any);
      enriched.homeAvgRating       = homePlayers.filter((p) => p.rating != null).length > 0
        ? Math.round(homePlayers.filter((p) => p.rating != null).reduce((s, p) => s + (p.rating ?? 0), 0) / homePlayers.filter((p) => p.rating != null).length * 100) / 100
        : null;
      enriched.homeSuspensionCount = homePlayers.filter((p) => p.suspensionRisk).length;
      enriched.homeTotalGoals      = homePlayers.reduce((s, p) => s + p.goals, 0);
    }

    if (awayPlayerStatsResult.status === 'fulfilled' && awayPlayerStatsResult.value.data?.length > 0) {
      const awayPlayers = mapPlayerStats(awayPlayerStatsResult.value.data as any[]);
      enriched.awayPlayerStats     = awayPlayers;
      enriched.awayTopScorer       = awayPlayers.reduce((best, p) => (!best || p.goals > best.goals) ? p : best, null as any);
      enriched.awayTopAssister     = awayPlayers.reduce((best, p) => (!best || p.assists > best.assists) ? p : best, null as any);
      enriched.awayAvgRating       = awayPlayers.filter((p) => p.rating != null).length > 0
        ? Math.round(awayPlayers.filter((p) => p.rating != null).reduce((s, p) => s + (p.rating ?? 0), 0) / awayPlayers.filter((p) => p.rating != null).length * 100) / 100
        : null;
      enriched.awaySuspensionCount = awayPlayers.filter((p) => p.suspensionRisk).length;
      enriched.awayTotalGoals      = awayPlayers.reduce((s, p) => s + p.goals, 0);
    }

    // ── Layer 5: Venue context ─────────────────────────────────────────────
    // Home advantage: calculate home win rate from recent home matches
    if (homeMatches.length > 0) {
      const trueHomeMatches = homeMatches.filter((m: any) => m.home_team === match.homeTeam);
      if (trueHomeMatches.length >= 3) {
        const homeWinRate = trueHomeMatches.filter((m: any) => m.home_score > m.away_score).length / trueHomeMatches.length;
        enriched.homeWinRate        = Math.round(homeWinRate * 100);
        enriched.homeMatchesAtHome  = trueHomeMatches.length;
      }
    }
    if (awayMatches.length > 0) {
      const trueAwayMatches = awayMatches.filter((m: any) => m.away_team === match.awayTeam);
      if (trueAwayMatches.length >= 3) {
        const awayWinRate = trueAwayMatches.filter((m: any) => m.away_score > m.home_score).length / trueAwayMatches.length;
        enriched.awayWinRateAway    = Math.round(awayWinRate * 100);
        enriched.awayMatchesAway    = trueAwayMatches.length;
      }
    }

    // ── DQ score estimate (helps the quality gate approve the prediction) ──
    // Count how many enrichment signals were actually populated
    const dqSignals: boolean[] = [
      (enriched.homeForm as string[]).length > 0,
      (enriched.awayForm as string[]).length > 0,
      enriched.homeStandingsPos != null,
      enriched.awayStandingsPos != null,
      enriched.oddsHomeWin != null,
      enriched.oddsAwayWin != null,
      enriched.oddsOver25 != null,
      enriched.homePlayerStats != null,
      enriched.awayPlayerStats != null,
      enriched.h2h != null,
      enriched.homeAvgGoalsScored != null,
      enriched.awayAvgGoalsScored != null,
    ];
    enriched.enrichmentScore   = dqSignals.filter(Boolean).length;
    enriched.enrichmentMaxScore = dqSignals.length;
    enriched.enrichmentPct     = Math.round((dqSignals.filter(Boolean).length / dqSignals.length) * 100);

  } catch { /* non-blocking enrichment failure — proceed with base data */ }

  return enriched;
}

// ─── Batch prediction generation ──────────────────────────────────────────────
/**
 * Generate predictions for multiple matches in parallel (max 3 concurrent).
 */
export async function generateBatchPredictions(
  matches: Match[],
  options: GenerateOptions = {},
): Promise<Map<string, Prediction>> {
  const results = new Map<string, Prediction>();
  const CONCURRENCY = 3;

  for (let i = 0; i < matches.length; i += CONCURRENCY) {
    const batch = matches.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((m) => generatePrediction(m, options)),
    );

    batchResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value.prediction) {
        results.set(batch[idx].id, result.value.prediction);
      }
    });

    // Small delay between batches to avoid rate limiting
    if (i + CONCURRENCY < matches.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return results;
}

// ─── Legacy helpers used by hooks/usePredictions.ts ─────────────────────────

/**
 * Fetch recent high-confidence predictions, optionally filtered by sport.
 * Matches are joined in-memory via match_id lookup.
 */
export async function fetchPredictions(sport = 'All'): Promise<Prediction[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .gte('confidence', 55)
      .order('confidence', { ascending: false })
      .limit(50);
    if (error || !data) return [];
    const preds = (data as Record<string, unknown>[]).map(rowToPrediction);
    if (sport === 'All') return preds;
    // Filter by sport — requires a join; for now return all (sport filter is handled UI-side)
    return preds;
  } catch { return []; }
}

/**
 * Fetch the latest prediction for a specific match.
 */
export async function fetchPredictionByMatchId(matchId: string): Promise<Prediction | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return rowToPrediction(data as Record<string, unknown>);
  } catch { return null; }
}

/**
 * Generate one AI prediction — thin wrapper over generatePrediction().
 * Returns { prediction, error } shape expected by useGeneratePrediction hook.
 */
export async function generateAIPrediction(
  match: Match,
  userId?: string,
): Promise<{ prediction: Prediction | null; error: string | null }> {
  const result = await generatePrediction(match, { userId, bypassCache: false });
  return { prediction: result.prediction, error: result.error ?? null };
}

/**
 * Batch-generate predictions for a list of matches.
 * Returns the count of successfully generated predictions.
 */
export async function batchGeneratePredictions(
  matches: Match[],
  userId: string | undefined,
  concurrency = 3,
): Promise<number> {
  let count = 0;
  for (let i = 0; i < matches.length; i += concurrency) {
    const batch = matches.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((m) => generatePrediction(m, { userId, bypassCache: false })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.prediction) count++;
    }
    if (i + concurrency < matches.length) {
      await new Promise((res) => setTimeout(res, 600));
    }
  }
  return count;
}

// ─── Fetch existing predictions from DB ───────────────────────────────────────
export async function fetchPredictionsForMatches(matchIds: string[]): Promise<Prediction[]> {
  if (matchIds.length === 0) return [];
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .in('match_id', matchIds)
      .order('confidence', { ascending: false });

    if (error || !data) return [];

    // Deduplicate: keep highest confidence prediction per match
    const seen = new Map<string, Prediction>();
    for (const row of data) {
      const pred = rowToPrediction(row);
      const existing = seen.get(pred.matchId);
      if (!existing || pred.confidence > existing.confidence) {
        seen.set(pred.matchId, pred);
      }
    }
    return [...seen.values()];
  } catch { return []; }
}
