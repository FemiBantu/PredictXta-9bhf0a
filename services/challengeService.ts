/**
 * challengeService.ts
 *
 * Complete Daily Challenge Service:
 *  - Multi-sport fixture fetching from DB
 *  - Smart challenge generation (difficulty-banded selection)
 *  - Result settlement for all supported sports
 *  - Leaderboard management
 *  - Server-side pick persistence
 *  - Auto-retry and fallback mechanisms
 *
 * Supported sports:
 *   Football, Basketball, Tennis, Cricket, Baseball, Hockey,
 *   Rugby, Volleyball, MMA/UFC, Handball, Esports, Motorsport, + more
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ChallengeOutcome = 'home_win' | 'draw' | 'away_win';
export type DifficultyBand = 'upset' | 'competitive' | 'favourite';
export type SettlementStatus = 'pending' | 'win' | 'partial' | 'loss';
export type ChallengeResultStatus = 'pending' | 'settled' | 'cancelled';

export interface ChallengeMatch {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  league: string;
  matchTime: string;
  status: 'upcoming' | 'live' | 'finished';
  homeScore: number;
  awayScore: number;
  minute: number;
  difficultyBand: DifficultyBand;
  difficultyScore: number;
  aiConfidence: number;
}

export interface ChallengePick {
  matchId: string;
  prediction: ChallengeOutcome;
}

export interface DailyEntry {
  date: string;
  picks: ChallengePick[];
  submitted: boolean;
  result?: SettlementStatus;
  correctCount?: number;
  settledCount?: number;   // how many of the 3 matches have settled
}

export interface ChallengeStats {
  totalDays: number;
  perfectDays: number;
  partialDays: number;
  lossDays: number;
  perfectRate: number;
  currentStreak: number;
  bestStreak: number;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  perfectDays: number;
  totalDays: number;
  totalCorrect: number;
  winRate: number;
  rank?: number;
}

// ─── Sport outcome determination (sport-aware) ────────────────────────────────
/**
 * Determines the actual match outcome based on sport rules.
 * For sports with no draw (tennis, basketball, MMA, etc.), only home_win / away_win.
 * For sports with draw (football, cricket, handball, etc.), also 'draw'.
 */
export function determineOutcome(
  sport: string,
  homeScore: number,
  awayScore: number,
): ChallengeOutcome | null {
  if (homeScore === null || awayScore === null) return null;

  const sp = (sport ?? '').toLowerCase();
  const noDrawSports = [
    'tennis', 'basketball', 'mma', 'boxing', 'ufc',
    'baseball', 'volleyball', 'american football',
    'american_football', 'nfl', 'nba',
  ];

  if (homeScore > awayScore) return 'home_win';
  if (awayScore > homeScore) return 'away_win';

  // Draw is only possible in draw-eligible sports
  if (noDrawSports.some((s) => sp.includes(s))) {
    // In no-draw sports, a tie score shouldn't happen in final state
    // but treat as away_win as a safe fallback
    return null; // match may still be in progress / extra time
  }

  return 'draw';
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getWeekKey(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
  );
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getNextResetMs(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Difficulty banding ───────────────────────────────────────────────────────
function getDifficultyBand(confidence: number): DifficultyBand {
  if (confidence < 55) return 'upset';
  if (confidence < 75) return 'competitive';
  return 'favourite';
}

// ─── Fetch AI confidence map ─────────────────────────────────────────────────
async function fetchConfidenceMap(matchIds: string[]): Promise<Record<string, number>> {
  if (matchIds.length === 0) return {};
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('predictions')
      .select('match_id, confidence')
      .in('match_id', matchIds);
    if (!data) return {};
    const map: Record<string, number> = {};
    (data as { match_id: string; confidence: number }[]).forEach((r) => {
      if (map[r.match_id] === undefined || r.confidence > map[r.match_id]) {
        map[r.match_id] = r.confidence;
      }
    });
    return map;
  } catch {
    return {};
  }
}

// ─── SMART MULTI-SPORT DAILY FIXTURE SELECTION ─────────────────────────────
/**
 * Fetches today's challenge matches from DB using a multi-sport strategy:
 *
 * 1. Try to get a cached challenge from the `daily_challenges` table (generated server-side).
 * 2. Fall back to client-side selection: query today's upcoming/live matches across all sports,
 *    score them by difficulty, and select the best 3.
 * 3. Return empty array if insufficient real fixtures — never fabricate fixtures.
 *
 * Selection rules:
 * - Only upcoming / live matches (not finished, not postponed)
 * - Must have both team names populated
 * - Prefer variety: 1 upset, 1 competitive, 1 favourite where possible
 * - Fall back to any valid fixture if not enough from each band
 * - Deduplicate by match_id
 */
export async function fetchDailyChallengeMatches(
  forDate: string = getTodayKey(),
): Promise<ChallengeMatch[]> {
  const supabase = getSupabaseClient();

  // ── Step 1: Try server-generated cache ────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('daily_challenges')
      .select('match_data, match_ids, status')
      .eq('challenge_date', forDate)
      .eq('status', 'active')
      .maybeSingle();

    if (cached?.match_data && Array.isArray(cached.match_data) && cached.match_data.length >= 3) {
      const matches = cached.match_data as ChallengeMatch[];
      if (matches.every((m) => m.id && m.homeTeam && m.awayTeam)) {
        // Re-fetch live statuses for these specific matches
        const { data: liveData } = await supabase
          .from('matches')
          .select('id, status, home_score, away_score, minute')
          .in('id', cached.match_ids ?? matches.map((m) => m.id));

        if (liveData) {
          const statusMap: Record<string, { status: string; homeScore: number; awayScore: number; minute: number }> = {};
          (liveData as any[]).forEach((r) => {
            statusMap[r.id] = { status: r.status, homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0, minute: r.minute ?? 0 };
          });
          return matches.map((m) => {
            const live = statusMap[m.id];
            if (!live) return m;
            return { ...m, status: live.status as any, homeScore: live.homeScore, awayScore: live.awayScore, minute: live.minute };
          });
        }
        return matches;
      }
    }
  } catch { /* fallthrough to client selection */ }

  // ── Step 2: Client-side selection from DB ─────────────────────────────────
  try {
    // Look ±1 day to catch matches scheduled near midnight boundary
    const dateStart = new Date(forDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(forDate);
    dateEnd.setHours(23, 59, 59, 999);

    const { data: rows } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, home_logo, away_logo, league, match_time, status, home_score, away_score, minute')
      .in('status', ['upcoming', 'live'])
      .gte('match_time', dateStart.toISOString())
      .lte('match_time', dateEnd.toISOString())
      .not('home_team', 'is', null)
      .not('away_team', 'is', null)
      .order('match_time', { ascending: true })
      .limit(100);

    let candidates: any[] = rows ?? [];

    // If no matches for today, expand to next 48 hours
    if (candidates.length < 3) {
      const extEnd = new Date(forDate);
      extEnd.setDate(extEnd.getDate() + 2);
      const { data: extRows } = await supabase
        .from('matches')
        .select('id, sport, home_team, away_team, home_logo, away_logo, league, match_time, status, home_score, away_score, minute')
        .in('status', ['upcoming', 'live'])
        .gte('match_time', dateStart.toISOString())
        .lte('match_time', extEnd.toISOString())
        .not('home_team', 'is', null)
        .not('away_team', 'is', null)
        .order('match_time', { ascending: true })
        .limit(100);
      candidates = extRows ?? [];
    }

    if (candidates.length >= 3) {
      // Filter: must have non-empty team names
      const valid = candidates.filter(
        (r) => r.home_team?.trim() && r.away_team?.trim(),
      );

      // Score with AI confidence
      const confMap = await fetchConfidenceMap(valid.map((r) => r.id));

      const withDiff: ChallengeMatch[] = valid.map((r) => {
        const conf = confMap[r.id] ?? 55;
        return {
          id: r.id,
          sport: r.sport ?? 'football',
          homeTeam: r.home_team,
          awayTeam: r.away_team,
          homeLogo: r.home_logo ?? null,
          awayLogo: r.away_logo ?? null,
          league: r.league ?? '',
          matchTime: r.match_time,
          status: r.status as any,
          homeScore: r.home_score ?? 0,
          awayScore: r.away_score ?? 0,
          minute: r.minute ?? 0,
          difficultyBand: getDifficultyBand(conf),
          difficultyScore: 100 - conf,
          aiConfidence: conf,
        };
      });

      return selectDiverseMatches(withDiff, 3);
    }
  } catch { /* fallthrough to empty */ }

  // ── Step 3: Honest empty state — never fabricate fixtures ─────────────────
  // Production rule: Daily Challenge must use only real verified fixtures.
  // If insufficient real fixtures are available, return [] so the UI shows
  // "Not enough verified fixtures are available today." — never fake matches.
  return [];
}

/**
 * Greedy diverse selection:
 * Aim for 1 from each difficulty band; fall back to fill 3 from any band.
 */
function selectDiverseMatches(
  pool: ChallengeMatch[],
  count: number,
): ChallengeMatch[] {
  const upsets = pool.filter((m) => m.difficultyBand === 'upset').sort((a, b) => b.difficultyScore - a.difficultyScore);
  const competitive = pool.filter((m) => m.difficultyBand === 'competitive').sort((a, b) => b.difficultyScore - a.difficultyScore);
  const favourites = pool.filter((m) => m.difficultyBand === 'favourite').sort((a, b) => b.difficultyScore - a.difficultyScore);

  const selected: ChallengeMatch[] = [];
  const usedIds = new Set<string>();

  const tryAdd = (list: ChallengeMatch[]) => {
    for (const m of list) {
      if (!usedIds.has(m.id) && selected.length < count) {
        selected.push(m);
        usedIds.add(m.id);
        return;
      }
    }
  };

  // First pass: one from each band (ideal distribution)
  tryAdd(upsets);
  tryAdd(competitive);
  tryAdd(favourites);

  // Fill remaining from any band (ordered: upset → competitive → favourite)
  const remaining = [...upsets, ...competitive, ...favourites];
  for (const m of remaining) {
    if (selected.length >= count) break;
    if (!usedIds.has(m.id)) {
      selected.push(m);
      usedIds.add(m.id);
    }
  }

  return selected.slice(0, count);
}

/**
 * Deterministic seed-based mock challenge — DEV ONLY, never called in production.
 * Kept as dead code to document historical approach; unreachable via fetchDailyChallengeMatches.
 * @dev Do NOT call this function from production code paths.
 */
function generateMockChallengeMatches(_date: string): never[] {
  // This function is intentionally unreachable in production.
  // fetchDailyChallengeMatches() returns [] (honest empty state) when no real fixtures exist.
  if (!__DEV__) {
    throw new Error('[PredictXta] generateMockChallengeMatches called in production — this is a critical bug.');
  }
  return [];
}

// ─── SERVER-SIDE CHALLENGE GENERATION ────────────────────────────────────────
/**
 * Generates and persists today's daily challenge in the `daily_challenges` table.
 * Called by the edge function `generate-daily-challenge` at 00:01 UTC each day.
 */
export async function generateAndPersistDailyChallenge(
  date: string = getTodayKey(),
): Promise<{ success: boolean; matchCount: number; error?: string }> {
  try {
    const matches = await fetchDailyChallengeMatches(date);
    if (matches.length < 3) {
      return { success: false, matchCount: matches.length, error: 'Not enough valid fixtures' };
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('daily_challenges')
      .upsert(
        {
          challenge_date: date,
          week_key: getWeekKey(),
          sport: 'all',
          match_ids: matches.map((m) => m.id),
          match_data: matches,
          generated_at: new Date().toISOString(),
          status: 'active',
        },
        { onConflict: 'challenge_date' },
      );

    if (error) throw error;
    return { success: true, matchCount: matches.length };
  } catch (e: any) {
    return { success: false, matchCount: 0, error: e?.message ?? 'Unknown error' };
  }
}

// ─── RESULT SETTLEMENT ENGINE ─────────────────────────────────────────────────
/**
 * Settles challenge picks for a user by fetching final match results from DB.
 * Supports all sports with correct outcome determination.
 */
export async function settleChallengeResults(
  userId: string,
  date: string = getTodayKey(),
): Promise<{
  settled: boolean;
  correctCount: number;
  settledCount: number;
  result: SettlementStatus;
  details: Array<{ matchId: string; predicted: ChallengeOutcome; actual: ChallengeOutcome | null; correct: boolean }>;
}> {
  try {
    const supabase = getSupabaseClient();

    // Fetch user's picks for the date
    const { data: picks } = await supabase
      .from('challenge_picks')
      .select('match_id, prediction, is_correct, settled_at')
      .eq('user_id', userId)
      .eq('challenge_date', date);

    if (!picks || picks.length === 0) {
      return { settled: false, correctCount: 0, settledCount: 0, result: 'pending', details: [] };
    }

    const matchIds = (picks as any[]).map((p: any) => p.match_id);

    // Fetch current match results
    const { data: matchResults } = await supabase
      .from('matches')
      .select('id, sport, status, home_score, away_score')
      .in('id', matchIds);

    if (!matchResults) {
      return { settled: false, correctCount: 0, settledCount: 0, result: 'pending', details: [] };
    }

    const resultMap: Record<string, { sport: string; status: string; homeScore: number; awayScore: number }> = {};
    (matchResults as any[]).forEach((r: any) => {
      resultMap[r.id] = { sport: r.sport, status: r.status, homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0 };
    });

    let correctCount = 0;
    let settledCount = 0;
    const details: Array<{ matchId: string; predicted: ChallengeOutcome; actual: ChallengeOutcome | null; correct: boolean }> = [];

    // Settle each pick
    for (const pick of picks as any[]) {
      const matchResult = resultMap[pick.match_id];
      if (!matchResult || matchResult.status !== 'finished') {
        details.push({ matchId: pick.match_id, predicted: pick.prediction, actual: null, correct: false });
        continue;
      }

      const actual = determineOutcome(matchResult.sport, matchResult.homeScore, matchResult.awayScore);
      if (actual === null) {
        // Match still in extra time / shootout — treat as unsettled
        details.push({ matchId: pick.match_id, predicted: pick.prediction, actual: null, correct: false });
        continue;
      }

      settledCount++;
      const isCorrect = pick.prediction === actual;
      if (isCorrect) correctCount++;

      details.push({ matchId: pick.match_id, predicted: pick.prediction, actual, correct: isCorrect });

      // Update the pick record if not already settled
      if (!pick.settled_at) {
        await supabase
          .from('challenge_picks')
          .update({
            actual_result: actual,
            is_correct: isCorrect,
            home_score_actual: matchResult.homeScore,
            away_score_actual: matchResult.awayScore,
            settled_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('challenge_date', date)
          .eq('match_id', pick.match_id);
      }
    }

    const totalPicks = picks.length;
    let result: SettlementStatus = 'pending';

    if (settledCount === totalPicks) {
      result = correctCount === totalPicks ? 'win' : correctCount > 0 ? 'partial' : 'loss';
    } else if (settledCount > 0 && correctCount === 0 && settledCount === totalPicks) {
      result = 'loss';
    }

    return { settled: settledCount === totalPicks, correctCount, settledCount, result, details };
  } catch (e) {
    return { settled: false, correctCount: 0, settledCount: 0, result: 'pending', details: [] };
  }
}

// ─── SERVER-SIDE PICK PERSISTENCE ────────────────────────────────────────────
/**
 * Saves a user's picks to the `challenge_picks` table for server-side settlement.
 */
export async function persistChallengePicks(
  userId: string,
  picks: Array<{ matchId: string; matchLabel: string; sport: string; prediction: ChallengeOutcome }>,
  date: string = getTodayKey(),
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const weekKey = getWeekKey();

    const rows = picks.map((p) => ({
      user_id: userId,
      challenge_date: date,
      week_key: weekKey,
      match_id: p.matchId,
      match_label: p.matchLabel,
      sport: p.sport,
      prediction: p.prediction,
      submitted_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('challenge_picks')
      .upsert(rows, { onConflict: 'user_id,challenge_date,match_id' });

    if (error) throw error;
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
export async function fetchWeeklyLeaderboard(weekKey?: string): Promise<LeaderboardEntry[]> {
  const wk = weekKey ?? getWeekKey();
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('challenge_results')
      .select('user_id, username, correct_count, is_perfect')
      .eq('week_key', wk);

    if (!data) return [];

    const map: Record<string, { username: string; perfectDays: number; totalDays: number; totalCorrect: number }> = {};
    (data as Record<string, unknown>[]).forEach((row: any) => {
      const uid = row.user_id as string;
      if (!map[uid]) map[uid] = { username: row.username ?? 'Anonymous', perfectDays: 0, totalDays: 0, totalCorrect: 0 };
      map[uid].totalDays += 1;
      map[uid].totalCorrect += Number(row.correct_count ?? 0);
      if (row.is_perfect) map[uid].perfectDays += 1;
    });

    return Object.entries(map)
      .map(([userId, v], idx) => ({
        userId,
        username: v.username,
        perfectDays: v.perfectDays,
        totalDays: v.totalDays,
        totalCorrect: v.totalCorrect,
        winRate: v.totalDays > 0 ? Math.round((v.perfectDays / v.totalDays) * 100) : 0,
        rank: idx + 1,
      }))
      .sort((a, b) => b.perfectDays - a.perfectDays || b.winRate - a.winRate || b.totalCorrect - a.totalCorrect)
      .map((e, idx) => ({ ...e, rank: idx + 1 }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export async function saveResultToLeaderboard(params: {
  userId: string;
  username: string;
  correctCount: number;
  isPerfect: boolean;
  date?: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('challenge_results').upsert(
      {
        user_id: params.userId,
        username: params.username,
        date: params.date ?? getTodayKey(),
        week_key: getWeekKey(),
        correct_count: params.correctCount,
        total_picks: 3,
        is_perfect: params.isPerfect,
      },
      { onConflict: 'user_id,date' },
    );
  } catch { /* non-blocking */ }
}

// ─── LOCAL STATS MANAGEMENT ───────────────────────────────────────────────────
const STORAGE_KEY_HISTORY = '@predictxta/challenge_history_v2';

export async function loadTodayEntry(): Promise<DailyEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return null;
    const history: DailyEntry[] = JSON.parse(raw);
    return history.find((e) => e.date === getTodayKey()) ?? null;
  } catch { return null; }
}

export async function saveEntry(entry: DailyEntry): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HISTORY);
    const history: DailyEntry[] = raw ? JSON.parse(raw) : [];
    const idx = history.findIndex((e) => e.date === entry.date);
    if (idx >= 0) history[idx] = entry;
    else history.push(entry);
    await AsyncStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.slice(-60)));
  } catch { /* silent */ }
}

export async function loadChallengeStats(): Promise<ChallengeStats> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return emptyStats();
    const history: DailyEntry[] = JSON.parse(raw);
    const finished = history.filter((e) => e.submitted && e.result && e.result !== 'pending');
    const perfect = finished.filter((e) => e.result === 'win').length;
    const partial = finished.filter((e) => e.result === 'partial').length;
    const loss = finished.filter((e) => e.result === 'loss').length;
    const rate = finished.length > 0 ? Math.round((perfect / finished.length) * 100) : 0;

    // Calculate current streak (consecutive perfect days from latest)
    const sorted = [...finished].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    let best = 0;
    let tempStreak = 0;
    for (const e of sorted) {
      if (e.result === 'win') {
        if (streak === tempStreak) streak++; // ongoing
        tempStreak++;
        best = Math.max(best, tempStreak);
      } else {
        if (streak === tempStreak && tempStreak > 0) { /* streak already captured */ }
        tempStreak = 0;
      }
    }

    return {
      totalDays: finished.length,
      perfectDays: perfect,
      partialDays: partial,
      lossDays: loss,
      perfectRate: rate,
      currentStreak: streak,
      bestStreak: best,
    };
  } catch {
    return emptyStats();
  }
}

function emptyStats(): ChallengeStats {
  return { totalDays: 0, perfectDays: 0, partialDays: 0, lossDays: 0, perfectRate: 0, currentStreak: 0, bestStreak: 0 };
}

export async function getConsecutiveWinCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return 0;
    const history: DailyEntry[] = JSON.parse(raw);
    const resolved = history
      .filter((e) => e.submitted && e.result && e.result !== 'pending')
      .sort((a, b) => b.date.localeCompare(a.date));
    let count = 0;
    for (const e of resolved) {
      if (e.result === 'win') count++;
      else break;
    }
    return count;
  } catch { return 0; }
}

// ─── COIN AWARDS ──────────────────────────────────────────────────────────────
export const COIN_AWARDS = {
  perfect: 25,  // 3/3 correct
  partial: 10,  // 1-2 correct
  perfectWeek: 100, // 7 consecutive perfect days
} as const;

export async function awardChallengeCoins(
  userId: string,
  result: SettlementStatus,
): Promise<{ awarded: number; newBalance: number }> {
  const amount = result === 'win' ? COIN_AWARDS.perfect : result === 'partial' ? COIN_AWARDS.partial : 0;
  if (amount === 0) return { awarded: 0, newBalance: 0 };

  try {
    const supabase = getSupabaseClient();
    await supabase.rpc('add_user_coins', { p_user_id: userId, p_amount: amount });
    const { data } = await supabase.from('user_coins').select('balance').eq('user_id', userId).maybeSingle();
    return { awarded: amount, newBalance: (data as any)?.balance ?? 0 };
  } catch {
    return { awarded: 0, newBalance: 0 };
  }
}

export async function checkAndAwardPerfectWeekBonus(
  userId: string,
): Promise<{ awarded: boolean; newBalance: number }> {
  const streakCount = await getConsecutiveWinCount();
  if (streakCount < 7) return { awarded: false, newBalance: 0 };

  // Check if we already awarded today's perfect-week bonus (prevent double-award)
  try {
    const supabase = getSupabaseClient();
    const today = getTodayKey();
    const { data: existingClaim } = await supabase
      .from('coin_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_type', 'perfect_week')
      .eq('reference_id', today)
      .maybeSingle();

    if (existingClaim) return { awarded: false, newBalance: 0 };

    // Award bonus and record claim
    await supabase.rpc('add_user_coins', { p_user_id: userId, p_amount: COIN_AWARDS.perfectWeek });
    await supabase.from('coin_claims').insert({
      user_id: userId,
      claim_type: 'perfect_week',
      reference_id: today,
      coins_awarded: COIN_AWARDS.perfectWeek,
    });

    const { data } = await supabase.from('user_coins').select('balance').eq('user_id', userId).maybeSingle();
    return { awarded: true, newBalance: (data as any)?.balance ?? 0 };
  } catch {
    return { awarded: false, newBalance: 0 };
  }
}

// ─── SPORT ICONS (expanded) ───────────────────────────────────────────────────
export const SPORT_CHALLENGE_CONFIG: Record<string, {
  emoji: string;
  outcomes: string[];
  drawPossible: boolean;
  settlementNote: string;
}> = {
  football:         { emoji: '⚽', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  soccer:           { emoji: '⚽', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  basketball:       { emoji: '🏀', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Final score inc. OT' },
  tennis:           { emoji: '🎾', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Match winner' },
  cricket:          { emoji: '🏏', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Match result' },
  baseball:         { emoji: '⚾', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Final score' },
  hockey:           { emoji: '🏒', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'FT result (60 min)' },
  rugby:            { emoji: '🏉', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  rugby_union:      { emoji: '🏉', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  rugby_league:     { emoji: '🏉', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  volleyball:       { emoji: '🏐', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Match winner' },
  handball:         { emoji: '🤾', outcomes: ['Home Win', 'Draw', 'Away Win'], drawPossible: true,  settlementNote: 'Full-time result' },
  mma:              { emoji: '🥊', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Fight winner' },
  boxing:           { emoji: '🥊', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Fight winner' },
  ufc:              { emoji: '🥊', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Fight winner' },
  esports:          { emoji: '🎮', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Match winner' },
  motorsport:       { emoji: '🏎️', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Race podium finish' },
  'american football': { emoji: '🏈', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Final score' },
  nfl:              { emoji: '🏈', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Final score' },
  golf:             { emoji: '⛳', outcomes: ['Home Win', 'Away Win'], drawPossible: false, settlementNote: 'Match play result' },
};

export function getSportChallengeConfig(sport: string) {
  const sp = (sport ?? '').toLowerCase();
  return SPORT_CHALLENGE_CONFIG[sp] ?? {
    emoji: '🏆',
    outcomes: ['Home Win', 'Draw', 'Away Win'],
    drawPossible: true,
    settlementNote: 'Full-time result',
  };
}
