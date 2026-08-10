import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  applyUserRateLimit,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

// ─── Model Configuration ─────────────────────────────────────────────────────
const OPENAI_MODEL      = 'gpt-4.1';
const OPENAI_MODEL_MINI = 'gpt-4.1-mini';
const ONSPACE_MODEL     = 'google/gemini-2.5-flash';
const OPENAI_BASE       = 'https://api.openai.com/v1';
const GROQ_BASE         = 'https://api.groq.com/openai/v1';
const GEMINI_BASE       = 'https://generativelanguage.googleapis.com/v1beta/openai';
// Ordered by preference — newest/most capable first
const GROQ_MODELS       = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192'];
const GEMINI_MODELS     = ['gemini-2.0-flash', 'gemini-1.5-flash'];

// ─── Types ────────────────────────────────────────────────────────────────────
interface MatchInput {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country?: string;
  season?: string;
  homeScore?: number;
  awayScore?: number;
  status?: string;
  minute?: number;
  venue?: string;
  homeForm?: string[];
  awayForm?: string[];
  homeStandingsPos?: number;
  awayStandingsPos?: number;
  homeGoalsScored?: number;
  awayGoalsScored?: number;
  homeGoalsConceded?: number;
  awayGoalsConceded?: number;
  h2h?: Array<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; date: string }>;
  injuries?: string[];
  suspensions?: string[];
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  stats?: Record<string, unknown> | null;
  homePace?: number;
  awayPace?: number;
  homeORtg?: number;
  awayORtg?: number;
  homeDRtg?: number;
  awayDRtg?: number;
  homeServeWin?: number;
  awayServeWin?: number;
  homeReturnWin?: number;
  awayReturnWin?: number;
  homeSurfaceWin?: number;
  awaySurfaceWin?: number;
  homeATPRank?: number;
  awayATPRank?: number;
  homeBattingAvg?: number;
  awayBattingAvg?: number;
  homeERA?: number;
  awayERA?: number;
  homeWHIP?: number;
  awayWHIP?: number;
  homeRunRate?: number;
  awayRunRate?: number;
}

// ─── Sport Configuration ─────────────────────────────────────────────────────
interface SportConfig {
  drawPossible: boolean;
  defaultOULine: number;
  ouUnit: string;
  hasCorners: boolean;
  hasCards: boolean;
  hasBTTS: boolean;
  hasHalftime: boolean;
}

const SPORT_CONFIGS: Record<string, SportConfig> = {
  football:   { drawPossible: true,  defaultOULine: 2.5,   ouUnit: 'goals',  hasCorners: true,  hasCards: true,  hasBTTS: true,  hasHalftime: true  },
  soccer:     { drawPossible: true,  defaultOULine: 2.5,   ouUnit: 'goals',  hasCorners: true,  hasCards: true,  hasBTTS: true,  hasHalftime: true  },
  basketball: { drawPossible: false, defaultOULine: 215.5, ouUnit: 'points', hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: true  },
  tennis:     { drawPossible: false, defaultOULine: 2.5,   ouUnit: 'sets',   hasCorners: false, hasCards: false, hasBTTS: true,  hasHalftime: false },
  cricket:    { drawPossible: true,  defaultOULine: 320.5, ouUnit: 'runs',   hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
  baseball:   { drawPossible: false, defaultOULine: 8.5,   ouUnit: 'runs',   hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: true  },
  hockey:     { drawPossible: false, defaultOULine: 5.5,   ouUnit: 'goals',  hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: true  },
  rugby:      { drawPossible: true,  defaultOULine: 42.5,  ouUnit: 'points', hasCorners: false, hasCards: true,  hasBTTS: true,  hasHalftime: true  },
  mma:        { drawPossible: false, defaultOULine: 2.5,   ouUnit: 'rounds', hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
  boxing:     { drawPossible: false, defaultOULine: 8.5,   ouUnit: 'rounds', hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
  handball:   { drawPossible: false, defaultOULine: 55.5,  ouUnit: 'goals',  hasCorners: false, hasCards: true,  hasBTTS: false, hasHalftime: true  },
  volleyball: { drawPossible: false, defaultOULine: 3.5,   ouUnit: 'sets',   hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
  esports:    { drawPossible: false, defaultOULine: 2.5,   ouUnit: 'maps',   hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
  formula1:   { drawPossible: false, defaultOULine: 3.5,   ouUnit: 'pos.',   hasCorners: false, hasCards: false, hasBTTS: false, hasHalftime: false },
};

function getSportConfig(sport: string): SportConfig {
  return SPORT_CONFIGS[sport.toLowerCase()] ?? SPORT_CONFIGS['football'];
}

// ─── Statistical Engines ──────────────────────────────────────────────────────
function eloWinProb(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

function posToElo(pos: number, total = 20): number {
  return Math.round(1700 + ((total - pos) / Math.max(total - 1, 1)) * 300);
}

function formScore(form: string[]): number {
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

function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

function poissonMatchProbs(lambdaH: number, lambdaA: number, maxGoals = 8): { hw: number; d: number; aw: number } {
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

function footballPoissonEngine(match: MatchInput): { lambdaH: number; lambdaA: number; hw: number; d: number; aw: number } | null {
  if (!match.homeGoalsScored || !match.awayGoalsScored) return null;
  const homeGP = 20;
  const avgGoalPerGame = 2.6;
  const homeAttack  = (match.homeGoalsScored  / homeGP) / (avgGoalPerGame / 2);
  const homeDefence = (match.homeGoalsConceded ?? match.homeGoalsScored) / homeGP / (avgGoalPerGame / 2);
  const awayAttack  = (match.awayGoalsScored  / homeGP) / (avgGoalPerGame / 2);
  const awayDefence = (match.awayGoalsConceded ?? match.awayGoalsScored) / homeGP / (avgGoalPerGame / 2);
  const lambdaH = Math.max(0.3, homeAttack * awayDefence * (avgGoalPerGame / 2) * 1.25);
  const lambdaA = Math.max(0.2, awayAttack * homeDefence * (avgGoalPerGame / 2));
  const probs = poissonMatchProbs(lambdaH, lambdaA);
  const total = probs.hw + probs.d + probs.aw || 1;
  return { lambdaH, lambdaA, hw: Math.round((probs.hw/total)*100), d: Math.round((probs.d/total)*100), aw: Math.round((probs.aw/total)*100) };
}

function basketballEngine(match: MatchInput): { homeTotal: number; awayTotal: number; total: number } | null {
  if (!match.homeORtg || !match.awayORtg || !match.homePace || !match.awayPace) return null;
  const pace = (match.homePace + match.awayPace) / 2;
  const poss = pace * 0.48;
  const homeTotal = Math.round((match.homeORtg / 100) * poss * (100 / (match.awayDRtg ?? 110)));
  const awayTotal = Math.round((match.awayORtg / 100) * poss * (100 / (match.homeDRtg ?? 112)));
  return { homeTotal, awayTotal, total: homeTotal + awayTotal };
}

function tennisEngine(match: MatchInput): { homeWinProb: number } | null {
  if (!match.homeServeWin && !match.homeATPRank) return null;
  let homeAdv = 0;
  if (match.homeATPRank && match.awayATPRank) {
    const homeElo = Math.max(1000, 1700 - (match.homeATPRank - 1) * 4);
    const awayElo  = Math.max(1000, 1700 - (match.awayATPRank - 1)  * 4);
    homeAdv += eloWinProb(homeElo - awayElo) - 0.5;
  }
  if (match.homeServeWin && match.awayServeWin) homeAdv += (match.homeServeWin - match.awayServeWin) / 200;
  if (match.homeSurfaceWin && match.awaySurfaceWin) homeAdv += (match.homeSurfaceWin - match.awaySurfaceWin) / 200;
  return { homeWinProb: Math.round(Math.min(85, Math.max(15, (0.5 + homeAdv) * 100))) };
}

function computeDQScore(match: MatchInput): number {
  let s = 40;
  if (match.homeForm?.length && match.homeForm.length >= 3) s += 10;
  if (match.awayForm?.length && match.awayForm.length >= 3) s += 10;
  if (match.h2h?.length && match.h2h.length >= 2) s += 10;
  if (match.homeStandingsPos && match.awayStandingsPos) s += 8;
  if (match.homeGoalsScored !== undefined && match.awayGoalsScored !== undefined) s += 8;
  if (match.homeOdds && match.awayOdds) s += 10;
  if (match.injuries?.length) s += 4;
  if (match.stats && Object.keys(match.stats).length > 0) s += 5;
  if (match.homeORtg && match.awayORtg) s += 5;
  if (match.homeServeWin && match.awayServeWin) s += 5;
  if (match.homeATPRank && match.awayATPRank) s += 5;
  return Math.min(100, s);
}

function marketImplied(home?: number, draw?: number | null, away?: number): { hw: number; d: number; aw: number } | null {
  if (!home || !away) return null;
  const rawHW = 100 / home;
  const rawD  = draw ? 100 / draw : 0;
  const rawAW = 100 / away;
  const total = rawHW + rawD + rawAW;
  return { hw: Math.round(rawHW / total * 100), d: Math.round(rawD / total * 100), aw: Math.round(rawAW / total * 100) };
}

function normProbs(a: number, b: number, c: number): [number, number, number] {
  const total = a + b + c;
  if (total <= 0) return [40, 20, 40];
  const na = Math.round((a / total) * 100);
  const nb = Math.round((b / total) * 100);
  return [Math.max(0, na), Math.max(0, nb), Math.max(0, 100 - na - nb)];
}

function buildStatisticalContext(match: MatchInput): string {
  const sport = match.sport?.toLowerCase() ?? 'football';
  const lines: string[] = ['\n── PRE-COMPUTED STATISTICAL CONTEXT ──'];

  if (match.homeForm?.length || match.awayForm?.length) {
    const hfs = formScore(match.homeForm ?? []);
    const afs = formScore(match.awayForm ?? []);
    lines.push(`Form Scores (0-100): ${match.homeTeam} = ${hfs} | ${match.awayTeam} = ${afs}`);
    lines.push(`Form Momentum: ${hfs > afs ? match.homeTeam + ' in better form' : afs > hfs ? match.awayTeam + ' in better form' : 'Even form'}`);
  }

  if (match.homeStandingsPos && match.awayStandingsPos) {
    const homeElo = posToElo(match.homeStandingsPos);
    const awayElo  = posToElo(match.awayStandingsPos);
    const eloDiff  = homeElo - awayElo + 50;
    const eloHW    = Math.round(eloWinProb(eloDiff) * 100);
    lines.push(`ELO Estimates: ${match.homeTeam} = ${homeElo} | ${match.awayTeam} = ${awayElo}`);
    lines.push(`ELO-implied Home Win Probability: ${eloHW}%`);
  }

  if (sport === 'football' || sport === 'soccer') {
    const pe = footballPoissonEngine(match);
    if (pe) {
      lines.push(`Poisson Engine: lambdaH=${pe.lambdaH.toFixed(2)} lambdaA=${pe.lambdaA.toFixed(2)}`);
      lines.push(`Poisson Probabilities: Home Win ${pe.hw}% | Draw ${pe.d}% | Away Win ${pe.aw}%`);
      lines.push(`Expected Goals: ${match.homeTeam} ${pe.lambdaH.toFixed(2)} | ${match.awayTeam} ${pe.lambdaA.toFixed(2)}`);
      lines.push(`BTTS Probability (Poisson): ${Math.round((1 - poissonPMF(0, pe.lambdaH)) * (1 - poissonPMF(0, pe.lambdaA)) * 100)}%`);
    }
    if (match.homeGoalsScored !== undefined && match.homeGoalsConceded !== undefined) {
      lines.push(`Season Goals: ${match.homeTeam} scored ${match.homeGoalsScored} conceded ${match.homeGoalsConceded}`);
      lines.push(`Season Goals: ${match.awayTeam} scored ${match.awayGoalsScored ?? '?'} conceded ${match.awayGoalsConceded ?? '?'}`);
    }
  }

  if (sport === 'basketball') {
    const be = basketballEngine(match);
    if (be) {
      lines.push(`Pace Engine: ${match.homeTeam} pace=${match.homePace} | ${match.awayTeam} pace=${match.awayPace}`);
      lines.push(`Efficiency: ${match.homeTeam} ORtg=${match.homeORtg} DRtg=${match.homeDRtg} | ${match.awayTeam} ORtg=${match.awayORtg} DRtg=${match.awayDRtg}`);
      lines.push(`Projected Points: ${match.homeTeam} ${be.homeTotal} | ${match.awayTeam} ${be.awayTotal} | Total ${be.total}`);
    }
  }

  if (sport === 'tennis') {
    const te = tennisEngine(match);
    if (match.homeATPRank && match.awayATPRank) lines.push(`ATP/WTA Rankings: ${match.homeTeam} #${match.homeATPRank} | ${match.awayTeam} #${match.awayATPRank}`);
    if (match.homeServeWin && match.awayServeWin) lines.push(`Serve Win %: ${match.homeTeam} ${match.homeServeWin}% | ${match.awayTeam} ${match.awayServeWin}%`);
    if (match.homeSurfaceWin && match.awaySurfaceWin) lines.push(`Surface Win %: ${match.homeTeam} ${match.homeSurfaceWin}% | ${match.awayTeam} ${match.awaySurfaceWin}%`);
    if (te) lines.push(`Engine-implied Win Probability: ${match.homeTeam} ${te.homeWinProb}% | ${match.awayTeam} ${100 - te.homeWinProb}%`);
  }

  if (sport === 'baseball') {
    if (match.homeERA !== undefined && match.awayERA !== undefined) lines.push(`Pitching (ERA): ${match.homeTeam} ${match.homeERA.toFixed(2)} | ${match.awayTeam} ${match.awayERA.toFixed(2)}`);
    if (match.homeWHIP !== undefined && match.awayWHIP !== undefined) lines.push(`WHIP: ${match.homeTeam} ${match.homeWHIP.toFixed(2)} | ${match.awayTeam} ${match.awayWHIP.toFixed(2)}`);
    if (match.homeBattingAvg !== undefined && match.awayBattingAvg !== undefined) lines.push(`Batting Average: ${match.homeTeam} .${String(Math.round(match.homeBattingAvg * 1000)).padStart(3, '0')} | ${match.awayTeam} .${String(Math.round(match.awayBattingAvg * 1000)).padStart(3, '0')}`);
  }

  if (sport === 'cricket') {
    if (match.homeRunRate !== undefined && match.awayRunRate !== undefined) lines.push(`Run Rate: ${match.homeTeam} ${match.homeRunRate.toFixed(2)} | ${match.awayTeam} ${match.awayRunRate.toFixed(2)}`);
  }

  const implied = marketImplied(match.homeOdds, match.drawOdds, match.awayOdds);
  if (implied) {
    lines.push(`Market Odds: 1=${match.homeOdds?.toFixed(2)} X=${match.drawOdds?.toFixed(2) ?? 'N/A'} 2=${match.awayOdds?.toFixed(2)}`);
    lines.push(`Market-Implied Probs: Home ${implied.hw}% | Draw ${implied.d}% | Away ${implied.aw}%`);
  }

  if (match.h2h?.length) {
    let hw = 0, d = 0, aw = 0;
    for (const g of match.h2h) {
      if (g.homeTeam === match.homeTeam) { if (g.homeScore > g.awayScore) hw++; else if (g.homeScore === g.awayScore) d++; else aw++; }
      else { if (g.awayScore > g.homeScore) hw++; else if (g.homeScore === g.awayScore) d++; else aw++; }
    }
    lines.push(`H2H Record (last ${match.h2h.length}): ${match.homeTeam} wins=${hw} draws=${d} ${match.awayTeam} wins=${aw}`);
    const recent = match.h2h[0];
    if (recent) lines.push(`Most Recent H2H: ${recent.homeTeam} ${recent.homeScore}-${recent.awayScore} ${recent.awayTeam} (${recent.date.slice(0, 10)})`);
  }

  lines.push('── END STATISTICAL CONTEXT ──');
  return lines.join('\n');
}

function buildSystemPrompt(): string {
  return `You are the PredictXta Universal Sports Intelligence Engine — a sportsbook-grade AI prediction system backed by statistical pre-computation.

CRITICAL RULES:
- Respond ONLY with a valid JSON object — no markdown, no code fences, no explanation text.
- Never fabricate statistics. Use only the data provided in the statistical context.
- If data quality is critically insufficient, return: {"status":"insufficient_data","message":"Insufficient data."}

CONFIDENCE: 85-95%=Elite, 75-84%=High, 65-74%=Moderate, 50-64%=Speculative.
DQ < 30 cap at 55%; < 50 cap at 68%; < 70 cap at 82%.

SPORT RULES:
FOOTBALL/SOCCER: Draw possible. Use Poisson probabilities. Draw_prob reflects Poisson.
BASKETBALL: NO DRAW. draw_prob=0, ht_draw_prob=0. btts=yes. Use projected totals.
TENNIS: NO DRAW. draw_prob=0. btts=yes. Use ATP rank + serve engine.
CRICKET: Draw possible in Tests. O/U in runs.
BASEBALL/HOCKEY/MMA/BOXING/ESPORTS/VOLLEYBALL/HANDBALL: NO DRAW. draw_prob=0.
RUGBY: Draws rare (0-3%).

VIP: Always compute value_score(0-100), market_edge_pct(AI win%-implied win%), sharp_signal(bullish/neutral/bearish), suggested_stake(low/medium/high).

PROBABILITY RULES: home_win_prob + draw_prob + away_win_prob = EXACTLY 100. ht_home_prob + ht_draw_prob + ht_away_prob = EXACTLY 100.

OUTPUT — return ONLY this JSON object:
{"status":"success","home_win_prob":<int>,"draw_prob":<int>,"away_win_prob":<int>,"predicted_result":<"home_win"|"draw"|"away_win">,"confidence":<int 40-95>,"risk_level":<"Low"|"Medium"|"High">,"value_score":<int 0-100>,"market_edge_pct":<int -50 to 50>,"sharp_signal":<"bullish"|"neutral"|"bearish">,"suggested_stake":<"low"|"medium"|"high">,"over_under":<"over"|"under">,"over_under_line":<number>,"predicted_home_goals":<number>,"predicted_away_goals":<number>,"btts":<"yes"|"no">,"correct_score":<string>,"corners_over_under":<"over"|"under">,"corners_line":<number>,"cards_total":<number>,"cards_over_under":<"over"|"under">,"asian_handicap_line":<number>,"asian_handicap_pick":<"home"|"away">,"ht_result":<"home_win"|"draw"|"away_win">,"ht_home_prob":<int>,"ht_draw_prob":<int>,"ht_away_prob":<int>,"clean_sheet_home":<"yes"|"no">,"clean_sheet_away":<"yes"|"no">,"first_goal":<"home"|"away"|"no_goal">,"both_score_ht":<"yes"|"no">,"anytime_scorecast":<string>,"prediction_summary":<string>,"key_alpha_metric":<string>,"ai_analysis":<string 2-3 sentences>,"key_factors":<array of 5 strings>,"warning_flags":<array 0-3 strings>}`;
}

function buildUserPrompt(match: MatchInput): string {
  const sport = match.sport?.toLowerCase() ?? 'football';
  const cfg = getSportConfig(sport);
  const dq = computeDQScore(match);
  const hfStr = match.homeForm?.slice(0, 5).join('-') || 'Unknown';
  const afStr = match.awayForm?.slice(0, 5).join('-') || 'Unknown';

  let liveBlock = '';
  if (match.status === 'live') {
    liveBlock = `\nLIVE: ${match.homeScore ?? 0}-${match.awayScore ?? 0} | Min: ${match.minute ?? 0}'`;
    if (match.stats) {
      const s = match.stats as Record<string, unknown>;
      const pos = s.home_possession ?? s.homePossession;
      const sht = s.home_shots ?? s.homeShots;
      const sot = s.home_shots_on_target ?? s.homeShotsOnTarget;
      if (pos) liveBlock += ` | Poss: ${pos}%-${100 - Number(pos)}%`;
      if (sht) liveBlock += ` | Shots: ${sht}-${s.away_shots ?? s.awayShots ?? '?'}`;
      if (sot) liveBlock += ` | SOT: ${sot}-${s.away_shots_on_target ?? s.awayShotsOnTarget ?? '?'}`;
    }
  }

  let teamNewsBlock = '';
  if (match.injuries?.length) teamNewsBlock += `\nInjuries: ${match.injuries.join(', ')}`;
  if (match.suspensions?.length) teamNewsBlock += `\nSuspensions: ${match.suspensions.join(', ')}`;

  const sportRules: Record<string, string> = {
    football:   `Draw possible. O/U ~${cfg.defaultOULine} goals. Include corners (8.5-11.5) and cards (3-4.5). Anchor to Poisson data.`,
    soccer:     `Draw possible. O/U ~${cfg.defaultOULine} goals. Include corners (8.5-11.5) and cards (3-4.5). Anchor to Poisson data.`,
    basketball: `NO DRAW. draw_prob=0, ht_draw_prob=0. btts=yes. O/U ~${cfg.defaultOULine} pts. corners_line=0. Anchor to projected totals.`,
    tennis:     `NO DRAW. draw_prob=0. btts=yes. O/U ~${cfg.defaultOULine} sets. corners_line=0. Anchor to ATP engine.`,
    cricket:    `Draw possible in Tests. O/U ~${cfg.defaultOULine} runs. corners_line=0. btts=no.`,
    baseball:   `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} runs. corners_line=0. ERA/WHIP key.`,
    hockey:     `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} goals. corners_line=0.`,
    rugby:      `Draw rare (0-3%). O/U ~${cfg.defaultOULine} pts. corners_line=0.`,
    mma:        `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} rounds. corners_line=0. btts=no.`,
    boxing:     `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} rounds. corners_line=0. btts=no.`,
    handball:   `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} goals. corners_line=0.`,
    volleyball: `NO DRAW. draw_prob=0. O/U ~${cfg.defaultOULine} sets. corners_line=0. btts=no.`,
    esports:    `NO DRAW. draw_prob=0, ht_draw_prob=0. O/U ~${cfg.defaultOULine} maps. corners_line=0. btts=no.`,
    formula1:   `NO DRAW. draw_prob=0. btts=no. corners_line=0. Treat home_team as favourite.`,
  };

  const statContext = buildStatisticalContext(match);

  return `Generate a ${match.sport.toUpperCase()} prediction for:
MATCH: ${match.homeTeam} vs ${match.awayTeam}
League: ${match.league}${match.country ? ` | ${match.country}` : ''}${match.venue ? ` | ${match.venue}` : ''}
Status: ${match.status ?? 'upcoming'} | Form: ${match.homeTeam} ${hfStr} | ${match.awayTeam} ${afStr}${teamNewsBlock}${liveBlock}
DQ Score: ${dq}/100${dq < 50 ? ' - LOW QUALITY: cap confidence at 68%' : dq >= 75 ? ' - GOOD' : ''}

${statContext}

RULES: ${sportRules[sport] ?? sportRules['football']}
Return ONLY the JSON. Anchor probabilities to statistical context (max ±8% deviation).`;
}

// ─── Fetch with retry helper ──────────────────────────────────────────────────
async function tryFetch(
  url: string,
  options: RequestInit,
  timeoutMs = 28_000,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  } catch {
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: secureHeaders });
  }

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 10, windowSec: 60, blockSec: 120 },
      maxPayloadBytes: 64_000,
      rateLimitScope: 'predict',
      blockBotUa: true,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    let match: MatchInput;
    let userId: string | null = null;

    try {
      const body = parsedBody as Record<string, unknown>;
      if (!body) throw new Error('Empty body');
      match = body.match as MatchInput;
      userId = (body.user_id as string) ?? null;
    } catch {
      return secureErrorResponse('Invalid request body', 400);
    }

    if (userId) {
      const userGuard = applyUserRateLimit(userId, 'predict', { max: 5, windowSec: 60, blockSec: 120 });
      if (userGuard) return userGuard;
    }

    if (!match?.id || !match?.homeTeam || !match?.awayTeam) {
      return secureErrorResponse('match.id, homeTeam, awayTeam required', 400);
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const groqKey   = Deno.env.get('Groq_API_Key');
    const geminiKey = Deno.env.get('Gemini_API_Key');
    const aiKey     = Deno.env.get('ONSPACE_AI_API_KEY');
    const aiBase    = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!openaiKey && !groqKey && !geminiKey && !aiKey) {
      return secureErrorResponse('No AI provider keys configured', 500);
    }

    const requestPayload = {
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: buildUserPrompt(match) },
      ],
      temperature: 0.55,
      max_tokens: 1400,
    };

    let rawContent = '';
    let usedProvider = 'none';

    // ── Provider 1: OpenAI GPT-4.1 → GPT-4.1-mini ───────────────────────────
    if (openaiKey) {
      for (const model of [OPENAI_MODEL, OPENAI_MODEL_MINI]) {
        const res = await tryFetch(`${OPENAI_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ ...requestPayload, model }),
        });
        if (res?.ok) {
          const data = await res.json() as Record<string, unknown>;
          const c = ((data.choices as any[])?.[0]?.message?.content ?? '') as string;
          if (c.length > 20) { rawContent = c; usedProvider = `openai-${model}`; break; }
        } else if (res && res.status !== 429 && res.status !== 503 && res.status !== 529) {
          break; // Non-retryable error — skip to next provider
        }
        // 429/503/529 = rate limited/overloaded — continue to try mini then fallback
      }
    }

    // ── Provider 2: Groq (multiple model fallback chain) ─────────────────────
    if (!rawContent && groqKey) {
      for (const model of GROQ_MODELS) {
        const res = await tryFetch(`${GROQ_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ ...requestPayload, model, response_format: { type: 'json_object' } }),
        });
        if (res?.ok) {
          const data = await res.json() as Record<string, unknown>;
          const c = ((data.choices as any[])?.[0]?.message?.content ?? '') as string;
          if (c.length > 20) { rawContent = c; usedProvider = `groq-${model}`; break; }
        } else if (res?.status === 404 || res?.status === 400) {
          continue; // Model not found, try next
        } else {
          break; // Other error
        }
      }
    }

    // ── Provider 3: Gemini (multiple model fallback chain) ────────────────────
    if (!rawContent && geminiKey) {
      for (const model of GEMINI_MODELS) {
        const res = await tryFetch(`${GEMINI_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${geminiKey}` },
          body: JSON.stringify({ ...requestPayload, model, response_format: { type: 'json_object' } }),
        });
        if (res?.ok) {
          const data = await res.json() as Record<string, unknown>;
          const c = ((data.choices as any[])?.[0]?.message?.content ?? '') as string;
          if (c.length > 20) { rawContent = c; usedProvider = `gemini-${model}`; break; }
        } else if (res?.status === 404 || res?.status === 400) {
          continue;
        } else {
          break;
        }
      }
    }

    // ── Provider 4: OnSpace AI fallback ──────────────────────────────────────
    if (!rawContent && aiKey && aiBase) {
      const res = await tryFetch(`${aiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
        body: JSON.stringify({ ...requestPayload, model: ONSPACE_MODEL }),
      });
      if (res?.ok) {
        const data = await res.json() as Record<string, unknown>;
        const c = ((data.choices as any[])?.[0]?.message?.content ?? '') as string;
        if (c.length > 20) { rawContent = c; usedProvider = 'onspace-ai'; }
      }
    }

    if (!rawContent) {
      console.error(`[generate-prediction] All providers failed for match ${match.id} | openai=${!!openaiKey} groq=${!!groqKey} gemini=${!!geminiKey} onspace=${!!aiKey}`);
      return secureErrorResponse('All AI providers failed', 502);
    }

    // ── Parse JSON ────────────────────────────────────────────────────────────
    let parsed: Record<string, unknown>;
    try {
      const cleaned = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const m = rawContent.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); }
        catch { return secureErrorResponse('AI returned invalid JSON', 502); }
      } else {
        return secureErrorResponse('AI returned no JSON', 502);
      }
    }

    if (parsed.status === 'insufficient_data') {
      return secureResponse({ success: false, insufficient_data: true, message: parsed.message ?? 'Insufficient data' });
    }

    // ── Normalise probabilities ───────────────────────────────────────────────
    const [nH, nD, nA] = normProbs(
      Math.max(0, Number(parsed.home_win_prob) || 0),
      Math.max(0, Number(parsed.draw_prob) || 0),
      Math.max(0, Number(parsed.away_win_prob) || 0),
    );
    const [nHH, nHD, nHA] = normProbs(
      Math.max(0, Number(parsed.ht_home_prob) || 35),
      Math.max(0, Number(parsed.ht_draw_prob) || 40),
      Math.max(0, Number(parsed.ht_away_prob) || 25),
    );

    const RESULTS = ['home_win', 'draw', 'away_win'] as const;
    const rawResult = String(parsed.predicted_result ?? '');
    const predictedResult = RESULTS.includes(rawResult as typeof RESULTS[number])
      ? (rawResult as typeof RESULTS[number])
      : (nH >= nA ? 'home_win' : 'away_win');

    const rawHtResult = String(parsed.ht_result ?? '');
    const htResult = RESULTS.includes(rawHtResult as typeof RESULTS[number])
      ? (rawHtResult as typeof RESULTS[number]) : 'draw';

    const overUnder   = String(parsed.over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over';
    const cardsOU     = String(parsed.cards_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over';
    const cornersOU   = String(parsed.corners_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over';
    const rawFG       = String(parsed.first_goal ?? 'home').toLowerCase();
    const firstGoal   = ['home','away','no_goal'].includes(rawFG) ? rawFG : 'home';
    const ahPick      = String(parsed.asian_handicap_pick ?? 'home').toLowerCase() === 'away' ? 'away' : 'home';
    const rawSignal   = String(parsed.sharp_signal ?? 'neutral').toLowerCase();
    const sharpSignal = ['bullish','neutral','bearish'].includes(rawSignal) ? rawSignal : 'neutral';
    const rawRisk     = String(parsed.risk_level ?? '');
    const riskLevel   = ['Low','Medium','High'].includes(rawRisk) ? rawRisk
      : (Number(parsed.confidence) >= 80 ? 'Low' : Number(parsed.confidence) >= 60 ? 'Medium' : 'High');
    const rawStake    = String(parsed.suggested_stake ?? '').toLowerCase();
    const suggestedStake = ['low','medium','high'].includes(rawStake) ? rawStake : 'medium';

    const confidence    = Math.max(40, Math.min(95, Number(parsed.confidence) || 65));
    const valueScore    = Math.max(0, Math.min(100, Number(parsed.value_score) || 50));
    const marketEdgePct = Math.max(-50, Math.min(50, Number(parsed.market_edge_pct) || 0));

    const keyFactors = Array.isArray(parsed.key_factors)
      ? (parsed.key_factors as string[]).filter((f) => typeof f === 'string').slice(0, 5)
      : [];
    while (keyFactors.length < 5) keyFactors.push('Statistical model applied');

    const warningFlags = Array.isArray(parsed.warning_flags)
      ? (parsed.warning_flags as string[]).filter((f) => typeof f === 'string').slice(0, 3)
      : [];

    const predHG = Number(parsed.predicted_home_goals ?? 1.5);
    const predAG = Number(parsed.predicted_away_goals ?? 1.2);
    const ouLine = Number(parsed.over_under_line ?? getSportConfig(match.sport ?? '').defaultOULine);
    const resolvedOU = (predHG + predAG) > ouLine ? 'over' : 'under';

    // ── Apply data-quality confidence ceiling ─────────────────────────────────
    const dq = computeDQScore(match);
    let finalConf = confidence;
    if (dq < 30) finalConf = Math.min(finalConf, 55);
    else if (dq < 50) finalConf = Math.min(finalConf, 68);
    else if (dq < 70) finalConf = Math.min(finalConf, 82);
    if (dq < 50 && !warningFlags.find((w) => w.toLowerCase().includes('data'))) {
      warningFlags.push(`Limited data quality (score ${dq}/100)`);
    }

    // ── Persist ───────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const predVersion = usedProvider.includes('gpt-4.1') && !usedProvider.includes('mini') ? 5
      : usedProvider.includes('openai') ? 4
      : usedProvider.includes('groq') ? 4
      : usedProvider.includes('gemini') ? 4 : 3;

    const row = {
      match_id: match.id, user_id: userId,
      home_win_prob: nH, draw_prob: nD, away_win_prob: nA,
      predicted_result: predictedResult, confidence: finalConf,
      over_under: resolvedOU, over_under_line: ouLine,
      predicted_home_goals: predHG, predicted_away_goals: predAG,
      btts: String(parsed.btts ?? 'no'),
      correct_score: String(parsed.correct_score ?? '1-1'),
      corners_over_under: cornersOU, corners_line: Number(parsed.corners_line ?? 9.5),
      cards_total: Number(parsed.cards_total ?? 3.5), cards_over_under: cardsOU,
      asian_handicap_line: Number(parsed.asian_handicap_line ?? 0), asian_handicap_pick: ahPick,
      ht_result: htResult, ht_home_prob: nHH, ht_draw_prob: nHD, ht_away_prob: nHA,
      clean_sheet_home: String(parsed.clean_sheet_home ?? 'no'),
      clean_sheet_away: String(parsed.clean_sheet_away ?? 'no'),
      first_goal: firstGoal, both_score_ht: String(parsed.both_score_ht ?? 'no'),
      anytime_scorecast: String(parsed.anytime_scorecast ?? ''),
      ai_analysis: String(parsed.ai_analysis ?? ''),
      key_factors: keyFactors, risk_level: riskLevel,
      value_score: valueScore, market_edge_pct: marketEdgePct,
      sharp_signal: sharpSignal, suggested_stake: suggestedStake,
      warning_flags: warningFlags, key_alpha_metric: String(parsed.key_alpha_metric ?? keyFactors[0]),
      prediction_version: predVersion,
    };

    const { data: saved, error: dbErr } = await supabase
      .from('predictions').insert(row).select().single();

    if (dbErr) {
      return secureResponse({ success: true, prediction: row, db_warning: 'Save skipped (duplicate or DB error)' });
    }

    return secureResponse({ success: true, prediction: saved });

  } catch (err) {
    console.error('[generate-prediction] fatal:', err instanceof Error ? err.message : String(err));
    return secureErrorResponse('Internal server error', 500);
  }
});
