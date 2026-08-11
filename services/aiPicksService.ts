/**
 * AI Picks Service
 *
 * Queries the `matches` and `predictions` tables from Supabase,
 * groups them by sport → country → league, and returns structured
 * data for the 3-level drill-down AI Picks screen.
 *
 * v2 fixes:
 * - Date range uses ±12h/36h buffer to handle UTC timezone mismatches
 * - Sport filter normalizes to lowercase-hyphenated DB key ('American Football' → 'american-football')
 * - Fallback to ±24h window when buffered range finds no matches
 * - batchGenerateForDate uses same normalization + wider window
 */

import { getSupabaseClient } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimum data quality thresholds for prediction generation */
const MIN_FORM_ENTRIES = 2;   // at least 2 results in home or away form array
const SUFFICIENT_SPORTS_WITHOUT_FORM = new Set([
  // These sports rarely carry form arrays but still have enough signal
  'tennis', 'mma', 'boxing', 'formula1', 'formula-1', 'motorsports',
  'darts', 'snooker', 'cycling', 'athletics', 'badminton', 'table-tennis',
]);

/** Returns true when a match has enough data to run prediction generation */
function hasEnoughData(row: {
  sport: string;
  home_form?: string[] | null;
  away_form?: string[] | null;
  stats?: Record<string, unknown> | null;
  status?: string;
}): boolean {
  const sport = (row.sport ?? '').toLowerCase();
  // Already finished → no point generating
  if (row.status === 'finished') return false;
  // Sports that carry meaningful stats even without form arrays
  if (SUFFICIENT_SPORTS_WITHOUT_FORM.has(sport)) return true;
  const homeForm = Array.isArray(row.home_form) ? row.home_form : [];
  const awayForm = Array.isArray(row.away_form) ? row.away_form : [];
  // Accept if either side has MIN_FORM_ENTRIES or stats blob exists
  const hasForm = homeForm.length >= MIN_FORM_ENTRIES || awayForm.length >= MIN_FORM_ENTRIES;
  const hasStats = row.stats && Object.keys(row.stats).length > 0;
  return hasForm || !!hasStats;
}

export interface AIPick {
  matchId: string;
  sport: string;
  league: string;
  leagueLogo: string | null;
  country: string;
  flag: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  status: 'upcoming' | 'live' | 'finished';
  matchTime: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  homeForm: string[];
  awayForm: string[];
  round: string | null;
  predictionId: string | null;
  homeWinProb: number | null;
  drawProb: number | null;
  awayWinProb: number | null;
  predictedResult: string | null;
  confidence: number | null;
  overUnder: string | null;
  overUnderLine: number | null;
  predictedHomeGoals: number | null;
  predictedAwayGoals: number | null;
  btts: string | null;
  correctScore: string | null;
  cornersOverUnder: string | null;
  cornersLine: number | null;
  cardsTotal: number | null;
  cardsOverUnder: string | null;
  asianHandicapLine: number | null;
  asianHandicapPick: string | null;
  htResult: string | null;
  htHomeProb: number | null;
  htDrawProb: number | null;
  htAwayProb: number | null;
  cleanSheetHome: string | null;
  cleanSheetAway: string | null;
  firstGoal: string | null;
  bothScoreHt: string | null;
  anytimeScorecast?: string | null;
  aiAnalysis: string | null;
  keyFactors: string[] | null;
  hasPrediction: boolean;
  riskLevel: 'Low' | 'Medium' | 'High' | null;
  valueScore: number | null;
  marketEdgePct: number | null;
  sharpSignal: 'bullish' | 'neutral' | 'bearish' | null;
  suggestedStake: 'low' | 'medium' | 'high' | null;
  warningFlags: string[] | null;
  keyAlphaMetric: string | null;
  /** True when the match lacks sufficient data for AI prediction generation */
  insufficientData?: boolean;
}

export interface AIPicksLeague {
  id: string;
  sport: string;
  country: string;
  flag: string;
  leagueName: string;
  leagueLogo: string | null;
  round: string | null;
  isFavorite: boolean;
  matches: AIPick[];
}

// ─── Sport key normalization ──────────────────────────────────────────────────
// DB stores sports as lowercase-hyphenated: 'football', 'american-football'
// UI sends Title Case or spaces: 'Football', 'American Football', 'Basketball'
const SPORT_KEY_OVERRIDES: Record<string, string> = {
  'american football': 'american-football',
  'americanfootball': 'american-football',
  'nfl': 'american-football',
  'table tennis': 'table-tennis',
  'tabletennis': 'table-tennis',
  'ping pong': 'table-tennis',
  'pingpong': 'table-tennis',
  'ice hockey': 'hockey',
  'icehockey': 'hockey',
  'formula 1': 'formula-1',
  'formula1': 'formula-1',
  'f1': 'formula-1',
  'mma/ufc': 'mma',
  'ufc': 'mma',
  'soccer': 'football',
};

function normalizeSportKey(sport?: string | null): string | null {
  if (!sport || sport === 'All' || sport === 'all') return null;
  const lower = sport.toLowerCase().trim();
  // Check explicit overrides first
  if (SPORT_KEY_OVERRIDES[lower]) return SPORT_KEY_OVERRIDES[lower];
  // Generic: lowercase + replace whitespace with hyphens
  return lower.replace(/\s+/g, '-');
}

// ─── Country → Flag lookup ────────────────────────────────────────────────────
const COUNTRY_FLAG_MAP: Record<string, string> = {
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'Northern Ireland': '🇬🇧', 'Spain': '🇪🇸', 'Germany': '🇩🇪', 'Italy': '🇮🇹',
  'France': '🇫🇷', 'Portugal': '🇵🇹', 'Netherlands': '🇳🇱', 'Belgium': '🇧🇪',
  'Turkey': '🇹🇷', 'Greece': '🇬🇷', 'Russia': '🇷🇺', 'Ukraine': '🇺🇦',
  'Poland': '🇵🇱', 'Czech Republic': '🇨🇿', 'Czechia': '🇨🇿', 'Slovakia': '🇸🇰',
  'Romania': '🇷🇴', 'Hungary': '🇭🇺', 'Bulgaria': '🇧🇬', 'Serbia': '🇷🇸',
  'Croatia': '🇭🇷', 'Slovenia': '🇸🇮', 'Bosnia': '🇧🇦', 'Bosnia and Herzegovina': '🇧🇦',
  'North Macedonia': '🇲🇰', 'Albania': '🇦🇱', 'Kosovo': '🇽🇰', 'Moldova': '🇲🇩',
  'Belarus': '🇧🇾', 'Latvia': '🇱🇻', 'Lithuania': '🇱🇹', 'Estonia': '🇪🇪',
  'Finland': '🇫🇮', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Switzerland': '🇨🇭', 'Austria': '🇦🇹', 'Ireland': '🇮🇪', 'Cyprus': '🇨🇾',
  'Malta': '🇲🇹', 'Iceland': '🇮🇸', 'Georgia': '🇬🇪', 'Armenia': '🇦🇲',
  'Azerbaijan': '🇦🇿', 'Kazakhstan': '🇰🇿', 'Israel': '🇮🇱', 'Europe': '🇪🇺',
  'USA': '🇺🇸', 'United States': '🇺🇸', 'Canada': '🇨🇦', 'Mexico': '🇲🇽',
  'Brazil': '🇧🇷', 'Argentina': '🇦🇷', 'Colombia': '🇨🇴', 'Chile': '🇨🇱',
  'Peru': '🇵🇪', 'Uruguay': '🇺🇾', 'Paraguay': '🇵🇾', 'Bolivia': '🇧🇴',
  'Ecuador': '🇪🇨', 'Venezuela': '🇻🇪', 'Costa Rica': '🇨🇷', 'Honduras': '🇭🇳',
  'Guatemala': '🇬🇹', 'Panama': '🇵🇦', 'Jamaica': '🇯🇲',
  'China': '🇨🇳', 'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'Korea Republic': '🇰🇷',
  'India': '🇮🇳', 'Australia': '🇦🇺', 'New Zealand': '🇳🇿', 'Saudi Arabia': '🇸🇦',
  'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪', 'Qatar': '🇶🇦', 'Kuwait': '🇰🇼',
  'Bahrain': '🇧🇭', 'Oman': '🇴🇲', 'Jordan': '🇯🇴', 'Iran': '🇮🇷', 'Iraq': '🇮🇶',
  'Pakistan': '🇵🇰', 'Bangladesh': '🇧🇩', 'Sri Lanka': '🇱🇰', 'Indonesia': '🇮🇩',
  'Thailand': '🇹🇭', 'Vietnam': '🇻🇳', 'Malaysia': '🇲🇾', 'Singapore': '🇸🇬',
  'Philippines': '🇵🇭',
  'Nigeria': '🇳🇬', 'Ghana': '🇬🇭', 'South Africa': '🇿🇦', 'Egypt': '🇪🇬',
  'Morocco': '🇲🇦', 'Algeria': '🇩🇿', 'Tunisia': '🇹🇳', 'Kenya': '🇰🇪',
  'Ethiopia': '🇪🇹', 'Senegal': '🇸🇳', 'Cameroon': '🇨🇲', 'Ivory Coast': '🇨🇮',
  "Côte d'Ivoire": '🇨🇮', 'Tanzania': '🇹🇿', 'Uganda': '🇺🇬', 'Zimbabwe': '🇿🇼',
  'Zambia': '🇿🇲', 'Angola': '🇦🇴', 'Mozambique': '🇲🇿',
  'International': '🌍', 'World': '🌍',
};

export function flagForCountry(country: string): string {
  return COUNTRY_FLAG_MAP[country] ?? COUNTRY_FLAG_MAP[country.trim()] ?? '🌍';
}

export function inferCountryFromLeague(leagueName: string): { country: string; flag: string } {
  return { country: 'International', flag: '🌍' };
}

const PRIORITY_LEAGUES = new Set([
  'UEFA Champions League', 'UEFA Europa League', 'UEFA Conference League',
  'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1',
  'Eredivisie', 'Primeira Liga', 'NBA', 'ATP', 'IPL', 'UFC',
]);

function isTopLeague(leagueName: string): boolean {
  return PRIORITY_LEAGUES.has(leagueName) ||
    [...PRIORITY_LEAGUES].some((pl) => leagueName.toLowerCase().includes(pl.toLowerCase()));
}

/** Sports that are genuinely off-season / data-sparse — show recent finished matches as context */
const EXTENDED_LOOKAHEAD_SPORTS = new Set([
  'basketball', 'cricket', 'tennis', 'table-tennis', 'badminton',
  'formula1', 'formula-1', 'motorsports', 'cycling', 'athletics',
  'darts', 'snooker', 'esports', 'afl', 'american-football',
]);

// ─── Main Fetcher ─────────────────────────────────────────────────────────────

export async function fetchAIPicks(options: {
  dateOffset: number;
  sport?: string;
}): Promise<AIPicksLeague[]> {
  const { dateOffset, sport } = options;

  // Normalize sport to DB key ('Basketball' → 'basketball', 'American Football' → 'american-football')
  const sportKey = normalizeSportKey(sport);

  // Build date range with ±12h/36h buffer to tolerate UTC timezone mismatches.
  // This ensures matches stored in slightly different UTC offsets still appear
  // on the correct day for the user's local timezone.
  const localToday = new Date();
  localToday.setHours(0, 0, 0, 0);
  const targetDate = new Date(localToday);
  targetDate.setDate(localToday.getDate() + dateOffset);
  const startIso = new Date(targetDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endIso   = new Date(targetDate.getTime() + 36 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch matches for the date range
    let matchQuery = supabase
      .from('matches')
      .select('id, sport, home_team, away_team, home_logo, away_logo, league_logo, league, country, status, match_time, home_score, away_score, minute, home_form, away_form, round, stats')
      .gte('match_time', startIso)
      .lt('match_time', endIso)
      .order('match_time', { ascending: true })
      .limit(200);

    if (sportKey) {
      matchQuery = matchQuery.eq('sport', sportKey);
    }

    let { data: matchRows, error: matchErr } = await matchQuery;

    // Fallback 1: widen to ±24h/48h if the buffered range found nothing
    if (!matchErr && (!matchRows || matchRows.length === 0)) {
      const wideStart = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const wideEnd   = new Date(targetDate.getTime() + 48 * 60 * 60 * 1000).toISOString();
      let wideQuery = supabase
        .from('matches')
        .select('id, sport, home_team, away_team, home_logo, away_logo, league_logo, league, country, status, match_time, home_score, away_score, minute, home_form, away_form, round, stats')
        .gte('match_time', wideStart)
        .lt('match_time', wideEnd)
        .order('match_time', { ascending: true })
        .limit(200);
      if (sportKey) wideQuery = wideQuery.eq('sport', sportKey);
      const { data: wideRows } = await wideQuery;
      matchRows = wideRows;
    }

    // Fallback 2: for sparse/off-season sports widen further to ±7 days
    // to show the closest available fixtures rather than a blank screen
    if (!matchErr && (!matchRows || matchRows.length === 0) && sportKey && EXTENDED_LOOKAHEAD_SPORTS.has(sportKey)) {
      const ultraStart = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const ultraEnd   = new Date(targetDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      let ultraQuery = supabase
        .from('matches')
        .select('id, sport, home_team, away_team, home_logo, away_logo, league_logo, league, country, status, match_time, home_score, away_score, minute, home_form, away_form, round, stats')
        .gte('match_time', ultraStart)
        .lt('match_time', ultraEnd)
        .order('match_time', { ascending: true })
        .limit(100);
      ultraQuery = ultraQuery.eq('sport', sportKey);
      const { data: ultraRows } = await ultraQuery;
      matchRows = ultraRows;
    }

    if (matchErr || !matchRows || matchRows.length === 0) {
      return [];
    }

    const matchIds = matchRows.map((m: any) => m.id as string);

    // 2. Fetch predictions for those matches (batch query)
    const { data: predRows } = await supabase
      .from('predictions')
      .select('id, match_id, home_win_prob, draw_prob, away_win_prob, predicted_result, confidence, over_under, over_under_line, predicted_home_goals, predicted_away_goals, btts, correct_score, corners_over_under, corners_line, cards_total, cards_over_under, asian_handicap_line, asian_handicap_pick, ht_result, ht_home_prob, ht_draw_prob, ht_away_prob, clean_sheet_home, clean_sheet_away, first_goal, both_score_ht, anytime_scorecast, ai_analysis, key_factors, risk_level, value_score, market_edge_pct, sharp_signal, suggested_stake, warning_flags, key_alpha_metric, created_at')
      .in('match_id', matchIds)
      .order('created_at', { ascending: false });

    const predMap = new Map<string, any>();
    for (const pred of (predRows ?? [])) {
      if (!predMap.has(pred.match_id)) predMap.set(pred.match_id, pred);
    }

    // 3. Build league groups
    const leagueMap = new Map<string, AIPicksLeague>();

    for (const row of matchRows) {
      const leagueName: string = row.league || 'Unknown League';
      // Use the raw DB sport value for the key to prevent cross-sport league collisions
      const dbSport: string = (row.sport || 'football').toLowerCase();
      const sportName: string = capitalise(row.sport || 'Football');
      const country: string = row.country && row.country.trim() ? row.country.trim() : 'International';
      const flag: string = flagForCountry(country);
      // Include dbSport in the league key to prevent cross-sport contamination
      const leagueKey = `${dbSport}::${country}::${leagueName}`;

      if (!leagueMap.has(leagueKey)) {
        leagueMap.set(leagueKey, {
          id: leagueKey, sport: sportName, country, flag, // sport here is display name
          leagueName, leagueLogo: row.league_logo ?? null,
          round: row.round ?? null, isFavorite: isTopLeague(leagueName), matches: [],
        });
      }

      const pred = predMap.get(row.id) ?? null;
      const pick: AIPick = {
        matchId: row.id,
        sport: dbSport,
        league: leagueName,
        leagueLogo: row.league_logo ?? null,
        country, flag,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeLogo: row.home_logo ?? null,
        awayLogo: row.away_logo ?? null,
        status: row.status as AIPick['status'],
        matchTime: row.match_time,
        homeScore: row.home_score ?? 0,
        awayScore: row.away_score ?? 0,
        minute: row.minute ?? 0,
        homeForm: Array.isArray(row.home_form) ? row.home_form : [],
        awayForm: Array.isArray(row.away_form) ? row.away_form : [],
        round: row.round ?? null,
        predictionId: pred?.id ?? null,
        homeWinProb: pred ? Number(pred.home_win_prob) : null,
        drawProb: pred ? Number(pred.draw_prob) : null,
        awayWinProb: pred ? Number(pred.away_win_prob) : null,
        predictedResult: pred?.predicted_result ?? null,
        confidence: pred ? Number(pred.confidence) : null,
        overUnder: pred?.over_under ?? null,
        overUnderLine: pred ? Number(pred.over_under_line) : null,
        predictedHomeGoals: pred ? Number(pred.predicted_home_goals) : null,
        predictedAwayGoals: pred ? Number(pred.predicted_away_goals) : null,
        // Football-only fields: only populate for football/rugby/handball to prevent cross-sport contamination
        btts: (dbSport === 'football' || dbSport === 'handball') ? (pred?.btts ?? null) : null,
        correctScore: pred?.correct_score ?? null,
        cornersOverUnder: dbSport === 'football' ? (pred?.corners_over_under ?? null) : null,
        cornersLine: dbSport === 'football' ? (pred?.corners_line != null ? Number(pred.corners_line) : null) : null,
        cardsTotal: dbSport === 'football' ? (pred?.cards_total != null ? Number(pred.cards_total) : null) : null,
        cardsOverUnder: dbSport === 'football' ? (pred?.cards_over_under ?? null) : null,
        asianHandicapLine: pred?.asian_handicap_line != null ? Number(pred.asian_handicap_line) : null,
        asianHandicapPick: pred?.asian_handicap_pick ?? null,
        // HT stats: meaningful for football, rugby, handball only
        htResult: (dbSport === 'football' || dbSport === 'rugby' || dbSport === 'handball') ? (pred?.ht_result ?? null) : null,
        htHomeProb: (dbSport === 'football' || dbSport === 'rugby' || dbSport === 'handball') ? (pred?.ht_home_prob != null ? Number(pred.ht_home_prob) : null) : null,
        htDrawProb: (dbSport === 'football' || dbSport === 'rugby' || dbSport === 'handball') ? (pred?.ht_draw_prob != null ? Number(pred.ht_draw_prob) : null) : null,
        htAwayProb: (dbSport === 'football' || dbSport === 'rugby' || dbSport === 'handball') ? (pred?.ht_away_prob != null ? Number(pred.ht_away_prob) : null) : null,
        cleanSheetHome: dbSport === 'football' ? (pred?.clean_sheet_home ?? null) : null,
        cleanSheetAway: dbSport === 'football' ? (pred?.clean_sheet_away ?? null) : null,
        firstGoal: dbSport === 'football' ? (pred?.first_goal ?? null) : null,
        bothScoreHt: dbSport === 'football' ? (pred?.both_score_ht ?? null) : null,
        anytimeScorecast: dbSport === 'football' ? (pred?.anytime_scorecast ?? null) : null,
        aiAnalysis: pred?.ai_analysis ?? null,
        keyFactors: pred?.key_factors ?? null,
        hasPrediction: pred !== null,
        insufficientData: pred === null && !hasEnoughData({
          sport: row.sport ?? 'football',
          home_form: Array.isArray(row.home_form) ? row.home_form : [],
          away_form: Array.isArray(row.away_form) ? row.away_form : [],
          stats: row.stats ?? null,
          status: row.status,
        }),
        riskLevel: pred
          ? ((pred.risk_level as 'Low' | 'Medium' | 'High') ||
             (Number(pred.confidence) >= 80 ? 'Low' : Number(pred.confidence) >= 60 ? 'Medium' : 'High'))
          : null,
        valueScore: pred?.value_score != null ? Number(pred.value_score) : null,
        marketEdgePct: pred?.market_edge_pct != null ? Number(pred.market_edge_pct) : null,
        sharpSignal: pred?.sharp_signal as 'bullish' | 'neutral' | 'bearish' | null ?? null,
        suggestedStake: pred?.suggested_stake as 'low' | 'medium' | 'high' | null ?? null,
        warningFlags: Array.isArray(pred?.warning_flags) ? pred.warning_flags : null,
        keyAlphaMetric: pred?.key_alpha_metric ?? null,
      };

      leagueMap.get(leagueKey)!.matches.push(pick);
    }

    const leagues = Array.from(leagueMap.values());
    leagues.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.country.localeCompare(b.country);
    });
    return leagues;
  } catch {
    return [];
  }
}

// ─── Batch AI prediction generation ────────────────────────────────────────────
export interface BatchGenResult {
  total: number;
  generated: number;
  failed: number;
  /** Matches skipped because they lacked sufficient data */
  skipped: number;
}

export async function batchGenerateForDate(options: {
  dateOffset: number;
  sport?: string;
  concurrency?: number;
  userId?: string | null;
}): Promise<BatchGenResult> {
  const { dateOffset, sport, concurrency = 5, userId = null } = options;
  const sportKey = normalizeSportKey(sport);

  const localToday = new Date();
  localToday.setHours(0, 0, 0, 0);
  const targetDate = new Date(localToday);
  targetDate.setDate(localToday.getDate() + dateOffset);
  // Use same ±12h/36h buffer for consistency with fetchAIPicks
  const startIso = new Date(targetDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endIso   = new Date(targetDate.getTime() + 36 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = getSupabaseClient();

    let matchQuery = supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, home_score, away_score, status, minute, stats, match_time, home_form, away_form')
      .gte('match_time', startIso)
      .lt('match_time', endIso)
      .limit(200);

    if (sportKey) matchQuery = matchQuery.eq('sport', sportKey);

    const { data: matchRows, error: matchErr } = await matchQuery;
    if (matchErr || !matchRows || matchRows.length === 0) {
      return { total: 0, generated: 0, failed: 0 };
    }

    const matchIds = matchRows.map((m: any) => m.id as string);

    const { data: existingPreds } = await supabase
      .from('predictions')
      .select('match_id')
      .in('match_id', matchIds);

    const alreadyPredicted = new Set<string>(
      (existingPreds ?? []).map((p: any) => p.match_id as string),
    );

    const unpredictedRows = matchRows.filter((m: any) => !alreadyPredicted.has(m.id));
    if (unpredictedRows.length === 0) return { total: 0, generated: 0, failed: 0, skipped: 0 };

    // ── Pre-filter: skip matches without enough data to produce a valid prediction ──
    const needsPrediction: typeof unpredictedRows = [];
    let skipped = 0;
    for (const m of unpredictedRows) {
      if (hasEnoughData({
        sport: m.sport ?? 'football',
        home_form: Array.isArray(m.home_form) ? m.home_form : [],
        away_form: Array.isArray(m.away_form) ? m.away_form : [],
        stats: m.stats ?? null,
        status: m.status,
      })) {
        needsPrediction.push(m);
      } else {
        skipped++;
      }
    }
    if (needsPrediction.length === 0) return { total: 0, generated: 0, failed: 0, skipped };

    let generated = 0;
    let failed = 0;
    const supabaseClient = getSupabaseClient();

    for (let i = 0; i < needsPrediction.length; i += concurrency) {
      const chunk = needsPrediction.slice(i, i + concurrency);
      const chunkIds = chunk.map((r: any) => r.id as string);
      // Also fetch odds for enriched prediction context
      const formMap = new Map<string, { homeForm: string[]; awayForm: string[] }>();
      const oddsMap = new Map<string, { homeWin: number | null; draw: number | null; awayWin: number | null }>();
      try {
        const [formResult, oddsResult] = await Promise.all([
          supabase.from('matches').select('id, home_form, away_form').in('id', chunkIds),
          supabase.from('odds').select('match_id, home_win, draw, away_win').in('match_id', chunkIds).limit(chunkIds.length),
        ]);
        const { data: formRows } = formResult;
        const { data: oddsRows } = oddsResult;
        if (formRows) {
          for (const fr of formRows as any[]) {
            formMap.set(fr.id, {
              homeForm: Array.isArray(fr.home_form) ? fr.home_form : [],
              awayForm: Array.isArray(fr.away_form) ? fr.away_form : [],
            });
          }
        }
        if (oddsRows) {
          for (const or_ of oddsRows as any[]) {
            oddsMap.set(or_.match_id, {
              homeWin: or_.home_win != null ? Number(or_.home_win) : null,
              draw: or_.draw != null ? Number(or_.draw) : null,
              awayWin: or_.away_win != null ? Number(or_.away_win) : null,
            });
          }
        }
      } catch { /* non-blocking */ }

      const results = await Promise.allSettled(
        chunk.map((row: any) => {
          const forms = formMap.get(row.id);
          const odds = oddsMap.get(row.id);
          return supabaseClient.functions.invoke('generate-prediction', {
            body: {
              match: {
                id: row.id, sport: row.sport,
                homeTeam: row.home_team, awayTeam: row.away_team, league: row.league,
                homeScore: row.home_score ?? 0, awayScore: row.away_score ?? 0,
                status: row.status, minute: row.minute ?? 0, stats: row.stats ?? null,
                homeForm: forms?.homeForm ?? [], awayForm: forms?.awayForm ?? [],
                // Pass odds when available for market-aware predictions
                homeOdds: odds?.homeWin ?? null,
                drawOdds: odds?.draw ?? null,
                awayOdds: odds?.awayWin ?? null,
              },
              user_id: userId,
            },
          });
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { data, error } = result.value;
          if (!error && data?.success) generated += 1;
          else failed += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { total: needsPrediction.length, generated, failed, skipped };
  } catch {
    return { total: 0, generated: 0, failed: 0, skipped: 0 };
  }
}

// ─── Coin unlock ──────────────────────────────────────────────────────────────
export const AI_REPORT_UNLOCK_COST = 5;

export async function spendCoinsForReport(userId: string): Promise<{ success: boolean; newBalance: number; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data: coinRow, error: fetchErr } = await supabase
      .from('user_coins').select('balance').eq('user_id', userId).maybeSingle();
    if (fetchErr || !coinRow) return { success: false, newBalance: 0, error: 'Could not fetch coin balance' };
    const balance = coinRow.balance as number;
    if (balance < AI_REPORT_UNLOCK_COST) return { success: false, newBalance: balance, error: 'Insufficient coins' };
    const newBalance = balance - AI_REPORT_UNLOCK_COST;
    const { error: updateErr } = await supabase
      .from('user_coins').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (updateErr) return { success: false, newBalance: balance, error: 'Failed to deduct coins' };
    return { success: true, newBalance, error: null };
  } catch (e) {
    return { success: false, newBalance: 0, error: 'Failed to process coin deduction' };
  }
}

// ─── VIP check ────────────────────────────────────────────────────────────────
export async function checkVipStatus(userId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.from('vip_subscriptions').select('id')
      .eq('user_id', userId).eq('status', 'active')
      .gt('expires_at', new Date().toISOString()).limit(1).maybeSingle();
    return data !== null;
  } catch { return false; }
}

// ─── Coin balance ─────────────────────────────────────────────────────────────
export async function fetchCoinBalance(userId: string): Promise<number> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.from('user_coins').select('balance').eq('user_id', userId).maybeSingle();
    return (data as any)?.balance ?? 0;
  } catch { return 0; }
}

// ─── League Standings ────────────────────────────────────────────────────────
export interface StandingsRow {
  team: string; logo: string | null;
  mp: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
}

export async function fetchLeagueStandings(leagueName: string, sport: string): Promise<StandingsRow[]> {
  try {
    const supabase = getSupabaseClient();
    const { data: matches, error } = await supabase
      .from('matches')
      .select('home_team, away_team, home_logo, away_logo, home_score, away_score, status')
      .eq('league', leagueName).eq('sport', sport.toLowerCase()).eq('status', 'finished').limit(500);
    if (error || !matches || matches.length === 0) return [];

    const map = new Map<string, StandingsRow>();
    const getOrCreate = (team: string, logo: string | null): StandingsRow => {
      if (!map.has(team)) map.set(team, { team, logo, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
      return map.get(team)!;
    };
    for (const m of matches) {
      const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0;
      const home = getOrCreate(m.home_team, m.home_logo ?? null);
      const away = getOrCreate(m.away_team, m.away_logo ?? null);
      home.mp++; away.mp++; home.gf += hs; home.ga += as_; away.gf += as_; away.ga += hs;
      if (hs > as_) { home.w++; home.pts += 3; away.l++; }
      else if (as_ > hs) { away.w++; away.pts += 3; home.l++; }
      else { home.d++; home.pts += 1; away.d++; away.pts += 1; }
    }
    const rows = Array.from(map.values()).map((r) => ({ ...r, gd: r.gf - r.ga }));
    rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return rows;
  } catch { return []; }
}

export interface StandingsResult { rows: StandingsRow[]; source: 'synced' | 'calculated'; }

export async function fetchLeagueStandingsFromDB(leagueName: string, sport: string, leagueId?: number | null): Promise<StandingsResult> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('league_standings')
      .select('team_name, team_logo, position, played, wins, draws, losses, goals_for, goals_against, goal_diff, points, form')
      .eq('sport', sport.toLowerCase()).order('position', { ascending: true }).limit(30);
    if (leagueId) { query = query.eq('league_id', leagueId); }
    else { query = query.ilike('league_name', `%${leagueName.split(' — ')[0].trim()}%`); }
    const { data: synced, error: syncErr } = await query;
    if (!syncErr && synced && synced.length > 0) {
      return { source: 'synced', rows: synced.map((r: any): StandingsRow => ({ team: r.team_name, logo: r.team_logo ?? null, mp: r.played ?? 0, w: r.wins ?? 0, d: r.draws ?? 0, l: r.losses ?? 0, gf: r.goals_for ?? 0, ga: r.goals_against ?? 0, gd: r.goal_diff ?? 0, pts: r.points ?? 0 })) };
    }
    return { rows: await fetchLeagueStandings(leagueName, sport), source: 'calculated' };
  } catch { return { rows: await fetchLeagueStandings(leagueName, sport), source: 'calculated' }; }
}

// ─── Head-to-Head ────────────────────────────────────────────────────────────
export interface H2HRecord { id: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; matchTime: string; league: string; }

export async function fetchHeadToHead(teamA: string, teamB: string, sport: string, limit = 5): Promise<H2HRecord[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('matches').select('id, home_team, away_team, home_score, away_score, match_time, league')
      .eq('sport', sport.toLowerCase()).eq('status', 'finished')
      .in('home_team', [teamA, teamB]).in('away_team', [teamA, teamB])
      .order('match_time', { ascending: false }).limit(limit * 4);
    if (error || !data) return [];
    return (data as any[])
      .filter((r) => (r.home_team === teamA && r.away_team === teamB) || (r.home_team === teamB && r.away_team === teamA))
      .slice(0, limit)
      .map((r: any): H2HRecord => ({ id: r.id, homeTeam: r.home_team, awayTeam: r.away_team, homeScore: r.home_score ?? 0, awayScore: r.away_score ?? 0, matchTime: r.match_time, league: r.league ?? '' }));
  } catch { return []; }
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
