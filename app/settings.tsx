import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Switch, TextInput, ActivityIndicator, Linking, Platform, Animated,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, useAlert, getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useTheme } from '@/contexts/ThemeContext';
import { COLORS as DARK_DEFAULTS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLocale } from '@/hooks/useLocale';
import { useTranslatedContent } from '@/hooks/useTranslatedContent';

// ─── Push notification helpers ───────────────────────────────────────────────
const PUSH_ENABLED_KEY = '@predictxta/push_notifications_enabled';

async function registerForPushNotifications(): Promise<{ token: string | null; denied: boolean }> {
  if (!Device.isDevice) return { token: null, denied: false };

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return { token: null, denied: true };
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    return { token: tokenResponse.data, denied: false };
  } catch {
    return { token: null, denied: false };
  }
}

async function savePushTokenToDb(userId: string, token: string | null): Promise<void> {
  try {
    await getSupabaseClient()
      .from('user_profiles')
      .update({ push_token: token })
      .eq('id', userId);
  } catch { /* non-blocking */ }
}

// ─── AsyncStorage keys ─────────────────────────────────────────────────────────
const NOTIF_KEYS = {
  goalAlerts: '@predictxta/notif_goal_alerts',
  predictionAlerts: '@predictxta/notif_prediction_alerts',
  vipTips: '@predictxta/notif_vip_tips',
};

// ─── VIP Subscription hook ────────────────────────────────────────────────────
interface VipInfo {
  isVip: boolean;
  plan: string | null;
  expiresAt: string | null;
  loading: boolean;
}

function useVipInfo(userId: string | undefined): VipInfo {
  const [info, setInfo] = useState<VipInfo>({ isVip: false, plan: null, expiresAt: null, loading: true });

  useEffect(() => {
    if (!userId) {
      setInfo({ isVip: false, plan: null, expiresAt: null, loading: false });
      return;
    }
    const supabase = getSupabaseClient();
    supabase
      .from('vip_subscriptions')
      .select('plan, status, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const row = data as { plan: string; expires_at: string };
          setInfo({ isVip: true, plan: row.plan, expiresAt: row.expires_at, loading: false });
        } else {
          setInfo({ isVip: false, plan: null, expiresAt: null, loading: false });
        }
      });
  }, [userId]);

  return info;
}

// ─── Notification toggles hook ────────────────────────────────────────────────
function useNotifToggles() {
  const [goalAlerts, setGoalAlerts] = useState(true);
  const [predictionAlerts, setPredictionAlerts] = useState(true);
  const [vipTips, setVipTips] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const allKeys = [...Object.values(NOTIF_KEYS), PUSH_ENABLED_KEY];
    AsyncStorage.multiGet(allKeys).then((pairs) => {
      const map: Record<string, string | null> = {};
      pairs.forEach(([key, val]) => (map[key] = val));
      if (map[NOTIF_KEYS.goalAlerts] !== null) setGoalAlerts(map[NOTIF_KEYS.goalAlerts] === 'true');
      if (map[NOTIF_KEYS.predictionAlerts] !== null) setPredictionAlerts(map[NOTIF_KEYS.predictionAlerts] === 'true');
      if (map[NOTIF_KEYS.vipTips] !== null) setVipTips(map[NOTIF_KEYS.vipTips] === 'true');
      if (map[PUSH_ENABLED_KEY] !== null) setPushEnabled(map[PUSH_ENABLED_KEY] === 'true');
      setLoaded(true);
    });
  }, []);

  const toggleGoalAlerts = useCallback((val: boolean) => {
    setGoalAlerts(val);
    AsyncStorage.setItem(NOTIF_KEYS.goalAlerts, String(val));
  }, []);

  const togglePredictionAlerts = useCallback((val: boolean) => {
    setPredictionAlerts(val);
    AsyncStorage.setItem(NOTIF_KEYS.predictionAlerts, String(val));
  }, []);

  const toggleVipTips = useCallback((val: boolean) => {
    setVipTips(val);
    AsyncStorage.setItem(NOTIF_KEYS.vipTips, String(val));
  }, []);

  return { goalAlerts, predictionAlerts, vipTips, pushEnabled, setPushEnabled, loaded, toggleGoalAlerts, togglePredictionAlerts, toggleVipTips };
}

// ─── Format date helpers ──────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPlanName(plan: string) {
  if (plan === 'monthly') return 'Monthly';
  if (plan === 'quarterly') return 'Quarterly';
  if (plan === 'annual') return 'Annual';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { showAlert } = useAlert();
  const { colors, isDark, toggleTheme, mode } = useTheme();
  const vip = useVipInfo(user?.id);
  const { languageInfo } = useLanguage();
  const notifs = useNotifToggles();
  const { t } = useLocale();
  const { translate, needsTranslation } = useTranslatedContent();
  const { language } = useLanguage();

  const [username, setUsername] = useState(user?.username || user?.email?.split('@')[0] || 'User');
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);

  // Dynamic translated texts for VIP plan info and member-since date
  const [displayPlanName, setDisplayPlanName] = useState('');
  const [displayExpiryDate, setDisplayExpiryDate] = useState('');
  const [displayMemberSince, setDisplayMemberSince] = useState('');
  const vipTranslatedKeyRef = useRef('');
  const memberTranslatedKeyRef = useRef('');

  // Stable language ref to avoid stale closure in translate calls
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);

  const C = colors;

  useEffect(() => {
    if (user) {
      setUsername(user.username || user.email?.split('@')[0] || 'User');
    }
  }, [user]);

  // Translate VIP plan name + expiry date
  useEffect(() => {
    const rawPlan = vip.plan ? formatPlanName(vip.plan) : '';
    const rawExpiry = vip.expiresAt ? formatDate(vip.expiresAt) : '';
    const key = `settings-vip::${rawPlan}::${rawExpiry}::${language}`;

    if (!vip.isVip || vip.loading) return;

    if (!needsTranslation) {
      setDisplayPlanName(rawPlan);
      setDisplayExpiryDate(rawExpiry);
      return;
    }

    if (vipTranslatedKeyRef.current === key) return;
    vipTranslatedKeyRef.current = key;

    const toTranslate = [rawPlan, rawExpiry].filter(Boolean);
    if (toTranslate.length === 0) return;

    Promise.all(toTranslate.map((t) => translate(t, 'general'))).then(([plan, expiry]) => {
      setDisplayPlanName(plan ?? rawPlan);
      setDisplayExpiryDate(expiry ?? rawExpiry);
    }).catch(() => {
      setDisplayPlanName(rawPlan);
      setDisplayExpiryDate(rawExpiry);
    });
  }, [vip.plan, vip.expiresAt, vip.isVip, vip.loading, language, needsTranslation]);

  // Translate member-since date
  useEffect(() => {
    const rawDate = user?.created_at ? formatDate(user.created_at) : 'May 2025';
    const key = `settings-member::${rawDate}::${language}`;

    if (!needsTranslation) {
      setDisplayMemberSince(rawDate);
      return;
    }

    if (memberTranslatedKeyRef.current === key) return;
    memberTranslatedKeyRef.current = key;

    translate(rawDate, 'general').then((d) => setDisplayMemberSince(d)).catch(() => setDisplayMemberSince(rawDate));
  }, [user?.created_at, language, needsTranslation]);

  // ── Push notification toggle ──
  const handlePushToggle = useCallback(async (val: boolean) => {
    if (!user?.id) return;

    if (!val) {
      // Disable: clear token from DB and local state
      notifs.setPushEnabled(false);
      await AsyncStorage.setItem(PUSH_ENABLED_KEY, 'false');
      await savePushTokenToDb(user.id, null);
      return;
    }

    // Enable: request permission + register token
    setPushRegistering(true);
    const { token, denied } = await registerForPushNotifications();
    setPushRegistering(false);

    if (denied) {
      showAlert(
        'Permission Required',
        'Push notifications are blocked. Please enable them in your device Settings to receive live goal alerts and daily challenge reminders.',
        [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    if (token) {
      notifs.setPushEnabled(true);
      await AsyncStorage.setItem(PUSH_ENABLED_KEY, 'true');
      await savePushTokenToDb(user.id, token);
    }
  }, [user?.id, notifs, showAlert]);

  // ── Logout with audit log ──
  const handleLogout = async () => {
    showAlert(t('auth.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          if (user?.id) {
            const { logSecurityEvent, clearSessionToken } = require('@/services/authSecurityService');
            await logSecurityEvent(user.id, { eventType: 'logout', status: 'success' });
            await clearSessionToken();
          }
          await logout();
          setLoggingOut(false);
          router.replace('/login' as any);
        },
      },
    ]);
  };

  // ── Delete Account ──────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm1' | 'confirm2' | 'deleting' | 'done'>('idle');
  const deletePulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (deleting) {
      const anim = Animated.loop(Animated.sequence([
        Animated.timing(deletePulse, { toValue: 0.4, duration: 500, useNativeDriver: true }),
        Animated.timing(deletePulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]));
      anim.start();
      return () => anim.stop();
    }
  }, [deleting]);

  const executeAccountDeletion = useCallback(async () => {
    if (!user?.id) return;
    setDeleting(true);
    setDeleteStep('deleting');

    try {
      const supabase = getSupabaseClient();

      // Get current session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No active session');

      // Call the delete-account Edge Function
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message}`;
          } catch {
            errorMessage = error.message;
          }
        }
        throw new Error(errorMessage);
      }

      if (!data?.success) {
        throw new Error(data?.error ?? 'Deletion failed unexpectedly');
      }

      // Clear ALL local storage
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys);

      setDeleteStep('done');

      // Sign out locally (auth user is already gone on server)
      try { await logout(); } catch { /* already deleted */ }

      showAlert(
        'Account Deleted',
        'Your account and all associated data have been permanently removed.',
        [{ text: 'OK', onPress: () => router.replace('/login' as any) }],
      );

    } catch (err: any) {
      setDeleteStep('idle');
      const msg = err?.message ?? 'Unknown error';
      showAlert(
        'Deletion Failed',
        `Could not delete your account.

${msg}

Please contact support@predictxta.com if this persists.`,
      );
    } finally {
      setDeleting(false);
    }
  }, [user?.id, logout, router, showAlert]);

  const handleDeleteAccount = useCallback(() => {
    // Step 1 — initial warning
    showAlert(
      'Delete Account?',
      'This will permanently remove your account, predictions, coins, VIP subscription, and all personal data. This action CANNOT be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            // Step 2 — final confirmation with typed-intent feel
            showAlert(
              'Are you absolutely sure?',
              `You are about to permanently delete the account for:

${user?.email ?? 'your account'}

All data will be erased from our servers immediately.`,
              [
                { text: 'Go Back', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: executeAccountDeletion,
                },
              ],
            );
          },
        },
      ],
    );
  }, [user?.email, executeAccountDeletion, showAlert]);

  const memberSince = displayMemberSince || (user?.created_at ? formatDate(user.created_at) : 'May 2025');

  // ── Section Header ──
  const SectionHeader = ({ titleKey, icon }: { titleKey: string; icon?: string }) => (
    <View style={[s.sectionHeaderWrap]}>
      {icon ? <Ionicons name={icon as any} size={12} color={C.textMuted} /> : null}
      <Text style={[s.sectionHeader, { color: C.textMuted }]}>{t(titleKey).toUpperCase()}</Text>
    </View>
  );

  // ── Info Row ──
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View style={[s.row, { borderBottomColor: C.border }]}>
      <Text style={[s.rowLabel, { color: C.textPrimary }]}>{label}</Text>
      <Text style={[s.rowValue, { color: C.textSecondary }]} numberOfLines={1}>{value}</Text>
    </View>
  );

  // ── Toggle Row ──
  const ToggleRow = ({
    icon, iconColor, labelKey, subKey, value, onChange, isLast,
  }: {
    icon: string; iconColor: string; labelKey: string; subKey: string;
    value: boolean; onChange: (v: boolean) => void; isLast?: boolean;
  }) => (
    <View style={[s.row, { borderBottomColor: C.border }, isLast ? s.rowLast : null]}>
      <View style={[s.rowIconWrap, { backgroundColor: `${iconColor}22` }]}>
        <Ionicons name={icon as any} size={15} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t(labelKey)}</Text>
        <Text style={[s.rowSub, { color: C.textMuted }]}>{t(subKey)}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.border, true: C.primaryDark }}
        thumbColor={value ? C.primary : C.textMuted}
        ios_backgroundColor={C.border}
      />
    </View>
  );

  // ── Press Row ──
  const PressRow = ({
    icon, iconColor, labelKey, value, onPress, valueColor, isLast,
  }: {
    icon?: string; iconColor?: string; labelKey: string; value?: string;
    onPress: () => void; valueColor?: string; isLast?: boolean;
  }) => (
    <Pressable
      style={({ pressed }) => [
        s.row, { borderBottomColor: C.border },
        isLast ? s.rowLast : null,
        pressed ? { backgroundColor: C.cardHighlight } : null,
      ]}
      onPress={onPress}
    >
      {icon ? (
        <View style={[s.rowIconWrap, { backgroundColor: iconColor ? `${iconColor}22` : C.surface }]}>
          <Ionicons name={icon as any} size={15} color={iconColor || C.textMuted} />
        </View>
      ) : null}
      <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t(labelKey)}</Text>
      <View style={s.pressRight}>
        {value ? <Text style={[s.rowValue, { color: valueColor ?? C.textSecondary }]}>{value}</Text> : null}
        <MaterialIcons name="chevron-right" size={18} color={C.textMuted} />
      </View>
    </Pressable>
  );

  // ── Username Edit Section ──
  const UsernameEditSection = ({
    currentUsername, userId, onSaved,
  }: { currentUsername: string; userId: string; onSaved: (n: string) => void }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(currentUsername);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
      const trimmed = draft.trim();
      if (!trimmed) { setError('Username cannot be empty'); return; }
      if (trimmed.length < 3) { setError('Minimum 3 characters'); return; }
      if (trimmed.length > 24) { setError('Maximum 24 characters'); return; }
      setSaving(true); setError('');
      try {
        const supabase = getSupabaseClient();
        const { error: dbErr } = await supabase.from('user_profiles').update({ username: trimmed }).eq('id', userId);
        if (dbErr) { setError('Failed to save. Try again.'); }
        else { onSaved(trimmed); setEditing(false); showAlert(t('common.success'), 'Username updated successfully.'); }
      } catch { setError('Network error. Try again.'); }
      finally { setSaving(false); }
    };

    if (!editing) {
      return (
        <Pressable
          style={({ pressed }) => [s.row, { borderBottomColor: C.border }, pressed ? { backgroundColor: C.cardHighlight } : null]}
          onPress={() => setEditing(true)}
        >
          <View style={[s.rowIconWrap, { backgroundColor: `${C.primary}22` }]}>
            <Ionicons name="person-outline" size={15} color={C.primary} />
          </View>
          <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t('settings.username')}</Text>
          <View style={s.pressRight}>
            <Text style={[s.rowValue, { color: C.textSecondary }]}>{currentUsername}</Text>
            <MaterialIcons name="edit" size={16} color={C.textMuted} />
          </View>
        </Pressable>
      );
    }

    return (
      <View style={[s.editSection, { borderBottomColor: C.border, backgroundColor: C.cardHighlight }]}>
        <Text style={[s.editLabel, { color: C.textMuted }]}>{t('settings.username')}</Text>
        <TextInput
          style={[s.editInput, { backgroundColor: C.surface, borderColor: error ? C.accentRed : C.border, color: C.textPrimary }]}
          value={draft}
          onChangeText={(text) => { setDraft(text); setError(''); }}
          placeholder="Enter username"
          placeholderTextColor={C.textMuted}
          autoFocus maxLength={24} autoCapitalize="none" autoCorrect={false}
        />
        <View style={s.editBtnRow}>
          <Pressable
            style={[s.editCancelBtn, { backgroundColor: C.surface, borderColor: C.border }]}
            onPress={() => { setDraft(currentUsername); setError(''); setEditing(false); }}
          >
            <Text style={[s.editCancelText, { color: C.textSecondary }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            style={[s.editSaveBtn, { backgroundColor: C.primary }, saving ? { opacity: 0.6 } : null]}
            onPress={handleSave} disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color={C.textInverse} />
              : <Text style={[s.editSaveText, { color: C.textInverse }]}>{t('common.save')}</Text>
            }
          </Pressable>
        </View>
        {error ? (
          <View style={s.editError}>
            <Ionicons name="warning-outline" size={12} color={C.accentRed} />
            <Text style={[s.editErrorText, { color: C.accentRed }]}>{error}</Text>
          </View>
        ) : null}
        <Text style={[s.editHint, { color: C.textMuted }]}>{draft.trim().length} / 24 {t('settings.username').toLowerCase()}</Text>
      </View>
    );
  };

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>{t('settings.title')}</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Profile Card ── */}
        <View style={[s.profileCard, { borderColor: 'rgba(255,215,0,0.2)' }]}>
          <LinearGradient
            colors={[isDark ? 'rgba(255,215,0,0.1)' : 'rgba(255,195,0,0.08)', 'transparent']}
            style={s.profileGradient}
          >
            <View style={[s.avatarWrap, { backgroundColor: C.primaryGlow, borderColor: 'rgba(255,215,0,0.4)' }]}>
              <Text style={[s.avatarInitial, { color: C.primary }]}>
                {username.charAt(0).toUpperCase()}
              </Text>
              {vip.isVip ? (
                <View style={[s.crownBadge, { backgroundColor: C.primaryGlow }]}>
                  <FontAwesome5 name="crown" size={9} color={C.primary} />
                </View>
              ) : null}
            </View>
            <View style={s.profileInfo}>
              <View style={s.profileNameRow}>
                <Text style={[s.profileName, { color: C.textPrimary }]}>{username}</Text>
                {vip.isVip ? (
                  <View style={[s.vipPill, { backgroundColor: C.primaryGlow }]}>
                    <FontAwesome5 name="crown" size={9} color={C.primary} />
                    <Text style={[s.vipPillText, { color: C.primary }]}>{t('common.vip')}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[s.profileEmail, { color: C.textMuted }]}>{user?.email || ''}</Text>
              {vip.isVip && vip.plan && vip.expiresAt ? (
                <Text style={[s.vipExpiry, { color: C.primary }]}>
                  {displayPlanName || formatPlanName(vip.plan)} {t('settings.manage').toLowerCase()} · {t('vip.expires').replace('{{date}}', displayExpiryDate || formatDate(vip.expiresAt))}
                </Text>
              ) : !vip.loading ? (
                <Pressable style={s.upgradeLink} onPress={() => router.push('/vip' as any)}>
                  <FontAwesome5 name="crown" size={10} color={C.primary} />
                  <Text style={[s.upgradeLinkText, { color: C.primary }]}>{t('common.upgrade')} {t('common.vip')}</Text>
                </Pressable>
              ) : null}
            </View>
          </LinearGradient>
        </View>

        {/* ── Profile Edit ── */}
        <SectionHeader titleKey="settings.profile" icon="person-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          {user ? (
            <UsernameEditSection currentUsername={username} userId={user.id} onSaved={setUsername} />
          ) : null}
          <InfoRow label={t('settings.email')} value={user?.email || '—'} />
          <InfoRow label={t('settings.memberSince')} value={memberSince} />
          {vip.isVip && vip.plan ? (
            <View style={[s.row, s.rowLast, { borderBottomColor: C.border }]}>
              <View style={[s.rowIconWrap, { backgroundColor: C.primaryGlow }]}>
                <FontAwesome5 name="crown" size={13} color={C.primary} />
              </View>
              <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t('settings.vipPlan')}</Text>
              <View style={s.pressRight}>
                <Text style={[s.rowValue, { color: C.primary }]}>{displayPlanName || formatPlanName(vip.plan)}</Text>
                <Pressable
                  style={[s.manageVipBtn, { backgroundColor: C.primaryGlow }]}
                  onPress={() => router.push('/vip' as any)}
                >
                  <Text style={[s.manageVipText, { color: C.primary }]}>{t('settings.manage')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Notifications ── */}
        <SectionHeader titleKey="settings.notifications" icon="notifications-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* Push Notifications master toggle */}
          <View style={[s.row, { borderBottomColor: C.border }]}>
            <View style={[s.rowIconWrap, { backgroundColor: `${C.accentBlue}22` }]}>
              {pushRegistering
                ? <ActivityIndicator size="small" color={C.accentBlue} />
                : <Ionicons name="notifications" size={15} color={C.accentBlue} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: C.textPrimary }]}>Push Notifications</Text>
              <Text style={[s.rowSub, { color: C.textMuted }]}>
                {notifs.pushEnabled
                  ? 'Live goal alerts, predictions & reminders'
                  : 'Enable to receive live alerts on your device'}
              </Text>
            </View>
            <Switch
              value={notifs.pushEnabled}
              onValueChange={handlePushToggle}
              disabled={pushRegistering}
              trackColor={{ false: C.border, true: C.accentBlue + '99' }}
              thumbColor={notifs.pushEnabled ? C.accentBlue : C.textMuted}
              ios_backgroundColor={C.border}
            />
          </View>

          {/* Push permission status banner (shown when disabled) */}
          {!notifs.pushEnabled ? (
            <Pressable
              style={[s.pushBanner, { backgroundColor: `${C.accentBlue}0D`, borderColor: `${C.accentBlue}22` }]}
              onPress={() => handlePushToggle(true)}
            >
              <Ionicons name="information-circle-outline" size={14} color={C.accentBlue} />
              <Text style={[s.pushBannerText, { color: C.accentBlue }]}>
                Tap to enable push notifications and register your device
              </Text>
              <Ionicons name="chevron-forward" size={14} color={C.accentBlue} />
            </Pressable>
          ) : null}

          <ToggleRow
            icon="football-outline" iconColor={C.accent}
            labelKey="settings.goalAlerts" subKey="settings.goalAlertsSub"
            value={notifs.goalAlerts} onChange={notifs.toggleGoalAlerts}
          />
          <ToggleRow
            icon="analytics-outline" iconColor={C.accentBlue}
            labelKey="settings.aiPredictions" subKey="settings.aiPredictionsSub"
            value={notifs.predictionAlerts} onChange={notifs.togglePredictionAlerts}
          />
          <ToggleRow
            icon="star-outline" iconColor={C.primary}
            labelKey="settings.vipTips" subKey="settings.vipTipsSub"
            value={notifs.vipTips} onChange={notifs.toggleVipTips}
          />
          <PressRow
            icon="options-outline" iconColor={C.accentPurple}
            labelKey="settings.notifPrefs" value="Advanced"
            onPress={() => router.push('/notification-preferences' as any)}
            isLast
          />
        </View>

        {/* ── Language ── */}
        <SectionHeader titleKey="settings.language" icon="language-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <PressRow
            icon="language-outline"
            iconColor={C.accentBlue}
            labelKey="settings.selectLanguage"
            value={`${languageInfo.flag} ${languageInfo.nativeName}`}
            onPress={() => router.push('/language-settings' as any)}
            isLast
          />
        </View>

        {/* ── Appearance / Theme ── */}
        <SectionHeader titleKey="settings.appearance" icon="color-palette-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* Toggle row */}
          <View style={[s.row, { borderBottomColor: C.border }]}>
            <View style={[s.rowIconWrap, { backgroundColor: isDark ? 'rgba(168,85,247,0.15)' : 'rgba(255,195,0,0.15)' }]}>
              <Ionicons
                name={isDark ? 'moon-outline' : 'sunny-outline'}
                size={15}
                color={isDark ? C.accentPurple : '#D4A000'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t('settings.darkMode')}</Text>
              <Text style={[s.rowSub, { color: C.textMuted }]}>
                {isDark
                  ? `${t('settings.dark')} mode`
                  : `${t('settings.light')} mode`}
              </Text>
            </View>
            <Switch
              value={!isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: C.border, true: 'rgba(212,160,0,0.55)' }}
              thumbColor={isDark ? C.textMuted : '#C9A800'}
              ios_backgroundColor={C.border}
            />
          </View>

          {/* Visual picker tiles */}
          <View style={[s.row, s.rowLast, { borderBottomColor: C.border, gap: 10 }]}>
            {/* Dark tile */}
            <Pressable
              style={({ pressed }) => [
                s.themeTile,
                { borderColor: isDark ? C.primary : C.border, backgroundColor: '#070B14' },
                isDark ? { borderWidth: 2 } : null,
                pressed ? { opacity: 0.8 } : null,
              ]}
              onPress={() => { if (!isDark) toggleTheme(); }}
            >
              <View style={s.themeTileBar1} />
              <View style={s.themeTileBar2} />
              <View style={s.themeTileBarShort} />
              {isDark ? (
                <View style={[s.themeTileCheck, { backgroundColor: C.primary }]}>
                  <Ionicons name="checkmark" size={10} color="#070B14" />
                </View>
              ) : null}
              <Text style={[s.themeTileLabel, { color: isDark ? C.primary : '#8B9BB4' }]}>{t('settings.dark')}</Text>
            </Pressable>

            {/* Light tile */}
            <Pressable
              style={({ pressed }) => [
                s.themeTile,
                { borderColor: !isDark ? '#C9A800' : C.border, backgroundColor: '#F0F4FA' },
                !isDark ? { borderWidth: 2 } : null,
                pressed ? { opacity: 0.8 } : null,
              ]}
              onPress={() => { if (isDark) toggleTheme(); }}
            >
              <View style={[s.themeTileBar1, { backgroundColor: '#D1DCF0' }]} />
              <View style={[s.themeTileBar2, { backgroundColor: '#C9A800' }]} />
              <View style={[s.themeTileBarShort, { backgroundColor: '#D1DCF0' }]} />
              {!isDark ? (
                <View style={[s.themeTileCheck, { backgroundColor: '#C9A800' }]}>
                  <Ionicons name="checkmark" size={10} color="#fff" />
                </View>
              ) : null}
              <Text style={[s.themeTileLabel, { color: !isDark ? '#C9A800' : C.textMuted }]}>{t('settings.light')}</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Security ── */}
        <SectionHeader titleKey="settings.security" icon="shield-checkmark-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <PressRow
            icon="shield-checkmark-outline"
            iconColor={C.primary}
            labelKey="settings.security"
            value="Sessions · Audit Log"
            onPress={() => router.push('/security' as any)}
          />
          <PressRow
            icon="lock-closed-outline"
            iconColor={C.accentBlue}
            labelKey="settings.changePassword"
            value="Reset via Email"
            onPress={() => {
              showAlert(
                'Change Password',
                'A password reset link will be sent to your email.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send Link',
                    onPress: async () => {
                      if (user?.email) {
                        const supabase = getSupabaseClient();
                        await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: 'predictxta://reset-password' });
                        showAlert('Email Sent', 'Check your inbox for the reset link.');
                      }
                    },
                  },
                ],
              );
            }}
            isLast
          />
        </View>

        {/* ── Legal ── */}
        <SectionHeader titleKey="settings.legal" icon="document-text-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <PressRow
            icon="document-text-outline" iconColor={C.accentBlue}
            labelKey="settings.privacy"
            onPress={() => router.push('/privacy' as any)}
          />
          <PressRow
            icon="shield-checkmark-outline" iconColor={C.accent}
            labelKey="settings.terms"
            onPress={() => router.push('/terms' as any)}
          />
          <PressRow
            icon="star-outline" iconColor={C.primary}
            labelKey="settings.rateApp"
            onPress={() => showAlert(t('settings.rateApp'), 'Thank you! Redirecting to app store rating.')}
          />
          <View style={[s.row, s.rowLast, { borderBottomColor: C.border }]}>
            <View style={[s.rowIconWrap, { backgroundColor: C.surface }]}>
              <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
            </View>
            <Text style={[s.rowLabel, { color: C.textPrimary }]}>{t('settings.version')}</Text>
            <Text style={[s.rowValue, { color: C.textSecondary }]}>1.0.0 (build 100)</Text>
          </View>
        </View>

        {/* ── Sign Out ── */}
        <SectionHeader titleKey="settings.accountActions" icon="log-out-outline" />
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <Pressable
            style={({ pressed }) => [
              s.row, s.rowLast, { borderBottomColor: C.border },
              pressed ? { backgroundColor: C.cardHighlight } : null,
            ]}
            onPress={handleLogout}
            disabled={loggingOut}
          >
            <View style={[s.rowIconWrap, { backgroundColor: 'rgba(255,71,87,0.12)' }]}>
              {loggingOut
                ? <ActivityIndicator size="small" color={C.accentRed} />
                : <Ionicons name="log-out-outline" size={15} color={C.accentRed} />
              }
            </View>
            <Text style={[s.rowLabel, { color: C.accentRed }]}>
              {loggingOut ? t('settings.signingOut') : t('settings.signOut')}
            </Text>
            <MaterialIcons name="chevron-right" size={18} color={C.accentRed} />
          </Pressable>
        </View>

        {/* ── Danger Zone ── */}
        <SectionHeader titleKey="settings.dangerZone" icon="warning-outline" />
        <View style={[s.section, s.dangerSection, { borderColor: 'rgba(255,71,87,0.25)' }]}>
          {/* Delete Account row */}
          <Pressable
            style={({ pressed }) => [s.dangerRow, pressed && !deleting ? { opacity: 0.8 } : null]}
            onPress={deleting ? undefined : handleDeleteAccount}
            disabled={deleting}
          >
            <Animated.View
              style={[
                s.rowIconWrap,
                { backgroundColor: 'rgba(255,71,87,0.12)' },
                deleting ? { opacity: deletePulse } : null,
              ]}
            >
              {deleting
                ? <ActivityIndicator size="small" color={C.accentRed} />
                : <Ionicons name="trash-outline" size={15} color={C.accentRed} />}
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={[s.dangerTitle, { color: C.accentRed }]}>
                {deleting ? 'Deleting account…' : t('settings.deleteAccount')}
              </Text>
              <Text style={[s.dangerSub, { color: 'rgba(255,71,87,0.65)' }]}>
                {deleting
                  ? 'Removing all your data from our servers'
                  : 'Permanently erase account and all data'}
              </Text>
            </View>
            {!deleting ? <MaterialIcons name="chevron-right" size={18} color={C.accentRed} /> : null}
          </Pressable>

          {/* Play Store Data Safety compliance notice */}
          <View style={[s.dataNotice, { borderTopColor: 'rgba(255,71,87,0.2)', backgroundColor: 'rgba(255,71,87,0.04)' }]}>
            <Ionicons name="shield-checkmark-outline" size={11} color="rgba(255,71,87,0.5)" />
            <Text style={[s.dataNoticeText, { color: 'rgba(255,71,87,0.55)' }]}>
              Account deletion removes all personal data per our Privacy Policy and Play Store Data Safety requirements. This cannot be reversed.
            </Text>
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles (theme-independent structure) ──────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: FONTS.bold },

  scroll: { paddingBottom: 24 },

  // Profile card
  profileCard: {
    marginHorizontal: SPACING.md, marginTop: SPACING.md,
    borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1,
  },
  profileGradient: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
  },
  avatarWrap: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    position: 'relative', flexShrink: 0,
  },
  avatarInitial: { fontSize: 24, fontWeight: FONTS.bold },
  crownBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  profileInfo: { flex: 1, gap: 3 },
  profileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileName: { fontSize: 18, fontWeight: FONTS.bold },
  vipPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  vipPillText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  profileEmail: { fontSize: 13 },
  vipExpiry: { fontSize: 11, fontWeight: FONTS.medium, marginTop: 2 },
  upgradeLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  upgradeLinkText: { fontSize: 12, fontWeight: FONTS.semiBold },

  // Section
  sectionHeaderWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: 6,
  },
  sectionHeader: { fontSize: 11, fontWeight: FONTS.bold, letterSpacing: 1 },
  section: {
    marginHorizontal: SPACING.md, borderRadius: RADIUS.lg,
    borderWidth: 1, overflow: 'hidden',
  },
  dangerSection: { backgroundColor: 'rgba(255,71,87,0.05)' },

  // Rows
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: 1, gap: 12,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: FONTS.medium },
  rowSub: { fontSize: 12, marginTop: 1 },
  rowValue: { fontSize: 13 },
  pressRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // VIP manage button
  manageVipBtn: {
    borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  manageVipText: { fontSize: 11, fontWeight: FONTS.bold },

  // Username edit
  editSection: {
    paddingHorizontal: 14, paddingVertical: 12, gap: 8, borderBottomWidth: 1,
  },
  editLabel: { fontSize: 11, fontWeight: FONTS.semiBold, letterSpacing: 0.5 },
  editInput: {
    borderRadius: RADIUS.md, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  editBtnRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  editCancelBtn: {
    paddingHorizontal: 18, paddingVertical: 9,
    borderRadius: RADIUS.full, borderWidth: 1,
  },
  editCancelText: { fontSize: 14, fontWeight: FONTS.medium },
  editSaveBtn: {
    paddingHorizontal: 22, paddingVertical: 9,
    borderRadius: RADIUS.full, minWidth: 80, alignItems: 'center',
  },
  editSaveText: { fontSize: 14, fontWeight: FONTS.bold },
  editError: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  editErrorText: { fontSize: 12 },
  editHint: { fontSize: 11, textAlign: 'right' },

  // Theme tiles
  themeTile: {
    flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 5, position: 'relative',
    minHeight: 80, justifyContent: 'center',
  },
  themeTileBar1: { height: 6, borderRadius: 3, backgroundColor: '#253550', width: '80%' },
  themeTileBar2: { height: 6, borderRadius: 3, backgroundColor: '#FFD700', width: '50%' },
  themeTileBarShort: { height: 6, borderRadius: 3, backgroundColor: '#1E2D45', width: '65%' },
  themeTileCheck: {
    position: 'absolute', top: 7, right: 7,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  themeTileLabel: { fontSize: 11, fontWeight: FONTS.bold, marginTop: 2 },

  // Push notification banner
  pushBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pushBannerText: { flex: 1, fontSize: 12, lineHeight: 17 },

  // Danger zone
  dangerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  dangerTitle: { fontSize: 15, fontWeight: FONTS.medium },
  dangerSub: { fontSize: 12, marginTop: 1 },
  dataNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1,
  },
  dataNoticeText: { flex: 1, fontSize: 10, lineHeight: 15 },
});
