/**
 * supabase/functions/resolve-prediction/index.ts
 *
 * Settles predictions against actual match results.
 * Computes Brier score and calibration data for each resolved prediction.
 * Updates model_performance_log for weight adjustment.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsOptions } from '../_shared/cors.ts';
import { secureHeaders, secureResponse, secureErrorResponse } from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsOptions(req, false);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Find finished matches with unresolved predictions
    const { data: finishedMatches, error: matchErr } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, home_score, away_score, status, match_time')
      .eq('status', 'finished')
      .gte('match_time', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .limit(100);

    if (matchErr || !finishedMatches?.length) {
      return secureResponse({ success: true, resolved: 0, message: 'No finished matches to resolve' });
    }

    const matchIds = finishedMatches.map((m: Record<string, unknown>) => String(m.id));

    // Get unresolved predictions for these matches
    const { data: unresolved, error: predErr } = await supabase
      .from('predictions')
      .select('id, match_id, predicted_result, home_win_prob, draw_prob, away_win_prob, confidence, prediction_version')
      .in('match_id', matchIds)
      .limit(200);

    if (predErr || !unresolved?.length) {
      return secureResponse({ success: true, resolved: 0, message: 'No predictions to resolve' });
    }

    // Check which are already resolved in prediction_outcomes
    const predIds = unresolved.map((p: Record<string, unknown>) => String(p.id));
    const { data: existing } = await supabase
      .from('prediction_outcomes')
      .select('prediction_id')
      .in('prediction_id', predIds);

    const resolvedSet = new Set((existing ?? []).map((r: Record<string, unknown>) => String(r.prediction_id)));
    const toResolve = (unresolved as Record<string, unknown>[]).filter((p) => !resolvedSet.has(String(p.id)));

    if (toResolve.length === 0) {
      return secureResponse({ success: true, resolved: 0, message: 'All predictions already resolved' });
    }

    const matchMap = new Map(
      finishedMatches.map((m: Record<string, unknown>) => [String(m.id), m])
    );

    let resolved = 0;
    const outcomes: Record<string, unknown>[] = [];

    for (const pred of toResolve) {
      const match = matchMap.get(String(pred.match_id));
      if (!match) continue;

      const homeScore = Number(match.home_score ?? 0);
      const awayScore = Number(match.away_score ?? 0);
      const actualResult = homeScore > awayScore ? 'home_win' : awayScore > homeScore ? 'away_win' : 'draw';
      const isCorrect = actualResult === pred.predicted_result;

      // Brier score: lower is better (0 = perfect, 1 = maximally wrong)
      // B = (p_home - I_home)^2 + (p_draw - I_draw)^2 + (p_away - I_away)^2
      const pH = (Number(pred.home_win_prob) || 0) / 100;
      const pD = (Number(pred.draw_prob) || 0) / 100;
      const pA = (Number(pred.away_win_prob) || 0) / 100;
      const iH = actualResult === 'home_win' ? 1 : 0;
      const iD = actualResult === 'draw' ? 1 : 0;
      const iA = actualResult === 'away_win' ? 1 : 0;
      const brierScore = Math.round(((pH - iH) ** 2 + (pD - iD) ** 2 + (pA - iA) ** 2) * 1000000) / 1000000;

      outcomes.push({
        prediction_id: pred.id,
        match_id: pred.match_id,
        sport: String(match.sport ?? 'football'),
        predicted_result: pred.predicted_result,
        actual_result: actualResult,
        is_correct: isCorrect,
        home_score_actual: homeScore,
        away_score_actual: awayScore,
        confidence_at_prediction: Number(pred.confidence ?? 0),
        brier_score: brierScore,
        prediction_version: pred.prediction_version ?? 1,
        resolved_at: new Date().toISOString(),
      });

      resolved++;
    }

    if (outcomes.length > 0) {
      const { error: insertErr } = await supabase
        .from('prediction_outcomes')
        .insert(outcomes)
        .select('id');

      if (insertErr) {
        console.error('[resolve-prediction] Insert error:', insertErr.message);
      }
    }

    // Update model_performance_log with rolling accuracy per version
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: perfData } = await supabase
        .from('prediction_outcomes')
        .select('sport, is_correct, brier_score, confidence_at_prediction, prediction_version')
        .gte('resolved_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString());

      if (perfData && perfData.length > 0) {
        // Group by sport for model_performance_log
        const sportMap = new Map<string, { total: number; correct: number; brierSum: number; confSum: number }>();
        for (const r of perfData as Array<{ sport: string; is_correct: boolean; brier_score: number; confidence_at_prediction: number }>) {
          const s = r.sport ?? 'all';
          const ex = sportMap.get(s) ?? { total: 0, correct: 0, brierSum: 0, confSum: 0 };
          ex.total++; if (r.is_correct) ex.correct++;
          ex.brierSum += Number(r.brier_score ?? 0.25);
          ex.confSum += Number(r.confidence_at_prediction ?? 0);
          sportMap.set(s, ex);
        }

        for (const [sport, stats] of sportMap) {
          if (stats.total < 10) continue;
          const accuracy = stats.correct / stats.total;
          await supabase.from('model_performance_log').upsert({
            logged_date: today,
            model_id: 'quantitative-ensemble-v1',
            sport,
            total_predictions: stats.total,
            correct_predictions: stats.correct,
            accuracy_pct: Math.round(accuracy * 10000) / 100,
            avg_hallucination_score: 0,
            avg_confidence: Math.round(stats.confSum / stats.total),
          }, { onConflict: 'logged_date,model_id,sport', ignoreDuplicates: false });
        }
      }
    } catch { /* non-blocking */ }

    return secureResponse({ success: true, resolved, total_checked: toResolve.length });

  } catch (err) {
    console.error('[resolve-prediction] fatal:', err instanceof Error ? err.message : String(err));
    return secureErrorResponse('Internal server error', 500);
  }
});
