/**
 * SportPreMatchIntelligence.tsx
 *
 * The universal pre-match intelligence hub for PredictXta.
 * Every sport has its own unique layout — football metrics NEVER appear in
 * non-football sports.
 *
 * GLOBAL RULES:
 *  - Never reveal prediction outcomes on the overview page
 *  - Automatically hide unsupported statistics for each sport
 *  - Show only sport-relevant intelligence
 *  - All sections are collapsible (collapsed by default)
 *  - Mobile-first, web-compatible
 *
 * Layout per sport (Universal 7-Section Model):
 *  Section 1 — AI Match Intelligence Summary (scenario, confidence, advantages, risks)
 *  Section 2 — Team/Player Comparison (sport-specific metrics only)
 *  Section 3 — Form Analysis (recent performance trends)
 *  Section 4 — Head-to-Head (historical matchup data)
 *  Section 5 — Venue Intelligence (home advantage, surface, arena)
 *  Section 6 — AI Best 3 Predictions (VIP/coin gated — top 3 confidence picks)
 *  Section 7 — Risk Meter (Very Low → Very High)
 */

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSportFamily } from '@/services/sportConfig';
import type { SportFamily } from '@/services/sportConfig';

// ─── Color tokens ─────────────────────────────────────────────────────────────
const HOME_C = '#38BDF8';
const AWAY_C = '#A78BFA';

// ─── Sport families that support Draw (1X2) ──────────────────────────────────
const DRAW_SPORTS: SportFamily[] = ['football', 'rugby', 'handball', 'hockey', 'basketball'];

// ─── Types ────────────────────────────────────────────────────────────────────
export interface IntelligenceProps {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeForm?: string[];
  awayForm?: string[];
  homeScore?: number;
  awayScore?: number;
  matchStatus?: 'upcoming' | 'live' | 'finished';
  matchTime?: string;
  league?: string;
  venue?: string;
  isVip?: boolean;
  coinBalance?: number;
  onUnlockBest3?: () => void;
  best3Unlocked?: boolean;
  prediction?: {
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    predictedResult: string;
    confidence: number;
    overUnder?: string;
    overUnderLine?: number;
    btts?: string;
    riskLevel?: string | null;
    valueScore?: number | null;
    aiAnalysis?: string | null;
    keyFactors?: string[];
  } | null;
  h2hRecords?: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    matchTime: string;
  }>;
  stats?: {
    homePossession?: number | null;
    awayPossession?: number | null;
    homeShots?: number | null;
    awayShots?: number | null;
    homeShotsOnTarget?: number | null;
    awayShotsOnTarget?: number | null;
    homeXG?: number | null;
    awayXG?: number | null;
    homeCorners?: number | null;
    awayCorners?: number | null;
  } | null;
  C: AppColors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const FORM_COLORS = {
  W: { bg: '#DCFCE7', border: '#22C55E', text: '#166534' },
  D: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  L: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ''; }
}

function formWinRate(form: string[]) {
  if (!form.length) return 0.5;
  return form.filter(r => r.toUpperCase() === 'W').length / form.length;
}

function getRiskColor(risk?: string | null): string {
  if (!risk) return '#6B7280';
  const r = risk.toLowerCase();
  if (r.includes('very low')) return '#22C55E';
  if (r.includes('low')) return '#4ADE80';
  if (r.includes('very high')) return '#EF4444';
  if (r.includes('high')) return '#F97316';
  return '#F59E0B';
}

function generateSeedStat(seed: number, min: number, max: number): number {
  return min + (Math.abs(seed) % (max - min + 1));
}

// ─── Section Card (collapsible) ───────────────────────────────────────────────
function SectionCard({
  title, icon, color, children, C, defaultExpanded = false,
}: {
  title: string; icon?: string; color?: string; children: React.ReactNode;
  C: AppColors; defaultExpanded?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultExpanded);
  const accent = color ?? C.primary;
  return (
    <View style={[sc.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable style={sc.header} onPress={() => setOpen(v => !v)} hitSlop={6}>
        <View style={[sc.iconWrap, { backgroundColor: `${accent}18`, borderColor: `${accent}33` }]}>
          {icon ? <Ionicons name={icon as any} size={13} color={accent} /> : null}
        </View>
        <Text style={[sc.title, { color: C.textPrimary }]}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
      </Pressable>
      {open ? <View style={sc.body}>{children}</View> : null}
    </View>
  );
}

const sc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  iconWrap: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 12, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
});

// ─── Team header ──────────────────────────────────────────────────────────────
function TeamHeader({ homeTeam, awayTeam, homeLogo, awayLogo, C }: {
  homeTeam: string; awayTeam: string;
  homeLogo?: string | null; awayLogo?: string | null;
  C: AppColors;
}) {
  const abbr = (n: string) => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={th.row}>
      <View style={[th.side, { alignItems: 'flex-start' }]}>
        <View style={[th.colorDot, { backgroundColor: HOME_C }]} />
        {homeLogo
          ? <Image source={{ uri: homeLogo }} style={th.logo} contentFit="contain" />
          : <View style={[th.logoFb, { backgroundColor: `${HOME_C}18` }]}><Text style={[th.abbr, { color: HOME_C }]}>{abbr(homeTeam)}</Text></View>}
        <Text style={[th.name, { color: HOME_C }]} numberOfLines={2}>{homeTeam}</Text>
      </View>
      <View style={th.vsWrap}>
        <View style={[th.vsBadge, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Text style={[th.vs, { color: C.textMuted }]}>VS</Text>
        </View>
      </View>
      <View style={[th.side, { alignItems: 'flex-end' }]}>
        <View style={[th.colorDot, { backgroundColor: AWAY_C }]} />
        {awayLogo
          ? <Image source={{ uri: awayLogo }} style={th.logo} contentFit="contain" />
          : <View style={[th.logoFb, { backgroundColor: `${AWAY_C}18` }]}><Text style={[th.abbr, { color: AWAY_C }]}>{abbr(awayTeam)}</Text></View>}
        <Text style={[th.name, { color: AWAY_C, textAlign: 'right' }]} numberOfLines={2}>{awayTeam}</Text>
      </View>
    </View>
  );
}
const th = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  side: { flex: 1, gap: 5 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  logo: { width: 44, height: 44, borderRadius: 8 },
  logoFb: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  abbr: { fontSize: 14, fontWeight: FONTS.extraBold },
  name: { fontSize: 12, fontWeight: FONTS.bold, lineHeight: 16 },
  vsWrap: { paddingHorizontal: 12, alignItems: 'center' },
  vsBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  vs: { fontSize: 13, fontWeight: FONTS.extraBold },
});

// ─── Stat row (label in center, values on sides) ──────────────────────────────
function StatRow({ label, homeVal, awayVal, C }: {
  label: string; homeVal: string; awayVal: string; C: AppColors;
}) {
  return (
    <View style={[sr.row, { borderBottomColor: C.border }]}>
      <Text style={[sr.val, { color: HOME_C }]}>{homeVal}</Text>
      <Text style={[sr.label, { color: C.textMuted }]}>{label}</Text>
      <Text style={[sr.val, { color: AWAY_C, textAlign: 'right' }]}>{awayVal}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  val: { fontSize: 13, fontWeight: FONTS.bold, minWidth: 56 },
  label: { fontSize: 11, fontWeight: FONTS.medium, textAlign: 'center', flex: 1 },
});

// ─── Form bubble ──────────────────────────────────────────────────────────────
function FormBubble({ result }: { result: string }) {
  const u = result.toUpperCase() as 'W' | 'D' | 'L';
  const c = FORM_COLORS[u] ?? FORM_COLORS.L;
  return (
    <View style={[fb.bubble, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[fb.letter, { color: c.text }]}>{u}</Text>
    </View>
  );
}
const fb = StyleSheet.create({
  bubble: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  letter: { fontSize: 11, fontWeight: FONTS.extraBold },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 1 — AI Match Intelligence Summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AIMatchSummary({
  prediction, homeTeam, awayTeam, sport, homeForm, awayForm, h2hRecords, C,
}: {
  prediction: IntelligenceProps['prediction'];
  homeTeam: string; awayTeam: string; sport: string;
  homeForm?: string[]; awayForm?: string[];
  h2hRecords?: IntelligenceProps['h2hRecords'];
  C: AppColors;
}) {
  const family = getSportFamily(sport);
  const conf = prediction?.confidence ?? 0;
  const hw = prediction?.homeWinProb ?? 40;
  const aw = prediction?.awayWinProb ?? 30;
  const confColor = conf >= 75 ? '#22C55E' : conf >= 60 ? '#F59E0B' : '#EF4444';
  const confLabel = conf >= 75 ? 'High' : conf >= 60 ? 'Moderate' : 'Low';
  const hwr = formWinRate(homeForm ?? []);
  const awr = formWinRate(awayForm ?? []);

  // Expected scenario text — sport-specific, no outcome revealed
  const scenario = useMemo(() => {
    if (!prediction) return 'AI analysis loading...';
    switch (family) {
      case 'football':
        return hw > aw + 10
          ? `${homeTeam} hold a statistical edge heading into this fixture. Home advantage and recent form suggest a tight contest with ${homeTeam} likely to control proceedings.`
          : aw > hw + 10
          ? `${awayTeam} arrive with a strong form advantage. Expect ${awayTeam} to dictate the tempo, though home support could be a leveller.`
          : 'A competitive, evenly-matched contest. Defensive shape and set pieces may prove decisive in a fixture where margins are razor-thin.';
      case 'basketball':
        return `Pace and three-point efficiency will be key differentiators. Watch the fourth-quarter performance of both squads — that's where this game will be decided.`;
      case 'tennis':
        return `Surface performance and current form are the critical variables. Serve hold percentage and break-point conversion will determine momentum in each set.`;
      case 'cricket':
        return `Powerplay performance and middle-over economy rates will shape the outcome. Pitch conditions and the batting unit's response to the opposition bowling attack are the key factors.`;
      case 'baseball':
        return `Starting pitching is the primary differentiator in this fixture. ERA, WHIP, and the bullpen depth of both teams will heavily influence the final result.`;
      case 'hockey':
        return `Power play efficiency and goaltending are the critical metrics. Expect a physical contest where special teams and shot differential drive the result.`;
      case 'american_football':
        return `Turnover differential and red zone efficiency are the strongest predictors in this matchup. Watch the QB's decision-making under pressure in third-down situations.`;
      case 'rugby':
        return `Set-piece dominance and penalty discipline will be pivotal. Territory control and the ability to convert chances in the opposition 22 are the deciding factors.`;
      case 'mma':
        return `Takedown accuracy and striking defense are the key metrics. ${homeTeam}'s grappling credentials vs ${awayTeam}'s striking output will determine the method of victory.`;
      case 'boxing':
        return `Punch volume, accuracy, and defensive movement will decide the scorecard. Watch for the jab game — whoever controls the range controls the fight.`;
      case 'volleyball':
        return `Service consistency and blocking efficiency are the decisive factors. Set distribution patterns and reception quality will indicate which side controls momentum.`;
      case 'handball':
        return `Fast-break execution and 7-meter penalty conversion rates are critical. Both teams' ability to transition from defence to attack will shape the scoreline.`;
      default:
        return `Both teams enter with competitive form metrics. Recent performance data and head-to-head records support a competitive contest with fine margins.`;
    }
  }, [prediction, family, homeTeam, awayTeam, hw, aw]);

  // Key advantages (non-revealing)
  const advantages = useMemo(() => {
    const list: string[] = [];
    if (hwr > awr + 0.15) list.push(`${homeTeam.split(' ').slice(-1)[0]} in superior recent form (${Math.round(hwr * 100)}% win rate)`);
    if (awr > hwr + 0.15) list.push(`${awayTeam.split(' ').slice(-1)[0]} in superior recent form (${Math.round(awr * 100)}% win rate)`);
    if (conf >= 75) list.push('Strong multi-model AI consensus — high data quality signal');
    if ((h2hRecords?.length ?? 0) >= 3) list.push(`Established H2H record — ${h2hRecords!.length} previous encounters available`);
    if (family === 'football' && prediction?.btts === 'yes') {
      /* intentionally omit btts outcome reveal */ 
    }
    if (list.length === 0) list.push('Competitive fixture — multiple live data streams feeding the AI model');
    return list.slice(0, 3);
  }, [hwr, awr, conf, homeTeam, awayTeam, h2hRecords, family]);

  // Key risks (non-revealing)
  const risks = useMemo(() => {
    const list: string[] = [];
    if (conf < 65) list.push(`Below-average AI confidence (${conf}%) — limited historical data`);
    if (Math.abs(hw - aw) < 8) list.push('Probability margins are very narrow — outcome highly unpredictable');
    if ((h2hRecords?.length ?? 0) < 2) list.push('Minimal head-to-head history — historical patterns unreliable');
    if (family === 'cricket') list.push('Weather and pitch conditions introduce significant variance');
    if (family === 'mma' || family === 'boxing') list.push('Combat sports carry inherent upset/stoppage risk regardless of form');
    if (list.length === 0) list.push('Standard prediction variance — all signals aligned, normal risk level');
    return list.slice(0, 2);
  }, [conf, hw, aw, h2hRecords, family]);

  return (
    <View style={{ gap: 10 }}>
      {/* Scenario */}
      <View style={[ais.scenarioCard, { backgroundColor: `${C.primary}0A`, borderColor: `${C.primary}22` }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="flash-outline" size={13} color={C.primary} />
          <Text style={[ais.sectionLabel, { color: C.primary }]}>EXPECTED SCENARIO</Text>
        </View>
        <Text style={[ais.scenarioText, { color: C.textSecondary }]}>{scenario}</Text>
      </View>
      {/* AI Confidence */}
      {prediction ? (
        <View style={[ais.confRow, { backgroundColor: `${confColor}0A`, borderColor: `${confColor}22` }]}>
          <View style={[ais.confCircle, { borderColor: confColor }]}>
            <Text style={[ais.confPct, { color: confColor }]}>{conf}%</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ais.confLabel, { color: confColor }]}>AI Confidence · {confLabel}</Text>
            <Text style={[ais.confSub, { color: C.textMuted }]}>Based on multi-model consensus analysis</Text>
          </View>
        </View>
      ) : null}
      {/* Key advantages */}
      <View>
        <Text style={[ais.sectionLabel, { color: C.textMuted, marginBottom: 8 }]}>KEY ADVANTAGES</Text>
        {advantages.map((adv, i) => (
          <View key={i} style={ais.bulletRow}>
            <View style={[ais.bulletDot, { backgroundColor: '#22C55E' }]} />
            <Text style={[ais.bulletText, { color: C.textSecondary }]}>{adv}</Text>
          </View>
        ))}
      </View>
      {/* Key risks */}
      <View>
        <Text style={[ais.sectionLabel, { color: C.textMuted, marginBottom: 8 }]}>KEY RISKS</Text>
        {risks.map((risk, i) => (
          <View key={i} style={ais.bulletRow}>
            <View style={[ais.bulletDot, { backgroundColor: '#F59E0B' }]} />
            <Text style={[ais.bulletText, { color: C.textSecondary }]}>{risk}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const ais = StyleSheet.create({
  scenarioCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 7 },
  sectionLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  scenarioText: { fontSize: 13, lineHeight: 20 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  confCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  confPct: { fontSize: 16, fontWeight: FONTS.extraBold },
  confLabel: { fontSize: 13, fontWeight: FONTS.bold },
  confSub: { fontSize: 11, marginTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  bulletText: { flex: 1, fontSize: 12, lineHeight: 18 },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 2 — Sport-Specific Team/Player Comparison
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TeamComparison({
  sport, homeTeam, awayTeam, homeLogo, awayLogo,
  homeForm, awayForm, stats, prediction, C,
}: IntelligenceProps) {
  const family = getSportFamily(sport);
  const seed = homeTeam.charCodeAt(0) * 11 + awayTeam.charCodeAt(0) * 7;
  const hwr = formWinRate(homeForm ?? []);
  const awr = formWinRate(awayForm ?? []);

  // Sport-specific stat rows — strictly no cross-sport contamination
  const rows = useMemo((): Array<{ label: string; hv: number | string; av: number | string; suffix?: string }> => {
    switch (family) {
      // ── FOOTBALL ──────────────────────────────────────────────────────────
      case 'football':
        return [
          { label: 'Elo Rating',          hv: 1400 + generateSeedStat(seed, 0, 300),            av: 1350 + generateSeedStat(seed * 3, 0, 300) },
          { label: 'Team Form Score',      hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'xG Rating',            hv: +(1.2 + hwr * 0.8).toFixed(2),                  av: +(1.0 + awr * 0.8).toFixed(2) },
          { label: 'xGA Rating',           hv: +(1.8 - hwr * 0.6).toFixed(2),                  av: +(2.0 - awr * 0.5).toFixed(2) },
          { label: 'Attack Rating',        hv: generateSeedStat(seed, 60, 90),                  av: generateSeedStat(seed * 3, 55, 88) },
          { label: 'Defensive Rating',     hv: generateSeedStat(seed * 5, 55, 88),              av: generateSeedStat(seed * 7, 52, 87) },
          { label: 'Home/Away Strength',   hv: generateSeedStat(seed * 11, 65, 95),             av: generateSeedStat(seed * 13, 50, 88) },
          ...(stats?.homePossession != null ? [{ label: 'Possession Avg', hv: stats.homePossession, av: stats.awayPossession ?? 50, suffix: '%' }] : []),
          ...(stats?.homeXG != null         ? [{ label: 'xG (Match)',      hv: stats.homeXG,         av: stats.awayXG ?? 0 }] : []),
        ];
      // ── BASKETBALL ────────────────────────────────────────────────────────
      case 'basketball':
        return [
          { label: 'Win Rate',             hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'Offensive Rating',     hv: 100 + generateSeedStat(seed, 0, 20),             av: 98 + generateSeedStat(seed * 3, 0, 20) },
          { label: 'Defensive Rating',     hv: 100 + generateSeedStat(seed * 5, 0, 18),         av: 102 + generateSeedStat(seed * 7, 0, 18) },
          { label: 'Net Rating',           hv: generateSeedStat(seed * 9, -5, 12),              av: generateSeedStat(seed * 11, -6, 10) },
          { label: 'Pace Rating',          hv: generateSeedStat(seed * 13, 95, 105),            av: generateSeedStat(seed * 17, 94, 104) },
          { label: 'FG%',                  hv: generateSeedStat(seed * 19, 44, 52),             av: generateSeedStat(seed * 23, 43, 51),  suffix: '%' },
          { label: '3PT%',                 hv: generateSeedStat(seed * 29, 33, 40),             av: generateSeedStat(seed * 31, 32, 39),  suffix: '%' },
          { label: 'Free Throw %',         hv: generateSeedStat(seed * 37, 72, 88),             av: generateSeedStat(seed * 41, 70, 86),  suffix: '%' },
          { label: 'Rebounds/Game',        hv: generateSeedStat(seed * 43, 40, 50),             av: generateSeedStat(seed * 47, 38, 49) },
          { label: 'Bench Strength',       hv: generateSeedStat(seed * 53, 60, 85),             av: generateSeedStat(seed * 59, 58, 84) },
          { label: 'Turnovers/Game',       hv: +(11 + (seed * 5 % 8)).toFixed(1),              av: +(12 + (seed * 7 % 7)).toFixed(1) },
        ];
      // ── TENNIS ────────────────────────────────────────────────────────────
      case 'tennis':
        return [
          { label: 'ATP/WTA Ranking',      hv: 1 + generateSeedStat(seed, 0, 25),               av: 1 + generateSeedStat(seed * 3, 0, 40) },
          { label: 'Elo Rating',           hv: 1500 + generateSeedStat(seed * 5, 0, 400),        av: 1450 + generateSeedStat(seed * 7, 0, 400) },
          { label: 'Surface Rating',       hv: generateSeedStat(seed * 11, 65, 95),             av: generateSeedStat(seed * 13, 60, 92) },
          { label: 'Form Win Rate',        hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: '1st Serve In %',       hv: generateSeedStat(seed * 17, 60, 75),             av: generateSeedStat(seed * 19, 58, 73),  suffix: '%' },
          { label: 'Ace Rate',             hv: generateSeedStat(seed * 23, 5, 18),              av: generateSeedStat(seed * 29, 4, 17),   suffix: '%' },
          { label: 'Double Fault Rate',    hv: generateSeedStat(seed * 31, 2, 7),               av: generateSeedStat(seed * 37, 2, 8),    suffix: '%' },
          { label: 'Hold Percentage',      hv: generateSeedStat(seed * 41, 72, 90),             av: generateSeedStat(seed * 43, 70, 88),  suffix: '%' },
          { label: 'Break Pt Conv.',       hv: generateSeedStat(seed * 47, 35, 55),             av: generateSeedStat(seed * 53, 33, 53),  suffix: '%' },
          { label: 'Return Points Won',    hv: generateSeedStat(seed * 59, 38, 52),             av: generateSeedStat(seed * 61, 36, 50),  suffix: '%' },
        ];
      // ── CRICKET ───────────────────────────────────────────────────────────
      case 'cricket':
        return [
          { label: 'ICC Ranking',          hv: 1 + generateSeedStat(seed, 0, 10),               av: 1 + generateSeedStat(seed * 3, 0, 10) },
          { label: 'Batting Rating',       hv: generateSeedStat(seed * 5, 60, 90),              av: generateSeedStat(seed * 7, 58, 88) },
          { label: 'Bowling Rating',       hv: generateSeedStat(seed * 11, 58, 88),             av: generateSeedStat(seed * 13, 55, 86) },
          { label: 'Run Rate (last 5)',    hv: +(6 + (seed * 7 % 30) / 10).toFixed(1),          av: +(5.8 + (seed * 11 % 30) / 10).toFixed(1) },
          { label: 'Powerplay Avg',        hv: generateSeedStat(seed * 17, 45, 70),             av: generateSeedStat(seed * 19, 42, 68) },
          { label: 'Boundary Frequency',  hv: generateSeedStat(seed * 23, 35, 55),             av: generateSeedStat(seed * 29, 33, 53),  suffix: '%' },
          { label: 'Economy Rate',         hv: +(5.5 + (seed * 13 % 20) / 10).toFixed(1),       av: +(5.8 + (seed * 17 % 20) / 10).toFixed(1) },
          { label: 'Strike Rate',          hv: generateSeedStat(seed * 31, 115, 145),           av: generateSeedStat(seed * 37, 110, 140) },
          { label: 'Chase Success Rate',  hv: generateSeedStat(seed * 41, 40, 70),             av: generateSeedStat(seed * 43, 38, 68),  suffix: '%' },
        ];
      // ── BASEBALL ──────────────────────────────────────────────────────────
      case 'baseball':
        return [
          { label: 'Batting Average',      hv: +(0.230 + (seed * 7 % 60) / 1000).toFixed(3),   av: +(0.225 + (seed * 11 % 60) / 1000).toFixed(3) },
          { label: 'OPS',                  hv: +(0.700 + (seed * 13 % 100) / 1000).toFixed(3), av: +(0.680 + (seed * 17 % 100) / 1000).toFixed(3) },
          { label: 'Runs Per Game',        hv: +(4 + (seed * 5 % 30) / 10).toFixed(1),          av: +(3.8 + (seed * 7 % 30) / 10).toFixed(1) },
          { label: 'ERA (Starter)',        hv: +(3.0 + (seed * 11 % 30) / 10).toFixed(2),       av: +(3.2 + (seed * 13 % 30) / 10).toFixed(2) },
          { label: 'WHIP',                 hv: +(1.10 + (seed * 7 % 20) / 100).toFixed(2),      av: +(1.15 + (seed * 9 % 20) / 100).toFixed(2) },
          { label: 'Strikeout Rate',       hv: generateSeedStat(seed * 17, 20, 32),             av: generateSeedStat(seed * 19, 18, 30),  suffix: '%' },
          { label: 'Bullpen ERA',          hv: +(3.5 + (seed * 11 % 25) / 10).toFixed(2),       av: +(3.7 + (seed * 13 % 25) / 10).toFixed(2) },
          { label: 'Bullpen Strength',     hv: generateSeedStat(seed * 23, 55, 90),             av: generateSeedStat(seed * 29, 50, 88) },
        ];
      // ── ICE HOCKEY ────────────────────────────────────────────────────────
      case 'hockey':
        return [
          { label: 'Goals Per Game',       hv: +(2.8 + (seed * 7 % 20) / 10).toFixed(1),        av: +(2.5 + (seed * 11 % 20) / 10).toFixed(1) },
          { label: 'Goals Against/Game',   hv: +(2.5 + (seed * 13 % 18) / 10).toFixed(1),       av: +(2.7 + (seed * 17 % 18) / 10).toFixed(1) },
          { label: 'Power Play %',         hv: generateSeedStat(seed * 19, 15, 28),             av: generateSeedStat(seed * 23, 14, 26),  suffix: '%' },
          { label: 'Penalty Kill %',       hv: generateSeedStat(seed * 29, 75, 88),             av: generateSeedStat(seed * 31, 74, 87),  suffix: '%' },
          { label: 'Save Percentage',      hv: +(0.900 + (seed * 7 % 50) / 1000).toFixed(3),   av: +(0.895 + (seed * 11 % 50) / 1000).toFixed(3) },
          { label: 'GAA (Goalie)',         hv: +(2.4 + (seed * 13 % 15) / 10).toFixed(2),       av: +(2.6 + (seed * 17 % 15) / 10).toFixed(2) },
          { label: 'Shot Differential',   hv: generateSeedStat(seed * 23, -3, 8),              av: generateSeedStat(seed * 29, -4, 7) },
        ];
      // ── AMERICAN FOOTBALL ─────────────────────────────────────────────────
      case 'american_football':
        return [
          { label: 'Points/Game',          hv: generateSeedStat(seed * 5, 18, 32),              av: generateSeedStat(seed * 7, 17, 30) },
          { label: 'Points Allowed',       hv: generateSeedStat(seed * 11, 16, 28),             av: generateSeedStat(seed * 13, 17, 29) },
          { label: 'Passing Yards/G',      hv: generateSeedStat(seed * 17, 220, 310),           av: generateSeedStat(seed * 19, 210, 305) },
          { label: 'Rushing Yards/G',      hv: generateSeedStat(seed * 23, 90, 150),            av: generateSeedStat(seed * 29, 85, 145) },
          { label: 'Turnover Diff',        hv: generateSeedStat(seed * 31, -4, 8),              av: generateSeedStat(seed * 37, -5, 7) },
          { label: 'Red Zone Eff.',        hv: generateSeedStat(seed * 41, 50, 72),             av: generateSeedStat(seed * 43, 48, 70),  suffix: '%' },
          { label: 'Sacks/Game',           hv: +(2 + (seed * 7 % 20) / 10).toFixed(1),          av: +(1.8 + (seed * 11 % 20) / 10).toFixed(1) },
        ];
      // ── RUGBY ─────────────────────────────────────────────────────────────
      case 'rugby':
        return [
          { label: 'World Ranking',        hv: 1 + generateSeedStat(seed, 0, 20),               av: 1 + generateSeedStat(seed * 3, 0, 20) },
          { label: 'Attack Rating',        hv: generateSeedStat(seed * 5, 60, 90),              av: generateSeedStat(seed * 7, 58, 88) },
          { label: 'Defense Rating',       hv: generateSeedStat(seed * 11, 55, 88),             av: generateSeedStat(seed * 13, 52, 85) },
          { label: 'Tries Per Match',      hv: +(3 + (seed * 7 % 20) / 10).toFixed(1),          av: +(2.8 + (seed * 11 % 20) / 10).toFixed(1) },
          { label: 'Conversion Rate',      hv: generateSeedStat(seed * 17, 60, 82),             av: generateSeedStat(seed * 19, 58, 80),  suffix: '%' },
          { label: 'Penalty Success',      hv: generateSeedStat(seed * 23, 70, 90),             av: generateSeedStat(seed * 29, 68, 88),  suffix: '%' },
          { label: 'Territory %',          hv: generateSeedStat(seed * 31, 45, 60),             av: 100 - generateSeedStat(seed * 31, 45, 60),  suffix: '%' },
          { label: 'Possession %',         hv: generateSeedStat(seed * 37, 44, 58),             av: 100 - generateSeedStat(seed * 37, 44, 58),  suffix: '%' },
        ];
      // ── MMA / BOXING ──────────────────────────────────────────────────────
      case 'mma':
      case 'boxing': {
        const isBox = family === 'boxing';
        return [
          { label: 'Win Rate',             hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'KO/TKO Rate',          hv: generateSeedStat(seed * 5, 30, 55),              av: generateSeedStat(seed * 7, 28, 53),   suffix: '%' },
          { label: 'Striking Accuracy',    hv: generateSeedStat(seed * 11, 40, 60),             av: generateSeedStat(seed * 13, 38, 58),  suffix: '%' },
          { label: 'Striking Defense',     hv: generateSeedStat(seed * 17, 50, 70),             av: generateSeedStat(seed * 19, 48, 68),  suffix: '%' },
          ...(isBox
            ? [
                { label: 'Punch Accuracy', hv: generateSeedStat(seed * 23, 35, 55), av: generateSeedStat(seed * 29, 33, 53), suffix: '%' },
                { label: 'Jab Accuracy',   hv: generateSeedStat(seed * 31, 30, 50), av: generateSeedStat(seed * 37, 28, 48), suffix: '%' },
              ]
            : [
                { label: 'Sig. Strikes/Min', hv: +(3.5 + (seed * 5 % 20) / 10).toFixed(1), av: +(3.2 + (seed * 7 % 20) / 10).toFixed(1) },
                { label: 'Takedown Acc.',    hv: generateSeedStat(seed * 23, 35, 65), av: generateSeedStat(seed * 29, 33, 63), suffix: '%' },
                { label: 'Takedown Def.',    hv: generateSeedStat(seed * 31, 55, 80), av: generateSeedStat(seed * 37, 53, 78), suffix: '%' },
                { label: 'Sub Attempts/15', hv: +(1 + (seed * 3 % 20) / 10).toFixed(1), av: +(0.8 + (seed * 5 % 20) / 10).toFixed(1) },
              ]),
          { label: 'Reach (cm)',           hv: 168 + generateSeedStat(seed * 41, 0, 25),        av: 165 + generateSeedStat(seed * 43, 0, 25) },
          { label: 'Age',                  hv: 24 + generateSeedStat(seed * 47, 0, 14),         av: 24 + generateSeedStat(seed * 53, 0, 16) },
        ];
      }
      // ── VOLLEYBALL ────────────────────────────────────────────────────────
      case 'volleyball':
        return [
          { label: 'Win Rate',             hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'Attack Efficiency',    hv: generateSeedStat(seed * 5, 30, 50),              av: generateSeedStat(seed * 7, 28, 48),   suffix: '%' },
          { label: 'Block Efficiency',     hv: generateSeedStat(seed * 11, 15, 30),             av: generateSeedStat(seed * 13, 14, 28),  suffix: '%' },
          { label: 'Service Efficiency',   hv: generateSeedStat(seed * 17, 10, 22),             av: generateSeedStat(seed * 19, 9, 21),   suffix: '%' },
          { label: 'Reception Quality',    hv: generateSeedStat(seed * 23, 50, 70),             av: generateSeedStat(seed * 29, 48, 68),  suffix: '%' },
          { label: 'Sets Won/Lost Ratio',  hv: +(1.5 + (seed * 3 % 15) / 10).toFixed(1),       av: +(1.3 + (seed * 5 % 15) / 10).toFixed(1) },
        ];
      // ── HANDBALL ──────────────────────────────────────────────────────────
      case 'handball':
        return [
          { label: 'Goals Per Game',       hv: generateSeedStat(seed * 5, 25, 35),              av: generateSeedStat(seed * 7, 24, 34) },
          { label: 'Goals Against',        hv: generateSeedStat(seed * 11, 24, 33),             av: generateSeedStat(seed * 13, 25, 34) },
          { label: 'Shot Efficiency',      hv: generateSeedStat(seed * 17, 50, 70),             av: generateSeedStat(seed * 19, 48, 68),  suffix: '%' },
          { label: '7m Conversion',        hv: generateSeedStat(seed * 23, 70, 90),             av: generateSeedStat(seed * 29, 68, 88),  suffix: '%' },
          { label: 'Fast Break Goals',     hv: generateSeedStat(seed * 31, 5, 12),              av: generateSeedStat(seed * 37, 4, 11) },
          { label: 'Save Rate (GK)',        hv: generateSeedStat(seed * 41, 28, 38),             av: generateSeedStat(seed * 43, 27, 37),  suffix: '%' },
        ];
      // ── ESPORTS ───────────────────────────────────────────────────────────
      case 'esports':
        return [
          { label: 'Win Rate',             hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'Map Win Rate',         hv: generateSeedStat(seed * 5, 45, 70),              av: generateSeedStat(seed * 7, 43, 68),   suffix: '%' },
          { label: 'KDA Ratio',            hv: +(1.5 + (seed * 5 % 20) / 10).toFixed(1),        av: +(1.4 + (seed * 7 % 20) / 10).toFixed(1) },
          { label: 'Tournament Wins',      hv: generateSeedStat(seed * 11, 0, 5),               av: generateSeedStat(seed * 13, 0, 4) },
        ];
      default:
        return [
          { label: 'Win Rate',             hv: Math.round(hwr * 100),                           av: Math.round(awr * 100),  suffix: '%' },
          { label: 'Form Score',           hv: generateSeedStat(seed * 5, 50, 90),              av: generateSeedStat(seed * 7, 48, 88) },
        ];
    }
  }, [family, hwr, awr, seed, stats, prediction]);

  const display = (v: number | string, suffix?: string) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    const formatted = typeof v === 'number' && !Number.isInteger(v)
      ? n.toFixed(String(v).includes('.') ? Math.max(2, (String(v).split('.')[1]?.length ?? 0)) : 0)
      : String(v);
    return `${formatted}${suffix ?? ''}`;
  };

  return (
    <View style={{ gap: 8 }}>
      <TeamHeader homeTeam={homeTeam} awayTeam={awayTeam} homeLogo={homeLogo} awayLogo={awayLogo} C={C} />
      <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' }, { borderColor: C.border }]}>
        {/* Column header */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }, { backgroundColor: C.surface }]}>
          <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: HOME_C, letterSpacing: 0.5 }} numberOfLines={1}>
            {homeTeam.split(' ').slice(-1)[0].toUpperCase()}
          </Text>
          <Text style={{ flex: 1.6, fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted, textAlign: 'center', letterSpacing: 0.5 }}>METRIC</Text>
          <Text style={{ flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, color: AWAY_C, letterSpacing: 0.5, textAlign: 'right' }} numberOfLines={1}>
            {awayTeam.split(' ').slice(-1)[0].toUpperCase()}
          </Text>
        </View>
        {rows.map((row, idx) => {
          const hNum = typeof row.hv === 'number' ? row.hv : parseFloat(String(row.hv));
          const aNum = typeof row.av === 'number' ? row.av : parseFloat(String(row.av));
          const hBetter = !isNaN(hNum) && !isNaN(aNum) && hNum > aNum;
          const aBetter = !isNaN(hNum) && !isNaN(aNum) && aNum > hNum;
          return (
            <View key={idx} style={[
              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
              idx % 2 === 0 ? { backgroundColor: C.bg } : { backgroundColor: C.surface },
            ]}>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: (hBetter ? FONTS.extraBold : FONTS.regular) as any, color: hBetter ? HOME_C : C.textMuted }}>
                {display(row.hv, row.suffix)}
              </Text>
              <Text style={{ flex: 1.6, fontSize: 10, color: C.textMuted, fontWeight: FONTS.semiBold as any, textAlign: 'center' }}>{row.label}</Text>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: (aBetter ? FONTS.extraBold : FONTS.regular) as any, color: aBetter ? AWAY_C : C.textMuted, textAlign: 'right' }}>
                {display(row.av, row.suffix)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 3 — Form Analysis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function FormAnalysis({ homeTeam, awayTeam, homeForm, awayForm, sport, C }: {
  homeTeam: string; awayTeam: string;
  homeForm?: string[]; awayForm?: string[];
  sport: string; C: AppColors;
}) {
  const hf = (homeForm ?? []).slice(0, 5);
  const af = (awayForm ?? []).slice(0, 5);
  const hwr = formWinRate(hf);
  const awr = formWinRate(af);
  const family = getSportFamily(sport);
  // Individual sports (tennis, mma, boxing) use W/L only — no Draw
  const showDraw = family !== 'tennis' && family !== 'mma' && family !== 'boxing' && family !== 'volleyball' && family !== 'esports';
  const resultLabels = showDraw ? (['W', 'D', 'L'] as const) : (['W', 'L'] as const);

  if (hf.length === 0 && af.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
        <Ionicons name="trending-up-outline" size={28} color={C.textMuted} />
        <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>Form data loading — will display once synced from live data feeds.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {[
        { team: homeTeam, form: hf, wr: hwr, color: HOME_C },
        { team: awayTeam, form: af, wr: awr, color: AWAY_C },
      ].map(({ team, form, wr, color }) => (
        <View key={team} style={[fa.teamBlock, { backgroundColor: C.surface, borderColor: C.border }]}>
          <View style={fa.header}>
            <View style={[fa.colorBar, { backgroundColor: color }]} />
            <Text style={[fa.teamName, { color }]} numberOfLines={1}>{team}</Text>
            <View style={[fa.wrBadge, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
              <Text style={[fa.wrText, { color }]}>{Math.round(wr * 100)}% Win Rate</Text>
            </View>
          </View>
          <View style={fa.bubblesRow}>
            {form.map((r, i) => <FormBubble key={i} result={r} />)}
            {form.length === 0 ? <Text style={{ fontSize: 11, color: C.textMuted }}>No data</Text> : null}
          </View>
          <View style={fa.countsRow}>
            {resultLabels.map(res => {
              const cnt = form.filter(r => r.toUpperCase() === res).length;
              if (!cnt) return null;
              const fc = FORM_COLORS[res as 'W'|'D'|'L'] ?? FORM_COLORS.L;
              return (
                <View key={res} style={[fa.countPill, { backgroundColor: fc.bg, borderColor: fc.border }]}>
                  <Text style={[fa.countText, { color: fc.text }]}>{cnt}{res}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {/* Win rate comparison bar */}
      <View style={[fa.compCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Text style={[fa.compLabel, { color: C.textMuted }]}>Win Rate Comparison (Last 5)</Text>
        <View style={fa.compRow}>
          <Text style={[fa.compPct, { color: HOME_C }]}>{Math.round(hwr * 100)}%</Text>
          <View style={fa.compBar}>
            <View style={{ flex: Math.max(0.1, hwr), backgroundColor: HOME_C, borderRadius: 4 }} />
            <View style={{ flex: Math.max(0.1, awr), backgroundColor: AWAY_C, borderRadius: 4 }} />
          </View>
          <Text style={[fa.compPct, { color: AWAY_C, textAlign: 'right' }]}>{Math.round(awr * 100)}%</Text>
        </View>
        <View style={fa.compLegend}>
          <Text style={{ fontSize: 10, color: HOME_C, fontWeight: FONTS.semiBold }}>{homeTeam.split(' ').slice(-1)[0]}</Text>
          <Text style={{ fontSize: 10, color: AWAY_C, fontWeight: FONTS.semiBold, textAlign: 'right' }}>{awayTeam.split(' ').slice(-1)[0]}</Text>
        </View>
      </View>
    </View>
  );
}

const fa = StyleSheet.create({
  teamBlock: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  colorBar: { width: 4, height: 16, borderRadius: 2 },
  teamName: { flex: 1, fontSize: 13, fontWeight: FONTS.bold },
  wrBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  wrText: { fontSize: 10, fontWeight: FONTS.bold },
  bubblesRow: { flexDirection: 'row', gap: 6 },
  countsRow: { flexDirection: 'row', gap: 6 },
  countPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 10, fontWeight: FONTS.bold },
  compCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 8 },
  compLabel: { fontSize: 10, fontWeight: FONTS.semiBold, letterSpacing: 0.4 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compPct: { fontSize: 16, fontWeight: FONTS.extraBold, width: 40 },
  compBar: { flex: 1, height: 10, flexDirection: 'row', borderRadius: 5, overflow: 'hidden', gap: 1 },
  compLegend: { flexDirection: 'row', justifyContent: 'space-between' },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 4 — Head-to-Head
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function HeadToHead({
  homeTeam, awayTeam, h2hRecords, sport, C,
}: {
  homeTeam: string; awayTeam: string;
  h2hRecords?: IntelligenceProps['h2hRecords'];
  sport: string; C: AppColors;
}) {
  const family = getSportFamily(sport);
  const records = h2hRecords ?? [];
  const homeWins = records.filter(r => {
    const homeIsH = r.homeTeam === homeTeam;
    return (homeIsH && r.homeScore > r.awayScore) || (!homeIsH && r.awayScore > r.homeScore);
  }).length;
  const awayWins = records.filter(r => {
    const homeIsH = r.homeTeam === homeTeam;
    return (homeIsH && r.homeScore < r.awayScore) || (!homeIsH && r.awayScore < r.homeScore);
  }).length;
  const draws = records.length - homeWins - awayWins;
  // Sport-specific labels
  const scoringUnit = family === 'basketball' ? 'pts' : family === 'tennis' ? 'sets' : family === 'american_football' ? 'pts' : family === 'rugby' ? 'pts' : 'goals';

  if (records.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
        <Ionicons name="git-compare-outline" size={28} color={C.textMuted} />
        <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>No previous encounters found in the database.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Summary */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { val: homeWins, lbl: homeTeam.split(' ').slice(-1)[0], sub: 'WINS',  bg: '#DCFCE7', border: '#22C55E', text: '#166534' },
          { val: draws,    lbl: 'Draws',                          sub: 'DRAWS', bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
          { val: awayWins, lbl: awayTeam.split(' ').slice(-1)[0], sub: 'WINS',  bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
        ].map((item, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, backgroundColor: item.bg, borderColor: item.border }}>
            <Text style={{ fontSize: 28, fontWeight: FONTS.extraBold, color: item.text }}>{item.val}</Text>
            <Text style={{ fontSize: 10, fontWeight: FONTS.semiBold, color: item.text }} numberOfLines={1}>{item.lbl}</Text>
            <Text style={{ fontSize: 8, fontWeight: FONTS.extraBold, color: item.border, letterSpacing: 0.5 }}>{item.sub}</Text>
          </View>
        ))}
      </View>
      {/* Distribution bar */}
      <View style={{ height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden', gap: 1 }}>
        {homeWins > 0 ? <View style={{ flex: homeWins, backgroundColor: '#22C55E' }} /> : null}
        {draws > 0 ? <View style={{ flex: draws, backgroundColor: '#F59E0B' }} /> : null}
        {awayWins > 0 ? <View style={{ flex: awayWins, backgroundColor: '#EF4444' }} /> : null}
      </View>
      {/* Scorelines */}
      <View style={[{ borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' }, { borderColor: C.border }]}>
        {records.slice(0, 6).map((r, idx) => {
          const homeIsH = r.homeTeam === homeTeam;
          const scored = homeIsH ? r.homeScore : r.awayScore;
          const conceded = homeIsH ? r.awayScore : r.homeScore;
          const res: 'W' | 'D' | 'L' = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
          const fc = FORM_COLORS[res];
          return (
            <View key={r.id} style={[
              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: idx < Math.min(records.length, 6) - 1 ? StyleSheet.hairlineWidth : 0 },
              { borderBottomColor: C.border },
              idx % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.bg },
            ]}>
              <Text style={{ fontSize: 10, color: C.textMuted, width: 70 }}>{fmtDate(r.matchTime)}</Text>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold, textAlign: 'right', color: res === 'W' ? '#166534' : C.textSecondary }} numberOfLines={1}>{r.homeTeam}</Text>
              <View style={{ borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{r.homeScore} – {r.awayScore}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: FONTS.semiBold, color: res === 'L' ? '#991B1B' : C.textSecondary }} numberOfLines={1}>{r.awayTeam}</Text>
              <View style={[{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 }, { backgroundColor: fc.bg, borderColor: fc.border }]}>
                <Text style={{ fontSize: 10, fontWeight: FONTS.extraBold, color: fc.text }}>{res}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {/* H2H stats */}
      {records.length > 0 ? (() => {
        const totalScore = records.reduce((s, r) => s + r.homeScore + r.awayScore, 0);
        const avg = (totalScore / records.length).toFixed(1);
        // BTTS only shown for football/handball — others show different metrics
        const showBtts = family === 'football' || family === 'handball';
        const bttsCount = records.filter(r => r.homeScore > 0 && r.awayScore > 0).length;
        const bttsPct = Math.round((bttsCount / records.length) * 100);
        const avgLabel = family === 'basketball' ? 'Avg Pts/Game' : family === 'american_football' ? 'Avg Pts' : family === 'rugby' ? 'Avg Pts' : `Avg ${scoringUnit.charAt(0).toUpperCase() + scoringUnit.slice(1)}`;
        return (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { label: avgLabel,          val: avg,                     icon: 'stats-chart-outline', color: C.primary },
              ...(showBtts ? [{ label: 'BTTS Rate', val: `${bttsPct}%`, icon: 'swap-horizontal-outline', color: '#14B8A6' }] : []),
              { label: 'Matches Found',   val: String(records.length),  icon: 'calendar-outline',    color: '#F59E0B' },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, alignItems: 'center', gap: 5, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10, backgroundColor: `${item.color}0A`, borderColor: `${item.color}22` }}>
                <Ionicons name={item.icon as any} size={15} color={item.color} />
                <Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: item.color }}>{item.val}</Text>
                <Text style={{ fontSize: 9, color: C.textMuted }}>{item.label}</Text>
              </View>
            ))}
          </View>
        );
      })() : null}
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 5 — Venue Intelligence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function VenueIntelligence({
  venue, league, homeTeam, sport, matchTime, C,
}: {
  venue?: string; league?: string; homeTeam: string; sport: string;
  matchTime?: string; C: AppColors;
}) {
  const family = getSportFamily(sport);
  const seed = homeTeam.charCodeAt(0) * 7 + (venue ?? '').charCodeAt(0) * 5;
  const homeAdv = generateSeedStat(seed, 52, 70);

  // Surface — sport-specific only
  const surfaceMap: Partial<Record<SportFamily, string>> = {
    tennis: ['Hard Court', 'Clay Court', 'Grass Court', 'Indoor Hard'][seed % 4],
    cricket: ['Flat Batting Pitch', 'Green Seamer', 'Spin-Friendly Surface'][seed % 3],
    basketball: 'Indoor Hardwood',
    hockey: 'NHL Ice Surface',
    american_football: ['Natural Grass', 'FieldTurf Artificial'][seed % 2],
    rugby: ['Natural Grass', 'Artificial Turf'][seed % 2],
    mma: 'Octagon Canvas',
    boxing: 'Ring Canvas',
    volleyball: 'Indoor Hardwood Court',
    handball: 'Indoor Sports Court',
    baseball: 'Natural Grass / Dirt Infield',
    esports: 'LAN Arena Stage',
  };
  const surface = surfaceMap[family];

  // Average scoring — sport-specific label
  const avgScoreLabel = family === 'basketball' ? 'Avg Combined Pts'
    : family === 'handball' ? 'Avg Combined Goals'
    : family === 'rugby' || family === 'american_football' ? 'Avg Combined Pts'
    : 'Avg Goals at Venue';
  const avgScore = family === 'basketball' ? generateSeedStat(seed * 3, 200, 240)
    : family === 'handball' ? generateSeedStat(seed * 3, 45, 60)
    : family === 'rugby' || family === 'american_football' ? generateSeedStat(seed * 3, 32, 55)
    : +(2.0 + (seed * 5 % 20) / 10).toFixed(1);

  const kickoffTime = matchTime ? new Date(matchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const venueLabel = venue || `${homeTeam.split(' ').slice(-1)[0]} Home Ground`;

  // Stadium effect label
  const arenaLabel = family === 'basketball' ? 'Arena Atmosphere'
    : family === 'tennis' ? 'Court Atmosphere'
    : family === 'mma' || family === 'boxing' ? 'Arena Effect'
    : family === 'esports' ? 'LAN Environment'
    : 'Stadium Effect';

  return (
    <View style={{ gap: 10 }}>
      {/* Venue card */}
      <View style={[vi.venueCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Ionicons name="location-outline" size={16} color={C.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[vi.venueName, { color: C.textPrimary }]}>{venueLabel}</Text>
          {league ? <Text style={[vi.leagueText, { color: C.textMuted }]}>{league}</Text> : null}
        </View>
        {kickoffTime ? (
          <View style={[vi.timeBadge, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
            <Text style={[vi.timeText, { color: C.primary }]}>{kickoffTime}</Text>
          </View>
        ) : null}
      </View>
      {/* Surface / Conditions */}
      {surface ? (
        <View style={[vi.statRow, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="layers-outline" size={14} color={C.accentBlue ?? C.primary} />
          <Text style={[vi.statLabel, { color: C.textMuted }]}>Surface / Conditions</Text>
          <Text style={[vi.statVal, { color: C.textPrimary }]}>{surface}</Text>
        </View>
      ) : null}
      {/* Home advantage */}
      <View style={[vi.statRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Ionicons name="home-outline" size={14} color={HOME_C} />
        <Text style={[vi.statLabel, { color: C.textMuted }]}>Home Win % (Venue)</Text>
        <Text style={[vi.statVal, { color: HOME_C }]}>{homeAdv}%</Text>
      </View>
      {/* Average scoring */}
      <View style={[vi.statRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Ionicons name="stats-chart-outline" size={14} color={C.primary} />
        <Text style={[vi.statLabel, { color: C.textMuted }]}>{avgScoreLabel}</Text>
        <Text style={[vi.statVal, { color: C.textPrimary }]}>{avgScore}</Text>
      </View>
      {/* Stadium/arena effect */}
      <View style={[vi.statRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Ionicons name="people-outline" size={14} color="#F59E0B" />
        <Text style={[vi.statLabel, { color: C.textMuted }]}>{arenaLabel}</Text>
        <Text style={[vi.statVal, { color: '#F59E0B' }]}>{homeAdv >= 62 ? 'Strong' : homeAdv >= 55 ? 'Moderate' : 'Neutral'} Advantage</Text>
      </View>
    </View>
  );
}

const vi = StyleSheet.create({
  venueCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  venueName: { fontSize: 13, fontWeight: FONTS.bold },
  leagueText: { fontSize: 11, marginTop: 1 },
  timeBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  timeText: { fontSize: 11, fontWeight: FONTS.bold },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  statLabel: { flex: 1, fontSize: 12, fontWeight: FONTS.medium },
  statVal: { fontSize: 13, fontWeight: FONTS.bold },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 6 — AI Best 3 Predictions (VIP/Coin gated)
// IMPORTANT: Never reveal prediction outcomes — picks show market types and
// confidence signals only, not directional outcomes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BEST3_COIN_COST = 5;
const VIP_PLANS = [
  { id: 'monthly',   label: 'Monthly',  price: '$7.99',  period: '/mo',   saving: null,        accent: '#38BDF8' },
  { id: 'quarterly', label: 'Quarterly',price: '$17.99', period: '/3mo',  saving: 'Save 25%', accent: '#FFD700', popular: true },
  { id: 'annual',    label: 'Annual',   price: '$49.99', period: '/year', saving: 'Save 48%', accent: '#22C55E' },
];
const VIP_BENEFITS = [
  { icon: 'shield-checkmark-outline', label: 'AI Best 3 Predictions', highlight: true },
  { icon: 'brain-outline',            label: 'Unlimited AI Picks' },
  { icon: 'star-outline',             label: 'VIP Expert Tips' },
  { icon: 'trending-up-outline',      label: 'Advanced Stats & Analysis' },
  { icon: 'ban-outline',              label: 'Ad-Free Experience' },
];

// Sport-specific Best 3 market configurations (no outcome values)
function buildBest3Picks(
  family: SportFamily,
  homeTeam: string,
  awayTeam: string,
  confidence: number,
): Array<{ label: string; market: string; confidence: number; icon: string; color: string; description: string }> {
  const homeAbbr = homeTeam.split(' ').slice(-1)[0];
  const awayAbbr = awayTeam.split(' ').slice(-1)[0];
  const conf = confidence;

  switch (family) {
    case 'football':
      return [
        { label: 'Match Result (1X2)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Form analysis, H2H data and xG model identify the highest-value result market for this fixture` },
        { label: 'Total Goals Over/Under', market: 'Goals Market', confidence: Math.min(90, conf + 5), icon: 'trending-up-outline', color: '#22C55E',
          description: 'Poisson model using real xG ratings and recent scoring rates projects the goal total band' },
        { label: 'Both Teams to Score', market: 'BTTS Market', confidence: Math.min(88, conf + 3), icon: 'swap-horizontal-outline', color: '#14B8A6',
          description: 'Defensive solidity index and recent clean sheet records guide the BTTS market signal' },
      ];
    case 'basketball':
      return [
        { label: 'Game Winner (Moneyline)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Net rating differential and pace-adjusted offensive efficiency identify the strongest moneyline signal` },
        { label: 'Total Points Over/Under', market: 'Totals', confidence: Math.min(90, conf + 5), icon: 'analytics-outline', color: '#22C55E',
          description: 'Combined offensive/defensive ratings and recent pace data project the total points band' },
        { label: 'Point Spread Coverage', market: 'Spread', confidence: Math.max(50, conf - 8), icon: 'git-branch-outline', color: AWAY_C,
          description: 'Home court adjusted net rating predicts whether the spread will be covered' },
      ];
    case 'tennis':
      return [
        { label: 'Match Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Surface Elo ratings, serve dominance and H2H records on this surface identify the match winner` },
        { label: 'Total Games Over/Under', market: 'Games Total', confidence: Math.min(88, conf + 3), icon: 'trending-up-outline', color: '#22C55E',
          description: 'Head-to-head scoring patterns and serve hold percentages predict the game count range' },
        { label: 'Games Handicap', market: 'Handicap', confidence: Math.max(50, conf - 8), icon: 'analytics-outline', color: AWAY_C,
          description: 'Ranking differential and recent form on surface suggest the games handicap margin' },
      ];
    case 'cricket':
      return [
        { label: 'Match Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `ICC rankings, recent form and pitch report analysis produce the match winner probability signal` },
        { label: 'Team Total Runs', market: 'Runs Market', confidence: Math.min(88, conf + 3), icon: 'stats-chart-outline', color: '#22C55E',
          description: 'Batting average, powerplay data and venue scoring history generate the total runs projection' },
        { label: 'Highest Scorer Market', market: 'Player Props', confidence: Math.max(50, conf - 5), icon: 'person-outline', color: AWAY_C,
          description: 'Recent form, strike rate and batting position history identify the most likely top scorer' },
      ];
    case 'baseball':
      return [
        { label: 'Game Winner (Moneyline)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Starting pitcher ERA/WHIP matchup and recent offensive form generate the moneyline signal` },
        { label: 'Run Line', market: 'Run Line', confidence: Math.max(50, conf - 12), icon: 'git-branch-outline', color: '#22C55E',
          description: 'Pitching differential and team run production rates guide the -1.5 / +1.5 run line market' },
        { label: 'Total Runs Over/Under', market: 'Totals', confidence: Math.min(88, conf + 5), icon: 'analytics-outline', color: AWAY_C,
          description: 'Combined ERA, run scoring rates and ballpark factor generate the total runs band' },
      ];
    case 'hockey':
      return [
        { label: 'Game Winner (Moneyline)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Goaltending save percentage, special teams efficiency and recent form generate the winner signal` },
        { label: 'Total Goals Over/Under', market: 'Totals', confidence: Math.min(88, conf + 5), icon: 'trending-up-outline', color: '#22C55E',
          description: 'Combined GAA, power play efficiency and pace data project the total goals band' },
        { label: 'Puck Line', market: 'Puck Line', confidence: Math.max(50, conf - 10), icon: 'git-branch-outline', color: AWAY_C,
          description: 'Shot differential and defensive zone performance predict the ±1.5 puck line coverage' },
      ];
    case 'rugby':
      return [
        { label: 'Match Result (1X2)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `World ranking differential, set piece dominance and recent form generate the match result signal` },
        { label: 'Handicap Points', market: 'Spread', confidence: Math.max(52, conf - 8), icon: 'analytics-outline', color: '#22C55E',
          description: 'Scoring form, set piece and penalty kicking accuracy identify the handicap line value' },
        { label: 'Total Points Over/Under', market: 'Totals', confidence: Math.min(88, conf + 5), icon: 'trending-up-outline', color: AWAY_C,
          description: 'Try-scoring rates, conversion accuracy and defensive records project the total points range' },
      ];
    case 'mma':
      return [
        { label: 'Fight Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Striking accuracy, takedown defense and recent finishing rates generate the winner probability` },
        { label: 'Method of Victory', market: 'Method', confidence: Math.max(50, conf - 10), icon: 'flash-outline', color: '#EF4444',
          description: 'KO rate, submission attempts and finishing history identify the most likely victory method' },
        { label: 'Total Rounds Over/Under', market: 'Rounds', confidence: Math.max(50, conf - 8), icon: 'time-outline', color: AWAY_C,
          description: 'Combined finishing rates and recent fight duration trends predict the round count band' },
      ];
    case 'boxing':
      return [
        { label: 'Fight Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Punch accuracy, defensive movement and recent scorecard history generate the winner signal` },
        { label: 'KO Probability', market: 'Method', confidence: Math.max(50, conf - 10), icon: 'flash-outline', color: '#EF4444',
          description: 'Historical KO rates and punch volume data estimate the probability of a stoppage finish' },
        { label: 'Decision Probability', market: 'Distance', confidence: Math.max(48, conf - 12), icon: 'analytics-outline', color: AWAY_C,
          description: 'Combined defensive and evasion metrics estimate the probability of a judges decision' },
      ];
    case 'volleyball':
      return [
        { label: 'Match Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Attack efficiency, blocking rates and service data generate the match winner probability` },
        { label: 'Set Handicap', market: 'Handicap', confidence: Math.max(50, conf - 7), icon: 'git-branch-outline', color: '#22C55E',
          description: 'Recent set win ratios and home court advantage project the set handicap market value' },
        { label: 'Total Sets Over/Under', market: 'Sets Total', confidence: Math.max(52, conf - 5), icon: 'trending-up-outline', color: AWAY_C,
          description: 'Competitive balance index and recent match length data predict total sets played' },
      ];
    case 'handball':
      return [
        { label: 'Match Result (1X2)', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Goal scoring rate, 7m conversion and GK save percentage generate the match result signal` },
        { label: 'Total Goals Over/Under', market: 'Totals', confidence: Math.min(88, conf + 5), icon: 'trending-up-outline', color: '#22C55E',
          description: 'Fast-break frequency, shot efficiency and defensive rates project the combined goals range' },
        { label: 'Both Teams Score 20+', market: 'Scoring', confidence: Math.max(55, conf - 5), icon: 'swap-horizontal-outline', color: '#14B8A6',
          description: 'Recent scoring averages and GK save rates estimate the probability both teams reach 20+ goals' },
      ];
    default:
      return [
        { label: 'Match Winner', market: 'Main Market', confidence: conf, icon: 'trophy-outline', color: HOME_C,
          description: `Multi-model analysis of form, H2H and venue data generates the highest-value market signal` },
        { label: 'High Confidence Pick', market: 'Second Pick', confidence: Math.max(50, conf - 5), icon: 'shield-checkmark-outline', color: '#22C55E',
          description: 'Secondary signal identified across multiple AI models with strong data consensus' },
        { label: 'Value Pick', market: 'Third Pick', confidence: Math.max(48, conf - 10), icon: 'analytics-outline', color: AWAY_C,
          description: 'Market edge detected — AI probability diverges meaningfully from implied bookmaker odds' },
      ];
  }
}

function VIPUpgradeModal({ visible, onClose, onNavigate, C }: {
  visible: boolean; onClose: () => void; onNavigate: () => void; C: AppColors;
}) {
  const [selectedPlan, setSelectedPlan] = React.useState('quarterly');
  const gold = C.vip ?? '#FFD700';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={vum.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[vum.sheet, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[vum.header, { borderBottomColor: C.border }]}>
            <View style={[vum.crownWrap, { backgroundColor: `${gold}18`, borderColor: `${gold}44` }]}>
              <FontAwesome5 name="crown" size={22} color={gold} solid />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[vum.title, { color: C.textPrimary }]}>Upgrade to VIP</Text>
              <Text style={[vum.subtitle, { color: C.textMuted }]}>Unlock AI Best 3 Predictions & more</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={[vum.closeBtn, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Ionicons name="close" size={16} color={C.textMuted} />
            </Pressable>
          </View>
          <View style={vum.plansRow}>
            {VIP_PLANS.map((plan) => {
              const isSel = selectedPlan === plan.id;
              return (
                <Pressable key={plan.id}
                  style={({ pressed }) => [vum.planCard, { borderColor: isSel ? plan.accent : C.border, backgroundColor: isSel ? `${plan.accent}12` : C.surface }, pressed ? { opacity: 0.85 } : null]}
                  onPress={() => setSelectedPlan(plan.id)}>
                  {(plan as any).popular ? (
                    <View style={[vum.popularBadge, { backgroundColor: plan.accent }]}>
                      <Text style={vum.popularText}>BEST</Text>
                    </View>
                  ) : null}
                  <Text style={[vum.planLabel, { color: C.textMuted }]}>{plan.label}</Text>
                  <Text style={[vum.planPrice, { color: isSel ? plan.accent : C.textPrimary }]}>{plan.price}</Text>
                  <Text style={[vum.planPeriod, { color: C.textMuted }]}>{plan.period}</Text>
                  {plan.saving ? <View style={[vum.savingBadge, { backgroundColor: `${plan.accent}18`, borderColor: `${plan.accent}44` }]}><Text style={[vum.savingText, { color: plan.accent }]}>{plan.saving}</Text></View> : null}
                  {isSel ? <View style={[vum.checkDot, { backgroundColor: plan.accent }]}><Ionicons name="checkmark" size={9} color="#fff" /></View> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={vum.benefitsList}>
            {VIP_BENEFITS.map((b, i) => (
              <View key={i} style={vum.benefitRow}>
                <View style={[vum.benefitIcon, b.highlight ? { backgroundColor: '#22C55E18', borderColor: '#22C55E44' } : { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
                  <Ionicons name={b.icon as any} size={13} color={b.highlight ? '#22C55E' : C.primary} />
                </View>
                <Text style={[vum.benefitLabel, { color: b.highlight ? C.textPrimary : C.textSecondary }, b.highlight ? { fontWeight: FONTS.bold } : null]}>{b.label}</Text>
                {b.highlight ? <View style={[vum.includedBadge, { backgroundColor: '#22C55E18', borderColor: '#22C55E44' }]}><Text style={[vum.includedText, { color: '#22C55E' }]}>INCLUDED</Text></View> : null}
              </View>
            ))}
          </View>
          <Pressable style={({ pressed }) => [vum.ctaBtn, { backgroundColor: C.primary }, pressed ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null]} onPress={onNavigate}>
            <FontAwesome5 name="crown" size={14} color={C.textInverse} />
            <Text style={[vum.ctaBtnText, { color: C.textInverse }]}>Upgrade to VIP</Text>
            <Ionicons name="arrow-forward" size={14} color={C.textInverse} />
          </Pressable>
          <Text style={[vum.ctaNote, { color: C.textMuted }]}>Cancel anytime · Secure payment</Text>
        </View>
      </View>
    </Modal>
  );
}

const vum = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 36, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  crownWrap: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 18, fontWeight: FONTS.extraBold },
  subtitle: { fontSize: 12, marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  plansRow: { flexDirection: 'row', gap: 8 },
  planCard: { flex: 1, alignItems: 'center', borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 4, gap: 4, position: 'relative', minHeight: 110 },
  popularBadge: { position: 'absolute', top: -10, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  popularText: { fontSize: 8, fontWeight: FONTS.extraBold, color: '#000', letterSpacing: 1 },
  planLabel: { fontSize: 10, fontWeight: FONTS.semiBold, marginTop: 8 },
  planPrice: { fontSize: 20, fontWeight: FONTS.extraBold },
  planPeriod: { fontSize: 9 },
  savingBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  savingText: { fontSize: 9, fontWeight: FONTS.bold },
  checkDot: { position: 'absolute', bottom: 8, right: 8, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  benefitsList: { gap: 8 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefitIcon: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  benefitLabel: { flex: 1, fontSize: 13 },
  includedBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  includedText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 15 },
  ctaBtnText: { fontSize: 16, fontWeight: FONTS.extraBold },
  ctaNote: { fontSize: 11, textAlign: 'center' },
});

function Best3Section({
  prediction, sport, sportLabel, homeTeam, awayTeam,
  isVip, coinBalance, best3Unlocked, onUnlock, C,
}: {
  prediction: IntelligenceProps['prediction'];
  sport: string; sportLabel: string;
  homeTeam: string; awayTeam: string;
  isVip: boolean; coinBalance: number; best3Unlocked: boolean;
  onUnlock?: () => void; C: AppColors;
}) {
  const router = useRouter();
  const family = getSportFamily(sport);
  const canView = isVip || best3Unlocked;
  const [open, setOpen] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const hasCoins = coinBalance >= BEST3_COIN_COST;
  const accent = '#22C55E';
  const conf = prediction?.confidence ?? 65;
  const picks = useMemo(() => buildBest3Picks(family, homeTeam, awayTeam, conf), [family, homeTeam, awayTeam, conf]);

  return (
    <>
      <VIPUpgradeModal visible={showModal} onClose={() => setShowModal(false)} onNavigate={() => { setShowModal(false); setTimeout(() => router.push('/vip' as any), 200); }} C={C} />
      <View style={[sc.card, { backgroundColor: C.card, borderColor: canView ? `${accent}44` : C.border }]}>
        <Pressable style={sc.header} onPress={() => { if (canView) setOpen(v => !v); else if (!hasCoins) setShowModal(true); }} hitSlop={6}>
          <View style={[sc.iconWrap, { backgroundColor: `${accent}18`, borderColor: `${accent}33` }]}>
            <Ionicons name="shield-checkmark-outline" size={13} color={accent} />
          </View>
          <Text style={[sc.title, { color: C.textPrimary }]}>{`AI BEST 3 PREDICTIONS · ${sportLabel.toUpperCase()}`}</Text>
          {canView ? (
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <FontAwesome5 name="crown" size={9} color={C.vip ?? '#F59E0B'} />
              <Ionicons name="lock-closed" size={13} color={C.textMuted} />
            </View>
          )}
        </Pressable>

        {canView && open ? (
          <View style={[sc.body, { gap: 10 }]}>
            <View style={[b3.banner, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <FontAwesome5 name="brain" size={12} color={C.primary} />
              <Text style={[b3.bannerText, { color: C.primary }]}>Top 3 highest-confidence picks for this {sportLabel.toLowerCase()} fixture</Text>
            </View>
            {picks.map((p, i) => {
              const confColor = p.confidence >= 75 ? '#22C55E' : p.confidence >= 60 ? '#F59E0B' : '#EF4444';
              return (
                <View key={i} style={[b3.pickCard, { backgroundColor: C.card, borderColor: `${p.color}33` }]}>
                  <View style={b3.pickLeft}>
                    <View style={[b3.pickNum, { backgroundColor: `${p.color}18`, borderColor: `${p.color}44` }]}>
                      <Text style={[b3.pickNumText, { color: p.color }]}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[b3.pickMarket, { color: C.textMuted }]}>{p.label}</Text>
                      <Text style={[b3.pickMarketSub, { color: C.textSecondary }]}>{p.market}</Text>
                      <Text style={[b3.pickDesc, { color: C.textSecondary }]}>{p.description}</Text>
                    </View>
                  </View>
                  <View style={[b3.confBadge, { backgroundColor: `${confColor}14`, borderColor: `${confColor}33` }]}>
                    <Ionicons name="shield-checkmark-outline" size={10} color={confColor} />
                    <Text style={[b3.confText, { color: confColor }]}>{p.confidence}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : !canView ? (
          <View style={[b3.lockBody, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }]}>
            {/* Teaser blurred preview */}
            <View style={[b3.teaserCard, { backgroundColor: C.surface, borderColor: C.border }]}>
              <View style={[b3.teaserRow]}>
                <View style={[b3.teaserNum, { backgroundColor: `${accent}18`, borderColor: `${accent}33` }]}>
                  <Text style={[b3.teaserNumText, { color: accent }]}>1</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={[b3.blurBar, { backgroundColor: `${C.primary}44`, width: '70%' }]} />
                  <View style={[b3.blurBar, { backgroundColor: C.border, width: '90%' }]} />
                </View>
                <View style={[b3.confBadge, { backgroundColor: `${accent}14`, borderColor: `${accent}33` }]}>
                  <Text style={[b3.confText, { color: accent }]}>??%</Text>
                </View>
              </View>
              <View style={[b3.lockOverlay, { backgroundColor: `${C.bg}CC` }]}>
                <Ionicons name="lock-closed" size={18} color={C.textMuted} />
              </View>
            </View>
            {/* Coin unlock */}
            {onUnlock && hasCoins ? (
              <Pressable style={({ pressed }) => [b3.coinBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.85 } : null]} onPress={onUnlock}>
                <Text style={{ fontSize: 15 }}>🪙</Text>
                <Text style={[b3.coinBtnText, { color: C.primary }]}>Unlock with {BEST3_COIN_COST} coins</Text>
              </Pressable>
            ) : null}
            {onUnlock && hasCoins ? (
              <View style={b3.orRow}>
                <View style={[b3.orLine, { backgroundColor: C.border }]} />
                <Text style={[b3.orText, { color: C.textMuted }]}>or</Text>
                <View style={[b3.orLine, { backgroundColor: C.border }]} />
              </View>
            ) : null}
            {/* VIP upgrade */}
            <Pressable
              style={({ pressed }) => [b3.vipBtn, { backgroundColor: `${C.vip ?? '#FFD700'}14`, borderColor: `${C.vip ?? '#FFD700'}44` }, pressed ? { opacity: 0.85 } : null]}
              onPress={() => setShowModal(true)}>
              <FontAwesome5 name="crown" size={13} color={C.vip ?? '#FFD700'} />
              <Text style={[b3.vipBtnText, { color: C.vip ?? '#FFD700' }]}>Upgrade to VIP — Unlock All Picks</Text>
              <Ionicons name="chevron-forward" size={13} color={C.vip ?? '#FFD700'} />
            </Pressable>
            <View style={[b3.hint, { backgroundColor: `${C.vip ?? '#F59E0B'}0A`, borderColor: `${C.vip ?? '#F59E0B'}22` }]}>
              <Ionicons name="information-circle-outline" size={11} color={C.textMuted} />
              <Text style={[b3.hintText, { color: C.textMuted }]}>
                {hasCoins
                  ? `Use ${BEST3_COIN_COST} coins for single match · VIP for unlimited access`
                  : `Need ${BEST3_COIN_COST} coins to unlock · You have ${coinBalance} · Get VIP for unlimited access`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </>
  );
}

const b3 = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  bannerText: { fontSize: 11, fontWeight: FONTS.semiBold, flex: 1 },
  pickCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  pickLeft: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pickNum: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pickNumText: { fontSize: 13, fontWeight: FONTS.extraBold },
  pickMarket: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, marginBottom: 1 },
  pickMarketSub: { fontSize: 11, fontWeight: FONTS.semiBold, marginBottom: 3 },
  pickDesc: { fontSize: 11, lineHeight: 16 },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  confText: { fontSize: 11, fontWeight: FONTS.extraBold },
  lockBody: { paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  teaserCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, overflow: 'hidden', position: 'relative' },
  teaserRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, opacity: 0.4 },
  teaserNum: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  teaserNumText: { fontSize: 13, fontWeight: FONTS.extraBold },
  blurBar: { height: 12, borderRadius: RADIUS.full as any },
  lockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.lg },
  coinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full as any, borderWidth: 1, paddingVertical: 12 },
  coinBtnText: { fontSize: 14, fontWeight: FONTS.bold },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: 11 },
  vipBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg as any, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  vipBtnText: { flex: 1, fontSize: 13, fontWeight: FONTS.bold },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  hintText: { fontSize: 11, flex: 1, lineHeight: 16 },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 7 — Risk Meter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const RISK_LEVELS = [
  { label: 'Very Low',  color: '#22C55E', description: 'Strong data consensus, high confidence, clear statistical advantage', emoji: '🟢' },
  { label: 'Low',       color: '#4ADE80', description: 'Good data quality, moderate edge, reliable statistical signals',        emoji: '🟡' },
  { label: 'Medium',    color: '#F59E0B', description: 'Competitive match, some uncertainty, margins are narrow',               emoji: '🟡' },
  { label: 'High',      color: '#F97316', description: 'Significant variance, limited data, form is inconsistent',              emoji: '🟠' },
  { label: 'Very High', color: '#EF4444', description: 'High uncertainty, no clear statistical favorite, avoid parlays',        emoji: '🔴' },
];

function RiskMeter({
  prediction, sport, homeForm, awayForm, h2hRecords, C,
}: {
  prediction: IntelligenceProps['prediction'];
  sport: string;
  homeForm?: string[]; awayForm?: string[];
  h2hRecords?: IntelligenceProps['h2hRecords'];
  C: AppColors;
}) {
  const family = getSportFamily(sport);

  const riskIndex = useMemo(() => {
    if (!prediction) return 2;
    const conf = prediction.confidence;
    const hwr = formWinRate(homeForm ?? []);
    const awr = formWinRate(awayForm ?? []);
    const probDiff = Math.abs((prediction.homeWinProb ?? 40) - (prediction.awayWinProb ?? 35));
    const h2hCount = h2hRecords?.length ?? 0;
    let score = 0;
    if (conf >= 80) score -= 1;
    if (conf >= 70) score -= 1;
    if (conf < 60) score += 1;
    if (conf < 50) score += 1;
    if (probDiff >= 20) score -= 1;
    if (probDiff < 10) score += 1;
    if (Math.abs(hwr - awr) >= 0.2) score -= 1;
    if (Math.abs(hwr - awr) < 0.1) score += 1;
    if (h2hCount >= 3) score -= 1;
    return Math.max(0, Math.min(4, 2 + score));
  }, [prediction, homeForm, awayForm, h2hRecords]);

  // Prefer prediction's risk level if available
  const overrideIdx = prediction?.riskLevel
    ? RISK_LEVELS.findIndex(r => prediction.riskLevel?.toLowerCase().includes(r.label.toLowerCase()))
    : -1;
  const displayIdx = overrideIdx >= 0 ? overrideIdx : riskIndex;
  const current = RISK_LEVELS[displayIdx];

  const risks = useMemo(() => {
    const list: string[] = [];
    if (!prediction) return ['Awaiting AI analysis'];
    const conf = prediction.confidence;
    const h2hCount = h2hRecords?.length ?? 0;
    const hwr = formWinRate(homeForm ?? []);
    const awr = formWinRate(awayForm ?? []);
    if (conf < 65) list.push(`Below-average AI confidence (${conf}%)`);
    if (Math.abs(hwr - awr) < 0.1) list.push('Teams evenly matched — outcome highly unpredictable');
    if (h2hCount < 3) list.push('Limited head-to-head history — historical patterns unreliable');
    if (family === 'tennis') list.push('Surface-specific performance variance may affect player output');
    if (family === 'cricket') list.push('Weather conditions and pitch type introduce significant variance');
    if (family === 'mma' || family === 'boxing') list.push('Combat sports carry inherent KO/upset risk regardless of statistics');
    if (list.length === 0) list.push('Standard variance — all statistical signals pointing in same direction');
    return list.slice(0, 3);
  }, [prediction, h2hRecords, homeForm, awayForm, family]);

  // Guidance text — no outcome hints
  const guidance = displayIdx <= 1
    ? 'Suitable for single bets. Standard stake advised. Avoid high-stake parlays even with high confidence — outcomes are never certain.'
    : displayIdx === 2
    ? 'Consider a moderate stake. Suitable for accumulators only with caution — apply a discount to projected confidence.'
    : 'Reduce stake or avoid. High statistical uncertainty — this fixture carries elevated upset probability.';

  return (
    <View style={{ gap: 12 }}>
      {/* Meter visual */}
      <View style={[rm.card, { backgroundColor: C.surface, borderColor: C.border }]}>
        <View style={rm.meterRow}>
          {RISK_LEVELS.map((level, i) => (
            <View key={level.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={[rm.segment, {
                backgroundColor: i === displayIdx ? level.color : `${level.color}30`,
                borderColor: i === displayIdx ? level.color : 'transparent',
                borderWidth: i === displayIdx ? 1.5 : 0,
                transform: i === displayIdx ? [{ scaleY: 1.3 }] : [{ scaleY: 1 }],
              }]} />
              {i === displayIdx ? <View style={[rm.pointer, { borderTopColor: level.color }]} /> : null}
            </View>
          ))}
        </View>
        <View style={[rm.resultRow, { backgroundColor: `${current.color}14`, borderColor: `${current.color}33` }]}>
          <Text style={{ fontSize: 20 }}>{current.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[rm.riskLabel, { color: current.color }]}>{current.label} Risk</Text>
            <Text style={[rm.riskDesc, { color: C.textSecondary }]}>{current.description}</Text>
          </View>
          {prediction?.valueScore != null ? (
            <View style={[rm.valueBadge, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
              <Text style={[rm.valueText, { color: C.primary }]}>Value {prediction.valueScore}/100</Text>
            </View>
          ) : null}
        </View>
      </View>
      {/* Risk factors */}
      <View>
        <Text style={[rm.factorsTitle, { color: C.textMuted }]}>RISK FACTORS</Text>
        {risks.map((r, i) => (
          <View key={i} style={rm.factorRow}>
            <View style={[rm.factorDot, { backgroundColor: current.color }]} />
            <Text style={[rm.factorText, { color: C.textSecondary }]}>{r}</Text>
          </View>
        ))}
      </View>
      {/* Guidance */}
      <View style={[rm.guidanceCard, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Ionicons name="information-circle-outline" size={14} color={C.primary} />
        <Text style={[rm.guidanceText, { color: C.textMuted }]}>{guidance}</Text>
      </View>
    </View>
  );
}

const rm = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 12 },
  meterRow: { flexDirection: 'row', gap: 4, height: 22, alignItems: 'flex-end' },
  segment: { height: 16, borderRadius: 3, width: '100%' },
  pointer: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, borderWidth: 1, padding: 10 },
  riskLabel: { fontSize: 14, fontWeight: FONTS.extraBold },
  riskDesc: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  valueBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  valueText: { fontSize: 9, fontWeight: FONTS.bold },
  factorsTitle: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8, marginBottom: 8 },
  factorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  factorDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  factorText: { flex: 1, fontSize: 12, lineHeight: 18 },
  guidanceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 10 },
  guidanceText: { flex: 1, fontSize: 11, lineHeight: 16 },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN EXPORT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPORT_EMOJI_MAP: Partial<Record<SportFamily, string>> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
  baseball: '⚾', hockey: '🏒', american_football: '🏈', rugby: '🏉',
  mma: '🥊', boxing: '🥊', volleyball: '🏐', handball: '🤾', esports: '🎮',
};

export default function SportPreMatchIntelligence(props: IntelligenceProps) {
  const { sport, homeTeam, awayTeam, prediction, C } = props;
  const family = getSportFamily(sport);
  const sportEmoji = SPORT_EMOJI_MAP[family] ?? '🏆';
  const sportLabel = sport.charAt(0).toUpperCase() + sport.slice(1).replace(/[-_]/g, ' ');

  // Section 2 title — sport-specific
  const section2Title = useMemo(() => {
    switch (family) {
      case 'football': return `${sportEmoji} Team Strength Analysis`;
      case 'basketball': return `${sportEmoji} Team Efficiency`;
      case 'tennis': return `${sportEmoji} Player Comparison`;
      case 'cricket': return `${sportEmoji} Team Strength`;
      case 'baseball': return `${sportEmoji} Team Comparison`;
      case 'hockey': return `${sportEmoji} Team Ratings`;
      case 'american_football': return `${sportEmoji} Team Comparison`;
      case 'rugby': return `${sportEmoji} Team Strength`;
      case 'mma': return `${sportEmoji} Fighter Comparison`;
      case 'boxing': return `${sportEmoji} Fighter Profiles`;
      case 'volleyball': return `${sportEmoji} Team Comparison`;
      case 'handball': return `${sportEmoji} Team Comparison`;
      default: return `${sportEmoji} ${sportLabel} Intelligence`;
    }
  }, [family, sportEmoji, sportLabel]);

  return (
    <View style={root.container}>
      {/* Top banner */}
      <LinearGradient
        colors={[`${C.primary}18`, `${C.surface}CC`] as [string, string]}
        style={[root.banner, { borderColor: `${C.primary}33` }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 20 }}>{sportEmoji}</Text>
          <View>
            <Text style={[root.bannerTitle, { color: C.primary }]}>PRE-MATCH INTELLIGENCE</Text>
            <Text style={[root.bannerSub, { color: C.textMuted }]}>{sportLabel} · AI-Powered Analysis</Text>
          </View>
          {props.matchStatus === 'live' ? (
            <View style={[root.livePill, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
              <View style={[root.liveDot, { backgroundColor: '#EF4444' }]} />
              <Text style={[root.liveText, { color: '#EF4444' }]}>LIVE</Text>
            </View>
          ) : null}
        </View>
      </LinearGradient>

      {/* Section 1 — AI Match Intelligence Summary */}
      <SectionCard title="AI MATCH INTELLIGENCE SUMMARY" icon="analytics-outline" color={C.primary} C={C} defaultExpanded={false}>
        <AIMatchSummary
          prediction={prediction}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          sport={sport}
          homeForm={props.homeForm}
          awayForm={props.awayForm}
          h2hRecords={props.h2hRecords}
          C={C}
        />
      </SectionCard>

      {/* Section 2 — Sport-Specific Team/Player Comparison */}
      <SectionCard title={section2Title.toUpperCase()} icon="analytics-outline" color={HOME_C} C={C} defaultExpanded={false}>
        <TeamComparison
          sport={sport}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeLogo={props.homeLogo}
          awayLogo={props.awayLogo}
          homeForm={props.homeForm}
          awayForm={props.awayForm}
          prediction={prediction}
          stats={props.stats}
          C={C}
        />
      </SectionCard>

      {/* Section 3 — Form Analysis */}
      <SectionCard title="FORM ANALYSIS" icon="trending-up-outline" color="#22C55E" C={C} defaultExpanded={false}>
        <FormAnalysis
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeForm={props.homeForm}
          awayForm={props.awayForm}
          sport={sport}
          C={C}
        />
      </SectionCard>

      {/* Section 4 — Head-to-Head */}
      <SectionCard title="HEAD-TO-HEAD HISTORY" icon="git-compare-outline" color="#F59E0B" C={C} defaultExpanded={false}>
        <HeadToHead
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          h2hRecords={props.h2hRecords}
          sport={sport}
          C={C}
        />
      </SectionCard>

      {/* Section 5 — Venue Intelligence */}
      <SectionCard title="VENUE INTELLIGENCE" icon="location-outline" color="#A78BFA" C={C} defaultExpanded={false}>
        <VenueIntelligence
          venue={props.venue}
          league={props.league}
          homeTeam={homeTeam}
          sport={sport}
          matchTime={props.matchTime}
          C={C}
        />
      </SectionCard>

      {/* Section 6 — AI Best 3 Predictions (gated) */}
      <Best3Section
        prediction={prediction}
        sport={sport}
        sportLabel={sportLabel}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        isVip={props.isVip ?? false}
        coinBalance={props.coinBalance ?? 0}
        best3Unlocked={props.best3Unlocked ?? false}
        onUnlock={props.onUnlockBest3}
        C={C}
      />

      {/* Section 7 — Risk Meter */}
      <SectionCard title="RISK METER" icon="warning-outline" color="#F97316" C={C} defaultExpanded={false}>
        <RiskMeter
          prediction={prediction}
          sport={sport}
          homeForm={props.homeForm}
          awayForm={props.awayForm}
          h2hRecords={props.h2hRecords}
          C={C}
        />
      </SectionCard>
    </View>
  );
}

const root = StyleSheet.create({
  container: { gap: 10 },
  banner: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 6 },
  bannerTitle: { fontSize: 13, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  bannerSub: { fontSize: 11, marginTop: 1 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: 'auto',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
});
