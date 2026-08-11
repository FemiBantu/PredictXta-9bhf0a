import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@predictxta:followed_matches';

/** Manages a persisted set of followed match IDs via AsyncStorage. */
export function useFollowedMatches() {
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val) setFollowedIds(JSON.parse(val));
      })
      .finally(() => setLoaded(true));
  }, []);

  /** Toggle a match in/out of the followed list and persist immediately. */
  const toggleFollow = useCallback((id: string) => {
    setFollowedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => null);
      return next;
    });
  }, []);

  const isFollowing = useCallback(
    (id: string) => followedIds.includes(id),
    [followedIds],
  );

  return { followedIds, isFollowing, toggleFollow, loaded };
}
