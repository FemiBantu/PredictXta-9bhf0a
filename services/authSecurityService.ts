/**
 * PredictXta Auth Security Service
 *
 * Handles device session tracking, security audit logging,
 * password strength validation, and risk signal detection.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getSupabaseClient } from '@/template';

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_TOKEN_KEY = '@predictxta/session_token';
const CURRENT_SESSION_ID_KEY = '@predictxta/current_session_id';
const LOGIN_ATTEMPTS_KEY = '@predictxta/login_attempts';
const LOCKOUT_UNTIL_KEY = '@predictxta/lockout_until';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DeviceSession {
  id: string;
  userId: string;
  sessionToken: string;
  deviceName: string | null;
  deviceType: string;
  platform: string | null;
  appVersion: string | null;
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
  isRevoked: boolean;
}

export interface SecurityAuditEvent {
  eventType:
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'register'
    | 'password_reset_request'
    | 'password_reset_complete'
    | 'session_revoked'
    | 'all_sessions_revoked'
    | 'security_settings_changed'
    | 'otp_sent'
    | 'otp_verified'
    | 'otp_failed';
  status: 'success' | 'failed' | 'blocked';
  metadata?: Record<string, unknown>;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;          // 0=terrible, 4=strong
  label: 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Very Strong';
  color: string;
  suggestions: string[];
  entropy: number;
}

export interface LoginAttemptState {
  count: number;
  lockedUntil: number | null;    // timestamp ms
  isLocked: boolean;
  remainingMs: number;
}

// ─── Password Strength Analyzer ───────────────────────────────────────────────
export function analyzePassword(password: string): PasswordStrength {
  const suggestions: string[] = [];
  let score = 0;

  // Length check
  if (password.length < 8) {
    suggestions.push('Use at least 8 characters');
  } else if (password.length >= 12) {
    score++;
  }
  if (password.length >= 16) score++;

  // Character class checks
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasUpper) suggestions.push('Add uppercase letters (A–Z)');
  if (!hasLower) suggestions.push('Add lowercase letters (a–z)');
  if (!hasDigit) suggestions.push('Add numbers (0–9)');
  if (!hasSymbol) suggestions.push('Add symbols (!@#$%^&*)');

  const classCount = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  if (classCount >= 3) score++;
  if (classCount === 4) score++;

  // Common pattern penalties
  const commonPatterns = [
    /^(.)\1+$/, // repeating chars
    /^(012|123|234|345|456|567|678|789|890)/, // sequential numbers
    /^(abc|bcd|cde|def|efg|fgh|ghi|hij)/i, // sequential letters
    /password|123456|qwerty|letmein|iloveyou|admin|welcome/i, // common words
  ];
  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score = Math.max(0, score - 1);
      suggestions.push('Avoid common patterns or dictionary words');
      break;
    }
  }

  // Entropy estimate (simplified)
  const charsetSize =
    (hasLower ? 26 : 0) +
    (hasUpper ? 26 : 0) +
    (hasDigit ? 10 : 0) +
    (hasSymbol ? 32 : 0);
  const entropy = password.length * Math.log2(Math.max(charsetSize, 1));

  // Clamp score
  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const labelMap: PasswordStrength['label'][] = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const colorMap = ['#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6'];

  return {
    score: clamped,
    label: labelMap[clamped],
    color: colorMap[clamped],
    suggestions: suggestions.slice(0, 3),
    entropy: Math.round(entropy),
  };
}

// ─── Email Validator ───────────────────────────────────────────────────────────
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ─── Rate Limiting / Login Attempt Guard ─────────────────────────────────────
export async function getLoginAttemptState(): Promise<LoginAttemptState> {
  try {
    const [rawCount, rawLockout] = await AsyncStorage.multiGet([
      LOGIN_ATTEMPTS_KEY,
      LOCKOUT_UNTIL_KEY,
    ]);
    const count = parseInt(rawCount[1] ?? '0', 10);
    const lockedUntil = rawLockout[1] ? parseInt(rawLockout[1], 10) : null;
    const now = Date.now();
    const isLocked = lockedUntil !== null && lockedUntil > now;
    const remainingMs = isLocked ? lockedUntil! - now : 0;
    return { count, lockedUntil, isLocked, remainingMs };
  } catch {
    return { count: 0, lockedUntil: null, isLocked: false, remainingMs: 0 };
  }
}

export async function recordLoginFailure(): Promise<LoginAttemptState> {
  const state = await getLoginAttemptState();
  if (state.isLocked) return state;

  const newCount = state.count + 1;
  await AsyncStorage.setItem(LOGIN_ATTEMPTS_KEY, String(newCount));

  if (newCount >= MAX_FAILED_ATTEMPTS) {
    const lockUntil = Date.now() + LOCKOUT_DURATION_MS;
    await AsyncStorage.setItem(LOCKOUT_UNTIL_KEY, String(lockUntil));
    return {
      count: newCount,
      lockedUntil: lockUntil,
      isLocked: true,
      remainingMs: LOCKOUT_DURATION_MS,
    };
  }
  return { count: newCount, lockedUntil: null, isLocked: false, remainingMs: 0 };
}

export async function clearLoginAttempts(): Promise<void> {
  await AsyncStorage.multiRemove([LOGIN_ATTEMPTS_KEY, LOCKOUT_UNTIL_KEY]);
}

export function formatLockoutTime(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes <= 1) return '1 minute';
  return `${minutes} minutes`;
}

// ─── Session Token ─────────────────────────────────────────────────────────────
function generateSessionToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function getOrCreateSessionToken(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    if (existing) return existing;
    const token = generateSessionToken();
    await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
    return token;
  } catch {
    return generateSessionToken();
  }
}

export async function clearSessionToken(): Promise<void> {
  await AsyncStorage.multiRemove([SESSION_TOKEN_KEY, CURRENT_SESSION_ID_KEY]);
}

// ─── Device Info ──────────────────────────────────────────────────────────────
function getDeviceName(): string {
  const plat = Platform.OS;
  if (plat === 'ios') return 'iPhone / iPad';
  if (plat === 'android') return 'Android Device';
  if (plat === 'web') return 'Web Browser';
  return 'Unknown Device';
}

function getPlatformLabel(): string {
  return Platform.OS === 'ios'
    ? `iOS ${Platform.Version}`
    : Platform.OS === 'android'
    ? `Android ${Platform.Version}`
    : 'Web';
}

// ─── Register / Update Device Session ────────────────────────────────────────
export async function registerDeviceSession(
  userId: string,
  options?: { markOthersNotCurrent?: boolean },
): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const sessionToken = await getOrCreateSessionToken();

    // Mark all other sessions as not current
    if (options?.markOthersNotCurrent) {
      await supabase
        .from('user_sessions')
        .update({ is_current: false })
        .eq('user_id', userId)
        .neq('session_token', sessionToken);
    }

    // Upsert current session
    const { data, error } = await supabase
      .from('user_sessions')
      .upsert(
        {
          user_id: userId,
          session_token: sessionToken,
          device_name: getDeviceName(),
          device_type: Platform.OS === 'web' ? 'web' : 'mobile',
          platform: getPlatformLabel(),
          app_version: '1.0.0',
          last_active_at: new Date().toISOString(),
          is_current: true,
          is_revoked: false,
        },
        { onConflict: 'session_token' },
      )
      .select('id')
      .single();

    if (!error && data) {
      await AsyncStorage.setItem(CURRENT_SESSION_ID_KEY, (data as any).id);
      return (data as any).id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateSessionActivity(userId: string): Promise<void> {
  try {
    const sessionToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    if (!sessionToken) return;
    await getSupabaseClient()
      .from('user_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('session_token', sessionToken);
  } catch { /* non-blocking */ }
}

// ─── Fetch Sessions ───────────────────────────────────────────────────────────
export async function fetchUserSessions(userId: string): Promise<DeviceSession[]> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_revoked', false)
      .order('last_active_at', { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return (data as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionToken: row.session_token,
      deviceName: row.device_name,
      deviceType: row.device_type ?? 'mobile',
      platform: row.platform,
      appVersion: row.app_version,
      ipAddress: row.ip_address,
      country: row.country,
      city: row.city,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
      isCurrent: row.is_current,
      isRevoked: row.is_revoked,
    }));
  } catch {
    return [];
  }
}

// ─── Revoke Session ───────────────────────────────────────────────────────────
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient()
      .from('user_sessions')
      .update({ is_revoked: true, is_current: false })
      .eq('id', sessionId)
      .eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}

export async function revokeAllOtherSessions(userId: string): Promise<boolean> {
  try {
    const currentToken = await AsyncStorage.getItem(SESSION_TOKEN_KEY);
    const query = getSupabaseClient()
      .from('user_sessions')
      .update({ is_revoked: true, is_current: false })
      .eq('user_id', userId);

    if (currentToken) {
      await query.neq('session_token', currentToken);
    } else {
      await query;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Security Audit Log ───────────────────────────────────────────────────────
export async function logSecurityEvent(
  userId: string | null,
  event: SecurityAuditEvent,
): Promise<void> {
  if (!userId) return;
  try {
    await getSupabaseClient().from('security_audit_log').insert({
      user_id: userId,
      event_type: event.eventType,
      event_status: event.status,
      device_info: `${getDeviceName()} · ${getPlatformLabel()}`,
      metadata: event.metadata ?? {},
      risk_level: event.riskLevel ?? 'low',
    });
  } catch { /* non-blocking */ }
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  eventStatus: string;
  deviceInfo: string | null;
  riskLevel: string;
  createdAt: string;
}

export async function fetchAuditLog(userId: string, limit = 20): Promise<AuditLogEntry[]> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('security_audit_log')
      .select('id, event_type, event_status, device_info, risk_level, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as any[]).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      eventStatus: row.event_status,
      deviceInfo: row.device_info,
      riskLevel: row.risk_level,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// ─── Helpers for display ──────────────────────────────────────────────────────
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getEventIcon(eventType: string): { icon: string; color: string } {
  const map: Record<string, { icon: string; color: string }> = {
    login_success:            { icon: 'checkmark-circle-outline', color: '#22C55E' },
    login_failed:             { icon: 'close-circle-outline',     color: '#EF4444' },
    logout:                   { icon: 'log-out-outline',           color: '#6B7280' },
    register:                 { icon: 'person-add-outline',        color: '#3B82F6' },
    password_reset_request:   { icon: 'key-outline',               color: '#F59E0B' },
    password_reset_complete:  { icon: 'shield-checkmark-outline',  color: '#22C55E' },
    session_revoked:          { icon: 'phone-portrait-outline',    color: '#EF4444' },
    all_sessions_revoked:     { icon: 'ban-outline',               color: '#EF4444' },
    security_settings_changed:{ icon: 'settings-outline',          color: '#8B5CF6' },
    otp_sent:                 { icon: 'mail-outline',              color: '#3B82F6' },
    otp_verified:             { icon: 'checkmark-done-outline',    color: '#22C55E' },
    otp_failed:               { icon: 'warning-outline',           color: '#EF4444' },
  };
  return map[eventType] ?? { icon: 'ellipse-outline', color: '#6B7280' };
}

export function getEventLabel(eventType: string): string {
  const map: Record<string, string> = {
    login_success:            'Signed In',
    login_failed:             'Sign-In Failed',
    logout:                   'Signed Out',
    register:                 'Account Created',
    password_reset_request:   'Password Reset Requested',
    password_reset_complete:  'Password Reset',
    session_revoked:          'Device Session Revoked',
    all_sessions_revoked:     'All Sessions Revoked',
    security_settings_changed:'Security Settings Updated',
    otp_sent:                 'Verification Code Sent',
    otp_verified:             'Email Verified',
    otp_failed:               'Verification Failed',
  };
  return map[eventType] ?? eventType.replace(/_/g, ' ');
}
