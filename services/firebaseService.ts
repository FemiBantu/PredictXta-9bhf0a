/**
 * firebaseService.ts — Firebase Realtime Database live score client
 *
 * Architecture:
 *   Mobile app → firebase-live edge function → Firebase RTDB
 *
 * Why proxy through an edge function?
 * - Firebase credentials stay server-side (FIREBASE_DATABASE_URL, FIREBASE_API_KEY)
 * - Client uses standard Supabase auth; no Firebase SDK needed
 * - No native module required — works in Expo Go, iOS, Android APK
 * - Edge function adds 10s CDN cache to reduce RTDB reads
 *
 * Data flow (live scores):
 *   sync-live edge fn → Supabase DB + Firebase RTDB (in parallel)
 *   firebaseService    → firebase-live edge fn → Firebase RTDB
 *   feedEngine        → firebaseService (L0, fastest) → Supabase (L1) → AsyncStorage (L2)
 *
 * Polling interval: 12 seconds (vs 45s for Supabase sync-live)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Match } from './types';

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_KEY = '@firebase/live_scores_v2';
const CACHE_TTL_MS = 15_000; // 15s

interface FirebaseLiveSnapshot {
  data: Match[];
  ts: number;
}

// In-memory L0 layer
let memSnapshot: FirebaseLiveSnapshot | null = null;

// ─── Firebase live score row (shape written by sync-live) ─────────────────────
export interface FirebaseLiveScoreRow {
  id: string;
  external_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  minute: number;
  status: string;
  match_time: string;
  league: string;
  home_logo: string | null;
  away_logo: string | null;
  league_logo: string | null;
  updated_at: string;
}

function rowToMatch(row: FirebaseLiveScoreRow): Match {
  return {
    id: row.id ?? '',
    sport: row.sport ?? 'football',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: row.status ?? 'live',
    matchTime: row.match_time ?? '',
    league: row.league ?? '',
    minute: Number(row.minute ?? 0),
    homeLogo: row.home_logo ?? null,
    awayLogo: row.away_logo ?? null,
    leagueLogo: row.league_logo ?? null,
    externalId: row.external_id ?? undefined,
    stats: null,
  };
}

// ─── Firebase configured check ────────────────────────────────────────────────
// The firebase-live edge function is always available when the backend is ready.
// We consider Firebase "configured" if the edge function is reachable.
// This is set to true once the first successful call to firebase-live returns data.
let _firebaseAvailable: boolean | null = null; // null = not yet determined

export function isFirebaseConfigured(): boolean {
  // Optimistic: assume available until proven otherwise.
  // The actual check happens in the first fetchFirebaseLiveScores() call.
  return _firebaseAvailable !== false;
}

// ─── Fetch live scores via firebase-live edge function ─────────────────────────
/**
 * fetchFirebaseLiveScores — reads /live_scores from Firebase RTDB
 * via the firebase-live edge function proxy.
 *
 * Falls back to AsyncStorage cache on failure.
 */
export async function fetchFirebaseLiveScores(sport?: string | null): Promise<{
  data: Match[];
  source: 'firebase' | 'cached' | 'empty';
  latencyMs: number;
}> {
  // L0 memory cache (15s TTL)
  if (memSnapshot && Date.now() - memSnapshot.ts < CACHE_TTL_MS) {
    const filtered = sport
      ? memSnapshot.data.filter((m) => m.sport?.toLowerCase() === sport.toLowerCase())
      : memSnapshot.data;
    return { data: filtered, source: 'cached', latencyMs: 0 };
  }

  const startMs = Date.now();

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('firebase-live', {
      body: { sport: sport ?? 'all' },
    });

    const latencyMs = Date.now() - startMs;

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await error.context?.text()) || msg; } catch { /* ignore */ }
      }
      _firebaseAvailable = false;
      return await _fallbackCache(sport, latencyMs);
    }

    if (!data || data.source === 'not_configured') {
      _firebaseAvailable = false;
      return { data: [], source: 'empty', latencyMs };
    }

    _firebaseAvailable = true;

    const rows: FirebaseLiveScoreRow[] = data.liveScores ?? [];
    const matches = rows.map(rowToMatch).filter((m) => m.id); // skip malformed rows

    // Update L0 + persist
    memSnapshot = { data: matches, ts: Date.now() };
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memSnapshot)).catch(() => {});

    const filtered = sport
      ? matches.filter((m) => m.sport?.toLowerCase() === sport.toLowerCase())
      : matches;



    return { data: filtered, source: 'firebase', latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - startMs;
    _firebaseAvailable = false;
    return await _fallbackCache(sport, latencyMs);
  }
}

async function _fallbackCache(
  sport: string | null | undefined,
  latencyMs: number,
): Promise<{ data: Match[]; source: 'cached' | 'empty'; latencyMs: number }> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached: FirebaseLiveSnapshot = JSON.parse(raw);
      if (Date.now() - cached.ts < 5 * 60_000) {
        memSnapshot = cached;
        const filtered = sport
          ? cached.data.filter((m) => m.sport?.toLowerCase() === sport.toLowerCase())
          : cached.data;
        return { data: filtered, source: 'cached', latencyMs };
      }
    }
  } catch { /* ignore */ }
  return { data: [], source: 'empty', latencyMs };
}

// ─── Invalidate Firebase live cache ───────────────────────────────────────────
export function invalidateFirebaseLiveCache(): void {
  memSnapshot = null;
}

// ─── Firebase RTDB status check (for admin dashboard) ─────────────────────────
export async function checkFirebaseStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  liveMatchCount: number;
  latencyMs: number;
}> {
  const startMs = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('firebase-live', {
      body: { sport: 'all' },
    });

    const latencyMs = Date.now() - startMs;

    if (error || !data) {
      return { configured: false, reachable: false, liveMatchCount: 0, latencyMs };
    }

    if (data.source === 'not_configured') {
      return { configured: false, reachable: false, liveMatchCount: 0, latencyMs };
    }

    return {
      configured: true,
      reachable: data.source === 'firebase',
      liveMatchCount: data.count ?? 0,
      latencyMs,
    };
  } catch {
    return { configured: false, reachable: false, liveMatchCount: 0, latencyMs: Date.now() - startMs };
  }
}
