/**
 * services/appleAuthService.ts
 *
 * Apple Sign-In integration for PredictXta.
 *
 * Flow (native iOS):
 *  1. Generate a random nonce and SHA-256 hash it.
 *  2. Call AppleAuthentication.signInAsync() — native Apple dialog.
 *  3. Apple returns a signed JWT (identityToken) + optional nonce verification.
 *  4. Exchange identityToken + rawNonce with Supabase for a session.
 *
 * Flow (Android / Web):
 *  Apple Sign-In is iOS-only via the native SDK. On Android we fall back to
 *  an OAuth web flow through Supabase (opens system browser).
 *  On web we do the same OAuth redirect approach.
 *
 * Required configuration:
 *  - Apple Developer Console → Certificates → Sign In with Apple:
 *      Service ID: com.predictxta.app
 *      Return URL: https://<supabase-project>.supabase.co/auth/v1/callback
 *  - Supabase Dashboard → Auth → Providers → Apple:
 *      Enable, add Team ID, Key ID, Private Key, Bundle/Service ID
 *  - app.json → plugins → expo-apple-authentication (already added)
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@/template';

export interface AppleSignInResult {
  success: boolean;
  error?: string;
  session?: unknown;
}

// ─── Nonce helpers ────────────────────────────────────────────────────────────
function generateRawNonce(length = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw,
  );
  return digest;
}

// ─── iOS native Apple Sign-In ─────────────────────────────────────────────────
async function signInWithAppleNative(): Promise<AppleSignInResult> {
  try {
    // Dynamic import so Android/web don't crash on missing native module
    const AppleAuthentication = await import('expo-apple-authentication');

    // Check availability (requires iOS 13+)
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      return {
        success: false,
        error: 'Apple Sign-In is not available on this device. Requires iOS 13+.',
      };
    }

    // Generate nonce for replay-attack protection
    const rawNonce = generateRawNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    // Show the Apple authentication dialog
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    const identityToken = credential.identityToken;
    if (!identityToken) {
      return { success: false, error: 'Apple did not return an identity token.' };
    }

    // Exchange with Supabase
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, session: data?.session };
  } catch (e: any) {
    // ERR_REQUEST_CANCELED is thrown when user taps "Cancel" in the Apple dialog
    if (e?.code === 'ERR_REQUEST_CANCELED') {
      return { success: false, error: 'Apple Sign-In was cancelled.' };
    }
    return { success: false, error: e?.message ?? 'Apple Sign-In failed.' };
  }
}

// ─── Android / Web OAuth fallback ─────────────────────────────────────────────
async function signInWithAppleOAuth(): Promise<AppleSignInResult> {
  try {
    const WebBrowser = await import('expo-web-browser');
    const supabase = getSupabaseClient();

    // IMPORTANT: Always use the hardcoded custom scheme — never Linking.createURL().
    // Linking.createURL() throws "Cannot make a deep link into a standalone app
    // with no custom scheme defined" in production standalone builds.
    const redirectTo = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'predictxta://auth/callback')
      : 'predictxta://auth/callback';

    const { data, error: urlError } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (urlError || !data?.url) {
      return { success: false, error: urlError?.message ?? 'Failed to get Apple OAuth URL' };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { success: false, error: 'Apple Sign-In was cancelled.' };
    }

    if (result.type !== 'success' || !result.url) {
      return { success: false, error: 'Apple Sign-In did not complete successfully.' };
    }

    const redirectUrl = result.url;
    const hasFragment = redirectUrl.includes('#');
    const paramString = hasFragment ? redirectUrl.split('#')[1] : redirectUrl.split('?')[1] ?? '';
    const params = Object.fromEntries(
      paramString.split('&').map((p) => {
        const [k, ...rest] = p.split('=');
        return [k, decodeURIComponent(rest.join('='))];
      })
    );

    if (params.code) {
      const { data: sd, error: se } = await supabase.auth.exchangeCodeForSession(params.code);
      if (se) return { success: false, error: se.message };
      return { success: true, session: sd?.session };
    }

    if (params.access_token) {
      const { data: sd, error: se } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token ?? '',
      });
      if (se) return { success: false, error: se.message };
      return { success: true, session: sd?.session };
    }

    return { success: false, error: 'No auth code or token received from Apple.' };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Apple Sign-In failed.' };
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
/**
 * Sign in with Apple.
 * - iOS: uses native `expo-apple-authentication` dialog.
 * - Android/Web: falls back to OAuth web browser flow via Supabase.
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  if (Platform.OS === 'ios') {
    return signInWithAppleNative();
  }
  return signInWithAppleOAuth();
}

/**
 * Check if Apple Sign-In is available on this device (iOS 13+).
 * Returns true on Android/web (where web OAuth is used instead).
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true; // Android uses OAuth fallback
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    return AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}
