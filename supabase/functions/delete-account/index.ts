/**
 * delete-account — Permanently deletes a user account and all associated data.
 *
 * Security hardening (v2.0):
 *  - Origin-aware CORS (getAuthCorsHeaders) — not wildcard for this sensitive endpoint
 *  - Rate limited: 3 attempts/IP/hour + 1 attempt/user/hour (prevents brute-force)
 *
 * Flow:
 *  1. Verify JWT → get authenticated user ID
 *  2. Cascade-delete all user data from every relevant table
 *  3. Delete the Supabase Auth user via admin API
 *  4. Return success / structured error
 *
 * Tables cleaned (in safe order to avoid FK violations):
 *  - video_views, video_likes, video_bookmarks
 *  - news_bookmarks
 *  - coin_claims, user_coins
 *  - challenge_picks, challenge_results
 *  - prediction_votes
 *  - predictions
 *  - expert_slip_picks, expert_slips, expert_rewards_ledger, expert_warnings, expert_daily_stats
 *  - expert_followers (both as follower and expert)
 *  - expert_profiles
 *  - chat_messages
 *  - notifications
 *  - referrals (both sides)
 *  - user_sessions
 *  - security_audit_log
 *  - user_security_settings
 *  - vip_subscriptions
 *  - admin_roles
 *  - user_profiles  ← triggers cascade on auth.users
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAuthCorsHeaders, handleCorsOptions } from '../_shared/cors.ts';
import { rateLimitCheck, getClientIp } from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req: Request) => {
  // ── CORS preflight (sensitive endpoint — origin-aware) ─────────────────────
  const preflight = handleCorsOptions(req, true);
  if (preflight) return preflight;

  const authCors = getAuthCorsHeaders(req);

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...authCors, 'Content-Type': 'application/json' },
    });
  }

  // ── Rate limiting: max 3 deletion attempts per IP per hour ─────────────────
  const ip = getClientIp(req);
  const ipRlGuard = rateLimitCheck(`delete-account::ip::${ip}`, {
    max: 3, windowSec: 3600, blockSec: 3600,
  });
  if (ipRlGuard) return ipRlGuard;

  try {
    // ── 1. Authenticate caller via JWT ─────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { ...authCors, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // User-context client (validates token server-side)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized — invalid token' }), {
        status: 401, headers: { ...authCors, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // ── Per-user rate limit: max 1 deletion per user per hour ──────────────
    const userRlGuard = rateLimitCheck(`delete-account::user::${userId}`, {
      max: 1, windowSec: 3600, blockSec: 3600,
    });
    if (userRlGuard) return userRlGuard;

    console.log(`[delete-account] Starting deletion for user: ${userId}`);

    // ── 2. Admin client for destructive operations ─────────────────────────
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 3. Delete user data in safe order ──────────────────────────────────
    const deleteTable = async (table: string, column: string = 'user_id') => {
      const { error } = await adminClient.from(table).delete().eq(column, userId);
      if (error && !error.message.includes('does not exist')) {
        console.warn(`[delete-account] Warning deleting ${table}: ${error.message}`);
      }
    };

    // Storage: remove avatar
    await adminClient.storage.from('avatars').remove([
      `${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.webp`,
    ]);

    // Interaction data
    await deleteTable('video_views');
    await deleteTable('video_likes');
    await deleteTable('video_bookmarks');
    await deleteTable('news_bookmarks');

    // Coin economy
    await deleteTable('coin_claims');
    await deleteTable('user_coins');

    // Challenge data
    await deleteTable('challenge_picks');
    await deleteTable('challenge_results');

    // Predictions
    await deleteTable('prediction_votes');
    await deleteTable('predictions');

    // Expert program
    await deleteTable('expert_slip_picks', 'expert_id');
    await deleteTable('expert_rewards_ledger');
    await deleteTable('expert_warnings');
    await deleteTable('expert_daily_stats', 'expert_id');
    await deleteTable('expert_slips');

    // expert_followers: delete where user is follower
    await adminClient.from('expert_followers').delete().eq('follower_id', userId);

    // Delete expert profile (triggers cascade on expert_followers as expert)
    await deleteTable('expert_profiles');

    // Chat
    await deleteTable('chat_messages');

    // Notifications & sessions
    await deleteTable('notifications');
    await adminClient.from('referrals').delete().eq('referrer_id', userId);
    await adminClient.from('referrals').delete().eq('referred_id', userId);
    await deleteTable('user_sessions');

    // Security & settings
    await deleteTable('security_audit_log');
    await deleteTable('user_security_settings');

    // Subscriptions & roles
    await deleteTable('vip_subscriptions');
    await deleteTable('admin_roles');

    // ── 4. Delete user_profiles row ────────────────────────────────────────
    const { error: profileErr } = await adminClient
      .from('user_profiles')
      .delete()
      .eq('id', userId);
    if (profileErr) {
      console.warn(`[delete-account] user_profiles delete warning: ${profileErr.message}`);
    }

    // ── 5. Delete Supabase Auth user via Admin API ─────────────────────────
    const { error: authErr } = await adminClient.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error(`[delete-account] Auth user deletion failed for ${userId}: ${authErr.message}`);
      return new Response(JSON.stringify({
        error: 'Failed to delete auth account. Data has been removed. Please contact support.',
        code: 'AUTH_DELETE_FAILED',
      }), {
        status: 500, headers: { ...authCors, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[delete-account] Successfully deleted user ${userId}`);

    return new Response(JSON.stringify({ success: true, message: 'Account permanently deleted.' }), {
      status: 200, headers: { ...authCors, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[delete-account] Unexpected error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...getAuthCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
