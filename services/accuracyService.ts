/**
 * accuracyService.ts — Platform-wide and per-sport prediction accuracy tracking
 *
 * Reads from prediction_outcomes table which is now populated by the
 * auto_resolve_and_track_predictions() DB function (runs on each sync).
 *
 * Returns accuracy stats per sport, per risk level, and platform-wide,
 * used by the admin dashboard, predictions page accuracy banner, and
 * the new accuracy widget on the AI Picks header.
 */

import { getSupabaseClient } from '@/template';

export interface SportAccuracyStat {
  sport: string;
  totalOutcomes: number;
  correct: number;
  accuracyPct: number;
  avgConfidence: number;
  calibrationDrift: number;  // |accuracy - avgConfidence| — lower = better calibrated
  trend: 'up' | 'down' | 'neutral';
}

export interface PlatformAccuracyStats {
  overall: {
    total: number;
    correct: number;
    accuracyPct: number;
    avgConfidence: number;
    calibrationDrift: number;
  };
  bySport: SportAccuracyStat[];
  byRisk: {
    low:    { total: number; correct: number; pct: number };
    medium: { total: number; correct: number; pct: number };
    high:   { total: number; correct: number; pct: number };
  };
  recentTrend: {
    last7d:  { total: number; correct: number; pct: number };
    last30d: { total: number; correct: number; pct: number };
  };
  lastUpdated: string;
}

const CACHE_KEY = '__px_accuracy_cache__';
const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
let _cache: { data: PlatformAccuracyStats; ts: number } | null = null;

function pct(correct: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((correct / total) * 100 * 10) / 10;
}

export async function fetchPlatformAccuracy(forceRefresh = false): Promise<PlatformAccuracyStats | null> {
  // L1 memory cache
  if (!forceRefresh && _cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  try {
    const supabase = getSupabaseClient();

    // Fetch all resolved outcomes from last 60 days
    const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: outcomes, error } = await supabase
      .from('prediction_outcomes')
      .select('sport, is_correct, confidence_at_prediction, resolved_at')
      .gte('resolved_at', since60d)
      .order('resolved_at', { ascending: false })
      .limit(2000);

    if (error || !outcomes || outcomes.length === 0) return null;

    // Overall stats
    const total   = outcomes.length;
    const correct = outcomes.filter((o: any) => o.is_correct).length;
    const avgConf = Math.round(
      outcomes.reduce((s: number, o: any) => s + (o.confidence_at_prediction ?? 65), 0) / total
    );
    const overallPct = pct(correct, total);

    // By sport
    const sportMap: Record<string, { total: number; correct: number; confSum: number }> = {};
    for (const o of outcomes as any[]) {
      const s = o.sport ?? 'unknown';
      if (!sportMap[s]) sportMap[s] = { total: 0, correct: 0, confSum: 0 };
      sportMap[s].total++;
      if (o.is_correct) sportMap[s].correct++;
      sportMap[s].confSum += o.confidence_at_prediction ?? 65;
    }

    const bySport: SportAccuracyStat[] = Object.entries(sportMap)
      .filter(([, v]) => v.total >= 3)
      .map(([sport, v]) => {
        const acc = pct(v.correct, v.total);
        const conf = Math.round(v.confSum / v.total);
        return {
          sport,
          totalOutcomes: v.total,
          correct: v.correct,
          accuracyPct: acc,
          avgConfidence: conf,
          calibrationDrift: Math.abs(acc - conf),
          trend: 'neutral' as const,
        };
      })
      .sort((a, b) => b.totalOutcomes - a.totalOutcomes);

    // By risk level — join via predictions table (approximate from confidence)
    const lowOutcomes    = outcomes.filter((o: any) => (o.confidence_at_prediction ?? 0) >= 80);
    const mediumOutcomes = outcomes.filter((o: any) => (o.confidence_at_prediction ?? 0) >= 60 && (o.confidence_at_prediction ?? 0) < 80);
    const highOutcomes   = outcomes.filter((o: any) => (o.confidence_at_prediction ?? 0) < 60);

    const byRisk = {
      low:    { total: lowOutcomes.length,    correct: lowOutcomes.filter((o: any) => o.is_correct).length,    pct: pct(lowOutcomes.filter((o: any) => o.is_correct).length, lowOutcomes.length) },
      medium: { total: mediumOutcomes.length, correct: mediumOutcomes.filter((o: any) => o.is_correct).length, pct: pct(mediumOutcomes.filter((o: any) => o.is_correct).length, mediumOutcomes.length) },
      high:   { total: highOutcomes.length,   correct: highOutcomes.filter((o: any) => o.is_correct).length,   pct: pct(highOutcomes.filter((o: any) => o.is_correct).length, highOutcomes.length) },
    };

    // Recent trend
    const last7 = outcomes.filter((o: any) => o.resolved_at >= since7d);
    const last30 = outcomes.filter((o: any) => o.resolved_at >= since30d);

    const recentTrend = {
      last7d:  { total: last7.length,  correct: last7.filter((o: any)  => o.is_correct).length, pct: pct(last7.filter((o: any)  => o.is_correct).length, last7.length) },
      last30d: { total: last30.length, correct: last30.filter((o: any) => o.is_correct).length, pct: pct(last30.filter((o: any) => o.is_correct).length, last30.length) },
    };

    const result: PlatformAccuracyStats = {
      overall: {
        total, correct, accuracyPct: overallPct,
        avgConfidence: avgConf,
        calibrationDrift: Math.abs(overallPct - avgConf),
      },
      bySport,
      byRisk,
      recentTrend,
      lastUpdated: new Date().toISOString(),
    };

    _cache = { data: result, ts: Date.now() };
    return result;
  } catch { return null; }
}

export function invalidateAccuracyCache(): void {
  _cache = null;
}

/**
 * Convenience: get a compact badge label for the accuracy header.
 * Returns e.g. "47% overall" or null if no data.
 */
export function getAccuracyBadgeLabel(stats: PlatformAccuracyStats | null): string | null {
  if (!stats || stats.overall.total < 10) return null;
  return `${stats.overall.accuracyPct}% verified (${stats.overall.total} picks)`;
}

/**
 * Get colour for an accuracy percentage (for UI display).
 */
export function getAccuracyColor(pctVal: number): string {
  if (pctVal >= 60) return '#6EDC1F'; // PredictXta brand green — good
  if (pctVal >= 50) return '#F59E0B'; // amber — average
  return '#EF4444';                   // red — below 50%
}
