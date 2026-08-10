/**
 * matchStatsService.ts
 *
 * Fetches and caches detailed match statistics for the AI Picks inline cards.
 * Data sources: Supabase matches table (stats JSONB), match_events, odds.
 *
 * Supports three match states:
 *  - upcoming  → team stats, odds, standings context
 *  - live      → live score, match events, in-play stats, momentum
 *  - finished  → final stats, prediction accuracy, match summary
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_VERSION = 'v2';
const CACHE_TTL_LIVE = 30_000;       // 30s for live matches
const CACHE_TTL_UPCOMING = 120_000;  // 2min for upcoming
const CACHE_TTL_FINISHED = 600_000;  // 10min for finished

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface MatchEvent {
  id: string;
  matchId: string;
  eventType: 'Goal' | 'Yellow Card' | 'Red Card' | 'Substitution' | 'Penalty' | 'Missed Penalty' | 'Own Goal' | string;
  playerName: string;
  assistName: string | null;
  team: string;
  isHomeTeam: boolean;
  minute: number;
  extraMinute: number | null;
  detail: string | null;
  comments: string | null;
}

export interface MatchOdds {
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  over25: number | null;
  under25: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  homeHandicap: number | null;
  awayHandicap: number | null;
  handicapLine: number | null;
  bookmaker: string;
  lastUpdated: string | null;
}

export interface LiveMatchStats {
  // Possession
  homePossession: number | null;
  awayPossession: number | null;
  // Shots
  homeShots: number | null;
  awayShots: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  // Cards
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  // Corners
  homeCorners: number | null;
  awayCorners: number | null;
  // Fouls
  homeFouls: number | null;
  awayFouls: number | null;
  // xG (expected goals)
  homeXG: number | null;
  awayXG: number | null;
  // Passes
  homePasses: number | null;
  awayPasses: number | null;
  homePassAccuracy: number | null;
  awayPassAccuracy: number | null;
  // Offsides
  homeOffsides: number | null;
  awayOffsides: number | null;
}

export interface DetailedMatchData {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  minute: number;
  stats: LiveMatchStats;
  events: MatchEvent[];
  odds: MatchOdds | null;
  fetchedAt: number;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
const memCache = new Map<string, { data: DetailedMatchData; ts: number }>();

function getCacheTTL(status: string): number {
  if (status === 'live') return CACHE_TTL_LIVE;
  if (status === 'finished') return CACHE_TTL_FINISHED;
  return CACHE_TTL_UPCOMING;
}

function cacheKey(matchId: string): string {
  return `@predictxta/match_detail_${CACHE_VERSION}_${matchId}`;
}

async function readCache(matchId: string): Promise<DetailedMatchData | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.data ?? null;
  } catch { return null; }
}

async function writeCache(matchId: string, data: DetailedMatchData): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(matchId), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* non-blocking */ }
}

// ─── Stats parser from JSONB ──────────────────────────────────────────────────
function parseStatsFromJsonb(stats: any): LiveMatchStats {
  if (!stats) return emptyStats();
  const get = (stat: string): number | null => {
    const v = stats[stat];
    if (v === null || v === undefined || v === '' || v === 'null') return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return isNaN(n) ? null : n;
  };
  return {
    homePossession: get('home_possession') ?? get('home_ball_possession'),
    awayPossession: get('away_possession') ?? get('away_ball_possession'),
    homeShots: get('home_shots') ?? get('home_total_shots'),
    awayShots: get('away_shots') ?? get('away_total_shots'),
    homeShotsOnTarget: get('home_shots_on_target') ?? get('home_shots_on_goal'),
    awayShotsOnTarget: get('away_shots_on_target') ?? get('away_shots_on_goal'),
    homeYellowCards: get('home_yellow_cards'),
    awayYellowCards: get('away_yellow_cards'),
    homeRedCards: get('home_red_cards'),
    awayRedCards: get('away_red_cards'),
    homeCorners: get('home_corners'),
    awayCorners: get('away_corners'),
    homeFouls: get('home_fouls'),
    awayFouls: get('away_fouls'),
    homeXG: get('home_xg') ?? get('home_expected_goals'),
    awayXG: get('away_xg') ?? get('away_expected_goals'),
    homePasses: get('home_passes') ?? get('home_total_passes'),
    awayPasses: get('away_passes') ?? get('away_total_passes'),
    homePassAccuracy: get('home_pass_accuracy'),
    awayPassAccuracy: get('away_pass_accuracy'),
    homeOffsides: get('home_offsides'),
    awayOffsides: get('away_offsides'),
  };
}

function emptyStats(): LiveMatchStats {
  return {
    homePossession: null, awayPossession: null,
    homeShots: null, awayShots: null,
    homeShotsOnTarget: null, awayShotsOnTarget: null,
    homeYellowCards: null, awayYellowCards: null,
    homeRedCards: null, awayRedCards: null,
    homeCorners: null, awayCorners: null,
    homeFouls: null, awayFouls: null,
    homeXG: null, awayXG: null,
    homePasses: null, awayPasses: null,
    homePassAccuracy: null, awayPassAccuracy: null,
    homeOffsides: null, awayOffsides: null,
  };
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────
export async function fetchDetailedMatchData(
  matchId: string,
  status: string,
  forceRefresh = false,
): Promise<DetailedMatchData | null> {
  // L1: Memory cache
  const mem = memCache.get(matchId);
  const ttl = getCacheTTL(status);
  if (!forceRefresh && mem && Date.now() - mem.ts < ttl) {
    return mem.data;
  }

  try {
    const supabase = getSupabaseClient();
    // fetch started (internal)

    // Fetch all data in parallel
    const [matchRes, eventsRes, oddsRes] = await Promise.allSettled([
      supabase
        .from('matches')
        .select('id, home_team, away_team, home_score, away_score, status, minute, stats')
        .eq('id', matchId)
        .maybeSingle(),
      supabase
        .from('match_events')
        .select('id, match_id, event_type, player_name, assist_name, team, is_home_team, minute, extra_minute, detail, comments')
        .eq('match_id', matchId)
        .order('minute', { ascending: true })
        .limit(50),
      supabase
        .from('odds')
        .select('home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, home_handicap, away_handicap, handicap_line, bookmaker, last_updated')
        .eq('match_id', matchId)
        .order('last_updated', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const matchRow = matchRes.status === 'fulfilled' ? matchRes.value.data : null;
    const eventRows = eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []) : [];
    const oddsRow = oddsRes.status === 'fulfilled' ? oddsRes.value.data : null;

    const stats = parseStatsFromJsonb(matchRow?.stats);

    const events: MatchEvent[] = (eventRows as any[]).map((e) => ({
      id: e.id,
      matchId: e.match_id,
      eventType: e.event_type,
      playerName: e.player_name || '',
      assistName: e.assist_name ?? null,
      team: e.team || '',
      isHomeTeam: e.is_home_team ?? true,
      minute: Number(e.minute ?? 0),
      extraMinute: e.extra_minute ? Number(e.extra_minute) : null,
      detail: e.detail ?? null,
      comments: e.comments ?? null,
    }));

    const odds: MatchOdds | null = oddsRow ? {
      homeWin: oddsRow.home_win ? Number(oddsRow.home_win) : null,
      draw: oddsRow.draw ? Number(oddsRow.draw) : null,
      awayWin: oddsRow.away_win ? Number(oddsRow.away_win) : null,
      over25: oddsRow.over_2_5 ? Number(oddsRow.over_2_5) : null,
      under25: oddsRow.under_2_5 ? Number(oddsRow.under_2_5) : null,
      bttsYes: oddsRow.btts_yes ? Number(oddsRow.btts_yes) : null,
      bttsNo: oddsRow.btts_no ? Number(oddsRow.btts_no) : null,
      homeHandicap: oddsRow.home_handicap ? Number(oddsRow.home_handicap) : null,
      awayHandicap: oddsRow.away_handicap ? Number(oddsRow.away_handicap) : null,
      handicapLine: oddsRow.handicap_line ? Number(oddsRow.handicap_line) : null,
      bookmaker: oddsRow.bookmaker || 'Bet365',
      lastUpdated: oddsRow.last_updated ?? null,
    } : null;

    const data: DetailedMatchData = {
      matchId,
      homeTeam: matchRow?.home_team ?? '',
      awayTeam: matchRow?.away_team ?? '',
      homeScore: Number(matchRow?.home_score ?? 0),
      awayScore: Number(matchRow?.away_score ?? 0),
      status: matchRow?.status ?? status,
      minute: Number(matchRow?.minute ?? 0),
      stats,
      events,
      odds,
      fetchedAt: Date.now(),
    };

    // data loaded (internal)

    // Update caches
    memCache.set(matchId, { data, ts: Date.now() });
    writeCache(matchId, data); // async, non-blocking

    return data;
  } catch (e) {
    /* non-blocking fetch error */
    // L2: AsyncStorage fallback
    const cached = await readCache(matchId);
    if (cached) return cached;
    return null;
  }
}

/**
 * Invalidate a match from the memory cache (call after sync completes).
 */
export function invalidateMatchCache(matchId: string): void {
  memCache.delete(matchId);
}
