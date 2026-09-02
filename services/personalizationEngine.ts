/**
 * services/personalizationEngine.ts — PredictXta Phase 8 Personalization Engine
 *
 * Server-side personalization using the personalization_profiles table.
 *
 * SAFETY RULES:
 *   - Personalization controls PRESENTATION only — never alters probabilities
 *   - No discriminatory outcomes — all users can access the same prediction facts
 *   - Users can view and reset their personalization profile
 *   - Private user data is never sent to analytics or AI training
 *   - Ranking considers quality/confidence; never ranks low-quality picks higher
 *     solely for engagement
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Match, Prediction } from './types';
import type { MatchRecommendation } from './recommendationEngine';

// ─── Local storage key for fast optimistic reads ─────────────────────────────
const PROFILE_CACHE_KEY = '@predictxta/personalization_profile_v1';

// ─── Profile type ─────────────────────────────────────────────────────────────
export interface PersonalizationProfile {
  userId: string;
  followedSports: string[];
  followedLeagues: string[];
  followedTeams: string[];
  preferredMarkets: string[];
  confidenceMin: number;
  lastActiveSports: string[];
  interactionCount: number;
  profileVersion: number;
  updatedAt: string;
}

const DEFAULT_PROFILE: Omit<PersonalizationProfile, 'userId' | 'updatedAt'> = {
  followedSports: [],
  followedLeagues: [],
  followedTeams: [],
  preferredMarkets: [],
  confidenceMin: 0,
  lastActiveSports: [],
  interactionCount: 0,
  profileVersion: 1,
};

// ─── Load profile (server + L1 cache) ────────────────────────────────────────
export async function loadPersonalizationProfile(userId: string): Promise<PersonalizationProfile> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('personalization_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (data) {
      const profile: PersonalizationProfile = {
        userId,
        followedSports:   data.followed_sports   ?? [],
        followedLeagues:  data.followed_leagues  ?? [],
        followedTeams:    data.followed_teams    ?? [],
        preferredMarkets: data.preferred_markets ?? [],
        confidenceMin:    data.confidence_min    ?? 0,
        lastActiveSports: data.last_active_sports ?? [],
        interactionCount: data.interaction_count ?? 0,
        profileVersion:   data.profile_version   ?? 1,
        updatedAt:        data.updated_at         ?? new Date().toISOString(),
      };
      // Cache locally
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)).catch(() => {});
      return profile;
    }
  } catch { /* fall through to cache */ }

  // L2: AsyncStorage
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as PersonalizationProfile;
      if (cached.userId === userId) return cached;
    }
  } catch { /* ignore */ }

  return { ...DEFAULT_PROFILE, userId, updatedAt: new Date().toISOString() };
}

// ─── Update profile ───────────────────────────────────────────────────────────
export async function updatePersonalizationProfile(
  userId: string,
  updates: Partial<Omit<PersonalizationProfile, 'userId' | 'updatedAt' | 'interactionCount'>>,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    await supabase.from('personalization_profiles').upsert({
      user_id:           userId,
      followed_sports:   updates.followedSports,
      followed_leagues:  updates.followedLeagues,
      followed_teams:    updates.followedTeams,
      preferred_markets: updates.preferredMarkets,
      confidence_min:    updates.confidenceMin,
      last_active_sports: updates.lastActiveSports,
      profile_version:   (updates.profileVersion ?? 1),
      updated_at:        now,
    }, { onConflict: 'user_id' });

    // Invalidate local cache
    await AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
  } catch { /* non-blocking */ }
}

// ─── Record an interaction (view/tap on a prediction) ─────────────────────────
export async function recordInteraction(userId: string, sport: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const profile = await loadPersonalizationProfile(userId);
    const updatedSports = [sport, ...profile.lastActiveSports.filter((s) => s !== sport)].slice(0, 5);
    await supabase.from('personalization_profiles').upsert({
      user_id:           userId,
      last_active_sports: updatedSports,
      interaction_count: (profile.interactionCount + 1),
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch { /* non-blocking */ }
}

// ─── Personalized ranking ─────────────────────────────────────────────────────
// Re-ranks a list of recommendations using the user's server-side profile.
// IMPORTANT: This only affects presentation order, never prediction probabilities.
export function personalizedRank(
  recommendations: MatchRecommendation[],
  profile: PersonalizationProfile,
): MatchRecommendation[] {
  if (!profile || profile.interactionCount === 0) return recommendations;

  const followedSports  = new Set(profile.followedSports.map((s) => s.toLowerCase()));
  const followedTeams   = new Set(profile.followedTeams.map((t) => t.toLowerCase()));
  const followedLeagues = new Set(profile.followedLeagues.map((l) => l.toLowerCase()));

  return [...recommendations]
    .map((rec) => {
      let boostScore = rec.score;

      // Sport preference boost
      const sport = (rec.match.sport ?? '').toLowerCase();
      if (followedSports.size > 0 && followedSports.has(sport)) boostScore += 12;

      // Last-active-sport boost (recent engagement)
      if (profile.lastActiveSports.includes(sport)) boostScore += 6;

      // Team preference boost
      const homeL = rec.match.homeTeam.toLowerCase();
      const awayL = rec.match.awayTeam.toLowerCase();
      if (followedTeams.size > 0) {
        const teamsArr = [...followedTeams];
        if (teamsArr.some((t) => homeL.includes(t) || t.includes(homeL))) boostScore += 15;
        if (teamsArr.some((t) => awayL.includes(t) || t.includes(awayL))) boostScore += 15;
      }

      // League preference boost
      const league = (rec.match.league ?? '').toLowerCase();
      if (followedLeagues.size > 0 && [...followedLeagues].some((l) => league.includes(l) || l.includes(league))) {
        boostScore += 8;
      }

      // Confidence filter: do not completely hide low-confidence picks,
      // but demote them if user prefers higher confidence
      if (profile.confidenceMin > 0 && rec.prediction) {
        const conf = rec.prediction.confidence ?? 0;
        if (conf < profile.confidenceMin) {
          boostScore = Math.max(0, boostScore - 20);
        }
      }

      return { ...rec, score: Math.min(100, boostScore) };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Build personalized feed sections ────────────────────────────────────────
export function buildPersonalizedSections(
  ranked: MatchRecommendation[],
  profile: PersonalizationProfile,
): {
  forYou: MatchRecommendation[];
  byLeague: Record<string, MatchRecommendation[]>;
  highConfidence: MatchRecommendation[];
} {
  const forYou = ranked.slice(0, 8);

  // Group into followed leagues
  const byLeague: Record<string, MatchRecommendation[]> = {};
  for (const rec of ranked) {
    const league = rec.match.league ?? 'Other';
    if (!byLeague[league]) byLeague[league] = [];
    if (byLeague[league].length < 5) byLeague[league].push(rec);
  }

  const highConfidence = ranked
    .filter((r) => r.prediction && (r.prediction.confidence ?? 0) >= 70)
    .slice(0, 8);

  return { forYou, byLeague, highConfidence };
}

// ─── Privacy: delete profile ──────────────────────────────────────────────────
export async function deletePersonalizationProfile(userId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('personalization_profiles').delete().eq('user_id', userId);
    await AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
  } catch { /* non-blocking */ }
}

export default {
  loadPersonalizationProfile,
  updatePersonalizationProfile,
  recordInteraction,
  personalizedRank,
  buildPersonalizedSections,
  deletePersonalizationProfile,
};
