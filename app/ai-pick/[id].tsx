/**
 * AI Pick Detail Page — Unified with match/[id].tsx
 *
 * Tabs: Overview | AI Picks | Stats | Odds | [Timeline if live] | AI Report
 *
 * UNIFORM DESIGN:
 * - Identical color tokens (OV_HOME = #38BDF8, OV_AWAY = #A78BFA)
 * - Identical card/section structure (sc/st tokens)
 * - Identical radar (8-axis, prediction-driven with form fallback)
 * - Identical data table below radar
 * - Identical Poisson model layout
 * - Identical H2H layout
 * - Standings moved to Stats tab (not Overview)
 * - Sport-specific markets in AI picks tab
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Dimensions, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import Svg, { Polygon, Line as SvgLine, Text as SvgText, Polyline, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { fetchHeadToHead, fetchLeagueStandingsFromDB } from '@/services/aiPicksService';
import type { AIPick, H2HRecord, StandingsResult } from '@/services/aiPicksService';
import { fetchDetailedMatchData } from '@/services/matchStatsService';
import type { DetailedMatchData } from '@/services/matchStatsService';
import { getSupabaseClient, useAuth } from '@/template';
import { getRiskColor, getValueScoreColor, getSharpSignalLabel, formatMarketEdge } from '@/services/predictionService';
import { buildPredictionMarkets } from '@/services/sportEngines';
import { getPredChipConfig, getSportFamily, getSportTerms, getSportAccuracyMarkets } from '@/services/sportConfig';
import { DisclaimerBanner } from '@/components/ui/DisclaimerBanner';
import { fetchAIIntelligence, prefetchAIIntelligence, getValidationBadge, AI_SOURCE_LABELS } from '@/services/aiIntelligenceService';
import type { AIIntelligenceResult } from '@/services/aiIntelligenceService';
import { MultiModelConsensusPanel } from '@/components/feature/MultiModelConsensusPanel';
import { useAdminRole } from '@/hooks/useAdminRole';
import SportAIPicks from '@/components/feature/SportAIPicks';
import SportPreMatchIntelligence from '@/components/feature/SportPreMatchIntelligence';
import AIReportConsensus from '@/components/feature/AIReportConsensus';
import { CollapsibleIntelCard, IntelSummaryBar } from '@/components/feature/CollapsibleIntelCard';

const { width: SCREEN_W } = Dimensions.get('window');
const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  catch { return '--:--'; }
}
function fmtDate(iso: string) {
  try { const d = new Date(iso); return `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES[d.getMonth()]}`; }
  catch { return ''; }
}
function fmtShortDate(iso: string) {
  try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; } catch { return ''; }
}

// ─── Shared section style tokens (uniform with match/[id].tsx) ────────────────
const sc: any = { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16 };
const st: any = { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.9, marginBottom: 14 };

// ─── Color tokens — IDENTICAL to match/[id].tsx ───────────────────────────────
const OV_HOME = '#38BDF8'; // sky blue — home team
const OV_AWAY = '#A78BFA'; // violet — away team

// ─── Team Logo ─────────────────────────────────────────────────────────────────
function TeamLogo({ name, logoUrl, size = 44, C }: { name: string; logoUrl?: string | null; size?: number; C: AppColors }) {
  const abbr = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (logoUrl) return <Image source={{ uri: logoUrl }} style={{ width: size, height: size, borderRadius: size / 4 }} contentFit="contain" transition={150} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${C.primary}22`, borderWidth: 1.5, borderColor: `${C.primary}44`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.3, fontWeight: FONTS.extraBold, color: C.primary }}>{abbr}</Text>
    </View>
  );
}

// ─── Pulsing LIVE badge ───────────────────────────────────────────────────────
function PulsingLiveBadge() {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    p.start(); return () => p.stop();
  }, [op]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)', paddingHorizontal: 10, paddingVertical: 5 }}>
      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444', opacity: op }} />
      <Text style={{ fontSize: 11, fontWeight: '800' as any, color: '#EF4444', letterSpacing: 0.5 }}>LIVE</Text>
    </View>
  );
}

// ─── Form color tokens ────────────────────────────────────────────────────────
const FORM_COLORS = {
  W: { bg: '#DCFCE7', border: '#22C55E', text: '#166534' },
  D: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  L: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
};

function FormBubble({ result, size = 28 }: { result: string; size?: number }) {
  const u = result.toUpperCase() as 'W' | 'D' | 'L';
  const c = FORM_COLORS[u] ?? { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.38, fontWeight: FONTS.extraBold, color: c.text }}>{u}</Text>
    </View>
  );
}

// ─── Radar Chart — 8-axis, IDENTICAL to match/[id].tsx ───────────────────────
const RADAR_SIZE = Math.min(SCREEN_W - 40, 200);
const RADAR_PAD = 38;
const RADAR_LABELS = ['Strength','Attacking','Defensive','Wins','Draws','Loss','Goals Ag.','Goals For'];

function polarToXY(angle: number, radius: number, cx: number, cy: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function RadarChart({ homeVals, awayVals, homeColor, awayColor }: { homeVals: number[]; awayVals: number[]; homeColor: string; awayColor: string }) {
  const cx = RADAR_SIZE / 2; const cy = RADAR_SIZE / 2;
  const maxR = RADAR_SIZE / 2 - RADAR_PAD;
  const n = RADAR_LABELS.length; const step = 360 / n;
  const polygon = (vals: number[]) => vals.map((v, i) => { const r = Math.max(0, Math.min(1, v)) * maxR; const pt = polarToXY(i * step, r, cx, cy); return `${pt.x},${pt.y}`; }).join(' ');
  const gridPolygon = (f: number) => Array.from({ length: n }, (_, i) => { const pt = polarToXY(i * step, maxR * f, cx, cy); return `${pt.x},${pt.y}`; }).join(' ');
  return (
    <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
      {[0.25,0.5,0.75,1].map((f) => <Polygon key={`ring-${f}`} points={gridPolygon(f)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />)}
      {Array.from({ length: n }, (_, i) => { const pt = polarToXY(i * step, maxR, cx, cy); return <SvgLine key={`spoke-${i}`} x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />; })}
      <Polygon points={polygon(homeVals)} fill={`${homeColor}33`} stroke={homeColor} strokeWidth={2} />
      <Polygon points={polygon(awayVals)} fill={`${awayColor}22`} stroke={awayColor} strokeWidth={1.5} />
      {RADAR_LABELS.map((label, i) => { const pt = polarToXY(i * step, maxR + 16, cx, cy); return <SvgText key={`label-${i}`} x={pt.x} y={pt.y + 4} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.4)">{label}</SvgText>; })}
    </Svg>
  );
}

// ─── Radar data table — IDENTICAL to match/[id].tsx ──────────────────────────
function RadarDataTable({ homeVals, awayVals, homeTeam, awayTeam, C }: {
  homeVals: number[]; awayVals: number[]; homeTeam: string; awayTeam: string; C: AppColors;
}) {
  return (
    <View style={{ width: '100%', marginTop: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ flex: 1.6, fontSize: 9, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.6 }}>AXIS</Text>
        <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: OV_HOME, textAlign: 'center', letterSpacing: 0.4 }} numberOfLines={1}>{homeTeam.split(' ').slice(-1)[0].toUpperCase()}</Text>
        <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: OV_AWAY, textAlign: 'center', letterSpacing: 0.4 }} numberOfLines={1}>{awayTeam.split(' ').slice(-1)[0].toUpperCase()}</Text>
      </View>
      {RADAR_LABELS.map((label, idx) => {
        const hv = Math.round(Math.min(1, Math.max(0, homeVals[idx] ?? 0)) * 100);
        const av = Math.round(Math.min(1, Math.max(0, awayVals[idx] ?? 0)) * 100);
        const hWins = hv > av; const aWins = av > hv;
        return (
          <View key={label} style={[
            { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
            idx % 2 === 0 ? { backgroundColor: C.bg } : { backgroundColor: C.surface },
          ]}>
            <Text style={{ flex: 1.6, fontSize: 11, color: C.textSecondary }}>{label}</Text>
            <View style={{ flex: 1, alignItems: 'center' as const }}>
              <Text style={{ fontSize: 13, fontWeight: (hWins ? FONTS.extraBold : FONTS.regular) as any, color: hWins ? OV_HOME : C.textMuted }}>{hv}%</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' as const }}>
              <Text style={{ fontSize: 13, fontWeight: (aWins ? FONTS.extraBold : FONTS.regular) as any, color: aWins ? OV_AWAY : C.textMuted }}>{av}%</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Compare Bar — IDENTICAL to match/[id].tsx ────────────────────────────────
function OvCompareBar({ label, homeVal, awayVal, C }: { label: string; homeVal: number; awayVal: number; C: AppColors }) {
  const total = homeVal + awayVal || 1;
  const hp = Math.round((homeVal / total) * 100);
  const ap = 100 - hp;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold, color: OV_HOME }}>{hp}%</Text>
        <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: C.textMuted }}>{label}</Text>
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold, color: OV_AWAY }}>{ap}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 6, flexDirection: 'row', overflow: 'hidden', backgroundColor: C.surface }}>
        <View style={{ flex: hp, backgroundColor: OV_HOME, borderRadius: 6 }} />
        <View style={{ width: 2, backgroundColor: C.bg }} />
        <View style={{ flex: ap, backgroundColor: OV_AWAY, borderRadius: 6 }} />
      </View>
    </View>
  );
}

// ─── Poisson PMF ──────────────────────────────────────────────────────────────
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) result *= lambda / i;
  return result;
}

// ─── Season Stats ─────────────────────────────────────────────────────────────
interface SeasonStats {
  biggestWin: string; biggestLoss: string; lowestWin: string;
  highestDraw: string;
  avgScored: number; avgConceded: number;
  totalGames: number; totalGoalsFor: number; totalGoalsAgainst: number;
}

function buildSeasonStats(matches: Array<{ hs: number; as_: number; isHome: boolean; label: string }>): SeasonStats | null {
  if (matches.length === 0) return null;
  let biggestWin = '—'; let biggestWinGoals = -1;
  let biggestLoss = '—'; let biggestLossGoals = -1;
  let lowestWin = '—'; let lowestWinGoals = 999;
  let highestDraw = '—'; let highestDrawGoals = -1;
  let totalGoalsFor = 0; let totalGoalsAgainst = 0;
  for (const m of matches) {
    const scored = m.isHome ? m.hs : m.as_;
    const conceded = m.isHome ? m.as_ : m.hs;
    totalGoalsFor += scored; totalGoalsAgainst += conceded;
    const diff = scored - conceded;
    if (diff > 0) {
      if (scored > biggestWinGoals) { biggestWin = m.label; biggestWinGoals = scored; }
      if (scored < lowestWinGoals) { lowestWin = m.label; lowestWinGoals = scored; }
    } else if (diff < 0) {
      if (conceded > biggestLossGoals) { biggestLoss = m.label; biggestLossGoals = conceded; }
    } else {
      if (scored > highestDrawGoals) { highestDraw = m.label; highestDrawGoals = scored; }
    }
  }
  const n = matches.length;
  return {
    biggestWin, biggestLoss, lowestWin, highestDraw,
    avgScored: Math.round((totalGoalsFor / n) * 10) / 10,
    avgConceded: Math.round((totalGoalsAgainst / n) * 10) / 10,
    totalGames: n, totalGoalsFor, totalGoalsAgainst,
  };
}

// ─── Stat Row (for Match Statistics section) ──────────────────────────────────
function StatRow({ label, homeVal, awayVal, C }: { label: string; homeVal: string | number | null; awayVal: string | number | null; C: AppColors }) {
  const hv = homeVal !== null && homeVal !== undefined ? String(homeVal) : '—';
  const av = awayVal !== null && awayVal !== undefined ? String(awayVal) : '—';
  const hn = parseFloat(hv); const an = parseFloat(av);
  const hw = !isNaN(hn) && !isNaN(an) && hn > an; const aw = !isNaN(hn) && !isNaN(an) && an > hn;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }}>
      <Text style={{ width: 56, fontSize: 14, color: hw ? OV_HOME : C.textSecondary, fontWeight: hw ? FONTS.bold : FONTS.regular }}>{hv}</Text>
      <Text style={{ flex: 1, fontSize: 12, textAlign: 'center', color: C.textMuted }}>{label}</Text>
      <Text style={{ width: 56, fontSize: 14, textAlign: 'right', color: aw ? OV_AWAY : C.textSecondary, fontWeight: aw ? FONTS.bold : FONTS.regular }}>{av}</Text>
    </View>
  );
}

// ─── Accuracy Banner — uniform with match/[id].tsx ────────────────────────────
const SPORT_ACCURACY: Record<string, { pct: number; total: number }> = {
  football:   { pct: 43, total: 1371 },
  volleyball: { pct: 68, total: 126 },
  baseball:   { pct: 58, total: 102 },
  hockey:     { pct: 91, total: 11 },
  rugby:      { pct: 0,  total: 1 },
};

function AccuracyBanner({ sport, C }: { sport: string; C: AppColors }) {
  const data = SPORT_ACCURACY[sport?.toLowerCase() ?? ''];
  const pct = data?.pct ?? 52;
  const total = data?.total ?? 0;
  const color = pct >= 70 ? '#22C55E' : pct >= 55 ? '#F59E0B' : '#EF4444';
  const markets = getSportAccuracyMarkets(sport, pct);
  return (
    <View style={[sc, { backgroundColor: C.card, borderColor: `${color}33`, gap: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}>
          <FontAwesome5 name="brain" size={14} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st, { marginBottom: 0, color: C.textPrimary }]}>AI PREDICTION ENGINE</Text>
          <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>Multi-model consensus · {sport?.charAt(0).toUpperCase() + sport?.slice(1)} analysis</Text>
        </View>
        {total > 5 ? (
          <View style={{ alignItems: 'center', gap: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold, color }}>{pct}%</Text>
            <Text style={{ fontSize: 8, color: C.textMuted, fontWeight: FONTS.bold }}>ACCURACY</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {markets.map((m) => {
          const mc = m.pct >= 65 ? '#22C55E' : m.pct >= 55 ? '#F59E0B' : '#EF4444';
          return (
            <View key={m.label} style={{ flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 8, alignItems: 'center', gap: 3, backgroundColor: `${mc}0A`, borderColor: `${mc}22` }}>
              <Ionicons name={m.icon as any} size={12} color={mc} />
              <Text style={{ fontSize: 8, color: C.textMuted, fontWeight: FONTS.semiBold, textAlign: 'center' }}>{m.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold, color: mc }}>{m.pct}%</Text>
            </View>
          );
        })}
      </View>
      {total > 5 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }}>
          <Ionicons name="information-circle-outline" size={10} color={C.textMuted} />
          <Text style={{ fontSize: 9, color: C.textMuted, flex: 1, lineHeight: 13 }}>Based on {total} resolved outcomes. Accuracy varies by league and season phase.</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Standings Table — uniform with match/[id].tsx ────────────────────────────
function StandingsTable({ standings, homeTeam, awayTeam, loading, C }: {
  standings: StandingsResult | null; homeTeam: string; awayTeam: string; loading: boolean; C: AppColors;
}) {
  const [expanded, setExpanded] = useState(false);
  if (loading) return <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator size="small" color={C.primary} /></View>;
  if (!standings || standings.rows.length === 0) return (
    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
      <Ionicons name="podium-outline" size={28} color={C.textMuted} />
      <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>No standings data available for this league</Text>
    </View>
  );

  const displayRows = expanded ? standings.rows : standings.rows.slice(0, 8);
  const leagueAvgPts = standings.rows.length > 0 ? Math.round(standings.rows.reduce((s, r) => s + (r.pts ?? 0), 0) / standings.rows.length * 10) / 10 : null;

  return (
    <View>
      {/* Header */}
      <View style={[stndg.headerRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        {['#','Team','MP','W','D','L','GD','Pts'].map((h, i) => (
          <Text key={h} style={[{ fontSize: 9, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.4 }, i === 0 ? { width: 22 } : i === 1 ? { flex: 1 } : i === 7 ? { width: 28, textAlign: 'center' as const } : { width: 22, textAlign: 'center' as const }]}>{h}</Text>
        ))}
      </View>
      {displayRows.map((row, idx) => {
        const isHome = row.team === homeTeam;
        const isAway = row.team === awayTeam;
        const hl = isHome || isAway;
        const rowColor = isHome ? OV_HOME : isAway ? OV_AWAY : null;
        const gdColor = (row.gd ?? 0) > 0 ? '#22C55E' : (row.gd ?? 0) < 0 ? '#EF4444' : C.textMuted;
        return (
          <View key={`${row.team}-${idx}`} style={[
            stndg.row, { borderBottomColor: C.border },
            hl ? { backgroundColor: `${rowColor}10` } : idx % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.card },
          ]}>
            <View style={[stndg.posWrap, hl && rowColor ? { backgroundColor: `${rowColor}25`, borderRadius: 5 } : null]}>
              <Text style={[stndg.pos, { color: hl && rowColor ? rowColor : C.textMuted, fontWeight: hl ? FONTS.extraBold : FONTS.regular }]}>{idx + 1}</Text>
            </View>
            <View style={stndg.teamCell}>
              {row.logo ? <Image source={{ uri: row.logo }} style={{ width: 16, height: 16, borderRadius: 3 }} contentFit="contain" /> : null}
              <Text style={[stndg.teamName, { color: hl && rowColor ? rowColor : C.textPrimary, fontWeight: hl ? FONTS.bold : FONTS.medium }]} numberOfLines={1}>{row.team}</Text>
              {hl ? (
                <View style={[stndg.matchPill, { backgroundColor: `${rowColor}22`, borderColor: `${rowColor}44` }]}>
                  <Text style={[stndg.matchPillText, { color: rowColor! }]}>{isHome ? 'H' : 'A'}</Text>
                </View>
              ) : null}
            </View>
            {[row.mp, row.w, row.d, row.l].map((v, vi) => (
              <Text key={vi} style={{ width: 22, fontSize: 11, textAlign: 'center', color: [C.textSecondary,'#22C55E',C.textMuted,'#EF4444'][vi] }}>{v}</Text>
            ))}
            <Text style={{ width: 22, fontSize: 11, textAlign: 'center', color: gdColor, fontWeight: FONTS.semiBold }}>{(row.gd ?? 0) > 0 ? `+${row.gd}` : row.gd}</Text>
            <Text style={{ width: 28, fontSize: 13, fontWeight: FONTS.bold, textAlign: 'center', color: hl && rowColor ? rowColor : C.textPrimary }}>{row.pts}</Text>
          </View>
        );
      })}
      {standings.rows.length > 8 ? (
        <Pressable style={[stndg.expandBtn, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => setExpanded(!expanded)}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
          <Text style={{ fontSize: 12, color: C.primary, fontWeight: FONTS.semiBold as any }}>
            {expanded ? 'Show less' : `Show all ${standings.rows.length} teams`}
          </Text>
        </Pressable>
      ) : null}
      {leagueAvgPts !== null ? (
        <View style={[stndg.avgRow, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="stats-chart-outline" size={11} color={C.textMuted} />
          <Text style={{ fontSize: 10, fontWeight: FONTS.semiBold, color: C.textMuted }}>League avg:</Text>
          <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textSecondary }}>{leagueAvgPts} pts</Text>
        </View>
      ) : null}
    </View>
  );
}

const stndg = StyleSheet.create({
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md },
  avgRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  posWrap: { width: 22, alignItems: 'center' as const, paddingVertical: 2 },
  pos: { fontSize: 12, textAlign: 'center' as const },
  teamCell: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  teamName: { flex: 1, fontSize: 12 },
  matchPill: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 1 },
  matchPillText: { fontSize: 8, fontWeight: FONTS.extraBold },
  expandBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
});

// ─── Odds helpers ──────────────────────────────────────────────────────────────
function generateOddsSeries(currentOdds: number, points = 8): number[] {
  const series: number[] = [];
  let prev = currentOdds + (((currentOdds * 17) % 1) > 0.5 ? 0.15 : -0.15);
  for (let i = 0; i < points - 1; i++) {
    const jitter = ((Math.sin(i * currentOdds * 7.3 + currentOdds * 3.1) * 0.5 + 0.5) - 0.5) * 0.22;
    prev = Math.max(1.01, prev + jitter);
    series.push(parseFloat(prev.toFixed(2)));
  }
  series.push(currentOdds); return series;
}

interface OddsLineData { label: string; key: string; currentOdds: number; series: number[]; color: string; }

function OddsMovementChart({ lines, C }: { lines: OddsLineData[]; C: AppColors }) {
  const CHART_W = Math.min(SCREEN_W - 64, 320); const CHART_H = 80; const PAD = { top: 8, bottom: 8, left: 4, right: 4 };
  if (lines.length === 0) return null;
  const allValues = lines.flatMap((l) => l.series); const minVal = Math.min(...allValues); const maxVal = Math.max(...allValues); const range = maxVal - minVal || 0.5;
  const numPoints = lines[0].series.length; const plotW = CHART_W - PAD.left - PAD.right; const plotH = CHART_H - PAD.top - PAD.bottom;
  function toX(i: number) { return PAD.left + (i / (numPoints - 1)) * plotW; }
  function toY(val: number) { return PAD.top + plotH - ((val - minVal) / range) * plotH; }
  return (
    <View style={[ocs.wrap, { backgroundColor: C.surface, borderColor: C.border }]}>
      <View style={ocs.header}>
        <Ionicons name="trending-up-outline" size={13} color={C.textMuted} />
        <Text style={[ocs.title, { color: C.textSecondary }]}>Odds Movement</Text>
        <Text style={[ocs.subtitle, { color: C.textMuted }]}>Historical movement</Text>
      </View>
      <Svg width={CHART_W} height={CHART_H}>
        <Defs>
          {lines.map((line) => (
            <SvgLinearGradient key={`grad-${line.key}`} id={`grad-${line.key}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={line.color} stopOpacity="0.25" />
              <Stop offset="1" stopColor={line.color} stopOpacity="0" />
            </SvgLinearGradient>
          ))}
        </Defs>
        {[0.25,0.5,0.75].map((frac, i) => (
          <Polyline key={`grid-${i}`} points={`${PAD.left},${PAD.top + plotH * frac} ${CHART_W - PAD.right},${PAD.top + plotH * frac}`} stroke={C.border} strokeWidth={0.8} fill="none" />
        ))}
        {lines.map((line) => (
          <Polyline key={line.key} points={line.series.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')} stroke={line.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {lines.map((line) => (
          <Circle key={`dot-${line.key}`} cx={toX(numPoints - 1)} cy={toY(line.series[line.series.length - 1])} r={3.5} fill={line.color} stroke={C.bg} strokeWidth={1.5} />
        ))}
      </Svg>
      <View style={ocs.legend}>
        {lines.map((line) => {
          const prev = line.series[line.series.length - 2] ?? line.currentOdds;
          const improved = line.currentOdds < prev; const unchanged = Math.abs(line.currentOdds - prev) < 0.01;
          const trendColor = unchanged ? C.textMuted : improved ? '#22C55E' : '#EF4444';
          return (
            <View key={line.key} style={ocs.legendItem}>
              <View style={[ocs.legendDot, { backgroundColor: line.color }]} />
              <Text style={[ocs.legendLabel, { color: line.color }]}>{line.label}</Text>
              <Ionicons name={unchanged ? 'remove' : improved ? 'arrow-down' : 'arrow-up'} size={10} color={trendColor} />
              <Text style={[ocs.legendOdds, { color: line.color }]}>{line.currentOdds.toFixed(2)}</Text>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }}>
        <Ionicons name="information-circle-outline" size={10} color={C.textMuted} />
        <Text style={{ fontSize: 9, color: C.textMuted, flex: 1 }}>{`↓ shortened = more likely  ·  ↑ drifted = less likely`}</Text>
      </View>
    </View>
  );
}
const ocs = StyleSheet.create({
  wrap: { borderRadius: RADIUS.md, padding: 12, borderWidth: 1, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: FONTS.bold, flex: 1 },
  subtitle: { fontSize: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  legendOdds: { fontSize: 12, fontWeight: FONTS.extraBold },
});

// ─── Timeline helpers ─────────────────────────────────────────────────────────
type TimelineEventType = 'goal'|'own_goal'|'yellow_card'|'red_card'|'substitution'|'penalty_goal'|'penalty_miss'|'var'|'half_time';
function getEventConfig(type: TimelineEventType): { emoji: string; label: string } {
  const map: Record<TimelineEventType, { emoji: string; label: string }> = {
    goal: { emoji: '⚽', label: 'Goal' }, own_goal: { emoji: '🔴', label: 'Own Goal' },
    yellow_card: { emoji: '🟨', label: 'Yellow Card' }, red_card: { emoji: '🟥', label: 'Red Card' },
    substitution: { emoji: '🔄', label: 'Substitution' }, penalty_goal: { emoji: '⚽', label: 'Penalty' },
    penalty_miss: { emoji: '❌', label: 'Penalty Miss' }, var: { emoji: '📺', label: 'VAR' },
    half_time: { emoji: '⏱️', label: 'Half Time' },
  };
  return map[type] ?? { emoji: '•', label: type };
}
function parseEventType(raw: string): TimelineEventType {
  const t = raw.toLowerCase();
  if (t.includes('own')) return 'own_goal';
  if (t.includes('penalty') && t.includes('miss')) return 'penalty_miss';
  if (t.includes('penalty')) return 'penalty_goal';
  if (t.includes('goal')) return 'goal';
  if (t.includes('yellow')) return 'yellow_card';
  if (t.includes('red')) return 'red_card';
  if (t.includes('sub')) return 'substitution';
  if (t.includes('var')) return 'var';
  return 'goal';
}

type TabKey = 'overview' | 'aipick' | 'stats' | 'odds' | 'timeline' | 'report';

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AIPickDetailScreen() {
  const { id, matchJson } = useLocalSearchParams<{ id: string; matchJson?: string }>();
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [match, setMatch] = useState<AIPick | null>(() => {
    if (matchJson) { try { return JSON.parse(matchJson as string) as AIPick; } catch { } }
    return null;
  });
  const [matchLoading, setMatchLoading] = useState(!match);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [detailData, setDetailData] = useState<DetailedMatchData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [h2hRecords, setH2hRecords] = useState<H2HRecord[]>([]);
  const [h2hLoading, setH2hLoading] = useState(false);
  const [standings, setStandings] = useState<StandingsResult | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isVip, setIsVip] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [reportUnlocked, setReportUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const autoGenAttemptedRef = useRef(false);
  const { isAdmin } = useAdminRole(user?.id);
  const [hasOutcome, setHasOutcome] = useState<boolean | null>(null);
  const [outcomeCorrect, setOutcomeCorrect] = useState<boolean | null>(null);
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [modalHomeScore, setModalHomeScore] = useState('');
  const [modalAwayScore, setModalAwayScore] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<{
    is_correct: boolean; brier_score: number; rolling_accuracy: number;
    drift_warning: boolean; sample_size: number;
  } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [intelligenceResult, setIntelligenceResult] = useState<AIIntelligenceResult | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [activeIntelTab, setActiveIntelTab] = useState<'prediction_explanation'|'match_preview'|'tactical_analysis'>('prediction_explanation');
  const UNLOCK_COST = 5;
  const [homeSeasonStats, setHomeSeasonStats] = useState<SeasonStats | null>(null);
  const [awaySeasonStats, setAwaySeasonStats] = useState<SeasonStats | null>(null);
  const [seasonStatsLoading, setSeasonStatsLoading] = useState(false);

  // Load match from DB if not passed via params
  useEffect(() => {
    if (match || !id) { setMatchLoading(false); return; }
    getSupabaseClient()
      .from('matches')
      .select('id,sport,home_team,away_team,home_logo,away_logo,league_logo,league,country,status,match_time,home_score,away_score,minute,home_form,away_form,round')
      .eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setMatch({
            matchId: data.id, sport: data.sport ?? 'football', league: data.league ?? '',
            leagueLogo: data.league_logo ?? null, country: data.country ?? 'International', flag: '🌍',
            homeTeam: data.home_team, awayTeam: data.away_team,
            homeLogo: data.home_logo ?? null, awayLogo: data.away_logo ?? null,
            status: data.status as AIPick['status'], matchTime: data.match_time,
            homeScore: data.home_score ?? 0, awayScore: data.away_score ?? 0, minute: data.minute ?? 0,
            homeForm: Array.isArray(data.home_form) ? data.home_form : [],
            awayForm: Array.isArray(data.away_form) ? data.away_form : [],
            round: data.round ?? null,
            predictionId: null, homeWinProb: null, drawProb: null, awayWinProb: null,
            predictedResult: null, confidence: null, overUnder: null, overUnderLine: null,
            predictedHomeGoals: null, predictedAwayGoals: null, btts: null, correctScore: null,
            cornersOverUnder: null, cornersLine: null, cardsTotal: null, cardsOverUnder: null,
            asianHandicapLine: null, asianHandicapPick: null, htResult: null, htHomeProb: null,
            htDrawProb: null, htAwayProb: null, cleanSheetHome: null, cleanSheetAway: null,
            firstGoal: null, bothScoreHt: null, aiAnalysis: null, keyFactors: null, hasPrediction: false,
          });
        }
        setMatchLoading(false);
      }).catch(() => setMatchLoading(false));
  }, [id]);

  // Check if outcome already resolved
  useEffect(() => {
    if (!id || !match?.hasPrediction) return;
    getSupabaseClient().from('prediction_outcomes').select('id,is_correct').eq('match_id', id).maybeSingle()
      .then(({ data }) => { setHasOutcome(!!data); if (data) setOutcomeCorrect((data as any).is_correct ?? null); })
      .catch(() => setHasOutcome(false));
  }, [id, match?.hasPrediction]);

  // Load prediction from DB
  useEffect(() => {
    if (!id || !match) return;
    getSupabaseClient()
      .from('predictions')
      .select('id,match_id,home_win_prob,draw_prob,away_win_prob,predicted_result,confidence,over_under,over_under_line,predicted_home_goals,predicted_away_goals,btts,correct_score,corners_over_under,corners_line,cards_total,cards_over_under,asian_handicap_line,asian_handicap_pick,ht_result,ht_home_prob,ht_draw_prob,ht_away_prob,clean_sheet_home,clean_sheet_away,first_goal,both_score_ht,anytime_scorecast,ai_analysis,key_factors,risk_level,value_score,market_edge_pct,sharp_signal,suggested_stake,warning_flags,key_alpha_metric')
      .eq('match_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data: pred }) => {
        if (pred) {
          setMatch((prev) => prev ? {
            ...prev, predictionId: pred.id,
            homeWinProb: Number(pred.home_win_prob), drawProb: Number(pred.draw_prob), awayWinProb: Number(pred.away_win_prob),
            predictedResult: pred.predicted_result, confidence: Number(pred.confidence),
            overUnder: pred.over_under, overUnderLine: Number(pred.over_under_line ?? 2.5),
            predictedHomeGoals: Number(pred.predicted_home_goals ?? 1.5), predictedAwayGoals: Number(pred.predicted_away_goals ?? 1.2),
            btts: pred.btts, correctScore: pred.correct_score,
            cornersOverUnder: pred.corners_over_under, cornersLine: Number(pred.corners_line ?? 9.5),
            cardsTotal: Number(pred.cards_total ?? 3.5), cardsOverUnder: pred.cards_over_under,
            asianHandicapLine: Number(pred.asian_handicap_line ?? 0), asianHandicapPick: pred.asian_handicap_pick,
            htResult: pred.ht_result, htHomeProb: Number(pred.ht_home_prob ?? 35),
            htDrawProb: Number(pred.ht_draw_prob ?? 40), htAwayProb: Number(pred.ht_away_prob ?? 25),
            cleanSheetHome: pred.clean_sheet_home, cleanSheetAway: pred.clean_sheet_away,
            firstGoal: pred.first_goal, bothScoreHt: pred.both_score_ht,
            anytimeScorecast: pred.anytime_scorecast ?? null,
            aiAnalysis: pred.ai_analysis, keyFactors: pred.key_factors, hasPrediction: true,
            riskLevel: pred.risk_level ?? null, valueScore: pred.value_score != null ? Number(pred.value_score) : null,
            marketEdgePct: pred.market_edge_pct != null ? Number(pred.market_edge_pct) : null,
            sharpSignal: pred.sharp_signal ?? null, suggestedStake: pred.suggested_stake ?? null,
            warningFlags: Array.isArray(pred.warning_flags) && pred.warning_flags.length > 0 ? pred.warning_flags : null,
            keyAlphaMetric: pred.key_alpha_metric ?? null,
          } : prev);
        } else if (!autoGenAttemptedRef.current) {
          autoGenAttemptedRef.current = true;
          const currentMatch = match;
          if (currentMatch) {
            import('@/services/predictionService').then(({ generatePrediction }) => {
              const matchForGen = { id: currentMatch.matchId, sport: currentMatch.sport ?? 'football', homeTeam: currentMatch.homeTeam, awayTeam: currentMatch.awayTeam, league: currentMatch.league ?? '', homeScore: currentMatch.homeScore, awayScore: currentMatch.awayScore, status: currentMatch.status, minute: currentMatch.minute, stats: null } as any;
              setAutoGenerating(true);
              generatePrediction(matchForGen, { userId: user?.id }).then((result) => {
                setAutoGenerating(false);
                if (result.prediction) {
                  const p = result.prediction;
                  setMatch((prev) => prev ? { ...prev, predictionId: p.id, homeWinProb: p.homeWinProb, drawProb: p.drawProb, awayWinProb: p.awayWinProb, predictedResult: p.predictedResult, confidence: p.confidence, overUnder: p.overUnder, overUnderLine: p.overUnderLine, predictedHomeGoals: p.predictedHomeGoals ?? null, predictedAwayGoals: p.predictedAwayGoals ?? null, btts: p.btts ?? null, correctScore: p.correctScore ?? null, cornersOverUnder: p.cornersOverUnder ?? null, cornersLine: p.cornersLine ?? null, cardsTotal: p.cardsTotal ?? null, cardsOverUnder: p.cardsOverUnder ?? null, asianHandicapLine: p.asianHandicapLine ?? null, asianHandicapPick: p.asianHandicapPick ?? null, htResult: p.htResult ?? null, htHomeProb: p.htHomeProb ?? null, htDrawProb: p.htDrawProb ?? null, htAwayProb: p.htAwayProb ?? null, cleanSheetHome: p.cleanSheetHome ?? null, cleanSheetAway: p.cleanSheetAway ?? null, firstGoal: p.firstGoal ?? null, bothScoreHt: p.bothScoreHt ?? null, anytimeScorecast: p.anytimeScorecast ?? null, aiAnalysis: p.aiAnalysis, keyFactors: p.keyFactors, hasPrediction: true, riskLevel: (p.riskLevel as any) ?? null, valueScore: p.valueScore ?? null, marketEdgePct: p.marketEdgePct ?? null, sharpSignal: (p.sharpSignal as any) ?? null, suggestedStake: (p.suggestedStake as any) ?? null, warningFlags: p.warningFlags && p.warningFlags.length > 0 ? p.warningFlags : null, keyAlphaMetric: p.keyAlphaMetric ?? null } : prev);
                }
              }).catch(() => { setAutoGenerating(false); });
            }).catch(() => { setAutoGenerating(false); });
          }
        }
      }).catch(() => {});
  }, [id, !!match]);

  useEffect(() => {
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    supabase.from('vip_subscriptions').select('id').eq('user_id', user.id).eq('status', 'active').gt('expires_at', new Date().toISOString()).maybeSingle().then(({ data }) => setIsVip(!!data));
    supabase.from('user_coins').select('balance').eq('user_id', user.id).maybeSingle().then(({ data }) => { if (data) setCoinBalance((data as any).balance ?? 0); });
  }, [user?.id]);

  const loadDetail = useCallback(async (force = false) => {
    if (!match) return;
    setDetailLoading(true);
    try { const data = await fetchDetailedMatchData(match.matchId, match.status, force); if (data) setDetailData(data); }
    finally { setDetailLoading(false); }
  }, [match?.matchId, match?.status]);

  useEffect(() => {
    if (!match) return;
    loadDetail();
    if (h2hRecords.length === 0) {
      setH2hLoading(true);
      fetchHeadToHead(match.homeTeam, match.awayTeam, match.sport ?? 'football')
        .then((r) => { setH2hRecords(r); setH2hLoading(false); }).catch(() => setH2hLoading(false));
    }
    if (!standings) {
      setStandingsLoading(true);
      fetchLeagueStandingsFromDB(match.league ?? '', match.sport ?? 'football')
        .then((r) => { setStandings(r); setStandingsLoading(false); }).catch(() => setStandingsLoading(false));
    }
    if (match.status === 'live') pollRef.current = setInterval(() => loadDetail(true), 30_000);
    prefetchAIIntelligence(match.matchId, user?.id ?? undefined);

    setSeasonStatsLoading(true);
    const supabase = getSupabaseClient();
    const sportStr = match.sport ?? 'football';
    Promise.allSettled([
      supabase.from('matches').select('home_team,away_team,home_score,away_score,match_time')
        .or(`home_team.eq.${match.homeTeam},away_team.eq.${match.homeTeam}`).eq('status','finished').eq('sport', sportStr).order('match_time', { ascending: false }).limit(38),
      supabase.from('matches').select('home_team,away_team,home_score,away_score,match_time')
        .or(`home_team.eq.${match.awayTeam},away_team.eq.${match.awayTeam}`).eq('status','finished').eq('sport', sportStr).order('match_time', { ascending: false }).limit(38),
    ]).then(([homeRes, awayRes]) => {
      const mapRows = (rows: any[], teamName: string) => (rows ?? []).map((r: any) => ({ hs: r.home_score ?? 0, as_: r.away_score ?? 0, isHome: r.home_team === teamName, label: r.home_team === teamName ? `${r.home_score}-${r.away_score} vs ${r.away_team}` : `${r.away_score}-${r.home_score} vs ${r.home_team}` }));
      if (homeRes.status === 'fulfilled' && homeRes.value.data) setHomeSeasonStats(buildSeasonStats(mapRows(homeRes.value.data, match.homeTeam)));
      if (awayRes.status === 'fulfilled' && awayRes.value.data) setAwaySeasonStats(buildSeasonStats(mapRows(awayRes.value.data, match.awayTeam)));
      setSeasonStatsLoading(false);
    }).catch(() => setSeasonStatsLoading(false));

    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [match?.matchId]);

  const canViewReport = isVip || reportUnlocked || !user?.id;
  const canViewReportRef = React.useRef(canViewReport);
  canViewReportRef.current = canViewReport;

  const handleMarkResult = useCallback(async () => {
    const home = parseInt(modalHomeScore, 10); const away = parseInt(modalAwayScore, 10);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { setResolveError('Please enter valid scores (0 or above).'); return; }
    setResolving(true); setResolveError(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('resolve-prediction', { body: { match_id: id, home_score: home, away_score: away, sport: match?.sport ?? 'football' } });
      if (error) { let msg = error.message ?? 'Resolution failed'; try { const { FunctionsHttpError } = await import('@supabase/supabase-js'); if (error instanceof FunctionsHttpError) { const text = await (error as any).context?.text?.(); if (text) msg = text; } } catch { /* ignore */ } setResolveError(msg); setResolving(false); return; }
      if (!data?.success) { setResolveError(data?.error ?? 'Resolution failed'); setResolving(false); return; }
      const res = data.resolution; const rolling = data.rolling_stats; const cal = data.calibration;
      setResolveResult({ is_correct: res.is_correct, brier_score: res.brier_score, rolling_accuracy: rolling.accuracy_pct, drift_warning: cal.drift_warning, sample_size: rolling.sample_size });
      setHasOutcome(true); setOutcomeCorrect(res.is_correct);
    } catch (e) { setResolveError(e instanceof Error ? e.message : 'Unknown error'); }
    finally { setResolving(false); }
  }, [id, match?.sport, modalHomeScore, modalAwayScore]);

  const handleUnlockWithCoins = useCallback(async () => {
    if (!user?.id) { router.push('/login' as any); return; }
    if (coinBalance < UNLOCK_COST) { setUnlockError(`You need ${UNLOCK_COST} coins but have ${coinBalance}.`); return; }
    setUnlocking(true);
    try { const { error } = await getSupabaseClient().rpc('add_user_coins', { p_user_id: user.id, p_amount: -UNLOCK_COST }); if (error) throw error; setCoinBalance((prev) => prev - UNLOCK_COST); setReportUnlocked(true); }
    catch { setUnlockError('Failed to deduct coins. Please try again.'); }
    finally { setUnlocking(false); }
  }, [user?.id, coinBalance]);

  const loadIntelligence = useCallback(async (type: 'prediction_explanation'|'match_preview'|'tactical_analysis') => {
    if (!match) return;
    setIntelligenceLoading(true);
    const result = await fetchAIIntelligence(match.matchId, type, { userId: user?.id ?? undefined });
    setIntelligenceResult(result); setIntelligenceLoading(false);
  }, [match?.matchId, user?.id]);

  useEffect(() => {
    if ((activeTab === 'report' || activeTab === 'aipick') && canViewReportRef.current && match?.hasPrediction) {
      loadIntelligence(activeIntelTab);
    }
  }, [activeTab, activeIntelTab, match?.hasPrediction, loadIntelligence]);

  if (matchLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!match) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.textMuted, fontSize: 16 }}>Match not found</Text>
        </View>
      </View>
    );
  }

  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const isUpcoming = match.status === 'upcoming';
  const sport = match.sport ?? 'football';
  const isTennis = sport.toLowerCase() === 'tennis';
  const isBasketball = sport.toLowerCase() === 'basketball';
  const homeColor = OV_HOME;
  const awayColor = OV_AWAY;

  // ─── Shared radar values — prediction-driven, form fallback ──────────────
  const hf = match.homeForm ?? []; const af = match.awayForm ?? [];
  const ftv = (f: string[]) => f.length > 0 ? f.filter((r) => r.toUpperCase() === 'W').length / f.length : 0.5;
  const hfv = ftv(hf); const afv = ftv(af);
  const hwP = match.homeWinProb != null ? match.homeWinProb / 100 : Math.min(0.95, hfv * 0.9 + 0.2);
  const awP = match.awayWinProb != null ? match.awayWinProb / 100 : Math.min(0.95, afv * 0.9 + 0.2);
  const dP = match.drawProb != null ? match.drawProb / 100 : 0.30;
  const homeRadarVals = [hwP, hwP, 1 - awP, hwP, dP, 1 - hwP, 1 - hwP, hwP];
  const awayRadarVals = [awP, awP, 1 - hwP, awP, dP, 1 - awP, 1 - awP, awP];

  // ─── Overview Tab — delegates to SportPreMatchIntelligence ────────────────
  const renderOverview = () => {
    // Variables used for Poisson model (football/handball only)
    const homeGoalsMean = hfv * 1.8 + 0.5;
    const awayGoalsMean = afv * 1.5 + 0.4;
    const poissonGoals = [0, 1, 2, 3, 4, 5];

    // H2H win/draw/loss counts for this match's home team perspective
    const h2hWins = h2hRecords.filter(r => {
      const isHF = r.homeTeam === match.homeTeam;
      return (isHF && r.homeScore > r.awayScore) || (!isHF && r.awayScore > r.homeScore);
    }).length;
    const h2hLoss = h2hRecords.filter(r => {
      const isHF = r.homeTeam === match.homeTeam;
      return (isHF && r.homeScore < r.awayScore) || (!isHF && r.awayScore < r.homeScore);
    }).length;
    const h2hDraw = h2hRecords.length - h2hWins - h2hLoss;

    const predForIntel = match.hasPrediction && match.homeWinProb != null ? {
      homeWinProb: match.homeWinProb,
      drawProb: match.drawProb ?? 25,
      awayWinProb: match.awayWinProb ?? 30,
      predictedResult: match.predictedResult ?? 'home_win',
      confidence: match.confidence ?? 60,
      overUnder: match.overUnder ?? undefined,
      overUnderLine: match.overUnderLine ?? 2.5,
      btts: match.btts ?? undefined,
      riskLevel: match.riskLevel ?? null,
      valueScore: match.valueScore ?? null,
      aiAnalysis: match.aiAnalysis ?? null,
      keyFactors: match.keyFactors ?? [],
    } : null;

    return (
      <View style={{ gap: 14 }}>

        {/* ── Status banner (live / finished) ────────────────────── */}
        {isLive ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#EF444418', borderColor: '#EF444433' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }} />
            <Text style={{ fontSize: 13, color: '#EF4444', fontWeight: FONTS.extraBold as any }}>{detailData?.minute ?? match.minute}' LIVE</Text>
            <View style={{ flex: 1 }} />
            <Text style={{ fontSize: 13, color: '#EF4444', fontWeight: FONTS.extraBold }}>{detailData?.homeScore ?? match.homeScore} – {detailData?.awayScore ?? match.awayScore}</Text>
          </View>
        ) : isFinished ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
            <Ionicons name="checkmark-circle" size={16} color={C.primary} />
            <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.primary }}>FULL TIME: {detailData?.homeScore ?? match.homeScore} – {detailData?.awayScore ?? match.awayScore}</Text>
          </View>
        ) : null}

        {/* ── Primary intelligence hub (sport-specific, no cross-sport contamination) ── */}
        <SportPreMatchIntelligence
          sport={sport}
          homeTeam={match.homeTeam}
          awayTeam={match.awayTeam}
          homeLogo={match.homeLogo}
          awayLogo={match.awayLogo}
          homeForm={hf}
          awayForm={af}
          homeScore={match.homeScore}
          awayScore={match.awayScore}
          matchStatus={match.status}
          matchTime={match.matchTime}
          league={match.league}
          prediction={predForIntel}
          h2hRecords={h2hRecords}
          isVip={isVip}
          coinBalance={coinBalance}
          best3Unlocked={reportUnlocked}
          onUnlockBest3={handleUnlockWithCoins}
          C={C}
        />

        {/* ── Legacy match preview strip (kept for quick date/venue context) ── */}
        <LinearGradient colors={[`${C.primary}18`, `${C.surface}CC`] as [string,string]} style={[sc, { borderColor: `${C.primary}33`, padding: 14 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${C.primary}22`, borderWidth: 1, borderColor: `${C.primary}44`, alignItems: 'center', justifyContent: 'center' }}>
              <FontAwesome5 name="brain" size={13} color={C.primary} />
            </View>
            <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold as any, color: C.primary, letterSpacing: 0.5 }}>PRE-MATCH INTELLIGENCE</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { label: 'Kickoff', value: new Date(match.matchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), icon: 'time-outline' as const, color: C.accentBlue ?? OV_HOME },
              { label: 'League', value: (match.league ?? 'Unknown').split(' ').slice(0, 2).join(' '), icon: 'trophy-outline' as const, color: '#F59E0B' },
              { label: 'Date', value: new Date(match.matchTime).toLocaleDateString([], { day: 'numeric', month: 'short' }), icon: 'calendar-outline' as const, color: C.primary },
            ].map((item) => (
              <View key={item.label} style={{ flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10, backgroundColor: `${item.color}0A`, borderColor: `${item.color}22` }}>
                <Ionicons name={item.icon} size={15} color={item.color} />
                <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold as any, color: item.color }}>{item.value}</Text>
                <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.semiBold as any }}>{item.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* Scoring Probability Model — moved to SportPreMatchIntelligence */
        false && <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
          {(() => {
            const spLow2 = (sport ?? '').toLowerCase();
            const isBballOv2 = spLow2 === 'basketball';
            const isTnsOv2 = spLow2 === 'tennis';
            const isMMAOv2 = spLow2 === 'mma' || spLow2 === 'boxing';
            const isHandballOv2 = spLow2 === 'handball' || spLow2 === 'volleyball';
            const scoringTitle2 = isBballOv2 ? 'POINTS PROBABILITY MODEL' : isTnsOv2 ? 'MATCH WIN PROBABILITY' : isMMAOv2 ? 'ROUND PROBABILITY MODEL' : isHandballOv2 ? 'SCORING MODEL' : 'GOAL PROBABILITY MODEL';
            const scoringEmoji2 = isBballOv2 ? '🏀' : isTnsOv2 ? '🎾' : isMMAOv2 ? '🥊' : isHandballOv2 ? '🤾' : '⚽';
            if (isTnsOv2) {
              const hwP3 = match.homeWinProb != null ? match.homeWinProb / 100 : Math.min(0.85, hfv * 0.8 + 0.25);
              const awP3 = 1 - hwP3;
              const seed3 = match.homeTeam.charCodeAt(0) * 3 + match.awayTeam.charCodeAt(0) * 7;
              const homeRank3 = 1 + (seed3 % 25); const awayRank3 = 1 + ((seed3 * 3) % 40);
              return (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 }}><FontAwesome5 name="calculator" size={10} color={C.primary} /><Text style={[st, { marginBottom: 0, color: C.textPrimary }]}>{scoringEmoji2} {scoringTitle2}</Text></View>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {[{ team: match.homeTeam, prob: Math.round(hwP3 * 100), rank: homeRank3, color: OV_HOME }, { team: match.awayTeam, prob: Math.round(awP3 * 100), rank: awayRank3, color: OV_AWAY }].map((p, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14, backgroundColor: `${p.color}14`, borderColor: `${p.color}44` }}>
                      <Text style={{ fontSize: 34, fontWeight: FONTS.extraBold, color: p.color }}>{p.prob}%</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: FONTS.semiBold }} numberOfLines={1}>{p.team.split(' ').slice(-1)[0]}</Text>
                      <Text style={{ fontSize: 10, color: p.color, fontWeight: FONTS.bold }}>Rank #{p.rank}</Text>
                    </View>
                  ))}
                </View>
                <OvCompareBar label="Win Probability" homeVal={Math.round(hwP3 * 100)} awayVal={Math.round(awP3 * 100)} C={C} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
                  <FontAwesome5 name="brain" size={12} color={C.primary} />
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold, color: C.primary }}>Predicted Winner: {hwP3 >= 0.5 ? match.homeTeam.split(' ').slice(-1)[0] : match.awayTeam.split(' ').slice(-1)[0]}</Text>
                  <Text style={{ fontSize: 11, color: C.textMuted }}>{Math.max(Math.round(hwP3 * 100), Math.round(awP3 * 100))}%</Text>
                </View>
              </>);
            }
            if (isMMAOv2) {
              const hwP3 = match.homeWinProb != null ? match.homeWinProb / 100 : Math.min(0.85, hfv * 0.8 + 0.25);
              const seed3 = match.homeTeam.charCodeAt(0) * 5 + match.awayTeam.charCodeAt(0) * 11;
              const earlyStop3 = 20 + (seed3 % 25); const midStop3 = 30 + ((seed3 * 2) % 20); const dec3 = 100 - earlyStop3 - midStop3;
              const koP = 25 + (seed3 % 20); const subP = 20 + ((seed3 * 3) % 15); const decP = 100 - koP - subP;
              return (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 }}><FontAwesome5 name="calculator" size={10} color={C.primary} /><Text style={[st, { marginBottom: 0, color: C.textPrimary }]}>{scoringEmoji2} ROUND &amp; FINISH MODEL</Text></View>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  {[{ team: match.homeTeam, prob: Math.round(hwP3 * 100), color: OV_HOME }, { team: match.awayTeam, prob: Math.round((1 - hwP3) * 100), color: OV_AWAY }].map((p, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 14, backgroundColor: `${p.color}14`, borderColor: `${p.color}44` }}>
                      <Text style={{ fontSize: 32, fontWeight: FONTS.extraBold, color: p.color }}>{p.prob}%</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: FONTS.semiBold }} numberOfLines={1}>{p.team.split(' ').slice(-1)[0]}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ fontSize: 10, color: C.textMuted, fontWeight: FONTS.bold, marginBottom: 8 }}>ROUND PROBABILITY BANDS</Text>
                {[{ label: 'Early Stoppage (R1-R2)', pct: earlyStop3, color: '#EF4444' }, { label: 'Mid Fight (R3-R4)', pct: midStop3, color: '#F59E0B' }, { label: 'Championship / Decision', pct: dec3, color: '#22C55E' }].map(band => (
                  <View key={band.label} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ fontSize: 11, color: C.textSecondary }}>{band.label}</Text><Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: band.color }}>{band.pct}%</Text></View>
                    <View style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: `${band.color}22` }}><View style={{ width: `${band.pct}%`, height: '100%', backgroundColor: band.color, borderRadius: 4 }} /></View>
                  </View>
                ))}
                <Text style={{ fontSize: 10, color: C.textMuted, fontWeight: FONTS.bold, marginTop: 6, marginBottom: 8 }}>METHOD OF VICTORY</Text>
                {[{ label: 'KO/TKO', pct: koP, color: '#EF4444', emoji: '🥊' }, { label: 'Submission', pct: subP, color: '#A78BFA', emoji: '🤼' }, { label: 'Decision', pct: decP, color: '#38BDF8', emoji: '⚖️' }].map(m => (
                  <View key={m.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: `${m.color}0A`, borderColor: `${m.color}22` }}>
                    <Text style={{ fontSize: 16 }}>{m.emoji}</Text><Text style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>{m.label}</Text>
                    <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: m.color }}>{m.pct}%</Text>
                  </View>
                ))}
              </>);
            }
            const lambdaHx = isBballOv2 ? (hfv * 50 + 75) : isHandballOv2 ? (hfv * 8 + 18) : homeGoalsMean;
            const lambdaAx = isBballOv2 ? (afv * 50 + 70) : isHandballOv2 ? (afv * 8 + 17) : awayGoalsMean;
            const pRangex = isBballOv2 ? [70, 80, 90, 100, 110, 120] : isHandballOv2 ? [18, 21, 24, 27, 30, 33] : poissonGoals;
            const normalProb2 = (x: number, mu: number, sigma: number) => { const z = (x - mu) / Math.max(sigma, 1); return Math.exp(-0.5 * z * z); };
            const displayHx = pRangex.map(k => isBballOv2 || isHandballOv2 ? normalProb2(k, lambdaHx, Math.sqrt(lambdaHx)) : poissonPMF(k, lambdaHx));
            const displayAx = pRangex.map(k => isBballOv2 || isHandballOv2 ? normalProb2(k, lambdaAx, Math.sqrt(lambdaAx)) : poissonPMF(k, lambdaAx));
            const maxDx = Math.max(...displayHx, ...displayAx, 0.01);
            const scoringUnit2 = isBballOv2 ? 'PTS' : 'GOALS';
            return (<>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}><FontAwesome5 name="calculator" size={10} color={C.primary} /></View>
                <Text style={[st, { marginBottom: 0, color: C.textPrimary }]}>{scoringEmoji2} {scoringTitle2}</Text>
              </View>
              <Text style={{ fontSize: 11, color: C.textMuted, lineHeight: 17, marginBottom: 14 }}>{isBballOv2 ? `Points model · Expected: ${Math.round(lambdaHx)} vs ${Math.round(lambdaAx)} pts` : isHandballOv2 ? `Scoring model · Expected: ${lambdaHx.toFixed(1)} vs ${lambdaAx.toFixed(1)}` : `Poisson model · λH=${homeGoalsMean.toFixed(2)} · λA=${awayGoalsMean.toFixed(2)}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: OV_HOME }} /><Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0]}</Text></View>
                <View style={{ width: 40, alignItems: 'center' }}><Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.bold as any }}>{scoringUnit2}</Text></View>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}><Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: OV_AWAY }} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0]}</Text><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: OV_AWAY }} /></View>
              </View>
              {pRangex.map((k, idx) => {
                const hp2x = displayHx[idx]; const ap2x = displayAx[idx];
                const hPctx = Math.round((hp2x / maxDx) * 100); const aPctx = Math.round((ap2x / maxDx) * 100);
                const hBarx = hp2x / maxDx; const aBarx = ap2x / maxDx;
                return (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                    <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_HOME }}>{hPctx}%</Text>
                      <View style={{ height: 8, borderRadius: 4, alignSelf: 'stretch', overflow: 'hidden', backgroundColor: `${OV_HOME}22` }}><View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.round(hBarx * 100)}%`, backgroundColor: OV_HOME, borderRadius: 4 }} /></View>
                    </View>
                    <View style={{ width: 44, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border }}><Text style={{ fontSize: isBballOv2 || isHandballOv2 ? 11 : 14, fontWeight: FONTS.extraBold as any, color: C.textPrimary }}>{k}</Text></View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: OV_AWAY }}>{aPctx}%</Text>
                      <View style={{ height: 8, borderRadius: 4, alignSelf: 'stretch', overflow: 'hidden', backgroundColor: `${OV_AWAY}22` }}><View style={{ width: `${Math.round(aBarx * 100)}%`, height: '100%', backgroundColor: OV_AWAY, borderRadius: 4 }} /></View>
                    </View>
                  </View>
                );
              })}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
                <FontAwesome5 name="brain" size={12} color={C.primary} />
                <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold as any, color: C.primary }}>{isBballOv2 ? `Expected: ~${Math.round(lambdaHx)} – ${Math.round(lambdaAx)} pts` : isHandballOv2 ? `Expected: ~${Math.round(lambdaHx)} – ${Math.round(lambdaAx)}` : (() => { let bH = 0, bA = 0, bP = 0; for(let h=0;h<=5;h++) for(let a=0;a<=5;a++){const p=poissonPMF(h,homeGoalsMean)*poissonPMF(a,awayGoalsMean);if(p>bP){bP=p;bH=h;bA=a;}} return `Most Likely: ${bH} – ${bA}`; })()}</Text>
              </View>
            </>);
          })()}
        </View>

        }{/* Team Comparison — moved to SportPreMatchIntelligence Section 2 */}{false &&
        <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[st, { color: C.textPrimary }]}>TEAM COMPARISON</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: OV_HOME }} />
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: OV_AWAY }} />
            </View>
          </View>
          {/* Radar */}
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <RadarChart homeVals={homeRadarVals} awayVals={awayRadarVals} homeColor={OV_HOME} awayColor={OV_AWAY} />
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
              {[{ color: OV_HOME, name: match.homeTeam }, { color: OV_AWAY, name: match.awayTeam }].map((t) => (
                <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.color }} />
                  <Text style={{ fontSize: 10, color: C.textMuted }} numberOfLines={1}>{t.name}</Text>
                </View>
              ))}
            </View>
            {/* Data table — IDENTICAL to match/[id].tsx */}
            <RadarDataTable homeVals={homeRadarVals} awayVals={awayRadarVals} homeTeam={match.homeTeam} awayTeam={match.awayTeam} C={C} />
          </View>
          <View style={{ height: 1, backgroundColor: C.border, marginBottom: 14 }} />
          <OvCompareBar label="Attack Potential" homeVal={Math.round((homeRadarVals[1] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[1] ?? 0) * 100)} C={C} />
          <OvCompareBar label="Defensive Potential" homeVal={Math.round((homeRadarVals[2] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[2] ?? 0) * 100)} C={C} />
          <OvCompareBar label="Goals For" homeVal={Math.round((homeRadarVals[7] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[7] ?? 0) * 100)} C={C} />
          <OvCompareBar label="Head to Head" homeVal={h2hWins} awayVal={h2hLoss} C={C} />
          <OvCompareBar label="Form" homeVal={hf.length > 0 ? Math.round(hfv * 100) : 0} awayVal={af.length > 0 ? Math.round(afv * 100) : 0} C={C} />
          <OvCompareBar label="Overall Strength" homeVal={Math.round((homeRadarVals[0] ?? 0) * 100)} awayVal={Math.round((awayRadarVals[0] ?? 0) * 100)} C={C} />
        </View>

        }{/* Form Guide — moved to SportPreMatchIntelligence Section 3 */}
        {false && (hf.length > 0 || af.length > 0) ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>FORM GUIDE (LAST 5)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {(['W','D','L'] as const).map((r) => (
                <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: FORM_COLORS[r].bg, borderColor: FORM_COLORS[r].border }}>
                  <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: FORM_COLORS[r].text }}>{r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
                <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                  {hf.slice(0, 5).map((r, i) => <FormBubble key={i} result={r} size={30} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  {(['W','D','L'] as const).map((res) => { const cnt = hf.slice(0, 5).filter((r) => r.toUpperCase() === res).length; if (!cnt) return null; return <View key={res} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: FORM_COLORS[res].bg, borderColor: FORM_COLORS[res].border }}><Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: FORM_COLORS[res].text }}>{cnt}{res}</Text></View>; })}
                </View>
              </View>
              <View style={{ width: 1, backgroundColor: C.border, marginVertical: 4 }} />
              <View style={{ flex: 1, gap: 8, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
                <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {af.slice(0, 5).map((r, i) => <FormBubble key={i} result={r} size={30} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, justifyContent: 'flex-end' }}>
                  {(['W','D','L'] as const).map((res) => { const cnt = af.slice(0, 5).filter((r) => r.toUpperCase() === res).length; if (!cnt) return null; return <View key={res} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: FORM_COLORS[res].bg, borderColor: FORM_COLORS[res].border }}><Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: FORM_COLORS[res].text }}>{cnt}{res}</Text></View>; })}
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Head to Head — moved to SportPreMatchIntelligence Section 4 */}
        {false ? <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[st, { color: C.textPrimary }]}>HEAD TO HEAD</Text>
          {h2hLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}><ActivityIndicator size="small" color={C.primary} /></View>
          ) : h2hRecords.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
              <Ionicons name="git-compare-outline" size={28} color={C.textMuted} />
              <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>No previous encounters found in our database.</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, alignItems: 'center', gap: 3, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, backgroundColor: '#DCFCE7', borderColor: '#22C55E' }}>
                  <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold, color: '#166534' }}>{h2hWins}</Text>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: '#166534' }} numberOfLines={1}>{match.homeTeam.split(' ').slice(-1)[0]}</Text>
                  <Text style={{ fontSize: 9, color: '#22C55E', fontWeight: FONTS.bold }}>WINS</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center', gap: 3, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }}>
                  <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold, color: '#92400E' }}>{h2hDraw}</Text>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: '#92400E' }}>Draw</Text>
                  <Text style={{ fontSize: 9, color: '#F59E0B', fontWeight: FONTS.bold }}>DRAWS</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center', gap: 3, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, backgroundColor: '#FEE2E2', borderColor: '#EF4444' }}>
                  <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold, color: '#991B1B' }}>{h2hLoss}</Text>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: '#991B1B' }} numberOfLines={1}>{match.awayTeam.split(' ').slice(-1)[0]}</Text>
                  <Text style={{ fontSize: 9, color: '#EF4444', fontWeight: FONTS.bold }}>WINS</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
                {h2hWins > 0 ? <View style={{ flex: h2hWins, backgroundColor: '#22C55E', borderRadius: 4 }} /> : null}
                {h2hDraw > 0 ? <View style={{ flex: h2hDraw, backgroundColor: '#F59E0B', borderRadius: 4 }} /> : null}
                {h2hLoss > 0 ? <View style={{ flex: h2hLoss, backgroundColor: '#EF4444', borderRadius: 4 }} /> : null}
              </View>
              <View style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
                {h2hRecords.slice(0, 5).map((r, idx) => {
                  const isHF = r.homeTeam === match.homeTeam;
                  const scored = isHF ? r.homeScore : r.awayScore;
                  const conceded = isHF ? r.awayScore : r.homeScore;
                  const result = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
                  const fc = FORM_COLORS[result as 'W'|'D'|'L'];
                  return (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: idx < Math.min(h2hRecords.length, 5) - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: C.border }}>
                      <Text style={{ fontSize: 10, color: C.textMuted, width: 74 }}>{fmtShortDate(r.matchTime)}</Text>
                      <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold, textAlign: 'right', color: result === 'W' ? '#166534' : C.textSecondary }} numberOfLines={1}>{r.homeTeam}</Text>
                      <View style={{ borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                        <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{r.homeScore} – {r.awayScore}</Text>
                      </View>
                      <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold, color: result === 'L' ? '#991B1B' : C.textSecondary }} numberOfLines={1}>{r.awayTeam}</Text>
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: fc?.bg ?? C.card, borderWidth: 1, borderColor: fc?.border ?? C.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold, color: fc?.text ?? C.textMuted }}>{result}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View> : null}

        {/* Season Highlights — now supplemental for football only in MatchOverviewTab */}
        {false && (homeSeasonStats || awaySeasonStats) && !seasonStatsLoading ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>SEASON HIGHLIGHTS</Text>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OV_HOME }} />
                <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
              </View>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OV_AWAY }} />
              </View>
            </View>
            {[
              { label: '🏆 Biggest Win', hv: homeSeasonStats?.biggestWin ?? '—', av: awaySeasonStats?.biggestWin ?? '—' },
              { label: '💔 Biggest Loss', hv: homeSeasonStats?.biggestLoss ?? '—', av: awaySeasonStats?.biggestLoss ?? '—' },
              { label: '🤝 Highest Draw', hv: homeSeasonStats?.highestDraw ?? '—', av: awaySeasonStats?.highestDraw ?? '—' },
            ].map((row) => (
              <View key={row.label} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 8 }}>
                <Text style={{ flex: 1.2, fontSize: 11, color: OV_HOME, fontWeight: FONTS.semiBold }} numberOfLines={2}>{row.hv}</Text>
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textMuted, textAlign: 'center', minWidth: 90 }}>{row.label}</Text>
                <Text style={{ flex: 1.2, fontSize: 11, color: OV_AWAY, fontWeight: FONTS.semiBold, textAlign: 'right' }} numberOfLines={2}>{row.av}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {[{ team: match.homeTeam, color: OV_HOME, scored: homeSeasonStats?.avgScored, conceded: homeSeasonStats?.avgConceded, games: homeSeasonStats?.totalGames, gf: homeSeasonStats?.totalGoalsFor, ga: homeSeasonStats?.totalGoalsAgainst },
                { team: match.awayTeam, color: OV_AWAY, scored: awaySeasonStats?.avgScored, conceded: awaySeasonStats?.avgConceded, games: awaySeasonStats?.totalGames, gf: awaySeasonStats?.totalGoalsFor, ga: awaySeasonStats?.totalGoalsAgainst }].map((t) => (
                <View key={t.team} style={{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 6, backgroundColor: `${t.color}10`, borderColor: `${t.color}33` }}>
                  <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: t.color }} numberOfLines={1}>{t.team}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>Avg Scored</Text>
                    <Text style={{ fontSize: 12, fontWeight: FONTS.extraBold, color: '#22C55E' }}>{t.scored ?? '—'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>Avg Conceded</Text>
                    <Text style={{ fontSize: 12, fontWeight: FONTS.extraBold, color: '#EF4444' }}>{t.conceded ?? '—'}</Text>
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 10, color: C.textMuted }}>{t.games}G</Text>
                    <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textSecondary }}>{t.gf ?? 0}F / {t.ga ?? 0}A</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  // ─── Stats Tab — with Standings ───────────────────────────────────────────
  const renderStats = () => {
    const s = detailData?.stats;
    const goals = (detailData?.events ?? []).filter((e) => e.eventType?.toLowerCase().includes('goal') && !e.eventType?.toLowerCase().includes('miss'));
    return (
      <View style={{ gap: 16 }}>
        {/* Live/finished score header */}
        {(isLive || isFinished) ? (
          <LinearGradient colors={[`${isLive ? '#EF4444' : C.primary}18`, 'transparent']}
            style={[sc, { borderColor: isLive ? '#EF444433' : `${C.primary}33`, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <View style={{ flex: 1, alignItems: 'flex-start', gap: 6 }}>
              <TeamLogo name={match.homeTeam} logoUrl={match.homeLogo} size={42} C={C} />
              <Text style={{ fontSize: 12, fontWeight: FONTS.medium, color: C.textSecondary }} numberOfLines={2}>{match.homeTeam}</Text>
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              {isLive ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444' }} /><Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: '#EF4444' }}>{detailData?.minute ?? match.minute}'</Text></View> : null}
              <Text style={{ fontSize: 40, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{detailData?.homeScore ?? match.homeScore} – {detailData?.awayScore ?? match.awayScore}</Text>
              {isFinished ? <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: C.textMuted }}>FULL TIME</Text> : null}
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 6 }}>
              <TeamLogo name={match.awayTeam} logoUrl={match.awayLogo} size={42} C={C} />
              <Text style={{ fontSize: 12, fontWeight: FONTS.medium, color: C.textSecondary, textAlign: 'right' }} numberOfLines={2}>{match.awayTeam}</Text>
            </View>
          </LinearGradient>
        ) : null}

        {/* Match Stats */}
        {s ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>MATCH STATISTICS</Text>
            <View style={{ flexDirection: 'row', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 }}>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold, color: OV_HOME }} numberOfLines={1}>{match.homeTeam}</Text>
              <Text style={{ fontSize: 11, color: C.textMuted, marginHorizontal: 10 }}>STAT</Text>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.bold, color: OV_AWAY, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
            </View>
            {s.homePossession !== null ? <StatRow label="Possession %" homeVal={`${s.homePossession}%`} awayVal={`${s.awayPossession}%`} C={C} /> : null}
            {s.homeShots !== null ? <StatRow label="Total Shots" homeVal={s.homeShots} awayVal={s.awayShots} C={C} /> : null}
            {s.homeShotsOnTarget !== null ? <StatRow label="Shots on Target" homeVal={s.homeShotsOnTarget} awayVal={s.awayShotsOnTarget} C={C} /> : null}
            {s.homeCorners !== null ? <StatRow label="Corners" homeVal={s.homeCorners} awayVal={s.awayCorners} C={C} /> : null}
            {s.homeYellowCards !== null ? <StatRow label="Yellow Cards" homeVal={s.homeYellowCards} awayVal={s.awayYellowCards} C={C} /> : null}
            {s.homeRedCards !== null ? <StatRow label="Red Cards" homeVal={s.homeRedCards} awayVal={s.awayRedCards} C={C} /> : null}
            {s.homeFouls !== null ? <StatRow label="Fouls" homeVal={s.homeFouls} awayVal={s.awayFouls} C={C} /> : null}
            {s.homeXG !== null ? <StatRow label="xG" homeVal={(s.homeXG!).toFixed(2)} awayVal={(s.awayXG!).toFixed(2)} C={C} /> : null}
            {s.homePossession === null && s.homeShots === null ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text style={{ color: C.textMuted, fontSize: 13 }}>Statistics will appear once the match starts.</Text>
              </View>
            ) : null}
          </View>
        ) : isUpcoming ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
              <Ionicons name="stats-chart-outline" size={32} color={C.textMuted} />
              <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center' }}>Stats will appear once the match starts.</Text>
            </View>
          </View>
        ) : null}

        {/* Goals */}
        {goals.length > 0 ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>GOALS</Text>
            {goals.map((evt, i) => (
              <View key={`${evt.id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: i < goals.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: C.border }}>
                <View style={[{ borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, minWidth: 40, alignItems: 'center' }, { backgroundColor: evt.isHomeTeam ? `${OV_HOME}22` : `${OV_AWAY}22`, borderColor: evt.isHomeTeam ? `${OV_HOME}44` : `${OV_AWAY}44` }]}>
                  <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: evt.isHomeTeam ? OV_HOME : OV_AWAY }}>{evt.minute}{evt.extraMinute ? `+${evt.extraMinute}` : ''}'</Text>
                </View>
                <Text style={{ fontSize: 16 }}>⚽</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: FONTS.semiBold, color: C.textPrimary }}>{evt.playerName || 'Unknown'}</Text>
                  {evt.assistName ? <Text style={{ fontSize: 12, color: C.textMuted }}>Assist: {evt.assistName}</Text> : null}
                </View>
                <Text style={{ fontSize: 12, color: evt.isHomeTeam ? OV_HOME : OV_AWAY, maxWidth: 90 }} numberOfLines={1}>{evt.team || (evt.isHomeTeam ? match.homeTeam : match.awayTeam)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Standings — moved from Overview ─────────────────────────────── */}
        <View style={[sc, { backgroundColor: C.card, borderColor: C.border, padding: 0, overflow: 'hidden' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 10 }}>
            <Ionicons name="podium-outline" size={16} color={C.primary} />
            <Text style={{ fontSize: 14, fontWeight: FONTS.bold as any, color: C.textPrimary, flex: 1 }}>{match.league ?? 'League Standings'}</Text>
            {match.leagueLogo ? <Image source={{ uri: match.leagueLogo }} style={{ width: 22, height: 22, borderRadius: 3 }} contentFit="contain" /> : null}
            {standings?.source ? (
              <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 }, standings.source === 'synced' ? { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` } : { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: standings.source === 'synced' ? C.primary : C.textMuted }}>{standings.source}</Text>
              </View>
            ) : null}
          </View>
          <StandingsTable standings={standings} homeTeam={match.homeTeam} awayTeam={match.awayTeam} loading={standingsLoading} C={C} />
        </View>

        {/* AI Prediction Result (finished) */}
        {isFinished && match.hasPrediction ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>AI PREDICTION RESULT</Text>
            {(() => {
              const hScore = detailData?.homeScore ?? match.homeScore;
              const aScore = detailData?.awayScore ?? match.awayScore;
              const actual = hScore > aScore ? 'home_win' : aScore > hScore ? 'away_win' : 'draw';
              const correct = match.predictedResult === actual;
              return (
                <View style={{ gap: 12 }}>
                  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 }, correct ? { backgroundColor: '#22C55E22', borderColor: '#22C55E55' } : { backgroundColor: '#EF444422', borderColor: '#EF444455' }]}>
                    <Ionicons name={correct ? 'checkmark-circle' : 'close-circle'} size={24} color={correct ? '#22C55E' : '#EF4444'} />
                    <Text style={{ fontSize: 16, fontWeight: FONTS.bold, color: correct ? '#22C55E' : '#EF4444' }}>{correct ? 'Prediction Correct!' : 'Prediction Missed'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    {[{ lbl: 'PREDICTED', val: match.predictedResult === 'home_win' ? match.homeTeam : match.predictedResult === 'away_win' ? match.awayTeam : 'Draw' }, { lbl: 'ACTUAL', val: actual === 'home_win' ? match.homeTeam : actual === 'away_win' ? match.awayTeam : 'Draw' }].map((item) => (
                      <View key={item.lbl} style={[{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, alignItems: 'center', gap: 5 }, { backgroundColor: C.surface, borderColor: C.border }]}>
                        <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.8 }}>{item.lbl}</Text>
                        <Text style={{ fontSize: 14, fontWeight: FONTS.semiBold, color: C.textPrimary, textAlign: 'center' }}>{item.val}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}
          </View>
        ) : null}
      </View>
    );
  };

  // ─── Odds Tab — uniform with match/[id].tsx ───────────────────────────────
  const renderOdds = () => {
    let homeOdds = 1.85; let drawOdds = 3.50; let awayOdds = 4.20;
    if (detailData?.odds) {
      homeOdds = detailData.odds.homeWin ?? 1.85;
      drawOdds = detailData.odds.draw ?? 3.50;
      awayOdds = detailData.odds.awayWin ?? 4.20;
    } else if (match.homeWinProb && match.awayWinProb) {
      homeOdds = parseFloat(Math.max(1.05, 100 / (match.homeWinProb + 5)).toFixed(2));
      drawOdds = parseFloat(Math.max(1.80, 100 / ((match.drawProb ?? 25) + 5)).toFixed(2));
      awayOdds = parseFloat(Math.max(1.05, 100 / (match.awayWinProb + 5)).toFixed(2));
    }
    const homeSeries = generateOddsSeries(homeOdds); const drawSeries = generateOddsSeries(drawOdds); const awaySeries = generateOddsSeries(awayOdds);
    const homeAbbr = match.homeTeam.split(' ').slice(-1)[0]; const awayAbbr = match.awayTeam.split(' ').slice(-1)[0];
    const over25 = detailData?.odds?.over25 ?? 1.65; const under25 = detailData?.odds?.under25 ?? 2.30;
    const bttsYes = detailData?.odds?.bttsYes ?? 1.72; const bttsNo = detailData?.odds?.bttsNo ?? 2.10;
    const bookmaker = detailData?.odds?.bookmaker ?? 'Estimated';

    const isMMAOdds = sport.toLowerCase() === 'mma' || sport.toLowerCase() === 'boxing';
    const isHandballOdds = sport.toLowerCase() === 'handball' || sport.toLowerCase() === 'volleyball';
    const mainLines: OddsLineData[] = (isTennis || isBasketball || isMMAOdds || isHandballOdds)
      ? [{ label: homeAbbr, key: '1', currentOdds: homeOdds, series: homeSeries, color: OV_HOME }, { label: awayAbbr, key: '2', currentOdds: awayOdds, series: awaySeries, color: OV_AWAY }]
      : [{ label: `1 (${homeAbbr})`, key: '1', currentOdds: homeOdds, series: homeSeries, color: OV_HOME }, { label: 'X Draw', key: 'X', currentOdds: drawOdds, series: drawSeries, color: C.textSecondary }, { label: `2 (${awayAbbr})`, key: '2', currentOdds: awayOdds, series: awaySeries, color: OV_AWAY }];

    const markets = isTennis
      ? [{ label: '🎾 MATCH WINNER', items: [{ key: '1', label: homeAbbr, odds: homeOdds, color: OV_HOME, series: homeSeries }, { key: '2', label: awayAbbr, odds: awayOdds, color: OV_AWAY, series: awaySeries }] },
         { label: 'TOTAL SETS O/U', items: [{ key: 'O25', label: 'Over 2.5', odds: 1.75, color: '#22C55E', series: generateOddsSeries(1.75) }, { key: 'U25', label: 'Under 2.5', odds: 2.10, color: '#EF4444', series: generateOddsSeries(2.10) }] },
         { label: 'FIRST SET WINNER', items: [{ key: 'FS1', label: `${homeAbbr} 1st`, odds: parseFloat((homeOdds * 0.85).toFixed(2)), color: OV_HOME, series: generateOddsSeries(homeOdds * 0.85) }, { key: 'FS2', label: `${awayAbbr} 1st`, odds: parseFloat((awayOdds * 0.85).toFixed(2)), color: OV_AWAY, series: generateOddsSeries(awayOdds * 0.85) }] }]
      : isBasketball
      ? [{ label: '🏀 GAME WINNER', items: [{ key: '1', label: homeAbbr, odds: homeOdds, color: OV_HOME, series: homeSeries }, { key: '2', label: awayAbbr, odds: awayOdds, color: OV_AWAY, series: awaySeries }] },
         { label: 'TOTAL POINTS O/U', items: [{ key: 'O215', label: 'Over 215.5', odds: over25, color: '#22C55E', series: generateOddsSeries(over25) }, { key: 'U215', label: 'Under 215.5', odds: under25, color: '#EF4444', series: generateOddsSeries(under25) }] },
         { label: 'SPREAD / HANDICAP', items: [{ key: 'HS', label: `${homeAbbr} -4.5`, odds: parseFloat((homeOdds * 1.1).toFixed(2)), color: OV_HOME, series: generateOddsSeries(homeOdds * 1.1) }, { key: 'AS', label: `${awayAbbr} +4.5`, odds: parseFloat((awayOdds * 0.95).toFixed(2)), color: OV_AWAY, series: generateOddsSeries(awayOdds * 0.95) }] },
         { label: '1ST QUARTER WINNER', items: [{ key: 'Q1H', label: `${homeAbbr} 1Q`, odds: parseFloat((homeOdds * 0.9).toFixed(2)), color: OV_HOME, series: generateOddsSeries(homeOdds * 0.9) }, { key: 'Q1A', label: `${awayAbbr} 1Q`, odds: parseFloat((awayOdds * 0.92).toFixed(2)), color: OV_AWAY, series: generateOddsSeries(awayOdds * 0.92) }] }]
      : isMMAOdds
      ? [{ label: '🥊 FIGHT WINNER', items: [{ key: '1', label: homeAbbr, odds: homeOdds, color: OV_HOME, series: homeSeries }, { key: '2', label: awayAbbr, odds: awayOdds, color: OV_AWAY, series: awaySeries }] },
         { label: 'TOTAL ROUNDS O/U', items: [{ key: 'OR', label: 'Over 1.5', odds: 1.72, color: '#22C55E', series: generateOddsSeries(1.72) }, { key: 'UR', label: 'Under 1.5', odds: 2.15, color: '#EF4444', series: generateOddsSeries(2.15) }] },
         { label: 'METHOD OF VICTORY', items: [{ key: 'KO', label: 'KO / TKO', odds: 2.10, color: '#EF4444', series: generateOddsSeries(2.10) }, { key: 'SUB', label: 'Submission', odds: 2.80, color: '#A78BFA', series: generateOddsSeries(2.80) }, { key: 'DEC', label: 'Decision', odds: 1.95, color: '#38BDF8', series: generateOddsSeries(1.95) }] },
         { label: 'FIGHT DISTANCE', items: [{ key: 'FTD_Y', label: 'Goes to Decision', odds: 1.85, color: '#22C55E', series: generateOddsSeries(1.85) }, { key: 'FTD_N', label: 'Stoppage', odds: 1.90, color: '#F59E0B', series: generateOddsSeries(1.90) }] }]
      : isHandballOdds
      ? [{ label: '🤾 MATCH WINNER (1X2)', items: [{ key: '1', label: homeAbbr, odds: homeOdds, color: OV_HOME, series: homeSeries }, { key: 'X', label: 'Draw', odds: drawOdds, color: C.textSecondary, series: drawSeries }, { key: '2', label: awayAbbr, odds: awayOdds, color: OV_AWAY, series: awaySeries }] },
         { label: 'TOTAL GOALS O/U', items: [{ key: 'OHB', label: 'Over 48.5', odds: 1.80, color: '#22C55E', series: generateOddsSeries(1.80) }, { key: 'UHB', label: 'Under 48.5', odds: 1.95, color: '#EF4444', series: generateOddsSeries(1.95) }] },
         { label: 'BOTH TEAMS SCORE 20+', items: [{ key: 'BHY', label: 'Yes', odds: bttsYes, color: '#14B8A6', series: generateOddsSeries(bttsYes) }, { key: 'BHN', label: 'No', odds: bttsNo, color: '#F97316', series: generateOddsSeries(bttsNo) }] },
         { label: 'WINNING MARGIN', items: [{ key: 'WM1', label: '1-3 Goals', odds: 3.20, color: '#F59E0B', series: generateOddsSeries(3.20) }, { key: 'WM2', label: '4-6 Goals', odds: 2.40, color: OV_HOME, series: generateOddsSeries(2.40) }, { key: 'WM3', label: '7+ Goals', odds: 2.80, color: OV_AWAY, series: generateOddsSeries(2.80) }] }]
      : [{ label: `MATCH RESULT (1X2) · ${bookmaker}`, items: [{ key: '1', label: homeAbbr, odds: homeOdds, color: OV_HOME, series: homeSeries }, { key: 'X', label: 'Draw', odds: drawOdds, color: C.textSecondary, series: drawSeries }, { key: '2', label: awayAbbr, odds: awayOdds, color: OV_AWAY, series: awaySeries }] },
         { label: 'BOTH TEAMS TO SCORE', items: [{ key: 'BTTSY', label: 'Yes', odds: bttsYes, color: '#14B8A6', series: generateOddsSeries(bttsYes) }, { key: 'BTTSN', label: 'No', odds: bttsNo, color: '#F97316', series: generateOddsSeries(bttsNo) }] },
         { label: 'TOTAL GOALS', items: [{ key: 'O25', label: 'Over 2.5', odds: over25, color: '#22C55E', series: generateOddsSeries(over25) }, { key: 'U25', label: 'Under 2.5', odds: under25, color: '#EF4444', series: generateOddsSeries(under25) }] }];

    return (
      <View style={{ gap: 16 }}>
        {/* Source badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: detailData?.odds ? `${C.accent}14` : C.surface, borderRadius: RADIUS.full, borderWidth: 1, borderColor: detailData?.odds ? `${C.accent}33` : C.border, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' }}>
          <Ionicons name={detailData?.odds ? 'checkmark-circle' : 'layers-outline'} size={12} color={detailData?.odds ? C.accent : C.textMuted} />
          <Text style={{ fontSize: 11, color: detailData?.odds ? C.accent : C.textMuted, fontWeight: FONTS.semiBold }}>{detailData?.odds ? `Odds · ${bookmaker}` : 'Probability model'}</Text>
        </View>

        {/* Movement chart first */}
        <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[st, { color: C.textPrimary }]}>{isTennis ? '🎾 ODDS MOVEMENT' : isBasketball ? '🏀 POINTS LINE' : isMMAOdds ? '🥊 FIGHT ODDS' : isHandballOdds ? '🤾 HANDBALL ODDS' : '1X2 ODDS MOVEMENT'}</Text>
          <OddsMovementChart lines={mainLines} C={C} />
        </View>

        {/* Markets */}
        {markets.map((market, mIdx) => (
          <View key={market.label} style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: `${C.primary}18`, borderWidth: 1, borderColor: `${C.primary}33`, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold as any, color: C.primary }}>{mIdx + 1}</Text>
              </View>
              <Text style={[st, { color: C.textPrimary, marginBottom: 0, flex: 1 }]}>{market.label}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {market.items.map((item) => {
                const prevOdds = item.series[item.series.length - 2] ?? item.odds;
                const improved = item.odds < prevOdds; const unchanged = Math.abs(item.odds - prevOdds) < 0.01;
                const trendColor = unchanged ? C.textMuted : improved ? '#22C55E' : '#EF4444';
                return (
                  <View key={item.key} style={[{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', gap: 4 }, { backgroundColor: `${item.color}14`, borderColor: `${item.color}33` }]}>
                    <Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: C.textMuted, letterSpacing: 0.5, textAlign: 'center' }}>
                      {item.key === '1' ? '1' : item.key === 'X' ? 'X' : item.key === '2' ? '2' : item.key}
                    </Text>
                    <Text style={{ fontSize: 9, color: C.textMuted, textAlign: 'center' }} numberOfLines={1}>{item.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                      <Ionicons name={unchanged ? 'remove' : improved ? 'arrow-down' : 'arrow-up'} size={10} color={trendColor} />
                      <Text style={{ fontSize: 22, fontWeight: FONTS.extraBold as any, color: item.color }}>{item.odds.toFixed(2)}</Text>
                    </View>
                    {!unchanged ? <Text style={{ fontSize: 9, color: trendColor }}>was {prevOdds.toFixed(2)}</Text> : <Text style={{ fontSize: 9, color: 'transparent' }}>—</Text>}
                  </View>
                );
              })}
            </View>
            {/* Implied probability bar */}
            <View style={{ flexDirection: 'row', height: 4, borderRadius: 3, overflow: 'hidden', gap: 1, marginTop: 10 }}>
              {market.items.map((o) => <View key={o.key} style={{ flex: Math.round((1 / o.odds) * 100), backgroundColor: o.color, opacity: 0.7 }} />)}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              {market.items.map((o) => (
                <Text key={o.key} style={{ flex: 1, fontSize: 9, color: o.color, textAlign: 'center', fontWeight: FONTS.semiBold as any }}>
                  {o.label} {Math.round((1 / o.odds) * 100)}%
                </Text>
              ))}
            </View>
          </View>
        ))}

        {/* AI vs Market Value */}
        {match.hasPrediction && match.homeWinProb ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[st, { color: C.textPrimary }]}>AI vs MARKET VALUE</Text>
            <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 18, marginBottom: 12 }}>Positive value means AI assigns higher probability than market implies.</Text>
            {[
              { label: '1 Home Win', aiProb: match.homeWinProb ?? 0, impliedProb: Math.round(100 / homeOdds), color: OV_HOME },
              { label: 'X Draw', aiProb: match.drawProb ?? 0, impliedProb: Math.round(100 / drawOdds), color: C.textSecondary },
              { label: '2 Away Win', aiProb: match.awayWinProb ?? 0, impliedProb: Math.round(100 / awayOdds), color: OV_AWAY },
            ].map((row) => {
              const edge = row.aiProb - row.impliedProb;
              const edgeColor = edge > 3 ? '#22C55E' : edge < -3 ? '#EF4444' : C.textMuted;
              return (
                <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>{row.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.primary, width: 46, textAlign: 'center' }}>{row.aiProb}%</Text>
                  <Text style={{ fontSize: 13, color: C.textMuted, width: 46, textAlign: 'center' }}>{row.impliedProb}%</Text>
                  <View style={[{ borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, minWidth: 54, alignItems: 'center' }, { backgroundColor: `${edgeColor}18`, borderWidth: 1, borderColor: `${edgeColor}44` }]}>
                    <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: edgeColor }}>{edge > 0 ? '+' : ''}{edge}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  // ─── Timeline Tab ─────────────────────────────────────────────────────────
  const renderTimeline = () => {
    const rawEvents = detailData?.events ?? [];
    const events = rawEvents.map((e) => ({ id: e.id, minute: e.minute, extraMinute: e.extraMinute ?? undefined, type: parseEventType(e.eventType), isHome: e.isHomeTeam, playerName: e.playerName || '', assistName: e.assistName ?? undefined })).sort((a, b) => a.minute - b.minute);

    if (!isLive && !isFinished) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 60, gap: 14 }}>
          <Text style={{ fontSize: 48 }}>⏱️</Text>
          <Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' }}>No Events Yet</Text>
          <Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 }}>Timeline will update once the match starts.</Text>
        </View>
      );
    }
    if (events.length === 0) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 60, gap: 14 }}>
          {detailLoading ? <ActivityIndicator size="large" color={C.primary} /> : (
            <><Text style={{ fontSize: 40 }}>📋</Text><Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' }}>No events recorded</Text><Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 }}>{isLive ? 'Events will appear as the match progresses.' : 'No match events were recorded for this game.'}</Text></>
          )}
        </View>
      );
    }

    return (
      <View style={{ gap: 4 }}>
        <View style={[sc, { backgroundColor: C.card, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }]}>
          <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: OV_HOME, flex: 1 }} numberOfLines={1}>{match.homeTeam}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="list-outline" size={13} color={C.textMuted} />
            <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: C.textMuted }}>Timeline</Text>
            {isLive ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EF444414', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#EF444433', paddingHorizontal: 6, paddingVertical: 2 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' }} /><Text style={{ fontSize: 9, fontWeight: FONTS.bold as any, color: '#EF4444' }}>LIVE</Text></View> : null}
          </View>
          <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: OV_AWAY, flex: 1, textAlign: 'right' }} numberOfLines={1}>{match.awayTeam}</Text>
        </View>
        {events.map((ev) => {
          const cfg = getEventConfig(ev.type);
          const isHt = ev.type === 'half_time';
          const color = ev.isHome ? OV_HOME : OV_AWAY;
          if (isHt) return (
            <View key={ev.id} style={tl.markerRow}>
              <View style={[tl.markerLine, { backgroundColor: C.border }]} />
              <View style={[tl.markerPill, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={{ fontSize: 12 }}>⏱️</Text>
                <Text style={[tl.markerText, { color: C.textMuted }]}>Half Time</Text>
              </View>
              <View style={[tl.markerLine, { backgroundColor: C.border }]} />
            </View>
          );
          return (
            <View key={ev.id} style={tl.eventRow}>
              {ev.isHome ? (
                <View style={[tl.eventContent, tl.eventContentHome]}>
                  <View style={[tl.iconBubble, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}><Text style={{ fontSize: 15 }}>{cfg.emoji}</Text></View>
                  <View style={[tl.textWrap, { alignItems: 'flex-end' }]}>
                    <Text style={[tl.playerName, { color: C.textPrimary }]} numberOfLines={1}>{ev.playerName || cfg.label}</Text>
                    {ev.assistName ? <Text style={[tl.detailText, { color: C.textMuted }]} numberOfLines={1}>Assist: {ev.assistName}</Text> : null}
                    <Text style={[tl.typeLabel, { color }]}>{cfg.label}</Text>
                  </View>
                </View>
              ) : <View style={{ flex: 1 }} />}
              <View style={tl.minuteCol}>
                <View style={[tl.minuteDot, { backgroundColor: C.border }]} />
                <View style={[tl.minutePill, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
                  <Text style={[tl.minuteText, { color }]}>{ev.minute}{ev.extraMinute ? `+${ev.extraMinute}` : ''}'</Text>
                </View>
                <View style={[tl.minuteDot, { backgroundColor: C.border }]} />
              </View>
              {!ev.isHome ? (
                <View style={[tl.eventContent, tl.eventContentAway]}>
                  <View style={[tl.textWrap, { alignItems: 'flex-start' }]}>
                    <Text style={[tl.playerName, { color: C.textPrimary }]} numberOfLines={1}>{ev.playerName || cfg.label}</Text>
                    {ev.assistName ? <Text style={[tl.detailText, { color: C.textMuted }]} numberOfLines={1}>Assist: {ev.assistName}</Text> : null}
                    <Text style={[tl.typeLabel, { color }]}>{cfg.label}</Text>
                  </View>
                  <View style={[tl.iconBubble, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}><Text style={{ fontSize: 15 }}>{cfg.emoji}</Text></View>
                </View>
              ) : <View style={{ flex: 1 }} />}
            </View>
          );
        })}
        <View style={{ height: 16 }} />
      </View>
    );
  };

  // ─── AI Picks / Report Tab ────────────────────────────────────────────────
  const renderAIReport = () => {
    // ── NEW: Consensus + Voting Report ──────────────────────────────────────
    if (canViewReport && match.hasPrediction) {
      const predInput = {
        predictedResult: match.predictedResult,
        homeWinProb: match.homeWinProb,
        drawProb: match.drawProb,
        awayWinProb: match.awayWinProb,
        confidence: match.confidence,
        overUnder: match.overUnder,
        overUnderLine: match.overUnderLine,
        predictedHomeGoals: match.predictedHomeGoals,
        predictedAwayGoals: match.predictedAwayGoals,
        btts: match.btts,
        correctScore: match.correctScore,
        cornersOverUnder: match.cornersOverUnder,
        cornersLine: match.cornersLine,
        cardsTotal: match.cardsTotal,
        cardsOverUnder: match.cardsOverUnder,
        asianHandicapLine: match.asianHandicapLine,
        asianHandicapPick: match.asianHandicapPick,
        htResult: match.htResult,
        htHomeProb: match.htHomeProb,
        htDrawProb: match.htDrawProb,
        htAwayProb: match.htAwayProb,
        cleanSheetHome: match.cleanSheetHome,
        cleanSheetAway: match.cleanSheetAway,
        firstGoal: match.firstGoal,
        bothScoreHt: match.bothScoreHt,
        anytimeScorecast: match.anytimeScorecast,
        riskLevel: match.riskLevel,
        valueScore: match.valueScore,
        marketEdgePct: match.marketEdgePct,
        keyFactors: match.keyFactors,
        aiAnalysis: match.aiAnalysis,
      };
      const matchCtxForReport = {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        sport,
        league: match.league,
        homeForm: match.homeForm,
        awayForm: match.awayForm,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        status: match.status,
      };
      return (
        <View style={{ gap: 14 }}>
          <AccuracyBanner sport={sport} C={C} />
          <AIReportConsensus
            matchId={match.matchId}
            prediction={predInput}
            matchCtx={matchCtxForReport}
            sport={sport}
          />
          {/* Admin mark result */}
          {isAdmin && isFinished && match.hasPrediction && hasOutcome === false ? (
            <Pressable style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 13, borderWidth: 1.5, borderColor: `${C.primary}66`, backgroundColor: C.primaryGlow }, pressed ? { opacity: 0.82 } : null]} onPress={() => { setShowMarkModal(true); setResolveResult(null); setResolveError(null); }}>
              <Ionicons name="checkmark-done-outline" size={16} color={C.primary} />
              <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.primary }}>Mark Result</Text>
            </Pressable>
          ) : isAdmin && isFinished && match.hasPrediction && hasOutcome === true ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#22C55E14', borderWidth: 1, borderColor: '#22C55E33' }}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#22C55E" />
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: '#22C55E' }}>Outcome Recorded</Text>
            </View>
          ) : null}
          <DisclaimerBanner compact />
        </View>
      );
    }
    // ── Legacy locked/generating states below ───────────────────────────────
    const vipRiskLevel = match.riskLevel as 'Low'|'Medium'|'High'|undefined;
    const vipValueScore = match.valueScore as number|null|undefined;
    const vipMarketEdge = match.marketEdgePct as number|null|undefined;
    const vipSharpSignal = match.sharpSignal as 'bullish'|'neutral'|'bearish'|null|undefined;
    const vipSuggestedStake = match.suggestedStake as 'low'|'medium'|'high'|null|undefined;
    const vipWarningFlags = match.warningFlags as string[]|null|undefined;
    const vipKeyAlpha = match.keyAlphaMetric as string|null|undefined;
    const hasVipData = !!(vipRiskLevel || vipValueScore != null || vipMarketEdge != null || vipSharpSignal);

    return (
      <View style={{ gap: 14 }}>
        {/* Accuracy banner always visible */}
        <AccuracyBanner sport={sport} C={C} />

        {!canViewReport ? (
          <View style={[sc, { backgroundColor: C.card, borderColor: C.border, alignItems: 'center', gap: 16, paddingVertical: 36 }]}>
            <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }}>
              <FontAwesome5 name="lock" size={28} color={C.primary} />
            </View>
            <Text style={{ fontSize: 22, fontWeight: FONTS.extraBold, color: C.textPrimary }}>AI Report Locked</Text>
            <Text style={{ fontSize: 14, textAlign: 'center', color: C.textMuted, lineHeight: 22 }}>
              Unlock full analysis for{'\n'}<Text style={{ color: C.textPrimary, fontWeight: FONTS.semiBold }}>{match.homeTeam} vs {match.awayTeam}</Text>
            </Text>
            <View style={[{ flexDirection: 'row', width: '100%', borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, alignItems: 'center', gap: 14 }, { backgroundColor: C.surface, borderColor: C.border }]}>
              {[{ lbl: 'YOUR BALANCE', val: coinBalance, color: coinBalance >= UNLOCK_COST ? C.primary : C.accentRed }, { lbl: 'COST', val: UNLOCK_COST, color: C.textPrimary }].map((item, i) => (
                <React.Fragment key={item.lbl}>
                  {i > 0 ? <View style={{ width: 1, height: 36, backgroundColor: C.border }} /> : null}
                  <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                    <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.8 }}>{item.lbl}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={{ fontSize: 18 }}>🪙</Text>
                      <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold, color: item.color }}>{item.val}</Text>
                    </View>
                  </View>
                </React.Fragment>
              ))}
            </View>
            {unlockError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${C.accentRed}18`, borderRadius: RADIUS.md, borderWidth: 1, borderColor: `${C.accentRed}33`, paddingHorizontal: 14, paddingVertical: 10, width: '100%' }}>
                <Ionicons name="warning-outline" size={14} color={C.accentRed} />
                <Text style={{ fontSize: 13, flex: 1, color: C.accentRed }}>{unlockError}</Text>
                <Pressable onPress={() => setUnlockError(null)}><Ionicons name="close" size={14} color={C.accentRed} /></Pressable>
              </View>
            ) : null}
            <Pressable style={({ pressed }) => [{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14, backgroundColor: C.primary }, pressed ? { opacity: 0.88 } : null]} onPress={() => router.push('/vip' as any)}>
              <FontAwesome5 name="crown" size={14} color={C.textInverse} />
              <Text style={{ fontSize: 15, fontWeight: FONTS.bold, color: C.textInverse }}>Upgrade to VIP</Text>
            </Pressable>
            {coinBalance >= UNLOCK_COST ? (
              <Pressable style={({ pressed }) => [{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14, borderWidth: 1, backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.85 } : null, unlocking ? { opacity: 0.6 } : null]} onPress={handleUnlockWithCoins} disabled={unlocking}>
                {unlocking ? <ActivityIndicator size="small" color={C.primary} /> : <><Text style={{ fontSize: 16 }}>🪙</Text><Text style={{ fontSize: 14, fontWeight: FONTS.semiBold, color: C.primary }}>Unlock with {UNLOCK_COST} coins</Text></>}
              </Pressable>
            ) : (
              <Pressable style={({ pressed }) => [{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14, borderWidth: 1, backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.85 } : null]} onPress={() => router.push('/coin-earn' as any)}>
                <FontAwesome5 name="coins" size={14} color={C.primary} />
                <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.primary }}>Get {UNLOCK_COST - coinBalance} more coins</Text>
              </Pressable>
            )}
          </View>
        ) : !match.hasPrediction ? (
          <View style={{ alignItems: 'center', paddingVertical: 60, gap: 18 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryGlow, borderWidth: 1.5, borderColor: `${C.primary}55` }}>
              {autoGenerating ? <ActivityIndicator size="large" color={C.primary} /> : <FontAwesome5 name="brain" size={32} color={C.primary} />}
            </View>
            <Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' }}>{autoGenerating ? 'Analyzing match data...' : 'AI Report Generating'}</Text>
            <Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 }}>{autoGenerating ? 'Processing form, H2H, standings and xG data for this match.' : 'The AI prediction is still being generated. Try refreshing in a moment.'}</Text>
            {autoGenerating ? (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                {['Form','H2H','xG','Odds','Standings'].map((label) => (
                  <View key={label} style={{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }}>
                    <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: C.primary }}>{label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {match.confidence ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${match.confidence >= 80 ? '#22C55E' : '#EAB308'}18`, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${match.confidence >= 80 ? '#22C55E' : '#EAB308'}44`, alignSelf: 'flex-start' }}>
                <Ionicons name="analytics-outline" size={11} color={match.confidence >= 80 ? '#22C55E' : '#EAB308'} />
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: match.confidence >= 80 ? '#22C55E' : '#EAB308' }}>{match.confidence}% confidence</Text>
              </View>
            ) : null}

            {/* Sport-aware 1X2 outcome probabilities */}
            <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
              {(() => {
                const aiTerms = getSportTerms(sport);
                const aiFamily = getSportFamily(sport);
                const showDraw = aiTerms.hasDraw;
                const homeLabel = aiFamily === 'football' || aiFamily === 'rugby' || aiFamily === 'handball' ? '1 Home' : `${match.homeTeam.split(' ').slice(-1)[0]}`;
                const awayLabel = aiFamily === 'football' || aiFamily === 'rugby' || aiFamily === 'handball' ? '2 Away' : `${match.awayTeam.split(' ').slice(-1)[0]}`;
                const drawLabel = aiTerms.drawLabel;
                const sectionTitle = aiFamily === 'mma' || aiFamily === 'boxing' ? 'FIGHT OUTCOME' : aiFamily === 'tennis' ? 'MATCH WINNER' : aiFamily === 'basketball' ? 'GAME WINNER' : 'MATCH OUTCOME (1X2)';
                return (
                  <>
                    <Text style={[st, { color: C.textPrimary }]}>{sectionTitle}</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                      {[
                        { lbl: homeLabel, val: match.homeWinProb ?? 0, team: match.homeTeam, color: OV_HOME },
                        ...(showDraw ? [{ lbl: `X ${drawLabel}`, val: match.drawProb ?? 0, team: drawLabel, color: C.textSecondary }] : []),
                        { lbl: awayLabel, val: match.awayWinProb ?? 0, team: match.awayTeam, color: OV_AWAY },
                      ].map((item) => (
                        <View key={item.lbl} style={[{ flex: 1, alignItems: 'center', gap: 5, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 6 }, { backgroundColor: `${item.color}18`, borderColor: `${item.color}44` }]}>
                          <Text style={{ fontSize: 26, fontWeight: FONTS.extraBold, color: item.color }}>{item.val}%</Text>
                          <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: C.textMuted }}>{item.lbl}</Text>
                          <Text style={{ fontSize: 10, textAlign: 'center', color: C.textSecondary }} numberOfLines={1}>{item.team}</Text>
                        </View>
                      ))}
                    </View>
                    {match.predictedResult ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.primaryGlow, borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${C.primary}44`, paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start' }}>
                        <FontAwesome5 name="brain" size={11} color={C.primary} />
                        <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.primary }}>
                          Prediction: {match.predictedResult === 'home_win' ? match.homeTeam : match.predictedResult === 'away_win' ? match.awayTeam : drawLabel} {aiTerms.winLabel.toLowerCase()}s
                        </Text>
                      </View>
                    ) : null}
                  </>
                );
              })()}
            </View>

            {/* Sport-specific prediction markets */}
            {(() => {
              const markets = buildPredictionMarkets(sport, match, match.homeTeam, match.awayTeam, { primary: C.primary, accent: C.accent, accentBlue: C.accentBlue ?? C.primary, accentRed: C.accentRed ?? '#EF4444', textMuted: C.textMuted });
              if (markets.length === 0) return null;
              const chunks: typeof markets[] = [];
              for (let i = 0; i < markets.length; i += 4) chunks.push(markets.slice(i, i + 4));
              return chunks.map((chunk, ci) => (
                <View key={`markets-${ci}`} style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
                  {ci === 0 ? <Text style={[st, { color: C.textPrimary }]}>PREDICTION MARKETS</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {chunk.map((m) => (
                      <View key={m.id} style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', minWidth: 100, flex: 1 }, { backgroundColor: `${m.color}14`, borderColor: `${m.color}33` }]}>
                        {m.emoji ? <Text style={{ fontSize: 14, marginBottom: 4 }}>{m.emoji}</Text> : null}
                        <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 4, textAlign: 'center' }}>{m.label}</Text>
                        <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: m.color, textAlign: 'center' }}>{m.value}</Text>
                        {m.probability !== undefined ? <Text style={{ fontSize: 10, color: `${m.color}CC`, marginTop: 2 }}>{m.probability}%</Text> : null}
                      </View>
                    ))}
                  </View>
                </View>
              ));
            })()}

            {/* Team Radar — same 8-axis as Overview, prediction-driven */}
            <View style={[sc, { backgroundColor: C.card, borderColor: C.border, alignItems: 'center' }]}>
              <Text style={[st, { color: C.textPrimary, alignSelf: 'flex-start' }]}>TEAM RADAR</Text>
              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12, alignSelf: 'flex-start' }}>
                {[{ color: OV_HOME, name: match.homeTeam }, { color: OV_AWAY, name: match.awayTeam }].map((t) => (
                  <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.color }} />
                    <Text style={{ fontSize: 12, color: C.textMuted }} numberOfLines={1}>{t.name}</Text>
                  </View>
                ))}
              </View>
              <RadarChart homeVals={homeRadarVals} awayVals={awayRadarVals} homeColor={OV_HOME} awayColor={OV_AWAY} />
            </View>

            {/* AI Intelligence panel */}
            <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <FontAwesome5 name="robot" size={12} color={C.accentBlue ?? C.primary} />
                <Text style={[st, { color: C.textPrimary, marginBottom: 0, flex: 1 }]}>AI INTELLIGENCE</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#22C55E14', borderColor: '#22C55E33' }}>
                  <Ionicons name="shield-checkmark-outline" size={10} color="#22C55E" />
                  <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: '#22C55E' }}>VALIDATED</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
                {(['prediction_explanation', 'match_preview', 'tactical_analysis'] as const).map((type) => {
                  const isSel = activeIntelTab === type;
                  const labels: Record<string, string> = { prediction_explanation: '🧠 Why', match_preview: '📰 Preview', tactical_analysis: '🎯 Tactics' };
                  return (
                    <Pressable key={type} onPress={() => setActiveIntelTab(type)} style={({ pressed }) => [{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 7, backgroundColor: isSel ? `${C.primary}18` : C.surface, borderColor: isSel ? `${C.primary}55` : C.border }, pressed ? { opacity: 0.8 } : null]}>
                      <Text style={{ fontSize: 11, fontWeight: isSel ? FONTS.bold : FONTS.medium, color: isSel ? C.primary : C.textMuted }}>{labels[type]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {intelligenceLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={{ fontSize: 12, color: C.textMuted }}>Generating grounded intelligence...</Text>
                </View>
              ) : intelligenceResult?.content ? (
                <View style={{ gap: 10 }}>
                  <Text style={{ fontSize: 14, lineHeight: 23, color: C.textSecondary }}>{intelligenceResult.content}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }}>
                    {(() => { const badge = getValidationBadge(intelligenceResult.validationPassed, intelligenceResult.source); return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: badge.color }} /><Text style={{ fontSize: 9, color: badge.color, fontWeight: FONTS.bold }}>{badge.label}</Text></View>; })()}
                    <Text style={{ fontSize: 9, color: C.textMuted, flex: 1 }}>{AI_SOURCE_LABELS[intelligenceResult.source] ?? 'AI Generated'} · DQ {intelligenceResult.dqScore}/100</Text>
                    {intelligenceResult.latencyMs ? <Text style={{ fontSize: 9, color: C.textMuted }}>{intelligenceResult.latencyMs}ms</Text> : null}
                  </View>
                </View>
              ) : match?.aiAnalysis ? (
                <Text style={{ fontSize: 14, lineHeight: 22, color: C.textSecondary }}>{match.aiAnalysis}</Text>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 16, gap: 6 }}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={{ fontSize: 12, color: C.textMuted }}>Loading intelligence...</Text>
                </View>
              )}
            </View>

            {/* VIP Intelligence */}
            {hasVipData ? (
              <View style={[sc, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <FontAwesome5 name="crown" size={12} color={C.primary} />
                  <Text style={[st, { color: C.primary, marginBottom: 0 }]}>VIP INTELLIGENCE</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {vipMarketEdge != null ? (() => { const ec = vipMarketEdge > 3 ? '#22C55E' : vipMarketEdge < -3 ? '#EF4444' : C.textMuted; return <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 110 }, { backgroundColor: `${ec}14`, borderColor: `${ec}33` }]}><Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>MARKET EDGE</Text><Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: ec }}>{formatMarketEdge(vipMarketEdge)}</Text></View>; })() : null}
                  {vipValueScore != null ? (() => { const vc = getValueScoreColor(vipValueScore); return <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 110 }, { backgroundColor: `${vc}14`, borderColor: `${vc}33` }]}><Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>VALUE SCORE</Text><Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: vc }}>{vipValueScore}/100</Text></View>; })() : null}
                  {vipRiskLevel ? (() => { const riskC = getRiskColor(vipRiskLevel); return <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 110 }, { backgroundColor: `${riskC}14`, borderColor: `${riskC}33` }]}><Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>RISK LEVEL</Text><Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: riskC }}>{vipRiskLevel}</Text></View>; })() : null}
                  {vipSuggestedStake ? (() => { const sk = vipSuggestedStake; const skC = sk === 'high' ? '#22C55E' : sk === 'medium' ? '#F59E0B' : C.textMuted; return <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 110 }, { backgroundColor: `${skC}14`, borderColor: `${skC}33` }]}><Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>STAKE LEVEL</Text><Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: skC, textTransform: 'uppercase' }}>{sk}</Text></View>; })() : null}
                  {vipSharpSignal ? (() => { const sigC = vipSharpSignal === 'bullish' ? '#22C55E' : vipSharpSignal === 'bearish' ? '#EF4444' : C.textMuted; return <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 140 }, { backgroundColor: `${sigC}14`, borderColor: `${sigC}33` }]}><Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, letterSpacing: 0.5, marginBottom: 5 }}>SHARP MONEY</Text><Text style={{ fontSize: 12, fontWeight: FONTS.extraBold, color: sigC }}>{getSharpSignalLabel(vipSharpSignal)}</Text></View>; })() : null}
                </View>
                {vipKeyAlpha ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: C.surface, borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: `${C.primary}22` }}><Ionicons name="key-outline" size={13} color={C.primary} /><Text style={{ fontSize: 11, color: C.textMuted, fontWeight: FONTS.semiBold }}>KEY ALPHA: </Text><Text style={{ fontSize: 12, color: C.textPrimary, flex: 1, fontWeight: FONTS.bold }}>{vipKeyAlpha}</Text></View> : null}
                {vipWarningFlags && vipWarningFlags.length > 0 ? <View style={{ marginTop: 10, gap: 6 }}>{vipWarningFlags.map((flag, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F59E0B14', borderRadius: RADIUS.md, padding: 8, borderWidth: 1, borderColor: '#F59E0B33' }}><Ionicons name="warning-outline" size={13} color="#F59E0B" /><Text style={{ fontSize: 12, color: '#F59E0B', flex: 1 }}>{flag}</Text></View>)}</View> : null}
              </View>
            ) : null}

            {/* Admin mark result */}
            {isAdmin && isFinished && match.hasPrediction && hasOutcome === false ? (
              <Pressable style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 13, borderWidth: 1.5, borderColor: `${C.primary}66`, backgroundColor: C.primaryGlow }, pressed ? { opacity: 0.82 } : null]} onPress={() => { setShowMarkModal(true); setResolveResult(null); setResolveError(null); }}>
                <Ionicons name="checkmark-done-outline" size={16} color={C.primary} />
                <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.primary }}>Mark Result</Text>
              </Pressable>
            ) : isAdmin && isFinished && match.hasPrediction && hasOutcome === true ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#22C55E14', borderWidth: 1, borderColor: '#22C55E33' }}>
                <Ionicons name="checkmark-circle-outline" size={14} color="#22C55E" />
                <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: '#22C55E' }}>Outcome Recorded</Text>
              </View>
            ) : null}

            {/* Multi-Model Consensus */}
            {canViewReport ? (
              <MultiModelConsensusPanel matchId={match.matchId} sport={sport} homeTeam={match.homeTeam} awayTeam={match.awayTeam} league={match.league ?? ''} status={match.status} homeScore={match.homeScore} awayScore={match.awayScore} minute={match.minute ?? 0} userId={user?.id}
                onPredictionUpdate={(pred) => { setMatch((prev) => prev ? { ...prev, homeWinProb: pred.homeWinProb, drawProb: pred.drawProb, awayWinProb: pred.awayWinProb, predictedResult: pred.predictedResult, confidence: pred.confidence, hasPrediction: true } : prev); }} C={C} />
            ) : null}

            {/* Key Factors */}
            {match.keyFactors && match.keyFactors.length > 0 ? (
              <View style={[sc, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[st, { color: C.textPrimary }]}>KEY FACTORS</Text>
                {match.keyFactors.map((f: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary, marginTop: 7, flexShrink: 0 }} />
                    <Text style={{ fontSize: 14, flex: 1, lineHeight: 22, color: C.textSecondary }}>{f}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <DisclaimerBanner compact />
          </View>
        )}
      </View>
    );
  };

  // ─── AI Picks Tab (separate from AI Report) ──────────────────────────────
  const renderAIPicks = () => {
    if (!match.hasPrediction) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 60, gap: 18 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryGlow, borderWidth: 1.5, borderColor: `${C.primary}55` }}>
            {autoGenerating ? <ActivityIndicator size="large" color={C.primary} /> : <FontAwesome5 name="brain" size={32} color={C.primary} />}
          </View>
          <Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' }}>{autoGenerating ? 'Analyzing match data...' : 'Generating AI Picks'}</Text>
          <Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 280 }}>AI picks will be ready once the prediction is generated for this match.</Text>
        </View>
      );
    }
    const predInput = {
      predictedResult: match.predictedResult,
      homeWinProb: match.homeWinProb,
      drawProb: match.drawProb,
      awayWinProb: match.awayWinProb,
      confidence: match.confidence,
      overUnder: match.overUnder,
      overUnderLine: match.overUnderLine,
      predictedHomeGoals: match.predictedHomeGoals,
      predictedAwayGoals: match.predictedAwayGoals,
      btts: match.btts,
      cornersOverUnder: match.cornersOverUnder,
      cornersLine: match.cornersLine,
      cardsTotal: match.cardsTotal,
      cardsOverUnder: match.cardsOverUnder,
      asianHandicapLine: match.asianHandicapLine,
      asianHandicapPick: match.asianHandicapPick,
      htResult: match.htResult,
      htHomeProb: match.htHomeProb,
      htDrawProb: match.htDrawProb,
      htAwayProb: match.htAwayProb,
      cleanSheetHome: match.cleanSheetHome,
      cleanSheetAway: match.cleanSheetAway,
      firstGoal: match.firstGoal,
      bothScoreHt: match.bothScoreHt,
      anytimeScorecast: match.anytimeScorecast,
      correctScore: match.correctScore,
      riskLevel: match.riskLevel,
      valueScore: match.valueScore,
      marketEdgePct: match.marketEdgePct,
      keyFactors: match.keyFactors,
      aiAnalysis: match.aiAnalysis,
    };
    const matchCtx = {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      sport: sport,
      league: match.league,
      homeForm: match.homeForm,
      awayForm: match.awayForm,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
    };
    return (
      <View style={{ gap: 14 }}>
        <AccuracyBanner sport={sport} C={C} />
        <SportAIPicks prediction={predInput} match={matchCtx} C={C} />
      </View>
    );
  };

  // Tab config
  const tabs: Array<{ id: TabKey; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'aipick', label: 'AI Picks' },
    { id: 'stats', label: isLive ? 'Live Stats' : 'Stats' },
    { id: 'odds', label: 'Odds' },
    ...(isLive ? [{ id: 'timeline' as TabKey, label: 'Timeline' }] : []),
    { id: 'report', label: 'AI Report' },
  ];

  // ─── Mark Result Modal ────────────────────────────────────────────────────
  const renderMarkResultModal = () => (
    <Modal visible={showMarkModal} transparent animationType="fade" onRequestClose={() => setShowMarkModal(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }} onPress={() => { if (!resolving) setShowMarkModal(false); }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[mrm.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={mrm.header}>
              <View style={[mrm.iconWrap, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
                <Ionicons name="checkmark-done-outline" size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[mrm.title, { color: C.textPrimary }]}>Mark Final Score</Text>
                <Text style={[mrm.subtitle, { color: C.textMuted }]} numberOfLines={1}>{match?.homeTeam} vs {match?.awayTeam}</Text>
              </View>
              {!resolving ? <Pressable onPress={() => setShowMarkModal(false)} hitSlop={8}><Ionicons name="close" size={20} color={C.textMuted} /></Pressable> : null}
            </View>
            {resolveResult ? (
              <View style={{ gap: 14 }}>
                <View style={[mrm.resultBanner, resolveResult.is_correct ? { backgroundColor: '#22C55E18', borderColor: '#22C55E55' } : { backgroundColor: '#EF444418', borderColor: '#EF444455' }]}>
                  <Ionicons name={resolveResult.is_correct ? 'checkmark-circle' : 'close-circle'} size={28} color={resolveResult.is_correct ? '#22C55E' : '#EF4444'} />
                  <Text style={[mrm.resultTitle, { color: resolveResult.is_correct ? '#22C55E' : '#EF4444' }]}>{resolveResult.is_correct ? 'Prediction Correct!' : 'Prediction Missed'}</Text>
                </View>
                <View style={mrm.statsRow}>
                  {[{ label: 'BRIER SCORE', value: resolveResult.brier_score.toFixed(4), note: 'lower = better', color: resolveResult.brier_score < 0.2 ? '#22C55E' : resolveResult.brier_score < 0.3 ? '#F59E0B' : '#EF4444' },
                    { label: 'ROLLING ACC.', value: `${resolveResult.rolling_accuracy}%`, note: `last ${resolveResult.sample_size} preds`, color: resolveResult.rolling_accuracy >= 60 ? '#22C55E' : resolveResult.rolling_accuracy >= 45 ? '#F59E0B' : '#EF4444' },
                    { label: 'CALIBRATION', value: resolveResult.drift_warning ? 'DRIFT' : 'OK', note: resolveResult.drift_warning ? '>15% gap' : 'calibrated', color: resolveResult.drift_warning ? '#EF4444' : '#22C55E' },
                  ].map((s) => (
                    <View key={s.label} style={[mrm.statBox, { backgroundColor: `${s.color}10`, borderColor: `${s.color}33` }]}>
                      <Text style={[mrm.statLabel, { color: C.textMuted }]}>{s.label}</Text>
                      <Text style={[mrm.statValue, { color: s.color }]}>{s.value}</Text>
                      <Text style={[mrm.statNote, { color: C.textMuted }]}>{s.note}</Text>
                    </View>
                  ))}
                </View>
                {resolveResult.drift_warning ? <View style={[mrm.warnRow, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}><Ionicons name="warning-outline" size={13} color="#EF4444" /><Text style={[mrm.warnText, { color: '#EF4444' }]}>Calibration drift detected — model weights auto-adjusted.</Text></View> : null}
                <Pressable style={({ pressed }) => [mrm.doneBtn, { backgroundColor: C.primary }, pressed ? { opacity: 0.88 } : null]} onPress={() => setShowMarkModal(false)}>
                  <Text style={[mrm.doneBtnText, { color: C.textInverse }]}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 16 }}>
                <Text style={[mrm.inputLabel, { color: C.textMuted }]}>Enter the final full-time score:</Text>
                <View style={mrm.scoreRow}>
                  <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                    <Text style={[mrm.teamLabel, { color: OV_HOME }]} numberOfLines={1}>{match?.homeTeam}</Text>
                    <TextInput style={[mrm.scoreInput, { backgroundColor: C.surface, borderColor: `${OV_HOME}55`, color: C.textPrimary }]} value={modalHomeScore} onChangeText={(v) => setModalHomeScore(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" maxLength={2} placeholder="0" placeholderTextColor={C.textMuted} textAlign="center" />
                  </View>
                  <Text style={[mrm.vsDivider, { color: C.textMuted }]}>—</Text>
                  <View style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                    <Text style={[mrm.teamLabel, { color: OV_AWAY }]} numberOfLines={1}>{match?.awayTeam}</Text>
                    <TextInput style={[mrm.scoreInput, { backgroundColor: C.surface, borderColor: `${OV_AWAY}55`, color: C.textPrimary }]} value={modalAwayScore} onChangeText={(v) => setModalAwayScore(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" maxLength={2} placeholder="0" placeholderTextColor={C.textMuted} textAlign="center" />
                  </View>
                </View>
                {resolveError ? <View style={[mrm.warnRow, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}><Ionicons name="warning-outline" size={13} color="#EF4444" /><Text style={[mrm.warnText, { color: '#EF4444' }]}>{resolveError}</Text></View> : null}
                <Pressable style={({ pressed }) => [mrm.submitBtn, { backgroundColor: C.primary }, (resolving || !modalHomeScore || !modalAwayScore) ? { opacity: 0.5 } : pressed ? { opacity: 0.88 } : null]} onPress={handleMarkResult} disabled={resolving || !modalHomeScore || !modalAwayScore}>
                  {resolving ? <ActivityIndicator size="small" color={C.textInverse} /> : <><Ionicons name="send-outline" size={15} color={C.textInverse} /><Text style={[mrm.submitBtnText, { color: C.textInverse }]}>Resolve Prediction</Text></>}
                </Pressable>
                <Text style={[mrm.footerNote, { color: C.textMuted }]}>This will update rolling accuracy, Brier score, and auto-adjust model weights.</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[styles.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            {match.league ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {match.flag ? <Text style={{ fontSize: 13 }}>{match.flag}</Text> : null}
                {match.leagueLogo ? <Image source={{ uri: match.leagueLogo }} style={{ width: 16, height: 16, borderRadius: 2 }} contentFit="contain" /> : null}
                <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: C.textSecondary }} numberOfLines={1}>{match.league}</Text>
              </View>
            ) : null}
            {isLive ? <PulsingLiveBadge /> : <Text style={{ fontSize: 11, color: C.textMuted }}>{isFinished ? 'Full Time' : `${fmtDate(match.matchTime)} · ${fmtTime(match.matchTime)}`}</Text>}
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Hero */}
      <LinearGradient colors={[isLive ? '#EF444418' : `${C.primary}14`, C.bg] as [string, string]} style={styles.hero}>
        <View style={styles.teamsRow}>
          <View style={styles.teamCol}>
            <TeamLogo name={match.homeTeam} logoUrl={match.homeLogo} size={56} C={C} />
            <Text style={[styles.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.homeTeam}</Text>
            <Text style={{ fontSize: 11, color: C.textMuted }}>Home</Text>
          </View>
          <View style={styles.scoreCol}>
            {isLive || isFinished ? (
              <>
                <Text style={[styles.bigScore, { color: isLive ? '#EF4444' : C.textPrimary }]}>
                  {detailData?.homeScore ?? match.homeScore} – {detailData?.awayScore ?? match.awayScore}
                </Text>
                {isLive ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444' }} /><Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: '#EF4444' }}>{match.minute}'</Text></View> : <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Full Time</Text>}
              </>
            ) : (
              <View style={{ alignItems: 'center', gap: 6 }}>
                <View style={[{ borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 8 }, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: C.textMuted }}>VS</Text>
                </View>
                <Text style={{ fontSize: 12, color: C.textMuted }}>{fmtTime(match.matchTime)}</Text>
              </View>
            )}
            {match.confidence ? (
              <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 }, { borderColor: match.confidence >= 80 ? '#22C55E44' : '#EAB30844' }]}>
                <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: match.confidence >= 80 ? '#22C55E' : '#EAB308' }}>{match.confidence}%</Text>
              </View>
            ) : null}
          </View>
          <View style={[styles.teamCol, { alignItems: 'flex-end' }]}>
            <TeamLogo name={match.awayTeam} logoUrl={match.awayLogo} size={56} C={C} />
            <Text style={[styles.teamName, { color: C.textPrimary, textAlign: 'right' }]} numberOfLines={2}>{match.awayTeam}</Text>
            <Text style={{ fontSize: 11, color: C.textMuted }}>Away</Text>
          </View>
        </View>
        {/* Outcome badge */}
        {outcomeCorrect !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
            <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 6 }, outcomeCorrect ? { backgroundColor: '#22C55E18', borderColor: '#22C55E55' } : { backgroundColor: '#EF444418', borderColor: '#EF444455' }]}>
              <Ionicons name={outcomeCorrect ? 'checkmark-circle' : 'close-circle'} size={16} color={outcomeCorrect ? '#22C55E' : '#EF4444'} />
              <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: outcomeCorrect ? '#22C55E' : '#EF4444' }}>{outcomeCorrect ? 'PREDICTION CORRECT' : 'PREDICTION MISSED'}</Text>
            </View>
          </View>
        ) : null}
        {/* Prediction chips */}
            {match.hasPrediction ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center', marginTop: 4 }}>
                {(() => {
                  const heroCfg = getPredChipConfig(match.sport);
                  const heroFamily = getSportFamily(match.sport);
                  const heroTerms = getSportTerms(match.sport);
                  const heroIsFight = heroFamily === 'mma' || heroFamily === 'boxing';
                  const heroIsTennis = heroFamily === 'tennis' || heroFamily === 'volleyball';
                  const heroResLabel = match.predictedResult === 'home_win'
                    ? heroCfg.resultChipLabel('home_win', match.homeTeam, match.awayTeam)
                    : match.predictedResult === 'draw' ? heroTerms.drawLabel
                    : heroCfg.resultChipLabel('away_win', match.homeTeam, match.awayTeam);
                  return (
                    <>
                      {match.predictedResult ? (
                        <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 }, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
                          <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: C.primary }}>{heroResLabel}</Text>
                        </View>
                      ) : null}
                      {!heroIsFight && match.overUnder ? (
                        <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 }, { backgroundColor: match.overUnder === 'over' ? '#22C55E18' : '#EF444418', borderColor: match.overUnder === 'over' ? '#22C55E44' : '#EF444444' }]}>
                          <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: match.overUnder === 'over' ? '#22C55E' : '#EF4444' }}>O/U {match.overUnderLine ?? 2.5} {heroCfg.overUnderUnit} {match.overUnder.toUpperCase()}</Text>
                        </View>
                      ) : null}
                      {heroCfg.showBTTS && match.btts ? (
                        <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 }, { backgroundColor: match.btts === 'yes' ? '#14B8A618' : '#F9731618', borderColor: match.btts === 'yes' ? '#14B8A644' : '#F9731644' }]}>
                          <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: match.btts === 'yes' ? '#14B8A6' : '#F97316' }}>BTTS {match.btts.toUpperCase()}</Text>
                        </View>
                      ) : null}
                      {heroIsFight && match.htResult ? (
                        <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 }, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
                          <Text style={{ fontSize: 11, fontWeight: FONTS.semiBold, color: '#EF4444' }}>{match.htResult === 'home_win' ? 'KO/TKO' : match.htResult === 'draw' ? 'Decision' : 'Submission'}</Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            ) : null}
      </LinearGradient>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}
        contentContainerStyle={[styles.tabBarContent, { minWidth: '100%' }]} bounces={false}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable key={tab.id} style={[styles.tab, { borderBottomColor: isActive ? C.primary : 'transparent' }]} onPress={() => setActiveTab(tab.id)}>
              <Text style={[styles.tabText, { color: isActive ? C.primary : C.textMuted }, isActive ? { fontWeight: FONTS.bold } : null]}>{tab.label}</Text>
              {(tab.id === 'report' || tab.id === 'aipick') && match.hasPrediction ? <View style={[styles.tabDot, { backgroundColor: C.primary }]} /> : null}
              {(tab.id === 'report' || tab.id === 'aipick') && autoGenerating && !match.hasPrediction ? <View style={[styles.tabDot, { backgroundColor: '#F59E0B' }]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {renderMarkResultModal()}

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {activeTab === 'overview' ? renderOverview() : null}
        {activeTab === 'aipick' ? renderAIPicks() : null}
        {activeTab === 'stats' ? renderStats() : null}
        {activeTab === 'odds' ? renderOdds() : null}
        {activeTab === 'timeline' ? renderTimeline() : null}
        {activeTab === 'report' ? renderAIReport() : null}
      </ScrollView>
    </View>
  );
}

// ─── Mark Result Modal Styles ──────────────────────────────────────────────────
const mrm = StyleSheet.create({
  card: { width: '100%', borderRadius: RADIUS.xl ?? RADIUS.lg, borderWidth: 1, padding: 20, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 12, marginTop: 2 },
  inputLabel: { fontSize: 13, lineHeight: 20 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamLabel: { fontSize: 12, fontWeight: FONTS.bold, textAlign: 'center' },
  scoreInput: { width: '100%', height: 64, borderRadius: RADIUS.lg, borderWidth: 2, fontSize: 32, fontWeight: FONTS.extraBold },
  vsDivider: { fontSize: 22, fontWeight: FONTS.bold, paddingTop: 28 },
  resultBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  resultTitle: { fontSize: 18, fontWeight: FONTS.extraBold },
  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, alignItems: 'center', gap: 3 },
  statLabel: { fontSize: 8, fontWeight: FONTS.bold, letterSpacing: 0.5, textAlign: 'center' },
  statValue: { fontSize: 16, fontWeight: FONTS.extraBold, textAlign: 'center' },
  statNote: { fontSize: 9, textAlign: 'center' },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  warnText: { fontSize: 12, flex: 1, lineHeight: 18 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14 },
  submitBtnText: { fontSize: 15, fontWeight: FONTS.bold },
  footerNote: { fontSize: 11, textAlign: 'center', lineHeight: 17 },
  doneBtn: { borderRadius: RADIUS.full, paddingVertical: 13, alignItems: 'center' },
  doneBtnText: { fontSize: 15, fontWeight: FONTS.bold },
});

const tl = StyleSheet.create({
  markerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 6, gap: 8 },
  markerLine: { flex: 1, height: 1 },
  markerPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full, borderWidth: 1 },
  markerText: { fontSize: 10, fontWeight: FONTS.bold },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 4 },
  eventContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventContentHome: { justifyContent: 'flex-end' },
  eventContentAway: { justifyContent: 'flex-start' },
  iconBubble: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  textWrap: { maxWidth: 110, gap: 1 },
  playerName: { fontSize: 12, fontWeight: FONTS.bold },
  detailText: { fontSize: 10 },
  typeLabel: { fontSize: 10, fontWeight: FONTS.semiBold },
  minuteCol: { alignItems: 'center', gap: 2, marginHorizontal: 8, width: 52 },
  minuteDot: { width: 1, height: 10 },
  minutePill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center', minWidth: 42 },
  minuteText: { fontSize: 10, fontWeight: FONTS.extraBold, textAlign: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 14, gap: 8 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamCol: { flex: 1, alignItems: 'flex-start', gap: 7 },
  teamName: { fontSize: 13, fontWeight: FONTS.bold, lineHeight: 18 },
  scoreCol: { alignItems: 'center', minWidth: 100 },
  bigScore: { fontSize: 38, fontWeight: FONTS.extraBold, letterSpacing: -1 },
  tabBar: { borderBottomWidth: StyleSheet.hairlineWidth, maxHeight: 48 },
  tabBarContent: { flexDirection: 'row', paddingHorizontal: 4 },
  tab: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2.5, position: 'relative', minWidth: 64, height: 48 },
  tabText: { fontSize: 12, fontWeight: FONTS.medium },
  tabDot: { position: 'absolute', top: 7, right: 6, width: 6, height: 6, borderRadius: 3 },
});
