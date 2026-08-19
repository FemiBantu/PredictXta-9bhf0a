/**
 * expert-promotion — Automated Expert Tipster Promotion & Demotion Engine
 *
 * Actions:
 *   check_promotion  { user_id }         → Check single user eligibility
 *   promote          { user_id }         → Promote eligible user to expert
 *   daily_review     {}                  → Review all experts (retention + warnings)
 *   settle_slip      { slip_id }         → Settle one fully-resolved slip
 *   settle_daily     { date? }           → Auto-settle all pending picks against today's finished matches
 *   credit_rewards   { date }            → Credit pending rewards for a date
 *   recalculate      { expert_id }       → Recalculate expert profile stats
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseAdmin = () => createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// ─── Reward tiers ─────────────────────────────────────────────────────────────
function coinsForAccuracy(pct: number): { coins: number; tier: string } {
  if (pct >= 100) return { coins: 500, tier: 'perfect' };
  if (pct >= 90)  return { coins: 250, tier: 'gold_reward' };
  if (pct >= 80)  return { coins: 120, tier: 'silver_reward' };
  if (pct >= 70)  return { coins: 50,  tier: 'bronze_reward' };
  return { coins: 0, tier: 'none' };
}

// ─── Expert tier from overall rating ─────────────────────────────────────────
function tierFromRating(rating: number): string {
  if (rating >= 90) return 'elite';
  if (rating >= 80) return 'gold';
  if (rating >= 70) return 'silver';
  return 'bronze';
}

// ─── Compute overall rating ──────────────────────────────────────────────────
function computeOverallRating(
  accuracyPct: number,
  profitabilityScore: number,
  consistencyScore: number,
  supportScore: number,
  activityScore: number,
): number {
  return Math.min(100, Math.round(
    accuracyPct * 0.40 +
    profitabilityScore * 0.30 +
    consistencyScore * 0.15 +
    supportScore * 0.10 +
    activityScore * 0.05,
  ));
}

// ─── Pick result evaluator ────────────────────────────────────────────────────
/**
 * Determines won / lost / void for a tip given actual scores.
 * Returns "won", "lost", or "void" (void = unresolvable without extra data).
 */
function evaluatePick(
  tipType: string,
  tipValue: string,
  homeScore: number,
  awayScore: number,
): 'won' | 'lost' | 'void' {
  const total = homeScore + awayScore;

  switch (tipType) {
    // ── 1X2 / moneyline / match-winner ──────────────────────────────────────
    case '1x2':
    case 'moneyline':
    case 'match_winner': {
      if (tipValue === 'home_win' || tipValue === 'home') return homeScore > awayScore ? 'won' : 'lost';
      if (tipValue === 'away_win' || tipValue === 'away') return awayScore > homeScore ? 'won' : 'lost';
      if (tipValue === 'draw') return homeScore === awayScore ? 'won' : 'lost';
      return 'void';
    }

    // ── Double chance ────────────────────────────────────────────────────────
    case 'double_chance': {
      if (tipValue === 'home_or_draw') return homeScore >= awayScore ? 'won' : 'lost';
      if (tipValue === 'away_or_draw') return awayScore >= homeScore ? 'won' : 'lost';
      if (tipValue === 'home_or_away') return homeScore !== awayScore ? 'won' : 'lost';
      return 'void';
    }

    // ── Over / under ─────────────────────────────────────────────────────────
    case 'over_under':
    case 'total_runs':
    case 'total_goals':
    case 'total_points':
    case 'total_sets':
    case 'total_maps': {
      const line = 2.5;
      if (tipValue === 'over') return total > line ? 'won' : 'lost';
      if (tipValue === 'under') return total < line ? 'won' : 'lost';
      return 'void';
    }

    // ── BTTS ─────────────────────────────────────────────────────────────────
    case 'btts': {
      const bttsResult = homeScore > 0 && awayScore > 0;
      if (tipValue === 'yes') return bttsResult ? 'won' : 'lost';
      if (tipValue === 'no') return !bttsResult ? 'won' : 'lost';
      return 'void';
    }

    // ── Correct score ─────────────────────────────────────────────────────────
    case 'correct_score': {
      const parts = tipValue.split('-');
      if (parts.length === 2) {
        const h = parseInt(parts[0], 10);
        const a = parseInt(parts[1], 10);
        if (!isNaN(h) && !isNaN(a)) return homeScore === h && awayScore === a ? 'won' : 'lost';
      }
      return 'void';
    }

    // ── Handicap / spread ────────────────────────────────────────────────────
    case 'asian_handicap':
    case 'spread':
    case 'run_line':
    case 'puck_line': {
      if (tipValue === 'home') return homeScore >= awayScore ? 'won' : 'lost';
      if (tipValue === 'away') return awayScore >= homeScore ? 'won' : 'lost';
      return 'void';
    }

    // ── First goalscorer ──────────────────────────────────────────────────────
    case 'first_goalscorer': {
      if (tipValue === 'home_team') return homeScore > 0 ? 'won' : 'lost';
      if (tipValue === 'away_team') return awayScore > 0 && awayScore > homeScore ? 'won' : 'lost';
      if (tipValue === 'no_goalscorer') return total === 0 ? 'won' : 'lost';
      return 'void';
    }

    // ── Fighter / set / map winner ────────────────────────────────────────────
    case 'fight_winner':
    case 'map_winner':
    case 'set_winner': {
      const homeWin = ['home', 'home_win', 'player_1', 'team_1', 'fighter_1'];
      const awayWin = ['away', 'away_win', 'player_2', 'team_2', 'fighter_2'];
      if (homeWin.includes(tipValue)) return homeScore > awayScore ? 'won' : 'lost';
      if (awayWin.includes(tipValue)) return awayScore > homeScore ? 'won' : 'lost';
      return 'void';
    }

    // ── First-half result ──────────────────────────────────────────────────────
    case 'ht_result':
    case 'first_quarter':
    case 'first_period':
    case 'first_5_innings':
    case 'goes_distance':
    case 'method_of_victory':
    case 'toss_winner':
    case 'first_blood':
    case 'top_batsman':
    case 'first_try_scorer':
      // Cannot resolve these from final score alone
      return 'void';

    // ── Default: basic 1X2 ────────────────────────────────────────────────────
    default: {
      if (tipValue === 'home' || tipValue === 'home_win') return homeScore > awayScore ? 'won' : 'lost';
      if (tipValue === 'away' || tipValue === 'away_win') return awayScore > homeScore ? 'won' : 'lost';
      if (tipValue === 'draw') return homeScore === awayScore ? 'won' : 'lost';
      if (tipValue === 'over') return total > 2.5 ? 'won' : 'lost';
      if (tipValue === 'under') return total < 2.5 ? 'won' : 'lost';
      return 'void';
    }
  }
}

// ─── Settle daily: resolve pending picks against finished matches ─────────────
/**
 * For a given date (defaults to today):
 *  1. Fetch all finished matches
 *  2. Find pending expert_slip_picks that reference those matches
 *     (by match_id exact match, then fuzzy match_label fallback)
 *  3. Evaluate each pick (won / lost / void)
 *  4. Update pick rows
 *  5. For each slip whose picks are now all resolved, call settleSlip()
 */
async function settleDaily(
  supabase: ReturnType<typeof supabaseAdmin>,
  date?: string,
): Promise<{
  success: boolean;
  log: string[];
  picksSettled: number;
  slipsSettled: number;
  errors: number;
  date?: string;
  message?: string;
}> {
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const log: string[] = [];
  let picksSettled = 0;
  let slipsSettled = 0;
  let errors = 0;

  // ── 1. Fetch finished matches for target date ──────────────────────────────
  const { data: finishedMatches, error: matchErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, status, match_time, sport')
    .eq('status', 'finished')
    .gte('match_time', `${targetDate}T00:00:00Z`)
    .lte('match_time', `${targetDate}T23:59:59Z`);

  if (matchErr) {
    log.push(`[ERROR] Failed to fetch finished matches: ${matchErr.message}`);
    return { success: false, log, picksSettled: 0, slipsSettled: 0, errors: 1 };
  }

  log.push(`[INFO] ${finishedMatches?.length ?? 0} finished matches for ${targetDate}`);

  if (!finishedMatches || finishedMatches.length === 0) {
    return { success: true, log, picksSettled: 0, slipsSettled: 0, errors: 0, date: targetDate, message: 'No finished matches' };
  }

  // ── 2. Build match lookup maps ─────────────────────────────────────────────
  type FinishedMatch = { id: string; home_team: string; away_team: string; home_score: number; away_score: number };
  const matchById = new Map<string, FinishedMatch>();
  const matchByLabel = new Map<string, FinishedMatch>();

  for (const m of finishedMatches as FinishedMatch[]) {
    matchById.set(m.id, m);
    const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    // Canonical labels
    matchByLabel.set(norm(`${m.home_team} vs ${m.away_team}`), m);
    matchByLabel.set(norm(`${m.away_team} vs ${m.home_team}`), m);
    matchByLabel.set(norm(`${m.home_team} v ${m.away_team}`), m);
    matchByLabel.set(norm(`${m.away_team} v ${m.home_team}`), m);
    matchByLabel.set(norm(`${m.home_team} - ${m.away_team}`), m);
  }

  // ── 3. Fetch pending picks ─────────────────────────────────────────────────
  // Fetch picks where match_id is in our finished set OR match_id is null
  const matchIds = finishedMatches.map((m: any) => m.id);

  const { data: pendingPicksById, error: pickErr1 } = await supabase
    .from('expert_slip_picks')
    .select('id, slip_id, expert_id, match_id, match_label, tip_type, tip_value, odds, result')
    .eq('result', 'pending')
    .in('match_id', matchIds);

  const { data: pendingPicksNoId, error: pickErr2 } = await supabase
    .from('expert_slip_picks')
    .select('id, slip_id, expert_id, match_id, match_label, tip_type, tip_value, odds, result')
    .eq('result', 'pending')
    .is('match_id', null);

  if (pickErr1 || pickErr2) {
    log.push(`[ERROR] Pending picks query: ${pickErr1?.message ?? pickErr2?.message}`);
    return { success: false, log, picksSettled: 0, slipsSettled: 0, errors: 1 };
  }

  const allPending = [...(pendingPicksById ?? []), ...(pendingPicksNoId ?? [])];
  // Deduplicate by id
  const seenPick = new Set<string>();
  const pendingPicks = allPending.filter((p) => { if (seenPick.has(p.id)) return false; seenPick.add(p.id); return true; });

  log.push(`[INFO] ${pendingPicks.length} pending picks to evaluate`);

  if (pendingPicks.length === 0) {
    return { success: true, log, picksSettled: 0, slipsSettled: 0, errors: 0, date: targetDate, message: 'No pending picks' };
  }

  // ── 4. Match each pick → finished match, evaluate result ──────────────────
  const pickUpdates: Array<{
    id: string;
    result: 'won' | 'lost' | 'void';
    actual_outcome: string;
    home_score_actual: number;
    away_score_actual: number;
    settled_at: string;
  }> = [];
  const affectedSlipIds = new Set<string>();

  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

  for (const pick of pendingPicks) {
    // a) Exact match_id lookup
    let match: FinishedMatch | undefined = pick.match_id ? matchById.get(pick.match_id) : undefined;

    // b) Normalised label lookup
    if (!match && pick.match_label) {
      match = matchByLabel.get(norm(pick.match_label));
    }

    // c) Fuzzy: check if label contains both team names
    if (!match && pick.match_label) {
      const lbl = norm(pick.match_label);
      for (const [, m] of matchById) {
        const hNorm = norm(m.home_team);
        const aNorm = norm(m.away_team);
        if (lbl.includes(hNorm) && lbl.includes(aNorm)) {
          match = m;
          log.push(`[FUZZY] "${pick.match_label}" → ${m.home_team} vs ${m.away_team}`);
          break;
        }
      }
    }

    if (!match) {
      log.push(`[SKIP] Pick ${pick.id}: no finished match for "${pick.match_label ?? pick.match_id ?? 'unknown'}"`);
      continue;
    }

    const homeScore = match.home_score ?? 0;
    const awayScore = match.away_score ?? 0;
    const result = evaluatePick(pick.tip_type ?? '', pick.tip_value ?? '', homeScore, awayScore);
    const actualOutcome = `${homeScore}-${awayScore}`;

    pickUpdates.push({
      id: pick.id,
      result,
      actual_outcome: actualOutcome,
      home_score_actual: homeScore,
      away_score_actual: awayScore,
      settled_at: new Date().toISOString(),
    });
    affectedSlipIds.add(pick.slip_id);
    picksSettled++;

    log.push(`[PICK] ${pick.match_label ?? `${match.home_team} v ${match.away_team}`} | ${pick.tip_type}:${pick.tip_value} → ${result} (${actualOutcome})`);
  }

  // ── 5. Batch-update pick rows ──────────────────────────────────────────────
  for (const update of pickUpdates) {
    const { error: upErr } = await supabase
      .from('expert_slip_picks')
      .update({
        result: update.result,
        actual_outcome: update.actual_outcome,
        home_score_actual: update.home_score_actual,
        away_score_actual: update.away_score_actual,
        settled_at: update.settled_at,
      })
      .eq('id', update.id);
    if (upErr) {
      errors++;
      log.push(`[ERROR] Pick ${update.id} update: ${upErr.message}`);
    }
  }

  log.push(`[INFO] Updated ${pickUpdates.length - errors} picks`);

  // ── 6. Settle fully-resolved slips ────────────────────────────────────────
  for (const slipId of affectedSlipIds) {
    try {
      const { count: stillPending } = await supabase
        .from('expert_slip_picks')
        .select('id', { count: 'exact', head: true })
        .eq('slip_id', slipId)
        .eq('result', 'pending');

      if ((stillPending ?? 1) > 0) {
        log.push(`[SLIP] ${slipId}: ${stillPending} picks still pending — skipping`);
        continue;
      }

      const slipResult = await settleSlip(supabase, slipId);
      if (slipResult.success) {
        slipsSettled++;
        log.push(`[SLIP] ${slipId} settled → acc:${slipResult.accuracy_pct?.toFixed(1)}% coins:${slipResult.coins_awarded}`);
      } else {
        log.push(`[SLIP] ${slipId} settle failed: ${slipResult.reason}`);
      }
    } catch (e) {
      errors++;
      log.push(`[ERROR] Slip ${slipId}: ${String(e)}`);
    }
  }

  log.push(`[DONE] date=${targetDate} picks=${picksSettled} slips=${slipsSettled} errors=${errors}`);
  return { success: true, log, picksSettled, slipsSettled, errors, date: targetDate };
}

// ─── Check promotion eligibility ─────────────────────────────────────────────
async function checkPromotion(supabase: ReturnType<typeof supabaseAdmin>, userId: string) {
  const { data: vip } = await supabase
    .from('vip_subscriptions')
    .select('id, status, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!vip) return { eligible: false, reason: 'Not an active VIP subscriber' };

  const { data: existing } = await supabase
    .from('expert_profiles')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing?.status === 'active') return { eligible: false, reason: 'Already an active expert' };

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const { data: challengeResults } = await supabase
    .from('challenge_results')
    .select('date, correct_count, total_picks, is_perfect')
    .eq('user_id', userId)
    .gte('date', threeDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: false })
    .limit(3);

  if (!challengeResults || challengeResults.length < 3) {
    return { eligible: false, reason: `Only ${challengeResults?.length ?? 0} of 3 required consecutive days found` };
  }

  const allPerfect = challengeResults.every(r => r.is_perfect === true);
  if (!allPerfect) {
    const imperfect = challengeResults.filter(r => !r.is_perfect).length;
    return { eligible: false, reason: `${imperfect} of the last 3 days were not 100% accurate` };
  }

  const dates = challengeResults.map(r => r.date).sort();
  const isConsecutive = dates.every((d, i) => {
    if (i === 0) return true;
    const diff = (new Date(d).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
    return diff === 1;
  });
  if (!isConsecutive) return { eligible: false, reason: '3 perfect days must be consecutive' };

  return { eligible: true, reason: null };
}

// ─── Promote user to expert ───────────────────────────────────────────────────
async function promoteToExpert(supabase: ReturnType<typeof supabaseAdmin>, userId: string) {
  const eligibility = await checkPromotion(supabase, userId);
  if (!eligibility.eligible) return { success: false, ...eligibility };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username, email, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  const username = profile?.username ?? `expert_${userId.slice(0, 6)}`;

  const { data: expertProfile, error } = await supabase
    .from('expert_profiles')
    .upsert({
      user_id: userId,
      username,
      avatar_url: profile?.avatar_url ?? null,
      status: 'active',
      tier: 'bronze',
      promoted_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .maybeSingle();

  if (error) return { success: false, reason: error.message };

  await supabase.from('admin_roles').upsert({
    user_id: userId,
    role: 'expert',
    permissions: { broadcast: false, manage_tips: true, manage_users: false, manage_matches: false },
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  await sendPushNotification(supabase, userId,
    'Expert Tipster Status Achieved! 🏆',
    'Congratulations! You have been promoted to Expert Tipster. Start submitting prediction slips!',
    { screen: 'expert-slips' },
  );

  await creditCoins(supabase, userId, 200, 'expert_promotion_bonus');

  return { success: true, expert_id: expertProfile?.id, username };
}

// ─── Credit coins helper ──────────────────────────────────────────────────────
async function creditCoins(
  supabase: ReturnType<typeof supabaseAdmin>,
  userId: string,
  coins: number,
  claimType: string,
  referenceId?: string,
) {
  if (coins <= 0) return;

  const { data: existing } = await supabase
    .from('user_coins')
    .select('id, balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase.from('user_coins')
      .update({ balance: (existing.balance ?? 0) + coins, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabase.from('user_coins').insert({ user_id: userId, balance: coins });
  }

  await supabase.from('coin_claims').insert({
    user_id: userId,
    claim_type: claimType,
    reference_id: referenceId ?? null,
    coins_awarded: coins,
    claimed_at: new Date().toISOString(),
  });
}

// ─── Send push notification ───────────────────────────────────────────────────
async function sendPushNotification(
  supabase: ReturnType<typeof supabaseAdmin>,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
) {
  try {
    await supabase.functions.invoke('send-push', { body: { user_id: userId, title, body, data } });
    await supabase.from('notifications').insert({ user_id: userId, title, body, type: 'expert', read: false });
  } catch { /* non-blocking */ }
}

// ─── Daily review ─────────────────────────────────────────────────────────────
async function dailyReview(supabase: ReturnType<typeof supabaseAdmin>) {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: experts } = await supabase
    .from('expert_profiles')
    .select('id, user_id, username, consecutive_below_threshold, accuracy_pct, overall_rating')
    .eq('status', 'active');

  if (!experts || experts.length === 0) return { reviewed: 0, demotions: 0 };

  let demotions = 0;

  for (const expert of experts) {
    const { data: yesterdaySlips } = await supabase
      .from('expert_slips')
      .select('total_picks, correct_picks, accuracy_pct')
      .eq('expert_id', expert.id)
      .eq('slip_date', yesterday)
      .eq('status', 'settled');

    if (!yesterdaySlips || yesterdaySlips.length === 0) continue;

    const totalPicks = yesterdaySlips.reduce((s, sl) => s + (sl.total_picks ?? 0), 0);
    const correctPicks = yesterdaySlips.reduce((s, sl) => s + (sl.correct_picks ?? 0), 0);
    const dailyAccuracy = totalPicks > 0 ? (correctPicks / totalPicks) * 100 : 0;
    const belowThreshold = dailyAccuracy < 70;

    await supabase.from('expert_daily_stats').upsert({
      expert_id: expert.id,
      stat_date: yesterday,
      slips_submitted: yesterdaySlips.length,
      total_picks: totalPicks,
      correct_picks: correctPicks,
      accuracy_pct: Math.round(dailyAccuracy * 100) / 100,
      below_threshold: belowThreshold,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'expert_id,stat_date' });

    if (belowThreshold) {
      const newConsecutive = (expert.consecutive_below_threshold ?? 0) + 1;

      await supabase.from('expert_profiles').update({
        consecutive_below_threshold: newConsecutive,
        last_warning_date: yesterday,
        updated_at: new Date().toISOString(),
      }).eq('id', expert.id);

      await supabase.from('expert_warnings').insert({
        expert_id: expert.id,
        user_id: expert.user_id,
        warning_date: yesterday,
        accuracy_pct: Math.round(dailyAccuracy * 100) / 100,
        reason: `Daily accuracy ${dailyAccuracy.toFixed(1)}% below 70% threshold`,
        consecutive_days: newConsecutive,
        status: 'active',
      });

      if (newConsecutive >= 3) {
        await supabase.from('expert_profiles').update({
          status: 'removed',
          consecutive_below_threshold: 0,
          updated_at: new Date().toISOString(),
        }).eq('id', expert.id);

        await supabase.from('admin_roles').update({
          permissions: { broadcast: false, manage_tips: false, manage_users: false, manage_matches: false },
          is_active: false,
          updated_at: new Date().toISOString(),
        }).eq('user_id', expert.user_id);

        await sendPushNotification(supabase, expert.user_id,
          'Expert Status Removed',
          'Your Expert Tipster status has been removed after 3 consecutive days below 70% accuracy. You remain a VIP member.',
          { screen: 'profile' },
        );
        demotions++;
      } else {
        await sendPushNotification(supabase, expert.user_id,
          `Performance Warning — Day ${newConsecutive}/3`,
          `Your accuracy yesterday was ${dailyAccuracy.toFixed(1)}%. Maintain 70%+ to keep Expert status. ${3 - newConsecutive} warning(s) remaining.`,
          { screen: 'expert-slips' },
        );
      }
    } else {
      await supabase.from('expert_profiles').update({
        consecutive_below_threshold: 0,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', expert.id);
    }
  }

  return { reviewed: experts.length, demotions, date: yesterday };
}

// ─── Settle a slip ────────────────────────────────────────────────────────────
async function settleSlip(supabase: ReturnType<typeof supabaseAdmin>, slipId: string) {
  const { data: slip } = await supabase
    .from('expert_slips')
    .select('*, expert_profiles!expert_slips_expert_id_fkey(user_id, username)')
    .eq('id', slipId)
    .maybeSingle();

  if (!slip) return { success: false, reason: 'Slip not found' };
  if (slip.status === 'settled') return { success: false, reason: 'Already settled' };

  const { data: picks } = await supabase
    .from('expert_slip_picks')
    .select('*')
    .eq('slip_id', slipId);

  if (!picks || picks.length === 0) return { success: false, reason: 'No picks found' };

  const pendingPicks = picks.filter(p => p.result === 'pending' || !p.result);
  if (pendingPicks.length > 0) {
    return { success: false, reason: `${pendingPicks.length} picks still pending` };
  }

  const totalPicks = picks.length;
  const correctPicks = picks.filter(p => p.result === 'won').length;
  const accuracyPct = totalPicks > 0 ? (correctPicks / totalPicks) * 100 : 0;

  const totalOdds = picks.reduce((s, p) => s * (p.odds ?? 1), 1);
  const winningOdds = picks.filter(p => p.result === 'won').reduce((s, p) => s * (p.odds ?? 1), 1);
  const profitabilityPct = totalOdds > 0 ? (winningOdds / totalOdds) * 100 : 0;

  const { coins, tier } = coinsForAccuracy(accuracyPct);

  await supabase.from('expert_slips').update({
    status: 'settled',
    correct_picks: correctPicks,
    accuracy_pct: Math.round(accuracyPct * 100) / 100,
    total_odds: totalOdds,
    winning_odds: winningOdds,
    profitability_pct: Math.round(profitabilityPct * 100) / 100,
    coins_awarded: coins,
    reward_status: coins > 0 ? 'credited' : 'ineligible',
    settled_at: new Date().toISOString(),
  }).eq('id', slipId);

  if (coins > 0) {
    const userId = slip.expert_profiles?.user_id ?? slip.user_id;
    await creditCoins(supabase, userId, coins, 'expert_slip_reward', slipId);

    await supabase.from('expert_rewards_ledger').insert({
      expert_id: slip.expert_id,
      user_id: userId,
      slip_id: slipId,
      ledger_date: slip.slip_date,
      accuracy_pct: Math.round(accuracyPct * 100) / 100,
      profitability_score: Math.round(profitabilityPct * 100) / 100,
      slip_count: 1,
      prediction_count: totalPicks,
      correct_count: correctPicks,
      coins_awarded: coins,
      reward_tier: tier,
      transaction_ref: `slip-${slipId}-${Date.now()}`,
      status: 'credited',
    });

    await sendPushNotification(supabase, userId,
      `Slip Settled — ${coins} Coins Earned! 🪙`,
      `Your slip achieved ${accuracyPct.toFixed(1)}% accuracy. ${coins} coins have been added to your wallet.`,
      { screen: 'coin-history' },
    );
  }

  await recalculateExpertStats(supabase, slip.expert_id);

  return { success: true, accuracy_pct: accuracyPct, coins_awarded: coins, tier };
}

// ─── Recalculate expert profile stats ────────────────────────────────────────
async function recalculateExpertStats(supabase: ReturnType<typeof supabaseAdmin>, expertId: string) {
  const { data: allSlips } = await supabase
    .from('expert_slips')
    .select('total_picks, correct_picks, total_odds, winning_odds, accuracy_pct, status')
    .eq('expert_id', expertId)
    .eq('status', 'settled');

  if (!allSlips || allSlips.length === 0) return;

  const totalPreds = allSlips.reduce((s, sl) => s + (sl.total_picks ?? 0), 0);
  const correctPreds = allSlips.reduce((s, sl) => s + (sl.correct_picks ?? 0), 0);
  const accuracyPct = totalPreds > 0 ? (correctPreds / totalPreds) * 100 : 0;
  const totalOddsSum = allSlips.reduce((s, sl) => s + (sl.total_odds ?? 0), 0);
  const winOddsSum = allSlips.reduce((s, sl) => s + (sl.winning_odds ?? 0), 0);
  const profitabilityScore = totalOddsSum > 0 ? (winOddsSum / totalOddsSum) * 100 : 0;
  const avgOdds = allSlips.length > 0 ? totalOddsSum / allSlips.length : 0;
  const roiPct = totalOddsSum > 0 ? ((winOddsSum - totalOddsSum) / totalOddsSum) * 100 : 0;
  const winningSlips = allSlips.filter(sl => (sl.accuracy_pct ?? 0) >= 70).length;

  const { data: dailyStats } = await supabase.from('expert_daily_stats').select('accuracy_pct').eq('expert_id', expertId);
  const goodDays = (dailyStats ?? []).filter(d => d.accuracy_pct >= 70).length;
  const consistencyScore = dailyStats && dailyStats.length > 0 ? (goodDays / dailyStats.length) * 100 : 70;

  const activityScore = Math.min(100, allSlips.length * 3);

  const { count: followersCount } = await supabase
    .from('expert_followers').select('id', { count: 'exact', head: true }).eq('expert_id', expertId);
  const supportScore = Math.min(100, (followersCount ?? 0) * 2);

  const { data: coinData } = await supabase.from('expert_rewards_ledger').select('coins_awarded').eq('expert_id', expertId);
  const totalCoins = (coinData ?? []).reduce((s, r) => s + (r.coins_awarded ?? 0), 0);

  const overallRating = computeOverallRating(
    Math.min(100, accuracyPct), Math.min(100, profitabilityScore),
    Math.min(100, consistencyScore), Math.min(100, supportScore), Math.min(100, activityScore),
  );

  const { data: recentDaily } = await supabase.from('expert_daily_stats')
    .select('stat_date, accuracy_pct').eq('expert_id', expertId)
    .order('stat_date', { ascending: false }).limit(60);

  let currentStreak = 0;
  for (const d of (recentDaily ?? [])) {
    if (d.accuracy_pct >= 70) currentStreak++;
    else break;
  }

  await supabase.from('expert_profiles').update({
    total_predictions: totalPreds,
    correct_predictions: correctPreds,
    accuracy_pct: Math.round(accuracyPct * 100) / 100,
    profitability_score: Math.round(profitabilityScore * 100) / 100,
    avg_odds: Math.round(avgOdds * 100) / 100,
    roi_pct: Math.round(roiPct * 100) / 100,
    total_slips: allSlips.length,
    winning_slips: winningSlips,
    accuracy_score: Math.round(Math.min(100, accuracyPct) * 100) / 100,
    profitability_rating: Math.round(Math.min(100, profitabilityScore) * 100) / 100,
    consistency_score: Math.round(Math.min(100, consistencyScore) * 100) / 100,
    support_score: Math.round(Math.min(100, supportScore) * 100) / 100,
    activity_score: Math.round(Math.min(100, activityScore) * 100) / 100,
    overall_rating: overallRating,
    tier: tierFromRating(overallRating),
    followers_count: followersCount ?? 0,
    total_coins_earned: totalCoins,
    current_streak: currentStreak,
    best_streak: Math.max(currentStreak, 0),
    updated_at: new Date().toISOString(),
  }).eq('id', expertId);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
// ─── Internal-only function ─────────────────────────────────────────────────
// expert-promotion is an INTERNAL function. It is only callable by:
//   1. pg_cron via invoke_edge_function (service-role Authorization + X-Job-Name)
//   2. Admin users with server-verified admin_roles entry
// Anonymous users and ordinary authenticated users are BLOCKED.

import { requireInternalToken, requireAdmin, logSecurityEvent } from '../_shared/authGuard.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Authorization gate: internal cron or admin only ──────────────────────
  const jobName = req.headers.get('X-Job-Name');
  let authorizedAs: 'internal' | 'admin' | null = null;
  let callerUserId: string | null = null;

  // Try internal token first (cron jobs)
  const { isInternal } = await requireInternalToken(req, 'expert-promotion');
  if (isInternal) {
    authorizedAs = 'internal';
  } else {
    // Try admin JWT
    const { auth, isAdmin, errorResponse: adminErr } = await requireAdmin(req);
    if (!adminErr && isAdmin) {
      authorizedAs = 'admin';
      callerUserId = auth?.userId ?? null;
    } else {
      // Block unauthorized access
      await logSecurityEvent(
        null, 'expert_promotion_unauthorized', 'blocked',
        { path: req.url, method: req.method, job_name: jobName },
        'high',
      );
      return new Response(
        JSON.stringify({ error: 'Unauthorized. This is an internal function.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  }

  const supabase = supabaseAdmin();

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'check_promotion') {
      const result = await checkPromotion(supabase, body.user_id);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'promote') {
      const result = await promoteToExpert(supabase, body.user_id);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'daily_review') {
      const result = await dailyReview(supabase);
      return new Response(JSON.stringify({ success: true, ...result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'settle_slip') {
      const result = await settleSlip(supabase, body.slip_id);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'settle_daily') {
      const result = await settleDaily(supabase, body.date);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'recalculate') {
      await recalculateExpertStats(supabase, body.expert_id);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await logSecurityEvent(
      callerUserId, `expert_promotion_action_${action}`, 'success',
      { action, authorized_as: authorizedAs }, 'low',
    );
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Supported: check_promotion, promote, daily_review, settle_slip, settle_daily, recalculate` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[expert-promotion] Unhandled error:', errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
