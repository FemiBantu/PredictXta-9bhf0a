/**
 * feedEngine.ts — Robust Multi-Layer Feed Architecture (v5 — sport-scoped cache)
 *
 * FIXES in v5:
 * - Sport key normalization: 'American Football' → 'american-football', etc.
 * - Sport-scoped L1 memory cache: different sports never share a cache slot
 * - Sport-scoped AsyncStorage cache keys: prevents cross-sport cache bleed
 * - All DB queries use normalized sport key consistently
 *
 * Layer 0: Firebase RTDB      (12s — live scores only, fastest)
 * Layer 1: In-memory cache    (instant, survives re-renders, 30s TTL for live)
 * Layer 2: AsyncStorage       (fast, survives app restart, offline)
 * Layer 3: Supabase DB        (source of truth, populated by edge functions)
 * Layer 4: Historical fallback (last 7 days when APIs are down)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import type { Match, Prediction } from './types';
import { fetchFirebaseLiveScores, isFirebaseConfigured } from './firebaseService';

// ─── Sport key normalization ─────────────────────────────────────────────────
// DB stores sports as lowercase-hyphenated: 'football', 'american-football'
// UI sends Title Case or spaces: 'Football', 'American Football'
// This function converts any sport string to the DB-compatible key.
function normalizeSportKey(sport?: string | null): string | null {
  if (!sport || sport === 'All' || sport === 'all') return null;
  // Already a DB key (lowercase, hyphenated)
  if (sport === sport.toLowerCase()) return sport.replace(/\s+/g, '-');
  // Title Case → lowercase + hyphenate
  return sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Cache configuration ────────────────────────────────────────────────────
const CACHE_VERSION = 'v5';
const CACHE_BASE = {
  LIVE_MATCHES:    `@predictxta/feed_live_${CACHE_VERSION}`,
  UPCOMING:        `@predictxta/feed_upcoming_${CACHE_VERSION}`,
  RECENT:          `@predictxta/feed_recent_${CACHE_VERSION}`,
  PREDICTIONS:     `@predictxta/feed_predictions_${CACHE_VERSION}`,
  EXPERT_TIPS:     `@predictxta/feed_expert_tips_${CACHE_VERSION}`,
  HIGHLIGHTS:      `@predictxta/feed_highlights_${CACHE_VERSION}`,
  NEWS:            `@predictxta/feed_news_${CACHE_VERSION}`,
  TRENDING:        `@predictxta/feed_trending_${CACHE_VERSION}`,
  TIMESTAMPS:      `@predictxta/feed_timestamps_${CACHE_VERSION}`,
};

// Returns a sport-scoped cache key to prevent cross-sport cache bleed
function cacheKey(base: string, sportKey: string | null): string {
  return sportKey ? `${base}_${sportKey}` : base;
}

// Freshness thresholds (ms)
const FRESHNESS = {
  LIVE:        30_000,        // 30s
  UPCOMING:    5 * 60_000,    // 5min
  RECENT:      10 * 60_000,   // 10min
  PREDICTIONS: 15 * 60_000,   // 15min
  EXPERT_TIPS: 10 * 60_000,   // 10min
  HIGHLIGHTS:  30 * 60_000,   // 30min
  NEWS:        20 * 60_000,   // 20min
  TRENDING:    5 * 60_000,    // 5min
};

// ─── Types ──────────────────────────────────────────────────────────────────
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

export interface NewsArticle {
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

export interface ExpertTip {
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

export interface TrendingLeague {
  leagueName: string;
  sport: string;
  matchCount: number;
  liveCount: number;
  leagueLogo: string | null;
}

export interface FeedSectionMeta {
  lastUpdated: string | null;
  source: 'live' | 'cached' | 'historical' | 'empty';
  recordCount: number;
  isStale: boolean;
  provider?: string;
}

export interface UnifiedFeed {
  liveMatches: Match[];
  upcomingMatches: Match[];
  recentMatches: Match[];
  featuredMatches: Match[];
  predictions: Prediction[];
  expertTips: ExpertTip[];
  highlights: HighlightItem[];
  news: NewsArticle[];
  trendingLeagues: TrendingLeague[];
  meta: {
    liveSection:        FeedSectionMeta;
    upcomingSection:    FeedSectionMeta;
    recentSection:      FeedSectionMeta;
    predictionsSection: FeedSectionMeta;
    tipsSection:        FeedSectionMeta;
    highlightsSection:  FeedSectionMeta;
    newsSection:        FeedSectionMeta;
    generatedAt: string;
    isFullyStale: boolean;
    hasAnyData: boolean;
    offlineMode: boolean;
  };
}

export const EMPTY_UNIFIED_FEED: UnifiedFeed = {
  liveMatches: [], upcomingMatches: [], recentMatches: [],
  featuredMatches: [], predictions: [], expertTips: [],
  highlights: [], news: [], trendingLeagues: [],
  meta: {
    liveSection:        { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    upcomingSection:    { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    recentSection:      { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    predictionsSection: { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    tipsSection:        { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    highlightsSection:  { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    newsSection:        { lastUpdated: null, source: 'empty', recordCount: 0, isStale: true },
    generatedAt: new Date().toISOString(),
    isFullyStale: true, hasAnyData: false, offlineMode: false,
  },
};

// ─── In-memory L1 cache — SPORT-SCOPED ─────────────────────────────────────
// Each sport gets its own cache slot so basketball data never overwrites football data
const memCache: {
  feeds: Record<string, { feed: UnifiedFeed; ts: number }>;
  timestamps: Record<string, number>;
} = {
  feeds: {},    // key = sportKey or '__all__'
  timestamps: {},
};

// ─── Row mappers ────────────────────────────────────────────────────────────
function rowToMatch(row: Record<string, any>): Match {
  return {
    id: row.id, sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '', awayTeam: row.away_team ?? '',
    homeScore: Number(row.home_score ?? 0), awayScore: Number(row.away_score ?? 0),
    status: row.status ?? 'upcoming', matchTime: row.match_time ?? '',
    league: row.league ?? '', country: row.country ?? undefined,
    venue: row.venue ?? undefined, minute: Number(row.minute ?? 0),
    round: row.round ?? undefined,
    homeLogo: row.home_logo ?? null, awayLogo: row.away_logo ?? null,
    leagueLogo: row.league_logo ?? null, stats: row.stats ?? null,
    externalId: row.external_id ?? undefined,
    homeOdds: row.home_odds ? Number(row.home_odds) : undefined,
    drawOdds: row.draw_odds ? Number(row.draw_odds) : undefined,
    awayOdds: row.away_odds ? Number(row.away_odds) : undefined,
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
    aiAnalysis: row.ai_analysis ?? '',
    keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [],
    createdAt: row.created_at ?? '',
    predictionVersion: row.prediction_version ?? undefined,
    predictedHomeGoals: row.predicted_home_goals != null ? Number(row.predicted_home_goals) : undefined,
    predictedAwayGoals: row.predicted_away_goals != null ? Number(row.predicted_away_goals) : undefined,
    correctScore: row.correct_score ?? undefined,
    cornersOverUnder: row.corners_over_under ?? undefined,
    cornersLine: row.corners_line != null ? Number(row.corners_line) : undefined,
    cardsTotal: row.cards_total != null ? Number(row.cards_total) : undefined,
    cardsOverUnder: row.cards_over_under ?? undefined,
    asianHandicapLine: row.asian_handicap_line != null ? Number(row.asian_handicap_line) : undefined,
    asianHandicapPick: row.asian_handicap_pick ?? undefined,
    htResult: row.ht_result ?? undefined,
    htHomeProb: row.ht_home_prob != null ? Number(row.ht_home_prob) : undefined,
    htDrawProb: row.ht_draw_prob != null ? Number(row.ht_draw_prob) : undefined,
    htAwayProb: row.ht_away_prob != null ? Number(row.ht_away_prob) : undefined,
    cleanSheetHome: row.clean_sheet_home ?? undefined,
    cleanSheetAway: row.clean_sheet_away ?? undefined,
    firstGoal: row.first_goal ?? undefined,
    bothScoreHt: row.both_score_ht ?? undefined,
    anytimeScorecast: row.anytime_scorecast ?? undefined,
    riskLevel: row.risk_level ?? undefined,
    valueScore: row.value_score != null ? Number(row.value_score) : undefined,
    marketEdgePct: row.market_edge_pct != null ? Number(row.market_edge_pct) : undefined,
    sharpSignal: row.sharp_signal ?? undefined,
    suggestedStake: row.suggested_stake ?? undefined,
    keyAlphaMetric: row.key_alpha_metric ?? undefined,
    warningFlags: Array.isArray(row.warning_flags) ? row.warning_flags : [],
  };
}

function rowToExpertTip(row: Record<string, any>): ExpertTip {
  return {
    id: row.id, expertName: row.expert_name ?? '',
    sport: row.sport ?? 'football', matchLabel: row.match_label ?? '',
    tipType: row.tip_type ?? '', tipValue: row.tip_value ?? '',
    odds: row.odds ? Number(row.odds) : null,
    confidence: Number(row.confidence ?? 70),
    status: row.status ?? 'pending', league: row.league ?? null,
    isPremium: row.is_premium ?? false, createdAt: row.created_at ?? '',
  };
}

function rowToHighlight(row: Record<string, any>): HighlightItem {
  return {
    id: row.id, title: row.title ?? '', sport: row.sport ?? 'football',
    embedUrl: row.embed_url ?? null, thumbnailUrl: row.thumbnail ?? null,
    homeTeam: row.home_team ?? null, awayTeam: row.away_team ?? null,
    league: row.league ?? null, eventDate: row.event_date ?? null,
    createdAt: row.created_at ?? '',
  };
}

function rowToNews(row: Record<string, any>): NewsArticle {
  return {
    id: row.id, externalId: row.external_id ?? '',
    source: row.source ?? 'unknown', sport: row.sport ?? 'football',
    title: row.title ?? '', summary: row.summary ?? null,
    author: row.author ?? null, url: row.url ?? null,
    imageUrl: row.image_url ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category ?? 'news',
    homeTeam: row.home_team ?? null, awayTeam: row.away_team ?? null,
    league: row.league ?? null,
    publishedAt: row.published_at ?? row.created_at ?? '',
    createdAt: row.created_at ?? '',
  };
}

// ─── AsyncStorage helpers ──────────────────────────────────────────────────
async function readCache<T>(key: string): Promise<{ data: T | null; ts: number }> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return { data: null, ts: 0 };
    const parsed = JSON.parse(raw);
    return { data: parsed.data ?? null, ts: parsed.ts ?? 0 };
  } catch { return { data: null, ts: 0 }; }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* non-blocking */ }
}

async function loadTimestamps(): Promise<void> {
  try {
    const { data } = await readCache<Record<string, number>>(CACHE_BASE.TIMESTAMPS);
    if (data) Object.assign(memCache.timestamps, data);
  } catch { /* ignore */ }
}

async function saveTimestamp(section: string): Promise<void> {
  memCache.timestamps[section] = Date.now();
  try {
    await AsyncStorage.setItem(
      CACHE_BASE.TIMESTAMPS,
      JSON.stringify({ data: memCache.timestamps, ts: Date.now() }),
    );
  } catch { /* non-blocking */ }
}

// ─── Freshness helpers ──────────────────────────────────────────────────────
function isFresh(section: string, thresholdMs: number): boolean {
  const ts = memCache.timestamps[section] ?? 0;
  return Date.now() - ts < thresholdMs;
}

function buildSectionMeta(
  data: any[],
  section: string,
  thresholdMs: number,
  source?: 'live' | 'cached' | 'historical',
  provider?: string,
): FeedSectionMeta {
  const ts = memCache.timestamps[section] ?? 0;
  const isStale = Date.now() - ts > thresholdMs;
  const lastUpdated = ts > 0 ? new Date(ts).toISOString() : null;
  return {
    lastUpdated,
    source: source ?? (data.length > 0 ? (isStale ? 'cached' : 'live') : 'empty'),
    recordCount: data.length,
    isStale,
    provider,
  };
}

// ─── Live Matches — 3-tier strategy ────────────────────────────────────────
async function queryLiveMatches(
  sportKey: string | null,
): Promise<{ data: Match[]; source: 'live' | 'cached' | 'historical' | 'empty'; provider: string }> {
  const section = 'live';
  const ck = cacheKey(CACHE_BASE.LIVE_MATCHES, sportKey);

  // Tier 0: Firebase RTDB (fastest, ~12s)
  if (isFirebaseConfigured()) {
    try {
      const { data: fbData, source: fbSource } = await fetchFirebaseLiveScores(sportKey);
      if (fbSource === 'firebase' && fbData.length > 0) {
        await writeCache(ck, fbData);
        await saveTimestamp(section);
        return { data: fbData, source: 'live', provider: 'firebase' };
      }
    } catch { /* fast-path unavailable */ }
  }

  // Tier 1: Supabase DB
  try {
    const supabase = getSupabaseClient();
    let q = supabase.from('matches').select('*').eq('status', 'live')
      .order('minute', { ascending: false }).limit(30);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    const matches = ((data ?? []) as Record<string, any>[]).map(rowToMatch);
    await writeCache(ck, matches);
    await saveTimestamp(section);
    return { data: matches, source: 'live', provider: 'supabase' };
  } catch {
    // Tier 2: AsyncStorage
    const { data: cached } = await readCache<Match[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached', provider: 'cache' };
    return { data: [], source: 'empty', provider: 'none' };
  }
}

// ─── Upcoming Matches ──────────────────────────────────────────────────────
async function queryUpcomingMatches(
  sportKey: string | null,
): Promise<{ data: Match[]; source: 'live' | 'cached' | 'historical' | 'empty'; provider: string }> {
  const section = 'upcoming';
  const ck = cacheKey(CACHE_BASE.UPCOMING, sportKey);

  if (isFresh(section, FRESHNESS.UPCOMING)) {
    const { data: mem } = await readCache<Match[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached', provider: 'cache' };
  }

  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const plus7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let q = supabase.from('matches').select('*')
      .eq('status', 'upcoming')
      .gte('match_time', now).lte('match_time', plus7d)
      .order('match_time', { ascending: true }).limit(60);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    const matches = ((data ?? []) as Record<string, any>[]).map(rowToMatch);
    await writeCache(ck, matches);
    await saveTimestamp(section);
    return { data: matches, source: 'live', provider: 'supabase' };
  } catch {
    const { data: cached } = await readCache<Match[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached', provider: 'cache' };
    return { data: [], source: 'empty', provider: 'none' };
  }
}

// ─── Recent Matches — 48h → 7d historical fallback ─────────────────────────
async function queryRecentMatches(
  sportKey: string | null,
): Promise<{ data: Match[]; source: 'live' | 'cached' | 'historical' | 'empty'; provider: string }> {
  const section = 'recent';
  const ck = cacheKey(CACHE_BASE.RECENT, sportKey);

  if (isFresh(section, FRESHNESS.RECENT)) {
    const { data: mem } = await readCache<Match[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached', provider: 'cache' };
  }

  try {
    const supabase = getSupabaseClient();
    const minus48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    let q = supabase.from('matches').select('*')
      .eq('status', 'finished').gte('match_time', minus48h)
      .order('match_time', { ascending: false }).limit(20);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    const matches = ((data ?? []) as Record<string, any>[]).map(rowToMatch);

    // Historical fallback: expand to 7 days if nothing in 48h
    if (matches.length === 0) {
      const minus7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let hq = supabase.from('matches').select('*')
        .eq('status', 'finished').gte('match_time', minus7d)
        .order('match_time', { ascending: false }).limit(20);
      if (sportKey) hq = hq.eq('sport', sportKey);
      const { data: hData } = await hq;
      const hMatches = ((hData ?? []) as Record<string, any>[]).map(rowToMatch);
      if (hMatches.length > 0) {
        await writeCache(ck, hMatches);
        await saveTimestamp(section);
        return { data: hMatches, source: 'historical', provider: 'supabase' };
      }
    }

    await writeCache(ck, matches);
    await saveTimestamp(section);
    return { data: matches, source: matches.length > 0 ? 'live' : 'empty', provider: 'supabase' };
  } catch {
    const { data: cached } = await readCache<Match[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached', provider: 'cache' };
    return { data: [], source: 'empty', provider: 'none' };
  }
}

// ─── Predictions ────────────────────────────────────────────────────────────
async function queryPredictions(): Promise<{ data: Prediction[]; source: 'live' | 'cached' | 'historical' | 'empty' }> {
  const section = 'predictions';
  const ck = CACHE_BASE.PREDICTIONS;

  if (isFresh(section, FRESHNESS.PREDICTIONS)) {
    const { data: mem } = await readCache<Prediction[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached' };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('predictions')
      .select('*').gte('confidence', 55)
      .order('confidence', { ascending: false }).limit(20);
    if (error) throw error;
    const preds = ((data ?? []) as Record<string, any>[]).map(rowToPrediction);

    if (preds.length === 0) {
      const { data: historical } = await supabase.from('predictions').select('*')
        .order('created_at', { ascending: false }).limit(20);
      const hPreds = ((historical ?? []) as Record<string, any>[]).map(rowToPrediction);
      if (hPreds.length > 0) {
        await writeCache(ck, hPreds);
        await saveTimestamp(section);
        return { data: hPreds, source: 'historical' };
      }
    }

    await writeCache(ck, preds);
    await saveTimestamp(section);
    return { data: preds, source: preds.length > 0 ? 'live' : 'empty' };
  } catch {
    const { data: cached } = await readCache<Prediction[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached' };
    return { data: [], source: 'empty' };
  }
}

// ─── Expert Tips ────────────────────────────────────────────────────────────
async function queryExpertTips(
  isVip: boolean,
): Promise<{ data: ExpertTip[]; source: 'live' | 'cached' | 'historical' | 'empty' }> {
  const section = 'tips';
  const ck = CACHE_BASE.EXPERT_TIPS;

  if (isFresh(section, FRESHNESS.EXPERT_TIPS)) {
    const { data: mem } = await readCache<ExpertTip[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached' };
  }

  try {
    const supabase = getSupabaseClient();
    let q = supabase.from('expert_tips')
      .select('id, expert_name, sport, match_label, tip_type, tip_value, odds, confidence, status, league, is_premium, created_at')
      .order('created_at', { ascending: false }).limit(15);
    if (!isVip) q = q.eq('is_premium', false);
    const { data, error } = await q;
    if (error) throw error;
    const tips = ((data ?? []) as Record<string, any>[]).map(rowToExpertTip);
    await writeCache(ck, tips);
    await saveTimestamp(section);
    return { data: tips, source: tips.length > 0 ? 'live' : 'empty' };
  } catch {
    const { data: cached } = await readCache<ExpertTip[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached' };
    return { data: [], source: 'empty' };
  }
}

// ─── Highlights ─────────────────────────────────────────────────────────────
async function queryHighlights(): Promise<{ data: HighlightItem[]; source: 'live' | 'cached' | 'historical' | 'empty' }> {
  const section = 'highlights';
  const ck = CACHE_BASE.HIGHLIGHTS;

  if (isFresh(section, FRESHNESS.HIGHLIGHTS)) {
    const { data: mem } = await readCache<HighlightItem[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached' };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('highlights')
      .select('id, title, sport, embed_url, thumbnail, home_team, away_team, league, event_date, created_at')
      .order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    const highlights = ((data ?? []) as Record<string, any>[]).map(rowToHighlight);
    await writeCache(ck, highlights);
    await saveTimestamp(section);
    return { data: highlights, source: highlights.length > 0 ? 'live' : 'empty' };
  } catch {
    const { data: cached } = await readCache<HighlightItem[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached' };
    return { data: [], source: 'empty' };
  }
}

// ─── News ───────────────────────────────────────────────────────────────────
async function queryNews(
  sportKey: string | null,
): Promise<{ data: NewsArticle[]; source: 'live' | 'cached' | 'historical' | 'empty' }> {
  const section = 'news';
  const ck = cacheKey(CACHE_BASE.NEWS, sportKey);

  if (isFresh(section, FRESHNESS.NEWS)) {
    const { data: mem } = await readCache<NewsArticle[]>(ck);
    if (mem && mem.length > 0) return { data: mem, source: 'cached' };
  }

  try {
    const supabase = getSupabaseClient();
    const SELECT_COLS = 'id, external_id, source, sport, title, summary, author, url, image_url, tags, category, home_team, away_team, league, published_at, created_at';
    let q = supabase.from('news_articles')
      .select(SELECT_COLS)
      .order('published_at', { ascending: false }).limit(20);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    const news = ((data ?? []) as Record<string, any>[]).map(rowToNews);

    // Historical fallback: expand to 30 days and remove sport filter if nothing found
    if (news.length === 0) {
      let hq = supabase.from('news_articles')
        .select(SELECT_COLS)
        .order('published_at', { ascending: false }).limit(20);
      // Don't filter by sport for historical fallback — show any recent news
      const { data: hData } = await hq;
      const hNews = ((hData ?? []) as Record<string, any>[]).map(rowToNews);
      if (hNews.length > 0) {
        await writeCache(ck, hNews);
        await saveTimestamp(section);
        return { data: hNews, source: 'historical' };
      }
    }

    await writeCache(ck, news);
    await saveTimestamp(section);
    return { data: news, source: news.length > 0 ? 'live' : 'empty' };
  } catch {
    const { data: cached } = await readCache<NewsArticle[]>(ck);
    if (cached && cached.length > 0) return { data: cached, source: 'cached' };
    return { data: [], source: 'empty' };
  }
}

// ─── Trending Leagues ──────────────────────────────────────────────────────
async function queryTrendingLeagues(sportKey: string | null): Promise<TrendingLeague[]> {
  try {
    const supabase = getSupabaseClient();
    const minus12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const plus48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    let q = supabase.from('matches').select('league, sport, status, league_logo')
      .gte('match_time', minus12h).lte('match_time', plus48h).limit(300);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data } = await q;
    const leagueMap = new Map<string, TrendingLeague>();
    for (const m of (data ?? [])) {
      if (!m.league) continue;
      if (!leagueMap.has(m.league)) {
        leagueMap.set(m.league, {
          leagueName: m.league, sport: m.sport ?? 'football',
          matchCount: 0, liveCount: 0, leagueLogo: m.league_logo ?? null,
        });
      }
      const entry = leagueMap.get(m.league)!;
      entry.matchCount++;
      if (m.status === 'live') entry.liveCount++;
    }
    return [...leagueMap.values()]
      .sort((a, b) => b.liveCount - a.liveCount || b.matchCount - a.matchCount)
      .slice(0, 8);
  } catch { return []; }
}

// ─── API Health & DB Stats (admin) ─────────────────────────────────────────
export interface ProviderHealth {
  name: string;
  label: string;
  lastCalled: string | null;
  successRate: number;
  recentErrors: number;
  totalRequests: number;
  isHealthy: boolean;
  lastError: string | null;
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  try {
    const supabase = getSupabaseClient();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data } = await supabase.from('api_usage')
      .select('provider_name, request_count, success_count, error_count, last_called, last_error')
      .gte('date', since);
    if (!data || data.length === 0) return [];
    const byProvider: Record<string, { req: number; ok: number; err: number; lastCalled: string; lastError: string | null }> = {};
    for (const row of data) {
      const p = row.provider_name;
      if (!byProvider[p]) byProvider[p] = { req: 0, ok: 0, err: 0, lastCalled: row.last_called ?? '', lastError: null };
      byProvider[p].req += row.request_count ?? 0;
      byProvider[p].ok += row.success_count ?? 0;
      byProvider[p].err += row.error_count ?? 0;
      if (row.last_called > byProvider[p].lastCalled) byProvider[p].lastCalled = row.last_called;
      if (row.last_error) byProvider[p].lastError = row.last_error;
    }
    const LABELS: Record<string, string> = {
      'api-football': 'API-Football', 'api-sports': 'API-Sports',
      'thesportsdb': 'TheSportsDB',
    };
    return Object.entries(byProvider).map(([name, stats]) => {
      const rate = stats.req > 0 ? Math.round((stats.ok / stats.req) * 100) : 0;
      return {
        name, label: LABELS[name] ?? name,
        lastCalled: stats.lastCalled || null,
        successRate: rate, recentErrors: stats.err,
        totalRequests: stats.req,
        isHealthy: rate >= 70 && stats.err < 10,
        lastError: stats.lastError,
      };
    });
  } catch { return []; }
}

export interface TableStat {
  table: string; label: string; count: number; icon: string; color: string;
}

export async function getDbTableStats(): Promise<TableStat[]> {
  try {
    const supabase = getSupabaseClient();
    const tables = [
      { key: 'matches',          label: 'Matches',      icon: 'football-outline',    color: '#3B82F6' },
      { key: 'predictions',      label: 'Predictions',  icon: 'brain-outline',       color: '#8B5CF6' },
      { key: 'expert_tips',      label: 'Expert Tips',  icon: 'bulb-outline',        color: '#F59E0B' },
      { key: 'odds',             label: 'Odds',         icon: 'trending-up-outline', color: '#22C55E' },
      { key: 'highlights',       label: 'Highlights',   icon: 'videocam-outline',    color: '#EC4899' },
      { key: 'news_articles',    label: 'News',         icon: 'newspaper-outline',   color: '#14B8A6' },
      { key: 'league_standings', label: 'Standings',    icon: 'podium-outline',      color: '#14B8A6' },
      { key: 'match_events',     label: 'Match Events', icon: 'flash-outline',       color: '#EF4444' },
      { key: 'player_stats',     label: 'Player Stats', icon: 'stats-chart-outline', color: '#6366F1' },
    ];
    const results = await Promise.allSettled(
      tables.map((t) => supabase.from(t.key).select('id', { count: 'exact', head: true })),
    );
    return tables.map((t, i) => ({
      table: t.key, label: t.label,
      count: results[i].status === 'fulfilled' ? (results[i] as any).value.count ?? 0 : 0,
      icon: t.icon, color: t.color,
    }));
  } catch { return []; }
}

export function getLastUpdatedLabel(isoOrNull: string | null): string {
  if (!isoOrNull) return 'Never';
  const diff = Date.now() - new Date(isoOrNull).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'Just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

let _initialized = false;

export async function initFeedEngine(): Promise<void> {
  if (_initialized) return;
  _initialized = true;
  await loadTimestamps();
}

// ─── Main public API ────────────────────────────────────────────────────────

/**
 * loadUnifiedFeed — Main entry point.
 * Sport-scoped so Basketball/Tennis/etc. never return Football's cached data.
 */
export async function loadUnifiedFeed(opts: {
  forceRefresh?: boolean;
  sport?: string;
  isVip?: boolean;
  onPartialUpdate?: (partial: Partial<UnifiedFeed>) => void;
} = {}): Promise<UnifiedFeed> {
  const { forceRefresh = false, sport, isVip = false } = opts;
  // Normalize: 'American Football' → 'american-football', 'All' → null
  const sportKey = normalizeSportKey(sport);
  const cacheSlot = sportKey ?? '__all__';

  // L1 cache hit — sport-scoped
  const existing = memCache.feeds[cacheSlot];
  if (!forceRefresh && existing && Date.now() - existing.ts < FRESHNESS.LIVE) {
    return existing.feed;
  }

  // Query all sections in parallel, passing normalized sport key
  const [liveRes, upcomingRes, recentRes, predictionsRes, tipsRes, highlightsRes, newsRes, trendingRes] =
    await Promise.all([
      queryLiveMatches(sportKey),
      queryUpcomingMatches(sportKey),
      queryRecentMatches(sportKey),
      queryPredictions(),
      queryExpertTips(isVip),
      queryHighlights(),
      queryNews(sportKey),
      queryTrendingLeagues(sportKey),
    ]);

  const featuredMatches = [
    ...liveRes.data.slice(0, 1),
    ...(liveRes.data.length === 0 ? upcomingRes.data.slice(0, 1) : []),
  ];

  const now = new Date().toISOString();
  const feed: UnifiedFeed = {
    liveMatches: liveRes.data,
    upcomingMatches: upcomingRes.data,
    recentMatches: recentRes.data,
    featuredMatches,
    predictions: predictionsRes.data,
    expertTips: tipsRes.data,
    highlights: highlightsRes.data,
    news: newsRes.data,
    trendingLeagues: trendingRes,
    meta: {
      liveSection:        buildSectionMeta(liveRes.data, 'live', FRESHNESS.LIVE, liveRes.source as any, liveRes.provider),
      upcomingSection:    buildSectionMeta(upcomingRes.data, 'upcoming', FRESHNESS.UPCOMING, upcomingRes.source as any, upcomingRes.provider),
      recentSection:      buildSectionMeta(recentRes.data, 'recent', FRESHNESS.RECENT, recentRes.source as any, recentRes.provider),
      predictionsSection: buildSectionMeta(predictionsRes.data, 'predictions', FRESHNESS.PREDICTIONS, predictionsRes.source as any),
      tipsSection:        buildSectionMeta(tipsRes.data, 'tips', FRESHNESS.EXPERT_TIPS, tipsRes.source as any),
      highlightsSection:  buildSectionMeta(highlightsRes.data, 'highlights', FRESHNESS.HIGHLIGHTS, highlightsRes.source as any),
      newsSection:        buildSectionMeta(newsRes.data, 'news', FRESHNESS.NEWS, newsRes.source as any),
      generatedAt: now,
      isFullyStale: [liveRes, upcomingRes, recentRes, predictionsRes].every((r) => (r as any).source !== 'live'),
      hasAnyData: (liveRes.data.length + upcomingRes.data.length + recentRes.data.length) > 0,
      offlineMode: [liveRes, upcomingRes, recentRes].every((r) => (r as any).source === 'cached' || (r as any).source === 'empty'),
    },
  };

  // Store in sport-scoped L1 cache slot
  memCache.feeds[cacheSlot] = { feed, ts: Date.now() };

  return feed;
}

/**
 * pollLiveFeed — Lightweight live-only update.
 */
export async function pollLiveFeed(sport?: string): Promise<Match[]> {
  const sportKey = normalizeSportKey(sport);
  const { data } = await queryLiveMatches(sportKey);

  const cacheSlot = sportKey ?? '__all__';
  const existing = memCache.feeds[cacheSlot];
  if (existing) {
    memCache.feeds[cacheSlot] = {
      feed: {
        ...existing.feed,
        liveMatches: data,
        featuredMatches: data.length > 0 ? data.slice(0, 1) : existing.feed.upcomingMatches.slice(0, 1),
        meta: {
          ...existing.feed.meta,
          liveSection: buildSectionMeta(data, 'live', FRESHNESS.LIVE, 'live'),
        },
      },
      ts: existing.ts,
    };
  }

  return data;
}

/**
 * invalidateFeedCache — Force full refresh on next loadUnifiedFeed call.
 */
export function invalidateFeedCache(): void {
  memCache.feeds = {};
  Object.keys(memCache.timestamps).forEach((k) => { memCache.timestamps[k] = 0; });
}

/**
 * clearAllFeedCaches — Wipes L1 + L2 caches (admin use).
 */
export async function clearAllFeedCaches(): Promise<void> {
  invalidateFeedCache();
  await Promise.allSettled(Object.values(CACHE_BASE).map((k) => AsyncStorage.removeItem(k)));
}

/**
 * getFeedTimestamps — Returns per-section last-updated times for UI display.
 */
export function getFeedTimestamps(): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [section, ts] of Object.entries(memCache.timestamps)) {
    result[section] = ts > 0 ? new Date(ts).toISOString() : null;
  }
  return result;
}
