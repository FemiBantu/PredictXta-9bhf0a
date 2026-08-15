/**
 * app/sport-coverage-test.tsx — Sport Coverage Validation Dashboard
 *
 * Interactive test runner validating all 21 supported sports across:
 *   Layer 1 — Normalization
 *   Layer 2 — Quality Gate
 *   Layer 3 — Statistical Engine
 *   Layer 4 — Market Config
 *   Layer 5 — Database (enabled by default)
 *   Layer 6 — Prediction Pipeline (optional)
 *
 * Also includes a live DB Coverage panel sourced directly from the matches
 * table, and a "Fix Missing Sports" action that triggers fetch-matches for
 * every sport with 0 DB rows.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING, getSportIcon } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import {
  runFullCoverage, runSmokeTest, ALL_SPORTS,
  type CoverageReport, type SportTestReport, type TestResult, type TestStatus,
} from '@/services/sportCoverageTests';

// ─── Known DB audit results (refreshed live on mount) ───────────────────────
const SEEDED_DB_COUNTS: Record<string, number> = {
  football: 3209, baseball: 302, volleyball: 67, cricket: 21, rugby: 7, hockey: 6, handball: 2,
  basketball: 0, tennis: 0, 'american-football': 0, mma: 0, boxing: 0,
  formula1: 0, motorsports: 0, 'table-tennis': 0, badminton: 0,
  snooker: 0, darts: 0, cycling: 0, athletics: 0, esports: 0,
};

// ─── Off-season / data-availability context per sport ───────────────────────
interface SportContext {
  reason: 'off_season' | 'individual_events' | 'no_schedule';
  label: string;
  returnDate?: string;
  note: string;
}

const OFF_SEASON_CONTEXT: Record<string, SportContext> = {
  basketball: { reason: 'off_season', label: 'NBA off-season', returnDate: 'Oct 2026',
    note: 'NBA regular season ended May 2026. Pre-season begins October. WNBA fixtures fetched separately if configured.' },
  'american-football': { reason: 'off_season', label: 'NFL off-season', returnDate: 'Aug 2026',
    note: 'NFL off-season (June). Pre-season starts August, regular season September. College football may appear earlier.' },
  mma: { reason: 'no_schedule', label: 'No event today', returnDate: 'Next UFC event',
    note: 'UFC / MMA events are bi-weekly. No event scheduled for today. Data populates on event week.' },
  boxing: { reason: 'individual_events', label: 'Individual bouts',
    note: 'Boxing bouts are single-athlete events in TheSportsDB — no opposing team field. Our pipeline requires two teams. Major promoted bouts are added manually.' },
  formula1: { reason: 'no_schedule', label: 'No Grand Prix today', returnDate: 'Next race weekend',
    note: 'F1 Grands Prix run bi-weekly on race weekends. Data populates Thursday–Sunday of race weeks. Only Grand Prix events are fetched.' },
  motorsports: { reason: 'individual_events', label: 'Individual entries',
    note: 'TheSportsDB motorsports events (MotoGP, WRC) are lap-time/stage results for individual drivers — no home/away team pair.' },
  tennis: { reason: 'individual_events', label: 'Individual matches',
    note: 'Tennis matches in TheSportsDB lack a fixed home/away team structure. Our null-guard filters these to protect DB constraints. Use ATP/WTA API for player-pair data.' },
  'table-tennis': { reason: 'individual_events', label: 'Individual matches',
    note: 'Table tennis events follow the same individual-player format as tennis. Team matches will populate when scheduled.' },
  badminton: { reason: 'individual_events', label: 'Individual matches',
    note: 'Badminton events are individual-player format. BWF Super Series team fixtures will populate when event data includes home/away pairs.' },
  snooker: { reason: 'individual_events', label: 'Individual frames',
    note: 'Snooker is a head-to-head individual sport. TheSportsDB lists frame results without team fields.' },
  darts: { reason: 'individual_events', label: 'Individual legs',
    note: 'Darts legs are individual athlete events. PDC/BDO fixtures without team names are filtered by the null-guard.' },
  cycling: { reason: 'individual_events', label: 'Stage results',
    note: "Cycling stage races report individual stage results without a home/away team pair. Team time trial stages may populate with a dedicated cycling API." },
  athletics: { reason: 'individual_events', label: 'Individual events',
    note: 'Athletics events (100m, marathon, etc.) are individual-athlete results with no opposing team.' },
  esports: { reason: 'individual_events', label: 'No team data',
    note: 'TheSportsDB esports events often lack structured home/away team names. Dedicated esports API (PandaScore, HLTV) integration is on the roadmap.' },
};

// ─── Status helpers ───────────────────────────────────────────────────────────
function statusColor(status: TestStatus, C: AppColors): string {
  if (status === 'pass') return '#22C55E';
  if (status === 'fail') return '#EF4444';
  if (status === 'warn') return '#F59E0B';
  return C.textMuted;
}
function statusIcon(status: TestStatus): string {
  if (status === 'pass') return 'checkmark-circle';
  if (status === 'fail') return 'close-circle';
  if (status === 'warn') return 'warning';
  return 'remove-circle-outline';
}
function scoreColor(score: number, C: AppColors): string {
  if (score >= 85) return '#22C55E';
  if (score >= 70) return '#6EDC1F';
  if (score >= 55) return '#F59E0B';
  return '#EF4444';
}
function dbColor(count: number): string {
  if (count >= 50) return '#22C55E';
  if (count >= 5)  return '#F59E0B';
  return '#EF4444';
}

// ─── Animated Score Ring ──────────────────────────────────────────────────────
function ScoreRing({ score, size = 72, C }: { score: number; size?: number; C: AppColors }) {
  const color = scoreColor(score, C);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [score]);
  const rotate = Math.min(score, 99) * 3.6 - 90;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 5, borderColor: `${color}22` }} />
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 5, borderColor: color, borderTopColor: `${color}22`, borderRightColor: `${color}22`, transform: [{ rotate: `${rotate}deg` }] }} />
      <Text style={{ fontSize: size > 64 ? 22 : 16, fontWeight: FONTS.extraBold, color }}>{score}</Text>
      <Text style={{ fontSize: 8, color: C.textMuted, fontWeight: FONTS.bold, letterSpacing: 0.3 }}>SCORE</Text>
    </View>
  );
}

// ─── Test Result Row ──────────────────────────────────────────────────────────
function TestRow({ test, C }: { test: TestResult; C: AppColors }) {
  const [expanded, setExpanded] = useState(false);
  const color = statusColor(test.status, C);
  return (
    <Pressable style={[trow.wrap, { borderBottomColor: C.border }]} onPress={() => test.detail ? setExpanded(!expanded) : null}>
      <Ionicons name={statusIcon(test.status) as any} size={14} color={color} style={{ flexShrink: 0 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[trow.name, { color: C.textPrimary }]}>{test.name}</Text>
        <Text style={[trow.msg, { color: C.textMuted }]} numberOfLines={expanded ? undefined : 1}>{test.message}</Text>
        {expanded && test.detail ? <Text style={[trow.detail, { color: C.accentBlue }]}>{test.detail}</Text> : null}
      </View>
      {test.duration !== undefined ? <Text style={[trow.ms, { color: C.textMuted }]}>{test.duration}ms</Text> : null}
      {test.detail ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={C.textMuted} /> : null}
    </Pressable>
  );
}
const trow = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 12, fontWeight: FONTS.semiBold },
  msg: { fontSize: 10, lineHeight: 14 },
  detail: { fontSize: 10, lineHeight: 14, fontStyle: 'italic' },
  ms: { fontSize: 9, flexShrink: 0 },
});

// ─── Layer Accordion ──────────────────────────────────────────────────────────
function LayerSection({ title, tests, icon, C }: { title: string; tests: TestResult[]; icon: string; C: AppColors }) {
  const [open, setOpen] = useState(false);
  if (tests.length === 0) return null;
  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const warned = tests.filter((t) => t.status === 'warn').length;
  const layerStatus: TestStatus = failed > 0 ? 'fail' : warned > 0 ? 'warn' : 'pass';
  const color = statusColor(layerStatus, C);
  return (
    <View style={[layer.wrap, { borderColor: C.border }]}>
      <Pressable style={[layer.header, { backgroundColor: `${color}08` }]} onPress={() => setOpen(!open)}>
        <View style={[layer.iconBox, { backgroundColor: `${color}14`, borderColor: `${color}30` }]}>
          <Ionicons name={icon as any} size={11} color={color} />
        </View>
        <Text style={[layer.title, { color: C.textPrimary }]}>{title}</Text>
        <View style={layer.chips}>
          {passed > 0 ? <View style={[layer.chip, { backgroundColor: '#22C55E18' }]}><Text style={[layer.chipText, { color: '#22C55E' }]}>{passed}✓</Text></View> : null}
          {warned > 0 ? <View style={[layer.chip, { backgroundColor: '#F59E0B18' }]}><Text style={[layer.chipText, { color: '#F59E0B' }]}>{warned}⚠</Text></View> : null}
          {failed > 0 ? <View style={[layer.chip, { backgroundColor: '#EF444418' }]}><Text style={[layer.chipText, { color: '#EF4444' }]}>{failed}✗</Text></View> : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={C.textMuted} />
      </Pressable>
      {open ? (
        <View style={layer.body}>
          {tests.map((t, i) => <TestRow key={`${t.name}-${i}`} test={t} C={C} />)}
        </View>
      ) : null}
    </View>
  );
}
const layer = StyleSheet.create({
  wrap: { borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden', marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  iconBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { flex: 1, fontSize: 12, fontWeight: FONTS.bold },
  chips: { flexDirection: 'row', gap: 4 },
  chip: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontSize: 9, fontWeight: FONTS.bold },
  body: { paddingHorizontal: 10, paddingBottom: 6 },
});

// ─── Off-Season Badge ────────────────────────────────────────────────────────
function OffSeasonBadge({ sportKey, C }: { sportKey: string; C: AppColors }) {
  const ctx = OFF_SEASON_CONTEXT[sportKey];
  if (!ctx) {
    return (
      <View style={[ob.pill, { backgroundColor: '#EF444412', borderColor: '#EF444433' }]}>
        <Ionicons name="server-outline" size={9} color="#EF4444" />
        <Text style={[ob.text, { color: '#EF4444' }]}>NO DB DATA</Text>
      </View>
    );
  }
  const isOffSeason = ctx.reason === 'off_season';
  const isIndividual = ctx.reason === 'individual_events';
  const color = isOffSeason ? '#F59E0B' : isIndividual ? '#6B7280' : '#8B5CF6';
  const icon = isOffSeason ? 'time-outline' : isIndividual ? 'person-outline' : 'calendar-outline';
  return (
    <View style={[ob.pill, { backgroundColor: `${color}12`, borderColor: `${color}33` }]}>
      <Ionicons name={icon as any} size={9} color={color} />
      <Text style={[ob.text, { color }]}>{ctx.label}</Text>
      {ctx.returnDate ? (
        <Text style={[ob.date, { color, backgroundColor: `${color}18` }]}>{ctx.returnDate}</Text>
      ) : null}
    </View>
  );
}
const ob = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  text: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  date: { fontSize: 8, fontWeight: FONTS.bold, borderRadius: RADIUS.full, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2 },
});

// ─── Off-Season Note Panel ────────────────────────────────────────────────────
function OffSeasonNotePanel({ sportKey, C }: { sportKey: string; C: AppColors }) {
  const ctx = OFF_SEASON_CONTEXT[sportKey];
  if (!ctx) return null;
  const isOffSeason = ctx.reason === 'off_season';
  const isIndividual = ctx.reason === 'individual_events';
  const color = isOffSeason ? '#F59E0B' : isIndividual ? '#6B7280' : '#8B5CF6';
  const icon = isOffSeason ? 'time-outline' : isIndividual ? 'person-outline' : 'information-circle-outline';
  const title = isOffSeason
    ? `Off-Season${ctx.returnDate ? ` · Returns ${ctx.returnDate}` : ''}`
    : isIndividual ? 'Individual Sport — No Team Pairs' : 'No Scheduled Events';
  return (
    <View style={[onp.wrap, { backgroundColor: `${color}0A`, borderColor: `${color}22` }]}>
      <View style={[onp.iconWrap, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
        <Ionicons name={icon as any} size={13} color={color} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[onp.title, { color }]}>{title}</Text>
        <Text style={[onp.note, { color: C.textMuted }]}>{ctx.note}</Text>
      </View>
    </View>
  );
}
const onp = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, marginTop: 4 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  title: { fontSize: 11, fontWeight: FONTS.bold as any, letterSpacing: 0.2 },
  note: { fontSize: 10, lineHeight: 15 },
});

// ─── Sport Report Card ────────────────────────────────────────────────────────
function SportCard({ report, dbCount, C }: { report: SportTestReport; dbCount: number; C: AppColors }) {
  const [open, setOpen] = useState(false);
  const statusC = statusColor(report.overall, C);
  const scoreC  = scoreColor(report.score, C);
  const icon    = getSportIcon(report.sport.dbKey);
  const dc      = dbColor(dbCount);

  const layerDefs = [
    { key: 'normalization', title: 'Layer 1 — Normalization',  icon: 'key-outline' },
    { key: 'qualityGate',   title: 'Layer 2 — Quality Gate',   icon: 'shield-checkmark-outline' },
    { key: 'engine',        title: 'Layer 3 — Stat Engine',    icon: 'calculator-outline' },
    { key: 'market',        title: 'Layer 4 — Market Config',  icon: 'trending-up-outline' },
  ] as const;

  const extraTests: TestResult[] = [
    ...(report.layers.database ? [report.layers.database] : []),
    ...(report.layers.pipeline ? [report.layers.pipeline] : []),
  ];

  return (
    <Pressable
      style={[card.wrap, { backgroundColor: C.card, borderColor: report.overall === 'fail' ? '#EF444444' : report.overall === 'warn' ? '#F59E0B33' : C.border }]}
      onPress={() => setOpen(!open)}
    >
      <View style={card.header}>
        <View style={[card.iconBox, { backgroundColor: `${statusC}12`, borderColor: `${statusC}33` }]}>
          <Text style={card.emoji}>{icon}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[card.name, { color: C.textPrimary }]}>{report.sport.ui}</Text>
          <Text style={[card.sub, { color: C.textMuted }]}>{report.sport.apiProvider} · {report.sport.dbKey}</Text>
        </View>
        {/* DB count badge */}
        <View style={[card.dbBadge, { backgroundColor: `${dc}12`, borderColor: `${dc}33` }]}>
          <Ionicons name="server-outline" size={9} color={dc} />
          <Text style={[card.dbText, { color: dc }]}>{dbCount > 999 ? `${(dbCount / 1000).toFixed(1)}k` : String(dbCount)}</Text>
        </View>
        <View style={[card.scorePill, { backgroundColor: `${scoreC}14`, borderColor: `${scoreC}33` }]}>
          <Text style={[card.scoreText, { color: scoreC }]}>{report.score}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
      </View>

      {/* Progress bar */}
      <View style={[card.progressTrack, { backgroundColor: C.surface }]}>
        <View style={[card.progressFill, { width: `${report.score}%`, backgroundColor: scoreC }]} />
      </View>

      {/* Pass/fail summary */}
      <View style={card.footer}>
        <Text style={[card.footerChip, { color: '#22C55E' }]}>{report.totalPassed}✓</Text>
        {report.totalFailed > 0 ? <Text style={[card.footerChip, { color: '#EF4444' }]}>{report.totalFailed}✗</Text> : null}
        {report.totalWarned > 0 ? <Text style={[card.footerChip, { color: '#F59E0B' }]}>{report.totalWarned}⚠</Text> : null}
        {dbCount === 0 ? <OffSeasonBadge sportKey={report.sport.dbKey} C={C} /> : null}
      </View>

      {open ? (
        <View style={card.body}>
          {layerDefs.map((ld) => {
            const tests = report.layers[ld.key];
            return tests.length > 0 ? <LayerSection key={ld.key} title={ld.title} tests={tests} icon={ld.icon} C={C} /> : null;
          })}
          {extraTests.length > 0 ? <LayerSection title="Layer 5-6 — DB & Pipeline" tests={extraTests} icon="server-outline" C={C} /> : null}
          {dbCount === 0 ? <OffSeasonNotePanel sportKey={report.sport.dbKey} C={C} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
const card = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  iconBox: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emoji: { fontSize: 20 },
  name: { fontSize: 14, fontWeight: FONTS.bold },
  sub: { fontSize: 10 },
  dbBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  dbText: { fontSize: 10, fontWeight: FONTS.extraBold },
  scorePill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, minWidth: 32, alignItems: 'center' },
  scoreText: { fontSize: 12, fontWeight: FONTS.extraBold },
  progressTrack: { height: 3, marginHorizontal: 14 },
  progressFill: { height: '100%', borderRadius: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, paddingTop: 4 },
  footerChip: { fontSize: 11, fontWeight: FONTS.bold },
  missingPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 4 },
  body: { padding: 12, paddingTop: 4 },
});

// ─── Summary Header ───────────────────────────────────────────────────────────
function SummaryHeader({ report, C }: { report: CoverageReport; C: AppColors }) {
  const sc = scoreColor(report.overallScore, C);
  return (
    <LinearGradient colors={[`${sc}18`, `${sc}06`] as [string, string]} style={[sum.wrap, { borderColor: `${sc}22` }]}>
      <View style={sum.left}>
        <ScoreRing score={report.overallScore} size={80} C={C} />
      </View>
      <View style={sum.right}>
        <Text style={[sum.title, { color: C.textPrimary }]}>Coverage Report</Text>
        <Text style={[sum.date, { color: C.textMuted }]}>{new Date(report.generatedAt).toLocaleString()}</Text>
        <View style={sum.kpis}>
          {[
            { val: report.passed,  color: '#22C55E', lbl: 'PASS' },
            { val: report.failed,  color: '#EF4444', lbl: 'FAIL' },
            { val: report.warned,  color: '#F59E0B', lbl: 'WARN' },
            { val: report.totalSports, color: C.textPrimary, lbl: 'TOTAL' },
          ].map((k, i) => (
            <React.Fragment key={k.lbl}>
              {i > 0 ? <View style={[sum.kpiDiv, { backgroundColor: C.border }]} /> : null}
              <View style={sum.kpi}>
                <Text style={[sum.kpiVal, { color: k.color }]}>{k.val}</Text>
                <Text style={[sum.kpiLbl, { color: C.textMuted }]}>{k.lbl}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}
const sum = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, flexDirection: 'row', gap: 16, alignItems: 'center' },
  left: {},
  right: { flex: 1, gap: 6 },
  title: { fontSize: 17, fontWeight: FONTS.extraBold },
  date: { fontSize: 10 },
  kpis: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  kpi: { flex: 1, alignItems: 'center', gap: 2 },
  kpiDiv: { width: 1, height: 24, marginHorizontal: 4 },
  kpiVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  kpiLbl: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
});

// ─── Layer Score Grid ─────────────────────────────────────────────────────────
function LayerGrid({ summary, C }: { summary: CoverageReport['summary']; C: AppColors }) {
  const cells = [
    { label: 'Normalization', score: summary.normalizationScore, icon: 'key-outline' },
    { label: 'Quality Gate',  score: summary.qualityGateScore,   icon: 'shield-checkmark-outline' },
    { label: 'Stat Engine',   score: summary.engineScore,        icon: 'calculator-outline' },
    { label: 'Market Config', score: summary.marketScore,        icon: 'trending-up-outline' },
    { label: 'DB Coverage',   score: summary.dbCoverage,         icon: 'server-outline' },
    { label: 'Predictions',   score: summary.pipelineCoverage,   icon: 'brain-outline' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {cells.map((c) => {
        const sc = scoreColor(c.score, C);
        return (
          <View key={c.label} style={[lgrid.cell, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name={c.icon as any} size={13} color={sc} />
            <Text style={[lgrid.val, { color: sc }]}>{c.score}%</Text>
            <Text style={[lgrid.lbl, { color: C.textMuted }]}>{c.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
const lgrid = StyleSheet.create({
  cell: { flex: 1, minWidth: '30%', alignItems: 'center', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 6 },
  val: { fontSize: 18, fontWeight: FONTS.extraBold },
  lbl: { fontSize: 8, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
});

// ─── DB Coverage Panel ────────────────────────────────────────────────────────
interface DbCounts { [sport: string]: number }

function DbCoveragePanel({
  dbCounts, fixingAll, onFixAll, onFixSingle, fixingSingle, C,
}: {
  dbCounts: DbCounts;
  fixingAll: boolean;
  onFixAll: () => void;
  onFixSingle: (sport: string) => void;
  fixingSingle: string | null;
  C: AppColors;
}) {
  const present = ALL_SPORTS.filter((s) => (dbCounts[s.dbKey] ?? 0) > 0);
  const missing = ALL_SPORTS.filter((s) => (dbCounts[s.dbKey] ?? 0) === 0);
  const totalMatches = Object.values(dbCounts).reduce((a, b) => a + b, 0);

  return (
    <View style={[dbp.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={dbp.header}>
        <View style={[dbp.iconBox, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}30` }]}>
          <Ionicons name="server-outline" size={16} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[dbp.title, { color: C.textPrimary }]}>Layer 5 — Database Coverage</Text>
          <Text style={[dbp.sub, { color: C.textMuted }]}>
            {present.length}/21 sports populated · {totalMatches.toLocaleString()} total matches
          </Text>
        </View>
      </View>

      {/* Summary bar */}
      <View style={dbp.summaryRow}>
        <View style={[dbp.summaryCell, { backgroundColor: '#22C55E12', borderColor: '#22C55E33' }]}>
          <Text style={[dbp.summaryVal, { color: '#22C55E' }]}>{present.length}</Text>
          <Text style={[dbp.summaryLbl, { color: C.textMuted }]}>PRESENT</Text>
        </View>
        <View style={[dbp.summaryCell, { backgroundColor: '#EF444412', borderColor: '#EF444433' }]}>
          <Text style={[dbp.summaryVal, { color: '#EF4444' }]}>{missing.length}</Text>
          <Text style={[dbp.summaryLbl, { color: C.textMuted }]}>MISSING</Text>
        </View>
        <View style={[dbp.summaryCell, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
          <Text style={[dbp.summaryVal, { color: C.primary }]}>{totalMatches.toLocaleString()}</Text>
          <Text style={[dbp.summaryLbl, { color: C.textMuted }]}>MATCHES</Text>
        </View>
      </View>

      {/* Progress track */}
      <View style={[dbp.track, { backgroundColor: C.surface }]}>
        <View style={[dbp.fill, { width: `${Math.round((present.length / 21) * 100)}%`, backgroundColor: present.length >= 18 ? '#22C55E' : present.length >= 12 ? '#F59E0B' : '#EF4444' }]} />
      </View>
      <Text style={[dbp.pct, { color: C.textMuted }]}>{Math.round((present.length / 21) * 100)}% coverage</Text>

      {/* Fix Missing button */}
      {missing.length > 0 ? (
        <Pressable
          style={({ pressed }) => [dbp.fixBtn, { backgroundColor: fixingAll ? '#EF444408' : '#EF444412', borderColor: '#EF444444' }, pressed && !fixingAll ? { opacity: 0.8 } : null]}
          onPress={onFixAll}
          disabled={fixingAll || fixingSingle !== null}
        >
          {fixingAll ? <ActivityIndicator size="small" color="#EF4444" /> : <Ionicons name="flash-outline" size={14} color="#EF4444" />}
          <Text style={[dbp.fixBtnText, { color: '#EF4444' }]}>
            {fixingAll ? 'Syncing missing sports...' : `Fix ${missing.length} Missing Sports`}
          </Text>
        </Pressable>
      ) : (
        <View style={[dbp.allGoodBadge, { backgroundColor: '#22C55E12', borderColor: '#22C55E33' }]}>
          <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
          <Text style={[dbp.allGoodText, { color: '#22C55E' }]}>All 21 sports have DB data</Text>
        </View>
      )}

      {/* Present sports grid */}
      {present.length > 0 ? (
        <>
          <Text style={[dbp.sectionLabel, { color: C.textMuted }]}>PRESENT ({present.length})</Text>
          <View style={dbp.grid}>
            {present.map((sp) => {
              const count = dbCounts[sp.dbKey] ?? 0;
              const dc = dbColor(count);
              return (
                <View key={sp.dbKey} style={[dbp.cell, { backgroundColor: `${dc}0A`, borderColor: `${dc}25` }]}>
                  <Text style={dbp.cellEmoji}>{getSportIcon(sp.dbKey)}</Text>
                  <Text style={[dbp.cellName, { color: C.textPrimary }]} numberOfLines={1}>{sp.ui}</Text>
                  <Text style={[dbp.cellCount, { color: dc }]}>{count > 999 ? `${(count / 1000).toFixed(1)}k` : String(count)}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Missing sports list */}
      {missing.length > 0 ? (
        <>
          <Text style={[dbp.sectionLabel, { color: C.textMuted }]}>MISSING ({missing.length}) — tap to sync individually</Text>
          {/* Global off-season explanation */}
          <View style={[{ borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 4 }, { backgroundColor: C.surface, borderColor: C.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="information-circle-outline" size={12} color={C.textMuted} />
              <Text style={{ fontSize: 10, fontWeight: FONTS.bold as any, color: C.textMuted }}>WHY ARE THESE 0?</Text>
            </View>
            <Text style={{ fontSize: 10, color: C.textMuted, lineHeight: 15 }}>
              {'🟡 Off-season (NBA, NFL): in off-season as of June 2026. Returns Aug–Oct.  '}
              {'⚪ Individual-event sports (tennis, MMA, boxing, F1, cycling, esports): TheSportsDB stores these without home/away team pairs. Our pipeline correctly filters them to protect DB constraints.'}
            </Text>
          </View>
          <View style={dbp.missingList}>
            {missing.map((sp) => {
              const isSyncing = fixingSingle === sp.dbKey || fixingAll;
              const ctx = OFF_SEASON_CONTEXT[sp.dbKey];
              const ctxColor = ctx?.reason === 'off_season' ? '#F59E0B' : ctx?.reason === 'individual_events' ? '#6B7280' : '#8B5CF6';
              return (
                <Pressable
                  key={sp.dbKey}
                  style={({ pressed }) => [dbp.missingRow, { borderBottomColor: C.border }, pressed && !isSyncing ? { backgroundColor: C.surface } : null]}
                  onPress={() => onFixSingle(sp.dbKey)}
                  disabled={isSyncing || fixingAll}
                >
                  <Text style={dbp.missingEmoji}>{getSportIcon(sp.dbKey)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[dbp.missingName, { color: C.textPrimary }]}>{sp.ui}</Text>
                    <Text style={[dbp.missingProvider, { color: C.textMuted }]}>{sp.apiProvider} · {sp.dbKey}</Text>
                    {ctx ? (
                      <Text style={{ fontSize: 9, color: ctxColor, fontWeight: FONTS.semiBold as any, marginTop: 1 }}>
                        {ctx.reason === 'off_season' ? `Returns ${ctx.returnDate ?? 'later'}` :
                         ctx.reason === 'individual_events' ? 'Individual sport — no team pair' : 'No events scheduled today'}
                      </Text>
                    ) : null}
                  </View>
                  {isSyncing ? (
                    <ActivityIndicator size="small" color={C.primary} />
                  ) : (
                    <View style={[dbp.syncBtn, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}44` }]}>
                      <Ionicons name="sync-outline" size={11} color={C.primary} />
                      <Text style={[dbp.syncBtnText, { color: C.primary }]}>Sync</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}
const dbp = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: FONTS.bold },
  sub: { fontSize: 11, marginTop: 1 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryCell: { flex: 1, alignItems: 'center', gap: 3, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10 },
  summaryVal: { fontSize: 22, fontWeight: FONTS.extraBold },
  summaryLbl: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  track: { height: 7, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { fontSize: 10, textAlign: 'right', marginTop: -8 },
  fixBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 12 },
  fixBtnText: { fontSize: 13, fontWeight: FONTS.bold },
  allGoodBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 10 },
  allGoodText: { fontSize: 12, fontWeight: FONTS.semiBold },
  sectionLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { minWidth: '21%', flex: 1, alignItems: 'center', gap: 3, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 4 },
  cellEmoji: { fontSize: 16 },
  cellName: { fontSize: 8, fontWeight: FONTS.semiBold, textAlign: 'center' },
  cellCount: { fontSize: 12, fontWeight: FONTS.extraBold },
  missingList: { borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  missingEmoji: { fontSize: 18, width: 26 },
  missingName: { fontSize: 13, fontWeight: FONTS.semiBold },
  missingProvider: { fontSize: 10, marginTop: 1 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  syncBtnText: { fontSize: 11, fontWeight: FONTS.bold },
});

// ─── Progress Bar (while running tests) ──────────────────────────────────────
function RunProgress({ current, total, sport, C }: { current: number; total: number; sport: string; C: AppColors }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <View style={[prog.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={[prog.label, { color: C.textPrimary }]}>Running tests…</Text>
        <Text style={[prog.pct, { color: C.primary }]}>{current}/{total}</Text>
      </View>
      <View style={[prog.track, { backgroundColor: C.surface }]}>
        <View style={[prog.fill, { width: `${pct}%`, backgroundColor: C.primary }]} />
      </View>
      <Text style={[prog.sport, { color: C.textMuted }]}>{getSportIcon(sport.toLowerCase())} {sport}</Text>
    </View>
  );
}
const prog = StyleSheet.create({
  wrap: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 4 },
  label: { fontSize: 13, fontWeight: FONTS.bold },
  pct: { fontSize: 13, fontWeight: FONTS.bold },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: 4 },
  fill: { height: '100%', borderRadius: 3 },
  sport: { fontSize: 11, marginTop: 4 },
});

// ─── Filter Bar ───────────────────────────────────────────────────────────────
type FilterMode = 'all' | 'fail' | 'warn' | 'pass';

function FilterBar({ active, onChange, counts, C }: {
  active: FilterMode; onChange: (m: FilterMode) => void;
  counts: Record<FilterMode, number>; C: AppColors;
}) {
  const opts: { key: FilterMode; label: string; color: string }[] = [
    { key: 'all',  label: `All (${counts.all})`,  color: C.textPrimary },
    { key: 'fail', label: `Fail (${counts.fail})`, color: '#EF4444' },
    { key: 'warn', label: `Warn (${counts.warn})`, color: '#F59E0B' },
    { key: 'pass', label: `Pass (${counts.pass})`, color: '#22C55E' },
  ];
  return (
    <View style={[fbar.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {opts.map((o) => (
        <Pressable
          key={o.key}
          style={[fbar.btn, { borderColor: C.border }, active === o.key ? { backgroundColor: `${o.color}14`, borderColor: `${o.color}44` } : null]}
          onPress={() => onChange(o.key)}
        >
          <Text style={[fbar.label, { color: active === o.key ? o.color : C.textMuted }, active === o.key ? { fontWeight: FONTS.bold } : null]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const fbar = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1, padding: 4 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: RADIUS.md, borderWidth: 1 },
  label: { fontSize: 10, fontWeight: FONTS.medium },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SportCoverageTestScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ sport: '', idx: 0, total: 0 });
  const [filter, setFilter] = useState<FilterMode>('all');
  // Layer 5 DB is ON by default — key change from previous version
  const [runDB, setRunDB] = useState(true);
  const [runPipeline, setRunPipeline] = useState(false);
  // Live DB counts (seeded from SQL audit, refreshed from DB on mount)
  const [dbCounts, setDbCounts] = useState<DbCounts>(SEEDED_DB_COUNTS);
  const [fixingAll, setFixingAll] = useState(false);
  const [fixingSingle, setFixingSingle] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string[]>([]);

  // ── Refresh DB counts from live DB ──────────────────────────────────────────
  const refreshDbCounts = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('matches')
        .select('sport')
        .then(({ data: rows, error }) => {
          if (error || !rows) return { data: {} };
          const map: DbCounts = {};
          for (const row of rows as { sport: string }[]) {
            map[row.sport] = (map[row.sport] ?? 0) + 1;
          }
          return { data: map };
        });
      if (data && Object.keys(data).length > 0) {
        setDbCounts((prev) => ({ ...prev, ...data }));
      }
    } catch { /* non-blocking */ }
  }, []);

  // ── Trigger fetch-matches for a single sport ─────────────────────────────────
  const triggerSportSync = useCallback(async (sportKey: string): Promise<{ fetched: number; inserted: number }> => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('fetch-matches', {
      body: { mode: 'today', sport: sportKey },
    });
    if (error) {
      let msg = error.message;
      try {
        const txt = await (error as any).context?.text();
        if (txt) msg = txt;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return { fetched: data?.fetched ?? 0, inserted: data?.inserted ?? 0 };
  }, []);

  // ── Fix a single missing sport ────────────────────────────────────────────
  const handleFixSingle = useCallback(async (sportKey: string) => {
    if (fixingSingle || fixingAll) return;
    setFixingSingle(sportKey);
    setSyncLog((p) => [...p, `⏳ Syncing ${sportKey}...`]);
    try {
      const result = await triggerSportSync(sportKey);
      setSyncLog((p) => [...p, `✅ ${sportKey}: fetched=${result.fetched} inserted=${result.inserted}`]);
      await refreshDbCounts();
    } catch (e) {
      setSyncLog((p) => [...p, `❌ ${sportKey}: ${String(e).slice(0, 80)}`]);
    }
    setFixingSingle(null);
  }, [fixingSingle, fixingAll, triggerSportSync, refreshDbCounts]);

  // ── Fix ALL missing sports sequentially ───────────────────────────────────
  const handleFixAll = useCallback(async () => {
    if (fixingAll || fixingSingle) return;
    const missing = ALL_SPORTS.filter((s) => (dbCounts[s.dbKey] ?? 0) === 0);
    if (missing.length === 0) return;
    setFixingAll(true);
    setSyncLog([`🚀 Starting sync for ${missing.length} missing sports...`]);
    let successCount = 0;
    for (const sp of missing) {
      setSyncLog((p) => [...p, `⏳ Syncing ${sp.ui}...`]);
      try {
        const result = await triggerSportSync(sp.dbKey);
        successCount++;
        setSyncLog((p) => [...p, `✅ ${sp.ui}: fetched=${result.fetched} inserted=${result.inserted}`]);
      } catch (e) {
        setSyncLog((p) => [...p, `❌ ${sp.ui}: ${String(e).slice(0, 80)}`]);
      }
    }
    setSyncLog((p) => [...p, `🏁 Done — ${successCount}/${missing.length} sports synced`]);
    await refreshDbCounts();
    setFixingAll(false);
  }, [fixingAll, fixingSingle, dbCounts, triggerSportSync, refreshDbCounts]);

  // ── Run full test suite ───────────────────────────────────────────────────
  const runTests = useCallback(async () => {
    setRunning(true);
    setReport(null);
    setProgress({ sport: '', idx: 0, total: 21 });
    try {
      const result = await runFullCoverage({
        runDB,
        runPipeline,
        onProgress: (sp, idx, total) => setProgress({ sport: sp, idx, total }),
      });
      setReport(result);
    } finally {
      setRunning(false);
    }
  }, [runDB, runPipeline]);

  // Auto-run on mount (with Layer 5 enabled by default)
  const ranOnce = useRef(false);
  useEffect(() => {
    if (!ranOnce.current) {
      ranOnce.current = true;
      refreshDbCounts();
      setTimeout(runTests, 300);
    }
  }, []);

  const filteredSports = report?.sports.filter((r) => {
    if (filter === 'all')  return true;
    if (filter === 'fail') return r.overall === 'fail';
    if (filter === 'warn') return r.overall === 'warn' || r.overall === 'skip';
    if (filter === 'pass') return r.overall === 'pass';
    return true;
  }) ?? [];

  const counts: Record<FilterMode, number> = {
    all:  report?.totalSports ?? 21,
    fail: report?.failed ?? 0,
    warn: report?.warned ?? 0,
    pass: report?.passed ?? 0,
  };

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[s.title, { color: C.textPrimary }]}>Sport Coverage Tests</Text>
            <Text style={[s.subtitle, { color: C.textMuted }]}>21 sports · 6 validation layers · L5 DB ON</Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.runBtn, { backgroundColor: running ? C.surface : C.primary, opacity: pressed ? 0.8 : 1 }]}
            onPress={runTests}
            disabled={running}
          >
            {running ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="play" size={14} color="#000" />}
            <Text style={[s.runBtnText, { color: running ? C.primary : '#000' }]}>
              {running ? 'Running' : 'Run'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── Test Options ───────────────────────────────────────────────────── */}
        <View style={[s.optCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.optTitle, { color: C.textSecondary }]}>Test Options</Text>
          <View style={s.optRow}>
            <Ionicons name="server-outline" size={14} color={runDB ? C.primary : C.textMuted} />
            <Text style={[s.optLabel, { color: C.textPrimary }]}>Layer 5 — Database</Text>
            <Switch value={runDB} onValueChange={(v) => { setRunDB(v); setReport(null); }} trackColor={{ true: C.primary, false: C.border }} thumbColor={C.textPrimary} />
          </View>
          <View style={[s.optRow, { borderBottomWidth: 0 }]}>
            <FontAwesome5 name="brain" size={13} color={runPipeline ? C.primary : C.textMuted} />
            <Text style={[s.optLabel, { color: C.textPrimary }]}>Layer 6 — Pipeline</Text>
            <Switch value={runPipeline} onValueChange={(v) => { setRunPipeline(v); setReport(null); }} trackColor={{ true: C.primary, false: C.border }} thumbColor={C.textPrimary} />
          </View>
        </View>

        {/* ── DB Coverage Panel (always visible) ────────────────────────────── */}
        <DbCoveragePanel
          dbCounts={dbCounts}
          fixingAll={fixingAll}
          onFixAll={handleFixAll}
          onFixSingle={handleFixSingle}
          fixingSingle={fixingSingle}
          C={C}
        />

        {/* ── Sync Log ──────────────────────────────────────────────────────── */}
        {syncLog.length > 0 ? (
          <View style={[s.logCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={s.logHeader}>
              <Ionicons name="terminal-outline" size={13} color={C.primary} />
              <Text style={[s.logTitle, { color: C.textPrimary }]}>Sync Log</Text>
              <Pressable onPress={() => setSyncLog([])} hitSlop={8}>
                <Ionicons name="close" size={14} color={C.textMuted} />
              </Pressable>
            </View>
            {syncLog.map((line, i) => (
              <Text key={i} style={[s.logLine, {
                color: line.startsWith('✅') ? '#22C55E' : line.startsWith('❌') ? '#EF4444' : line.startsWith('🏁') ? C.primary : C.textMuted,
              }]} numberOfLines={2}>{line}</Text>
            ))}
          </View>
        ) : null}

        {/* ── Running progress ──────────────────────────────────────────────── */}
        {running ? <RunProgress current={progress.idx} total={progress.total} sport={progress.sport} C={C} /> : null}

        {/* ── Full report ───────────────────────────────────────────────────── */}
        {report ? (
          <>
            <SummaryHeader report={report} C={C} />
            <LayerGrid summary={report.summary} C={C} />
            <FilterBar active={filter} onChange={setFilter} counts={counts} C={C} />

            <View style={[s.sectionHeader, { borderBottomColor: C.border }]}>
              <Ionicons name="list-outline" size={14} color={C.textMuted} />
              <Text style={[s.sectionTitle, { color: C.textSecondary }]}>
                {filter === 'all' ? 'All Sports' : `${filter.toUpperCase()} Sports`}{'  '}({filteredSports.length})
              </Text>
            </View>

            {filteredSports.map((r) => (
              <SportCard
                key={r.sport.dbKey}
                report={r}
                dbCount={dbCounts[r.sport.dbKey] ?? 0}
                C={C}
              />
            ))}

            {/* Legend */}
            <View style={[s.legendCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[s.legendTitle, { color: C.textSecondary }]}>Legend</Text>
              {[
                { dot: '#22C55E', label: 'PASS — Test successful, layer fully operational' },
                { dot: '#F59E0B', label: 'WARN — Partial coverage, needs attention but non-blocking' },
                { dot: '#EF4444', label: 'FAIL — Critical issue, sport may not render correctly' },
                { dot: C.textMuted, label: 'SKIP — Layer not applicable for this sport' },
              ].map((l) => (
                <View key={l.label} style={s.legendRow}>
                  <View style={[s.legendDot, { backgroundColor: l.dot }]} />
                  <Text style={[s.legendText, { color: C.textMuted }]}>{l.label}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1 },
  title: { fontSize: 17, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 10, marginTop: 1 },
  runBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 8 },
  runBtnText: { fontSize: 12, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md, gap: 10 },
  optCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 0 },
  optTitle: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  optLabel: { flex: 1, fontSize: 13, fontWeight: FONTS.medium },
  logCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 4 },
  logHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  logTitle: { flex: 1, fontSize: 12, fontWeight: FONTS.bold },
  logLine: { fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 2 },
  sectionTitle: { fontSize: 11, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  legendCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 8 },
  legendTitle: { fontSize: 10, fontWeight: FONTS.extraBold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginTop: 3, flexShrink: 0 },
  legendText: { flex: 1, fontSize: 11, lineHeight: 16 },
});
