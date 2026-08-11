/**
 * feedService.ts — Unified Home Feed Service
 *
 * Responsibilities:
 * 1. Fetch the unified feed from the home-feed edge function
 * 2. Cache the feed in AsyncStorage for offline support
 * 3. Return stale cached data immediately while fetching fresh data
 * 4. Never expose or call external sports APIs — only reads DB via edge functions
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Match, Prediction } from './types';

// ─── Logging helpers ──────────────────────────────────────────────────────────
const LOG = __DEV__;
function log(stage: string, ...args: unknown[]) {
  if (LOG) console.log(`[feedService][${stage}]`, ...args);
}
function warn(stage: string, ...args: unknown[]) {
  console.warn(`[feedService][${stage}]`, ...args);
}

// ─── Cache keys ───────────────────────────────────────────────────────────────
const FEED_CACHE_KEY = '@predictxta/home_feed_v2';
const FEED_CACHE_TS_KEY = '@predictxta/home_feed_ts_v2';
const FEED_STALE_MS = 60_000; // 60 seconds — feed is considered stale

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TrendingLeague {
  leagueName: string;
  sport: string;
  matchCount: number;
  liveCount: number;
  leagueLogo: string | null;
}

export interface HighlightItem {
  id: string;
  title: string;
  sport: string;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  league: string | null;
  eventDate: string | null;
  createdAt: string;
}

export interface ExpertTipRow {
  id: string;
  expertName: string;
  sport: string;
  matchLabel: string;
  tipType: string;
  tipValue: string;
  odds: number | null;
  confidence: number;
  status: 'pending' | 'won' | 'lost' | 'void';
  league: string | null;
  isPremium: boolean;
  createdAt: string;
}

export interface NewsArticleItem {
  id: string;
  externalId: string;
  source: string;
  sport: string;
  title: string;
  summary: string | null;
  author: string | null;
  url: string | null;
  imageUrl: string | null;
  tags: string[];
  category: string;
  homeTeam: string | null;
  awayTeam: string | null;
  league: string | null;
  publishedAt: string;
  createdAt: string;
}

export interface FeedData {
  featuredMatches: Match[];
  liveMatches: Match[];
  upcomingMatches: Match[];
  recentMatches: Match[];
  predictions: Prediction[];
  vipPredictions: Prediction[];
  expertTips: ExpertTipRow[];
  trendingLeagues: TrendingLeague[];
  highConfidenceTips: ExpertTipRow[];
  highlights: HighlightItem[];
  news: NewsArticleItem[];
  personalisation: {
    followedLeagues: string[];
    hasPersonalisation: boolean;
  };
  feedMeta: {
    generatedAt: string;
    liveCount: number;
    upcomingCount: number;
    predictionsCount: number;
    elapsed_ms?: number;
    sport?: string;
    isVip?: boolean;
    error?: boolean;
    fromCache?: boolean;
    dataSource?: string;
    recentSource?: string;
  };
}

export const EMPTY_FEED: FeedData = {
  featuredMatches: [],
  liveMatches: [],
  upcomingMatches: [],
  recentMatches: [],
  predictions: [],
  vipPredictions: [],
  expertTips: [],
  trendingLeagues: [],
  highConfidenceTips: [],
  highlights: [],
  news: [],
  personalisation: { followedLeagues: [], hasPersonalisation: false },
  feedMeta: {
    generatedAt: new Date().toISOString(),
    liveCount: 0, upcomingCount: 0, predictionsCount: 0,
    fromCache: false,
  },
};

// ─── Map raw DB rows to typed objects ─────────────────────────────────────────
function rowToMatch(row: Record<string, any>): Match {
  return {
    id: row.id,
    sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: row.status ?? 'upcoming',
    matchTime: row.match_time ?? '',
    league: row.league ?? '',
    venue: row.venue ?? undefined,
    minute: Number(row.minute ?? 0),
    homeLogo: row.home_logo ?? null,
    awayLogo: row.away_logo ?? null,
    leagueLogo: row.league_logo ?? null,
    stats: row.stats ?? null,
    externalId: row.external_id ?? undefined,
  };
}

function rowToPrediction(row: Record<string, any>): Prediction {
  return {
    id: row.id,
    matchId: row.match_id ?? '',
    homeWinProb: Number(row.home_win_prob ?? 0),
    drawProb: Number(row.draw_prob ?? 0),
    awayWinProb: Number(row.away_win_prob ?? 0),
    predictedResult: row.predicted_result ?? 'home_win',
    confidence: Number(row.confidence ?? 0),
    overUnder: row.over_under ?? 'over',
    overUnderLine: Number(row.over_under_line ?? 2.5),
    btts: row.btts ?? 'no',
    aiAnalysis: row.ai_analysis ?? null,
    keyFactors: row.key_factors ?? [],
    createdAt: row.created_at ?? '',
  };
}

function rowToExpertTip(row: Record<string, any>): ExpertTipRow {
  return {
    id: row.id,
    expertName: row.expert_name ?? '',
    sport: row.sport ?? 'football',
    matchLabel: row.match_label ?? '',
    tipType: row.tip_type ?? '',
    tipValue: row.tip_value ?? '',
    odds: row.odds ? Number(row.odds) : null,
    confidence: Number(row.confidence ?? 70),
    status: row.status ?? 'pending',
    league: row.league ?? null,
    isPremium: row.is_premium ?? false,
    createdAt: row.created_at ?? '',
  };
}

// ─── Read cached feed from AsyncStorage ───────────────────────────────────────
export async function getCachedFeed(): Promise<FeedData | null> {
  try {
    const [raw, tsRaw] = await Promise.all([
      AsyncStorage.getItem(FEED_CACHE_KEY),
      AsyncStorage.getItem(FEED_CACHE_TS_KEY),
    ]);
    if (!raw) return null;
    const feed: FeedData = JSON.parse(raw);
    feed.feedMeta.fromCache = true;
    if (tsRaw) {
      const ts = parseInt(tsRaw, 10);
      const ageMs = Date.now() - ts;
      (feed.feedMeta as any).cacheAgeMs = ageMs;
      (feed.feedMeta as any).cacheStale = ageMs > FEED_STALE_MS;
    }
    return feed;
  } catch {
    return null;
  }
}

// ─── Check if cached feed is still fresh ─────────────────────────────────────
export async function isFeedCacheFresh(): Promise<boolean> {
  try {
    const tsRaw = await AsyncStorage.getItem(FEED_CACHE_TS_KEY);
    if (!tsRaw) return false;
    const age = Date.now() - parseInt(tsRaw, 10);
    return age < FEED_STALE_MS;
  } catch {
    return false;
  }
}

// ─── Persist feed to AsyncStorage ─────────────────────────────────────────────
async function saveFeedCache(feed: FeedData): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify(feed)),
      AsyncStorage.setItem(FEED_CACHE_TS_KEY, String(Date.now())),
    ]);
  } catch { /* non-blocking — offline writes may fail */ }
}

// ─── Fetch fresh feed from home-feed edge function ────────────────────────────
export async function fetchFeedFromEdge(opts: {
  sport?: string;
  isVip?: boolean;
  userId?: string;
}): Promise<FeedData> {
  try {
    log('API Request', `→ home-feed | sport=${opts.sport ?? 'all'} isVip=${opts.isVip ?? false} userId=${opts.userId ?? 'anon'}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('home-feed', {
      body: {
        sport: opts.sport ?? 'all',
        isVip: opts.isVip ?? false,
        userId: opts.userId ?? null,
        limit: 12,
      },
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await error.context?.text()) || msg; } catch { /* ignore */ }
      }
      warn('API Response', `home-feed error: ${msg}`);
      return { ...EMPTY_FEED, feedMeta: { ...EMPTY_FEED.feedMeta, error: true } };
    }

    if (!data) {
      warn('API Response', 'home-feed returned no data');
      return EMPTY_FEED;
    }

    log('API Response', `← home-feed | live=${data.liveMatches?.length ?? 0} upcoming=${data.upcomingMatches?.length ?? 0} predictions=${data.predictions?.length ?? 0} elapsed=${data.feedMeta?.elapsed_ms ?? '?'}ms`);

    // Map raw DB rows → typed objects
    const feed: FeedData = {
      featuredMatches: (data.featuredMatches ?? []).map(rowToMatch),
      liveMatches: (data.liveMatches ?? []).map(rowToMatch),
      upcomingMatches: (data.upcomingMatches ?? []).map(rowToMatch),
      recentMatches: (data.recentMatches ?? []).map(rowToMatch),
      predictions: (data.predictions ?? []).map(rowToPrediction),
      vipPredictions: (data.vipPredictions ?? []).map(rowToPrediction),
      expertTips: (data.expertTips ?? []).map(rowToExpertTip),
      trendingLeagues: data.trendingLeagues ?? [],
      highConfidenceTips: (data.highConfidenceTips ?? []).map(rowToExpertTip),
      news: (data.news ?? []).map((row: Record<string, any>): NewsArticleItem => ({
        id: row.id,
        externalId: row.external_id ?? '',
        source: row.source ?? 'unknown',
        sport: row.sport ?? 'football',
        title: row.title ?? '',
        summary: row.summary ?? null,
        author: row.author ?? null,
        url: row.url ?? null,
        imageUrl: row.image_url ?? null,
        tags: Array.isArray(row.tags) ? row.tags : [],
        category: row.category ?? 'news',
        homeTeam: row.home_team ?? null,
        awayTeam: row.away_team ?? null,
        league: row.league ?? null,
        publishedAt: row.published_at ?? row.created_at ?? '',
        createdAt: row.created_at ?? '',
      })) as NewsArticleItem[],
      highlights: (data.highlights ?? []).map((row: Record<string, any>) => ({
        id: row.id,
        title: row.title ?? '',
        sport: row.sport ?? 'football',
        embedUrl: row.embed_url ?? null,
        thumbnailUrl: row.thumbnail ?? null,
        homeTeam: row.home_team ?? null,
        awayTeam: row.away_team ?? null,
        league: row.league ?? null,
        eventDate: row.event_date ?? null,
        createdAt: row.created_at ?? '',
      })),
      personalisation: data.personalisation ?? { followedLeagues: [], hasPersonalisation: false },
      feedMeta: {
        ...(data.feedMeta ?? {}),
        fromCache: false,
      },
    };

    // Persist to cache for offline support
    await saveFeedCache(feed);
    log('Database Save', `Feed cached to AsyncStorage (${feed.liveMatches.length} live, ${feed.upcomingMatches.length} upcoming)`);
    return feed;
  } catch (e) {
    warn('fetchFeedFromEdge', 'Unexpected error:', e);
    return { ...EMPTY_FEED, feedMeta: { ...EMPTY_FEED.feedMeta, error: true } };
  }
}

// ─── Main public API ──────────────────────────────────────────────────────────
/**
 * loadFeed — Stale-while-revalidate strategy:
 * 1. Return cached data immediately (fast paint)
 * 2. Fetch fresh data in background
 * 3. Callback `onFresh` when new data arrives
 */
export async function loadFeed(opts: {
  sport?: string;
  isVip?: boolean;
  userId?: string;
  onFresh?: (feed: FeedData) => void;
  forceRefresh?: boolean;
}): Promise<FeedData> {
  const { sport, isVip, userId, onFresh, forceRefresh } = opts;

  // Try cache first for instant render
  const cached = await getCachedFeed();
  const cacheIsFresh = cached ? await isFeedCacheFresh() : false;

  if (cached && cacheIsFresh && !forceRefresh) {
    // Cache is fresh — return it, skip background fetch
    return cached;
  }

  if (cached && !forceRefresh) {
    // Stale cache — return immediately, fetch in background
    fetchFeedFromEdge({ sport, isVip, userId })
      .then((fresh) => onFresh?.(fresh))
      .catch(() => { /* silent — offline */ });
    return cached;
  }

  // No cache or force refresh — fetch synchronously
  const fresh = await fetchFeedFromEdge({ sport, isVip, userId });
  return fresh;
}

/**
 * fetchUpcomingMatchesFromDB — Directly query upcoming matches for next 7 days
 * Used by the home screen to show upcoming matches without waiting for edge function.
 */
export async function fetchUpcomingMatchesFromDB(): Promise<Match[]> {
  try {
    log('Database Read', 'Fetching upcoming matches from DB (next 7 days)');
    const supabase = getSupabaseClient();
    const windowEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'upcoming')
      .gte('match_time', new Date().toISOString())
      .lte('match_time', windowEnd)
      .order('match_time', { ascending: true })
      .limit(60);
    if (error) {
      warn('Database Read', 'fetchUpcomingMatchesFromDB error:', error.message);
      return [];
    }
    log('Database Read', `Upcoming matches from DB: ${data?.length ?? 0}`);
    return ((data ?? []) as Record<string, any>[]).map(rowToMatch);
  } catch (e) {
    warn('fetchUpcomingMatchesFromDB', e);
    return [];
  }
}

/**
 * fetchRecentlyFinishedFromDB — Directly query matches finished in last 48 hours
 */
export async function fetchRecentlyFinishedFromDB(): Promise<Match[]> {
  try {
    log('Database Read', 'Fetching recently finished matches from DB (last 48h)');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'finished')
      .gte('match_time', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('match_time', { ascending: false })
      .limit(12);
    if (error) {
      warn('Database Read', 'fetchRecentlyFinishedFromDB error:', error.message);
      return [];
    }
    log('Database Read', `Recently finished from DB: ${data?.length ?? 0}`);
    return ((data ?? []) as Record<string, any>[]).map(rowToMatch);
  } catch (e) {
    warn('fetchRecentlyFinishedFromDB', e);
    return [];
  }
}

export async function fetchLiveFeedFromDB(): Promise<Match[]> {
  try {
    log('Database Read', 'Fetching live matches from DB');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'live')
      .order('minute', { ascending: false })
      .limit(30);
    if (error) {
      warn('Database Read', 'fetchLiveFeedFromDB error:', error.message);
      return [];
    }
    log('Database Read', `Live matches from DB: ${data?.length ?? 0}`);
    return ((data ?? []) as Record<string, any>[]).map(rowToMatch);
  } catch (e) {
    warn('fetchLiveFeedFromDB', e);
    return [];
  }
}

/**
 * triggerLiveSync — Calls the sync-live edge function to refresh live scores
 * and optionally send goal alerts. Call every 30–60s from background.
 */
export async function triggerLiveSync(sendAlerts = true): Promise<{
  liveCount: number;
  scoreChanges: number;
}> {
  try {
    log('API Request', `→ sync-live | sendAlerts=${sendAlerts}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('sync-live', {
      body: { sports: [
        'football', 'basketball', 'hockey', 'tennis',
        'rugby', 'handball', 'volleyball', 'baseball', 'american-football',
        'cricket', 'mma',
      ], sendAlerts },
    });
    if (error) {
      warn('API Response', `sync-live error: ${error.message}`);
      return { liveCount: 0, scoreChanges: 0 };
    }
    log('API Response', `← sync-live | liveCount=${data?.liveCount ?? 0} scoreChanges=${data?.scoreChanges ?? 0}`);
    return {
      liveCount: data?.liveCount ?? 0,
      scoreChanges: data?.scoreChanges ?? 0,
    };
  } catch {
    return { liveCount: 0, scoreChanges: 0 };
  }
}

/**
 * triggerFixtureSync — Triggers fetch-matches edge function to sync today's fixtures.
 * Call every hour in background (or on app foreground).
 */
export async function triggerFixtureSync(sport = 'all'): Promise<void> {
  try {
    log('API Request', `→ fetch-matches | mode=today sport=${sport}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('fetch-matches', { body: { mode: 'today', sport } });
    if (error) {
      warn('API Response', `fetch-matches error: ${error.message}`);
    } else {
      log('API Response', `← fetch-matches | fetched=${data?.fetched ?? '?'} inserted=${data?.inserted ?? '?'}`);
    }
  } catch (e) {
    warn('triggerFixtureSync', e);
  }
}

/**
 * triggerOddsSync — Triggers fetch-odds edge function.
 * Call every 2–5 minutes.
 */
export async function triggerOddsSync(): Promise<void> {
  try {
    log('API Request', '→ fetch-odds | mode=today');
    const supabase = getSupabaseClient();
    const { error } = await supabase.functions.invoke('fetch-odds', { body: { mode: 'today' } });
    if (error) {
      warn('API Response', `fetch-odds error: ${error.message}`);
    } else {
      log('API Response', '← fetch-odds | OK');
    }
  } catch (e) {
    warn('triggerOddsSync', e);
  }
}

/**
 * triggerStandingsSync — Triggers sync-standings edge function.
 * Call every 6 hours.
 */
export async function triggerStandingsSync(syncPlayers = false): Promise<void> {
  try {
    log('API Request', `→ sync-standings | syncPlayers=${syncPlayers}`);
    const supabase = getSupabaseClient();
    const { error } = await supabase.functions.invoke('sync-standings', {
      body: { syncPlayers, syncEvents: false },
    });
    if (error) {
      warn('API Response', `sync-standings error: ${error.message}`);
    } else {
      log('API Response', '← sync-standings | OK');
    }
  } catch (e) {
    warn('triggerStandingsSync', e);
  }
}

/**
 * triggerHighlightsSync — Triggers sync-highlights edge function.
 * Fetches highlights from TheSportsDB (primary) + API-Football (secondary).
 * Call every 30 minutes in background.
 * NOTE: Highlightly API removed — TheSportsDB is now the primary source.
 */
export async function triggerHighlightsSync(limit = 20): Promise<{
  fetched: number;
  upserted: number;
}> {
  try {
    log('API Request', `→ sync-highlights (TheSportsDB+APIFootball) | limit=${limit}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('sync-highlights', {
      body: { limit },
    });
    if (error) {
      warn('API Response', `sync-highlights error: ${error.message}`);
      return { fetched: 0, upserted: 0 };
    }
    log('API Response', `← sync-highlights | fetched=${data?.fetched ?? 0} upserted=${data?.upserted ?? 0} elapsed=${data?.elapsed_ms ?? '?'}ms`);
    return { fetched: data?.fetched ?? 0, upserted: data?.upserted ?? 0 };
  } catch (e) {
    warn('triggerHighlightsSync', e);
    return { fetched: 0, upserted: 0 };
  }
}

/**
 * triggerNewsSync — Triggers sync-news edge function.
 * Fetches latest news from TheSportsDB (primary) + API-Football (secondary).
 * NOTE: Highlightly API removed — TheSportsDB is now the primary news source.
 * Call every 20 minutes in background.
 */
export async function triggerNewsSync(sports: string[] = ['football', 'basketball', 'tennis', 'cricket', 'hockey', 'rugby', 'mma']): Promise<{
  fetched: number;
  upserted: number;
}> {
  try {
    log('API Request', `→ sync-news | sports=${sports.join(',')}`);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('sync-news', {
      body: { sports, limit: 20 },
    });
    if (error) {
      warn('API Response', `sync-news error: ${error.message}`);
      return { fetched: 0, upserted: 0 };
    }
    log('API Response', `← sync-news | fetched=${data?.fetched ?? 0} upserted=${data?.upserted ?? 0}`);
    return { fetched: data?.fetched ?? 0, upserted: data?.upserted ?? 0 };
  } catch (e) {
    warn('triggerNewsSync', e);
    return { fetched: 0, upserted: 0 };
  }
}

/**
 * triggerFirebaseLiveSync — manually invoke firebase-live edge function
 * to test Firebase RTDB connectivity from the admin dashboard.
 */
export async function triggerFirebaseLiveSync(): Promise<{
  liveCount: number;
  source: string;
  latencyMs: number;
}> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('firebase-live', { body: { sport: 'all' } });
    if (error) return { liveCount: 0, source: 'error', latencyMs: 0 };
    return {
      liveCount: data?.count ?? 0,
      source: data?.source ?? 'unknown',
      latencyMs: data?.elapsed_ms ?? 0,
    };
  } catch {
    return { liveCount: 0, source: 'error', latencyMs: 0 };
  }
}
