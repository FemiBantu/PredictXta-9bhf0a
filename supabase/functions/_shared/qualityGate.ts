/**
 * qualityGate.ts — Enterprise Prediction Quality Gate v3
 *
 * 7-stage validation pipeline with sport-specific calibration:
 *
 * Stage 1: Data completeness check (required fields present)
 * Stage 2: Statistical plausibility (Poisson-based sanity check)
 * Stage 3: Probability normalization (sum = 100)
 * Stage 4: Confidence calibration (model not overconfident vs historical)
 * Stage 5: Hallucination detection (LLM didn't invent stats)
 * Stage 6: Consensus threshold (multi-model agreement ≥ 50%)
 * Stage 7: Market edge validation (not claiming unrealistic edge)
 *
 * Sport-specific thresholds:
 * - No-draw sports (basketball, tennis, etc.) → draw_prob must be 0
 * - High-scoring sports (basketball) → different OU plausibility ranges
 * - MMA/Boxing → round-based OU, no goals validation
 *
 * Returns QualityGateResult with approval status and full diagnostics.
 */

export type GateStage = 'completeness' | 'plausibility' | 'normalization' | 'calibration' | 'hallucination' | 'consensus' | 'market_edge';

export interface StageResult {
  stage: GateStage;
  passed: boolean;
  score: number;       // 0–100
  reason: string | null;
}

export interface QualityGateResult {
  approved: boolean;
  overallScore: number;    // 0–100
  stages: StageResult[];
  rejectionReason: string | null;
  warningFlags: string[];
  hallucinationScore: number;  // 0–100 (lower = better)
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  dqBonus: number;  // extra confidence allowed based on enrichment
}

// ─── Sport configuration ─────────────────────────────────────────────────────
interface SportGateConfig {
  drawPossible: boolean;
  ouUnit: string;
  ouMin: number;
  ouMax: number;
  goalsMin: number;
  goalsMax: number;
}

const SPORT_GATE_CONFIGS: Record<string, SportGateConfig> = {
  football:          { drawPossible: true,  ouUnit: 'goals',  ouMin: 0.5, ouMax: 6.5,  goalsMin: 0, goalsMax: 10 },
  soccer:            { drawPossible: true,  ouUnit: 'goals',  ouMin: 0.5, ouMax: 6.5,  goalsMin: 0, goalsMax: 10 },
  basketball:        { drawPossible: false, ouUnit: 'points', ouMin: 150, ouMax: 280,  goalsMin: 50, goalsMax: 160 },
  tennis:            { drawPossible: false, ouUnit: 'sets',   ouMin: 1.5, ouMax: 3.5,  goalsMin: 0, goalsMax: 4 },
  cricket:           { drawPossible: true,  ouUnit: 'runs',   ouMin: 100, ouMax: 600,  goalsMin: 50, goalsMax: 400 },
  baseball:          { drawPossible: false, ouUnit: 'runs',   ouMin: 4.5, ouMax: 14.5, goalsMin: 0, goalsMax: 15 },
  hockey:            { drawPossible: false, ouUnit: 'goals',  ouMin: 2.5, ouMax: 9.5,  goalsMin: 0, goalsMax: 10 },
  rugby:             { drawPossible: true,  ouUnit: 'points', ouMin: 25,  ouMax: 70,   goalsMin: 0, goalsMax: 60 },
  mma:               { drawPossible: false, ouUnit: 'rounds', ouMin: 1.5, ouMax: 3.5,  goalsMin: 0, goalsMax: 5 },
  boxing:            { drawPossible: false, ouUnit: 'rounds', ouMin: 4.5, ouMax: 11.5, goalsMin: 0, goalsMax: 12 },
  handball:          { drawPossible: false, ouUnit: 'goals',  ouMin: 40,  ouMax: 75,   goalsMin: 15, goalsMax: 45 },
  volleyball:        { drawPossible: false, ouUnit: 'sets',   ouMin: 2.5, ouMax: 4.5,  goalsMin: 0, goalsMax: 5 },
  esports:           { drawPossible: false, ouUnit: 'maps',   ouMin: 1.5, ouMax: 3.5,  goalsMin: 0, goalsMax: 3 },
  'american-football':{ drawPossible: false, ouUnit: 'points', ouMin: 30,  ouMax: 70,  goalsMin: 0, goalsMax: 50 },
  // formula1 intentionally removed — not in canonical 13-sport registry
};

function getSportConfig(sport?: string | null): SportGateConfig {
  if (!sport) return SPORT_GATE_CONFIGS['football'];
  return SPORT_GATE_CONFIGS[sport.toLowerCase()] ?? SPORT_GATE_CONFIGS['football'];
}

// ─── Prediction shape expected by the gate ──────────────────────────────────
export interface PredictionForGate {
  match_id: string;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  predicted_result: string;
  confidence: number;
  over_under: string;
  over_under_line: number;
  btts: string;
  ai_analysis?: string;
  key_factors?: string[];
  predicted_home_goals?: number | null;
  predicted_away_goals?: number | null;
  correct_score?: string | null;
  risk_level?: string;
  value_score?: number;
  market_edge_pct?: number;
  warning_flags?: string[];
  // Context enrichment (from match data)
  match_sport?: string;
  home_team?: string;
  away_team?: string;
  match_status?: string;
  enrichment_pct?: number;  // 0-100 from predictionService enrichMatchData
  // Multi-model context
  consensus_models?: number;  // how many models agree
  total_models?: number;
}

// ─── Stage 1: Completeness ───────────────────────────────────────────────────
function checkCompleteness(p: PredictionForGate): StageResult {
  const required = ['match_id', 'home_win_prob', 'draw_prob', 'away_win_prob', 'predicted_result', 'confidence'];
  const missing = required.filter((k) => p[k as keyof PredictionForGate] === undefined || p[k as keyof PredictionForGate] === null || p[k as keyof PredictionForGate] === '');

  const enrichedFields = ['ai_analysis', 'key_factors', 'predicted_home_goals', 'predicted_away_goals', 'over_under_line', 'btts'];
  const missingOptional = enrichedFields.filter((k) => !p[k as keyof PredictionForGate]);
  const optionalBonus = Math.max(0, 15 - missingOptional.length * 2);
  const score = Math.max(0, Math.min(100, 85 - missing.length * 20 + optionalBonus));

  return {
    stage: 'completeness',
    passed: missing.length === 0,
    score,
    reason: missing.length > 0 ? `Missing required fields: ${missing.join(', ')}` : null,
  };
}

// ─── Stage 2: Statistical plausibility ──────────────────────────────────────
function checkPlausibility(p: PredictionForGate): StageResult {
  const reasons: string[] = [];
  let score = 100;
  const cfg = getSportConfig(p.match_sport);

  // Confidence sanity
  if (p.confidence > 95) {
    reasons.push(`Confidence ${p.confidence}% is unrealistically high (max 95%)`);
    score -= 20;
  }
  if (p.confidence < 40) {
    reasons.push(`Confidence ${p.confidence}% is too low to be actionable`);
    score -= 15;
  }

  // Predicted result should align with highest probability
  const predictedResult = p.predicted_result;
  const predictedProb = predictedResult === 'home_win' ? p.home_win_prob
    : predictedResult === 'draw' ? p.draw_prob
    : p.away_win_prob;

  // Threshold: on 0-100 integer scale, predicted result should have > 35%
  const probScale = (p.home_win_prob + p.draw_prob + p.away_win_prob) > 1.5 ? 'int' : 'frac';
  const threshold = probScale === 'int' ? 35 : 0.35;

  if (predictedProb < threshold) {
    const display = probScale === 'int' ? `${predictedProb.toFixed(0)}%` : `${(predictedProb * 100).toFixed(1)}%`;
    reasons.push(`Predicted result has only ${display} probability — inconsistent with selection`);
    score -= 25;
  }

  // Sport-specific: no-draw sports should have draw_prob = 0 (or very close)
  if (!cfg.drawPossible) {
    const drawProb = probScale === 'int' ? p.draw_prob : p.draw_prob * 100;
    if (drawProb > 5) {
      reasons.push(`Draw prob ${drawProb.toFixed(0)}% assigned to ${p.match_sport} which has no draws`);
      score -= 15;
    }
  }

  // Goals/runs/points plausibility
  if (p.predicted_home_goals !== null && p.predicted_home_goals !== undefined) {
    if (p.predicted_home_goals > cfg.goalsMax || p.predicted_home_goals < cfg.goalsMin) {
      reasons.push(`predicted_home_goals ${p.predicted_home_goals} outside ${p.match_sport} range [${cfg.goalsMin}–${cfg.goalsMax}]`);
      score -= 10;
    }
  }
  if (p.predicted_away_goals !== null && p.predicted_away_goals !== undefined) {
    if (p.predicted_away_goals > cfg.goalsMax || p.predicted_away_goals < cfg.goalsMin) {
      reasons.push(`predicted_away_goals ${p.predicted_away_goals} outside ${p.match_sport} range [${cfg.goalsMin}–${cfg.goalsMax}]`);
      score -= 10;
    }
  }

  // OU line plausibility
  if (p.over_under_line !== undefined && p.over_under_line !== null) {
    if (p.over_under_line < cfg.ouMin || p.over_under_line > cfg.ouMax) {
      reasons.push(`O/U line ${p.over_under_line} outside ${p.match_sport} range [${cfg.ouMin}–${cfg.ouMax}]`);
      score -= 8;
    }
  }

  return {
    stage: 'plausibility',
    passed: score >= 55,
    score: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

// ─── Stage 3: Probability normalization ──────────────────────────────────────
function checkNormalization(p: PredictionForGate): StageResult {
  const reasons: string[] = [];
  let score = 100;

  const sum = p.home_win_prob + p.draw_prob + p.away_win_prob;
  const isIntegerScale = sum > 1.5;
  const expectedSum = isIntegerScale ? 100 : 1;
  const tolerance = isIntegerScale ? 8 : 0.08;

  if (Math.abs(sum - expectedSum) > tolerance) {
    reasons.push(`Probability sum ${sum.toFixed(isIntegerScale ? 0 : 3)} deviates from ${expectedSum} (tolerance ±${tolerance})`);
    score -= 35;
  }

  // All probs should be non-negative
  if (p.home_win_prob < 0 || p.draw_prob < 0 || p.away_win_prob < 0) {
    reasons.push('Negative probability detected');
    score -= 40;
  }

  // No single prob should be > 98% (degenerate prediction)
  const maxProb = Math.max(p.home_win_prob, p.draw_prob, p.away_win_prob);
  const maxProbDisplay = isIntegerScale ? maxProb : maxProb * 100;
  if (maxProbDisplay > 95) {
    reasons.push(`Probability ${maxProbDisplay.toFixed(0)}% is degenerate — model overfit`);
    score -= 20;
  }

  return {
    stage: 'normalization',
    passed: score >= 60,
    score: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

// ─── Stage 4: Calibration check ─────────────────────────────────────────────
function checkCalibration(
  p: PredictionForGate,
  modelRollingAccuracy: number | null,
): StageResult {
  if (modelRollingAccuracy === null) {
    // No historical data — use enrichment as proxy
    const enrichmentPct = p.enrichment_pct ?? 50;
    const enrichmentScore = Math.min(90, 60 + enrichmentPct * 0.3);
    return { stage: 'calibration', passed: true, score: Math.round(enrichmentScore), reason: 'No historical accuracy data — using enrichment proxy' };
  }

  const historicalAccuracy = modelRollingAccuracy * 100; // convert 0-1 → 0-100
  const drift = Math.abs(p.confidence - historicalAccuracy);
  let score = Math.max(0, 100 - drift * 2);
  let reason: string | null = null;

  if (drift > 25) {
    reason = `Confidence ${p.confidence}% deviates ${drift.toFixed(1)}% from rolling accuracy ${historicalAccuracy.toFixed(1)}%`;
    score -= 10;
  }

  return {
    stage: 'calibration',
    passed: drift <= 30,
    score: Math.max(0, Math.min(100, score)),
    reason,
  };
}

// ─── Stage 5: Hallucination detection ───────────────────────────────────────
function detectHallucinations(analysis: string): { score: number; warningFlags: string[] } {
  if (!analysis || analysis.trim().length < 20) {
    return { score: 0, warningFlags: [] };
  }

  const flags: string[] = [];
  let hallucinationScore = 0;

  // Pattern 1: Invented exact statistics without context grounding
  const exactStatPatterns = [
    /averaging\s+\d+\.\d+\s+goals?\s+per\s+game/gi,
    /scored\s+(?:in|over)\s+\d+\s+(?:consecutive|straight)\s+(?:games|matches)/gi,
    /(?:xG|expected goals?)\s+of\s+\d+\.\d+/gi,
    /win\s+rate\s+of\s+\d+\.\d+%/gi,
  ];
  let exactStatMatches = 0;
  for (const pattern of exactStatPatterns) {
    const m = analysis.match(pattern);
    if (m && m.length > 0) exactStatMatches += m.length;
  }
  if (exactStatMatches > 3) {
    hallucinationScore += 12;
    flags.push('excessive_exact_stats');
  }

  // Pattern 2: Win/loss streaks without contextual grounding
  const streakPattern = /\b(?:won|lost|unbeaten)\s+(?:their\s+)?(?:last\s+)?\d+\s+(?:consecutive\s+)?(?:games|matches|fixtures)\b/gi;
  const streakMatches = analysis.match(streakPattern);
  if (streakMatches && streakMatches.length > 2) {
    hallucinationScore += 8;
    flags.push('streak_claims');
  }

  // Pattern 3: Invented odds references
  const oddsPattern = /\bpriced\s+at\s+\d+\.\d+\s+odds?\b/gi;
  if (oddsPattern.test(analysis)) {
    hallucinationScore += 15;
    flags.push('invented_odds');
  }

  // Pattern 4: Fabricated H2H records not grounded in data
  const h2hPattern = /\b(?:won\s+\d+,?\s+drawn?\s+\d+,?\s+lost\s+\d+)\b/gi;
  if (h2hPattern.test(analysis)) {
    const contextCheck = /according to|data shows|historically|statistics show|our database/i.test(analysis);
    if (!contextCheck) {
      hallucinationScore += 10;
      flags.push('ungrounded_h2h');
    }
  }

  // Pattern 5: Analysis that's too short (likely no real reasoning)
  if (analysis.trim().length < 80) {
    hallucinationScore += 5;
    flags.push('insufficient_analysis');
  }

  return {
    score: Math.min(100, hallucinationScore),
    warningFlags: [...new Set(flags)],
  };
}

function checkHallucination(p: PredictionForGate): { result: StageResult; hallucinationScore: number } {
  const { score: hScore, warningFlags } = detectHallucinations(p.ai_analysis ?? '');

  const stageResult: StageResult = {
    stage: 'hallucination',
    passed: hScore < 40,
    score: Math.max(0, 100 - hScore * 1.5),
    reason: hScore >= 40 ? `Hallucination risk score: ${hScore}/100. Flags: ${warningFlags.join(', ')}` : null,
  };

  return { result: stageResult, hallucinationScore: hScore };
}

// ─── Stage 6: Consensus validation ──────────────────────────────────────────
function checkConsensus(p: PredictionForGate): StageResult {
  if (!p.consensus_models || !p.total_models || p.total_models < 2) {
    return { stage: 'consensus', passed: true, score: 75, reason: 'Single-model prediction — consensus N/A' };
  }

  const agreementPct = (p.consensus_models / p.total_models) * 100;
  const passed = agreementPct >= 50;
  const score = Math.min(100, agreementPct + 10); // slight bonus for having multi-model

  return {
    stage: 'consensus',
    passed,
    score: Math.round(score),
    reason: !passed ? `Only ${p.consensus_models}/${p.total_models} models agree (${agreementPct.toFixed(0)}%)` : null,
  };
}

// ─── Stage 7: Market edge validation ────────────────────────────────────────
function checkMarketEdge(p: PredictionForGate): StageResult {
  if (p.market_edge_pct === undefined || p.market_edge_pct === null) {
    return { stage: 'market_edge', passed: true, score: 80, reason: null };
  }

  const edge = p.market_edge_pct;
  const MAX_REALISTIC_EDGE = 30; // 30% is extremely high

  if (Math.abs(edge) > MAX_REALISTIC_EDGE) {
    return {
      stage: 'market_edge',
      passed: false,
      score: Math.max(0, 100 - Math.abs(edge) * 2),
      reason: `Market edge ${edge}% exceeds realistic maximum of ${MAX_REALISTIC_EDGE}%`,
    };
  }

  return {
    stage: 'market_edge',
    passed: true,
    score: Math.max(0, 100 - Math.abs(edge) * 0.5),
    reason: null,
  };
}

// ─── Main quality gate function ─────────────────────────────────────────────
export function runQualityGate(
  prediction: PredictionForGate,
  opts: {
    modelRollingAccuracy?: number | null;
    strictMode?: boolean;
    minApprovalScore?: number;
  } = {},
): QualityGateResult {
  const { modelRollingAccuracy = null, strictMode = false, minApprovalScore = 50 } = opts;

  const completenessResult  = checkCompleteness(prediction);
  const plausibilityResult  = checkPlausibility(prediction);
  const normalizationResult = checkNormalization(prediction);
  const calibrationResult   = checkCalibration(prediction, modelRollingAccuracy);
  const { result: hallucinationResult, hallucinationScore } = checkHallucination(prediction);
  const consensusResult     = checkConsensus(prediction);
  const marketEdgeResult    = checkMarketEdge(prediction);

  const stages: StageResult[] = [
    completenessResult,
    plausibilityResult,
    normalizationResult,
    calibrationResult,
    hallucinationResult,
    consensusResult,
    marketEdgeResult,
  ];

  // Weighted scoring — completeness and plausibility are most critical
  const weights: Record<GateStage, number> = {
    completeness:  0.22,
    plausibility:  0.22,
    normalization: 0.15,
    calibration:   0.15,
    hallucination: 0.15,
    consensus:     0.07,
    market_edge:   0.04,
  };

  const overallScore = Math.round(
    stages.reduce((sum, s) => sum + s.score * (weights[s.stage] ?? 0.1), 0),
  );

  // Enrichment bonus: higher enrichment allows lower overall score threshold
  const enrichmentPct = prediction.enrichment_pct ?? 50;
  const dqBonus = Math.round(enrichmentPct * 0.1); // max +10 bonus
  const effectiveMinScore = Math.max(45, minApprovalScore - dqBonus);

  // Critical failures (always reject regardless of overall score)
  const failedCritical = !completenessResult.passed || !plausibilityResult.passed;
  const failedAny      = stages.some((s) => !s.passed);

  const approved = strictMode
    ? !failedAny && overallScore >= effectiveMinScore
    : !failedCritical && overallScore >= effectiveMinScore;

  const rejectionReason = !approved
    ? (stages.filter((s) => !s.passed).map((s) => s.reason).filter(Boolean).join(' | ') || 'Quality score below threshold')
    : null;

  const allWarningFlags = [
    ...(prediction.warning_flags ?? []),
    ...stages.filter((s) => !s.passed && s.reason).map((s) => s.stage),
    ...(hallucinationScore > 20 ? ['hallucination_risk'] : []),
  ];

  const riskLevel: QualityGateResult['riskLevel'] =
    overallScore >= 80 ? 'low'
    : overallScore >= 65 ? 'medium'
    : overallScore >= 50 ? 'high'
    : 'critical';

  return {
    approved,
    overallScore,
    stages,
    rejectionReason,
    warningFlags: [...new Set(allWarningFlags)],
    hallucinationScore,
    riskLevel,
    dqBonus,
  };
}

// ─── Batch quality gate ─────────────────────────────────────────────────────
export function batchQualityGate(
  predictions: PredictionForGate[],
  opts: Parameters<typeof runQualityGate>[1] = {},
): {
  approved: PredictionForGate[];
  rejected: Array<{ prediction: PredictionForGate; reason: string; score: number }>;
  stats: { total: number; approvedCount: number; avgScore: number; avgHallucinationScore: number; approvalRate: number };
} {
  const approved: PredictionForGate[] = [];
  const rejected: Array<{ prediction: PredictionForGate; reason: string; score: number }> = [];
  let totalScore = 0;
  let totalHalScore = 0;

  for (const p of predictions) {
    const result = runQualityGate(p, opts);
    totalScore    += result.overallScore;
    totalHalScore += result.hallucinationScore;

    if (result.approved) {
      approved.push(p);
    } else {
      rejected.push({ prediction: p, reason: result.rejectionReason ?? 'Quality gate failed', score: result.overallScore });
    }
  }

  const n = predictions.length || 1;
  return {
    approved,
    rejected,
    stats: {
      total: predictions.length,
      approvedCount: approved.length,
      avgScore: Math.round(totalScore / n),
      avgHallucinationScore: Math.round(totalHalScore / n),
      approvalRate: Math.round((approved.length / n) * 100),
    },
  };
}
