/**
 * services/realtimeService.ts — Enterprise Realtime Distribution Layer
 *
 * Replaces frontend polling with SSE (Server-Sent Events) for live score updates.
 * Falls back to polling if SSE is unavailable (Expo Go, older Android).
 *
 * Architecture:
 *   Client → SSE Connection → Edge Function → DB polling → Delta broadcast
 *
 * Delta-only updates: only changed fields are transmitted.
 * Example: { matchId, homeScore: 2, awayScore: 1, minute: 67 }
 *
 * Features:
 *  - Auto-reconnect with exponential backoff
 *  - Sport-scoped connections (football, basketball, etc.)
 *  - Listener pattern (subscribe/unsubscribe)
 *  - Polling fallback for unsupported environments
 *  - Battery-efficient: pauses when app is in background
 */

import { Platform } from 'react-native';
import { AppState, AppStateStatus } from 'react-native';
import { getSupabaseClient } from '@/template';
import type { Match } from './types';

// SSE endpoint
const SSE_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/live-scores-sse`;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Polling fallback interval (when SSE unavailable)
const POLL_INTERVAL_MS = 10_000;
const SSE_RECONNECT_BASE_MS = 3_000;
const SSE_MAX_RECONNECT_MS = 60_000;

// ─── Event Types ─────────────────────────────────────────────────────────────
export type RealtimeEventType =
  | 'score-update'
  | 'match-status'
  | 'match-event'
  | 'odds-update'
  | 'heartbeat'
  | 'sync-complete'
  | 'reconnect'
  | 'error';

export interface ScoreUpdate {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  sport: string;
  ts: string;
}

export interface MatchStatusUpdate {
  matchId: string;
  status: 'live' | 'finished' | 'upcoming';
  minute?: number;
  sport: string;
  ts: string;
}

export interface SyncComplete {
  sport: string;
  matchCount: number;
  matches: Array<{
    id: string; sport: string;
    homeTeam: string; awayTeam: string;
    homeScore: number; awayScore: number;
    status: string; minute: number; league: string;
  }>;
  ts: string;
}

export type RealtimeListener<T = unknown> = (data: T) => void;

// ─── Realtime Service (singleton) ────────────────────────────────────────────
class RealtimeService {
  private connections = new Map<string, EventSource | null>();
  private pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private listeners = new Map<string, Map<RealtimeEventType, Set<RealtimeListener>>>();
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private isBackground = false;
  private sseSupported: boolean;

  constructor() {
    // SSE via EventSource is not available in React Native
    // We use fetch-based SSE for native, browser EventSource for web
    this.sseSupported = Platform.OS === 'web' && typeof EventSource !== 'undefined';
    this.setupAppStateListener();
  }

  private setupAppStateListener() {
    AppState.addEventListener('change', (state: AppStateStatus) => {
      this.isBackground = state === 'background' || state === 'inactive';
      if (this.isBackground) {
        // Pause all connections when app goes to background
        this.pauseAllConnections();
      } else {
        // Resume connections when app comes back to foreground
        this.resumeAllConnections();
      }
    });
  }

  // ─── Subscribe ────────────────────────────────────────────────────────────
  subscribe<T = unknown>(
    sport: string,
    eventType: RealtimeEventType,
    listener: RealtimeListener<T>,
  ): () => void {
    const sportKey = sport.toLowerCase().replace(/\s+/g, '-');

    if (!this.listeners.has(sportKey)) {
      this.listeners.set(sportKey, new Map());
    }
    const sportListeners = this.listeners.get(sportKey)!;

    if (!sportListeners.has(eventType)) {
      sportListeners.set(eventType, new Set());
    }
    (sportListeners.get(eventType)! as Set<RealtimeListener<T>>).add(listener as RealtimeListener<T>);

    // Start connection if not already active
    if (!this.connections.has(sportKey) && !this.pollIntervals.has(sportKey)) {
      this.connect(sportKey);
    }

    // Return unsubscribe function
    return () => {
      (sportListeners.get(eventType) as Set<RealtimeListener<T>> | undefined)
        ?.delete(listener as RealtimeListener<T>);
      // Disconnect if no more listeners
      const hasListeners = [...sportListeners.values()].some(s => s.size > 0);
      if (!hasListeners) this.disconnect(sportKey);
    };
  }

  // ─── Connect ──────────────────────────────────────────────────────────────
  private connect(sportKey: string) {
    if (this.isBackground) return;

    if (this.sseSupported) {
      this.connectSSE(sportKey);
    } else {
      // Fallback to polling for React Native
      this.connectPolling(sportKey);
    }
  }

  // ─── SSE Connection (Web only) ────────────────────────────────────────────
  private connectSSE(sportKey: string) {
    try {
      const url = sportKey === 'all'
        ? `${SSE_BASE_URL}`
        : `${SSE_BASE_URL}?sport=${encodeURIComponent(sportKey)}`;

      const es = new EventSource(url);
      this.connections.set(sportKey, es);

      const events: RealtimeEventType[] = [
        'score-update', 'match-status', 'match-event',
        'odds-update', 'heartbeat', 'sync-complete', 'reconnect', 'error',
      ];

      for (const eventType of events) {
        es.addEventListener(eventType, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            this.emit(sportKey, eventType, data);
          } catch { /* parse error */ }
        });
      }

      es.addEventListener('error', () => {
        es.close();
        this.connections.delete(sportKey);
        this.scheduleReconnect(sportKey);
      });

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts.set(sportKey, 0);
    } catch {
      this.connectPolling(sportKey);
    }
  }

  // ─── Polling Fallback (React Native) ─────────────────────────────────────
  private connectPolling(sportKey: string) {
    if (this.pollIntervals.has(sportKey)) return;

    let prevState = new Map<string, {
      homeScore: number; awayScore: number; minute: number; status: string;
    }>();

    const poll = async () => {
      if (this.isBackground) return;
      try {
        const supabase = getSupabaseClient();
        let q = supabase
          .from('matches')
          .select('id, sport, home_team, away_team, home_score, away_score, status, minute, league, last_updated')
          .eq('status', 'live')
          .order('minute', { ascending: false })
          .limit(50);

        if (sportKey !== 'all') q = q.eq('sport', sportKey);

        const { data, error } = await q;
        if (error || !data) return;

        const currentIds = new Set(data.map((m: Record<string, unknown>) => String(m.id)));

        for (const match of data as Record<string, unknown>[]) {
          const id = String(match.id);
          const prev = prevState.get(id);
          const homeScore = Number(match.home_score ?? 0);
          const awayScore = Number(match.away_score ?? 0);
          const minute = Number(match.minute ?? 0);
          const status = String(match.status ?? 'live');

          if (!prev) {
            // First time seeing this match
            this.emit(sportKey, 'sync-complete', {
              sport: sportKey,
              matchCount: 1,
              matches: [{
                id,
                sport: String(match.sport),
                homeTeam: String(match.home_team ?? ''),
                awayTeam: String(match.away_team ?? ''),
                homeScore, awayScore, status, minute,
                league: String(match.league ?? ''),
              }],
              ts: new Date().toISOString(),
            });
          } else {
            if (homeScore !== prev.homeScore || awayScore !== prev.awayScore) {
              this.emit(sportKey, 'score-update', {
                matchId: id, homeScore, awayScore, minute,
                sport: String(match.sport ?? sportKey),
                ts: new Date().toISOString(),
              });
            }
            if (status !== prev.status) {
              this.emit(sportKey, 'match-status', {
                matchId: id, status, minute,
                sport: String(match.sport ?? sportKey),
                ts: new Date().toISOString(),
              });
            }
          }

          prevState.set(id, { homeScore, awayScore, minute, status });
        }

        // Clean up finished matches
        for (const [id, prev] of prevState) {
          if (!currentIds.has(id) && prev.status === 'live') {
            this.emit(sportKey, 'match-status', {
              matchId: id, status: 'finished', sport: sportKey,
              ts: new Date().toISOString(),
            });
            prevState.delete(id);
          }
        }

        // Heartbeat
        this.emit(sportKey, 'heartbeat', {
          ts: new Date().toISOString(),
          liveCount: data.length,
          sport: sportKey,
        });

      } catch { /* poll error */ }
    };

    // Initial poll
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    this.pollIntervals.set(sportKey, interval);
  }

  // ─── Emit event to listeners ──────────────────────────────────────────────
  private emit(sportKey: string, eventType: RealtimeEventType, data: unknown) {
    const sportListeners = this.listeners.get(sportKey);
    if (!sportListeners) return;

    const eventListeners = sportListeners.get(eventType);
    if (!eventListeners) return;

    for (const listener of eventListeners) {
      try { listener(data); } catch { /* listener error */ }
    }

    // Also emit to 'all' subscribers
    if (sportKey !== 'all') {
      this.emit('all', eventType, data);
    }
  }

  // ─── Reconnect with exponential backoff ──────────────────────────────────
  private scheduleReconnect(sportKey: string) {
    const attempts = (this.reconnectAttempts.get(sportKey) ?? 0) + 1;
    this.reconnectAttempts.set(sportKey, attempts);

    const delay = Math.min(
      SSE_RECONNECT_BASE_MS * Math.pow(2, attempts - 1),
      SSE_MAX_RECONNECT_MS,
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(sportKey);
      if (this.listeners.has(sportKey)) {
        this.connect(sportKey);
      }
    }, delay);

    this.reconnectTimers.set(sportKey, timer);
  }

  // ─── Disconnect ──────────────────────────────────────────────────────────
  disconnect(sportKey: string) {
    const es = this.connections.get(sportKey);
    if (es) { es.close(); this.connections.delete(sportKey); }

    const interval = this.pollIntervals.get(sportKey);
    if (interval) { clearInterval(interval); this.pollIntervals.delete(sportKey); }

    const timer = this.reconnectTimers.get(sportKey);
    if (timer) { clearTimeout(timer); this.reconnectTimers.delete(sportKey); }

    this.reconnectAttempts.delete(sportKey);
    this.listeners.delete(sportKey);
  }

  private pauseAllConnections() {
    for (const [sportKey, interval] of this.pollIntervals) {
      clearInterval(interval);
      this.pollIntervals.delete(sportKey);
    }
  }

  private resumeAllConnections() {
    for (const [sportKey] of this.listeners) {
      if (!this.connections.has(sportKey) && !this.pollIntervals.has(sportKey)) {
        this.connect(sportKey);
      }
    }
  }

  disconnectAll() {
    for (const sportKey of [...this.connections.keys(), ...this.pollIntervals.keys()]) {
      this.disconnect(sportKey);
    }
  }
}

// Singleton instance
export const realtimeService = new RealtimeService();

// ─── React Hooks ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useLiveScores — Subscribe to live score updates for a sport.
 * Returns current scores as a Map<matchId, ScoreUpdate>.
 */
export function useLiveScores(sport: string = 'all') {
  const [scores, setScores] = useState<Map<string, ScoreUpdate>>(new Map());
  const [liveCount, setLiveCount] = useState(0);
  const sportKey = sport.toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Initial sync
    unsubs.push(realtimeService.subscribe<SyncComplete>(
      sportKey, 'sync-complete', (data) => {
        const newScores = new Map<string, ScoreUpdate>();
        for (const m of data.matches) {
          newScores.set(m.id, {
            matchId: m.id,
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            minute: m.minute,
            sport: m.sport,
            ts: data.ts,
          });
        }
        setScores(newScores);
        setLiveCount(data.matchCount);
      },
    ));

    // Score updates (delta only)
    unsubs.push(realtimeService.subscribe<ScoreUpdate>(
      sportKey, 'score-update', (update) => {
        setScores(prev => {
          const next = new Map(prev);
          next.set(update.matchId, update);
          return next;
        });
      },
    ));

    // Match status changes (finished, etc.)
    unsubs.push(realtimeService.subscribe<MatchStatusUpdate>(
      sportKey, 'match-status', (update) => {
        if (update.status === 'finished') {
          setScores(prev => {
            const next = new Map(prev);
            next.delete(update.matchId);
            return next;
          });
          setLiveCount(prev => Math.max(0, prev - 1));
        }
      },
    ));

    // Heartbeat for live count
    unsubs.push(realtimeService.subscribe<{ liveCount: number }>(
      sportKey, 'heartbeat', (data) => {
        setLiveCount(data.liveCount);
      },
    ));

    return () => unsubs.forEach(u => u());
  }, [sportKey]);

  return { scores, liveCount };
}

/**
 * useMatchLiveScore — Get live score for a specific match ID.
 *
 * Optimised for per-card independent updates: subscribes directly to the
 * realtimeService singleton for the relevant sport channel and filters events
 * by matchId client-side. Only THIS card's state changes when its match
 * receives an update — sibling cards are NOT re-rendered.
 *
 * The singleton ensures a single network connection per sport regardless of
 * how many cards call this hook simultaneously.
 *
 * Returns null when the match is not live.
 */
export function useMatchLiveScore(matchId: string, sport: string = 'all') {
  const [score, setScore] = useState<ScoreUpdate | null>(null);
  const sportKey = sport.toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Initial sync — pick up current score if match is already live on mount
    unsubs.push(realtimeService.subscribe<SyncComplete>(
      sportKey, 'sync-complete', (data) => {
        const m = data.matches.find(x => x.id === matchId);
        if (m) {
          setScore({
            matchId,
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            minute:    m.minute,
            sport:     m.sport,
            ts:        data.ts,
          });
        }
      },
    ));

    // Delta score updates — only fires setScore when matchId matches
    unsubs.push(realtimeService.subscribe<ScoreUpdate>(
      sportKey, 'score-update', (update) => {
        if (update.matchId === matchId) setScore(update);
      },
    ));

    // Status change — clear live score when match finishes
    unsubs.push(realtimeService.subscribe<MatchStatusUpdate>(
      sportKey, 'match-status', (update) => {
        if (update.matchId === matchId && update.status === 'finished') {
          setScore(null);
        }
      },
    ));

    return () => unsubs.forEach(u => u());
  }, [matchId, sportKey]);

  return score;
}

/**
 * useRealtimeMatchList — Subscribe to a live-updated list of matches.
 * Merges realtime score updates into the provided base match list.
 */
export function useRealtimeMatchList(
  baseMatches: Match[],
  sport: string = 'all',
): Match[] {
  const { scores } = useLiveScores(sport);
  const [merged, setMerged] = useState<Match[]>(baseMatches);

  useEffect(() => {
    if (scores.size === 0) {
      setMerged(baseMatches);
      return;
    }
    setMerged(baseMatches.map(m => {
      const update = scores.get(m.id);
      if (!update) return m;
      return {
        ...m,
        homeScore: update.homeScore,
        awayScore: update.awayScore,
        minute: update.minute,
      };
    }));
  }, [baseMatches, scores]);

  return merged;
}
