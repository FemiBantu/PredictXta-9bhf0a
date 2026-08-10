/**
 * PredictXta · Cloudflare Sports Cache Manager
 * ──────────────────────────────────────────────────────────────────────────────
 * Provides cache management utilities for sports data:
 *
 *  GET  /cache/stats          — Return cache analytics per route
 *  POST /cache/purge          — Purge specific routes or all sports data
 *  GET  /cache/health         — Health check with KV connectivity test
 *  POST /cache/warm           — Pre-warm cache for specified routes
 *
 * This Worker is called from OnSpace Edge Functions after data syncs
 * to invalidate stale cache entries immediately.
 *
 *  Deploy: npx wrangler deploy --name px-cache-manager
 */

interface Env {
  PX_CACHE: KVNamespace;
  ONSPACE_BASE_URL: string;
  PX_SIGNING_SECRET: string;
  SUPABASE_ANON_KEY: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-px-signature, x-px-timestamp',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Routes that should be purged after each data sync
const SYNC_PURGE_ROUTES: Record<string, string[]> = {
  'fetch-matches':  ['home-feed', 'fetch-matches'],
  'sync-live':      ['home-feed', 'firebase-live'],
  'sync-news':      ['home-feed', 'sync-news'],
  'sync-standings': ['sync-standings'],
  'fetch-odds':     ['fetch-odds'],
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Cache Stats ──────────────────────────────────────────────────────────
    if (path === '/cache/stats' && request.method === 'GET') {
      return handleCacheStats(env);
    }

    // ── Cache Purge ──────────────────────────────────────────────────────────
    if (path === '/cache/purge' && request.method === 'POST') {
      return handleCachePurge(request, env);
    }

    // ── Health Check ─────────────────────────────────────────────────────────
    if (path === '/cache/health' && request.method === 'GET') {
      return handleHealthCheck(env);
    }

    // ── Cache Warm ───────────────────────────────────────────────────────────
    if (path === '/cache/warm' && request.method === 'POST') {
      return handleCacheWarm(request, env);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};

// ─── Cache Stats Handler ──────────────────────────────────────────────────────
async function handleCacheStats(env: Env): Promise<Response> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // List all analytics keys for today and yesterday
    const todayKeys = await env.PX_CACHE.list({ prefix: `analytics:${today}:` });
    const yesterdayKeys = await env.PX_CACHE.list({ prefix: `analytics:${yesterday}:` });

    const fetchStats = async (keys: KVNamespaceListResult<unknown, string>) => {
      const stats: Record<string, unknown>[] = [];
      for (const key of keys.keys) {
        const raw = await env.PX_CACHE.get(key.name);
        if (raw) {
          const data = JSON.parse(raw);
          stats.push({
            route: key.name.split(':').slice(2).join(':'),
            ...data,
            cacheHitRate: data.requests > 0 ? Math.round((data.cacheHits / data.requests) * 100) : 0,
            avgLatencyMs: data.requests > 0 ? Math.round(data.totalLatency / data.requests) : 0,
          });
        }
      }
      return stats;
    };

    const [todayStats, yesterdayStats] = await Promise.all([
      fetchStats(todayKeys),
      fetchStats(yesterdayKeys),
    ]);

    const totalToday = todayStats.reduce((a, s: any) => ({
      requests: a.requests + (s.requests ?? 0),
      cacheHits: a.cacheHits + (s.cacheHits ?? 0),
      errors: a.errors + (s.errors ?? 0),
      blocked: a.blocked + (s.blocked ?? 0),
    }), { requests: 0, cacheHits: 0, errors: 0, blocked: 0 });

    return new Response(JSON.stringify({
      today: { date: today, summary: totalToday, routes: todayStats },
      yesterday: { date: yesterday, routes: yesterdayStats },
      generatedAt: new Date().toISOString(),
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

// ─── Cache Purge Handler ──────────────────────────────────────────────────────
async function handleCachePurge(request: Request, env: Env): Promise<Response> {
  let body: { routes?: string[]; syncJob?: string; all?: boolean } = {};
  try { body = await request.json(); } catch { /* defaults */ }

  const toPurge: string[] = [];

  if (body.all) {
    // Purge all cache entries (dangerous — use with care)
    try {
      const allKeys = await env.PX_CACHE.list({ prefix: 'cache:' });
      for (const key of allKeys.keys) toPurge.push(key.name);
    } catch { /* non-fatal */ }
  } else if (body.syncJob && SYNC_PURGE_ROUTES[body.syncJob]) {
    // Purge routes affected by a specific sync job
    for (const route of SYNC_PURGE_ROUTES[body.syncJob]) {
      try {
        const affected = await env.PX_CACHE.list({ prefix: `cache:/functions/v1/${route}` });
        for (const key of affected.keys) toPurge.push(key.name);
      } catch { /* non-fatal */ }
    }
  } else if (body.routes && body.routes.length > 0) {
    // Purge specific route prefixes
    for (const route of body.routes) {
      try {
        const affected = await env.PX_CACHE.list({ prefix: `cache:/functions/v1/${route}` });
        for (const key of affected.keys) toPurge.push(key.name);
      } catch { /* non-fatal */ }
    }
  }

  // Delete all identified keys
  let purged = 0;
  const errors: string[] = [];
  for (const key of toPurge) {
    try {
      await env.PX_CACHE.delete(key);
      purged++;
    } catch (e) {
      errors.push(`Failed to delete ${key}: ${e}`);
    }
  }

  console.log(`[CacheManager] Purged ${purged}/${toPurge.length} keys. Job: ${body.syncJob ?? 'manual'}`);

  return new Response(JSON.stringify({
    success: true,
    purged,
    total: toPurge.length,
    errors: errors.slice(0, 5),
    syncJob: body.syncJob ?? null,
    timestamp: new Date().toISOString(),
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ─── Health Check Handler ─────────────────────────────────────────────────────
async function handleHealthCheck(env: Env): Promise<Response> {
  const checks: Record<string, boolean | string> = {};

  // KV connectivity
  try {
    await env.PX_CACHE.put('health:check', 'ok', { expirationTtl: 10 });
    const val = await env.PX_CACHE.get('health:check');
    checks.kv = val === 'ok';
  } catch (e) {
    checks.kv = `FAIL: ${e}`;
  }

  // Origin reachability
  try {
    const originRes = await fetch(`${env.ONSPACE_BASE_URL}/functions/v1/home-feed`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(3000),
    });
    checks.origin = originRes.status < 500;
    checks.originStatus = originRes.status;
  } catch (e) {
    checks.origin = false;
    checks.originError = String(e);
  }

  const healthy = Object.values(checks).every((v) => v === true || typeof v === 'number');

  return new Response(JSON.stringify({
    healthy,
    checks,
    timestamp: new Date().toISOString(),
    region: 'cloudflare-edge',
  }), {
    status: healthy ? 200 : 503,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ─── Cache Warm Handler ───────────────────────────────────────────────────────
async function handleCacheWarm(request: Request, env: Env): Promise<Response> {
  let body: { sports?: string[]; userId?: string } = {};
  try { body = await request.json(); } catch { /* defaults */ }

  const sports = body.sports ?? ['all', 'football', 'basketball'];
  const warmed: string[] = [];
  const failed: string[] = [];

  for (const sport of sports) {
    try {
      const warmUrl = `${env.ONSPACE_BASE_URL}/functions/v1/home-feed?sport=${sport}&isVip=false`;
      const res = await fetch(warmUrl, {
        headers: {
          'apikey': env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const responseText = await res.text();
        const cacheKey = `cache:/functions/v1/home-feed|sport:${sport}|vip:false|date:${new Date().toISOString().split('T')[0]}`;
        await env.PX_CACHE.put(cacheKey, responseText, {
          expirationTtl: 60,
          metadata: { contentType: 'application/json', status: 200 },
        });
        warmed.push(sport);
      } else {
        failed.push(`${sport}: HTTP ${res.status}`);
      }
    } catch (e) {
      failed.push(`${sport}: ${e}`);
    }
  }

  return new Response(JSON.stringify({
    success: failed.length === 0,
    warmed,
    failed,
    timestamp: new Date().toISOString(),
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
