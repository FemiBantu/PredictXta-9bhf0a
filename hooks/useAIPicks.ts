/**
 * useAIPicks — hook for the AI Picks 3-level drill-down screen
 *
 * Manages:
 *  - Fetching leagues + matches + predictions from Supabase
 *  - VIP status + coin balance for AI report gating
 *  - Coin-spend unlock flow
 *  - Per-match unlock cache (so users don't re-pay on back navigation)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/template';
import {
  fetchAIPicks,
  checkVipStatus,
  fetchCoinBalance,
  spendCoinsForReport,
  batchGenerateForDate,
  AI_REPORT_UNLOCK_COST,
  type AIPicksLeague,
  type BatchGenResult,
} from '@/services/aiPicksService';

// ─── Per-session unlock cache ─────────────────────────────────────────────────
// Stores matchIds the user has unlocked this session so the paywall
// doesn't re-appear on back navigation.
const unlockedMatchIds = new Set<string>();

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAIPicks(dateOffset: number, sport: string) {
  const { user } = useAuth();

  const [leagues, setLeagues] = useState<AIPicksLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Access control
  const [isVip, setIsVip] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [accessChecked, setAccessChecked] = useState(false);

  // Unlock state
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Track last fetch params so we know when to re-fetch
  const lastParams = useRef<{ offset: number; sport: string } | null>(null);

  // ── Batch AI generation ─────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<BatchGenResult | null>(null);
  // Prevent re-auto-triggering for the same (offset, sport) pair
  const autoGenParamsRef = useRef<string | null>(null);

  // ── Load leagues ────────────────────────────────────────────────────────────
  const load = useCallback(async (offset: number, sportFilter: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchAIPicks({ dateOffset: offset, sport: sportFilter });
      setLeagues(data);
      return data;
    } catch (e) {
      setError('Failed to load matches. Pull down to retry.');
      setLeagues([]);
      return [];
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Batch generate — manual trigger ────────────────────────────────────────
  const generateForDate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setGenResult(null);
    try {
      const result = await batchGenerateForDate({
        dateOffset,
        sport,
        concurrency: 3,
        userId: user?.id ?? null,
      });
      setGenResult(result);
      if (result.generated > 0) {
        // Re-fetch leagues so hasPrediction badges update
        await load(dateOffset, sport);
      }
    } finally {
      setGenerating(false);
    }
  }, [generating, dateOffset, sport, user?.id, load]);

  // Re-fetch when date offset or sport changes, then auto-generate if needed
  useEffect(() => {
    const params = { offset: dateOffset, sport };
    if (
      lastParams.current?.offset === params.offset &&
      lastParams.current?.sport === params.sport
    ) return;
    lastParams.current = params;

    const paramKey = `${dateOffset}::${sport}`;

    load(dateOffset, sport).then((data) => {
      // Auto-generate only for today/tomorrow when matches have no prediction
      // and only once per (offset+sport) combo to avoid hammering the edge fn
      const isPastDate = dateOffset < -1;
      const hasUnpredicted = !isPastDate && data.some((l) => l.matches.some((m) => !m.hasPrediction));
      if (hasUnpredicted && autoGenParamsRef.current !== paramKey) {
        autoGenParamsRef.current = paramKey;
        // Delay so the UI is interactive before triggering background generation
        setTimeout(() => {
          batchGenerateForDate({
            dateOffset,
            sport,
            concurrency: 2,
            userId: user?.id ?? null,
          }).then((result) => {
            setGenResult(result);
            if (result.generated > 0) {
              // Silently refresh so new prediction badges appear
              load(dateOffset, sport);
            }
          }).catch(() => {});
        }, 3000);
      }
    });
  }, [dateOffset, sport, load, user?.id]);

  // ── Check VIP + coins ───────────────────────────────────────────────────────
  const checkAccess = useCallback(async () => {
    if (!user?.id) {
      setIsVip(false);
      setCoinBalance(0);
      setAccessChecked(true);
      return;
    }
    const [vip, coins] = await Promise.all([
      checkVipStatus(user.id),
      fetchCoinBalance(user.id),
    ]);
    setIsVip(vip);
    setCoinBalance(coins);
    setAccessChecked(true);
  }, [user?.id]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  // ── Determine if a specific match's AI report is accessible ────────────────
  const canViewReport = useCallback((matchId: string): boolean => {
    return isVip || unlockedMatchIds.has(matchId);
  }, [isVip]);

  // ── Spend coins to unlock a match's AI report ───────────────────────────────
  const unlockWithCoins = useCallback(async (matchId: string): Promise<boolean> => {
    if (!user?.id) return false;
    if (coinBalance < AI_REPORT_UNLOCK_COST) {
      setUnlockError(`You need ${AI_REPORT_UNLOCK_COST} coins to unlock. You have ${coinBalance}.`);
      return false;
    }
    setUnlocking(true);
    setUnlockError(null);
    const result = await spendCoinsForReport(user.id);
    setUnlocking(false);
    if (result.success) {
      unlockedMatchIds.add(matchId);
      setCoinBalance(result.newBalance);
      return true;
    } else {
      setUnlockError(result.error ?? 'Unlock failed');
      return false;
    }
  }, [user?.id, coinBalance]);

  const refresh = useCallback(() => {
    // Reset both guards so that a manual pull-to-refresh also re-evaluates
    // lastParams (to allow re-fetch) and autoGenParamsRef (to allow re-generation)
    autoGenParamsRef.current = null;
    lastParams.current = null;
    load(dateOffset, sport, true);
    checkAccess();
  }, [dateOffset, sport, load, checkAccess]);

  return {
    leagues,
    loading,
    refreshing,
    error,
    refresh,
    isVip,
    coinBalance,
    accessChecked,
    canViewReport,
    unlockWithCoins,
    unlocking,
    unlockError,
    setUnlockError,
    unlockCost: AI_REPORT_UNLOCK_COST,
    // Batch generation
    generating,
    genResult,
    generateForDate,
  };
}
