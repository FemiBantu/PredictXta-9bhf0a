import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADIUS, SHADOW } from '@/constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  highlighted?: boolean;
  noPadding?: boolean;
}

export default function GlassCard({ children, style, highlighted, noPadding }: GlassCardProps) {
  return (
    <View
      style={[
        styles.card,
        highlighted ? styles.highlighted : null,
        noPadding ? styles.noPadding : null,
        ...(Array.isArray(style) ? style : style ? [style] : []),
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.md,
  },
  highlighted: {
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.cardHighlight,
  },
  noPadding: {
    padding: 0,
  },
});
