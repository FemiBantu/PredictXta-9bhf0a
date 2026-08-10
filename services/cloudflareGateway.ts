/**
 * services/cloudflareGateway.ts
 *
 * Client-side Cloudflare gateway integration for PredictXta.
 *
 * When CLOUDFLARE_GATEWAY_URL is configured, all edge function calls
 * are routed through the Cloudflare Worker gateway for:
 *  - Edge caching (faster responses from nearest PoP)
 *  - Rate limiting by user tier (VIP gets higher limits)
 *  - Bot detection and WAF protection
 *  - Security headers on all responses
 *
 * Falls back transparently to direct OnSpace calls if gateway unavailable.
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Configuration ────────────────────────────────────────────────────────────
// Set this in .env as EXPO_PUBLIC_CLOUDFLARE_GATEWAY_URL when deploying Workers
const GATEWAY_URL = process.env.EXPO_PUBLIC_CLOUDFLARE_GATEWAY_URL ?? null;
const ONSPACE_BASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

// Cache key for VIP status (read locally to attach to requests)
const VIP_CACHE_KEY = 'predictxta_is_vip_v1';

// ─── User Tier Detection ──────────────────────────────────────────────────────
async function getUserTier(): Promise<'anon' | 'free' | 'vip'> {
  try {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return 'anon';

    // Check cached VIP status first (avoid DB hit on every request)
    const cached = await AsyncStorage.getItem(VIP_CACHE_KEY);
    if (cached === 'true') return 'vip';

    return 'free';
  } catch {
    return 'anon';
  }
}

// ─── Gateway-aware fetch ──────────────────────────────────────────────────────
interface GatewayFetchOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  /** Force bypass of Cloudflare cache (adds Cache-Control: no-cache) */
  bypassCache?: boolean;
}

interface GatewayFetchResult<T> {
  data: T | null;
  error: string | null;
  /** Whether the response came from Cloudflare edge cache */
  cacheHit: boolean;
  /** Which data source served the response */
  source: 'cloudflare-cache' | 'cloudflare-origin' | 'direct';
  /** Rate limit remaining (if returned by gateway) */
  rateLimitRemaining?: number;
}

/**
 * Fetch from an OnSpace Edge Function, routing through Cloudflare gateway
 * when configured. Attaches user tier header for differential rate limiting.
 *
 * @param functionName - Edge function name (e.g. 'home-feed')
 * @param options - Request options
 */
export async function gatewayFetch<T = unknown>(
  functionName: string,
  options: GatewayFetchOptions = {},
): Promise<GatewayFetchResult<T>> {
  const { method = 'POST', body, bypassCache = false } = options;
  const path = `/functions/v1/${functionName}`;

  try {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': anonKey,
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    if (bypassCache) {
      headers['Cache-Control'] = 'no-cache';
      headers['X-PX-Bypass-Cache'] = '1';
    }

    // Attach user tier for differential rate limiting at the edge
    const tier = await getUserTier();
    headers['X-PX-User-Tier'] = tier;

    // Determine base URL (gateway or direct)
    const baseUrl = GATEWAY_URL ?? ONSPACE_BASE_URL;
    const source = GATEWAY_URL ? 'cloudflare-origin' : 'direct';

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Read Cloudflare cache status
    const cfCacheStatus = response.headers.get('CF-Cache-Status');
    const pxCache = response.headers.get('X-PX-Cache');
    const cacheHit = cfCacheStatus === 'HIT' || pxCache === 'HIT';

    // Read rate limit headers
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');

    if (!response.ok) {
      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') ?? '60';
        const rateTier = response.headers.get('X-RateLimit-Tier') ?? tier;
        return {
          data: null,
          error: `Rate limited (${rateTier} tier). Retry in ${retryAfter}s.`,
          cacheHit: false,
          source,
          rateLimitRemaining: 0,
        };
      }

      // Handle WAF/bot blocks
      if (response.status === 403) {
        return {
          data: null,
          error: 'Request blocked by security policy.',
          cacheHit: false,
          source,
        };
      }

      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        data: null,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        cacheHit: false,
        source,
      };
    }

    const data = await response.json() as T;
    return {
      data,
      error: null,
      cacheHit,
      source: cacheHit ? 'cloudflare-cache' : source,
      rateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // If gateway fails, try direct OnSpace as fallback
    if (GATEWAY_URL) {
      console.warn(`[Gateway] Cloudflare gateway failed, falling back to direct: ${message}`);
      return directFetch<T>(functionName, options);
    }

    return { data: null, error: message, cacheHit: false, source: 'direct' };
  }
}

/** Direct OnSpace fetch without Cloudflare routing (fallback) */
async function directFetch<T>(
  functionName: string,
  options: GatewayFetchOptions,
): Promise<GatewayFetchResult<T>> {
  const { method = 'POST', body } = options;
  const path = `/functions/v1/${functionName}`;
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'apikey': anonKey };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

  const response = await fetch(`${ONSPACE_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    return { data: null, error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`, cacheHit: false, source: 'direct' };
  }

  const data = await response.json() as T;
  return { data, error: null, cacheHit: false, source: 'direct' };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Fetch home feed through gateway (cached at edge) */
export async function fetchHomeFeedViaGateway(params: {
  sport?: string;
  isVip?: boolean;
  userId?: string;
}) {
  return gatewayFetch<Record<string, unknown>>('home-feed', {
    method: 'POST',
    body: params,
  });
}

/** Force-refresh home feed bypassing edge cache */
export async function refreshHomeFeedViaGateway(params: {
  sport?: string;
  isVip?: boolean;
  userId?: string;
}) {
  return gatewayFetch<Record<string, unknown>>('home-feed', {
    method: 'POST',
    body: params,
    bypassCache: true,
  });
}

/** Check if Cloudflare gateway is configured and reachable */
export async function checkGatewayHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  latencyMs: number;
  cacheHit: boolean;
}> {
  if (!GATEWAY_URL) {
    return { configured: false, reachable: false, latencyMs: 0, cacheHit: false };
  }

  const startMs = Date.now();
  try {
    const res = await fetch(`${GATEWAY_URL}/functions/v1/home-feed?sport=all`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - startMs;
    const cacheHit = res.headers.get('CF-Cache-Status') === 'HIT';
    return { configured: true, reachable: res.ok, latencyMs, cacheHit };
  } catch {
    return { configured: true, reachable: false, latencyMs: Date.now() - startMs, cacheHit: false };
  }
}

// ─── Gateway Status Hook ──────────────────────────────────────────────────────
/** Returns a display string for gateway status (for debug/settings screens) */
export function getGatewayStatusLabel(): string {
  if (!GATEWAY_URL) return 'Direct (no Cloudflare)';
  const domain = new URL(GATEWAY_URL).hostname;
  return `Cloudflare Workers (${domain})`;
}
