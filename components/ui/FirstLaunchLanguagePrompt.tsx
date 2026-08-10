/**
 * FirstLaunchLanguagePrompt.tsx
 *
 * Shown on first app launch to let users confirm or change the auto-detected
 * language. Slides up from bottom, shows detected language + top alternatives.
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

export function FirstLaunchLanguagePrompt() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { language, languageInfo, dismissFirstLaunchPrompt } = useLanguage();
  const translateY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleContinue = () => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 300, duration: 200, useNativeDriver: true }),
    ]).start(() => dismissFirstLaunchPrompt());
  };

  const handleChangeLanguage = () => {
    dismissFirstLaunchPrompt();
    setTimeout(() => router.push('/language-settings' as any), 150);
  };

  const confirmText: Record<string, string> = {
    en: `Continue in English`,
    fr: `Continuer en Français`,
    es: `Continuar en Español`,
    pt: `Continuar em Português`,
    ar: `المتابعة بالعربية`,
    sw: `Endelea kwa Kiswahili`,
  };

  const message = confirmText[language] ?? `Continue in ${languageInfo.nativeName}`;

  return (
    <Animated.View style={[s.overlay, { opacity }]} pointerEvents="box-none">
      {Platform.OS !== 'web' ? (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      )}
      <Animated.View
        style={[s.sheet, { backgroundColor: C.card, borderColor: C.border, transform: [{ translateY }] }]}
      >
        {/* Globe icon */}
        <View style={[s.iconWrap, { backgroundColor: `${C.accent}18`, borderColor: `${C.accent}33` }]}>
          <Ionicons name="globe-outline" size={32} color={C.accent} />
        </View>

        {/* Detected language */}
        <View style={s.flagRow}>
          <Text style={s.flagEmoji}>{languageInfo.flag}</Text>
          <View>
            <Text style={[s.detectedLabel, { color: C.textMuted }]}>Detected Language</Text>
            <Text style={[s.detectedLang, { color: C.textPrimary }]}>{languageInfo.nativeName}</Text>
          </View>
        </View>

        {/* Primary CTA */}
        <Pressable
          style={({ pressed }) => [s.continueBtn, { backgroundColor: C.accent }, pressed ? { opacity: 0.88 } : null]}
          onPress={handleContinue}
        >
          <Text style={s.continueBtnText}>{message}</Text>
          <Ionicons name="arrow-forward" size={16} color="#000" />
        </Pressable>

        {/* Change language option */}
        <Pressable
          style={({ pressed }) => [s.changeBtn, { borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
          onPress={handleChangeLanguage}
        >
          <Ionicons name="language-outline" size={15} color={C.textSecondary} />
          <Text style={[s.changeBtnText, { color: C.textSecondary }]}>Choose a different language</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 9990,
  },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderBottomWidth: 0,
    padding: SPACING.xl, paddingBottom: 36,
    alignItems: 'center', gap: 16,
  },
  iconWrap: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  flagRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    alignSelf: 'stretch',
    borderRadius: RADIUS.xl, padding: 14,
  },
  flagEmoji: { fontSize: 40, lineHeight: 46 },
  detectedLabel: { fontSize: 11, fontWeight: FONTS.semiBold, letterSpacing: 0.5, marginBottom: 2 },
  detectedLang: { fontSize: 20, fontWeight: FONTS.extraBold },
  continueBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 15,
  },
  continueBtnText: { fontSize: 16, fontWeight: FONTS.bold, color: '#000' },
  changeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 20, paddingVertical: 12, width: '100%', justifyContent: 'center',
  },
  changeBtnText: { fontSize: 14, fontWeight: FONTS.medium },
});
