
/**
 * services/multiModelPredictionService.ts
 *
 * Client-side service for the multi-model consensus prediction engine.
 *
 * Invokes the `multi-model-prediction` edge function which fans out to
 * GPT-4.1, GPT-4o-mini, Gemini 2.0 Flash, and Llama 3.1 70B simultaneously,
 * then returns an aggregated consensus prediction.
 *
 * Usage:
 *   import { generateMultiModelPrediction } from '@/services/multiModelPredictionService';
 *   const result = await generateMultiModelPrediction(match, { userId });
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Match, Prediction } from './types';
import { rowToPrediction, enrichMatchDataForPrediction } from './predictionService';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ModelBreakdown {
  id: string;           // 'gpt41' | 'gpt4mini' | 'gemini' | 'llama'
  result: string;       // predicted_result or 'failed'
  confidence: number;
  latencyMs: number;
  error?: string;
}

export interface MultiModelConsensus {
  modelsUsed: number;
  modelsAgreed: number;
  consensusPassed: boolean;
  hallucinationScore: number; // 0-100, lower is better
  dqScore: number;            // data quality 0-100
  latencyMs: number;
  breakdown: ModelBreakdown[];
}

export interface MultiModelResult {
  prediction: Prediction | null;
  consensus: MultiModelConsensus | null;
  source: 'multi-model' | 'cache' | 'error';
  error?: string;
}

// ─── Badge helper ─────────────────────────────────────────────────────────────
export function getConsensusBadge(consensus: MultiModelConsensus | null): {
  label: string;
  color: string;
  icon: string;
} {
  if (!consensus) return { label: 'Single Model', color: '#6B7280', icon: 'brain-outline' };
  const { modelsUsed, modelsAgreed, consensusPassed } = consensus;
  if (modelsUsed >= 4 && modelsAgreed >= 3 && consensusPassed) {
    return { label: `${modelsAgreed}/4 Models Agree`, color: '#22C55E', icon: 'shield-checkmark-outline' };
  }
  if (modelsUsed >= 3 && modelsAgreed >= 3) {
    return { label: `${modelsAgreed}/3 Models Agree`, color: '#22C55E', icon: 'shield-checkmark-outline' };
  }
  if (modelsUsed >= 2 && modelsAgreed >= 2) {
    return { label: `${modelsAgreed}/${modelsUsed} Models Agree`, color: '#F59E0B', icon: 'analytics-outline' };
  }
  return { label: `${modelsUsed} Model${modelsUsed !== 1 ? 's' : ''} · Partial`, color: '#6B7280', icon: 'help-circle-outline' };
}

export function getHallucinationBadge(score: number): { label: string; color: string } {
  if (score < 20) return { label: 'Clean', color: '#22C55E' };
  if (score < 50) return { label: 'Low Risk', color: '#F59E0B' };
  return { label: 'Review', color: '#EF4444' };
}

// ─── Cache check ──────────────────────────────────────────────────────────────
async function checkMultiModelCache(matchId: string): Promise<Prediction | null> {
  try {
    const supabase = getSupabaseClient();
    // Check for any recent prediction (v4+ from single model, v11 from multi-model consensus)
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const { data: cached } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', matchId)
      .gte('prediction_version', 4)
      .gte('created_at', since)
      .order('prediction_version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached) return rowToPrediction(cached as Record<string, unknown>);
    return null;
  } catch { return null; }
}

// ─── Main function ─────────────────────────────────────────────────────────────
export async function generateMultiModelPrediction(
  match: Match,
  options: { userId?: string; bypassCache?: boolean } = {},
): Promise<MultiModelResult> {
  const { userId, bypassCache = false } = options;
  const supabase = getSupabaseClient();

  // 1. Check cache for recent multi-model prediction
  if (!bypassCache) {
    const cached = await checkMultiModelCache(match.id);
    if (cached) {
      return { prediction: cached, consensus: null, source: 'cache' };
    }
  }

  // 2. Enrich match with DB context
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
      homeOdds: match.homeOdds, drawOdds: match.drawOdds, awayOdds: match.awayOdds,
    };
  }

  // 3. Invoke multi-model edge function
  try {
    const { data: session } = await supabase.auth.getSession();
    const authToken = session?.session?.access_token;

    const { data, error } = await supabase.functions.invoke('multi-model-prediction', {
      body: { match: enriched, user_id: userId ?? null },
      ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
    });

    if (error) {
      let errMsg = error.message ?? 'Multi-model prediction failed';
      if (error instanceof FunctionsHttpError) {
        try {
          const status = error.context?.status ?? 500;
          const text = await error.context?.text();
          errMsg = `[${status}] ${text || errMsg}`;
        } catch { /* ignore */ }
      }
      return { prediction: null, consensus: null, source: 'error', error: errMsg };
    }

    if (!data?.success || !data?.prediction) {
      return { prediction: null, consensus: null, source: 'error', error: data?.error ?? 'No prediction returned' };
    }

    const prediction = rowToPrediction(data.prediction as Record<string, unknown>);
    const consensus: MultiModelConsensus | null = data.consensus ?? null;

    return { prediction, consensus, source: 'multi-model' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { prediction: null, consensus: null, source: 'error', error: msg };
  }
}

// Model provider labels for display in the UI
export const AI_PROVIDER_LABELS: Record<string, string> = {
  openai:    'GPT-5.5 (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  gemini:    'Gemini (Google)',
  groq:      'Llama (Meta via Groq)',
};

// Model ID → display name mapping for consensus breakdown UI
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  gpt55:  'GPT-5.5',
  claude: 'Claude',
  gemini: 'Gemini 2.5',
  llama:  'Llama 4',
};

// ─── Batch Prediction Function ────────────────────────────────────────────────
// (max 2 concurrent, heavier)
export async function batchMultiModelPredictions(
  matches: Match[],
  options: { userId?: string } = {},
): Promise<Map<string, { prediction: Prediction; consensus: MultiModelConsensus | null }>> {
  const results = new Map<string, { prediction: Prediction; consensus: MultiModelConsensus | null }>();
  const CONCURRENCY = 2; // multi-model calls are expensive

  for (let i = 0; i < matches.length; i += CONCURRENCY) {
    const batch = matches.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((m) => generateMultiModelPrediction(m, options)),
    );

    batchResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value.prediction) {
        results.set(batch[idx].id, {
          prediction: result.value.prediction,
          consensus: result.value.consensus,
        });
      }
    });

    // Longer delay — multi-model calls are rate-limited more aggressively
    if (i + CONCURRENCY < matches.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return results;
}
