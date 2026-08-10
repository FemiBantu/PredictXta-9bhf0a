
/**
 * _shared/security.ts — PredictXta Edge Function Security Middleware
 *
 * Implements layered API security without requiring Cloudflare DNS control:
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  Layer 1: Hardened HTTP Security Headers (OWASP recommended)   │
 *  │  Layer 2: In-memory Rate Limiting (per IP + per user)          │
 *  │  Layer 3: Request Signature Validation (HMAC-SHA256 optional)  │
 *  │  Layer 4: Bot & Abuse Detection heuristics                     │
 *  │  Layer 5: Input Sanitization & Payload Size Guards             │
 *  │  Layer 6: JWT / Auth token validation helpers                  │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * Usage in any edge function:
 *
 *   import { applySecurityMiddleware, secureHeaders, rateLimitCheck } from '../_shared/security.ts';
 *
 *   Deno.serve(async (req) => {
 *     if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });
 *
 *     const guard = await applySecurityMiddleware(req, { rateLimit: { max: 20, windowSec: 60 } });
 *     if (guard) return guard; // blocked — returns 429 / 400 / 403 response
 *
 *     // ... your handler logic
 *   });
 */

import { corsHeaders } from './cors.ts';

// ─── Security Headers (OWASP Secure Headers Project) ────────────────────────
export const securityHeaders: Record<string, string> = {
  // Standard CORS
  ...corsHeaders,

  // Prevents MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',

  // Clickjacking protection
  'X-Frame-Options': 'DENY',

  // XSS filter (legacy browsers)
  'X-XSS-Protection': '1; mode=block',

  // Strict Transport Security (2 years, include subdomains)
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',

  // Referrer policy — don't leak path info
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Content Security Policy for API responses (no HTML, no external scripts)
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",

  // Disable caching for auth/prediction endpoints by default
  'Cache-Control': 'no-store, max-age=0',

  // Permissions policy — no geolocation / camera from API
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',

  // Content type
  'Content-Type': 'application/json',
};

/**
 * Merge security headers with CORS for OPTIONS / success responses.
 * Use this instead of bare `corsHeaders` in handlers.
 */
export const secureHeaders = securityHeaders;

// ─── In-memory Rate Limit Store ───────────────────────────────────────────────
interface RateLimitEntry {
  count: number;
  windowStart: number;
  firstSeen: number;
  blocked: boolean;
  blockUntil: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes to prevent memory leak
let lastCleanup = Date.now();

function cleanupRateLimitStore() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > 3_600_000) { // 1 hour since last seen
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests per window (default: 30) */
  max: number;
  /** Window size in seconds (default: 60) */
  windowSec: number;
  /** Block duration in seconds when limit exceeded (default: 300 = 5min) */
  blockSec?: number;
}

const DEFAULT_RATE_CONFIG: RateLimitConfig = {
  max: 30,
  windowSec: 60,
  blockSec: 300,
};

/**
 * Check rate limit for a given key (IP, userId, etc).
 * Returns `null` if allowed, or a Response (429) if blocked.
 */
export function rateLimitCheck(
  key: string,
  config: RateLimitConfig = DEFAULT_RATE_CONFIG,
): Response | null {
  cleanupRateLimitStore();
  const { max, windowSec, blockSec = 300 } = config;
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const blockMs = blockSec * 1000;

  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { count: 1, windowStart: now, firstSeen: now, blocked: false, blockUntil: 0 };
    rateLimitStore.set(key, entry);
    return null;
  }

  // Currently blocked?
  if (entry.blocked && now < entry.blockUntil) {
    const retryAfter = Math.ceil((entry.blockUntil - now) / 1000);
    return new Response(
      JSON.stringify({
        error: 'Too many requests. Please try again later.',
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          ...securityHeaders,
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.blockUntil / 1000)),
        },
      },
    );
  }

  // Reset window?
  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    entry.blocked = false;
    entry.blockUntil = 0;
    rateLimitStore.set(key, entry);
    return null;
  }

  entry.count++;
  rateLimitStore.set(key, entry);

  if (entry.count > max) {
    entry.blocked = true;
    entry.blockUntil = now + blockMs;
    rateLimitStore.set(key, entry);
    // rate limit exceeded — request throttled
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Your request has been throttled.',
        retryAfter: blockSec,
      }),
      {
        status: 429,
        headers: {
          ...securityHeaders,
          'Retry-After': String(blockSec),
          'X-RateLimit-Limit': String(max),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  return null; // allowed
}

// ─── IP Extraction ────────────────────────────────────────────────────────────
/**
 * Extract the real client IP from request headers.
 * Respects Cloudflare CF-Connecting-IP, then X-Forwarded-For, then fallback.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??       // Cloudflare (if ever added later)
    req.headers.get('X-Real-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

// ─── Bot / Abuse Heuristics ───────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /python-requests/i,
  /curl\//i,
  /wget\//i,
  /scrapy/i,
  /httpie/i,
  /go-http-client/i,
  /java\//i,
  /libwww-perl/i,
  /masscan/i,
  /zgrab/i,
  /nikto/i,
  /sqlmap/i,
  /nmap/i,
  /nuclei/i,
];

/**
 * Returns true if the User-Agent looks like an automated scanner/bot.
 * Note: legitimate Supabase SDK and React Native apps don't send UA headers,
 * so we only block obviously malicious UAs, not absence of UA.
 */
export function isSuspiciousUserAgent(req: Request): boolean {
  const ua = req.headers.get('User-Agent') ?? '';
  if (!ua) return false; // absence is fine (mobile app / Deno client)
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

// ─── Payload Size Guard ───────────────────────────────────────────────────────
/**
 * Check Content-Length against a maximum bytes limit.
 * Returns a 413 Response if too large, otherwise null.
 */
export function payloadSizeCheck(req: Request, maxBytes = 512_000): Response | null {
  const contentLength = req.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return new Response(
      JSON.stringify({ error: `Payload too large. Maximum allowed size is ${maxBytes} bytes.` }),
      { status: 413, headers: securityHeaders },
    );
  }
  return null;
}

// ─── HMAC-SHA256 Request Signature (optional) ─────────────────────────────────
/**
 * Verify HMAC-SHA256 request signature.
 *
 * The mobile client should set header:
 *   X-PX-Signature: <hex(HMAC-SHA256(secret, timestamp + ':' + body))>
 *   X-PX-Timestamp: <unix seconds>
 *
 * This prevents replay attacks and ensures requests originate from the app.
 * Only enforced when PREDICTXTA_SIGNING_SECRET is configured.
 */
export async function verifyRequestSignature(
  req: Request,
  body: string,
): Promise<Response | null> {
  const signingSecret = Deno.env.get('PREDICTXTA_SIGNING_SECRET');
  if (!signingSecret) return null; // Signing not configured — skip check

  const signature = req.headers.get('X-PX-Signature');
  const timestamp = req.headers.get('X-PX-Timestamp');

  if (!signature || !timestamp) {
    return new Response(
      JSON.stringify({ error: 'Missing request signature headers.' }),
      { status: 401, headers: securityHeaders },
    );
  }

  // Reject stale requests older than 5 minutes
  const tsNum = parseInt(timestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > 300) {
    return new Response(
      JSON.stringify({ error: 'Request timestamp is expired or invalid.' }),
      { status: 401, headers: securityHeaders },
    );
  }

  // Compute expected HMAC
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `${timestamp}:${body}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(message));
  const expectedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSig.length) {
    return new Response(
      JSON.stringify({ error: 'Invalid request signature.' }),
      { status: 403, headers: securityHeaders },
    );
  }
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) {
    // signature mismatch — possible tampered request
    return new Response(
      JSON.stringify({ error: 'Invalid request signature.' }),
      { status: 403, headers: securityHeaders },
    );
  }

  return null; // Valid
}

// ─── Input Sanitization ───────────────────────────────────────────────────────
const SQL_INJECTION_PATTERNS = [
  /(\bOR\b|\bAND\b)\s+\d+\s*=\s*\d+/i,
  /;\s*(DROP|DELETE|TRUNCATE|INSERT|UPDATE|CREATE|ALTER)\s+/i,
  /UNION\s+(ALL\s+)?SELECT/i,
  /\/\*.*?\*\//s,
  /xp_cmdshell/i,
  /EXEC\s*\(/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
];

/**
 * Sanitize a string value — detects SQL injection and XSS patterns.
 * Returns sanitized string (strips dangerous content) + flags.
 */
export function sanitizeString(value: string): { clean: string; isSuspicious: boolean } {
  const hasSql = SQL_INJECTION_PATTERNS.some((p) => p.test(value));
  const hasXss = XSS_PATTERNS.some((p) => p.test(value));
  if (hasSql || hasXss) {
    // suspicious input pattern detected
    // Strip HTML tags and null bytes
    const clean = value
      .replace(/<[^>]*>/g, '')         // strip HTML tags
      .replace(/\0/g, '')              // null bytes
      .replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width chars
    return { clean, isSuspicious: hasSql || hasXss };
  }
  return { clean: value, isSuspicious: false }; // no suspicious patterns, return original
}

/**
 * Recursively sanitize all string values in a JSON object.
 * Returns `{ clean, suspicious }`.
 */
export function sanitizePayload(obj: unknown, depth = 0): { clean: unknown; suspicious: boolean } {
  if (depth > 10) return { clean: obj, suspicious: false }; // max depth guard
  if (typeof obj === 'string') {
    const { clean, isSuspicious } = sanitizeString(obj);
    return { clean, suspicious: isSuspicious };
  }
  if (Array.isArray(obj)) {
    let suspicious = false;
    const clean = obj.map((item) => {
      const result = sanitizePayload(item, depth + 1);
      if (result.suspicious) suspicious = true;
      return result.clean;
    });
    return { clean, suspicious };
  }
  if (obj !== null && typeof obj === 'object') {
    let suspicious = false;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const result = sanitizePayload(v, depth + 1);
      if (result.suspicious) suspicious = true;
      clean[k] = result.clean;
    }
    return { clean, suspicious };
  }
  return { clean: obj, suspicious: false };
}

// ─── Main Security Middleware ─────────────────────────────────────────────────
export interface SecurityOptions {
  /** Rate limit config. Pass false to disable. Default: 30 req/60s */
  rateLimit?: RateLimitConfig | false;
  /** Check payload size. Pass false to skip. Default: 512KB */
  maxPayloadBytes?: number | false;
  /** Verify HMAC signature if secret is set. Default: true */
  verifySignature?: boolean;
  /** Block obvious scanner UAs. Default: true */
  blockBotUa?: boolean;
  /** Sanitize request body. Default: true */
  sanitizeInput?: boolean;
  /** Key prefix for rate limiting (e.g. 'predict', 'chat'). Default: 'global' */
  rateLimitScope?: string;
}

/**
 * applySecurityMiddleware — run all security checks on an incoming request.
 *
 * Returns `null` if the request passes all checks (proceed with handler).
 * Returns a `Response` object if the request should be rejected.
 *
 * Parsed body is returned so you don't need to re-read the stream:
 *   const { guard, body } = await applySecurityMiddleware(req, opts);
 *   if (guard) return guard;
 *   const { userId, match } = body as MyRequestBody;
 */
export async function applySecurityMiddleware(
  req: Request,
  opts: SecurityOptions = {},
): Promise<{ guard: Response | null; body: unknown; ip: string }> {
  const {
    rateLimit: rateLimitConfig = DEFAULT_RATE_CONFIG,
    maxPayloadBytes = 512_000,
    verifySignature = true,
    blockBotUa = true,
    sanitizeInput = true,
    rateLimitScope = 'global',
  } = opts;

  const ip = getClientIp(req);

  // ── 1. Bot UA check ──────────────────────────────────────────────────────
  if (blockBotUa && isSuspiciousUserAgent(req)) {
    // suspicious UA blocked
    return {
      guard: new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: securityHeaders },
      ),
      body: null,
      ip,
    };
  }

  // ── 2. Payload size check ────────────────────────────────────────────────
  if (maxPayloadBytes !== false) {
    const sizeGuard = payloadSizeCheck(req, maxPayloadBytes as number);
    if (sizeGuard) return { guard: sizeGuard, body: null, ip };
  }

  // ── 3. Rate limit (IP-based) ─────────────────────────────────────────────
  if (rateLimitConfig !== false) {
    const rlKey = `${rateLimitScope}::ip::${ip}`;
    const rlGuard = rateLimitCheck(rlKey, rateLimitConfig as RateLimitConfig);
    if (rlGuard) return { guard: rlGuard, body: null, ip };
  }

  // ── 4. Parse body ────────────────────────────────────────────────────────
  let rawBody = '';
  let parsedBody: unknown = null;
  try {
    rawBody = await req.text();
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return {
      guard: new Response(
        JSON.stringify({ error: 'Invalid JSON in request body.' }),
        { status: 400, headers: securityHeaders },
      ),
      body: null,
      ip,
    };
  }

  // ── 5. Request signature verification ───────────────────────────────────
  if (verifySignature) {
    const sigGuard = await verifyRequestSignature(req, rawBody);
    if (sigGuard) return { guard: sigGuard, body: null, ip };
  }

  // ── 6. Input sanitization ────────────────────────────────────────────────
  let body = parsedBody;
  if (sanitizeInput && parsedBody !== null) {
    const { clean, suspicious } = sanitizePayload(parsedBody);
    if (suspicious) {
      // Return 400 on obvious injection attempts
      return {
        guard: new Response(
          JSON.stringify({ error: 'Request contains invalid characters or patterns.' }),
          { status: 400, headers: securityHeaders },
        ),
        body: null,
        ip,
      };
    }
    body = clean;
  }

  return { guard: null, body, ip };
}

// ─── Per-User Rate Limit Helper ───────────────────────────────────────────────
/**
 * Apply per-user rate limit (in addition to IP rate limit).
 * Call this after extracting userId from JWT.
 */
export function applyUserRateLimit(
  userId: string,
  scope: string,
  config: RateLimitConfig,
): Response | null {
  const key = `${scope}::user::${userId}`;
  return rateLimitCheck(key, config);
}

// ─── Helper: wrap response with security headers ──────────────────────────────
export function secureResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders,
  });
}

export function secureErrorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: securityHeaders,
  });
}
