/**
 * ai-intelligence Edge Function
 *
 * Enterprise Grounded Sports Intelligence Service
 * Generates validated, zero-hallucination match previews and analysis
 * using the PredictXta Verified Facts Object framework.
 *
 * GOVERNANCE: LLMs are explanation/language layer only.
 * All probabilities, confidence scores, and predictions must originate
 * from the validated Statistical Prediction Engines — never from LLMs.
 *
 * Pipeline:
 *   Request → Pre-Validation → Facts Object Build → Prompt Guardrails →
 *   AI Provider → Post-Validation → Hallucination Check → Audit Log → Response
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { applySecurityMiddleware, secureHeaders, secureResponse, secureErrorResponse } from '../_shared/security.ts';

// ─── Model Configuration (internal only — never exposed to clients) ──────────
const PRIMARY_MODEL      = 'gpt-4.1';
const FALLBACK_MODEL     = 'gpt-4.1-mini';
const ONSPACE_MODEL      = 'google/gemini-2.5-flash';
const OPENAI_BASE        = 'https://api.openai.com/v1';
const PROMPT_VERSION     = 3;

// ─── Content Types ────────────────────────────────────────────────────────────
type ContentType = 'match_preview' | 'tactical_analysis' | 'prediction_explanation' | 'vip_report';

// ─── Verified Facts Object ────────────────────────────────────────────────────
// Every AI request is grounded using ONLY data from this validated structure.
// LLMs may not reference any information outside this object.
interface VerifiedFactsObject {
  // Match identity
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  country: string;
  sport: string;
  status: string;
  match_time: string;
  venue?: string;
  // Prediction data (must come from Prediction Engines — never from LLMs)
  prediction_type: string;
  predicted_outcome: string | null;
  probability: number | null;
  confidence_score: number | null;
  risk_rating: string | null;
  // Supporting statistics (validated from DB)
  supporting_statistics: Array<{ label: string; home: string | number; away: string | number }>;
  // Historical metrics
  historical_metrics: Array<{ label: string; value: string | number }>;
  // Form metrics
  form_metrics: { home: string[]; away: string[]; home_score: number; away_score: number };
  // H2H
  h2h_records: Array<{ date: string; score: string; result: 'W' | 'D' | 'L' }>;
  // Extended prediction fields
  over_under: string | null;
  over_under_line: number | null;
  btts: string | null;
  key_factors: string[];
  model_consensus: string;
  prediction_version: number;
  data_quality_score: number;
  generated_timestamp: string;
  // VIP fields
  value_score: number | null;
  market_edge_pct: number | null;
  sharp_signal: string | null;
  warning_flags: string[];
  key_alpha_metric: string | null;
}

// ─── Pre-Generation Validation ────────────────────────────────────────────────
interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function preValidateFacts(facts: VerifiedFactsObject): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // REQUIRED fields — generation must fail if these are missing
  if (!facts.match_id) errors.push('match_id missing');
  if (!facts.home_team) errors.push('home_team missing');
  if (!facts.away_team) errors.push('away_team missing');
  if (!facts.sport) errors.push('sport missing');

  // DATA QUALITY checks — warnings only
  if (facts.data_quality_score < 30) errors.push(`Data quality critically insufficient (${facts.data_quality_score}/100). Generation blocked.`);
  if (facts.data_quality_score < 50) warnings.push(`Low data quality (${facts.data_quality_score}/100) — confidence will be capped`);
  if (facts.form_metrics.home.length < 2) warnings.push('Insufficient home form data');
  if (facts.form_metrics.away.length < 2) warnings.push('Insufficient away form data');
  if (facts.h2h_records.length === 0) warnings.push('No H2H records available');

  // PREDICTION INTEGRITY — prediction must come from engines, not be null without reason
  if (facts.confidence_score !== null && (facts.confidence_score < 0 || facts.confidence_score > 100)) {
    errors.push('confidence_score out of valid range 0-100');
  }
  if (facts.probability !== null && (facts.probability < 0 || facts.probability > 100)) {
    errors.push('probability out of valid range 0-100');
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ─── Post-Generation Hallucination Detector ────────────────────────────────────
interface HallucinationResult {
  passed: boolean;
  score: number;    // 0-100: lower = fewer hallucinations
  violations: string[];
}

function detectHallucinations(
  aiOutput: string,
  facts: VerifiedFactsObject,
): HallucinationResult {
  const violations: string[] = [];
  let score = 0;

  // 1. Check for invented probability numbers not in facts
  const percentMatches = aiOutput.match(/\b(\d{1,3})%/g) ?? [];
  for (const pct of percentMatches) {
    const val = parseInt(pct);
    // Allow probabilities within ±10 of validated values
    const validProbs = [
      facts.probability,
      facts.confidence_score,
      facts.form_metrics.home_score,
      facts.form_metrics.away_score,
    ].filter((v) => v !== null);

    if (val > 5 && val < 99) {
      const isValidated = validProbs.some((vp) => Math.abs(val - (vp ?? 0)) <= 15);
      if (!isValidated && validProbs.length > 0) {
        score += 5;
      }
    }
  }

  // 2. Check for team name hallucinations (wrong names)
  const homeLower  = facts.home_team.toLowerCase();
  const awayLower  = facts.away_team.toLowerCase();
  const outputLower = aiOutput.toLowerCase();

  // If neither team is mentioned at all in a medium-length response, flag it
  if (aiOutput.length > 200 && !outputLower.includes(homeLower.split(' ')[0]) && !outputLower.includes(awayLower.split(' ')[0])) {
    violations.push('AI output does not reference the correct team names');
    score += 20;
  }

  // 3. Check for disallowed phrases (LLM trying to generate predictions independently)
  const DISALLOWED_PHRASES = [
    'i predict', 'my prediction', 'i believe the odds',
    'based on my analysis', 'i estimate',
    'statistically speaking, i calculate',
  ];
  for (const phrase of DISALLOWED_PHRASES) {
    if (outputLower.includes(phrase)) {
      violations.push(`Disallowed first-person prediction phrase: "${phrase}"`);
      score += 15;
    }
  }

  // 4. Check for fabricated statistics (numbers that appear invented)
  // Look for very specific decimal statistics not referenced in facts
  const specificDecimals = aiOutput.match(/\b\d+\.\d{3,}\b/g) ?? [];
  if (specificDecimals.length > 3) {
    score += 5;
    violations.push(`Suspicious over-precision in statistics: ${specificDecimals.slice(0, 3).join(', ')}`);
  }

  // 5. Check for invented player names (basic check: 3+ consecutive proper-case words not in facts)
  const properNames = aiOutput.match(/\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? [];
  if (properNames.length > 0) {
    score += Math.min(10, properNames.length * 2);
  }

  const finalScore = Math.min(100, score);
  const passed = finalScore < 40; // threshold: score < 40 = acceptable

  return {
    passed,
    score: finalScore,
    violations: passed ? [] : violations,
  };
}

// ─── Universal AI Guardrails Prompt ───────────────────────────────────────────
function buildGuardrailsPrompt(): string {
  return `You are operating inside PredictXta's validated sports intelligence framework.

CORE GOVERNANCE RULES — THESE ARE ABSOLUTE AND NON-NEGOTIABLE:

1. GROUNDING RULE: Use ONLY the supplied Verified Facts Object. Every claim you make must be traceable to a field in this object.

2. PROBABILITY PROHIBITION: You are STRICTLY FORBIDDEN from independently generating, calculating, estimating, inventing, or inferring:
   - Match outcome probabilities
   - Confidence scores
   - Odds values or betting recommendations
   - Risk ratings (only reference what is in the facts object)
   - Win percentages not explicitly provided
   - Any numerical prediction not present in the Verified Facts Object

3. STATISTICS PROHIBITION: Do not invent or assume:
   - Player statistics, injury status, or availability
   - Team standings not in the facts object
   - Historical records not in h2h_records
   - Season statistics not in supporting_statistics
   - Any fact not explicitly in the Verified Facts Object

4. WHEN DATA IS UNAVAILABLE: If the required information is not in the Verified Facts Object, you MUST say:
   "The required data is not available within the validated PredictXta dataset."
   Never fabricate a substitute.

5. YOUR ROLE: You are the EXPLANATION and LANGUAGE layer only. Prediction Engines have already computed all probabilities. Your job is to communicate their findings clearly, professionally, and engagingly — not to recalculate or override them.

6. REFERENCING PREDICTIONS: When referencing predicted outcomes, ALWAYS attribute them to "the PredictXta prediction engine" or "statistical analysis" — never claim the prediction as your own reasoning.

7. STRUCTURE: Respond with clear, professional sports intelligence content. No markdown headers. No bullet lists unless specifically requested. Flowing paragraph prose is preferred.`;
}

// ─── Build Verified Facts Object from DB data ─────────────────────────────────
async function buildVerifiedFactsObject(
  matchId: string,
  supabase: ReturnType<typeof createClient>,
  contentType: ContentType,
): Promise<{ facts: VerifiedFactsObject | null; error: string | null }> {
  try {
    // Fetch match data
    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, country, status, match_time, venue, home_score, away_score, minute, home_form, away_form, home_logo, away_logo')
      .eq('id', matchId)
      .maybeSingle();

    if (matchErr || !match) return { facts: null, error: 'Match not found' };

    // Fetch latest prediction
    const { data: pred } = await supabase
      .from('predictions')
      .select('predicted_result, confidence, home_win_prob, draw_prob, away_win_prob, over_under, over_under_line, btts, ai_analysis, key_factors, risk_level, value_score, market_edge_pct, sharp_signal, key_alpha_metric, warning_flags, predicted_home_goals, predicted_away_goals, correct_score, prediction_version')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch H2H records
    const { data: h2hRows } = await supabase
      .from('matches')
      .select('home_team, away_team, home_score, away_score, match_time')
      .eq('sport', match.sport)
      .eq('status', 'finished')
      .in('home_team', [match.home_team, match.away_team])
      .in('away_team', [match.home_team, match.away_team])
      .order('match_time', { ascending: false })
      .limit(5);

    const h2hRecords = ((h2hRows ?? []) as any[])
      .filter((r) => (r.home_team === match.home_team && r.away_team === match.away_team) || (r.home_team === match.away_team && r.away_team === match.home_team))
      .slice(0, 5)
      .map((r: any) => {
        const isHomeTeam = r.home_team === match.home_team;
        const scored    = isHomeTeam ? r.home_score : r.away_score;
        const conceded  = isHomeTeam ? r.away_score : r.home_score;
        const result    = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
        return {
          date: r.match_time?.slice(0, 10) ?? '',
          score: `${r.home_score}-${r.away_score}`,
          result: result as 'W' | 'D' | 'L',
        };
      });

    // Fetch standings for supporting statistics
    const { data: standings } = await supabase
      .from('league_standings')
      .select('team_name, position, played, wins, draws, losses, goals_for, goals_against, points')
      .ilike('league_name', `%${match.league?.split(' — ')[0]?.trim() ?? ''}%`)
      .order('position', { ascending: true })
      .limit(20);

    const homeStanding = (standings ?? []).find((s: any) => s.team_name === match.home_team);
    const awayStanding = (standings ?? []).find((s: any) => s.team_name === match.away_team);

    // Compute form scores
    const homeForm: string[] = Array.isArray(match.home_form) ? match.home_form : [];
    const awayForm: string[] = Array.isArray(match.away_form) ? match.away_form : [];

    const formScoreFn = (form: string[]) => {
      if (form.length === 0) return 50;
      const weights = [2, 1.6, 1.4, 1.2, 1];
      const recent = form.slice(-5).reverse();
      let tot = 0; let wSum = 0;
      recent.forEach((r, i) => {
        const w = weights[Math.min(i, weights.length - 1)];
        const pts = r.toUpperCase() === 'W' ? 3 : r.toUpperCase() === 'D' ? 1 : 0;
        tot += pts * w; wSum += 3 * w;
      });
      return Math.round((tot / wSum) * 100);
    };

    const homeFormScore = formScoreFn(homeForm);
    const awayFormScore = formScoreFn(awayForm);

    // Data quality score
    let dqScore = 35;
    if (homeForm.length >= 3) dqScore += 10;
    if (awayForm.length >= 3) dqScore += 10;
    if (h2hRecords.length >= 2) dqScore += 10;
    if (homeStanding) dqScore += 8;
    if (awayStanding) dqScore += 8;
    if (pred) dqScore += 15;
    dqScore = Math.min(100, dqScore);

    // Build supporting statistics from validated DB data only
    const supportingStatistics: Array<{ label: string; home: string | number; away: string | number }> = [];

    if (homeStanding && awayStanding) {
      supportingStatistics.push(
        { label: 'League Position', home: homeStanding.position, away: awayStanding.position },
        { label: 'Points', home: homeStanding.points, away: awayStanding.points },
        { label: 'Wins', home: homeStanding.wins, away: awayStanding.wins },
        { label: 'Goals Scored', home: homeStanding.goals_for, away: awayStanding.goals_for },
        { label: 'Goals Conceded', home: homeStanding.goals_against, away: awayStanding.goals_against },
      );
    }

    if (homeForm.length > 0 || awayForm.length > 0) {
      supportingStatistics.push({ label: 'Form Score (0-100)', home: homeFormScore, away: awayFormScore });
      supportingStatistics.push({
        label: 'Recent Form (Last 5)',
        home: homeForm.slice(0, 5).join('') || 'N/A',
        away: awayForm.slice(0, 5).join('') || 'N/A',
      });
    }

    if (pred?.predicted_home_goals != null && pred?.predicted_away_goals != null) {
      supportingStatistics.push({
        label: 'Projected Score',
        home: Number(pred.predicted_home_goals).toFixed(1),
        away: Number(pred.predicted_away_goals).toFixed(1),
      });
    }

    // Historical metrics
    const historicalMetrics: Array<{ label: string; value: string | number }> = [];
    if (h2hRecords.length > 0) {
      const hw = h2hRecords.filter((r) => r.result === 'W').length;
      const hd = h2hRecords.filter((r) => r.result === 'D').length;
      const hl = h2hRecords.filter((r) => r.result === 'L').length;
      historicalMetrics.push(
        { label: `${match.home_team} H2H Record`, value: `${hw}W ${hd}D ${hl}L` },
        { label: 'Most Recent Meeting', value: `${h2hRecords[0].score} (${h2hRecords[0].date})` },
      );
    }

    // Determine predicted outcome label
    let predictedOutcomeLabel: string | null = null;
    if (pred?.predicted_result) {
      predictedOutcomeLabel = pred.predicted_result === 'home_win'
        ? `${match.home_team} Win`
        : pred.predicted_result === 'away_win'
        ? `${match.away_team} Win`
        : 'Draw';
    }

    // Model consensus string
    const consensus = pred
      ? `Statistical engines predict ${predictedOutcomeLabel ?? 'outcome undecided'} with ${pred.confidence ?? 0}% confidence (DQ: ${dqScore}/100)`
      : `Prediction not yet generated (DQ: ${dqScore}/100)`;

    const facts: VerifiedFactsObject = {
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      league: match.league ?? 'Unknown League',
      country: match.country ?? 'International',
      sport: match.sport ?? 'football',
      status: match.status ?? 'upcoming',
      match_time: match.match_time ?? '',
      venue: match.venue ?? undefined,
      prediction_type: contentType,
      predicted_outcome: predictedOutcomeLabel,
      probability: pred ? (pred.predicted_result === 'home_win' ? Number(pred.home_win_prob) : pred.predicted_result === 'away_win' ? Number(pred.away_win_prob) : Number(pred.draw_prob)) : null,
      confidence_score: pred ? Number(pred.confidence) : null,
      risk_rating: pred?.risk_level ?? null,
      supporting_statistics: supportingStatistics,
      historical_metrics: historicalMetrics,
      form_metrics: {
        home: homeForm.slice(0, 5),
        away: awayForm.slice(0, 5),
        home_score: homeFormScore,
        away_score: awayFormScore,
      },
      h2h_records: h2hRecords,
      over_under: pred?.over_under ?? null,
      over_under_line: pred ? Number(pred.over_under_line) : null,
      btts: pred?.btts ?? null,
      key_factors: Array.isArray(pred?.key_factors) ? pred.key_factors : [],
      model_consensus: consensus,
      prediction_version: pred?.prediction_version ?? 0,
      data_quality_score: dqScore,
      generated_timestamp: new Date().toISOString(),
      value_score: pred?.value_score != null ? Number(pred.value_score) : null,
      market_edge_pct: pred?.market_edge_pct != null ? Number(pred.market_edge_pct) : null,
      sharp_signal: pred?.sharp_signal ?? null,
      warning_flags: Array.isArray(pred?.warning_flags) ? pred.warning_flags : [],
      key_alpha_metric: pred?.key_alpha_metric ?? null,
    };

    return { facts, error: null };
  } catch (e) {
    return { facts: null, error: `Facts object build failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─── Content-Type-Specific User Prompts ───────────────────────────────────────
function buildUserPrompt(facts: VerifiedFactsObject, contentType: ContentType): string {
  const statsBlock = facts.supporting_statistics.length > 0
    ? '\n\nVERIFIED STATISTICS:\n' + facts.supporting_statistics.map((s) => `• ${s.label}: ${facts.home_team} ${s.home} | ${facts.away_team} ${s.away}`).join('\n')
    : '';

  const h2hBlock = facts.h2h_records.length > 0
    ? '\n\nVERIFIED H2H RECORDS (last 5 meetings):\n' + facts.h2h_records.map((r, i) => `${i + 1}. ${r.date}: ${r.score} → ${r.result}`).join('\n')
    : '\n\nH2H: No previous meetings in database.';

  const formBlock = `\n\nFORM DATA:\n• ${facts.home_team} (last 5): ${facts.form_metrics.home.join('') || 'N/A'} (form score: ${facts.form_metrics.home_score}/100)\n• ${facts.away_team} (last 5): ${facts.form_metrics.away.join('') || 'N/A'} (form score: ${facts.form_metrics.away_score}/100)`;

  const predBlock = facts.predicted_outcome
    ? `\n\nVALIDATED PREDICTION ENGINE OUTPUT:\n• Predicted Result: ${facts.predicted_outcome}\n• Win Probability: ${facts.probability}%\n• Confidence: ${facts.confidence_score}%\n• Risk Level: ${facts.risk_rating ?? 'N/A'}\n• O/U ${facts.over_under_line}: ${facts.over_under?.toUpperCase() ?? 'N/A'}\n• BTTS: ${facts.btts?.toUpperCase() ?? 'N/A'}${facts.key_alpha_metric ? '\n• Key Alpha Metric: ' + facts.key_alpha_metric : ''}${facts.key_factors.length > 0 ? '\n• Key Factors:\n' + facts.key_factors.map((f) => `  - ${f}`).join('\n') : ''}`
    : '\n\nPREDICTION: No validated prediction available for this match yet.';

  const warningBlock = facts.warning_flags.length > 0
    ? '\n\nWARNING FLAGS (validated): ' + facts.warning_flags.join(' | ')
    : '';

  const baseContext = `VERIFIED FACTS OBJECT:
Match: ${facts.home_team} vs ${facts.away_team}
Sport: ${facts.sport.toUpperCase()} | League: ${facts.league} | Country: ${facts.country}
Status: ${facts.status} | Kickoff: ${facts.match_time.slice(0, 16).replace('T', ' ')}
${facts.venue ? 'Venue: ' + facts.venue : ''}
Data Quality Score: ${facts.data_quality_score}/100
Model Consensus: ${facts.model_consensus}${statsBlock}${formBlock}${h2hBlock}${predBlock}${warningBlock}`;

  if (contentType === 'match_preview') {
    return `${baseContext}

TASK: Write a professional 3-paragraph match preview for ${facts.home_team} vs ${facts.away_team}.

REQUIREMENTS:
- Paragraph 1: Introduce the match, its significance, both teams' current form using ONLY the verified form data above
- Paragraph 2: Analyse the statistical picture using ONLY the supporting_statistics provided
- Paragraph 3: Summarise the outlook, referencing the validated prediction engine output (attributed to "PredictXta's prediction engine")
- Total length: 150-200 words
- Tone: Professional sports journalist, confident, analytical
- FORBIDDEN: Do not invent statistics, probabilities, injury news, or player names not in the facts object`;
  }

  if (contentType === 'prediction_explanation') {
    if (!facts.predicted_outcome) {
      return `${baseContext}\n\nTASK: Explain that a prediction has not yet been generated for this match and describe what data would be needed. Keep it under 80 words.`;
    }
    return `${baseContext}

TASK: Write a professional 2-paragraph explanation of why PredictXta's statistical engines predict "${facts.predicted_outcome}" for this match.

REQUIREMENTS:
- Paragraph 1: Explain the primary statistical reasons, citing ONLY the key_factors and supporting_statistics provided
- Paragraph 2: Address the confidence level and risk rating, referencing the model_consensus
- Total length: 100-140 words
- Tone: Data-driven, authoritative, trustworthy
- CRITICAL: Every probability or percentage you mention must be taken directly from the validated prediction output above
- FORBIDDEN: Do not generate alternative probabilities or override the prediction engine output`;
  }

  if (contentType === 'tactical_analysis') {
    return `${baseContext}

TASK: Write a 2-paragraph tactical analysis of how ${facts.home_team} and ${facts.away_team} are likely to approach this ${facts.sport} match.

REQUIREMENTS:
- Paragraph 1: ${facts.home_team}'s expected approach based on their form data
- Paragraph 2: ${facts.away_team}'s expected approach and how the styles may interact
- Base ALL tactical inferences on the form metrics and standings data provided — never invent tactical systems
- Total length: 120-160 words
- Tone: Tactical, insightful, grounded in data`;
  }

  if (contentType === 'vip_report') {
    return `${baseContext}

TASK: Write a premium VIP Intelligence Report for ${facts.home_team} vs ${facts.away_team}.

REQUIREMENTS:
- Section 1 (50 words): Executive Summary — the single most important insight from the prediction engine
- Section 2 (60 words): Statistical Edge — reference the key_alpha_metric and market_edge_pct if available
- Section 3 (50 words): Risk Assessment — reference the risk_rating and warning_flags
- Total length: 160-200 words
- Tone: Exclusive, premium, professional — like a private intelligence briefing
- CRITICAL: Attribute all predictions to "PredictXta's multi-model prediction engine"
- FORBIDDEN: Do not generate any recommendation to bet or any betting advice`;
  }

  return baseContext + '\n\nTASK: Provide a brief 80-word intelligence summary for this match.';
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: secureHeaders });
  }

  const startMs = Date.now();

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 20, windowSec: 60, blockSec: 60 },
      maxPayloadBytes: 16_000,
      rateLimitScope: 'ai_intel',
      blockBotUa: false,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const body = parsedBody as Record<string, unknown>;
    const matchId     = String(body?.match_id ?? '');
    const contentType = (body?.content_type ?? 'match_preview') as ContentType;
    const userId      = body?.user_id as string | undefined;
    const bypassCache = Boolean(body?.bypass_cache);

    if (!matchId) return secureErrorResponse('match_id required', 400);

    const VALID_TYPES: ContentType[] = ['match_preview', 'tactical_analysis', 'prediction_explanation', 'vip_report'];
    if (!VALID_TYPES.includes(contentType)) {
      return secureErrorResponse(`Invalid content_type. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Check intelligence cache first ────────────────────────────────────────
    if (!bypassCache) {
      const { data: cached } = await supabase
        .from('ai_intelligence_cache')
        .select('content, dq_score, validation_passed')
        .eq('match_id', matchId)
        .eq('content_type', contentType)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (cached?.content && cached.validation_passed) {
        return secureResponse({
          success: true,
          content: cached.content,
          content_type: contentType,
          source: 'cache',
          dq_score: cached.dq_score,
        });
      }
    }

    // ── Build Verified Facts Object ───────────────────────────────────────────
    const { facts, error: factsError } = await buildVerifiedFactsObject(matchId, supabase, contentType);

    if (factsError || !facts) {
      return secureErrorResponse(factsError ?? 'Failed to build verified facts', 422);
    }

    // ── PRE-GENERATION VALIDATION ──────────────────────────────────────────────
    const preValidation = preValidateFacts(facts);

    if (!preValidation.passed) {
      // Log to audit trail
      await supabase.from('ai_audit_logs').insert({
        match_id: matchId,
        user_id: userId ?? null,
        function_name: 'ai-intelligence',
        provider_code: 'none',
        prompt_version: PROMPT_VERSION,
        facts_object: facts as unknown as Record<string, unknown>,
        pre_validation_passed: false,
        post_validation_passed: false,
        hallucination_score: 0,
        consensus_passed: false,
        approval_status: 'rejected',
        dq_score: facts.data_quality_score,
        rejection_reason: preValidation.errors.join('; '),
        latency_ms: Date.now() - startMs,
      });
      return secureErrorResponse(`Validation failed: ${preValidation.errors[0]}`, 422);
    }

    // ── Call AI Provider ──────────────────────────────────────────────────────
    const openaiKey  = Deno.env.get('OPENAI_API_KEY');
    const groqKey    = Deno.env.get('Groq_API_Key');
    const geminiKey  = Deno.env.get('Gemini_API_Key');
    const aiKey      = Deno.env.get('ONSPACE_AI_API_KEY');
    const aiBase     = Deno.env.get('ONSPACE_AI_BASE_URL');
    const groqBase   = 'https://api.groq.com/openai/v1';
    const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';

    if (!openaiKey && !groqKey && !geminiKey && !aiKey) {
      return secureErrorResponse('Intelligence service unavailable', 503);
    }

    const systemPrompt = buildGuardrailsPrompt();
    const userPrompt   = buildUserPrompt(facts, contentType);

    const requestPayload = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.65,
      max_tokens: 600,
    };

    let rawContent   = '';
    let usedProvider = 'none';
    let outputTokens = 0;

    // GPT primary → GPT fallback → Groq → Gemini → OnSpace AI
    if (openaiKey) {
      for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
        try {
          const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
            body: JSON.stringify({ ...requestPayload, model }),
          });
          if (res.ok) {
            const data = await res.json();
            const c = data.choices?.[0]?.message?.content ?? '';
            if (c.length > 30) {
              rawContent   = c.trim();
              usedProvider = model === PRIMARY_MODEL ? 'gpt-primary' : 'gpt-fallback';
              outputTokens = data.usage?.completion_tokens ?? 0;
              break;
            }
          } else {
            if (![429, 503, 529].includes(res.status)) break;
          }
        } catch { break; }
      }
    }

    if (!rawContent && groqKey) {
      try {
        const res = await fetch(`${groqBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ ...requestPayload, model: 'llama-3.1-70b-versatile' }),
        });
        if (res.ok) {
          const data = await res.json();
          const c = (data.choices?.[0]?.message?.content ?? '').trim();
          if (c.length > 30) { rawContent = c; usedProvider = 'groq-llama-3.1-70b'; outputTokens = data.usage?.completion_tokens ?? 0; }
        }
      } catch { /* fall through */ }
    }

    if (!rawContent && geminiKey) {
      try {
        const res = await fetch(`${geminiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${geminiKey}` },
          body: JSON.stringify({ ...requestPayload, model: 'gemini-2.0-flash' }),
        });
        if (res.ok) {
          const data = await res.json();
          const c = (data.choices?.[0]?.message?.content ?? '').trim();
          if (c.length > 30) { rawContent = c; usedProvider = 'gemini-2.0-flash'; outputTokens = data.usage?.completion_tokens ?? 0; }
        }
      } catch { /* fall through */ }
    }

    if (!rawContent && aiKey && aiBase) {
      try {
        const res = await fetch(`${aiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
          body: JSON.stringify({ ...requestPayload, model: ONSPACE_MODEL }),
        });
        if (res.ok) {
          const data = await res.json();
          rawContent   = (data.choices?.[0]?.message?.content ?? '').trim();
          usedProvider = 'onspace-fallback';
          outputTokens = data.usage?.completion_tokens ?? 0;
        }
      } catch { /* fall through */ }
    }

    if (!rawContent) {
      await supabase.from('ai_audit_logs').insert({
        match_id: matchId, user_id: userId ?? null,
        function_name: 'ai-intelligence', provider_code: 'none',
        prompt_version: PROMPT_VERSION, facts_object: facts as unknown as Record<string, unknown>,
        pre_validation_passed: true, post_validation_passed: false,
        hallucination_score: 0, consensus_passed: false,
        approval_status: 'rejected', dq_score: facts.data_quality_score,
        rejection_reason: 'All AI providers returned empty responses',
        latency_ms: Date.now() - startMs,
      });
      return secureErrorResponse('Intelligence generation service unavailable', 503);
    }

    // ── POST-GENERATION HALLUCINATION DETECTION ────────────────────────────────
    const hallucinationResult = detectHallucinations(rawContent, facts);
    const latencyMs           = Date.now() - startMs;

    const approvalStatus = hallucinationResult.passed ? 'approved' : 'flagged';

    // ── AUDIT LOG ─────────────────────────────────────────────────────────────
    await supabase.from('ai_audit_logs').insert({
      match_id: matchId, user_id: userId ?? null,
      function_name: 'ai-intelligence', provider_code: usedProvider,
      prompt_version: PROMPT_VERSION,
      prediction_version: facts.prediction_version,
      facts_object: facts as unknown as Record<string, unknown>,
      pre_validation_passed: true,
      post_validation_passed: hallucinationResult.passed,
      hallucination_score: hallucinationResult.score,
      consensus_passed: hallucinationResult.passed,
      approval_status: approvalStatus,
      dq_score: facts.data_quality_score,
      confidence_output: facts.confidence_score,
      risk_level: facts.risk_rating,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      warning_flags: [...preValidation.warnings, ...hallucinationResult.violations],
    });

    // ── If hallucination score is too high, return generic fallback ────────────
    if (!hallucinationResult.passed) {
      // For very high scores (>70) we return a safe deterministic fallback
      if (hallucinationResult.score > 70) {
        const safeFallback = `${facts.home_team} vs ${facts.away_team} is scheduled in the ${facts.league}. ${
          facts.predicted_outcome
            ? `PredictXta's prediction engine has analysed this fixture and projects ${facts.predicted_outcome} with ${facts.confidence_score}% confidence.`
            : 'A full AI prediction is being processed for this fixture.'
        } Form data: ${facts.home_team} ${facts.form_metrics.home.join('') || 'N/A'} | ${facts.away_team} ${facts.form_metrics.away.join('') || 'N/A'}.`;
        return secureResponse({
          success: true,
          content: safeFallback,
          content_type: contentType,
          source: 'safe_fallback',
          dq_score: facts.data_quality_score,
          validation_passed: false,
        });
      }
    }

    // ── Cache validated content ────────────────────────────────────────────────
    if (hallucinationResult.passed) {
      await supabase.from('ai_intelligence_cache').upsert({
        match_id: matchId,
        content_type: contentType,
        content: rawContent,
        sport: facts.sport,
        dq_score: facts.data_quality_score,
        validation_passed: true,
        expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      }, { onConflict: 'match_id,content_type' });
    }

    return secureResponse({
      success: true,
      content: rawContent,
      content_type: contentType,
      source: usedProvider,
      dq_score: facts.data_quality_score,
      validation_passed: hallucinationResult.passed,
      hallucination_score: hallucinationResult.score,
      latency_ms: latencyMs,
    });

  } catch (err) {
    return secureErrorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
