/**
 * services/oddsService.ts
 * Client-side service for fetching odds from the database.
 * API calls are executed server-side only (fetch-odds edge function).
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Helper: extract message from edge-function invocation errors ─────────────
async function edgeFnErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const statusCode = (error.context as any)?.status ?? 500;
      const text = await (error.context as any)?.text?.();
      return `[${statusCode}] ${text || error.message || 'Unknown error'}`;
    } catch {
      return error.message || 'Edge function error';
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface MatchOdds {
  id: string;
  matchId: string;
  bookmaker: string;
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  over25: number | null;
  under25: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  lastUpdated: string;
}

export interface MatchEvent {
  id: string;
  matchId: string;
  eventType: 'goal' | 'card' | 'substitution' | 'var' | 'penalty' | 'missed_penalty';
  playerName: string;
  assistName: string | null;
  team: string;
  isHomeTeam: boolean;
  minute: number;
  extraMinute: number | null;
  detail: string | null;
  comments: string | null;
}

export interface ApiUsageStat {
  id: string;
  providerName: string;
  endpoint: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  lastCalled: string;
  lastError: string | null;
  date: string;
}

export interface LeagueStanding {
  teamName: string;
  teamLogo: string | null;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: string | null;
  description: string | null;
}

/** Fetch odds for a single match from the database */
export async function fetchMatchOdds(matchId: string): Promise<MatchOdds[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('odds')
      .select('*')
      .eq('match_id', matchId)
      .order('bookmaker', { ascending: true });

    if (error || !data) return [];

    return data.map((r: any) => ({
      id: r.id,
      matchId: r.match_id,
      bookmaker: r.bookmaker,
      homeWin: r.home_win ? Number(r.home_win) : null,
      draw: r.draw ? Number(r.draw) : null,
      awayWin: r.away_win ? Number(r.away_win) : null,
      over25: r.over_2_5 ? Number(r.over_2_5) : null,
      under25: r.under_2_5 ? Number(r.under_2_5) : null,
      bttsYes: r.btts_yes ? Number(r.btts_yes) : null,
      bttsNo: r.btts_no ? Number(r.btts_no) : null,
      lastUpdated: r.last_updated,
    }));
  } catch {
    return [];
  }
}

/** Fetch match events (goals, cards, subs) for a match */
export async function fetchMatchEvents(matchId: string): Promise<MatchEvent[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('match_events')
      .select('*')
      .eq('match_id', matchId)
      .order('minute', { ascending: true });

    if (error || !data) return [];

    return data.map((r: any) => ({
      id: r.id,
      matchId: r.match_id,
      eventType: r.event_type,
      playerName: r.player_name ?? '',
      assistName: r.assist_name ?? null,
      team: r.team ?? '',
      isHomeTeam: r.is_home_team ?? true,
      minute: r.minute ?? 0,
      extraMinute: r.extra_minute ?? null,
      detail: r.detail ?? null,
      comments: r.comments ?? null,
    }));
  } catch {
    return [];
  }
}

/** Fetch API usage stats (admin only) */
export async function fetchApiUsageStats(days = 7): Promise<ApiUsageStat[]> {
  try {
    const sb = getSupabaseClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const { data, error } = await sb
      .from('api_usage')
      .select('*')
      .gte('date', cutoffStr)
      .order('last_called', { ascending: false })
      .limit(200);

    if (error || !data) return [];

    return data.map((r: any) => ({
      id: r.id,
      providerName: r.provider_name,
      endpoint: r.endpoint,
      requestCount: r.request_count ?? 0,
      successCount: r.success_count ?? 0,
      errorCount: r.error_count ?? 0,
      lastCalled: r.last_called,
      lastError: r.last_error ?? null,
      date: r.date,
    }));
  } catch {
    return [];
  }
}

/** Fetch league standings from API-synced table */
export async function fetchApiStandings(leagueName: string, season = 2024): Promise<LeagueStanding[]> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('league_standings')
      .select('*')
      .eq('league_name', leagueName)
      .eq('season', season)
      .order('position', { ascending: true })
      .limit(30);

    if (error || !data || data.length === 0) return [];

    return data.map((r: any) => ({
      teamName: r.team_name,
      teamLogo: r.team_logo ?? null,
      position: r.position ?? 0,
      played: r.played ?? 0,
      wins: r.wins ?? 0,
      draws: r.draws ?? 0,
      losses: r.losses ?? 0,
      goalsFor: r.goals_for ?? 0,
      goalsAgainst: r.goals_against ?? 0,
      goalDiff: r.goal_diff ?? 0,
      points: r.points ?? 0,
      form: r.form ?? null,
      description: r.description ?? null,
    }));
  } catch {
    return [];
  }
}

/** Trigger fetch-odds edge function (admin use) */
export async function triggerFetchOdds(mode: 'live' | 'today' | 'all' = 'today'): Promise<{ success: boolean; message: string }> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.functions.invoke('fetch-odds', { body: { mode } });
    if (error) {
      return { success: false, message: await edgeFnErrorMessage(error) };
    }
    return { success: true, message: `Upserted ${data?.upserted ?? 0} odds rows` };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

/** Trigger sync-standings edge function (admin use) */
export async function triggerSyncStandings(opts?: { leagueId?: number; syncPlayers?: boolean }): Promise<{ success: boolean; message: string }> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.functions.invoke('sync-standings', {
      body: { leagueId: opts?.leagueId, syncPlayers: opts?.syncPlayers ?? false },
    });
    if (error) {
      return { success: false, message: await edgeFnErrorMessage(error) };
    }
    return { success: true, message: `Synced ${data?.standings_upserted ?? 0} standings rows` };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

/** Trigger fetch-matches edge function (admin use) */
export async function triggerFetchMatches(mode: 'live' | 'today' | 'all' = 'today', sport = 'all'): Promise<{ success: boolean; message: string }> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.functions.invoke('fetch-matches', { body: { mode, sport } });
    if (error) {
      return { success: false, message: await edgeFnErrorMessage(error) };
    }
    return { success: true, message: `Fetched ${data?.fetched ?? 0} matches, inserted ${data?.inserted ?? 0}` };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}
