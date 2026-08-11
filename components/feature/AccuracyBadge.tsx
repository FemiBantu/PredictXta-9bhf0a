/**
 * AccuracyBadge — Compact verified-accuracy pill
 * Shows platform accuracy from resolved prediction outcomes.
 * Used in the AI Picks page header and the Home page stats banner.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS } from '@/constants/theme';
import {
  fetchPlatformAccuracy,
  getAccuracyColor,
  type PlatformAccuracyStats,
} from '@/services/accuracyService';

interface AccuracyBadgeProps {
  /** If true shows a pill badge — compact mode for headers */
  compact?: boolean;
  /** If true renders the full stats mini-card */
  expanded?: boolean;
  onPress?: () => void;
}

export function AccuracyBadge({ compact = true, expanded = false, onPress }: AccuracyBadgeProps) {
  const { colors: C } = useTheme();
  const [stats, setStats] = useState<PlatformAccuracyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlatformAccuracy()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={[styles.pill, { backgroundColor: C.card, borderColor: C.border }]}>
        <ActivityIndicator size={10} color={C.textMuted} />
      </View>
    );
  }

  if (!stats || stats.overall.total < 5) return null;

  const acc = stats.overall.accuracyPct;
  const color = getAccuracyColor(acc);
  const trend7 = stats.recentTrend.last7d.pct;
  const trendDir = trend7 >= acc + 2 ? 'up' : trend7 <= acc - 2 ? 'down' : 'neutral';
  const trendIcon = trendDir === 'up' ? 'trending-up' : trendDir === 'down' ? 'trending-down' : 'remove';
  const trendColor = trendDir === 'up' ? '#6EDC1F' : trendDir === 'down' ? '#EF4444' : C.textMuted;

  if (compact) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: `${color}12`, borderColor: `${color}33` },
          pressed ? { opacity: 0.75 } : null,
        ]}
        onPress={onPress}
        hitSlop={6}
      >
        <Ionicons name="shield-checkmark" size={10} color={color} />
        <Text style={[styles.pillText, { color }]}>{acc}% verified</Text>
        <Text style={[styles.pillTotal, { color: C.textMuted }]}>({stats.overall.total})</Text>
      </Pressable>
    );
  }

  if (expanded) {
    return (
      <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.cardIcon, { backgroundColor: `${color}14`, borderColor: `${color}33` }]}>
            <FontAwesome5 name="brain" size={12} color={color} />
          </View>
          <Text style={[styles.cardTitle, { color: C.textPrimary }]}>AI Accuracy</Text>
          <View style={[styles.trendPill, { backgroundColor: `${trendColor}14`, borderColor: `${trendColor}33` }]}>
            <Ionicons name={trendIcon as any} size={10} color={trendColor} />
            <Text style={[styles.trendText, { color: trendColor }]}>{trend7}% 7d</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <MetricCell value={`${acc}%`} label="Overall" color={color} C={C} />
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <MetricCell value={`${stats.overall.correct}`} label="Correct" color={C.primary} C={C} />
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <MetricCell value={`${stats.overall.total}`} label="Resolved" color={C.textSecondary} C={C} />
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <MetricCell value={`${stats.byRisk.low.pct}%`} label="Low Risk" color="#6EDC1F" C={C} />
        </View>

        <View style={[styles.calibBar, { backgroundColor: C.surface }]}>
          <View style={[styles.calibFill, { width: `${Math.min(100, acc)}%` as any, backgroundColor: color }]} />
        </View>

        <View style={styles.cardFooter}>
          <Ionicons name="checkmark-circle-outline" size={10} color={C.textMuted} />
          <Text style={[styles.footerText, { color: C.textMuted }]}>
            Calibration drift: {stats.overall.calibrationDrift.toFixed(1)}%
          </Text>
          <Text style={[styles.footerText, { color: C.textMuted }]}>·</Text>
          <Text style={[styles.footerText, { color: C.textMuted }]}>
            Conf avg: {stats.overall.avgConfidence}%
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

function MetricCell({ value, label, color, C }: { value: string; label: string; color: string; C: any }) {
  return (
    <View style={styles.metricCell}>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={[styles.metricLbl, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  pillText: { fontSize: 10, fontWeight: FONTS.bold },
  pillTotal: { fontSize: 9 },
  card: {
    borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 14, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon: {
    width: 26, height: 26, borderRadius: 7, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 13, fontWeight: FONTS.bold, flex: 1 },
  trendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  trendText: { fontSize: 9, fontWeight: FONTS.bold },
  metricsRow: { flexDirection: 'row', alignItems: 'center' },
  metricCell: { flex: 1, alignItems: 'center', gap: 2 },
  metricVal: { fontSize: 17, fontWeight: FONTS.extraBold },
  metricLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.4 },
  divider: { width: 1, height: 28 },
  calibBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  calibFill: { height: '100%', borderRadius: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 9 },
});
