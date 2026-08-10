/**
 * DisclaimerBanner — AI Predictions Entertainment Disclaimer
 *
 * Shown on AI Picks screens and individual prediction views.
 * Required for App Store / Play Store compliance for gambling-adjacent content.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

interface DisclaimerBannerProps {
  /** Compact 1-line version for tight spaces */
  compact?: boolean;
  /** Allow user to dismiss the banner */
  dismissible?: boolean;
}

export function DisclaimerBanner({ compact = false, dismissible = true }: DisclaimerBannerProps) {
  const { colors: C } = useTheme();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (compact) {
    return (
      <View style={[s.compact, { backgroundColor: `${C.textMuted}10`, borderColor: `${C.textMuted}25` }]}>
        <Ionicons name="information-circle-outline" size={12} color={C.textMuted} />
        <Text style={[s.compactText, { color: C.textMuted }]}>
          For entertainment only — not betting advice.
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.banner, { backgroundColor: `${C.textMuted}08`, borderColor: `${C.textMuted}20` }]}>
      <View style={s.iconRow}>
        <View style={[s.iconWrap, { backgroundColor: `${C.textMuted}15` }]}>
          <Ionicons name="shield-checkmark-outline" size={16} color={C.textMuted} />
        </View>
        <Text style={[s.title, { color: C.textSecondary }]}>Responsible Use</Text>
        {dismissible ? (
          <Pressable onPress={() => setDismissed(true)} hitSlop={8} style={s.closeBtn}>
            <Ionicons name="close" size={14} color={C.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[s.body, { color: C.textMuted }]}>
        PredictXta AI predictions are generated for{' '}
        <Text style={{ fontWeight: FONTS.bold }}>entertainment and informational purposes only</Text>.
        They do not constitute financial, betting, or wagering advice.
        {Platform.OS !== 'web' ? ' Please gamble responsibly.' : ''}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    marginHorizontal: SPACING.md,
    marginVertical: 6,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: FONTS.bold,
    letterSpacing: 0.2,
  },
  closeBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontSize: 11,
    lineHeight: 16,
  },
  // Compact variant
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'center',
  },
  compactText: {
    fontSize: 10,
    fontWeight: FONTS.medium,
  },
});
