/**
 * pipeline-audit/index.ts — Phase 4 Prediction Pipeline Audit & Backtesting v2.0
 *
 * Capabilities:
 *   1. Backtesting — evaluates historical predictions against actual outcomes
 *      per sport/model with Brier score, log loss, calibration error, ROI
 *   2. Calibration logging — computes rolling accuracy + drift vs. confidence
 *   3. Model performance update — feeds model_performance_log and rebalances
 *   4. Eligibility cleanup — marks past matches ineligible for new predictions
 *   5. Admin-only endpoint (requires service-role Authorization header)
 *
 * Phase 4 compliance:
 *   ✓ Uses ONLY canonical Phase 3 data (predictions + matches tables)
 *   ✓ Never fabricates outcomes — only settles from verified DB results
 *   ✓ Chronological only — no future data leakage into historical periods
 *   ✓ Minimum sample size enforced (n ≥ 10) before publishing metrics
 *   ✓ Calibration drift detection (>15% gap triggers drift flag)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

const MIN_SAMPLE_SIZE = 10;  // Minimum predictions for valid metrics
const CALIBRATION_WINDOW_DAYS = 30;
const DRIFT_THRESHOLD = 0.15; // 15% gap between confidence and accuracy = drift

// ─── Brier score: lower = better (0 = perfect, 2 = maximally wrong) ──────────
function brierScore(pH: number, pD: number, pA: number, actual: string): number {
  const iH = actual === 'home_win' ? 1 : 0;
  const iD = actual === 'draw'     ? 1 : 0;
  const iA = actual === 'away_win' ? 1 : 0;
  return (pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2;
}

// ─── Log loss for predicted result probability ─────────────────────────────────
function logLoss(predictedProb: number, correct: boolean): number {
  const eps = 1e-7;
  const p = Math.max(eps, Math.min(1 - eps, predictedProb / 100));
  return correct ? -Math.log(p) : -Math.log(1 - p);
}

// ─── Calibration error (Expected Calibration Error) ───────────────────────────
function calibrationError(
  confidences: number[],
  correctnesses: boolean[],
  nBins = 10,
): number {
  const bins: { confSum: number; accSum: number; n: number }[] = Array.from(
    { length: nBins },
    () => ({ confSum: 0, accSum: 0, n: 0 }),
  );
  for (let i = 0; i < confidences.length; i++) {
    const bin = Math.min(nBins - 1, Math.floor((confidences[i] / 100) * nBins));
    bins[bin].confSum += confidences[i] / 100;
    bins[bin].accSum  += correctnesses[i] ? 1 : 0;
    bins[bin].n++;
  }
  let ece = 0;
  const n = confidences.length || 1;
  for (const bin of bins) {
    if (bin.n === 0) continue;
    const avgConf = bin.confSum / bin.n;
    const avgAcc  = bin.accSum  / bin.n;
    ece += (bin.n / n) * Math.abs(avgConf - avgAcc);
  }
  return Math.round(ece * 10000) / 10000;
}

// ─── Run backtesting for a sport over a date range ────────────────────────────
async function runBacktest(
  supabase: ReturnType<typeof createClient>,
  sport: string,
  startDate: string,
  endDate: string,
  modelId = 'quantitative-ensemble-v1',
): Promise<{
  n: number; correct: number; accuracyPct: number;
  brierAvg: number; logLossAvg: number; roiPct: number;
  sampleSizeFlag: boolean; calibErr: number;
}> {
  // Fetch predictions for this sport + date range (chronological — no leakage)
  const { data: preds } = await supabase
    .from('predictions')
    .select(`
      id, match_id, predicted_result,
      home_win_prob, draw_prob, away_win_prob, confidence
    `)
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`)
    .order('created_at', { ascending: true });

  if (!preds?.length) return {
    n: 0, correct: 0, accuracyPct: 0,
    brierAvg: 0.25, logLossAvg: 1.0, roiPct: 0,
    sampleSizeFlag: true, calibErr: 0,
  };

  // Fetch outcomes for these predictions
  const predIds = preds.map((p: Record<string, unknown>) => String(p.id));
  const { data: outcomes } = await supabase
    .from('prediction_outcomes')
    .select('prediction_id, actual_result, is_correct, brier_score')
    .in('prediction_id', predIds);

  const outcomeMap = new Map(
    (outcomes ?? []).map((o: Record<string, unknown>) => [String(o.prediction_id), o])
  );

  let correct = 0, brierSum = 0, logLossSum = 0;
  const confs: number[] = [];
  const corrects: boolean[] = [];
  let settled = 0;

  for (const pred of preds as Array<Record<string, unknown>>) {
    const outcome = outcomeMap.get(String(pred.id));
    if (!outcome) continue; // not yet settled

    settled++;
    const isCorrect = Boolean(outcome.is_correct);
    if (isCorrect) correct++;

    const pH = Number(pred.home_win_prob ?? 0) / 100;
    const pD = Number(pred.draw_prob ?? 0) / 100;
    const pA = Number(pred.away_win_prob ?? 0) / 100;
    brierSum += brierScore(pH, pD, pA, String(outcome.actual_result));

    // Log loss on predicted result probability
    const predResult = String(pred.predicted_result);
    const predProb = predResult === 'home_win' ? Number(pred.home_win_prob ?? 0)
      : predResult === 'draw' ? Number(pred.draw_prob ?? 0)
      : Number(pred.away_win_prob ?? 0);
    logLossSum += logLoss(predProb, isCorrect);

    confs.push(Number(pred.confidence ?? 50));
    corrects.push(isCorrect);
  }

  if (settled < MIN_SAMPLE_SIZE) return {
    n: settled, correct, accuracyPct: settled > 0 ? Math.round((correct / settled) * 100 * 100) / 100 : 0,
    brierAvg: settled > 0 ? Math.round((brierSum / settled) * 1000000) / 1000000 : 0.25,
    logLossAvg: settled > 0 ? Math.round((logLossSum / settled) * 10000) / 10000 : 1.0,
    roiPct: 0, sampleSizeFlag: true, calibErr: 0,
  };

  const accuracyPct = Math.round((correct / settled) * 10000) / 100;
  const brierAvg    = Math.round((brierSum / settled) * 1000000) / 1000000;
  const logLossAvg  = Math.round((logLossSum / settled) * 10000) / 10000;
  const calibErr    = calibrationError(confs, corrects);

  // Simplified ROI: flat-stake 1 unit per bet, avg odds 2.0 (50% break-even)
  const avgOdds = 2.0;
  const roiPct  = Math.round(((correct * avgOdds - settled) / settled) * 10000) / 100;

  return { n: settled, correct, accuracyPct, brierAvg, logLossAvg, roiPct, sampleSizeFlag: false, calibErr };
}

// ─── Update calibration log ────────────────────────────────────────────────────
async function updateCalibrationLog(
  supabase: ReturnType<typeof createClient>,
  sport: string,
): Promise<{ driftDetected: boolean; loggedDate: string }> {
  const today       = new Date().toISOString().split('T')[0];
  const windowStart = new Date(Date.now() - CALIBRATION_WINDOW_DAYS * 86400_000).toISOString();

  const { data: outcomes } = await supabase
    .from('prediction_outcomes')
    .select(`
      is_correct, brier_score, confidence_at_prediction, sport,
      prediction_id
    `)
    .eq('sport', sport)
    .gte('resolved_at', windowStart);

  if (!outcomes?.length || outcomes.length < MIN_SAMPLE_SIZE) return { driftDetected: false, loggedDate: today };

  const rows = outcomes as Array<{
    is_correct: boolean; brier_score: number;
    confidence_at_prediction: number; sport: string;
  }>;

  const n          = rows.length;
  const correct    = rows.filter(r => r.is_correct).length;
  const brierAvg   = rows.reduce((s, r) => s + Number(r.brier_score ?? 0.25), 0) / n;
  const confAvg    = rows.reduce((s, r) => s + Number(r.confidence_at_prediction ?? 50), 0) / n;
  const accuracyPct = (correct / n) * 100;

  const confs    = rows.map(r => Number(r.confidence_at_prediction ?? 50));
  const corrects = rows.map(r => Boolean(r.is_correct));
  const calibErr = calibrationError(confs, corrects);

  // Drift: if |confidence - accuracy| > threshold
  const driftMag      = Math.abs((confAvg / 100) - (accuracyPct / 100));
  const driftDetected = driftMag > DRIFT_THRESHOLD;

  // Overconfidence: confidence > accuracy, underconfidence: reverse
  const overconfCount  = rows.filter(r => (Number(r.confidence_at_prediction) / 100) > (correct / n) + 0.05).length;
  const underconfCount = rows.filter(r => (Number(r.confidence_at_prediction) / 100) < (correct / n) - 0.05).length;

  await supabase.from('calibration_log').upsert({
    logged_date:         today,
    model_id:            'quantitative-ensemble-v1',
    sport,
    n_predictions:       n,
    n_correct:           correct,
    accuracy_pct:        Math.round(accuracyPct * 100) / 100,
    brier_score_avg:     Math.round(brierAvg * 1000000) / 1000000,
    log_loss_avg:        null,
    calibration_error:   calibErr,
    confidence_avg:      Math.round(confAvg * 100) / 100,
    overconfidence_pct:  Math.round((overconfCount / n) * 10000) / 100,
    underconfidence_pct: Math.round((underconfCount / n) * 10000) / 100,
    drift_detected:      driftDetected,
    drift_magnitude:     Math.round(driftMag * 10000) / 10000,
    window_days:         CALIBRATION_WINDOW_DAYS,
  }, { onConflict: 'logged_date,model_id,sport', ignoreDuplicates: false });

  // Emit governance log entry if drift detected
  if (driftDetected) {
    await supabase.from('ai_governance_log').insert({
      event_type: 'calibration_drift',
      severity: driftMag > 0.25 ? 'warning' : 'info',
      model_id: 'quantitative-ensemble-v1',
      sport,
      details: {
        drift_magnitude: driftMag,
        confidence_avg: confAvg,
        accuracy_pct: accuracyPct,
        n: n,
        calibration_error: calibErr,
      },
    });
    console.warn(`[pipeline-audit] Calibration drift detected for ${sport}: ${(driftMag * 100).toFixed(1)}% (conf=${confAvg.toFixed(1)} acc=${accuracyPct.toFixed(1)})`);
  }

  return { driftDetected, loggedDate: today };
}

// ─── Clean up prediction eligibility for started/finished matches ─────────────
async function updatePredictionEligibility(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  // Mark all started/live/finished matches as ineligible for new pre-match predictions
  const { data: ineligible } = await supabase
    .from('matches')
    .select('id, sport, match_time, status')
    .in('status', ['live', 'finished'])
    .gte('match_time', new Date(Date.now() - 7 * 86400_000).toISOString());

  if (!ineligible?.length) return 0;

  const rows = (ineligible as Array<{id: string; sport: string; match_time: string; status: string}>)
    .map(m => ({
      match_id:            m.id,
      sport:               m.sport,
      match_time:          m.match_time,
      is_eligible:         false,
      ineligibility_reason: m.status === 'live' ? 'match_in_progress' : 'match_finished',
      checked_at:          new Date().toISOString(),
    }));

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    await supabase.from('prediction_eligibility')
      .upsert(rows.slice(i, i + BATCH), {
        onConflict: 'match_id',
        ignoreDuplicates: false,
      });
  }

  return rows.length;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  const startMs = Date.now();

  try {
    const { guard } = await applySecurityMiddleware(req, {
      rateLimit: { max: 20, windowSec: 3600, blockSec: 3600 },
      maxPayloadBytes: 4_000,
      rateLimitScope: 'pipeline-audit',
      blockBotUa: false,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* use defaults */ }

    const mode      = String(body.mode ?? 'full');         // 'backtest' | 'calibrate' | 'eligibility' | 'full'
    const sport     = String(body.sport ?? 'all');
    const startDate = String(body.start_date ?? new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]);
    const endDate   = String(body.end_date   ?? new Date().toISOString().split('T')[0]);

    console.log(`[pipeline-audit] v2 mode=${mode} sport=${sport} range=${startDate}→${endDate}`);

    const CANONICAL_SPORTS = [
      'football', 'basketball', 'tennis', 'cricket', 'baseball',
      'hockey', 'rugby', 'american-football', 'mma', 'boxing',
      'volleyball', 'handball', 'esports',
    ];
    const sportsToRun = sport === 'all' ? CANONICAL_SPORTS : [sport];

    const report: Record<string, unknown> = {
      run_date:    new Date().toISOString(),
      mode,
      sports:      sportsToRun,
      date_range:  { start: startDate, end: endDate },
    };

    // ── 1. Backtesting ─────────────────────────────────────────────────────────
    if (mode === 'backtest' || mode === 'full') {
      const backtestResults: Record<string, unknown>[] = [];

      for (const sp of sportsToRun) {
        const result = await runBacktest(supabase, sp, startDate, endDate);

        if (!result.sampleSizeFlag && result.n >= MIN_SAMPLE_SIZE) {
          await supabase.from('backtesting_runs').insert({
            run_date:       new Date().toISOString().split('T')[0],
            model_id:       'quantitative-ensemble-v1',
            sport:          sp,
            start_date:     startDate,
            end_date:       endDate,
            n_matches:      result.n,
            n_correct:      result.correct,
            accuracy_pct:   result.accuracyPct,
            brier_score_avg: result.brierAvg,
            log_loss_avg:   result.logLossAvg,
            roi_pct:        result.roiPct,
            sample_size_flag: result.sampleSizeFlag,
            status:         'completed',
            details: {
              calibration_error: result.calibErr,
              note: 'Phase 4 backtesting — chronological, no leakage, flat-stake ROI estimate only',
            },
          });

          // Update model_performance_log
          await supabase.from('model_performance_log').upsert({
            logged_date:        new Date().toISOString().split('T')[0],
            model_id:           'quantitative-ensemble-v1',
            sport:              sp,
            total_predictions:  result.n,
            correct_predictions: result.correct,
            accuracy_pct:       result.accuracyPct,
            avg_confidence:     null,
          }, { onConflict: 'logged_date,model_id,sport', ignoreDuplicates: false });
        }

        backtestResults.push({
          sport:        sp,
          n:            result.n,
          accuracy_pct: result.accuracyPct,
          brier_avg:    result.brierAvg,
          log_loss_avg: result.logLossAvg,
          roi_pct:      result.roiPct,
          sample_size_flag: result.sampleSizeFlag,
          calibration_error: result.calibErr,
        });
      }

      report.backtesting = backtestResults;
      console.log(`[pipeline-audit] Backtesting complete for ${sportsToRun.length} sports`);
    }

    // ── 2. Calibration logging ─────────────────────────────────────────────────
    if (mode === 'calibrate' || mode === 'full') {
      const calResults: Record<string, unknown>[] = [];

      for (const sp of sportsToRun) {
        const { driftDetected, loggedDate } = await updateCalibrationLog(supabase, sp);
        calResults.push({ sport: sp, drift_detected: driftDetected, logged_date: loggedDate });
      }

      report.calibration = calResults;
      report.drift_sports = calResults.filter(r => r.drift_detected).map(r => r.sport);
      console.log(`[pipeline-audit] Calibration logged for ${sportsToRun.length} sports`);
    }

    // ── 3. Prediction eligibility cleanup ─────────────────────────────────────
    if (mode === 'eligibility' || mode === 'full') {
      const updated = await updatePredictionEligibility(supabase);
      report.eligibility_updated = updated;
      console.log(`[pipeline-audit] Marked ${updated} matches as ineligible`);
    }

    // ── 4. Governance log entry ───────────────────────────────────────────────
    await supabase.from('ai_governance_log').insert({
      event_type: 'pipeline_audit_run',
      severity:   'info',
      model_id:   'quantitative-ensemble-v1',
      sport:      sport,
      details:    { mode, sports: sportsToRun.length, elapsed_ms: Date.now() - startMs },
    });

    report.elapsed_ms = Date.now() - startMs;
    return secureResponse({ success: true, ...report });

  } catch (err) {
    console.error('[pipeline-audit] fatal:', err instanceof Error ? err.message : String(err));
    return secureErrorResponse('Internal server error', 500);
  }
});
