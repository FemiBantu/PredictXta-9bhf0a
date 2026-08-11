/**
 * services/sportsIntelligence.ts
 *
 * Enterprise Sports Intelligence Layer — Phase 2-6 Implementation
 *
 * Unified feature store providing:
 * - Team Elo ratings derived from standings
 * - Form momentum scoring
 * - Sport-specific statistical engines (Poisson, Dixon-Coles, Pace/Efficiency, Surface Elo)
 * - Universal data quality scoring
 * - Market consensus analysis
 * - Pre-match intelligence summary for AI prompt enrichment
 *
 * All computations are pure TypeScript — no external ML deps required.
 * Used by predictionService enrichMatchData() and by the AI Picks UI.
 */

// ─── Core Probability Engines ─────────────────────────────────────────────────

export function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

export function poissonMatchProbs(
  lambdaH: number,
  lambdaA: number,
  maxGoals = 8,
): { hw: number; d: number; aw: number } {
  let hw = 0, d = 0, aw = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA);
      if (h > a) hw += p;
      else if (h === a) d += p;
      else aw += p;
    }
  }
  return { hw, d, aw };
}

/** Dixon-Coles adjustment: reduces Poisson over-prediction of 0-0 and 1-0 scores */
export function dixonColesAdjustment(lambdaH: number, lambdaA: number, rho = -0.13): number {
  // Rho is typically calibrated to -0.13 from football data
  // Returns adjustment factor for (0,0) score — approximated here
  return Math.max(0.8, 1 + rho * poissonPMF(0, lambdaH) * poissonPMF(0, lambdaA));
}

// ─── Elo Engine ───────────────────────────────────────────────────────────────

export function eloWinProb(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

export function posToElo(pos: number, totalTeams = 20): number {
  const base = 1700;
  const spread = 350;
  return Math.round(base + ((totalTeams - pos) / Math.max(totalTeams - 1, 1)) * spread);
}

export function eloFromGoalDiff(goalDiff: number, played: number): number {
  // Supplement Elo with season goal difference
  if (played === 0) return 1700;
  const gdPerGame = goalDiff / played;
  return Math.round(1700 + gdPerGame * 40); // each GD/game ≈ 40 Elo points
}

// ─── Form Score ───────────────────────────────────────────────────────────────

export function formScore(form: string[]): number {
  if (!form || form.length === 0) return 50;
  const weights = [2.0, 1.6, 1.4, 1.2, 1.0];
  const recent = form.slice(-5).reverse();
  let tot = 0, wSum = 0;
  recent.forEach((r, i) => {
    const w = weights[Math.min(i, weights.length - 1)];
    const pts = r.toUpperCase() === 'W' ? 3 : r.toUpperCase() === 'D' ? 1 : 0;
    tot += pts * w; wSum += 3 * w;
  });
  return Math.round((tot / wSum) * 100);
}

export function formMomentum(form: string[]): 'accelerating' | 'stable' | 'declining' {
  if (form.length < 4) return 'stable';
  const recent3 = formScore(form.slice(-3));
  const prev3   = formScore(form.slice(-6, -3));
  if (recent3 > prev3 + 10) return 'accelerating';
  if (recent3 < prev3 - 10) return 'declining';
  return 'stable';
}

// ─── Football Intelligence ────────────────────────────────────────────────────

export interface FootballEngineResult {
  lambdaH: number;
  lambdaA: number;
  poissonProbs: { hw: number; d: number; aw: number };
  bttsProb: number;
  over25Prob: number;
  mostLikelyScore: { h: number; a: number; prob: number };
  xgHome: number;
  xgAway: number;
}

export function footballEngine(params: {
  homeGoalsScored: number;
  homeGoalsConceded: number;
  awayGoalsScored: number;
  awayGoalsConceded: number;
  gamesPlayed?: number;
  leagueAvgGoals?: number;
  homeAdvantage?: number;
}): FootballEngineResult | null {
  const {
    homeGoalsScored, homeGoalsConceded,
    awayGoalsScored, awayGoalsConceded,
    gamesPlayed = 20, leagueAvgGoals = 2.6, homeAdvantage = 1.25,
  } = params;

  if (!homeGoalsScored || !awayGoalsScored) return null;

  const gp = Math.max(1, gamesPlayed);
  const avg = leagueAvgGoals / 2;

  const homeAtk = (homeGoalsScored  / gp) / avg;
  const homeDef = (homeGoalsConceded / gp) / avg;
  const awayAtk = (awayGoalsScored  / gp) / avg;
  const awayDef = (awayGoalsConceded / gp) / avg;

  const lambdaH = Math.max(0.3, homeAtk * awayDef * avg * homeAdvantage);
  const lambdaA = Math.max(0.2, awayAtk * homeDef * avg);

  const poissonProbs = poissonMatchProbs(lambdaH, lambdaA);
  const bttsProb = (1 - poissonPMF(0, lambdaH)) * (1 - poissonPMF(0, lambdaA));

  // Over 2.5 probability
  let over25 = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      if (h + a > 2) over25 += poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA);
    }
  }

  // Most likely scoreline
  let bestH = 0, bestA = 0, bestP = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const p = poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA);
      if (p > bestP) { bestP = p; bestH = h; bestA = a; }
    }
  }

  return {
    lambdaH, lambdaA,
    poissonProbs,
    bttsProb: Math.round(bttsProb * 100) / 100,
    over25Prob: Math.round(over25 * 100) / 100,
    mostLikelyScore: { h: bestH, a: bestA, prob: Math.round(bestP * 100) / 100 },
    xgHome: Math.round(lambdaH * 100) / 100,
    xgAway: Math.round(lambdaA * 100) / 100,
  };
}

// ─── Basketball Intelligence ──────────────────────────────────────────────────

export interface BasketballEngineResult {
  homeProjected: number;
  awayProjected: number;
  totalProjected: number;
  paceLabel: 'fast' | 'moderate' | 'slow';
  homeWinProb: number;
  spreadLine: number;
}

export function basketballEngine(params: {
  homePace: number; awayPace: number;
  homeORtg: number; awayORtg: number;
  homeDRtg: number; awayDRtg: number;
}): BasketballEngineResult | null {
  const { homePace, awayPace, homeORtg, awayORtg, homeDRtg, awayDRtg } = params;
  if (!homePace || !awayPace || !homeORtg || !awayORtg) return null;

  const pace = (homePace + awayPace) / 2;
  const poss = pace * 0.48;
  const homeTotal = Math.round((homeORtg / 100) * poss * (100 / Math.max(1, awayDRtg)));
  const awayTotal = Math.round((awayORtg / 100) * poss * (100 / Math.max(1, homeDRtg)));
  const diff = homeTotal - awayTotal;

  // Simple logistic conversion for spread → win prob
  const homeWinProb = Math.round(Math.min(85, Math.max(15, 50 + diff * 1.5)));

  return {
    homeProjected: homeTotal,
    awayProjected: awayTotal,
    totalProjected: homeTotal + awayTotal,
    paceLabel: pace > 102 ? 'fast' : pace > 97 ? 'moderate' : 'slow',
    homeWinProb,
    spreadLine: Math.round(diff * 10) / 10,
  };
}

// ─── Tennis Intelligence ──────────────────────────────────────────────────────

export interface TennisEngineResult {
  homeWinProb: number;
  awayWinProb: number;
  eloAdvantage: number;
  dominance: 'home_strong' | 'home_slight' | 'even' | 'away_slight' | 'away_strong';
  suggestedSets: number;
}

export function tennisEngine(params: {
  homeRank?: number | null; awayRank?: number | null;
  homeServeWin?: number | null; awayServeWin?: number | null;
  homeSurfaceWin?: number | null; awaySurfaceWin?: number | null;
  homeReturnWin?: number | null; awayReturnWin?: number | null;
}): TennisEngineResult | null {
  const { homeRank, awayRank, homeServeWin, awayServeWin, homeSurfaceWin, awaySurfaceWin } = params;
  if (!homeRank && !homeServeWin) return null;

  let homeWin = 0.5;

  if (homeRank && awayRank) {
    const homeElo = Math.max(1000, 2000 - (homeRank - 1) * 3.5);
    const awayElo  = Math.max(1000, 2000 - (awayRank  - 1) * 3.5);
    homeWin += (eloWinProb(homeElo - awayElo) - 0.5) * 0.6;
  }

  if (homeServeWin && awayServeWin) {
    homeWin += (homeServeWin - awayServeWin) / 300;
  }
  if (homeSurfaceWin && awaySurfaceWin) {
    homeWin += (homeSurfaceWin - awaySurfaceWin) / 200;
  }

  homeWin = Math.min(0.88, Math.max(0.12, homeWin));
  const homeRankDiff = (homeRank ?? 50) - (awayRank ?? 50);
  const eloAdv = homeRank && awayRank
    ? Math.round((2000 - (homeRank - 1) * 3.5) - (2000 - (awayRank - 1) * 3.5))
    : 0;

  const dominance: TennisEngineResult['dominance'] =
    homeWin > 0.72 ? 'home_strong'
    : homeWin > 0.58 ? 'home_slight'
    : homeWin < 0.28 ? 'away_strong'
    : homeWin < 0.42 ? 'away_slight'
    : 'even';

  return {
    homeWinProb: Math.round(homeWin * 100),
    awayWinProb: Math.round((1 - homeWin) * 100),
    eloAdvantage: eloAdv,
    dominance,
    suggestedSets: homeWin > 0.65 || homeWin < 0.35 ? 2 : 3,
  };
}

// ─── Cricket Intelligence ─────────────────────────────────────────────────────

export interface CricketEngineResult {
  homeProjectedRuns: number;
  awayProjectedRuns: number;
  totalProjected: number;
  homeWinProb: number;
  runDiff: number;
}

export function cricketEngine(params: {
  homeRunRate?: number | null;
  awayRunRate?: number | null;
  overs?: number;
}): CricketEngineResult | null {
  const { homeRunRate, awayRunRate, overs = 20 } = params;
  if (!homeRunRate || !awayRunRate) return null;

  const homeProj = Math.round(homeRunRate * overs);
  const awayProj = Math.round(awayRunRate * overs);
  const total = homeProj + awayProj;
  const homeWin = total > 0 ? Math.min(80, Math.max(20, Math.round((homeProj / total) * 100))) : 50;

  return {
    homeProjectedRuns: homeProj,
    awayProjectedRuns: awayProj,
    totalProjected: total,
    homeWinProb: homeWin,
    runDiff: homeProj - awayProj,
  };
}

// ─── Baseball Intelligence ────────────────────────────────────────────────────

export interface BaseballEngineResult {
  homeEdgeScore: number;  // 0-100
  awayEdgeScore: number;
  pitchingAdvantage: 'home' | 'away' | 'neutral';
  projectedTotal: number;
}

export function baseballEngine(params: {
  homeERA?: number | null; awayERA?: number | null;
  homeWHIP?: number | null; awayWHIP?: number | null;
  homeBattingAvg?: number | null; awayBattingAvg?: number | null;
}): BaseballEngineResult | null {
  const { homeERA, awayERA, homeWHIP, awayWHIP, homeBattingAvg, awayBattingAvg } = params;
  if (!homeERA && !awayERA) return null;

  const eraAdv  = ((awayERA ?? 4.0) - (homeERA ?? 4.0)) * 12;
  const whipAdv = ((awayWHIP ?? 1.3) - (homeWHIP ?? 1.3)) * 20;
  const batAdv  = ((homeBattingAvg ?? 0.25) - (awayBattingAvg ?? 0.25)) * 200;
  const rawEdge = Math.min(40, Math.max(-40, eraAdv + whipAdv + batAdv));

  const projRuns = Math.round(4.5 + (homeERA ?? 4.0) * 0.5 + (awayERA ?? 4.0) * 0.5);

  return {
    homeEdgeScore: Math.round(50 + rawEdge),
    awayEdgeScore: Math.round(50 - rawEdge),
    pitchingAdvantage: rawEdge > 8 ? 'home' : rawEdge < -8 ? 'away' : 'neutral',
    projectedTotal: Math.min(14, Math.max(5, projRuns)),
  };
}

// ─── Market Intelligence ──────────────────────────────────────────────────────

export interface MarketIntelligence {
  impliedHomeWin: number;  // 0-100
  impliedDraw: number;
  impliedAwayWin: number;
  vig: number;             // margin in %
  favourite: 'home' | 'draw' | 'away' | 'unknown';
  overUnderFavour: 'over' | 'under' | 'unknown';
  valueGap: number;        // AI confidence - implied prob (positive = value)
}

export function computeMarketIntelligence(
  homeOdds?: number | null,
  drawOdds?: number | null,
  awayOdds?: number | null,
  over25Odds?: number | null,
  under25Odds?: number | null,
  aiHomeWinPct?: number,
): MarketIntelligence | null {
  if (!homeOdds || !awayOdds) return null;

  const rawHW = 1 / homeOdds;
  const rawD  = drawOdds ? 1 / drawOdds : 0;
  const rawAW = 1 / awayOdds;
  const total = rawHW + rawD + rawAW;

  const vig = Math.round((total - 1) * 100 * 10) / 10; // in %

  const impliedHW = Math.round((rawHW / total) * 100);
  const impliedD  = Math.round((rawD  / total) * 100);
  const impliedAW = Math.round((rawAW / total) * 100);

  const favourite: MarketIntelligence['favourite'] =
    impliedHW >= impliedAW && impliedHW >= impliedD ? 'home'
    : impliedAW >= impliedHW && impliedAW >= impliedD ? 'away'
    : impliedD > impliedHW && impliedD > impliedAW ? 'draw'
    : 'unknown';

  let overUnderFavour: MarketIntelligence['overUnderFavour'] = 'unknown';
  if (over25Odds && under25Odds) {
    overUnderFavour = over25Odds < under25Odds ? 'over' : 'under';
  }

  const valueGap = aiHomeWinPct !== undefined ? aiHomeWinPct - impliedHW : 0;

  return { impliedHomeWin: impliedHW, impliedDraw: impliedD, impliedAwayWin: impliedAW, vig, favourite, overUnderFavour, valueGap };
}

// ─── Universal DQ Score ───────────────────────────────────────────────────────

export interface DataQualityResult {
  score: number;           // 0-100
  tier: 'excellent' | 'good' | 'fair' | 'poor';
  breakdown: Record<string, number>;
  confidenceCeiling: number;
  hasSufficientData: boolean;
  missingSignals: string[];
}

export function computeDataQuality(match: {
  sport?: string;
  homeForm?: string[] | null; awayForm?: string[] | null;
  homeStandingsPos?: number | null; awayStandingsPos?: number | null;
  homeGoalsScored?: number | null; awayGoalsScored?: number | null;
  homeGoalsConceded?: number | null; awayGoalsConceded?: number | null;
  homeOdds?: number | null; awayOdds?: number | null; drawOdds?: number | null;
  oddsOver25?: number | null; oddsBttsYes?: number | null;
  h2h?: unknown[] | null;
  homePlayerStats?: unknown[] | null; awayPlayerStats?: unknown[] | null;
  homeAvgRating?: number | null; awayAvgRating?: number | null;
  enrichmentPct?: number | null;
  injuries?: unknown[] | null;
  venue?: string | null;
}): DataQualityResult {
  const breakdown: Record<string, number> = {};
  const missing: string[] = [];
  let s = 30; // base score

  // Form data (most important for accuracy)
  if (match.homeForm?.length && match.homeForm.length >= 3) { s += 12; breakdown.homeForm = 12; }
  else missing.push('home_form');
  if (match.awayForm?.length && match.awayForm.length >= 3) { s += 12; breakdown.awayForm = 12; }
  else missing.push('away_form');

  // Standings
  if (match.homeStandingsPos && match.awayStandingsPos) { s += 8; breakdown.standings = 8; }
  else missing.push('standings');

  // Season goals (for Poisson)
  if (match.homeGoalsScored !== undefined && match.homeGoalsScored !== null &&
      match.awayGoalsScored !== undefined && match.awayGoalsScored !== null) { s += 8; breakdown.seasonGoals = 8; }
  else missing.push('season_goals');

  // Bookmaker odds (market intelligence)
  if (match.homeOdds && match.awayOdds) { s += 10; breakdown.odds = 10; }
  else missing.push('odds');
  if (match.oddsOver25) { s += 3; breakdown.ouOdds = 3; }
  if (match.oddsBttsYes) { s += 2; breakdown.bttsOdds = 2; }

  // H2H record
  if (match.h2h?.length && match.h2h.length >= 2) { s += 8; breakdown.h2h = 8; }
  else missing.push('h2h');

  // Player stats
  if (match.homePlayerStats?.length && match.homePlayerStats.length >= 3) { s += 4; breakdown.homePlayers = 4; }
  if (match.awayPlayerStats?.length && match.awayPlayerStats.length >= 3) { s += 4; breakdown.awayPlayers = 4; }

  // Injury/suspension data
  if (match.injuries?.length) { s += 3; breakdown.injuries = 3; }

  // Venue
  if (match.venue) { s += 2; breakdown.venue = 2; }

  const score = Math.min(100, s);
  const tier: DataQualityResult['tier'] =
    score >= 80 ? 'excellent'
    : score >= 60 ? 'good'
    : score >= 40 ? 'fair'
    : 'poor';

  // Confidence ceiling from DQ score
  const confidenceCeiling =
    score >= 75 ? 95
    : score >= 55 ? 82
    : score >= 35 ? 68
    : 55;

  return { score, tier, breakdown, confidenceCeiling, hasSufficientData: score >= 35, missingSignals: missing };
}

// ─── Pre-Match Intelligence Summary ─────────────────────────────────────────
// Builds a compact text summary of all statistical signals for use in AI prompt

export function buildPreMatchIntelligence(match: {
  homeTeam: string; awayTeam: string; sport: string; league?: string;
  homeForm?: string[] | null; awayForm?: string[] | null;
  homeStandingsPos?: number | null; awayStandingsPos?: number | null;
  homeStandingsPts?: number | null; awayStandingsPts?: number | null;
  homeGoalDiff?: number | null; awayGoalDiff?: number | null;
  homeGoalsScored?: number | null; awayGoalsScored?: number | null;
  homeGoalsConceded?: number | null; awayGoalsConceded?: number | null;
  homeOdds?: number | null; drawOdds?: number | null; awayOdds?: number | null;
  oddsOver25?: number | null; oddsUnder25?: number | null;
  oddsBttsYes?: number | null; oddsBttsNo?: number | null;
  h2hHomeWins?: number | null; h2hDraws?: number | null; h2hAwayWins?: number | null;
  homeAvgGoalsScored?: number | null; homeAvgGoalsConceded?: number | null;
  awayAvgGoalsScored?: number | null; awayAvgGoalsConceded?: number | null;
  homeTopScorer?: { name: string; goals: number } | null;
  awayTopScorer?: { name: string; goals: number } | null;
  homeSuspensionCount?: number | null; awaySuspensionCount?: number | null;
}): string {
  const lines: string[] = ['── INTELLIGENCE SUMMARY ──'];
  const sport = match.sport?.toLowerCase() ?? 'football';

  // Form
  const hfs = formScore(match.homeForm ?? []);
  const afs = formScore(match.awayForm ?? []);
  if (match.homeForm?.length || match.awayForm?.length) {
    lines.push(`Form (0-100): ${match.homeTeam}=${hfs} | ${match.awayTeam}=${afs}`);
    const hMom = formMomentum(match.homeForm ?? []);
    const aMom = formMomentum(match.awayForm ?? []);
    if (hMom !== 'stable' || aMom !== 'stable') {
      lines.push(`Momentum: ${match.homeTeam}=${hMom} | ${match.awayTeam}=${aMom}`);
    }
  }

  // Standings ELO
  if (match.homeStandingsPos && match.awayStandingsPos) {
    const hElo = posToElo(match.homeStandingsPos);
    const aElo  = posToElo(match.awayStandingsPos);
    const eloHW = Math.round(eloWinProb(hElo - aElo + 50) * 100);
    lines.push(`Elo (standings): ${match.homeTeam}=${hElo} | ${match.awayTeam}=${aElo} | Pos${match.homeStandingsPos} vs Pos${match.awayStandingsPos}`);
    lines.push(`Elo Home Win Prob: ${eloHW}%`);
    if (match.homeStandingsPts !== null && match.homeStandingsPts !== undefined) {
      lines.push(`Points: ${match.homeTeam}=${match.homeStandingsPts} | ${match.awayTeam}=${match.awayStandingsPts ?? '?'}`);
    }
  }

  // Sport-specific engine
  if (sport === 'football' || sport === 'soccer') {
    if (match.homeGoalsScored !== null && match.homeGoalsScored !== undefined) {
      const fe = footballEngine({
        homeGoalsScored:    match.homeGoalsScored ?? 0,
        homeGoalsConceded:  match.homeGoalsConceded ?? 0,
        awayGoalsScored:    match.awayGoalsScored ?? 0,
        awayGoalsConceded:  match.awayGoalsConceded ?? 0,
      });
      if (fe) {
        lines.push(`Poisson λ: Home=${fe.lambdaH.toFixed(2)} Away=${fe.lambdaA.toFixed(2)}`);
        lines.push(`Poisson Probs: 1=${Math.round(fe.poissonProbs.hw * 100)}% X=${Math.round(fe.poissonProbs.d * 100)}% 2=${Math.round(fe.poissonProbs.aw * 100)}%`);
        lines.push(`BTTS Prob: ${Math.round(fe.bttsProb * 100)}% | Over 2.5 Prob: ${Math.round(fe.over25Prob * 100)}%`);
        lines.push(`Most Likely Score: ${fe.mostLikelyScore.h}-${fe.mostLikelyScore.a} (${Math.round(fe.mostLikelyScore.prob * 100)}%)`);
      }
      if (match.homeAvgGoalsScored !== null && match.homeAvgGoalsScored !== undefined) {
        lines.push(`Avg Goals/Game: ${match.homeTeam}=${match.homeAvgGoalsScored?.toFixed(2)} scored, ${match.homeAvgGoalsConceded?.toFixed(2)} conceded`);
        lines.push(`Avg Goals/Game: ${match.awayTeam}=${match.awayAvgGoalsScored?.toFixed(2)} scored, ${match.awayAvgGoalsConceded?.toFixed(2)} conceded`);
      }
    }
  }

  // Market
  if (match.homeOdds && match.awayOdds) {
    const market = computeMarketIntelligence(match.homeOdds, match.drawOdds, match.awayOdds, match.oddsOver25, match.oddsUnder25);
    if (market) {
      lines.push(`Market Odds: 1=${match.homeOdds.toFixed(2)} X=${match.drawOdds?.toFixed(2) ?? 'N/A'} 2=${match.awayOdds.toFixed(2)}`);
      lines.push(`Market Implied: 1=${market.impliedHomeWin}% X=${market.impliedDraw}% 2=${market.impliedAwayWin}% | Vig=${market.vig}%`);
      lines.push(`Market Favourite: ${market.favourite.toUpperCase()} | OU Favour: ${market.overUnderFavour}`);
      if (match.oddsOver25 && match.oddsUnder25) lines.push(`OU Odds: O2.5=${match.oddsOver25.toFixed(2)} U2.5=${match.oddsUnder25.toFixed(2)}`);
      if (match.oddsBttsYes && match.oddsBttsNo) lines.push(`BTTS Odds: Yes=${match.oddsBttsYes.toFixed(2)} No=${match.oddsBttsNo.toFixed(2)}`);
    }
  }

  // H2H
  if (match.h2hHomeWins !== null && match.h2hHomeWins !== undefined) {
    const total = (match.h2hHomeWins ?? 0) + (match.h2hDraws ?? 0) + (match.h2hAwayWins ?? 0);
    lines.push(`H2H (last ${total}): ${match.homeTeam} ${match.h2hHomeWins}W-${match.h2hDraws ?? 0}D-${match.h2hAwayWins ?? 0}L`);
  }

  // Players
  if (match.homeTopScorer) lines.push(`${match.homeTeam} Top Scorer: ${match.homeTopScorer.name} (${match.homeTopScorer.goals}G)`);
  if (match.awayTopScorer) lines.push(`${match.awayTeam} Top Scorer: ${match.awayTopScorer.name} (${match.awayTopScorer.goals}G)`);
  if ((match.homeSuspensionCount ?? 0) > 0) lines.push(`⚠️ ${match.homeTeam}: ${match.homeSuspensionCount} suspension risk(s)`);
  if ((match.awaySuspensionCount ?? 0) > 0) lines.push(`⚠️ ${match.awayTeam}: ${match.awaySuspensionCount} suspension risk(s)`);

  lines.push('── END SUMMARY ──');
  return lines.join('\n');
}
