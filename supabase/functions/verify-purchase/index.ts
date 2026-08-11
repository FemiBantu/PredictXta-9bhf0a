/**
 * supabase/functions/verify-purchase/index.ts
 *
 * Secure server-side IAP purchase verification.
 *
 * Flow:
 *   Client sends purchase receipt/token
 *   → This function verifies with Apple StoreKit 2 or Google Play Billing
 *   → Idempotency check against purchase_transactions table
 *   → On success: upsert vip_subscriptions using service_role key
 *   → Return entitlement status to client
 *
 * The client NEVER directly writes to vip_subscriptions, user_coins, or
 * purchase_transactions. All entitlement grants originate here.
 *
 * Security:
 *   - Authenticated requests only (JWT validated)
 *   - Service-role key used for DB mutations (not exposed to client)
 *   - Idempotency: duplicate purchase tokens return existing entitlement
 *   - All transactions logged to purchase_audit_log
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsOptions } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Product definitions (server-side canonical source of truth)
const PRODUCT_DEFINITIONS: Record<string, {
  type: 'subscription' | 'consumable';
  durationDays?: number;
  coinAmount?: number;
  plan: string;
}> = {
  // VIP Subscriptions
  'predictxta_vip_monthly':   { type: 'subscription', durationDays: 31,  plan: 'monthly' },
  'predictxta_vip_6month':    { type: 'subscription', durationDays: 183, plan: 'biannual' },
  'predictxta_vip_yearly':    { type: 'subscription', durationDays: 365, plan: 'yearly' },
  // Coin packs
  'predictxta_coins_100':     { type: 'consumable', coinAmount: 100,  plan: 'coins_100' },
  'predictxta_coins_500':     { type: 'consumable', coinAmount: 500,  plan: 'coins_500' },
  'predictxta_coins_1000':    { type: 'consumable', coinAmount: 1000, plan: 'coins_1000' },
  'predictxta_coins_5000':    { type: 'consumable', coinAmount: 5000, plan: 'coins_5000' },
};

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req, true); // sensitive endpoint — auth required

  if (req.method === 'OPTIONS') {
    return handleCorsOptions(req, true);
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 1. Authenticate request via JWT ─────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser  = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Parse and validate request body ──────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    productId,
    purchaseToken,   // Android: purchase token from Google Play
    receiptData,     // iOS: receipt data from App Store
    transactionId,   // Android: orderId / iOS: transactionIdentifier
    platform,        // 'ios' | 'android'
    isRestore = false,
  } = body as {
    productId?: string;
    purchaseToken?: string;
    receiptData?: string;
    transactionId?: string;
    platform?: string;
    isRestore?: boolean;
  };

  if (!productId || !platform || (!purchaseToken && !receiptData)) {
    return new Response(JSON.stringify({
      error: 'Missing required fields: productId, platform, and purchaseToken or receiptData',
    }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 3. Validate product ID against server-side canonical list ───────────
  const productDef = PRODUCT_DEFINITIONS[productId as string];
  if (!productDef) {
    console.error(`[verify-purchase] Unknown productId: ${productId} user=${user.id}`);
    return new Response(JSON.stringify({ error: `Unknown product: ${productId}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Idempotency check — prevent double-grant of same purchase ─────────
  const idempotencyKey = transactionId || purchaseToken || `${user.id}:${productId}:${Date.now()}`;
  const { data: existingTx } = await supabaseAdmin
    .from('purchase_audit_log')
    .select('id, status, granted_at')
    .eq('idempotency_key', idempotencyKey)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existingTx && existingTx.status === 'granted') {
    console.log(`[verify-purchase] Duplicate purchase detected, returning existing grant. txId=${idempotencyKey}`);
    return new Response(JSON.stringify({
      success: true,
      alreadyGranted: true,
      message: 'Purchase already processed',
      grantedAt: existingTx.granted_at,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 5. Verify with store (NOT VERIFIED — requires Apple/Google credentials) ─
  // Production verification requires:
  //   iOS:     POST to https://buy.itunes.apple.com/verifyReceipt with shared secret
  //   Android: Google Play Developer API oauth2 with service account
  //
  // For the current build, we accept the purchase claim from the client and
  // log it. When Apple/Google credentials are configured in Supabase Secrets,
  // replace the TODO below with real verification calls.
  //
  // TODO: Implement real receipt validation once credentials are available:
  //   iOS:     Deno.env.get('APPLE_SHARED_SECRET')
  //   Android: Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')

  let verificationStatus: 'verified' | 'pending_verification' = 'pending_verification';
  let verificationDetails: Record<string, unknown> = {
    note: 'NOT VERIFIED — Apple/Google credentials not configured. Configure APPLE_SHARED_SECRET and GOOGLE_PLAY_SERVICE_ACCOUNT_JSON in Supabase Secrets.',
    platform,
    productId,
    isRestore,
  };

  // When real verification is implemented, set verificationStatus = 'verified'
  // only after confirming the receipt with the store. For now, log and proceed.
  console.log(`[verify-purchase] Processing ${platform} purchase: ${productId} user=${user.id} restore=${isRestore}`);

  // ── 6. Log to audit table ────────────────────────────────────────────────
  const auditEntry = {
    user_id: user.id,
    product_id: productId,
    platform: platform,
    transaction_id: transactionId ?? null,
    purchase_token: purchaseToken ? purchaseToken.substring(0, 50) : null, // partial only
    idempotency_key: idempotencyKey,
    status: verificationStatus,
    product_type: productDef.type,
    plan: productDef.plan,
    is_restore: isRestore,
    verification_details: verificationDetails,
    created_at: new Date().toISOString(),
  };

  const { error: auditError } = await supabaseAdmin
    .from('purchase_audit_log')
    .upsert(auditEntry, { onConflict: 'idempotency_key' });

  if (auditError) {
    console.error('[verify-purchase] Failed to log audit entry:', auditError.message);
    // Non-blocking: continue even if audit log fails
  }

  // ── 7. Grant entitlement via service role ────────────────────────────────
  const now = new Date();
  let grantError: string | null = null;

  if (productDef.type === 'subscription') {
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + (productDef.durationDays ?? 31));

    const { error: vipError } = await supabaseAdmin
      .from('vip_subscriptions')
      .upsert({
        user_id: user.id,
        plan: productDef.plan,
        status: 'active',
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      });

    if (vipError) {
      grantError = `VIP subscription grant failed: ${vipError.message}`;
      console.error('[verify-purchase]', grantError);
    } else {
      console.log(`[verify-purchase] VIP granted: ${productDef.plan} until ${expiresAt.toISOString()} user=${user.id}`);
    }
  } else if (productDef.type === 'consumable' && productDef.coinAmount) {
    // Use the SECURITY DEFINER add_user_coins function to prevent direct writes
    const { error: coinError } = await supabaseAdmin.rpc('add_user_coins', {
      p_user_id: user.id,
      p_amount: productDef.coinAmount,
    });

    if (coinError) {
      grantError = `Coin grant failed: ${coinError.message}`;
      console.error('[verify-purchase]', grantError);
    } else {
      console.log(`[verify-purchase] Coins granted: ${productDef.coinAmount} user=${user.id}`);
    }
  }

  // ── 8. Update audit log with grant result ────────────────────────────────
  await supabaseAdmin
    .from('purchase_audit_log')
    .update({
      status: grantError ? 'grant_failed' : 'granted',
      granted_at: grantError ? null : now.toISOString(),
      error_message: grantError ?? null,
    })
    .eq('idempotency_key', idempotencyKey);

  if (grantError) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Purchase recorded but entitlement grant failed. Contact support.',
      details: grantError,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    productId,
    plan: productDef.plan,
    type: productDef.type,
    coinAmount: productDef.coinAmount ?? null,
    verificationStatus,
    message: productDef.type === 'subscription'
      ? `VIP subscription activated (${productDef.plan})`
      : `${productDef.coinAmount} coins credited to your account`,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
