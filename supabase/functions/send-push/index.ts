import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

/**
 * send-push edge function — Expo Push + Firebase Cloud Messaging v1 API
 *
 * Delivers push notifications via:
 *  1. Expo Push API  — ExponentPushToken devices (iOS Expo Go + managed builds)
 *  2. FCM v1 API     — Native Android / iOS FCM tokens via OAuth2 service account JWT
 *
 * FCM v1 replaces the deprecated Legacy HTTP API (shutdown June 2024).
 * Auth: RS256 JWT signed with service account private key → exchanges for short-lived
 * OAuth2 access token → used as Bearer on FCM v1 endpoint.
 *
 * Required Supabase secrets:
 *  - FIREBASE_SERVICE_ACCOUNT_JSON  (full service account JSON from Firebase Console)
 *  - FIREBASE_PROJECT_ID            (e.g. "predictxta-app")
 *
 * Request body:
 * {
 *   userIds: string[];
 *   title: string;
 *   body: string;
 *   data?: Record<string, unknown>;
 *   channelId?: string;
 *   contentType?: string;
 * }
 */

const EXPO_PUSH_URL  = 'https://exp.host/--/api/v2/push/send';
const FCM_SCOPE      = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL  = 'https://oauth2.googleapis.com/token';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SendPushRequest {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  contentType?: string;
}

interface UserProfile {
  id: string;
  push_token: string | null;
  preferred_language: string | null;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

// ─── JWT / OAuth2 helpers ────────────────────────────────────────────────────

/**
 * Base64url-encode a Uint8Array (no padding, URL-safe chars).
 */
function base64url(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert PEM private key string to CryptoKey for RS256 signing.
 * Deno's Web Crypto supports PKCS#8 DER import.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and newlines
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binaryStr = atob(pemBody);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Create a signed RS256 JWT for Google OAuth2 service-account flow.
 * JWT lifetime: 3600 seconds (1 hour) — matches Google's max allowed.
 */
async function createServiceAccountJWT(sa: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: FCM_TOKEN_URL,
    scope,
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(obj)));

  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signingBytes = new TextEncoder().encode(signingInput);

  const key = await importPrivateKey(sa.private_key);
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signingBytes);

  return `${signingInput}.${base64url(new Uint8Array(sigBytes))}`;
}

/**
 * Exchange a service-account JWT for a short-lived Google OAuth2 access token.
 * Cached in module-level variable for the process lifetime (≤15 min in Deno Deploy).
 */
let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  // Reuse cached token if it has >5 min remaining
  if (_cachedToken && now < _cachedToken.expiresAt - 300_000) {
    return _cachedToken.token;
  }

  const jwt = await createServiceAccountJWT(sa, FCM_SCOPE);

  const res = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const token: string = json.access_token;
  const expiresIn: number = json.expires_in ?? 3600;

  _cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

// ─── Translation helper ───────────────────────────────────────────────────────
async function translateText(
  supabaseUrl: string,
  serviceKey: string,
  text: string,
  targetLanguage: string,
  contentType: string,
): Promise<string> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/translate-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ text, targetLanguage, sourceLanguage: 'en', contentType }),
    });
    if (!resp.ok) return text;
    const result = await resp.json();
    return result.translated ?? text;
  } catch {
    return text;
  }
}

// ─── FCM v1 batch sender ──────────────────────────────────────────────────────
/**
 * Send notifications to FCM tokens using the FCM v1 HTTP API.
 * FCM v1 does NOT support multicast (registration_ids), so we send one
 * request per token but process them in controlled concurrency batches.
 *
 * Endpoint: POST /v1/projects/{projectId}/messages:send
 * Auth:     Bearer {OAuth2 access token from service account}
 */
async function sendFcmV1Batch(
  sa: ServiceAccount,
  projectId: string,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  channelId = 'default',
): Promise<{ sent: number; errors: number }> {
  if (tokens.length === 0) return { sent: 0, errors: 0 };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    console.error('[send-push] FCM v1 token error:', e);
    return { sent: 0, errors: tokens.length };
  }

  const FCM_URL = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  // Stringify all data values (FCM requires string map)
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  let sent = 0;
  let errors = 0;

  // Process tokens in concurrency batches of 10 to avoid rate limits
  const CONCURRENCY = 10;
  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (token) => {
        try {
          const res = await fetch(FCM_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body },
                data: stringData,
                android: {
                  priority: 'HIGH',
                  notification: {
                    channel_id: channelId,
                    sound: 'default',
                    click_action: 'FLUTTER_NOTIFICATION_CLICK',
                  },
                },
                apns: {
                  payload: {
                    aps: {
                      alert: { title, body },
                      sound: 'default',
                    },
                  },
                },
              },
            }),
          });

          if (res.ok) {
            sent++;
          } else {
            const errJson = await res.json().catch(() => ({}));
            const errMsg = errJson?.error?.message ?? res.statusText;
            // UNREGISTERED / INVALID_ARGUMENT = stale token — not a real error
            if (
              errMsg?.includes('UNREGISTERED') ||
              errMsg?.includes('INVALID_ARGUMENT')
            ) {
              console.log(`[send-push] FCM v1 stale token removed: ${token.slice(0, 20)}…`);
            } else {
              console.warn(`[send-push] FCM v1 error for token: ${errMsg}`);
            }
            errors++;
          }
        } catch (e) {
          console.warn(`[send-push] FCM v1 request error:`, e);
          errors++;
        }
      }),
    );
  }

  console.log(`[send-push] FCM v1: sent=${sent} errors=${errors} total=${tokens.length}`);
  return { sent, errors };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    // ── Security middleware ───────────────────────────────────────────────────
    const { guard, body: parsedBody } = await applySecurityMiddleware(req, {
      rateLimit: { max: 50, windowSec: 60, blockSec: 120 },
      maxPayloadBytes: 256_000,
      rateLimitScope: 'push',
      blockBotUa: true,
      sanitizeInput: true,
      verifySignature: false,
    });
    if (guard) return guard;

    const payload = parsedBody as SendPushRequest;
    const {
      userIds,
      title,
      body,
      data,
      channelId = 'default',
      contentType = 'notification',
    } = payload;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return secureErrorResponse('userIds must be a non-empty array', 400);
    }
    if (!title || !body) {
      return secureErrorResponse('title and body are required', 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // ── Load FCM v1 service account ───────────────────────────────────────────
    const saJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    const projectId = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';

    let serviceAccount: ServiceAccount | null = null;
    if (saJson) {
      try {
        serviceAccount = JSON.parse(saJson) as ServiceAccount;
      } catch {
        console.warn('[send-push] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON — FCM v1 disabled');
      }
    } else {
      console.warn('[send-push] FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM v1 push will be skipped');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // ── Fetch profiles ────────────────────────────────────────────────────────
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, push_token, preferred_language')
      .in('id', userIds)
      .not('push_token', 'is', null);

    if (profilesError) {
      return secureErrorResponse('Failed to fetch user profiles', 500);
    }

    if (!profiles || profiles.length === 0) {
      return secureResponse({ sent: 0, fcmSent: 0, errors: [], message: 'No push tokens found' });
    }

    // ── Split tokens: Expo vs FCM ─────────────────────────────────────────────
    const expoProfiles = (profiles as UserProfile[]).filter(
      (p) => p.push_token?.startsWith('ExponentPushToken['),
    );
    const fcmTokens = (profiles as UserProfile[])
      .map((p) => p.push_token)
      .filter((t): t is string => Boolean(t) && !t.startsWith('ExponentPushToken['));

    // ── Group Expo users by language ──────────────────────────────────────────
    const byLanguage = new Map<string, UserProfile[]>();
    for (const profile of expoProfiles) {
      const lang = profile.preferred_language ?? 'en';
      if (!byLanguage.has(lang)) byLanguage.set(lang, []);
      byLanguage.get(lang)!.push(profile);
    }

    // ── Translate for non-English languages ───────────────────────────────────
    const translationCache = new Map<string, { title: string; body: string }>();
    translationCache.set('en', { title, body });

    const nonEnglishLangs = [...byLanguage.keys()].filter((l) => l !== 'en');
    await Promise.all(
      nonEnglishLangs.map(async (lang) => {
        const [translatedTitle, translatedBody] = await Promise.all([
          translateText(supabaseUrl, serviceKey, title, lang, contentType),
          translateText(supabaseUrl, serviceKey, body, lang, contentType),
        ]);
        translationCache.set(lang, { title: translatedTitle, body: translatedBody });
      }),
    );

    // ── Build Expo messages ───────────────────────────────────────────────────
    const messages: ExpoPushMessage[] = expoProfiles.map((profile) => {
      const lang = profile.preferred_language ?? 'en';
      const translated = translationCache.get(lang) ?? translationCache.get('en')!;
      return {
        to: profile.push_token!,
        title: translated.title,
        body: translated.body,
        data: data ?? {},
        channelId,
        sound: 'default',
        priority: 'high',
      };
    });

    // ── Expo delivery ─────────────────────────────────────────────────────────
    const BATCH_SIZE = 100;
    const errors: string[] = [];
    let expoSent = 0;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      try {
        const expoResponse = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });
        if (!expoResponse.ok) {
          errors.push(`Expo API error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${await expoResponse.text()}`);
          continue;
        }
        const result = await expoResponse.json() as { data: ExpoPushTicket[] };
        for (const ticket of (result.data ?? [])) {
          if (ticket.status === 'ok') expoSent++;
          else errors.push(`Token error: ${ticket.message ?? 'unknown'}`);
        }
      } catch (e) {
        errors.push(`Expo batch error: ${String(e)}`);
      }
    }

    // ── FCM v1 delivery ───────────────────────────────────────────────────────
    let fcmSent = 0;
    if (serviceAccount && projectId && fcmTokens.length > 0) {
      const { sent, errors: fcmErrors } = await sendFcmV1Batch(
        serviceAccount,
        projectId,
        fcmTokens,
        title,
        body,
        (data as Record<string, unknown>) ?? {},
        channelId,
      );
      fcmSent = sent;
      if (fcmErrors > 0) errors.push(`FCM v1: ${fcmErrors} delivery failures`);
    } else if (fcmTokens.length > 0) {
      errors.push('FCM v1: skipped — FIREBASE_SERVICE_ACCOUNT_JSON not configured');
    }

    const langSummary = [...byLanguage.entries()]
      .map(([l, users]) => `${l}:${users.length}`)
      .join(', ');

    console.log(
      `[send-push] Expo=${expoSent}/${messages.length} FCMv1=${fcmSent}/${fcmTokens.length} langs=${langSummary} errors=${errors.length}`,
    );

    return secureResponse({
      sent: expoSent,
      fcmSent,
      errors,
      languages: Object.fromEntries([...byLanguage.entries()].map(([l, u]) => [l, u.length])),
    });
  } catch (err) {
    console.error('[send-push] unexpected error:', err);
    return secureErrorResponse('Internal server error', 500);
  }
});
