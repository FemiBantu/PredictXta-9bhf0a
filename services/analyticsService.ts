/**
 * services/analyticsService.ts — PredictXta Phase 7 Product Analytics
 *
 * Privacy-conscious, non-blocking analytics service.
 *
 * PRINCIPLES:
 *   - No PII beyond user UUID (opt-in)
 *   - No payment details, tokens, or secrets in events
 *   - Batched, non-blocking writes to analytics_events table
 *   - Graceful degradation: analytics failure NEVER blocks product features
 *   - GDPR/privacy-aware: anonymous session IDs when user not logged in
 *
 * Tracked events (funnel):
 *   INSTALL → SIGNUP → LOGIN → ONBOARDING → SPORT_SELECTED → MATCH_VIEWED
 *   → PREDICTION_VIEWED → VIP_VIEWED → SUBSCRIPTION_STARTED → PURCHASE_SUCCESS
 */

import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── Event types ──────────────────────────────────────────────────────────────
export type AnalyticsEventType =
  // Auth funnel
  | 'app_open'
  | 'signup'
  | 'login'
  | 'logout'
  | 'onboarding_start'
  | 'onboarding_complete'
  | 'onboarding_skip'
  // Feature engagement
  | 'sport_selected'
  | 'match_viewed'
  | 'prediction_viewed'
  | 'prediction_shared'
  | 'ai_report_viewed'
  | 'expert_tip_viewed'
  | 'live_match_viewed'
  | 'challenge_started'
  | 'challenge_completed'
  | 'notification_tapped'
  | 'search_performed'
  // Monetisation funnel
  | 'vip_page_viewed'
  | 'subscription_started'
  | 'subscription_cancelled'
  | 'purchase_initiated'
  | 'purchase_success'
  | 'purchase_failure'
  | 'restore_purchase'
  // Retention
  | 'd1_return'
  | 'd7_return'
  | 'd30_return'
  // Error/quality
  | 'prediction_unavailable'
  | 'feed_error'
  | 'auth_error';

export interface AnalyticsEvent {
  event_type: AnalyticsEventType;
  session_id?: string;
  user_id?: string | null;
  sport?: string;
  match_id?: string;
  experiment_key?: string;
  variant?: string;
  properties?: Record<string, unknown>;
}

// ─── Session ID ───────────────────────────────────────────────────────────────
const SESSION_KEY = '@predictxta/analytics_session';
let _sessionId: string | null = null;

async function getSessionId(): Promise<string> {
  if (_sessionId) return _sessionId;
  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (stored) {
      const { id, ts } = JSON.parse(stored);
      // Session expires after 30 minutes of inactivity
      if (Date.now() - ts < 30 * 60 * 1000) {
        _sessionId = id;
        return id;
      }
    }
  } catch { /* ignore */ }
  // Generate new session
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  _sessionId = id;
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch { /* non-blocking */ }
  return id;
}

// ─── Event queue (batch writes) ───────────────────────────────────────────────
const _queue: AnalyticsEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5_000; // flush every 5s

async function flushQueue(): Promise<void> {
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, BATCH_SIZE);

  try {
    const sessionId = await getSessionId();
    const supabase = getSupabaseClient();

    const rows = batch.map((e) => ({
      event_type:     e.event_type,
      session_id:     e.session_id ?? sessionId,
      user_id:        e.user_id ?? null,
      sport:          e.sport ?? null,
      match_id:       e.match_id ?? null,
      experiment_key: e.experiment_key ?? null,
      variant:        e.variant ?? null,
      properties:     sanitizeProperties(e.properties ?? {}),
      platform:       Platform.OS,
      app_version:    '1.0.1',
      created_at:     new Date().toISOString(),
    }));

    await supabase.from('analytics_events').insert(rows);
  } catch {
    // Silently discard on failure — analytics must never block the product
  }
}

function scheduleFlush(): void {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushQueue().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

// ─── Privacy: sanitize properties ────────────────────────────────────────────
const FORBIDDEN_PROPERTY_KEYS = [
  'password', 'token', 'access_token', 'refresh_token', 'api_key',
  'secret', 'private_key', 'service_role', 'receipt', 'payment_method',
  'card_number', 'cvv', 'ssn', 'email', 'phone',
];

function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_PROPERTY_KEYS.some((forbidden) => k.toLowerCase().includes(forbidden))) {
      continue; // drop forbidden keys
    }
    // Truncate long string values
    if (typeof v === 'string' && v.length > 200) {
      clean[k] = v.slice(0, 200) + '...[truncated]';
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * track — queue an analytics event for batch writing.
 * Non-blocking — never awaited in critical user flows.
 */
export function track(event: AnalyticsEvent): void {
  _queue.push(event);
  if (_queue.length >= BATCH_SIZE) {
    // Immediate flush if batch is full
    flushQueue().catch(() => {});
  } else {
    scheduleFlush();
  }
}

/**
 * trackAsync — queue and immediately flush (use for critical events like purchase).
 */
export async function trackAsync(event: AnalyticsEvent): Promise<void> {
  _queue.push(event);
  await flushQueue();
}

/**
 * flush — manually flush the queue (call on app background/close).
 */
export async function flush(): Promise<void> {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  await flushQueue();
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function trackMatchView(matchId: string, sport: string, userId?: string): void {
  track({ event_type: 'match_viewed', match_id: matchId, sport, user_id: userId });
}

export function trackPredictionView(matchId: string, sport: string, confidence: number, userId?: string): void {
  track({ event_type: 'prediction_viewed', match_id: matchId, sport, user_id: userId, properties: { confidence } });
}

export function trackSportSelected(sport: string, userId?: string): void {
  track({ event_type: 'sport_selected', sport, user_id: userId });
}

export function trackVIPPageView(source: string, userId?: string): void {
  track({ event_type: 'vip_page_viewed', user_id: userId, properties: { source } });
}

export function trackPurchaseSuccess(plan: string, platform: string, userId?: string): void {
  // Note: never include receipt, token, or payment details here
  track({ event_type: 'purchase_success', user_id: userId, properties: { plan, platform } });
}

export function trackPurchaseFailure(reason: string, userId?: string): void {
  track({ event_type: 'purchase_failure', user_id: userId, properties: { reason } });
}

export function trackAuthError(errorCode: string): void {
  // Do NOT include email or password
  track({ event_type: 'auth_error', properties: { error_code: errorCode } });
}

export function trackAppOpen(userId?: string): void {
  track({ event_type: 'app_open', user_id: userId });
}

export function trackSignup(method: string): void {
  // Do NOT include email
  track({ event_type: 'signup', properties: { method } });
}

export function trackLogin(method: string, userId?: string): void {
  track({ event_type: 'login', user_id: userId, properties: { method } });
}

export function trackChallengeCompleted(
  userId: string,
  correctCount: number,
  totalPicks: number,
): void {
  track({
    event_type: 'challenge_completed',
    user_id: userId,
    properties: { correct_count: correctCount, total_picks: totalPicks, is_perfect: correctCount === totalPicks },
  });
}

export default { track, trackAsync, flush, trackMatchView, trackPredictionView, trackSportSelected };
