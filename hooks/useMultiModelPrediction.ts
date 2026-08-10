/**
 * hooks/useMultiModelPrediction.ts
 *
 * React hook for the 4-model consensus prediction engine.
 * Wraps generateMultiModelPrediction and exposes loading/error state.
 */

import { useState, useCallback } from 'react';
import { generateMultiModelPrediction, type MultiModelResult, type MultiModelConsensus } from '@/services/multiModelPredictionService';
import type { Match, Prediction } from '@/services/types';

export interface UseMultiModelPredictionReturn {
  prediction: Prediction | null;
  consensus: MultiModelConsensus | null;
  generating: boolean;
  error: string | null;
  source: 'multi-model' | 'cache' | 'error' | null;
  generate: (match: Match, userId?: string) => Promise<MultiModelResult>;
  reset: () => void;
}

export function useMultiModelPrediction(): UseMultiModelPredictionReturn {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [consensus, setConsensus] = useState<MultiModelConsensus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'multi-model' | 'cache' | 'error' | null>(null);

  const generate = useCallback(async (match: Match, userId?: string): Promise<MultiModelResult> => {
    setGenerating(true);
    setError(null);

    const result = await generateMultiModelPrediction(match, { userId, bypassCache: false });

    setGenerating(false);
    setSource(result.source);

    if (result.prediction) {
      setPrediction(result.prediction);
      setConsensus(result.consensus);
    } else {
      setError(result.error ?? 'Generation failed');
    }

    return result;
  }, []);

  const reset = useCallback(() => {
    setPrediction(null);
    setConsensus(null);
    setGenerating(false);
    setError(null);
    setSource(null);
  }, []);

  return { prediction, consensus, generating, error, source, generate, reset };
}
