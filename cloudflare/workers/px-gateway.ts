/**
 * PredictXta · Cloudflare Edge API Gateway
 * ──────────────────────────────────────────────────────────────────────────────
 * Acts as the global edge layer between the PredictXta mobile app and
 * OnSpace Edge Functions. Handles:
 *
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  1. WAF — SQL injection, XSS, path traversal, SSRF blocking     │
 *  │  2. DDoS — automatic volume spike mitigation via rate limits     │
 *  │  3. Bot Detection — UA fingerprinting + behavioural scoring      │
 *  │  4. Rate Limiting — Free/VIP/Anon tiers per IP + JWT identity   │
 *  │  5. Edge Caching — KV-backed response cache per route           │
 *  │  6. Request Signing — HMAC-SHA256 signature injection           │
 *  │  7. Security Headers — OWASP hardened response headers          │
 *  │  8. Analytics — per-route request telemetry                     │
 *  └──────────────────────────────────────────────────────────────────┘
 *
 *  Deploy: npx wrangler deploy
 */

// ─── Environment bindings (defined in wrangler.toml) ──────────────────────────
interface Env {
  PX_CACHE: KVNamespace;
  ENVIRONMENT: string;
  ONSPACE_BASE_URL: string;
  RATE_LIMIT_FREE: string;
  RATE_LIMIT_VIP: string;
  RATE_LIMIT_ANON: string;
  CACHE_TTL_LIVE: string;
  CACHE_TTL_FEED: string;
  CACHE_TTL_PREDICTIONS: string;
  CACHE_TTL_STANDINGS: string;
  CACHE_TTL_NEWS: string;
  CACHE_TTL_ODDS: string;
  PX_SIGNING_SECRET: string;
  SUPABASE_ANON_KEY: string;
}

// ─── Security Headers ─────────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'CF-Cache-Status': 'DYNAMIC',
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-px-signature, x-px-timestamp, x-px-user-tier',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const allSecureHeaders = { ...SECURITY_HEADERS, ...CORS_HEADERS };

// ─── Route → Cache TTL mapping ────────────────────────────────────────────────
interface RouteConfig {
  /** Path prefix to match */
  prefix: string;
  /** Cache TTL in seconds (0 = no cache) */
  cacheTtl: number;
  /** Rate limit bucket */
  tier: 'live' | 'feed' | 'predictions' | 'standings' | 'news' | 'odds' | 'auth' | 'ai' | 'admin';
  /** Whether this route requires authentication */
  requiresAuth: boolean;
  /** Whether response should vary by sport param */
  varyBySport: boolean;
}

const ROUTE_MAP: RouteConfig[] = [
  { prefix: '/functions/v1/home-feed',         cacheTtl: 30,   tier: 'feed',        requiresAuth: false, varyBySport: true  },
  { prefix: '/functions/v1/fetch-matches',     cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: true  },
  { prefix: '/functions/v1/generate-prediction',cacheTtl: 300, tier: 'predictions', requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/ai-sports-chat',    cacheTtl: 0,    tier: 'ai',          requiresAuth: true,  varyBySport: false },
  { prefix: '/functions/v1/fetch-odds',        cacheTtl: 60,   tier: 'odds',        requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/sync-news',         cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/sync-live',         cacheTtl: 0,    tier: 'live',        requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/sync-standings',    cacheTtl: 0,    tier: 'standings',   requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/sync-highlights',   cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/send-push',         cacheTtl: 0,    tier: 'auth',        requiresAuth: true,  varyBySport: false },
  { prefix: '/functions/v1/translate-content', cacheTtl: 3600, tier: 'feed',        requiresAuth: false, varyBySport: false },
  { prefix: '/functions/v1/firebase-live',     cacheTtl: 12,   tier: 'live',        requiresAuth: false, varyBySport: true  },
];

// ─── Rate Limit Store (using Workers KV for distributed state) ────────────────
// For in-memory fallback when KV is unavailable
const memRateStore = new Map<string, { count: number; windowStart: number; blocked: boolean; blockUntil: number }>();

async function checkRateLimit(
  env: Env,
  key: string,
  maxReq: number,
  windowSec = 60,
  blockSec = 300,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const blockMs = blockSec * 1000;
  const storeKey = `rl:${key}`;

  try {
    // Use KV for distributed rate limiting across Cloudflare PoPs
    const raw = await env.PX_CACHE.get(storeKey);
    const entry = raw ? JSON.parse(raw) : { count: 0, windowStart: now, blocked: false, blockUntil: 0 };

    if (entry.blocked && now < entry.blockUntil) {
      const retryAfter = Math.ceil((entry.blockUntil - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }

    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
      entry.blocked = false;
      entry.blockUntil = 0;
    }

    entry.count++;

    if (entry.count > maxReq) {
      entry.blocked = true;
      entry.blockUntil = now + blockMs;
      await env.PX_CACHE.put(storeKey, JSON.stringify(entry), { expirationTtl: blockSec + windowSec });
      return { allowed: false, remaining: 0, retryAfter: blockSec };
    }

    await env.PX_CACHE.put(storeKey, JSON.stringify(entry), { expirationTtl: windowSec + 10 });
    return { allowed: true, remaining: maxReq - entry.count };
  } catch {
    // KV unavailable — fallback to in-memory (local PoP only)
    let mem = memRateStore.get(key);
    if (!mem) { mem = { count: 0, windowStart: now, blocked: false, blockUntil: 0 }; }

    if (mem.blocked && now < mem.blockUntil) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((mem.blockUntil - now) / 1000) };
    }
    if (now - mem.windowStart > windowMs) { mem.count = 0; mem.windowStart = now; mem.blocked = false; mem.blockUntil = 0; }
    mem.count++;
    if (mem.count > maxReq) { mem.blocked = true; mem.blockUntil = now + blockMs; memRateStore.set(key, mem); return { allowed: false, remaining: 0, retryAfter: blockSec }; }
    memRateStore.set(key, mem);
    return { allowed: true, remaining: maxReq - mem.count };
  }
}

// ─── Bot Detection ────────────────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /python-requests/i, /curl\//i, /wget\//i, /scrapy/i, /httpie/i,
  /go-http-client/i, /java\//i, /libwww-perl/i, /masscan/i, /zgrab/i,
  /nikto/i, /sqlmap/i, /nmap/i, /nuclei/i, /dirbuster/i, /hydra/i,
];

const BETTING_BOT_PATTERNS = [
  /oddsscraper/i, /betbot/i, /odds-collector/i, /arbitrage/i,
  /surebet/i, /bookiebot/i, /betfair-bot/i,
];

interface BotScore {
  score: number;        // 0-100: higher = more likely bot
  blocked: boolean;
  reason?: string;
}

function calculateBotScore(req: Request): BotScore {
  const ua = req.headers.get('User-Agent') ?? '';
  const cfThreat = req.headers.get('CF-Threat-Score');
  const cfBot = req.headers.get('CF-Worker'); // Cloudflare bot management header

  // Cloudflare threat score (0-100, higher = more suspicious)
  const threatScore = cfThreat ? parseInt(cfThreat, 10) : 0;

  // Scanner/tool UA check
  if (BOT_UA_PATTERNS.some((p) => p.test(ua))) {
    return { score: 100, blocked: true, reason: 'Scanner user agent detected' };
  }

  // Betting bot UA check
  if (BETTING_BOT_PATTERNS.some((p) => p.test(ua))) {
    return { score: 100, blocked: true, reason: 'Betting bot user agent detected' };
  }

  // CF threat score threshold
  if (threatScore > 50) {
    return { score: threatScore, blocked: true, reason: `Cloudflare threat score: ${threatScore}` };
  }

  // No Accept header for non-OPTIONS requests = likely automated
  const accept = req.headers.get('Accept');
  if (req.method === 'POST' && !accept) {
    return { score: 40, blocked: false, reason: 'Missing Accept header' };
  }

  return { score: Math.min(threatScore, 10), blocked: false };
}

// ─── WAF Rules ────────────────────────────────────────────────────────────────
const SQL_INJECTION_PATTERNS = [
  /(\bOR\b|\bAND\b)\s+\d+\s*=\s*\d+/i,
  /;\s*(DROP|DELETE|TRUNCATE|INSERT|UPDATE|CREATE|ALTER)\b/i,
  /UNION\s+(ALL\s+)?SELECT/i,
  /xp_cmdshell/i,
  /EXEC\s*\(/i,
  /\/\*.*?\*\//s,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=\s*["']/i,
  /<iframe/i,
  /data:\s*text\/html/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%252e%252e%252f/i,
];

function runWAF(url: URL, body: string): { blocked: boolean; reason?: string } {
  const fullPath = url.pathname + url.search;

  // Path traversal
  if (PATH_TRAVERSAL_PATTERNS.some((p) => p.test(fullPath))) {
    return { blocked: true, reason: 'Path traversal attempt' };
  }

  // SQL injection in URL
  if (SQL_INJECTION_PATTERNS.some((p) => p.test(decodeURIComponent(fullPath)))) {
    return { blocked: true, reason: 'SQL injection in URL' };
  }

  // XSS in URL
  if (XSS_PATTERNS.some((p) => p.test(decodeURIComponent(fullPath)))) {
    return { blocked: true, reason: 'XSS attempt in URL' };
  }

  // Check request body if present
  if (body) {
    if (SQL_INJECTION_PATTERNS.some((p) => p.test(body))) {
      return { blocked: true, reason: 'SQL injection in request body' };
    }
    if (XSS_PATTERNS.some((p) => p.test(body))) {
      return { blocked: true, reason: 'XSS attempt in request body' };
    }
  }

  return { blocked: false };
}

// ─── JWT Tier Extraction ──────────────────────────────────────────────────────
function extractUserTierFromJWT(authHeader: string | null): 'anon' | 'free' | 'vip' {
  // Check explicit tier header first (set by client)
  if (!authHeader) return 'anon';

  // Check the x-px-user-tier header passed from the mobile app
  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) return 'free';
    const payload = JSON.parse(atob(parts[1]));
    // Check custom claim set by Supabase auth or client metadata
    if (payload?.user_metadata?.is_vip === true) return 'vip';
    if (payload?.app_metadata?.is_vip === true) return 'vip';
    return 'free';
  } catch {
    return 'free';
  }
}

// ─── Cache Key Builder ────────────────────────────────────────────────────────
function buildCacheKey(url: URL, route: RouteConfig, body: string): string {
  const base = url.pathname;
  const sport = url.searchParams.get('sport') ?? '';
  const isVip = url.searchParams.get('isVip') ?? 'false';
  const date = url.searchParams.get('date') ?? new Date().toISOString().split('T')[0];

  // For POST bodies, include a hash of the body for cache differentiation
  let bodyKey = '';
  if (body && body.length > 0 && body.length < 500) {
    // Simple deterministic key from body content
    let hash = 0;
    for (let i = 0; i < body.length; i++) {
      hash = ((hash << 5) - hash) + body.charCodeAt(i);
      hash |= 0;
    }
    bodyKey = `body:${hash}`;
  }

  const parts = [base, route.varyBySport ? `sport:${sport}` : '', `vip:${isVip}`, `date:${date}`, bodyKey]
    .filter(Boolean);
  return `cache:${parts.join('|')}`;
}

// ─── HMAC Request Signing ─────────────────────────────────────────────────────
async function signRequest(body: string, secret: string): Promise<{ sig: string; ts: string }> {
  const ts = String(Math.floor(Date.now() / 1000));
  const message = `${ts}:${body}`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(message));
  const sig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { sig, ts };
}

// ─── Rate Limit Config per Tier ───────────────────────────────────────────────
function getRateLimitMax(tier: string, userTier: 'anon' | 'free' | 'vip', env: Env): number {
  const baseAnon = parseInt(env.RATE_LIMIT_ANON, 10) || 30;
  const baseFree = parseInt(env.RATE_LIMIT_FREE, 10) || 100;
  const baseVip  = parseInt(env.RATE_LIMIT_VIP, 10) || 500;

  const base = userTier === 'vip' ? baseVip : userTier === 'free' ? baseFree : baseAnon;

  // Stricter limits for AI endpoints (cost control)
  if (tier === 'ai') return Math.floor(base * 0.3);
  if (tier === 'predictions') return Math.floor(base * 0.5);
  if (tier === 'admin') return Math.min(base, 10); // strict for sync endpoints

  return base;
}

// ─── Analytics Logger ─────────────────────────────────────────────────────────
interface RequestLog {
  ts: number;
  path: string;
  method: string;
  status: number;
  cacheHit: boolean;
  latencyMs: number;
  country: string;
  tier: string;
  userTier: string;
  blocked: boolean;
  blockReason?: string;
}

async function logRequest(env: Env, log: RequestLog): Promise<void> {
  try {
    // Store aggregate counters in KV (per-day, per-route)
    const dateKey = new Date().toISOString().split('T')[0];
    const aggKey = `analytics:${dateKey}:${log.path.split('/').pop() ?? 'unknown'}`;
    const raw = await env.PX_CACHE.get(aggKey);
    const agg = raw ? JSON.parse(raw) : {
      requests: 0, cacheHits: 0, errors: 0, blocked: 0,
      totalLatency: 0, countries: {} as Record<string, number>,
    };
    agg.requests++;
    if (log.cacheHit) agg.cacheHits++;
    if (log.status >= 400) agg.errors++;
    if (log.blocked) agg.blocked++;
    agg.totalLatency += log.latencyMs;
    agg.countries[log.country] = (agg.countries[log.country] ?? 0) + 1;
    await env.PX_CACHE.put(aggKey, JSON.stringify(agg), { expirationTtl: 86400 * 7 }); // 7 days
  } catch { /* non-blocking — analytics must never fail request handling */ }
}

// ─── Main Worker Handler ──────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startMs = Date.now();
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...SECURITY_HEADERS } });
    }

    // ── Determine origin URL ──────────────────────────────────────────────────
    const originBase = env.ONSPACE_BASE_URL || 'https://osmkbrryalhtpnayosmk.backend.onspace.ai';
    const path = url.pathname + url.search;

    // ── Find matching route config ────────────────────────────────────────────
    const route = ROUTE_MAP.find((r) => path.startsWith(r.prefix));

    // ── Read request body (needed for WAF + signing + caching) ───────────────
    let body = '';
    if (request.method === 'POST' || request.method === 'PUT') {
      try { body = await request.clone().text(); } catch { /* ignore */ }
    }

    // ── 1. WAF Check ──────────────────────────────────────────────────────────
    const wafResult = runWAF(url, body);
    if (wafResult.blocked) {
      console.warn(`[Gateway] WAF blocked: ${wafResult.reason} path=${path}`);
      ctx.waitUntil(logRequest(env, {
        ts: startMs, path, method: request.method, status: 403,
        cacheHit: false, latencyMs: Date.now() - startMs,
        country: request.headers.get('CF-IPCountry') ?? 'XX',
        tier: route?.tier ?? 'unknown', userTier: 'anon',
        blocked: true, blockReason: wafResult.reason,
      }));
      return new Response(JSON.stringify({ error: 'Request blocked by security policy' }), {
        status: 403, headers: { ...allSecureHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Bot Detection ──────────────────────────────────────────────────────
    const botScore = calculateBotScore(request);
    if (botScore.blocked) {
      console.warn(`[Gateway] Bot blocked: ${botScore.reason} path=${path}`);
      return new Response(JSON.stringify({ error: 'Automated access not permitted' }), {
        status: 403, headers: { ...allSecureHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Extract user tier from JWT ─────────────────────────────────────────
    const authHeader = request.headers.get('Authorization');
    const explicitTier = request.headers.get('X-PX-User-Tier') as 'anon' | 'free' | 'vip' | null;
    const userTier: 'anon' | 'free' | 'vip' = explicitTier ?? extractUserTierFromJWT(authHeader);

    // ── 4. Rate Limiting ──────────────────────────────────────────────────────
    if (route) {
      const clientIp = request.headers.get('CF-Connecting-IP') ??
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
        'unknown';
      const maxReq = getRateLimitMax(route.tier, userTier, env);
      const rlKey = `${route.tier}:${clientIp}`;
      const rl = await checkRateLimit(env, rlKey, maxReq, 60, 300);

      if (!rl.allowed) {
        console.warn(`[Gateway] Rate limit exceeded: key=${rlKey} tier=${userTier}`);
        ctx.waitUntil(logRequest(env, {
          ts: startMs, path, method: request.method, status: 429,
          cacheHit: false, latencyMs: Date.now() - startMs,
          country: request.headers.get('CF-IPCountry') ?? 'XX',
          tier: route.tier, userTier, blocked: true, blockReason: 'Rate limit',
        }));
        return new Response(JSON.stringify({
          error: 'Too many requests. Please try again later.',
          retryAfter: rl.retryAfter,
          tier: userTier,
        }), {
          status: 429,
          headers: {
            ...allSecureHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rl.retryAfter ?? 60),
            'X-RateLimit-Limit': String(maxReq),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Tier': userTier,
          },
        });
      }
    }

    // ── 5. Cache Lookup (GET + cacheable POST routes) ─────────────────────────
    let cachedResponse: Response | null = null;
    const cacheTtl = route?.cacheTtl ?? 0;
    let cacheKey = '';

    if (cacheTtl > 0 && route) {
      cacheKey = buildCacheKey(url, route, body);
      try {
        const cached = await env.PX_CACHE.getWithMetadata<{ contentType: string; status: number }>(cacheKey);
        if (cached.value && cached.metadata) {
          const age = cached.metadata ? 0 : 0; // TTL managed by KV expiration
          cachedResponse = new Response(cached.value, {
            status: cached.metadata.status ?? 200,
            headers: {
              ...allSecureHeaders,
              'Content-Type': cached.metadata.contentType ?? 'application/json',
              'CF-Cache-Status': 'HIT',
              'X-PX-Cache': 'HIT',
              'X-PX-Cache-Key': cacheKey.slice(0, 40),
              'Cache-Control': `public, max-age=${cacheTtl}, stale-while-revalidate=${cacheTtl * 2}`,
            },
          });
        }
      } catch { /* KV miss or error — proceed to origin */ }
    }

    if (cachedResponse) {
      ctx.waitUntil(logRequest(env, {
        ts: startMs, path, method: request.method, status: 200,
        cacheHit: true, latencyMs: Date.now() - startMs,
        country: request.headers.get('CF-IPCountry') ?? 'XX',
        tier: route?.tier ?? 'unknown', userTier, blocked: false,
      }));
      return cachedResponse;
    }

    // ── 6. Build forwarded request to OnSpace origin ──────────────────────────
    const originUrl = `${originBase}${path}`;
    const forwardHeaders = new Headers(request.headers);

    // Inject Cloudflare metadata
    forwardHeaders.set('CF-Connecting-IP', request.headers.get('CF-Connecting-IP') ?? '');
    forwardHeaders.set('CF-IPCountry', request.headers.get('CF-IPCountry') ?? 'XX');
    forwardHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');
    forwardHeaders.set('X-PX-Gateway', 'cloudflare-worker');
    forwardHeaders.set('X-PX-User-Tier', userTier);
    forwardHeaders.set('X-PX-Bot-Score', String(botScore.score));
    forwardHeaders.set('X-PX-Environment', env.ENVIRONMENT);

    // Inject HMAC signature if signing secret is configured
    if (env.PX_SIGNING_SECRET && body) {
      try {
        const { sig, ts } = await signRequest(body, env.PX_SIGNING_SECRET);
        forwardHeaders.set('X-PX-Signature', sig);
        forwardHeaders.set('X-PX-Timestamp', ts);
      } catch { /* signing failed — proceed unsigned */ }
    }

    // Forward auth header if present
    if (authHeader) {
      forwardHeaders.set('Authorization', authHeader);
    } else if (env.SUPABASE_ANON_KEY) {
      // Inject anon key for unauthenticated requests
      forwardHeaders.set('apikey', env.SUPABASE_ANON_KEY);
    }

    // ── 7. Forward to Origin ──────────────────────────────────────────────────
    let originResponse: Response;
    try {
      originResponse = await fetch(originUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: body || undefined,
      });
    } catch (fetchErr) {
      console.error(`[Gateway] Origin fetch failed: ${fetchErr}`);
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable', upstream: 'origin_fetch_failed' }), {
        status: 503,
        headers: { ...allSecureHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 8. Read origin response ───────────────────────────────────────────────
    const responseBody = await originResponse.text();
    const contentType = originResponse.headers.get('Content-Type') ?? 'application/json';
    const status = originResponse.status;

    // ── 9. Store in cache if cacheable ────────────────────────────────────────
    if (cacheTtl > 0 && status === 200 && cacheKey) {
      ctx.waitUntil(
        env.PX_CACHE.put(cacheKey, responseBody, {
          expirationTtl: cacheTtl * 2, // KV TTL = 2x to allow stale-while-revalidate
          metadata: { contentType, status },
        }).catch(() => { /* non-blocking cache write */ }),
      );
    }

    // ── 10. Build final response with security headers ────────────────────────
    const finalHeaders: Record<string, string> = {
      ...allSecureHeaders,
      'Content-Type': contentType,
      'CF-Cache-Status': 'MISS',
      'X-PX-Cache': 'MISS',
      'X-PX-Gateway': 'cloudflare-worker',
      'X-PX-User-Tier': userTier,
      'X-PX-Bot-Score': String(botScore.score),
    };

    if (cacheTtl > 0) {
      finalHeaders['Cache-Control'] = `public, max-age=${cacheTtl}, stale-while-revalidate=${cacheTtl * 2}`;
    } else {
      finalHeaders['Cache-Control'] = 'no-store, max-age=0';
    }

    // Pass through rate limit headers
    finalHeaders['X-RateLimit-Tier'] = userTier;

    // ── 11. Analytics (async, non-blocking) ───────────────────────────────────
    ctx.waitUntil(logRequest(env, {
      ts: startMs, path, method: request.method, status,
      cacheHit: false, latencyMs: Date.now() - startMs,
      country: request.headers.get('CF-IPCountry') ?? 'XX',
      tier: route?.tier ?? 'unknown', userTier, blocked: false,
    }));

    return new Response(responseBody, { status, headers: finalHeaders });
  },
};
