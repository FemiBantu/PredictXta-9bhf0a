/**
 * components/ui/SportBadge.tsx
 *
 * Reusable clickable sport badge/chip.
 * Tapping it navigates to /sports/{sportKey}.
 *
 * Usage:
 *   <SportBadge sport="football" />
 *   <SportBadge sport="Basketball" label="🏀 Basketball" size="sm" />
 *   <SportBadge sport="mma" variant="pill" />
 */

import React from 'react';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FONTS, RADIUS, getSportIcon, normalizeSportName } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';

// Per-sport accent map (mirrors the one in the sport page)
const SPORT_ACCENTS: Record<string, string> = {
  football:          '#6EDC1F',
  basketball:        '#F97316',
  tennis:            '#FBBF24',
  baseball:          '#C084FC',
  hockey:            '#38BDF8',
  rugby:             '#34D399',
  handball:          '#FB923C',
  volleyball:        '#60A5FA',
  'american-football': '#F87171',
  cricket:           '#A78BFA',
  mma:               '#F43F5E',
  boxing:            '#EF4444',
  formula1:          '#E11D48',
  motorsports:       '#EF4444',
  esports:           '#8B5CF6',
  'table-tennis':    '#FCD34D',
  badminton:         '#6EE7B7',
  snooker:           '#10B981',
  darts:             '#F59E0B',
  cycling:           '#22D3EE',
  athletics:         '#FB7185',
  default:           '#6EDC1F',
};

function getSportAccent(sportKey: string): string {
  return SPORT_ACCENTS[sportKey] ?? SPORT_ACCENTS.default;
}

type BadgeVariant = 'chip' | 'pill' | 'icon-only' | 'text-only';
type BadgeSize    = 'sm' | 'md' | 'lg';

interface SportBadgeProps {
  /** Sport name or key, e.g. "Football", "basketball", "mma" */
  sport: string;
  /** Override display label; defaults to normalized name */
  label?: string;
  /** Badge variant */
  variant?: BadgeVariant;
  /** Size preset */
  size?: BadgeSize;
  /** Disable navigation (render as non-interactive display) */
  disabled?: boolean;
  /** Extra wrapper style */
  style?: any;
  /** Callback after press (in addition to navigation) */
  onPress?: () => void;
}

export function SportBadge({
  sport,
  label,
  variant = 'chip',
  size = 'md',
  disabled = false,
  style,
  onPress: onPressProp,
}: SportBadgeProps) {
  const router = useRouter();
  const { colors: C } = useTheme();

  // Normalise to URL-safe key
  const sportKey = sport.toLowerCase().replace(/\s+/g, '-');
  const displayName = label ?? normalizeSportName(sportKey);
  const icon = getSportIcon(sportKey);
  const accent = getSportAccent(sportKey);

  const handlePress = () => {
    if (disabled) return;
    onPressProp?.();
    router.push({ pathname: '/sports/[sport]', params: { sport: sportKey } } as any);
  };

  // ── Sizing presets ────────────────────────────────────────────────────────
  const fontSize    = size === 'sm' ? 10 : size === 'lg' ? 14 : 12;
  const iconSize    = size === 'sm' ? 13 : size === 'lg' ? 18 : 15;
  const padH        = size === 'sm' ? 7 : size === 'lg' ? 14 : 10;
  const padV        = size === 'sm' ? 3 : size === 'lg' ? 8 : 5;
  const borderRadius = variant === 'pill' ? RADIUS.full : RADIUS.md;

  if (variant === 'icon-only') {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityLabel={`View ${displayName} sports page`}
        accessibilityRole="button"
        style={({ pressed }) => [
          {
            width: size === 'sm' ? 28 : size === 'lg' ? 44 : 36,
            height: size === 'sm' ? 28 : size === 'lg' ? 44 : 36,
            borderRadius: size === 'sm' ? 14 : size === 'lg' ? 22 : 18,
            backgroundColor: `${accent}18`,
            borderWidth: 1,
            borderColor: `${accent}35`,
            alignItems: 'center',
            justifyContent: 'center',
          },
          pressed && !disabled ? { opacity: 0.7, transform: [{ scale: 0.93 }] } : null,
          style,
        ]}
        disabled={disabled}
      >
        <Text style={{ fontSize: iconSize }}>{icon}</Text>
      </Pressable>
    );
  }

  if (variant === 'text-only') {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityLabel={`View ${displayName} sports page`}
        accessibilityRole="link"
        style={({ pressed }) => [
          { paddingVertical: 2 },
          pressed && !disabled ? { opacity: 0.6 } : null,
          style,
        ]}
        disabled={disabled}
      >
        <Text style={[
          { fontSize, fontWeight: FONTS.semiBold, color: accent, textDecorationLine: 'underline' },
        ]}>
          {icon} {displayName}
        </Text>
      </Pressable>
    );
  }

  // chip / pill
  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={`View ${displayName} sports page`}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: 5,
          paddingHorizontal: padH,
          paddingVertical: padV,
          borderRadius,
          backgroundColor: `${accent}14`,
          borderWidth: 1,
          borderColor: `${accent}35`,
        },
        pressed && !disabled ? { opacity: 0.75, transform: [{ scale: 0.97 }] } : null,
        style,
      ]}
      disabled={disabled}
    >
      <Text style={{ fontSize: iconSize, lineHeight: iconSize + 4 }}>{icon}</Text>
      {variant !== 'icon-only' ? (
        <Text style={{ fontSize, fontWeight: FONTS.semiBold, color: accent }}>
          {displayName}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default SportBadge;
