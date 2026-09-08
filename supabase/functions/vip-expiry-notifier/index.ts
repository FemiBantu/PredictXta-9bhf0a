/**
 * supabase/functions/vip-expiry-notifier/index.ts
 *
 * Queries vip_subscriptions for users whose plan expires within 7 days
 * and dispatches a push notification to each via the send-push edge function.
 *
 * Designed to be called daily by the pipeline_schedule cron system.
 * Also accepts direct POST calls (e.g. from daily-scheduler or admin panel).
 *
 * Request body (optional):
 * {
 *   windowDays?: number;   // default 7  — notify users expiring within N days
 *   dryRun?: boolean;      // default false — if true, query only, no push sent
 * }
 *
 * Security:
 *   - Uses service role to query vip_subscriptions (bypasses RLS)
 *   - Never exposes user IDs or token data in response
 *   - Calls send-push internally (server-to-server, no client tokens required)
 *
 * Required Supabase secrets (inherited from send-push):
 *   FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PROJECT_ID
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Notification copy — one message per expiry band
const COPY: Record<string, { title: string; body: string }> = {
  '1': {
    title: '⏳ VIP Expires Tomorrow',
    body: 'Your PredictXta VIP plan expires tomorrow. Renew now to keep all your premium benefits.',
  },
  '3': {
    title: '⏳ VIP Expires in 3 Days',
    body: 'Your PredictXta VIP plan expires in 3 days. Renew now so you never miss an expert pick.',
  },
  '7': {
    title: '🏆 VIP Expiring Soon',
    body: 'Your PredictXta VIP plan expires in 7 days. Renew to keep unlimited AI picks and expert tips.',
  },
};

/** Pick the most specific copy bucket for a given days-remaining value. */
function copyForDays(days: number): { title: string; body: string } {
  if (days <= 1) return COPY['1'];
  if (days <= 3) return COPY['3'];
  return COPY['7'];
}

Deno.serve(async (req: Request) => {
  // ── CORS pre-flight ─────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse request body ──────────────────────────────────────────────────────
  let windowDays = 7;
  let dryRun = false;

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.windowDays === 'number' && body.windowDays > 0) {
      windowDays = Math.min(body.windowDays, 30); // cap at 30 days
    }
    if (body.dryRun === true) dryRun = true;
  } catch { /* use defaults */ }

  const started = Date.now();
  console.log(`[vip-expiry-notifier] starting — windowDays=${windowDays} dryRun=${dryRun}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Query expiring subscriptions ────────────────────────────────────────────
  // Find active subs whose expires_at is between now and (now + windowDays)
  const now       = new Date();
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const { data: expiringSubs, error: queryError } = await supabase
    .from('vip_subscriptions')
    .select('user_id, plan, expires_at')
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .lte('expires_at', windowEnd.toISOString());

  if (queryError) {
    console.error('[vip-expiry-notifier] query failed:', queryError.message);
    return new Response(
      JSON.stringify({ error: `Query failed: ${queryError.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const subs = expiringSubs ?? [];
  console.log(`[vip-expiry-notifier] found ${subs.length} expiring subscriptions`);

  if (subs.length === 0) {
    return new Response(
      JSON.stringify({ notified: 0, skipped: 0, dryRun, message: 'No expiring subscriptions found' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (dryRun) {
    return new Response(
      JSON.stringify({
        notified: 0,
        skipped: subs.length,
        dryRun: true,
        users: subs.map((s) => ({
          userId: s.user_id,
          plan: s.plan,
          expiresAt: s.expires_at,
          daysRemaining: Math.ceil(
            (new Date(s.expires_at).getTime() - now.getTime()) / 86_400_000,
          ),
        })),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Deduplicate by user (keep the soonest-expiring sub per user) ─────────────
  const byUser = new Map<string, { plan: string; expiresAt: string; daysRemaining: number }>();
  for (const sub of subs) {
    const daysRemaining = Math.ceil(
      (new Date(sub.expires_at).getTime() - now.getTime()) / 86_400_000,
    );
    const existing = byUser.get(sub.user_id);
    if (!existing || daysRemaining < existing.daysRemaining) {
      byUser.set(sub.user_id, { plan: sub.plan, expiresAt: sub.expires_at, daysRemaining });
    }
  }

  // ── Group by expiry band for notification copy ───────────────────────────────
  // Group 1: ≤1 day  → "expires tomorrow"
  // Group 3: ≤3 days → "expires in 3 days"
  // Group 7: ≤7 days → "expiring soon"
  const groups: Record<string, string[]> = { '1': [], '3': [], '7': [] };

  for (const [userId, { daysRemaining }] of byUser) {
    if (daysRemaining <= 1)      groups['1'].push(userId);
    else if (daysRemaining <= 3) groups['3'].push(userId);
    else                          groups['7'].push(userId);
  }

  // ── Fire send-push for each non-empty group ──────────────────────────────────
  let totalNotified = 0;
  let totalErrors   = 0;
  const groupResults: Record<string, unknown> = {};

  const sendPushUrl = `${SUPABASE_URL}/functions/v1/send-push`;

  for (const [band, userIds] of Object.entries(groups)) {
    if (userIds.length === 0) continue;

    const { title, body: notifBody } = copyForDays(parseInt(band, 10));

    try {
      const resp = await fetch(sendPushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userIds,
          title,
          body: notifBody,
          data: {
            screen: 'subscription-management',
            deepLink: 'predictxta://subscription-management',
            notifType: 'vip_expiry',
            band,
          },
          channelId: 'vip',
          contentType: 'notification',
        }),
      });

      const result = resp.ok ? await resp.json() : { error: await resp.text() };
      groupResults[band] = result;

      if (resp.ok) {
        const sent = (result.sent ?? 0) + (result.fcmSent ?? 0);
        totalNotified += sent;
        console.log(
          `[vip-expiry-notifier] band=${band} userIds=${userIds.length} sent=${sent}`,
        );
      } else {
        totalErrors += userIds.length;
        console.error(`[vip-expiry-notifier] band=${band} send-push error:`, result.error);
      }
    } catch (e) {
      totalErrors += userIds.length;
      groupResults[band] = { error: String(e) };
      console.error(`[vip-expiry-notifier] band=${band} fetch error:`, e);
    }
  }

  // ── Log to pipeline_alerts if any errors ─────────────────────────────────────
  if (totalErrors > 0) {
    await supabase.from('pipeline_alerts').insert({
      alert_type: 'vip_expiry_notifier_partial_failure',
      severity: 'warning',
      message: `vip-expiry-notifier: ${totalErrors} push delivery failures`,
      details: { groupResults, totalNotified, totalErrors, windowDays },
    }).then(() => {}).catch(() => {});
  }

  const durationMs = Date.now() - started;
  console.log(
    `[vip-expiry-notifier] done — notified=${totalNotified} errors=${totalErrors} ms=${durationMs}`,
  );

  return new Response(
    JSON.stringify({
      notified: totalNotified,
      errors: totalErrors,
      totalUsersFound: byUser.size,
      dryRun: false,
      groups: Object.fromEntries(
        Object.entries(groups).map(([k, v]) => [k, v.length]),
      ),
      durationMs,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
