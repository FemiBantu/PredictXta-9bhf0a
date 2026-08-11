/**
 * predictionsFeedService.ts
 *
 * Client-side service for the predictions-feed edge function.
 * Provides a typed API with in-memory + AsyncStorage caching,
 * stale-while-revalidate, and pagination helpers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PredictionFeedItem {
  // Match
  matchId:       string;
  sport:         string;
  homeTeam:      string;
  awayTeam:      string;
  homeLogo:      string | null;
  awayLogo:      string | null;
  leagueLogo:    string | null;
  league:        string;
  country:       string;
  status:        'upcoming' | 'live' | 'finished';
  matchTime:     string;
  minute:        number;
  homeScore:     number;
  awayScore:     number;
  homeForm:      string[];
  awayForm:      string[];
  round:         string | null;
  // Prediction
  predictionId:        string | null;
  hasPrediction:       boolean;
  homeWinProb:         number | null;
  drawProb:            number | null;
  awayWinProb:         number | null;
  predictedResult:     'home_win' | 'draw' | 'away_win' | null;
  confidence:          number | null;
  overUnder:           'over' | 'under' | null;
  overUnderLine:       number | null;
  btts:                'yes' | 'no' | null;
  correctScore:        string | null;
  predictedHomeGoals:  number | null;
  predictedAwayGoals:  number | null;
  cornersOverUnder:    'over' | 'under' | null;
  cornersLine:         number | null;
  cardsTotal:          number | null;
  cardsOverUnder:      'over' | 'under' | null;
  asianHandicapLine:   number | null;
  asianHandicapPick:   'home' | 'away' | null;
  htResult:            'home_win' | 'draw' | 'away_win' | null;
  firstGoal:           'home' | 'away' | 'no_goal' | null;
  keyFactors:          string[];
  aiAnalysis:          string | null;
  // VIP (null if not VIP)
  riskLevel:           'Low' | 'Medium' | 'High' | null;
  valueScore:          number | null;
  marketEdgePct:       number | null;
  sharpSignal:         'bullish' | 'neutral' | 'bearish' | null;
  suggestedStake:      'low' | 'medium' | 'high' | null;
  warningFlags:        string[];
  keyAlphaMetric:      string | null;
  // Outcome badge
  outcomeResolved:     boolean;
  outcomeCorrect:      boolean | null;
  brierScore:          number | null;
  // Odds
  homeOdds:    number | null;
  drawOdds:    number | null;
  awayOdds:    number | null;
  bookmaker:   string | null;
}

export interface PredictionsFeedPagination {
  page:    number;
  limit:   number;
  total:   number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PredictionsFeedMeta {
  generatedAt:    string;
  sport:          string;
  status:         string;
  date:           string;
  sort:           string;
  liveCount:      number;
  predictedCount: number;
  totalMatches:   number;
  outcomeStats: {
    total:        number;
    correct:      number;
    accuracy_pct: number;
  };
  fromCache?: boolean;
  cacheAgeMs?: number;
}

export interface PredictionsFeedResult {
  items:      PredictionFeedItem[];
  pagination: PredictionsFeedPagination;
  meta:       PredictionsFeedMeta;
  error?:     string;
}

export type FeedSortMode    = 'time' | 'confidence' | 'value';
export type FeedStatusMode  = 'all' | 'upcoming' | 'live' | 'finished';
export type FeedResultMode  = 'all' | 'home_win' | 'draw' | 'away_win';
export type FeedOUMode      = 'all' | 'over' | 'under';
export type FeedBTTSMode    = 'all' | 'yes' | 'no';

export interface FetchPredictionsFeedOptions {
  sport?:          string;
  status?:         FeedStatusMode;
  date?:           string;         // YYYY-MM-DD or 'today'|'yesterday'|'tomorrow' or numeric offset
  page?:           number;
  limit?:          number;
  sort?:           FeedSortMode;
  minConf?:        number;
  result?:         FeedResultMode;
  ou?:             FeedOUMode;
  btts?:           FeedBTTSMode;
  league?:         string;
  country?:        string;
  isVip?:          boolean;
  includeOutcome?: boolean;
  // Cache control
  bypassCache?:    boolean;
  onFresh?:        (result: PredictionsFeedResult) => void;
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_PREFIX    = '@pf/feed_v2_';
const CACHE_TS_PREFIX = '@pf/ts_v2_';
const STALE_MS        = 90_000; // 90 seconds

function cacheKey(opts: FetchPredictionsFeedOptions): string {
  return `${CACHE_PREFIX}${opts.sport ?? 'all'}_${opts.status ?? 'all'}_${opts.date ?? 'today'}_${opts.sort ?? 'time'}_${opts.page ?? 1}_${opts.minConf ?? 0}_${opts.result ?? 'all'}_${opts.ou ?? 'all'}_${opts.btts ?? 'all'}`;
}

async function readCache(key: string): Promise<PredictionsFeedResult | null> {
  try {
    const [raw, tsRaw] = await Promise.all([
      AsyncStorage.getItem(key),
      AsyncStorage.getItem(key.replace(CACHE_PREFIX, CACHE_TS_PREFIX)),
    ]);
    if (!raw) return null;
    const result: PredictionsFeedResult = JSON.parse(raw);
    const ageMs = tsRaw ? Date.now() - parseInt(tsRaw, 10) : Infinity;
    result.meta.fromCache  = true;
    result.meta.cacheAgeMs = ageMs;
    return result;
  } catch {
    return null;
  }
}

async function writeCache(key: string, result: PredictionsFeedResult): Promise<void> {
  try {
    const tsKey = key.replace(CACHE_PREFIX, CACHE_TS_PREFIX);
    await Promise.all([
      AsyncStorage.setItem(key, JSON.stringify(result)),
      AsyncStorage.setItem(tsKey, String(Date.now())),
    ]);
  } catch { /* silent */ }
}

async function isCacheFresh(key: string): Promise<boolean> {
  try {
    const tsKey = key.replace(CACHE_PREFIX, CACHE_TS_PREFIX);
    const raw = await AsyncStorage.getItem(tsKey);
    if (!raw) return false;
    return Date.now() - parseInt(raw, 10) < STALE_MS;
  } catch {
    return false;
  }
}

// ─── Empty result ─────────────────────────────────────────────────────────────
const EMPTY_RESULT: PredictionsFeedResult = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, hasNext: false, hasPrev: false },
  meta: {
    generatedAt: new Date().toISOString(),
    sport: 'all', status: 'all', date: 'today', sort: 'time',
    liveCount: 0, predictedCount: 0, totalMatches: 0,
    outcomeStats: { total: 0, correct: 0, accuracy_pct: 0 },
  },
};

// ─── Core fetch ───────────────────────────────────────────────────────────────
async function fetchFromEdge(opts: FetchPredictionsFeedOptions): Promise<PredictionsFeedResult> {
  try {
    const params = new URLSearchParams();
    if (opts.sport && opts.sport !== 'all') params.set('sport', opts.sport);
    if (opts.status && opts.status !== 'all') params.set('status', opts.status);
    if (opts.date)   params.set('date',    opts.date);
    if (opts.page)   params.set('page',    String(opts.page));
    if (opts.limit)  params.set('limit',   String(opts.limit));
    if (opts.sort)   params.set('sort',    opts.sort);
    if (opts.minConf && opts.minConf > 0) params.set('min_conf', String(opts.minConf));
    if (opts.result && opts.result !== 'all') params.set('result', opts.result);
    if (opts.ou && opts.ou !== 'all')         params.set('ou',     opts.ou);
    if (opts.btts && opts.btts !== 'all')     params.set('btts',   opts.btts);
    if (opts.league)  params.set('league',  opts.league);
    if (opts.country) params.set('country', opts.country);
    if (opts.isVip)   params.set('is_vip',  'true');
    if (opts.includeOutcome === false) params.set('include_outcome', 'false');

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('predictions-feed', {
      body: Object.fromEntries(params.entries()),
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await (error as any).context?.text()) || msg; } catch { /* ignore */ }
      }
      return { ...EMPTY_RESULT, error: msg };
    }

    if (!data?.items) return { ...EMPTY_RESULT, error: 'Empty response' };

    return {
      items:      data.items as PredictionFeedItem[],
      pagination: data.pagination as PredictionsFeedPagination,
      meta:       { ...(data.meta as PredictionsFeedMeta), fromCache: false },
    };
  } catch (e) {
    return { ...EMPTY_RESULT, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * fetchPredictionsFeed — stale-while-revalidate:
 * Returns cached data instantly, then fetches fresh in background.
 */
export async function fetchPredictionsFeed(
  opts: FetchPredictionsFeedOptions = {},
): Promise<PredictionsFeedResult> {
  const key     = cacheKey(opts);
  const cached  = await readCache(key);
  const fresh   = cached ? await isCacheFresh(key) : false;

  if (cached && fresh && !opts.bypassCache) return cached;

  if (cached && !opts.bypassCache) {
    // Stale — return immediately, background revalidate
    fetchFromEdge(opts).then(async (result) => {
      await writeCache(key, result);
      opts.onFresh?.(result);
    }).catch(() => { /* silent */ });
    return cached;
  }

  // No cache or bypass — synchronous fetch
  const result = await fetchFromEdge(opts);
  if (!result.error) await writeCache(key, result);
  return result;
}

/**
 * invalidatePredictionsFeedCache — wipes all predictions feed cache keys.
 * Call after generating new predictions.
 */
export async function invalidatePredictionsFeedCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const feedKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX) || k.startsWith(CACHE_TS_PREFIX));
    if (feedKeys.length > 0) await AsyncStorage.multiRemove(feedKeys);
  } catch { /* silent */ }
}

/**
 * groupFeedItemsByCountry — groups feed items into the nested
 * Country → League → Match hierarchy used by the predictions tab.
 */
export function groupFeedItemsByCountry(items: PredictionFeedItem[]): CountryGroup[] {
  const countryMap = new Map<string, Map<string, PredictionFeedItem[]>>();

  for (const item of items) {
    const country = item.country || 'International';
    const league  = item.league  || 'Unknown League';

    if (!countryMap.has(country)) countryMap.set(country, new Map());
    const leagueMap = countryMap.get(country)!;
    if (!leagueMap.has(league)) leagueMap.set(league, []);
    leagueMap.get(league)!.push(item);
  }

  const groups: CountryGroup[] = [];
  for (const [country, leagueMap] of countryMap) {
    const leagues: LeagueGroup[] = [];
    for (const [league, matches] of leagueMap) {
      leagues.push({
        leagueName:  league,
        leagueLogo:  matches[0].leagueLogo ?? null,
        sport:       matches[0].sport,
        matches,
        liveCount:   matches.filter((m) => m.status === 'live').length,
        predCount:   matches.filter((m) => m.hasPrediction).length,
      });
    }
    // Sort leagues: live first
    leagues.sort((a, b) => b.liveCount - a.liveCount || a.leagueName.localeCompare(b.leagueName));

    const allMatches = leagues.flatMap((l) => l.matches);
    groups.push({
      country,
      flag:         guessFlag(country),
      leagues,
      totalMatches: allMatches.length,
      totalLive:    allMatches.filter((m) => m.status === 'live').length,
      hasPredictions: allMatches.some((m) => m.hasPrediction),
    });
  }

  // Sort groups: live first, then alphabetical
  groups.sort((a, b) => b.totalLive - a.totalLive || a.country.localeCompare(b.country));
  return groups;
}

export interface LeagueGroup {
  leagueName:  string;
  leagueLogo:  string | null;
  sport:       string;
  matches:     PredictionFeedItem[];
  liveCount:   number;
  predCount:   number;
}

export interface CountryGroup {
  country:        string;
  flag:           string;
  leagues:        LeagueGroup[];
  totalMatches:   number;
  totalLive:      number;
  hasPredictions: boolean;
}

/** Basic flag guesser — maps common country names to flag emojis */
function guessFlag(country: string): string {
  const c = country.toLowerCase();
  const map: Record<string, string> = {
    england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', spain: '🇪🇸', germany: '🇩🇪', france: '🇫🇷', italy: '🇮🇹',
    portugal: '🇵🇹', netherlands: '🇳🇱', brazil: '🇧🇷', argentina: '🇦🇷', usa: '🇺🇸',
    'united states': '🇺🇸', turkey: '🇹🇷', russia: '🇷🇺', ukraine: '🇺🇦', belgium: '🇧🇪',
    scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', mexico: '🇲🇽', japan: '🇯🇵', china: '🇨🇳',
    australia: '🇦🇺', india: '🇮🇳', 'south korea': '🇰🇷', canada: '🇨🇦', sweden: '🇸🇪',
    norway: '🇳🇴', denmark: '🇩🇰', switzerland: '🇨🇭', austria: '🇦🇹', greece: '🇬🇷',
    croatia: '🇭🇷', serbia: '🇷🇸', poland: '🇵🇱', czech: '🇨🇿', romania: '🇷🇴',
    international: '🌍', world: '🌍', europe: '🇪🇺',
  };
  for (const [key, emoji] of Object.entries(map)) {
    if (c.includes(key)) return emoji;
  }
  return '🌍';
}

/**
 * getSportEmoji — returns the emoji for a sport string
 */
export function getSportEmoji(sport: string): string {
  const map: Record<string, string> = {
    football: '⚽', soccer: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
    mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉', handball: '🤾',
    volleyball: '🏐', esports: '🎮', boxing: '🥊', cycling: '🚴', golf: '⛳',
  };
  return map[sport?.toLowerCase()] ?? '🏆';
}

/**
 * getPredictionLabel — human-readable prediction label
 */
export function getPredictionLabel(item: PredictionFeedItem): string | null {
  if (!item.predictedResult) return null;
  if (item.predictedResult === 'home_win') return item.homeTeam;
  if (item.predictedResult === 'away_win') return item.awayTeam;
  return 'Draw';
}

/**
 * getConfidenceColor — returns a hex color for a confidence value
 */
export function getConfidenceColor(conf: number | null): string {
  if (!conf) return '#9CA3AF';
  if (conf >= 80) return '#22C55E';
  if (conf >= 65) return '#EAB308';
  return '#F97316';
}

/**
 * filterFeedItems — client-side filter (for instant response while awaiting API)
 */
export function filterFeedItems(
  items: PredictionFeedItem[],
  filters: {
    result?: FeedResultMode;
    ou?: FeedOUMode;
    btts?: FeedBTTSMode;
    minConf?: number;
  },
): PredictionFeedItem[] {
  let out = items;
  if (filters.result && filters.result !== 'all') out = out.filter((i) => i.predictedResult === filters.result);
  if (filters.ou && filters.ou !== 'all')         out = out.filter((i) => i.overUnder === filters.ou);
  if (filters.btts && filters.btts !== 'all')     out = out.filter((i) => i.btts === filters.btts);
  if (filters.minConf && filters.minConf > 0)     out = out.filter((i) => (i.confidence ?? 0) >= filters.minConf!);
  return out;
}
