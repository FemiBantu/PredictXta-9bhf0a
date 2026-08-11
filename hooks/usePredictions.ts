import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  fetchPredictions,
  fetchPredictionByMatchId,
  generateAIPrediction,
  batchGeneratePredictions,
} from '@/services/predictionService';
import { Prediction, Match } from '@/services/types';
import { useAuth } from '@/template';

export function usePredictions(sport = 'All') {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSport, setSelectedSport] = useState(sport);
  // Tracks whether we already have fresh data so foreground re-fetch is skipped
  // when the user hasn't been in the background long enough to warrant it.
  const hasFetched = useRef(false);

  // Sync external sport prop changes into internal state and force a re-fetch
  useEffect(() => {
    hasFetched.current = false;
    setSelectedSport(sport);
  }, [sport]);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    const data = await fetchPredictions(s);
    setPredictions(data);
    hasFetched.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    load(selectedSport);
  }, [selectedSport, load]);

  // Re-fetch predictions when app returns from background
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        hasFetched.current = false;
        load(selectedSport);
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [selectedSport, load]);

  const reload = useCallback(() => {
    hasFetched.current = false;
    load(selectedSport);
  }, [selectedSport, load]);

  return { predictions, loading, selectedSport, setSelectedSport, reload };
}

export function usePredictionForMatch(matchId: string) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await fetchPredictionByMatchId(matchId);
    setPrediction(data);
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    if (matchId) reload();
  }, [matchId, reload]);

  return { prediction, loading, reload };
}

export function useGeneratePrediction() {
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (match: Match): Promise<Prediction | null> => {
      setGenerating(true);
      setError(null);
      try {
        const { prediction, error: err } = await generateAIPrediction(match, user?.id);
        if (err) {
          setError(err);
          return null;
        }
        return prediction;
      } finally {
        setGenerating(false);
      }
    },
    [user],
  );

  return { generate, generating, error };
}

// Batch-generate AI predictions for upcoming matches that have none.
// Runs up to 3 edge-function calls in parallel.
export function useBatchPredictionGen() {
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(0);

  const runBatch = useCallback(
    async (matches: Match[]): Promise<number> => {
      if (generating) return 0;
      setGenerating(true);
      try {
        const count = await batchGeneratePredictions(matches, user?.id, 3);
        setGenerated((prev) => prev + count);
        return count;
      } finally {
        setGenerating(false);
      }
    },
    [user, generating],
  );

  return { runBatch, generating, generated };
}
