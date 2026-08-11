
/**
 * usePushNotifications
 *
 * Responsibilities:
 *  1. Request notification permissions on first launch (persists answer in AsyncStorage).
 *  2. Obtain an Expo push token and store it in user_profiles.push_token.
 *  3. Schedule a daily 9 AM local notification for the Daily Challenge.
 *  4. Expose helpers for triggering push notifications via the send-push edge function.
 *
 * Called once from AppShell in app/_layout.tsx.
 *
 * Android: requires the Notifications plugin in app.json (already present via expo-notifications).
 * Permissions are re-requested whenever the user logs in so the token is
 * always linked to the correct profile.
 */

import { useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { loadNotificationPrefs } from '@/app/notification-preferences';

// ─── Constants ────────────────────────────────────────────────────────────────
const PUSH_TOKEN_KEY = '@predictxta/push_token';
const CHALLENGE_NOTIF_ID_KEY = '@predictxta/challenge_notif_id';
const PERMS_ASKED_KEY = '@predictxta/push_perms_asked';
const VIP_TIPS_NOTIF_ID_KEY = '@predictxta/vip_tips_notif_id';

// ─── Notification display handler (foreground) ────────────────────────────────
// Must be called before any notification is received.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Android notification channel ─────────────────────────────────────────────
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'PredictXta',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FFD700',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('score-alerts', {
    name: 'Score Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 150, 150, 150],
    lightColor: '#00FF87',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('challenge', {
    name: 'Daily Challenge',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#FFD700',
    sound: 'default',
  });
}

// ─── Permission request ────────────────────────────────────────────────────────
async function requestPermissions(): Promise<boolean> {
  if (!Device.isDevice) return false; // simulator — skip

  await ensureAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  // Only ask if we haven't asked before (avoid repeated prompts on every launch)
  const alreadyAsked = await AsyncStorage.getItem(PERMS_ASKED_KEY);
  if (alreadyAsked === 'true' && existingStatus === 'denied') return false;

  const { status } = await Notifications.requestPermissionsAsync();
  await AsyncStorage.setItem(PERMS_ASKED_KEY, 'true');
  return status === 'granted';
}

// ─── Get Expo push token ──────────────────────────────────────────────────────
async function getExpoPushToken(): Promise<string | null> {
  try {
    // Check cached token first
    const cached = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (cached) return cached;

    // expo-notifications requires a real EAS projectId for production.
    // In development / Expo Go, omit projectId — the SDK infers it from app.json.
    // In production EAS builds, the projectId is baked in at build time.
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (e) {
    // Gracefully handle missing projectId in dev / simulator environments
    // without crashing the app.
    if (__DEV__) {
      console.warn('[PushNotifications] Could not get push token (dev/simulator):', e);
    }
    return null;
  }
}

// ─── Store token in Supabase user_profiles ────────────────────────────────────
async function syncTokenToProfile(userId: string, token: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('user_profiles')
      .update({ push_token: token })
      .eq('id', userId);
  } catch { /* non-blocking */ }
}

// ─── Schedule 9 AM daily challenge local notification ─────────────────────────
async function scheduleDailyChallenge(enabled: boolean): Promise<void> {
  try {
    // Always cancel existing notification first
    const prevId = await AsyncStorage.getItem(CHALLENGE_NOTIF_ID_KEY);
    if (prevId) {
      await Notifications.cancelScheduledNotificationAsync(prevId).catch(() => null);
      await AsyncStorage.removeItem(CHALLENGE_NOTIF_ID_KEY);
    }

    if (!enabled) return; // user opted out

    // Schedule recurring daily trigger at 09:00 local time
    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🏆 Daily Challenge is Live!',
        body: "Today's 3 picks are ready. Can you go perfect?",
        data: { screen: 'challenge' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: true,
        hour: 9,
        minute: 0,
      },
    });

    await AsyncStorage.setItem(CHALLENGE_NOTIF_ID_KEY, notifId);
  } catch { /* non-blocking — scheduling may fail on web/simulator */ }
}

// ─── Schedule VIP Tips alert (once per day at 12:00) ────────────────────────
async function scheduleVipTipsAlert(enabled: boolean): Promise<void> {
  try {
    const prevId = await AsyncStorage.getItem(VIP_TIPS_NOTIF_ID_KEY);
    if (prevId) {
      await Notifications.cancelScheduledNotificationAsync(prevId).catch(() => null);
      await AsyncStorage.removeItem(VIP_TIPS_NOTIF_ID_KEY);
    }

    if (!enabled) return;

    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '👑 New VIP Expert Tips',
        body: "Today's expert tips are ready. Check the VIP feed.",
        data: { screen: 'vip' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: true,
        hour: 12,
        minute: 0,
      },
    });

    await AsyncStorage.setItem(VIP_TIPS_NOTIF_ID_KEY, notifId);
  } catch { /* non-blocking */ }
}

// ─── Send push via edge function ──────────────────────────────────────────────
export async function sendPushToUser(params: {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.functions.invoke('send-push', { body: params });
  } catch { /* non-blocking */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
interface UsePushNotificationsOptions {
  userId?: string;
}

export function usePushNotifications({ userId }: UsePushNotificationsOptions) {
  const initializedRef = useRef(false);

  const setup = useCallback(async () => {
    // Only run once per user session to avoid repeated permission prompts
    if (initializedRef.current) return;
    initializedRef.current = true;

    const granted = await requestPermissions();
    if (!granted) {
      // Even without permission, cancel any leftover scheduled notifications
      await scheduleDailyChallenge(false);
      await scheduleVipTipsAlert(false);
      return;
    }

    // Get token and sync to profile
    const token = await getExpoPushToken();
    if (token && userId) {
      await syncTokenToProfile(userId, token);
    }

    // Load user notification preferences and schedule accordingly
    const prefs = await loadNotificationPrefs();

    // Daily Challenge reminder — controlled by dailyChallenge preference
    await scheduleDailyChallenge(prefs.dailyChallenge);

    // VIP Tips alert — controlled by vipTipsAlerts preference
    await scheduleVipTipsAlert(prefs.vipTipsAlerts);

    // Note: matchReminders and liveScoreAlerts are event-driven (scheduled
    // on demand when a user follows a match) so they are handled separately
    // in useFollowedMatches / useScoreAlerts. If the user disables those
    // preferences, we cancel all existing match-scoped reminders below.
    if (!prefs.matchReminders) {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        const matchNotifs = scheduled.filter(
          (n) => n.identifier.startsWith('match_reminder_') ||
                 (n.content.data as any)?.matchId
        );
        await Promise.allSettled(
          matchNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
        );
      } catch { /* non-blocking */ }
    }
  }, [userId]);

  useEffect(() => {
    // Small delay so navigation finishes mounting before showing permission dialog
    const timer = setTimeout(setup, 2000);
    return () => clearTimeout(timer);
  }, [setup]);

  // Re-run when user logs in (userId changes from undefined → defined)
  useEffect(() => {
    if (!userId) return;
    initializedRef.current = false; // allow re-run for new user
    setup();
  }, [userId, setup]); // Added 'setup' to the dependency array
}
