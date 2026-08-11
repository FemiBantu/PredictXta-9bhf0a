import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, RADIUS, FONTS } from '@/constants/theme';

type BadgeVariant = 'live' | 'primary' | 'accent' | 'red' | 'blue' | 'purple' | 'muted' | 'vip';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export default function Badge({ label, variant = 'primary', size = 'sm', dot }: BadgeProps) {
  return (
    <View style={[styles.base, styles[variant], size === 'md' ? styles.md : styles.sm]}>
      {dot ? <View style={[styles.dot, { backgroundColor: variantTextColor[variant] }]} /> : null}
      <Text style={[styles.text, { color: variantTextColor[variant] }, size === 'md' ? styles.textMd : styles.textSm]}>
        {label}
      </Text>
    </View>
  );
}

const variantTextColor: Record<BadgeVariant, string> = {
  live: '#00FF87',
  primary: '#FFD700',
  accent: '#00FF87',
  red: '#FF4757',
  blue: '#4ECDC4',
  purple: '#A855F7',
  muted: '#8B9BB4',
  vip: '#FFD700',
};

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  sm: { paddingHorizontal: 8, paddingVertical: 3 },
  md: { paddingHorizontal: 12, paddingVertical: 5 },
  live: { backgroundColor: 'rgba(0, 255, 135, 0.12)', borderColor: 'rgba(0, 255, 135, 0.3)' },
  primary: { backgroundColor: 'rgba(255, 215, 0, 0.12)', borderColor: 'rgba(255, 215, 0, 0.3)' },
  accent: { backgroundColor: 'rgba(0, 255, 135, 0.12)', borderColor: 'rgba(0, 255, 135, 0.3)' },
  red: { backgroundColor: 'rgba(255, 71, 87, 0.12)', borderColor: 'rgba(255, 71, 87, 0.3)' },
  blue: { backgroundColor: 'rgba(78, 205, 196, 0.12)', borderColor: 'rgba(78, 205, 196, 0.3)' },
  purple: { backgroundColor: 'rgba(168, 85, 247, 0.12)', borderColor: 'rgba(168, 85, 247, 0.3)' },
  muted: { backgroundColor: 'rgba(139, 155, 180, 0.1)', borderColor: 'rgba(139, 155, 180, 0.2)' },
  vip: { backgroundColor: 'rgba(255, 215, 0, 0.15)', borderColor: 'rgba(255, 215, 0, 0.4)' },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  text: { fontWeight: FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  textSm: { fontSize: 9 },
  textMd: { fontSize: 11 },
});
