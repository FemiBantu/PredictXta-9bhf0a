
import { Stack, useRouter } from 'expo-router';
import '@/services/i18n'; // initialise i18next before any component renders
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertProvider, AuthProvider, useAuth } from '@/template';
import { ErrorBoundary } from '@/components/feature/ErrorBoundary';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useFollowedMatches } from '@/hooks/useFollowedMatches';
import { useScoreAlerts } from '@/hooks/useScoreAlerts';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { ToastStack } from '@/components/ui/Toast';
import type { ToastItem } from '@/components/ui/Toast';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { initLogoCache } from '@/services/logoCache';
import { startSelfHealing, stopSelfHealing } from '@/services/selfHealingService';
import BackgroundSyncManager from '@/components/feature/BackgroundSyncManager';
import { CookieConsentBanner } from '@/components/ui/CookieConsent';
import { OTAUpdateBanner } from '@/components/ui/OTAUpdateBanner';
import { FirstLaunchLanguagePrompt } from '@/components/ui/FirstLaunchLanguagePrompt';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { syncMatchesFromApi } from '@/services/matchService';
import { markSyncComplete } from '@/hooks/useMatches';
import { handleOAuthCallback as handleOAuthCallbackFn } from '@/services/googleAuthService';
// Apple OAuth shares the same predictxta://auth/callback deep-link path as Google.
// Both providers go through the PKCE exchange inside handleOAuthCallbackFn.
const handleGoogleOAuthCallback = handleOAuthCallbackFn;
import * as Notifications from 'expo-notifications';
import { useEffect, useState, useRef, useCallback } from 'react';

// ─── Initialise logo cache as early as possible (before any component renders) ─
// This is a module-level call so the in-memory store is warm by the time the
// first MatchCard / AI pick card tries a synchronous logo lookup.
initLogoCache();

// ─── Startup Match Sync (kept for legacy Live tab compatibility) ─────────────
function StartupSyncManager() {
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await syncMatchesFromApi('today', 'all');
        if (result) markSyncComplete();
      } catch { /* non-blocking */ }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

// ─── Self-Healing Service Manager ────────────────────────────────────────────
function SelfHealingManager() {
  useEffect(() => {
    startSelfHealing();
    return () => stopSelfHealing();
  }, []);
  return null;
}

// Mounts once inside SafeAreaProvider so it has access to insets
function ScoreAlertManager() {
  const insets = useSafeAreaInsets();
  const { followedIds } = useFollowedMatches();
  const { alerts, dismissAlert } = useScoreAlerts(followedIds);

  // ScoreAlert already has `sport`; ToastItem now accepts it too
  const toastItems = alerts.map((a) => ({
    id: a.id,
    matchLabel: a.matchLabel,
    message: a.message,
    sport: a.sport,
  }));

  return (
    <View
      style={{
        position: 'absolute', top: insets.top + 8,
        left: 0, right: 0, zIndex: 9999,
      }}
      pointerEvents="box-none"
    >
      <ToastStack toasts={toastItems} onDismiss={dismissAlert} />
    </View>
  );
}

// ─── In-App Notification Toast Manager ───────────────────────────────────────
// Listens for foreground notifications (e.g. 9 AM Daily Challenge) and shows
// a dismissible ToastStack banner while the app is open.
function NotificationToastManager() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listenerRef = useRef<Notifications.Subscription | null>(null);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    listenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        const { title, body, data } = notification.request.content;

        // Build a label from the notification title or a friendly default
        const matchLabel =
          data?.screen === 'challenge'
            ? '🏆 Daily Challenge'
            : (typeof title === 'string' ? title : 'PredictX');

        const message =
          typeof body === 'string' && body.length > 0
            ? body
            : "Today's challenge is live — can you go perfect?";

        const newToast: ToastItem = {
          id: `notif-${notification.request.identifier}-${Date.now()}`,
          matchLabel,
          message,
        };

        setToasts((prev) => {
          // Cap at 3 concurrent toasts; newest at front
          const deduped = prev.filter((t) => t.id !== newToast.id);
          return [newToast, ...deduped].slice(0, 3);
        });
      },
    );

    return () => {
      listenerRef.current?.remove();
    };
  }, []);

  if (toasts.length === 0) return null;

  // Offset below any score-alert toasts (score toasts are at insets.top + 8)
  // Add extra vertical room so both stacks don't collide
  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 8 + 82, // sits below one score-alert row
        left: 0,
        right: 0,
        zIndex: 9998,
      }}
      pointerEvents="box-none"
    >
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </View>
  );
}

// ─── Deep-link handler — navigates on notification tap ──────────────────────
function NotificationDeepLinkHandler() {
  const router = useRouter();
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Handle notification taps from lock screen / notification centre
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const screen = typeof data?.screen === 'string' ? data.screen : null;
        if (screen === 'challenge') {
          // Small delay lets the navigator finish mounting before pushing
          setTimeout(() => router.push('/challenge' as any), 300);
        } else if (screen === 'vip') {
          setTimeout(() => router.push('/vip' as any), 300);
        } else if (screen === 'live') {
          setTimeout(() => router.push('/(tabs)/live' as any), 300);
        }
      },
    );
    return () => {
      responseListenerRef.current?.remove();
    };
  }, []);

  return null;
}

// ─── Universal Deep-link Handler ─────────────────────────────────────────────
// Handles ALL incoming predictxta:// deep links:
//  1. predictxta://reset-password#access_token=...&type=recovery  (password reset)
//  2. predictxta://auth/callback?code=...                          (Google OAuth)
//  3. predictxta://auth/callback#access_token=...                  (Google OAuth implicit)
function PasswordResetDeepLinkHandler() {
  const router = useRouter();

  const processUrl = useCallback(async (url: string | null) => {
    if (!url) return;

    const { getSupabaseClient } = require('@/template');
    const supabase = getSupabaseClient();

    // ── Google OAuth callback ─────────────────────────────────────────────
    // Detect OAuth callback broadly: path-based OR any predictxta:// URL with
    // a code/token parameter. This catches both PKCE and implicit flows and
    // ensures resolvePendingOAuth() is called before the 10s timeout expires,
    // eliminating false E006 errors on Android Chrome Custom Tabs.
    const isOAuthCallback = (
      url.includes('/auth/callback') ||
      url.includes('auth-callback') ||
      url.includes('predictxta://auth') ||
      (url.startsWith('predictxta://') && url.includes('code=')) ||
      (url.startsWith('predictxta://') && url.includes('access_token='))
    );
    if (isOAuthCallback && !url.includes('reset-password') && !url.includes('type=recovery')) {
      try {
        await handleGoogleOAuthCallback(url);
        // handleOAuthCallback exchanges the PKCE code and calls
        // resolvePendingOAuth(), unblocking signInWithGoogleOAuth().
        // Session is now set — AuthRouter redirects to tabs automatically.
      } catch (err) {
        console.error('[DeepLink] OAuth callback error:', err);
      }
      return;
    }

    // ── Password Reset callback ───────────────────────────────────────────
    if (url.includes('reset-password') || url.includes('type=recovery')) {
      // Extract from fragment (legacy Supabase implicit flow)
      const fragment = url.split('#')[1] ?? url.split('?')[1] ?? '';
      const params = Object.fromEntries(
        fragment.split('&').map((p: string) => {
          const [k, ...rest] = p.split('=');
          return [k, decodeURIComponent(rest.join('='))];
        })
      );

      if (params.code) {
        // PKCE flow
        await supabase.auth.exchangeCodeForSession(params.code).catch(() => {});
        setTimeout(() => router.push('/reset-password' as any), 400);
      } else if (params.access_token && params.type === 'recovery') {
        // Implicit flow
        await supabase.auth
          .setSession({ access_token: params.access_token, refresh_token: params.refresh_token ?? '' })
          .catch(() => {});
        setTimeout(() => router.push('/reset-password' as any), 400);
      } else {
        // No token found yet — still navigate so user sees the reset form
        setTimeout(() => router.push('/reset-password' as any), 400);
      }
    }
  }, [router]);

  useEffect(() => {
    const { Linking } = require('react-native');

    // Handle cold-start deep link
    Linking.getInitialURL().then(processUrl).catch(() => {});

    // Handle foreground link open
    const sub = Linking.addEventListener('url', ({ url: incomingUrl }: { url: string }) => {
      processUrl(incomingUrl);
    });
    return () => sub?.remove();
  }, [processUrl]);

  return null;
}

// ─── Push Notification Manager ──────────────────────────────────────────────
// Must be inside AuthProvider to access the current user.
function PushNotificationManager() {
  const { user } = useAuth();
  usePushNotifications({ userId: user?.id });
  return null;
}

// Language prompt — shown on first launch
function LanguagePromptManager() {
  const { showFirstLaunchPrompt, loading } = useLanguage();
  if (loading || !showFirstLaunchPrompt) return null;
  return <FirstLaunchLanguagePrompt />;
}

// Inner shell — needs ThemeProvider to be mounted first
function AppShell() {
  const { colors, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <StartupSyncManager />
      <SelfHealingManager />
      <BackgroundSyncManager />
      <PushNotificationManager />
      <NotificationDeepLinkHandler />
      <PasswordResetDeepLinkHandler />
      <ScoreAlertManager />
      <NotificationToastManager />
      <LanguagePromptManager />
      <OTAUpdateBanner />
      <CookieConsentBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="match/[id]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="vip"
              options={{ headerShown: false, animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="notifications"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="settings"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="leaderboard"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="chat/[id]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="search"
              options={{ headerShown: false, animation: 'fade' }}
            />
            <Stack.Screen
              name="chat/vip"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="referral"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="challenge"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="notification-preferences"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-reports"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="coin-history"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="coin-earn"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="terms"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="privacy"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-tips"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-ai-audit"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-ai-monitor"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="accuracy"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="tips"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="expert-leaderboard"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="language-settings"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ai-pick/[id]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ai-picks-country/[country]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ai-picks-league/[leagueKey]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />

            <Stack.Screen
              name="reset-password"
              options={{ headerShown: false, animation: 'slide_from_bottom', gestureEnabled: false }}
            />
            <Stack.Screen
              name="onboarding"
              options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="live-stream-demo"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="security"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="sport-coverage-test"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="submit-tip"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="auth/callback"
              options={{ headerShown: false, animation: 'fade' }}
            />
            <Stack.Screen
              name="challenge-history"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="expert-rewards-history"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="expert-slip-detail/[id]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-pipeline"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-data-integrity"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-experts"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="admin-chat"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="bookmarks"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="audit-report"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="deployment-checklist"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="expert-slips"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="trends"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="privacy-web"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="oauth-debug"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="deep-link-diagnostics"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="account-deleted"
              options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="account-deletion-request"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
            {/* The duplicate <Stack.Screen> tag was causing the parsing error */}
            <Stack.Screen
              name="sports/[sport]"
              options={{ headerShown: false, animation: 'slide_from_right' }}
            />
          </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ErrorBoundary context="RootLayout">
    <AlertProvider>
      <ThemeProvider>
        <LanguageProvider>
          <SafeAreaProvider>
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          </SafeAreaProvider>
        </LanguageProvider>
      </ThemeProvider>
    </AlertProvider>
    </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
