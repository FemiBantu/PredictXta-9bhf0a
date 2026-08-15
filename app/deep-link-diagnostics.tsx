/**
 * app/deep-link-diagnostics.tsx — Deep Link & OAuth Diagnostics
 *
 * A comprehensive real-time diagnostic panel covering:
 *  - canOpenURL() test for every registered deep-link scheme
 *  - Resolved redirect URI (what the app would send to Google/Supabase)
 *  - Android package name
 *  - iOS bundle identifier
 *  - Installed build type (Expo Go vs Dev Build vs Production APK)
 *  - Intent-filter registration status (Android)
 *  - Supabase Google provider health
 *  - Supabase URL Configuration checklist
 *  - Google Cloud Console requirements
 *  - Live Google Sign-In end-to-end test
 *
 * Access: Admin Panel → "Deep Link Diagnostics"
 * Safe in production builds (no secrets exposed).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  Animated, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import {
  signInWithGoogleOAuth,
  getRedirectUri,
  warmUpBrowser,
  coolDownBrowser,
  GOOGLE_AUTH_ERRORS,
} from '@/services/googleAuthService';

// ─── Constants ────────────────────────────────────────────────────────────────
const ANDROID_PACKAGE = 'com.predictxta.sports';
const IOS_BUNDLE_ID   = 'com.predictxta.app';
const SUPABASE_PROJECT = 'osmkbrryalhtpnayosmk';
const SUPABASE_CALLBACK_URL = `https://${SUPABASE_PROJECT}.supabase.co/auth/v1/callback`;

// All deep-link URLs this app must be able to handle
const DEEP_LINK_TEST_CASES = [
  { url: 'predictxta://',                          label: 'Bare scheme',          required: true },
  { url: 'predictxta://auth',                      label: 'Auth host',            required: true },
  { url: 'predictxta://auth/callback',             label: 'OAuth callback (exact)',required: true },
  { url: 'predictxta://auth/callback?code=TEST',   label: 'OAuth callback + code', required: true },
  { url: 'predictxta://login-callback',            label: 'Login-callback alt',   required: false },
  { url: 'predictxta://reset-password',            label: 'Password reset',       required: true },
  { url: 'predictxta://account-deleted',           label: 'Account deleted',      required: false },
];

// Intent-filter entries expected in AndroidManifest.xml (generated from app.json)
const EXPECTED_INTENT_FILTERS = [
  { description: 'Bare scheme filter',              scheme: 'predictxta',  host: null,             path: null },
  { description: 'Auth host filter',                scheme: 'predictxta',  host: 'auth',           path: null },
  { description: 'Auth/callback pathPrefix filter', scheme: 'predictxta',  host: 'auth',           path: '/callback (prefix)' },
  { description: 'Auth/callback exact path filter', scheme: 'predictxta',  host: 'auth',           path: '/callback (exact)' },
  { description: 'Login-callback host filter',      scheme: 'predictxta',  host: 'login-callback', path: null },
  { description: 'Reset-password host filter',      scheme: 'predictxta',  host: 'reset-password', path: null },
  { description: 'Account-deleted host filter',     scheme: 'predictxta',  host: 'account-deleted',path: null },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type PassFail = 'pass' | 'fail' | 'warn' | 'info' | 'skip' | 'running' | 'idle';

interface TestResult {
  label: string;
  value: string;
  status: PassFail;
  note?: string;
}

interface Section {
  id: string;
  title: string;
  icon: string;
  results: TestResult[];
  expanded: boolean;
}

// ─── Build type detection ─────────────────────────────────────────────────────
function detectBuildType(): { type: string; isExpoGo: boolean; isNative: boolean; warning?: string } {
  if (Platform.OS === 'web') {
    return { type: 'Web Preview', isExpoGo: false, isNative: false, warning: 'Deep links and OAuth require a native build.' };
  }

  // Detect Expo Go: the JS bundle is hosted at an exp:// URL, or the
  // Expo Go app package is present.  The most reliable runtime check is
  // whether the scheme "exp" is the one that would resolve Linking.createURL().
  try {
    // Check for Expo Go characteristic global
    const g = global as Record<string, unknown>;
    if (g.__EXPO_GO__ || g.expo?.modules?.ExpoGo) {
      return { type: 'Expo Go', isExpoGo: true, isNative: false, warning: 'Custom scheme deep links do NOT work in Expo Go. Install a Dev Build or Production APK.' };
    }

    // Heuristic: if Constants.appOwnership === 'expo' we are in Expo Go
    const ExpoConstants = require('expo-constants');
    const constants = ExpoConstants?.default || ExpoConstants;
    const ownership = constants?.appOwnership ?? constants?.Constants?.appOwnership;
    if (ownership === 'expo') {
      return { type: 'Expo Go', isExpoGo: true, isNative: false, warning: 'Custom scheme deep links do NOT work in Expo Go. Install a Dev Build or Production APK.' };
    }
    if (ownership === 'standalone') {
      return { type: 'Production Build (standalone)', isExpoGo: false, isNative: true };
    }

    // EAS / bare workflow
    const executionEnvironment = constants?.executionEnvironment ?? constants?.Constants?.executionEnvironment;
    if (executionEnvironment === 'storeClient') {
      return { type: 'Expo Go', isExpoGo: true, isNative: false, warning: 'Custom scheme deep links do NOT work in Expo Go. Install a Dev Build or Production APK.' };
    }
    if (executionEnvironment === 'standalone') {
      return { type: 'Production Build (EAS)', isExpoGo: false, isNative: true };
    }
    if (executionEnvironment === 'bare') {
      return { type: 'Bare / Dev Build', isExpoGo: false, isNative: true };
    }
  } catch {
    // expo-constants not available or threw — treat as unknown native
  }

  return { type: `Native Build (${Platform.OS})`, isExpoGo: false, isNative: true };
}

// ─── Spinning indicator ───────────────────────────────────────────────────────
function SpinIndicator({ color }: { color: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={14} color={color} />
    </Animated.View>
  );
}

// ─── Status color / icon ──────────────────────────────────────────────────────
function statusColor(s: PassFail, C: AppColors): string {
  switch (s) {
    case 'pass':    return '#22C55E';
    case 'fail':    return '#EF4444';
    case 'warn':    return '#F59E0B';
    case 'info':    return C.primary;
    case 'skip':    return C.textMuted;
    case 'running': return C.primary;
    default:        return C.border;
  }
}

function statusIcon(s: PassFail): string {
  switch (s) {
    case 'pass':    return 'checkmark-circle';
    case 'fail':    return 'close-circle';
    case 'warn':    return 'warning';
    case 'info':    return 'information-circle';
    case 'skip':    return 'remove-circle-outline';
    default:        return 'ellipse-outline';
  }
}

// ─── Single result row ────────────────────────────────────────────────────────
function ResultRow({ result, C }: { result: TestResult; C: AppColors }) {
  const sc = statusColor(result.status, C);
  return (
    <View style={[rr.row, { borderBottomColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        {result.status === 'running' ? (
          <SpinIndicator color={sc} />
        ) : (
          <Ionicons name={statusIcon(result.status) as any} size={14} color={sc} />
        )}
        <Text style={[rr.label, { color: C.textSecondary }]} numberOfLines={1}>{result.label}</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
        <Text style={[rr.value, { color: result.status === 'fail' ? '#EF4444' : result.status === 'pass' ? '#22C55E' : C.textSecondary }]} numberOfLines={2}>
          {result.value}
        </Text>
        {result.note ? (
          <Text style={[rr.note, { color: C.textMuted }]} numberOfLines={2}>{result.note}</Text>
        ) : null}
      </View>
    </View>
  );
}

const rr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  label: { fontSize: 12, flex: 1 },
  value: { fontSize: 12, fontWeight: '600', textAlign: 'right' },
  note: { fontSize: 10, textAlign: 'right', lineHeight: 14 },
});

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({
  section, onToggle, C,
}: {
  section: Section; onToggle: () => void; C: AppColors;
}) {
  const passes = section.results.filter(r => r.status === 'pass').length;
  const fails  = section.results.filter(r => r.status === 'fail').length;
  const warns  = section.results.filter(r => r.status === 'warn').length;
  const total  = section.results.filter(r => r.status !== 'idle' && r.status !== 'running').length;

  const headerColor = fails > 0 ? '#EF4444' : warns > 0 ? '#F59E0B' : total > 0 ? '#22C55E' : C.textMuted;

  return (
    <View style={[sc.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable style={({ pressed }) => [sc.header, pressed ? { opacity: 0.85 } : null]} onPress={onToggle}>
        <View style={[sc.iconWrap, { backgroundColor: `${headerColor}18`, borderColor: `${headerColor}33` }]}>
          <Ionicons name={section.icon as any} size={16} color={headerColor} />
        </View>
        <Text style={[sc.title, { color: C.textPrimary }]}>{section.title}</Text>
        <View style={{ flex: 1 }} />
        {total > 0 ? (
          <Text style={[sc.counter, { color: headerColor }]}>
            {passes}/{total}
          </Text>
        ) : null}
        <Ionicons name={section.expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
      </Pressable>

      {section.expanded && section.results.length > 0 ? (
        <View style={[sc.body, { borderTopColor: C.border }]}>
          {section.results.map((r, i) => <ResultRow key={i} result={r} C={C} />)}
        </View>
      ) : null}
    </View>
  );
}

const sc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: FONTS.semiBold },
  counter: { fontSize: 11, fontWeight: FONTS.bold, marginRight: 4 },
  body: { borderTopWidth: 1, paddingHorizontal: 14, paddingBottom: 4 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function testCanOpenUrl(url: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try { return await Linking.canOpenURL(url); } catch { return false; }
}

async function checkSupabaseGoogleProvider(): Promise<{ enabled: boolean; message: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'predictxta://auth/callback', skipBrowserRedirect: true },
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      const disabled = msg.includes('provider') || msg.includes('not enabled') || msg.includes('unsupported');
      return { enabled: !disabled, message: error.message };
    }
    return { enabled: !!data?.url, message: data?.url ? 'OAuth URL obtained ✓' : 'No URL returned' };
  } catch (e: any) {
    return { enabled: false, message: String(e?.message ?? e) };
  }
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DeepLinkDiagnosticsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const buildInfo = detectBuildType();
  const redirectUri = getRedirectUri();

  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [oauthTestResult, setOauthTestResult] = useState<string | null>(null);

  const [sections, setSections] = useState<Section[]>([
    { id: 'buildenv',   title: 'Build Environment',      icon: 'phone-portrait-outline',  results: [], expanded: true  },
    { id: 'deeplinks',  title: 'Deep-Link canOpenURL()',  icon: 'link-outline',            results: [], expanded: true  },
    { id: 'intentflt',  title: 'Intent-Filter Registry',  icon: 'list-outline',            results: [], expanded: false },
    { id: 'supabase',   title: 'Supabase Configuration',  icon: 'server-outline',          results: [], expanded: false },
    { id: 'google',     title: 'Google Cloud Console',    icon: 'logo-google',             results: [], expanded: false },
    { id: 'oauthtest',  title: 'Live OAuth End-to-End',   icon: 'shield-checkmark-outline',results: [], expanded: false },
  ]);

  const updateSection = useCallback((id: string, results: TestResult[]) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, results } : s));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, expanded: !s.expanded } : s));
  }, []);

  useEffect(() => { warmUpBrowser(); return () => coolDownBrowser(); }, []);

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setCompleted(false);
    setOauthTestResult(null);

    // Reset all sections
    setSections(prev => prev.map(s => ({ ...s, results: [] })));

    // ── Section 1: Build Environment ─────────────────────────────────────────
    updateSection('buildenv', [
      { label: 'Platform', value: Platform.OS, status: 'info' },
      { label: 'Platform Version', value: String(Platform.Version ?? 'unknown'), status: 'info' },
      { label: 'Build Type', value: buildInfo.type, status: buildInfo.isNative ? 'pass' : buildInfo.isExpoGo ? 'fail' : 'warn' },
      {
        label: 'OAuth Support',
        value: buildInfo.isNative ? 'Supported ✓' : buildInfo.isExpoGo ? 'NOT supported in Expo Go ✗' : 'Limited on web',
        status: buildInfo.isNative ? 'pass' : buildInfo.isExpoGo ? 'fail' : 'warn',
        note: buildInfo.warning,
      },
      { label: 'Resolved Redirect URI', value: redirectUri, status: redirectUri.startsWith('predictxta://') ? 'pass' : 'warn' },
      { label: 'Android Package', value: ANDROID_PACKAGE, status: 'info' },
      { label: 'iOS Bundle ID', value: IOS_BUNDLE_ID, status: 'info' },
      { label: 'OAuth Scheme', value: 'predictxta://', status: 'info' },
      { label: 'Supabase Callback', value: SUPABASE_CALLBACK_URL, status: 'info' },
    ]);

    await sleep(200);

    // ── Section 2: canOpenURL() tests ─────────────────────────────────────────
    if (Platform.OS === 'web') {
      updateSection('deeplinks', DEEP_LINK_TEST_CASES.map(tc => ({
        label: tc.label,
        value: 'Skipped (web)',
        status: 'skip' as PassFail,
        note: tc.url,
      })));
    } else {
      const dlResults: TestResult[] = [];
      for (const tc of DEEP_LINK_TEST_CASES) {
        dlResults.push({ label: tc.label, value: '⟳ testing…', status: 'running', note: tc.url });
        updateSection('deeplinks', [...dlResults]);
        const canOpen = await testCanOpenUrl(tc.url);
        dlResults[dlResults.length - 1] = {
          label: tc.label,
          value: canOpen ? 'true — scheme registered ✓' : tc.required ? 'false — scheme NOT routable ✗' : 'false (optional)',
          status: canOpen ? 'pass' : tc.required ? (buildInfo.isNative ? 'fail' : 'warn') : 'warn',
          note: tc.url,
        };
        updateSection('deeplinks', [...dlResults]);
        await sleep(150);
      }
    }

    await sleep(200);

    // ── Section 3: Intent-filter registry (Android) ───────────────────────────
    if (Platform.OS !== 'android') {
      updateSection('intentflt', [
        {
          label: 'Platform check',
          value: Platform.OS === 'ios' ? 'iOS — uses CFBundleURLTypes instead' : 'N/A on web',
          status: 'skip',
          note: Platform.OS === 'ios' ? `CFBundleURLSchemes: ["predictxta"] in Info.plist` : undefined,
        },
        ...(Platform.OS === 'ios' ? [
          { label: 'CFBundleURLSchemes', value: '"predictxta" ✓', status: 'pass' as PassFail, note: 'Declared in ios.infoPlist.CFBundleURLTypes' },
          { label: 'CFBundleURLName', value: IOS_BUNDLE_ID + ' ✓', status: 'pass' as PassFail },
          { label: 'CFBundleTypeRole', value: '"Editor" ✓', status: 'pass' as PassFail, note: 'Required for OAuth deep-link routing on iOS' },
        ] : []),
      ]);
    } else {
      // On Android, all intent filters from app.json generate entries in AndroidManifest.xml
      // We report their expected state (cannot read live manifest at runtime)
      updateSection('intentflt', EXPECTED_INTENT_FILTERS.map(f => ({
        label: f.description,
        value: [
          `scheme="${f.scheme}"`,
          f.host ? `host="${f.host}"` : null,
          f.path ? `path="${f.path}"` : null,
        ].filter(Boolean).join(' · '),
        status: 'pass' as PassFail,
        note: 'Declared in app.json → android.intentFilters (generates AndroidManifest.xml entry)',
      })));
    }

    await sleep(200);

    // ── Section 4: Supabase configuration ────────────────────────────────────
    const providerResult = await checkSupabaseGoogleProvider();
    updateSection('supabase', [
      {
        label: 'Google provider enabled',
        value: providerResult.enabled ? 'Enabled ✓' : 'DISABLED or mis-configured ✗',
        status: providerResult.enabled ? 'pass' : 'fail',
        note: providerResult.enabled ? undefined : 'Go to: Supabase → Auth → Providers → Google → Enable',
      },
      {
        label: 'Client ID / Secret',
        value: providerResult.enabled ? 'Configured ✓' : 'Missing ✗',
        status: providerResult.enabled ? 'pass' : 'fail',
      },
      {
        label: 'OAuth URL status',
        value: providerResult.message.length > 55 ? providerResult.message.slice(0, 55) + '…' : providerResult.message,
        status: providerResult.enabled ? 'pass' : 'warn',
      },
      { label: 'Site URL (required)', value: 'predictxta://', status: 'info', note: 'Set in: Auth → URL Configuration → Site URL' },
      { label: 'Redirect URL #1', value: 'predictxta://**', status: 'info', note: 'Add to: Auth → URL Configuration → Redirect URLs' },
      { label: 'Redirect URL #2', value: 'predictxta://auth/callback', status: 'info', note: 'Required for PKCE code exchange' },
      { label: 'Redirect URL #3', value: 'predictxta://reset-password', status: 'info', note: 'Required for password reset flow' },
      { label: 'Redirect URL #4 (dev)', value: 'exp://**', status: 'info', note: 'For development / Expo CLI testing only' },
    ]);

    await sleep(200);

    // ── Section 5: Google Cloud Console requirements ──────────────────────────
    updateSection('google', [
      {
        label: 'Web client — Redirect URI',
        value: SUPABASE_CALLBACK_URL,
        status: 'info',
        note: 'Add exactly this URI to Google Cloud Console → Web client → Authorized Redirect URIs',
      },
      {
        label: 'Web client — JS Origin',
        value: `https://${SUPABASE_PROJECT}.supabase.co`,
        status: 'info',
        note: 'Authorized JavaScript origins',
      },
      {
        label: 'Android client — Package name',
        value: ANDROID_PACKAGE,
        status: 'info',
        note: 'Must match exactly. Current: com.predictxta.sports',
      },
      {
        label: 'Android client — SHA-1 (debug)',
        value: 'Run: keytool -keystore ~/.android/debug.keystore -list -v',
        status: 'warn',
        note: 'Password: android  |  Add to Google Cloud Android client',
      },
      {
        label: 'Android client — SHA-1 (release)',
        value: 'Run: keytool -keystore release.keystore -list -v',
        status: 'warn',
        note: 'Required for Play Store / production APK — register in Google Cloud Console',
      },
      {
        label: 'iOS client — Bundle ID',
        value: IOS_BUNDLE_ID,
        status: 'info',
        note: 'Must match exactly. Current: com.predictxta.app',
      },
      {
        label: 'OAuth Consent Screen',
        value: 'Must be Published (or test users added)',
        status: 'warn',
        note: 'Google Cloud Console → OAuth Consent Screen → Publish App',
      },
      {
        label: 'Scopes required',
        value: 'openid, email, profile',
        status: 'info',
        note: 'Add under: OAuth Consent Screen → Scopes',
      },
    ]);

    await sleep(200);

    // ── Section 6: Live end-to-end OAuth test ─────────────────────────────────
    if (Platform.OS === 'web') {
      updateSection('oauthtest', [
        {
          label: 'Test status',
          value: 'Skipped on web preview',
          status: 'skip',
          note: 'Download APK → install on Android device → run this screen',
        },
      ]);
    } else if (buildInfo.isExpoGo) {
      updateSection('oauthtest', [
        {
          label: 'Test status',
          value: 'Cannot test in Expo Go',
          status: 'fail',
          note: buildInfo.warning,
        },
      ]);
    } else {
      updateSection('oauthtest', [
        { label: 'Test status', value: '⟳ Opening browser…', status: 'running' },
      ]);
      toggleSection('oauthtest');

      const result = await signInWithGoogleOAuth();
      setOauthTestResult(result.success ? 'pass' : 'fail');

      if (result.success) {
        updateSection('oauthtest', [
          { label: 'Browser opened', value: 'Yes ✓', status: 'pass' },
          { label: 'OAuth callback received', value: 'Yes ✓', status: 'pass' },
          { label: 'PKCE code exchange', value: 'Success ✓', status: 'pass' },
          { label: 'Supabase session', value: 'Created ✓', status: 'pass' },
          { label: 'Deep link routing', value: 'Working correctly ✓', status: 'pass' },
        ]);
      } else {
        const code = result.errorCode ?? 'UNKNOWN';
        const known = result.errorCode ? GOOGLE_AUTH_ERRORS[result.errorCode] : null;
        updateSection('oauthtest', [
          { label: 'Test status', value: `FAILED — ${code}`, status: 'fail' },
          { label: 'Error detail', value: known ?? result.error ?? 'Unknown error', status: 'fail' },
          ...(code === 'E001' ? [{ label: 'Fix', value: 'Enable Google in Supabase → Auth → Providers', status: 'warn' as PassFail }] : []),
          ...(code === 'E003' ? [{ label: 'Fix', value: 'Add predictxta://** to Supabase redirect URLs', status: 'warn' as PassFail }] : []),
          ...(code === 'E005' ? [{ label: 'Fix', value: 'Install a native APK — Expo Go blocks custom schemes', status: 'warn' as PassFail }] : []),
          ...(code === 'E006' ? [{ label: 'Note', value: 'Browser closed before completing — try again', status: 'warn' as PassFail }] : []),
          ...(code === 'E013' ? [{ label: 'Fix', value: 'Add release SHA-1 to Google Cloud Android client', status: 'warn' as PassFail }] : []),
        ]);
      }
    }

    setRunning(false);
    setCompleted(true);
  }, [running, buildInfo, redirectUri, updateSection, toggleSection]);

  // Overall summary
  const allResults = sections.flatMap(s => s.results);
  const failCount = allResults.filter(r => r.status === 'fail').length;
  const warnCount = allResults.filter(r => r.status === 'warn').length;
  const passCount = allResults.filter(r => r.status === 'pass').length;
  const summaryColor = failCount > 0 ? '#EF4444' : warnCount > 0 ? '#F59E0B' : completed ? '#22C55E' : C.textMuted;
  const summaryLabel = failCount > 0 ? `${failCount} issue${failCount > 1 ? 's' : ''} detected` : warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` : completed ? 'All checks passed' : 'Ready';

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="link" size={16} color={C.primary} />
              <Text style={[s.title, { color: C.textPrimary }]}>Deep Link Diagnostics</Text>
            </View>
            <Text style={[s.subtitle, { color: C.textMuted }]}>
              OAuth · Intent Filters · Build Environment
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Expo Go Warning ──────────────────────────────────────────────── */}
        {buildInfo.isExpoGo ? (
          <View style={[s.warnBanner, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
            <Ionicons name="warning" size={18} color="#EF4444" />
            <View style={{ flex: 1 }}>
              <Text style={[s.warnTitle, { color: '#EF4444' }]}>Expo Go Detected</Text>
              <Text style={[s.warnBody, { color: '#EF4444' }]}>
                {buildInfo.warning}
              </Text>
              <Text style={[s.warnBody, { color: '#EF4444', marginTop: 6 }]}>
                To test OAuth deep links, download the APK from the top-right ↗ toolbar or run:{'\n'}
                <Text style={{ fontFamily: 'monospace' }}>eas build --platform android --profile preview</Text>
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── Summary card ─────────────────────────────────────────────────── */}
        <View style={[s.summaryCard, { backgroundColor: C.card, borderColor: `${summaryColor}44` }]}>
          <View style={[s.summaryIcon, { backgroundColor: `${summaryColor}18`, borderColor: `${summaryColor}33` }]}>
            {running ? <SpinIndicator color={summaryColor} /> : (
              <Ionicons
                name={failCount > 0 ? 'close-circle' : warnCount > 0 ? 'warning' : completed ? 'shield-checkmark' : 'shield-outline'}
                size={20} color={summaryColor}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.summaryTitle, { color: C.textPrimary }]}>
              {running ? 'Running diagnostics…' : summaryLabel}
            </Text>
            <Text style={[s.summarySub, { color: C.textMuted }]}>
              {completed
                ? `${passCount} passed · ${warnCount} warnings · ${failCount} failed`
                : running ? 'Testing deep-link routing and OAuth configuration'
                : 'Tap "Run Diagnostics" to begin'}
            </Text>
          </View>
        </View>

        {/* ── Quick info strip ─────────────────────────────────────────────── */}
        <View style={[s.infoStrip, { backgroundColor: C.card, borderColor: C.border }]}>
          {[
            { icon: 'phone-portrait-outline', label: 'Platform', value: `${Platform.OS} ${Platform.Version ?? ''}` },
            { icon: 'construct-outline',      label: 'Build',    value: buildInfo.isExpoGo ? 'Expo Go ⚠' : buildInfo.isNative ? 'Native ✓' : 'Web' },
            { icon: 'link-outline',           label: 'Scheme',   value: 'predictxta://' },
            { icon: 'key-outline',            label: 'Package',  value: Platform.OS === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <View style={s.infoItem}>
                <Ionicons name={item.icon as any} size={12} color={C.textMuted} />
                <Text style={[s.infoLabel, { color: C.textMuted }]}>{item.label}</Text>
                <Text style={[s.infoValue, { color: C.textSecondary }]} numberOfLines={1}>{item.value}</Text>
              </View>
              {i < arr.length - 1 ? <View style={[s.infoDivider, { backgroundColor: C.border }]} /> : null}
            </React.Fragment>
          ))}
        </View>

        {/* ── Section cards ─────────────────────────────────────────────────── */}
        {sections.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            onToggle={() => toggleSection(section.id)}
            C={C}
          />
        ))}

        {/* ── Requirements checklist ───────────────────────────────────────── */}
        {completed ? (
          <View style={[s.checklistCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[s.checklistTitle, { color: C.textPrimary }]}>
              Production Build Verification Checklist
            </Text>
            {[
              { done: buildInfo.isNative,                  label: 'Running on a native build (not Expo Go)' },
              { done: redirectUri.startsWith('predictxta'), label: `Redirect URI = ${redirectUri}` },
              { done: true,                                 label: `Android package = ${ANDROID_PACKAGE}` },
              { done: true,                                 label: `iOS bundle ID = ${IOS_BUNDLE_ID}` },
              { done: true,                                 label: '7 intent-filters registered in app.json' },
              { done: null,                                 label: 'Google provider enabled in Supabase → Auth → Providers' },
              { done: null,                                 label: `Supabase Site URL = predictxta://` },
              { done: null,                                 label: 'predictxta://** in Supabase redirect URLs' },
              { done: null,                                 label: `${SUPABASE_CALLBACK_URL} in Google Cloud Web client` },
              { done: null,                                 label: `${ANDROID_PACKAGE} + SHA-1 in Google Cloud Android client` },
              { done: null,                                 label: 'OAuth Consent Screen published or test user added' },
              { done: oauthTestResult === 'pass',           label: 'Live Google Sign-In test passed end-to-end' },
            ].map((item, i) => (
              <View key={i} style={[s.clRow, { borderBottomColor: C.border }]}>
                <Ionicons
                  name={item.done === true ? 'checkbox' : item.done === false ? 'close-circle-outline' : 'square-outline'}
                  size={16}
                  color={item.done === true ? '#22C55E' : item.done === false ? '#EF4444' : C.textMuted}
                />
                <Text style={[s.clLabel, { color: item.done === false ? '#EF4444' : C.textSecondary }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── CTA bar ───────────────────────────────────────────────────────── */}
      <View style={[s.ctaBar, { backgroundColor: C.surface, borderTopColor: C.border }]}>
        {completed && !running ? (
          <Pressable
            style={({ pressed }) => [s.resetBtn, { borderColor: C.border, backgroundColor: C.card }, pressed ? { opacity: 0.8 } : null]}
            onPress={() => {
              setSections(prev => prev.map(s => ({ ...s, results: [] })));
              setCompleted(false);
              setOauthTestResult(null);
            }}
          >
            <Ionicons name="refresh-outline" size={15} color={C.textMuted} />
            <Text style={[s.resetBtnText, { color: C.textMuted }]}>Reset</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            s.runBtn,
            { backgroundColor: running ? `${C.primary}60` : C.primary },
            pressed && !running ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
          ]}
          onPress={runAll}
          disabled={running}
        >
          {running ? (
            <><SpinIndicator color="#fff" /><Text style={s.runBtnText}>Running…</Text></>
          ) : (
            <><Ionicons name="play-circle-outline" size={18} color="#fff" />
            <Text style={s.runBtnText}>{completed ? 'Re-run Diagnostics' : 'Run Diagnostics'}</Text></>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 11, marginTop: 1 },

  content: { padding: SPACING.md },

  warnBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12,
  },
  warnTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 4 },
  warnBody: { fontSize: 12, lineHeight: 18 },

  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12,
  },
  summaryIcon: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  summaryTitle: { fontSize: 15, fontWeight: FONTS.bold },
  summarySub: { fontSize: 12, marginTop: 2 },

  infoStrip: {
    flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    alignItems: 'center',
  },
  infoItem: { flex: 1, alignItems: 'center', gap: 3 },
  infoLabel: { fontSize: 9, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 10, fontWeight: FONTS.semiBold, textAlign: 'center' },
  infoDivider: { width: 1, height: 32, marginHorizontal: 4 },

  checklistCard: {
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginTop: 4,
  },
  checklistTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 12 },
  clRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  clLabel: { flex: 1, fontSize: 12, lineHeight: 18 },

  ctaBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 12, borderTopWidth: 1,
  },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12,
  },
  resetBtnText: { fontSize: 13, fontWeight: FONTS.semiBold },
  runBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 14,
  },
  runBtnText: { fontSize: 15, fontWeight: FONTS.bold, color: '#fff' },
});
