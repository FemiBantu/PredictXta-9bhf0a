/**
 * generate-daily-challenge/index.ts
 *
 * Edge Function: Daily Challenge Generator & Settler
 *
 * Endpoints:
 *   POST /generate-daily-challenge { action: 'generate', date?: string }
 *   POST /generate-daily-challenge { action: 'settle', date?: string }
 *   POST /generate-daily-challenge { action: 'status' }
 *
 * Designed to be called by:
 *  1. A Cloudflare Worker cron at 00:01 UTC daily (generate)
 *  2. A Cloudflare Worker cron every 30 min (settle finished matches)
 *  3. Admin panel manually
 *
 * Generation strategy:
 *  - Queries today's fixtures from the `matches` table across ALL sports
 *  - Scores them by AI confidence (difficulty banding)
 *  - Selects 3 diverse matches: 1 upset, 1 competitive, 1 favourite
 *  - Persists to `daily_challenges` table
 *  - Falls back to next 48h fixtures if today has none
 *
 * Settlement strategy:
 *  - Finds all challenge_picks for `date` with no `settled_at`
 *  - For each finished match, determines outcome (sport-aware)
 *  - Updates pick records + challenge_results + awards coins
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Sport outcome resolver ────────────────────────────────────────────────────
function determineOutcome(sport: string, homeScore: number, awayScore: number): string | null {
  const sp = (sport ?? '').toLowerCase();
  const noDrawSports = ['tennis', 'basketball', 'mma', 'ufc', 'baseball', 'volleyball', 'american football', 'american_football', 'american-football', 'nfl', 'nba', 'afl', 'australian football', 'australian_football'];

  if (homeScore > awayScore) return 'home_win';
  if (awayScore > homeScore) return 'away_win';

  // Equal scores
  if (noDrawSports.some((s) => sp.includes(s))) return null; // still in play / OT
  return 'draw';
}

// ─── Difficulty banding ───────────────────────────────────────────────────────
function getDifficultyBand(conf: number): string {
  if (conf < 55) return 'upset';
  if (conf < 75) return 'competitive';
  return 'favourite';
}

// ─── Diverse match selection ──────────────────────────────────────────────────
function selectDiverse(pool: any[], count = 3): any[] {
  const upsets      = pool.filter((m) => m.difficultyBand === 'upset');
  const competitive = pool.filter((m) => m.difficultyBand === 'competitive');
  const favourites  = pool.filter((m) => m.difficultyBand === 'favourite');

  const selected: any[] = [];
  const usedIds = new Set<string>();

  const tryAdd = (list: any[]) => {
    for (const m of list) {
      if (!usedIds.has(m.id) && selected.length < count) { selected.push(m); usedIds.add(m.id); return; }
    }
  };

  tryAdd(upsets); tryAdd(competitive); tryAdd(favourites);

  for (const m of [...upsets, ...competitive, ...favourites]) {
    if (selected.length >= count) break;
    if (!usedIds.has(m.id)) { selected.push(m); usedIds.add(m.id); }
  }
  return selected.slice(0, count);
}

// ─── Week key helper ──────────────────────────────────────────────────────────
function getWeekKey(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? 'generate';
    const today = new Date().toISOString().slice(0, 10);
    const targetDate: string = body.date ?? today;

    // ── ACTION: status ──────────────────────────────────────────────────────
    if (action === 'status') {
      const { data: challenge } = await supabase
        .from('daily_challenges')
        .select('*')
        .eq('challenge_date', targetDate)
        .maybeSingle();

      const { count: totalPicks } = await supabase
        .from('challenge_picks')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_date', targetDate);

      const { count: settledPicks } = await supabase
        .from('challenge_picks')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_date', targetDate)
        .not('settled_at', 'is', null);

      const { count: correctPicks } = await supabase
        .from('challenge_picks')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_date', targetDate)
        .eq('is_correct', true);

      return new Response(JSON.stringify({
        date: targetDate,
        challenge: challenge ?? null,
        picks: { total: totalPicks ?? 0, settled: settledPicks ?? 0, correct: correctPicks ?? 0 },
        generated: !!challenge,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── ACTION: generate ────────────────────────────────────────────────────
    if (action === 'generate') {
      // Check if already generated for this date
      const { data: existing } = await supabase
        .from('daily_challenges')
        .select('id, match_ids')
        .eq('challenge_date', targetDate)
        .eq('status', 'active')
        .maybeSingle();

      if (existing && !body.force) {
        return new Response(JSON.stringify({ success: true, skipped: true, message: 'Challenge already generated', date: targetDate }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch today's fixtures
      const dateStart = new Date(targetDate); dateStart.setHours(0, 0, 0, 0);
      const dateEnd   = new Date(targetDate); dateEnd.setHours(23, 59, 59, 999);

      let { data: fixtures } = await supabase
        .from('matches')
        .select('id, sport, home_team, away_team, home_logo, away_logo, league, match_time, status, home_score, away_score, minute')
        .in('status', ['upcoming', 'live'])
        .gte('match_time', dateStart.toISOString())
        .lte('match_time', dateEnd.toISOString())
        .not('home_team', 'is', null)
        .not('away_team', 'is', null)
        .order('match_time', { ascending: true })
        .limit(200);

      // Fall back to next 48h if today is sparse
      if (!fixtures || fixtures.length < 3) {
        const extEnd = new Date(targetDate); extEnd.setDate(extEnd.getDate() + 2);
        const { data: ext } = await supabase
          .from('matches')
          .select('id, sport, home_team, away_team, home_logo, away_logo, league, match_time, status, home_score, away_score, minute')
          .in('status', ['upcoming', 'live'])
          .gte('match_time', dateStart.toISOString())
          .lte('match_time', extEnd.toISOString())
          .not('home_team', 'is', null)
          .not('away_team', 'is', null)
          .order('match_time', { ascending: true })
          .limit(200);
        fixtures = ext ?? [];
      }

      const validFixtures = (fixtures ?? []).filter(
        (r: any) => r.home_team?.trim() && r.away_team?.trim(),
      );

      if (validFixtures.length < 3) {
        return new Response(JSON.stringify({
          success: false,
          error: `Only ${validFixtures.length} valid fixtures found for ${targetDate}`,
          availableSports: [...new Set(validFixtures.map((f: any) => f.sport))],
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Get AI confidence for fixtures
      const matchIds = validFixtures.map((f: any) => f.id);
      const { data: predictions } = await supabase
        .from('predictions')
        .select('match_id, confidence')
        .in('match_id', matchIds);

      const confMap: Record<string, number> = {};
      (predictions ?? []).forEach((p: any) => {
        if (!confMap[p.match_id] || p.confidence > confMap[p.match_id]) confMap[p.match_id] = p.confidence;
      });

      // Build scored pool
      const scoredPool = validFixtures.map((f: any) => {
        const conf = confMap[f.id] ?? 55;
        return {
          id: f.id,
          sport: f.sport ?? 'football',
          homeTeam: f.home_team,
          awayTeam: f.away_team,
          homeLogo: f.home_logo ?? null,
          awayLogo: f.away_logo ?? null,
          league: f.league ?? '',
          matchTime: f.match_time,
          status: f.status,
          homeScore: f.home_score ?? 0,
          awayScore: f.away_score ?? 0,
          minute: f.minute ?? 0,
          difficultyBand: getDifficultyBand(conf),
          difficultyScore: 100 - conf,
          aiConfidence: conf,
        };
      });

      const selected = selectDiverse(scoredPool, 3);

      // Persist challenge
      const { error: upsertError } = await supabase
        .from('daily_challenges')
        .upsert({
          challenge_date: targetDate,
          week_key: getWeekKey(),
          sport: 'all',
          match_ids: selected.map((m) => m.id),
          match_data: selected,
          generated_at: new Date().toISOString(),
          status: 'active',
        }, { onConflict: 'challenge_date' });

      if (upsertError) throw upsertError;

      console.log(`[generate-daily-challenge] Generated ${selected.length} matches for ${targetDate}:`, selected.map((m) => `${m.homeTeam} vs ${m.awayTeam} (${m.sport})`).join(', '));

      return new Response(JSON.stringify({
        success: true,
        date: targetDate,
        matchCount: selected.length,
        sports: selected.map((m) => m.sport),
        matches: selected.map((m) => ({ id: m.id, label: `${m.homeTeam} vs ${m.awayTeam}`, sport: m.sport, band: m.difficultyBand })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── ACTION: settle ──────────────────────────────────────────────────────
    if (action === 'settle') {
      // Find all unsettled picks for the date
      const { data: unsettledPicks } = await supabase
        .from('challenge_picks')
        .select('id, user_id, match_id, prediction, challenge_date')
        .eq('challenge_date', targetDate)
        .is('settled_at', null);

      if (!unsettledPicks || unsettledPicks.length === 0) {
        return new Response(JSON.stringify({ success: true, settled: 0, message: 'No unsettled picks' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get unique match IDs
      const uniqueMatchIds = [...new Set((unsettledPicks as any[]).map((p: any) => p.match_id))];

      // Fetch finished match results
      const { data: matchResults } = await supabase
        .from('matches')
        .select('id, sport, status, home_score, away_score')
        .in('id', uniqueMatchIds)
        .eq('status', 'finished');

      if (!matchResults || matchResults.length === 0) {
        return new Response(JSON.stringify({ success: true, settled: 0, message: 'No finished matches yet' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resultMap: Record<string, any> = {};
      (matchResults as any[]).forEach((r: any) => { resultMap[r.id] = r; });

      let settledCount = 0;
      const settledByUser: Record<string, { correct: number; total: number; perfect: boolean }> = {};

      for (const pick of unsettledPicks as any[]) {
        const matchResult = resultMap[pick.match_id];
        if (!matchResult) continue; // not finished yet

        const actual = determineOutcome(matchResult.sport, matchResult.home_score ?? 0, matchResult.away_score ?? 0);
        if (actual === null) continue; // OT / shootout still in progress

        const isCorrect = pick.prediction === actual;

        // Update pick
        await supabase
          .from('challenge_picks')
          .update({
            actual_result: actual,
            is_correct: isCorrect,
            home_score_actual: matchResult.home_score ?? 0,
            away_score_actual: matchResult.away_score ?? 0,
            settled_at: new Date().toISOString(),
          })
          .eq('id', pick.id);

        settledCount++;

        if (!settledByUser[pick.user_id]) settledByUser[pick.user_id] = { correct: 0, total: 0, perfect: false };
        settledByUser[pick.user_id].total++;
        if (isCorrect) settledByUser[pick.user_id].correct++;
      }

      // For each user with all 3 picks settled, update challenge_results + award coins
      for (const [userId, stats] of Object.entries(settledByUser)) {
        // Check if all 3 picks are now settled for this user/date
        const { count: totalSettled } = await supabase
          .from('challenge_picks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('challenge_date', targetDate)
          .not('settled_at', 'is', null);

        const { count: totalPicks } = await supabase
          .from('challenge_picks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('challenge_date', targetDate);

        if ((totalSettled ?? 0) < (totalPicks ?? 3)) continue; // not all settled yet

        // Count total correct for the day
        const { count: totalCorrect } = await supabase
          .from('challenge_picks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('challenge_date', targetDate)
          .eq('is_correct', true);

        const correct = totalCorrect ?? 0;
        const isPerfect = correct === 3;

        // Get username
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('username, email')
          .eq('id', userId)
          .maybeSingle();
        const username = (profile as any)?.username ?? (profile as any)?.email?.split('@')[0] ?? 'Anonymous';

        // Upsert challenge_results
        await supabase
          .from('challenge_results')
          .upsert({
            user_id: userId,
            username,
            date: targetDate,
            week_key: getWeekKey(),
            correct_count: correct,
            total_picks: 3,
            is_perfect: isPerfect,
          }, { onConflict: 'user_id,date' });

        // Award coins
        const coins = isPerfect ? 25 : correct > 0 ? 10 : 0;
        if (coins > 0) {
          await supabase.rpc('add_user_coins', { p_user_id: userId, p_amount: coins });
          await supabase.from('coin_claims').upsert({
            user_id: userId,
            claim_type: 'challenge_result',
            reference_id: `${targetDate}-${userId}`,
            coins_awarded: coins,
          }, { onConflict: 'user_id,reference_id' }).catch(() => {});
        }

        // Send notification
        const notifBody = isPerfect
          ? `Perfect! All 3/3 correct. +${coins} coins awarded! 🪙`
          : correct > 0
          ? `You scored ${correct}/3 today. +${coins} coins! 🪙`
          : 'You scored 0/3. Better luck tomorrow!';

        await supabase.from('notifications').insert({
          user_id: userId,
          type: 'challenge',
          title: '🏆 Challenge Results',
          body: notifBody,
          read: false,
        }).catch(() => {});

        console.log(`[settle] User ${userId}: ${correct}/3 correct, ${coins} coins awarded`);
      }

      return new Response(JSON.stringify({ success: true, settled: settledCount, users: Object.keys(settledByUser).length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[generate-daily-challenge] Error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
