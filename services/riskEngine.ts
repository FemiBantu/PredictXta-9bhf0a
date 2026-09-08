/**
 * services/riskEngine.ts — PredictXta Phase 8 Risk Intelligence Engine
 *
 * Produces evidence-based risk assessments for predictions.
 *
 * Risk states:
 *   LOW      (0–30)   — Good data, model agreement, calibrated
 *   MODERATE (31–55)  — Minor gaps or slight model disagreement
 *   HIGH     (56–79)  — Significant data gaps or model disagreement
 *   BLOCKED  (80–100) — Insufficient data; prediction should not be published
 *
 * RULES:
 *   - Risk is always derived from measurable signals, never arbitrary
 *   - High confidence does NOT guarantee low risk
 *   - Missing data adds risk; fabricated data is never used
 *   - Stale inputs escalate risk automatically
 */

import type { Match, Prediction } from './types';
import type { FeatureSet } from './featureStore';

// ─── Risk signals ─────────────────────────────────────────────────────────────
export type RiskSignal =
  | 'low_data_completeness'
  | 'stale_odds'
  | 'no_odds'
  | 'model_disagreement'
  | 'extreme_probability'
  | 'insufficient_h2h'
  | 'calibration_weakness'
  | 'prediction_instability'
  | 'data_quality_low'
  | 'unsupported_market'
  | 'stale_features'
  | 'match_already_started'
  | 'low_sample_size';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'BLOCKED';

export interface RiskAssessment {
  level: RiskLevel;
  score: number;            // 0–100; higher = more risk
  signals: RiskSignal[];
  explanation: string;
  shouldBlock: boolean;
  confidenceCeiling: number; // max confidence allowed given this risk
  publishable: boolean;
}

// ─── Severity weights per signal ─────────────────────────────────────────────
const SIGNAL_WEIGHT: Record<RiskSignal, number> = {
  low_data_completeness:   20,
  stale_odds:              10,
  no_odds:                  8,
  model_disagreement:      15,
  extreme_probability:     12,
  insufficient_h2h:         5,
  calibration_weakness:    10,
  prediction_instability:  18,
  data_quality_low:        25,
  unsupported_market:      80,
  stale_features:          12,
  match_already_started:   85,
  low_sample_size:          8,
};

// ─── Risk level from score ────────────────────────────────────────────────────
function levelFromScore(score: number): RiskLevel {
  if (score >= 80) return 'BLOCKED';
  if (score >= 56) return 'HIGH';
  if (score >= 31) return 'MODERATE';
  return 'LOW';
}

// ─── Confidence ceiling from risk ────────────────────────────────────────────
function confidenceCeilingFromRisk(level: RiskLevel, completeness: number): number {
  if (level === 'BLOCKED') return 0;
  if (level === 'HIGH')     return Math.min(65, Math.round(completeness * 0.72));
  if (level === 'MODERATE') return Math.min(80, Math.round(completeness * 0.88));
  return Math.min(95, Math.round(completeness * 0.96));
}

// ─── Core risk assessment ─────────────────────────────────────────────────────
export function assessPredictionRisk(params: {
  match: Match;
  prediction: Prediction | null;
  features: FeatureSet | null;
  dataQualityScore?: number;
  modelAgreement?: number;        // 0–1: 1 = full agreement
  probabilityDispersion?: number; // std deviation across model outputs
}): RiskAssessment {
  const { match, prediction, features, dataQualityScore, modelAgreement, probabilityDispersion } = params;

  const signals: RiskSignal[] = [];
  let totalWeight = 0;

  // ── Match already started (pre-match gate) ───────────────────────────────
  if (match.status === 'live' || match.status === 'finished') {
    signals.push('match_already_started');
    totalWeight += SIGNAL_WEIGHT.match_already_started;
  }

  // ── Data completeness ────────────────────────────────────────────────────
  const completeness = features?.completenessPercent ?? (dataQualityScore ?? 0);
  if (completeness < 30) {
    signals.push('data_quality_low');
    totalWeight += SIGNAL_WEIGHT.data_quality_low;
  } else if (completeness < 55) {
    signals.push('low_data_completeness');
    totalWeight += SIGNAL_WEIGHT.low_data_completeness;
  }

  // ── Odds availability and freshness ──────────────────────────────────────
  if (!features?.market.homeOdds) {
    signals.push('no_odds');
    totalWeight += SIGNAL_WEIGHT.no_odds;
  } else if (features.market.oddsTimestamp) {
    const oddsAgeHours = (Date.now() - new Date(features.market.oddsTimestamp).getTime()) / 3600_000;
    if (oddsAgeHours > 24) {
      signals.push('stale_odds');
      totalWeight += SIGNAL_WEIGHT.stale_odds;
    }
  }

  // ── H2H sample size ──────────────────────────────────────────────────────
  if ((features?.h2h.h2hMatchesConsidered ?? 0) < 3) {
    signals.push('insufficient_h2h');
    totalWeight += SIGNAL_WEIGHT.insufficient_h2h;
  }

  // ── Model disagreement ───────────────────────────────────────────────────
  if (modelAgreement !== undefined && modelAgreement < 0.6) {
    signals.push('model_disagreement');
    totalWeight += SIGNAL_WEIGHT.model_disagreement;
  }
  if (probabilityDispersion !== undefined && probabilityDispersion > 0.12) {
    signals.push('prediction_instability');
    totalWeight += SIGNAL_WEIGHT.prediction_instability;
  }

  // ── Extreme probability outputs ───────────────────────────────────────────
  if (prediction) {
    const maxProb = Math.max(prediction.homeWinProb ?? 0, prediction.drawProb ?? 0, prediction.awayWinProb ?? 0);
    const minProb = Math.min(prediction.homeWinProb ?? 0, prediction.drawProb ?? 0, prediction.awayWinProb ?? 0);
    if (maxProb > 0.92 || minProb < 0.02) {
      signals.push('extreme_probability');
      totalWeight += SIGNAL_WEIGHT.extreme_probability;
    }
  }

  // ── Stale feature data ────────────────────────────────────────────────────
  if (features?.validUntil && new Date(features.validUntil).getTime() < Date.now()) {
    signals.push('stale_features');
    totalWeight += SIGNAL_WEIGHT.stale_features;
  }

  // ── Calibration weakness (low dq score proxy) ────────────────────────────
  if (dataQualityScore !== undefined && dataQualityScore < 40) {
    signals.push('calibration_weakness');
    totalWeight += SIGNAL_WEIGHT.calibration_weakness;
  }

  // ── Cap at 100 ────────────────────────────────────────────────────────────
  const score = Math.min(100, totalWeight);
  const level = levelFromScore(score);
  const ceiling = confidenceCeilingFromRisk(level, completeness);
  const publishable = level !== 'BLOCKED';

  // ── Human-readable explanation ────────────────────────────────────────────
  const explanationParts: string[] = [];
  if (signals.includes('match_already_started')) explanationParts.push('Match has already started; pre-match predictions are closed');
  if (signals.includes('data_quality_low'))      explanationParts.push('Very limited data available for this fixture');
  if (signals.includes('low_data_completeness')) explanationParts.push('Feature data is incomplete');
  if (signals.includes('no_odds'))               explanationParts.push('No market odds available');
  if (signals.includes('stale_odds'))            explanationParts.push('Odds data is more than 24 hours old');
  if (signals.includes('model_disagreement'))    explanationParts.push('Models disagree significantly on probabilities');
  if (signals.includes('prediction_instability'))explanationParts.push('High probability variance across model outputs');
  if (signals.includes('extreme_probability'))   explanationParts.push('Model output contains extreme probability values');
  if (signals.includes('stale_features'))        explanationParts.push('Feature cache has expired');
  if (signals.includes('insufficient_h2h'))      explanationParts.push('Limited head-to-head history');

  const explanation = explanationParts.length > 0
    ? explanationParts.join('. ') + '.'
    : 'No significant risk signals detected.';

  return { level, score, signals, explanation, shouldBlock: !publishable, confidenceCeiling: ceiling, publishable };
}

// ─── Apply risk ceiling to confidence ────────────────────────────────────────
export function applyRiskCeiling(confidence: number, risk: RiskAssessment): number {
  return Math.min(confidence, risk.confidenceCeiling);
}

// ─── Risk label / color for UI ────────────────────────────────────────────────
export function getRiskDisplay(level: RiskLevel): { color: string; label: string; description: string } {
  switch (level) {
    case 'LOW':      return { color: '#22C55E', label: 'Low Risk',      description: 'Good data quality and model agreement' };
    case 'MODERATE': return { color: '#F59E0B', label: 'Moderate Risk', description: 'Some data gaps — use caution' };
    case 'HIGH':     return { color: '#EF4444', label: 'High Risk',     description: 'Significant uncertainty — limited data or model disagreement' };
    case 'BLOCKED':  return { color: '#6B7280', label: 'Blocked',       description: 'Insufficient data to publish prediction' };
  }
}

export default { assessPredictionRisk, applyRiskCeiling, getRiskDisplay };
