/**
 * recommendationEngine.ts — Personalised Match & Prediction Recommendations
 *
 * Generates personalised recommendations based on:
 *   - User's followed sports/teams (from AsyncStorage)
 *   - Past prediction interactions (viewed AI picks)
 *   - VIP status (premium predictions surfaced first)
 *   - Time context (upcoming matches within 3h surfaced first)
 *   - Confidence scores (only high-confidence predictions)
 *   - Trending leagues (high match volume surfaced)
 *
 * All processing is client-side — no additional edge function calls.
 * Data is sourced from the unified feed already loaded by feedEngine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import type { Match, Prediction } from './types';
import type { ExpertTip, TrendingLeague } from './feedEngine';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const VIEWED_PICKS_KEY = '@predictxta/viewed_picks_v1';
const FOLLOWED_SPORTS_KEY = '@predictxta/followed_sports_v1';
const FOLLOWED_TEAMS_KEY = '@predictxta/followed_teams_v1';
const INTERACTED_MATCHES_KEY = '@predictxta/interacted_matches_v1';

// ─── Recommendation types ────────────────────────────────────────────────────
export type RecommendationReason =
  | 'followed_team'
  | 'followed_sport'
  | 'trending_league'
  | 'high_confidence'
  | 'kickoff_soon'
  | 'live_now'
  | 'high_value'
  | 'recently_viewed'
  | 'expert_tip_available'
  | 'vip_pick'
  | 'new_prediction';

export interface MatchRecommendation {
  match: Match;
  prediction: Prediction | null;
  expertTip: ExpertTip | null;
  score: number;                // 0–100 ranking score
  reasons: RecommendationReason[];
  isLive: boolean;
  kickoffInMs: number | null;   // null for finished/live
  confidenceLabel: string | null;
  valueLabel: string | null;
}

export interface RecommendationSet {
  topPicks: MatchRecommendation[];       // Featured — 3–5 items
  upcoming: MatchRecommendation[];       // Kickoff within 24h
  highConfidence: MatchRecommendation[]; // Confidence ≥ 70%
  forYou: MatchRecommendation[];         // Personalised by sport/team
  trending: MatchRecommendation[];       // From trending leagues
  generatedAt: string;
  personalisationLevel: 'high' | 'medium' | 'low';
}

// ─── User preferences helpers ────────────────────────────────────────────────
export async function getFollowedSports(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWED_SPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function getFollowedTeams(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWED_TEAMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function addFollowedSport(sport: string): Promise<void> {
  const sports = await getFollowedSports();
  const normalised = sport.toLowerCase();
  if (!sports.includes(normalised)) {
    await AsyncStorage.setItem(FOLLOWED_SPORTS_KEY, JSON.stringify([...sports, normalised]));
  }
}

export async function removeFollowedSport(sport: string): Promise<void> {
  const sports = await getFollowedSports();
  await AsyncStorage.setItem(
    FOLLOWED_SPORTS_KEY,
    JSON.stringify(sports.filter((s) => s !== sport.toLowerCase())),
  );
}

export async function addFollowedTeam(team: string): Promise<void> {
  const teams = await getFollowedTeams();
  if (!teams.includes(team)) {
    await AsyncStorage.setItem(FOLLOWED_TEAMS_KEY, JSON.stringify([...teams, team]));
  }
}

export async function removeFollowedTeam(team: string): Promise<void> {
  const teams = await getFollowedTeams();
  await AsyncStorage.setItem(
    FOLLOWED_TEAMS_KEY,
    JSON.stringify(teams.filter((t) => t !== team)),
  );
}

export async function markPickViewed(matchId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(VIEWED_PICKS_KEY);
    const viewed: string[] = raw ? JSON.parse(raw) : [];
    if (!viewed.includes(matchId)) {
      const updated = [matchId, ...viewed].slice(0, 100); // keep last 100
      await AsyncStorage.setItem(VIEWED_PICKS_KEY, JSON.stringify(updated));
    }
  } catch { /* non-blocking */ }
}

export async function markMatchInteracted(matchId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INTERACTED_MATCHES_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const updated = [matchId, ...list.filter((id) => id !== matchId)].slice(0, 50);
    await AsyncStorage.setItem(INTERACTED_MATCHES_KEY, JSON.stringify(updated));
  } catch { /* non-blocking */ }
}

// ─── Score computation ────────────────────────────────────────────────────────
interface ScoringContext {
  followedSports: Set<string>;
  followedTeams: Set<string>;
  viewedPicks: Set<string>;
  interactedMatches: Set<string>;
  trendingLeagues: Set<string>;
  isVip: boolean;
  predictionMap: Map<string, Prediction>;
  tipMap: Map<string, ExpertTip>;
}

function computeScore(match: Match, ctx: ScoringContext): {
  score: number;
  reasons: RecommendationReason[];
} {
  let score = 0;
  const reasons: RecommendationReason[] = [];

  // Live matches always rank highest
  if (match.status === 'live') {
    score += 35;
    reasons.push('live_now');
  }

  // Kickoff within 3 hours
  const kickoffInMs = match.status === 'upcoming'
    ? new Date(match.matchTime).getTime() - Date.now()
    : null;
  if (kickoffInMs !== null && kickoffInMs > 0 && kickoffInMs < 3 * 60 * 60_000) {
    score += 25;
    reasons.push('kickoff_soon');
  } else if (kickoffInMs !== null && kickoffInMs > 0 && kickoffInMs < 24 * 60 * 60_000) {
    score += 10;
  }

  // Followed sport
  const matchSport = (match.sport ?? 'football').toLowerCase();
  if (ctx.followedSports.size > 0 && ctx.followedSports.has(matchSport)) {
    score += 20;
    reasons.push('followed_sport');
  }

  // Followed team
  const homeTeamLower = match.homeTeam.toLowerCase();
  const awayTeamLower = match.awayTeam.toLowerCase();
  if (ctx.followedTeams.size > 0) {
    const followedTeamsArr = [...ctx.followedTeams];
    const homeMatch = followedTeamsArr.some((t) => homeTeamLower.includes(t.toLowerCase()) || t.toLowerCase().includes(homeTeamLower));
    const awayMatch = followedTeamsArr.some((t) => awayTeamLower.includes(t.toLowerCase()) || t.toLowerCase().includes(awayTeamLower));
    if (homeMatch || awayMatch) {
      score += 30;
      reasons.push('followed_team');
    }
  }

  // High confidence prediction
  const pred = ctx.predictionMap.get(match.id);
  if (pred) {
    if (pred.confidence >= 75) {
      score += 20;
      reasons.push('high_confidence');
    } else if (pred.confidence >= 60) {
      score += 10;
    }
    // High value pick
    if ((pred as any).valueScore && (pred as any).valueScore >= 70) {
      score += 10;
      reasons.push('high_value');
    }
    if (ctx.isVip && (pred as any).riskLevel === 'Low') {
      reasons.push('vip_pick');
      score += 8;
    }
  }

  // Expert tip available
  if (ctx.tipMap.has(match.id)) {
    score += 8;
    reasons.push('expert_tip_available');
  }

  // Trending league
  const leagueLower = (match.league ?? '').toLowerCase();
  if (ctx.trendingLeagues.size > 0 && leagueLower) {
    const trendingArr = [...ctx.trendingLeagues];
    if (trendingArr.some((l) => l.toLowerCase().includes(leagueLower) || leagueLower.includes(l.toLowerCase()))) {
      score += 10;
      reasons.push('trending_league');
    }
  }

  // Recently viewed pick (mild boost — user has shown interest)
  if (ctx.viewedPicks.has(match.id)) {
    score += 5;
    reasons.push('recently_viewed');
  }

  // Penalise already-interacted matches slightly (avoid surfacing too often)
  if (ctx.interactedMatches.has(match.id)) {
    score = Math.max(0, score - 8);
  }

  return { score: Math.min(100, score), reasons };
}

function buildConfidenceLabel(pred: Prediction | null): string | null {
  if (!pred) return null;
  if (pred.confidence >= 80) return 'Very High';
  if (pred.confidence >= 70) return 'High';
  if (pred.confidence >= 55) return 'Medium';
  return 'Low';
}

function buildValueLabel(pred: Prediction | null): string | null {
  if (!pred) return null;
  const vs = (pred as any).valueScore ?? 50;
  if (vs >= 80) return 'Excellent Value';
  if (vs >= 65) return 'Good Value';
  if (vs >= 50) return 'Fair Value';
  return null;
}

// ─── Main recommendation engine ──────────────────────────────────────────────
export async function generateRecommendations(params: {
  matches: Match[];
  predictions: Prediction[];
  expertTips: ExpertTip[];
  trendingLeagues: TrendingLeague[];
  isVip?: boolean;
  userId?: string | null;
  maxPerSection?: number;
}): Promise<RecommendationSet> {
  const {
    matches,
    predictions,
    expertTips,
    trendingLeagues,
    isVip = false,
    userId = null,
    maxPerSection = 8,
  } = params;

  // Load user preferences
  const [followedSports, followedTeams, viewedPicksRaw, interactedRaw] = await Promise.all([
    getFollowedSports(),
    getFollowedTeams(),
    AsyncStorage.getItem(VIEWED_PICKS_KEY).catch(() => null),
    AsyncStorage.getItem(INTERACTED_MATCHES_KEY).catch(() => null),
  ]);

  const viewedPicks: string[] = viewedPicksRaw ? JSON.parse(viewedPicksRaw) : [];
  const interactedMatches: string[] = interactedRaw ? JSON.parse(interactedRaw) : [];

  // Prediction and tip lookup maps
  const predictionMap = new Map<string, Prediction>(predictions.map((p) => [p.matchId, p]));

  // Build tip map keyed by match label for fuzzy matching
  const tipMap = new Map<string, ExpertTip>();
  for (const tip of expertTips) {
    for (const match of matches) {
      const label = `${match.homeTeam} vs ${match.awayTeam}`.toLowerCase();
      if (tip.matchLabel.toLowerCase().includes(match.homeTeam.toLowerCase()) ||
          tip.matchLabel.toLowerCase().includes(match.awayTeam.toLowerCase())) {
        tipMap.set(match.id, tip);
        break;
      }
    }
  }

  const personalisationLevel: 'high' | 'medium' | 'low' =
    followedSports.length > 0 || followedTeams.length > 0 ? 'high'
    : userId ? 'medium'
    : 'low';

  const ctx: ScoringContext = {
    followedSports: new Set(followedSports),
    followedTeams: new Set(followedTeams),
    viewedPicks: new Set(viewedPicks.slice(0, 30)),
    interactedMatches: new Set(interactedMatches),
    trendingLeagues: new Set(trendingLeagues.map((l) => l.leagueName)),
    isVip,
    predictionMap,
    tipMap,
  };

  // Score all matches
  const scored: MatchRecommendation[] = matches
    .filter((m) => m.status === 'live' || m.status === 'upcoming')
    .map((match) => {
      const { score, reasons } = computeScore(match, ctx);
      const pred = predictionMap.get(match.id) ?? null;
      const kickoffInMs = match.status === 'upcoming'
        ? Math.max(0, new Date(match.matchTime).getTime() - Date.now())
        : null;
      return {
        match,
        prediction: pred,
        expertTip: tipMap.get(match.id) ?? null,
        score,
        reasons,
        isLive: match.status === 'live',
        kickoffInMs,
        confidenceLabel: buildConfidenceLabel(pred),
        valueLabel: buildValueLabel(pred),
      };
    })
    .sort((a, b) => b.score - a.score);

  // Section builders
  const topPicks = scored.slice(0, 5);

  const upcoming = scored
    .filter((r) => r.kickoffInMs !== null && r.kickoffInMs > 0 && r.kickoffInMs < 24 * 60 * 60_000)
    .sort((a, b) => (a.kickoffInMs ?? 0) - (b.kickoffInMs ?? 0))
    .slice(0, maxPerSection);

  const highConfidence = scored
    .filter((r) => r.prediction && r.prediction.confidence >= 70)
    .sort((a, b) => (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0))
    .slice(0, maxPerSection);

  const forYou = personalisationLevel === 'low'
    ? scored.slice(0, maxPerSection)
    : scored
        .filter((r) => r.reasons.includes('followed_team') || r.reasons.includes('followed_sport'))
        .slice(0, maxPerSection);

  const trendingSet = new Set(trendingLeagues.map((l) => l.leagueName.toLowerCase()));
  const trending = scored
    .filter((r) => {
      const league = (r.match.league ?? '').toLowerCase();
      return [...trendingSet].some((t) => league.includes(t) || t.includes(league));
    })
    .slice(0, maxPerSection);

  return {
    topPicks,
    upcoming,
    highConfidence,
    forYou,
    trending,
    generatedAt: new Date().toISOString(),
    personalisationLevel,
  };
}

// ─── Lightweight re-rank (no async) for UI updates ───────────────────────────
export function rerankByUserActivity(
  recommendations: MatchRecommendation[],
  recentMatchId: string,
): MatchRecommendation[] {
  return [...recommendations].map((r) => ({
    ...r,
    score: r.match.id === recentMatchId ? Math.max(0, r.score - 15) : r.score,
  })).sort((a, b) => b.score - a.score);
}

// ─── Prediction statistics (for home screen banner) ────────────────────────────
export async function fetchPredictionStats(userId: string | null): Promise<{
  totalPredictions: number;
  correctCount: number;
  accuracyPct: number;
  avgConfidence: number;
  streakDays: number;
}> {
  if (!userId) return { totalPredictions: 0, correctCount: 0, accuracyPct: 0, avgConfidence: 0, streakDays: 0 };

  try {
    const supabase = getSupabaseClient();
    const [predsRes, challengeRes] = await Promise.all([
      supabase
        .from('predictions')
        .select('confidence')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('challenge_results')
        .select('date, is_perfect, correct_count, total_picks')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(30),
    ]);

    const preds = predsRes.data ?? [];
    const challenges = challengeRes.data ?? [];

    const avgConfidence = preds.length > 0
      ? Math.round(preds.reduce((s: number, p: any) => s + Number(p.confidence ?? 0), 0) / preds.length)
      : 0;

    const totalPredictions = challenges.reduce((s: number, c: any) => s + Number(c.total_picks ?? 0), 0);
    const correctCount = challenges.reduce((s: number, c: any) => s + Number(c.correct_count ?? 0), 0);
    const accuracyPct = totalPredictions > 0 ? Math.round((correctCount / totalPredictions) * 100) : 0;

    // Compute current streak (consecutive days with any challenge result)
    let streakDays = 0;
    const sortedDates = challenges.map((c: any) => c.date).sort().reverse();
    if (sortedDates.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      let checkDate = today;
      for (const date of sortedDates) {
        if (date === checkDate) {
          streakDays++;
          const d = new Date(checkDate);
          d.setDate(d.getDate() - 1);
          checkDate = d.toISOString().split('T')[0];
        } else {
          break;
        }
      }
    }

    return { totalPredictions, correctCount, accuracyPct, avgConfidence, streakDays };
  } catch { return { totalPredictions: 0, correctCount: 0, accuracyPct: 0, avgConfidence: 0, streakDays: 0 }; }
}
