/**
 * BackgroundSyncManager.tsx — Production-Grade Background Sync (v2)
 *
 * Manages all background data synchronization for PredictXta:
 * - Feed cache warming on app focus
 * - Live score polling relay
 * - Stale cache invalidation
 * - Health cycle integration
 *
 * Renders nothing — pure side-effect component.
 * Mounted once in app/_layout.tsx inside AuthProvider.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '@/template';
import {
  loadUnifiedFeed,
  invalidateFeedCache,
  initFeedEngine,
} from '@/services/feedEngine';
import { triggerHealthCycle } from '@/services/selfHealingService';

// ─── Intervals ───────────────────────────────────────────────────────────────
const LIVE_POLL_MS      = 30_000;  // 30s live score update
const PREFETCH_DELAY_MS  = 3_000;  // Delay after app focus before prefetch

export default function BackgroundSyncManager() {
  const { user } = useAuth();
  const appStateRef    = useRef<AppStateStatus>(AppState.currentState);
  const liveTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(true);

  // ── Feed initialization (once on mount) ─────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    initFeedEngine().catch(() => {});

    // Warm the football feed immediately
    setTimeout(() => {
      if (!mountedRef.current) return;
      loadUnifiedFeed({ sport: 'Football', isVip: false }).catch(() => {});
    }, 1500);

    return () => {
      mountedRef.current = false;
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  // ── Live score polling ───────────────────────────────────────────────────
  const startLivePolling = useCallback(() => {
    if (liveTimerRef.current) return;
    liveTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      loadUnifiedFeed({ forceRefresh: true }).catch(() => {});
    }, LIVE_POLL_MS);
  }, []);

  const stopLivePolling = useCallback(() => {
    if (!liveTimerRef.current) return;
    clearInterval(liveTimerRef.current);
    liveTimerRef.current = null;
  }, []);

  // ── App state management ─────────────────────────────────────────────────
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active' && prevState !== 'active') {
        // App returned from background — invalidate stale cache and refetch
        if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          invalidateFeedCache();
          loadUnifiedFeed({ forceRefresh: true }).catch(() => {});
          triggerHealthCycle();
        }, PREFETCH_DELAY_MS);
        startLivePolling();
      } else if (nextState === 'background' || nextState === 'inactive') {
        // App going to background — stop live polling to save battery
        stopLivePolling();
        if (prefetchTimerRef.current) {
          clearTimeout(prefetchTimerRef.current);
          prefetchTimerRef.current = null;
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    // Start polling if app is already active when this mounts
    if (AppState.currentState === 'active') startLivePolling();

    return () => {
      sub.remove();
      stopLivePolling();
    };
  }, [startLivePolling, stopLivePolling]);

  // ── User-dependent prefetch (warm VIP feed on login) ─────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      loadUnifiedFeed({ sport: 'Football', isVip: true, forceRefresh: true }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [user?.id]);

  return null;
}
