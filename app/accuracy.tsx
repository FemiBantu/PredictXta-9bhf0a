/**
 * app/accuracy.tsx — Platform Prediction Accuracy Analytics
 *
 * Displays:
 * - Per-sport animated horizontal bar chart (react-native-reanimated)
 * - 7d vs 30d trend comparison with colored arrows
 * - Calibration drift indicator per sport
 * - Top-5 most accurate leagues table
 * - Overall platform KPIs (accuracy, calibration, total outcomes)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay,
  Easing, interpolateColor, useDerivedValue,
} from 'react-native-reanimated';
import { getSupabaseClient } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING, getSportIcon } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SportAccuracyRow {
  sport: string;
  total: number;
  correct: number;
  accuracyPct: number;
  avgConfidence: number;
  calibrationDrift: number;
  total7d: number;
  correct7d: number;
  pct7d: number;
  total30d: number;
  correct30d: number;
  pct30d: number;
  trendDirection: 'up' | 'down' | 'flat';
  trendDelta: number;
}

interface LeagueAccuracyRow {
  league: string;
  sport: string;
  total: number;
  correct: number;
  accuracyPct: number;
  avgConfidence: number;
}

interface OverallStats {
  totalOutcomes: number;
  totalCorrect: number;
  overallPct: number;
  avgConfidence: number;
  calibrationDrift: number;
  approvalRate: number;
  total7d: number;
  correct7d: number;
  pct7d: number;
  total30d: number;
  correct30d: number;
  pct30d: number;
  trendDirection: 'up' | 'down' | 'flat';
  trendDelta: number;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function accuracyColor(pct: number): string {
  if (pct >= 70) return '#22C55E';
  if (pct >= 55) return '#6EDC1F';
  if (pct >= 45) return '#F59E0B';
  if (pct >= 30) return '#F97316';
  return '#EF4444';
}

function trendColor(direction: 'up' | 'down' | 'flat', C: AppColors): string {
  if (direction === 'up') return '#22C55E';
  if (direction === 'down') return '#EF4444';
  return C.textMuted;
}

function trendIcon(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') return 'trending-up';
  if (direction === 'down') return 'trending-down';
  return 'remove';
}

function driftColor(drift: number, C: AppColors): string {
  if (drift <= 5) return '#22C55E';
  if (drift <= 10) return '#F59E0B';
  return '#EF4444';
}

function driftLabel(drift: number): string {
  if (drift <= 5) return 'Well Calibrated';
  if (drift <= 10) return 'Slight Drift';
  return 'High Drift';
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchAccuracyData(): Promise<{
  overall: OverallStats;
  bySport: SportAccuracyRow[];
  topLeagues: LeagueAccuracyRow[];
}> {
  const supabase = getSupabaseClient();

  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const since7d  = new Date(Date.now() -  7 * 24 * 3600 * 1000).toISOString();

  const [allRes, leagueRes] = await Promise.allSettled([
    supabase
      .from('prediction_outcomes')
      .select('sport, is_correct, resolved_at, confidence_at_prediction'),
    supabase
      .from('prediction_outcomes')
      .select('sport, is_correct, confidence_at_prediction, match_id')
      .not('match_id', 'is', null),
  ]);

  const rows = allRes.status === 'fulfilled' ? (allRes.value.data ?? []) as any[] : [];

  // ── Overall stats ────────────────────────────────────────────────────────
  const rows30d = rows.filter((r) => r.resolved_at >= since30d);
  const rows7d  = rows.filter((r) => r.resolved_at >= since7d);

  const buildStats = (subset: any[]) => ({
    total:   subset.length,
    correct: subset.filter((r) => r.is_correct).length,
    pct:     subset.length > 0
      ? Math.round((subset.filter((r) => r.is_correct).length / subset.length) * 100)
      : 0,
    avgConf: subset.length > 0
      ? Math.round(subset.reduce((s: number, r: any) => s + (r.confidence_at_prediction ?? 0), 0) / subset.length)
      : 0,
  });

  const allStats  = buildStats(rows);
  const s30d      = buildStats(rows30d);
  const s7d       = buildStats(rows7d);
  const trendDelta = s7d.pct - s30d.pct;
  const overall: OverallStats = {
    totalOutcomes:   allStats.total,
    totalCorrect:    allStats.correct,
    overallPct:      allStats.pct,
    avgConfidence:   allStats.avgConf,
    calibrationDrift: Math.abs(allStats.pct - allStats.avgConf),
    approvalRate:    allStats.pct,
    total7d:         s7d.total,
    correct7d:       s7d.correct,
    pct7d:           s7d.pct,
    total30d:        s30d.total,
    correct30d:      s30d.correct,
    pct30d:          s30d.pct,
    trendDirection:  Math.abs(trendDelta) < 3 ? 'flat' : trendDelta > 0 ? 'up' : 'down',
    trendDelta:      Math.abs(trendDelta),
  };

  // ── Per-sport stats ──────────────────────────────────────────────────────
  const sportMap: Record<string, { all: any[]; d30: any[]; d7: any[] }> = {};
  for (const row of rows) {
    const sp = row.sport ?? 'football';
    if (!sportMap[sp]) sportMap[sp] = { all: [], d30: [], d7: [] };
    sportMap[sp].all.push(row);
    if (row.resolved_at >= since30d) sportMap[sp].d30.push(row);
    if (row.resolved_at >= since7d)  sportMap[sp].d7.push(row);
  }

  const bySport: SportAccuracyRow[] = Object.entries(sportMap)
    .filter(([, v]) => v.all.length >= 1)
    .map(([sport, v]) => {
      const a  = buildStats(v.all);
      const d3 = buildStats(v.d30);
      const d7 = buildStats(v.d7);
      const delta = d7.pct - d3.pct;
      return {
        sport,
        total:             a.total,
        correct:           a.correct,
        accuracyPct:       a.pct,
        avgConfidence:     a.avgConf,
        calibrationDrift:  Math.abs(a.pct - a.avgConf),
        total7d:           d7.total,
        correct7d:         d7.correct,
        pct7d:             d7.pct,
        total30d:          d3.total,
        correct30d:        d3.correct,
        pct30d:            d3.pct,
        trendDirection:    Math.abs(delta) < 3 ? 'flat' : delta > 0 ? 'up' : 'down',
        trendDelta:        Math.abs(delta),
      };
    })
    .sort((a, b) => b.total - a.total);

  // ── Top leagues from matches join ────────────────────────────────────────
  // Pull match league names for outcomes, then aggregate
  const { data: matchLeagueRows } = await supabase
    .from('prediction_outcomes')
    .select('is_correct, confidence_at_prediction, match_id, sport')
    .not('match_id', 'is', null)
    .limit(2000);

  const matchIds = [...new Set((matchLeagueRows ?? []).map((r: any) => r.match_id))].slice(0, 200);
  let leagueMap: Record<string, { league: string; sport: string; total: number; correct: number; conf: number[] }> = {};

  if (matchIds.length > 0) {
    const { data: matchData } = await supabase
      .from('matches')
      .select('id, league, sport')
      .in('id', matchIds);

    const leagueByMatchId: Record<string, { league: string; sport: string }> = {};
    for (const m of (matchData ?? []) as any[]) {
      if (m.league) leagueByMatchId[m.id] = { league: m.league, sport: m.sport };
    }

    for (const row of (matchLeagueRows ?? []) as any[]) {
      const info = leagueByMatchId[row.match_id];
      if (!info?.league) continue;
      const key = info.league;
      if (!leagueMap[key]) leagueMap[key] = { league: info.league, sport: info.sport, total: 0, correct: 0, conf: [] };
      leagueMap[key].total++;
      if (row.is_correct) leagueMap[key].correct++;
      if (row.confidence_at_prediction) leagueMap[key].conf.push(row.confidence_at_prediction);
    }
  }

  const topLeagues: LeagueAccuracyRow[] = Object.values(leagueMap)
    .filter((l) => l.total >= 3)
    .map((l) => ({
      league:       l.league,
      sport:        l.sport,
      total:        l.total,
      correct:      l.correct,
      accuracyPct:  Math.round((l.correct / l.total) * 100),
      avgConfidence: l.conf.length > 0
        ? Math.round(l.conf.reduce((s, v) => s + v, 0) / l.conf.length)
        : 0,
    }))
    .sort((a, b) => b.accuracyPct - a.accuracyPct || b.total - a.total)
    .slice(0, 5);

  return { overall, bySport, topLeagues };
}

// ─── Animated accuracy bar ────────────────────────────────────────────────────

function AccuracyBar({
  sport,
  accuracyPct,
  total7d,
  pct7d,
  total30d,
  pct30d,
  trendDirection,
  trendDelta,
  calibrationDrift,
  avgConfidence,
  index,
  C,
}: SportAccuracyRow & { index: number; C: AppColors }) {
  const barWidth = useSharedValue(0);
  const bar7dWidth = useSharedValue(0);
  const barOpacity = useSharedValue(0);

  useEffect(() => {
    barOpacity.value = withDelay(index * 80, withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }));
    barWidth.value   = withDelay(index * 80 + 150, withTiming(accuracyPct, { duration: 600, easing: Easing.out(Easing.cubic) }));
    bar7dWidth.value = withDelay(index * 80 + 250, withTiming(pct7d, { duration: 500, easing: Easing.out(Easing.quad) }));
  }, [accuracyPct, pct7d]);

  const barColor = accuracyColor(accuracyPct);
  const bar7dColor = accuracyColor(pct7d);

  const animBarStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%` as any,
    backgroundColor: barColor,
  }));

  const anim7dBarStyle = useAnimatedStyle(() => ({
    width: `${bar7dWidth.value}%` as any,
    backgroundColor: bar7dColor,
    opacity: 0.55,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: barOpacity.value,
    transform: [{ translateX: (1 - barOpacity.value) * -16 }],
  }));

  const tc = trendColor(trendDirection, C);
  const dc = driftColor(calibrationDrift, C);

  return (
    <Animated.View style={[barStyles.wrap, containerStyle]}>
      {/* Header row */}
      <View style={barStyles.header}>
        <View style={barStyles.headerLeft}>
          <Text style={barStyles.sportEmoji}>{getSportIcon(sport)}</Text>
          <Text style={[barStyles.sportName, { color: C.textPrimary }]}>
            {sport.charAt(0).toUpperCase() + sport.slice(1).replace(/-/g, ' ')}
          </Text>
          <Text style={[barStyles.totalCount, { color: C.textMuted }]}>({total30d} picks)</Text>
        </View>
        <View style={barStyles.headerRight}>
          {/* Trend chip */}
          <View style={[barStyles.trendChip, { backgroundColor: `${tc}14`, borderColor: `${tc}33` }]}>
            <Ionicons name={trendIcon(trendDirection) as any} size={10} color={tc} />
            <Text style={[barStyles.trendText, { color: tc }]}>
              {trendDirection !== 'flat' ? `${trendDelta}%` : 'flat'}
            </Text>
          </View>
          {/* Accuracy badge */}
          <View style={[barStyles.accBadge, { backgroundColor: `${barColor}14`, borderColor: `${barColor}33` }]}>
            <Text style={[barStyles.accBadgeText, { color: barColor }]}>{accuracyPct}%</Text>
          </View>
        </View>
      </View>

      {/* Bar tracks */}
      <View style={[barStyles.track, { backgroundColor: C.surface }]}>
        {/* 30d bar (background) */}
        <View style={[barStyles.bar30dFill, { width: `${accuracyPct}%`, backgroundColor: `${barColor}30` }]} />
        {/* 7d animated bar */}
        <Animated.View style={[barStyles.bar7dFill, anim7dBarStyle]} />
        {/* Main animated bar */}
        <Animated.View style={[barStyles.barFill, animBarStyle]} />
        {/* 50% marker */}
        <View style={[barStyles.midLine, { backgroundColor: C.border }]} />
      </View>

      {/* Footer: 7d vs 30d */}
      <View style={barStyles.footer}>
        <View style={barStyles.footerPair}>
          <View style={[barStyles.legendDot, { backgroundColor: barColor }]} />
          <Text style={[barStyles.footerLabel, { color: C.textMuted }]}>
            30d: <Text style={{ color: barColor, fontWeight: FONTS.bold }}>{pct30d}%</Text>
            {'  '}({total30d})
          </Text>
        </View>
        <View style={barStyles.footerPair}>
          <View style={[barStyles.legendDot, { backgroundColor: bar7dColor, opacity: 0.6 }]} />
          <Text style={[barStyles.footerLabel, { color: C.textMuted }]}>
            7d: <Text style={{ color: bar7dColor, fontWeight: FONTS.bold }}>{pct7d}%</Text>
            {'  '}({total7d})
          </Text>
        </View>
        {/* Calibration drift */}
        <View style={[barStyles.driftChip, { backgroundColor: `${dc}10`, borderColor: `${dc}30` }]}>
          <Ionicons name="analytics-outline" size={9} color={dc} />
          <Text style={[barStyles.driftText, { color: dc }]}>
            drift {calibrationDrift.toFixed(0)}%
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const barStyles = StyleSheet.create({
  wrap: { gap: 7, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sportEmoji: { fontSize: 16 },
  sportName: { fontSize: 13, fontWeight: FONTS.bold },
  totalCount: { fontSize: 10 },
  trendChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  trendText: { fontSize: 10, fontWeight: FONTS.bold },
  accBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  accBadgeText: { fontSize: 12, fontWeight: FONTS.extraBold },
  track: { height: 12, borderRadius: 6, overflow: 'hidden', position: 'relative' },
  bar30dFill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 6 },
  bar7dFill: { position: 'absolute', top: 3, left: 0, height: 6, borderRadius: 3 },
  barFill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 6 },
  midLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  footerPair: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  footerLabel: { fontSize: 10 },
  driftChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 'auto' },
  driftText: { fontSize: 9, fontWeight: FONTS.bold },
});

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, subLabel, color, icon, C }: {
  label: string; value: string; subLabel?: string;
  color: string; icon: string; C: AppColors;
}) {
  return (
    <View style={[kpiStyles.tile, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[kpiStyles.iconWrap, { backgroundColor: `${color}14`, borderColor: `${color}30` }]}>
        <Ionicons name={icon as any} size={15} color={color} />
      </View>
      <Text style={[kpiStyles.value, { color }]}>{value}</Text>
      <Text style={[kpiStyles.label, { color: C.textMuted }]}>{label}</Text>
      {subLabel ? <Text style={[kpiStyles.sub, { color: C.textMuted }]}>{subLabel}</Text> : null}
    </View>
  );
}

const kpiStyles = StyleSheet.create({
  tile: { flex: 1, alignItems: 'center', gap: 5, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 6 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 22, fontWeight: FONTS.extraBold },
  label: { fontSize: 9, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  sub: { fontSize: 9, textAlign: 'center' },
});

// ─── Overall Trend Banner ─────────────────────────────────────────────────────

function TrendBanner({ overall, C }: { overall: OverallStats; C: AppColors }) {
  const tc = trendColor(overall.trendDirection, C);
  const accColor = accuracyColor(overall.overallPct);

  return (
    <LinearGradient
      colors={[`${accColor}18`, `${accColor}06`] as [string, string]}
      style={[bannerStyles.wrap, { borderColor: `${accColor}22` }]}
    >
      <View style={bannerStyles.left}>
        <View style={[bannerStyles.bigCircle, { borderColor: `${accColor}55`, backgroundColor: `${accColor}10` }]}>
          <Text style={[bannerStyles.bigPct, { color: accColor }]}>{overall.overallPct}%</Text>
          <Text style={[bannerStyles.bigLabel, { color: C.textMuted }]}>OVERALL</Text>
        </View>
      </View>
      <View style={bannerStyles.right}>
        <Text style={[bannerStyles.headline, { color: C.textPrimary }]}>
          Platform Accuracy
        </Text>
        <Text style={[bannerStyles.sub, { color: C.textMuted }]}>
          Based on {overall.totalOutcomes.toLocaleString()} resolved predictions
        </Text>
        {/* 7d vs 30d comparison */}
        <View style={bannerStyles.compRow}>
          <View style={bannerStyles.compCell}>
            <Text style={[bannerStyles.compVal, { color: accuracyColor(overall.pct7d) }]}>{overall.pct7d}%</Text>
            <Text style={[bannerStyles.compLbl, { color: C.textMuted }]}>7 Days</Text>
            <Text style={[bannerStyles.compCount, { color: C.textMuted }]}>{overall.total7d} picks</Text>
          </View>
          <View style={[bannerStyles.compDivider, { backgroundColor: C.border }]} />
          <View style={bannerStyles.compCell}>
            <Text style={[bannerStyles.compVal, { color: accuracyColor(overall.pct30d) }]}>{overall.pct30d}%</Text>
            <Text style={[bannerStyles.compLbl, { color: C.textMuted }]}>30 Days</Text>
            <Text style={[bannerStyles.compCount, { color: C.textMuted }]}>{overall.total30d} picks</Text>
          </View>
          <View style={[bannerStyles.compDivider, { backgroundColor: C.border }]} />
          <View style={bannerStyles.compCell}>
            <View style={bannerStyles.trendRow}>
              <Ionicons name={trendIcon(overall.trendDirection) as any} size={14} color={tc} />
              <Text style={[bannerStyles.compVal, { color: tc }]}>
                {overall.trendDirection !== 'flat' ? `${overall.trendDelta}%` : '—'}
              </Text>
            </View>
            <Text style={[bannerStyles.compLbl, { color: C.textMuted }]}>Trend</Text>
            <Text style={[bannerStyles.compCount, { color: tc }]}>{overall.trendDirection}</Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}

const bannerStyles = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, flexDirection: 'row', gap: 16, alignItems: 'center' },
  left: { alignItems: 'center', justifyContent: 'center' },
  bigCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bigPct: { fontSize: 22, fontWeight: FONTS.extraBold },
  bigLabel: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  right: { flex: 1, gap: 8 },
  headline: { fontSize: 16, fontWeight: FONTS.extraBold },
  sub: { fontSize: 11 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  compCell: { flex: 1, alignItems: 'center', gap: 2 },
  compDivider: { width: 1, height: 32, marginHorizontal: 4 },
  compVal: { fontSize: 16, fontWeight: FONTS.extraBold },
  compLbl: { fontSize: 9, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  compCount: { fontSize: 9 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});

// ─── Top Leagues Table ────────────────────────────────────────────────────────

function TopLeaguesTable({ leagues, C }: { leagues: LeagueAccuracyRow[]; C: AppColors }) {
  if (leagues.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
        <Ionicons name="trophy-outline" size={28} color={C.textMuted} />
        <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>
          Not enough resolved predictions per league yet.{'\n'}Run more predictions to populate this table.
        </Text>
      </View>
    );
  }

  return (
    <View style={tableStyles.wrap}>
      {/* Header */}
      <View style={[tableStyles.headerRow, { borderBottomColor: C.border }]}>
        <Text style={[tableStyles.headerCell, { color: C.textMuted, flex: 2 }]}>League</Text>
        <Text style={[tableStyles.headerCell, { color: C.textMuted }]}>Picks</Text>
        <Text style={[tableStyles.headerCell, { color: C.textMuted }]}>Conf</Text>
        <Text style={[tableStyles.headerCell, { color: C.textMuted }]}>Accuracy</Text>
      </View>
      {leagues.map((row, idx) => {
        const ac = accuracyColor(row.accuracyPct);
        return (
          <View key={row.league} style={[tableStyles.row, { borderBottomColor: C.border }, idx === leagues.length - 1 ? { borderBottomWidth: 0 } : null]}>
            {/* Rank badge */}
            <View style={[tableStyles.rankBadge, {
              backgroundColor: idx === 0 ? '#FFD70018' : idx === 1 ? '#C0C0C018' : idx === 2 ? '#CD7F3218' : C.surface,
              borderColor: idx === 0 ? '#FFD70044' : idx === 1 ? '#C0C0C044' : idx === 2 ? '#CD7F3244' : C.border,
            }]}>
              <Text style={[tableStyles.rankText, {
                color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : C.textMuted,
              }]}>#{idx + 1}</Text>
            </View>
            <View style={{ flex: 2, gap: 2 }}>
              <Text style={[tableStyles.leagueName, { color: C.textPrimary }]} numberOfLines={1}>{row.league}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11 }}>{getSportIcon(row.sport)}</Text>
                <Text style={[tableStyles.sportLabel, { color: C.textMuted }]}>{row.sport}</Text>
              </View>
            </View>
            <Text style={[tableStyles.cell, { color: C.textSecondary }]}>{row.total}</Text>
            <Text style={[tableStyles.cell, { color: C.accentBlue }]}>{row.avgConfidence}%</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <View style={[tableStyles.accChip, { backgroundColor: `${ac}14`, borderColor: `${ac}33` }]}>
                <Text style={[tableStyles.accChipText, { color: ac }]}>{row.accuracyPct}%</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const tableStyles = StyleSheet.create({
  wrap: { gap: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, paddingHorizontal: 4, gap: 6 },
  headerCell: { flex: 1, fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, paddingHorizontal: 4, gap: 8 },
  rankBadge: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText: { fontSize: 9, fontWeight: FONTS.extraBold },
  leagueName: { fontSize: 13, fontWeight: FONTS.semiBold },
  sportLabel: { fontSize: 10 },
  cell: { flex: 1, fontSize: 12, fontWeight: FONTS.semiBold, textAlign: 'center' },
  accChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  accChipText: { fontSize: 12, fontWeight: FONTS.extraBold },
});

// ─── Calibration Drift Panel ──────────────────────────────────────────────────

function CalibrationPanel({ bySport, C }: { bySport: SportAccuracyRow[]; C: AppColors }) {
  const sorted = [...bySport].sort((a, b) => b.calibrationDrift - a.calibrationDrift);

  return (
    <View style={{ gap: 10 }}>
      <Text style={[calStyles.intro, { color: C.textMuted }]}>
        Calibration drift measures how far model confidence deviates from actual accuracy.
        Ideal drift is ≤5%. High drift indicates the model is over- or under-confident.
      </Text>
      {sorted.map((row) => {
        const dc = driftColor(row.calibrationDrift, C);
        const dl = driftLabel(row.calibrationDrift);
        const barPct = Math.min(100, row.calibrationDrift * 3);
        return (
          <View key={row.sport} style={[calStyles.row, { borderBottomColor: C.border }]}>
            <Text style={calStyles.emoji}>{getSportIcon(row.sport)}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[calStyles.sportName, { color: C.textPrimary }]}>
                  {row.sport.charAt(0).toUpperCase() + row.sport.slice(1).replace(/-/g, ' ')}
                </Text>
                <View style={[calStyles.statusPill, { backgroundColor: `${dc}12`, borderColor: `${dc}33` }]}>
                  <Text style={[calStyles.statusText, { color: dc }]}>{dl}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[calStyles.track, { backgroundColor: C.surface, flex: 1 }]}>
                  <View style={[calStyles.fill, { width: `${barPct}%`, backgroundColor: dc }]} />
                </View>
                <Text style={[calStyles.driftVal, { color: dc }]}>{row.calibrationDrift.toFixed(1)}%</Text>
              </View>
              <Text style={[calStyles.detail, { color: C.textMuted }]}>
                Accuracy {row.accuracyPct}% vs Avg Confidence {row.avgConfidence}%
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const calStyles = StyleSheet.create({
  intro: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  emoji: { fontSize: 18, width: 26, paddingTop: 2 },
  sportName: { fontSize: 13, fontWeight: FONTS.semiBold },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  driftVal: { fontSize: 12, fontWeight: FONTS.extraBold, width: 38, textAlign: 'right' },
  statusPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.4 },
  detail: { fontSize: 10 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AccuracyScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [bySport, setBySport] = useState<SportAccuracyRow[]>([]);
  const [topLeagues, setTopLeagues] = useState<LeagueAccuracyRow[]>([]);
  const [activeSection, setActiveSection] = useState<'chart' | 'leagues' | 'calibration'>('chart');

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await fetchAccuracyData();
      setOverall(result.overall);
      setBySport(result.bySport);
      setTopLeagues(result.topLeagues);
    } catch { /* non-blocking */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); loadData(true); }, [loadData]);

  if (loading) return (
    <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={C.primary} />
      <Text style={{ color: C.textMuted, marginTop: 12, fontSize: 13 }}>Loading accuracy data...</Text>
    </View>
  );

  const accColor = overall ? accuracyColor(overall.overallPct) : C.primary;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[s.title, { color: C.textPrimary }]}>Prediction Accuracy</Text>
            <Text style={[s.subtitle, { color: C.textMuted }]}>Per-sport performance analytics</Text>
          </View>
          {overall ? (
            <View style={[s.headerBadge, { backgroundColor: `${accColor}14`, borderColor: `${accColor}33` }]}>
              <FontAwesome5 name="chart-line" size={11} color={accColor} />
              <Text style={[s.headerBadgeText, { color: accColor }]}>{overall.overallPct}%</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* Overall trend banner */}
        {overall ? <TrendBanner overall={overall} C={C} /> : null}

        {/* KPI row */}
        {overall ? (
          <View style={s.kpiRow}>
            <KpiTile
              label="Outcomes"
              value={overall.totalOutcomes.toLocaleString()}
              subLabel="all time"
              color={C.accentBlue}
              icon="list-outline"
              C={C}
            />
            <KpiTile
              label="Correct"
              value={overall.totalCorrect.toLocaleString()}
              color="#22C55E"
              icon="checkmark-circle-outline"
              C={C}
            />
            <KpiTile
              label="Calibration"
              value={`${overall.calibrationDrift.toFixed(0)}%`}
              subLabel={driftLabel(overall.calibrationDrift)}
              color={driftColor(overall.calibrationDrift, C)}
              icon="analytics-outline"
              C={C}
            />
          </View>
        ) : null}

        {/* Section switcher */}
        <View style={[s.sectionSwitcher, { backgroundColor: C.card, borderColor: C.border }]}>
          {([
            ['chart',       'bar-chart-outline',   'By Sport'],
            ['leagues',     'trophy-outline',       'Top Leagues'],
            ['calibration', 'analytics-outline',    'Calibration'],
          ] as const).map(([key, icon, label]) => {
            const active = activeSection === key;
            return (
              <Pressable
                key={key}
                style={[s.sectionBtn, { borderColor: C.border }, active ? { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` } : null]}
                onPress={() => setActiveSection(key)}
              >
                <Ionicons name={icon as any} size={13} color={active ? C.primary : C.textMuted} />
                <Text style={[s.sectionBtnText, { color: active ? C.primary : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* By Sport chart */}
        {activeSection === 'chart' ? (
          <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={s.cardHeader}>
              <View style={[s.cardIcon, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}30` }]}>
                <Ionicons name="bar-chart-outline" size={14} color={C.primary} />
              </View>
              <Text style={[s.cardTitle, { color: C.textPrimary }]}>Accuracy by Sport</Text>
            </View>
            {/* Legend */}
            <View style={s.legend}>
              <View style={s.legendItem}>
                <View style={[s.legendBar, { backgroundColor: C.primary, height: 6 }]} />
                <Text style={[s.legendLabel, { color: C.textMuted }]}>All-time</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendBar, { backgroundColor: C.primary, height: 3, opacity: 0.5 }]} />
                <Text style={[s.legendLabel, { color: C.textMuted }]}>7-day window</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendBar, { backgroundColor: C.border, height: 4 }]} />
                <Text style={[s.legendLabel, { color: C.textMuted }]}>50% mark</Text>
              </View>
            </View>
            {bySport.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                <Ionicons name="bar-chart-outline" size={32} color={C.textMuted} />
                <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
                  No resolved predictions found.{'\n'}Run "Resolve Outcomes" in Admin to populate.
                </Text>
              </View>
            ) : null}
            {bySport.map((row, idx) => (
              <AccuracyBar key={row.sport} {...row} index={idx} C={C} />
            ))}
          </View>
        ) : null}

        {/* Top leagues */}
        {activeSection === 'leagues' ? (
          <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={s.cardHeader}>
              <View style={[s.cardIcon, { backgroundColor: `${C.accentAmber}14`, borderColor: `${C.accentAmber}30` }]}>
                <Ionicons name="trophy-outline" size={14} color={C.accentAmber} />
              </View>
              <Text style={[s.cardTitle, { color: C.textPrimary }]}>Top 5 Leagues by Accuracy</Text>
            </View>
            <Text style={[s.cardSub, { color: C.textMuted }]}>
              Minimum 3 resolved predictions. Sorted by accuracy then volume.
            </Text>
            <TopLeaguesTable leagues={topLeagues} C={C} />
          </View>
        ) : null}

        {/* Calibration */}
        {activeSection === 'calibration' ? (
          <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={s.cardHeader}>
              <View style={[s.cardIcon, { backgroundColor: `${C.accentBlue}14`, borderColor: `${C.accentBlue}30` }]}>
                <Ionicons name="analytics-outline" size={14} color={C.accentBlue} />
              </View>
              <Text style={[s.cardTitle, { color: C.textPrimary }]}>Model Calibration Drift</Text>
            </View>
            <CalibrationPanel bySport={bySport} C={C} />
          </View>
        ) : null}

        {/* Info footer */}
        <View style={[s.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="information-circle-outline" size={16} color={C.accentBlue} />
          <Text style={[s.infoText, { color: C.textMuted }]}>
            Accuracy is computed from resolved prediction outcomes only. Pull down to refresh with the latest data.
            Visit Admin → AI Governance for model registry and MLOps controls.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 11, marginTop: 1 },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  headerBadgeText: { fontSize: 13, fontWeight: FONTS.extraBold },
  scroll: { padding: SPACING.md, gap: 12 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  sectionSwitcher: {
    flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1,
    padding: 4, gap: 4,
  },
  sectionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: RADIUS.md, borderWidth: 1,
  },
  sectionBtnText: { fontSize: 11, fontWeight: FONTS.medium },
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 30, height: 30, borderRadius: 9, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: FONTS.bold, flex: 1 },
  cardSub: { fontSize: 11, lineHeight: 16 },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendBar: { width: 24, borderRadius: 2 },
  legendLabel: { fontSize: 10 },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: RADIUS.lg, borderWidth: 1, padding: 12,
  },
  infoText: { flex: 1, fontSize: 11, lineHeight: 17 },
  accentAmber: {},
  accentBlue: {},
});
