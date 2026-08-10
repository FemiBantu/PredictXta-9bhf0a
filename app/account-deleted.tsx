/**
 * Account Deleted — shown after successful account deletion.
 * Provides a clean confirmation screen before the user returns to login.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

export default function AccountDeletedScreen() {
  const router = useRouter();
  const scaleAnim = useRef(new Animated.Value(0.4)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 8,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <Animated.View style={[styles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark-circle" size={72} color="#6EDC1F" />
        </View>

        {/* Title */}
        <Text style={styles.title}>Account Deleted</Text>
        <Text style={styles.body}>
          Your account and all associated data have been permanently deleted. We are sorry to see you go.
        </Text>

        {/* Info chips */}
        <View style={styles.chips}>
          {[
            { icon: 'shield-checkmark-outline', label: 'Data permanently removed' },
            { icon: 'lock-closed-outline', label: 'Sessions invalidated' },
            { icon: 'person-remove-outline', label: 'Profile deleted' },
          ].map((item) => (
            <View key={item.label} style={styles.chip}>
              <Ionicons name={item.icon as any} size={14} color="#6EDC1F" />
              <Text style={styles.chipText}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [styles.btn, pressed ? { opacity: 0.85 } : null]}
          onPress={() => router.replace('/login' as any)}
        >
          <Text style={styles.btnText}>Return to Login</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    gap: 16,
    maxWidth: 380,
    width: '100%',
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(110,220,31,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(110,220,31,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: FONTS.extraBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#8B9BB4',
    textAlign: 'center',
    lineHeight: 22,
  },
  chips: {
    gap: 8,
    width: '100%',
    marginVertical: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(110,220,31,0.08)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(110,220,31,0.2)',
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  chipText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: FONTS.medium,
  },
  btn: {
    backgroundColor: '#6EDC1F',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: {
    fontSize: 15,
    fontWeight: FONTS.bold,
    color: '#070B14',
  },
});
