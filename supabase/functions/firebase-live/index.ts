/**
 * firebase-live — Thin proxy that reads live scores from Firebase RTDB
 * and returns them to the mobile client.
 *
 * Why a proxy?
 * - Firebase credentials stay server-side (never exposed to client)
 * - Client just calls this edge function with standard Supabase auth
 * - Adds a 10s server-side cache via response headers to reduce RTDB reads
 *
 * Fault-tolerance strategy:
 * - AbortSignal timeout extended to 8 s (cold Firebase RTDB can take 6-8 s)
 * - One automatic retry on timeout or 5xx Firebase response (with 800 ms delay)
 * - res.json() wrapped in its own try/catch — malformed / HTML payloads
 *   never bubble up as 500s; they gracefully return an empty array
 * - Every error path returns HTTP 200 with { liveScores: [], source: '...' }
 *   so the mobile client never has to handle a failed fetch
 */

import { corsHeaders } from '../_shared/cors.ts';

const FIREBASE_TIMEOUT_MS = 8_000;   // per attempt
const RETRY_DELAY_MS      = 800;     // wait before the single retry
const MAX_ATTEMPTS        = 2;       // initial + 1 retry

// ─── Safe JSON parser — never throws ──────────────────────────────────────────
async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text || text.trim() === 'null') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Single attempt to call Firebase RTDB ─────────────────────────────────────
async function fetchFirebase(dbUrl: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  timedOut: boolean;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIREBASE_TIMEOUT_MS);
  try {
    const res = await fetch(dbUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await safeJson(res);
    return { ok: res.ok, status: res.status, data, timedOut: false };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isAbort =
      err instanceof DOMException && err.name === 'AbortError';
    return { ok: false, status: 0, data: null, timedOut: isAbort };
  }
}

// ─── Retry wrapper ─────────────────────────────────────────────────────────────
async function fetchWithRetry(dbUrl: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  attempts: number;
}> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchFirebase(dbUrl);

    // Success path
    if (result.ok && result.data !== null) {
      return { ...result, attempts: attempt };
    }

    const shouldRetry =
      attempt < MAX_ATTEMPTS &&
      (result.timedOut || result.status === 0 || result.status >= 500);

    if (!shouldRetry) {
      return { ...result, attempts: attempt };
    }

    console.warn(
      `[firebase-live] attempt ${attempt} failed (status=${result.status}, timedOut=${result.timedOut}) — retrying in ${RETRY_DELAY_MS}ms`,
    );
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  // Unreachable but TypeScript needs it
  return { ok: false, status: 0, data: null, attempts: MAX_ATTEMPTS };
}

// ─── Graceful 200 response helpers ────────────────────────────────────────────
function emptyResponse(source: string, extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ liveScores: [], count: 0, source, ...extra }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5',
      },
    },
  );
}

// ─── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startMs = Date.now();

  // ── Config check ──────────────────────────────────────────────────────────
  const firebaseDbUrl = Deno.env.get('FIREBASE_DATABASE_URL') ?? '';
  const firebaseApiKey = Deno.env.get('FIREBASE_API_KEY') ?? '';

  if (!firebaseDbUrl) {
    return emptyResponse('not_configured');
  }

  // ── Parse optional sport filter ───────────────────────────────────────────
  const urlObj = new URL(req.url);
  let sport: string | null = urlObj.searchParams.get('sport');

  if (!sport && req.method === 'POST') {
    try {
      const body = await req.json();
      sport = body?.sport ?? null;
    } catch {
      // Ignore malformed or missing body — sport remains null
    }
  }

  // ── Build Firebase RTDB URL ───────────────────────────────────────────────
  const dbUrl = firebaseApiKey
    ? `${firebaseDbUrl}/live_scores.json?auth=${firebaseApiKey}`
    : `${firebaseDbUrl}/live_scores.json`;

  // ── Fetch with retry ──────────────────────────────────────────────────────
  let fetchResult: Awaited<ReturnType<typeof fetchWithRetry>>;
  try {
    fetchResult = await fetchWithRetry(dbUrl);
  } catch (unexpected) {
    // Should never happen — fetchWithRetry swallows all errors internally —
    // but belt-and-suspenders: always return 200.
    console.error('[firebase-live] unexpected outer error:', unexpected);
    return emptyResponse('error', {
      error: unexpected instanceof Error ? unexpected.message : String(unexpected),
      elapsed_ms: Date.now() - startMs,
    });
  }

  const elapsed = Date.now() - startMs;

  // ── Handle non-OK result ──────────────────────────────────────────────────
  if (!fetchResult.ok || fetchResult.data === null) {
    const reason = fetchResult.timedOut ? 'timeout'
      : fetchResult.status >= 500 ? 'firebase_5xx'
      : fetchResult.status === 0 ? 'network_error'
      : 'firebase_error';

    console.warn(
      `[firebase-live] giving up after ${fetchResult.attempts} attempt(s): ${reason} status=${fetchResult.status} elapsed=${elapsed}ms`,
    );
    return emptyResponse(reason, {
      http_status: fetchResult.status,
      attempts: fetchResult.attempts,
      elapsed_ms: elapsed,
    });
  }

  // ── Process valid response ────────────────────────────────────────────────
  const json = fetchResult.data;

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    // Firebase returned null/empty — no live data
    return emptyResponse('empty', { elapsed_ms: elapsed });
  }

  // Convert Firebase RTDB object map → array, keep only live rows
  let allRows: Record<string, unknown>[];
  try {
    allRows = Object.values(json as Record<string, unknown>)
      .filter((row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && (row as any).status === 'live',
      );
  } catch (parseErr) {
    console.error('[firebase-live] error converting RTDB object to array:', parseErr);
    return emptyResponse('parse_error', { elapsed_ms: elapsed });
  }

  // Optional sport filter
  const filtered =
    sport && sport !== 'all'
      ? allRows.filter(
          (row) =>
            String(row.sport ?? 'football').toLowerCase() ===
            sport!.toLowerCase(),
        )
      : allRows;

  // Sort by minute descending (most active first)
  filtered.sort(
    (a, b) => Number(b.minute ?? 0) - Number(a.minute ?? 0),
  );

  console.log(
    `[firebase-live] ${filtered.length}/${allRows.length} live scores in ${elapsed}ms (${fetchResult.attempts} attempt${fetchResult.attempts !== 1 ? 's' : ''})`,
  );

  return new Response(
    JSON.stringify({
      liveScores: filtered,
      count: filtered.length,
      totalLive: allRows.length,
      source: 'firebase',
      elapsed_ms: elapsed,
      attempts: fetchResult.attempts,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=10, stale-while-revalidate=20',
      },
    },
  );
});
