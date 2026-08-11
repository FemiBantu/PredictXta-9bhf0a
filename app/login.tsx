
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  KeyboardAvoidingView, Platform, Animated, Easing,
  TextInput,
} from 'react-native';
import { useAuth, useAlert, getSupabaseClient } from '@/template';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { signInWithGoogleOAuth, warmUpBrowser, coolDownBrowser } from '@/services/googleAuthService';
import { signInWithApple, isAppleSignInAvailable } from '@/services/appleAuthService';
import type { AppleSignInResult } from '@/services/appleAuthService';
import {
  analyzePassword,
  isValidEmail,
  getLoginAttemptState,
  recordLoginFailure,
  clearLoginAttempts,
  formatLockoutTime,
  registerDeviceSession,
  logSecurityEvent,
} from '@/services/authSecurityService';
import * as Haptics from 'expo-haptics';

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const D = {
  bg: '#FFFFFF',
  surface: '#F5F5F5',
  card: '#FFFFFF',
  border: '#E8E8E8',
  text: '#0D0D0D',
  textMid: '#4A4A4A',
  textMuted: '#9A9A9A',
  primary: '#6EDC1F',
  primaryDark: '#4EBA00',
  primaryText: '#FFFFFF',
  danger: '#EF4444',
  warning: '#F59E0B',
  blue: '#4285F4',
  apple: '#000000',
};

type Screen = 'landing' | 'email-login' | 'email-register' | 'otp' | 'forgot';

// ─── OTP Digit Input ──────────────────────────────────────────────────────────
function OtpBoxes({
  value, onChange, hasError,
}: {
  value: string; onChange: (v: string) => void; hasError: boolean;
}) {
  const refs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];
  const digits = value.padEnd(4, '').split('').slice(0, 4);
  const shakeX = useRef(new Animated.Value(0)).current;
  const prevErr = useRef(false);

  useEffect(() => {
    if (hasError && !prevErr.current) {
      prevErr.current = true;
      Animated.sequence([
        Animated.timing(shakeX, { toValue: -8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -6, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 6, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    } else if (!hasError) {
      prevErr.current = false;
    }
  }, [hasError, shakeX]);

  const handleKey = (idx: number, key: string) => {
    if (key === 'Backspace') {
      const next = value.slice(0, digits[idx] === '' && idx > 0 ? idx - 1 : idx);
      onChange(next);
      const fi = digits[idx] === '' && idx > 0 ? idx - 1 : Math.max(0, idx - 1);
      setTimeout(() => refs[fi]?.current?.focus(), 10);
    }
  };
  const handleChange = (idx: number, text: string) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    if (!digit) return;
    const arr = value.padEnd(4, '').split('').slice(0, 4);
    arr[idx] = digit;
    const next = arr.join('').replace(/\s/g, '').slice(0, 4);
    onChange(next);
    if (idx < 3) setTimeout(() => refs[idx + 1]?.current?.focus(), 20);
    else refs[idx]?.current?.blur();
  };

  return (
    <Animated.View style={[otp.row, { transform: [{ translateX: shakeX }] }]}>
      {[0, 1, 2, 3].map((i) => {
        const filled = digits[i] !== '' && digits[i] !== ' ';
        const bc = hasError ? D.danger : filled ? D.primary : D.border;
        return (
          <View
            key={i}
            style={[otp.box, { borderColor: bc, backgroundColor: filled ? `${D.primary}10` : D.surface }]}
          >
            <TextInput
              ref={refs[i]}
              style={[otp.digit, { color: hasError ? D.danger : D.text }]}
              value={filled ? digits[i] : ''}
              onChangeText={(t) => handleChange(i, t)}
              onKeyPress={({ nativeEvent }) => handleKey(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              caretHidden
              textContentType="oneTimeCode"
            />
          </View>
        );
      })}
    </Animated.View>
  );
}
const otp = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginVertical: 20 },
  box: { width: 62, height: 72, borderRadius: RADIUS.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 30, fontWeight: '800', textAlign: 'center', width: '100%', padding: 0 },
});

// ─── Password Strength ────────────────────────────────────────────────────────
function StrengthBar({ password }: { password: string }) {
  if (!password) return null;
  const s = analyzePassword(password);
  return (
    <View style={{ marginTop: 6, marginBottom: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < s.score ? s.color : D.border }}
          />
        ))}
      </View>
      <Text style={{ fontSize: 11, color: s.color, fontWeight: '600' }}>{s.label}</Text>
    </View>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, secure, keyboardType, autoCapitalize, error,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; secure?: boolean; keyboardType?: any;
  autoCapitalize?: any; error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={f.label}>{label}</Text>
      <View style={[f.wrap, { borderColor: error ? D.danger : D.border }]}>
        <TextInput
          style={f.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={D.textMuted}
          secureTextEntry={secure && !show}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
        />
        {secure ? (
          <Pressable onPress={() => setShow(s => !s)} hitSlop={8}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={D.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={f.error}>{error}</Text> : null}
    </View>
  );
}
const f = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: D.text, marginBottom: 6 },
  wrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: D.surface, borderRadius: RADIUS.lg, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13, gap: 8 },
  input: { flex: 1, fontSize: 15, color: D.text, padding: 0 },
  error: { fontSize: 11, color: D.danger, marginTop: 4 },
});

// ─── Primary Button ───────────────────────────────────────────────────────────
function PrimaryBtn({ label, onPress, loading, disabled }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [pb.btn, { opacity: loading || disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading
        ? <Ionicons name="sync-outline" size={20} color="#000" />
        : <Text style={pb.label}>{label}</Text>
      }
    </Pressable>
  );
}
const pb = StyleSheet.create({
  btn: { backgroundColor: D.primary, borderRadius: RADIUS.full, paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '800', color: '#000' },
});

// ─── Social Button ─────────────────────────────────────────────────────────────
function SocialBtn({
  label, icon, onPress, loading, style: extraStyle,
}: {
  label: string; icon: React.ReactNode; onPress: () => void; loading?: boolean; style?: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [sb.btn, extraStyle, { opacity: loading ? 0.6 : pressed ? 0.85 : 1 }]}
    >
      {loading ? (
        <Ionicons name="sync-outline" size={20} color={D.text} style={{ marginRight: 10 }} />
      ) : (
        <View style={sb.iconWrap}>{icon}</View>
      )}
      <Text style={sb.label}>{label}</Text>
    </Pressable>
  );
}
const sb = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: D.surface, borderRadius: RADIUS.xl,
    paddingVertical: 18, paddingHorizontal: 24, gap: 10,
  },
  iconWrap: { width: 22, alignItems: 'center' },
  label: { fontSize: 16, fontWeight: '700', color: D.text },
});

// ─── Google G Icon ────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: D.border }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: '#4285F4', lineHeight: 16 }}>G</Text>
    </View>
  );
}

// ─── Apple Icon ───────────────────────────────────────────────────────────────
function AppleIcon({ color = '#000' }: { color?: string }) {
  return (
    <View style={{ width: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="logo-apple" size={22} color={color} />
    </View>
  );
}

// ─── Section Back Header ─────────────────────────────────────────────────────
function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, backgroundColor: D.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}
      >
        <Ionicons name="arrow-back" size={20} color={D.text} />
      </Pressable>
      <Text style={{ fontSize: 18, fontWeight: '800', color: D.text, flex: 1 }}>{title}</Text>
    </View>
  );
}

// ─── Password Requirements ────────────────────────────────────────────────────
function PwReqs({ pw, confirm }: { pw: string; confirm: string }) {
  if (!pw) return null;
  const reqs = [
    { ok: pw.length >= 8, label: '8+ characters' },
    { ok: /[A-Z]/.test(pw), label: 'Uppercase letter' },
    { ok: /[0-9]/.test(pw), label: 'One number' },
    { ok: pw === confirm && confirm.length > 0, label: 'Passwords match' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {reqs.map(r => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={r.ok ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.ok ? D.primary : D.textMuted} />
          <Text style={{ fontSize: 11, color: r.ok ? D.primary : D.textMuted, fontWeight: '600' }}>{r.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function OrDivider() {
  return (
    <View style={s.divider}>
      <View style={[s.line, { backgroundColor: D.border }]} />
      <Text style={[s.orText, { color: D.textMuted }]}>or</Text>
      <View style={[s.line, { backgroundColor: D.border }]} />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const router = useRouter();
  const {
    signInWithPassword, sendOTP, verifyOTPAndLogin,
    operationLoading, loading: authLoading,
  } = useAuth();
  const { showAlert } = useAlert();

  const [screen, setScreen] = useState<Screen>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingPassword, setPendingPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutMs, setLockoutMs] = useState(0);

  // OTP countdown
  const OTP_EXPIRY = 59;
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const otpTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs so retry alerts can invoke the handlers without circular deps.
  const handleGoogleRef = useRef<() => void>(() => {});
  const handleAppleRef  = useRef<() => void>(() => {});

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const screenFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!authLoading) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }),
      ]).start();
    }
  }, [authLoading, fadeAnim, slideAnim]);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // Pre-warm Chrome CCT on Android so it is ready when the user taps Google
  useEffect(() => {
    warmUpBrowser();
    return () => coolDownBrowser();
  }, []);

  const goTo = (s: Screen) => {
    Animated.timing(screenFade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setScreen(s);
      Animated.timing(screenFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    getLoginAttemptState().then(st => {
      setIsLocked(st.isLocked); setLockoutMs(st.remainingMs);
    });
    lockTimer.current = setInterval(async () => {
      const st = await getLoginAttemptState();
      setIsLocked(st.isLocked); setLockoutMs(st.remainingMs);
    }, 1000);
    return () => { if (lockTimer.current) clearInterval(lockTimer.current); };
  }, []);

  const startOtpTimer = useCallback(() => {
    if (otpTimer.current) clearInterval(otpTimer.current);
    setOtpCountdown(OTP_EXPIRY);
    otpTimer.current = setInterval(() => {
      setOtpCountdown(p => { if (p <= 1) { clearInterval(otpTimer.current!); return 0; } return p - 1; });
    }, 1000);
  }, []);

  const startResendCooldown = useCallback(() => {
    if (resendTimer.current) clearInterval(resendTimer.current);
    setResendCooldown(30);
    resendTimer.current = setInterval(() => {
      setResendCooldown(p => { if (p <= 1) { clearInterval(resendTimer.current!); return 0; } return p - 1; });
    }, 1000);
  }, []);

  useEffect(() => {
    if (screen === 'otp') {
      setOtpValue(''); setOtpError(false);
      startOtpTimer();
    } else {
      if (otpTimer.current) clearInterval(otpTimer.current);
      if (resendTimer.current) clearInterval(resendTimer.current);
    }
    return () => {
      if (otpTimer.current) clearInterval(otpTimer.current);
      if (resendTimer.current) clearInterval(resendTimer.current);
    };
  }, [screen, startOtpTimer, startResendCooldown]);

  useEffect(() => { if (otpError && otpValue.length > 0) setOtpError(false); }, [otpValue, otpError]);

  // ── Helper: post-login tasks ───────────────────────────────────────────────
  const onSignInSuccess = useCallback(async (userId: string, provider: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await clearLoginAttempts();
    registerDeviceSession(userId, { markOthersNotCurrent: false });
    logSecurityEvent(userId, { eventType: 'login_success', status: 'success', metadata: { provider } });
  }, []);

  // ── Auth Handlers ──────────────────────────────────────────────────────────
  const handleEmailLogin = async () => {
    const st = await getLoginAttemptState();
    if (st.isLocked) { showAlert('Account Locked', `Try again in ${formatLockoutTime(st.remainingMs)}.`); return; }
    if (!email.trim() || !isValidEmail(email)) { showAlert('Invalid Email', 'Enter a valid email address.'); return; }
    if (!password) { showAlert('Password Required', 'Enter your password.'); return; }
    const { error, user: u } = await signInWithPassword(email.trim().toLowerCase(), password);
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const ns = await recordLoginFailure();
      setIsLocked(ns.isLocked); setLockoutMs(ns.remainingMs);
      if (ns.isLocked) showAlert('Account Locked', `Too many failed attempts. Wait ${formatLockoutTime(ns.remainingMs)}.`);
      else showAlert('Sign-In Failed', error);
    } else if (u) {
      await onSignInSuccess(u.id, 'email');
    }
  };

  const handleSendOTP = async () => {
    if (!email.trim() || !isValidEmail(email)) { showAlert('Invalid Email', 'Enter a valid email address.'); return; }
    if (!password || password.length < 8) { showAlert('Password Too Short', 'Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { showAlert('Passwords Do Not Match', 'Both fields must match.'); return; }
    try {
      const sb = getSupabaseClient();
      const { data: ex } = await sb.from('user_profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
      if (ex) {
        showAlert('Email Already Registered', 'An account exists with this email. Sign in instead.', [
          { text: 'Sign In', onPress: () => goTo('email-login') },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
    } catch { /* non-blocking */ }
    const { error } = await sendOTP(email.trim().toLowerCase());
    if (error) { showAlert('Error', error); return; }
    setPendingEmail(email.trim().toLowerCase());
    setPendingPassword(password);
    goTo('otp');
    showAlert('Code Sent', `A 4-digit code was sent to ${email.trim()}. It expires in 59 seconds.`);
  };

  const handleVerifyOTP = async () => {
    if (otpValue.length < 4) {
      setOtpError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    const { error, user: u } = await verifyOTPAndLogin(pendingEmail, otpValue, { password: pendingPassword });
    if (error) {
      setOtpError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setOtpValue('');
      showAlert('Verification Failed', error);
    } else if (u) {
      await onSignInSuccess(u.id, 'email_otp');
    }
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true); setOtpValue(''); setOtpError(false);
    try {
      const { error } = await sendOTP(pendingEmail);
      if (error) { showAlert('Error', error); return; }
      startOtpTimer(); startResendCooldown();
      showAlert('Code Resent', `New code sent to ${pendingEmail}.`);
    } finally { setResending(false); }
  };

  const handleForgot = async () => {
    if (!email.trim() || !isValidEmail(email)) { showAlert('Invalid Email', 'Enter a valid email address.'); return; }
    setForgotLoading(true);
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'predictxta://reset-password' });
      if (error) { showAlert('Error', error.message); return; }
      setResetSent(true);
    } catch (e: any) { showAlert('Error', e?.message ?? 'Failed to send reset email'); }
    finally { setForgotLoading(false); }
  };

  // ── Google Sign-In ─────────────────────────────────────────────────────────
  // NOTE: handleGoogleRef is used for the E006 retry to avoid a circular
  // self-reference in the useCallback dependency array.
  const handleGoogle = useCallback(async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogleOAuth();

      if (result.success) {
        const sb = getSupabaseClient();
        // Prefer getUser() — server-validated, avoids stale local cache right
        // after CCT code exchange on Android.
        const { data: { user: gUser } } = await sb.auth.getUser();
        if (gUser) { await onSignInSuccess(gUser.id, 'google'); return; }
        // Fallback to getSession
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) { await onSignInSuccess(session.user.id, 'google'); return; }
        showAlert('Sign-In Error', 'Authentication succeeded but user profile could not be loaded. Please try again.');
        return;
      }

      const code = result.errorCode;

      if (code === 'E006') {
        // E006 on Android is almost always a false-positive from Chrome CCT
        // closing before the promise resolves. googleAuthService handles this
        // with the pre-registered resolver + 3s retry loop. One more check here:
        const sb = getSupabaseClient();
        const { data: { user: gUser } } = await sb.auth.getUser();
        if (gUser) { await onSignInSuccess(gUser.id, 'google'); return; }
        // Genuine cancel — friendly retry prompt using stable ref (no circular dep)
        showAlert(
          'Sign-In Not Completed',
          'It looks like the browser was closed before finishing. Tap "Try Again" to retry.',
          [
            { text: 'Try Again', onPress: () => handleGoogleRef.current() },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      const msg = result.error ?? 'Google Sign-In failed. Ensure the Google provider is enabled in Supabase.';
      const codeLabel = code ? ` [${code}]` : '';
      showAlert(`Google Sign-In Failed${codeLabel}`, msg);
    } catch (e: any) {
      showAlert('Google Sign-In Failed', e?.message ?? 'Unexpected error');
    } finally {
      setGoogleLoading(false);
    }
  }, [googleLoading, onSignInSuccess, showAlert]);

  // Keep Google ref in sync
  useEffect(() => { handleGoogleRef.current = handleGoogle; }, [handleGoogle]);

  // ── Apple Sign-In ──────────────────────────────────────────────────────
  const handleApple = useCallback(async () => {
    if (appleLoading) return;
    setAppleLoading(true);
    try {
      const result: AppleSignInResult = await signInWithApple();

      if (result.success) {
        const sb = getSupabaseClient();
        // Server-validated user fetch (avoids stale cache right after exchange)
        const { data: { user: aUser } } = await sb.auth.getUser();
        if (aUser) { await onSignInSuccess(aUser.id, 'apple'); return; }
        // Fallback to session
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) { await onSignInSuccess(session.user.id, 'apple'); return; }
        showAlert('Sign-In Error', 'Authentication succeeded but user profile could not be loaded. Please try again.');
        return;
      }

      // Cancelled — user intentionally dismissed the sheet; no alert needed
      const isCancelled =
        result.error?.includes('cancelled') ||
        result.error?.includes('canceled') ||
        result.error?.includes('ERR_REQUEST_CANCELED');

      if (isCancelled) return;

      // E006-style incomplete flow on Android OAuth path
      const isIncomplete =
        result.error?.includes('did not complete') ||
        result.error?.includes('browser was closed') ||
        result.error?.includes('E006');

      if (isIncomplete) {
        // Last-chance session check — CCT may have resolved after the promise
        const sb = getSupabaseClient();
        const { data: { user: aUser } } = await sb.auth.getUser();
        if (aUser) { await onSignInSuccess(aUser.id, 'apple'); return; }

        showAlert(
          'Sign-In Not Completed',
          'It looks like the browser closed before finishing. Tap "Try Again" to retry.',
          [
            { text: 'Try Again', onPress: () => handleAppleRef.current() },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      const msg = result.error ?? 'Apple Sign-In failed. Ensure the Apple provider is enabled in Supabase.';
      showAlert('Apple Sign-In Failed', msg);
    } catch (e: any) {
      showAlert('Apple Sign-In Failed', e?.message ?? 'Unexpected error');
    } finally {
      setAppleLoading(false);
    }
  }, [appleLoading, onSignInSuccess, showAlert]);

  // Keep stable ref in sync
  useEffect(() => { handleAppleRef.current = handleApple; }, [handleApple]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={[s.inner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

              {/* ── LANDING ── */}
              {screen === 'landing' ? (
                <Animated.View style={{ opacity: screenFade }}>
                  <View style={s.logoSection}>
                    <View style={s.logoBox}>
                      <Image source={require('@/assets/logo.png')} style={s.logoImg} contentFit="contain" />
                    </View>
                  </View>
                  <View style={s.headlineSection}>
                    <Text style={s.headline}>Predict Smarter,{'\n'}Win Bigger.</Text>
                    <Text style={s.subheadline}>AI-Powered Sports Predictions</Text>
                  </View>
                  <View style={s.buttonsSection}>
                    {appleAvailable ? (
                      <SocialBtn label="Continue with Apple" icon={<AppleIcon color={D.apple} />} onPress={handleApple} loading={appleLoading} style={s.appleBtn} />
                    ) : null}
                    <SocialBtn label="Continue with Google" icon={<GoogleIcon />} onPress={handleGoogle} loading={googleLoading} />
                    <SocialBtn label="Continue with Email" icon={<Ionicons name="mail-outline" size={20} color={D.text} />} onPress={() => goTo('email-login')} />
                  </View>
                  <View style={s.dividerThin} />
                  <View style={s.legalSection}>
                    <Text style={s.legalText}>By continuing, I agree to PredictXta's{'\n'}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
                      <Pressable onPress={() => router.push('/privacy' as any)}>
                        <Text style={s.legalLink}>Privacy Policy</Text>
                      </Pressable>
                      <Text style={s.legalText}>and</Text>
                      <Pressable onPress={() => router.push('/terms' as any)}>
                        <Text style={s.legalLink}>Terms of use</Text>
                      </Pressable>
                    </View>
                  </View>
                </Animated.View>

              ) : screen === 'email-login' ? (
                <Animated.View style={{ opacity: screenFade }}>
                  <BackHeader title="Sign In" onBack={() => goTo('landing')} />
                  {isLocked && lockoutMs > 0 ? (
                    <View style={s.lockBanner}>
                      <Ionicons name="lock-closed" size={14} color={D.danger} />
                      <Text style={[s.lockText, { color: D.danger }]}>Account locked. Try again in {Math.ceil(lockoutMs / 60000)}m.</Text>
                    </View>
                  ) : null}
                  <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                  <Field label="Password" value={password} onChange={setPassword} placeholder="Your password" secure />
                  <Pressable onPress={() => goTo('forgot')} style={{ alignSelf: 'flex-end', marginBottom: 20, marginTop: -6 }}>
                    <Text style={{ fontSize: 13, color: D.primary, fontWeight: '600' }}>Forgot Password?</Text>
                  </Pressable>
                  <PrimaryBtn label="Sign In" onPress={handleEmailLogin} loading={operationLoading} disabled={isLocked} />
                  <OrDivider />
                  {appleAvailable ? (
                    <SocialBtn label="Continue with Apple" icon={<AppleIcon color={D.apple} />} onPress={handleApple} loading={appleLoading} style={[s.appleBtn, { marginBottom: 10 }]} />
                  ) : null}
                  <SocialBtn label="Continue with Google" icon={<GoogleIcon />} onPress={handleGoogle} loading={googleLoading} />
                  <Pressable onPress={() => goTo('email-register')} style={{ alignItems: 'center', marginTop: 20 }}>
                    <Text style={{ fontSize: 14, color: D.textMid }}>New here?{' '}<Text style={{ color: D.primary, fontWeight: '700' }}>Create account</Text></Text>
                  </Pressable>
                </Animated.View>

              ) : screen === 'email-register' ? (
                <Animated.View style={{ opacity: screenFade }}>
                  <BackHeader title="Create Account" onBack={() => goTo('email-login')} />
                  <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                  <Field label="Password" value={password} onChange={setPassword} placeholder="Min 8 characters" secure />
                  {password.length > 0 ? <StrengthBar password={password} /> : null}
                  <Field label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat password" secure />
                  {password.length > 0 ? <PwReqs pw={password} confirm={confirmPassword} /> : null}
                  <PrimaryBtn label="Create Account" onPress={handleSendOTP} loading={operationLoading} />
                  <Pressable onPress={() => goTo('email-login')} style={{ alignItems: 'center', marginTop: 20 }}>
                    <Text style={{ fontSize: 14, color: D.textMid }}>Already have an account?{' '}<Text style={{ color: D.primary, fontWeight: '700' }}>Sign in</Text></Text>
                  </Pressable>
                </Animated.View>

              ) : screen === 'otp' ? (
                <Animated.View style={{ opacity: screenFade }}>
                  <BackHeader title="Verify Email" onBack={() => goTo('email-register')} />
                  <View style={[s.otpHero, { backgroundColor: `${D.primary}10`, borderColor: `${D.primary}25` }]}>
                    <Ionicons name="mail-open-outline" size={36} color={D.primary} />
                    <Text style={[s.otpHeroTitle, { color: D.text }]}>Code sent!</Text>
                    <Text style={[s.otpHeroSub, { color: D.textMid }]}>
                      We sent a 4-digit code to{'\n'}
                      <Text style={{ color: D.primary, fontWeight: '700' }}>{pendingEmail}</Text>
                    </Text>
                  </View>
                  <OtpBoxes value={otpValue} onChange={setOtpValue} hasError={otpError} />
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    {otpCountdown > 0 ? (
                      <Text style={{ fontSize: 13, color: D.textMuted }}>
                        Code expires in{' '}
                        <Text style={{ color: otpCountdown <= 10 ? D.danger : D.primary, fontWeight: '700' }}>{otpCountdown}s</Text>
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 13, color: D.danger, fontWeight: '600' }}>Code expired</Text>
                    )}
                  </View>
                  <PrimaryBtn label="Verify & Create Account" onPress={handleVerifyOTP} loading={operationLoading} />
                  <Pressable
                    onPress={handleResendOTP}
                    disabled={resendCooldown > 0 || resending}
                    style={({ pressed }) => [s.resendBtn, { borderColor: D.border, opacity: resendCooldown > 0 || resending ? 0.4 : pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="refresh-outline" size={16} color={D.primary} />
                    <Text style={{ fontSize: 14, color: D.primary, fontWeight: '700' }}>
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resending ? 'Sending...' : 'Resend Code'}
                    </Text>
                  </Pressable>
                </Animated.View>

              ) : screen === 'forgot' ? (
                <Animated.View style={{ opacity: screenFade }}>
                  <BackHeader title="Reset Password" onBack={() => goTo('email-login')} />
                  {resetSent ? (
                    <View style={[s.otpHero, { backgroundColor: `${D.primary}10`, borderColor: `${D.primary}25` }]}>
                      <Ionicons name="checkmark-circle-outline" size={40} color={D.primary} />
                      <Text style={[s.otpHeroTitle, { color: D.text }]}>Email sent!</Text>
                      <Text style={[s.otpHeroSub, { color: D.textMid }]}>
                        Check your inbox at{'\n'}
                        <Text style={{ color: D.primary, fontWeight: '700' }}>{email.trim()}</Text>
                        {'\n'}and click the reset link.
                      </Text>
                      <Pressable onPress={() => setResetSent(false)} style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 13, color: D.textMuted, textDecorationLine: 'underline' }}>Resend email</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <Text style={{ fontSize: 14, color: D.textMid, marginBottom: 20, lineHeight: 21 }}>
                        Enter your email and we will send you a secure link to reset your password.
                      </Text>
                      <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                      <PrimaryBtn label="Send Reset Link" onPress={handleForgot} loading={forgotLoading} />
                    </>
                  )}
                </Animated.View>
              ) : null}

            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, paddingHorizontal: 28, paddingBottom: 32 },

  logoSection: { alignItems: 'center', paddingTop: 60, paddingBottom: 36 },
  logoBox: {
    width: 100, height: 100, borderRadius: 26,
    backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  logoImg: { width: 64, height: 64 },

  headlineSection: { alignItems: 'center', marginBottom: 44 },
  headline: {
    fontSize: 30, fontWeight: '900', color: D.text,
    textAlign: 'center', lineHeight: 38, letterSpacing: -0.5,
  },
  subheadline: {
    fontSize: 17, fontWeight: '600', color: D.textMid,
    textAlign: 'center', marginTop: 10, lineHeight: 24,
  },

  buttonsSection: { gap: 12, marginBottom: 28 },

  appleBtn: { backgroundColor: '#000000', borderRadius: RADIUS.xl },

  dividerThin: { height: 1, backgroundColor: D.border, marginBottom: 20 },

  legalSection: { alignItems: 'center', gap: 2 },
  legalText: { fontSize: 13, color: D.textMuted, textAlign: 'center', lineHeight: 20 },
  legalLink: { fontSize: 13, color: D.text, fontWeight: '700', textDecorationLine: 'underline' },

  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EF444412', borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: '#EF444430', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  lockText: { fontSize: 13, fontWeight: '600', flex: 1 },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  line: { flex: 1, height: 1 },
  orText: { fontSize: 13 },

  otpHero: {
    alignItems: 'center', borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: 28, paddingHorizontal: 20, gap: 8, marginBottom: 8,
  },
  otpHeroTitle: { fontSize: 20, fontWeight: '800' },
  otpHeroSub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },

  resendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, borderWidth: 1.5,
    paddingVertical: 14, marginTop: 12,
  },
});
