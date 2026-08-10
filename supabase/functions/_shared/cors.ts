/**
 * cors.ts — Hardened CORS headers for PredictXta Edge Functions
 *
 * Provides two levels of CORS protection:
 *
 *  1. corsHeaders  — Wildcard CORS for public/read-only endpoints
 *                    (matches, predictions, news, highlights, standings)
 *
 *  2. getAuthCorsHeaders(req) — Origin-aware CORS for authenticated/sensitive endpoints
 *     Allows: predictxta.app, localhost, exp:// (dev)
 *     For all other origins: still returns valid headers (mobile apps don't send Origin)
 *
 * Usage:
 *   Public endpoint:     return new Response(body, { headers: corsHeaders });
 *   Auth endpoint:       return new Response(body, { headers: { ...getAuthCorsHeaders(req), 'Content-Type': 'application/json' } });
 */

/** Approved production + development origins */
const ALLOWED_ORIGINS = new Set([
  'https://predictxta.app',
  'https://www.predictxta.app',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
]);

const ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-px-signature, x-px-timestamp, x-correlation-id, x-job-name, x-retry-count';

/**
 * Standard CORS headers (wildcard) — safe for public data endpoints.
 * Mobile apps (React Native) do not send Origin headers so CORS is irrelevant for them.
 * This wildcard only affects web browser requests.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/**
 * Origin-aware CORS headers for authenticated / sensitive endpoints.
 *
 * - If Origin matches the allowlist → echo the exact origin back (required for credentials)
 * - If Origin is not present (native mobile) → use wildcard (no browser CORS applies)
 * - If Origin is unknown (untrusted browser) → still respond to avoid breakage in previews,
 *   but include Vary: Origin so CDNs cache correctly
 *
 * Use for: delete-account, AI generation, expert predictions, admin endpoints.
 */
export function getAuthCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');

  if (!origin) {
    // Native app / server-to-server — no CORS needed, use wildcard for safety
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
      'Access-Control-Max-Age': '86400',
    };
  }

  const isAllowed = ALLOWED_ORIGINS.has(origin) ||
                    origin.startsWith('exp://') ||          // Expo Go development
                    origin.startsWith('http://localhost') || // localhost any port
                    origin.includes('.backend.onspace.ai');  // OnSpace platform

  const allowedOrigin = isAllowed ? origin : 'https://predictxta.app';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Build a complete CORS preflight (OPTIONS) response.
 * Call at the very top of every edge function handler.
 */
export function handleCorsOptions(req: Request, sensitive = false): Response | null {
  if (req.method !== 'OPTIONS') return null;
  const headers = sensitive ? getAuthCorsHeaders(req) : corsHeaders;
  return new Response(null, { status: 204, headers });
}
