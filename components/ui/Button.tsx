import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { COLORS, RADIUS, FONTS, SHADOW } from '@/constants/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export default function Button({
  label, onPress, variant = 'primary', size = 'md',
  loading, disabled, style, textStyle, fullWidth,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[`size_${size}` as keyof typeof styles],
        fullWidth ? styles.fullWidth : null,
        pressed ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        variant === 'primary' ? SHADOW.primary : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? COLORS.textInverse : COLORS.primary} />
      ) : (
        <Text style={[styles.label, styles[`label_${variant}` as keyof typeof styles], styles[`labelSize_${size}` as keyof typeof styles], textStyle]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primary: { backgroundColor: COLORS.primary },
  secondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: COLORS.accentRed },
  accent: { backgroundColor: COLORS.accent },
  size_sm: { paddingVertical: 8, paddingHorizontal: 16, minHeight: 36 },
  size_md: { paddingVertical: 12, paddingHorizontal: 24, minHeight: 44 },
  size_lg: { paddingVertical: 16, paddingHorizontal: 32, minHeight: 54 },
  fullWidth: { width: '100%' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
  label: { fontWeight: FONTS.bold, letterSpacing: 0.3 },
  label_primary: { color: COLORS.textInverse },
  label_secondary: { color: COLORS.textPrimary },
  label_ghost: { color: COLORS.primary },
  label_danger: { color: COLORS.textPrimary },
  label_accent: { color: COLORS.textInverse },
  labelSize_sm: { fontSize: 13 },
  labelSize_md: { fontSize: 15 },
  labelSize_lg: { fontSize: 17 },
});
