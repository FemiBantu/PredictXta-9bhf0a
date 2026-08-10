/**
 * OTAUpdateBanner.tsx
 * Dismissible in-app banner shown when an OTA update is available.
 * Guards: skipped on web, in dev mode, and on simulators.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';

// ─── Guard: only import expo-updates on supported platforms ──────────────────
// expo-updates is a no-op in bare workflow or when updates are disabled.
// We lazy-require it to avoid crashes on web SSR and in Jest.
let Updates: typeof import('expo-updates') | null = null;
let useUpdatesHook: typeof import('expo-updates').useUpdates | null = null;

if (Platform.OS !== 'web') {
  try {
    const mod = require('expo-updates');
    Updates = mod;
    useUpdatesHook = mod.useUpdates ?? null;
  } catch {
    // expo-updates not installed or not available
  }
}

// ─── Inner component (only rendered on native) ────────────────────────────────
function OTABannerInner() {
  const { colors: C } = useTheme();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Use the hook if available (expo-updates ≥ 0.20)
  const updatesState = useUpdatesHook ? useUpdatesHook() : null;

  // Fallback: manual polling when useUpdates is unavailable
  const [manualAvailable, setManualAvailable] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (useUpdatesHook || !Updates || __DEV__) return;

    const check = async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          setManualAvailable(true);
        }
      } catch {
        // Network unavailable or no update channel configured — silent
      }
    };

    check();
    // Re-check every 30 minutes
    pollRef.current = setInterval(check, 30 * 60 * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Determine if an update is ready to install
  const isUpdateReady = Boolean(
    !__DEV__ && (
      (updatesState?.isUpdatePending) ||
      (updatesState?.isUpdateAvailable && updatesState?.downloadedUpdate) ||
      manualAvailable
    )
  );

  // Animate in when update becomes available
  useEffect(() => {
    if (!isUpdateReady || dismissed) return;
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isUpdateReady, dismissed]);

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -120, duration: 220, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => setDismissed(true));
  }, [slideAnim, opacityAnim]);

  const handleUpdate = useCallback(async () => {
    if (!Updates || reloading) return;
    setReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  }, [reloading]);

  if (!isUpdateReady || dismissed) return null;

  return (
    <Animated.View
      style={[
        s.container,
        {
          top: insets.top + 4,
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={[s.banner, { backgroundColor: C.card, borderColor: '#FFD700' }]}>
        {/* Icon */}
        <View style={s.iconWrap}>
          <Ionicons name="rocket-outline" size={18} color="#FFD700" />
        </View>

        {/* Text */}
        <View style={s.textWrap}>
          <Text style={[s.title, { color: C.textPrimary }]}>Update Available</Text>
          <Text style={[s.subtitle, { color: C.textMuted }]}>
            A new version of PredictXta is ready.
          </Text>
        </View>

        {/* Update button */}
        <Pressable
          onPress={handleUpdate}
          disabled={reloading}
          style={({ pressed }) => [
            s.updateBtn,
            { opacity: reloading || pressed ? 0.7 : 1 },
          ]}
        >
          {reloading
            ? <Ionicons name="sync-outline" size={14} color="#000" />
            : <Text style={s.updateBtnText}>Update</Text>
          }
        </Pressable>

        {/* Dismiss */}
        <Pressable onPress={handleDismiss} hitSlop={10} style={s.closeBtn}>
          <Ionicons name="close" size={16} color={C.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Public export — renders nothing on web or in dev mode ───────────────────
export function OTAUpdateBanner() {
  // Never render on web or in Expo Go dev client
  if (Platform.OS === 'web') return null;
  if (__DEV__) return null;
  if (!Updates) return null;
  return <OTABannerInner />;
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 9997,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,215,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: FONTS.bold,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  updateBtn: {
    backgroundColor: '#FFD700',
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  updateBtnText: {
    fontSize: 12,
    fontWeight: FONTS.extraBold,
    color: '#000',
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
