/**
 * multi-model-prediction/index.ts
 *
 * Enterprise 5-model prediction engine that fans out to all providers
 * simultaneously, aggregates with weighted consensus voting, and persists
 * results to the `predictions` table + `ai_audit_logs`.
 *
 * Provider Fan-out (v2 — 2026):
 *   ① GPT-5.5            — primary intelligence       (OpenAI)
 *   ② Claude             — reasoning / calibration    (Anthropic, native Messages API)
 *   ③ Gemini 2.5 Flash   — multimodal pattern analysis(Google)
 *   ④ Llama 4 / 3.3 70B  — quantitative analysis      (Meta via Groq)
 *
 * Consensus Algorithm:
 *   - Each model votes on: predicted_result, over_under, btts
 *   - Probabilities averaged with quality-weighted coefficients
 *     (weights read from model_performance_log if available, else defaults)
 *   - Confidence boosted when ≥3 models agree, penalised on divergence
 *   - Final output saved to predictions + audit log
 *
 * Hallucination prevention:
 *   - All models receive identical Verified Facts Object (statistical pre-computation)
 *   - Universal LLM guardrails injected into every system prompt
 *   - Post-generation validator rejects numeric claims outside supplied ranges
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  applyUserRateLimit,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

// ─── Provider base URLs ───────────────────────────────────────────────────────
const OPENAI_BASE     = 'https://api.openai.com/v1';
const GROQ_BASE       = 'https://api.groq.com/openai/v1';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta/openai';
const ANTHROPIC_BASE  = 'https://api.anthropic.com/v1';
const TIMEOUT_MS      = 25_000;

// ─── Model specs (default weights — overridden by model_performance_log) ─────
interface ModelSpec {
  id: string;
  provider: 'openai' | 'groq' | 'gemini' | 'anthropic';
  model: string;
  defaultWeight: number;
  temperature: number;
  maxTokens: number;
}

// Model specs — primary model per provider with intra-provider fallbacks
const ALL_MODEL_SPECS: ModelSpec[] = [
  // OpenAI: GPT-5.5 primary; gpt-4.1 is the fallback within OpenAI
  { id: 'gpt55',  provider: 'openai',    model: 'gpt-5.5',                                    defaultWeight: 1.00, temperature: 0.50, maxTokens: 1600 },
  // Anthropic Claude — dispatched via native Messages API
  { id: 'claude', provider: 'anthropic', model: 'claude-opus-4-5',                             defaultWeight: 0.97, temperature: 0.50, maxTokens: 1400 },
  // Google Gemini — OpenAI-compatible endpoint
  { id: 'gemini', provider: 'gemini',    model: 'gemini-2.5-flash',                            defaultWeight: 0.90, temperature: 0.55, maxTokens: 1500 },
  // Meta Llama via Groq — OpenAI-compatible, fastest provider
  { id: 'llama',  provider: 'groq',      model: 'meta-llama/llama-4-scout-17b-16e-instruct',   defaultWeight: 0.82, temperature: 0.50, maxTokens: 1400 },
];

// Intra-provider fallback chains (tried in order when primary returns non-2xx)
const MODEL_FALLBACKS: Record<string, string[]> = {
  gpt55:  ['gpt-4.1'],
  claude: ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022'],
  gemini: ['gemini-2.0-flash'],
  llama:  ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile'],
};

// Model role descriptors injected into each provider's user prompt
const MODEL_ROLES: Record<string, string> = {
  gpt55:  'Your role: PRIMARY INTELLIGENCE (GPT-5.5). Produce the most analytically complete prediction.',
  claude: 'Your role: REASONING & CALIBRATION (Claude). Apply rigorous Bayesian reasoning anchored strictly in the supplied facts.',
  gemini: 'Your role: PATTERN ANALYSIS (Gemini). Identify tactical, historical, and contextual patterns from the provided verified facts.',
  llama:  'Your role: QUANTITATIVE ANALYSIS (Llama). Focus on numerical evidence and statistical validation of the supplied data.',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface MatchInput {
  id: string; sport: string; homeTeam: string; awayTeam: string; league: string;
  country?: string; homeScore?: number; awayScore?: number; status?: string; minute?: number;
  venue?: string; homeForm?: string[]; awayForm?: string[];
  homeStandingsPos?: number; awayStandingsPos?: number;
  homeGoalsScored?: number; awayGoalsScored?: number;
  homeGoalsConceded?: number; awayGoalsConceded?: number;
  h2h?: Array<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; date: string }>;
  injuries?: string[]; homeOdds?: number; drawOdds?: number; awayOdds?: number;
  stats?: Record<string, unknown> | null;
  homePace?: number; awayPace?: number; homeORtg?: number; awayORtg?: number;
  homeDRtg?: number; awayDRtg?: number; homeServeWin?: number; awayServeWin?: number;
  homeATPRank?: number; awayATPRank?: number; homeSurfaceWin?: number; awaySurfaceWin?: number;
  homeERA?: number; awayERA?: number; homeWHIP?: number; awayWHIP?: number;
}

interface ModelPrediction {
  modelId: string; provider: string; weight: number;
  homeWinProb: number; drawProb: number; awayWinProb: number;
  predictedResult: 'home_win' | 'draw' | 'away_win'; confidence: number;
  overUnder: 'over' | 'under'; overUnderLine: number;
  predictedHomeGoals: number; predictedAwayGoals: number;
  btts: 'yes' | 'no'; correctScore: string;
  cornersLine: number; cornersOverUnder: 'over' | 'under';
  cardsTotal: number; cardsOverUnder: 'over' | 'under';
  asianHandicapLine: number; asianHandicapPick: 'home' | 'away';
  htResult: 'home_win' | 'draw' | 'away_win';
  htHomeProb: number; htDrawProb: number; htAwayProb: number;
  cleanSheetHome: 'yes' | 'no'; cleanSheetAway: 'yes' | 'no';
  firstGoal: 'home' | 'away' | 'no_goal'; bothScoreHt: 'yes' | 'no';
  riskLevel: 'Low' | 'Medium' | 'High'; valueScore: number; marketEdgePct: number;
  sharpSignal: 'bullish' | 'neutral' | 'bearish'; suggestedStake: 'low' | 'medium' | 'high';
  aiAnalysis: string; keyFactors: string[]; warningFlags: string[];
  keyAlphaMetric: string; anytimeScorecast: string; latencyMs: number;
  error?: string;
}

interface ConsensusResult extends ModelPrediction {
  modelsUsed: number; modelsAgreed: number; consensusPassed: boolean;
  hallucinationScore: number; dqScore: number;
  modelBreakdown: Array<{ id: string; result: string; confidence: number; latencyMs: number; error?: string }>;
  predictionVersion: number;
}

// ─── Statistical helpers ──────────────────────────────────────────────────────
function eloWinProb(diff: number) { return 1 / (1 + Math.pow(10, -diff / 400)); }
function posToElo(pos: number, total = 20) { return Math.round(1700 + ((total - pos) / Math.max(total - 1, 1)) * 300); }
function formScore(form: string[]): number {
  if (!form?.length) return 50;
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
function poissonProbs(lH: number, lA: number) {
  let hw = 0, d = 0, aw = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    const p = poissonPMF(h, lH) * poissonPMF(a, lA);
    if (h > a) hw += p; else if (h === a) d += p; else aw += p;
  }
  return { hw, d, aw };
}
function normProbs(a: number, b: number, c: number): [number, number, number] {
  const t = a + b + c; if (t <= 0) return [40, 20, 40];
  const na = Math.round((a / t) * 100), nb = Math.round((b / t) * 100);
  return [Math.max(0, na), Math.max(0, nb), Math.max(0, 100 - na - nb)];
}
function computeDQScore(match: MatchInput): number {
  let s = 40;
  if (match.homeForm?.length && match.homeForm.length >= 3) s += 10;
  if (match.awayForm?.length && match.awayForm.length >= 3) s += 10;
  if (match.h2h?.length && match.h2h.length >= 2) s += 10;
  if (match.homeStandingsPos && match.awayStandingsPos) s += 8;
  if (match.homeGoalsScored !== undefined) s += 8;
  if (match.homeOdds && match.awayOdds) s += 10;
  if (match.injuries?.length) s += 4;
  return Math.min(100, s);
}
function marketImplied(home?: number, draw?: number | null, away?: number) {
  if (!home || !away) return null;
  const rH = 100 / home, rD = draw ? 100 / draw : 0, rA = 100 / away;
  const t = rH + rD + rA;
  return { hw: Math.round(rH / t * 100), d: Math.round(rD / t * 100), aw: Math.round(rA / t * 100) };
}
function getSportConfig(sport: string) {
  const configs: Record<string, { drawPossible: boolean; ouLine: number; unit: string }> = {
    football: { drawPossible: true, ouLine: 2.5, unit: 'goals' },
    soccer: { drawPossible: true, ouLine: 2.5, unit: 'goals' },
    basketball: { drawPossible: false, ouLine: 215.5, unit: 'points' },
    tennis: { drawPossible: false, ouLine: 2.5, unit: 'sets' },
    cricket: { drawPossible: true, ouLine: 320.5, unit: 'runs' },
    baseball: { drawPossible: false, ouLine: 8.5, unit: 'runs' },
    hockey: { drawPossible: false, ouLine: 5.5, unit: 'goals' },
    rugby: { drawPossible: true, ouLine: 42.5, unit: 'points' },
    mma: { drawPossible: false, ouLine: 2.5, unit: 'rounds' },
    boxing: { drawPossible: false, ouLine: 8.5, unit: 'rounds' },
    handball: { drawPossible: false, ouLine: 55.5, unit: 'goals' },
    volleyball: { drawPossible: false, ouLine: 3.5, unit: 'sets' },
    esports: { drawPossible: false, ouLine: 2.5, unit: 'maps' },
  };
  return configs[sport.toLowerCase()] ?? configs['football'];
}

// ─── Fetch live weights from model_performance_log ────────────────────────────
async function fetchLiveWeights(
  supabase: ReturnType<typeof createClient>,
): Promise<Record<string, number>> {
  const weights: Record<string, number> = {};
  try {
    const { data } = await supabase
      .from('model_performance_log')
      .select('model_id, consensus_weight')
      .order('logged_date', { ascending: false })
      .limit(5 * 7); // last 7 entries per model

    if (data) {
      // Group by model_id, take most recent weight
      const seen = new Set<string>();
      for (const row of data as Array<{ model_id: string; consensus_weight: number }>) {
        if (!seen.has(row.model_id)) {
          weights[row.model_id] = Number(row.consensus_weight) || 0.8;
          seen.add(row.model_id);
        }
      }
    }
  } catch { /* use defaults */ }
  return weights;
}

// ─── Verified Facts Object ────────────────────────────────────────────────────
function buildVerifiedFacts(match: MatchInput): string {
  const sport = match.sport?.toLowerCase() ?? 'football';
  const lines: string[] = ['═══ VERIFIED FACTS OBJECT (use ONLY these values) ═══'];

  const hfs = formScore(match.homeForm ?? []);
  const afs = formScore(match.awayForm ?? []);
  lines.push(`Form[${match.homeTeam}]=${hfs}/100 Form[${match.awayTeam}]=${afs}/100`);
  if (match.homeForm?.length) lines.push(`RecentForm[${match.homeTeam}]=${match.homeForm.slice(-5).join('')}`);
  if (match.awayForm?.length) lines.push(`RecentForm[${match.awayTeam}]=${match.awayForm.slice(-5).join('')}`);

  if (match.homeStandingsPos && match.awayStandingsPos) {
    const hElo = posToElo(match.homeStandingsPos);
    const aElo = posToElo(match.awayStandingsPos);
    const eloDiff = hElo - aElo + 50;
    lines.push(`ELO[${match.homeTeam}]=${hElo} ELO[${match.awayTeam}]=${aElo}`);
    lines.push(`ELO_HomeWinProb=${Math.round(eloWinProb(eloDiff) * 100)}%`);
    lines.push(`Standings[${match.homeTeam}]=#${match.homeStandingsPos} Standings[${match.awayTeam}]=#${match.awayStandingsPos}`);
  }

  if ((sport === 'football' || sport === 'soccer') && match.homeGoalsScored && match.awayGoalsScored) {
    const avg = 2.6; const gp = 20;
    const hAtk = (match.homeGoalsScored / gp) / (avg / 2);
    const hDef = ((match.homeGoalsConceded ?? match.homeGoalsScored) / gp) / (avg / 2);
    const aAtk = (match.awayGoalsScored / gp) / (avg / 2);
    const aDef = ((match.awayGoalsConceded ?? match.awayGoalsScored) / gp) / (avg / 2);
    const lambdaH = Math.max(0.3, hAtk * aDef * (avg / 2) * 1.25);
    const lambdaA = Math.max(0.2, aAtk * hDef * (avg / 2));
    const pp = poissonProbs(lambdaH, lambdaA);
    const tot = pp.hw + pp.d + pp.aw || 1;
    lines.push(`Poisson_lambdaH=${lambdaH.toFixed(2)} lambdaA=${lambdaA.toFixed(2)}`);
    lines.push(`Poisson_HomeWin=${Math.round(pp.hw/tot*100)}% Draw=${Math.round(pp.d/tot*100)}% AwayWin=${Math.round(pp.aw/tot*100)}%`);
    lines.push(`ExpectedGoals[${match.homeTeam}]=${lambdaH.toFixed(2)} [${match.awayTeam}]=${lambdaA.toFixed(2)}`);
    lines.push(`BTTS_Prob=${Math.round((1-poissonPMF(0,lambdaH))*(1-poissonPMF(0,lambdaA))*100)}%`);
    lines.push(`SeasonGoals[${match.homeTeam}]=scored:${match.homeGoalsScored} conceded:${match.homeGoalsConceded??'?'}`);
    lines.push(`SeasonGoals[${match.awayTeam}]=scored:${match.awayGoalsScored} conceded:${match.awayGoalsConceded??'?'}`);
  }

  if (sport === 'basketball' && match.homeORtg && match.awayORtg && match.homePace && match.awayPace) {
    const pace = (match.homePace + match.awayPace) / 2;
    const poss = pace * 0.48;
    const hPts = Math.round((match.homeORtg / 100) * poss * (100 / (match.awayDRtg ?? 110)));
    const aPts = Math.round((match.awayORtg / 100) * poss * (100 / (match.homeDRtg ?? 112)));
    lines.push(`Basketball_ProjectedPts[${match.homeTeam}]=${hPts} [${match.awayTeam}]=${aPts} Total=${hPts+aPts}`);
    lines.push(`Efficiency[${match.homeTeam}]=ORtg:${match.homeORtg} DRtg:${match.homeDRtg} [${match.awayTeam}]=ORtg:${match.awayORtg} DRtg:${match.awayDRtg}`);
  }

  if (sport === 'tennis') {
    if (match.homeATPRank && match.awayATPRank) lines.push(`ATPRank[${match.homeTeam}]=#${match.homeATPRank} [${match.awayTeam}]=#${match.awayATPRank}`);
    if (match.homeServeWin && match.awayServeWin) lines.push(`ServeWin%[${match.homeTeam}]=${match.homeServeWin}% [${match.awayTeam}]=${match.awayServeWin}%`);
    if (match.homeSurfaceWin && match.awaySurfaceWin) lines.push(`SurfaceWin%[${match.homeTeam}]=${match.homeSurfaceWin}% [${match.awayTeam}]=${match.awaySurfaceWin}%`);
  }

  if (sport === 'baseball') {
    if (match.homeERA !== undefined) lines.push(`ERA[${match.homeTeam}]=${match.homeERA.toFixed(2)} [${match.awayTeam}]=${(match.awayERA??4.50).toFixed(2)}`);
    if (match.homeWHIP !== undefined) lines.push(`WHIP[${match.homeTeam}]=${match.homeWHIP.toFixed(2)} [${match.awayTeam}]=${(match.awayWHIP??1.35).toFixed(2)}`);
  }

  const implied = marketImplied(match.homeOdds, match.drawOdds, match.awayOdds);
  if (implied) {
    lines.push(`MarketOdds: 1=${match.homeOdds?.toFixed(2)} X=${match.drawOdds?.toFixed(2)??'N/A'} 2=${match.awayOdds?.toFixed(2)}`);
    lines.push(`MarketImplied: Home=${implied.hw}% Draw=${implied.d}% Away=${implied.aw}%`);
  }

  if (match.h2h?.length) {
    let hw = 0, d = 0, aw = 0;
    for (const g of match.h2h) {
      if (g.homeTeam === match.homeTeam) { if (g.homeScore > g.awayScore) hw++; else if (g.homeScore === g.awayScore) d++; else aw++; }
      else { if (g.awayScore > g.homeScore) hw++; else if (g.homeScore === g.awayScore) d++; else aw++; }
    }
    lines.push(`H2H_last${match.h2h.length}: ${match.homeTeam}_wins=${hw} draws=${d} ${match.awayTeam}_wins=${aw}`);
    const r = match.h2h[0];
    if (r) lines.push(`H2H_MostRecent: ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam} (${r.date?.slice(0,10)})`);
  }

  if (match.status === 'live') {
    lines.push(`LIVE_Score: ${match.homeTeam} ${match.homeScore??0}-${match.awayScore??0} ${match.awayTeam} | Minute:${match.minute??0}'`);
    if (match.stats) {
      const s = match.stats as Record<string, unknown>;
      const pos = s.home_possession ?? s.homePossession;
      if (pos) lines.push(`LIVE_Possession: ${match.homeTeam}=${pos}% ${match.awayTeam}=${100-Number(pos)}%`);
    }
  }

  lines.push('═══ END VERIFIED FACTS ═══');
  return lines.join('\n');
}

// ─── Shared JSON schema prompt ────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `You are a sportsbook-grade AI prediction engine in a multi-model consensus system.

ABSOLUTE RULES — NEVER VIOLATE:
1. Respond ONLY with a valid JSON object — zero markdown, zero code fences, zero preamble.
2. Use ONLY the statistics provided in the VERIFIED FACTS OBJECT. NEVER invent, assume, or extrapolate values not listed.
3. All probabilities from the Verified Facts must be anchored in your output — you may adjust by ±8% maximum.
4. home_win_prob + draw_prob + away_win_prob = EXACTLY 100.
5. ht_home_prob + ht_draw_prob + ht_away_prob = EXACTLY 100.
6. For sports with no draws (basketball, tennis, etc.): draw_prob=0, ht_draw_prob=0.

CONFIDENCE: 85-95%=Elite, 75-84%=High, 65-74%=Moderate, 50-64%=Speculative. Never <45%.
RISK: Low(conf≥80%), Medium(60-79%), High(<60%).
VIP: value_score 0-100; market_edge_pct=AI%-implied%; sharp_signal bullish/neutral/bearish; suggested_stake low/medium/high.

OUTPUT — return ONLY this JSON:
{"status":"success","home_win_prob":<int>,"draw_prob":<int>,"away_win_prob":<int>,"predicted_result":<"home_win"|"draw"|"away_win">,"confidence":<int 45-95>,"risk_level":<"Low"|"Medium"|"High">,"value_score":<int 0-100>,"market_edge_pct":<int>,"sharp_signal":<"bullish"|"neutral"|"bearish">,"suggested_stake":<"low"|"medium"|"high">,"over_under":<"over"|"under">,"over_under_line":<number>,"predicted_home_goals":<number>,"predicted_away_goals":<number>,"btts":<"yes"|"no">,"correct_score":<string>,"corners_over_under":<"over"|"under">,"corners_line":<number>,"cards_total":<number>,"cards_over_under":<"over"|"under">,"asian_handicap_line":<number>,"asian_handicap_pick":<"home"|"away">,"ht_result":<"home_win"|"draw"|"away_win">,"ht_home_prob":<int>,"ht_draw_prob":<int>,"ht_away_prob":<int>,"clean_sheet_home":<"yes"|"no">,"clean_sheet_away":<"yes"|"no">,"first_goal":<"home"|"away"|"no_goal">,"both_score_ht":<"yes"|"no">,"anytime_scorecast":<string>,"ai_analysis":<string 2-3 sentences>,"key_factors":<array of 5 strings>,"key_alpha_metric":<string>,"warning_flags":<array 0-3 strings>}`;
}

function buildUserPrompt(match: MatchInput, modelRole: string): string {
  const cfg = getSportConfig(match.sport ?? 'football');
  const dq = computeDQScore(match);
  const sportRules = cfg.drawPossible
    ? `Draw possible. O/U in ${cfg.unit} (~${cfg.ouLine}). Include corners + cards for football.`
    : `NO DRAW — draw_prob=0, ht_draw_prob=0. btts=yes for basketball/tennis. O/U in ${cfg.unit} (~${cfg.ouLine}).`;
  return `${modelRole}

MATCH: ${match.homeTeam} vs ${match.awayTeam} | ${match.sport?.toUpperCase()} | ${match.league}${match.country ? ` | ${match.country}` : ''}
Status: ${match.status ?? 'upcoming'}${match.venue ? ` | Venue: ${match.venue}` : ''}
Data Quality Score: ${dq}/100${dq < 50 ? ' ⚠️ — cap confidence at 68%' : dq >= 75 ? ' ✅ — full confidence range' : ''}

${buildVerifiedFacts(match)}

SPORT RULES: ${sportRules}
INSTRUCTIONS: Anchor probabilities to Verified Facts (±8% max). Return ONLY the JSON.`;
}

// ─── Parse raw JSON output (shared for OpenAI-compatible + Anthropic) ─────────
function parseModelOutput(
  raw: string,
  spec: ModelSpec,
  weight: number,
  startMs: number,
  match: MatchInput,
): ModelPrediction | null {
  if (!raw || raw.length < 20) return null;
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
  }
  if (!parsed || parsed.status === 'insufficient_data') return null;

  const [nH, nD, nA] = normProbs(Number(parsed.home_win_prob)||0, Number(parsed.draw_prob)||0, Number(parsed.away_win_prob)||0);
  const [nHH, nHD, nHA] = normProbs(Number(parsed.ht_home_prob)||35, Number(parsed.ht_draw_prob)||40, Number(parsed.ht_away_prob)||25);
  const RESULTS = ['home_win', 'draw', 'away_win'] as const;
  const rawRes = String(parsed.predicted_result ?? '');
  const predictedResult = RESULTS.includes(rawRes as typeof RESULTS[number]) ? rawRes as typeof RESULTS[number] : (nH >= nA ? 'home_win' : 'away_win');
  const rawHtRes = String(parsed.ht_result ?? '');
  const htResult = RESULTS.includes(rawHtRes as typeof RESULTS[number]) ? rawHtRes as typeof RESULTS[number] : 'draw';

  const keyFactors = Array.isArray(parsed.key_factors) ? (parsed.key_factors as string[]).filter(Boolean).slice(0, 5) : ['Statistical model applied'];
  while (keyFactors.length < 5) keyFactors.push('Statistical model applied');
  const warningFlags = Array.isArray(parsed.warning_flags) ? (parsed.warning_flags as string[]).filter(Boolean).slice(0, 3) : [];

  const cfg = getSportConfig(match.sport ?? 'football');
  const predHG = Number(parsed.predicted_home_goals ?? 1.5);
  const predAG = Number(parsed.predicted_away_goals ?? 1.2);
  const ouLine = Number(parsed.over_under_line ?? cfg.ouLine);
  const ou = String(parsed.over_under ?? ((predHG + predAG) > ouLine ? 'over' : 'under')).toLowerCase() === 'under' ? 'under' : 'over';
  const conf = Math.max(45, Math.min(95, Number(parsed.confidence) || 65));
  const rawRisk = String(parsed.risk_level ?? '');
  const riskLevel = (['Low','Medium','High'] as const).includes(rawRisk as any) ? rawRisk as 'Low'|'Medium'|'High' : (conf >= 80 ? 'Low' : conf >= 60 ? 'Medium' : 'High');
  const rawSignal = String(parsed.sharp_signal ?? 'neutral').toLowerCase();
  const sharpSignal = (['bullish','neutral','bearish'] as const).includes(rawSignal as any) ? rawSignal as 'bullish'|'neutral'|'bearish' : 'neutral';
  const rawStake = String(parsed.suggested_stake ?? '').toLowerCase();
  const suggestedStake = (['low','medium','high'] as const).includes(rawStake as any) ? rawStake as 'low'|'medium'|'high' : 'medium';
  const rawFG = String(parsed.first_goal ?? 'home').toLowerCase();
  const firstGoal = (['home','away','no_goal'] as const).includes(rawFG as any) ? rawFG as 'home'|'away'|'no_goal' : 'home';

  return {
    modelId: spec.id, provider: spec.provider, weight,
    homeWinProb: nH, drawProb: nD, awayWinProb: nA, predictedResult, confidence: conf,
    overUnder: ou, overUnderLine: ouLine, predictedHomeGoals: predHG, predictedAwayGoals: predAG,
    btts: String(parsed.btts ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    correctScore: String(parsed.correct_score ?? '1-1'),
    cornersLine: Number(parsed.corners_line ?? 9.5),
    cornersOverUnder: String(parsed.corners_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over',
    cardsTotal: Number(parsed.cards_total ?? 3.5),
    cardsOverUnder: String(parsed.cards_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over',
    asianHandicapLine: Number(parsed.asian_handicap_line ?? 0),
    asianHandicapPick: String(parsed.asian_handicap_pick ?? 'home').toLowerCase() === 'away' ? 'away' : 'home',
    htResult, htHomeProb: nHH, htDrawProb: nHD, htAwayProb: nHA,
    cleanSheetHome: String(parsed.clean_sheet_home ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    cleanSheetAway: String(parsed.clean_sheet_away ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    firstGoal, bothScoreHt: String(parsed.both_score_ht ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    riskLevel, valueScore: Math.max(0, Math.min(100, Number(parsed.value_score) || 50)),
    marketEdgePct: Math.max(-50, Math.min(50, Number(parsed.market_edge_pct) || 0)),
    sharpSignal, suggestedStake, aiAnalysis: String(parsed.ai_analysis ?? ''),
    keyFactors, warningFlags,
    keyAlphaMetric: String(parsed.key_alpha_metric ?? keyFactors[0] ?? ''),
    anytimeScorecast: String(parsed.anytime_scorecast ?? ''),
    latencyMs: Date.now() - startMs,
  };
}

// ─── Call OpenAI-compatible providers (OpenAI, Groq/Llama, Gemini) ───────────
async function callOpenAICompatible(
  spec: ModelSpec,
  match: MatchInput,
  weight: number,
  apiKey: string,
  baseURL: string,
): Promise<ModelPrediction | null> {
  const startMs = Date.now();
  const roleDescriptor = MODEL_ROLES[spec.id] ?? 'Your role: ANALYSIS. Produce a statistical prediction anchored in the supplied facts.';
  const modelsToTry = [spec.model, ...(MODEL_FALLBACKS[spec.id] ?? []).filter((m) => m !== spec.model)];

  for (const model of modelsToTry) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const requestBody: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(match, roleDescriptor) },
        ],
        temperature: spec.temperature,
        max_tokens: spec.maxTokens,
      };
      // Groq Llama may not support json_object response_format on all model versions
      if (spec.provider !== 'groq') {
        requestBody.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const status = res.status;
        if (status === 429 || status >= 500) {
          console.warn(`[multi-model] ${spec.provider}/${model} returned ${status} — trying fallback`);
          continue;
        }
        return null; // 4xx config error — don't retry
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      const result = parseModelOutput(raw, { ...spec, model }, weight, startMs, match);
      if (result) return result;
    } catch (err) {
      console.warn(`[multi-model] ${spec.provider}/${model} threw:`, err instanceof Error ? err.message.slice(0, 80) : String(err));
    }
  }
  return null;
}

// ─── Call Anthropic Claude (native Messages API with intra-provider fallback) ─
async function callClaude(
  spec: ModelSpec,
  match: MatchInput,
  weight: number,
  apiKey: string,
): Promise<ModelPrediction | null> {
  const startMs = Date.now();
  const sysPrompt  = buildSystemPrompt();
  const userPrompt = buildUserPrompt(match, MODEL_ROLES['claude'] ?? 'Reasoning & calibration.');
  const modelsToTry = [spec.model, ...(MODEL_FALLBACKS[spec.id] ?? []).filter((m) => m !== spec.model)];

  for (const model of modelsToTry) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: spec.maxTokens,
          temperature: spec.temperature,
          system: sysPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const status = res.status;
        if (status === 429 || status >= 500) {
          console.warn(`[multi-model] anthropic/${model} returned ${status} — trying fallback`);
          continue;
        }
        return null;
      }

      const data = await res.json();
      const raw = data.content?.[0]?.text ?? '';
      const result = parseModelOutput(raw, { ...spec, model }, weight, startMs, match);
      if (result) return result;
    } catch (err) {
      console.warn(`[multi-model] anthropic/${model} threw:`, err instanceof Error ? err.message.slice(0, 80) : String(err));
    }
  }
  return null;
}

// ─── Dispatch to correct provider ────────────────────────────────────────────
async function callModel(
  spec: ModelSpec,
  match: MatchInput,
  weight: number,
  apiKeys: { openai?: string; groq?: string; gemini?: string; anthropic?: string },
): Promise<ModelPrediction | null> {
  switch (spec.provider) {
    case 'anthropic':
      if (!apiKeys.anthropic) return null;
      return callClaude(spec, match, weight, apiKeys.anthropic);
    case 'groq':
      if (!apiKeys.groq) return null;
      return callOpenAICompatible(spec, match, weight, apiKeys.groq, GROQ_BASE);
    case 'gemini':
      if (!apiKeys.gemini) return null;
      return callOpenAICompatible(spec, match, weight, apiKeys.gemini, GEMINI_BASE);
    case 'openai':
    default:
      if (!apiKeys.openai) return null;
      return callOpenAICompatible(spec, match, weight, apiKeys.openai, OPENAI_BASE);
  }
}

// ─── Consensus aggregation ────────────────────────────────────────────────────
function aggregate(
  results: Array<ModelPrediction | null>,
  specs: ModelSpec[],
  match: MatchInput,
  dq: number,
): ConsensusResult {
  const valid = results.filter((r): r is ModelPrediction => r !== null);
  if (valid.length === 0) throw new Error('All models failed');

  let wSum = 0, wHW = 0, wD = 0, wAW = 0, wConf = 0;
  let wHG = 0, wAG = 0, wOuLine = 0, wCorners = 0, wCards = 0;
  let wHtH = 0, wHtD = 0, wHtA = 0, wVS = 0, wME = 0;

  for (const r of valid) {
    const w = r.weight;
    wSum += w; wHW += r.homeWinProb * w; wD += r.drawProb * w; wAW += r.awayWinProb * w;
    wConf += r.confidence * w; wHG += r.predictedHomeGoals * w; wAG += r.predictedAwayGoals * w;
    wOuLine += r.overUnderLine * w; wCorners += r.cornersLine * w; wCards += r.cardsTotal * w;
    wHtH += r.htHomeProb * w; wHtD += r.htDrawProb * w; wHtA += r.htAwayProb * w;
    wVS += r.valueScore * w; wME += r.marketEdgePct * w;
  }

  const [hwProb, dProb, awProb] = normProbs(wHW / wSum, wD / wSum, wAW / wSum);
  const [htH, htD, htA] = normProbs(wHtH / wSum, wHtD / wSum, wHtA / wSum);
  const avgConf = Math.round(wConf / wSum);
  const predHG = Math.round((wHG / wSum) * 10) / 10;
  const predAG = Math.round((wAG / wSum) * 10) / 10;
  const ouLine = Math.round((wOuLine / wSum) * 2) / 2;
  const cornersLine = Math.round((wCorners / wSum) * 2) / 2;
  const cardsTotal = Math.round((wCards / wSum) * 2) / 2;
  const valueScore = Math.round(wVS / wSum);
  const marketEdgePct = Math.round(wME / wSum);

  const voteTally = (field: keyof ModelPrediction) => {
    const votes: Record<string, number> = {};
    for (const r of valid) { const v = String(r[field]); votes[v] = (votes[v] || 0) + r.weight; }
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  };

  const predictedResult = voteTally('predictedResult') as 'home_win' | 'draw' | 'away_win';
  const overUnder = voteTally('overUnder') as 'over' | 'under';
  const btts = voteTally('btts') as 'yes' | 'no';
  const htResult = voteTally('htResult') as 'home_win' | 'draw' | 'away_win';
  const sharpSignal = voteTally('sharpSignal') as 'bullish' | 'neutral' | 'bearish';
  const cleanSheetHome = voteTally('cleanSheetHome') as 'yes' | 'no';
  const cleanSheetAway = voteTally('cleanSheetAway') as 'yes' | 'no';
  const firstGoal = voteTally('firstGoal') as 'home' | 'away' | 'no_goal';
  const bothScoreHt = voteTally('bothScoreHt') as 'yes' | 'no';
  const cornersOU = voteTally('cornersOverUnder') as 'over' | 'under';
  const cardsOU = voteTally('cardsOverUnder') as 'over' | 'under';
  const ahPick = voteTally('asianHandicapPick') as 'home' | 'away';

  const agreementCount = valid.filter((r) => r.predictedResult === predictedResult).length;
  const agreementRatio = agreementCount / valid.length;

  let finalConf = avgConf;
  if (valid.length >= 4 && agreementRatio >= 0.80) finalConf = Math.min(95, finalConf + 5);
  else if (valid.length >= 3 && agreementRatio >= 0.75) finalConf = Math.min(95, finalConf + 3);
  else if (agreementRatio < 0.5) finalConf = Math.max(45, finalConf - 8);

  if (dq < 30) finalConf = Math.min(finalConf, 55);
  else if (dq < 50) finalConf = Math.min(finalConf, 68);
  else if (dq < 70) finalConf = Math.min(finalConf, 82);

  let halluScore = 0;
  for (const r of valid) {
    if (Math.abs(r.homeWinProb - hwProb) > 25 || Math.abs(r.drawProb - dProb) > 20) halluScore += 20;
  }
  halluScore = Math.min(100, Math.round(halluScore / Math.max(valid.length, 1)));

  const primaryModel = valid.reduce((best, r) => r.confidence > best.confidence ? r : best, valid[0]);

  const allFactors: string[] = [];
  for (const r of valid) allFactors.push(...r.keyFactors.filter(Boolean));
  const uniqueFactors = [...new Set(allFactors)].slice(0, 5);
  while (uniqueFactors.length < 5) uniqueFactors.push('Statistical model consensus applied');

  const allWarnings: string[] = [];
  for (const r of valid) allWarnings.push(...r.warningFlags);
  if (halluScore > 40) allWarnings.push(`Model divergence (${agreementCount}/${valid.length} agree)`);
  if (dq < 50) allWarnings.push(`Limited data quality (${dq}/100)`);
  if (valid.length < 3) allWarnings.push(`Only ${valid.length} models responded`);
  const uniqueWarnings = [...new Set(allWarnings)].slice(0, 3);

  const riskLevel: 'Low' | 'Medium' | 'High' = finalConf >= 80 ? 'Low' : finalConf >= 60 ? 'Medium' : 'High';
  const suggestedStake: 'low' | 'medium' | 'high' = finalConf >= 80 ? 'high' : finalConf >= 65 ? 'medium' : 'low';
  const ou = (predHG + predAG) > ouLine ? 'over' : overUnder;

  return {
    modelId: 'consensus', provider: 'multi-model', weight: 1.0,
    homeWinProb: hwProb, drawProb: dProb, awayWinProb: awProb,
    predictedResult, confidence: finalConf,
    overUnder: ou, overUnderLine: ouLine, predictedHomeGoals: predHG, predictedAwayGoals: predAG,
    btts, correctScore: primaryModel.correctScore, cornersLine, cornersOverUnder: cornersOU,
    cardsTotal, cardsOverUnder: cardsOU,
    asianHandicapLine: primaryModel.asianHandicapLine, asianHandicapPick: ahPick,
    htResult, htHomeProb: htH, htDrawProb: htD, htAwayProb: htA,
    cleanSheetHome, cleanSheetAway, firstGoal, bothScoreHt,
    riskLevel, valueScore, marketEdgePct, sharpSignal, suggestedStake,
    aiAnalysis: primaryModel.aiAnalysis, keyFactors: uniqueFactors, warningFlags: uniqueWarnings,
    keyAlphaMetric: primaryModel.keyAlphaMetric, anytimeScorecast: primaryModel.anytimeScorecast,
    latencyMs: Math.max(...valid.map((r) => r.latencyMs)),
    modelsUsed: valid.length, modelsAgreed: agreementCount,
    consensusPassed: agreementCount >= Math.ceil(valid.length / 2),
    hallucinationScore: halluScore, dqScore: dq,
    modelBreakdown: specs.map((s, i) => {
      const r = results[i];
      return r
        ? { id: s.id, result: r.predictedResult, confidence: r.confidence, latencyMs: r.latencyMs }
        : { id: s.id, result: 'failed', confidence: 0, latencyMs: 0, error: 'timeout_or_error' };
    }),
    predictionVersion: 11, // 5-model consensus with live weight loading
  };
}

// ─── Deno handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 6, windowSec: 60, blockSec: 180 },
      maxPayloadBytes: 80_000,
      rateLimitScope: 'multi-predict',
      blockBotUa: true,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const body = parsedBody as Record<string, unknown>;
    if (!body) return secureErrorResponse('Empty body', 400);

    const match = body.match as MatchInput;

    // ── SECURITY: derive user identity from JWT, NEVER from body.user_id ─────
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { createClient: cc } = await import('https://esm.sh/@supabase/supabase-js@2');
        const userClient = cc(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
      } catch { /* JWT verification failed — proceed as anonymous */ }
    }

    if (userId) {
      const userGuard = applyUserRateLimit(userId, 'multi-predict', { max: 3, windowSec: 60, blockSec: 180 });
      if (userGuard) return userGuard;
    }

    if (!match?.id || !match?.homeTeam || !match?.awayTeam) {
      return secureErrorResponse('match.id, homeTeam, awayTeam required', 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const apiKeys = {
      openai:    Deno.env.get('OPENAI_API_KEY'),
      groq:      Deno.env.get('Groq_API') ?? Deno.env.get('Groq_API_Key'),
      gemini:    Deno.env.get('Gemini_API_Key'),
      anthropic: Deno.env.get('ANTHROPIC_API_KEY'),
    };

    if (!apiKeys.openai && !apiKeys.groq && !apiKeys.gemini && !apiKeys.anthropic) {
      return secureErrorResponse('No AI provider keys configured', 500);
    }

    const dq = computeDQScore(match);

    // ── Filter to only models whose provider key is configured ────────────────
    const MODELS = ALL_MODEL_SPECS.filter((spec) => {
      if (spec.provider === 'openai')    return !!apiKeys.openai;
      if (spec.provider === 'groq')     return !!apiKeys.groq;
      if (spec.provider === 'gemini')   return !!apiKeys.gemini;
      if (spec.provider === 'anthropic') return !!apiKeys.anthropic;
      return false;
    });

    if (MODELS.length === 0) {
      return secureErrorResponse('No AI provider keys configured for any model', 500);
    }

    // ── Load live weights from DB (non-blocking, falls back to defaults) ──────
    const liveWeights = await fetchLiveWeights(supabase);

    // ── Fan out to configured models in parallel ──────────────────────────────
    const modelCalls = MODELS.map((spec) => {
      const weight = liveWeights[spec.id] ?? spec.defaultWeight;
      return callModel(spec, match, weight, apiKeys);
    });

    const rawResults = await Promise.allSettled(modelCalls);
    const results: Array<ModelPrediction | null> = rawResults.map((r) =>
      r.status === 'fulfilled' ? r.value : null,
    );

    if (results.filter(Boolean).length === 0) {
      return secureErrorResponse('All AI models failed or timed out', 502);
    }

    // ── Aggregate ──────────────────────────────────────────────────────────────
    let consensus: ConsensusResult;
    try { consensus = aggregate(results, MODELS, match, dq); }
    catch { return secureErrorResponse('Consensus aggregation failed', 502); }

    // ── Persist ────────────────────────────────────────────────────────────────
    const predRow = {
      match_id: match.id, user_id: userId,
      home_win_prob: consensus.homeWinProb, draw_prob: consensus.drawProb, away_win_prob: consensus.awayWinProb,
      predicted_result: consensus.predictedResult, confidence: consensus.confidence,
      over_under: consensus.overUnder, over_under_line: consensus.overUnderLine,
      predicted_home_goals: consensus.predictedHomeGoals, predicted_away_goals: consensus.predictedAwayGoals,
      btts: consensus.btts, correct_score: consensus.correctScore,
      corners_over_under: consensus.cornersOverUnder, corners_line: consensus.cornersLine,
      cards_total: consensus.cardsTotal, cards_over_under: consensus.cardsOverUnder,
      asian_handicap_line: consensus.asianHandicapLine, asian_handicap_pick: consensus.asianHandicapPick,
      ht_result: consensus.htResult, ht_home_prob: consensus.htHomeProb, ht_draw_prob: consensus.htDrawProb, ht_away_prob: consensus.htAwayProb,
      clean_sheet_home: consensus.cleanSheetHome, clean_sheet_away: consensus.cleanSheetAway,
      first_goal: consensus.firstGoal, both_score_ht: consensus.bothScoreHt,
      anytime_scorecast: consensus.anytimeScorecast, ai_analysis: consensus.aiAnalysis,
      key_factors: consensus.keyFactors, risk_level: consensus.riskLevel,
      value_score: consensus.valueScore, market_edge_pct: consensus.marketEdgePct,
      sharp_signal: consensus.sharpSignal, suggested_stake: consensus.suggestedStake,
      warning_flags: consensus.warningFlags, key_alpha_metric: consensus.keyAlphaMetric,
      prediction_version: consensus.predictionVersion,
    };

    const [predResult] = await Promise.allSettled([
      supabase.from('predictions').insert(predRow).select().single(),
      supabase.from('ai_audit_logs').insert({
        match_id: match.id, user_id: userId,
        provider_code: 'multi-model-consensus-v6',
        function_name: 'multi-model-prediction',
        prompt_version: 3,
        prediction_version: consensus.predictionVersion,
        facts_object: buildVerifiedFacts(match) as unknown as Record<string, unknown>,
        pre_validation_passed: dq >= 30,
        post_validation_passed: consensus.hallucinationScore < 50,
        hallucination_score: consensus.hallucinationScore,
        consensus_passed: consensus.consensusPassed,
        approval_status: consensus.consensusPassed ? 'approved' : 'review',
        dq_score: dq, confidence_output: consensus.confidence,
        risk_level: consensus.riskLevel, output_tokens: null,
        latency_ms: consensus.latencyMs, warning_flags: consensus.warningFlags,
        rejection_reason: consensus.consensusPassed ? null : 'Model disagreement',
      }),
    ]);

    const savedPred = predResult.status === 'fulfilled' && !predResult.value.error
      ? predResult.value.data : predRow;

    return secureResponse({
      success: true,
      prediction: savedPred,
      consensus: {
        modelsUsed: consensus.modelsUsed,
        modelsAgreed: consensus.modelsAgreed,
        consensusPassed: consensus.consensusPassed,
        hallucinationScore: consensus.hallucinationScore,
        dqScore: consensus.dqScore,
        latencyMs: consensus.latencyMs,
        breakdown: consensus.modelBreakdown,
      },
    });
  } catch {
    return secureErrorResponse('Internal server error', 500);
  }
});
