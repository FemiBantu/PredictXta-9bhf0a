import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS, FONTS, RADIUS } from '@/constants/theme';
import { Prediction } from '@/services/types';
import { getConfidenceColor } from '@/services/predictionService';

interface PredictionBarProps {
  prediction: Prediction;
  homeTeam: string;
  awayTeam: string;
}

export default function PredictionBar({ prediction, homeTeam, awayTeam }: PredictionBarProps) {
  const homeAnim = useRef(new Animated.Value(0)).current;
  const drawAnim = useRef(new Animated.Value(0)).current;
  const awayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(homeAnim, { toValue: prediction.homeWinProb / 100, duration: 800, useNativeDriver: false }),
      Animated.timing(drawAnim, { toValue: prediction.drawProb / 100, duration: 800, useNativeDriver: false }),
      Animated.timing(awayAnim, { toValue: prediction.awayWinProb / 100, duration: 800, useNativeDriver: false }),
    ]).start();
  }, []);

  const confColor = getConfidenceColor(prediction.confidence);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>AI Win Probability</Text>
        <View style={[styles.confidenceBadge, { borderColor: confColor }]}>
          <Text style={[styles.confidenceText, { color: confColor }]}>{prediction.confidence}% Confidence</Text>
        </View>
      </View>

      {/* Home */}
      <ProbRow
        label={homeTeam}
        prob={prediction.homeWinProb}
        anim={homeAnim}
        color={COLORS.accentBlue}
        isHighest={prediction.predictedResult === 'home_win'}
      />

      {/* Draw - only for football */}
      {prediction.drawProb > 0 ? (
        <ProbRow
          label="Draw"
          prob={prediction.drawProb}
          anim={drawAnim}
          color={COLORS.textMuted}
          isHighest={prediction.predictedResult === 'draw'}
        />
      ) : null}

      {/* Away */}
      <ProbRow
        label={awayTeam}
        prob={prediction.awayWinProb}
        anim={awayAnim}
        color={COLORS.accentRed}
        isHighest={prediction.predictedResult === 'away_win'}
      />

      {/* Chips */}
      <View style={styles.chipsRow}>
        <ChipItem
          icon="⚽"
          label={`O/U ${prediction.overUnderLine}`}
          value={prediction.overUnder.toUpperCase()}
          color={prediction.overUnder === 'over' ? COLORS.accent : COLORS.accentRed}
        />
        <ChipItem
          icon="🎯"
          label="BTTS"
          value={prediction.btts.toUpperCase()}
          color={prediction.btts === 'yes' ? COLORS.accent : COLORS.accentRed}
        />
        <ChipItem
          icon="🏆"
          label="Result"
          value={prediction.predictedResult === 'home_win' ? '1' : prediction.predictedResult === 'draw' ? 'X' : '2'}
          color={COLORS.primary}
        />
      </View>
    </View>
  );
}

function ProbRow({ label, prob, anim, color, isHighest }: {
  label: string; prob: number; anim: Animated.Value; color: string; isHighest: boolean;
}) {
  return (
    <View style={styles.probRow}>
      <Text style={[styles.probLabel, isHighest ? { color: COLORS.textPrimary } : null]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            { backgroundColor: isHighest ? color : `${color}66`, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
      <Text style={[styles.probPct, isHighest ? { color } : null]}>{prob}%</Text>
    </View>
  );
}

function ChipItem({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipIcon}>{icon}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 14, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  confidenceBadge: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  confidenceText: { fontSize: 11, fontWeight: FONTS.bold },
  probRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  probLabel: { width: 90, fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: RADIUS.full },
  probPct: { width: 36, fontSize: 12, fontWeight: FONTS.bold, color: COLORS.textMuted, textAlign: 'right' },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  chipIcon: { fontSize: 16 },
  chipLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium, letterSpacing: 0.5 },
  chipValue: { fontSize: 13, fontWeight: FONTS.bold },
});
