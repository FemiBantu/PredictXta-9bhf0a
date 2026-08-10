/**
 * useRecommendations — React hook for personalised match recommendations
 *
 * Combines feed data with user preferences to generate ranked recommendations.
 * Re-generates when feed data changes or user follows/unfollows a sport/team.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateRecommendations,
  markPickViewed,
  markMatchInteracted,
  addFollowedSport,
  removeFollowedSport,
  addFollowedTeam,
  removeFollowedTeam,
  getFollowedSports,
  getFollowedTeams,
  fetchPredictionStats,
  rerankByUserActivity,
  type RecommendationSet,
  type MatchRecommendation,
} from '@/services/recommendationEngine';
import type { Match, Prediction } from '@/services/types';
import type { ExpertTip, TrendingLeague } from '@/services/feedEngine';

interface UseRecommendationsParams {
  matches: Match[];
  predictions: Prediction[];
  expertTips: ExpertTip[];
  trendingLeagues: TrendingLeague[];
  isVip?: boolean;
  userId?: string | null;
  enabled?: boolean;
}

interface UseRecommendationsResult {
  recommendations: RecommendationSet | null;
  followedSports: string[];
  followedTeams: string[];
  loading: boolean;
  predStats: {
    totalPredictions: number;
    correctCount: number;
    accuracyPct: number;
    avgConfidence: number;
    streakDays: number;
  } | null;
  // Actions
  followSport: (sport: string) => Promise<void>;
  unfollowSport: (sport: string) => Promise<void>;
  followTeam: (team: string) => Promise<void>;
  unfollowTeam: (team: string) => Promise<void>;
  onPickViewed: (matchId: string) => void;
  onMatchInteracted: (matchId: string) => void;
  refresh: () => void;
}

export function useRecommendations(params: UseRecommendationsParams): UseRecommendationsResult {
  const {
    matches,
    predictions,
    expertTips,
    trendingLeagues,
    isVip = false,
    userId = null,
    enabled = true,
  } = params;

  const [recommendations, setRecommendations] = useState<RecommendationSet | null>(null);
  const [followedSports, setFollowedSports] = useState<string[]>([]);
  const [followedTeams, setFollowedTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [predStats, setPredStats] = useState<UseRecommendationsResult['predStats']>(null);
  const refreshTriggerRef = useRef(0);
  const generatingRef = useRef(false);

  // Load preferences on mount
  useEffect(() => {
    Promise.all([getFollowedSports(), getFollowedTeams()]).then(([sports, teams]) => {
      setFollowedSports(sports);
      setFollowedTeams(teams);
    });
  }, []);

  // Fetch prediction stats for the user
  useEffect(() => {
    if (!userId) { setPredStats(null); return; }
    fetchPredictionStats(userId).then(setPredStats);
  }, [userId]);

  // Generate recommendations whenever inputs change
  useEffect(() => {
    if (!enabled || matches.length === 0) {
      setLoading(false);
      return;
    }
    if (generatingRef.current) return;
    generatingRef.current = true;

    generateRecommendations({
      matches,
      predictions,
      expertTips,
      trendingLeagues,
      isVip,
      userId,
    }).then((recs) => {
      setRecommendations(recs);
      setLoading(false);
      generatingRef.current = false;
    }).catch(() => {
      setLoading(false);
      generatingRef.current = false;
    });
  }, [
    matches.length,
    predictions.length,
    followedSports.join(','),
    followedTeams.join(','),
    isVip,
    userId,
    refreshTriggerRef.current,
    enabled,
  ]);

  const refresh = useCallback(() => {
    refreshTriggerRef.current += 1;
    setLoading(true);
  }, []);

  const followSport = useCallback(async (sport: string) => {
    await addFollowedSport(sport);
    setFollowedSports(await getFollowedSports());
    refresh();
  }, [refresh]);

  const unfollowSport = useCallback(async (sport: string) => {
    await removeFollowedSport(sport);
    setFollowedSports(await getFollowedSports());
    refresh();
  }, [refresh]);

  const followTeam = useCallback(async (team: string) => {
    await addFollowedTeam(team);
    setFollowedTeams(await getFollowedTeams());
    refresh();
  }, [refresh]);

  const unfollowTeam = useCallback(async (team: string) => {
    await removeFollowedTeam(team);
    setFollowedTeams(await getFollowedTeams());
    refresh();
  }, [refresh]);

  const onPickViewed = useCallback((matchId: string) => {
    markPickViewed(matchId);
    // Optimistic rerank without full re-generation
    if (recommendations) {
      setRecommendations((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          topPicks: rerankByUserActivity(prev.topPicks, matchId),
          forYou: rerankByUserActivity(prev.forYou, matchId),
        };
      });
    }
  }, [recommendations]);

  const onMatchInteracted = useCallback((matchId: string) => {
    markMatchInteracted(matchId);
  }, []);

  return {
    recommendations,
    followedSports,
    followedTeams,
    loading,
    predStats,
    followSport,
    unfollowSport,
    followTeam,
    unfollowTeam,
    onPickViewed,
    onMatchInteracted,
    refresh,
  };
}
