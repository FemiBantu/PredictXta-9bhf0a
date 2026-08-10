import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, FONTS, SPACING } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  secureToggle?: boolean;
}

export default function Input({ label, error, icon, secureToggle, ...props }: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isSecure = secureToggle && !showPassword;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputWrap, error ? styles.inputError : null]}>
        {icon ? (
          <Ionicons name={icon} size={18} color={COLORS.textMuted} style={styles.icon} />
        ) : null}
        <TextInput
          {...props}
          secureTextEntry={isSecure}
          placeholderTextColor={COLORS.textMuted}
          style={[styles.input, props.style]}
        />
        {secureToggle ? (
          <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={COLORS.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  label: {
    fontSize: 13,
    fontWeight: FONTS.medium,
    color: COLORS.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  inputError: { borderColor: COLORS.accentRed },
  icon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    includeFontPadding: false,
  },
  errorText: {
    fontSize: 12,
    color: COLORS.accentRed,
    marginTop: 4,
    marginLeft: 2,
  },
});
