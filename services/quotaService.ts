/**
 * services/quotaService.ts — Client-Side Quota Monitoring
 *
 * Provides the frontend with real-time quota usage information.
 * Used by the admin dashboard to display API budget health.
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface QuotaBudget {
  total: number;
  used: number;
  remaining: number;
  usagePct: number;
  successRate: number;
  errorRate: number;
}

export interface QuotaProjection {
  currentHour: number;
  hourlyRate: number;
  projectedDayTotal: number;
  willExceedBudget: boolean;
  projectedExhaustionHour: number | null;
}

export interface QuotaStatus {
  emergencyMode: boolean;
  warningMode: boolean;
  healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

export interface QuotaReport {
  date: string;
  budget: QuotaBudget;
  projection: QuotaProjection;
  status: QuotaStatus;
  byProvider: Record<string, { requests: number; errors: number; lastCalled: string | null }>;
  recommendations: Record<string, number | boolean>;
  generatedAt: string;
}

// ─── Fetch quota report ───────────────────────────────────────────────────────
export async function fetchQuotaReport(): Promise<QuotaReport | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('quota-monitor', {
      body: { action: 'report' },
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await error.context?.text()) || msg; } catch { /* ignore */ }
      }
      console.warn('[QuotaService] Error fetching report:', msg);
      return null;
    }

    return data as QuotaReport;
  } catch (e) {
    console.warn('[QuotaService] Fetch error:', e);
    return null;
  }
}

// ─── Get status summary for admin header ─────────────────────────────────────
export async function getQuotaStatusSummary(): Promise<{
  usagePct: number;
  emergencyMode: boolean;
  remaining: number;
  healthStatus: string;
}> {
  try {
    const report = await fetchQuotaReport();
    if (!report) return { usagePct: 0, emergencyMode: false, remaining: 7000, healthStatus: 'UNKNOWN' };
    return {
      usagePct: report.budget.usagePct,
      emergencyMode: report.status.emergencyMode,
      remaining: report.budget.remaining,
      healthStatus: report.status.healthStatus,
    };
  } catch {
    return { usagePct: 0, emergencyMode: false, remaining: 7000, healthStatus: 'UNKNOWN' };
  }
}

// ─── Color helpers ────────────────────────────────────────────────────────────
export function quotaStatusToColor(healthStatus: string): string {
  switch (healthStatus) {
    case 'HEALTHY': return '#22C55E';
    case 'WARNING': return '#F59E0B';
    case 'CRITICAL': return '#EF4444';
    default: return '#6B7280';
  }
}

export function quotaUsagePctToColor(pct: number): string {
  if (pct < 50) return '#22C55E';
  if (pct < 75) return '#F59E0B';
  return '#EF4444';
}
