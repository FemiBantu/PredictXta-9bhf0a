/**
 * useFeed — Unified Home Feed Hook (v3 — feedEngine-backed, news-aware)
 *
 * Architecture:
 * - feedEngine.ts: 4-layer caching (L0 Firebase → L1 memory → L2 AsyncStorage → L3 Supabase DB)
 * - NEVER calls external APIs directly — only reads Supabase DB
 * - Always serves data: live → cached → historical fallback
 * - Exposes per-section "last updated" timestamps
 * - News + highlights included alongside match data
 * - Offline mode detection and graceful degradation
 * - Realtime simulation via polling (30s live, 5min upcoming, AppState foreground trigger)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  loadUnifiedFeed,
  pollLiveFeed,
  invalidateFeedCache,
  initFeedEngine,
  type UnifiedFeed,
  type NewsArticle,
  EMPTY_UNIFIED_FEED,
} from '@/services/feedEngine';
import {
  triggerLiveSync,
  triggerFixtureSync,
  triggerOddsSync,
  triggerStandingsSync,
  triggerHighlightsSync,
  type FeedData,
  type NewsArticleItem,
  EMPTY_FEED,
  fetchLiveFeedFromDB,
  fetchUpcomingMatchesFromDB,
  fetchRecentlyFinishedFromDB,
} from '@/services/feedService';
import type { Match } from '@/services/types';
import { SPORT_API_KEY } from '@/constants/theme';

// Normalize UI sport label to DB key for edge function calls
function toDbSportKey(sport: string): string {
  if (sport === 'all' || sport === 'All') return 'all';
  return SPORT_API_KEY[sport] ?? sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Polling intervals ──────────────────────────────────────────────────────
const LIVE_POLL_MS      = 30_000;
const LIVE_SYNC_MS      = 45_000;
const FIXTURE_SYNC_MS   = 60 * 60_000;
const ODDS_SYNC_MS      = 5 * 60_000;
const STANDINGS_SYNC_MS = 6 * 60 * 60_000;
const NEWS_SYNC_MS      = 20 * 60_000;  // 20 min
const HIGHLIGHTS_SYNC_MS = 30 * 60_000; // 30 min

// ─── Module-level sync state ────────────────────────────────────────────────
const syncState = {
  lastFixtureSync: 0,
  lastOddsSync: 0,
  lastStandingsSync: 0,
  lastLiveSync: 0,
  lastNewsSync: 0,
  lastHighlightsSync: 0,
  engineInit: false,
};

export interface UseFeedOptions {
  sport?: string;
  isVip?: boolean;
  userId?: string;
  enabled?: boolean;
}

export interface UseFeedResult {
  unifiedFeed: UnifiedFeed;
  feed: FeedData;
  liveMatches: Match[];
  news: NewsArticle[];
  loading: boolean;
  refreshing: boolean;
  syncing: boolean;
  isOffline: boolean;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

// Silence unused import warning — NewsArticleItem is used via FeedData
type _NewsArticleItem = NewsArticleItem;

export function useFeed(opts: UseFeedOptions = {}): UseFeedResult {
  const { sport = 'all', isVip = false, enabled = true } = opts;

  const [unifiedFeed, setUnifiedFeed] = useState<UnifiedFeed>(EMPTY_UNIFIED_FEED);
  const [feed, setFeed]               = useState<FeedData>(EMPTY_FEED);
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [news, setNews]               = useState<NewsArticle[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [isOffline, setIsOffline]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const sportRef  = useRef(sport);
  sportRef.current = sport;
  const isVipRef  = useRef(isVip);
  isVipRef.current = isVip;

  // ─── Map UnifiedFeed → legacy FeedData shape ───────────────────────────
  const mapToLegacyFeed = useCallback((uf: UnifiedFeed): FeedData => ({
    featuredMatches: uf.featuredMatches,
    liveMatches: uf.liveMatches,
    upcomingMatches: uf.upcomingMatches,
    recentMatches: uf.recentMatches,
    predictions: uf.predictions,
    vipPredictions: uf.predictions.filter((p) => (p.confidence ?? 0) >= 80),
    expertTips: uf.expertTips.map((t) => ({
      id: t.id, expertName: t.expertName, sport: t.sport,
      matchLabel: t.matchLabel, tipType: t.tipType, tipValue: t.tipValue,
      odds: t.odds, confidence: t.confidence, status: t.status,
      league: t.league, isPremium: t.isPremium, createdAt: t.createdAt,
    })),
    trendingLeagues: uf.trendingLeagues,
    highConfidenceTips: uf.expertTips
      .filter((t) => (t.confidence ?? 0) >= 85).slice(0, 5).map((t) => ({
        id: t.id, expertName: t.expertName, sport: t.sport,
        matchLabel: t.matchLabel, tipType: t.tipType, tipValue: t.tipValue,
        odds: t.odds, confidence: t.confidence, status: t.status,
        league: t.league, isPremium: t.isPremium, createdAt: t.createdAt,
      })),
    highlights: uf.highlights,
    personalisation: { followedLeagues: [], hasPersonalisation: false },
    feedMeta: {
      generatedAt: uf.meta.generatedAt,
      liveCount: uf.liveMatches.length,
      upcomingCount: uf.upcomingMatches.length,
      predictionsCount: uf.predictions.length,
      fromCache: uf.meta.offlineMode,
      error: uf.meta.isFullyStale && !uf.meta.hasAnyData,
    },
  }), []);

  // ─── Initial load ────────────────────────────────────────────────────────
  const loadInitial = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;

    if (!syncState.engineInit) {
      syncState.engineInit = true;
      await initFeedEngine();
    }

    // Seed from DB immediately (instant first render)
    const [liveNow] = await Promise.allSettled([fetchLiveFeedFromDB()]);
    if (liveNow.status === 'fulfilled' && liveNow.value.length > 0) {
      setLiveMatches(liveNow.value);
    }

    const uf = await loadUnifiedFeed({
      forceRefresh,
      sport: sportRef.current,
      isVip: isVipRef.current,
    });

    // Merge live seed data into unified feed
    const merged = liveNow.status === 'fulfilled' && liveNow.value.length > 0
      ? { ...uf, liveMatches: liveNow.value }
      : uf;

    setUnifiedFeed(merged);
    setFeed(mapToLegacyFeed(merged));
    setLiveMatches(merged.liveMatches);
    setNews(merged.news);
    setIsOffline(merged.meta.offlineMode);
    if (!merged.meta.isFullyStale) setLastUpdated(new Date());
  }, [enabled, mapToLegacyFeed]);

  useEffect(() => {
    setLoading(true);
    loadInitial().finally(() => setLoading(false));
  }, [loadInitial]);

  // ─── 30s live polling ───────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const live = await pollLiveFeed(sportRef.current);
      setLiveMatches(live);
      setUnifiedFeed((prev) => {
        const next = {
          ...prev, liveMatches: live,
          featuredMatches: live.length > 0 ? live.slice(0, 1) : prev.featuredMatches,
        };
        setFeed(mapToLegacyFeed(next));
        return next;
      });
    }, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, mapToLegacyFeed]);

  // ─── 45s live edge-fn sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastLiveSync < LIVE_SYNC_MS - 5000) return;
      syncState.lastLiveSync = now;
      try {
        await triggerLiveSync(true);
        const live = await pollLiveFeed(sportRef.current);
        setLiveMatches(live);
        setUnifiedFeed((prev) => {
          const next = { ...prev, liveMatches: live };
          setFeed(mapToLegacyFeed(next));
          return next;
        });
      } catch { /* non-blocking */ }
    }, LIVE_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled, mapToLegacyFeed]);

  // ─── 1hr fixture sync ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastFixtureSync < FIXTURE_SYNC_MS - 5000) return;
      syncState.lastFixtureSync = now;
      setSyncing(true);
      try {
        await triggerFixtureSync(toDbSportKey(sportRef.current));
        invalidateFeedCache();
        await loadInitial(true);
        setLastUpdated(new Date());
      } catch { /* non-blocking */ }
      setSyncing(false);
    }, FIXTURE_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled, loadInitial]);

  // ─── 5min odds sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastOddsSync < ODDS_SYNC_MS - 5000) return;
      syncState.lastOddsSync = now;
      try { await triggerOddsSync(); } catch { /* non-blocking */ }
    }, ODDS_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  // ─── 6hr standings sync ─────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastStandingsSync < STANDINGS_SYNC_MS - 5000) return;
      syncState.lastStandingsSync = now;
      try { await triggerStandingsSync(false); } catch { /* non-blocking */ }
    }, STANDINGS_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  // ─── 30min highlights sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastHighlightsSync < HIGHLIGHTS_SYNC_MS - 5000) return;
      syncState.lastHighlightsSync = now;
      try {
        await triggerHighlightsSync(20);
        invalidateFeedCache();
        const uf = await loadUnifiedFeed({ sport: sportRef.current, isVip: isVipRef.current });
        setUnifiedFeed(uf);
        setFeed(mapToLegacyFeed(uf));
      } catch { /* non-blocking */ }
    }, HIGHLIGHTS_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled, mapToLegacyFeed]);

  // ─── 20min news sync ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      if (now - syncState.lastNewsSync < NEWS_SYNC_MS - 5000) return;
      syncState.lastNewsSync = now;
      try {
        const supabase = (await import('@/template')).getSupabaseClient();
        await supabase.functions.invoke('sync-news', {
          body: { sports: ['football', 'basketball', 'tennis', 'cricket', 'hockey', 'rugby', 'mma'], limit: 20 },
        });
        invalidateFeedCache();
        const uf = await loadUnifiedFeed({ sport: sportRef.current, isVip: isVipRef.current });
        setUnifiedFeed(uf);
        setFeed(mapToLegacyFeed(uf));
        setNews(uf.news);
      } catch { /* non-blocking */ }
    }, NEWS_SYNC_MS);
    return () => clearInterval(interval);
  }, [enabled, mapToLegacyFeed]);

  // ─── Re-sync on app foreground ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const handler = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        syncState.lastFixtureSync = 0;
        syncState.lastLiveSync = 0;
        invalidateFeedCache();
        loadInitial(true);
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [enabled, loadInitial]);

  // ─── Manual refresh ─────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setRefreshing(true);
    syncState.lastFixtureSync = 0;
    syncState.lastLiveSync = 0;
    syncState.lastNewsSync = 0;
    syncState.lastHighlightsSync = 0;
    invalidateFeedCache();
    try {
      await Promise.allSettled([
        triggerFixtureSync(toDbSportKey(sportRef.current)),
        triggerLiveSync(false),
      ]);
      await loadInitial(true);
      setLastUpdated(new Date());
      setIsOffline(false);
    } catch {
      setIsOffline(true);
    }
    setRefreshing(false);
  }, [loadInitial]);

  return {
    unifiedFeed, feed, liveMatches, news,
    loading, refreshing, syncing, isOffline, lastUpdated, refresh,
  };
}
