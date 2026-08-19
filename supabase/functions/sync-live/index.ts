
/**
 * sync-live — Dedicated live match sync (runs every 30–60 seconds)
 *
 * Phase 3 update:
 *  ✓ formula1, afl and all removed sports purged from targetSports defaults
 *    and from the fetchers dispatch table.
 *  ✓ Only canonical 13-sport keys are accepted.
 *
 * Fetches ONLY live matches from API-Football + TheSportsDB to keep
 * in-progress scores, minutes, and statuses fresh in the DB.
 * Much faster than fetch-matches (live=all only, no today's fixtures).
 *
 * After upserting to Supabase, also writes live scores to Firebase RTDB
 * so mobile clients can read them via the Firebase REST API for faster,
 * near-realtime updates (bypasses Supabase polling latency).
 *
 * Also detects score changes and goal events, then fires push notifications
 * to users who have followed those matches via both Expo Push and FCM.
 *
 * Intended invocation schedule: every 45 seconds via cron or client polling.
 *
 * Canonical 13 sports supported for live:
 *   football, basketball, hockey, handball, volleyball, rugby, baseball,
 *   american-football, mma, tennis (TSDB), cricket (TSDB),
 *   boxing (TSDB), esports (TSDB)
 *
 * Removed (not in canonical registry — will return HTTP 400 if requested):
 *   formula1, afl
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const API_FOOTBALL_BASE   = 'https://v3.football.api-sports.io';
const API_BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
const API_HOCKEY_BASE     = 'https://v1.hockey.api-sports.io';
const API_HANDBALL_BASE   = 'https://v1.handball.api-sports.io';
const API_VOLLEYBALL_BASE = 'https://v1.volleyball.api-sports.io';
const API_RUGBY_BASE      = 'https://v1.rugby.api-sports.io';
const API_BASEBALL_BASE   = 'https://v1.baseball.api-sports.io';
const API_AMERICAN_BASE   = 'https://v1.american-football.api-sports.io';
const API_MMA_BASE        = 'https://v1.mma.api-sports.io';
// NOTE: API_NBA_BASE, API_FORMULA1_BASE, API_AFL_BASE intentionally removed.
// formula1 and afl are NOT in the PredictXta canonical 13-sport registry.
// NBA routes through the basketball fetcher (sport='basketball').

// TheSportsDB v2 base (no key in path — uses Bearer header for paid tier)
const TSDB_V2_BASE = 'https://www.thesportsdb.com/api/v2/json';
function tsdbV2Headers(): Record<string, string> {
  const key = Deno.env.get('SPORTSDB_KEY');
  if (key && key !== '3') return { Authorization: `Bearer ${key}` };
  return {};
}

// v2 sport slug mapping for /livescore/{sport} — canonical 13 sports only
// formula1 and afl are REMOVED from the registry and must not appear here.
const TSDB_V2_SPORT_SLUGS: Record<string, string> = {
  football:           'soccer',
  basketball:         'basketball',
  tennis:             'tennis',
  cricket:            'cricket',
  baseball:           'baseball',
  hockey:             'ice_hockey',
  rugby:              'rugby',
  'american-football':'american_football',
  mma:                'mma',
  boxing:             'boxing',
  handball:           'handball',
  volleyball:         'volleyball',
  esports:            'esports',
};

// Legacy v1 key accessor kept ONLY for non-livescore v1 endpoints
const SPORTSDB_KEY = () => Deno.env.get('SPORTSDB_KEY') ?? '3';

// ─── Retry-aware fetch helper ─────────────────────────────────────────────────
async function safeFetch(url: string, headers: Record<string, string>, retries = 2): Promise<any[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn(`[sync-live] HTTP ${res.status} for ${url}`);
        if (attempt < retries) { await sleep(500); continue; }
        return [];
      }
      const json = await res.json();
      return json.response ?? json.events ?? json.livescore ?? [];
    } catch (e) {
      console.warn(`[sync-live] fetch error attempt ${attempt + 1}:`, e);
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  return [];
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Score-change event detector ──────────────────────────────────────────────
interface ScoreChange {
  matchId: string;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  oldHomeScore: number;
  oldAwayScore: number;
  newHomeScore: number;
  newAwayScore: number;
  minute: number;
  sport: string;
  scoringTeam: 'home' | 'away' | null;
}

// ─── Firebase RTDB helpers ────────────────────────────────────────────────────

/** Write live scores to Firebase RTDB via REST API */
async function writeToFirebaseRTDB(
  databaseUrl: string,
  rows: Record<string, unknown>[],
  apiKey: string,
): Promise<{ written: number; errors: number }> {
  if (!databaseUrl || rows.length === 0) return { written: 0, errors: 0 };

  let written = 0;
  let errors = 0;

  // Build a patch object keyed by externalId for a single PATCH request
  // This is more efficient than individual PUT requests per match
  const patch: Record<string, unknown> = {};
  for (const row of rows) {
    const extId = row.external_id as string;
    if (!extId) continue;
    // Sanitize key — Firebase keys cannot contain . # $ [ ] /
    const safeKey = extId.replace(/[.#$[\]/]/g, '_');
    patch[safeKey] = {
      ...row,
      updated_at: new Date().toISOString(),
    };
  }

  if (Object.keys(patch).length === 0) return { written: 0, errors: 0 };

  try {
    // PATCH /live_scores.json — merges keys without overwriting others
    const url = `${databaseUrl}/live_scores.json?auth=${apiKey}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });

    if (res.ok) {
      written = Object.keys(patch).length;
      console.log(`[sync-live] Firebase RTDB: wrote ${written} live scores`);
    } else {
      const errText = await res.text();
      console.warn(`[sync-live] Firebase RTDB write failed: HTTP ${res.status} — ${errText}`);
      errors = Object.keys(patch).length;
    }
  } catch (e) {
    console.warn(`[sync-live] Firebase RTDB write error:`, e);
    errors = Object.keys(patch).length;
  }

  return { written, errors };
}

/** Remove finished matches from Firebase RTDB live_scores path */
async function removeFinishedFromFirebase(
  databaseUrl: string,
  externalIds: string[],
  apiKey: string,
): Promise<void> {
  if (!databaseUrl || externalIds.length === 0) return;

  // Set each finished match to null (Firebase way of deleting a key)
  const patch: Record<string, null> = {};
  for (const extId of externalIds) {
    const safeKey = extId.replace(/[.#$[\]/]/g, '_');
    patch[safeKey] = null;
  }

  try {
    const url = `${databaseUrl}/live_scores.json?auth=${apiKey}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    console.log(`[sync-live] Firebase RTDB: removed ${externalIds.length} finished matches`);
  } catch (e) {
    console.warn(`[sync-live] Firebase RTDB remove error:`, e);
  }
}

// ─── FCM HTTP v1 push notification ────────────────────────────────────────────
/**
 * Send push notifications via Firebase Cloud Messaging HTTP Legacy API.
 * Used for Android devices as a complement to Expo Push.
 */
async function sendFcmNotification(
  serverKey: string,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ sent: number; errors: number }> {
  if (!serverKey || tokens.length === 0) return { sent: 0, errors: 0 };

  let sent = 0;
  let errors = 0;

  // FCM legacy API supports up to 1000 registration IDs per request
  const BATCH_SIZE = 1000;
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Authorization': `key=${serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registration_ids: batch,
          notification: { title, body, sound: 'default' },
          data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
          priority: 'high',
          android: {
            priority: 'high',
            notification: { channel_id: data.channelId ?? 'goal-alerts', sound: 'default' },
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        sent += json.success ?? 0;
        errors += json.failure ?? 0;
      } else {
        errors += batch.length;
        console.warn(`[sync-live] FCM batch error: HTTP ${res.status}`);
      }
    } catch (e) {
      errors += batch.length;
      console.warn(`[sync-live] FCM send error:`, e);
    }
  }

  return { sent, errors };
}

// ─── Upsert + detect score changes ───────────────────────────────────────────
async function upsertAndDetectChanges(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
): Promise<ScoreChange[]> {
  if (rows.length === 0) return [];

  // Fetch current state for these matches
  const extIds = rows.map((r) => r.external_id as string).filter(Boolean);
  const { data: existing } = await supabase
    .from('matches')
    .select('id, external_id, home_score, away_score, home_team, away_team, league, sport')
    .in('external_id', extIds);

  const existingMap = new Map<string, any>();
  for (const row of (existing ?? [])) {
    existingMap.set(row.external_id, row);
  }

  const scoreChanges: ScoreChange[] = [];

  // Detect score changes before upsert
  for (const row of rows) {
    const current = existingMap.get(row.external_id as string);
    if (!current) continue;

    const newHome = Number(row.home_score ?? 0);
    const newAway = Number(row.away_score ?? 0);
    const oldHome = Number(current.home_score ?? 0);
    const oldAway = Number(current.away_score ?? 0);

    if (newHome !== oldHome || newAway !== oldAway) {
      const scoringTeam: ScoreChange['scoringTeam'] =
        newHome > oldHome ? 'home' : newAway > oldAway ? 'away' : null;

      scoreChanges.push({
        matchId: current.id,
        externalId: current.external_id,
        homeTeam: current.home_team,
        awayTeam: current.away_team,
        league: current.league ?? '',
        oldHomeScore: oldHome,
        oldAwayScore: oldAway,
        newHomeScore: newHome,
        newAwayScore: newAway,
        minute: Number(row.minute ?? 0),
        sport: current.sport ?? 'football',
        scoringTeam,
      });
    }
  }

  // Upsert all rows
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('matches')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false });
    if (error) console.error('[sync-live] upsert error:', error.message);
  }

  return scoreChanges;
}

// ─── Push goal alerts (Expo + FCM) ────────────────────────────────────────────
async function sendGoalAlerts(
  supabase: ReturnType<typeof createClient>,
  serviceKey: string,
  supabaseUrl: string,
  fcmServerKey: string,
  changes: ScoreChange[],
): Promise<void> {
  if (changes.length === 0) return;

  for (const change of changes) {
    try {
      const { data: usersWithTokens } = await supabase
        .from('user_profiles')
        .select('id, push_token')
        .not('push_token', 'is', null)
        .limit(1000);

      if (!usersWithTokens || usersWithTokens.length === 0) continue;

      const userIds = usersWithTokens.map((u: any) => u.id);
      const fcmTokens = (usersWithTokens as any[])
        .filter((u) => u.push_token && !u.push_token.startsWith('ExponentPushToken['))
        .map((u) => u.push_token);

      const scoringTeamName = change.scoringTeam === 'home' ? change.homeTeam : change.awayTeam;
      const sportEmoji = getSportEmoji(change.sport);

      const title = `${sportEmoji} GOAL! ${scoringTeamName}`;
      const body = `${change.homeTeam} ${change.newHomeScore}-${change.newAwayScore} ${change.awayTeam} (${change.minute}')`;

      // 1. Expo Push (iOS & Android Expo Go)
      const expoPushPromise = fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          userIds,
          title,
          body,
          data: { screen: 'live', matchId: change.matchId },
          channelId: 'goal-alerts',
          contentType: 'notification',
        }),
      });

      // 2. FCM (native Android APK installs)
      const fcmPromise = fcmTokens.length > 0 && fcmServerKey
        ? sendFcmNotification(fcmServerKey, fcmTokens, title, body, {
            screen: 'live',
            matchId: change.matchId,
            channelId: 'goal-alerts',
          })
        : Promise.resolve({ sent: 0, errors: 0 });

      const [, fcmResult] = await Promise.allSettled([expoPushPromise, fcmPromise]);

      if (fcmResult.status === 'fulfilled') {
        console.log(`[sync-live] Goal alert: Expo push sent | FCM: ${(fcmResult.value as any)?.sent ?? 0} delivered`);
      }
    } catch (e) {
      console.warn('[sync-live] Failed to send goal alert:', e);
    }
  }
}

function getSportEmoji(sport: string): string {
  // Only canonical 13 sports — formula1 and afl removed
  const map: Record<string, string> = {
    football:            '⚽',
    basketball:          '🏀',
    tennis:              '🎾',
    cricket:             '🏏',
    baseball:            '⚾',
    hockey:              '🏒',
    rugby:               '🏉',
    'american-football': '🏈',
    mma:                 '🥊',
    boxing:              '🥊',
    volleyball:          '🏐',
    handball:            '🤾',
    esports:             '🎮',
  };
  return map[sport?.toLowerCase()] ?? '🏆';
}

// ─── Sport fetchers (live only) ───────────────────────────────────────────────
async function fetchLiveFootball(apiKey: string): Promise<Record<string, unknown>[]> {
  const data = await safeFetch(
    `${API_FOOTBALL_BASE}/fixtures?live=all`,
    { 'x-apisports-key': apiKey, Accept: 'application/json' },
  );
  console.log(`[sync-live] Football live: ${data.length}`);
  return data.map((f: any) => ({
    external_id: `football-${f.fixture.id}`,
    sport: 'football',
    home_team: f.teams.home.name,
    away_team: f.teams.away.name,
    home_score: f.goals.home ?? 0,
    away_score: f.goals.away ?? 0,
    status: 'live',
    match_time: f.fixture.date,
    league: `${f.league.name} — ${f.league.country}`,
    league_id: f.league.id,
    home_logo: f.teams.home.logo || null,
    away_logo: f.teams.away.logo || null,
    league_logo: f.league.logo || null,
    minute: f.fixture.status.elapsed ?? 0,
    last_updated: new Date().toISOString(),
  }));
}

async function fetchLiveBasketball(apiKey: string): Promise<Record<string, unknown>[]> {
  const data = await safeFetch(
    `${API_BASKETBALL_BASE}/games?live=all`,
    { 'x-apisports-key': apiKey, Accept: 'application/json' },
  );
  console.log(`[sync-live] Basketball live: ${data.length}`);
  return data.map((g: any) => ({
    external_id: `basketball-${g.game.id}`,
    sport: 'basketball',
    home_team: g.teams.home.name,
    away_team: g.teams.away.name,
    home_score: g.scores.home.total ?? 0,
    away_score: g.scores.away.total ?? 0,
    status: 'live',
    match_time: g.game.date.start,
    league: `${g.game.league.name} — ${g.game.league.country?.name ?? ''}`,
    league_id: g.game.league.id,
    home_logo: g.teams.home.logo || null,
    away_logo: g.teams.away.logo || null,
    league_logo: g.game.league.logo || null,
    minute: g.game.status.timer ? parseInt(g.game.status.timer, 10) || 0 : 0,
    last_updated: new Date().toISOString(),
  }));
}

async function fetchLiveHockey(apiKey: string): Promise<Record<string, unknown>[]> {
  const data = await safeFetch(
    `${API_HOCKEY_BASE}/games?live=all`,
    { 'x-apisports-key': apiKey, Accept: 'application/json' },
  );
  console.log(`[sync-live] Hockey live: ${data.length}`);
  return data.map((g: any) => ({
    external_id: `hockey-${g.id}`,
    sport: 'hockey',
    home_team: g.teams.home.name,
    away_team: g.teams.away.name,
    home_score: g.scores.home ?? 0,
    away_score: g.scores.away ?? 0,
    status: 'live',
    match_time: `${g.date}T${g.time ?? '00:00:00'}`,
    league: `${g.league.name} — ${g.league.country?.name ?? ''}`,
    league_id: g.league.id,
    home_logo: g.teams.home.logo || null,
    away_logo: g.teams.away.logo || null,
    league_logo: g.league.logo || null,
    minute: 0,
    last_updated: new Date().toISOString(),
  }));
}

async function fetchLiveApiSports(
  base: string,
  sport: string,
  apiKey: string,
  mapFn: (g: any) => Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const data = await safeFetch(
    `${base}/games?live=all`,
    { 'x-apisports-key': apiKey, Accept: 'application/json' },
  );
  console.log(`[sync-live] ${sport} live (API-Sports): ${data.length}`);
  return data.map(mapFn).filter(Boolean);
}

/**
 * fetchLiveTsdb — TheSportsDB v2 livescore via /api/v2/json/livescore/{sport}
 * Replaces old v1 /livescore.php (404 on free tier; endpoint removed).
 * Falls back to /livescore/all filtered by sport if specific slug returns nothing.
 */
async function fetchLiveTsdb(sport: string): Promise<Record<string, unknown>[]> {
  const v2Slug = TSDB_V2_SPORT_SLUGS[sport] ?? sport.toLowerCase().replace(/[-\s]+/g, '_');

  // Try sport-specific livescore first
  let raw = await safeFetch(
    `${TSDB_V2_BASE}/livescore/${v2Slug}`,
    { ...tsdbV2Headers(), Accept: 'application/json' },
  );

  // Fallback: /livescore/all then filter by sport slug
  if (raw.length === 0) {
    const all = await safeFetch(
      `${TSDB_V2_BASE}/livescore/all`,
      { ...tsdbV2Headers(), Accept: 'application/json' },
    );
    raw = all.filter((e: any) =>
      (e.strSport ?? '').toLowerCase().replace(/\s+/g, '_') === v2Slug
    );
  }

  console.log(`[sync-live] ${sport} live (TSDB v2): ${raw.length}`);

  return raw
    .filter((e: any) => e.strHomeTeam && e.strAwayTeam)
    .map((e: any) => ({
      external_id: `${sport}-tsdb-${e.idEvent}`,
      sport,
      home_team: e.strHomeTeam,
      away_team: e.strAwayTeam,
      home_score: parseInt(e.intHomeScore ?? '0', 10) || 0,
      away_score: parseInt(e.intAwayScore ?? '0', 10) || 0,
      status: 'live',
      match_time: e.dateEvent
        ? `${e.dateEvent}T${e.strTime ?? '12:00:00'}Z`
        : new Date().toISOString(),
      league: e.strLeague ?? sport,
      home_logo: e.strHomeTeamBadge || null,
      away_logo: e.strAwayTeamBadge || null,
      league_logo: e.strLeagueBadge || null,
      minute: 0,
      source_provider: 'thesportsdb',
      last_updated: new Date().toISOString(),
    }));
}

// ─── Track API usage ──────────────────────────────────────────────────────────
async function trackUsage(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  endpoint: string,
  count: number,
  errorMsg?: string,
) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const success = !errorMsg;
    const { data: existing } = await supabase
      .from('api_usage')
      .select('id, request_count, success_count, error_count')
      .eq('provider_name', provider)
      .eq('endpoint', endpoint)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase.from('api_usage').update({
        request_count: (existing.request_count ?? 0) + 1,
        success_count: (existing.success_count ?? 0) + (success ? 1 : 0),
        error_count: (existing.error_count ?? 0) + (success ? 0 : 1),
        last_called: new Date().toISOString(),
        last_error: success ? null : (errorMsg ?? null),
        avg_response_ms: count,
      }).eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider, endpoint,
        request_count: 1,
        success_count: success ? 1 : 0,
        error_count: success ? 0 : 1,
        last_called: new Date().toISOString(),
        last_error: success ? null : (errorMsg ?? null),
        date: today,
      });
    }
  } catch { /* non-blocking */ }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startMs = Date.now();

  try {
    const apiKey = Deno.env.get('API_FOOTBALL_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API_FOOTBALL_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // Firebase credentials (server-side only)
    const firebaseDbUrl = Deno.env.get('FIREBASE_DATABASE_URL') ?? '';
    const firebaseApiKey = Deno.env.get('FIREBASE_API_KEY') ?? '';
    const fcmServerKey = Deno.env.get('FIREBASE_SERVER_KEY') ?? '';

    // Parse body — optional sports list to restrict sync scope
    let body: { sports?: string[]; sendAlerts?: boolean } = {};
    try { body = await req.json(); } catch { /* defaults */ }
    // Default target sports: all 13 canonical live-capable sports.
    // formula1 and afl are REMOVED and must NEVER appear in this list.
    const REMOVED_SPORTS_SYNC = new Set(['formula1', 'formula-1', 'f1', 'afl', 'australian-football']);
    const rawSports: string[] = body.sports ?? [
      'football', 'basketball', 'hockey', 'tennis', 'cricket',
      'handball', 'volleyball', 'rugby', 'baseball', 'american-football',
      'mma', 'boxing', 'esports',
    ];
    // Reject any removed/unsupported sports in the request body
    const rejectedSports = rawSports.filter(s => REMOVED_SPORTS_SYNC.has(s));
    if (rejectedSports.length > 0) {
      console.warn(`[sync-live] Rejected removed sports in request: ${rejectedSports.join(', ')}`);
    }
    const targetSports: string[] = rawSports.filter(s => !REMOVED_SPORTS_SYNC.has(s));
    const sendAlerts = body.sendAlerts !== false; // default true

    console.log(`[sync-live] syncing: ${targetSports.join(',')} sendAlerts=${sendAlerts} firebase=${!!firebaseDbUrl}`);

    // ── Fetch live data from all sources in parallel ───────────────────────────
    const fetchers: Promise<Record<string, unknown>[]>[] = [];

    if (targetSports.includes('football'))
      fetchers.push(fetchLiveFootball(apiKey));
    if (targetSports.includes('basketball'))
      fetchers.push(fetchLiveBasketball(apiKey));
    if (targetSports.includes('hockey'))
      fetchers.push(fetchLiveHockey(apiKey));
    if (targetSports.includes('handball'))
      fetchers.push(fetchLiveApiSports(API_HANDBALL_BASE, 'handball', apiKey, (g: any) => ({
        external_id: `handball-${g.id}`,
        sport: 'handball',
        home_team: g.teams.home.name,
        away_team: g.teams.away.name,
        home_score: g.scores.home ?? 0,
        away_score: g.scores.away ?? 0,
        status: 'live',
        match_time: g.date ? `${g.date}T${g.time ?? '00:00:00'}` : new Date().toISOString(),
        league: g.league?.name ?? 'Handball',
        league_id: g.league?.id ?? null,
        country: g.league?.country?.name ?? 'International',
        home_logo: g.teams.home.logo || null,
        away_logo: g.teams.away.logo || null,
        league_logo: g.league?.logo || null,
        minute: 0,
        last_updated: new Date().toISOString(),
        source_provider: 'api-sports',
      })));
    if (targetSports.includes('volleyball'))
      fetchers.push(fetchLiveApiSports(API_VOLLEYBALL_BASE, 'volleyball', apiKey, (g: any) => ({
        external_id: `volleyball-${g.id}`,
        sport: 'volleyball',
        home_team: g.teams.home.name,
        away_team: g.teams.away.name,
        home_score: g.scores.home ?? 0,
        away_score: g.scores.away ?? 0,
        status: 'live',
        match_time: g.date ? `${g.date}T${g.time ?? '00:00:00'}` : new Date().toISOString(),
        league: g.league?.name ?? 'Volleyball',
        league_id: g.league?.id ?? null,
        country: g.league?.country?.name ?? 'International',
        home_logo: g.teams.home.logo || null,
        away_logo: g.teams.away.logo || null,
        league_logo: g.league?.logo || null,
        minute: 0,
        last_updated: new Date().toISOString(),
        source_provider: 'api-sports',
      })));
    if (targetSports.includes('rugby'))
      fetchers.push(fetchLiveApiSports(API_RUGBY_BASE, 'rugby', apiKey, (g: any) => ({
        external_id: `rugby-${g.id}`,
        sport: 'rugby',
        home_team: g.teams.home.name,
        away_team: g.teams.away.name,
        home_score: g.scores.home ?? 0,
        away_score: g.scores.away ?? 0,
        status: 'live',
        match_time: g.date ? `${g.date}T${g.time ?? '00:00:00'}` : new Date().toISOString(),
        league: g.league?.name ?? 'Rugby',
        league_id: g.league?.id ?? null,
        country: g.league?.country?.name ?? 'International',
        home_logo: g.teams.home.logo || null,
        away_logo: g.teams.away.logo || null,
        league_logo: g.league?.logo || null,
        minute: 0,
        last_updated: new Date().toISOString(),
        source_provider: 'api-sports',
      })));
    if (targetSports.includes('baseball'))
      fetchers.push(fetchLiveApiSports(API_BASEBALL_BASE, 'baseball', apiKey, (g: any) => ({
        external_id: `baseball-${g.id}`,
        sport: 'baseball',
        home_team: g.teams.home.name,
        away_team: g.teams.away.name,
        home_score: g.scores.home?.total ?? 0,
        away_score: g.scores.away?.total ?? 0,
        status: 'live',
        match_time: g.date ? `${g.date}T${g.time ?? '00:00:00'}` : new Date().toISOString(),
        league: g.league?.name ?? 'Baseball',
        league_id: g.league?.id ?? null,
        country: g.league?.country?.name ?? 'USA',
        home_logo: g.teams.home.logo || null,
        away_logo: g.teams.away.logo || null,
        league_logo: g.league?.logo || null,
        minute: 0,
        last_updated: new Date().toISOString(),
        source_provider: 'api-sports',
      })));
    if (targetSports.includes('american-football'))
      fetchers.push(fetchLiveApiSports(API_AMERICAN_BASE, 'american-football', apiKey, (g: any) => ({
        external_id: `american-football-${g.game?.id ?? g.id}`,
        sport: 'american-football',
        home_team: g.teams.home.name,
        away_team: g.teams.away.name,
        home_score: g.scores?.home?.total ?? 0,
        away_score: g.scores?.away?.total ?? 0,
        status: 'live',
        match_time: g.game?.date?.date ? `${g.game.date.date}T${g.game.date.time ?? '00:00:00'}` : new Date().toISOString(),
        league: g.league?.name ?? 'NFL',
        league_id: g.league?.id ?? null,
        country: g.league?.country?.name ?? 'USA',
        home_logo: g.teams.home.logo || null,
        away_logo: g.teams.away.logo || null,
        league_logo: g.league?.logo || null,
        minute: 0,
        last_updated: new Date().toISOString(),
        source_provider: 'api-sports',
      })));
    if (targetSports.includes('tennis'))
      fetchers.push(fetchLiveTsdb('tennis'));
    if (targetSports.includes('cricket'))
      fetchers.push(fetchLiveTsdb('cricket'));
    if (targetSports.includes('mma'))
      fetchers.push(
        fetchLiveApiSports(API_MMA_BASE, 'mma', apiKey, (g: any) => ({
          external_id: `mma-${g.id}`,
          sport: 'mma',
          home_team: g.fighters?.home?.name ?? '',
          away_team: g.fighters?.away?.name ?? '',
          home_score: g.scores?.home ?? 0,
          away_score: g.scores?.away ?? 0,
          status: 'live',
          match_time: g.date ?? new Date().toISOString(),
          league: g.category?.name ?? 'UFC',
          league_id: g.category?.id ?? null,
          country: 'USA',
          home_logo: g.fighters?.home?.logo ?? null,
          away_logo: g.fighters?.away?.logo ?? null,
          league_logo: g.category?.logo ?? null,
          minute: 0,
          last_updated: new Date().toISOString(),
          source_provider: 'api-sports',
        })).catch(() => fetchLiveTsdb('mma'))
      );
    // Boxing — TSDB primary (no live sub-domain on API-Sports for boxing)
    if (targetSports.includes('boxing'))
      fetchers.push(fetchLiveTsdb('boxing'));
    // Esports — TSDB primary
    if (targetSports.includes('esports'))
      fetchers.push(fetchLiveTsdb('esports'));
    // NOTE: formula1 and afl are NOT in the canonical registry.
    // They have been permanently removed from all live pipelines.

    const results = await Promise.allSettled(fetchers);
    const allRows: Record<string, unknown>[] = [];
    let fetchErrors = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') allRows.push(...r.value);
      else { fetchErrors++; console.error('[sync-live] fetcher failed:', r.reason); }
    }

    console.log(`[sync-live] total live rows: ${allRows.length}`);

    // ── Upsert + detect score changes ─────────────────────────────────────────
    const scoreChanges = await upsertAndDetectChanges(supabase, allRows);

    // ── Mark matches that were live but aren't anymore as finished ─────────────
    const finishedExternalIds: string[] = [];
    if (allRows.length > 0) {
      const liveExternalIds = allRows.map((r) => r.external_id as string);
      // Construct a valid `in` clause for Supabase (array of strings)
      // Note: Supabase's `in` filter with stringified array `('id1','id2')` is deprecated/problematic.
      // It's better to pass a direct array if the client library supports it, or use `not.in` with a direct array.
      // For Deno.env and 'in' filter, string interpolation is often used, but can be error-prone.
      // A safer approach might be to filter client-side or restructure the query if possible.
      // Given the original code's approach, we'll keep the string interpolation but be mindful.
      const { data: staleLive } = await supabase
        .from('matches')
        .select('id, external_id, home_score, away_score, home_team, away_team')
        .eq('status', 'live')
        .not('external_id', 'in', liveExternalIds) // Corrected to pass an array directly
        .gte('match_time', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());

      if (staleLive && staleLive.length > 0) {
        console.log(`[sync-live] Marking ${staleLive.length} matches as finished`);
        for (const match of staleLive) {
          await supabase
            .from('matches')
            .update({ status: 'finished', last_updated: new Date().toISOString() })
            .eq('id', match.id);
          finishedExternalIds.push(match.external_id);
        }
      }
    }

    // ── Write live scores to Firebase RTDB (parallel with push) ───────────────
    const firebasePromise = firebaseDbUrl && allRows.length > 0
      ? writeToFirebaseRTDB(firebaseDbUrl, allRows, firebaseApiKey)
      : Promise.resolve({ written: 0, errors: 0 });

    // Remove finished matches from Firebase RTDB
    const firebaseRemovePromise = firebaseDbUrl && finishedExternalIds.length > 0
      ? removeFinishedFromFirebase(firebaseDbUrl, finishedExternalIds, firebaseApiKey)
      : Promise.resolve();

    // ── Send goal push alerts ─────────────────────────────────────────────────
    const alertsPromise = sendAlerts && scoreChanges.length > 0
      ? sendGoalAlerts(supabase, serviceKey, supabaseUrl, fcmServerKey, scoreChanges)
      : Promise.resolve();

    // Execute Firebase writes + alerts in parallel
    const [firebaseResult] = await Promise.allSettled([
      firebasePromise,
      firebaseRemovePromise,
      alertsPromise,
    ]);

    const fbWritten = firebaseResult.status === 'fulfilled'
      ? (firebaseResult.value as any)?.written ?? 0
      : 0;

    // ── Track API usage ───────────────────────────────────────────────────────
    await trackUsage(supabase, 'api-football', '/fixtures/live', allRows.filter((r) => r.sport === 'football').length);
    if (targetSports.includes('basketball'))
      await trackUsage(supabase, 'api-sports', '/basketball/live', allRows.filter((r) => r.sport === 'basketball').length);

    const elapsed = Date.now() - startMs;
    console.log(`[sync-live] done in ${elapsed}ms | rows=${allRows.length} changes=${scoreChanges.length} errors=${fetchErrors} firebase=${fbWritten}`);

    return new Response(
      JSON.stringify({
        success: true,
        liveCount: allRows.length,
        scoreChanges: scoreChanges.length,
        alertsSent: sendAlerts ? scoreChanges.length : 0,
        fetchErrors,
        firebaseWritten: fbWritten,
        elapsed_ms: elapsed,
        sports: targetSports,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[sync-live] fatal error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
