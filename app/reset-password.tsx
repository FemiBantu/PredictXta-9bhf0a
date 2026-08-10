import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  KeyboardAvoidingView, Platform, Animated, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getSupabaseClient, useAlert } from '@/template';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { Image } from 'expo-image';

type Stage = 'form' | 'success';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { showAlert } = useAlert();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>('form');
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Entrance animation
  const cardOpacity    = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity,    { toValue: 1, duration: 320, delay: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(cardTranslateY, { toValue: 0, duration: 320, delay: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();

    // Check whether Supabase has established a recovery session from the deep-link
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  async function handleReset() {
    if (!password || password.length < 8) {
      showAlert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showAlert('Reset Failed', error.message);
        return;
      }
      setStage('success');
    } catch (e: any) {
      showAlert('Error', e?.message ?? 'Failed to update password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0F1923', '#070B14', '#070B14']} style={StyleSheet.absoluteFill} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => router.replace('/login' as any)}
              style={({ pressed }) => [styles.backBtn, pressed ? { opacity: 0.7 } : null]}
              hitSlop={8}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.primary} />
            </Pressable>
          </View>

          <Animated.View style={[styles.content, { opacity: cardOpacity, transform: [{ translateY: cardTranslateY }] }]}>

            {/* Logo strip */}
            <View style={styles.logoRow}>
              <View style={styles.logoWrap}>
                <Image source={require('@/assets/logo.png')} style={styles.logo} contentFit="contain" transition={0} />
              </View>
              <View style={styles.appNameRow}>
                <Text style={[styles.appNameWhite, { color: '#FFFFFF' }]}>Predict</Text>
                <Text style={[styles.appNameWhite, { color: '#6EDC1F' }]}>X</Text>
                <Text style={[styles.appNameWhite, { color: '#FFFFFF' }]}>ta</Text>
              </View>
            </View>

            <View style={styles.card}>

              {stage === 'success' ? (
                // ── Success state ──────────────────────────────────────────
                <View style={styles.successBox}>
                  <View style={styles.successIconWrap}>
                    <Ionicons name="shield-checkmark-outline" size={40} color={COLORS.primary} />
                  </View>
                  <Text style={styles.title}>Password Updated!</Text>
                  <Text style={styles.subtitle}>
                    Your password has been changed successfully. You can now sign in with your new password.
                  </Text>
                  <Button
                    label="Go to Sign In"
                    onPress={() => router.replace('/login' as any)}
                    fullWidth
                    size="lg"
                  />
                </View>

              ) : hasSession === false ? (
                // ── No recovery session — link expired / already used ──────
                <View style={styles.errorBox}>
                  <View style={styles.errorIconWrap}>
                    <Ionicons name="warning-outline" size={36} color={COLORS.accentRed} />
                  </View>
                  <Text style={styles.title}>Link Expired</Text>
                  <Text style={styles.subtitle}>
                    This password reset link has expired or already been used. Please request a new one.
                  </Text>
                  <Button
                    label="Request New Link"
                    onPress={() => router.replace('/login' as any)}
                    fullWidth
                    size="lg"
                  />
                </View>

              ) : (
                // ── Password form ──────────────────────────────────────────
                <View>
                  <View style={styles.titleRow}>
                    <View style={styles.titleIconWrap}>
                      <Ionicons name="lock-open-outline" size={22} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>Set New Password</Text>
                      <Text style={styles.subtitle}>Choose a strong password for your account</Text>
                    </View>
                  </View>

                  {/* Strength hint */}
                  <PasswordStrengthBar password={password} />

                  <Input
                    label="New Password"
                    value={password}
                    onChangeText={setPassword}
                    secureToggle
                    icon="lock-closed-outline"
                    placeholder="Min 6 characters"
                  />
                  <Input
                    label="Confirm Password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureToggle
                    icon="shield-checkmark-outline"
                    placeholder="Repeat new password"
                  />

                  {/* Match indicator */}
                  {confirmPassword.length > 0 ? (
                    <View style={[styles.matchRow, { opacity: confirmPassword.length > 0 ? 1 : 0 }]}>
                      <Ionicons
                        name={password === confirmPassword ? 'checkmark-circle' : 'close-circle'}
                        size={14}
                        color={password === confirmPassword ? '#22C55E' : COLORS.accentRed}
                      />
                      <Text style={[
                        styles.matchText,
                        { color: password === confirmPassword ? '#22C55E' : COLORS.accentRed },
                      ]}>
                        {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                      </Text>
                    </View>
                  ) : null}

                  <View style={{ marginTop: 8 }}>
                    <Button
                      label="Update Password"
                      onPress={handleReset}
                      loading={loading}
                      fullWidth
                      size="lg"
                    />
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Password strength bar ────────────────────────────────────────────────────
function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) return null;

  const score = (() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  const label  = score <= 1 ? 'Weak' : score <= 3 ? 'Fair' : 'Strong';
  const color  = score <= 1 ? COLORS.accentRed : score <= 3 ? '#F59E0B' : '#22C55E';
  const filled = Math.min(score, 4);

  return (
    <View style={sb.wrap}>
      <View style={sb.barRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[sb.segment, { backgroundColor: i < filled ? color : 'rgba(255,255,255,0.1)' }]}
          />
        ))}
      </View>
      <Text style={[sb.label, { color }]}>{label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  barRow: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  label: { fontSize: 11, fontWeight: FONTS.bold, minWidth: 40, textAlign: 'right' },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: SPACING.md, paddingTop: 8, paddingBottom: 4,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: SPACING.md, justifyContent: 'center' },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, justifyContent: 'center' },
  logoWrap: {
    width: 48, height: 48, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.3)',
  },
  logo: { width: '100%', height: '100%' },
  appNameRow: { flexDirection: 'row', alignItems: 'center' },
  appNameWhite: { fontSize: 26, fontWeight: FONTS.extraBold, color: '#FFFFFF', letterSpacing: 1 },
  gradientX: { width: 18, height: 35 },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  titleIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title: { fontSize: 20, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },

  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8, marginTop: -4 },
  matchText: { fontSize: 12, fontWeight: FONTS.semiBold },

  // Success
  successBox: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  successIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },

  // Error / expired
  errorBox: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  errorIconWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,71,87,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
});
