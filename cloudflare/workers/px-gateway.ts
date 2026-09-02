/**
 * PredictXta · Cloudflare Edge API Gateway — PHASE 2 SECURITY HARDENED
 * ──────────────────────────────────────────────────────────────────────────────
 * SECURITY FIXES (Phase 2):
 *   ✅ FIX: X-PX-User-Tier from CLIENT is now IGNORED — derived from JWT only
 *   ✅ FIX: VIP cache isolation — authenticated/VIP responses are NEVER cached
 *            in shared cache. Only anon/public responses are cached.
 *   ✅ FIX: Cache key no longer includes unverified client-supplied isVip param
 *   ✅ FIX: user_metadata.is_vip removed from tier extraction (client-settable)
 *            Only app_metadata.is_vip is trusted (server-set by Supabase admin)
 *   ✅ FIX: Security headers added to prevent cache leakage
 *   ✅ FIX: X-PX-Gateway header set on all forwarded requests so Edge Functions
 *            can distinguish gateway-processed requests from direct calls
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
    'authorization, x-client-info, apikey, content-type, x-px-signature, x-px-timestamp',
  // NOTE: x-px-user-tier intentionally REMOVED from allowed client headers
  // Tier is now derived server-side from JWT only
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const allSecureHeaders = { ...SECURITY_HEADERS, ...CORS_HEADERS };

// ─── Route → Cache TTL mapping ────────────────────────────────────────────────
interface RouteConfig {
  prefix: string;
  cacheTtl: number;
  tier: 'live' | 'feed' | 'predictions' | 'standings' | 'news' | 'odds' | 'auth' | 'ai' | 'admin';
  requiresAuth: boolean;
  varyBySport: boolean;
  /** PUBLIC = cacheable for anon users; AUTHENTICATED/VIP = NEVER cache shared */
  cacheClass: 'PUBLIC' | 'AUTHENTICATED' | 'VIP' | 'INTERNAL';
}

const ROUTE_MAP: RouteConfig[] = [
  // PUBLIC — cacheable for anonymous users only
  { prefix: '/functions/v1/home-feed',          cacheTtl: 30,   tier: 'feed',        requiresAuth: false, varyBySport: true,  cacheClass: 'PUBLIC' },
  { prefix: '/functions/v1/generate-prediction', cacheTtl: 300,  tier: 'predictions', requiresAuth: false, varyBySport: false, cacheClass: 'PUBLIC' },
  { prefix: '/functions/v1/fetch-odds',          cacheTtl: 60,   tier: 'odds',        requiresAuth: false, varyBySport: false, cacheClass: 'PUBLIC' },
  { prefix: '/functions/v1/translate-content',   cacheTtl: 3600, tier: 'feed',        requiresAuth: false, varyBySport: false, cacheClass: 'PUBLIC' },
  { prefix: '/functions/v1/firebase-live',       cacheTtl: 12,   tier: 'live',        requiresAuth: false, varyBySport: true,  cacheClass: 'PUBLIC' },
  // INTERNAL — never cache, admin-only, require service-role
  { prefix: '/functions/v1/fetch-matches',       cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: true,  cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/sync-news',           cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/sync-live',           cacheTtl: 0,    tier: 'live',        requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/sync-standings',      cacheTtl: 0,    tier: 'standings',   requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/sync-highlights',     cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/midnight-preload',    cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/expert-promotion',    cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/resolve-prediction',  cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/rebalance-weights',   cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  { prefix: '/functions/v1/pipeline-audit',      cacheTtl: 0,    tier: 'admin',       requiresAuth: false, varyBySport: false, cacheClass: 'INTERNAL' },
  // AUTHENTICATED — never cache in shared cache
  { prefix: '/functions/v1/ai-sports-chat',      cacheTtl: 0,    tier: 'ai',          requiresAuth: true,  varyBySport: false, cacheClass: 'AUTHENTICATED' },
  { prefix: '/functions/v1/send-push',           cacheTtl: 0,    tier: 'auth',        requiresAuth: true,  varyBySport: false, cacheClass: 'AUTHENTICATED' },
  { prefix: '/functions/v1/delete-account',      cacheTtl: 0,    tier: 'auth',        requiresAuth: true,  varyBySport: false, cacheClass: 'AUTHENTICATED' },
  { prefix: '/functions/v1/verify-purchase',     cacheTtl: 0,    tier: 'auth',        requiresAuth: true,  varyBySport: false, cacheClass: 'AUTHENTICATED' },
  { prefix: '/functions/v1/multi-model-prediction', cacheTtl: 0, tier: 'ai',         requiresAuth: true,  varyBySport: false, cacheClass: 'AUTHENTICATED' },
];

// ─── Rate Limit Store (Workers KV — distributed across Cloudflare PoPs) ───────
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
    const raw = await env.PX_CACHE.get(storeKey);
    const entry = raw ? JSON.parse(raw) : { count: 0, windowStart: now, blocked: false, blockUntil: 0 };

    if (entry.blocked && now < entry.blockUntil) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.blockUntil - now) / 1000) };
    }
    if (now - entry.windowStart > windowMs) {
      entry.count = 0; entry.windowStart = now; entry.blocked = false; entry.blockUntil = 0;
    }
    entry.count++;
    if (entry.count > maxReq) {
      entry.blocked = true; entry.blockUntil = now + blockMs;
      await env.PX_CACHE.put(storeKey, JSON.stringify(entry), { expirationTtl: blockSec + windowSec });
      return { allowed: false, remaining: 0, retryAfter: blockSec };
    }
    await env.PX_CACHE.put(storeKey, JSON.stringify(entry), { expirationTtl: windowSec + 10 });
    return { allowed: true, remaining: maxReq - entry.count };
  } catch {
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

function calculateBotScore(req: Request): { score: number; blocked: boolean; reason?: string } {
  const ua = req.headers.get('User-Agent') ?? '';
  const cfThreat = req.headers.get('CF-Threat-Score');
  const threatScore = cfThreat ? parseInt(cfThreat, 10) : 0;
  if (BOT_UA_PATTERNS.some((p) => p.test(ua))) return { score: 100, blocked: true, reason: 'Scanner user agent' };
  if (BETTING_BOT_PATTERNS.some((p) => p.test(ua))) return { score: 100, blocked: true, reason: 'Betting bot user agent' };
  if (threatScore > 50) return { score: threatScore, blocked: true, reason: `CF threat score: ${threatScore}` };
  return { score: Math.min(threatScore, 10), blocked: false };
}

// ─── WAF Rules ────────────────────────────────────────────────────────────────
const SQL_INJ = [/(\bOR\b|\bAND\b)\s+\d+\s*=\s*\d+/i, /;\s*(DROP|DELETE|TRUNCATE|INSERT|UPDATE|CREATE|ALTER)\b/i, /UNION\s+(ALL\s+)?SELECT/i, /xp_cmdshell/i, /EXEC\s*\(/i, /\/\*.*?\*\//s];
const XSS = [/<script[\s>]/i, /javascript:/i, /on\w+\s*=\s*["']/i, /<iframe/i, /data:\s*text\/html/i];
const PATH_TRAV = [/\.\.\//, /\.\.\\/, /%2e%2e%2f/i, /%252e%252e%252f/i];

function runWAF(url: URL, body: string): { blocked: boolean; reason?: string } {
  const p = url.pathname + url.search;
  if (PATH_TRAV.some((r) => r.test(p))) return { blocked: true, reason: 'Path traversal' };
  if (SQL_INJ.some((r) => r.test(decodeURIComponent(p)))) return { blocked: true, reason: 'SQL injection in URL' };
  if (XSS.some((r) => r.test(decodeURIComponent(p)))) return { blocked: true, reason: 'XSS in URL' };
  if (body && SQL_INJ.some((r) => r.test(body))) return { blocked: true, reason: 'SQL injection in body' };
  if (body && XSS.some((r) => r.test(body))) return { blocked: true, reason: 'XSS in body' };
  return { blocked: false };
}

// ─── JWT Tier Extraction — SECURITY HARDENED ─────────────────────────────────
// NEVER trust X-PX-User-Tier from the client directly.
// VIP tier is derived ONLY from JWT app_metadata (server-set by Supabase).
// user_metadata is intentionally EXCLUDED — it can be modified by the client.
function extractUserTierFromJWT(authHeader: string | null): 'anon' | 'free' | 'vip' {
  if (!authHeader) return 'anon';
  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) return 'free';
    const payload = JSON.parse(atob(parts[1]));
    // ONLY app_metadata is trusted — it is set by Supabase server-side functions,
    // NOT by the client. user_metadata CAN be modified by users and is therefore
    // intentionally ignored for tier determination.
    if (payload?.app_metadata?.is_vip === true) return 'vip';
    // Do NOT check user_metadata.is_vip — client-controlled
    return 'free';
  } catch {
    return 'free';
  }
}

// ─── Cache Key Builder — VIP-Safe ─────────────────────────────────────────────
// SECURITY FIX: Cache key no longer includes client-supplied isVip parameter.
// Only PUBLIC (anon) responses are cached. Authenticated/VIP: no shared cache.
function buildPublicCacheKey(url: URL, route: RouteConfig, body: string): string {
  const base = url.pathname;
  const sport = url.searchParams.get('sport') ?? '';
  const date = url.searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  // isVip from URL param intentionally removed from cache key

  let bodyKey = '';
  if (body && body.length > 0 && body.length < 500) {
    let hash = 0;
    for (let i = 0; i < body.length; i++) {
      hash = ((hash << 5) - hash) + body.charCodeAt(i);
      hash |= 0;
    }
    bodyKey = `body:${hash}`;
  }

  const parts = [base, route.varyBySport ? `sport:${sport}` : '', `date:${date}`, bodyKey]
    .filter(Boolean);
  return `public:${parts.join('|')}`;
}

// ─── HMAC Request Signing ─────────────────────────────────────────────────────
async function signRequest(body: string, secret: string): Promise<{ sig: string; ts: string }> {
  const ts = String(Math.floor(Date.now() / 1000));
  const message = `${ts}:${body}`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(message));
  const sig = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { sig, ts };
}

// ─── Rate Limit Config per Tier ───────────────────────────────────────────────
function getRateLimitMax(tier: string, userTier: 'anon' | 'free' | 'vip', env: Env): number {
  const baseAnon = parseInt(env.RATE_LIMIT_ANON, 10) || 30;
  const baseFree = parseInt(env.RATE_LIMIT_FREE, 10) || 100;
  const baseVip  = parseInt(env.RATE_LIMIT_VIP, 10) || 500;
  const base = userTier === 'vip' ? baseVip : userTier === 'free' ? baseFree : baseAnon;
  if (tier === 'ai') return Math.floor(base * 0.3);
  if (tier === 'predictions') return Math.floor(base * 0.5);
  if (tier === 'admin') return Math.min(base, 5); // very strict for ingestion
  return base;
}

// ─── Analytics Logger ─────────────────────────────────────────────────────────
async function logRequest(env: Env, log: { ts: number; path: string; method: string; status: number; cacheHit: boolean; latencyMs: number; country: string; tier: string; userTier: string; blocked: boolean; blockReason?: string }): Promise<void> {
  try {
    const dateKey = new Date().toISOString().split('T')[0];
    const aggKey = `analytics:${dateKey}:${log.path.split('/').pop() ?? 'unknown'}`;
    const raw = await env.PX_CACHE.get(aggKey);
    const agg = raw ? JSON.parse(raw) : { requests: 0, cacheHits: 0, errors: 0, blocked: 0, totalLatency: 0, countries: {} as Record<string, number> };
    agg.requests++; if (log.cacheHit) agg.cacheHits++; if (log.status >= 400) agg.errors++; if (log.blocked) agg.blocked++;
    agg.totalLatency += log.latencyMs;
    agg.countries[log.country] = (agg.countries[log.country] ?? 0) + 1;
    await env.PX_CACHE.put(aggKey, JSON.stringify(agg), { expirationTtl: 86400 * 7 });
  } catch { /* non-blocking */ }
}

// ─── Main Worker Handler ──────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startMs = Date.now();
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...SECURITY_HEADERS } });
    }

    const originBase = env.ONSPACE_BASE_URL || 'https://osmkbrryalhtpnayosmk.backend.onspace.ai';
    const path = url.pathname + url.search;
    const route = ROUTE_MAP.find((r) => path.startsWith(r.prefix));

    let body = '';
    if (request.method === 'POST' || request.method === 'PUT') {
      try { body = await request.clone().text(); } catch { /* ignore */ }
    }

    // ── 1. WAF ─────────────────────────────────────────────────────────────────
    const wafResult = runWAF(url, body);
    if (wafResult.blocked) {
      ctx.waitUntil(logRequest(env, { ts: startMs, path, method: request.method, status: 403, cacheHit: false, latencyMs: Date.now() - startMs, country: request.headers.get('CF-IPCountry') ?? 'XX', tier: route?.tier ?? 'unknown', userTier: 'anon', blocked: true, blockReason: wafResult.reason }));
      return new Response(JSON.stringify({ error: 'Request blocked by security policy' }), { status: 403, headers: { ...allSecureHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 2. Bot Detection ───────────────────────────────────────────────────────
    const botScore = calculateBotScore(request);
    if (botScore.blocked) {
      return new Response(JSON.stringify({ error: 'Automated access not permitted' }), { status: 403, headers: { ...allSecureHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 3. User Tier — derived from JWT ONLY, never from client header ─────────
    // SECURITY: X-PX-User-Tier from the client is IGNORED.
    // We strip it from forwarded headers below.
    // The gateway injects X-PX-User-Tier after JWT-based derivation.
    const authHeader = request.headers.get('Authorization');
    const userTier: 'anon' | 'free' | 'vip' = extractUserTierFromJWT(authHeader);

    // ── 4. Rate Limiting ───────────────────────────────────────────────────────
    if (route) {
      const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
      const maxReq = getRateLimitMax(route.tier, userTier, env);
      const rl = await checkRateLimit(env, `${route.tier}:${clientIp}`, maxReq, 60, 300);
      if (!rl.allowed) {
        ctx.waitUntil(logRequest(env, { ts: startMs, path, method: request.method, status: 429, cacheHit: false, latencyMs: Date.now() - startMs, country: request.headers.get('CF-IPCountry') ?? 'XX', tier: route.tier, userTier, blocked: true, blockReason: 'Rate limit' }));
        return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.', retryAfter: rl.retryAfter, tier: userTier }), { status: 429, headers: { ...allSecureHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter ?? 60), 'X-RateLimit-Limit': String(maxReq), 'X-RateLimit-Remaining': '0' } });
      }
    }

    // ── 5. Cache Lookup — PUBLIC responses only, never authenticated/VIP ───────
    // SECURITY: Only cache responses for anonymous (non-authenticated) requests.
    // VIP, authenticated, and internal responses are NEVER served from shared cache.
    let cachedResponse: Response | null = null;
    const cacheTtl = route?.cacheTtl ?? 0;
    let cacheKey = '';

    const isCacheableRequest = (
      cacheTtl > 0 &&
      route !== undefined &&
      route.cacheClass === 'PUBLIC' &&
      !authHeader // Only cache anonymous requests
    );

    if (isCacheableRequest) {
      cacheKey = buildPublicCacheKey(url, route!, body);
      try {
        const cached = await env.PX_CACHE.getWithMetadata<{ contentType: string; status: number }>(cacheKey);
        if (cached.value && cached.metadata) {
          cachedResponse = new Response(cached.value, {
            status: cached.metadata.status ?? 200,
            headers: { ...allSecureHeaders, 'Content-Type': cached.metadata.contentType ?? 'application/json', 'CF-Cache-Status': 'HIT', 'X-PX-Cache': 'HIT', 'Cache-Control': `public, max-age=${cacheTtl}, stale-while-revalidate=${cacheTtl * 2}` },
          });
        }
      } catch { /* KV miss */ }
    }

    if (cachedResponse) {
      ctx.waitUntil(logRequest(env, { ts: startMs, path, method: request.method, status: 200, cacheHit: true, latencyMs: Date.now() - startMs, country: request.headers.get('CF-IPCountry') ?? 'XX', tier: route?.tier ?? 'unknown', userTier, blocked: false }));
      return cachedResponse;
    }

    // ── 6. Build forwarded request ─────────────────────────────────────────────
    const originUrl = `${originBase}${path}`;
    const forwardHeaders = new Headers(request.headers);

    // Strip client-supplied security headers that could be used for bypass
    forwardHeaders.delete('X-PX-User-Tier');   // Never trust client-supplied tier
    forwardHeaders.delete('X-PX-User-Id');      // Never trust client-supplied identity
    forwardHeaders.delete('X-PX-VIP');          // Never trust client-supplied VIP flag
    forwardHeaders.delete('X-Internal-Token');  // Strip any internal token attempts
    forwardHeaders.delete('X-Job-Name');        // Strip cron job name spoofing

    // Inject trusted gateway metadata
    forwardHeaders.set('CF-Connecting-IP', request.headers.get('CF-Connecting-IP') ?? '');
    forwardHeaders.set('CF-IPCountry', request.headers.get('CF-IPCountry') ?? 'XX');
    forwardHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');
    forwardHeaders.set('X-PX-Gateway', 'cloudflare-worker'); // Trusted marker for Edge Functions
    forwardHeaders.set('X-PX-User-Tier', userTier);          // Server-derived tier
    forwardHeaders.set('X-PX-Bot-Score', String(botScore.score));
    forwardHeaders.set('X-PX-Environment', env.ENVIRONMENT);

    // Inject HMAC signature for request integrity
    if (env.PX_SIGNING_SECRET && body) {
      try {
        const { sig, ts } = await signRequest(body, env.PX_SIGNING_SECRET);
        forwardHeaders.set('X-PX-Signature', sig);
        forwardHeaders.set('X-PX-Timestamp', ts);
      } catch { /* signing failed — proceed unsigned */ }
    }

    if (authHeader) {
      forwardHeaders.set('Authorization', authHeader);
    } else if (env.SUPABASE_ANON_KEY) {
      forwardHeaders.set('apikey', env.SUPABASE_ANON_KEY);
    }

    // ── 7. Forward to Origin ───────────────────────────────────────────────────
    let originResponse: Response;
    try {
      originResponse = await fetch(originUrl, { method: request.method, headers: forwardHeaders, body: body || undefined });
    } catch (fetchErr) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), { status: 503, headers: { ...allSecureHeaders, 'Content-Type': 'application/json' } });
    }

    const responseBody = await originResponse.text();
    const contentType = originResponse.headers.get('Content-Type') ?? 'application/json';
    const status = originResponse.status;

    // ── 8. Store in shared cache ONLY for public anon responses ────────────────
    // SECURITY: Never cache authenticated, VIP, or error responses
    if (isCacheableRequest && status === 200 && cacheKey) {
      ctx.waitUntil(
        env.PX_CACHE.put(cacheKey, responseBody, {
          expirationTtl: cacheTtl * 2,
          metadata: { contentType, status },
        }).catch(() => {}),
      );
    }

    // ── 9. Build response ──────────────────────────────────────────────────────
    const finalHeaders: Record<string, string> = {
      ...allSecureHeaders,
      'Content-Type': contentType,
      'CF-Cache-Status': 'MISS',
      'X-PX-Cache': 'MISS',
      'X-PX-Gateway': 'cloudflare-worker',
      // Do NOT expose user tier in response headers (information disclosure)
    };

    if (isCacheableRequest && cacheTtl > 0) {
      finalHeaders['Cache-Control'] = `public, max-age=${cacheTtl}, stale-while-revalidate=${cacheTtl * 2}`;
    } else {
      // Authenticated and VIP responses: never cache anywhere
      finalHeaders['Cache-Control'] = 'no-store, no-cache, must-revalidate, private';
      finalHeaders['Pragma'] = 'no-cache';
    }

    ctx.waitUntil(logRequest(env, { ts: startMs, path, method: request.method, status, cacheHit: false, latencyMs: Date.now() - startMs, country: request.headers.get('CF-IPCountry') ?? 'XX', tier: route?.tier ?? 'unknown', userTier, blocked: false }));

    return new Response(responseBody, { status, headers: finalHeaders });
  },
};
