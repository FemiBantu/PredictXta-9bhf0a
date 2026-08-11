/**
 * services/aiIntelligenceService.ts
 *
 * Client-side service for PredictXta's Enterprise AI Intelligence ecosystem.
 *
 * GOVERNANCE PRINCIPLES:
 * - LLMs operate as explanation/language layer only
 * - All probabilities, confidence scores, and predictions originate
 *   exclusively from validated Statistical Prediction Engines
 * - Every AI request is grounded via a Verified Facts Object (server-side)
 * - Pre/Post generation validation + hallucination detection enforced server-side
 * - Full AI Audit Trail logged server-side for compliance & observability
 *
 * Content types supported:
 *   match_preview        — 3-paragraph pre-match preview
 *   prediction_explanation — why the engine predicted this outcome
 *   tactical_analysis    — how teams are likely to approach the match
 *   vip_report           — premium intelligence briefing (VIP only)
 */

import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIContentType =
  | 'match_preview'
  | 'prediction_explanation'
  | 'tactical_analysis'
  | 'vip_report';

export interface AIIntelligenceResult {
  content: string;
  contentType: AIContentType;
  source: 'cache' | 'gpt-primary' | 'gpt-fallback' | 'onspace-fallback' | 'safe_fallback' | string;
  dqScore: number;
  validationPassed: boolean;
  hallucinationScore?: number;
  latencyMs?: number;
  fromCache: boolean;
  error?: string;
}

export interface AIIntelligenceOptions {
  bypassCache?: boolean;
  userId?: string;
}

// ─── In-Memory Cache (per session) ───────────────────────────────────────────
const sessionCache = new Map<string, { result: AIIntelligenceResult; expiresAt: number }>();
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSessionCacheKey(matchId: string, contentType: AIContentType): string {
  return `${matchId}::${contentType}`;
}

// ─── Main Fetch Function ──────────────────────────────────────────────────────

/**
 * fetchAIIntelligence — Fetches grounded AI-generated content for a match.
 *
 * Uses stale-while-revalidate:
 * 1. Check in-memory session cache
 * 2. Call ai-intelligence edge function (which manages server-side DB cache)
 * 3. All validation, hallucination detection, and audit logging happen server-side
 *
 * The edge function enforces all governance rules — this client simply
 * requests content and receives validated output.
 */
export async function fetchAIIntelligence(
  matchId: string,
  contentType: AIContentType,
  options: AIIntelligenceOptions = {},
): Promise<AIIntelligenceResult> {
  if (!matchId) {
    return { content: '', contentType, source: 'cache', dqScore: 0, validationPassed: false, fromCache: false, error: 'No match ID provided' };
  }

  // Check session cache
  const cacheKey = getSessionCacheKey(matchId, contentType);
  if (!options.bypassCache) {
    const cached = sessionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, fromCache: true };
    }
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('ai-intelligence', {
      body: {
        match_id: matchId,
        content_type: contentType,
        user_id: options.userId ?? null,
        bypass_cache: options.bypassCache ?? false,
      },
    });

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = (await error.context?.text()) || msg; } catch { /* ignore */ }
      }
      return { content: '', contentType, source: 'cache', dqScore: 0, validationPassed: false, fromCache: false, error: msg };
    }

    if (!data?.success || !data?.content) {
      return { content: '', contentType, source: 'cache', dqScore: 0, validationPassed: false, fromCache: false, error: 'Empty response from intelligence service' };
    }

    const result: AIIntelligenceResult = {
      content: data.content as string,
      contentType,
      source: data.source as string ?? 'unknown',
      dqScore: Number(data.dq_score ?? 0),
      validationPassed: Boolean(data.validation_passed),
      hallucinationScore: data.hallucination_score != null ? Number(data.hallucination_score) : undefined,
      latencyMs: data.latency_ms != null ? Number(data.latency_ms) : undefined,
      fromCache: data.source === 'cache',
    };

    // Store in session cache
    sessionCache.set(cacheKey, { result, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Intelligence service error';
    return { content: '', contentType, source: 'cache', dqScore: 0, validationPassed: false, fromCache: false, error: msg };
  }
}

/**
 * prefetchAIIntelligence — Fire-and-forget prefetch for match preview.
 * Call this when navigating to a match detail page to warm the cache.
 */
export function prefetchAIIntelligence(matchId: string, userId?: string): void {
  if (!matchId) return;
  const cacheKey = getSessionCacheKey(matchId, 'match_preview');
  const cached   = sessionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return;
  // Fire and forget — don't await
  fetchAIIntelligence(matchId, 'match_preview', { userId }).catch(() => {});
}

/**
 * clearAIIntelligenceCache — Clear session cache for a specific match
 * (e.g. after prediction regeneration).
 */
export function clearAIIntelligenceCache(matchId?: string): void {
  if (matchId) {
    const types: AIContentType[] = ['match_preview', 'prediction_explanation', 'tactical_analysis', 'vip_report'];
    types.forEach((t) => sessionCache.delete(getSessionCacheKey(matchId, t)));
  } else {
    sessionCache.clear();
  }
}

// ─── Governance Info for UI ───────────────────────────────────────────────────
// These help the UI communicate transparency to users about how AI is used.

export const AI_GOVERNANCE_LABELS: Record<string, string> = {
  'match_preview': 'AI Match Preview',
  'prediction_explanation': 'Prediction Intelligence',
  'tactical_analysis': 'Tactical Analysis',
  'vip_report': 'VIP Intelligence Report',
};

export const AI_SOURCE_LABELS: Record<string, string> = {
  'cache':           'Cached · Fast',
  'gpt-primary':     'AI Generated',
  'gpt-fallback':    'AI Generated',
  'onspace-fallback':'AI Generated',
  'safe_fallback':   'Verified Summary',
  'unknown':         'AI Generated',
};

export const AI_VALIDATION_BADGE: Record<string, { label: string; color: string }> = {
  'approved':   { label: '✓ Validated', color: '#22C55E' },
  'flagged':    { label: '⚠ Review', color: '#F59E0B' },
  'safe_fallback': { label: '✓ Verified', color: '#4ECDC4' },
};

/**
 * getValidationBadge — Returns appropriate validation badge config
 * for display in the AI report section.
 */
export function getValidationBadge(
  validationPassed: boolean,
  source: string,
): { label: string; color: string } {
  if (source === 'safe_fallback') return AI_VALIDATION_BADGE['safe_fallback'];
  return validationPassed ? AI_VALIDATION_BADGE['approved'] : AI_VALIDATION_BADGE['flagged'];
}
