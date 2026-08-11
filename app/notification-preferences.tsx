/**
 * app/notification-preferences.tsx
 *
 * Notification Preferences — toggle rows for all notification types.
 * Settings persisted to AsyncStorage and referenced during push scheduling.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Storage key ─────────────────────────────────────────────────────────────
export const NOTIF_PREFS_KEY = '@predictxta/notification_preferences_v1';

// ─── Default preferences ──────────────────────────────────────────────────────
export interface NotificationPreferences {
  matchReminders: boolean;      // 30 min before kickoff
  liveScoreAlerts: boolean;     // live score updates for followed matches
  dailyChallenge: boolean;      // 9am daily challenge reminder
  vipTipsAlerts: boolean;       // new VIP expert tips
  breakingNews: boolean;        // breaking sports news
}

export const DEFAULT_NOTIF_PREFS: NotificationPreferences = {
  matchReminders: true,
  liveScoreAlerts: true,
  dailyChallenge: true,
  vipTipsAlerts: false,
  breakingNews: false,
};

export async function loadNotificationPrefs(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTIF_PREFS };
    return { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

export async function saveNotificationPrefs(prefs: NotificationPreferences): Promise<void> {
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

// ─── Toggle Row ───────────────────────────────────────────────────────────────
interface PrefRowProps {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  C: AppColors;
  isLast?: boolean;
}

function PrefRow({ icon, iconColor, title, description, value, onToggle, C, isLast }: PrefRowProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleToggle = useCallback((v: boolean) => {
    // Small bounce animation on toggle
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
    ]).start();
    onToggle(v);
  }, [onToggle, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <View style={[
        pr.wrap,
        { borderBottomColor: C.border },
        isLast ? { borderBottomWidth: 0 } : null,
      ]}>
        {/* Icon */}
        <View style={[pr.iconBox, { backgroundColor: `${iconColor}18`, borderColor: `${iconColor}30` }]}>
          <Ionicons name={icon as any} size={18} color={iconColor} />
        </View>

        {/* Text */}
        <View style={pr.textCol}>
          <Text style={[pr.title, { color: C.textPrimary }]}>{title}</Text>
          <Text style={[pr.desc, { color: C.textMuted }]}>{description}</Text>
        </View>

        {/* Toggle */}
        <Switch
          value={value}
          onValueChange={handleToggle}
          trackColor={{ true: iconColor, false: C.border }}
          thumbColor={C.textPrimary}
          ios_backgroundColor={C.border}
        />
      </View>
    </Animated.View>
  );
}

const pr = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: SPACING.md, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: FONTS.semiBold },
  desc: { fontSize: 12, lineHeight: 17 },
});

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, C }: { title: string; C: AppColors }) {
  return (
    <Text style={[sh.text, { color: C.textMuted }]}>{title}</Text>
  );
}
const sh = StyleSheet.create({
  text: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 6 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();

  const [prefs, setPrefs] = useState<NotificationPreferences>({ ...DEFAULT_NOTIF_PREFS });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    loadNotificationPrefs().then((p) => {
      setPrefs(p);
      setLoading(false);
    });
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Auto-save on change
  const updatePref = useCallback(<K extends keyof NotificationPreferences>(key: K, value: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveNotificationPrefs(next).catch(() => {});
      return next;
    });
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  const sections = [
    {
      title: 'Match Alerts',
      rows: [
        {
          key: 'matchReminders' as const,
          icon: 'alarm-outline',
          iconColor: '#3B82F6',
          title: 'Match Reminders',
          description: 'Get notified 30 minutes before kick-off for matches you follow',
        },
        {
          key: 'liveScoreAlerts' as const,
          icon: 'pulse-outline',
          iconColor: '#EF4444',
          title: 'Live Score Alerts',
          description: 'Real-time goal and key event alerts for followed matches',
        },
      ],
    },
    {
      title: 'Daily & Challenges',
      rows: [
        {
          key: 'dailyChallenge' as const,
          icon: 'flash-outline',
          iconColor: '#F59E0B',
          title: 'Daily Challenge Reminder',
          description: 'Morning reminder at 9am when a new challenge is available',
        },
      ],
    },
    {
      title: 'Tips & News',
      rows: [
        {
          key: 'vipTipsAlerts' as const,
          icon: 'bulb-outline',
          iconColor: '#8B5CF6',
          title: 'VIP Tips Alerts',
          description: 'Be the first to know when new expert VIP tips are posted',
        },
        {
          key: 'breakingNews' as const,
          icon: 'newspaper-outline',
          iconColor: '#22C55E',
          title: 'Breaking News',
          description: 'Important sports news and transfer updates',
        },
      ],
    },
  ];

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Notifications</Text>
          {/* Saved indicator */}
          <View style={s.savedWrap}>
            {saved ? (
              <View style={[s.savedPill, { backgroundColor: '#22C55E18', borderColor: '#22C55E33' }]}>
                <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                <Text style={[s.savedText, { color: '#22C55E' }]}>Saved</Text>
              </View>
            ) : <View style={{ width: 60 }} />}
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Intro card */}
          <View style={[s.infoCard, { backgroundColor: C.card, borderColor: `${C.primary}33` }]}>
            <View style={[s.infoIconWrap, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
              <Ionicons name="notifications-outline" size={20} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.infoTitle, { color: C.textPrimary }]}>Stay in the Loop</Text>
              <Text style={[s.infoDesc, { color: C.textMuted }]}>
                Choose which notifications you want to receive. Changes are saved automatically.
              </Text>
            </View>
          </View>

          {sections.map((section) => (
            <View key={section.title}>
              <SectionHeader title={section.title} C={C} />
              <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
                {section.rows.map((row, idx) => (
                  <PrefRow
                    key={row.key}
                    icon={row.icon}
                    iconColor={row.iconColor}
                    title={row.title}
                    description={row.description}
                    value={prefs[row.key]}
                    onToggle={(v) => updatePref(row.key, v)}
                    C={C}
                    isLast={idx === section.rows.length - 1}
                  />
                ))}
              </View>
            </View>
          ))}

          {/* Footer note */}
          <View style={[s.footerNote, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={[s.footerNoteText, { color: C.textMuted }]}>
              To completely disable notifications, use your device Settings → PredictXta → Notifications.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  savedWrap: { width: 60, alignItems: 'flex-end' },
  savedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
  },
  savedText: { fontSize: 10, fontWeight: FONTS.bold },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: SPACING.md, marginTop: SPACING.md, marginBottom: 4,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
  },
  infoIconWrap: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  infoTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: 3 },
  infoDesc: { fontSize: 12, lineHeight: 17 },
  sectionCard: {
    marginHorizontal: SPACING.md, borderRadius: RADIUS.xl,
    borderWidth: 1, overflow: 'hidden',
  },
  footerNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: SPACING.md, marginTop: SPACING.md,
    borderRadius: RADIUS.lg, borderWidth: 1, padding: 12,
  },
  footerNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
});
