/**
 * services/supabase.ts
 *
 * Typed Supabase client for PredictXta.
 *
 * Usage:
 *   import { supabase } from '@/services/supabase';
 *   const { data, error } = await supabase.from('matches').select('*');
 *
 * The client is a singleton that reuses the OnSpace Cloud connection
 * (same credentials as the template client) but exposes a typed
 * fluent interface and a set of ready-to-use helper queries.
 */

import { getSupabaseClient } from '@/template';
import type { Match, Prediction } from './types';
import type { HighlightItem, NewsArticle, ExpertTip, TrendingLeague } from './feedEngine';

// ─── Singleton accessor ──────────────────────────────────────────────────────
/**
 * Typed Supabase client instance.
 * Backed by the auto-configured OnSpace Cloud connection.
 */
export const supabase = getSupabaseClient();

// ─── Sport key normalizer ─────────────────────────────────────────────────────
// DB stores sports as lowercase-hyphenated: 'american-football', 'volleyball'
// Callers may pass Title Case or spaces: 'American Football', 'Volleyball'
function dbSport(sport?: string): string | undefined {
  if (!sport || sport === 'All' || sport === 'all') return undefined;
  return sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Row → Domain mappers ────────────────────────────────────────────────────
export function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    sport: (row.sport as string) ?? 'football',
    homeTeam: (row.home_team as string) ?? '',
    awayTeam: (row.away_team as string) ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: (row.status as Match['status']) ?? 'upcoming',
    matchTime: (row.match_time as string) ?? '',
    league: (row.league as string) ?? '',
    country: (row.country as string) ?? undefined,
    venue: (row.venue as string) ?? undefined,
    minute: Number(row.minute ?? 0),
    round: (row.round as string) ?? undefined,
    homeLogo: (row.home_logo as string) ?? null,
    awayLogo: (row.away_logo as string) ?? null,
    leagueLogo: (row.league_logo as string) ?? null,
    stats: (row.stats as Match['stats']) ?? null,
    externalId: (row.external_id as string) ?? undefined,
    homeOdds: row.home_odds ? Number(row.home_odds) : undefined,
    drawOdds: row.draw_odds ? Number(row.draw_odds) : undefined,
    awayOdds: row.away_odds ? Number(row.away_odds) : undefined,
  };
}

export function rowToPrediction(row: Record<string, unknown>): Prediction {
  return {
    id: (row.id as string) ?? '',
    matchId: (row.match_id as string) ?? '',
    homeWinProb: Number(row.home_win_prob ?? 0),
    drawProb: Number(row.draw_prob ?? 0),
    awayWinProb: Number(row.away_win_prob ?? 0),
    predictedResult: (row.predicted_result as Prediction['predictedResult']) ?? 'home_win',
    confidence: Number(row.confidence ?? 70),
    overUnder: (row.over_under as 'over' | 'under') ?? 'over',
    overUnderLine: Number(row.over_under_line ?? 2.5),
    btts: (row.btts as 'yes' | 'no') ?? 'no',
    aiAnalysis: (row.ai_analysis as string) ?? '',
    keyFactors: Array.isArray(row.key_factors) ? (row.key_factors as string[]) : [],
    createdAt: (row.created_at as string) ?? undefined,
    predictedHomeGoals: row.predicted_home_goals != null ? Number(row.predicted_home_goals) : undefined,
    predictedAwayGoals: row.predicted_away_goals != null ? Number(row.predicted_away_goals) : undefined,
    correctScore: (row.correct_score as string) ?? undefined,
    cornersOverUnder: (row.corners_over_under as 'over' | 'under') ?? undefined,
    cornersLine: row.corners_line != null ? Number(row.corners_line) : undefined,
    cardsTotal: row.cards_total != null ? Number(row.cards_total) : undefined,
    cardsOverUnder: (row.cards_over_under as 'over' | 'under') ?? undefined,
    asianHandicapLine: row.asian_handicap_line != null ? Number(row.asian_handicap_line) : undefined,
    asianHandicapPick: (row.asian_handicap_pick as 'home' | 'away') ?? undefined,
    htResult: (row.ht_result as 'home_win' | 'draw' | 'away_win') ?? undefined,
    htHomeProb: row.ht_home_prob != null ? Number(row.ht_home_prob) : undefined,
    htDrawProb: row.ht_draw_prob != null ? Number(row.ht_draw_prob) : undefined,
    htAwayProb: row.ht_away_prob != null ? Number(row.ht_away_prob) : undefined,
    cleanSheetHome: (row.clean_sheet_home as 'yes' | 'no') ?? undefined,
    cleanSheetAway: (row.clean_sheet_away as 'yes' | 'no') ?? undefined,
    firstGoal: (row.first_goal as 'home' | 'away' | 'no_goal') ?? undefined,
    bothScoreHt: (row.both_score_ht as 'yes' | 'no') ?? undefined,
    anytimeScorecast: (row.anytime_scorecast as string) ?? undefined,
    riskLevel: (row.risk_level as 'Low' | 'Medium' | 'High') ?? undefined,
    valueScore: row.value_score != null ? Number(row.value_score) : undefined,
    marketEdgePct: row.market_edge_pct != null ? Number(row.market_edge_pct) : undefined,
    sharpSignal: (row.sharp_signal as 'bullish' | 'neutral' | 'bearish') ?? undefined,
    suggestedStake: (row.suggested_stake as 'low' | 'medium' | 'high') ?? undefined,
    keyAlphaMetric: (row.key_alpha_metric as string) ?? undefined,
    predictionVersion: row.prediction_version != null ? Number(row.prediction_version) : undefined,
    warningFlags: Array.isArray(row.warning_flags) ? (row.warning_flags as string[]) : undefined,
  };
}

export function rowToExpertTip(row: Record<string, unknown>): ExpertTip {
  return {
    id: row.id as string,
    expertName: (row.expert_name as string) ?? '',
    sport: (row.sport as string) ?? 'football',
    matchLabel: (row.match_label as string) ?? '',
    tipType: (row.tip_type as string) ?? '',
    tipValue: (row.tip_value as string) ?? '',
    odds: row.odds ? Number(row.odds) : null,
    confidence: Number(row.confidence ?? 70),
    status: (row.status as ExpertTip['status']) ?? 'pending',
    league: (row.league as string) ?? null,
    isPremium: (row.is_premium as boolean) ?? false,
    createdAt: (row.created_at as string) ?? '',
  };
}

export function rowToHighlight(row: Record<string, unknown>): HighlightItem {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    sport: (row.sport as string) ?? 'football',
    embedUrl: (row.embed_url as string) ?? null,
    thumbnailUrl: (row.thumbnail as string) ?? null,
    homeTeam: (row.home_team as string) ?? null,
    awayTeam: (row.away_team as string) ?? null,
    league: (row.league as string) ?? null,
    eventDate: (row.event_date as string) ?? null,
    createdAt: (row.created_at as string) ?? '',
  };
}

export function rowToNews(row: Record<string, unknown>): NewsArticle {
  return {
    id: row.id as string,
    externalId: (row.external_id as string) ?? '',
    source: (row.source as string) ?? 'unknown',
    sport: (row.sport as string) ?? 'football',
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? null,
    author: (row.author as string) ?? null,
    url: (row.url as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    category: (row.category as string) ?? 'news',
    homeTeam: (row.home_team as string) ?? null,
    awayTeam: (row.away_team as string) ?? null,
    league: (row.league as string) ?? null,
    publishedAt: (row.published_at as string) ?? (row.created_at as string) ?? '',
    createdAt: (row.created_at as string) ?? '',
  };
}

// ─── Typed helper queries ────────────────────────────────────────────────────

/** Fetch live matches (optionally filtered by sport). */
export async function getLiveMatches(sport?: string): Promise<Match[]> {
  const s = dbSport(sport);
  let q = supabase
    .from('matches')
    .select('*')
    .eq('status', 'live')
    .order('minute', { ascending: false })
    .limit(30);
  if (s) q = q.eq('sport', s);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToMatch);
}

/** Fetch upcoming matches within the next N days. */
export async function getUpcomingMatches(sport?: string, daysAhead = 7): Promise<Match[]> {
  const s = dbSport(sport);
  const now = new Date().toISOString();
  const future = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
  let q = supabase
    .from('matches')
    .select('*')
    .eq('status', 'upcoming')
    .gte('match_time', now)
    .lte('match_time', future)
    .order('match_time', { ascending: true })
    .limit(60);
  if (s) q = q.eq('sport', s);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToMatch);
}

/** Fetch recently finished matches. */
export async function getRecentMatches(sport?: string, hoursBack = 48): Promise<Match[]> {
  const s = dbSport(sport);
  const cutoff = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  let q = supabase
    .from('matches')
    .select('*')
    .eq('status', 'finished')
    .gte('match_time', cutoff)
    .order('match_time', { ascending: false })
    .limit(20);
  if (s) q = q.eq('sport', s);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToMatch);
}

/** Fetch a single match by ID. */
export async function getMatchById(id: string): Promise<Match | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToMatch(data as Record<string, unknown>);
}

/** Fetch predictions; optionally filter by match IDs. */
export async function getPredictions(matchIds?: string[]): Promise<Prediction[]> {
  let q = supabase
    .from('predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (matchIds && matchIds.length > 0) q = q.in('match_id', matchIds);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToPrediction);
}

/** Fetch the latest prediction for a specific match. */
export async function getPredictionByMatchId(matchId: string): Promise<Prediction | null> {
  const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToPrediction(data as Record<string, unknown>);
}

/** Fetch news articles (optionally filtered by sport). */
export async function getNewsArticles(sport?: string, limit = 20): Promise<NewsArticle[]> {
  let q = supabase
    .from('news_articles')
    .select(
      'id, external_id, source, sport, title, summary, author, url, image_url, tags, category, home_team, away_team, league, published_at, created_at',
    )
    .order('published_at', { ascending: false })
    .limit(limit);
  if (sport) q = q.eq('sport', sport.toLowerCase());
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToNews);
}

/** Fetch expert tips (premium tips hidden unless isVip). */
export async function getExpertTips(isVip = false, limit = 15): Promise<ExpertTip[]> {
  let q = supabase
    .from('expert_tips')
    .select(
      'id, expert_name, sport, match_label, tip_type, tip_value, odds, confidence, status, league, is_premium, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!isVip) q = q.eq('is_premium', false);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToExpertTip);
}

/** Fetch trending leagues (by match + live count within ±48h window). */
export async function getTrendingLeagues(sport?: string): Promise<TrendingLeague[]> {
  const minus12h = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const plus48h = new Date(Date.now() + 48 * 3_600_000).toISOString();
  let q = supabase
    .from('matches')
    .select('league, sport, status, league_logo')
    .gte('match_time', minus12h)
    .lte('match_time', plus48h)
    .limit(300);
  if (sport) q = q.eq('sport', sport.toLowerCase());
  const { data } = await q;
  const map = new Map<string, TrendingLeague>();
  for (const m of data ?? []) {
    if (!m.league) continue;
    if (!map.has(m.league)) {
      map.set(m.league, {
        leagueName: m.league,
        sport: m.sport ?? 'football',
        matchCount: 0,
        liveCount: 0,
        leagueLogo: m.league_logo ?? null,
      });
    }
    const entry = map.get(m.league)!;
    entry.matchCount++;
    if (m.status === 'live') entry.liveCount++;
  }
  return [...map.values()]
    .sort((a, b) => b.liveCount - a.liveCount || b.matchCount - a.matchCount)
    .slice(0, 8);
}

/** Fetch user coin balance. */
export async function getUserCoins(userId: string): Promise<number> {
  const { data } = await supabase
    .from('user_coins')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

/** Fetch VIP subscription status. */
export async function getVipStatus(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('vip_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return !!data;
}

/** Upsert user profile fields. */
export async function updateUserProfile(
  userId: string,
  fields: Partial<{ username: string; push_token: string; preferred_language: string; avatar_url: string }>,
): Promise<void> {
  await supabase.from('user_profiles').upsert({ id: userId, ...fields });
}

/** Mark notifications as read for a user. */
export async function markNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}

/** Count unread notifications. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
}
