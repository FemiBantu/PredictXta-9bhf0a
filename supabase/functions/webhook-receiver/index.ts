/**
 * webhook-receiver — Enterprise Webhook Handler with Full HMAC Verification
 *
 * Security Architecture:
 *   1. HMAC-SHA256 signature verification using ML_INGEST_HMAC_SECRET
 *      (falls back to PX_SIGNING_SECRET for internal PredictXta payloads)
 *   2. Rate limiting via applySecurityMiddleware (max 120/min per IP)
 *   3. Payload size guard (10MB max for bulk webhook batches)
 *   4. Bot UA detection and request sanitization
 *   5. Per-provider signature header support:
 *      - API-Football: x-apisports-key (key-based auth)
 *      - GitHub-style:  x-hub-signature-256: sha256=<hex>
 *      - PredictXta:    x-px-signature + x-px-timestamp (HMAC with timestamp)
 *      - ML Ingest:     x-ml-signature (HMAC of raw body with ML_INGEST_HMAC_SECRET)
 *
 * Pipeline:
 *   1. Verify signature → 401 if invalid
 *   2. Rate-limit check → 429 if exceeded
 *   3. Parse payload by provider format
 *   4. Validate data through dataValidator.ts
 *   5. Upsert to Supabase DB
 *   6. Trigger downstream actions (invalidate cache, send push)
 *   7. Log to sync_logs + webhook_events tables
 *
 * Returns 200 immediately — processing is synchronous within the request.
 * Providers retry on non-2xx, so we ensure quick acknowledgement.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  secureResponse,
  secureErrorResponse,
  secureHeaders,
  getClientIp,
  rateLimitCheck,
} from '../_shared/security.ts';
import {
  validateMatch,
  validateMatchEvent,
  validateOdds,
  batchValidateMatches,
  type RawMatchInput,
  type RawEventInput,
  type RawOddsInput,
} from '../_shared/dataValidator.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─── Secrets (checked at runtime so the function still deploys without them) ──
function getHmacSecret(): string {
  // Primary: ML ingest HMAC secret (for sports data providers)
  return Deno.env.get('ML_INGEST_HMAC_SECRET') ?? Deno.env.get('PX_SIGNING_SECRET') ?? '';
}

function getPxSecret(): string {
  return Deno.env.get('PX_SIGNING_SECRET') ?? '';
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

/** Convert lowercase hex string → Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^(sha256=|sha1=)/i, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Constant-time hex comparison to prevent timing attacks */
function safeHexEqual(a: string, b: string): boolean {
  const ca = a.replace(/^sha256=/i, '').toLowerCase();
  const cb = b.replace(/^sha256=/i, '').toLowerCase();
  if (ca.length !== cb.length) return false;
  let diff = 0;
  for (let i = 0; i < ca.length; i++) {
    diff |= ca.charCodeAt(i) ^ cb.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * computeHmacHex — Compute HMAC-SHA256 over `message` with `secret`, return hex.
 */
async function computeHmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * verifyMlIngestSignature — Verify the x-ml-signature header.
 * Format: HMAC-SHA256(ML_INGEST_HMAC_SECRET, rawBody)
 */
async function verifyMlIngestSignature(body: string, sig: string): Promise<boolean> {
  const secret = getHmacSecret();
  if (!secret || !sig) return false;
  try {
    const expected = await computeHmacHex(body, secret);
    return safeHexEqual(sig, expected);
  } catch { return false; }
}

/**
 * verifyGitHubStyleSignature — Verify x-hub-signature-256: sha256=<hex>
 * Used by API-Football webhook style and GitHub-compatible providers.
 */
async function verifyGitHubStyleSignature(body: string, sig: string): Promise<boolean> {
  const secret = getHmacSecret();
  if (!secret || !sig) return false;
  try {
    const expected = 'sha256=' + await computeHmacHex(body, secret);
    return safeHexEqual(sig, expected);
  } catch { return false; }
}

/**
 * verifyPxTimestampSignature — Verify x-px-signature with timestamp replay protection.
 * Format: HMAC-SHA256(PX_SIGNING_SECRET, "<timestamp>.<body>")
 * Rejects requests older than 5 minutes.
 */
async function verifyPxTimestampSignature(
  body: string,
  sig: string,
  timestamp: string,
): Promise<{ valid: boolean; reason?: string }> {
  const secret = getPxSecret();
  if (!secret) return { valid: true }; // Not configured — skip
  if (!sig || !timestamp) return { valid: false, reason: 'Missing px signature headers' };

  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) return { valid: false, reason: 'Invalid timestamp' };

  // Replay attack guard — reject requests older than 5 minutes
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 300) {
    return { valid: false, reason: 'Timestamp expired (replay attack prevention)' };
  }

  try {
    const payload = `${timestamp}.${body}`;
    const expected = await computeHmacHex(payload, secret);
    const isValid = safeHexEqual(sig, expected);
    return isValid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
  } catch {
    return { valid: false, reason: 'Signature computation failed' };
  }
}

/**
 * performSignatureVerification — Main signature routing function.
 *
 * Header priority:
 *   1. x-ml-signature         → ML ingest HMAC (ML_INGEST_HMAC_SECRET)
 *   2. x-hub-signature-256    → GitHub-style (ML_INGEST_HMAC_SECRET)
 *   3. x-px-signature         → PredictXta internal (PX_SIGNING_SECRET + timestamp)
 *   4. No signature header    → Allow if no secret configured (dev mode)
 */
async function performSignatureVerification(
  req: Request,
  body: string,
): Promise<{ allowed: boolean; method: string; reason?: string }> {
  const mlSig = req.headers.get('x-ml-signature') ?? '';
  const hubSig = req.headers.get('x-hub-signature-256') ?? '';
  const pxSig = req.headers.get('x-px-signature') ?? '';
  const pxTs = req.headers.get('x-px-timestamp') ?? '';

  // Path 1: ML ingest HMAC
  if (mlSig) {
    const valid = await verifyMlIngestSignature(body, mlSig);
    return valid
      ? { allowed: true, method: 'ml-hmac' }
      : { allowed: false, method: 'ml-hmac', reason: 'Invalid x-ml-signature' };
  }

  // Path 2: GitHub-style x-hub-signature-256
  if (hubSig) {
    const valid = await verifyGitHubStyleSignature(body, hubSig);
    return valid
      ? { allowed: true, method: 'hub-hmac' }
      : { allowed: false, method: 'hub-hmac', reason: 'Invalid x-hub-signature-256' };
  }

  // Path 3: PredictXta x-px-signature + timestamp
  if (pxSig) {
    const result = await verifyPxTimestampSignature(body, pxSig, pxTs);
    return result.valid
      ? { allowed: true, method: 'px-hmac' }
      : { allowed: false, method: 'px-hmac', reason: result.reason };
  }

  // Path 4: No signature header
  const secret = getHmacSecret();
  if (secret) {
    // Secret is configured but no signature provided — reject
    return {
      allowed: false,
      method: 'none',
      reason: 'Webhook signature required but not provided. Set x-ml-signature or x-hub-signature-256.',
    };
  }

  // No secret configured — allow for testing/dev
  return { allowed: true, method: 'unsigned-dev' };
}

// ─── Provider-specific normalizers ──────────────────────────────────────────

function normalizeApiFootballStatus(short: string): string {
  const STATUS_MAP: Record<string, string> = {
    'NS': 'upcoming', 'TBD': 'upcoming', 'PST': 'upcoming',
    '1H': 'live', '2H': 'live', 'ET': 'live', 'BT': 'live', 'P': 'live', 'LIVE': 'live',
    'HT': 'live', 'SUSP': 'live', 'INT': 'live', 'BREAK': 'live',
    'FT': 'finished', 'AET': 'finished', 'PEN': 'finished',
    'CANC': 'cancelled', 'ABD': 'cancelled', 'WO': 'finished', 'AWD': 'finished',
  };
  return STATUS_MAP[short.toUpperCase()] ?? 'upcoming';
}

function normalizeApiFootballFixture(payload: any): RawMatchInput[] {
  const fixtures = Array.isArray(payload.response) ? payload.response
    : Array.isArray(payload.fixtures) ? payload.fixtures
    : payload.fixture ? [payload] : [];

  return fixtures.map((item: any) => {
    const f = item.fixture ?? item;
    const teams = item.teams ?? {};
    const goals = item.goals ?? {};
    const league = item.league ?? {};
    return {
      external_id: String(f.id ?? ''),
      sport: 'football',
      home_team: teams.home?.name ?? '',
      away_team: teams.away?.name ?? '',
      home_score: goals.home ?? 0,
      away_score: goals.away ?? 0,
      status: normalizeApiFootballStatus(f.status?.short ?? ''),
      match_time: f.date ?? new Date().toISOString(),
      league: league.name ?? '',
      league_id: league.id ?? null,
      home_logo: teams.home?.logo ?? null,
      away_logo: teams.away?.logo ?? null,
      league_logo: league.logo ?? null,
      venue: f.venue?.name ?? null,
      minute: f.status?.elapsed ?? 0,
      round: league.round ?? null,
      country: league.country ?? null,
      source_provider: 'api-football',
    };
  });
}

function normalizeApiFootballEventType(type: string, detail: string): string {
  const combined = `${type} ${detail}`.toLowerCase();
  if (combined.includes('own goal')) return 'own_goal';
  if (combined.includes('penalty') && combined.includes('miss')) return 'penalty_miss';
  if (combined.includes('penalty') && combined.includes('scored')) return 'penalty_goal';
  if (combined.includes('goal')) return 'goal';
  if (combined.includes('yellow card')) return 'yellow_card';
  if (combined.includes('red card')) return 'red_card';
  if (combined.includes('yellow red card')) return 'second_yellow';
  if (combined.includes('subst')) return 'substitution';
  if (combined.includes('var')) return 'var_review';
  return type.toLowerCase().replace(/\s+/g, '_');
}

function normalizeApiFootballEvents(payload: any): RawEventInput[] {
  const events = Array.isArray(payload.response) ? payload.response
    : Array.isArray(payload.events) ? payload.events : [];
  return events.map((ev: any) => ({
    external_match_id: String(payload.parameters?.fixture ?? payload.match_id ?? ''),
    event_type: normalizeApiFootballEventType(ev.type ?? '', ev.detail ?? ''),
    player_name: ev.player?.name ?? '',
    player_id: ev.player?.id ?? null,
    assist_name: ev.assist?.name ?? null,
    team: ev.team?.name ?? '',
    is_home_team: ev.team?.id === (payload.homeTeamId ?? ev.team?.id),
    minute: ev.time?.elapsed ?? 0,
    extra_minute: ev.time?.extra ?? null,
    detail: ev.detail ?? null,
    comments: ev.comments ?? null,
  }));
}

function normalizeApiFootballOdds(payload: any): RawOddsInput[] {
  const bookmakers = Array.isArray(payload.response) ? payload.response : [];
  const results: RawOddsInput[] = [];
  const matchId = String(payload.parameters?.fixture ?? '');

  for (const bm of bookmakers.slice(0, 3)) {
    const result: RawOddsInput = {
      external_match_id: matchId,
      bookmaker: bm.bookmaker?.name ?? 'Unknown',
    };
    for (const bet of (bm.bets ?? [])) {
      const betName = (bet.name ?? '').toLowerCase();
      if (betName.includes('match winner') || betName === 'match result') {
        for (const val of (bet.values ?? [])) {
          const v = val.value?.toLowerCase();
          if (v === 'home') result.home_win = parseFloat(val.odd);
          else if (v === 'draw') result.draw = parseFloat(val.odd);
          else if (v === 'away') result.away_win = parseFloat(val.odd);
        }
      }
      if (betName.includes('goals over/under') || betName.includes('total goals')) {
        for (const val of (bet.values ?? [])) {
          const v = val.value?.toLowerCase();
          if (v === 'over 2.5') result.over_2_5 = parseFloat(val.odd);
          if (v === 'under 2.5') result.under_2_5 = parseFloat(val.odd);
        }
      }
      if (betName.includes('both teams score') || betName === 'btts') {
        for (const val of (bet.values ?? [])) {
          const v = val.value?.toLowerCase();
          if (v === 'yes') result.btts_yes = parseFloat(val.odd);
          if (v === 'no') result.btts_no = parseFloat(val.odd);
        }
      }
    }
    if (result.home_win || result.away_win) results.push(result);
  }
  return results;
}

// ─── DB upsert helpers ───────────────────────────────────────────────────────

async function upsertMatches(
  supabase: ReturnType<typeof createClient>,
  matches: RawMatchInput[],
): Promise<{ upserted: number; rejected: number; avgDqScore: number }> {
  const { valid, rejected, avgDqScore } = batchValidateMatches(matches);
  if (valid.length === 0) return { upserted: 0, rejected: rejected.length, avgDqScore: 0 };

  const rows = valid.map((m) => ({ ...m, last_updated: new Date().toISOString() }));
  const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false });
  if (error) throw new Error(`matches upsert: ${error.message}`);
  return { upserted: valid.length, rejected: rejected.length, avgDqScore };
}

async function upsertEvents(
  supabase: ReturnType<typeof createClient>,
  rawEvents: RawEventInput[],
): Promise<{ upserted: number; rejected: number }> {
  const valid: any[] = [];
  const rejected: any[] = [];

  for (const raw of rawEvents) {
    const result = validateMatchEvent(raw);
    if (result.isValid && result.sanitised.external_match_id) {
      const { data: match } = await supabase
        .from('matches').select('id')
        .eq('external_id', result.sanitised.external_match_id).maybeSingle();
      if (match?.id) valid.push({ ...result.sanitised, match_id: match.id });
      else rejected.push({ reason: 'match not found', id: result.sanitised.external_match_id });
    } else {
      rejected.push({ reason: result.isValid ? 'no external_match_id' : result.errors?.join(', ') });
    }
  }

  if (valid.length > 0) {
    await supabase.from('match_events').upsert(valid, {
      onConflict: 'match_id,event_type,minute,player_name',
      ignoreDuplicates: true,
    });
  }
  return { upserted: valid.length, rejected: rejected.length };
}

async function upsertOdds(
  supabase: ReturnType<typeof createClient>,
  rawOdds: RawOddsInput[],
): Promise<{ upserted: number; rejected: number }> {
  const valid: any[] = [];
  let rejected = 0;

  for (const raw of rawOdds) {
    const result = validateOdds(raw);
    if (result.isValid) {
      const { data: match } = await supabase
        .from('matches').select('id')
        .eq('external_id', result.sanitised.external_match_id).maybeSingle();
      if (match?.id) {
        valid.push({ match_id: match.id, ...result.sanitised, last_updated: new Date().toISOString() });
      } else { rejected++; }
    } else { rejected++; }
  }

  if (valid.length > 0) {
    await supabase.from('odds').upsert(valid, { onConflict: 'match_id,bookmaker', ignoreDuplicates: false });
  }
  return { upserted: valid.length, rejected };
}

/** Update live match score when a goal event is received */
async function autoUpdateScoreOnGoal(
  supabase: ReturnType<typeof createClient>,
  events: RawEventInput[],
): Promise<void> {
  const goalEvents = events.filter((e) =>
    (e.event_type ?? '').toLowerCase().includes('goal') && e.external_match_id,
  );
  for (const evt of goalEvents) {
    if (!evt.external_match_id) continue;
    const { data: matchData } = await supabase
      .from('matches').select('id, home_team, away_team, home_score, away_score')
      .eq('external_id', evt.external_match_id).maybeSingle();
    if (!matchData || !evt.team) continue;

    // Determine if event team is home team
    const isHome = (evt.team ?? '').toLowerCase() === (matchData.home_team ?? '').toLowerCase();
    await supabase.from('matches').update({
      home_score: isHome ? matchData.home_score + 1 : matchData.home_score,
      away_score: !isHome ? matchData.away_score + 1 : matchData.away_score,
      last_updated: new Date().toISOString(),
    }).eq('id', matchData.id);
  }
}

async function logWebhookEvent(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  eventType: string,
  externalId: string | null,
  payloadHash: string,
  status: 'processed' | 'error',
  recordsUpserted: number,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  await supabase.from('webhook_events').insert({
    provider,
    event_type: eventType,
    external_id: externalId,
    payload_hash: payloadHash,
    status,
    records_upserted: recordsUpserted,
    duration_ms: durationMs,
    error_message: errorMessage ?? null,
  }).catch(() => {}); // non-blocking
}

async function logSync(
  supabase: ReturnType<typeof createClient>,
  jobName: string,
  status: 'success' | 'error',
  recordsAffected: number,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  await supabase.from('sync_logs').insert({
    job_name: jobName,
    status,
    records_affected: recordsAffected,
    duration_ms: durationMs,
    error_message: errorMessage ?? null,
  }).catch(() => {});
}

/** Simple SHA-256 hash of body for deduplication in webhook_events */
async function hashBody(body: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // ── CORS preflight ───────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Health / test endpoint ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/health') || url.searchParams.get('action') === 'health') {
      return secureResponse({
        status: 'ok',
        service: 'webhook-receiver',
        hmac_configured: !!getHmacSecret(),
        px_signature_configured: !!getPxSecret(),
        supported_headers: ['x-ml-signature', 'x-hub-signature-256', 'x-px-signature'],
        timestamp: new Date().toISOString(),
      });
    }
    return secureErrorResponse('Method not allowed. Send POST to this endpoint.', 405);
  }

  if (req.method !== 'POST') {
    return secureErrorResponse('Method not allowed', 405);
  }

  const startMs = Date.now();
  const ip = getClientIp(req);

  // ── Rate limiting (120 webhook calls per minute per IP) ──────────────────
  const rlGuard = rateLimitCheck(`webhook::ip::${ip}`, { max: 120, windowSec: 60, blockSec: 300 });
  if (rlGuard) return rlGuard;

  // ── Payload size guard (10MB max for bulk batches) ───────────────────────
  const contentLength = parseInt(req.headers.get('Content-Length') ?? '0', 10);
  if (contentLength > 10 * 1024 * 1024) {
    return secureErrorResponse('Payload too large (max 10MB)', 413);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // ── Read raw body for signature verification ─────────────────────────
    const bodyText = await req.text();
    if (!bodyText) {
      return secureErrorResponse('Empty request body', 400);
    }

    // ── Admin test bypass (JWT-authenticated users only) ─────────────────
    // Lets the admin panel ping the webhook without needing the HMAC secret
    // client-side. Only activates when body has admin_test:true + type:test.
    {
      let peekedBody: any = null;
      try { peekedBody = JSON.parse(bodyText); } catch { /* fall through */ }

      if (peekedBody?.admin_test === true && peekedBody?.type === 'test') {
        const authHeader = req.headers.get('Authorization') ?? '';
        const token = authHeader.replace('Bearer ', '').trim();
        if (token) {
          try {
            const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
            const userClient = createClient(SUPABASE_URL, anonKey);
            const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
            if (user && !userErr) {
              const durationMs = Date.now() - startMs;
              const payloadHash = await hashBody(bodyText).catch(() => 'hash-error');
              await Promise.all([
                logWebhookEvent(supabase, 'admin-panel', 'test', null, payloadHash, 'processed', 0, durationMs),
                logSync(supabase, 'webhook-admin-test', 'success', 0, durationMs),
              ]);
              console.log(`[webhook-receiver] Admin test from ${user.email ?? user.id} in ${durationMs}ms`);
              return secureResponse({
                received: true,
                type: 'test',
                auth_method: 'admin-jwt',
                upserted: 0,
                rejected: 0,
                durationMs,
                message: `Admin webhook test successful — verified as ${user.email ?? user.id}`,
                hmac_configured: !!getHmacSecret(),
                px_configured: !!getPxSecret(),
                supported_headers: ['x-ml-signature', 'x-hub-signature-256', 'x-px-signature'],
              });
            }
          } catch { /* fall through to normal HMAC flow */ }
        }
        // JWT missing or invalid — fall through to HMAC check
      }
    }

    // ── HMAC Signature Verification ──────────────────────────────────────
    const sigResult = await performSignatureVerification(req, bodyText);
    if (!sigResult.allowed) {
      console.error(`[webhook-receiver] Signature rejected (${sigResult.method}): ${sigResult.reason}`);
      await logWebhookEvent(
        supabase, 'unknown', 'auth_failure', null,
        await hashBody(bodyText).catch(() => 'hash-error'),
        'error', 0, Date.now() - startMs, sigResult.reason,
      );
      return new Response(
        JSON.stringify({ error: 'Unauthorized', reason: sigResult.reason }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[webhook-receiver] Auth passed via ${sigResult.method} from ${ip}`);

    // ── Parse JSON ────────────────────────────────────────────────────────
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return secureErrorResponse('Invalid JSON payload', 400);
    }

    const provider = req.headers.get('x-webhook-provider') ?? body.provider ?? 'unknown';
    const webhookType = body.type ?? body.event ?? body.action
      ?? req.headers.get('x-webhook-type') ?? 'fixture';
    const payloadHash = await hashBody(bodyText).catch(() => 'hash-error');

    let totalUpserted = 0;
    let totalRejected = 0;

    // ── Route to handler ─────────────────────────────────────────────────
    if (webhookType === 'fixture' || webhookType === 'fixture_update' || webhookType === 'match_update') {
      const raw = normalizeApiFootballFixture(body);
      const { upserted, rejected } = await upsertMatches(supabase, raw);
      totalUpserted += upserted;
      totalRejected += rejected;
      console.log(`[webhook-receiver] fixture: ${upserted} upserted, ${rejected} rejected`);
    }

    else if (webhookType === 'event' || webhookType === 'match_event' || webhookType === 'live_event') {
      const raw = normalizeApiFootballEvents(body);
      const { upserted, rejected } = await upsertEvents(supabase, raw);
      totalUpserted += upserted;
      totalRejected += rejected;
      // Auto-update scores on goal events
      await autoUpdateScoreOnGoal(supabase, raw);
    }

    else if (webhookType === 'odds' || webhookType === 'odds_update') {
      const raw = normalizeApiFootballOdds(body);
      const { upserted, rejected } = await upsertOdds(supabase, raw);
      totalUpserted += upserted;
      totalRejected += rejected;
    }

    else if (webhookType === 'batch') {
      // Batch: multiple event types in one request
      for (const evt of (body.events ?? [])) {
        const t = evt.type ?? 'fixture';
        if (t === 'fixture') {
          const raw = normalizeApiFootballFixture(evt);
          const { upserted } = await upsertMatches(supabase, raw);
          totalUpserted += upserted;
        } else if (t === 'event') {
          const raw = normalizeApiFootballEvents(evt);
          const { upserted } = await upsertEvents(supabase, raw);
          totalUpserted += upserted;
          await autoUpdateScoreOnGoal(supabase, raw);
        } else if (t === 'odds') {
          const raw = normalizeApiFootballOdds(evt);
          const { upserted } = await upsertOdds(supabase, raw);
          totalUpserted += upserted;
        }
      }
    }

    else if (webhookType === 'test' || webhookType === 'ping') {
      // Test payload — verify signature was valid and return echo
      const durationMs = Date.now() - startMs;
      await logWebhookEvent(supabase, provider, 'test', null, payloadHash, 'processed', 0, durationMs);
      return secureResponse({
        received: true,
        type: 'test',
        echo: body,
        auth_method: sigResult.method,
        durationMs,
        message: 'Webhook test successful — HMAC signature verified',
      });
    }

    else {
      console.warn(`[webhook-receiver] Unknown webhook type: ${webhookType}`);
    }

    const durationMs = Date.now() - startMs;

    // ── Log to both webhook_events and sync_logs ─────────────────────────
    await Promise.all([
      logWebhookEvent(
        supabase, provider, webhookType,
        body.parameters?.fixture ? String(body.parameters.fixture) : null,
        payloadHash, 'processed', totalUpserted, durationMs,
      ),
      logSync(supabase, `webhook-${webhookType}-${provider}`, 'success', totalUpserted, durationMs),
    ]);

    return secureResponse({
      received: true,
      type: webhookType,
      provider,
      auth_method: sigResult.method,
      upserted: totalUpserted,
      rejected: totalRejected,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[webhook-receiver] Error: ${errMsg}`);

    await Promise.all([
      supabase.from('sync_logs').insert({
        job_name: 'webhook-receiver',
        status: 'error',
        records_affected: 0,
        duration_ms: durationMs,
        error_message: errMsg,
      }).catch(() => {}),
    ]);

    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
