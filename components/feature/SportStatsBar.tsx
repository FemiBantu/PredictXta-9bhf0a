import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Match, BasketballStats, TennisStats } from '@/services/types';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';

interface Props {
  match: Match;
}

/**
 * Renders sport-specific inline stats under a match score:
 * - Basketball: Q1 Q2 Q3 Q4 OT quarter scores
 * - Tennis: Set circles (filled = won)
 * - Football: nothing extra (minute already shown)
 */
export default function SportStatsBar({ match }: Props) {
  const sport = match.sport?.toLowerCase();

  if (sport === 'basketball' && match.stats) {
    return <BasketballQuarters match={match} />;
  }

  if (sport === 'tennis' && match.stats) {
    return <TennisSets match={match} />;
  }

  return null;
}

// ─── Basketball quarters ─────────────────────────────────────────────────────
function BasketballQuarters({ match }: { match: Match }) {
  const s = match.stats as BasketballStats;
  const quarters = [
    { label: 'Q1', home: s.home_q1, away: s.away_q1 },
    { label: 'Q2', home: s.home_q2, away: s.away_q2 },
    { label: 'Q3', home: s.home_q3, away: s.away_q3 },
    { label: 'Q4', home: s.home_q4, away: s.away_q4 },
  ];
  const hasOT = s.home_ot != null || s.away_ot != null;
  if (hasOT) quarters.push({ label: 'OT', home: s.home_ot ?? null, away: s.away_ot ?? null });

  const played = quarters.filter((q) => q.home != null);
  if (played.length === 0) return null;

  return (
    <View style={bStyles.container}>
      {/* Header */}
      <View style={bStyles.row}>
        <View style={bStyles.teamCol} />
        {played.map((q) => (
          <Text key={q.label} style={bStyles.qHeader}>{q.label}</Text>
        ))}
      </View>
      {/* Home row */}
      <View style={bStyles.row}>
        <Text style={bStyles.teamLabel} numberOfLines={1}>{abbrev(match.homeTeam)}</Text>
        {played.map((q) => (
          <Text
            key={`h-${q.label}`}
            style={[bStyles.qScore, isHigher(q.home, q.away) ? bStyles.qWinner : null]}
          >
            {q.home ?? '-'}
          </Text>
        ))}
      </View>
      {/* Away row */}
      <View style={bStyles.row}>
        <Text style={bStyles.teamLabel} numberOfLines={1}>{abbrev(match.awayTeam)}</Text>
        {played.map((q) => (
          <Text
            key={`a-${q.label}`}
            style={[bStyles.qScore, isHigher(q.away, q.home) ? bStyles.qWinner : null]}
          >
            {q.away ?? '-'}
          </Text>
        ))}
      </View>
    </View>
  );
}

function isHigher(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && a > b;
}

function abbrev(name: string, max = 10): string {
  return name.length > max ? name.slice(0, max - 1) + '.' : name;
}

const bStyles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    gap: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  teamCol: { width: 70 },
  teamLabel: { width: 70, fontSize: 11, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  qHeader: { flex: 1, textAlign: 'center', fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.bold },
  qScore: { flex: 1, textAlign: 'center', fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  qWinner: { color: COLORS.primary, fontWeight: FONTS.bold },
});

// ─── Tennis sets ─────────────────────────────────────────────────────────────
function TennisSets({ match }: { match: Match }) {
  const s = match.stats as TennisStats;
  const homeSets = s.home_sets ?? match.homeScore ?? 0;
  const awaySets = s.away_sets ?? match.awayScore ?? 0;
  const totalSets = homeSets + awaySets;

  // Max possible sets for rendering (best-of-5 for grand slams)
  const maxSets = Math.max(5, totalSets);

  return (
    <View style={tStyles.container}>
      <View style={tStyles.row}>
        <Text style={tStyles.label} numberOfLines={1}>{abbrev(match.homeTeam, 12)}</Text>
        <View style={tStyles.sets}>
          {Array.from({ length: maxSets }).map((_, i) => (
            <View
              key={i}
              style={[tStyles.circle, i < homeSets ? tStyles.circleWon : tStyles.circleLost]}
            >
              {i < homeSets ? <Text style={tStyles.setCheck}>✓</Text> : null}
            </View>
          ))}
        </View>
        <Text style={tStyles.count}>{homeSets}</Text>
      </View>
      <View style={tStyles.row}>
        <Text style={tStyles.label} numberOfLines={1}>{abbrev(match.awayTeam, 12)}</Text>
        <View style={tStyles.sets}>
          {Array.from({ length: maxSets }).map((_, i) => (
            <View
              key={i}
              style={[tStyles.circle, i < awaySets ? tStyles.circleWon : tStyles.circleLost]}
            >
              {i < awaySets ? <Text style={tStyles.setCheck}>✓</Text> : null}
            </View>
          ))}
        </View>
        <Text style={tStyles.count}>{awaySets}</Text>
      </View>
    </View>
  );
}

const tStyles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { width: 90, fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.medium },
  sets: { flex: 1, flexDirection: 'row', gap: 4 },
  circle: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  circleWon: { backgroundColor: COLORS.primaryGlow, borderColor: COLORS.primary },
  circleLost: { backgroundColor: 'transparent', borderColor: COLORS.border },
  setCheck: { fontSize: 9, color: COLORS.primary, fontWeight: FONTS.bold },
  count: { width: 18, textAlign: 'right', fontSize: 14, color: COLORS.textPrimary, fontWeight: FONTS.bold },
});
