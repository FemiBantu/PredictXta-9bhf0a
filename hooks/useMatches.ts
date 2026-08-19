import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchMatches, fetchLiveMatches, syncMatchesFromApi } from '@/services/matchService';
import { SPORT_API_KEY } from '@/constants/theme';
import { Match } from '@/services/types';

// ─── Normalize sport for DB queries ──────────────────────────────────────────
// DB uses canonical lowercase-hyphenated keys: 'american-football', 'hockey', etc.
// UI uses Title Case: 'American Football', 'Ice Hockey', 'All'
// Only canonical 13 sports are supported — formula1 and afl removed.
function toDbSportKey(sport: string): string {
  if (sport === 'All' || sport === 'all') return 'All';
  // SPORT_API_KEY maps all UI labels correctly, including:
  //   'American Football' → 'american-football'
  //   'Ice Hockey'        → 'hockey'
  const apiKey = SPORT_API_KEY[sport];
  if (apiKey && apiKey !== 'all') return apiKey;
  // Fallback: lowercase + hyphenate spaces
  return sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Logging helpers ──────────────────────────────────────────────────────────
const LOG = __DEV__;
function log(...args: unknown[]) { if (LOG) console.log('[useMatches]', ...args); }
function warn(...args: unknown[]) { console.warn('[useMatches]', ...args); }

// ─── Module-level sync timestamp ─────────────────────────────────────────────
// Persists across hook re-mounts (tab switches) but resets on full app restart.
// Sync is skipped if last successful sync was less than SYNC_STALE_MS ago.
let lastSyncTimestamp = 0;
const SYNC_STALE_MS = 5 * 60 * 1000; // 5 minutes

/** Returns true when enough time has passed that we should re-sync from the API. */
function isSyncStale(): boolean {
  return Date.now() - lastSyncTimestamp > SYNC_STALE_MS;
}

/** Called externally (e.g. StartupSyncManager) to mark a sync as complete. */
export function markSyncComplete() {
  lastSyncTimestamp = Date.now();
}

/** Force the next syncAndLoad call to re-hit the API regardless of the timer. */
export function invalidateSyncCache() {
  lastSyncTimestamp = 0;
}

export function useMatches(initialSport = 'All') {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedSport, setSelectedSport] = useState(initialSport);
  const [refreshing, setRefreshing] = useState(false);

  // Load from DB — pass normalized DB key so fetchMatches applies the correct SQL filter
  const load = useCallback(async (sport: string) => {
    const dbKey = toDbSportKey(sport);
    const data = await fetchMatches(dbKey);
    setMatches(data);
  }, []);

  // Sync from API-Football + TheSportsDB then reload DB.
  // Skipped automatically if data was refreshed within the last 5 minutes.
  const syncAndLoad = useCallback(async (sport: string, force = false) => {
    if (!force && !isSyncStale()) {
      // Data is fresh — just read from DB, skip the edge function call
      log(`Cache fresh, loading from DB only (sport=${sport})`);
      await load(sport);
      return;
    }
    setSyncing(true);
    try {
      // Map UI label → DB/API key for canonical 13 sports
      // SPORT_API_KEY['All'] returns 'all' which is valid for fetch-matches
      const rawKey = SPORT_API_KEY[sport] ?? sport.toLowerCase().replace(/\s+/g, '-');
      // fetch-matches accepts 'all' + any canonical sport key
      const apiSport = rawKey as Parameters<typeof syncMatchesFromApi>[1];
      log(`Syncing from API | sport=${apiSport} force=${force}`);
      const result = await syncMatchesFromApi('today', apiSport);
      if (result) {
        log(`Multi-sport sync OK: fetched=${result.fetched} inserted=${result.inserted}`);
      } else {
        warn('Sync returned null — will use existing DB data');
      }
      markSyncComplete();
    } catch (e) {
      warn('Sync failed, using DB data:', e);
    } finally {
      setSyncing(false);
    }
    await load(sport);
  }, [load]);

  useEffect(() => {
    setLoading(true);
    syncAndLoad(selectedSport).finally(() => setLoading(false));
  }, [selectedSport, syncAndLoad]);

  // Poll live scores every 30 seconds (DB read only — no edge function)
  useEffect(() => {
    const interval = setInterval(() => {
      load(selectedSport);
    }, 30_000);
    return () => clearInterval(interval);
  }, [selectedSport, load]);

  // Re-sync when app returns from background (invalidate cache first)
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        invalidateSyncCache();
        syncAndLoad(selectedSport);
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [selectedSport, syncAndLoad]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncAndLoad(selectedSport, true); // force = true → always hits edge function
    setRefreshing(false);
  }, [selectedSport, syncAndLoad]);

  const liveMatches = matches.filter((m) => m.status === 'live');
  const upcomingMatches = matches.filter((m) => m.status === 'upcoming');
  const finishedMatches = matches.filter((m) => m.status === 'finished');

  return {
    matches,
    liveMatches,
    upcomingMatches,
    finishedMatches,
    loading: loading || syncing,
    refreshing,
    selectedSport,
    setSelectedSport,
    onRefresh,
  };
}

export function useLiveMatches() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLiveMatches().then((data) => {
      setMatches(data);
      setLoading(false);
    });
    // Poll live scores every 30s
    const interval = setInterval(() => {
      fetchLiveMatches().then(setMatches);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return { matches, loading };
}
