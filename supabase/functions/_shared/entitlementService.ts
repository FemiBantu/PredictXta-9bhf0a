/**
 * _shared/entitlementService.ts — Canonical Server-Side Entitlement Service
 *
 * PHASE 2: Single authoritative VIP/subscription entitlement derivation.
 *
 * Every VIP-protected endpoint MUST use this service.
 * NEVER duplicate subscription logic across Edge Functions.
 * NEVER derive VIP status from client-supplied headers or body fields.
 *
 * Architecture:
 *   JWT → verified userId → vip_subscriptions (service role) → entitlement decision
 *
 * This service is the ONLY source of truth for VIP access decisions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Types ─────────────────────────────────────────────────────────────────────
export type SubscriptionStatus =
  | 'active'
  | 'cancelled'
  | 'expired'
  | 'pending_verification'
  | 'revoked'
  | 'none';

export interface Entitlement {
  /** Supabase user ID — server-derived from JWT, never from client */
  userId: string;
  /** True only if subscription is active AND not expired */
  isVip: boolean;
  /** Product/plan ID from canonical server-side list */
  plan: string | null;
  /** Platform: 'ios' | 'android' | null */
  platform: string | null;
  /** Server-derived subscription status */
  status: SubscriptionStatus;
  /** ISO timestamp of subscription start */
  startedAt: string | null;
  /** ISO timestamp of expiry */
  expiresAt: string | null;
  /** ISO timestamp of cancellation (if any) */
  cancelledAt: string | null;
  /** Whether currently in grace period */
  inGracePeriod: boolean;
  /** Whether subscription was revoked (fraud, chargeback) */
  revoked: boolean;
  /** ISO timestamp of last server verification */
  verifiedAt: string;
  /** Whether this entitlement was checked against purchase records */
  purchaseVerified: boolean;
}

// ─── In-memory entitlement cache (30 seconds TTL) ─────────────────────────────
interface CacheEntry {
  entitlement: Entitlement;
  fetchedAt: number;
}
const entitlementCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

// ─── Main entitlement resolution ──────────────────────────────────────────────
/**
 * getEntitlement — canonical server-side VIP entitlement check.
 *
 * Checks vip_subscriptions table using service role.
 * Result cached for 30s per userId to reduce DB load.
 *
 * @param userId — Server-derived from JWT. NEVER pass a client-supplied userId.
 * @param bypassCache — Force a fresh DB read (use for purchase verification flows)
 */
export async function getEntitlement(
  userId: string,
  bypassCache = false,
): Promise<Entitlement> {
  const now = Date.now();
  const nowIso = new Date().toISOString();

  // Return cached result if fresh
  if (!bypassCache) {
    const cached = entitlementCache.get(userId);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.entitlement;
    }
  }

  const empty: Entitlement = {
    userId,
    isVip: false,
    plan: null,
    platform: null,
    status: 'none',
    startedAt: null,
    expiresAt: null,
    cancelledAt: null,
    inGracePeriod: false,
    revoked: false,
    verifiedAt: nowIso,
    purchaseVerified: false,
  };

  if (!SUPABASE_SERVICE_ROLE_KEY) return empty;

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Query active subscriptions for this user
    const { data: sub, error } = await adminClient
      .from('vip_subscriptions')
      .select('plan, status, expires_at, created_at')
      .eq('user_id', userId)
      .in('status', ['active', 'cancelled']) // Include cancelled for grace period check
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !sub) {
      entitlementCache.set(userId, { entitlement: empty, fetchedAt: now });
      return empty;
    }

    // Check purchase audit log for revocation
    const { data: auditEntry } = await adminClient
      .from('purchase_audit_log')
      .select('status')
      .eq('user_id', userId)
      .eq('status', 'revoked')
      .limit(1)
      .maybeSingle();

    const isRevoked = !!auditEntry;

    const expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;
    const isExpired = expiresAt ? expiresAt <= new Date() : true;

    // Grace period: 3 days after expiry for cancelled subscriptions
    const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
    const inGracePeriod = sub.status === 'cancelled' && expiresAt !== null
      ? (expiresAt.getTime() + gracePeriodMs) > now
      : false;

    const isVip = !isRevoked && !isExpired && (sub.status === 'active' || inGracePeriod);

    const result: Entitlement = {
      userId,
      isVip,
      plan: sub.plan ?? null,
      platform: null, // Not stored in current schema; could be added
      status: isRevoked ? 'revoked'
        : isExpired ? 'expired'
        : sub.status as SubscriptionStatus,
      startedAt: sub.created_at ?? null,
      expiresAt: sub.expires_at ?? null,
      cancelledAt: sub.status === 'cancelled' ? sub.expires_at ?? null : null,
      inGracePeriod,
      revoked: isRevoked,
      verifiedAt: nowIso,
      purchaseVerified: true,
    };

    entitlementCache.set(userId, { entitlement: result, fetchedAt: now });
    return result;
  } catch {
    return empty;
  }
}

/**
 * invalidateEntitlementCache — call after purchase verification or subscription change.
 * Ensures the next request gets a fresh DB read.
 */
export function invalidateEntitlementCache(userId: string): void {
  entitlementCache.delete(userId);
}

/**
 * invalidateAllEntitlementCaches — call on server restart or mass revocation.
 */
export function invalidateAllEntitlementCaches(): void {
  entitlementCache.clear();
}

/**
 * checkVipAccess — quick boolean VIP check for protecting endpoints.
 *
 * @param userId — Server-derived from JWT.
 * @returns true only if user has active, non-expired, non-revoked VIP subscription.
 */
export async function checkVipAccess(userId: string): Promise<boolean> {
  const entitlement = await getEntitlement(userId);
  return entitlement.isVip;
}
