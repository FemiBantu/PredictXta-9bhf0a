/**
 * services/googleAuthService.ts
 *
 * Google OAuth helper for PredictXta — PKCE flow via Supabase Auth.
 *
 * ─── Flow ──────────────────────────────────────────────────────────────────
 *  1. Call supabase.auth.signInWithOAuth({ skipBrowserRedirect: true })
 *     → receives the Google consent URL
 *  2. Open it via WebBrowser.openAuthSessionAsync(url, redirectUri)
 *     → system browser opens Google sign-in
 *  3. Google redirects to: predictxta://auth/callback?code=XXXX
 *     → expo-web-browser captures the redirect URI and resolves
 *  4. Extract ?code= and call supabase.auth.exchangeCodeForSession(code)
 *     → Supabase validates the PKCE code and returns a session
 *  5. AuthRouter detects the authenticated session → navigates to /(tabs)
 *
 * ─── ANDROID E006 ROOT CAUSES & FIXES ──────────────────────────────────────
 *  Root cause 1: prompt='consent' forces account picker inside CCT on every
 *    attempt. Extra navigation step causes CCT to close before redirect fires.
 *    Fix: use prompt='select_account' on first attempt; omit on retry.
 *
 *  Root cause 2: Chrome Custom Tabs fires the deep-link redirect BEFORE the
 *    openAuthSessionAsync promise resolves, returning { type: 'cancel' }.
 *    Fix: register a pending resolver BEFORE opening the browser so the
 *    deep-link handler (which may fire concurrently) can resolve it
 *    immediately rather than relying on polling.
 *
 *  Root cause 3: Intent filter for predictxta://auth/callback on Android
 *    needs multiple intent-filter entries — one for bare scheme, one per
 *    host/path combination. Fixed in app.json intentFilters.
 *
 *  Root cause 4: Race condition — resolver registered after browser open.
 *    Fix: resolver is registered BEFORE browser opens.
 *
 *  Root cause 5: Double code exchange when deep-link fires AND browser
 *    result both carry the same code. Fix: _exchangedCodes dedup set.
 *
 * ─── External config required ─────────────────────────────────────────────
 *  Supabase Dashboard → Auth → URL Configuration:
 *    Site URL:         predictxta://
 *    Redirect URLs:    predictxta://**
 *                      predictxta://auth/callback
 *                      predictxta://auth-callback
 *                      predictxta://reset-password
 *                      exp://**
 *
 *  Supabase Dashboard → Auth → Providers → Google:
 *    Enabled: ON
 *    Client ID:     <Web OAuth Client ID from Google Cloud Console>
 *    Client Secret: <Web OAuth Client Secret>
 *
 *  Google Cloud Console → Credentials:
 *    Web client:
 *      Authorized redirect URI: https://<project>.supabase.co/auth/v1/callback
 *    Android client:
 *      Package name:  com.predictxta.sports  ← must match app.json android.package
 *      SHA-1:         <debug or release keystore fingerprint>
 *    iOS client:
 *      Bundle ID:     com.predictxta.sports    ← must match app.json ios.bundleIdentifier (same as Android package)
 *
 *  Google Cloud Console → OAuth Consent Screen:
 *    Status: Published (or test users added)
 *    Scopes: openid, email, profile
 */

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getSupabaseClient } from '@/template';

// ─── Ensure web auth sessions complete (required for Expo web / Expo Go) ─────
WebBrowser.maybeCompleteAuthSession();

// ─── Error code catalogue ─────────────────────────────────────────────────────
export const GOOGLE_AUTH_ERRORS = {
  E001: 'E001: Google provider not enabled in Supabase. Go to Dashboard → Auth → Providers → Google.',
  E002: 'E002: No OAuth URL returned from Supabase. Check Client ID and Client Secret in Supabase Google provider settings.',
  E003: 'E003: redirect_uri_mismatch — the redirect URI is not listed in Supabase Auth → URL Configuration → Redirect URLs.',
  E004: 'E004: access_denied — OAuth consent screen not published or test user not added. Go to Google Cloud Console → OAuth Consent Screen.',
  E005: 'E005: Custom scheme not registered — this requires a native build (APK/IPA). Expo Go does not support custom scheme redirects for Google OAuth.',
  E006: 'E006: Browser session cancelled. If you completed sign-in and still see this, please try again — this can happen on Android due to a Chrome timing issue.',
  E007: 'E007: Browser opened but did not return a valid redirect URL.',
  E008: 'E008: Auth code exchange failed — the PKCE code may have expired. Please try again.',
  E009: 'E009: Implicit token session failed — access_token may be expired or malformed.',
  E010: 'E010: No auth code or token received from Google. Check Google Cloud OAuth client redirect URI configuration.',
  E011: 'E011: Android package name mismatch. Ensure Google Cloud Android OAuth client uses package name: com.predictxta.sports',
  E012: 'E012: iOS bundle ID mismatch. Ensure Google Cloud iOS OAuth client uses bundle ID: com.predictxta.sports',
  E013: 'E013: SHA-1 fingerprint not registered. Add your debug/release keystore SHA-1 in Google Cloud Console → Android OAuth client.',
} as const;

// ─── Pending OAuth resolution ─────────────────────────────────────────────────
// Key fix: resolver is registered BEFORE the browser opens so any concurrent
// deep-link (Android CCT fires redirect before promise resolves) is caught
// immediately without relying on polling intervals.
let _pendingResolver: ((session: unknown) => void) | null = null;
let _pendingRejecter: ((err: Error) => void) | null = null;

// Dedup: track codes already exchanged to prevent double-exchange on Android
// when both the deep-link handler AND the browser result carry the same code.
const _exchangedCodes = new Set<string>();

// Track how many times we have attempted Google sign-in in this session
// so we can skip prompt=consent on retries (reduces CCT navigation steps).
let _oauthAttemptCount = 0;

export function resolvePendingOAuth(session: unknown) {
  if (_pendingResolver) {
    const r = _pendingResolver;
    _pendingResolver = null;
    _pendingRejecter = null;
    r(session);
  }
}

export function rejectPendingOAuth(err: Error) {
  if (_pendingRejecter) {
    const r = _pendingRejecter;
    _pendingResolver = null;
    _pendingRejecter = null;
    r(err);
  }
}

export function hasPendingOAuth(): boolean {
  return _pendingResolver !== null;
}

/** Cancel any in-flight pending resolver (e.g. user navigates away). */
export function cancelPendingOAuth() {
  _pendingResolver = null;
  _pendingRejecter = null;
}

/** Clear exchanged-code cache — call on logout or session reset. */
export function clearExchangedCodes() {
  _exchangedCodes.clear();
}

// ─── Browser warm-up ─────────────────────────────────────────────────────────
export function warmUpBrowser(): void {
  if (Platform.OS !== 'web') {
    WebBrowser.warmUpAsync().catch(() => {});
  }
}

export function coolDownBrowser(): void {
  if (Platform.OS !== 'web') {
    WebBrowser.coolDownAsync().catch(() => {});
  }
}

// ─── Redirect URI ─────────────────────────────────────────────────────────────
/**
 * Returns the redirect URI for the current environment.
 *
 * Standalone native build → predictxta://auth/callback  (ALWAYS for production)
 * Web dev                 → window.location.origin/auth/callback
 *
 * IMPORTANT: We NEVER use Linking.createURL() for OAuth redirects in production.
 * Linking.createURL() may produce exp:// URLs in Expo Go or throw
 * "Cannot make a deep link into a standalone app with no custom scheme defined"
 * when EAS project metadata is missing. We hardcode the predictxta:// scheme
 * so standalone APK/IPA builds always work correctly.
 */
export function getRedirectUri(): string {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/auth/callback`;
    }
    return 'predictxta://auth/callback';
  }
  // Always use the hardcoded custom scheme — never Linking.createURL()
  // This is safe for both debug and release builds.
  return 'predictxta://auth/callback';
}

// ─── Result type ─────────────────────────────────────────────────────────────
export interface GoogleSignInResult {
  success: boolean;
  error?: string;
  errorCode?: keyof typeof GOOGLE_AUTH_ERRORS;
  session?: unknown;
}

// ─── Check if Supabase already has a session ─────────────────────────────────
async function checkExistingSession(): Promise<unknown | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

// ─── Register pending resolver (must be called BEFORE browser opens) ─────────
/**
 * Creates a Promise that resolves when:
 *  a) handleOAuthCallback() is called by the deep-link handler (fires first on Android)
 *  b) Supabase already has a valid session (polled every 350ms)
 *  c) Timeout expires (returns null — genuine cancel or failure)
 *
 * CRITICAL: This must be registered before WebBrowser.openAuthSessionAsync()
 * because on Android the CCT fires the deep link concurrently with the
 * browser open call, not after it resolves.
 */
function registerPendingOAuthAndWait(timeoutMs: number): Promise<unknown | null> {
  // If a previous resolver is dangling, clean it up first
  _pendingResolver = null;
  _pendingRejecter = null;

  return new Promise((resolve) => {
    let settled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const done = (session: unknown | null) => {
      if (settled) return;
      settled = true;
      _pendingResolver = null;
      _pendingRejecter = null;
      if (pollId) clearInterval(pollId);
      if (timerId) clearTimeout(timerId);
      resolve(session);
    };

    // Register resolver so handleOAuthCallback() can immediately resolve this
    _pendingResolver = (session) => done(session);
    _pendingRejecter = () => done(null);

    // Poll Supabase every 350ms — covers the case where the deep-link
    // fired and exchanged the code before we registered the resolver.
    pollId = setInterval(async () => {
      const session = await checkExistingSession();
      if (session) done(session);
    }, 350);

    // Timeout — genuine cancel or user did not complete sign-in
    timerId = setTimeout(() => done(null), timeoutMs);
  });
}

// ─── Main OAuth flow ─────────────────────────────────────────────────────────
export async function signInWithGoogleOAuth(): Promise<GoogleSignInResult> {
  try {
    const supabase  = getSupabaseClient();
    const redirectTo = getRedirectUri();
    _oauthAttemptCount += 1;

    console.log('[GoogleAuth] attempt:', _oauthAttemptCount);
    console.log('[GoogleAuth] redirect_uri:', redirectTo);
    console.log('[GoogleAuth] platform:', Platform.OS);

    // ── Step 1: Pre-warm Chrome CCT (Android) ────────────────────────────────
    if (Platform.OS === 'android') {
      await WebBrowser.warmUpAsync().catch(() => {});
    }

    // ── Step 2: Get Supabase OAuth URL ───────────────────────────────────────
    const promptValue = _oauthAttemptCount === 1 ? 'select_account' : undefined;

    const { data, error: urlError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          ...(promptValue ? { prompt: promptValue } : {}),
        },
      },
    });

    if (urlError) {
      const isNotEnabled = urlError.message?.toLowerCase().includes('provider') ||
                           urlError.message?.toLowerCase().includes('not enabled') ||
                           urlError.message?.toLowerCase().includes('unsupported');
      if (isNotEnabled) return { success: false, errorCode: 'E001', error: GOOGLE_AUTH_ERRORS.E001 };
      return { success: false, error: `Supabase OAuth URL error: ${urlError.message}` };
    }

    if (!data?.url) {
      return { success: false, errorCode: 'E002', error: GOOGLE_AUTH_ERRORS.E002 };
    }

    console.log('[GoogleAuth] OAuth URL obtained, registering pending resolver then opening browser...');

    // ── Step 3 (KEY FIX): Register the pending resolver BEFORE opening the
    //    browser so the deep-link handler can resolve it immediately if it
    //    arrives concurrently (Android CCT pattern).
    // Extended to 15s for slower devices / poor network conditions.
    const androidWaitPromise = (Platform.OS === 'android')
      ? registerPendingOAuthAndWait(15_000)
      : Promise.resolve(null);

    // ── Step 4: Open system browser ──────────────────────────────────────────
    let result: WebBrowser.WebBrowserAuthSessionResult;
    try {
      result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
        // showInRecents: false prevents CCT from emitting a secondary 'cancel'
        // signal when it appears in the recents list on Android
        showInRecents: false,
        // Keep cookies so the user does not have to re-enter Google credentials
        preferEphemeralSession: false,
        // dismissButtonStyle applies on iOS only
        dismissButtonStyle: 'cancel',
        // createTask: false prevents CCT from creating a new Android task
        // which can orphan the session on some Android versions
        createTask: false,
      } as any);
    } catch (browserErr: any) {
      cancelPendingOAuth();
      const msg = browserErr?.message ?? String(browserErr);
      console.error('[GoogleAuth] Browser error:', msg);
      if (Platform.OS === 'android') await WebBrowser.coolDownAsync().catch(() => {});
      if (msg.includes('no custom scheme') || msg.includes('deep link') || msg.includes('scheme')) {
        return { success: false, errorCode: 'E005', error: GOOGLE_AUTH_ERRORS.E005 };
      }
      return { success: false, error: `Browser open failed: ${msg}` };
    } finally {
      if (Platform.OS === 'android') WebBrowser.coolDownAsync().catch(() => {});
    }

    console.log('[GoogleAuth] Browser result type:', result.type);

    // ── Step 5: Handle Android CCT "cancel" — almost always a false positive ─
    if (result.type === 'cancel' || result.type === 'dismiss') {
      if (Platform.OS === 'android') {
        console.log('[GoogleAuth] Android CCT cancel/dismiss — awaiting pre-registered resolver...');
        // The resolver was registered BEFORE the browser opened (Step 3), so
        // if the deep-link already fired, androidWaitPromise has resolved by now.
        const session = await androidWaitPromise;
        if (session) {
          console.log('[GoogleAuth] Android deep-link resolved session — NOT a real E006');
          return { success: true, session };
        }
        // Extended retry: poll Supabase up to 6 × 500ms = 3 extra seconds
        // Covers edge case where CCT close fires before code exchange completes.
        for (let retry = 0; retry < 6; retry++) {
          await new Promise((r) => setTimeout(r, 500));
          const retrySession = await checkExistingSession();
          if (retrySession) {
            console.log(`[GoogleAuth] Android session found on retry ${retry + 1}`);
            return { success: true, session: retrySession };
          }
        }
        // Genuine cancel (user closed the browser)
        console.log('[GoogleAuth] Genuine Android cancel — no session found after retries');
      }
      // iOS / Web: genuine user cancellation
      return { success: false, errorCode: 'E006', error: GOOGLE_AUTH_ERRORS.E006 };
    }

    // On Android, if we reach here with 'success', cancel the androidWaitPromise
    // so it does not resolve after we have already handled the URL.
    cancelPendingOAuth();

    if (result.type !== 'success' || !result.url) {
      const existingSession = await checkExistingSession();
      if (existingSession) return { success: true, session: existingSession };
      return { success: false, errorCode: 'E007', error: GOOGLE_AUTH_ERRORS.E007 };
    }

    const redirectUrl = result.url;
    console.log('[GoogleAuth] Redirect URL received:', redirectUrl.split('?')[0] + '?[params]');

    // ── Step 6: Check for OAuth errors in redirect ───────────────────────────
    if (redirectUrl.includes('error=')) {
      let urlObj: URL | null = null;
      try { urlObj = new URL(redirectUrl); } catch { /* fallback below */ }
      const errorParam = urlObj?.searchParams.get('error') ?? extractParam(redirectUrl, 'error');
      const errorDesc  = urlObj?.searchParams.get('error_description') ?? extractParam(redirectUrl, 'error_description');
      const decoded    = errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : '';

      console.error('[GoogleAuth] OAuth error in redirect:', errorParam, decoded);

      if (errorParam === 'redirect_uri_mismatch') return { success: false, errorCode: 'E003', error: GOOGLE_AUTH_ERRORS.E003 };
      if (errorParam === 'access_denied')         return { success: false, errorCode: 'E004', error: GOOGLE_AUTH_ERRORS.E004 };
      return { success: false, error: decoded || errorParam || 'OAuth error from Google' };
    }

    // ── Step 7: Exchange code / tokens for session ───────────────────────────
    return await exchangeRedirectUrl(redirectUrl);

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error('[GoogleAuth] Unexpected error:', msg);
    cancelPendingOAuth();

    if (msg.includes('no custom scheme') || msg.includes('deep link')) {
      return { success: false, errorCode: 'E005', error: GOOGLE_AUTH_ERRORS.E005 };
    }
    if (msg.includes('SHA') || msg.includes('fingerprint') || msg.includes('signing')) {
      return { success: false, errorCode: 'E013', error: GOOGLE_AUTH_ERRORS.E013 };
    }
    return { success: false, error: `Unexpected error: ${msg}` };
  }
}

// ─── Exchange redirect URL for a Supabase session ────────────────────────────
async function exchangeRedirectUrl(redirectUrl: string): Promise<GoogleSignInResult> {
  const params = parseRedirectParams(redirectUrl);
  const supabase = getSupabaseClient();

  // PKCE code flow (preferred)
  if (params.code) {
    // Dedup: if this code was already exchanged by handleOAuthCallback(),
    // skip the exchange and return the existing session.
    if (_exchangedCodes.has(params.code)) {
      console.log('[GoogleAuth] Code already exchanged — returning existing session');
      const existingSession = await checkExistingSession();
      return { success: true, session: existingSession };
    }
    _exchangedCodes.add(params.code);
    console.log('[GoogleAuth] PKCE code found, exchanging for session...');
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) {
      _exchangedCodes.delete(params.code); // allow retry
      console.error('[GoogleAuth] Code exchange error:', exchangeError.message);
      return { success: false, errorCode: 'E008', error: `${GOOGLE_AUTH_ERRORS.E008} Detail: ${exchangeError.message}` };
    }
    console.log('[GoogleAuth] Session established via PKCE');
    return { success: true, session: sessionData?.session };
  }

  // Implicit flow fallback (access_token in fragment)
  if (params.access_token) {
    console.log('[GoogleAuth] Implicit access_token found, setting session...');
    const { data: sessionData, error: setError } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token ?? '',
    });
    if (setError) {
      console.error('[GoogleAuth] Set session error:', setError.message);
      return { success: false, errorCode: 'E009', error: `${GOOGLE_AUTH_ERRORS.E009} Detail: ${setError.message}` };
    }
    console.log('[GoogleAuth] Session established via implicit flow');
    return { success: true, session: sessionData?.session };
  }

  console.error('[GoogleAuth] No code or access_token in redirect URL');
  return { success: false, errorCode: 'E010', error: GOOGLE_AUTH_ERRORS.E010 };
}

// ─── Deep-link callback handler ──────────────────────────────────────────────
/**
 * Called from _layout.tsx Linking event listener when the app receives
 * an OAuth redirect deep link in the foreground.
 *
 * On Android: this fires BEFORE openAuthSessionAsync resolves, so we
 * call resolvePendingOAuth() to hand the session back to the waiting caller.
 */
export async function handleOAuthCallback(url: string): Promise<boolean> {
  if (!url) return false;

  const isAuthCallback = url.includes('auth/callback') ||
                         url.includes('auth-callback') ||
                         (url.includes('predictxta://') && url.includes('code='));

  if (!isAuthCallback) return false;

  console.log('[GoogleAuth] handleOAuthCallback:', url.split('?')[0] + '?[params]');

  try {
    const supabase = getSupabaseClient();
    const params = parseRedirectParams(url);

    if (params.error) {
      console.error('[GoogleAuth] Callback error:', params.error, params.error_description);
      rejectPendingOAuth(new Error(params.error));
      return false;
    }

    if (params.code) {
      // Dedup: skip if exchangeRedirectUrl has already (or will) exchange this code.
      if (_exchangedCodes.has(params.code)) {
        console.log('[GoogleAuth] Callback: code already exchanged, resolving with existing session');
        const existing = await checkExistingSession();
        if (existing) resolvePendingOAuth(existing);
        return true;
      }
      _exchangedCodes.add(params.code);
      const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        _exchangedCodes.delete(params.code); // allow retry
        console.error('[GoogleAuth] Callback code exchange error:', error.message);
        rejectPendingOAuth(error);
        return false;
      }
      console.log('[GoogleAuth] Callback PKCE exchange OK');
      resolvePendingOAuth(sessionData?.session);
      return true;
    }

    if (params.access_token) {
      const { data: sessionData, error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token ?? '',
      });
      if (error) {
        console.error('[GoogleAuth] Callback setSession error:', error.message);
        rejectPendingOAuth(error);
        return false;
      }
      console.log('[GoogleAuth] Callback implicit session OK');
      resolvePendingOAuth(sessionData?.session);
      return true;
    }
  } catch (e) {
    console.error('[GoogleAuth] handleOAuthCallback exception:', e);
    rejectPendingOAuth(e instanceof Error ? e : new Error(String(e)));
  }
  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Parses both query params (?key=value) and fragment params (#key=value)
 * from a redirect URL into a flat key-value object.
 */
function parseRedirectParams(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const [base, fragment] = url.split('#');
    const queryStr = base.includes('?') ? base.split('?')[1] : '';
    const fragmentStr = fragment ?? '';
    const combined = [queryStr, fragmentStr].filter(Boolean).join('&');
    combined.split('&').forEach((pair) => {
      const [k, ...rest] = pair.split('=');
      if (k) result[k] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    });
  } catch { /* ignore */ }
  return result;
}

function extractParam(url: string, key: string): string {
  const match = url.match(new RegExp(`[?&#]${key}=([^&#]*)`));
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
}
