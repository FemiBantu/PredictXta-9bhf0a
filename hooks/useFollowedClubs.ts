/**
 * useFollowedClubs
 * ----------------
 * Manages a persisted set of followed club/team names.
 * Club names are used as keys (lowercased + trimmed for consistency).
 *
 * Notifications for followed clubs piggyback on the existing score-alert
 * polling: if either team in a match is followed, score changes surface as toasts.
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@predictxta:followed_clubs';

/** Normalise a team name so "Man Utd" and "man utd" map to the same key. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

export function useFollowedClubs() {
  const [followedClubs, setFollowedClubs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load persisted clubs on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val) {
          try { setFollowedClubs(JSON.parse(val)); } catch { /* ignore */ }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  /** Toggle a club in/out of the followed list and persist immediately. */
  const toggleFollowClub = useCallback((teamName: string) => {
    const key = normalise(teamName);
    setFollowedClubs((prev) => {
      const next = prev.includes(key)
        ? prev.filter((x) => x !== key)
        : [...prev, key];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => null);
      return next;
    });
  }, []);

  const isFollowingClub = useCallback(
    (teamName: string) => followedClubs.includes(normalise(teamName)),
    [followedClubs],
  );

  /** Returns true if EITHER the home or away team is followed by the user. */
  const isMatchFollowedByClub = useCallback(
    (homeTeam: string, awayTeam: string) =>
      followedClubs.includes(normalise(homeTeam)) ||
      followedClubs.includes(normalise(awayTeam)),
    [followedClubs],
  );

  return { followedClubs, isFollowingClub, isMatchFollowedByClub, toggleFollowClub, loaded };
}
