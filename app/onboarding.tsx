
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Easing,
  Dimensions, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useLocale } from '@/hooks/useLocale';
import { useTranslatedContent } from '@/hooks/useTranslatedContent';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Constants ────────────────────────────────────────────────────────────────
export const ONBOARDING_KEY = '@predictxta/onboarding_done_v1';
// SPORT_PREFS_KEY is now canonical in constants/theme.ts — re-exported here for backwards compat
export { SPORT_PREFS_KEY } from '@/constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const TOTAL_STEPS = 3;

// ─── Sport Options ────────────────────────────────────────────────────────────
interface SportOption {
  key: string;
  label: string;
  emoji: string;
  description: string;
  color: string;
}

const SPORTS: SportOption[] = [
  {
    key: 'football',
    label: 'Football',
    emoji: '⚽',
    description: 'Premier League, UCL, La Liga & more',
    color: COLORS.accent,
  },
  {
    key: 'basketball',
    label: 'Basketball',
    emoji: '🏀',
    description: 'NBA, EuroLeague & international',
    color: COLORS.accentBlue,
  },
  {
    key: 'tennis',
    label: 'Tennis',
    emoji: '🎾',
    description: 'Grand Slams, ATP & WTA events',
    color: COLORS.primary,
  },
  {
    key: 'baseball',
    label: 'Baseball',
    emoji: '⚾',
    description: 'MLB, NPB & international series',
    color: '#E05A2B',
  },
  {
    key: 'hockey',
    label: 'Ice Hockey',
    emoji: '🏒',
    description: 'NHL, KHL & international cups',
    color: '#00BFFF',
  },
  {
    key: 'rugby',
    label: 'Rugby',
    emoji: '🏉',
    description: 'World Cup, Six Nations & Super Rugby',
    color: '#8B5CF6',
  },
  {
    key: 'american-football',
    label: 'American Football',
    emoji: '🏈',
    description: 'NFL & College Football matchups',
    color: '#F59E0B',
  },
  {
    key: 'cricket',
    label: 'Cricket',
    emoji: '🏏',
    description: 'ICC Tests, ODIs & T20 tournaments',
    color: '#10B981',
  },
  {
    key: 'mma',
    label: 'MMA / UFC',
    emoji: '🥊',
    description: 'UFC, Bellator & ONE Championship',
    color: '#EF4444',
  },
  {
    key: 'volleyball',
    label: 'Volleyball',
    emoji: '🏐',
    description: 'VNL, CEV Champions League & Olympics',
    color: '#06B6D4',
  },
  {
    key: 'handball',
    label: 'Handball',
    emoji: '🤾',
    description: 'EHF Champions League & Bundesliga',
    color: '#D97706',
  },
];

// ─── Mark onboarding complete ─────────────────────────────────────────────────
export async function markOnboardingDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch { /* silent */ }
}

// ─── Dot Indicator ───────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={dots.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            dots.dot,
            i === current ? dots.dotActive : dots.dotInactive,
          ]}
        />
      ))}
    </View>
  );
}

const dots = StyleSheet.create({
  row: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  dot: { borderRadius: RADIUS.full, height: 7 },
  dotActive: { width: 24, backgroundColor: COLORS.primary },
  dotInactive: { width: 7, backgroundColor: COLORS.border },
});

// ─── Screen 1: Welcome + Sport Selection ──────────────────────────────────────
function SportSelectScreen({
  selected,
  onToggle,
  onBulkSet,
  logoOpacity,
  logoScale,
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  onBulkSet: (keys: Set<string>) => void;
  logoOpacity: Animated.Value;
  logoScale: Animated.Value;
}) {
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [translatedSports, setTranslatedSports] = useState<SportOption[]>(SPORTS);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `onboarding-sports::${language}`;
    if (!needsTranslation) {
      setTranslatedSports(SPORTS);
      return;
    }
    if (translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    Promise.all(
      SPORTS.flatMap((sport) => [
        translate(sport.label, 'general'),
        translate(sport.description, 'general'),
      ])
    ).then((results) => {
      const updated = SPORTS.map((sport, i) => ({
        ...sport,
        label: results[i * 2] ?? sport.label,
        description: results[i * 2 + 1] ?? sport.description,
      }));
      setTranslatedSports(updated);
    }).catch(() => {
      setTranslatedSports(SPORTS);
    });
  }, [language, needsTranslation]);

  return (
    <View style={screen.root}>
      {/* Animated logo hero — replaces the image + text headline */}
      <Animated.View
        style={[
          screen.logoHero,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <View style={screen.logoGlowOuter}>
          <View style={screen.logoGlowInner}>
            <View style={screen.logoTile}>
              <Image
                source={require('@/assets/logo.png')}
                style={screen.logoImg}
                contentFit="contain"
                transition={0}
              />
            </View>
          </View>
        </View>
        <View style={screen.appNameRow}>
          <Text style={[screen.appNameText, { color: COLORS.primary }]}>PredictXta Sports</Text>
        </View>
        <Text style={screen.logoTagline}>
          <Text style={{ color: '#FFFFFF' }}>AI PREDICTION - </Text>
          <Text style={{ color: '#6EDC1F' }}>BET SMART</Text>
          <Text style={{ color: '#FFFFFF' }}> - WIN MORE.</Text>
        </Text>
      </Animated.View>

      <View style={screen.body}>
        <View style={screen.badge}>
          <FontAwesome5 name="crown" size={11} color={COLORS.primary} />
          <Text style={screen.badgeText}>AI-POWERED PREDICTIONS</Text>
        </View>

        <Text style={screen.sub}>
          Get AI-generated match predictions, live scores, and expert analysis. Pick your favourite sports to personalise your feed.
        </Text>

        {/* Selected count pill */}
        <View style={screen.selectedCountRow}>
          <View style={screen.selectedCountPill}>
            <Ionicons name="checkmark-circle" size={13} color={COLORS.primary} />
            <Text style={screen.selectedCountText}>
              {selected.size} of {translatedSports.length} selected
            </Text>
          </View>
          <Pressable
            onPress={() => {
              const allKeys = translatedSports.map((s) => s.key);
              const allSelected = allKeys.every((k) => selected.has(k));
              onBulkSet(allSelected ? new Set([allKeys[0]]) : new Set(allKeys));
            }}
            style={({ pressed }) => [screen.selectAllBtn, pressed ? { opacity: 0.7 } : null]}
          >
            <Text style={screen.selectAllText}>
              {translatedSports.every((s) => selected.has(s.key)) ? 'Deselect All' : 'Select All'}
            </Text>
          </Pressable>
        </View>

        <View style={screen.sportsGrid}>
          {translatedSports.map((sport) => {
            const isSelected = selected.has(sport.key);
            return (
              <Pressable
                key={sport.key}
                style={({ pressed }) => [
                  screen.sportCard,
                  isSelected ? { borderColor: sport.color, backgroundColor: `${sport.color}12` } : null,
                  pressed ? { opacity: 0.82, transform: [{ scale: 0.97 }] } : null,
                ]}
                onPress={() => onToggle(sport.key)}
              >
                <View style={[screen.sportIconWrap, { backgroundColor: `${sport.color}18` }]}>
                  <Text style={screen.sportEmoji}>{sport.emoji}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[screen.sportLabel, isSelected ? { color: sport.color } : null]}>
                    {sport.label}
                  </Text>
                  <Text style={screen.sportDesc} numberOfLines={1}>
                    {sport.description}
                  </Text>
                </View>
                <View style={[
                  screen.checkCircle,
                  isSelected
                    ? { backgroundColor: sport.color, borderColor: sport.color }
                    : null,
                ]}>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={13} color={COLORS.textInverse} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={screen.hint}>Select all that apply · change anytime in Settings.</Text>
      </View>
    </View>
  );
}

// ─── Notification feature bullets (module-level for translation) ─────────────
const NOTIF_FEATURES = [
  { icon: 'football-outline', color: COLORS.accent, label: 'Goal alerts for followed matches' },
  { icon: 'alarm-outline', color: COLORS.primary, label: 'Match kick-off reminders (30 min before)' },
  { icon: 'analytics-outline', color: COLORS.accentBlue, label: 'New AI predictions ready to view' },
  { icon: 'trophy-outline', color: COLORS.primary, label: 'Daily challenge reminders at 9:00 AM' },
];

// ─── Screen 2: Notification Permission ───────────────────────────────────────
function NotifScreen({
  granted,
  onRequest,
}: {
  granted: boolean;
  onRequest: () => void;
}) {
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [features, setFeatures] = useState(NOTIF_FEATURES);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `onboarding-notif::${language}`;
    if (!needsTranslation) {
      setFeatures(NOTIF_FEATURES);
      return;
    }
    if (translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    Promise.all(NOTIF_FEATURES.map((f) => translate(f.label, 'general')))
      .then((labels) => {
        setFeatures(NOTIF_FEATURES.map((f, i) => ({ ...f, label: labels[i] ?? f.label })));
      })
      .catch(() => setFeatures(NOTIF_FEATURES));
  }, [language, needsTranslation]);

  return (
    <View style={screen.root}>
      <View style={screen.imageWrap}>
        <Image
          source={require('@/assets/onboarding2.png')}
          style={screen.heroImage}
          contentFit="cover"
          transition={300}
        />
        <LinearGradient
          colors={['transparent', COLORS.bg]}
          style={screen.imageGradient}
        />
        <View style={screen.logoBadge}>
          <Image
            source={require('@/assets/logo.png')}
            style={screen.logoBadgeImg}
            contentFit="contain"
            transition={0}
          />
        </View>
      </View>

      <View style={screen.body}>
        <View style={screen.badge}>
          <Ionicons name="notifications-outline" size={11} color={COLORS.accentBlue} />
          <Text style={[screen.badgeText, { color: COLORS.accentBlue }]}>STAY IN THE LOOP</Text>
        </View>

        <Text style={screen.headline}>Never Miss{'\n'}a Moment</Text>
        <Text style={screen.sub}>
          Enable notifications to get real-time match updates, AI picks, and reminders delivered straight to your device.
        </Text>

        <View style={screen.featureList}>
          {features.map((f, i) => (
            <View key={i} style={screen.featureRow}>
              <View style={[screen.featureIconWrap, { backgroundColor: `${f.color}18` }]}>
                <Ionicons name={f.icon as any} size={16} color={f.color} />
              </View>
              <Text style={screen.featureText}>{f.label}</Text>
            </View>
          ))}
        </View>

        {granted ? (
          <View style={screen.grantedBanner}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
            <Text style={screen.grantedText}>Notifications enabled — you are all set!</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              screen.notifBtn,
              pressed ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
            ]}
            onPress={onRequest}
          >
            <Ionicons name="notifications" size={18} color={COLORS.textInverse} />
            <Text style={screen.notifBtnText}>Enable Notifications</Text>
          </Pressable>
        )}

        <Text style={screen.hint}>You can manage notification preferences anytime in Settings.</Text>
      </View>
    </View>
  );
}

// ─── AI Prediction Screen static strings (module-level for translation) ──────
const AI_BADGE = 'AI MATCH ANALYSIS';
const AI_HEADLINE = 'Smart Predictions, Every Match';
const AI_SUB = 'Our AI analyses team form, H2H stats, xG data, and league position to generate high-confidence predictions.';
const AI_FACTORS = [
  'Home team unbeaten in last 8 home fixtures',
  'Away side missing key striker through injury',
  'H2H record strongly favours home side (4W-1D-0L)',
];

// ─── Screen 3: AI Prediction Preview ─────────────────────────────────────────
function AIPredictionScreen() {
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();
  const [badge, setBadge] = useState(AI_BADGE);
  const [headline, setHeadline] = useState(AI_HEADLINE);
  const [sub, setSub] = useState(AI_SUB);
  const [factors, setFactors] = useState(AI_FACTORS);
  const translatedKeyRef = useRef('');

  useEffect(() => {
    const key = `onboarding-ai::${language}`;
    if (!needsTranslation) {
      setBadge(AI_BADGE);
      setHeadline(AI_HEADLINE);
      setSub(AI_SUB);
      setFactors(AI_FACTORS);
      return;
    }
    if (translatedKeyRef.current === key) return;
    translatedKeyRef.current = key;
    Promise.all([
      translate(AI_BADGE, 'general'),
      translate(AI_HEADLINE, 'general'),
      translate(AI_SUB, 'general'),
      ...AI_FACTORS.map((f) => translate(f, 'general')),
    ]).then(([tBadge, tHeadline, tSub, ...tFactors]) => {
      setBadge(tBadge ?? AI_BADGE);
      setHeadline(tHeadline ?? AI_HEADLINE);
      setSub(tSub ?? AI_SUB);
      setFactors(AI_FACTORS.map((f, i) => tFactors[i] ?? f));
    }).catch(() => {
      setBadge(AI_BADGE);
      setHeadline(AI_HEADLINE);
      setSub(AI_SUB);
      setFactors(AI_FACTORS);
    });
  }, [language, needsTranslation]);

  return (
    <View style={screen.root}>
      <View style={screen.imageWrap}>
        <Image
          source={require('@/assets/onboarding3.png')}
          style={screen.heroImage}
          contentFit="cover"
          transition={300}
        />
        <LinearGradient
          colors={['transparent', COLORS.bg]}
          style={screen.imageGradient}
        />
        <View style={screen.logoBadge}>
          <Image
            source={require('@/assets/logo.png')}
            style={screen.logoBadgeImg}
            contentFit="contain"
            transition={0}
          />
        </View>
      </View>

      <View style={screen.body}>
        <View style={[screen.badge, { backgroundColor: `${COLORS.primary}15`, borderColor: `${COLORS.primary}40` }]}>
          <FontAwesome5 name="brain" size={11} color={COLORS.primary} />
          <Text style={screen.badgeText}>{badge}</Text>
        </View>

        <Text style={screen.headline}>{headline}</Text>
        <Text style={screen.sub}>{sub}</Text>

        {/* Mock prediction card */}
        <View style={previewCard.wrap}>
          <View style={previewCard.header}>
            <Text style={previewCard.league}>⚽ Premier League</Text>
            <View style={previewCard.upcomingPill}>
              <Text style={previewCard.upcomingText}>UPCOMING</Text>
            </View>
          </View>

          <View style={previewCard.teams}>
            <Text style={previewCard.teamName}>Man City</Text>
            <Text style={previewCard.vsText}>vs</Text>
            <Text style={previewCard.teamName}>Arsenal</Text>
          </View>

          {/* Probability bars */}
          <View style={previewCard.probRow}>
            <View style={previewCard.probItem}>
              <Text style={[previewCard.probPct, { color: COLORS.accentBlue }]}>61%</Text>
              <View style={[previewCard.probBar, { backgroundColor: `${COLORS.accentBlue}22` }]}>
                <View style={[previewCard.probFill, { width: '61%', backgroundColor: COLORS.accentBlue }]} />
              </View>
              <Text style={previewCard.probLabel}>Home Win</Text>
            </View>
            <View style={previewCard.probItem}>
              <Text style={[previewCard.probPct, { color: COLORS.primary }]}>24%</Text>
              <View style={[previewCard.probBar, { backgroundColor: `${COLORS.primary}22` }]}>
                <View style={[previewCard.probFill, { width: '24%', backgroundColor: COLORS.primary }]} />
              </View>
              <Text style={previewCard.probLabel}>Draw</Text>
            </View>
            <View style={previewCard.probItem}>
              <Text style={[previewCard.probPct, { color: COLORS.accentRed }]}>15%</Text>
              <View style={[previewCard.probBar, { backgroundColor: `${COLORS.accentRed}22` }]}>
                <View style={[previewCard.probFill, { width: '15%', backgroundColor: COLORS.accentRed }]} />
              </View>
              <Text style={previewCard.probLabel}>Away Win</Text>
            </View>
          </View>

          {/* Chips */}
          <View style={previewCard.chips}>
            <View style={[previewCard.chip, { borderColor: `${COLORS.accentBlue}44` }]}>
              <Text style={previewCard.chipLabel}>Pick</Text>
              <Text style={[previewCard.chipValue, { color: COLORS.accentBlue }]}>Home Win</Text>
            </View>
            <View style={[previewCard.chip, { borderColor: `${COLORS.accent}44` }]}>
              <Text style={previewCard.chipLabel}>O/U 2.5</Text>
              <Text style={[previewCard.chipValue, { color: COLORS.accent }]}>OVER</Text>
            </View>
            <View style={[previewCard.chip, { borderColor: `${COLORS.primary}44` }]}>
              <Text style={previewCard.chipLabel}>BTTS</Text>
              <Text style={[previewCard.chipValue, { color: COLORS.primary }]}>YES</Text>
            </View>
          </View>

          {/* Confidence */}
          <View style={previewCard.confRow}>
            <FontAwesome5 name="brain" size={12} color={COLORS.accent} />
            <Text style={previewCard.confLabel}>AI Confidence</Text>
            <View style={[previewCard.confBadge, { borderColor: `${COLORS.accent}55` }]}>
              <Text style={[previewCard.confValue, { color: COLORS.accent }]}>82%</Text>
            </View>
          </View>

          {/* Key factors */}
          <View style={previewCard.factors}>
            {factors.map((f, i) => (
              <View key={i} style={previewCard.factorRow}>
                <View style={previewCard.factorDot} />
                <Text style={previewCard.factorText} numberOfLines={1}>{f}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const previewCard = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: `${COLORS.primary}33`,
    padding: 14, gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  league: { fontSize: 12, color: COLORS.textMuted, fontWeight: FONTS.medium },
  upcomingPill: {
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  upcomingText: { fontSize: 9, color: COLORS.primary, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  teams: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  teamName: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },
  vsText: { fontSize: 12, color: COLORS.textMuted },
  probRow: { flexDirection: 'row', gap: 8 },
  probItem: { flex: 1, gap: 4 },
  probPct: { fontSize: 15, fontWeight: FONTS.extraBold, textAlign: 'center' },
  probBar: { height: 6, borderRadius: RADIUS.full, overflow: 'hidden' },
  probFill: { height: '100%', borderRadius: RADIUS.full },
  probLabel: { fontSize: 9, color: COLORS.textMuted, textAlign: 'center', fontWeight: FONTS.semiBold },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1, borderWidth: 1, borderRadius: RADIUS.md,
    paddingVertical: 7, alignItems: 'center', backgroundColor: COLORS.surface,
  },
  chipLabel: { fontSize: 9, color: COLORS.textMuted },
  chipValue: { fontSize: 12, fontWeight: FONTS.bold },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confLabel: { flex: 1, fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  confBadge: {
    borderWidth: 1.5, borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 3,
    backgroundColor: `${COLORS.accent}12`,
  },
  confValue: { fontSize: 14, fontWeight: FONTS.extraBold },
  factors: { gap: 5, paddingTop: 4, borderTopWidth: 1, borderTopColor: COLORS.border },
  factorRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  factorDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primary, flexShrink: 0 },
  factorText: { fontSize: 11, color: COLORS.textSecondary, flex: 1 },
});

// ─── Shared screen styles ─────────────────────────────────────────────────────
const screen = StyleSheet.create({
  root: { width: SCREEN_W, flex: 1 },

  // ─ Logo hero (step 0) ─────────────────────────────────────────────────────
  logoHero: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
  },
  logoGlowOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,215,0,0.055)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.40,
    shadowRadius: 36,
    elevation: 8,
  },
  logoGlowInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTile: {
    width: 80,
    height: 80,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.30)',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  logoImg: { width: '100%', height: '100%' },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  appNameText: {
    fontSize: 24,
    fontWeight: FONTS.extraBold,
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  gradientX: {
    width: 18,
    height: 32,
  },
  logoTagline: {
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 1.1,
    fontWeight: '700',
  },

  // ─ Shared step layout ────────────────────────────────────────────────────
  imageWrap: { width: '100%', height: 240, overflow: 'hidden' },
  heroImage: { width: '100%', height: '100%' },
  imageGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
  },
  logoBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.40)',
    backgroundColor: 'rgba(7,11,20,0.55)',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  logoBadgeImg: { width: '100%', height: '100%' },

  body: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: 4, gap: 12 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  badgeText: { fontSize: 10, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 0.8 },

  headline: {
    fontSize: 28, fontWeight: FONTS.extraBold, color: COLORS.textPrimary,
    lineHeight: 34,
  },
  sub: { fontSize: 14, color: COLORS.textMuted, lineHeight: 21 },

  selectedCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  selectedCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryGlow,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
  },
  selectedCountText: {
    fontSize: 11,
    fontWeight: FONTS.bold,
    color: COLORS.primary,
  },
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectAllText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: FONTS.medium,
  },
  sportsGrid: { gap: 8 },
  sportCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sportIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  sportEmoji: { fontSize: 22 },
  sportLabel: { fontSize: 15, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  sportDesc: { fontSize: 11, color: COLORS.textMuted },
  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },

  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  featureText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: FONTS.medium, flex: 1 },

  grantedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: `${COLORS.accent}12`, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: `${COLORS.accent}44`,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  grantedText: { fontSize: 14, color: COLORS.accent, fontWeight: FONTS.semiBold, flex: 1 },

  notifBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: COLORS.accentBlue,
    borderRadius: RADIUS.full, paddingVertical: 15,
  },
  notifBtnText: { fontSize: 15, fontWeight: FONTS.bold, color: COLORS.textInverse },

  hint: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', lineHeight: 16 },
});

// ─── Main Onboarding Screen ───────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedSports, setSelectedSports] = useState<Set<string>>(
    new Set(['football', 'basketball', 'tennis']),
  );
  const [notifGranted, setNotifGranted] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // ── Logo hero entrance animation (runs once on mount, drives step-0 logo) ──
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale   = useRef(new Animated.Value(0.82)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 65,
        friction: 9,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Animated slide value
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback((nextStep: number) => {
    const direction = nextStep > step ? -1 : 1;
    // Slide out current
    Animated.timing(slideAnim, {
      toValue: direction * SCREEN_W,
      duration: 240,
      useNativeDriver: true,
    }).start(() => {
      setStep(nextStep);
      // Reset position to opposite side instantly, then slide in
      slideAnim.setValue(-direction * SCREEN_W);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    });
  }, [step, slideAnim]);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      animateTo(step + 1);
    } else {
      handleFinish();
    }
  }, [step, animateTo]);

  const handleBack = useCallback(() => {
    if (step > 0) animateTo(step - 1);
  }, [step, animateTo]);

  const handleFinish = useCallback(async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      await AsyncStorage.setItem(
        SPORT_PREFS_KEY,
        JSON.stringify(Array.from(selectedSports)),
      );
    } catch { /* silent */ }
    router.replace('/login' as any);
  }, [selectedSports, router, isFinishing]);

  const handleSkip = useCallback(() => {
    handleFinish();
  }, [handleFinish]);

  const toggleSport = useCallback((key: string) => {
    setSelectedSports((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleRequestNotif = useCallback(async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifGranted(status === 'granted');
    } catch { /* silent */ }
  }, []);

  const { t } = useLocale();
  const isLastStep = step === TOTAL_STEPS - 1;
  const nextLabel = isLastStep ? t('onboarding.getStarted') : t('onboarding.next');

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        {/* Top bar */}
        <View style={styles.topBar}>
          {step > 0 ? (
            <Pressable
              onPress={handleBack}
              hitSlop={10}
              style={({ pressed }) => [styles.backBtn, pressed ? { opacity: 0.7 } : null]}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}

          <StepDots current={step} total={TOTAL_STEPS} />

          <Pressable
            onPress={handleSkip}
            hitSlop={10}
            style={({ pressed }) => [styles.skipBtn, pressed ? { opacity: 0.7 } : null]}
          >
            <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Animated content */}
      <Animated.View
        style={[styles.slideWrap, { transform: [{ translateX: slideAnim }] }]}
      >
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          bounces={false}
        >
          {step === 0 ? (
            <SportSelectScreen
              selected={selectedSports}
              onToggle={toggleSport}
              onBulkSet={setSelectedSports}
              logoOpacity={logoOpacity}
              logoScale={logoScale}
            />
          ) : step === 1 ? (
            <NotifScreen granted={notifGranted} onRequest={handleRequestNotif} />
          ) : (
            <AIPredictionScreen />
          )}
        </ScrollView>
      </Animated.View>

      {/* Bottom CTA */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafe}>
        <View style={styles.bottomBar}>
          {/* Step hint */}
          <Text style={styles.stepHint}>
            {step + 1} / {TOTAL_STEPS}
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.nextBtn,
              isLastStep ? styles.nextBtnFinal : null,
              pressed ? { opacity: 0.87, transform: [{ scale: 0.97 }] } : null,
              isFinishing ? { opacity: 0.6 } : null,
            ]}
            onPress={handleNext}
            disabled={isFinishing}
          >
            <LinearGradient
              colors={
                isLastStep
                  ? [COLORS.primary, '#E5C100']
                  : [COLORS.surface, COLORS.card]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextBtnGradient}
            >
              <Text
                style={[
                  styles.nextBtnText,
                  isLastStep ? styles.nextBtnTextFinal : null,
                ]}
              >
                {nextLabel}
              </Text>
              <MaterialIcons
                name={isLastStep ? 'rocket-launch' : 'arrow-forward'}
                size={18}
                color={isLastStep ? COLORS.textInverse : COLORS.primary}
              />
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  topSafe: { backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  skipBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  skipText: { fontSize: 14, color: COLORS.textMuted, fontWeight: FONTS.medium },

  slideWrap: { flex: 1, overflow: 'hidden' },
  scrollContent: { flexGrow: 1 },

  bottomSafe: { backgroundColor: COLORS.bg },
  bottomBar: {
    paddingHorizontal: SPACING.lg, paddingTop: 10, paddingBottom: 6, gap: 10,
  },
  stepHint: {
    fontSize: 11, color: COLORS.textMuted, textAlign: 'center', fontWeight: FONTS.medium,
  },
  nextBtn: {
    borderRadius: RADIUS.full, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  nextBtnFinal: { borderColor: 'rgba(255,215,0,0.4)' },
  nextBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  nextBtnText: { fontSize: 16, fontWeight: FONTS.bold, color: COLORS.primary },
  nextBtnTextFinal: { color: COLORS.textInverse },
});
