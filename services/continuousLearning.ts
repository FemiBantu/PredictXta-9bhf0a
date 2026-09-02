/**
 * services/continuousLearning.ts — PredictXta Phase 8 Continuous Learning
 *
 * Controlled feedback loop: prediction → result → error analysis → improvement.
 *
 * GOVERNANCE RULES:
 *   - No model is automatically promoted from this loop
 *   - Error analysis surfaces systematic weaknesses for HUMAN investigation
 *   - Training data is never contaminated with incorrect settlements
 *   - All analysis is chronological — no future data leakage
 *   - Shadow runs must validate before any production promotion is considered
 *   - Backtesting must complete before promotion is even eligible
 *
 * PIPELINE:
 *   PREDICTION → SETTLEMENT (resolve-prediction edge fn) → ERROR LOG →
 *   CALIBRATION UPDATE → DRIFT CHECK → (if threshold exceeded) → ALERT →
 *   INVESTIGATE → RETRAIN → BACKTEST → SHADOW → CANARY → PRODUCTION
 */

import { getSupabaseClient } from '@/template';

// ─── Error classification ─────────────────────────────────────────────────────
export type PredictionErrorType =
  | 'overconfident'       // confidence >> accuracy
  | 'underconfident'      // confidence << accuracy
  | 'wrong_favourite'     // picked wrong outcome as most likely
  | 'calibration_drift'   // probability consistently off in one direction
  | 'data_quality'        // error attributable to poor data
  | 'market_shock'        // result inconsistent with all market signals
  | 'model_failure'       // model produced invalid output
  | 'random_variance';    // within expected statistical range

// ─── Classify a prediction error ─────────────────────────────────────────────
export function classifyError(
  predicted: string,
  actual: string,
  confidence: number,
  modelProb: number,
): PredictionErrorType {
  const isCorrect = predicted === actual;
  if (isCorrect) return 'random_variance'; // no error to classify

  if (confidence >= 85 && !isCorrect) return 'overconfident';
  if (confidence < 50 && !isCorrect) return 'random_variance';
  if (modelProb > 0.75 && !isCorrect) return 'wrong_favourite';
  if (confidence >= 60 && !isCorrect) return 'calibration_drift';
  return 'random_variance';
}

// ─── Brier score ─────────────────────────────────────────────────────────────
export function brierScore(predictedProb: number, actualOutcome: 0 | 1): number {
  return Math.round((predictedProb - actualOutcome) ** 2 * 10000) / 10000;
}

// ─── Log a settled prediction error to the error_log table ───────────────────
export async function logPredictionError(params: {
  predictionId: string | null;
  matchId: string;
  sport: string;
  league: string | null;
  market: string;
  modelId: string | null;
  confidenceAtPred: number;
  probAtPred: number;
  predictedResult: string;
  actualResult: string;
  dataQualityScore: number | null;
  featureVersion: string | null;
  isHome: boolean;
}): Promise<void> {
  const {
    predictionId, matchId, sport, league, market, modelId,
    confidenceAtPred, probAtPred, predictedResult, actualResult,
    dataQualityScore, featureVersion, isHome,
  } = params;

  const isCorrect = predictedResult === actualResult;
  const errorType = isCorrect ? 'random_variance' : classifyError(predictedResult, actualResult, confidenceAtPred, probAtPred);
  const actualOutcome: 0 | 1 = isCorrect ? 1 : 0;
  const bs = brierScore(probAtPred, actualOutcome);
  const errorMagnitude = Math.abs(probAtPred - actualOutcome);

  try {
    const supabase = getSupabaseClient();
    await supabase.from('prediction_error_log').insert({
      prediction_id:     predictionId,
      match_id:          matchId,
      sport,
      league,
      market,
      model_id:          modelId,
      confidence_at_pred: confidenceAtPred,
      prob_at_pred:       probAtPred,
      predicted_result:  predictedResult,
      actual_result:     actualResult,
      error_type:        errorType,
      error_magnitude:   errorMagnitude,
      brier_contribution: bs,
      data_quality_score: dataQualityScore,
      feature_version:   featureVersion,
      home_advantage:    isHome,
    });
  } catch { /* non-blocking */ }
}

// ─── Drift detection ─────────────────────────────────────────────────────────
export interface DriftReport {
  sport: string;
  metric: string;
  baseline: number;
  current: number;
  magnitude: number;
  severity: 'info' | 'warning' | 'critical';
  requiresAction: boolean;
}

const DRIFT_THRESHOLDS = {
  accuracy_pct:         { warning: 5, critical: 10 },   // % points drop
  brier_score_avg:      { warning: 0.03, critical: 0.06 },
  calibration_error:    { warning: 0.05, critical: 0.10 },
  confidence_avg:       { warning: 8, critical: 15 },   // % points
};

export async function detectDrift(sport: string = 'all'): Promise<DriftReport[]> {
  const reports: DriftReport[] = [];

  try {
    const supabase = getSupabaseClient();

    // Fetch last 30 and 7 days of calibration data
    const { data: recent } = await supabase
      .from('calibration_log')
      .select('accuracy_pct, brier_score_avg, calibration_error, confidence_avg, logged_date')
      .eq('sport', sport)
      .order('logged_date', { ascending: false })
      .limit(30);

    if (!recent || recent.length < 7) return reports; // insufficient history

    // Split: most recent 7 vs previous 7–30
    const current = recent.slice(0, 7) as any[];
    const baseline = recent.slice(7) as any[];

    const avg = (arr: any[], key: string) => {
      const vals = arr.map((r) => Number(r[key])).filter((v) => !isNaN(v));
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    for (const [metric, thresholds] of Object.entries(DRIFT_THRESHOLDS)) {
      const currentAvg = avg(current, metric);
      const baselineAvg = avg(baseline, metric);
      if (currentAvg === null || baselineAvg === null) continue;

      const magnitude = Math.abs(currentAvg - baselineAvg);
      let severity: DriftReport['severity'] = 'info';
      if (magnitude >= thresholds.critical) severity = 'critical';
      else if (magnitude >= thresholds.warning) severity = 'warning';

      if (severity !== 'info') {
        reports.push({
          sport,
          metric,
          baseline: Math.round(baselineAvg * 10000) / 10000,
          current: Math.round(currentAvg * 10000) / 10000,
          magnitude: Math.round(magnitude * 10000) / 10000,
          severity,
          requiresAction: severity === 'critical',
        });
      }
    }
  } catch { /* non-blocking */ }

  return reports;
}

// ─── Log drift to drift_log table ────────────────────────────────────────────
export async function logDriftReport(report: DriftReport): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const threshold = DRIFT_THRESHOLDS[report.metric as keyof typeof DRIFT_THRESHOLDS];
    await supabase.from('drift_log').insert({
      logged_date:     new Date().toISOString().split('T')[0],
      drift_type:      'calibration',
      sport:           report.sport,
      metric_name:     report.metric,
      baseline_value:  report.baseline,
      current_value:   report.current,
      drift_magnitude: report.magnitude,
      threshold:       threshold?.critical ?? null,
      severity:        report.severity,
      requires_action: report.requiresAction,
    });

    // Raise pipeline alert for critical drift
    if (report.requiresAction) {
      await supabase.from('pipeline_alerts').insert({
        alert_type: `drift_${report.metric}_${report.sport}`,
        severity:   'warning',
        message:    `Prediction drift detected: ${report.metric} for ${report.sport} drifted by ${report.magnitude} (baseline: ${report.baseline} → current: ${report.current})`,
        details:    { report },
        resolved:   false,
      });
    }
  } catch { /* non-blocking */ }
}

// ─── Shadow model result ─────────────────────────────────────────────────────
export interface ShadowRunResult {
  matchId: string;
  sport: string;
  shadowModelId: string;
  productionModelId: string;
  shadowProbs: { home: number; draw: number; away: number };
  shadowConfidence: number;
  prodPredictionId: string | null;
  prodConfidence: number | null;
  featureVersion: string;
}

export async function persistShadowRun(run: ShadowRunResult): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const prodConf = run.prodConfidence ?? null;
    const divergence = prodConf
      ? Math.abs(run.shadowConfidence - prodConf) / 100
      : null;

    await supabase.from('model_shadow_runs').insert({
      match_id:            run.matchId,
      sport:               run.sport,
      shadow_model_id:     run.shadowModelId,
      production_model_id: run.productionModelId,
      shadow_prediction:   run.shadowProbs,
      prod_prediction_id:  run.prodPredictionId,
      home_win_prob:       run.shadowProbs.home,
      draw_prob:           run.shadowProbs.draw,
      away_win_prob:       run.shadowProbs.away,
      confidence:          run.prodConfidence,
      shadow_confidence:   run.shadowConfidence,
      prob_divergence:     divergence,
      feature_version:     run.featureVersion,
    });
  } catch { /* non-blocking */ }
}

// ─── Evaluate shadow model readiness for promotion consideration ──────────────
export async function evaluateShadowReadiness(shadowModelId: string, sport: string): Promise<{
  eligible: boolean;
  reason: string;
  sampleSize: number;
  shadowAccuracy: number | null;
  prodAccuracy: number | null;
  brierImprovement: number | null;
}> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('model_shadow_runs')
      .select('shadow_correct, prod_correct, brier_contribution')
      .eq('shadow_model_id', shadowModelId)
      .eq('sport', sport)
      .not('shadow_correct', 'is', null)
      .limit(500);

    if (!data || data.length < 50) {
      return {
        eligible: false,
        reason: `Insufficient settled shadow runs (need ≥50, have ${data?.length ?? 0})`,
        sampleSize: data?.length ?? 0,
        shadowAccuracy: null, prodAccuracy: null, brierImprovement: null,
      };
    }

    const settled = data as any[];
    const shadowCorrect = settled.filter((r) => r.shadow_correct).length;
    const prodCorrect = settled.filter((r) => r.prod_correct).length;
    const shadowAcc = Math.round((shadowCorrect / settled.length) * 10000) / 100;
    const prodAcc = Math.round((prodCorrect / settled.length) * 10000) / 100;
    const improvement = Math.round((shadowAcc - prodAcc) * 100) / 100;

    const eligible = shadowAcc > prodAcc + 1.5; // must outperform by ≥1.5% accuracy
    const reason = eligible
      ? `Shadow model shows +${improvement}% accuracy improvement over ${settled.length} settled predictions`
      : `Shadow model (+${improvement}%) does not meet the ≥1.5% improvement threshold for promotion eligibility`;

    return {
      eligible,
      reason,
      sampleSize: settled.length,
      shadowAccuracy: shadowAcc,
      prodAccuracy: prodAcc,
      brierImprovement: improvement,
    };
  } catch {
    return {
      eligible: false,
      reason: 'Error evaluating shadow runs',
      sampleSize: 0, shadowAccuracy: null, prodAccuracy: null, brierImprovement: null,
    };
  }
}

export default {
  classifyError, brierScore, logPredictionError,
  detectDrift, logDriftReport,
  persistShadowRun, evaluateShadowReadiness,
};
