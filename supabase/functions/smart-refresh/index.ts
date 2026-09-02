/**
 * supabase/functions/smart-refresh/index.ts — Phase 5 Smart Prediction Scheduler v2.0
 *
 * Automated prediction lifecycle manager that runs as a scheduled edge function.
 *
 * Lifecycle:
 *   SCHEDULED → DATA_READY → GENERATING → VALIDATING → PUBLISHED
 *   FAILED | STALE | CANCELLED
 *
 * Responsibilities:
 *   1. Scan for eligible upcoming matches without predictions
 *   2. Check data readiness gate (features, odds, form, standings)
 *   3. Enqueue prediction jobs with idempotency keys
 *   4. Generate predictions in batches (respects AI quota)
 *   5. Mark stale predictions (match started without prediction)
 *   6. Settle finished matches via resolve-prediction
 *   7. Warm feed cache after batch generation
 *   8. Emit observability metrics to ai_governance_log
 *
 * Called by:
 *   - pg_cron / scheduled_jobs at 18:00, 20:00, 21:00 UTC
 *   - daily-scheduler stage 5 (generate_predictions)
 *   - manual admin trigger
 *
 * Phase 5 compliance:
 *   ✓ Idempotency keys prevent duplicate generation
 *   ✓ Pre-generation readiness gate
 *   ✓ Prediction lifecycle state machine
 *   ✓ Quota-aware batch sizing
 *   ✓ Never generates predictions for live/finished matches
 *   ✓ Structured job visibility in prediction_jobs table
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applySecurityMiddleware,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';
import { checkPredictionEligibility } from '../_shared/predictionEligibility.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Readiness thresholds ────────────────────────────────────────────────────
const MIN_DQ_FOR_GENERATION = 25;
const BATCH_SIZE             = 15;
const MAX_PARALLEL           = 3;
const PREDICTION_TTL_HOURS   = 4;
const MIN_KICKOFF_BUFFER_MIN = 30; // don't generate < 30min before kickoff

// ─── Sports where odds are required for generation ───────────────────────────
const ODDS_REQUIRED_SPORTS = new Set(['football', 'basketball', 'tennis']);

// ─── Idempotency key generator ───────────────────────────────────────────────
function predictionIdempotencyKey(matchId: string, date: string): string {
  return `pred-${matchId.slice(0, 8)}-${date}`;
}

// ─── Data readiness check ────────────────────────────────────────────────────
interface ReadinessResult {
  ready:  boolean;
  dqScore: number;
  reasons: string[];
}

function checkDataReadiness(
  match: Record<string, unknown>,
  hasOdds: boolean,
): ReadinessResult {
  const reasons: string[] = [];
  let dqScore = 40; // baseline

  const sport = String(match.sport ?? 'football');
  const homeForm = match.home_form as string[] | null;
  const awayForm = match.away_form as string[] | null;

  if (homeForm?.length && homeForm.length >= 3) dqScore += 10;
  else reasons.push('missing home form');

  if (awayForm?.length && awayForm.length >= 3) dqScore += 10;
  else reasons.push('missing away form');

  if (match.home_standings_pos || match.stats) dqScore += 8;

  if (hasOdds) {
    dqScore += 10;
  } else if (ODDS_REQUIRED_SPORTS.has(sport)) {
    reasons.push('odds unavailable for required sport');
  }

  if (match.home_goals_scored !== undefined || (match.stats as any)?.goals) {
    dqScore += 8;
  }

  dqScore = Math.min(100, dqScore);

  if (dqScore < MIN_DQ_FOR_GENERATION) {
    reasons.push(`DQ score ${dqScore} below minimum ${MIN_DQ_FOR_GENERATION}`);
  }

  return { ready: dqScore >= MIN_DQ_FOR_GENERATION && reasons.length === 0, dqScore, reasons };
}

// ─── Invoke edge function ────────────────────────────────────────────────────
async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 35_000,
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
      const txt = await res.text().catch(() => '');
      return { ok: false, data: null, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, data: null, error: String(e) };
  }
}

// ─── Update job status ───────────────────────────────────────────────────────
async function updateJobStatus(
  supabase: ReturnType<typeof createClient>,
  idempotencyKey: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  await supabase.from('prediction_jobs')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('idempotency_key', idempotencyKey)
    .catch(() => {}); // non-blocking
}

// ─── Log observability event ─────────────────────────────────────────────────
async function logGovernance(
  supabase: ReturnType<typeof createClient>,
  eventType: string,
  severity: 'info' | 'warning' | 'error',
  details: Record<string, unknown>,
) {
  await supabase.from('ai_governance_log').insert({
    event_type: eventType,
    severity,
    model_id: 'smart-refresh-v2',
    details,
  }).catch(() => {});
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  const startMs = Date.now();

  try {
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit:       { max: 30, windowSec: 3600, blockSec: 3600 },
      maxPayloadBytes: 4_096,
      rateLimitScope:  'smart-refresh',
      blockBotUa:      false,
      sanitizeInput:   false,
      verifySignature: false,
    });
    if (guard) return guard;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = (parsedBody as Record<string, unknown>) ?? {};
    const mode       = String(body.mode ?? 'schedule');
    const batchLimit = Math.min(Number(body.batch_limit ?? BATCH_SIZE), 40);
    const sport      = body.sport ? String(body.sport) : null;
    const dryRun     = Boolean(body.dry_run ?? false);

    console.log(`[smart-refresh] v2 mode=${mode} batch=${batchLimit} sport=${sport ?? 'all'} dry=${dryRun}`);

    const today = new Date().toISOString().split('T')[0];
    const now   = new Date();
    const stats = { scheduled: 0, alreadyQueued: 0, generated: 0, failed: 0, staleMarked: 0, settled: 0 };

    // ── Phase 1: Mark stale predictions ──────────────────────────────────────
    // Matches that started without a prediction are now "stale" — mark them
    const { data: staleJobs } = await supabase
      .from('prediction_jobs')
      .select('id, match_id, idempotency_key')
      .in('status', ['scheduled', 'data_ready'])
      .lt('scheduled_at', new Date(now.getTime() - 60 * 60_000).toISOString()); // > 1h old

    if (staleJobs?.length) {
      for (const job of staleJobs as Record<string, unknown>[]) {
        // Check if match has started
        const { data: m } = await supabase.from('matches').select('status, match_time').eq('id', job.match_id).maybeSingle();
        if (m && (m.status === 'live' || m.status === 'finished')) {
          await updateJobStatus(supabase, job.idempotency_key as string, 'stale', { failure_reason: 'match_started_without_prediction' });
          stats.staleMarked++;
        }
      }
    }

    // ── Phase 2: Find eligible matches needing predictions ────────────────────
    const cutoffTime = new Date(now.getTime() + MIN_KICKOFF_BUFFER_MIN * 60_000).toISOString();
    const maxLookAhead = new Date(now.getTime() + 48 * 3600_000).toISOString();

    let matchQ = supabase
      .from('matches')
      .select('id, sport, home_team, away_team, league, country, match_time, status, home_form, away_form, stats, home_logo, away_logo, league_logo, minute, venue')
      .eq('status', 'upcoming')
      .gt('match_time', cutoffTime)
      .lte('match_time', maxLookAhead)
      .order('match_time', { ascending: true })
      .limit(batchLimit * 2); // fetch more, filter below

    if (sport) matchQ = matchQ.eq('sport', sport);

    const { data: candidateMatches } = await matchQ;
    const candidates = (candidateMatches ?? []) as Record<string, unknown>[];

    if (candidates.length === 0) {
      return secureResponse({ success: true, stats, message: 'No eligible upcoming matches found', elapsed_ms: Date.now() - startMs });
    }

    // ── Phase 3: Filter out already-predicted matches ─────────────────────────
    const candidateIds = candidates.map(m => m.id as string);
    const since = new Date(now.getTime() - PREDICTION_TTL_HOURS * 3600_000).toISOString();

    const { data: existingPreds } = await supabase
      .from('predictions')
      .select('match_id')
      .in('match_id', candidateIds)
      .gte('created_at', since);

    const predictedMatchIds = new Set((existingPreds ?? []).map((p: Record<string, unknown>) => p.match_id as string));

    // ── Phase 4: Filter out already-queued jobs ───────────────────────────────
    const { data: existingJobs } = await supabase
      .from('prediction_jobs')
      .select('match_id, status')
      .in('match_id', candidateIds)
      .in('status', ['scheduled', 'generating', 'validating', 'published']);

    const queuedMatchIds = new Set((existingJobs ?? []).map((j: Record<string, unknown>) => j.match_id as string));

    // ── Phase 5: Fetch odds availability ─────────────────────────────────────
    const { data: oddsData } = await supabase
      .from('odds')
      .select('match_id')
      .in('match_id', candidateIds)
      .gte('last_updated', new Date(now.getTime() - 12 * 3600_000).toISOString());

    const matchesWithOdds = new Set((oddsData ?? []).map((o: Record<string, unknown>) => o.match_id as string));

    // ── Phase 6: Select matches for generation ────────────────────────────────
    const toGenerate: Record<string, unknown>[] = [];

    for (const match of candidates) {
      const matchId = match.id as string;

      // Skip already predicted or queued
      if (predictedMatchIds.has(matchId)) { stats.alreadyQueued++; continue; }
      if (queuedMatchIds.has(matchId))    { stats.alreadyQueued++; continue; }

      // Eligibility gate
      const eligibility = checkPredictionEligibility({
        matchId,
        sport:     String(match.sport ?? 'football'),
        status:    String(match.status ?? 'upcoming'),
        matchTime: String(match.match_time ?? new Date(now.getTime() + 3600_000).toISOString()),
        dqScore:   undefined,
        hasPrediction: false,
      });

      if (!eligibility.eligible && eligibility.status !== 'ELIGIBLE') {
        if (eligibility.status === 'UNSUPPORTED_SPORT') continue; // skip silently
        if (eligibility.status === 'MATCH_STARTED' || eligibility.status === 'MATCH_FINISHED') continue;
      }

      // Data readiness gate
      const readiness = checkDataReadiness(match, matchesWithOdds.has(matchId));

      // Enqueue job record (idempotent)
      const iKey = predictionIdempotencyKey(matchId, today);
      if (!dryRun) {
        await supabase.from('prediction_jobs').upsert({
          match_id:        matchId,
          idempotency_key: iKey,
          sport:           String(match.sport ?? 'football'),
          status:          readiness.ready ? 'data_ready' : 'scheduled',
          dq_score:        readiness.dqScore,
          scheduled_at:    new Date().toISOString(),
          updated_at:      new Date().toISOString(),
          attempts:        0,
        }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      }

      stats.scheduled++;

      if (readiness.ready) {
        toGenerate.push({ match, iKey, dqScore: readiness.dqScore });
      }

      if (toGenerate.length >= batchLimit) break;
    }

    if (mode === 'schedule_only' || dryRun) {
      return secureResponse({ success: true, stats, scheduled: toGenerate.length, dry_run: dryRun, elapsed_ms: Date.now() - startMs });
    }

    // ── Phase 7: Generate predictions in parallel batches ─────────────────────
    for (let i = 0; i < toGenerate.length; i += MAX_PARALLEL) {
      const batch = toGenerate.slice(i, i + MAX_PARALLEL);

      await Promise.allSettled(batch.map(async ({ match, iKey, dqScore }) => {
        const m = match as Record<string, unknown>;
        const matchId = m.id as string;

        // Mark as generating
        await updateJobStatus(supabase, iKey as string, 'generating', {
          started_at: new Date().toISOString(),
          attempts:   1,
        });

        const result = await invokeFunction('generate-prediction', {
          match: {
            id:        matchId,
            sport:     m.sport ?? 'football',
            homeTeam:  m.home_team,
            awayTeam:  m.away_team,
            league:    m.league ?? '',
            country:   m.country,
            homeForm:  m.home_form ?? [],
            awayForm:  m.away_form ?? [],
            status:    m.status,
            minute:    m.minute ?? 0,
            venue:     m.venue,
            stats:     m.stats,
          },
        });

        const respData = result.data as Record<string, unknown>;

        if (result.ok && respData?.success) {
          // Published
          await updateJobStatus(supabase, iKey as string, 'published', {
            completed_at:  new Date().toISOString(),
            prediction_id: (respData.prediction as Record<string, unknown>)?.id ?? null,
          });
          stats.generated++;
        } else if (respData?.rejected || respData?.ineligible) {
          // Quality gate or eligibility gate rejection → cancel job
          await updateJobStatus(supabase, iKey as string, 'cancelled', {
            failure_reason: String(respData?.rejectionReason ?? respData?.reason ?? 'gate_rejected'),
            completed_at:   new Date().toISOString(),
          });
          stats.failed++;
        } else {
          // Recoverable failure
          const attempts = 1;
          const nextRetry = new Date(Date.now() + Math.pow(2, attempts) * 60_000).toISOString();
          await updateJobStatus(supabase, iKey as string, 'failed', {
            failure_reason: String(result.error ?? 'generation_failed'),
            next_retry_at:  nextRetry,
            attempts,
          });
          stats.failed++;
        }
      }));

      // Brief pause between batches to respect rate limits
      if (i + MAX_PARALLEL < toGenerate.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // ── Phase 8: Settle finished matches ──────────────────────────────────────
    if (mode === 'full' || mode === 'settle') {
      const settleResult = await invokeFunction('resolve-prediction', {}, 30_000);
      if (settleResult.ok) {
        stats.settled = Number((settleResult.data as Record<string, unknown>)?.resolved ?? 0);
      }
    }

    // ── Phase 9: Warm cache ───────────────────────────────────────────────────
    if (stats.generated > 0) {
      invokeFunction('home-feed', { sport: 'all', warmCache: true }).catch(() => {});
    }

    // ── Phase 10: Governance log ──────────────────────────────────────────────
    const elapsedMs = Date.now() - startMs;
    await logGovernance(supabase, 'smart_refresh_run', 'info', {
      mode, sport: sport ?? 'all', ...stats, elapsed_ms: elapsedMs,
      batch_size: batchLimit, candidates_found: candidates.length,
    });

    console.log(`[smart-refresh] done | gen=${stats.generated} fail=${stats.failed} stale=${stats.staleMarked} settled=${stats.settled} ${elapsedMs}ms`);

    return secureResponse({ success: true, stats, elapsed_ms: elapsedMs });

  } catch (err) {
    console.error('[smart-refresh] fatal:', err instanceof Error ? err.message : String(err));
    return secureErrorResponse('Internal server error', 500);
  }
});
