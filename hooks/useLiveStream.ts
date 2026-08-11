/**
 * useLiveStream — React Native hook for SSE live data stream
 *
 * Connects to the live-stream edge function and maintains:
 *   - liveMatches: current live match scores (updated every 15s)
 *   - latestEvent: most recent match event (goal/card/sub)
 *   - liveOdds: odds map keyed by match_id
 *   - connectionState: connected | connecting | disconnected | error
 *
 * Automatically:
 *   - Reconnects on disconnect (exponential backoff, max 30s)
 *   - Falls back to DB polling when SSE is unavailable
 *   - Stops streaming when app goes to background
 *   - Restarts when app comes to foreground
 *
 * React Native doesn't have EventSource — uses fetch() streaming.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { getSupabaseClient } from '@/template';
import type { Match } from '@/services/types';

// ─── Types ────────────────────────────────────────────────────────────────────
export type StreamConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'fallback';

export interface LiveMatchEvent {
  id: string;
  match_id: string;
  event_type: string;
  player_name: string;
  team: string;
  is_home_team: boolean;
  minute: number;
  extra_minute: number | null;
  detail: string | null;
  home_team: string | null;
  away_team: string | null;
  ts: number;
}

export interface LiveOddsSnapshot {
  match_id: string;
  bookmaker: string;
  home_win: number | null;
  draw: number | null;
  away_win: number | null;
  over_2_5: number | null;
  under_2_5: number | null;
  last_updated: string;
}

export interface UseLiveStreamResult {
  liveMatches: Match[];
  latestEvent: LiveMatchEvent | null;
  oddsMap: Record<string, LiveOddsSnapshot>;    // keyed by match_id
  connectionState: StreamConnectionState;
  lastUpdated: Date | null;
  liveCount: number;
  reconnect: () => void;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────
function rowToMatch(row: Record<string, any>): Match {
  return {
    id: row.id,
    sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: row.status ?? 'live',
    matchTime: row.match_time ?? row.last_updated ?? new Date().toISOString(),
    league: row.league ?? '',
    minute: Number(row.minute ?? 0),
    homeLogo: row.home_logo ?? null,
    awayLogo: row.away_logo ?? null,
    stats: null,
  };
}

// Reconstruct Match from SSE live match row (slightly different schema)
function streamRowToMatch(row: any): Match {
  return {
    id: row.id,
    sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: row.status ?? 'live',
    matchTime: row.last_updated ?? new Date().toISOString(),
    league: row.league ?? '',
    minute: Number(row.minute ?? 0),
    homeLogo: row.home_logo ?? null,
    awayLogo: row.away_logo ?? null,
    stats: null,
  };
}

// ─── SSE stream reader ────────────────────────────────────────────────────────
function parseSSELine(line: string): { event: string; data: string } | null {
  if (!line.trim()) return null;
  // Handle "event: X\ndata: Y" style accumulated
  return null; // handled by buffer parser below
}

function* parseSSEBuffer(buffer: string): Generator<{ event: string; data: string }> {
  const blocks = buffer.split('\n\n');
  for (let i = 0; i < blocks.length - 1; i++) { // last block may be incomplete
    const block = blocks[i].trim();
    if (!block) continue;
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data = line.slice(6).trim();
    }
    if (data) yield { event, data };
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const FALLBACK_POLL_INTERVAL = 30_000;   // 30s fallback DB poll
const MAX_RECONNECT_DELAY = 30_000;      // 30s max backoff
const INITIAL_RECONNECT_DELAY = 2_000;  // 2s initial backoff

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLiveStream(opts: {
  sport?: string;
  matchId?: string;
  includeOdds?: boolean;
  enabled?: boolean;
} = {}): UseLiveStreamResult {
  const { sport, matchId, includeOdds = false, enabled = true } = opts;

  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [latestEvent, setLatestEvent] = useState<LiveMatchEvent | null>(null);
  const [oddsMap, setOddsMap] = useState<Record<string, LiveOddsSnapshot>>({});
  const [connectionState, setConnectionState] = useState<StreamConnectionState>('disconnected');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isActiveRef = useRef(true);
  const bufferRef = useRef('');

  // ── Fallback DB polling ──────────────────────────────────────────────────
  const startFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) return;
    setConnectionState('fallback');

    const poll = async () => {
      try {
        const supabase = getSupabaseClient();
        let q = supabase
          .from('matches')
          .select('id, sport, home_team, away_team, home_score, away_score, status, minute, league, home_logo, away_logo, match_time, last_updated')
          .eq('status', 'live')
          .order('minute', { ascending: false })
          .limit(30);
        if (sport) q = q.eq('sport', sport);
        if (matchId) q = q.eq('id', matchId);

        const { data } = await q;
        if (data) {
          setLiveMatches((data as any[]).map(rowToMatch));
          setLastUpdated(new Date());
        }
      } catch { /* non-blocking */ }
    };

    poll();
    fallbackIntervalRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL);
  }, [sport, matchId]);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
  }, []);

  // ── SSE stream connect ───────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!enabled || !isActiveRef.current) return;

    // Abort any existing connection
    if (abortRef.current) abortRef.current.abort();
    stopFallbackPolling();

    const controller = new AbortController();
    abortRef.current = controller;
    setConnectionState('connecting');

    try {
      const params = new URLSearchParams();
      if (sport) params.set('sport', sport);
      if (matchId) params.set('match_id', matchId);
      if (includeOdds) params.set('include_odds', 'true');

      const url = `${SUPABASE_URL}/functions/v1/live-stream?${params.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream HTTP ${response.status}`);
      }

      setConnectionState('connected');
      reconnectAttemptRef.current = 0;
      bufferRef.current = '';

      // ── Read SSE stream ────────────────────────────────────────────────
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        // Platform doesn't support streaming — fall back to polling
        startFallbackPolling();
        return;
      }

      while (isActiveRef.current) {
        const { done, value } = await reader.read();
        if (done) break;

        bufferRef.current += decoder.decode(value, { stream: true });

        // Parse complete SSE blocks
        for (const { event, data } of parseSSEBuffer(bufferRef.current)) {
          // Trim processed part of buffer
          const blockEnd = bufferRef.current.indexOf('\n\n');
          if (blockEnd !== -1) bufferRef.current = bufferRef.current.slice(blockEnd + 2);

          try {
            const parsed = JSON.parse(data);

            if (event === 'live_scores' && parsed.matches) {
              const matches = (parsed.matches as any[]).map(streamRowToMatch);
              setLiveMatches(matches);
              setLastUpdated(new Date());

              if (parsed.odds && includeOdds) {
                const newOddsMap: Record<string, LiveOddsSnapshot> = {};
                for (const odds of parsed.odds) {
                  newOddsMap[odds.match_id] = odds;
                }
                setOddsMap((prev) => ({ ...prev, ...newOddsMap }));
              }
            }

            else if (event === 'match_event') {
              setLatestEvent(parsed as LiveMatchEvent);
            }

            else if (event === 'reconnect') {
              // Server-initiated reconnect
              if (parsed.reconnect_after_ms) {
                await new Promise((r) => setTimeout(r, parsed.reconnect_after_ms));
              }
              if (isActiveRef.current) connect();
              return;
            }

            else if (event === 'error') {
              throw new Error(parsed.message ?? 'Stream error');
            }

            // heartbeat and connection_meta: no action needed
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // malformed JSON, skip
            throw parseErr;
          }
        }
      }

      // Stream ended naturally — reconnect
      if (isActiveRef.current) scheduleReconnect();

    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // intentional disconnect

      setConnectionState('error');

      // Fall back to polling if SSE fails
      startFallbackPolling();
      scheduleReconnect();
    }
  }, [enabled, sport, matchId, includeOdds, startFallbackPolling, stopFallbackPolling]);

  const scheduleReconnect = useCallback(() => {
    if (!isActiveRef.current) return;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isActiveRef.current) connect();
    }, delay);
  }, [connect]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setConnectionState('disconnected');
      return;
    }

    isActiveRef.current = true;
    connect();

    return () => {
      isActiveRef.current = false;
      if (abortRef.current) abortRef.current.abort();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      stopFallbackPolling();
      setConnectionState('disconnected');
    };
  }, [enabled, sport, matchId, includeOdds]);

  // ── App state handler (pause when backgrounded) ─────────────────────────
  useEffect(() => {
    const handler = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        isActiveRef.current = true;
        if (connectionState !== 'connected') reconnect();
      } else {
        isActiveRef.current = false;
        if (abortRef.current) abortRef.current.abort();
        stopFallbackPolling();
        setConnectionState('disconnected');
      }
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [reconnect, stopFallbackPolling, connectionState]);

  return {
    liveMatches,
    latestEvent,
    oddsMap,
    connectionState,
    lastUpdated,
    liveCount: liveMatches.length,
    reconnect,
  };
}
