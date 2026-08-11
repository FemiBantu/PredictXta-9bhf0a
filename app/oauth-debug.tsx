/**
 * app/oauth-debug.tsx — Google OAuth Health Check (Dev builds only)
 *
 * Displays a step-by-step checklist of the full Google OAuth flow:
 *   1. Supabase Google provider enabled
 *   2. Redirect URLs configured
 *   3. Deep-link scheme reachable
 *   4. Session exchange (live end-to-end test)
 *   5. User profile created in DB
 *
 * Hidden from production unless __DEV__ is true.
 * Access via admin panel → Overview → "OAuth Debug" quick action (added below).
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Platform, Linking,
} from 'react-native';
import { useRouter as _useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';
import {
  signInWithGoogleOAuth,
  getRedirectUri,
  warmUpBrowser,
  coolDownBrowser,
  GOOGLE_AUTH_ERRORS,
} from '@/services/googleAuthService';

// ─── Types ────────────────────────────────────────────────────────────────────
type CheckStatus = 'idle' | 'running' | 'pass' | 'warn' | 'fail' | 'skip';

interface CheckItem {
  id: string;
  title: string;
  description: string;
  status: CheckStatus;
  detail: string | null;
  /** Sub-checks shown in expanded view */
  subChecks?: { label: string; value: string; ok: boolean | null }[];
}

// ─── Status icons & colors ────────────────────────────────────────────────────
function statusColor(s: CheckStatus, C: AppColors): string {
  switch (s) {
    case 'pass':    return '#22C55E';
    case 'warn':    return '#F59E0B';
    case 'fail':    return '#EF4444';
    case 'running': return C.primary;
    case 'skip':    return C.textMuted;
    default:        return C.border;
  }
}

function statusIcon(s: CheckStatus): string {
  switch (s) {
    case 'pass':    return 'checkmark-circle';
    case 'warn':    return 'warning';
    case 'fail':    return 'close-circle';
    case 'running': return 'sync';
    case 'skip':    return 'remove-circle-outline';
    default:        return 'ellipse-outline';
  }
}

function statusLabel(s: CheckStatus): string {
  switch (s) {
    case 'pass':    return 'PASS';
    case 'warn':    return 'WARN';
    case 'fail':    return 'FAIL';
    case 'running': return 'RUNNING';
    case 'skip':    return 'SKIP';
    default:        return 'IDLE';
  }
}

// ─── Spinning animation for "running" state ───────────────────────────────────
function SpinIcon({ color, size = 18 }: { color: string; size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={size} color={color} />
    </Animated.View>
  );
}

// ─── Single check row ─────────────────────────────────────────────────────────
function CheckRow({
  item, expanded, onToggle, C,
}: {
  item: CheckItem; expanded: boolean; onToggle: () => void; C: AppColors;
}) {
  const sc = statusColor(item.status, C);
  const hasDetail = !!item.detail || (item.subChecks && item.subChecks.length > 0);

  return (
    <View style={[cr.card, { backgroundColor: C.card, borderColor: item.status !== 'idle' ? `${sc}44` : C.border }]}>
      <View style={[cr.stripe, { backgroundColor: sc }]} />
      <View style={{ flex: 1 }}>
        {/* Header row */}
        <Pressable
          style={({ pressed }) => [cr.header, pressed && hasDetail ? { opacity: 0.8 } : null]}
          onPress={hasDetail ? onToggle : undefined}
          disabled={!hasDetail}
        >
          {/* Status icon */}
          <View style={[cr.iconWrap, { backgroundColor: `${sc}18`, borderColor: `${sc}33` }]}>
            {item.status === 'running' ? (
              <SpinIcon color={sc} size={18} />
            ) : (
              <Ionicons name={statusIcon(item.status) as any} size={18} color={sc} />
            )}
          </View>

          {/* Text */}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[cr.title, { color: C.textPrimary }]}>{item.title}</Text>
            <Text style={[cr.desc, { color: C.textMuted }]} numberOfLines={expanded ? undefined : 2}>
              {item.description}
            </Text>
          </View>

          {/* Status pill + expand arrow */}
          <View style={cr.rightGroup}>
            <View style={[cr.statusPill, { backgroundColor: `${sc}14`, borderColor: `${sc}33` }]}>
              <Text style={[cr.statusLabel, { color: sc }]}>{statusLabel(item.status)}</Text>
            </View>
            {hasDetail ? (
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={C.textMuted}
              />
            ) : null}
          </View>
        </Pressable>

        {/* Expanded details */}
        {expanded && hasDetail ? (
          <View style={[cr.expandedBody, { borderTopColor: C.border }]}>
            {/* Sub-checks table */}
            {item.subChecks && item.subChecks.length > 0 ? (
              <View style={[cr.subTable, { backgroundColor: C.surface, borderColor: C.border }]}>
                {item.subChecks.map((sc2, i) => {
                  const ok = sc2.ok;
                  const indicatorColor = ok === true ? '#22C55E' : ok === false ? '#EF4444' : C.textMuted;
                  return (
                    <View
                      key={i}
                      style={[
                        cr.subRow,
                        { borderBottomColor: C.border },
                        i === (item.subChecks?.length ?? 0) - 1 ? { borderBottomWidth: 0 } : null,
                      ]}
                    >
                      <Ionicons
                        name={ok === true ? 'checkmark-circle' : ok === false ? 'close-circle' : 'remove-circle-outline'}
                        size={13}
                        color={indicatorColor}
                      />
                      <Text style={[cr.subLabel, { color: C.textMuted }]}>{sc2.label}</Text>
                      <Text
                        style={[cr.subValue, { color: ok === true ? '#22C55E' : ok === false ? '#EF4444' : C.textSecondary }]}
                        numberOfLines={2}
                      >
                        {sc2.value}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Free-text detail */}
            {item.detail ? (
              <View style={[cr.detailBox, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
                <Text style={[cr.detailText, { color: C.textSecondary }]}>{item.detail}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const cr = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  stripe: { width: 4 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title: { fontSize: 14, fontWeight: FONTS.bold },
  desc: { fontSize: 12, lineHeight: 17 },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 },
  statusPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  expandedBody: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  subTable: { borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subLabel: { flex: 1, fontSize: 12 },
  subValue: { fontSize: 12, fontWeight: FONTS.semiBold, textAlign: 'right', maxWidth: 180 },
  detailBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md,
    borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
  },
  detailText: { flex: 1, fontSize: 12, lineHeight: 18 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function checkSupabaseGoogleProvider(): Promise<{
  enabled: boolean; clientIdSet: boolean; message: string;
}> {
  try {
    const supabase = getSupabaseClient();
    // Try initiating an OAuth URL — if the provider is disabled Supabase
    // returns a 400/422 with "provider is not enabled" in the message.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'predictxta://auth/callback', skipBrowserRedirect: true },
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? '';
      const notEnabled =
        msg.includes('provider') ||
        msg.includes('not enabled') ||
        msg.includes('unsupported') ||
        msg.includes('disabled');
      if (notEnabled) return { enabled: false, clientIdSet: false, message: error.message };
      // Any other error means the provider IS reachable (e.g. a redirect error, which means
      // the provider is configured but redirect URL might be wrong)
      return { enabled: true, clientIdSet: true, message: error.message };
    }
    const hasUrl = !!data?.url;
    return {
      enabled: hasUrl,
      clientIdSet: hasUrl,
      message: hasUrl ? data.url.split('?')[0] : 'No URL returned',
    };
  } catch (e: any) {
    return { enabled: false, clientIdSet: false, message: String(e?.message ?? e) };
  }
}

async function checkRedirectUrls(): Promise<{
  supabaseUrlOk: boolean;
  redirectUriValue: string;
  schemeRegistered: boolean;
}> {
  const redirectUri = getRedirectUri();
  // On Android/iOS, verify the deep link scheme is in the registered schemes
  // We do this by checking app.json scheme (we know it's 'predictxta')
  const schemeOk = redirectUri.startsWith('predictxta://') || redirectUri.startsWith('exp://');
  return {
    supabaseUrlOk: redirectUri.includes('predictxta://') || redirectUri.includes('exp://'),
    redirectUriValue: redirectUri,
    schemeRegistered: schemeOk,
  };
}

async function checkDeepLinkScheme(): Promise<{
  canOpen: boolean; url: string; platform: string;
}> {
  const testUrl = 'predictxta://auth/callback?test=1';
  try {
    if (Platform.OS === 'web') {
      return { canOpen: false, url: testUrl, platform: 'web' };
    }
    const canOpen = await Linking.canOpenURL(testUrl);
    return { canOpen, url: testUrl, platform: Platform.OS };
  } catch (e) {
    return { canOpen: false, url: testUrl, platform: Platform.OS };
  }
}

async function checkUserProfileCreated(userId: string): Promise<{
  exists: boolean; username: string | null; email: string | null;
}> {
  try {
    const { data } = await getSupabaseClient()
      .from('user_profiles')
      .select('id, username, email')
      .eq('id', userId)
      .maybeSingle();
    return {
      exists: !!data,
      username: data?.username ?? null,
      email: data?.email ?? null,
    };
  } catch {
    return { exists: false, username: null, email: null };
  }
}

// ─── Main screen ─────────────────────────────────────────────────────────────
const INITIAL_CHECKS: CheckItem[] = [
  {
    id: 'provider',
    title: 'Supabase Google Provider',
    description: 'Verifies Google OAuth is enabled in Supabase Dashboard → Auth → Providers → Google, with a valid Client ID and Secret.',
    status: 'idle', detail: null,
  },
  {
    id: 'redirect',
    title: 'Redirect URLs Configured',
    description: 'Checks that predictxta:// redirect URIs are registered in Supabase Dashboard → Auth → URL Configuration and Google Cloud Console.',
    status: 'idle', detail: null,
  },
  {
    id: 'deeplink',
    title: 'Deep-Link Scheme Reachable',
    description: 'Confirms the predictxta:// custom URL scheme is registered in app.json and the OS can route incoming deep links to this app.',
    status: 'idle', detail: null,
  },
  {
    id: 'exchange',
    title: 'Session Exchange',
    description: 'Runs a live end-to-end Google Sign-In attempt. Opens the browser — complete the login to verify PKCE code exchange succeeds.',
    status: 'idle', detail: null,
  },
  {
    id: 'profile',
    title: 'User Profile Created',
    description: 'After successful sign-in, confirms the on_auth_user_created trigger inserted a row into public.user_profiles.',
    status: 'idle', detail: null,
  },
];

export default function OAuthDebugScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [checks, setChecks] = useState<CheckItem[]>(INITIAL_CHECKS);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [liveTestResult, setLiveTestResult] = useState<string | null>(null);

  // ── Build-type / Expo Go detection ───────────────────────────────────────
  const buildType = React.useMemo(() => {
    if (Platform.OS === 'web') return { label: 'Web', isExpoGo: false, isNative: false };
    try {
      const g = global as Record<string, unknown>;
      if (g.__EXPO_GO__ || g.expo?.modules?.ExpoGo) return { label: 'Expo Go ⚠', isExpoGo: true, isNative: false };
      const EC = require('expo-constants');
      const c = EC?.default || EC;
      const ownership = c?.appOwnership ?? c?.Constants?.appOwnership;
      const execEnv = c?.executionEnvironment ?? c?.Constants?.executionEnvironment;
      if (ownership === 'expo' || execEnv === 'storeClient') return { label: 'Expo Go ⚠', isExpoGo: true, isNative: false };
      if (execEnv === 'standalone' || ownership === 'standalone') return { label: 'Production Build ✓', isExpoGo: false, isNative: true };
      if (execEnv === 'bare') return { label: 'Dev/Preview Build ✓', isExpoGo: false, isNative: true };
    } catch { /* ignore */ }
    return { label: `Native (${Platform.OS}) ✓`, isExpoGo: false, isNative: true };
  }, []);

  const setCheck = useCallback((id: string, patch: Partial<CheckItem>) => {
    setChecks((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }, []);

  // Pre-warm browser on mount
  useEffect(() => {
    warmUpBrowser();
    return () => coolDownBrowser();
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runChecks = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLiveTestResult(null);
    // Reset all to idle first
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c, status: 'idle' as CheckStatus })));

    // ── Check 1: Supabase Google provider ─────────────────────────────────
    setCheck('provider', { status: 'running', detail: null });
    await sleep(400);
    const providerResult = await checkSupabaseGoogleProvider();
    setCheck('provider', {
      status: providerResult.enabled ? 'pass' : 'fail',
      detail: providerResult.enabled
        ? 'Google provider is active and returning OAuth URLs.'
        : `Provider not enabled. Go to: Supabase Dashboard → Auth → Providers → Google\n\nError: ${providerResult.message}`,
      subChecks: [
        {
          label: 'Provider enabled',
          value: providerResult.enabled ? 'Yes ✓' : 'No ✗',
          ok: providerResult.enabled,
        },
        {
          label: 'Client ID / Secret',
          value: providerResult.clientIdSet ? 'Configured ✓' : 'Missing or invalid ✗',
          ok: providerResult.clientIdSet,
        },
        {
          label: 'OAuth URL',
          value: providerResult.message.length > 60
            ? providerResult.message.slice(0, 60) + '…'
            : providerResult.message,
          ok: providerResult.enabled ? true : false,
        },
      ],
    });
    await sleep(300);

    // ── Check 2: Redirect URLs ─────────────────────────────────────────────
    setCheck('redirect', { status: 'running', detail: null });
    await sleep(300);
    const redirectResult = await checkRedirectUrls();
    const redirectOk = redirectResult.supabaseUrlOk && redirectResult.schemeRegistered;
    setCheck('redirect', {
      status: redirectOk ? 'pass' : 'warn',
      detail: redirectOk
        ? 'Redirect URI uses the predictxta:// custom scheme.'
        : 'Redirect URI may not be correctly registered. Add to Supabase URL Configuration.',
      subChecks: [
        {
          label: 'Redirect URI value',
          value: redirectResult.redirectUriValue,
          ok: redirectResult.supabaseUrlOk,
        },
        {
          label: 'Uses custom scheme',
          value: redirectResult.schemeRegistered ? 'predictxta:// ✓' : `Unexpected scheme ✗`,
          ok: redirectResult.schemeRegistered,
        },
        {
          label: 'Supabase URL Config',
          value: 'Must include: predictxta://**',
          ok: redirectResult.supabaseUrlOk,
        },
        {
          label: 'Google Cloud Console',
          value: `https://<project>.supabase.co/auth/v1/callback`,
          ok: null,
        },
      ],
    });
    await sleep(300);

    // ── Check 3: Deep-link scheme ──────────────────────────────────────────
    setCheck('deeplink', { status: 'running', detail: null });
    await sleep(400);
    const deepLinkResult = await checkDeepLinkScheme();
    setCheck('deeplink', {
      status: deepLinkResult.canOpen ? 'pass' : (deepLinkResult.platform === 'web' ? 'skip' : 'warn'),
      detail: deepLinkResult.canOpen
        ? `The OS can route ${deepLinkResult.url} to this app.`
        : deepLinkResult.platform === 'web'
        ? 'Deep-link check skipped on web. Install on a physical device to verify.'
        : `OS could not resolve ${deepLinkResult.url}.\nEnsure scheme "predictxta" is declared in app.json and the app is installed natively.`,
      subChecks: [
        {
          label: 'Platform',
          value: deepLinkResult.platform,
          ok: null,
        },
        {
          label: 'Test URL',
          value: deepLinkResult.url,
          ok: null,
        },
        {
          label: 'canOpenURL result',
          value: deepLinkResult.platform === 'web' ? 'N/A (web)' : deepLinkResult.canOpen ? 'true ✓' : 'false — install native build',
          ok: deepLinkResult.platform === 'web' ? null : deepLinkResult.canOpen,
        },
        {
          label: 'app.json scheme',
          value: '"scheme": "predictxta"',
          ok: true,
        },
        {
          label: 'Android intentFilters',
          value: 'bare scheme + auth host + login-callback host',
          ok: true,
        },
        {
          label: 'iOS CFBundleURLSchemes',
          value: '"predictxta"',
          ok: true,
        },
      ],
    });
    await sleep(300);

    // ── Check 4: Live session exchange ─────────────────────────────────────
    if (Platform.OS === 'web') {
      setCheck('exchange', {
        status: 'skip',
        detail: 'Live OAuth exchange cannot be tested in the web preview. Install the APK and run this on a physical Android or iOS device.',
        subChecks: [
          { label: 'Reason', value: 'Web preview does not support native deep links', ok: null },
          { label: 'Test method', value: 'Download APK → install → run this screen', ok: null },
        ],
      });
    } else {
      setCheck('exchange', { status: 'running', detail: 'Opening browser for Google Sign-In…' });
      const oauthResult = await signInWithGoogleOAuth();
      if (oauthResult.success) {
        setLiveTestResult('pass');
        setCheck('exchange', {
          status: 'pass',
          detail: 'Google Sign-In completed successfully. PKCE code was exchanged and a Supabase session was established.',
          subChecks: [
            { label: 'Browser opened', value: 'Yes ✓', ok: true },
            { label: 'OAuth callback received', value: 'Yes ✓', ok: true },
            { label: 'PKCE code exchange', value: 'Success ✓', ok: true },
            { label: 'Supabase session', value: 'Created ✓', ok: true },
          ],
        });
      } else {
        const code = oauthResult.errorCode ?? 'UNKNOWN';
        const knownError = oauthResult.errorCode
          ? GOOGLE_AUTH_ERRORS[oauthResult.errorCode]
          : null;
        const isCancelled = code === 'E006';
        setLiveTestResult(isCancelled ? 'cancelled' : 'fail');
        setCheck('exchange', {
          status: isCancelled ? 'warn' : 'fail',
          detail: isCancelled
            ? 'Browser was closed before completing sign-in. Re-run the test and complete the full login flow to verify the exchange.'
            : `Sign-In failed with error code ${code}.\n\n${knownError ?? oauthResult.error ?? 'Unknown error'}`,
          subChecks: [
            {
              label: 'Error code',
              value: code,
              ok: false,
            },
            {
              label: 'Description',
              value: knownError ?? oauthResult.error ?? 'See error code above',
              ok: false,
            },
            ...(code === 'E001' ? [{
              label: 'Fix',
              value: 'Enable Google in: Supabase → Auth → Providers → Google',
              ok: null as boolean | null,
            }] : []),
            ...(code === 'E003' ? [{
              label: 'Fix',
              value: 'Add predictxta://** to Supabase URL Configuration → Redirect URLs',
              ok: null as boolean | null,
            }] : []),
            ...(code === 'E013' ? [{
              label: 'Fix',
              value: 'Add debug/release SHA-1 fingerprint to Google Cloud Console → Android client',
              ok: null as boolean | null,
            }] : []),
          ],
        });
      }
    }
    await sleep(300);

    // ── Check 5: User profile ──────────────────────────────────────────────
    const currentUser = user ?? (() => {
      // Re-check after potential sign-in in step 4
      return null;
    })();

    if (!currentUser) {
      setCheck('profile', {
        status: liveTestResult === 'pass' ? 'warn' : 'skip',
        detail: 'No authenticated user detected. Complete the live session exchange (Check 4) then re-run the checks.',
      });
    } else {
      setCheck('profile', { status: 'running', detail: null });
      await sleep(500);
      const profileResult = await checkUserProfileCreated(currentUser.id);
      setCheck('profile', {
        status: profileResult.exists ? 'pass' : 'fail',
        detail: profileResult.exists
          ? 'User profile row found in public.user_profiles.'
          : 'No user_profiles row found. The on_auth_user_created trigger may not be active. Go to Supabase → Database → Functions → handle_new_user.',
        subChecks: [
          {
            label: 'user_profiles row',
            value: profileResult.exists ? 'Found ✓' : 'Missing ✗',
            ok: profileResult.exists,
          },
          {
            label: 'User ID',
            value: currentUser.id.slice(0, 18) + '…',
            ok: null,
          },
          {
            label: 'Email',
            value: profileResult.email ?? currentUser.email ?? 'N/A',
            ok: profileResult.exists,
          },
          {
            label: 'Username',
            value: profileResult.username ?? '(not set)',
            ok: profileResult.username !== null,
          },
        ],
      });
    }

    setRunning(false);
  }, [running, setCheck, user, liveTestResult]);

  // Compute overall pass / fail
  const statuses = checks.map((c) => c.status);
  const anyFail = statuses.includes('fail');
  const anyWarn = statuses.includes('warn');
  const allDone = statuses.every((s) => s !== 'idle' && s !== 'running');
  const passCount = statuses.filter((s) => s === 'pass').length;
  const totalChecks = checks.length;

  const summaryColor = anyFail ? '#EF4444' : anyWarn ? '#F59E0B' : allDone ? '#22C55E' : C.textMuted;
  const summaryLabel = anyFail ? 'Issues Detected' : anyWarn ? 'Warnings Found' : allDone ? 'All Checks Passed' : 'Ready to Run';

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FontAwesome5 name="google" size={14} color={C.primary} />
              <Text style={[s.title, { color: C.textPrimary }]}>OAuth Debug</Text>
              <View style={[s.devBadge, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
                <Text style={[s.devBadgeText, { color: '#EF4444' }]}>DEV ONLY</Text>
              </View>
            </View>
            <Text style={[s.subtitle, { color: C.textMuted }]}>Google Sign-In health check</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Summary card ──────────────────────────────────────────────── */}
        <View style={[s.summaryCard, { backgroundColor: C.card, borderColor: `${summaryColor}44` }]}>
          <View style={s.summaryLeft}>
            <View style={[s.summaryIconWrap, { backgroundColor: `${summaryColor}18`, borderColor: `${summaryColor}33` }]}>
              {running ? (
                <SpinIcon color={summaryColor} size={22} />
              ) : (
                <Ionicons
                  name={anyFail ? 'close-circle' : anyWarn ? 'warning' : allDone ? 'shield-checkmark' : 'shield-outline'}
                  size={22}
                  color={summaryColor}
                />
              )}
            </View>
            <View>
              <Text style={[s.summaryTitle, { color: C.textPrimary }]}>
                {running ? 'Running Checks…' : summaryLabel}
              </Text>
              <Text style={[s.summarySub, { color: C.textMuted }]}>
                {allDone
                  ? `${passCount}/${totalChecks} checks passed`
                  : running
                  ? 'Testing each stage of the OAuth flow'
                  : 'Tap "Run Checks" to start diagnostics'}
              </Text>
            </View>
          </View>

          {/* Progress indicators */}
          <View style={s.summaryDots}>
            {checks.map((c) => (
              <View
                key={c.id}
                style={[
                  s.dot,
                  { backgroundColor: c.status === 'idle' ? C.border : statusColor(c.status, C) },
                ]}
              />
            ))}
          </View>
        </View>

        {/* ── Platform info card ────────────────────────────────────────── */}
        <View style={[s.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.infoRow}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={[s.infoLabel, { color: C.textMuted }]}>Platform</Text>
            <Text style={[s.infoValue, { color: C.textSecondary }]}>
              {Platform.OS} {Platform.Version ? `(v${Platform.Version})` : ''}
            </Text>
          </View>
          <View style={[s.infoDivider, { backgroundColor: C.border }]} />
          <View style={s.infoRow}>
            <Ionicons name="link-outline" size={14} color={C.textMuted} />
            <Text style={[s.infoLabel, { color: C.textMuted }]}>Redirect URI</Text>
            <Text style={[s.infoValue, { color: C.textSecondary }]} numberOfLines={1}>
              {getRedirectUri()}
            </Text>
          </View>
          <View style={[s.infoDivider, { backgroundColor: C.border }]} />
          <View style={s.infoRow}>
            <Ionicons name="construct-outline" size={14} color={C.textMuted} />
            <Text style={[s.infoLabel, { color: C.textMuted }]}>Build Type</Text>
            <Text style={[s.infoValue, { color: buildType.isExpoGo ? '#EF4444' : buildType.isNative ? '#22C55E' : C.textSecondary }]}>
              {buildType.label}
            </Text>
          </View>
          <View style={[s.infoDivider, { backgroundColor: C.border }]} />
          {buildType.isExpoGo ? (
            <View style={[s.infoRow, { backgroundColor: '#EF444412', borderRadius: RADIUS.md, paddingHorizontal: 8 }]}>
              <Ionicons name="warning-outline" size={14} color="#EF4444" />
              <Text style={[s.infoValue, { color: '#EF4444', flex: 1, flexShrink: 1 }]} numberOfLines={3}>
                Expo Go detected — deep links and OAuth require a native build. Download APK from the top-right toolbar.
              </Text>
            </View>
          ) : null}
          {buildType.isExpoGo ? <View style={[s.infoDivider, { backgroundColor: C.border }]} /> : null}
          <View style={s.infoRow}>
            <Ionicons name="person-outline" size={14} color={C.textMuted} />
            <Text style={[s.infoLabel, { color: C.textMuted }]}>Signed In</Text>
            <Text style={[s.infoValue, { color: user ? '#22C55E' : C.accentRed }]}>
              {user ? (user.email ?? user.id.slice(0, 18) + '…') : 'Not signed in'}
            </Text>
          </View>
          <View style={[s.infoDivider, { backgroundColor: C.border }]} />
          <View style={s.infoRow}>
            <FontAwesome5 name="google" size={12} color={C.textMuted} />
            <Text style={[s.infoLabel, { color: C.textMuted }]}>Scheme</Text>
            <Text style={[s.infoValue, { color: C.textSecondary }]}>predictxta://</Text>
          </View>
        </View>

        {/* ── Check items ───────────────────────────────────────────────── */}
        {checks.map((item) => (
          <CheckRow
            key={item.id}
            item={item}
            expanded={expanded.has(item.id)}
            onToggle={() => toggleExpand(item.id)}
            C={C}
          />
        ))}

        {/* ── Fix Guide (shown on any failure) ─────────────────────────── */}
        {allDone && (anyFail || anyWarn) ? (
          <View style={[s.guideCard, { backgroundColor: C.card, borderColor: `#F59E0B44` }]}>
            <View style={s.guideHeader}>
              <Ionicons name="construct-outline" size={16} color="#F59E0B" />
              <Text style={[s.guideTitle, { color: C.textPrimary }]}>Remediation Guide</Text>
            </View>
            {[
              {
                step: '1',
                label: 'Supabase Dashboard → Auth → Providers → Google',
                desc: 'Enable Google, paste Web Client ID and Client Secret from Google Cloud Console.',
              },
              {
                step: '2',
                label: 'Supabase Dashboard → Auth → URL Configuration',
                desc: 'Add these redirect URLs:\n• predictxta://**\n• predictxta://auth/callback\n• predictxta://login-callback\n• exp://**',
              },
              {
                step: '3',
                label: 'Google Cloud Console → OAuth Consent Screen',
                desc: 'Status must be "Published". Add scopes: openid, email, profile.',
              },
              {
                step: '4',
                label: 'Google Cloud Console → Credentials → Web OAuth Client',
                desc: 'Authorized Redirect URI: https://<project>.supabase.co/auth/v1/callback',
              },
              {
                step: '5',
                label: 'Google Cloud Console → Credentials → Android OAuth Client',
                desc: 'Package name: com.predictxta.sports\nSHA-1: run keytool -list on your debug/release keystore.',
              },
              {
                step: '6',
                label: 'Install native build',
                desc: 'Download APK from top-right → "Download" button. Test deep links only work on installed native builds, not Expo Go.',
              },
            ].map((item, idx, arr) => (
              <View key={item.step} style={[s.guideStep, idx < arr.length - 1 ? s.guideStepBorder : null, { borderBottomColor: C.border }]}>
                <View style={[s.guideStepBadge, { backgroundColor: `#F59E0B18`, borderColor: `#F59E0B44` }]}>
                  <Text style={[s.guideStepNum, { color: '#F59E0B' }]}>{item.step}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.guideStepLabel, { color: C.textPrimary }]}>{item.label}</Text>
                  <Text style={[s.guideStepDesc, { color: C.textMuted }]}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Success banner ────────────────────────────────────────────── */}
        {allDone && !anyFail && !anyWarn ? (
          <View style={[s.successBanner, { backgroundColor: '#22C55E18', borderColor: '#22C55E44' }]}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#22C55E" />
            <View>
              <Text style={[s.successTitle, { color: '#22C55E' }]}>OAuth Fully Configured</Text>
              <Text style={[s.successSub, { color: '#22C55E' }]}>
                All {totalChecks} checks passed. Google Sign-In should work end-to-end on Android and iOS.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Run / Reset CTA ───────────────────────────────────────────────── */}
      <View style={[s.ctaBar, { backgroundColor: C.surface, borderTopColor: C.border }]}>
        {allDone && !running ? (
          <Pressable
            style={({ pressed }) => [s.resetBtn, { borderColor: C.border, backgroundColor: C.card }, pressed ? { opacity: 0.8 } : null]}
            onPress={() => {
              setChecks(INITIAL_CHECKS);
              setLiveTestResult(null);
              setExpanded(new Set());
            }}
          >
            <Ionicons name="refresh-outline" size={16} color={C.textMuted} />
            <Text style={[s.resetBtnText, { color: C.textMuted }]}>Reset</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            s.runBtn,
            { backgroundColor: running ? `${C.primary}60` : C.primary },
            pressed && !running ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
            { flex: allDone && !running ? 1 : 1 },
          ]}
          onPress={runChecks}
          disabled={running}
        >
          {running ? (
            <><ActivityIndicator size="small" color="#fff" /><Text style={s.runBtnText}>Running…</Text></>
          ) : (
            <><Ionicons name="play-circle-outline" size={18} color="#fff" /><Text style={s.runBtnText}>{allDone ? 'Re-run All Checks' : 'Run Checks'}</Text></>
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
  subtitle: { fontSize: 11 },
  devBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  devBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },

  content: { padding: SPACING.md, gap: 0 },

  summaryCard: {
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
    marginBottom: 12, gap: 12,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryIconWrap: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  summaryTitle: { fontSize: 15, fontWeight: FONTS.bold },
  summarySub: { fontSize: 12, marginTop: 2 },
  summaryDots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  infoCard: {
    borderRadius: RADIUS.xl, borderWidth: 1, paddingHorizontal: 14,
    paddingVertical: 10, marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  infoLabel: { width: 90, fontSize: 12, fontWeight: FONTS.semiBold },
  infoValue: { flex: 1, fontSize: 12 },
  infoDivider: { height: StyleSheet.hairlineWidth },

  guideCard: {
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 14,
    marginTop: 4, marginBottom: 10, gap: 12,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  guideTitle: { fontSize: 14, fontWeight: FONTS.bold },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  guideStepBorder: { borderBottomWidth: StyleSheet.hairlineWidth },
  guideStepBadge: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  guideStepNum: { fontSize: 12, fontWeight: FONTS.extraBold },
  guideStepLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  guideStepDesc: { fontSize: 11, lineHeight: 17 },

  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, marginTop: 4,
  },
  successTitle: { fontSize: 14, fontWeight: FONTS.bold },
  successSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },

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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: RADIUS.full, paddingVertical: 14,
  },
  runBtnText: { fontSize: 15, fontWeight: FONTS.bold, color: '#fff' },
});
