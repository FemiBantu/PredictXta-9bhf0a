import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FOLLOWED_CLUBS_KEY = '@predictxta:followed_clubs';

async function loadFollowedClubs(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWED_CLUBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export interface ScoreAlert {
  id: string;
  matchId: string;
  matchLabel: string;
  message: string;
  sport: string;
  timestamp: number;
}

// Poll faster when live matches are tracked, back off when none
const POLL_LIVE_MS = 30_000;
const POLL_IDLE_MS = 60_000;

// Sport-specific scoring emoji
const SPORT_EVENT_EMOJI: Record<string, string> = {
  football:            '⚽',
  soccer:              '⚽',
  basketball:          '🏀',
  tennis:              '🎾',
  baseball:            '⚾',
  hockey:              '🏒',
  rugby:               '🏉',
  handball:            '🤾',
  volleyball:          '🏐',
  'american football': '🏈',
  cricket:             '🏏',
  mma:                 '🥊',
  afl:                 '🏈',
};

// Sport-specific score event verb
const SPORT_SCORE_VERB: Record<string, string> = {
  football:            'Goal',
  soccer:              'Goal',
  basketball:          'Scores',
  tennis:              'Takes Set',
  baseball:            'Runs',
  hockey:              'Goal',
  rugby:               'Try',
  handball:            'Goal',
  volleyball:          'Set Won',
  'american football': 'Touchdown',
  cricket:             'Wicket',
  mma:                 'Point',
  afl:                 'Goal',
};

function getSportEmoji(sport: string): string {
  return SPORT_EVENT_EMOJI[sport.toLowerCase()] ?? '🏆';
}

function getScoreVerb(sport: string): string {
  return SPORT_SCORE_VERB[sport.toLowerCase()] ?? 'Scores';
}

// Build a human-readable alert message for a score change event
function buildScoreMessage(params: {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  prevHome: number;
  prevAway: number;
  newHome: number;
  newAway: number;
}): string {
  const { sport, homeTeam, awayTeam, prevHome, prevAway, newHome, newAway } = params;
  const emoji = getSportEmoji(sport);
  const verb = getScoreVerb(sport);
  const scoreline = `${newHome}–${newAway}`;

  const homeGoals = newHome - prevHome;
  const awayGoals = newAway - prevAway;

  // Both teams scored within the same poll window
  if (homeGoals > 0 && awayGoals > 0) {
    return `${emoji} Both teams score! ${scoreline}`;
  }

  const scorer = homeGoals > 0 ? homeTeam : awayTeam;
  const goals = homeGoals > 0 ? homeGoals : awayGoals;

  // Short team name (last word) keeps toast compact on small screens
  const shortName = scorer.split(' ').slice(-1)[0];

  if (goals > 1) {
    return `${emoji} ${shortName} (+${goals}) ${verb}! Now ${scoreline}`;
  }
  return `${emoji} ${verb}! ${shortName} · ${scoreline}`;
}

// Internal cache shape — richer than before so we can generate good messages
interface CacheEntry {
  home: number;
  away: number;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  isLive: boolean;
}

// Extend the interval ref with the current target ms so we can detect changes
type IntervalRefWithMs = ReturnType<typeof useRef<ReturnType<typeof setInterval> | null>> & { _ms?: number };

/**
 * Polls the DB for score changes on followed matches.
 *
 * Improvements over the previous implementation:
 * - 30s interval while live matches exist, 60s when none are live.
 * - Pauses polling while the app is backgrounded (AppState), syncs on resume.
 * - Sport-aware emoji and verb (Goal / Try / Touchdown / etc.).
 * - Handles multi-goal bursts ("both teams score" or "+2 pts" etc.).
 * - Caps the visible alert list at 5 to avoid screen flood.
 * - Includes `sport` on ScoreAlert so Toast can render the right icon.
 */
export function useScoreAlerts(followedMatchIds: string[]) {
  // Keep backward-compat alias
  const followedIds = followedMatchIds;
  const [alerts, setAlerts] = useState<ScoreAlert[]>([]);
  const scoreCache = useRef<Record<string, CacheEntry>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null) as IntervalRefWithMs;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ─── Core polling function ────────────────────────────────────────────────
  const checkScores = useCallback(async () => {
    // Skip tick when app is backgrounded
    if (appStateRef.current !== 'active') return;

    // Load followed clubs each tick (lightweight AsyncStorage read)
    const followedClubs = await loadFollowedClubs();

    const hasFollowedMatches = followedIds.length > 0;
    const hasFollowedClubs = followedClubs.length > 0;
    if (!hasFollowedMatches && !hasFollowedClubs) return;

    type MatchRow = {
      id: string;
      home_team: string;
      away_team: string;
      home_score: number;
      away_score: number;
      status: string;
      sport: string;
    };

    let rows: MatchRow[] = [];

    try {
      const sb = getSupabaseClient();

      if (hasFollowedMatches && hasFollowedClubs) {
        // Fetch pinned matches + any live match involving followed clubs
        const { data: matchRows } = await sb
          .from('matches')
          .select('id, home_team, away_team, home_score, away_score, status, sport')
          .in('id', followedIds);
        const { data: liveRows } = await sb
          .from('matches')
          .select('id, home_team, away_team, home_score, away_score, status, sport')
          .eq('status', 'live');
        const combined = [...(matchRows ?? []), ...(liveRows ?? [])];
        // De-duplicate by id
        const seen = new Set<string>();
        rows = (combined as MatchRow[]).filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      } else if (hasFollowedMatches) {
        const { data, error } = await sb
          .from('matches')
          .select('id, home_team, away_team, home_score, away_score, status, sport')
          .in('id', followedIds);
        if (!error && data) rows = data as MatchRow[];
      } else {
        // Only club follows — fetch all live matches
        const { data, error } = await sb
          .from('matches')
          .select('id, home_team, away_team, home_score, away_score, status, sport')
          .eq('status', 'live');
        if (!error && data) rows = data as MatchRow[];
      }
    } catch {
      return;
    }

    // Filter to only rows we actually care about
    rows = rows.filter((r) => {
      if (followedIds.includes(r.id)) return true; // pinned match
      if (followedClubs.includes(r.home_team.trim().toLowerCase())) return true; // followed home club
      if (followedClubs.includes(r.away_team.trim().toLowerCase())) return true; // followed away club
      return false;
    });

    const newAlerts: ScoreAlert[] = [];
    let hasLiveNow = false;

    for (const row of rows) {
      // Always update cache to keep it fresh for status transitions
      const updatedEntry: CacheEntry = {
        home: row.home_score,
        away: row.away_score,
        sport: row.sport,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        isLive: row.status === 'live',
      };

      if (row.status !== 'live') {
        scoreCache.current[row.id] = updatedEntry;
        continue;
      }

      hasLiveNow = true;
      const cached = scoreCache.current[row.id];

      if (cached) {
        const homeChanged = row.home_score !== cached.home;
        const awayChanged = row.away_score !== cached.away;

        if (homeChanged || awayChanged) {
          const msg = buildScoreMessage({
            sport: row.sport,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            prevHome: cached.home,
            prevAway: cached.away,
            newHome: row.home_score,
            newAway: row.away_score,
          });

          newAlerts.push({
            id: `${row.id}-${Date.now()}`,
            matchId: row.id,
            matchLabel: `${row.home_team} vs ${row.away_team}`,
            message: msg,
            sport: row.sport,
            timestamp: Date.now(),
          });
        }
      }

      scoreCache.current[row.id] = updatedEntry;
    }

    if (newAlerts.length > 0) {
      // Cap total visible alerts at 5 to avoid flooding the screen
      setAlerts((prev) => [...prev, ...newAlerts].slice(-5));

      // Fire local push notifications for background delivery (no-op on web/simulator)
      for (const alert of newAlerts) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: alert.matchLabel,
            body: alert.message,
            data: { screen: 'live', matchId: alert.matchId },
            sound: 'default',
          },
          trigger: null, // immediate
        }).catch(() => null);
      }
    }

    // Dynamically adjust the poll interval based on live match presence
    const targetMs = hasLiveNow ? POLL_LIVE_MS : POLL_IDLE_MS;
    if (intervalRef._ms !== targetMs) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(checkScores, targetMs);
      intervalRef._ms = targetMs;
    }
  }, [followedIds]);

  // ─── Seed cache on mount / followedIds change (no alert on first load) ─────
  const seedCache = useCallback(async () => {
    const followedClubs = await loadFollowedClubs();
    if (followedIds.length === 0 && followedClubs.length === 0) return;

    type SeedRow = {
      id: string;
      home_score: number;
      away_score: number;
      status: string;
      sport: string;
      home_team: string;
      away_team: string;
    };

    let seedRows: SeedRow[] = [];

    try {
      const sb = getSupabaseClient();
      const { data } = await sb
        .from('matches')
        .select('id, home_score, away_score, status, sport, home_team, away_team')
        .in('id', followedIds);
      if (data) {
        seedRows = data as SeedRow[];
      }
    } catch { /* ignore */ }

    seedRows.forEach((r) => {
      scoreCache.current[r.id] = {
        home: r.home_score,
        away: r.away_score,
        sport: r.sport,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        isLive: r.status === 'live',
      };
    });
  }, [followedIds]);

  // ─── Setup polling + cleanup ─────────────────────────────────────────────
  useEffect(() => {
    seedCache();

    // Start at live interval — checkScores will back off to idle if no live matches found
    intervalRef._ms = POLL_LIVE_MS;
    intervalRef.current = setInterval(checkScores, POLL_LIVE_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [seedCache, checkScores]);

  // ─── AppState: pause on background, sync on foreground resume ───────────
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && prev !== 'active') {
        // Immediate check when user brings app back to foreground
        checkScores();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [checkScores]);

  // ─── Dismiss a single alert ──────────────────────────────────────────────
  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, dismissAlert };
}
