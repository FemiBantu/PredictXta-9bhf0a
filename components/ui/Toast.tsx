import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, Pressable, Platform } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';

// expo-haptics MUST be loaded lazily inside a function — never at module init.
// On Android/Hermes, synchronous require() of native modules at module init time
// can corrupt the entire Metro module graph even inside try/catch.
function getHaptics(): typeof import('expo-haptics') | null {
  try { return require('expo-haptics'); } catch { return null; }
}

function triggerHapticMedium() {
  try {
    const h = getHaptics();
    if (h && h.ImpactFeedbackStyle && h.impactAsync) {
      h.impactAsync(h.ImpactFeedbackStyle.Medium);
    }
  } catch { /* silent — native module may not be available */ }
}

function triggerHapticLight() {
  try {
    const h = getHaptics();
    if (h && h.ImpactFeedbackStyle && h.impactAsync) {
      h.impactAsync(h.ImpactFeedbackStyle.Light);
    }
  } catch { /* silent — native module may not be available */ }
}

// Gold palette for Daily Challenge toasts
const GOLD = '#FFD700';
const GOLD_DIM = 'rgba(255,215,0,0.15)';
const GOLD_BORDER = 'rgba(255,215,0,0.30)';

export interface ToastProps {
  id: string;
  matchLabel: string;
  message: string;
  onDismiss: (id: string) => void;
  /** Auto-dismiss after this many ms. Default: 5000 */
  duration?: number;
  /** Sport key for score-alert icon selection */
  sport?: string;
}

// Map sport keys to @expo/vector-icons icon names (Ionicons set)
const SPORT_ICON: Record<string, { name: string; lib: 'ionicons' | 'fa5' }> = {
  football:            { name: 'football-outline',  lib: 'ionicons' },
  soccer:              { name: 'football-outline',  lib: 'ionicons' },
  basketball:          { name: 'basketball-outline', lib: 'ionicons' },
  tennis:              { name: 'tennisball-outline', lib: 'ionicons' },
  baseball:            { name: 'baseball-outline',  lib: 'ionicons' },
  hockey:              { name: 'snow-outline',       lib: 'ionicons' },
  rugby:               { name: 'american-football-outline', lib: 'ionicons' },
  'american football': { name: 'american-football-outline', lib: 'ionicons' },
  cricket:             { name: 'baseball-outline',  lib: 'ionicons' },
  mma:                 { name: 'fitness-outline',   lib: 'ionicons' },
  volleyball:          { name: 'radio-button-off-outline', lib: 'ionicons' },
  handball:            { name: 'hand-right-outline', lib: 'ionicons' },
};

function SportIcon({ sport, color }: { sport?: string; color: string }) {
  const cfg = sport ? SPORT_ICON[sport.toLowerCase()] : null;
  if (!cfg) {
    return <Ionicons name="football-outline" size={18} color={color} />;
  }
  return <Ionicons name={cfg.name as any} size={18} color={color} />;
}

export function Toast({ id, matchLabel, message, onDismiss, duration = 5000, sport }: ToastProps) {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visual variant: Daily Challenge toasts use gold + trophy icon
  const isChallenge = matchLabel.startsWith('🏆 Daily Challenge');
  const accentColor = isChallenge ? GOLD : COLORS.accent;
  const accentDim = isChallenge ? GOLD_DIM : COLORS.accentDim;
  const borderColor = isChallenge ? GOLD_BORDER : 'rgba(0,255,135,0.25)';

  const dismiss = (isUserInitiated = false) => {
    if (isUserInitiated) {
      triggerHapticLight();
    }
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss(id));
  };

  useEffect(() => {
    // Haptic feedback on arrival — Medium impact for goal/score events
    triggerHapticMedium();

    // Slide in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        tension: 70,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto dismiss
    dismissTimer.current = setTimeout(dismiss, duration);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY }], opacity }]}>
      <View style={[styles.inner, { borderColor }]}>
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {/* Icon */}
        <View style={[styles.iconCircle, { backgroundColor: accentDim }]}>
          {isChallenge ? (
            <FontAwesome5 name="trophy" size={16} color={GOLD} />
          ) : (
            <SportIcon sport={sport} color={COLORS.accent} />
          )}
        </View>

        {/* Text */}
        <View style={styles.textWrap}>
          <Text style={[styles.matchLabel, { color: accentColor }]} numberOfLines={1}>{matchLabel}</Text>
          <Text style={styles.message} numberOfLines={2}>{message}</Text>
        </View>

        {/* Dismiss */}
        <Pressable
          onPress={() => dismiss(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.closeBtn, pressed ? { opacity: 0.6 } : null]}
        >
          <Ionicons name="close" size={16} color={COLORS.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Toast Stack ──────────────────────────────────────────────────────────────
// Renders a stack of toasts anchored near the top of the screen.
export interface ToastItem {
  id: string;
  matchLabel: string;
  message: string;
  sport?: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <View style={stack.container} pointerEvents="box-none">
      {toasts.slice(0, 3).map((t, i) => (
        <View key={t.id} style={[stack.item, { top: i * 78 }]}>
          <Toast
            id={t.id}
            matchLabel={t.matchLabel}
            message={t.message}
            sport={t.sport}
            onDismiss={onDismiss}
          />
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.5,
        shadowRadius: 14,
      },
      android: { elevation: 12 },
    }),
  },
  inner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: RADIUS.lg, paddingVertical: 12, paddingRight: 12,
    gap: 10, overflow: 'hidden',
  },
  accentBar: {
    width: 4, alignSelf: 'stretch',
    borderTopLeftRadius: RADIUS.lg,
    borderBottomLeftRadius: RADIUS.lg,
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1, gap: 2 },
  matchLabel: {
    fontSize: 10, fontWeight: FONTS.extraBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  message: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.textPrimary, lineHeight: 18 },
  closeBtn: { padding: 4, alignSelf: 'flex-start', marginTop: 2 },
});

const stack = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 9999,
    pointerEvents: 'box-none',
  },
  item: {
    position: 'absolute',
    left: 0, right: 0,
  },
});
