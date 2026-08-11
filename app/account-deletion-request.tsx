/**
 * account-deletion-request.tsx
 *
 * Account & data deletion screen — required for Play Store Data Safety form
 * and Google Play policy compliance.
 *
 * Flow:
 *  1. User reads what will be deleted
 *  2. Types "DELETE" to confirm
 *  3. Edge function permanently removes all data + auth account
 *  4. All local AsyncStorage keys are cleared
 *  5. User is redirected to account-deleted confirmation screen
 *
 * Accessible via: Profile → Settings → Privacy → Delete My Data
 * Public web URL: /privacy  (links to this flow)
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useAlert, getSupabaseClient } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────
const CONFIRM_WORD = 'DELETE';

/** All AsyncStorage keys used across the app — cleared on account deletion */
const ALL_STORAGE_KEYS = [
  '@predictxta/deployment_checklist_v1',
  '@predictxta/deployment_checklist_v2',
  '@predictxta/deployment_checklist_v3',
  '@predictxta/chat_last_seen',
  '@predictxta/chat_room_seen_map',
  '@predictxta/joined_rooms',
  '@predictxta/cookie_consent',
  '@predictxta/onboarding_complete',
  '@predictxta/first_launch_language_shown',
  '@predictxta/vip_unlock_',
  '@predictxta/coin_unlock_',
  'predictxta_challenge_history_v1',
  'predictxta_followed_matches',
  'predictxta_followed_clubs',
  'predictxta_push_token',
  'predictxta_push_permission_asked',
  'predictxta_preferred_language',
  'predictxta_theme',
  'predictxta_referral_code',
  '@supabase/auth-token',
  'supabase.auth.token',
];

// ─── Data deletion categories shown to user ──────────────────────────────────
const DELETION_ITEMS = [
  { icon: 'person-outline' as const, label: 'Account & profile', desc: 'Name, email, avatar, username' },
  { icon: 'stats-chart-outline' as const, label: 'Prediction history', desc: 'All AI picks and outcomes you generated' },
  { icon: 'flash-outline' as const, label: 'Challenge history', desc: 'Daily challenge picks and streak data' },
  { icon: 'chatbubbles-outline' as const, label: 'Chat messages', desc: 'All messages sent in community rooms' },
  { icon: 'wallet-outline' as const, label: 'Coins & rewards', desc: 'Coin balance, earn history, VIP subscription' },
  { icon: 'bookmark-outline' as const, label: 'Bookmarks', desc: 'Saved articles and video bookmarks' },
  { icon: 'shield-checkmark-outline' as const, label: 'Security data', desc: 'Session tokens, audit logs, security settings' },
  { icon: 'people-outline' as const, label: 'Expert program data', desc: 'Expert profile, slips, followers, rewards' },
  { icon: 'notifications-outline' as const, label: 'Notifications', desc: 'All notification history and preferences' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function DeletionItem({ icon, label, desc, C }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  desc: string;
  C: AppColors;
}) {
  return (
    <View style={[di.row, { borderBottomColor: C.border }]}>
      <View style={[di.iconWrap, { backgroundColor: '#EF444412', borderColor: '#EF444422' }]}>
        <Ionicons name={icon} size={16} color="#EF4444" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[di.label, { color: C.textPrimary }]}>{label}</Text>
        <Text style={[di.desc, { color: C.textMuted }]}>{desc}</Text>
      </View>
      <Ionicons name="checkmark" size={14} color="#EF4444" />
    </View>
  );
}

const di = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0,
  },
  label: { fontSize: 13, fontWeight: FONTS.semiBold },
  desc: { fontSize: 11, marginTop: 1, lineHeight: 15 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AccountDeletionRequestScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { showAlert } = useAlert();
  const { colors: C } = useTheme();

  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [step, setStep] = useState<'info' | 'confirm'>('info');
  const inputRef = useRef<TextInput>(null);

  const isConfirmed = confirmInput.trim().toUpperCase() === CONFIRM_WORD;

  /** Clear all local storage keys — best effort, non-blocking */
  const clearLocalData = useCallback(async () => {
    try {
      // Remove all known keys
      await AsyncStorage.multiRemove(ALL_STORAGE_KEYS);
      // Also clear everything to catch any keys we may have missed
      await AsyncStorage.clear();
    } catch {
      // Non-critical — account is already deleted server-side
    }
  }, []);

  /** Call delete-account edge function, clear local data, redirect */
  const handleDeleteAccount = useCallback(async () => {
    if (!user || !isConfirmed || deleting) return;

    setDeleting(true);
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        showAlert('Session Expired', 'Please log in again to delete your account.', [
          { text: 'OK', onPress: () => router.replace('/login' as any) },
        ]);
        setDeleting(false);
        return;
      }

      const { error } = await supabase.functions.invoke('delete-account', {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[${statusCode}] ${textContent || error.message || 'Deletion failed'}`;
          } catch {
            errorMessage = error.message || 'Deletion failed';
          }
        }
        showAlert('Deletion Failed', errorMessage || 'Something went wrong. Please contact support@predictxta.com.');
        setDeleting(false);
        return;
      }

      // ── Success: clear local data, sign out, redirect ─────────────────────
      await clearLocalData();
      await logout();
      router.replace('/account-deleted' as any);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showAlert('Error', `Account deletion failed: ${msg}\n\nPlease contact support@predictxta.com`);
      setDeleting(false);
    }
  }, [user, isConfirmed, deleting, clearLocalData, logout, router, showAlert]);

  const handleProceedToConfirm = useCallback(() => {
    showAlert(
      'This action is permanent',
      'Your account, predictions, coins, chat messages, and all data will be permanently deleted and cannot be recovered.',
      [
        { text: 'Go Back', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setStep('confirm');
            setTimeout(() => inputRef.current?.focus(), 300);
          },
        },
      ],
    );
  }, [showAlert]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[s.root, { backgroundColor: C.bg }]}>
        {/* Header */}
        <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
          <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            <Pressable
              onPress={() => {
                if (step === 'confirm') { setStep('info'); return; }
                router.back();
              }}
              hitSlop={8}
            >
              <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
            </Pressable>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Delete My Data</Text>
            <View style={{ width: 22 }} />
          </View>
        </SafeAreaView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'info' ? (
            <>
              {/* Warning banner */}
              <View style={[s.warningBanner, { backgroundColor: '#EF444410', borderColor: '#EF444433' }]}>
                <Ionicons name="warning" size={24} color="#EF4444" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.warningTitle, { color: '#EF4444' }]}>Permanent Deletion</Text>
                  <Text style={[s.warningBody, { color: '#EF4444CC' }]}>
                    This will permanently delete your PredictXta account and all associated data.
                    This action cannot be undone.
                  </Text>
                </View>
              </View>

              {/* What gets deleted */}
              <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={[s.cardHeader, { borderBottomColor: C.border }]}>
                  <MaterialIcons name="delete-forever" size={18} color="#EF4444" />
                  <Text style={[s.cardTitle, { color: C.textPrimary }]}>What will be deleted</Text>
                </View>
                {DELETION_ITEMS.map((item) => (
                  <DeletionItem key={item.label} {...item} C={C} />
                ))}
                <Text style={[s.cardNote, { color: C.textMuted }]}>
                  All data is deleted immediately from our servers. Backups are purged within 30 days.
                </Text>
              </View>

              {/* Alternatives */}
              <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[s.cardTitle, { color: C.textPrimary, marginBottom: 8 }]}>
                  Before you go…
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    s.altRow, { borderColor: C.border },
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                  onPress={() => router.push('/settings' as any)}
                >
                  <Ionicons name="settings-outline" size={18} color={C.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.altLabel, { color: C.textPrimary }]}>Adjust notification settings</Text>
                    <Text style={[s.altDesc, { color: C.textMuted }]}>Turn off emails or push without deleting</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    s.altRow, { borderColor: 'transparent' },
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                  onPress={() => Linking.openURL('mailto:support@predictxta.com?subject=Account%20Help')}
                >
                  <Ionicons name="mail-outline" size={18} color={C.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.altLabel, { color: C.textPrimary }]}>Contact support</Text>
                    <Text style={[s.altDesc, { color: C.textMuted }]}>support@predictxta.com</Text>
                  </View>
                  <Ionicons name="open-outline" size={14} color={C.textMuted} />
                </Pressable>
              </View>

              {/* Privacy policy link */}
              <Pressable
                style={s.privacyLink}
                onPress={() => router.push('/privacy' as any)}
              >
                <Ionicons name="document-text-outline" size={14} color={C.primary} />
                <Text style={[s.privacyLinkText, { color: C.primary }]}>
                  Read our Privacy Policy
                </Text>
              </Pressable>

              {/* CTA */}
              <Pressable
                style={({ pressed }) => [
                  s.destructiveBtn,
                  { backgroundColor: '#EF444414', borderColor: '#EF444444' },
                  pressed ? { opacity: 0.8 } : null,
                ]}
                onPress={handleProceedToConfirm}
              >
                <MaterialIcons name="delete-forever" size={20} color="#EF4444" />
                <Text style={[s.destructiveBtnText, { color: '#EF4444' }]}>
                  Proceed to Delete My Account
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* Confirm step */}
              <View style={[s.warningBanner, { backgroundColor: '#EF444410', borderColor: '#EF444433' }]}>
                <Ionicons name="alert-circle" size={24} color="#EF4444" />
                <Text style={[s.warningBody, { color: '#EF4444CC', flex: 1 }]}>
                  You are about to permanently delete{' '}
                  <Text style={{ fontWeight: FONTS.bold, color: '#EF4444' }}>
                    {user?.email}
                  </Text>
                  {' '}and all associated data.
                </Text>
              </View>

              {/* Confirmation input */}
              <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[s.confirmPrompt, { color: C.textPrimary }]}>
                  Type{' '}
                  <Text style={[s.confirmWord, { color: '#EF4444' }]}>DELETE</Text>
                  {' '}to confirm permanent deletion:
                </Text>
                <View
                  style={[
                    s.inputWrap,
                    {
                      backgroundColor: C.surface,
                      borderColor: isConfirmed ? '#EF4444' : C.border,
                    },
                  ]}
                >
                  <TextInput
                    ref={inputRef}
                    style={[s.input, { color: isConfirmed ? '#EF4444' : C.textPrimary }]}
                    value={confirmInput}
                    onChangeText={(t) => setConfirmInput(t.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    spellCheck={false}
                    placeholder="Type DELETE here"
                    placeholderTextColor={C.textMuted}
                    maxLength={10}
                    editable={!deleting}
                  />
                  {isConfirmed ? (
                    <Ionicons name="checkmark-circle" size={20} color="#EF4444" />
                  ) : null}
                </View>
                <Text style={[s.confirmHint, { color: C.textMuted }]}>
                  This confirmation is case-sensitive and must match exactly.
                </Text>
              </View>

              {/* Final delete button */}
              <Pressable
                style={({ pressed }) => [
                  s.finalDeleteBtn,
                  {
                    backgroundColor: isConfirmed ? '#EF4444' : C.border,
                    opacity: deleting ? 0.7 : pressed ? 0.85 : 1,
                  },
                ]}
                onPress={handleDeleteAccount}
                disabled={!isConfirmed || deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons name="delete-forever" size={20} color="#fff" />
                )}
                <Text style={s.finalDeleteText}>
                  {deleting ? 'Deleting your account…' : 'Permanently Delete My Account'}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  s.cancelLink,
                  pressed ? { opacity: 0.7 } : null,
                ]}
                onPress={() => { setStep('info'); setConfirmInput(''); }}
                disabled={deleting}
              >
                <Text style={[s.cancelLinkText, { color: C.textMuted }]}>Cancel — keep my account</Text>
              </Pressable>

              {/* Legal note */}
              <View style={[s.legalNote, { backgroundColor: C.card, borderColor: C.border }]}>
                <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
                <Text style={[s.legalText, { color: C.textMuted }]}>
                  Deletion is processed immediately. You will receive a confirmation email at{' '}
                  <Text style={{ fontWeight: FONTS.semiBold }}>{user?.email}</Text>.
                  Residual backup copies are purged within 30 days per our{' '}
                  <Text
                    style={{ color: C.primary }}
                    onPress={() => router.push('/privacy' as any)}
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },

  scroll: { padding: SPACING.md, gap: 12 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
  },
  warningTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: 4 },
  warningBody: { fontSize: 13, lineHeight: 19 },

  card: {
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 0,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 10, marginBottom: 4, borderBottomWidth: 1,
  },
  cardTitle: { fontSize: 14, fontWeight: FONTS.bold },
  cardNote: { fontSize: 11, lineHeight: 16, marginTop: 10 },

  altRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  altLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  altDesc: { fontSize: 11, marginTop: 1 },

  privacyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', paddingVertical: 4,
  },
  privacyLinkText: { fontSize: 13, fontWeight: FONTS.semiBold },

  destructiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: 15, marginTop: 4,
  },
  destructiveBtnText: { fontSize: 15, fontWeight: FONTS.bold },

  // Confirm step
  confirmPrompt: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  confirmWord: { fontWeight: FONTS.extraBold, letterSpacing: 1 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: RADIUS.lg, borderWidth: 2,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  input: {
    flex: 1, fontSize: 18, fontWeight: FONTS.bold,
    letterSpacing: 2, padding: 0,
  },
  confirmHint: { fontSize: 11, lineHeight: 16, marginTop: 8 },

  finalDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: RADIUS.xl, paddingVertical: 16, marginTop: 4,
  },
  finalDeleteText: {
    fontSize: 15, fontWeight: FONTS.bold, color: '#fff',
  },

  cancelLink: { alignItems: 'center', paddingVertical: 12 },
  cancelLinkText: { fontSize: 14, fontWeight: FONTS.medium },

  legalNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: RADIUS.lg, borderWidth: 1, padding: 12,
  },
  legalText: { flex: 1, fontSize: 11, lineHeight: 17 },
});
