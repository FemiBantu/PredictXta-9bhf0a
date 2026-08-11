/**
 * ScreenshotFrame.tsx
 * Phone frame overlay component for Play Store / App Store screenshot preparation.
 *
 * Usage:
 *   <ScreenshotFrame label="AI Picks" badge="NEW">
 *     {children}
 *   </ScreenshotFrame>
 *
 * Render this wrapper around any screen content, then capture via
 * react-native-view-shot or Expo's captureRef() to produce store-ready images.
 */

import React from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// Standard Play Store phone screenshot: 1080×1920 (portrait)
const FRAME_W = 390; // logical display width
const FRAME_H = 844; // logical display height (iPhone 14 Pro size)

const BRAND = {
  bg: '#070B14',
  surface: '#0D1526',
  card: '#131E35',
  border: 'rgba(255,215,0,0.15)',
  primary: '#FFD700',
  text: '#FFFFFF',
  textMuted: '#8090B0',
  accent: '#6EDC1F',
  accentBlue: '#3B82F6',
};

interface ScreenshotFrameProps {
  /** Screen label shown in the bottom caption strip */
  label?: string;
  /** Optional badge text (e.g. "AI POWERED", "LIVE") */
  badge?: string;
  /** Badge color (defaults to primary gold) */
  badgeColor?: string;
  /** Hide the top status bar simulation */
  hideStatusBar?: boolean;
  /** Hide the bottom caption strip */
  hideCaption?: boolean;
  /** Content to render inside the frame */
  children?: React.ReactNode;
  /** Override frame width */
  width?: number;
  /** Override frame height */
  height?: number;
}

/** Simulated status bar for the frame */
function FakeStatusBar() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  return (
    <View style={sb.row}>
      <Text style={sb.time}>{h}:{m}</Text>
      <View style={sb.icons}>
        <Ionicons name="cellular" size={12} color={BRAND.text} />
        <Ionicons name="wifi" size={12} color={BRAND.text} />
        <Ionicons name="battery-full" size={14} color={BRAND.text} />
      </View>
    </View>
  );
}
const sb = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: BRAND.bg,
  },
  time: { fontSize: 13, fontWeight: FONTS.bold, color: BRAND.text },
  icons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

/** Bottom caption strip */
function Caption({ label, badge, badgeColor }: { label?: string; badge?: string; badgeColor?: string }) {
  const bc = badgeColor ?? BRAND.primary;
  return (
    <LinearGradient
      colors={['rgba(7,11,20,0)', 'rgba(7,11,20,0.96)', '#070B14']}
      style={cap.gradient}
    >
      <View style={cap.inner}>
        {/* Logo */}
        <View style={cap.logoRow}>
          <View style={cap.logoBox}>
            <Image
              source={require('@/assets/logo.png')}
              style={cap.logoImg}
              contentFit="contain"
            />
          </View>
          <View>
            <Text style={cap.appName}>PredictXta</Text>
            <Text style={cap.tagline}>AI-Powered Sports Predictions</Text>
          </View>
        </View>

        {/* Screen label + badge */}
        <View style={cap.labelRow}>
          {label ? (
            <Text style={cap.label}>{label}</Text>
          ) : null}
          {badge ? (
            <View style={[cap.badge, { backgroundColor: `${bc}22`, borderColor: `${bc}55` }]}>
              <Text style={[cap.badgeText, { color: bc }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </LinearGradient>
  );
}
const cap = StyleSheet.create({
  gradient: { paddingTop: 40, paddingBottom: 24, paddingHorizontal: 20 },
  inner: { gap: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: {
    width: 36, height: 36, borderRadius: 9,
    overflow: 'hidden', borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
    backgroundColor: '#0D1526',
  },
  logoImg: { width: '100%', height: '100%' },
  appName: { fontSize: 16, fontWeight: FONTS.extraBold, color: BRAND.text },
  tagline: { fontSize: 10, color: BRAND.textMuted, fontWeight: FONTS.medium },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 22, fontWeight: FONTS.extraBold, color: BRAND.text, flex: 1 },
  badge: {
    borderWidth: 1, borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
});

/** Phone notch/dynamic island simulation */
function DynamicIsland() {
  return (
    <View style={di.root}>
      <View style={di.pill} />
    </View>
  );
}
const di = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 4 },
  pill: {
    width: 120, height: 34,
    backgroundColor: '#000',
    borderRadius: 20,
  },
});

/** Phone outer shell / bezel */
function PhoneBezel({ children, width, height }: { children: React.ReactNode; width: number; height: number }) {
  return (
    <View style={[bezel.outer, { width: width + 16, height: height + 16, borderRadius: 52 }]}>
      <View style={[bezel.inner, { width, height, borderRadius: 44 }]}>
        {children}
      </View>
      {/* Side buttons */}
      <View style={[bezel.btn, bezel.btnLeft, { top: height * 0.3 }]} />
      <View style={[bezel.btn, bezel.btnLeft, { top: height * 0.4 }]} />
      <View style={[bezel.btn, bezel.btnRight, { top: height * 0.35 }]} />
    </View>
  );
}
const bezel = StyleSheet.create({
  outer: {
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 24,
  },
  inner: {
    overflow: 'hidden',
    backgroundColor: BRAND.bg,
  },
  btn: {
    position: 'absolute',
    width: 4,
    height: 44,
    backgroundColor: '#2A2A2A',
    borderRadius: 2,
  },
  btnLeft: { left: -2 },
  btnRight: { right: -2 },
});

// ─── Main ScreenshotFrame component ──────────────────────────────────────────
export function ScreenshotFrame({
  label,
  badge,
  badgeColor,
  hideStatusBar = false,
  hideCaption = false,
  children,
  width = FRAME_W,
  height = FRAME_H,
}: ScreenshotFrameProps) {
  // Only useful in dev / screenshot capture environments
  if (!__DEV__ && Platform.OS !== 'web') return <>{children}</>;

  return (
    <View style={[frame.root, { width, height }]}>
      {/* Background gradient */}
      <LinearGradient
        colors={[BRAND.bg, '#0D1526', BRAND.bg]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      {/* Phone frame with content */}
      <PhoneBezel width={width - 32} height={height - 32}>
        {/* Dynamic Island */}
        <DynamicIsland />

        {/* Status bar */}
        {!hideStatusBar ? <FakeStatusBar /> : null}

        {/* Screen content */}
        <View style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </View>

        {/* Caption overlay */}
        {!hideCaption ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={{ flex: 1 }} />
            <Caption label={label} badge={badge} badgeColor={badgeColor} />
          </View>
        ) : null}
      </PhoneBezel>

      {/* Watermark strip */}
      <View style={frame.watermark}>
        <Text style={frame.watermarkText}>predictxta.app</Text>
      </View>
    </View>
  );
}

/** Quick-use preset variants */
export const ScreenshotPresets = {
  AIPicks:    { label: 'AI Predictions',   badge: 'AI POWERED',  badgeColor: '#FFD700' },
  LiveScores: { label: 'Live Scores',       badge: 'LIVE',        badgeColor: '#EF4444' },
  Challenge:  { label: 'Daily Challenge',   badge: 'WIN COINS',   badgeColor: '#10B981' },
  Trends:     { label: 'Trends & Insights', badge: 'HOT',         badgeColor: '#F59E0B' },
  Chat:       { label: 'Fan Chat',          badge: 'COMMUNITY',   badgeColor: '#3B82F6' },
  ExpertPicks:{ label: 'Expert Tips',       badge: 'VIP',         badgeColor: '#8B5CF6' },
} as const;

const frame = StyleSheet.create({
  root: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermark: {
    position: 'absolute',
    bottom: 8,
    right: 12,
  },
  watermarkText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: FONTS.medium,
    letterSpacing: 0.5,
  },
});
