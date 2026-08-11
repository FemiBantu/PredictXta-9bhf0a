/**
 * services/security.ts — Client-side security utilities for PredictXta
 *
 * Provides:
 *  1. Request signing helper (HMAC-SHA256) — matches server-side verification
 *  2. Input sanitization for form fields
 *  3. JWT expiry detection
 *  4. Sensitive data redaction for logging
 */

import * as Crypto from 'expo-crypto';

// ─── Input Sanitization ────────────────────────────────────────────────────────

/**
 * Strip HTML tags, null bytes, and zero-width chars from a string.
 * Use before sending user-typed text to the API.
 */
export function sanitizeInput(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')            // strip HTML tags
    .replace(/\0/g, '')                 // null bytes
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .trim();
}

/**
 * Validate an email address format.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validate a password meets minimum security requirements:
 * - At least 8 characters (matches Supabase auth settings)
 * - At least 1 uppercase, 1 lowercase, 1 digit
 */
export function validatePassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: 'Password must contain at least one digit.' };
  }
  return { valid: true, message: '' };
}

// ─── Sensitive Data Redaction ────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apiKey', 'api_key',
  'access_token', 'refresh_token', 'authorization',
  'push_token', 'fcm_token', 'service_role_key',
]);

/**
 * Redact sensitive keys in an object for safe logging.
 * Deep-clones the object and replaces sensitive values with '[REDACTED]'.
 */
export function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── JWT Helpers ─────────────────────────────────────────────────────────────

/**
 * Decode a JWT payload (base64) without verifying the signature.
 * Use only for reading expiry / user info client-side.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Returns true if the JWT is expired (or invalid).
 */
export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return Date.now() / 1000 > payload.exp;
}

/**
 * Returns seconds until JWT expiry (negative if already expired).
 */
export function jwtExpiresInSeconds(token: string): number {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return -1;
  return Math.floor(payload.exp - Date.now() / 1000);
}

// ─── HMAC-SHA256 Request Signing ─────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 request signature headers for edge function calls.
 *
 * Usage (optional — only needed when PREDICTXTA_SIGNING_SECRET is deployed):
 *
 *   const sigHeaders = await signRequest(JSON.stringify(body), signingSecret);
 *   supabase.functions.invoke('generate-prediction', {
 *     body,
 *     headers: sigHeaders,
 *   });
 *
 * Matches the `verifyRequestSignature()` logic in _shared/security.ts.
 */
export async function signRequest(
  bodyString: string,
  secret: string,
): Promise<{ 'X-PX-Signature': string; 'X-PX-Timestamp': string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `${timestamp}:${bodyString}`;

  // Use expo-crypto for React Native compatibility
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    message,
    { encoding: Crypto.CryptoEncoding.HEX },
  );

  return {
    'X-PX-Signature': digest,
    'X-PX-Timestamp': timestamp,
  };
}

// ─── Content Security Checks ──────────────────────────────────────────────────

/**
 * Check if a URL is safe to open (no javascript: or data: schemes).
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate a username: 3-30 chars, alphanumeric + underscore only.
 */
export function isValidUsername(username: string): { valid: boolean; message: string } {
  if (username.length < 3) return { valid: false, message: 'Username must be at least 3 characters.' };
  if (username.length > 30) return { valid: false, message: 'Username must be 30 characters or less.' };
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, message: 'Username can only contain letters, numbers, and underscores.' };
  }
  return { valid: true, message: '' };
}

// ─── Rate Limit UI Helper ─────────────────────────────────────────────────────

/**
 * Parse a 429 response and return the retry-after seconds.
 */
export async function parseRateLimitError(response: Response): Promise<{
  isRateLimit: boolean;
  retryAfter: number;
  message: string;
}> {
  if (response.status !== 429) {
    return { isRateLimit: false, retryAfter: 0, message: '' };
  }
  const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10);
  try {
    const body = await response.json();
    return {
      isRateLimit: true,
      retryAfter,
      message: body.error ?? 'Too many requests. Please try again later.',
    };
  } catch {
    return { isRateLimit: true, retryAfter, message: 'Too many requests. Please try again later.' };
  }
}
