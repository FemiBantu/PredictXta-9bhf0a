/**
 * CookieConsentBanner
 *
 * GDPR / NDPR compliant one-time consent banner.
 * Shown on first app launch; persists the decision to AsyncStorage.
 *
 * Key: @predictxta/cookie_consent_v1
 * Values stored:
 *   { decided: true, analytics: boolean, personalization: boolean }
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Easing,
  Modal, Switch, ScrollView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useRouter } from 'expo-router';

// ─── Storage ──────────────────────────────────────────────────────────────────
const CONSENT_KEY = '@predictxta/cookie_consent_v1';

export interface ConsentData {
  decided: boolean;
  analytics: boolean;
  personalization: boolean;
}

export async function getConsent(): Promise<ConsentData | null> {
  try {
    const raw = await AsyncStorage.getItem(CONSENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveConsent(data: ConsentData): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(data));
}

// ─── Toggle Row ───────────────────────────────────────────────────────────────
function PreferenceRow({
  icon, iconColor, label, description, value, onChange, locked,
  C,
}: {
  icon: string; iconColor: string; label: string; description: string;
  value: boolean; onChange?: (v: boolean) => void; locked?: boolean;
  C: any;
}) {
  return (
    <View style={[pr.row, { borderBottomColor: C.border }]}>
      <View style={[pr.iconWrap, { backgroundColor: `${iconColor}18` }]}>
        <Ionicons name={icon as any} size={16} color={iconColor} />
      </View>
      <View style={pr.text}>
        <View style={pr.labelRow}>
          <Text style={[pr.label, { color: C.textPrimary }]}>{label}</Text>
          {locked ? (
            <View style={[pr.requiredPill, { backgroundColor: `${iconColor}18`, borderColor: `${iconColor}44` }]}>
              <Text style={[pr.requiredText, { color: iconColor }]}>Required</Text>
            </View>
          ) : null}
        </View>
        <Text style={[pr.desc, { color: C.textMuted }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={locked ? undefined : onChange}
        disabled={locked}
        trackColor={{ false: C.border, true: `${iconColor}88` }}
        thumbColor={value ? iconColor : C.textMuted}
        ios_backgroundColor={C.border}
      />
    </View>
  );
}

const pr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, gap: 12, borderBottomWidth: 1,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  text: { flex: 1, gap: 3 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 14, fontWeight: FONTS.semiBold },
  desc: { fontSize: 12, lineHeight: 17 },
  requiredPill: {
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1,
  },
  requiredText: { fontSize: 9, fontWeight: FONTS.bold },
});

// ─── Manage Preferences Modal ─────────────────────────────────────────────────
function ManageModal({
  visible, onClose, onSave, C,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: { analytics: boolean; personalization: boolean }) => void;
  C: any;
}) {
  const router = useRouter();
  const [analytics, setAnalytics] = useState(true);
  const [personalization, setPersonalization] = useState(true);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[mm.root, { backgroundColor: C.bg }]}>
        {/* Header */}
        <View style={[mm.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={onClose} style={mm.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[mm.title, { color: C.textPrimary }]}>Privacy Preferences</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={mm.scroll} showsVerticalScrollIndicator={false}>
          {/* Intro */}
          <View style={[mm.introCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name="shield-checkmark" size={20} color={C.accentBlue} />
            <Text style={[mm.introText, { color: C.textSecondary }]}>
              We respect your privacy. Choose which data processing activities you consent to. Essential cookies are always active and cannot be disabled.
            </Text>
          </View>

          {/* Toggles */}
          <View style={[mm.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <PreferenceRow
              icon="lock-closed-outline" iconColor={C.accent}
              label="Essential" description="Required for the app to function. Includes authentication, session management, and security. Cannot be disabled."
              value={true} locked C={C}
            />
            <PreferenceRow
              icon="bar-chart-outline" iconColor={C.accentBlue}
              label="Analytics" description="Helps us understand how you use the app so we can improve performance, fix bugs, and deliver better predictions."
              value={analytics} onChange={setAnalytics} C={C}
            />
            <PreferenceRow
              icon="person-outline" iconColor={C.primary}
              label="Personalization" description="Enables sport-preference filtering, personalized AI picks, and a tailored experience based on your usage patterns."
              value={personalization} onChange={setPersonalization} C={C}
            />
          </View>

          {/* Legal links */}
          <View style={[mm.legalRow, { borderTopColor: C.border }]}>
            <Pressable onPress={() => { onClose(); setTimeout(() => router.push('/privacy' as any), 350); }}>
              <Text style={[mm.legalLink, { color: C.accentBlue }]}>Privacy Policy</Text>
            </Pressable>
            <Text style={[mm.legalDot, { color: C.textMuted }]}>·</Text>
            <Pressable onPress={() => { onClose(); setTimeout(() => router.push('/terms' as any), 350); }}>
              <Text style={[mm.legalLink, { color: C.accentBlue }]}>Terms &amp; Conditions</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Save button */}
        <View style={[mm.footer, { backgroundColor: C.surface, borderTopColor: C.border }]}>
          <Pressable
            style={({ pressed }) => [
              mm.saveBtn,
              { backgroundColor: C.primary },
              pressed ? { opacity: 0.85 } : null,
            ]}
            onPress={() => onSave({ analytics, personalization })}
          >
            <Ionicons name="checkmark-circle" size={18} color={C.textInverse} />
            <Text style={[mm.saveBtnText, { color: C.textInverse }]}>Save My Preferences</Text>
          </Pressable>
          <Text style={[mm.footerNote, { color: C.textMuted }]}>
            You can change these settings anytime in Settings.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const mm = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 14, gap: 10,
    borderBottomWidth: 1,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md, gap: 14 },
  introCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.md,
  },
  introText: { flex: 1, fontSize: 13, lineHeight: 20 },
  section: { borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, overflow: 'hidden' },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingTop: 16, borderTopWidth: 1, marginTop: 4,
  },
  legalLink: { fontSize: 13, fontWeight: FONTS.semiBold },
  legalDot: { fontSize: 13 },
  footer: {
    borderTopWidth: 1, paddingHorizontal: SPACING.md,
    paddingTop: 14, paddingBottom: Platform.OS === 'ios' ? 28 : 16, gap: 10,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 15,
  },
  saveBtnText: { fontSize: 16, fontWeight: FONTS.bold },
  footerNote: { fontSize: 11, textAlign: 'center' },
});

// ─── Main Banner ──────────────────────────────────────────────────────────────
export function CookieConsentBanner() {
  const { colors: C } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const slideY = useRef(new Animated.Value(300)).current;

  // ── Check if user has already decided ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // Small delay so the rest of the app UI renders first
    const timer = setTimeout(async () => {
      const consent = await getConsent();
      if (!consent?.decided && !cancelled) {
        setVisible(true);
        Animated.spring(slideY, {
          toValue: 0, tension: 60, friction: 10, useNativeDriver: true,
        }).start();
      }
    }, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const dismiss = () => {
    Animated.timing(slideY, {
      toValue: 400, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  const handleAcceptAll = async () => {
    await saveConsent({ decided: true, analytics: true, personalization: true });
    dismiss();
  };

  const handleSavePreferences = async (prefs: { analytics: boolean; personalization: boolean }) => {
    await saveConsent({ decided: true, ...prefs });
    setManageOpen(false);
    dismiss();
  };

  if (!visible) return null;

  return (
    <>
      {/* Scrim */}
      <Pressable
        style={[b.scrim]}
        onPress={() => {/* prevent dismiss without deciding */}}
      />

      {/* Banner */}
      <Animated.View
        style={[
          b.banner,
          {
            backgroundColor: C.card,
            borderColor: C.border,
            paddingBottom: Math.max(insets.bottom + 8, 20),
            transform: [{ translateY: slideY }],
          },
        ]}
      >
        {/* Handle bar */}
        <View style={[b.handle, { backgroundColor: C.border }]} />

        {/* Header row */}
        <View style={b.headerRow}>
          <View style={[b.iconWrap, { backgroundColor: `${C.accentBlue}18`, borderColor: `${C.accentBlue}33` }]}>
            <Ionicons name="shield-checkmark" size={20} color={C.accentBlue} />
          </View>
          <View style={b.headerText}>
            <Text style={[b.title, { color: C.textPrimary }]}>Privacy &amp; Cookie Settings</Text>
            <View style={b.badgeRow}>
              <View style={[b.badge, { backgroundColor: `${C.accentBlue}14`, borderColor: `${C.accentBlue}33` }]}>
                <Text style={[b.badgeText, { color: C.accentBlue }]}>GDPR</Text>
              </View>
              <View style={[b.badge, { backgroundColor: `${C.accent}14`, borderColor: `${C.accent}33` }]}>
                <Text style={[b.badgeText, { color: C.accent }]}>NDPR</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Body text */}
        <Text style={[b.body, { color: C.textSecondary }]}>
          We use cookies and similar technologies to improve your experience, deliver AI-powered predictions, and analyse app usage. By tapping{' '}
          <Text style={{ fontWeight: FONTS.bold, color: C.textPrimary }}>Accept All</Text>
          {' '}you consent to all processing. You can customise or withdraw consent at any time in Settings.
        </Text>

        {/* Legal links */}
        <View style={b.legalRow}>
          <Pressable onPress={() => router.push('/privacy' as any)}>
            <Text style={[b.legalLink, { color: C.accentBlue }]}>Privacy Policy</Text>
          </Pressable>
          <Text style={[b.legalDot, { color: C.textMuted }]}>·</Text>
          <Pressable onPress={() => router.push('/terms' as any)}>
            <Text style={[b.legalLink, { color: C.accentBlue }]}>Terms &amp; Conditions</Text>
          </Pressable>
        </View>

        {/* Buttons */}
        <View style={b.btnRow}>
          <Pressable
            style={({ pressed }) => [
              b.manageBtn,
              { backgroundColor: C.surface, borderColor: C.border },
              pressed ? { opacity: 0.75 } : null,
            ]}
            onPress={() => setManageOpen(true)}
          >
            <MaterialIcons name="tune" size={15} color={C.textSecondary} />
            <Text style={[b.manageBtnText, { color: C.textSecondary }]}>Manage</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              b.acceptBtn,
              { backgroundColor: C.primary },
              pressed ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
            ]}
            onPress={handleAcceptAll}
          >
            <Ionicons name="checkmark-circle" size={17} color={C.textInverse} />
            <Text style={[b.acceptBtnText, { color: C.textInverse }]}>Accept All</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* Manage Preferences Modal */}
      <ManageModal
        visible={manageOpen}
        onClose={() => setManageOpen(false)}
        onSave={handleSavePreferences}
        C={C}
      />
    </>
  );
}

const b = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 9000,
  },
  banner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    zIndex: 9001,
    borderTopLeftRadius: RADIUS.xl + 4,
    borderTopRightRadius: RADIUS.xl + 4,
    borderWidth: 1, borderBottomWidth: 0,
    paddingTop: 12,
    paddingHorizontal: SPACING.md,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 24,
  },
  handle: {
    width: 38, height: 4, borderRadius: 2,
    alignSelf: 'center', marginBottom: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  headerText: { flex: 1, gap: 5 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: {
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1,
  },
  badgeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  body: { fontSize: 13, lineHeight: 20 },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legalLink: { fontSize: 12, fontWeight: FONTS.semiBold },
  legalDot: { fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10 },
  manageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 13,
  },
  manageBtnText: { fontSize: 14, fontWeight: FONTS.semiBold },
  acceptBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 13,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  acceptBtnText: { fontSize: 15, fontWeight: FONTS.bold },
});
