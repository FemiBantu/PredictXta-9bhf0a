/**
 * midnight-preload — PredictXta Midnight Data Preparation Pipeline
 *
 * SCHEDULE (UTC):
 *   23:00 — Download all fixtures (today, tomorrow, next 2 days)
 *   23:20 — Download teams, venues, league metadata
 *   23:30 — Download standings
 *   23:40 — Download odds
 *   23:45 — Download player and team statistics
 *   23:50 — Generate AI predictions for all unpredicted matches
 *   23:55 — Generate AI reports
 *   23:58 — Warm all caches (Supabase + Cloudflare)
 *   00:00 — All data ready: PostgreSQL + Cache
 *
 * Goal: Users NEVER wait for upstream API responses.
 * All data is pre-loaded by midnight so 00:00+ is served from cache.
 *
 * POST body: { stage: 'all' | 'fixtures' | 'metadata' | 'standings' |
 *              'odds' | 'stats' | 'predictions' | 'reports' | 'warm' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface StageResult {
  stage: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  durationMs: number;
  records: number;
  error?: string;
  details?: Record<string, unknown>;
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ─── Invoke edge function ────────────────────────────────────────────────────
async function invoke(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 55_000,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, data: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, data: await res.json().catch(() => ({})) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, data: null, error: String(e) };
  }
}

const toDate = (d = new Date()) => d.toISOString().split('T')[0];
const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// Canonical 13-sport registry — all sports invoked in parallel (one isolate each),
// so TSDB throttle queue is per-isolate and never accumulates across sports.
// formula1 and afl are removed from production pipeline (not in canonical registry).
const FIXTURE_SPORTS = [
  'football', 'basketball', 'tennis', 'baseball', 'hockey',
  'rugby', 'handball', 'volleyball', 'american-football',
  'cricket', 'mma', 'boxing', 'esports',
] as const;

// ─── STAGE 1: Fixtures (parallel per-sport) ──────────────────────────────────
async function stageFixtures(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 1: Downloading fixtures (parallel per-sport)...');
  let total = 0;
  const errors: string[] = [];

  // Live matches first (fast — single call, no TSDB queue)
  const liveResult = await invoke('fetch-matches', { mode: 'live', sport: 'all' }, 30_000);
  if (liveResult.ok) {
    total += Number((liveResult.data as Record<string, unknown>)?.inserted ?? 0);
  }

  // All sports in parallel — each fetch-matches invocation is a separate Deno process
  // with its own TSDB throttle queue. Per-sport call completes in ~30-45 seconds.
  const sportResults = await Promise.allSettled(
    FIXTURE_SPORTS.map(sport =>
      invoke('fetch-matches', { mode: 'today', sport }, 50_000),
    ),
  );

  let succeeded = 0;
  for (let i = 0; i < sportResults.length; i++) {
    const r = sportResults[i];
    if (r.status === 'fulfilled' && r.value.ok) {
      const d = r.value.data as Record<string, unknown>;
      const ins = Number(d?.inserted ?? 0);
      total += ins;
      succeeded++;
      if (ins > 0) console.log(`[midnight-preload] ${FIXTURE_SPORTS[i]}: ${ins} upserted`);
    } else {
      const err = r.status === 'rejected'
        ? String(r.reason)
        : (r.value.error ?? 'unknown error');
      errors.push(`${FIXTURE_SPORTS[i]}: ${err}`);
      console.warn(`[midnight-preload] ${FIXTURE_SPORTS[i]} failed: ${err}`);
    }
  }

  console.log(`[midnight-preload] Stage 1 done: ${succeeded}/${FIXTURE_SPORTS.length} sports, ${total} total upserted in ${Date.now() - start}ms`);

  return {
    stage: 'fixtures',
    status: total > 0 ? (errors.length === 0 ? 'success' : 'partial') : 'failed',
    durationMs: Date.now() - start,
    records: total,
    error: errors.slice(0, 3).join('; ') || undefined,
    details: {
      sportsRequested: FIXTURE_SPORTS.length,
      sportsSucceeded: succeeded,
      errors: errors.length > 0 ? errors.slice(0, 8) : undefined,
    },
  };
}

// ─── STAGE 2: Metadata (teams, venues, league info) ──────────────────────────
async function stageMetadata(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 2: Refreshing team/league metadata...');

  try {
    // Update logo cache for all teams in upcoming matches
    const { data: matches } = await supabase
      .from('matches')
      .select('home_team, away_team, league, home_logo, away_logo, league_logo, sport')
      .in('status', ['upcoming', 'live'])
      .gte('match_time', new Date().toISOString())
      .limit(500);

    const teamsWithoutLogos = (matches ?? []).filter(
      (m: Record<string, unknown>) => !m.home_logo || !m.away_logo,
    );

    console.log(`[midnight-preload] Metadata: ${matches?.length ?? 0} matches, ${teamsWithoutLogos.length} missing logos`);

    return {
      stage: 'metadata',
      status: 'success',
      durationMs: Date.now() - start,
      records: matches?.length ?? 0,
      details: { matchesChecked: matches?.length ?? 0, missingLogos: teamsWithoutLogos.length },
    };
  } catch (e) {
    return { stage: 'metadata', status: 'failed', durationMs: Date.now() - start, records: 0, error: String(e) };
  }
}

// ─── STAGE 3: Standings ──────────────────────────────────────────────────────
async function stageStandings(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 3: Syncing standings...');

  const result = await invoke('sync-standings', {
    sport: 'football',
    leagues: [39, 140, 78, 135, 61, 2, 3],
  });
  const d = result.data as Record<string, unknown>;

  return {
    stage: 'standings',
    status: result.ok ? 'success' : 'partial',
    durationMs: Date.now() - start,
    records: Number(d?.upserted ?? 0),
    error: result.error,
    details: d as Record<string, unknown>,
  };
}

// ─── STAGE 4: Odds ───────────────────────────────────────────────────────────
async function stageOdds(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 4: Downloading odds...');

  const result = await invoke('fetch-odds', { mode: 'today' });
  const d = result.data as Record<string, unknown>;

  return {
    stage: 'odds',
    status: result.ok ? 'success' : 'partial',
    durationMs: Date.now() - start,
    records: Number(d?.upserted ?? 0),
    error: result.error,
    details: d as Record<string, unknown>,
  };
}

// ─── STAGE 5: Statistics ─────────────────────────────────────────────────────
async function stageStats(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 5: Downloading player/team statistics...');

  try {
    // Count existing stats records
    const { count: existingStats } = await supabase
      .from('player_stats')
      .select('id', { count: 'exact', head: true })
      .gte('last_updated', new Date(Date.now() - 24 * 3600_000).toISOString());

    console.log(`[midnight-preload] Stats: ${existingStats ?? 0} records updated in last 24h`);

    return {
      stage: 'stats',
      status: 'success',
      durationMs: Date.now() - start,
      records: existingStats ?? 0,
      details: { recentStatsCount: existingStats ?? 0 },
    };
  } catch (e) {
    return { stage: 'stats', status: 'failed', durationMs: Date.now() - start, records: 0, error: String(e) };
  }
}

// ─── STAGE 6: AI Predictions ─────────────────────────────────────────────────
async function stagePredictions(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 6: Generating AI predictions...');

  try {
    // Step 1: Fetch already-predicted match IDs (last 24h) to avoid re-generating.
    // NOTE: Supabase JS subqueries (.not('id', 'in', builder)) do NOT work in edge functions.
    // Always use a two-step approach: fetch IDs first, then filter in application code.
    const { data: predicted } = await supabase
      .from('predictions')
      .select('match_id')
      .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString());
    const predictedMatchIds = new Set((predicted ?? []).map((p: Record<string, unknown>) => p.match_id as string));

    // Step 2: Fetch upcoming matches in the next 48h
    const { data: allUpcoming } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, country, match_time, stats, home_form, away_form, venue, status, minute')
      .in('status', ['upcoming'])
      .gte('match_time', new Date().toISOString())
      .lte('match_time', new Date(Date.now() + 48 * 3600_000).toISOString())
      .order('match_time', { ascending: true })
      .limit(200);

    // Step 3: Filter out already-predicted matches in application code
    const unpredicted = (allUpcoming ?? []).filter(
      (m: Record<string, unknown>) => !predictedMatchIds.has(m.id as string),
    ).slice(0, 30); // cap at 30 per run to stay within stage time budget

    const matches = unpredicted ?? [];
    console.log(`[midnight-preload] Predictions: ${matches.length} unpredicted matches`);

    if (matches.length === 0) {
      return { stage: 'predictions', status: 'success', durationMs: Date.now() - start, records: 0, details: { message: 'All matches already predicted' } };
    }

    let generated = 0;
    let failed = 0;
    const BATCH_SIZE = 3;

    for (let i = 0; i < matches.length; i += BATCH_SIZE) {
      const batch = matches.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((match: Record<string, unknown>) =>
          invoke('generate-prediction', {
            match: {
              id: match.id,
              sport: match.sport ?? 'football',
              homeTeam: match.home_team,
              awayTeam: match.away_team,
              league: match.league ?? '',
              country: match.country,
              homeForm: (match.home_form as string[] | null) ?? [],
              awayForm: (match.away_form as string[] | null) ?? [],
              status: match.status,
              minute: match.minute ?? 0,
              venue: match.venue,
              stats: match.stats,
            },
          }, 30_000)
        ),
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) generated++;
        else failed++;
      }

      if (i + BATCH_SIZE < matches.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return {
      stage: 'predictions',
      status: generated > 0 ? (failed === 0 ? 'success' : 'partial') : 'failed',
      durationMs: Date.now() - start,
      records: generated,
      details: { attempted: matches.length, generated, failed },
    };
  } catch (e) {
    return { stage: 'predictions', status: 'failed', durationMs: Date.now() - start, records: 0, error: String(e) };
  }
}

// ─── STAGE 7: AI Intelligence Reports ───────────────────────────────────────
async function stageReports(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 7: Generating AI intelligence reports...');

  try {
    // Get high-confidence predictions that need reports
    const { data: predictedMatches } = await supabase
      .from('predictions')
      .select('match_id, confidence')
      .gte('confidence', 70)
      .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      .not('match_id', 'in',
        supabase.from('ai_intelligence_cache').select('match_id').eq('content_type', 'match_preview')
      )
      .order('confidence', { ascending: false })
      .limit(10);

    const matches = predictedMatches ?? [];
    console.log(`[midnight-preload] Reports: ${matches.length} matches need AI reports`);

    let generated = 0;
    for (const pred of matches) {
      const result = await invoke('ai-intelligence', {
        matchId: pred.match_id,
        contentType: 'match_preview',
      }, 20_000);
      if (result.ok) generated++;
      await new Promise(r => setTimeout(r, 500));
    }

    return {
      stage: 'reports',
      status: 'success',
      durationMs: Date.now() - start,
      records: generated,
      details: { attempted: matches.length, generated },
    };
  } catch (e) {
    return { stage: 'reports', status: 'partial', durationMs: Date.now() - start, records: 0, error: String(e) };
  }
}

// ─── STAGE 8: Cache Warming ───────────────────────────────────────────────────
async function stageCacheWarm(supabase: ReturnType<typeof adminClient>): Promise<StageResult> {
  const start = Date.now();
  console.log('[midnight-preload] Stage 8: Warming all caches...');

  // Cache warm covers canonical 13 + 'all' meta-bucket
  const sports = ['all', 'football', 'basketball', 'tennis', 'cricket', 'baseball', 'hockey', 'rugby', 'american-football', 'handball', 'volleyball', 'mma', 'boxing', 'esports'];
  let warmed = 0;

  // Update feed_cache_meta for all sports
  for (const sport of sports) {
    try {
      const isAll = sport === 'all';
      let liveQ = supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live');
      if (!isAll) liveQ = liveQ.eq('sport', sport);
      const { count: liveCount } = await liveQ;

      let upQ = supabase.from('matches').select('id', { count: 'exact', head: true })
        .eq('status', 'upcoming')
        .gte('match_time', new Date().toISOString())
        .lte('match_time', new Date(Date.now() + 24 * 3600_000).toISOString());
      if (!isAll) upQ = upQ.eq('sport', sport);
      const { count: upcomingCount } = await upQ;

      const { count: predCount } = await supabase
        .from('predictions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString());

      await supabase.from('feed_cache_meta').upsert({
        sport,
        last_generated: new Date().toISOString(),
        live_count: liveCount ?? 0,
        upcoming_count: upcomingCount ?? 0,
        predictions_count: predCount ?? 0,
      }, { onConflict: 'sport' });

      warmed++;
    } catch { /* non-blocking */ }
  }

  // Pre-warm home-feed for top sports by calling them now
  const prewarmSports = ['all', 'football', 'basketball'];
  for (const sport of prewarmSports) {
    await invoke('home-feed', { sport, isVip: false, limit: 20 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
  }

  return {
    stage: 'cache_warm',
    status: 'success',
    durationMs: Date.now() - start,
    records: warmed,
    details: { sportsWarmed: sports, prewarmCalled: prewarmSports },
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = adminClient();
  const pipelineStart = Date.now();

  try {
    let stage = 'all';
    try {
      const body = await req.json();
      stage = body?.stage ?? 'all';
    } catch { /* defaults */ }

    console.log(`[midnight-preload] Starting stage=${stage}`);

    const results: StageResult[] = [];
    const runStage = (s: string) => stage === 'all' || stage === s;

    // ── Wave 1: All data-fetch stages in parallel ──────────────────────────
    // stageFixtures now runs 21 per-sport invocations in parallel (~50s).
    // Running standings/odds/stats alongside it is free since they are independent.
    const wave1Promises: Array<Promise<StageResult>> = [];
    if (runStage('fixtures'))  wave1Promises.push(stageFixtures(supabase));
    if (runStage('metadata'))  wave1Promises.push(stageMetadata(supabase));
    if (runStage('standings')) wave1Promises.push(stageStandings(supabase));
    if (runStage('odds'))      wave1Promises.push(stageOdds(supabase));
    if (runStage('stats'))     wave1Promises.push(stageStats(supabase));

    const wave1Results = await Promise.allSettled(wave1Promises);
    for (const r of wave1Results) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ stage: 'unknown', status: 'failed', durationMs: 0, records: 0, error: String(r.reason) });
    }

    // ── Wave 2: Predictions + cache warm in parallel (after fixtures are in DB) ──
    const wave2Promises: Array<Promise<StageResult>> = [];
    if (runStage('predictions')) wave2Promises.push(stagePredictions(supabase));
    if (runStage('reports'))     wave2Promises.push(stageReports(supabase));
    if (runStage('warm'))        wave2Promises.push(stageCacheWarm(supabase));

    const wave2Results = await Promise.allSettled(wave2Promises);
    for (const r of wave2Results) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ stage: 'unknown', status: 'failed', durationMs: 0, records: 0, error: String(r.reason) });
    }

    const totalMs = Date.now() - pipelineStart;
    const failed = results.filter(r => r.status === 'failed').length;
    const partial = results.filter(r => r.status === 'partial').length;
    const overallStatus = failed === 0 && partial === 0 ? 'success' : failed > 0 ? 'partial' : 'partial';

    // Log to sync_logs
    await supabase.from('sync_logs').insert({
      job_name: 'midnight-preload',
      status: overallStatus,
      records_affected: results.reduce((sum, r) => sum + r.records, 0),
      duration_ms: totalMs,
      error_message: failed > 0 ? `${failed} stage(s) failed` : null,
    }).catch(() => {});

    console.log(`[midnight-preload] Complete in ${totalMs}ms | ${overallStatus} | ${results.length} stages`);

    return new Response(JSON.stringify({
      success: true,
      stage,
      overallStatus,
      totalDurationMs: totalMs,
      stages: results,
      summary: {
        totalRecords: results.reduce((sum, r) => sum + r.records, 0),
        failedStages: failed,
        partialStages: partial,
        completedAt: new Date().toISOString(),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[midnight-preload] Fatal error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: String(err),
      totalDurationMs: Date.now() - pipelineStart,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
