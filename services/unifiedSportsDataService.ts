/**
 * services/unifiedSportsDataService.ts
 *
 * Unified Sports Data Service — wraps Supabase queries with
 * sport-agnostic normalised outputs. No frontend code should
 * ever query the DB directly; it goes through this service.
 *
 * All sports are first-class citizens; football is NOT special-cased.
 */

import { getSupabaseClient } from '@/template';
import { getSportDef, isFightSport, isRacketSport, getSportDisplayName } from './sportsRegistry';

// ─── Unified Types ────────────────────────────────────────────────────────────

export interface UnifiedFixture {
  id: string;
  externalId?: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'live' | 'upcoming' | 'finished';
  matchTime: string;
  league: string;
  country: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  leagueLogo?: string | null;
  venue?: string | null;
  minute: number;
  homeForm?: string[];
  awayForm?: string[];
  stats?: Record<string, unknown> | null;
  sourceProvider?: string;
  lastUpdated?: string;
}

export interface UnifiedStanding {
  position: number;
  teamName: string;
  teamLogo?: string | null;
  leagueName: string;
  leagueId?: number;
  sport: string;
  season: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form?: string | null;
  description?: string | null;
}

export interface UnifiedPrediction {
  id: string;
  matchId: string;
  sport: string;
  predictedResult: 'home_win' | 'draw' | 'away_win';
  confidence: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  overUnder: 'over' | 'under';
  overUnderLine: number;
  btts: 'yes' | 'no';
  aiAnalysis?: string | null;
  keyFactors?: string[];
  riskLevel?: string | null;
  valueScore?: number;
  marketEdgePct?: number;
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  matchTime?: string;
  matchStatus?: string;
  createdAt?: string;
}

export interface UnifiedOdds {
  matchId: string;
  bookmaker: string;
  homeWin?: number | null;
  draw?: number | null;
  awayWin?: number | null;
  over25?: number | null;
  under25?: number | null;
  bttsYes?: number | null;
  bttsNo?: number | null;
  lastUpdated?: string;
}

export interface UnifiedPlayerStat {
  playerName: string;
  teamName: string;
  leagueName: string;
  sport: string;
  season: number;
  position?: string;
  goals: number;
  assists: number;
  appearances: number;
  rating?: number | null;
  photo?: string | null;
}

export interface SportCoverage {
  sport: string;
  displayName: string;
  emoji: string;
  liveCount: number;
  upcomingCount: number;
  finishedCount: number;
  predictionCount: number;
  standingsCount: number;
  hasData: boolean;
  lastSyncedAt?: string;
}

// ─── DB Row Mappers ────────────────────────────────────────────────────────────

function rowToFixture(r: Record<string, unknown>): UnifiedFixture {
  return {
    id: r.id as string,
    externalId: r.external_id as string | undefined,
    sport: (r.sport as string) ?? 'football',
    homeTeam: r.home_team as string,
    awayTeam: r.away_team as string,
    homeScore: Number(r.home_score ?? 0),
    awayScore: Number(r.away_score ?? 0),
    status: (r.status as UnifiedFixture['status']) ?? 'upcoming',
    matchTime: r.match_time as string,
    league: (r.league as string) ?? '',
    country: (r.country as string) ?? 'International',
    homeLogo: r.home_logo as string | null,
    awayLogo: r.away_logo as string | null,
    leagueLogo: r.league_logo as string | null,
    venue: r.venue as string | null,
    minute: Number(r.minute ?? 0),
    homeForm: Array.isArray(r.home_form) ? (r.home_form as string[]) : [],
    awayForm: Array.isArray(r.away_form) ? (r.away_form as string[]) : [],
    stats: (r.stats as Record<string, unknown>) ?? null,
    sourceProvider: r.source_provider as string | undefined,
    lastUpdated: r.last_updated as string | undefined,
  };
}

function rowToStanding(r: Record<string, unknown>): UnifiedStanding {
  return {
    position: Number(r.position ?? 1),
    teamName: r.team_name as string,
    teamLogo: r.team_logo as string | null,
    leagueName: r.league_name as string,
    leagueId: r.league_id ? Number(r.league_id) : undefined,
    sport: r.sport as string,
    season: Number(r.season ?? new Date().getFullYear()),
    played: Number(r.played ?? 0),
    wins: Number(r.wins ?? 0),
    draws: Number(r.draws ?? 0),
    losses: Number(r.losses ?? 0),
    goalsFor: Number(r.goals_for ?? 0),
    goalsAgainst: Number(r.goals_against ?? 0),
    goalDiff: Number(r.goal_diff ?? 0),
    points: Number(r.points ?? 0),
    form: r.form as string | null,
    description: r.description as string | null,
  };
}

function rowToPrediction(r: Record<string, unknown>, matchRow?: Record<string, unknown>): UnifiedPrediction {
  return {
    id: r.id as string,
    matchId: r.match_id as string,
    sport: (matchRow?.sport as string) ?? 'football',
    predictedResult: (r.predicted_result as UnifiedPrediction['predictedResult']) ?? 'home_win',
    confidence: Number(r.confidence ?? 65),
    homeWinProb: Number(r.home_win_prob ?? 0.4),
    drawProb: Number(r.draw_prob ?? 0.25),
    awayWinProb: Number(r.away_win_prob ?? 0.35),
    overUnder: (r.over_under as 'over' | 'under') ?? 'over',
    overUnderLine: Number(r.over_under_line ?? 2.5),
    btts: (r.btts as 'yes' | 'no') ?? 'no',
    aiAnalysis: r.ai_analysis as string | null,
    keyFactors: Array.isArray(r.key_factors) ? (r.key_factors as string[]) : [],
    riskLevel: r.risk_level as string | null,
    valueScore: r.value_score ? Number(r.value_score) : undefined,
    marketEdgePct: r.market_edge_pct ? Number(r.market_edge_pct) : undefined,
    homeTeam: matchRow?.home_team as string | undefined,
    awayTeam: matchRow?.away_team as string | undefined,
    league: matchRow?.league as string | undefined,
    matchTime: matchRow?.match_time as string | undefined,
    matchStatus: matchRow?.status as string | undefined,
    createdAt: r.created_at as string | undefined,
  };
}

// ─── Core Service Functions ───────────────────────────────────────────────────

/** Fetch live matches for one or all sports */
export async function getLiveFixtures(sport?: string): Promise<UnifiedFixture[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('matches').select('*').eq('status', 'live').order('match_time', { ascending: true }).limit(100);
  if (sport && sport !== 'all') q = q.eq('sport', sport);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(rowToFixture);
}

/** Fetch upcoming matches for one or all sports */
export async function getUpcomingFixtures(sport?: string, daysAhead = 2): Promise<UnifiedFixture[]> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  // MMA/boxing needs wider window (events every 2 weeks)
  const windowMs = (isFightSport(sport ?? '') ? 30 : daysAhead) * 24 * 60 * 60 * 1000;
  const until = new Date(Date.now() + windowMs).toISOString();
  let q = supabase.from('matches').select('*').eq('status', 'upcoming')
    .gte('match_time', now).lte('match_time', until)
    .order('match_time', { ascending: true }).limit(sport ? 60 : 200);
  if (sport && sport !== 'all') q = q.eq('sport', sport);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(rowToFixture);
}

/** Fetch recent results */
export async function getRecentResults(sport?: string, hoursBack = 24): Promise<UnifiedFixture[]> {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  let q = supabase.from('matches').select('*').eq('status', 'finished')
    .gte('match_time', since)
    .order('match_time', { ascending: false }).limit(50);
  if (sport && sport !== 'all') q = q.eq('sport', sport);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(rowToFixture);
}

/** Fetch standings for one or all sports */
export async function getStandings(sport?: string, leagueName?: string): Promise<UnifiedStanding[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('league_standings').select('*').order('position', { ascending: true }).limit(300);
  if (sport && sport !== 'all') q = q.eq('sport', sport);
  if (leagueName) q = q.eq('league_name', leagueName);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(rowToStanding);
}

/** Fetch predictions for a set of match IDs or all predictions for a sport */
export async function getPredictions(
  matchIds?: string[],
  sport?: string,
  limit = 50,
): Promise<UnifiedPrediction[]> {
  const supabase = getSupabaseClient();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const dayAhead = new Date(now.getTime() + 48 * 3600_000).toISOString();

  // Fetch predictions
  let pq = supabase.from('predictions').select('*').order('confidence', { ascending: false }).limit(limit);
  if (matchIds && matchIds.length > 0) pq = pq.in('match_id', matchIds);
  const { data: preds } = await pq;
  if (!preds || preds.length === 0) return [];

  // Enrich with match data
  const ids = preds.map((r: any) => r.match_id).filter(Boolean);
  const { data: matches } = await supabase.from('matches').select('id,sport,home_team,away_team,league,match_time,status')
    .in('id', ids).gte('match_time', dayAgo).lte('match_time', dayAhead);
  const matchMap = new Map<string, Record<string, unknown>>();
  (matches ?? []).forEach((r: any) => matchMap.set(r.id, r as Record<string, unknown>));

  return preds.map((r: any) => rowToPrediction(r, matchMap.get(r.match_id))).filter((p) => {
    if (sport && sport !== 'all' && p.sport !== sport) return false;
    return true;
  });
}

/** Fetch odds for a match */
export async function getOddsForMatch(matchId: string): Promise<UnifiedOdds[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('odds').select('*').eq('match_id', matchId);
  return (data ?? []).map((r: any) => ({
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
}

/** Fetch top player stats for a sport */
export async function getTopPlayerStats(sport: string, limit = 20): Promise<UnifiedPlayerStat[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('player_stats').select('*').eq('sport', sport)
    .order('goals', { ascending: false }).limit(limit);
  return (data ?? []).map((r: any) => ({
    playerName: r.player_name,
    teamName: r.team_name,
    leagueName: r.league_name,
    sport: r.sport,
    season: Number(r.season ?? 2024),
    position: r.position ?? undefined,
    goals: Number(r.goals ?? 0),
    assists: Number(r.assists ?? 0),
    appearances: Number(r.appearances ?? 0),
    rating: r.rating ? Number(r.rating) : null,
    photo: r.photo ?? null,
  }));
}

/** Get multi-sport coverage snapshot */
export async function getSportCoverage(): Promise<SportCoverage[]> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
  const tomorrow = new Date(Date.now() + 48 * 3600_000).toISOString();

  const [matchData, predData, standData] = await Promise.allSettled([
    supabase.from('matches').select('sport, status, last_updated').gte('match_time', yesterday).lte('match_time', tomorrow),
    supabase.from('predictions').select('match_id').gte('created_at', yesterday),
    supabase.from('league_standings').select('sport').limit(500),
  ]);

  const matches = matchData.status === 'fulfilled' ? (matchData.value.data ?? []) : [];
  const preds = predData.status === 'fulfilled' ? (predData.value.data ?? []) : [];
  const stands = standData.status === 'fulfilled' ? (standData.value.data ?? []) : [];

  // Group by sport
  const sportMap = new Map<string, { live: number; upcoming: number; finished: number; lastSync: string | undefined }>();
  for (const m of matches) {
    const sp = m.sport as string;
    if (!sportMap.has(sp)) sportMap.set(sp, { live: 0, upcoming: 0, finished: 0, lastSync: undefined });
    const entry = sportMap.get(sp)!;
    if (m.status === 'live') entry.live++;
    else if (m.status === 'upcoming') entry.upcoming++;
    else if (m.status === 'finished') entry.finished++;
    if (!entry.lastSync || m.last_updated > entry.lastSync) entry.lastSync = m.last_updated;
  }

  const standSports = new Set(stands.map((s: any) => s.sport as string));

  return Array.from(sportMap.entries()).map(([sport, counts]) => ({
    sport,
    displayName: getSportDisplayName(sport),
    emoji: getSportDef(sport)?.emoji ?? '🏆',
    liveCount: counts.live,
    upcomingCount: counts.upcoming,
    finishedCount: counts.finished,
    predictionCount: preds.length, // simplified; ideally per-sport join
    standingsCount: standSports.has(sport) ? 1 : 0,
    hasData: counts.live + counts.upcoming + counts.finished > 0,
    lastSyncedAt: counts.lastSync,
  })).sort((a, b) => b.liveCount - a.liveCount || b.upcomingCount - a.upcomingCount);
}

/** Get head-to-head records for two teams */
export async function getHeadToHead(
  homeTeam: string,
  awayTeam: string,
  sport: string,
  limit = 10,
): Promise<UnifiedFixture[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('matches').select('*')
    .eq('sport', sport).eq('status', 'finished')
    .or(`and(home_team.eq.${homeTeam},away_team.eq.${awayTeam}),and(home_team.eq.${awayTeam},away_team.eq.${homeTeam})`)
    .order('match_time', { ascending: false }).limit(limit);
  return (data ?? []).map(rowToFixture);
}

/** Fetch a single fixture by ID */
export async function getFixtureById(id: string): Promise<UnifiedFixture | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('matches').select('*').eq('id', id).single();
  return data ? rowToFixture(data) : null;
}

/** Fetch news articles for a sport */
export async function getSportNews(sport: string, limit = 20) {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('news_articles').select('*').eq('sport', sport)
    .order('published_at', { ascending: false }).limit(limit);
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string | null,
    imageUrl: r.image_url as string | null,
    url: r.url as string | null,
    league: r.league as string | null,
    publishedAt: r.published_at as string,
    category: r.category as string | null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  }));
}

export default {
  getLiveFixtures,
  getUpcomingFixtures,
  getRecentResults,
  getStandings,
  getPredictions,
  getOddsForMatch,
  getTopPlayerStats,
  getSportCoverage,
  getHeadToHead,
  getFixtureById,
  getSportNews,
};
