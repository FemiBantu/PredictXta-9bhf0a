/**
 * language-settings.tsx — Enhanced Language Selection Screen
 *
 * 11 languages with:
 * - Visual cards for each language (flag, native name, script preview)
 * - RTL badge for Arabic
 * - Auto-detected indicator
 * - Coverage stats per language
 * - Instant switch with loading state
 * - Syncs to user profile
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/template';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { SupportedLanguage } from '@/services/i18n';
import { useLocale } from '@/hooks/useLocale';

// Language-specific script preview strings to show the user what the script looks like
const SCRIPT_PREVIEW: Record<string, string> = {
  en: 'AI · Sports · Predictions',
  fr: 'IA · Sports · Pronostics',
  es: 'IA · Deportes · Predicciones',
  pt: 'IA · Esportes · Previsões',
  de: 'KI · Sport · Vorhersagen',
  it: 'IA · Sport · Previsioni',
  tr: 'YZ · Spor · Tahminler',
  hi: 'एआई · खेल · भविष्यवाणी',
  zh: 'AI · 体育 · 预测',
  ar: 'الذكاء الاصطناعي · رياضة · توقعات',
  sw: 'AI · Michezo · Utabiri',
};

// Approximate coverage label per language
const COVERAGE: Record<string, { ui: number; dynamic: boolean }> = {
  en: { ui: 100, dynamic: true },
  fr: { ui: 100, dynamic: true },
  es: { ui: 100, dynamic: true },
  pt: { ui: 100, dynamic: true },
  ar: { ui: 100, dynamic: true },
  sw: { ui: 100, dynamic: true },
  de: { ui: 100, dynamic: true },
  it: { ui: 100, dynamic: true },
  tr: { ui: 100, dynamic: true },
  hi: { ui: 100, dynamic: true },
  zh: { ui: 100, dynamic: true },
};

export default function LanguageSettingsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { language, supportedLanguages, setLanguage, detectedLocale } = useLanguage();
  const { user } = useAuth();
  const { t } = useLocale();
  const [switching, setSwitching] = useState<string | null>(null);

  // Detected language code from device
  const detectedCode = detectedLocale?.substring(0, 2).toLowerCase() ?? 'en';

  const handleSelect = async (lang: SupportedLanguage) => {
    if (lang.code === language || switching) return;
    setSwitching(lang.code);
    try {
      await setLanguage(lang.code, user?.id ?? null);
      router.back();
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>{t('settings.language')}</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Info banner */}
        <View style={[s.infoCard, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
          <Ionicons name="globe-outline" size={20} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.infoTitle, { color: C.textPrimary }]}>
              {t('language.selectTitle')}
            </Text>
            <Text style={[s.infoDesc, { color: C.textMuted }]}>
              {t('language.selectSubtitle')} UI updates instantly; AI analysis, expert tips, and match previews translate on demand.
            </Text>
          </View>
        </View>

        {/* Language Cards */}
        <View style={s.langList}>
          {supportedLanguages.map((lang) => {
            const isSelected = lang.code === language;
            const isSwitching = switching === lang.code;
            const isDetected = lang.code === detectedCode && lang.code !== language;
            const cov = COVERAGE[lang.code] ?? { ui: 100, dynamic: true };

            return (
              <Pressable
                key={lang.code}
                style={({ pressed }) => [
                  s.langCard,
                  { backgroundColor: C.card, borderColor: C.border },
                  isSelected
                    ? { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}55`, borderWidth: 1.5 }
                    : null,
                  pressed && !isSelected && !isSwitching ? { opacity: 0.82, transform: [{ scale: 0.99 }] } : null,
                ]}
                onPress={() => handleSelect(lang)}
                disabled={isSelected || !!switching}
              >
                {/* Flag */}
                <Text style={s.flag}>{lang.flag}</Text>

                {/* Names + script preview */}
                <View style={s.langInfo}>
                  <View style={s.langNameRow}>
                    <Text style={[s.nativeName, { color: isSelected ? C.primary : C.textPrimary }]}>
                      {lang.nativeName}
                    </Text>
                    {lang.rtl ? (
                      <View style={[s.rtlBadge, { backgroundColor: `${C.accentPurple}18`, borderColor: `${C.accentPurple}33` }]}>
                        <Text style={[s.rtlText, { color: C.accentPurple }]}>RTL</Text>
                      </View>
                    ) : null}
                    {isDetected ? (
                      <View style={[s.detectedBadge, { backgroundColor: `${C.accent}14`, borderColor: `${C.accent}44` }]}>
                        <Ionicons name="phone-portrait-outline" size={9} color={C.accent} />
                        <Text style={[s.detectedText, { color: C.accent }]}>Device</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[s.englishName, { color: C.textMuted }]}>{lang.name}</Text>
                  {/* Script preview */}
                  <Text
                    style={[
                      s.scriptPreview,
                      { color: isSelected ? `${C.primary}99` : C.textMuted },
                      lang.rtl ? { textAlign: 'right' } : null,
                    ]}
                    numberOfLines={1}
                  >
                    {SCRIPT_PREVIEW[lang.code] ?? ''}
                  </Text>
                </View>

                {/* Coverage pill */}
                <View style={s.rightCol}>
                  <View style={[s.covPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
                    <Ionicons name="checkmark-circle" size={10} color={C.primary} />
                    <Text style={[s.covText, { color: C.primary }]}>{cov.ui}% UI</Text>
                  </View>
                  {cov.dynamic ? (
                    <View style={[s.covPill, { backgroundColor: `${C.accent}14`, borderColor: `${C.accent}33` }]}>
                      <Ionicons name="flash" size={10} color={C.accent} />
                      <Text style={[s.covText, { color: C.accent }]}>AI</Text>
                    </View>
                  ) : null}

                  {/* Selected / loading indicator */}
                  <View style={s.checkWrap}>
                    {isSwitching ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : isSelected ? (
                      <View style={[s.checkCircle, { backgroundColor: C.primary }]}>
                        <Ionicons name="checkmark" size={14} color={C.textInverse} />
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Translation architecture note */}
        <View style={[s.noteCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="shield-checkmark-outline" size={16} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[s.noteTitle, { color: C.textPrimary }]}>Translation Architecture</Text>
            <Text style={[s.noteText, { color: C.textMuted }]}>
              Team names, player names, league names, scores, and odds are{' '}
              <Text style={{ fontWeight: FONTS.bold, color: C.textSecondary }}>never translated</Text>
              {' '}— only natural-language content (AI analysis, tips, previews) is localized.
              Backend databases always remain in English.
            </Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={[s.statsCard, { backgroundColor: C.card, borderColor: C.border }]}>
          {[
            { icon: '🌍', val: String(supportedLanguages.length), lbl: 'Languages' },
            { icon: '⚡', val: '< 300ms', lbl: 'Latency' },
            { icon: '🎯', val: '80%+', lbl: 'Cache Rate' },
          ].map((item, i) => (
            <View key={item.lbl} style={[s.statItem, i > 0 ? { borderLeftWidth: 1, borderLeftColor: C.border } : null]}>
              <Text style={s.statIcon}>{item.icon}</Text>
              <Text style={[s.statVal, { color: C.primary }]}>{item.val}</Text>
              <Text style={[s.statLbl, { color: C.textMuted }]}>{item.lbl}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md, gap: 12, paddingBottom: 48 },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
  },
  infoTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: 4 },
  infoDesc: { fontSize: 12, lineHeight: 18 },

  langList: { gap: 8 },
  langCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
  },
  flag: { fontSize: 28, lineHeight: 34 },
  langInfo: { flex: 1, gap: 2 },
  langNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  nativeName: { fontSize: 16, fontWeight: FONTS.bold },
  englishName: { fontSize: 11, fontWeight: FONTS.medium },
  scriptPreview: { fontSize: 10, fontWeight: FONTS.regular, marginTop: 1 },

  rtlBadge: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  rtlText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },

  detectedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  detectedText: { fontSize: 8, fontWeight: FONTS.semiBold },

  rightCol: { alignItems: 'flex-end', gap: 6 },
  covPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  covText: { fontSize: 9, fontWeight: FONTS.bold },
  checkWrap: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  checkCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
  },
  noteTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 4 },
  noteText: { fontSize: 12, lineHeight: 18 },

  statsCard: {
    flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: 12,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  statIcon: { fontSize: 16 },
  statVal: { fontSize: 14, fontWeight: FONTS.extraBold },
  statLbl: { fontSize: 9, fontWeight: FONTS.medium },
});
