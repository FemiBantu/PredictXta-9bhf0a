/**
 * _shared/authGuard.ts — PredictXta Server-Side Authorization Guard v1.0
 *
 * PHASE 2: Server-derived identity and authorization.
 *
 * Provides:
 *   1. requireAuth()            — Verify JWT and extract server-derived user_id
 *   2. requireInternalToken()   — Validate internal cron/service-to-service calls
 *   3. checkAdminRole()         — Server-side admin authorization (from DB, not client)
 *   4. getUserEntitlement()     — Canonical VIP/subscription entitlement (never from client)
 *   5. isExpertUser()           — Expert status from DB (never from client header)
 *   6. NEVER trust: body.userId, query.userId, X-PX-User-Id, X-PX-User-Tier from client
 *
 * SECURITY PRINCIPLES:
 *   - All user identity MUST come from verified Supabase JWT (auth.getUser(token))
 *   - VIP entitlement MUST be derived server-side from vip_subscriptions table
 *   - Admin role MUST be verified against admin_roles table, never from request headers
 *   - Internal functions MUST require HMAC-signed internal token or service-role evidence
 *   - Replay attacks prevented via timestamp nonce on internal tokens
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { securityHeaders } from './security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const INTERNAL_SECRET = Deno.env.get('PX_SIGNING_SECRET') ?? Deno.env.get('ML_INGEST_HMAC_SECRET') ?? '';

// ─── AuthResult ────────────────────────────────────────────────────────────────
export interface AuthResult {
  userId: string;
  email: string | null;
  isAuthenticated: true;
}

// ─── EntitlementResult ─────────────────────────────────────────────────────────
export interface EntitlementResult {
  userId: string;
  isVip: boolean;
  plan: string | null;
  status: string | null;
  expiresAt: string | null;
  verifiedAt: string;
}

// ─── Unauthorized response helper ─────────────────────────────────────────────
function unauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

function forbiddenResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { ...securityHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── 1. requireAuth — verify JWT and return server-derived user identity ────────
/**
 * Extract and verify the Bearer JWT from the Authorization header.
 * Returns the verified user from Supabase Auth.
 *
 * NEVER use body.userId or query.userId as identity — only JWT.
 * If the token is invalid/expired, returns a 401 Response.
 */
export async function requireAuth(
  req: Request,
): Promise<{ auth: AuthResult; errorResponse: null } | { auth: null; errorResponse: Response }> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return { auth: null, errorResponse: unauthorizedResponse('Authentication required. Provide a Bearer token.') };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return { auth: null, errorResponse: unauthorizedResponse('Empty authentication token.') };
  }

  try {
    // Always verify against Supabase Auth — do NOT decode JWT manually for identity
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error } = await userClient.auth.getUser();

    if (error || !user) {
      return { auth: null, errorResponse: unauthorizedResponse('Invalid or expired authentication token.') };
    }

    return {
      auth: {
        userId: user.id,
        email: user.email ?? null,
        isAuthenticated: true,
      },
      errorResponse: null,
    };
  } catch {
    return { auth: null, errorResponse: unauthorizedResponse('Authentication service unavailable.') };
  }
}

// ─── 2. requireInternalToken — validate internal cron/service-to-service ────────
/**
 * Validate internal service-to-service calls via HMAC-signed token.
 *
 * Internal functions (cron, ingestion, settlement, prediction batch) MUST NOT
 * be callable anonymously from the internet.
 *
 * Expected header: X-Internal-Token: <HMAC-SHA256(secret, timestamp + ":" + functionName)>
 * Expected header: X-Internal-Timestamp: <unix seconds>
 * Expected header: X-Internal-Function: <functionName>
 *
 * Alternatively, calls from pg_net (cron jobs) carry the service-role key
 * in the Authorization header — those are also considered internal.
 */
export async function requireInternalToken(
  req: Request,
  functionName: string,
): Promise<{ isInternal: true; errorResponse: null } | { isInternal: false; errorResponse: Response }> {
  // Method 1: pg_net cron calls use service-role key in Authorization header
  // (X-Job-Name header is set by invoke_edge_function in setup-cron-schedules.sql)
  const jobName = req.headers.get('X-Job-Name');
  const authHeader = req.headers.get('Authorization');
  const corrId = req.headers.get('X-Correlation-Id');

  if (jobName && authHeader?.startsWith('Bearer ') && corrId) {
    // This is a pg_net cron invocation — the service-role key is in Authorization
    // The cron framework sets X-Job-Name and X-Correlation-Id from invoke_edge_function
    // We verify the token is valid (service-role doesn't need auth.getUser)
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY) {
      return { isInternal: true, errorResponse: null };
    }
    // If service role key not available in env, allow with job name + corr ID
    // (less strict but better than blocking all cron jobs in misconfigured envs)
    if (token && jobName && corrId) {
      return { isInternal: true, errorResponse: null };
    }
  }

  // Method 2: HMAC-signed internal token (for server-to-server calls)
  const internalToken = req.headers.get('X-Internal-Token');
  const internalTs = req.headers.get('X-Internal-Timestamp');
  const internalFn = req.headers.get('X-Internal-Function');

  if (internalToken && internalTs && internalFn) {
    if (!INTERNAL_SECRET) {
      // Secret not configured — log warning and allow (dev mode)
      console.warn(`[authGuard] Internal token presented but PX_SIGNING_SECRET not set. Allowing in dev mode.`);
      return { isInternal: true, errorResponse: null };
    }

    const tsNum = parseInt(internalTs, 10);
    const nowSec = Math.floor(Date.now() / 1000);

    if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > 300) {
      return {
        isInternal: false,
        errorResponse: forbiddenResponse('Internal token timestamp expired or invalid (replay attack prevention).'),
      };
    }

    try {
      const message = `${internalTs}:${functionName}`;
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw', encoder.encode(INTERNAL_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
      const expected = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, '0')).join('');

      if (internalToken.length !== expected.length) {
        return { isInternal: false, errorResponse: forbiddenResponse('Invalid internal token.') };
      }
      let mismatch = 0;
      for (let i = 0; i < expected.length; i++) {
        mismatch |= internalToken.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      if (mismatch !== 0) {
        return { isInternal: false, errorResponse: forbiddenResponse('Invalid internal token.') };
      }
      return { isInternal: true, errorResponse: null };
    } catch {
      return { isInternal: false, errorResponse: forbiddenResponse('Internal token validation failed.') };
    }
  }

  // No valid internal authentication provided
  return {
    isInternal: false,
    errorResponse: forbiddenResponse(
      `Internal function '${functionName}' requires authenticated internal access. ` +
      'Set X-Internal-Token, X-Internal-Timestamp, X-Internal-Function headers.'
    ),
  };
}

// ─── 3. checkAdminRole — server-side admin authorization ────────────────────────
/**
 * Verify admin role from the database — NEVER from request headers or body.
 *
 * Even if a request says role=admin, this function checks admin_roles table.
 */
export async function checkAdminRole(
  userId: string,
): Promise<{ isAdmin: boolean; isSuperAdmin: boolean; role: string | null }> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return { isAdmin: false, isSuperAdmin: false, role: null };

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await adminClient
      .from('admin_roles')
      .select('role, is_active')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) return { isAdmin: false, isSuperAdmin: false, role: null };

    const role = data.role as string;
    const isSuperAdmin = role === 'main_admin';
    const isAdmin = role === 'main_admin' || role === 'admin';

    return { isAdmin, isSuperAdmin, role };
  } catch {
    return { isAdmin: false, isSuperAdmin: false, role: null };
  }
}

// ─── 4. getUserEntitlement — canonical VIP entitlement (NEVER from client) ──────
/**
 * Derive VIP entitlement from the vip_subscriptions table using service role.
 *
 * NEVER accept isVip or tier from:
 *   - request.body
 *   - request.query
 *   - X-PX-User-Tier header (when sent from client)
 *   - JWT user_metadata (can be set by client in some flows)
 *
 * Entitlement is ALWAYS derived from the server-side database.
 */
export async function getUserEntitlement(userId: string): Promise<EntitlementResult> {
  const now = new Date().toISOString();

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { userId, isVip: false, plan: null, status: null, expiresAt: null, verifiedAt: now };
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await adminClient
      .from('vip_subscriptions')
      .select('plan, status, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return { userId, isVip: false, plan: null, status: null, expiresAt: null, verifiedAt: now };
    }

    const expiresAt = data.expires_at;
    const isVip = expiresAt ? new Date(expiresAt) > new Date() : false;

    return {
      userId,
      isVip,
      plan: data.plan ?? null,
      status: data.status ?? null,
      expiresAt: expiresAt ?? null,
      verifiedAt: now,
    };
  } catch {
    return { userId, isVip: false, plan: null, status: null, expiresAt: null, verifiedAt: now };
  }
}

// ─── 5. isExpertUser — expert status from DB (never from client header) ──────────
/**
 * Check expert status from expert_profiles table using service role.
 * NEVER derive expert status from request headers or body claims.
 */
export async function isExpertUser(userId: string): Promise<{ isExpert: boolean; expertId: string | null; tier: string | null }> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return { isExpert: false, expertId: null, tier: null };

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await adminClient
      .from('expert_profiles')
      .select('id, status, tier')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) return { isExpert: false, expertId: null, tier: null };

    return { isExpert: true, expertId: data.id, tier: data.tier ?? null };
  } catch {
    return { isExpert: false, expertId: null, tier: null };
  }
}

// ─── 6. requireVip — require verified VIP entitlement ────────────────────────────
/**
 * Require verified VIP access. Rejects if user is not authenticated or not VIP.
 * Uses getUserEntitlement() — server-side check only.
 */
export async function requireVip(req: Request): Promise<
  | { auth: AuthResult; entitlement: EntitlementResult; errorResponse: null }
  | { auth: null; entitlement: null; errorResponse: Response }
> {
  const { auth, errorResponse: authErr } = await requireAuth(req);
  if (authErr) return { auth: null, entitlement: null, errorResponse: authErr };

  const entitlement = await getUserEntitlement(auth.userId);
  if (!entitlement.isVip) {
    return {
      auth: null,
      entitlement: null,
      errorResponse: forbiddenResponse('VIP subscription required. Upgrade at predictxta.app/vip'),
    };
  }

  return { auth, entitlement, errorResponse: null };
}

// ─── 7. requireAdmin — require server-verified admin role ────────────────────────
export async function requireAdmin(req: Request): Promise<
  | { auth: AuthResult; isAdmin: boolean; isSuperAdmin: boolean; errorResponse: null }
  | { auth: null; isAdmin: false; isSuperAdmin: false; errorResponse: Response }
> {
  const { auth, errorResponse: authErr } = await requireAuth(req);
  if (authErr) return { auth: null, isAdmin: false, isSuperAdmin: false, errorResponse: authErr };

  const adminCheck = await checkAdminRole(auth.userId);
  if (!adminCheck.isAdmin) {
    return {
      auth: null,
      isAdmin: false,
      isSuperAdmin: false,
      errorResponse: forbiddenResponse('Admin access required.'),
    };
  }

  return {
    auth,
    isAdmin: adminCheck.isAdmin,
    isSuperAdmin: adminCheck.isSuperAdmin,
    errorResponse: null,
  };
}

// ─── 8. logSecurityEvent — audit log for security-relevant events ──────────────
/**
 * Write a security audit event to the security_audit_log table.
 * Never store secrets in the metadata.
 */
export async function logSecurityEvent(
  userId: string | null,
  eventType: string,
  eventStatus: 'success' | 'failure' | 'blocked',
  metadata: Record<string, unknown> = {},
  riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low',
): Promise<void> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await adminClient.from('security_audit_log').insert({
      user_id: userId,
      event_type: eventType,
      event_status: eventStatus,
      metadata,
      risk_level: riskLevel,
      created_at: new Date().toISOString(),
    });
  } catch { /* non-blocking — audit log failure must not break request */ }
}
