/**
 * services/sportEngines.ts
 *
 * Client-side statistical engines for sport-specific UI rendering.
 * These provide data-driven values for Stats/Overview tabs without requiring
 * an AI call — they derive from data already in the DB (form, standings, etc.)
 *
 * Engines:
 *  - Football: Poisson, ELO, xG derivation
 *  - Basketball: Pace/ORtg/DRtg efficiency
 *  - Tennis: ATP rank proxy, surface win estimation
 *  - Cricket: Run rate projection
 *  - Baseball: ERA/WHIP pitching quality
 *  - Universal: Form score, confidence engine
 */

// ─── Poisson PMF ──────────────────────────────────────────────────────────────
export function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

/**
 * Compute win/draw/loss probabilities from two Poisson lambdas.
 * Returns values as fractions (0-1).
 */
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

/**
 * Derive Poisson expected goals from goals scored/conceded per game.
 */
export function deriveExpectedGoals(
  homeGoalsScored: number,
  homeGoalsConceded: number,
  awayGoalsScored: number,
  awayGoalsConceded: number,
  gamesPlayed = 20,
  leagueAvgGoals = 2.6,
): { lambdaH: number; lambdaA: number } {
  const gpSafe = Math.max(1, gamesPlayed);
  const avg = leagueAvgGoals / 2;
  const homeAtk  = (homeGoalsScored  / gpSafe) / avg;
  const homeDef  = (homeGoalsConceded / gpSafe) / avg;
  const awayAtk  = (awayGoalsScored  / gpSafe) / avg;
  const awayDef  = (awayGoalsConceded / gpSafe) / avg;
  const homeAdv  = 1.25;
  return {
    lambdaH: Math.max(0.3, homeAtk * awayDef  * avg * homeAdv),
    lambdaA: Math.max(0.2, awayAtk * homeDef  * avg),
  };
}

// ─── ELO Engine ───────────────────────────────────────────────────────────────
export function eloWinProb(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

export function posToElo(pos: number, totalTeams = 20): number {
  const base   = 1700;
  const spread = 300;
  return Math.round(base + ((totalTeams - pos) / Math.max(totalTeams - 1, 1)) * spread);
}

// ─── Form Score (0-100) ───────────────────────────────────────────────────────
export function formScore(form: string[]): number {
  if (!form || form.length === 0) return 50;
  const weights = [2, 1.6, 1.4, 1.2, 1];
  const recent = form.slice(-5).reverse();
  let tot = 0, wSum = 0;
  recent.forEach((r, i) => {
    const w = weights[Math.min(i, weights.length - 1)];
    const pts = r.toUpperCase() === 'W' ? 3 : r.toUpperCase() === 'D' ? 1 : 0;
    tot += pts * w; wSum += 3 * w;
  });
  return Math.round((tot / wSum) * 100);
}

// ─── Market-Implied Probabilities ─────────────────────────────────────────────
export function marketImplied(
  homeOdds?: number | null,
  drawOdds?: number | null,
  awayOdds?: number | null,
): { hw: number; d: number; aw: number } | null {
  if (!homeOdds || !awayOdds) return null;
  const rawHW = 100 / homeOdds;
  const rawD  = drawOdds ? 100 / drawOdds : 0;
  const rawAW = 100 / awayOdds;
  const total = rawHW + rawD + rawAW || 1;
  return {
    hw: Math.round((rawHW / total) * 100),
    d:  Math.round((rawD  / total) * 100),
    aw: Math.round((rawAW / total) * 100),
  };
}

// ─── Basketball Efficiency Engine ─────────────────────────────────────────────
export interface BasketballProjection {
  homeTotal: number;
  awayTotal: number;
  totalPoints: number;
  paceLabel: 'fast' | 'moderate' | 'slow';
}

export function basketballProjection(
  homePace: number, awayPace: number,
  homeORtg: number, awayORtg: number,
  homeDRtg: number, awayDRtg: number,
): BasketballProjection {
  const pace = (homePace + awayPace) / 2;
  const poss = pace * 0.48;
  const homeTotal = Math.round((homeORtg / 100) * poss * (100 / (awayDRtg || 110)));
  const awayTotal = Math.round((awayORtg / 100) * poss * (100 / (homeDRtg || 112)));
  const paceLabel: 'fast' | 'moderate' | 'slow' = pace > 102 ? 'fast' : pace > 97 ? 'moderate' : 'slow';
  return { homeTotal, awayTotal, totalPoints: homeTotal + awayTotal, paceLabel };
}

// ─── Tennis Engine ────────────────────────────────────────────────────────────
export interface TennisAnalysis {
  homeWinProb: number;
  awayWinProb: number;
  dominance: 'home' | 'away' | 'even';
  rankAdvantage: number; // positive = home advantage in ELO points
}

export function tennisAnalysis(
  homeRank: number, awayRank: number,
  homeServeWinPct = 60, awayServeWinPct = 60,
  homeSurfaceWinPct = 50, awaySurfaceWinPct = 50,
): TennisAnalysis {
  // Rank → ELO proxy (rank 1 ≈ 2000, each rank loses ~3 points)
  const homeElo = Math.max(1000, 2000 - (homeRank - 1) * 3.5);
  const awayElo  = Math.max(1000, 2000 - (awayRank  - 1) * 3.5);
  const eloAdv    = homeElo - awayElo;
  let homeWin = eloWinProb(eloAdv);
  // Adjust for serve and surface
  homeWin += (homeServeWinPct - awayServeWinPct) / 1000;
  homeWin += (homeSurfaceWinPct - awaySurfaceWinPct) / 1000;
  homeWin = Math.min(0.88, Math.max(0.12, homeWin));
  return {
    homeWinProb: Math.round(homeWin * 100),
    awayWinProb: Math.round((1 - homeWin) * 100),
    dominance: homeWin > 0.58 ? 'home' : homeWin < 0.42 ? 'away' : 'even',
    rankAdvantage: Math.round(eloAdv),
  };
}

// ─── Cricket Run Rate Engine ──────────────────────────────────────────────────
export interface CricketProjection {
  homeProjectedRuns: number;
  awayProjectedRuns: number;
  totalProjected: number;
  homeWinProb: number;
}

export function cricketProjection(
  homeRunRate: number, awayRunRate: number,
  overs = 20, // T20 = 20, ODI = 50
): CricketProjection {
  const homeProj = Math.round(homeRunRate * overs);
  const awayProj = Math.round(awayRunRate * overs);
  const total    = homeProj + awayProj;
  const homeWin  = total > 0 ? Math.round((homeProj / total) * 100) : 50;
  return { homeProjectedRuns: homeProj, awayProjectedRuns: awayProj, totalProjected: total, homeWinProb: homeWin };
}

// ─── Baseball Pitching Engine ─────────────────────────────────────────────────
export interface BaseballPitchingEdge {
  homeEdge: number;  // positive = home pitching advantage (0-100 scale)
  awayEdge: number;
  runLineEdge: 'home' | 'away' | 'neutral';
}

export function baseballPitchingEdge(
  homeERA: number, awayERA: number,
  homeWHIP: number, awayWHIP: number,
): BaseballPitchingEdge {
  // Lower ERA/WHIP = better. Normalise to 0-100 advantage score.
  const eraEdge  = (awayERA  - homeERA)  * 10;
  const whipEdge = (awayWHIP - homeWHIP) * 20;
  const homeEdgeRaw = Math.min(50, Math.max(-50, eraEdge + whipEdge));
  return {
    homeEdge: Math.round(50 + homeEdgeRaw),
    awayEdge: Math.round(50 - homeEdgeRaw),
    runLineEdge: homeEdgeRaw > 5 ? 'home' : homeEdgeRaw < -5 ? 'away' : 'neutral',
  };
}

// ─── Confidence Engine ────────────────────────────────────────────────────────
export interface ConfidenceOutput {
  score: number;         // 0-100
  ceiling: number;       // max allowed by data quality
  tier: 'elite' | 'high' | 'moderate' | 'speculative' | 'low';
  label: string;
  color: string;
}

export function computeConfidence(
  rawConfidence: number,
  dqScore: number,
  hasFormData: boolean,
  hasH2H: boolean,
  hasOdds: boolean,
): ConfidenceOutput {
  let ceiling = 95;
  if (dqScore < 30) ceiling = 55;
  else if (dqScore < 50) ceiling = 68;
  else if (dqScore < 70) ceiling = 82;

  // Adjustments
  let adj = rawConfidence;
  if (!hasFormData) adj = Math.min(adj, ceiling - 5);
  if (!hasH2H)     adj = Math.min(adj, ceiling - 2);
  if (!hasOdds)    adj = Math.min(adj, ceiling - 3);

  const score = Math.min(ceiling, Math.max(40, Math.round(adj)));

  let tier: ConfidenceOutput['tier'];
  let label: string;
  let color: string;
  if (score >= 85) { tier = 'elite';       label = 'Elite';       color = '#22C55E'; }
  else if (score >= 75) { tier = 'high';   label = 'High';        color = '#84CC16'; }
  else if (score >= 65) { tier = 'moderate'; label = 'Moderate';  color = '#F59E0B'; }
  else if (score >= 50) { tier = 'speculative'; label = 'Speculative'; color = '#EF4444'; }
  else { tier = 'low'; label = 'Low'; color = '#9CA3AF'; }

  return { score, ceiling, tier, label, color };
}

// ─── Data Quality Score ───────────────────────────────────────────────────────
export interface DQScore {
  score: number;
  breakdown: Record<string, number>;
  hasSufficientData: boolean;
}

export function computeDataQualityScore(match: {
  homeTeam?: string; awayTeam?: string; league?: string;
  homeForm?: string[]; awayForm?: string[];
  h2h?: unknown[]; homeStandingsPos?: number; awayStandingsPos?: number;
  homeGoalsScored?: number; awayGoalsScored?: number;
  homeOdds?: number; awayOdds?: number;
  injuries?: unknown[]; stats?: unknown;
}): DQScore {
  const breakdown: Record<string, number> = {};
  let s = 35;
  if (match.homeTeam && match.awayTeam) { breakdown.teams = 5; s += 5; }
  if (match.league) { breakdown.league = 3; s += 3; }
  if (match.homeForm?.length && match.homeForm.length >= 3) { breakdown.homeForm = 10; s += 10; }
  if (match.awayForm?.length && match.awayForm.length >= 3) { breakdown.awayForm = 10; s += 10; }
  if (match.h2h?.length && match.h2h.length >= 2) { breakdown.h2h = 10; s += 10; }
  if (match.homeStandingsPos && match.awayStandingsPos) { breakdown.standings = 8; s += 8; }
  if (match.homeGoalsScored !== undefined && match.awayGoalsScored !== undefined) { breakdown.seasonGoals = 8; s += 8; }
  if (match.homeOdds && match.awayOdds) { breakdown.odds = 10; s += 10; }
  if (match.injuries?.length) { breakdown.injuries = 4; s += 4; }
  if (match.stats && Object.keys(match.stats as object).length > 0) { breakdown.liveStats = 5; s += 5; }
  const score = Math.min(100, s);
  return { score, breakdown, hasSufficientData: score >= 40 };
}

/**
 * sportAwarePredChips — lightweight helper consumed by match/[id].tsx PredictionTab.
 * Returns the sport-correct chip data without importing the full sportConfig module
 * (avoids the 256KB file-size constraint).
 */
export function sportAwarePredChips(sport: string, prediction: {
  predictedResult?: string | null;
  overUnder?: string | null;
  overUnderLine?: number | null;
  btts?: string | null;
  htResult?: string | null;
  correctScore?: string | null;
  asianHandicapLine?: number | null;
  asianHandicapPick?: string | null;
}, homeTeam: string, awayTeam: string): Array<{ label: string; value: string; color: string; colorHex: string }> {
  const s = (sport ?? '').toLowerCase().replace(/[_\s-]+/g, '');
  const isFball = s === 'football' || s === 'soccer';
  const isBball = s === 'basketball';
  const isTennis = s === 'tennis' || s === 'volleyball';
  const isMMA = s === 'mma' || s === 'boxing' || s === 'ufc';
  const isRugby = s.includes('rugby');
  const isHandball = s === 'handball';
  const showDraw = isFball || isRugby || isHandball;

  const chips: Array<{ label: string; value: string; color: string; colorHex: string }> = [];

  // Result chip
  if (prediction.predictedResult) {
    const resVal = prediction.predictedResult === 'home_win'
      ? (isFball || isRugby || isHandball ? '1 Home Win' : `${homeTeam.split(' ').slice(-1)[0]} Win`)
      : prediction.predictedResult === 'draw'
      ? (isFball || isRugby || isHandball ? 'X Draw' : 'Draw')
      : (isFball || isRugby || isHandball ? '2 Away Win' : `${awayTeam.split(' ').slice(-1)[0]} Win`);
    chips.push({ label: 'Result', value: resVal, color: 'primary', colorHex: '#6EDC1F' });
  }

  // Over/Under (never for MMA/Boxing)
  if (!isMMA && prediction.overUnder && prediction.overUnderLine) {
    const unit = isBball ? 'Pts' : isTennis ? 'Sets' : s === 'baseball' || s === 'cricket' ? 'Runs' : s === 'americanfootball' || s === 'nfl' ? 'Pts' : 'Goals';
    chips.push({
      label: `O/U ${prediction.overUnderLine} ${unit}`,
      value: prediction.overUnder.toUpperCase(),
      color: prediction.overUnder === 'over' ? 'accentGreen' : 'accentRed',
      colorHex: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444',
    });
  }

  // BTTS — FOOTBALL AND HANDBALL ONLY
  if ((isFball || isHandball) && prediction.btts) {
    chips.push({
      label: 'BTTS',
      value: prediction.btts.toUpperCase(),
      color: prediction.btts === 'yes' ? 'accentTeal' : 'accentOrange',
      colorHex: prediction.btts === 'yes' ? '#14B8A6' : '#F97316',
    });
  }

  // MMA/Boxing: method of victory
  if (isMMA && prediction.htResult) {
    chips.push({
      label: 'Method',
      value: prediction.htResult === 'home_win' ? 'KO / TKO' : prediction.htResult === 'draw' ? 'Decision' : 'Submission',
      color: 'accentRed',
      colorHex: '#EF4444',
    });
  }

  // Tennis/Volleyball: set score
  if (isTennis && prediction.correctScore) {
    chips.push({ label: 'Set Score', value: prediction.correctScore, color: 'accentBlue', colorHex: '#38BDF8' });
  }

  // Basketball/NFL: spread
  if ((isBball || s === 'americanfootball') && prediction.asianHandicapPick && prediction.asianHandicapLine != null) {
    const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
    const label = isBball ? 'Spread' : 'ATS';
    chips.push({
      label,
      value: `${prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0]} ${sign}${prediction.asianHandicapLine}`,
      color: 'accentPurple',
      colorHex: '#8B5CF6',
    });
  }

  return chips;
}
export interface PredictionMarket {
  id: string;
  label: string;
  sublabel?: string;
  value: string;
  probability?: number;  // 0-100
  confidence?: number;   // 0-100
  color: string;
  emoji?: string;
}

/**
 * Build sport-specific prediction market chips from a prediction object.
 * Returns only markets relevant to the sport.
 */
export function buildPredictionMarkets(
  sport: string,
  prediction: {
    predictedResult?: string | null;
    homeWinProb?: number | null;
    drawProb?: number | null;
    awayWinProb?: number | null;
    overUnder?: string | null;
    overUnderLine?: number | null;
    predictedHomeGoals?: number | null;
    predictedAwayGoals?: number | null;
    btts?: string | null;
    cornersOverUnder?: string | null;
    cornersLine?: number | null;
    cardsTotal?: number | null;
    cardsOverUnder?: string | null;
    asianHandicapLine?: number | null;
    asianHandicapPick?: string | null;
    htResult?: string | null;
    htHomeProb?: number | null;
    htDrawProb?: number | null;
    htAwayProb?: number | null;
    cleanSheetHome?: string | null;
    cleanSheetAway?: string | null;
    firstGoal?: string | null;
    bothScoreHt?: string | null;
    anytimeScorecast?: string | null;
    correctScore?: string | null;
    confidence?: number | null;
    riskLevel?: string | null;
    valueScore?: number | null;
    marketEdgePct?: number | null;
  },
  homeTeam: string,
  awayTeam: string,
  colors: { primary: string; accent: string; accentBlue: string; accentRed: string; textMuted: string },
): PredictionMarket[] {
  const s = sport.toLowerCase();
  const markets: PredictionMarket[] = [];

  // ── Universal: Match Result ─────────────────────────────────────────────────
  if (prediction.predictedResult) {
    const resLabel = prediction.predictedResult === 'home_win' ? '1 Home Win'
      : prediction.predictedResult === 'away_win' ? '2 Away Win' : 'X Draw';
    const resProb = prediction.predictedResult === 'home_win' ? prediction.homeWinProb
      : prediction.predictedResult === 'away_win' ? prediction.awayWinProb : prediction.drawProb;
    markets.push({ id: 'result', label: 'RESULT', value: resLabel, probability: resProb ?? undefined, color: colors.primary, emoji: '🏆' });
  }

  // ── Football-specific ───────────────────────────────────────────────────────
  if (s === 'football' || s === 'soccer') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Goals`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '⚽' });
    }
    if (prediction.btts) {
      markets.push({ id: 'btts', label: 'BTTS', value: prediction.btts.toUpperCase(), color: prediction.btts === 'yes' ? '#14B8A6' : '#F97316', emoji: '🎯' });
    }
    if (prediction.correctScore) {
      markets.push({ id: 'cs', label: 'CORRECT SCORE', value: prediction.correctScore, color: colors.accentBlue, emoji: '🔢' });
    }
    if (prediction.htResult) {
      const htLabel = prediction.htResult === 'home_win' ? '1 Home' : prediction.htResult === 'away_win' ? '2 Away' : 'X Draw';
      markets.push({ id: 'ht', label: 'HALF TIME', value: htLabel, probability: prediction.htResult === 'home_win' ? (prediction.htHomeProb ?? undefined) : prediction.htResult === 'away_win' ? (prediction.htAwayProb ?? undefined) : (prediction.htDrawProb ?? undefined), color: '#A855F7', emoji: '⏱️' });
    }
    if (prediction.cornersOverUnder && prediction.cornersLine) {
      markets.push({ id: 'corners', label: `CORNERS ${prediction.cornersLine}`, value: prediction.cornersOverUnder.toUpperCase(), color: '#4ECDC4', emoji: '🚩' });
    }
    if (prediction.cardsOverUnder && prediction.cardsTotal) {
      markets.push({ id: 'cards', label: `CARDS ${prediction.cardsTotal}`, value: prediction.cardsOverUnder.toUpperCase(), color: '#EAB308', emoji: '🟨' });
    }
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({ id: 'ah', label: `AH ${sign}${prediction.asianHandicapLine ?? 0}`, value: prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#8B5CF6', emoji: '🎱' });
    }
    if (prediction.firstGoal) {
      const fgLabel = prediction.firstGoal === 'home' ? homeTeam.split(' ').slice(-1)[0] : prediction.firstGoal === 'away' ? awayTeam.split(' ').slice(-1)[0] : 'No Goal';
      markets.push({ id: 'first_goal', label: 'FIRST GOAL', value: fgLabel, color: '#F97316', emoji: '🥇' });
    }
    if (prediction.cleanSheetHome) {
      markets.push({ id: 'cs_home', label: 'HOME CLEAN SHEET', value: prediction.cleanSheetHome.toUpperCase(), color: prediction.cleanSheetHome === 'yes' ? '#22C55E' : '#EF4444', emoji: '🧤' });
    }
    if (prediction.predictedHomeGoals !== null && prediction.predictedHomeGoals !== undefined) {
      markets.push({ id: 'xg', label: 'xG', value: `${(prediction.predictedHomeGoals ?? 0).toFixed(1)} - ${(prediction.predictedAwayGoals ?? 0).toFixed(1)}`, color: colors.textMuted, emoji: '📊' });
    }
    if (prediction.anytimeScorecast) {
      markets.push({ id: 'scorecast', label: 'SCORECAST', value: prediction.anytimeScorecast, color: colors.primary, emoji: '⭐' });
    }
  }

  // ── Basketball-specific ──────────────────────────────────────────────────────
  if (s === 'basketball') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Pts`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🏀' });
    }
    if (prediction.predictedHomeGoals && prediction.predictedAwayGoals) {
      markets.push({ id: 'proj', label: 'PROJECTED', value: `${Math.round(prediction.predictedHomeGoals)} - ${Math.round(prediction.predictedAwayGoals)}`, color: colors.accentBlue, emoji: '📈' });
    }
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({ id: 'spread', label: `SPREAD ${sign}${prediction.asianHandicapLine ?? 0}`, value: prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#8B5CF6', emoji: '🎯' });
    }
    if (prediction.htResult) {
      const htLabel = prediction.htResult === 'home_win' ? '1H Home' : '1H Away';
      markets.push({ id: 'ht', label: '1ST HALF', value: htLabel, probability: prediction.htResult === 'home_win' ? (prediction.htHomeProb ?? undefined) : (prediction.htAwayProb ?? undefined), color: '#A855F7', emoji: '⏱️' });
    }
  }

  // ── Tennis-specific ──────────────────────────────────────────────────────────
  if (s === 'tennis') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Sets`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🎾' });
    }
    if (prediction.correctScore) {
      markets.push({ id: 'sets', label: 'SET SCORE', value: prediction.correctScore, color: colors.accentBlue, emoji: '🔢' });
    }
    if (prediction.firstGoal) {
      markets.push({ id: 'first_set', label: 'FIRST SET', value: prediction.firstGoal === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#F97316', emoji: '🥇' });
    }
  }

  // ── Cricket-specific ──────────────────────────────────────────────────────────
  if (s === 'cricket') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Runs`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🏏' });
    }
    if (prediction.predictedHomeGoals) {
      markets.push({ id: 'team_runs', label: 'TEAM RUNS', value: `${homeTeam.split(' ').slice(-1)[0]}: ~${Math.round((prediction.predictedHomeGoals ?? 0))} | ${awayTeam.split(' ').slice(-1)[0]}: ~${Math.round((prediction.predictedAwayGoals ?? 0))}`, color: colors.accentBlue, emoji: '📊' });
    }
  }

  // ── Baseball-specific ──────────────────────────────────────────────────────────
  if (s === 'baseball') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Runs`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '⚾' });
    }
    if (prediction.predictedHomeGoals && prediction.predictedAwayGoals) {
      markets.push({ id: 'proj', label: 'RUN LINE', value: `${homeTeam.split(' ').slice(-1)[0]}: ${(prediction.predictedHomeGoals ?? 0).toFixed(1)} | ${awayTeam.split(' ').slice(-1)[0]}: ${(prediction.predictedAwayGoals ?? 0).toFixed(1)}`, color: colors.accentBlue, emoji: '📈' });
    }
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({ id: 'rl', label: `RUN LINE ${sign}${prediction.asianHandicapLine ?? -1.5}`, value: prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#8B5CF6', emoji: '🎯' });
    }
  }

  // ── Hockey-specific ─────────────────────────────────────────────────────────
  if (s === 'hockey') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Goals`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🏒' });
    }
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({ id: 'puck', label: `PUCK LINE ${sign}${prediction.asianHandicapLine ?? -1.5}`, value: prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#8B5CF6', emoji: '🎯' });
    }
  }

  // ── Rugby-specific ───────────────────────────────────────────────────────────
  if (s === 'rugby' || s === 'rugby_union' || s === 'rugby_league' || s.includes('rugby')) {
    // Total Points O/U
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Pts`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🏉' });
    }

    // Total Tries O/U — derive from predicted goals (each try ≈ 1 unit)
    if (prediction.predictedHomeGoals !== null && prediction.predictedHomeGoals !== undefined &&
        prediction.predictedAwayGoals !== null && prediction.predictedAwayGoals !== undefined) {
      const totalTries = (prediction.predictedHomeGoals ?? 0) + (prediction.predictedAwayGoals ?? 0);
      const triesLine = Math.round(totalTries * 2) / 2; // round to nearest 0.5
      const triesOverProb = Math.round(55 + (totalTries - triesLine) * 20);
      markets.push({
        id: 'tries_ou',
        label: `TRIES O/U ${triesLine}`,
        value: totalTries >= triesLine ? 'OVER' : 'UNDER',
        probability: Math.min(80, Math.max(40, triesOverProb)),
        color: totalTries >= triesLine ? '#22C55E' : '#EF4444',
        emoji: '🏉',
      });
    }

    // Both Teams to Score a Try
    if (prediction.btts) {
      markets.push({
        id: 'both_try',
        label: 'BOTH SCORE TRY',
        value: prediction.btts.toUpperCase(),
        probability: prediction.btts === 'yes' ? 72 : 28,
        color: prediction.btts === 'yes' ? '#14B8A6' : '#F97316',
        emoji: '🎯',
      });
    } else {
      // Derive BTTS-try from win probabilities — if close match, both likely to score
      const hwp = prediction.homeWinProb ?? 50;
      const awp = prediction.awayWinProb ?? 50;
      const balance = 100 - Math.abs(hwp - awp);
      const bothTryProb = Math.round(40 + balance * 0.35);
      markets.push({
        id: 'both_try',
        label: 'BOTH SCORE TRY',
        value: bothTryProb >= 55 ? 'YES' : 'NO',
        probability: bothTryProb >= 55 ? bothTryProb : 100 - bothTryProb,
        color: bothTryProb >= 55 ? '#14B8A6' : '#F97316',
        emoji: '🎯',
      });
    }

    // Winning Margin bands — derived from win probabilities
    const hwProb = prediction.homeWinProb ?? 50;
    const awProb = prediction.awayWinProb ?? 30;
    const leadingTeamProb = Math.max(hwProb, awProb);
    const leadingTeam = hwProb >= awProb
      ? homeTeam.split(' ').slice(-1)[0]
      : awayTeam.split(' ').slice(-1)[0];
    // Wider margin more likely when one team dominates
    const margin1to12  = Math.round(30 + (100 - leadingTeamProb) * 0.4);  // close game
    const margin13to24 = Math.round(35 + (leadingTeamProb - 50) * 0.2);   // comfortable win
    const margin25plus = Math.round(Math.max(10, (leadingTeamProb - 65) * 1.2)); // blowout
    const [bestBand, bestProb] = [
      ['1-12 pts', margin1to12],
      ['13-24 pts', margin13to24],
      ['25+ pts', margin25plus],
    ].sort((a, b) => (b[1] as number) - (a[1] as number))[0] as [string, number];
    markets.push({
      id: 'win_margin',
      label: `${leadingTeam} MARGIN`,
      value: bestBand,
      probability: Math.min(65, Math.max(25, bestProb)),
      color: '#8B5CF6',
      emoji: '📏',
    });

    // First Try Scorer — use firstGoal field if available, else derive
    const firstTryTeam = prediction.firstGoal === 'home'
      ? homeTeam.split(' ').slice(-1)[0]
      : prediction.firstGoal === 'away'
        ? awayTeam.split(' ').slice(-1)[0]
        : hwProb >= awProb
          ? homeTeam.split(' ').slice(-1)[0]
          : awayTeam.split(' ').slice(-1)[0];
    const firstTryProb = prediction.firstGoal
      ? (prediction.firstGoal === 'home' ? (hwProb ?? 55) : (awProb ?? 45))
      : Math.round(Math.max(hwProb, awProb));
    markets.push({
      id: 'first_try',
      label: 'FIRST TRY',
      value: firstTryTeam,
      probability: Math.min(75, Math.max(35, Math.round(firstTryProb))),
      color: '#F59E0B',
      emoji: '🥇',
    });

    // Handicap if available
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({
        id: 'hcp',
        label: `HANDICAP ${sign}${prediction.asianHandicapLine ?? 0}`,
        value: prediction.asianHandicapPick === 'home'
          ? homeTeam.split(' ').slice(-1)[0]
          : awayTeam.split(' ').slice(-1)[0],
        color: '#A78BFA',
        emoji: '🎱',
      });
    }
  }

  // ── MMA/Boxing-specific ──────────────────────────────────────────────────────
  if (s === 'mma' || s === 'boxing') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Rounds`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🥊' });
    }
    if (prediction.htResult) {
      markets.push({ id: 'finish', label: 'FINISH METHOD', value: prediction.htResult === 'home_win' ? 'KO/TKO' : prediction.htResult === 'draw' ? 'DECISION' : 'SUBMISSION', color: '#EF4444', emoji: '⚡' });
    }
  }

  // ── Esports-specific ─────────────────────────────────────────────────────────
  if (s === 'esports') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Maps`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🎮' });
    }
    if (prediction.asianHandicapPick && prediction.asianHandicapLine !== null) {
      const sign = (prediction.asianHandicapLine ?? 0) > 0 ? '+' : '';
      markets.push({ id: 'mapHcp', label: `MAP HCP ${sign}${prediction.asianHandicapLine ?? 0}`, value: prediction.asianHandicapPick === 'home' ? homeTeam.split(' ').slice(-1)[0] : awayTeam.split(' ').slice(-1)[0], color: '#8B5CF6', emoji: '🗺️' });
    }
  }

  // ── Volleyball-specific ──────────────────────────────────────────────────────
  if (s === 'volleyball') {
    if (prediction.overUnder && prediction.overUnderLine) {
      markets.push({ id: 'ou', label: `O/U ${prediction.overUnderLine} Sets`, value: prediction.overUnder.toUpperCase(), color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444', emoji: '🏐' });
    }
    if (prediction.correctScore) {
      markets.push({ id: 'setScore', label: 'SET SCORE', value: prediction.correctScore, color: colors.accentBlue, emoji: '🔢' });
    }
  }

  return markets;
}

// ─── Sport-specific stats layout config ─────────────────────────────────────
export interface SportStatsLayout {
  sections: Array<{
    title: string;
    stats: Array<{
      label: string;
      homeKey: string;   // key in LiveMatchStats or custom
      awayKey: string;
      format?: (v: number) => string;
      higherIsBetter?: boolean; // true = higher value highlighted
      reverseHighlight?: boolean; // true = lower value highlighted (e.g. fouls)
    }>;
  }>;
}

export function getSportStatsLayout(sport: string): SportStatsLayout {
  const s = sport.toLowerCase();

  if (s === 'basketball') {
    return {
      sections: [
        { title: 'SCORING', stats: [
          { label: 'Points', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Field Goals %', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: '3-Pointers', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
          { label: 'Free Throws', homeKey: 'homePasses', awayKey: 'awayPasses', higherIsBetter: true },
        ]},
        { title: 'EFFICIENCY', stats: [
          { label: 'Offensive Rating', homeKey: 'homeXG', awayKey: 'awayXG', format: (v) => v.toFixed(1), higherIsBetter: true },
          { label: 'Defensive Rating', homeKey: 'homePossession', awayKey: 'awayPossession', higherIsBetter: false, reverseHighlight: true },
          { label: 'Rebounds', homeKey: 'homeYellowCards', awayKey: 'awayYellowCards', higherIsBetter: true },
          { label: 'Assists', homeKey: 'homeRedCards', awayKey: 'awayRedCards', higherIsBetter: true },
          { label: 'Turnovers', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'tennis') {
    return {
      sections: [
        { title: 'SERVE', stats: [
          { label: '1st Serve %', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Service Win %', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Aces', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Double Faults', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
        { title: 'RETURN', stats: [
          { label: 'Return Win %', homeKey: 'homePassAccuracy', awayKey: 'awayPassAccuracy', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Break Points Won', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
          { label: 'Winners', homeKey: 'homePasses', awayKey: 'awayPasses', higherIsBetter: true },
          { label: 'Unforced Errors', homeKey: 'homeYellowCards', awayKey: 'awayYellowCards', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'cricket') {
    return {
      sections: [
        { title: 'BATTING', stats: [
          { label: 'Runs Scored', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Wickets Lost', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
          { label: 'Run Rate', homeKey: 'homeXG', awayKey: 'awayXG', format: (v) => v.toFixed(2), higherIsBetter: true },
          { label: 'Strike Rate', homeKey: 'homePassAccuracy', awayKey: 'awayPassAccuracy', format: (v) => v.toFixed(1), higherIsBetter: true },
        ]},
        { title: 'BOWLING', stats: [
          { label: 'Economy Rate', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => v.toFixed(2), higherIsBetter: false, reverseHighlight: true },
          { label: 'Wickets Taken', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: 'Extras', homeKey: 'homeYellowCards', awayKey: 'awayYellowCards', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'baseball') {
    return {
      sections: [
        { title: 'PITCHING', stats: [
          { label: 'ERA', homeKey: 'homeXG', awayKey: 'awayXG', format: (v) => v.toFixed(2), higherIsBetter: false, reverseHighlight: true },
          { label: 'Strikeouts', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Walks', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
        { title: 'BATTING', stats: [
          { label: 'Hits', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: 'Home Runs', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
          { label: 'Batting Avg', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => `.${String(Math.round(v)).padStart(3, '0')}`, higherIsBetter: true },
          { label: 'RBI', homeKey: 'homePasses', awayKey: 'awayPasses', higherIsBetter: true },
          { label: 'Strikeouts (bat)', homeKey: 'homeYellowCards', awayKey: 'awayYellowCards', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'hockey') {
    return {
      sections: [
        { title: 'SHOTS', stats: [
          { label: 'Shots on Goal', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: 'Total Shots', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
        ]},
        { title: 'POSSESSION', stats: [
          { label: 'Faceoffs Won', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Power Play', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
          { label: 'Penalty Minutes', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'rugby') {
    return {
      sections: [
        { title: 'ATTACK', stats: [
          { label: 'Tries Scored', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Conversions', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: 'Line Breaks', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
        ]},
        { title: 'POSSESSION', stats: [
          { label: 'Possession', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Territory', homeKey: 'homePassAccuracy', awayKey: 'awayPassAccuracy', format: (v) => `${v}%`, higherIsBetter: true },
          { label: 'Tackles', homeKey: 'homePasses', awayKey: 'awayPasses', higherIsBetter: true },
          { label: 'Penalties', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  if (s === 'handball' || s === 'volleyball') {
    return {
      sections: [
        { title: 'ATTACK', stats: [
          { label: 'Goals / Points', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
          { label: 'Shots on Target', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
          { label: 'Efficiency %', homeKey: 'homePassAccuracy', awayKey: 'awayPassAccuracy', format: (v) => `${v}%`, higherIsBetter: true },
        ]},
        { title: 'DEFENCE', stats: [
          { label: 'Saves', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
          { label: 'Turnovers', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
        ]},
      ],
    };
  }

  // Default: Football layout
  return {
    sections: [
      { title: 'PERFORMANCE', stats: [
        { label: 'Possession', homeKey: 'homePossession', awayKey: 'awayPossession', format: (v) => `${v}%`, higherIsBetter: true },
        { label: 'Total Shots', homeKey: 'homeShots', awayKey: 'awayShots', higherIsBetter: true },
        { label: 'Shots on Target', homeKey: 'homeShotsOnTarget', awayKey: 'awayShotsOnTarget', higherIsBetter: true },
        { label: 'xG', homeKey: 'homeXG', awayKey: 'awayXG', format: (v) => v.toFixed(2), higherIsBetter: true },
      ]},
      { title: 'PASSING', stats: [
        { label: 'Total Passes', homeKey: 'homePasses', awayKey: 'awayPasses', higherIsBetter: true },
        { label: 'Pass Accuracy', homeKey: 'homePassAccuracy', awayKey: 'awayPassAccuracy', format: (v) => `${v}%`, higherIsBetter: true },
      ]},
      { title: 'SET PIECES', stats: [
        { label: 'Corners', homeKey: 'homeCorners', awayKey: 'awayCorners', higherIsBetter: true },
        { label: 'Offsides', homeKey: 'homeOffsides', awayKey: 'awayOffsides', higherIsBetter: false, reverseHighlight: true },
      ]},
      { title: 'DISCIPLINE', stats: [
        { label: 'Yellow Cards', homeKey: 'homeYellowCards', awayKey: 'awayYellowCards', higherIsBetter: false, reverseHighlight: true },
        { label: 'Red Cards', homeKey: 'homeRedCards', awayKey: 'awayRedCards', higherIsBetter: false, reverseHighlight: true },
        { label: 'Fouls', homeKey: 'homeFouls', awayKey: 'awayFouls', higherIsBetter: false, reverseHighlight: true },
      ]},
    ],
  };
}
