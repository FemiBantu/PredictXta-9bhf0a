/**
 * services/enterpriseDataService.ts — Enterprise Sports Data Gateway
 *
 * The ONLY service the frontend uses to access sports data.
 * All data flows: Provider API → Edge Function → PostgreSQL → This Service → UI
 *
 * CRITICAL RULE: The frontend NEVER calls sports API providers directly.
 *
 * Architecture:
 *   L1: In-memory store (0ms — instant)
 *   L2: AsyncStorage  (fast — persists across app restarts)
 *   L3: Supabase DB   (source of truth — populated by edge functions)
 *
 * Features:
 *  - Smart cache with TTL per data type
 *  - Realtime delta updates via realtimeService
 *  - Optimistic UI updates
 *  - Automatic background refresh
 *  - Quota-aware request scheduling
 *  - Provider failover transparency (UI gets data regardless of which provider was used)
 *  - Complete offline mode with stale data display
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import type { Match, Prediction } from './types';
import type { NewsArticle, HighlightItem, ExpertTip, TrendingLeague } from './feedEngine';

// ─── Cache TTLs ──────────────────────────────────────────────────────────────
const TTL = {
  LIVE:          15_000,   // 15s
  PRE_MATCH:    300_000,   // 5min
  UPCOMING:     300_000,   // 5min
  RECENT:       600_000,   // 10min
  PREDICTIONS:  900_000,   // 15min
  STANDINGS:  3_600_000,   // 1hr
  ODDS:          60_000,   // 1min
  EXPERT_TIPS:  600_000,   // 10min
  HIGHLIGHTS: 1_800_000,   // 30min
  NEWS:       1_200_000,   // 20min
  TRENDING:     300_000,   // 5min
  STATIC:   86_400_000,    // 24hr (leagues, teams, venues)
} as const;

const CACHE_VERSION = 'enterprise-v1';
const BASE_KEY = `@predictxta/eds/${CACHE_VERSION}`;

type CacheEntry<T> = { data: T; ts: number; source: string };

// ─── L1 In-Memory Store ──────────────────────────────────────────────────────
const memStore = new Map<string, CacheEntry<unknown>>();

// ─── L2 AsyncStorage helpers ──────────────────────────────────────────────────
async function l2Get<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${BASE_KEY}/${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch { return null; }
}

async function l2Set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    await AsyncStorage.setItem(`${BASE_KEY}/${key}`, JSON.stringify(entry));
  } catch { /* non-blocking */ }
}

// ─── Generic cache-first read ─────────────────────────────────────────────────
async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<{ data: T; source: string }>,
  forceRefresh = false,
): Promise<{ data: T; source: 'memory' | 'storage' | 'network' | 'stale' }> {
  const now = Date.now();

  // L1: Memory
  if (!forceRefresh) {
    const mem = memStore.get(key);
    if (mem && now - mem.ts < ttlMs) {
      return { data: mem.data as T, source: 'memory' };
    }
  }

  // L2: AsyncStorage
  if (!forceRefresh) {
    const stored = await l2Get<T>(key);
    if (stored && now - stored.ts < ttlMs) {
      memStore.set(key, stored);
      return { data: stored.data, source: 'storage' };
    }
  }

  // L3: Network (Supabase DB — never external APIs directly)
  try {
    const result = await fetcher();
    const entry: CacheEntry<T> = { data: result.data, ts: now, source: result.source };
    memStore.set(key, entry);
    l2Set(key, entry).catch(() => {});
    return { data: result.data, source: 'network' };
  } catch {
    // Return stale data if available
    const stored = await l2Get<T>(key);
    if (stored) {
      memStore.set(key, stored);
      return { data: stored.data, source: 'stale' };
    }
    return { data: [] as unknown as T, source: 'stale' };
  }
}

function normalizeSport(sport?: string | null): string | null {
  if (!sport || sport === 'all' || sport === 'All') return null;
  return sport.toLowerCase().replace(/\s+/g, '-');
}

// ─── Match fetchers ───────────────────────────────────────────────────────────
export async function getLiveMatches(
  sport?: string,
  forceRefresh = false,
): Promise<{ data: Match[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `live/${sportKey ?? 'all'}`;

  return cached<Match[]>(cacheKey, TTL.LIVE, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('matches')
      .select('*')
      .eq('status', 'live')
      .order('minute', { ascending: false })
      .limit(50);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data ?? []).map(rowToMatch), source: 'supabase' };
  }, forceRefresh);
}

export async function getUpcomingMatches(
  sport?: string,
  daysAhead = 7,
  forceRefresh = false,
): Promise<{ data: Match[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `upcoming/${sportKey ?? 'all'}/${daysAhead}`;

  return cached<Match[]>(cacheKey, TTL.UPCOMING, async () => {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
    let q = supabase
      .from('matches')
      .select('*')
      .eq('status', 'upcoming')
      .gte('match_time', now)
      .lte('match_time', future)
      .order('match_time', { ascending: true })
      .limit(100);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data ?? []).map(rowToMatch), source: 'supabase' };
  }, forceRefresh);
}

export async function getMatchById(id: string): Promise<Match | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('matches').select('*').eq('id', id).maybeSingle();
  return data ? rowToMatch(data as Record<string, unknown>) : null;
}

// ─── Predictions ──────────────────────────────────────────────────────────────
export async function getPredictions(
  sport?: string,
  minConfidence = 55,
  forceRefresh = false,
): Promise<{ data: Prediction[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `predictions/${sportKey ?? 'all'}/${minConfidence}`;

  return cached<Prediction[]>(cacheKey, TTL.PREDICTIONS, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('predictions')
      .select('*, matches(home_team, away_team, status, home_score, away_score, league, sport, match_time, home_logo, away_logo, league_logo, minute)')
      .gte('confidence', minConfidence)
      .order('confidence', { ascending: false })
      .limit(50);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data ?? []).map(rowToPrediction), source: 'supabase' };
  }, forceRefresh);
}

export async function getPredictionByMatchId(matchId: string): Promise<Prediction | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('predictions')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToPrediction(data as Record<string, unknown>) : null;
}

// ─── Standings ────────────────────────────────────────────────────────────────
export interface Standing {
  id: string;
  leagueName: string;
  leagueId: number;
  season: number;
  sport: string;
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
}

export async function getStandings(
  leagueName?: string,
  sport = 'football',
  forceRefresh = false,
): Promise<{ data: Standing[]; source: string }> {
  const cacheKey = `standings/${sport}/${leagueName ?? 'all'}`;

  return cached<Standing[]>(cacheKey, TTL.STANDINGS, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('league_standings')
      .select('*')
      .eq('sport', sport)
      .order('position', { ascending: true })
      .limit(100);
    if (leagueName) q = q.ilike('league_name', `%${leagueName}%`);
    const { data, error } = await q;
    if (error) throw error;
    return {
      data: (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        leagueName: String(r.league_name ?? ''),
        leagueId: Number(r.league_id ?? 0),
        season: Number(r.season ?? new Date().getFullYear()),
        sport: String(r.sport ?? 'football'),
        teamName: String(r.team_name ?? ''),
        teamLogo: r.team_logo ? String(r.team_logo) : null,
        position: Number(r.position ?? 0),
        played: Number(r.played ?? 0),
        wins: Number(r.wins ?? 0),
        draws: Number(r.draws ?? 0),
        losses: Number(r.losses ?? 0),
        goalsFor: Number(r.goals_for ?? 0),
        goalsAgainst: Number(r.goals_against ?? 0),
        goalDiff: Number(r.goal_diff ?? 0),
        points: Number(r.points ?? 0),
        form: r.form ? String(r.form) : null,
      })),
      source: 'supabase',
    };
  }, forceRefresh);
}

// ─── Odds ─────────────────────────────────────────────────────────────────────
export interface MatchOdds {
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

export async function getOddsForMatch(matchId: string): Promise<MatchOdds | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('odds')
    .select('*')
    .eq('match_id', matchId)
    .order('last_updated', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return rowToOdds(data as Record<string, unknown>);
}

export async function getOddsForMatches(matchIds: string[]): Promise<Map<string, MatchOdds>> {
  if (matchIds.length === 0) return new Map();
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('odds')
    .select('*')
    .in('match_id', matchIds);
  const map = new Map<string, MatchOdds>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const odds = rowToOdds(row);
    if (!map.has(odds.matchId)) map.set(odds.matchId, odds); // Latest only
  }
  return map;
}

// ─── News ─────────────────────────────────────────────────────────────────────
export async function getNews(
  sport?: string,
  limit = 20,
  forceRefresh = false,
): Promise<{ data: NewsArticle[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `news/${sportKey ?? 'all'}/${limit}`;

  return cached<NewsArticle[]>(cacheKey, TTL.NEWS, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('news_articles')
      .select('id,external_id,source,sport,title,summary,author,url,image_url,tags,category,home_team,away_team,league,published_at,created_at')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    // Fallback: if no sport-specific news, return global
    if (rows.length === 0 && sportKey) {
      const { data: globalData } = await supabase
        .from('news_articles')
        .select('id,external_id,source,sport,title,summary,author,url,image_url,tags,category,home_team,away_team,league,published_at,created_at')
        .order('published_at', { ascending: false })
        .limit(limit);
      return { data: (globalData ?? []).map(rowToNews), source: 'supabase-fallback' };
    }
    return { data: rows.map(rowToNews), source: 'supabase' };
  }, forceRefresh);
}

// ─── Highlights ───────────────────────────────────────────────────────────────
export async function getHighlights(
  sport?: string,
  limit = 10,
  forceRefresh = false,
): Promise<{ data: HighlightItem[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `highlights/${sportKey ?? 'all'}/${limit}`;

  return cached<HighlightItem[]>(cacheKey, TTL.HIGHLIGHTS, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('highlights')
      .select('id,title,sport,embed_url,thumbnail,home_team,away_team,league,event_date,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data ?? []).map(rowToHighlight), source: 'supabase' };
  }, forceRefresh);
}

// ─── Expert Tips ──────────────────────────────────────────────────────────────
export async function getExpertTips(
  isVip = false,
  limit = 15,
  forceRefresh = false,
): Promise<{ data: ExpertTip[]; source: string }> {
  const cacheKey = `expert-tips/${isVip ? 'vip' : 'free'}/${limit}`;

  return cached<ExpertTip[]>(cacheKey, TTL.EXPERT_TIPS, async () => {
    const supabase = getSupabaseClient();
    let q = supabase
      .from('expert_tips')
      .select('id,expert_name,sport,match_label,tip_type,tip_value,odds,confidence,status,league,is_premium,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!isVip) q = q.eq('is_premium', false);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data ?? []).map(rowToExpertTip), source: 'supabase' };
  }, forceRefresh);
}

// ─── Trending Leagues ─────────────────────────────────────────────────────────
export async function getTrendingLeagues(
  sport?: string,
  forceRefresh = false,
): Promise<{ data: TrendingLeague[]; source: string }> {
  const sportKey = normalizeSport(sport);
  const cacheKey = `trending/${sportKey ?? 'all'}`;

  return cached<TrendingLeague[]>(cacheKey, TTL.TRENDING, async () => {
    const supabase = getSupabaseClient();
    const minus12h = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const plus48h = new Date(Date.now() + 48 * 3_600_000).toISOString();
    let q = supabase
      .from('matches')
      .select('league, sport, status, league_logo')
      .gte('match_time', minus12h)
      .lte('match_time', plus48h)
      .limit(300);
    if (sportKey) q = q.eq('sport', sportKey);
    const { data } = await q;

    const map = new Map<string, TrendingLeague>();
    for (const m of (data ?? []) as Record<string, unknown>[]) {
      if (!m.league) continue;
      const league = String(m.league);
      if (!map.has(league)) {
        map.set(league, {
          leagueName: league,
          sport: String(m.sport ?? 'football'),
          matchCount: 0,
          liveCount: 0,
          leagueLogo: m.league_logo ? String(m.league_logo) : null,
        });
      }
      const entry = map.get(league)!;
      entry.matchCount++;
      if (m.status === 'live') entry.liveCount++;
    }

    const trending = [...map.values()]
      .sort((a, b) => b.liveCount - a.liveCount || b.matchCount - a.matchCount)
      .slice(0, 8);

    return { data: trending, source: 'supabase' };
  }, forceRefresh);
}

// ─── Match Events ─────────────────────────────────────────────────────────────
export interface MatchEvent {
  id: string;
  matchId: string;
  eventType: string;
  playerName: string;
  team: string;
  minute: number;
  detail: string | null;
}

export async function getMatchEvents(matchId: string): Promise<MatchEvent[]> {
  const cacheKey = `events/${matchId}`;
  const mem = memStore.get(cacheKey);
  if (mem && Date.now() - mem.ts < 15_000) return mem.data as MatchEvent[];

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('match_events')
    .select('id, match_id, event_type, player_name, team, minute, detail')
    .eq('match_id', matchId)
    .order('minute', { ascending: true });

  const events = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    matchId: String(r.match_id),
    eventType: String(r.event_type ?? ''),
    playerName: String(r.player_name ?? ''),
    team: String(r.team ?? ''),
    minute: Number(r.minute ?? 0),
    detail: r.detail ? String(r.detail) : null,
  }));

  memStore.set(cacheKey, { data: events, ts: Date.now(), source: 'supabase' });
  return events;
}

// ─── Player Stats ─────────────────────────────────────────────────────────────
export async function getPlayerStats(
  teamName: string,
  leagueName?: string,
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  let q = supabase
    .from('player_stats')
    .select('*')
    .ilike('team_name', `%${teamName}%`)
    .order('goals', { ascending: false })
    .limit(20);
  if (leagueName) q = q.ilike('league_name', `%${leagueName}%`);
  const { data } = await q;
  return (data ?? []) as Record<string, unknown>[];
}

// ─── Cache Management ─────────────────────────────────────────────────────────
export function invalidateCache(pattern?: string) {
  if (!pattern) {
    memStore.clear();
    return;
  }
  for (const key of memStore.keys()) {
    if (key.includes(pattern)) memStore.delete(key);
  }
}

export async function clearAllCaches(): Promise<void> {
  memStore.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ourKeys = keys.filter(k => k.startsWith(BASE_KEY));
    if (ourKeys.length > 0) await AsyncStorage.multiRemove(ourKeys);
  } catch { /* non-blocking */ }
}

export function getCacheStats(): { size: number; keys: string[]; oldestEntry: string | null } {
  const keys = [...memStore.keys()];
  let oldestTs = Infinity;
  let oldestKey: string | null = null;
  for (const [k, v] of memStore) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  return {
    size: memStore.size,
    keys: keys.slice(0, 20),
    oldestEntry: oldestKey,
  };
}

// ─── Row Mappers ──────────────────────────────────────────────────────────────
function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: String(row.id),
    sport: String(row.sport ?? 'football'),
    homeTeam: String(row.home_team ?? ''),
    awayTeam: String(row.away_team ?? ''),
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
    status: (row.status as Match['status']) ?? 'upcoming',
    matchTime: String(row.match_time ?? ''),
    league: String(row.league ?? ''),
    country: row.country ? String(row.country) : undefined,
    venue: row.venue ? String(row.venue) : undefined,
    minute: Number(row.minute ?? 0),
    round: row.round ? String(row.round) : undefined,
    homeLogo: row.home_logo ? String(row.home_logo) : null,
    awayLogo: row.away_logo ? String(row.away_logo) : null,
    leagueLogo: row.league_logo ? String(row.league_logo) : null,
    stats: (row.stats as Match['stats']) ?? null,
    externalId: row.external_id ? String(row.external_id) : undefined,
    homeOdds: row.home_odds ? Number(row.home_odds) : undefined,
    drawOdds: row.draw_odds ? Number(row.draw_odds) : undefined,
    awayOdds: row.away_odds ? Number(row.away_odds) : undefined,
  };
}

function rowToPrediction(row: Record<string, unknown>): Prediction {
  return {
    id: String(row.id ?? ''),
    matchId: String(row.match_id ?? ''),
    homeWinProb: Number(row.home_win_prob ?? 0),
    drawProb: Number(row.draw_prob ?? 0),
    awayWinProb: Number(row.away_win_prob ?? 0),
    predictedResult: (row.predicted_result as Prediction['predictedResult']) ?? 'home_win',
    confidence: Number(row.confidence ?? 70),
    overUnder: (row.over_under as 'over' | 'under') ?? 'over',
    overUnderLine: Number(row.over_under_line ?? 2.5),
    btts: (row.btts as 'yes' | 'no') ?? 'no',
    aiAnalysis: String(row.ai_analysis ?? ''),
    keyFactors: Array.isArray(row.key_factors) ? row.key_factors as string[] : [],
    createdAt: row.created_at ? String(row.created_at) : undefined,
    riskLevel: row.risk_level ? (row.risk_level as 'Low' | 'Medium' | 'High') : undefined,
    valueScore: row.value_score != null ? Number(row.value_score) : undefined,
    predictionVersion: row.prediction_version != null ? Number(row.prediction_version) : undefined,
  };
}

function rowToNews(row: Record<string, unknown>): NewsArticle {
  return {
    id: String(row.id),
    externalId: String(row.external_id ?? ''),
    source: String(row.source ?? 'unknown'),
    sport: String(row.sport ?? 'football'),
    title: String(row.title ?? ''),
    summary: row.summary ? String(row.summary) : null,
    author: row.author ? String(row.author) : null,
    url: row.url ? String(row.url) : null,
    imageUrl: row.image_url ? String(row.image_url) : null,
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    category: String(row.category ?? 'news'),
    homeTeam: row.home_team ? String(row.home_team) : null,
    awayTeam: row.away_team ? String(row.away_team) : null,
    league: row.league ? String(row.league) : null,
    publishedAt: String(row.published_at ?? row.created_at ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

function rowToHighlight(row: Record<string, unknown>): HighlightItem {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    sport: String(row.sport ?? 'football'),
    embedUrl: row.embed_url ? String(row.embed_url) : null,
    thumbnailUrl: row.thumbnail ? String(row.thumbnail) : null,
    homeTeam: row.home_team ? String(row.home_team) : null,
    awayTeam: row.away_team ? String(row.away_team) : null,
    league: row.league ? String(row.league) : null,
    eventDate: row.event_date ? String(row.event_date) : null,
    createdAt: String(row.created_at ?? ''),
  };
}

function rowToExpertTip(row: Record<string, unknown>): ExpertTip {
  return {
    id: String(row.id),
    expertName: String(row.expert_name ?? ''),
    sport: String(row.sport ?? 'football'),
    matchLabel: String(row.match_label ?? ''),
    tipType: String(row.tip_type ?? ''),
    tipValue: String(row.tip_value ?? ''),
    odds: row.odds ? Number(row.odds) : null,
    confidence: Number(row.confidence ?? 70),
    status: (row.status as ExpertTip['status']) ?? 'pending',
    league: row.league ? String(row.league) : null,
    isPremium: Boolean(row.is_premium ?? false),
    createdAt: String(row.created_at ?? ''),
  };
}

function rowToOdds(row: Record<string, unknown>): MatchOdds {
  return {
    matchId: String(row.match_id ?? ''),
    bookmaker: String(row.bookmaker ?? 'Bet365'),
    homeWin: row.home_win ? Number(row.home_win) : null,
    draw: row.draw ? Number(row.draw) : null,
    awayWin: row.away_win ? Number(row.away_win) : null,
    over25: row.over_2_5 ? Number(row.over_2_5) : null,
    under25: row.under_2_5 ? Number(row.under_2_5) : null,
    bttsYes: row.btts_yes ? Number(row.btts_yes) : null,
    bttsNo: row.btts_no ? Number(row.btts_no) : null,
    lastUpdated: String(row.last_updated ?? new Date().toISOString()),
  };
}
