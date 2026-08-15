/**
 * services/predictionEngineService.ts
 *
 * Client-side service for the upgraded prediction engine.
 * Exposes the prediction pipeline with proper error handling,
 * confidence band mapping, and provider health monitoring.
 *
 * Architecture:
 *   Match data → enrichment → generate-prediction Edge Function
 *              → quantitative model + AI provider → quality gate → DB
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Match, Prediction } from './types';
import { enrichMatchDataForPrediction, rowToPrediction } from './predictionService';

// ─── Confidence bands ────────────────────────────────────────────────────────
export interface ConfidenceBand {
  label: string;
  color: string;
  textColor: string;
  description: string;
}

export function getConfidenceBand(confidence: number | null | undefined): ConfidenceBand {
  if (confidence == null) return { label: 'N/A', color: '#6B7280', textColor: '#fff', description: 'Not calculated' };
  if (confidence >= 90) return { label: 'Elite', color: '#22C55E', textColor: '#fff', description: 'Exceptional model agreement and data quality' };
  if (confidence >= 80) return { label: 'High', color: '#3B82F6', textColor: '#fff', description: 'Strong data signal with consistent model output' };
  if (confidence >= 70) return { label: 'Medium', color: '#F59E0B', textColor: '#000', description: 'Moderate data quality, reasonable signal' };
  if (confidence >= 60) return { label: 'Moderate', color: '#F97316', textColor: '#fff', description: 'Limited data — use caution' };
  return { label: 'Low', color: '#EF4444', textColor: '#fff', description: 'Insufficient data for reliable prediction' };
}

// ─── Provider routing display ─────────────────────────────────────────────────
export interface PredictionSource {
  label: string;
  icon: string;
  color: string;
  isMultiModel: boolean;
}

export function getPredictionSource(predictionVersion: number | null | undefined): PredictionSource {
  if (!predictionVersion) return { label: 'Statistical Model', icon: 'calculator-outline', color: '#6B7280', isMultiModel: false };
  if (predictionVersion >= 12) return { label: 'AI Consensus (2+ Models)', icon: 'shield-checkmark-outline', color: '#22C55E', isMultiModel: true };
  if (predictionVersion >= 10) return { label: 'OpenAI Analysis', icon: 'brain-outline', color: '#3B82F6', isMultiModel: false };
  if (predictionVersion >= 9) return { label: 'AI Analysis', icon: 'analytics-outline', color: '#8B5CF6', isMultiModel: false };
  if (predictionVersion >= 8) return { label: 'Quantitative Model', icon: 'calculator-outline', color: '#6B7280', isMultiModel: false };
  return { label: 'Statistical Model', icon: 'calculator-outline', color: '#6B7280', isMultiModel: false };
}

// ─── Data Quality Score display ───────────────────────────────────────────────
export interface DQBadge {
  label: string;
  color: string;
  description: string;
}

export function getDQBadge(score: number | null | undefined): DQBadge {
  if (score == null) return { label: 'Unknown', color: '#6B7280', description: 'Data quality not measured' };
  if (score >= 80) return { label: 'Excellent', color: '#22C55E', description: 'Rich data with form, standings, H2H, market odds' };
  if (score >= 65) return { label: 'Good', color: '#3B82F6', description: 'Sufficient data for reliable prediction' };
  if (score >= 50) return { label: 'Fair', color: '#F59E0B', description: 'Some data available — moderate signal' };
  if (score >= 35) return { label: 'Poor', color: '#F97316', description: 'Limited data — low confidence ceiling' };
  return { label: 'Minimal', color: '#EF4444', description: 'Very limited data — prediction unreliable' };
}

// ─── Cache check ─────────────────────────────────────────────────────────────
async function checkPredictionCache(matchId: string, maxAgeHours = 4): Promise<Prediction | null> {
  try {
    const supabase = getSupabaseClient();
    const since = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
    const { data } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', matchId)
      .gte('created_at', since)
      .order('prediction_version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToPrediction(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// ─── Main prediction function ─────────────────────────────────────────────────
export interface PredictionResult {
  prediction: Prediction | null;
  source: 'cache' | 'generated' | 'quantitative_only' | 'error';
  provider?: string;
  quantMethod?: string;
  dqScore?: number;
  qualityGateScore?: number;
  error?: string;
}

export async function generatePrediction(
  match: Match,
  options: {
    userId?: string;
    bypassCache?: boolean;
    maxCacheAgeHours?: number;
  } = {},
): Promise<PredictionResult> {
  const { userId, bypassCache = false, maxCacheAgeHours = 4 } = options;
  const supabase = getSupabaseClient();

  // 1. Cache check
  if (!bypassCache && match.id) {
    const cached = await checkPredictionCache(match.id, maxCacheAgeHours);
    if (cached) return { prediction: cached, source: 'cache' };
  }

  // 2. Enrich match data
  let enriched: Record<string, unknown>;
  try {
    enriched = await enrichMatchDataForPrediction(match);
  } catch {
    enriched = {
      id: match.id, sport: match.sport,
      homeTeam: match.homeTeam, awayTeam: match.awayTeam,
      league: match.league, status: match.status,
      homeScore: match.homeScore, awayScore: match.awayScore,
      minute: match.minute, stats: match.stats,
    };
  }

  // 3. Call edge function
  try {
    const { data: session } = await supabase.auth.getSession();
    const authToken = session?.session?.access_token;

    const { data, error } = await supabase.functions.invoke('generate-prediction', {
      body: { match: enriched, user_id: userId ?? null },
      ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
    });

    if (error) {
      let errMsg = error.message ?? 'Prediction generation failed';
      if (error instanceof FunctionsHttpError) {
        try {
          const statusCode = error.context?.status ?? 500;
          const text = await error.context?.text();
          errMsg = `[${statusCode}] ${text || errMsg}`;
        } catch { /* ignore */ }
      }
      return { prediction: null, source: 'error', error: errMsg };
    }

    if (data?.rejected) {
      return {
        prediction: null,
        source: 'error',
        error: `Quality gate: ${data.rejectionReason ?? 'Failed validation'}`,
        qualityGateScore: data.qualityScore,
      };
    }

    if (!data?.success || !data?.prediction) {
      return { prediction: null, source: 'error', error: data?.error ?? 'No prediction returned' };
    }

    const prediction = rowToPrediction(data.prediction as Record<string, unknown>);
    const meta = data.meta ?? {};

    return {
      prediction,
      source: meta.provider?.includes('quantitative') ? 'quantitative_only' : 'generated',
      provider: meta.provider,
      quantMethod: meta.quantMethod,
      dqScore: meta.dqScore,
      qualityGateScore: meta.qualityGateScore,
    };
  } catch (e) {
    return { prediction: null, source: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── AI Provider health (for admin dashboard) ─────────────────────────────────
export interface AIProviderHealth {
  provider: string;
  circuitOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}

export async function getAIProviderHealth(): Promise<AIProviderHealth[]> {
  try {
    const supabase = getSupabaseClient();
    // Invoke a lightweight health check via the edge function
    const { data, error } = await supabase.functions.invoke('generate-prediction', {
      body: { health_check: true },
    });
    if (error || !data?.circuitHealth) return [];
    return data.circuitHealth as AIProviderHealth[];
  } catch { return []; }
}

// ─── Prediction accuracy tracking ────────────────────────────────────────────
export interface AccuracyStats {
  sport: string;
  totalPredictions: number;
  correct: number;
  accuracy: number;
  avgConfidence: number;
  brierScore: number;
  calibrationGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export async function fetchAccuracyStats(sport?: string): Promise<AccuracyStats[]> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('prediction_outcomes')
      .select('sport, is_correct, confidence_at_prediction, brier_score')
      .not('actual_result', 'is', null);

    if (sport && sport !== 'All') {
      query = query.eq('sport', sport.toLowerCase());
    }

    const { data, error } = await query.limit(5000);
    if (error || !data) return [];

    // Group by sport
    const statsMap = new Map<string, { total: number; correct: number; confSum: number; brierSum: number }>();
    for (const row of data as Array<{ sport: string; is_correct: boolean; confidence_at_prediction: number; brier_score: number }>) {
      const s = row.sport ?? 'unknown';
      const existing = statsMap.get(s) ?? { total: 0, correct: 0, confSum: 0, brierSum: 0 };
      existing.total++;
      if (row.is_correct) existing.correct++;
      existing.confSum += Number(row.confidence_at_prediction ?? 0);
      existing.brierSum += Number(row.brier_score ?? 0.25);
      statsMap.set(s, existing);
    }

    return Array.from(statsMap.entries())
      .filter(([, s]) => s.total >= 10)
      .map(([sportKey, s]) => {
        const accuracy = Math.round((s.correct / s.total) * 100);
        const avgConf = Math.round(s.confSum / s.total);
        const brierScore = Math.round((s.brierSum / s.total) * 1000) / 1000;
        const calibGrade: AccuracyStats['calibrationGrade'] =
          Math.abs(avgConf - accuracy) <= 5 ? 'A'
          : Math.abs(avgConf - accuracy) <= 10 ? 'B'
          : Math.abs(avgConf - accuracy) <= 15 ? 'C'
          : Math.abs(avgConf - accuracy) <= 25 ? 'D' : 'F';
        return { sport: sportKey, totalPredictions: s.total, correct: s.correct, accuracy, avgConfidence: avgConf, brierScore, calibrationGrade: calibGrade };
      })
      .sort((a, b) => b.totalPredictions - a.totalPredictions);
  } catch { return []; }
}
