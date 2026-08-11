
/**
 * usePredictionsFeed.ts
 *
 * React hook for the predictions-feed edge function.
 * Supports:
 *   - Date picker (offset or YYYY-MM-DD)
 *   - Sport filter
 *   - Status filter (all/live/upcoming/finished)
 *   - Sort mode (time/confidence/value)
 *   - Prediction type filters (result, over/under, btts, min_conf)
 *   - Infinite scroll / pagination
 *   - Stale-while-revalidate caching
 *   - VIP data passthrough
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPredictionsFeed,
  invalidatePredictionsFeedCache,
  groupFeedItemsByCountry,
  type PredictionFeedItem,
  type PredictionsFeedPagination,
  type PredictionsFeedMeta,
  type CountryGroup,
  type FeedSortMode,
  type FeedStatusMode,
  type FeedResultMode,
  type FeedOUMode,
  type FeedBTTSMode,
} from '@/services/predictionsFeedService';
import { useAuth } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsePredictionsFeedOptions {
  sport?:      string;
  status?:     FeedStatusMode;
  date?:       string;         // YYYY-MM-DD | 'today' | 'yesterday' | numeric offset string
  sort?:       FeedSortMode;
  minConf?:    number;
  result?:     FeedResultMode;
  ou?:         FeedOUMode;
  btts?:       FeedBTTSMode;
  league?:     string;
  country?:    string;
  limit?:      number;
  autoFetch?:  boolean;        // default true
}

export interface UsePredictionsFeedResult {
  // Data
  items:         PredictionFeedItem[];
  countryGroups: CountryGroup[];
  pagination:    PredictionsFeedPagination | null;
  meta:          PredictionsFeedMeta | null;
  // State
  loading:       boolean;
  refreshing:    boolean;
  loadingMore:   boolean;
  error:         string | null;
  // Actions
  refresh:       () => Promise<void>;
  loadMore:      () => Promise<void>;
  // Feed stats
  liveCount:     number;
  predictedCount: number;
  totalCount:    number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePredictionsFeed(opts: UsePredictionsFeedOptions = {}): UsePredictionsFeedResult {
  const {
    sport = 'all',
    status = 'all',
    date = 'today',
    sort = 'time',
    minConf = 0,
    result = 'all',
    ou = 'all',
    btts = 'all',
    league,
    country,
    limit = 20,
    autoFetch = true,
  } = opts;

  const { user } = useAuth();
  // VIP status is intentionally kept as false here since predictions-feed
  // is a public read — VIP gating happens at the component level via useAIPicks/useFeed.
  // Full VIP data passthrough is controlled by the isVip param if needed.
  const isVip = false;

  const [items, setItems]             = useState<PredictionFeedItem[]>([]);
  const [pagination, setPagination]   = useState<PredictionsFeedPagination | null>(null);
  const [meta, setMeta]               = useState<PredictionsFeedMeta | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const pageRef                       = useRef(1);
  const isMounted                     = useRef(true);

  // Build stable options fingerprint for change detection
  const optsKey = `${sport}|${status}|${date}|${sort}|${minConf}|${result}|${ou}|${btts}|${league ?? ''}|${country ?? ''}|${limit}`;

  // ── Core fetch ──────────────────────────────────────────────────────────────
  const doFetch = useCallback(async (options: {
    page?: number;
    force?: boolean;
    isRefresh?: boolean;
    append?: boolean;
  } = {}) => {
    const { page = 1, force = false, isRefresh = false, append = false } = options;

    if (!append) {
      isRefresh ? setRefreshing(true) : setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    const feedResult = await fetchPredictionsFeed({
      sport:    sport === 'All' ? 'all' : sport.toLowerCase(),
      status,
      date,
      page,
      limit,
      sort,
      minConf,
      result,
      ou,
      btts,
      league,
      country,
      isVip,
      includeOutcome: true,
      bypassCache: force || isRefresh,
      onFresh: (fresh) => {
        if (!isMounted.current) return;
        if (page === 1) {
          setItems(fresh.items);
          setPagination(fresh.pagination);
          setMeta(fresh.meta);
        }
      },
    });

    if (!isMounted.current) return;

    if (feedResult.error) {
      setError(feedResult.error);
    } else {
      if (append) {
        setItems((prev) => [...prev, ...feedResult.items]);
      } else {
        setItems(feedResult.items);
      }
      setPagination(feedResult.pagination);
      setMeta(feedResult.meta);
      pageRef.current = page;
    }

    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }, [sport, status, date, sort, minConf, result, ou, btts, league, country, limit, isVip]); // isMounted.current should not be in the dependency array

  // ── Initial load + re-fetch when opts change ────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    if (!autoFetch) return;
    pageRef.current = 1;
    setItems([]);
    setPagination(null);
    doFetch({ page: 1 });
    return () => { isMounted.current = false; };
  }, [optsKey, autoFetch, doFetch]);

  // ── Refresh ─────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    pageRef.current = 1;
    await doFetch({ page: 1, force: true, isRefresh: true });
  }, [doFetch]);

  // ── Load more (infinite scroll) ─────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !pagination?.hasNext) return;
    const nextPage = pageRef.current + 1;
    await doFetch({ page: nextPage, append: true });
  }, [loadingMore, loading, pagination, doFetch]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const countryGroups = groupFeedItemsByCountry(items);
  const liveCount      = meta?.liveCount      ?? items.filter((i) => i.status === 'live').length;
  const predictedCount = meta?.predictedCount ?? items.filter((i) => i.hasPrediction).length;
  const totalCount     = pagination?.total    ?? items.length;

  return {
    items,
    countryGroups,
    pagination,
    meta,
    loading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
    liveCount,
    predictedCount,
    totalCount,
  };
}

// ─── Re-export helpers for convenience ───────────────────────────────────────
export { invalidatePredictionsFeedCache };
export type {
  PredictionFeedItem,
  CountryGroup,
  FeedSortMode,
  FeedStatusMode,
  FeedResultMode,
  FeedOUMode,
  FeedBTTSMode,
};
