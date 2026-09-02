/**
 * services/marketIntelligence.ts — PredictXta Phase 8 Market Intelligence
 *
 * Provides structured analysis of bookmaker odds vs model probabilities.
 *
 * STRICT RULES:
 *   - Never fabricate odds; only analyse available bookmaker data
 *   - Clearly distinguish model probability, market probability, and value
 *   - No guarantee of profitability is ever implied
 *   - Expected value is informational only; not investment advice
 *   - Bookmaker margin is always accounted for before computing value
 */

import { getSupabaseClient } from '@/template';
import type { Match } from './types';

// ─── Market types ─────────────────────────────────────────────────────────────
export interface MarketOdds {
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  over25: number | null;
  under25: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  bookmaker: string;
  timestamp: string;
}

export interface ImpliedProbabilities {
  homeWin: number | null;   // raw bookmaker implied
  draw: number | null;
  awayWin: number | null;
  margin: number | null;    // bookmaker overround (e.g. 0.05 = 5% margin)
  // De-juiced (fair) probabilities
  fairHomeWin: number | null;
  fairDraw: number | null;
  fairAwayWin: number | null;
}

export interface ValueAnalysis {
  market: '1x2' | 'over_under' | 'btts';
  selection: string;
  modelProbability: number;    // from quantitative model
  marketFairProbability: number; // bookmaker odds de-juiced
  impliedProbabilityRaw: number; // bookmaker raw implied
  expectedValue: number;       // (modelProb × odds) - 1
  hasValue: boolean;           // model prob > market fair prob + threshold
  confidence: 'high' | 'medium' | 'low';
  caveat: string;
}

// ─── Odds → implied probability ───────────────────────────────────────────────
function toImplied(odds: number | null): number | null {
  if (!odds || odds <= 1) return null;
  return 1 / odds;
}

// ─── De-juice (Shin/proportional method) ─────────────────────────────────────
function deJuice(home: number | null, draw: number | null, away: number | null): ImpliedProbabilities {
  const hI = toImplied(home);
  const dI = toImplied(draw);
  const aI = toImplied(away);

  if (!hI || !aI) {
    return {
      homeWin: hI, draw: dI, awayWin: aI,
      margin: null,
      fairHomeWin: null, fairDraw: null, fairAwayWin: null,
    };
  }

  const totalImplied = (hI ?? 0) + (dI ?? 0) + (aI ?? 0);
  const margin = totalImplied > 0 ? totalImplied - 1 : null;

  // Proportional de-juicing: divide each by sum
  const fairHome = totalImplied > 0 ? hI / totalImplied : null;
  const fairDraw = totalImplied > 0 && dI ? dI / totalImplied : null;
  const fairAway = totalImplied > 0 ? (aI ?? 0) / totalImplied : null;

  return {
    homeWin: hI,
    draw: dI,
    awayWin: aI,
    margin: margin ? Math.round(margin * 10000) / 10000 : null,
    fairHomeWin: fairHome ? Math.round(fairHome * 10000) / 10000 : null,
    fairDraw: fairDraw ? Math.round(fairDraw * 10000) / 10000 : null,
    fairAwayWin: fairAway ? Math.round(fairAway * 10000) / 10000 : null,
  };
}

// ─── Expected value calculation ───────────────────────────────────────────────
function calcEV(modelProb: number, odds: number | null): number | null {
  if (!odds || odds <= 1) return null;
  return Math.round(((modelProb * odds) - 1) * 10000) / 10000;
}

// ─── Value threshold (conservative) ─────────────────────────────────────────
const VALUE_THRESHOLD = 0.04; // model must exceed fair prob by ≥ 4% to flag value

// ─── Load odds for a match ────────────────────────────────────────────────────
export async function loadMarketOdds(matchId: string): Promise<MarketOdds | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('odds')
      .select('home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, bookmaker, last_updated')
      .eq('match_id', matchId)
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      homeWin:  data.home_win  ? Number(data.home_win)  : null,
      draw:     data.draw      ? Number(data.draw)      : null,
      awayWin:  data.away_win  ? Number(data.away_win)  : null,
      over25:   data.over_2_5  ? Number(data.over_2_5)  : null,
      under25:  data.under_2_5 ? Number(data.under_2_5) : null,
      bttsYes:  data.btts_yes  ? Number(data.btts_yes)  : null,
      bttsNo:   data.btts_no   ? Number(data.btts_no)   : null,
      bookmaker: data.bookmaker ?? 'Unknown',
      timestamp: data.last_updated ?? new Date().toISOString(),
    };
  } catch { return null; }
}

// ─── Full market intelligence for a match ────────────────────────────────────
export interface MarketIntelligenceReport {
  matchId: string;
  sport: string;
  odds: MarketOdds | null;
  implied: ImpliedProbabilities | null;
  valueAnalysis: ValueAnalysis[];
  modelVsMarketSummary: string;
  dataAvailable: boolean;
  oddsAge: string | null;
  disclaimer: string;
}

export function buildMarketReport(
  match: Match,
  odds: MarketOdds | null,
  modelProbs: { home: number; draw: number; away: number } | null,
): MarketIntelligenceReport {
  if (!odds || !modelProbs) {
    return {
      matchId: match.id,
      sport: match.sport ?? 'football',
      odds: null,
      implied: null,
      valueAnalysis: [],
      modelVsMarketSummary: 'Odds or model probabilities unavailable.',
      dataAvailable: false,
      oddsAge: null,
      disclaimer: 'Market analysis unavailable: no odds data.',
    };
  }

  const implied = deJuice(odds.homeWin, odds.draw, odds.awayWin);

  const oddsAgeMs = odds.timestamp ? Date.now() - new Date(odds.timestamp).getTime() : null;
  const oddsAgeLabel = oddsAgeMs !== null
    ? oddsAgeMs < 3600_000 ? 'Less than 1 hour ago'
    : oddsAgeMs < 86400_000 ? `${Math.floor(oddsAgeMs / 3600_000)}h ago`
    : `${Math.floor(oddsAgeMs / 86400_000)}d ago`
    : null;

  const valueAnalysis: ValueAnalysis[] = [];

  // 1X2 value analysis
  const selections: Array<{ key: '1' | 'X' | '2'; modelProb: number; fairProb: number | null; odds: number | null }> = [
    { key: '1', modelProb: modelProbs.home, fairProb: implied.fairHomeWin, odds: odds.homeWin },
    { key: 'X', modelProb: modelProbs.draw, fairProb: implied.fairDraw,    odds: odds.draw },
    { key: '2', modelProb: modelProbs.away, fairProb: implied.fairAwayWin, odds: odds.awayWin },
  ];

  for (const sel of selections) {
    if (!sel.fairProb || !sel.odds || !implied.homeWin) continue;
    const ev = calcEV(sel.modelProb, sel.odds);
    const hasValue = sel.modelProb > sel.fairProb + VALUE_THRESHOLD;
    const diff = Math.abs(sel.modelProb - sel.fairProb);
    const conf: ValueAnalysis['confidence'] = diff > 0.08 ? 'high' : diff > 0.04 ? 'medium' : 'low';

    valueAnalysis.push({
      market: '1x2',
      selection: sel.key,
      modelProbability: Math.round(sel.modelProb * 10000) / 10000,
      marketFairProbability: Math.round(sel.fairProb * 10000) / 10000,
      impliedProbabilityRaw: Math.round((1 / sel.odds) * 10000) / 10000,
      expectedValue: ev ?? 0,
      hasValue,
      confidence: conf,
      caveat: hasValue
        ? 'Model estimates higher probability than market. Verify data freshness and model calibration before acting.'
        : 'Model and market are broadly aligned on this selection.',
    });
  }

  // Summary
  const modelFavour = modelProbs.home > modelProbs.away ? 'HOME' : modelProbs.away > modelProbs.home ? 'AWAY' : 'DRAW';
  const marketFavour = (implied.fairHomeWin ?? 0) > (implied.fairAwayWin ?? 0) ? 'HOME' : (implied.fairAwayWin ?? 0) > (implied.fairHomeWin ?? 0) ? 'AWAY' : 'DRAW';
  const agreement = modelFavour === marketFavour;

  const summary = agreement
    ? `Model and market both favour ${modelFavour}. Consistent signals.`
    : `Model favours ${modelFavour} but market favours ${marketFavour}. Investigate discrepancy before publication.`;

  return {
    matchId: match.id,
    sport: match.sport ?? 'football',
    odds,
    implied,
    valueAnalysis,
    modelVsMarketSummary: summary,
    dataAvailable: true,
    oddsAge: oddsAgeLabel,
    disclaimer: 'Market analysis is informational only. Expected value estimates do not guarantee profitability. Past model performance does not predict future results.',
  };
}

export default { loadMarketOdds, buildMarketReport };
