/**
 * quotaManager.ts — Enterprise API Quota Management  v2.0
 *
 * Tracks and enforces the 7,000 req/day budget across all providers.
 * Prevents quota exhaustion via dynamic interval adjustment.
 *
 * Canonical 13-sport registry (v3.0 — AFL/formula1 removed, boxing/esports added)
 *   API-Sports (quota-consuming — 11 sports):
 *     football, basketball, hockey, handball, volleyball,
 *     rugby, baseball, american-football, mma, boxing, esports
 *   TheSportsDB (free tier — 0 API-Sports quota consumed — 2 sports):
 *     tennis, cricket
 *
 * Budget allocation (7,000 total):
 *   Football Live          (288/day):  600  (8.6%)
 *   Basketball Live        (288/day):  280  (4.0%)
 *   Hockey Live            (288/day):  280  (4.0%)
 *   Rugby Live             (288/day):  260  (3.7%)
 *   Handball Live          (288/day):  260  (3.7%)
 *   Volleyball Live        (288/day):  260  (3.7%)
 *   Baseball Live          (288/day):  280  (4.0%)
 *   American Football Live (288/day):  260  (3.7%)
 *   MMA Live               (288/day):  260  (3.7%)
 *   Boxing Live            (limited events): 150  (2.1%)
 *   Esports Live           (288/day):  150  (2.1%)
 *   Tennis/Cricket (TSDB free):          0  (0.0%)
 *   Fixture fetches  (2× daily):        500  (7.1%)
 *   Odds (football leagues):            100  (1.4%)
 *   Standings (weekly avg):             100  (1.4%)
 *   Emergency Buffer:                 3,760 (53.7%)
 *   ────────────────────────────────────────────────
 *   EXPECTED daily total:             ~3,240
 *   Available headroom:               ~3,760
 *
 * Alert thresholds (recalibrated for ~3,100/day normal baseline):
 *   > 60% (~4,200 calls): CAUTION  — unexpected calls, investigate
 *   > 75% (~5,250 calls): WARNING  — auto-increase intervals
 *   > 90% (~6,300 calls): CRITICAL — emergency mode, suspend non-critical
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface QuotaAllocation {
  sport: string;
  dailyBudget: number;
  hourlyBudget: number;
  usedToday: number;
  usedThisHour: number;
  remainingToday: number;
  exhaustionRiskPct: number;
  recommendedIntervalSec: number;
  canFetch: boolean;
}

export interface QuotaReport {
  date: string;
  totalBudget: number;
  totalUsed: number;
  totalRemaining: number;
  exhaustionRiskPct: number;
  normalUsagePct: number;       // vs expected ~3,100/day baseline
  allocations: QuotaAllocation[];
  hourlyUsage: number[];
  emergencyMode: boolean;
  warningMode: boolean;
  cautionMode: boolean;
  projectedExhaustionHour: number | null;
}

// Daily budget allocations per sport / category (API-Sports quota only)
// Tennis, cricket, formula1 use TheSportsDB (free) — not counted here.
// Daily budget per category (API-Sports quota only; TSDB is free)
const DAILY_BUDGETS: Record<string, number> = {
  'football-live':            600,  // highest global coverage demand
  'basketball-live':          280,
  'hockey-live':              280,
  'rugby-live':               260,
  'handball-live':            260,
  'volleyball-live':          260,
  'baseball-live':            280,
  'american-football-live':   260,
  'mma-live':                 260,
  'boxing-live':              150,  // infrequent events — lower budget
  'esports-live':             150,  // API-Sports esports sub-domain
  // tennis-live, cricket-live → TSDB free (0 API-Sports quota)
  'fixtures':                 500,  // morning + evening preloads, 13 canonical sports
  'odds':                     100,  // football major leagues only
  'standings':                100,  // weekly, averaged daily
  'emergency':               3760,  // buffer — ~54% headroom
};

const TOTAL_DAILY_BUDGET = 7000; // hard API-Sports platform limit

// Expected daily usage for 13-sport pipeline (v2.0 baseline)
// 10 API-Sports × 288 sync-live + ~220 fixture/odds/standings = ~3,100/day
export const EXPECTED_DAILY_USAGE = 3100;
export const EXPECTED_USAGE_WARNING_MULTIPLIER = 1.35; // alert if usage exceeds 135% of expected

// Dynamic interval recommendations (v2.0 — recalibrated for 44% normal baseline)
// Old thresholds (50% → 2×) fired every normal day. New caution at 60%.
function getRecommendedInterval(remainingPct: number, baseIntervalSec: number): number {
  if (remainingPct > 40) return baseIntervalSec;        // normal (0–60% used)
  if (remainingPct > 25) return baseIntervalSec * 1.5;  // caution (60–75% used)
  if (remainingPct > 10) return baseIntervalSec * 3;    // warning (75–90% used)
  return baseIntervalSec * 6;                            // emergency (>90% used)
}

export async function getQuotaReport(
  supabase: ReturnType<typeof createClient>,
): Promise<QuotaReport> {
  const today = new Date().toISOString().split('T')[0];
  const currentHour = new Date().getUTCHours();

  try {
    const { data: usageRows } = await supabase
      .from('api_usage')
      .select('provider_name, endpoint, request_count, date')
      .eq('date', today);

    const rows = usageRows ?? [];
    const totalUsed = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.request_count ?? 0), 0);
    const remainingTotal = Math.max(0, TOTAL_DAILY_BUDGET - totalUsed);
    const exhaustionRiskPct = Math.round((totalUsed / TOTAL_DAILY_BUDGET) * 100);

    // Normalised usage vs expected baseline (not the hard cap)
    const normalUsagePct = Math.round((totalUsed / EXPECTED_DAILY_USAGE) * 100);

    const hourlyEstimate = currentHour > 0 ? Math.round(totalUsed / currentHour) : 0;
    const projectedDailyTotal = hourlyEstimate * 24;
    const projectedExhaustionHour = projectedDailyTotal > TOTAL_DAILY_BUDGET
      ? Math.round(TOTAL_DAILY_BUDGET / Math.max(1, hourlyEstimate))
      : null;

    const allocations: QuotaAllocation[] = Object.entries(DAILY_BUDGETS).map(([category, budget]) => {
      const categoryUsed = estimateCategoryUsage(rows, category);
      const remaining = Math.max(0, budget - categoryUsed);
      const pct = Math.round((categoryUsed / budget) * 100);
      const baseInterval = getCategoryBaseInterval(category);

      return {
        sport: category,
        dailyBudget: budget,
        hourlyBudget: Math.round(budget / 24),
        usedToday: categoryUsed,
        usedThisHour: Math.round(categoryUsed / Math.max(1, currentHour)),
        remainingToday: remaining,
        exhaustionRiskPct: pct,
        recommendedIntervalSec: getRecommendedInterval(100 - pct, baseInterval),
        canFetch: remaining > 0 && exhaustionRiskPct < 95,
      };
    });

    const hourlyUsage = Array.from({ length: 24 }, (_, h) =>
      h <= currentHour ? Math.round(totalUsed / Math.max(1, currentHour)) : 0,
    );

    return {
      date: today,
      totalBudget: TOTAL_DAILY_BUDGET,
      totalUsed,
      totalRemaining: remainingTotal,
      exhaustionRiskPct,
      normalUsagePct,
      allocations,
      hourlyUsage,
      emergencyMode: exhaustionRiskPct > 90,
      warningMode:   exhaustionRiskPct > 75,
      cautionMode:   exhaustionRiskPct > 60,
      projectedExhaustionHour,
    };
  } catch (e) {
    console.error('[QuotaManager] Error fetching quota report:', e);
    return {
      date: today,
      totalBudget: TOTAL_DAILY_BUDGET,
      totalUsed: 0,
      totalRemaining: TOTAL_DAILY_BUDGET,
      exhaustionRiskPct: 0,
      normalUsagePct: 0,
      allocations: [],
      hourlyUsage: Array(24).fill(0),
      emergencyMode: false,
      warningMode: false,
      cautionMode: false,
      projectedExhaustionHour: null,
    };
  }
}

function estimateCategoryUsage(
  rows: Record<string, unknown>[],
  category: string,
): number {
  return rows
    .filter((r: Record<string, unknown>) => {
      const provider = String(r.provider_name ?? '');
      const endpoint = String(r.endpoint ?? '');
      switch (category) {
        case 'football-live':            return provider === 'api-football' && endpoint.includes('live');
        case 'basketball-live':          return provider.includes('basketball') && !endpoint.includes('standing');
        case 'hockey-live':              return provider.includes('hockey')      && !endpoint.includes('standing');
        case 'rugby-live':               return provider.includes('rugby')       && !endpoint.includes('standing');
        case 'handball-live':            return provider.includes('handball')    && !endpoint.includes('standing');
        case 'volleyball-live':          return provider.includes('volleyball')  && !endpoint.includes('standing');
        case 'baseball-live':            return provider.includes('baseball')    && !endpoint.includes('standing');
        case 'american-football-live':   return provider.includes('american')    && !endpoint.includes('standing');
        case 'mma-live':                 return provider.includes('mma')         && !endpoint.includes('standing');
        case 'boxing-live':              return provider.includes('boxing')      && !endpoint.includes('standing');
        case 'esports-live':             return provider.includes('esports')     && !endpoint.includes('standing');
        // tennis, cricket → TSDB (free) — always 0 API-Sports quota
        case 'fixtures':   return endpoint.includes('fixture') || endpoint.includes('game?date');
        case 'odds':       return endpoint.includes('odd');
        case 'standings':  return endpoint.includes('standing');
        case 'emergency':  return false; // buffer slot, never consumed directly
        default:           return false;
      }
    })
    .reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.request_count ?? 0), 0);
}

function getCategoryBaseInterval(category: string): number {
  const intervals: Record<string, number> = {
    'football-live':           15,   // 15s base for live football
    'basketball-live':         20,
    'hockey-live':             25,
    'rugby-live':              30,
    'handball-live':           30,
    'volleyball-live':         30,
    'baseball-live':           30,
    'american-football-live':  30,
    'mma-live':                45,   // infrequent events
    'boxing-live':             120,  // rare live fights
    'esports-live':            30,
    'fixtures':              3600,   // 1h between fixture refreshes
    'odds':                  3600,
    'standings':             3600,
    'emergency':            86400,   // buffer slot — never fetched directly
  };
  return intervals[category] ?? 60;
}

// Check if a specific fetch category is allowed
export async function canFetch(
  supabase: ReturnType<typeof createClient>,
  category: string,
): Promise<boolean> {
  try {
    const report = await getQuotaReport(supabase);
    if (report.emergencyMode) {
      // Emergency: only allow football and basketball live sync
      return ['football-live', 'basketball-live'].includes(category);
    }
    if (report.warningMode) {
      // Warning: suspend non-live categories (fixtures, odds, standings)
      const liveCategories = [
        'football-live', 'basketball-live', 'hockey-live', 'rugby-live',
        'handball-live', 'volleyball-live', 'baseball-live',
        'american-football-live', 'mma-live', 'boxing-live', 'esports-live',
      ];
      return liveCategories.includes(category);
    }
    const allocation = report.allocations.find((a) => a.sport === category);
    return allocation?.canFetch ?? true;
  } catch {
    return true; // Allow on error to avoid blocking
  }
}

// Record that requests were made
export async function recordQuotaUsage(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  endpoint: string,
  count: number,
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase
      .from('api_usage')
      .select('id, request_count')
      .eq('provider_name', provider)
      .eq('endpoint', endpoint)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('api_usage')
        .update({
          request_count: (existing.request_count ?? 0) + count,
          last_called: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('api_usage').insert({
        provider_name: provider,
        endpoint,
        date: today,
        request_count: count,
        success_count: count,
        error_count: 0,
        last_called: new Date().toISOString(),
      });
    }
  } catch { /* non-blocking */ }
}
