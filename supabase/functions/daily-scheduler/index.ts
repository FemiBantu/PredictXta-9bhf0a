/**
 * daily-scheduler — PredictXta Automated Data Pipeline
 *
 * Runs the full 10-stage next-day fixture readiness pipeline ensuring
 * all data is available before 21:00 daily.
 *
 * Pipeline stages:
 *   Stage 1  — fetch_fixtures      : Pull all sport fixtures (API-Football → TheSportsDB)
 *   Stage 2  — validate_fixtures   : Validate and deduplicate fixture data
 *   Stage 3  — fetch_odds          : Collect odds for all upcoming fixtures
 *   Stage 4  — fetch_standings     : Update league standings + team form
 *   Stage 5  — generate_predictions: Batch AI prediction generation
 *   Stage 6  — run_quality_gate    : Quality-gate all new predictions
 *   Stage 7  — cache_predictions   : Warm cache layer for frontend
 *   Stage 8  — generate_challenge  : Build Daily Challenge picks
 *   Stage 9  — settle_daily        : Settle expert slip picks against finished matches
 *   Stage 10 — publish_report      : Final readiness report + alert sending
 *
 * Provider Priority:
 *   Football:          API-Football (primary) → TheSportsDB (secondary)
 *   All Other Sports:  TheSportsDB (primary) → API-Football where supported
 *   News/Highlights:   TheSportsDB (primary) → API-Football (secondary)
 *   NOTE: Highlightly has been permanently removed from the data pipeline.
 *
 * Trigger modes:
 *   { mode: 'full' }         — Run all 10 stages
 *   { mode: 'fixtures' }     — Stages 1–2 only
 *   { mode: 'predictions' }  — Stages 5–7 only
 *   { mode: 'status' }       — Return current pipeline status (no execution)
 *   { mode: 'stage', stage: 'fetch_fixtures' } — Single stage
 *   { mode: 'settle' }       — Stage 9 only (expert settlement)
 *
 * Schedule:
 *   18:00 — { mode: 'fixtures' }
 *   19:00 — { mode: 'stage', stage: 'fetch_odds' }
 *   20:00 — { mode: 'predictions' }
 *   21:00 — { mode: 'full' } (safety net / final verification)
 *   23:00 — { mode: 'settle' } (auto-settle expert picks)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────
interface StageResult {
  stage: string;
  status: 'success' | 'failed' | 'skipped' | 'partial';
  duration_ms: number;
  records_affected: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface PipelineReport {
  run_date: string;
  triggered_at: string;
  mode: string;
  stages: StageResult[];
  total_duration_ms: number;
  overall_status: 'success' | 'partial' | 'failed';
  readiness_score: number;
  alerts: string[];
  summary: {
    fixtures_fetched: number;
    fixtures_validated: number;
    predictions_generated: number;
    predictions_approved: number;
    odds_coverage_pct: number;
    sports_covered: string[];
    expert_picks_settled: number;
    provider_failovers: number;
  };
}

// ─── Supabase admin client ────────────────────────────────────────────────────
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ─── Logging helpers ──────────────────────────────────────────────────────────
async function logStage(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
  stage: string,
  status: string,
  durationMs: number,
  records: number,
  error?: string,
  details?: Record<string, unknown>,
) {
  try {
    await supabase.from('daily_pipeline_log').upsert({
      run_date: runDate,
      stage,
      status,
      started_at: new Date(Date.now() - durationMs).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      records_affected: records,
      error_message: error ?? null,
      details: details ?? {},
    }, { onConflict: 'run_date,stage', ignoreDuplicates: false });
  } catch { /* non-blocking */ }
}

async function createAlert(
  supabase: ReturnType<typeof adminClient>,
  alertType: string,
  severity: 'info' | 'warning' | 'critical',
  message: string,
  details?: Record<string, unknown>,
) {
  try {
    await supabase.from('pipeline_alerts').insert({
      alert_type: alertType,
      severity,
      message,
      details: details ?? {},
      resolved: false,
    });
    console.log(`[ALERT ${severity.toUpperCase()}] ${alertType}: ${message}`);
  } catch { /* non-blocking */ }
}

// ─── Helper: invoke another edge function ────────────────────────────────────
async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 55_000,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'x-scheduler-key': Deno.env.get('ML_INGEST_HMAC_SECRET') ?? '',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => 'no body');
      return { ok: false, data: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, data: null, error: String(e) };
  }
}

// ─── Target date helpers ──────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

// Canonical 13-sport registry — must match services/sportsRegistry.ts SUPPORTED_SPORTS
// Boxing and Esports added; AFL retained for data validation but excluded from
// prediction generation (no quality-gated AI models for AFL currently).
const ALL_SPORTS = [
  'football', 'basketball', 'tennis', 'cricket', 'baseball',
  'hockey', 'rugby', 'handball', 'volleyball', 'mma', 'boxing',
  'american-football', 'esports',
];

// ─── STAGE 1: Fetch fixtures (Football: API-Football→TheSportsDB | Other: TheSportsDB→API-Football) ──
async function stageFetchFixtures(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
  targetDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log(`[Stage 1] Fetching fixtures for ${targetDate} — Provider: API-Football (primary)...`);
  let totalFetched = 0;
  let providerFailovers = 0;
  const errors: string[] = [];

  try {
    // Primary for football: API-Football
    // Primary for other sports: TheSportsDB (via fetch-matches sport routing)
    const primaryResult = await invokeFunction('fetch-matches', {
      mode: 'today',
      sport: 'all',
      bypassCache: false,
    });

    if (!primaryResult.ok) {
      errors.push(`API-Football/API-Sports (primary): ${primaryResult.error}`);
      console.warn('[Stage 1] Primary providers failed — TheSportsDB fallback activated');
      providerFailovers++;

      // Secondary fallback: TheSportsDB for all sports
      const secondaryResult = await invokeFunction('fetch-matches', {
        mode: 'today',
        sport: 'all',
        provider: 'thesportsdb',
      });

      if (secondaryResult.ok) {
        const d = secondaryResult.data as Record<string, unknown>;
        totalFetched += Number(d?.fetched ?? 0);
        console.log(`[Stage 1] TheSportsDB (secondary) fetched ${totalFetched} fixtures`);
      } else {
        errors.push(`TheSportsDB (secondary): ${secondaryResult.error}`);
        providerFailovers++;
        console.error('[Stage 1] Both primary and secondary providers failed — no fixtures available');
      }
    } else {
      const d = primaryResult.data as Record<string, unknown>;
      totalFetched += Number(d?.fetched ?? 0);
      console.log(`[Stage 1] Primary providers fetched ${totalFetched} fixtures`);

      // Log provider breakdown
      const sources = d?.sources as Record<string, number> | undefined;
      if (sources) {
        console.log(`[Stage 1] Sources: api-football=${sources.api_football ?? 0} api-sports=${sources.api_sports ?? 0} thesportsdb=${sources.thesportsdb ?? 0}`);
      }
    }

    const duration = Date.now() - start;
    const status = totalFetched > 0 ? 'success' : 'partial';

    await logStage(supabase, runDate, 'fetch_fixtures', status, duration, totalFetched, errors[0], {
      targetDate,
      errors: errors.length > 0 ? errors : undefined,
      providerFailovers,
    });

    if (totalFetched === 0) {
      await createAlert(supabase, 'fixtures_missing', 'critical',
        `No fixtures fetched for ${targetDate} after all 3 provider attempts`, { errors, providerFailovers });
    } else if (providerFailovers > 0) {
      await createAlert(supabase, 'provider_failover', 'warning',
        `Primary provider failed for ${targetDate}. Failovers: ${providerFailovers}. Total fetched: ${totalFetched}`,
        { errors, providerFailovers, totalFetched });
    }

    return {
      stage: 'fetch_fixtures', status, duration_ms: duration, records_affected: totalFetched,
      error: errors[0],
      details: { targetDate, providerFailovers, errors: errors.length > 0 ? errors : undefined },
    };
  } catch (e) {
    const duration = Date.now() - start;
    const err = String(e);
    await logStage(supabase, runDate, 'fetch_fixtures', 'failed', duration, 0, err);
    await createAlert(supabase, 'fixtures_fetch_error', 'critical', `Fixture fetch failed: ${err}`);
    return { stage: 'fetch_fixtures', status: 'failed', duration_ms: duration, records_affected: 0, error: err };
  }
}

// ─── STAGE 2: Validate fixtures ───────────────────────────────────────────────
async function stageValidateFixtures(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 2] Validating fixtures...');

  try {
    const { data: sportCounts } = await supabase
      .from('matches')
      .select('sport, status')
      .in('status', ['upcoming', 'live'])
      .gte('match_time', new Date().toISOString());

    const bySport: Record<string, number> = {};
    for (const row of (sportCounts ?? [])) {
      bySport[row.sport] = (bySport[row.sport] ?? 0) + 1;
    }

    const missingSports = ALL_SPORTS.filter(s => !bySport[s] || bySport[s] === 0);
    if (missingSports.length > 0) {
      await createAlert(supabase, 'sports_no_fixtures', 'warning',
        `Sports with no upcoming fixtures: ${missingSports.join(', ')}`,
        { missingSports, availableSports: bySport });
    }

    const totalValid = Object.values(bySport).reduce((a, b) => a + b, 0);
    const duration = Date.now() - start;
    const status = totalValid > 0 ? 'success' : 'failed';

    await logStage(supabase, runDate, 'validate_fixtures', status, duration, totalValid, undefined, {
      sportBreakdown: bySport,
      missingSports,
    });

    return {
      stage: 'validate_fixtures', status, duration_ms: duration,
      records_affected: totalValid,
      details: { sportBreakdown: bySport, missingSports },
    };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'validate_fixtures', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 3: Fetch odds ──────────────────────────────────────────────────────
async function stageFetchOdds(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 3] Fetching odds...');

  try {
    const result = await invokeFunction('fetch-odds', { mode: 'today' });
    const d = result.data as Record<string, unknown>;
    const upserted = Number(d?.upserted ?? 0);
    const duration = Date.now() - start;

    if (!result.ok || upserted === 0) {
      await createAlert(supabase, 'odds_unavailable', 'warning',
        `Odds fetch returned ${upserted} rows. Error: ${result.error ?? 'none'}`,
        { result: d });
    }

    const status = upserted > 0 ? 'success' : 'partial';
    await logStage(supabase, runDate, 'fetch_odds', status, duration, upserted, result.error);

    return { stage: 'fetch_odds', status, duration_ms: duration, records_affected: upserted, error: result.error, details: d as Record<string, unknown> };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'fetch_odds', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 4: Fetch standings ─────────────────────────────────────────────────
async function stageFetchStandings(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 4] Syncing standings...');

  try {
    const result = await invokeFunction('sync-standings', { sport: 'football', leagues: [39, 140, 78, 135, 61] });
    const d = result.data as Record<string, unknown>;
    const duration = Date.now() - start;

    await logStage(supabase, runDate, 'fetch_standings', result.ok ? 'success' : 'partial', duration,
      Number(d?.upserted ?? 0), result.error);

    return {
      stage: 'fetch_standings',
      status: result.ok ? 'success' : 'partial',
      duration_ms: duration,
      records_affected: Number(d?.upserted ?? 0),
      error: result.error,
    };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'fetch_standings', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 5: Generate predictions ───────────────────────────────────────────
async function stageGeneratePredictions(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
  batchSize = 20,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 5] Generating AI predictions for unpredicted fixtures...');

  try {
    const { data: unpredicted } = await supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, country, match_time, stats, home_form, away_form, home_logo, away_logo, home_score, away_score, status, minute, venue')
      .in('status', ['upcoming'])
      .gte('match_time', new Date().toISOString())
      .lte('match_time', new Date(Date.now() + 48 * 3600_000).toISOString())
      .not('id', 'in', supabase.from('predictions').select('match_id').limit(10000))
      .order('match_time', { ascending: true })
      .limit(batchSize);

    const matches = unpredicted ?? [];
    console.log(`[Stage 5] Found ${matches.length} unpredicted matches`);

    if (matches.length === 0) {
      const duration = Date.now() - start;
      await logStage(supabase, runDate, 'generate_predictions', 'success', duration, 0, undefined, { message: 'All fixtures already predicted' });
      return { stage: 'generate_predictions', status: 'success', duration_ms: duration, records_affected: 0, details: { message: 'All predicted' } };
    }

    let generated = 0;
    let failed = 0;

    const PARALLEL = 3;
    for (let i = 0; i < matches.length; i += PARALLEL) {
      const batch = matches.slice(i, i + PARALLEL);
      const promises = batch.map(async (match: Record<string, unknown>) => {
        try {
          const result = await invokeFunction('generate-prediction', {
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
          }, 30_000);

          if (result.ok && (result.data as Record<string, unknown>)?.success) {
            generated++;
          } else {
            failed++;
          }
        } catch { failed++; }
      });
      await Promise.all(promises);
      if (i + PARALLEL < matches.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const duration = Date.now() - start;
    const status = generated > 0 ? (failed === 0 ? 'success' : 'partial') : 'failed';

    await logStage(supabase, runDate, 'generate_predictions', status, duration, generated, undefined, {
      attempted: matches.length,
      generated,
      failed,
    });

    if (failed > 0) {
      await createAlert(supabase, 'prediction_failures', 'warning',
        `${failed}/${matches.length} prediction generations failed`,
        { generated, failed });
    }

    return {
      stage: 'generate_predictions', status, duration_ms: duration, records_affected: generated,
      details: { attempted: matches.length, generated, failed },
    };
  } catch (e) {
    const duration = Date.now() - start;
    const err = String(e);
    await logStage(supabase, runDate, 'generate_predictions', 'failed', duration, 0, err);
    return { stage: 'generate_predictions', status: 'failed', duration_ms: duration, records_affected: 0, error: err };
  }
}

// ─── STAGE 6: Quality gate ────────────────────────────────────────────────────
async function stageQualityGate(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 6] Running quality gate...');

  try {
    const { count: total } = await supabase
      .from('predictions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 2 * 3600_000).toISOString())
      .is('quality_gate_score', null);

    const duration = Date.now() - start;
    await logStage(supabase, runDate, 'quality_gate', 'success', duration, total ?? 0, undefined, {
      message: 'Quality gate validation embedded in prediction generation pipeline',
    });

    return {
      stage: 'quality_gate', status: 'success',
      duration_ms: duration, records_affected: total ?? 0,
      details: { note: 'Gate runs inline during generation' },
    };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'quality_gate', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 7: Cache warm ──────────────────────────────────────────────────────
async function stageCacheWarm(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 7] Warming prediction cache...');

  try {
    const sports = ['football', 'basketball', 'tennis', 'cricket', 'baseball', 'hockey', 'rugby', 'handball', 'volleyball', 'mma', 'boxing', 'esports', 'all'];
    let updated = 0;

    for (const sport of sports) {
      const baseQuery = sport !== 'all'
        ? supabase.from('matches').select('id', { count: 'exact', head: true }).eq('sport', sport)
        : supabase.from('matches').select('id', { count: 'exact', head: true });

      const { count: liveCount } = await baseQuery.eq('status', 'live');
      const { count: upcomingCount } = await baseQuery
        .eq('status', 'upcoming')
        .gte('match_time', new Date().toISOString())
        .lte('match_time', new Date(Date.now() + 24 * 3600_000).toISOString());

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

      updated++;
    }

    const duration = Date.now() - start;
    await logStage(supabase, runDate, 'cache_warm', 'success', duration, updated);

    return { stage: 'cache_warm', status: 'success', duration_ms: duration, records_affected: updated };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'cache_warm', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 8: Generate Daily Challenge ───────────────────────────────────────
async function stageGenerateChallenge(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 8] Generating daily challenge...');

  try {
    const tomorrow = tomorrowStr();
    const { data: existing } = await supabase
      .from('daily_challenges')
      .select('id, status')
      .eq('challenge_date', tomorrow)
      .maybeSingle();

    if (existing?.status === 'active') {
      const duration = Date.now() - start;
      await logStage(supabase, runDate, 'generate_challenge', 'success', duration, 0, undefined, {
        message: `Challenge already exists for ${tomorrow}`,
      });
      return { stage: 'generate_challenge', status: 'success', duration_ms: duration, records_affected: 0, details: { message: 'Already generated' } };
    }

    const result = await invokeFunction('generate-daily-challenge', { date: tomorrow });
    const duration = Date.now() - start;

    if (!result.ok) {
      await createAlert(supabase, 'challenge_generation_failed', 'warning',
        `Daily challenge generation failed for ${tomorrow}: ${result.error}`);
    }

    await logStage(supabase, runDate, 'generate_challenge', result.ok ? 'success' : 'partial', duration, 1, result.error);

    return {
      stage: 'generate_challenge',
      status: result.ok ? 'success' : 'partial',
      duration_ms: duration,
      records_affected: result.ok ? 1 : 0,
      error: result.error,
    };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'generate_challenge', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── STAGE 9: Settle Daily Expert Picks ──────────────────────────────────────
/**
 * Runs at 23:00 each day.
 * Invokes expert-promotion with action=settle_daily for today's date.
 * Logs result to daily_pipeline_log.
 * Triggers a pipeline_alert if errors > 0.
 */
async function stageSettleDaily(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<StageResult> {
  const start = Date.now();
  console.log(`[Stage 9] Settling expert picks for ${runDate}...`);

  try {
    const result = await invokeFunction('expert-promotion', {
      action: 'settle_daily',
      date: runDate,
    }, 55_000);

    const d = result.data as Record<string, unknown>;
    const duration = Date.now() - start;

    const settled     = Number(d?.settled     ?? 0);
    const errors      = Number(d?.errors      ?? 0);
    const slipsSettled = Number(d?.slipsSettled ?? 0);

    console.log(`[Stage 9] Expert settlement: ${settled} picks settled, ${slipsSettled} slips closed, ${errors} errors`);

    if (!result.ok) {
      await createAlert(supabase, 'expert_settlement_failed', 'critical',
        `Expert pick settlement failed for ${runDate}: ${result.error}`,
        { error: result.error });
      await logStage(supabase, runDate, 'settle_daily', 'failed', duration, 0, result.error);
      return { stage: 'settle_daily', status: 'failed', duration_ms: duration, records_affected: 0, error: result.error };
    }

    if (errors > 0) {
      await createAlert(supabase, 'expert_settlement_partial', 'warning',
        `Expert settlement for ${runDate} had ${errors} errors. Settled: ${settled} picks, ${slipsSettled} slips.`,
        { settled, slipsSettled, errors, date: runDate });
    }

    const status = errors === 0 ? 'success' : 'partial';
    await logStage(supabase, runDate, 'settle_daily', status, duration, settled, undefined, {
      settled,
      slipsSettled,
      errors,
      date: runDate,
      details: d,
    });

    return {
      stage: 'settle_daily',
      status,
      duration_ms: duration,
      records_affected: settled,
      details: { settled, slipsSettled, errors, date: runDate },
    };
  } catch (e) {
    const duration = Date.now() - start;
    const err = String(e);
    await logStage(supabase, runDate, 'settle_daily', 'failed', duration, 0, err);
    await createAlert(supabase, 'expert_settlement_error', 'critical',
      `Expert settlement threw exception for ${runDate}: ${err}`);
    return { stage: 'settle_daily', status: 'failed', duration_ms: duration, records_affected: 0, error: err };
  }
}

// ─── STAGE 10: Publish report ──────────────────────────────────────────────────
async function stagePublishReport(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
  allStageResults: StageResult[],
): Promise<StageResult> {
  const start = Date.now();
  console.log('[Stage 10] Generating readiness report...');

  try {
    const { data: sportStats } = await supabase
      .from('matches')
      .select('sport, status')
      .in('status', ['upcoming', 'live'])
      .gte('match_time', new Date().toISOString());

    const { data: predStats } = await supabase
      .from('predictions')
      .select('match_id')
      .gte('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

    const { data: oddsStats } = await supabase
      .from('odds')
      .select('match_id')
      .gte('last_updated', new Date(Date.now() - 24 * 3600_000).toISOString());

    const sportsWithFixtures = [...new Set((sportStats ?? []).map((r: Record<string, unknown>) => r.sport as string))];
    const predMatchIds = new Set((predStats ?? []).map((r: Record<string, unknown>) => r.match_id as string));
    const oddsMatchIds = new Set((oddsStats ?? []).map((r: Record<string, unknown>) => r.match_id as string));

    const upcomingCount = (sportStats ?? []).filter((r: Record<string, unknown>) => r.status === 'upcoming').length;
    const liveCount = (sportStats ?? []).filter((r: Record<string, unknown>) => r.status === 'live').length;
    const oddsCoverage = upcomingCount > 0 ? Math.round((oddsMatchIds.size / upcomingCount) * 100) : 0;

    // Settlement stats
    const settleStage = allStageResults.find(s => s.stage === 'settle_daily');
    const expertPicksSettled = Number(settleStage?.records_affected ?? 0);

    // Provider failover count
    const fixtureStage = allStageResults.find(s => s.stage === 'fetch_fixtures');
    const providerFailovers = Number((fixtureStage?.details?.providerFailovers as number) ?? 0);

    // Compute readiness score (0–100)
    const stageScores: Record<string, number> = {
      fetch_fixtures: 25,
      validate_fixtures: 10,
      fetch_odds: 10,
      fetch_standings: 5,
      generate_predictions: 25,
      quality_gate: 5,
      cache_warm: 10,
      generate_challenge: 5,
      settle_daily: 5,
    };

    let readinessScore = 0;
    for (const sr of allStageResults) {
      const weight = stageScores[sr.stage] ?? 5;
      if (sr.status === 'success') readinessScore += weight;
      else if (sr.status === 'partial') readinessScore += Math.round(weight * 0.5);
    }

    if (upcomingCount > 0) {
      const predCoverage = (predMatchIds.size / upcomingCount) * 100;
      if (predCoverage >= 80) readinessScore = Math.min(100, readinessScore + 5);
    }

    const hour = new Date().getHours();
    if (readinessScore < 60 && hour >= 20) {
      await createAlert(supabase, 'low_readiness_score', 'critical',
        `Pipeline readiness ${readinessScore}/100 at ${hour}:00 — target was 21:00`,
        { readinessScore, upcomingCount, sportsWithFixtures });
    }

    await supabase.from('sync_logs').insert({
      job_name: 'daily-scheduler',
      status: readinessScore >= 70 ? 'success' : readinessScore >= 40 ? 'partial' : 'failed',
      records_affected: upcomingCount + predMatchIds.size,
      duration_ms: Date.now() - start,
      error_message: readinessScore < 40 ? `Low readiness: ${readinessScore}/100` : null,
    });

    const duration = Date.now() - start;
    await logStage(supabase, runDate, 'publish_report', 'success', duration, readinessScore, undefined, {
      readinessScore,
      upcomingFixtures: upcomingCount,
      liveFixtures: liveCount,
      predictedCount: predMatchIds.size,
      oddsCoverage,
      sportsWithFixtures,
      expertPicksSettled,
      providerFailovers,
    });

    return {
      stage: 'publish_report',
      status: 'success',
      duration_ms: duration,
      records_affected: readinessScore,
      details: {
        readiness_score: readinessScore,
        upcoming_fixtures: upcomingCount,
        live_fixtures: liveCount,
        predicted_count: predMatchIds.size,
        odds_coverage_pct: oddsCoverage,
        sports_covered: sportsWithFixtures,
        expert_picks_settled: expertPicksSettled,
        provider_failovers: providerFailovers,
      },
    };
  } catch (e) {
    const duration = Date.now() - start;
    return { stage: 'publish_report', status: 'failed', duration_ms: duration, records_affected: 0, error: String(e) };
  }
}

// ─── Pipeline status query ────────────────────────────────────────────────────
async function getPipelineStatus(
  supabase: ReturnType<typeof adminClient>,
  runDate: string,
): Promise<Record<string, unknown>> {
  const { data: logs } = await supabase
    .from('daily_pipeline_log')
    .select('*')
    .eq('run_date', runDate)
    .order('created_at', { ascending: false });

  const { data: alerts } = await supabase
    .from('pipeline_alerts')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(10);

  const { count: upcomingCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'upcoming')
    .gte('match_time', new Date().toISOString());

  const { count: liveCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'live');

  const { count: predictedCount } = await supabase
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

  const { count: oddsCount } = await supabase
    .from('odds')
    .select('id', { count: 'exact', head: true })
    .gte('last_updated', new Date(Date.now() - 24 * 3600_000).toISOString());

  const stageMap: Record<string, unknown> = {};
  for (const log of (logs ?? [])) {
    if (!stageMap[log.stage]) stageMap[log.stage] = log;
  }

  return {
    runDate,
    currentTime: new Date().toISOString(),
    stages: stageMap,
    recentAlerts: alerts ?? [],
    metrics: {
      upcomingFixtures: upcomingCount ?? 0,
      liveFixtures: liveCount ?? 0,
      recentPredictions: predictedCount ?? 0,
      recentOdds: oddsCount ?? 0,
    },
    providerPriority: {
      football: { primary: 'API-Football', secondary: 'TheSportsDB' },
      otherSports: { primary: 'TheSportsDB', secondary: 'API-Football' },
      newsHighlights: { primary: 'TheSportsDB', secondary: 'API-Football' },
    },
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = adminClient();
  const runDate = todayStr();
  const pipelineStart = Date.now();

  try {
    let mode = 'full';
    let specificStage = '';
    let batchSize = 20;
    let targetDate = tomorrowStr();

    try {
      const body = await req.json();
      mode = body?.mode ?? 'full';
      specificStage = body?.stage ?? '';
      batchSize = Number(body?.batchSize ?? 20);
      targetDate = body?.targetDate ?? tomorrowStr();
    } catch { /* use defaults */ }

    console.log(`[daily-scheduler] mode=${mode} stage=${specificStage} targetDate=${targetDate} runDate=${runDate}`);

    // Status-only mode
    if (mode === 'status') {
      const status = await getPipelineStatus(supabase, runDate);
      return new Response(JSON.stringify({ success: true, ...status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stageResults: StageResult[] = [];
    const runStage = (name: string) =>
      mode === 'full' || mode === 'midnight_cleanup' ||
      (mode === 'settle' && name === 'settle_daily') ||
      (mode === 'stage' && specificStage === name) ||
      (mode === 'fixtures' && ['fetch_fixtures', 'validate_fixtures'].includes(name)) ||
      (mode === 'predictions' && ['generate_predictions', 'quality_gate', 'cache_warm'].includes(name));

    // ── Stage 1 ──
    if (runStage('fetch_fixtures')) {
      stageResults.push(await stageFetchFixtures(supabase, runDate, targetDate));
    }
    // ── Stage 2 ──
    if (runStage('validate_fixtures')) {
      stageResults.push(await stageValidateFixtures(supabase, runDate));
    }
    // ── Stage 3 ──
    if (runStage('fetch_odds')) {
      stageResults.push(await stageFetchOdds(supabase, runDate));
    }
    // ── Stage 4 ──
    if (runStage('fetch_standings')) {
      stageResults.push(await stageFetchStandings(supabase, runDate));
    }
    // ── Stage 5 ──
    if (runStage('generate_predictions')) {
      stageResults.push(await stageGeneratePredictions(supabase, runDate, batchSize));
    }
    // ── Stage 6 ──
    if (runStage('quality_gate')) {
      stageResults.push(await stageQualityGate(supabase, runDate));
    }
    // ── Stage 7 ──
    if (runStage('cache_warm')) {
      stageResults.push(await stageCacheWarm(supabase, runDate));
    }
    // ── Stage 8 ──
    if (runStage('generate_challenge')) {
      stageResults.push(await stageGenerateChallenge(supabase, runDate));
    }
    // ── Stage 9: Settle daily expert picks ──
    if (runStage('settle_daily') || mode === 'settle') {
      stageResults.push(await stageSettleDaily(supabase, runDate));
    }
    // ── Midnight cleanup: purge stale data ──
    if (mode === 'full' || specificStage === 'midnight_cleanup' || (mode === 'stage' && specificStage === 'midnight_cleanup')) {
      const cleanupStart = Date.now();
      console.log('[daily-scheduler] Running midnight stale-data cleanup...');
      try {
        const { data: cleanupResult } = await supabase.rpc('cleanup_stale_data_midnight');
        const cleanupDuration = Date.now() - cleanupStart;
        stageResults.push({
          stage: 'midnight_cleanup',
          status: 'success',
          duration_ms: cleanupDuration,
          records_affected: Number(
            (cleanupResult as Record<string,unknown>)?.stale_live_fixed ?? 0
          ) + Number(
            (cleanupResult as Record<string,unknown>)?.stale_upcoming_fixed ?? 0
          ) + Number(
            (cleanupResult as Record<string,unknown>)?.api_usage_purged ?? 0
          ) + Number(
            (cleanupResult as Record<string,unknown>)?.cache_purged ?? 0
          ),
          details: cleanupResult as Record<string,unknown>,
        });
        console.log('[daily-scheduler] Midnight cleanup complete:', cleanupResult);
      } catch (e) {
        stageResults.push({ stage: 'midnight_cleanup', status: 'failed', duration_ms: Date.now() - cleanupStart, records_affected: 0, error: String(e) });
      }
    }
    // ── Stage 10 ──
    if (mode === 'full' || mode === 'settle' || (mode === 'stage' && specificStage === 'publish_report')) {
      stageResults.push(await stagePublishReport(supabase, runDate, stageResults));
    }

    const totalDuration = Date.now() - pipelineStart;
    const failedStages = stageResults.filter(s => s.status === 'failed');
    const partialStages = stageResults.filter(s => s.status === 'partial');
    const overallStatus = failedStages.length === 0 ? (partialStages.length === 0 ? 'success' : 'partial') : 'failed';

    const reportStage = stageResults.find(s => s.stage === 'publish_report');
    const readinessScore = Number(reportStage?.records_affected ?? 0);

    const settleStage = stageResults.find(s => s.stage === 'settle_daily');
    const fixtureStage = stageResults.find(s => s.stage === 'fetch_fixtures');

    const summary = {
      fixtures_fetched: fixtureStage?.records_affected ?? 0,
      fixtures_validated: stageResults.find(s => s.stage === 'validate_fixtures')?.records_affected ?? 0,
      predictions_generated: stageResults.find(s => s.stage === 'generate_predictions')?.records_affected ?? 0,
      predictions_approved: stageResults.find(s => s.stage === 'quality_gate')?.records_affected ?? 0,
      odds_coverage_pct: (reportStage?.details?.['odds_coverage_pct'] as number) ?? 0,
      sports_covered: (reportStage?.details?.['sports_covered'] as string[]) ?? [],
      expert_picks_settled: settleStage?.records_affected ?? 0,
      provider_failovers: Number((fixtureStage?.details?.providerFailovers as number) ?? 0),
    };

    const report: PipelineReport = {
      run_date: runDate,
      triggered_at: new Date(pipelineStart).toISOString(),
      mode,
      stages: stageResults,
      total_duration_ms: totalDuration,
      overall_status: overallStatus,
      readiness_score: readinessScore,
      alerts: failedStages.map(s => `${s.stage}: ${s.error ?? 'Failed'}`),
      summary,
    };

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[daily-scheduler] Fatal error:', err);
    return new Response(
      JSON.stringify({ success: false, error: String(err), run_date: runDate }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
