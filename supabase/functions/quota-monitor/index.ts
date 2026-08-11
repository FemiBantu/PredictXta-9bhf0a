/**
 * quota-monitor — API Quota Monitoring & Budget Management
 *
 * Tracks daily API usage across all providers.
 * Prevents quota exhaustion by dynamically adjusting refresh intervals.
 *
 * Target: Maximum 7,000 API requests per day (API-Football / API-Sports shared key).
 *
 * Supported sports: 13 total (10 on API-Sports, 3 on TheSportsDB free tier)
 *   API-Sports (quota-consuming):
 *     football, basketball, hockey, handball, volleyball,
 *     rugby, baseball, american-football, mma, afl
 *   TheSportsDB (free tier — no API-Sports quota):
 *     tennis, cricket, formula1
 *
 * Budget allocation (recalculated for 13 sports — v2.0):
 *   Football Live    (288 runs/day):    600  (8.6%)   was 2,000
 *   Basketball Live  (288 runs/day):    300  (4.3%)   was 1,000
 *   Hockey Live      (288 runs/day):    300  (4.3%)   new line
 *   Rugby Live       (288 runs/day):    300  (4.3%)   new line
 *   Handball Live    (288 runs/day):    300  (4.3%)   new line
 *   Volleyball Live  (288 runs/day):    300  (4.3%)   new line
 *   Baseball Live    (288 runs/day):    300  (4.3%)   new line
 *   Amer.Football Live (288 runs/day):  300  (4.3%)   new line
 *   MMA Live         (288 runs/day):    300  (4.3%)   was in other
 *   AFL Live         (288 runs/day):    300  (4.3%)   new line
 *   Tennis/Cricket/F1 (TSDB — free):      0  (0.0%)   was 1,100
 *   Fixture fetches  (2× daily):        500  (7.1%)   was 900
 *   Odds (football leagues):            100  (1.4%)   was included
 *   Standings (weekly avg):             100  (1.4%)   was 300
 *   Emergency Buffer:                 3,900 (55.7%)   was 300
 *   ─────────────────────────────────────────────────
 *   EXPECTED daily usage:             ~3,100          was ~6,700
 *   Available headroom:               ~3,900          was ~300
 *
 * Alert thresholds (adjusted for 13-sport normal usage ~3,100/day):
 *   > 60% (~4,200): CAUTION  — unexpected extra calls, investigate
 *   > 75% (~5,250): WARNING  — auto-increase refresh intervals
 *   > 90% (~6,300): CRITICAL — emergency mode, suspend non-critical syncs
 *
 * POST body: { action: 'report' | 'check' | 'reset-emergency' }
 * GET: returns current quota report
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOTAL_DAILY_BUDGET = 7000;

// Expected daily usage for 13 sports (10 API-Sports + 3 TSDB).
// Calculated as: 10 sports × 288 sync-live runs + ~220 fixture/odds/standings calls.
// This is used to compute a "normal usage" health band distinct from the hard quota limit.
const EXPECTED_DAILY_USAGE = 3100;

// Per-sport daily quota allocations (API-Sports quota-consuming sports only)
const SPORT_QUOTAS: Record<string, number> = {
  football:            600,  // highest — most live matches globally
  basketball:          300,
  hockey:              300,
  rugby:               300,
  handball:            300,
  volleyball:          300,
  baseball:            300,
  'american-football': 300,
  mma:                 300,
  afl:                 300,
  // tennis, cricket, formula1 use TSDB (free) — not counted here
  fixtures:            500,  // morning + evening preloads
  odds:                100,  // football leagues only
  standings:           100,  // weekly, all sports
};

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = adminClient();

  try {
    let action = 'report';
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        action = body?.action ?? 'report';
      } catch { /* defaults */ }
    }

    if (action === 'report' || req.method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const currentHour = new Date().getUTCHours();

      // Get today's usage grouped by provider
      const { data: usageRows } = await supabase
        .from('api_usage')
        .select('provider_name, endpoint, request_count, success_count, error_count, last_called, last_error, avg_response_ms')
        .eq('date', today);

      const rows = usageRows ?? [];
      const totalUsed = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.request_count ?? 0), 0);
      const totalSuccess = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.success_count ?? 0), 0);
      const totalErrors = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.error_count ?? 0), 0);
      const remaining = Math.max(0, TOTAL_DAILY_BUDGET - totalUsed);
      const usagePct = Math.round((totalUsed / TOTAL_DAILY_BUDGET) * 100);

      // By provider breakdown
      const byProvider: Record<string, { requests: number; errors: number; lastCalled: string | null }> = {};
      for (const r of rows) {
        const p = String(r.provider_name ?? 'unknown');
        if (!byProvider[p]) byProvider[p] = { requests: 0, errors: 0, lastCalled: null };
        byProvider[p].requests += Number(r.request_count ?? 0);
        byProvider[p].errors += Number(r.error_count ?? 0);
        const lc = r.last_called ? String(r.last_called) : null;
        if (lc && (!byProvider[p].lastCalled || lc > byProvider[p].lastCalled!)) {
          byProvider[p].lastCalled = lc;
        }
      }

      // Hourly projection
      const hourlyRate = currentHour > 0 ? Math.round(totalUsed / currentHour) : 0;
      const projectedDayTotal = hourlyRate * 24;
      const willExceedBudget = projectedDayTotal > TOTAL_DAILY_BUDGET;
      const projectedExhaustionHour = willExceedBudget
        ? Math.round(TOTAL_DAILY_BUDGET / Math.max(1, hourlyRate))
        : null;

      // Dynamic interval recommendations
      const recommendations = generateIntervalRecommendations(usagePct);

      // Quota health bands (recalibrated for 13-sport expected usage ~3,100/day)
      // At normal operation we sit at ~44% — only alert when something is anomalous.
      const emergencyMode = usagePct >= 90;  // > 6,300 calls — hard limit approaching
      const warningMode   = usagePct >= 75;  // > 5,250 calls — unusual, reduce intervals
      const cautionMode   = usagePct >= 60;  // > 4,200 calls — above expected, investigate

      // Normalised usage relative to expected baseline (not the hard cap)
      const normalUsagePct = Math.round((totalUsed / EXPECTED_DAILY_USAGE) * 100);
      const usageVsExpected = normalUsagePct <= 100
        ? 'normal'
        : normalUsagePct <= 135
        ? 'elevated'
        : 'anomalous';

      // Per-sport quota breakdown
      const sportBreakdown: Record<string, { quota: number; usedPct: number }> = {};
      for (const [sport, quota] of Object.entries(SPORT_QUOTAS)) {
        const sportUsed = rows
          .filter((r: Record<string, unknown>) => {
            const ep = String(r.endpoint ?? '').toLowerCase();
            const pv = String(r.provider_name ?? '').toLowerCase();
            if (sport === 'fixtures') return ep.includes('fixture') || ep.includes('game?date');
            if (sport === 'odds')     return ep.includes('odd');
            if (sport === 'standings') return ep.includes('standing');
            return ep.includes(sport.replace('-', '')) || pv.includes(sport.replace('-', ''));
          })
          .reduce((s: number, r: Record<string, unknown>) => s + Number(r.request_count ?? 0), 0);
        sportBreakdown[sport] = { quota, usedPct: Math.round((sportUsed / quota) * 100) };
      }

      // Create alert if approaching quota limits
      if (emergencyMode) {
        await supabase.from('pipeline_alerts').insert({
          alert_type: 'quota_emergency',
          severity: 'critical',
          message: `API quota at ${usagePct}% (${totalUsed}/${TOTAL_DAILY_BUDGET}). Emergency mode active — non-critical syncs suspended.`,
          details: { totalUsed, remaining, usagePct, byProvider },
          resolved: false,
        }).catch(() => {});
      } else if (warningMode) {
        await supabase.from('pipeline_alerts').insert({
          alert_type: 'quota_warning',
          severity: 'warning',
          message: `API quota at ${usagePct}% (${totalUsed}/${TOTAL_DAILY_BUDGET}). Refresh intervals auto-increased.`,
          details: { totalUsed, remaining, usagePct, normalUsagePct },
          resolved: false,
        }).catch(() => {});
      } else if (cautionMode && !warningMode) {
        await supabase.from('pipeline_alerts').insert({
          alert_type: 'quota_caution',
          severity: 'info',
          message: `API quota at ${usagePct}% — above expected for 13 sports (expected ~${EXPECTED_DAILY_USAGE} calls/day). Investigate unexpected sources.`,
          details: { totalUsed, remaining, usagePct, normalUsagePct, expectedDaily: EXPECTED_DAILY_USAGE },
          resolved: false,
        }).catch(() => {});
      }

      return new Response(JSON.stringify({
        date: today,
        budget: {
          total: TOTAL_DAILY_BUDGET,
          used: totalUsed,
          remaining,
          usagePct,
          successRate: totalUsed > 0 ? Math.round((totalSuccess / totalUsed) * 100) : 100,
          errorRate: totalUsed > 0 ? Math.round((totalErrors / totalUsed) * 100) : 0,
        },
        projection: {
          currentHour,
          hourlyRate,
          projectedDayTotal,
          willExceedBudget,
          projectedExhaustionHour,
        },
        status: {
          emergencyMode,
          warningMode,
          cautionMode,
          healthStatus: emergencyMode ? 'CRITICAL' : warningMode ? 'WARNING' : cautionMode ? 'CAUTION' : 'HEALTHY',
          normalUsagePct,
          usageVsExpected,
        },
        expectedDailyUsage: EXPECTED_DAILY_USAGE,
        byProvider,
        sportBreakdown,
        recommendations,
        generatedAt: new Date().toISOString(),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'reset-emergency') {
      // Resolve open quota alerts
      await supabase.from('pipeline_alerts')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .in('alert_type', ['quota_emergency', 'quota_warning'])
        .eq('resolved', false);

      return new Response(JSON.stringify({ success: true, message: 'Emergency mode reset' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function generateIntervalRecommendations(usagePct: number): Record<string, number> {
  // Recalibrated for 13-sport pipeline (~3,100 expected daily calls out of 7,000).
  // With ~44% normal baseline, throttling should not kick in until 75%+.
  // Old thresholds (50% → 2x) were too aggressive; they would fire every normal day.
  const multiplier =
    usagePct > 90 ? 6   :  // CRITICAL — 6× slower, suspend all non-football
    usagePct > 75 ? 3   :  // WARNING  — 3× slower
    usagePct > 60 ? 1.5 :  // CAUTION  — 1.5× (anomalous but not yet dangerous)
    1;                      // NORMAL   — no throttle (0–60% expected range)
  return {
    // Live sync intervals (seconds between polls)
    'live-football-sec':      15 * multiplier,   // base 15s
    'live-basketball-sec':    20 * multiplier,   // base 20s
    'live-hockey-sec':        25 * multiplier,   // base 25s
    'live-rugby-sec':         30 * multiplier,   // base 30s
    'live-handball-sec':      30 * multiplier,
    'live-volleyball-sec':    30 * multiplier,
    'live-baseball-sec':      30 * multiplier,
    'live-american-football-sec': 30 * multiplier,
    'live-mma-sec':           45 * multiplier,   // base 45s (less frequent events)
    'live-afl-sec':           30 * multiplier,
    // TSDB sports — no API-Sports quota impact
    'live-tennis-sec':        30,                // always base (TSDB free tier)
    'live-cricket-sec':       30,
    'live-formula1-sec':      30,
    // Pre-match and fixture intervals
    'pre-match-30min-sec':   300 * multiplier,
    'pre-match-2h-sec':      900 * multiplier,
    'fixtures-sec':         3600 * multiplier,
    'standings-sec':        3600 * multiplier,
    'metadata-sec':        86400,                // always 24h (static data)
    // Status flags
    'emergencyMode':  usagePct > 90,
    'warningMode':    usagePct > 75,
    'cautionMode':    usagePct > 60,
    'multiplier':     multiplier,
    'sportsCount':    13,
    'tsdbSports':     3,   // tennis, cricket, formula1 — free tier
    'apiSportsSports': 10, // football, basketball, hockey, handball, volleyball,
                           // rugby, baseball, american-football, mma, afl
  };
}
