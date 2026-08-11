/**
 * privacy-web.tsx — Live Privacy Policy WebView
 * Loads the hosted privacy policy URL for Play Store Data Safety compliance.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  ActivityIndicator, Share, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Production Privacy Policy URL ───────────────────────────────────────────
export const PRIVACY_POLICY_URL = 'https://predictxta.com/privacy';

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ progress, color }: { progress: number; color: string }) {
  if (progress >= 1) return null;
  return (
    <View style={pb.track}>
      <View style={[pb.fill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: color }]} />
    </View>
  );
}
const pb = StyleSheet.create({
  track: { height: 2, backgroundColor: 'transparent', overflow: 'hidden' },
  fill: { height: 2, borderRadius: 1 },
});

// ─── Error State ───────────────────────────────────────────────────────────────
function ErrorState({ url, onRetry, C }: { url: string; onRetry: () => void; C: any }) {
  const openInBrowser = () => Linking.openURL(url).catch(() => {});
  return (
    <View style={[es.wrap, { backgroundColor: C.bg }]}>
      <View style={[es.iconWrap, { backgroundColor: `${C.accentBlue}12`, borderColor: `${C.accentBlue}33` }]}>
        <Ionicons name="cloud-offline-outline" size={36} color={C.accentBlue} />
      </View>
      <Text style={[es.title, { color: C.textPrimary }]}>Could not load page</Text>
      <Text style={[es.body, { color: C.textMuted }]}>
        Check your internet connection and try again, or open the page in your browser.
      </Text>
      <View style={es.actions}>
        <Pressable
          style={({ pressed }) => [es.btn, { backgroundColor: C.primary }, pressed ? { opacity: 0.85 } : null]}
          onPress={onRetry}
        >
          <Ionicons name="refresh" size={15} color="#000" />
          <Text style={[es.btnText, { color: '#000' }]}>Retry</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [es.btn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }, pressed ? { opacity: 0.85 } : null]}
          onPress={openInBrowser}
        >
          <Ionicons name="open-outline" size={15} color={C.textPrimary} />
          <Text style={[es.btnText, { color: C.textPrimary }]}>Open in Browser</Text>
        </Pressable>
      </View>
    </View>
  );
}
const es = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  iconWrap: { width: 80, height: 80, borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  body: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.full, paddingHorizontal: 18, paddingVertical: 11 },
  btnText: { fontSize: 13, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PrivacyWebScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const webRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(PRIVACY_POLICY_URL);
  const [retryKey, setRetryKey] = useState(0);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `PredictXta Privacy Policy — ${PRIVACY_POLICY_URL}`,
        url: PRIVACY_POLICY_URL,
        title: 'PredictXta Privacy Policy',
      });
    } catch { /* ignore */ }
  }, []);

  const handleOpenBrowser = useCallback(() => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  }, []);

  const handleRetry = useCallback(() => {
    setHasError(false);
    setLoading(true);
    setRetryKey(k => k + 1);
  }, []);

  const handleBack = useCallback(() => {
    if (canGoBack && webRef.current) {
      webRef.current.goBack();
    } else {
      router.back();
    }
  }, [canGoBack, router]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={handleBack} hitSlop={8} style={s.headerBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>

          <View style={s.headerCenter}>
            <View style={[s.lockBadge, { backgroundColor: `${C.accentBlue}14`, borderColor: `${C.accentBlue}33` }]}>
              <Ionicons name="lock-closed" size={10} color={C.accentBlue} />
              <Text style={[s.lockText, { color: C.accentBlue }]}>predictxta.com</Text>
            </View>
            <Text style={[s.headerTitle, { color: C.textPrimary }]} numberOfLines={1}>Privacy Policy</Text>
          </View>

          <View style={s.headerActions}>
            <Pressable onPress={handleShare} hitSlop={8} style={[s.headerBtn, { marginRight: 2 }]}>
              <Ionicons name="share-outline" size={20} color={C.textPrimary} />
            </Pressable>
            <Pressable onPress={handleOpenBrowser} hitSlop={8} style={s.headerBtn}>
              <Ionicons name="open-outline" size={19} color={C.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Progress bar */}
        <ProgressBar progress={progress} color={C.accentBlue} />
      </SafeAreaView>

      {/* URL bar */}
      <View style={[s.urlBar, { backgroundColor: C.card, borderBottomColor: C.border }]}>
        <Ionicons name="shield-checkmark" size={12} color={C.accentBlue} />
        <Text style={[s.urlText, { color: C.textMuted }]} numberOfLines={1}>{currentUrl}</Text>
        {loading ? <ActivityIndicator size="small" color={C.accentBlue} style={{ marginLeft: 4 }} /> : null}
      </View>

      {/* WebView */}
      {hasError ? (
        <ErrorState url={PRIVACY_POLICY_URL} onRetry={handleRetry} C={C} />
      ) : (
        <WebView
          key={retryKey}
          ref={webRef}
          source={{ uri: PRIVACY_POLICY_URL }}
          style={s.webview}
          onLoadStart={() => { setLoading(true); setHasError(false); }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setHasError(true); }}
          onHttpError={() => { setLoading(false); setHasError(true); }}
          onNavigationStateChange={(state) => {
            setCanGoBack(state.canGoBack);
            setCurrentUrl(state.url);
          }}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
          allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
          userAgent="PredictXta/1.0 (Mobile; Privacy)"
          renderLoading={() => (
            <View style={[s.loadingOverlay, { backgroundColor: C.bg }]}>
              <ActivityIndicator size="large" color={C.accentBlue} />
              <Text style={[s.loadingText, { color: C.textMuted }]}>Loading privacy policy…</Text>
            </View>
          )}
        />
      )}

      {/* Play Store compliance footer */}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.surface }}>
        <View style={[s.footer, { backgroundColor: C.surface, borderTopColor: C.border }]}>
          <Ionicons name="document-text-outline" size={13} color={C.textMuted} />
          <Text style={[s.footerText, { color: C.textMuted }]}>
            This policy is required for Play Store Data Safety compliance
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 13, fontWeight: FONTS.semiBold },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockText: { fontSize: 10, fontWeight: FONTS.semiBold },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  urlText: { flex: 1, fontSize: 11 },
  webview: { flex: 1 },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 13 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  footerText: { fontSize: 11, flex: 1, lineHeight: 16 },
});
