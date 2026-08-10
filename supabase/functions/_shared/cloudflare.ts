/**
 * _shared/cloudflare.ts — Cloudflare API utilities for OnSpace Edge Functions
 *
 * Used server-side only. Provides:
 *  1. Cache purge after data sync operations
 *  2. WAF rule management (block IPs, update threat scores)
 *  3. Analytics reporting to Cloudflare Analytics Engine
 *  4. Zone-level cache invalidation via Cloudflare REST API
 *
 * All Cloudflare credentials are read from Deno environment secrets.
 * NEVER call these from client-side code.
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ─── Cloudflare API client ────────────────────────────────────────────────────
function getCloudflareHeaders(): HeadersInit {
  const token = Deno.env.get('CLOUDFLARE_API_TOKEN');
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN not configured in secrets');
  }
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function getZoneId(): string {
  const zoneId = Deno.env.get('CLOUDFLARE_ZONE_ID');
  if (!zoneId) throw new Error('CLOUDFLARE_ZONE_ID not configured');
  return zoneId;
}

function getAccountId(): string {
  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');
  return accountId;
}

// ─── Cache Purge ──────────────────────────────────────────────────────────────
export interface CachePurgeResult {
  success: boolean;
  purgedUrls?: string[];
  error?: string;
}

/**
 * Purge specific URLs from Cloudflare edge cache.
 * Call this after syncing new data to ensure users get fresh content.
 *
 * @param urls - Array of fully qualified URLs to purge
 */
export async function purgeCloudflareCache(urls: string[]): Promise<CachePurgeResult> {
  if (urls.length === 0) return { success: true, purgedUrls: [] };

  try {
    const zoneId = getZoneId();

    // Cloudflare limits to 30 URLs per purge request
    const BATCH_SIZE = 30;
    let purged = 0;

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: getCloudflareHeaders(),
        body: JSON.stringify({ files: batch }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[cloudflare] Cache purge failed HTTP ${res.status}: ${text}`);
        return { success: false, error: `HTTP ${res.status}: ${text}` };
      }

      const data = await res.json();
      if (!data.success) {
        const errMsg = data.errors?.map((e: any) => e.message).join(', ') ?? 'Unknown error';
        console.error(`[cloudflare] Cache purge API error: ${errMsg}`);
        return { success: false, error: errMsg };
      }

      purged += batch.length;
    }

    console.log(`[cloudflare] Cache purged: ${purged} URLs`);
    return { success: true, purgedUrls: urls };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cloudflare] purgeCloudflareCache error: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Purge all cached responses for a specific API route prefix.
 * Uses Cloudflare's prefix-based purge (Enterprise) or falls back to tag-based.
 */
export async function purgeRoutePrefixCache(routePrefix: string): Promise<CachePurgeResult> {
  try {
    const zoneId = getZoneId();
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: getCloudflareHeaders(),
      body: JSON.stringify({
        // Cache-Tag based purge: requires CF Enterprise
        // For non-Enterprise: purge by prefix using files array
        prefixes: [routePrefix],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[cloudflare] Prefix purge not available (${res.status}), falling back to everything`);
      return purgeEverything();
    }

    const data = await res.json();
    return { success: data.success, error: data.success ? undefined : data.errors?.[0]?.message };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Purge ALL cached content from the zone (nuclear option — use sparingly).
 * Only call after major data migrations or bulk sync operations.
 */
export async function purgeEverything(): Promise<CachePurgeResult> {
  try {
    const zoneId = getZoneId();
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: getCloudflareHeaders(),
      body: JSON.stringify({ purge_everything: true }),
    });

    const data = await res.json();
    const success = res.ok && data.success;
    console.log(`[cloudflare] Purge everything: ${success ? 'OK' : 'FAILED'}`);
    return { success, error: success ? undefined : data.errors?.[0]?.message };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── WAF Rule Management ──────────────────────────────────────────────────────
export interface WAFRuleResult {
  success: boolean;
  ruleId?: string;
  error?: string;
}

/**
 * Block a specific IP address via Cloudflare WAF custom rule.
 * Used when abuse is detected server-side (e.g. repeated invalid auth attempts).
 */
export async function blockIpAddress(
  ip: string,
  reason = 'Automated abuse detected',
): Promise<WAFRuleResult> {
  try {
    const zoneId = getZoneId();
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/firewall/access_rules/rules`, {
      method: 'POST',
      headers: getCloudflareHeaders(),
      body: JSON.stringify({
        mode: 'block',
        configuration: { target: 'ip', value: ip },
        notes: `[PredictXta Auto-Block] ${reason} at ${new Date().toISOString()}`,
      }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      console.log(`[cloudflare] IP blocked: ${ip} reason: ${reason}`);
      return { success: true, ruleId: data.result?.id };
    }
    return { success: false, error: data.errors?.[0]?.message ?? 'Failed to block IP' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Remove an IP block rule (unblock a previously blocked IP).
 */
export async function unblockIpAddress(ruleId: string): Promise<WAFRuleResult> {
  try {
    const zoneId = getZoneId();
    const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`, {
      method: 'DELETE',
      headers: getCloudflareHeaders(),
    });
    const data = await res.json();
    return { success: res.ok && data.success };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Zone Analytics ───────────────────────────────────────────────────────────
export interface ZoneAnalytics {
  totalRequests: number;
  cachedRequests: number;
  cacheHitRate: number;
  uniqueVisitors: number;
  bandwidth: { total: number; cached: number };
  threats: number;
  generatedAt: string;
}

/**
 * Fetch zone-level analytics from Cloudflare Analytics API.
 * Returns aggregated stats for the last 24 hours.
 */
export async function getZoneAnalytics(): Promise<ZoneAnalytics | null> {
  try {
    const zoneId = getZoneId();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const until = new Date().toISOString();

    const res = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/analytics/dashboard?since=${since}&until=${until}&continuous=true`,
      { headers: getCloudflareHeaders() },
    );

    if (!res.ok) return null;
    const data = await res.json();
    const totals = data.result?.totals;
    if (!totals) return null;

    const total = totals.requests?.all ?? 0;
    const cached = totals.requests?.cached ?? 0;

    return {
      totalRequests: total,
      cachedRequests: cached,
      cacheHitRate: total > 0 ? Math.round((cached / total) * 100) : 0,
      uniqueVisitors: totals.uniques?.all ?? 0,
      bandwidth: {
        total: totals.bandwidth?.all ?? 0,
        cached: totals.bandwidth?.cached ?? 0,
      },
      threats: totals.threats?.all ?? 0,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[cloudflare] getZoneAnalytics error:', err);
    return null;
  }
}

// ─── Post-Sync Cache Invalidation ─────────────────────────────────────────────
/**
 * Called by sync edge functions after a successful data sync.
 * Purges the relevant cached routes so users get fresh data immediately.
 *
 * Usage in sync functions:
 *   import { invalidateSyncCache } from '../_shared/cloudflare.ts';
 *   await invalidateSyncCache('sync-news');
 */
export async function invalidateSyncCache(syncJob: string): Promise<void> {
  try {
    // Notify the cache manager Worker about the completed sync
    const cacheManagerUrl = Deno.env.get('CLOUDFLARE_CACHE_MANAGER_URL');
    if (!cacheManagerUrl) {
      console.log('[cloudflare] CLOUDFLARE_CACHE_MANAGER_URL not set — skipping cache invalidation');
      return;
    }

    const res = await fetch(`${cacheManagerUrl}/cache/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('PX_SIGNING_SECRET') ?? ''}`,
      },
      body: JSON.stringify({ syncJob }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[cloudflare] Cache invalidated: ${data.purged} entries for job ${syncJob}`);
    } else {
      console.warn(`[cloudflare] Cache invalidation HTTP ${res.status} for job ${syncJob}`);
    }
  } catch (err) {
    // Non-blocking — cache invalidation failure should not break sync
    console.warn('[cloudflare] Cache invalidation failed (non-blocking):', err);
  }
}

// ─── Rate Limit Abuse Reporter ────────────────────────────────────────────────
/**
 * Report a severely abusive IP to Cloudflare for automatic blocking.
 * Only call when confidence is high (e.g. >1000 req/min from same IP).
 */
export async function reportAbuseToCloudflare(
  ip: string,
  requestCount: number,
  endpoint: string,
): Promise<void> {
  try {
    if (requestCount < 500) return; // Only report severe abuse
    const result = await blockIpAddress(
      ip,
      `Severe abuse: ${requestCount} requests to ${endpoint} in 60s`,
    );
    if (result.success) {
      console.log(`[cloudflare] Auto-blocked abusive IP ${ip} (${requestCount} req/min on ${endpoint})`);
    }
  } catch { /* non-blocking */ }
}

// ─── Cloudflare Workers KV Helper (for edge functions that write to KV) ───────
/**
 * Write a value to Cloudflare Workers KV via REST API.
 * Useful for edge functions that want to pre-populate the gateway cache.
 *
 * Note: This writes to the KV namespace binding in the Worker.
 * The namespace ID must be configured as CLOUDFLARE_KV_NAMESPACE_ID secret.
 */
export async function writeToWorkersKV(
  key: string,
  value: string,
  ttlSeconds = 60,
): Promise<boolean> {
  try {
    const accountId = getAccountId();
    const namespaceId = Deno.env.get('CLOUDFLARE_KV_NAMESPACE_ID');
    if (!namespaceId) {
      console.warn('[cloudflare] CLOUDFLARE_KV_NAMESPACE_ID not configured');
      return false;
    }

    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}?expiration_ttl=${ttlSeconds}`,
      {
        method: 'PUT',
        headers: getCloudflareHeaders(),
        body: value,
      },
    );

    return res.ok;
  } catch (err) {
    console.warn('[cloudflare] writeToWorkersKV error:', err);
    return false;
  }
}
