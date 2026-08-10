/**
 * logoCache.ts
 * -----------
 * Singleton in-memory + AsyncStorage logo URL cache.
 *
 * Keys:
 *   `team:<TeamName>`   → team/club badge URL
 *   `league:<LeagueName>` → league logo URL
 *
 * Usage flow:
 *   1. `initLogoCache()` — called once on app start (loads AsyncStorage → memory)
 *   2. `getLogoUrlSync(key)` — synchronous in-memory lookup for instant render
 *   3. `updateLogoCacheEntries(map)` — called after each DB fetch to persist new URLs
 *   4. `buildCacheEntriesFromMatches(matches)` — helper to extract entries from DB rows
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Match } from './types';

const CACHE_KEY = '@predictxta/logo_cache_v2';

/** In-memory store — populated on startup and updated after every DB fetch */
let memoryCache: Record<string, string> = {};
let initialized = false;

// ─── Key builders ─────────────────────────────────────────────────────────────

export function teamKey(teamName: string): string {
  return `team:${teamName}`;
}

export function leagueKey(leagueName: string): string {
  return `league:${leagueName}`;
}

// ─── Init (call once at app startup) ─────────────────────────────────────────

export async function initLogoCache(): Promise<void> {
  if (initialized) return;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, string>;
      // Only accept string values to guard against corrupt data
      const validated: Record<string, string> = {};
      for (const [k, v] of Object.entries(stored)) {
        if (typeof k === 'string' && typeof v === 'string' && v.startsWith('http')) {
          validated[k] = v;
        }
      }
      memoryCache = validated;
    }
  } catch {
    // Never crash on cache read failure — silently continue with empty cache
    memoryCache = {};
  }
  initialized = true;
}

// ─── Synchronous read (instant, no await) ────────────────────────────────────

export function getLogoUrlSync(key: string): string | null {
  return memoryCache[key] ?? null;
}

// ─── Batch update (merge + persist) ──────────────────────────────────────────

/**
 * Merge new {key → url} entries into memory + AsyncStorage.
 * Only entries with valid HTTPS/HTTP URLs are accepted.
 * Write is fire-and-forget (non-blocking).
 */
export function updateLogoCacheEntries(entries: Record<string, string>): void {
  let changed = false;

  for (const [k, v] of Object.entries(entries)) {
    if (typeof v === 'string' && v.startsWith('http') && memoryCache[k] !== v) {
      memoryCache[k] = v;
      changed = true;
    }
  }

  if (!changed) return;

  // Persist asynchronously — don't block the caller
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache)).catch(() => {
    /* non-blocking — best-effort persistence */
  });
}

// ─── Extract entries from a match array ──────────────────────────────────────

/**
 * Build a flat {key → url} map from an array of Match objects.
 * Pass the result directly to `updateLogoCacheEntries`.
 */
export function buildCacheEntriesFromMatches(
  matches: Match[],
): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const m of matches) {
    if (m.homeLogo) entries[teamKey(m.homeTeam)] = m.homeLogo;
    if (m.awayLogo) entries[teamKey(m.awayTeam)] = m.awayLogo;
    if (m.leagueLogo && m.league) entries[leagueKey(m.league)] = m.leagueLogo;
  }

  return entries;
}

// ─── Convenience: extract + persist in one call ───────────────────────────────

export function cacheLogosFromMatches(matches: Match[]): void {
  const entries = buildCacheEntriesFromMatches(matches);
  updateLogoCacheEntries(entries);
}

// ─── Cache stats (for debugging) ─────────────────────────────────────────────

export function getLogoCacheSize(): number {
  return Object.keys(memoryCache).length;
}

export function clearLogoCache(): Promise<void> {
  memoryCache = {};
  return AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
