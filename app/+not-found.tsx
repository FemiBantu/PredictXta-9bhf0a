/**
 * +not-found.tsx
 * Shown when navigating to any route that doesn't exist.
 * Required by Expo Router for both web and native platforms.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

export default function NotFoundScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();

  // Subtle float animation for the icon
  const floatAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Float loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -8, duration: 1400, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0,  duration: 1400, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <Animated.View style={[s.content, { opacity: fadeAnim }]}>
          {/* Floating icon */}
          <Animated.View
            style={[
              s.iconWrap,
              { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` },
              { transform: [{ translateY: floatAnim }] },
            ]}
          >
            <Text style={s.iconEmoji}>🔍</Text>
          </Animated.View>

          {/* Error code */}
          <Text style={[s.code, { color: C.primary }]}>404</Text>

          {/* Title */}
          <Text style={[s.title, { color: C.textPrimary }]}>Page Not Found</Text>

          {/* Body */}
          <Text style={[s.body, { color: C.textMuted }]}>
            The page you are looking for does not exist or may have been moved.
          </Text>

          {/* Actions */}
          <View style={s.actions}>
            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                { backgroundColor: C.primary },
                pressed ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
              ]}
              onPress={() => router.replace('/(tabs)' as any)}
            >
              <Ionicons name="home-outline" size={16} color="#000" />
              <Text style={s.primaryBtnText}>Go Home</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                s.secondaryBtn,
                { backgroundColor: C.card, borderColor: C.border },
                pressed ? { opacity: 0.8 } : null,
              ]}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back-outline" size={16} color={C.textSecondary} />
              <Text style={[s.secondaryBtnText, { color: C.textSecondary }]}>Go Back</Text>
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.xl, gap: 12,
  },
  iconWrap: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  iconEmoji: { fontSize: 42 },
  code: { fontSize: 72, fontWeight: FONTS.extraBold, lineHeight: 76, letterSpacing: -2 },
  title: { fontSize: 22, fontWeight: FONTS.bold, textAlign: 'center' },
  body: {
    fontSize: 14, textAlign: 'center', lineHeight: 22,
    maxWidth: 300, marginTop: 4, marginBottom: 8,
  },
  actions: { gap: 10, width: '100%', maxWidth: 280, marginTop: 8 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: 24,
  },
  primaryBtnText: { fontSize: 15, fontWeight: FONTS.bold, color: '#000' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, borderWidth: 1,
    paddingVertical: 13, paddingHorizontal: 24,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: FONTS.semiBold },
});
