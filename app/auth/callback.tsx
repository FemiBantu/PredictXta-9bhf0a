/**
 * app/auth/callback.tsx
 *
 * OAuth callback screen — receives the redirect from Google / Apple after
 * the user completes authentication.
 *
 * Deep link patterns handled:
 *   predictxta://auth/callback?code=XXXX          (PKCE flow — Google/Apple OAuth)
 *   predictxta://auth/callback#access_token=XXXX  (implicit flow — legacy)
 *
 * Responsibilities:
 *  1. Extract auth code / tokens from the incoming URL (cold-start OR foreground link)
 *  2. Exchange them for a Supabase session (PKCE: exchangeCodeForSession)
 *  3. Persist the session (Supabase client does this automatically)
 *  4. Navigate to main tabs — AuthRouter will redirect to login if exchange failed
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet, Animated, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '@/constants/theme';
import { handleOAuthCallback } from '@/services/googleAuthService';
import { getSupabaseClient } from '@/template';

type Status = 'loading' | 'success' | 'error';

// Parse any URL and exchange code / tokens for a session
async function exchangeUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!url) return { ok: false, error: 'No URL received' };

  // ── PKCE code flow (Google + Apple OAuth) ───────────────────────────────
  const hasFragment = url.includes('#');
  const paramString = hasFragment ? url.split('#')[1] : url.split('?')[1] ?? '';
  const params: Record<string, string> = {};
  paramString.split('&').forEach((p) => {
    const [k, ...rest] = p.split('=');
    if (k) params[k] = decodeURIComponent(rest.join('='));
  });

  // Error case
  if (params.error) {
    return {
      ok: false,
      error: params.error_description
        ? decodeURIComponent(params.error_description)
        : params.error,
    };
  }

  const supabase = getSupabaseClient();

  // PKCE auth code
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Implicit access_token (legacy fallback)
  if (params.access_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token ?? '',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Already handled upstream (e.g., googleAuthService / _layout.tsx)
  // Check if we already have a valid session
  const { data } = await supabase.auth.getSession();
  if (data?.session) return { ok: true };

  return { ok: false, error: 'No auth code or token found in callback URL' };
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const processedRef = useRef(false);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Completing sign-in...');
  const [provider, setProvider] = useState<'google' | 'apple' | 'unknown'>('unknown');

  // Animate the spinner ring
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const handle = async () => {
      try {
        // 1. Get incoming URL (cold-start deep link)
        const url = await Linking.getInitialURL();

        if (url) {
          // Detect provider from URL
          if (url.includes('google')) setProvider('google');
          else if (url.includes('apple')) setProvider('apple');

          setMessage('Verifying your identity...');

          // 2. Try the dedicated OAuth callback handler first (handles both
          //    Google and Apple via handleOAuthCallback in googleAuthService)
          const handledByService = await handleOAuthCallback(url);

          if (!handledByService) {
            // 3. Fallback: direct exchange
            const result = await exchangeUrl(url);
            if (!result.ok) {
              setStatus('error');
              setMessage(result.error ?? 'Sign-in failed. Please try again.');
              setTimeout(() => router.replace('/login' as any), 3000);
              return;
            }
          }
        } else {
          // URL not available yet — check if session was already set by
          // PasswordResetDeepLinkHandler in _layout.tsx (foreground link path)
          await new Promise((res) => setTimeout(res, 800));
          const supabase = getSupabaseClient();
          const { data } = await supabase.auth.getSession();
          if (!data?.session) {
            // No session and no URL — something went wrong, return to login
            setStatus('error');
            setMessage('Sign-in could not be completed. Please try again.');
            setTimeout(() => router.replace('/login' as any), 2500);
            return;
          }
        }

        // 4. Success — show tick then navigate
        setStatus('success');
        setMessage('Welcome to PredictXta!');
        setTimeout(() => router.replace('/(tabs)' as any), 1200);
      } catch (e: any) {
        setStatus('error');
        setMessage(e?.message ?? 'An unexpected error occurred. Please try again.');
        setTimeout(() => router.replace('/login' as any), 3000);
      }
    };

    handle();
  }, []);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const PROVIDER_LABEL =
    provider === 'google' ? 'Google' : provider === 'apple' ? 'Apple' : '';

  return (
    <View style={s.root}>
      <Animated.View style={[s.card, { transform: [{ scale: scaleAnim }] }]}>

        {/* Spinner / icon */}
        {status === 'loading' ? (
          <View style={s.spinnerWrap}>
            <Animated.View style={[s.ring, { transform: [{ rotate }] }]} />
            <View style={s.logoInner}>
              {provider === 'google' ? (
                <Text style={s.providerLetter}>G</Text>
              ) : provider === 'apple' ? (
                <Text style={[s.providerLetter, { color: '#fff', fontSize: 26 }]}>&#xF8FF;</Text>
              ) : (
                <ActivityIndicator size="small" color={COLORS.primary} />
              )}
            </View>
          </View>
        ) : status === 'success' ? (
          <View style={[s.iconCircle, { backgroundColor: '#22C55E18', borderColor: '#22C55E44' }]}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
          </View>
        ) : (
          <View style={[s.iconCircle, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
            <Ionicons name="close-circle" size={48} color="#EF4444" />
          </View>
        )}

        {/* Text */}
        <Text style={[s.title, {
          color: status === 'success' ? '#22C55E' : status === 'error' ? '#EF4444' : COLORS.textPrimary,
        }]}>
          {status === 'loading'
            ? `Signing in${PROVIDER_LABEL ? ` with ${PROVIDER_LABEL}` : ''}...`
            : status === 'success'
            ? 'Sign-in Successful!'
            : 'Sign-in Failed'}
        </Text>

        <Text style={s.message}>{message}</Text>

        {/* Progress dots for loading state */}
        {status === 'loading' ? (
          <View style={s.dots}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[s.dot, { backgroundColor: COLORS.primary, opacity: 0.3 + i * 0.3 }]}
              />
            ))}
          </View>
        ) : null}

        {/* Status footer */}
        <View style={s.footer}>
          <Ionicons
            name={status === 'error' ? 'lock-open-outline' : 'shield-checkmark-outline'}
            size={12}
            color={status === 'error' ? '#EF4444' : COLORS.textMuted}
          />
          <Text style={[s.footerText, { color: status === 'error' ? '#EF4444' : COLORS.textMuted }]}>
            {status === 'error'
              ? 'Redirecting to login...'
              : 'Secured by Supabase Auth · End-to-end encrypted'}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 40,
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 340,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },

  // Spinner
  spinnerWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  ring: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.primary,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  logoInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerLetter: {
    fontSize: 24,
    fontWeight: '900',
    color: '#4285F4',
  },

  // Status icon
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  // Text
  title: {
    fontSize: 18,
    fontWeight: FONTS.bold,
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    width: '100%',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 10,
    textAlign: 'center',
  },
});
