/**
 * supabase/functions/generate-prediction/index.ts  v6.0
 *
 * Upgraded Prediction Pipeline:
 *   1. Quantitative sport-specific model (math anchor)
 *   2. AI Provider Router: OpenAI → Gemini → Groq (auto-failover, circuit breaker)
 *   3. LLMs receive Verified Facts Object — constrained to ±8% deviation
 *   4. Quality gate validation before storage
 *   5. Idempotency: skip if recent prediction already exists
 *   6. Full audit logging
 *
 * Cost optimization:
 *   - DQ < 40 → Groq only (fast, cheap)
 *   - DQ 40–70 → primary_with_fallback (OpenAI → Gemini → Groq)
 *   - DQ ≥ 70 + high-value league → consensus_two (OpenAI + Gemini)
 *   - All LLMs unavailable → quantitative model only (still published)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsOptions } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  applyUserRateLimit,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';
import {
  runQuantitativeModel,
  computeDQScore,
  normToHundred,
  marketImplied,
  type MatchFeatures,
  type QuantModelOutput,
} from '../_shared/quantitativeModels.ts';
import {
  routeAICall,
  routeConsensusCall,
  selectRoutingStrategy,
  isHighValueLeague,
  parseAndValidatePredictionJSON,
  getProviderCircuitHealth,
  type AICallResult,
  type RoutingStrategy,
} from '../_shared/aiProviderRouter.ts';
import { runQualityGate, type PredictionForGate } from '../_shared/qualityGate.ts';

// ─── Sport configuration (default lines per sport) ───────────────────────────
const DEFAULT_OU_LINES: Record<string, number> = {
  football: 2.5, basketball: 215.5, tennis: 2.5, cricket: 320.5,
  baseball: 8.5, hockey: 5.5, rugby: 42.5, mma: 2.5, boxing: 8.5,
  handball: 55.5, volleyball: 3.5, esports: 2.5,
  'american-football': 44.5,
};

const DRAW_POSSIBLE_SPORTS = new Set(['football', 'soccer', 'cricket', 'rugby', 'handball']);

function getOULine(sport: string): number {
  return DEFAULT_OU_LINES[sport.toLowerCase()] ?? 2.5;
}

// ─── Build LLM system prompt ─────────────────────────────────────────────────
function buildSystemPrompt(sport: string): string {
  const drawRule = DRAW_POSSIBLE_SPORTS.has(sport.toLowerCase())
    ? 'Draw IS possible for this sport.'
    : 'NO DRAW for this sport — draw_prob MUST be 0, ht_draw_prob MUST be 0.';

  return `You are a sportsbook-grade prediction engine. You MUST follow these rules absolutely:

1. Return ONLY a valid JSON object — no markdown, no code fences, no text outside JSON.
2. Use ONLY the statistics in the VERIFIED FACTS OBJECT. NEVER invent statistics.
3. Anchor home_win_prob / draw_prob / away_win_prob to the Model Probability Anchor — max ±8% deviation.
4. home_win_prob + draw_prob + away_win_prob = EXACTLY 100.
5. ht_home_prob + ht_draw_prob + ht_away_prob = EXACTLY 100.
6. ${drawRule}
7. If data is critically insufficient: {"status":"insufficient_data","message":"Insufficient data for reliable prediction."}

CONFIDENCE CALIBRATION:
- Never exceed 92% confidence regardless of apparent certainty.
- DQ < 40: cap at 58%. DQ 40-60: cap at 72%. DQ 60-80: cap at 84%. DQ >= 80: up to 92%.
- Base confidence on model agreement, data quality, and historical reliability.

OUTPUT — return ONLY this exact JSON schema:
{"status":"success","home_win_prob":<int>,"draw_prob":<int>,"away_win_prob":<int>,"predicted_result":<"home_win"|"draw"|"away_win">,"confidence":<int 45-92>,"risk_level":<"Low"|"Medium"|"High">,"value_score":<int 0-100>,"market_edge_pct":<int -40 to 40>,"sharp_signal":<"bullish"|"neutral"|"bearish">,"suggested_stake":<"low"|"medium"|"high">,"over_under":<"over"|"under">,"over_under_line":<number>,"predicted_home_goals":<number>,"predicted_away_goals":<number>,"btts":<"yes"|"no">,"correct_score":<string>,"corners_over_under":<"over"|"under">,"corners_line":<number>,"cards_total":<number>,"cards_over_under":<"over"|"under">,"asian_handicap_line":<number>,"asian_handicap_pick":<"home"|"away">,"ht_result":<"home_win"|"draw"|"away_win">,"ht_home_prob":<int>,"ht_draw_prob":<int>,"ht_away_prob":<int>,"clean_sheet_home":<"yes"|"no">,"clean_sheet_away":<"yes"|"no">,"first_goal":<"home"|"away"|"no_goal">,"both_score_ht":<"yes"|"no">,"anytime_scorecast":<string>,"ai_analysis":<string 2-3 sentences>,"key_factors":<array of 5 strings>,"warning_flags":<array 0-3 strings>,"key_alpha_metric":<string>}`;
}

function buildUserPrompt(match: MatchFeatures, quantOutput: QuantModelOutput): string {
  const ouLine = getOULine(match.sport ?? 'football');
  const drawNote = DRAW_POSSIBLE_SPORTS.has((match.sport ?? 'football').toLowerCase())
    ? 'Draw is possible.' : 'No draws for this sport.';

  return `Generate a ${(match.sport ?? 'football').toUpperCase()} prediction.
Match: ${match.homeTeam} vs ${match.awayTeam} | ${match.league ?? 'Unknown League'}
Status: ${match.status ?? 'upcoming'} | O/U default: ~${ouLine} | ${drawNote}
Data Quality: ${quantOutput.dqScore}/100
Quantitative Method: ${quantOutput.modelMethod}

${quantOutput.verifiedFactsText}

INSTRUCTION: Anchor probabilities to the Model Probability Anchor above (±8% max deviation). Provide deeper contextual analysis. Return ONLY JSON.`;
}

// ─── Merge quantitative output with LLM output ───────────────────────────────
function mergeOutputs(
  quant: QuantModelOutput,
  llmParsed: Record<string, unknown> | null,
  sport: string,
): Record<string, unknown> {
  const drawPossible = DRAW_POSSIBLE_SPORTS.has(sport.toLowerCase());

  if (!llmParsed) {
    // Quantitative-only prediction
    const ouLine = quant.totalExpected != null
      ? Math.round(quant.totalExpected * 2) / 2
      : getOULine(sport);
    const overUnder = quant.expectedHomeScore != null && quant.expectedAwayScore != null
      ? (quant.expectedHomeScore + quant.expectedAwayScore) > ouLine ? 'over' : 'under'
      : 'over';
    const [nHH, nHD, nHA] = normToHundred(35, drawPossible ? 40 : 0, 25);
    return {
      home_win_prob: quant.homeWinProb,
      draw_prob: quant.drawProb,
      away_win_prob: quant.awayWinProb,
      predicted_result: quant.predictedResult,
      confidence: quant.confidence,
      risk_level: quant.confidence >= 80 ? 'Low' : quant.confidence >= 60 ? 'Medium' : 'High',
      value_score: 50,
      market_edge_pct: 0,
      sharp_signal: 'neutral',
      suggested_stake: quant.confidence >= 80 ? 'medium' : 'low',
      over_under: overUnder,
      over_under_line: ouLine,
      predicted_home_goals: quant.expectedHomeScore ?? 1.4,
      predicted_away_goals: quant.expectedAwayScore ?? 1.1,
      btts: quant.drawProb > 20 ? 'yes' : 'no',
      correct_score: '1-1',
      corners_over_under: 'over', corners_line: sport === 'football' ? 9.5 : 0,
      cards_total: sport === 'football' ? 3.5 : 0, cards_over_under: 'over',
      asian_handicap_line: 0, asian_handicap_pick: 'home',
      ht_result: 'draw', ht_home_prob: nHH, ht_draw_prob: nHD, ht_away_prob: nHA,
      clean_sheet_home: 'no', clean_sheet_away: 'no',
      first_goal: 'home', both_score_ht: 'no', anytime_scorecast: '',
      ai_analysis: `Statistical model prediction: ${quant.modelMethod}. Quantitative probability anchor applied.`,
      key_factors: ['Statistical model consensus', 'Elo rating differential', 'Recent form analysis', 'Data quality considered', 'Market signal incorporated'],
      warning_flags: quant.dqScore < 50 ? [`Limited data quality (${quant.dqScore}/100)`] : [],
      key_alpha_metric: `Model confidence: ${quant.confidence}%`,
      source: 'quantitative_only',
    };
  }

  // LLM output: clamp probabilities to ±8% of quantitative anchor
  const clamp = (llmVal: number, anchor: number, maxDev = 8) =>
    Math.max(0, Math.min(100, Math.round(
      Math.min(anchor + maxDev, Math.max(anchor - maxDev, llmVal))
    )));

  const llmHW = clamp(Number(llmParsed.home_win_prob) || 0, quant.homeWinProb);
  const llmD  = drawPossible ? clamp(Number(llmParsed.draw_prob) || 0, quant.drawProb) : 0;
  const llmAW = clamp(Number(llmParsed.away_win_prob) || 0, quant.awayWinProb);
  const [nHW, nD, nAW] = normToHundred(llmHW, llmD, llmAW);

  const ouLine = Number(llmParsed.over_under_line ?? getOULine(sport));
  const predHG = Number(llmParsed.predicted_home_goals ?? (quant.expectedHomeScore ?? 1.4));
  const predAG = Number(llmParsed.predicted_away_goals ?? (quant.expectedAwayScore ?? 1.1));
  const overUnder = String(llmParsed.over_under ?? ((predHG + predAG > ouLine) ? 'over' : 'under')).toLowerCase() === 'under' ? 'under' : 'over';

  // DQ-gated confidence ceiling
  let llmConf = Math.max(45, Math.min(92, Number(llmParsed.confidence) || quant.confidence));
  if (quant.dqScore < 40) llmConf = Math.min(llmConf, 58);
  else if (quant.dqScore < 60) llmConf = Math.min(llmConf, 72);
  else if (quant.dqScore < 80) llmConf = Math.min(llmConf, 84);

  const RESULTS = ['home_win', 'draw', 'away_win'] as const;
  const rawResult = String(llmParsed.predicted_result ?? quant.predictedResult);
  const predictedResult = RESULTS.includes(rawResult as any)
    ? (rawResult as typeof RESULTS[number])
    : quant.predictedResult;

  const rawHtResult = String(llmParsed.ht_result ?? 'draw');
  const htResult = RESULTS.includes(rawHtResult as any) ? (rawHtResult as typeof RESULTS[number]) : 'draw';
  const [nHH, nHD, nHA] = normToHundred(
    Number(llmParsed.ht_home_prob) || 35,
    drawPossible ? (Number(llmParsed.ht_draw_prob) || 40) : 0,
    Number(llmParsed.ht_away_prob) || 25,
  );

  const rawRisk = String(llmParsed.risk_level ?? '');
  const riskLevel = (['Low', 'Medium', 'High'] as const).includes(rawRisk as any)
    ? rawRisk as 'Low' | 'Medium' | 'High'
    : llmConf >= 80 ? 'Low' : llmConf >= 60 ? 'Medium' : 'High';

  const rawSignal = String(llmParsed.sharp_signal ?? 'neutral').toLowerCase();
  const sharpSignal = (['bullish', 'neutral', 'bearish'] as const).includes(rawSignal as any)
    ? rawSignal as 'bullish' | 'neutral' | 'bearish' : 'neutral';

  const rawStake = String(llmParsed.suggested_stake ?? '').toLowerCase();
  const suggestedStake = (['low', 'medium', 'high'] as const).includes(rawStake as any)
    ? rawStake as 'low' | 'medium' | 'high' : 'medium';

  const rawFG = String(llmParsed.first_goal ?? 'home').toLowerCase();
  const firstGoal = (['home', 'away', 'no_goal'] as const).includes(rawFG as any)
    ? rawFG as 'home' | 'away' | 'no_goal' : 'home';

  const keyFactors = Array.isArray(llmParsed.key_factors)
    ? (llmParsed.key_factors as string[]).filter(Boolean).slice(0, 5)
    : [];
  while (keyFactors.length < 5) keyFactors.push('Statistical model consensus applied');

  const warningFlags = Array.isArray(llmParsed.warning_flags)
    ? (llmParsed.warning_flags as string[]).filter(Boolean).slice(0, 3)
    : [];
  if (quant.dqScore < 50) warningFlags.push(`Limited data quality (${quant.dqScore}/100)`);

  return {
    home_win_prob: nHW, draw_prob: nD, away_win_prob: nAW,
    predicted_result: predictedResult, confidence: llmConf,
    risk_level: riskLevel, value_score: Math.max(0, Math.min(100, Number(llmParsed.value_score) || 50)),
    market_edge_pct: Math.max(-40, Math.min(40, Number(llmParsed.market_edge_pct) || 0)),
    sharp_signal: sharpSignal, suggested_stake: suggestedStake,
    over_under: overUnder, over_under_line: ouLine,
    predicted_home_goals: predHG, predicted_away_goals: predAG,
    btts: String(llmParsed.btts ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    correct_score: String(llmParsed.correct_score ?? '1-1'),
    corners_over_under: String(llmParsed.corners_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over',
    corners_line: Number(llmParsed.corners_line ?? (sport === 'football' ? 9.5 : 0)),
    cards_total: Number(llmParsed.cards_total ?? (sport === 'football' ? 3.5 : 0)),
    cards_over_under: String(llmParsed.cards_over_under ?? 'over').toLowerCase() === 'under' ? 'under' : 'over',
    asian_handicap_line: Number(llmParsed.asian_handicap_line ?? 0),
    asian_handicap_pick: String(llmParsed.asian_handicap_pick ?? 'home').toLowerCase() === 'away' ? 'away' : 'home',
    ht_result: htResult, ht_home_prob: nHH, ht_draw_prob: nHD, ht_away_prob: nHA,
    clean_sheet_home: String(llmParsed.clean_sheet_home ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    clean_sheet_away: String(llmParsed.clean_sheet_away ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    first_goal: firstGoal,
    both_score_ht: String(llmParsed.both_score_ht ?? 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
    anytime_scorecast: String(llmParsed.anytime_scorecast ?? ''),
    ai_analysis: String(llmParsed.ai_analysis ?? ''),
    key_factors: keyFactors, warning_flags: warningFlags,
    key_alpha_metric: String(llmParsed.key_alpha_metric ?? keyFactors[0] ?? ''),
    source: 'llm_anchored',
  };
}

// ─── Deno handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsOptions(req, false);

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 12, windowSec: 60, blockSec: 120 },
      maxPayloadBytes: 80_000,
      rateLimitScope: 'predict',
      blockBotUa: true,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const body = parsedBody as Record<string, unknown>;
    if (!body) return secureErrorResponse('Empty body', 400);

    const match = body.match as MatchFeatures;
    const userId = (body.user_id as string) ?? null;
    const bypassCache = Boolean(body.bypass_cache ?? false);

    if (userId) {
      const userGuard = applyUserRateLimit(userId, 'predict', { max: 6, windowSec: 60, blockSec: 120 });
      if (userGuard) return userGuard;
    }

    if (!match?.sport || !match?.homeTeam || !match?.awayTeam) {
      return secureErrorResponse('match.sport, homeTeam, awayTeam required', 400);
    }

    const sport = (match.sport ?? 'football').toLowerCase();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Idempotency: check for recent prediction ──────────────────────────────
    if (!bypassCache && match.id) {
      const since = new Date(Date.now() - 4 * 3600_000).toISOString();
      const { data: existing } = await supabase
        .from('predictions')
        .select('id, confidence, prediction_version')
        .eq('match_id', match.id)
        .gte('created_at', since)
        .order('prediction_version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.log(`[generate-prediction] Cache hit for match=${match.id} pred=${existing.id}`);
        return secureResponse({ success: true, prediction: existing, cached: true });
      }
    }

    // ── Step 1: Quantitative model (always runs) ──────────────────────────────
    const quantOutput = runQuantitativeModel(match);
    console.log(`[generate-prediction] Quant model: ${sport} DQ=${quantOutput.dqScore} conf=${quantOutput.confidence} method=${quantOutput.modelMethod}`);

    // ── Step 2: Determine AI routing strategy ─────────────────────────────────
    const highValue = isHighValueLeague(match.league ?? '');
    const strategy = selectRoutingStrategy({
      sport,
      dqScore: quantOutput.dqScore,
      league: match.league,
      isHighValue: highValue,
      isLive: match.status === 'live',
    });

    // ── Step 3: Call AI provider(s) ───────────────────────────────────────────
    let aiResult: AICallResult | null = null;
    let aiResults: AICallResult[] = [];
    let providerCode = 'quantitative_only';
    let usedStrategy: RoutingStrategy = strategy;

    const systemPrompt = buildSystemPrompt(sport);
    const userPrompt = buildUserPrompt(match, quantOutput);
    const aiOptions = { messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.5, maxTokens: 1400, requireJsonObject: true };

    if (strategy === 'consensus_two') {
      const consensusResult = await routeConsensusCall('consensus_two', aiOptions);
      aiResults = consensusResult.results;
      aiResult = aiResults[0] ?? null;
      providerCode = `consensus:${consensusResult.providersSucceeded.join('+')}`;
    } else if (strategy !== 'primary_only') {
      aiResult = await routeAICall(strategy, aiOptions);
      if (aiResult) providerCode = `${aiResult.provider}/${aiResult.model}`;
      else providerCode = 'quantitative_only';
    }

    // ── Step 4: Parse and merge outputs ──────────────────────────────────────
    let llmParsed: Record<string, unknown> | null = null;
    if (aiResult) {
      llmParsed = parseAndValidatePredictionJSON(aiResult.content);
      if (!llmParsed) {
        console.warn(`[generate-prediction] LLM JSON parse failed, falling back to quant-only`);
        providerCode = 'quantitative_fallback';
      }
    }

    // For consensus: try to merge multiple LLM outputs
    if (aiResults.length > 1) {
      const parsedResults = aiResults.map((r) => parseAndValidatePredictionJSON(r.content)).filter(Boolean) as Record<string, unknown>[];
      if (parsedResults.length > 0) {
        // Average the probabilities across valid LLM results
        const avgHW = Math.round(parsedResults.reduce((s, r) => s + Number(r.home_win_prob ?? 0), 0) / parsedResults.length);
        const avgD = Math.round(parsedResults.reduce((s, r) => s + Number(r.draw_prob ?? 0), 0) / parsedResults.length);
        const avgAW = Math.round(parsedResults.reduce((s, r) => s + Number(r.away_win_prob ?? 0), 0) / parsedResults.length);
        const avgConf = Math.round(parsedResults.reduce((s, r) => s + Number(r.confidence ?? 0), 0) / parsedResults.length);
        // Use first result as template and override probabilities with average
        llmParsed = { ...parsedResults[0], home_win_prob: avgHW, draw_prob: avgD, away_win_prob: avgAW, confidence: avgConf };
      }
    }

    const merged = mergeOutputs(quantOutput, llmParsed, sport);

    // ── Step 5: Quality gate ──────────────────────────────────────────────────
    const forGate: PredictionForGate = {
      match_id: match.id ?? 'unknown',
      home_win_prob: merged.home_win_prob as number,
      draw_prob: merged.draw_prob as number,
      away_win_prob: merged.away_win_prob as number,
      predicted_result: merged.predicted_result as string,
      confidence: merged.confidence as number,
      over_under: merged.over_under as string,
      over_under_line: merged.over_under_line as number,
      btts: merged.btts as string,
      ai_analysis: merged.ai_analysis as string,
      key_factors: merged.key_factors as string[],
      predicted_home_goals: merged.predicted_home_goals as number,
      predicted_away_goals: merged.predicted_away_goals as number,
      correct_score: merged.correct_score as string,
      risk_level: merged.risk_level as string,
      value_score: merged.value_score as number,
      market_edge_pct: merged.market_edge_pct as number,
      warning_flags: merged.warning_flags as string[],
      match_sport: sport,
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      match_status: match.status ?? 'upcoming',
      enrichment_pct: quantOutput.dqScore,
    };

    const gateResult = runQualityGate(forGate, { strictMode: false, minApprovalScore: 45 });

    if (!gateResult.approved) {
      console.warn(`[generate-prediction] Quality gate REJECTED: ${gateResult.rejectionReason} score=${gateResult.overallScore}`);
      return secureResponse({
        success: false,
        rejected: true,
        rejectionReason: gateResult.rejectionReason,
        qualityScore: gateResult.overallScore,
      });
    }

    // ── Step 6: Determine prediction version ─────────────────────────────────
    const predVersion = strategy === 'consensus_two' ? 12
      : strategy === 'consensus_three' ? 13
      : providerCode.includes('openai') ? 10
      : providerCode.includes('gemini') ? 9
      : providerCode.includes('groq') ? 9
      : 8; // quantitative only

    // ── Step 7: Persist ───────────────────────────────────────────────────────
    const row = {
      match_id: match.id ?? null,
      user_id: userId,
      ...merged,
      quality_gate_score: gateResult.overallScore,
      enrichment_pct: quantOutput.dqScore,
      prediction_version: predVersion,
    };

    const { data: saved, error: dbErr } = await supabase
      .from('predictions')
      .insert(row)
      .select()
      .single();

    // Audit log (non-blocking)
    supabase.from('ai_audit_logs').insert({
      match_id: match.id ?? null,
      user_id: userId,
      provider_code: providerCode,
      function_name: 'generate-prediction-v6',
      prompt_version: 4,
      prediction_version: predVersion,
      facts_object: { dqScore: quantOutput.dqScore, method: quantOutput.modelMethod },
      pre_validation_passed: quantOutput.dqScore >= 30,
      post_validation_passed: gateResult.approved,
      hallucination_score: gateResult.hallucinationScore,
      consensus_passed: true,
      approval_status: 'approved',
      dq_score: quantOutput.dqScore,
      confidence_output: merged.confidence as number,
      risk_level: merged.risk_level as string,
      latency_ms: aiResult?.latencyMs ?? null,
      warning_flags: merged.warning_flags as string[],
      rejection_reason: null,
      enrichment_pct: quantOutput.dqScore,
    }).then(() => {}).catch(() => {});

    if (dbErr) {
      console.warn(`[generate-prediction] DB insert warning: ${dbErr.message}`);
      return secureResponse({ success: true, prediction: row, db_warning: dbErr.message });
    }

    return secureResponse({
      success: true,
      prediction: saved,
      meta: {
        provider: providerCode,
        strategy: usedStrategy,
        quantMethod: quantOutput.modelMethod,
        dqScore: quantOutput.dqScore,
        qualityGateScore: gateResult.overallScore,
        circuitHealth: getProviderCircuitHealth(),
      },
    });

  } catch (err) {
    console.error('[generate-prediction] fatal:', err instanceof Error ? err.message : String(err));
    return secureErrorResponse('Internal server error', 500);
  }
});
