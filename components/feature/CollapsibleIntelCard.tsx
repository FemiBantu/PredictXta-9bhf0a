/**
 * CollapsibleIntelCard — Intelligence-first collapsible card system
 *
 * Used across Home Overview, AI Picks Overview, and Match Detail Overview.
 * Default state: collapsed — shows headline + confidence + risk + odds
 * Expanded state: reveals full intelligence (reasoning, metrics, evidence, factors)
 *
 * Design: glassmorphism, sport-aware color tokens, smooth 300ms animation
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'elite' | 'high' | 'medium' | 'low';
export type RiskLevel = 'Very Low' | 'Low' | 'Medium' | 'High' | 'Very High';

export interface IntelCardMetric {
  label: string;
  value: string;
  color?: string;
  icon?: string;
  ok?: boolean | null;
}

export interface IntelCardProps {
  /** Collapsed header */
  title: string;
  subtitle?: string;
  confidence?: number;
  riskLevel?: RiskLevel | string | null;
  odds?: number | null;
  prediction?: string;
  predictionColor?: string;
  /** Sport emoji or icon */
  sportEmoji?: string;
  /** Category badge label */
  category?: string;
  categoryColor?: string;
  /** Left accent bar color */
  accentColor?: string;

  /** Expanded content */
  reasoning?: string | null;
  historicalEvidence?: string[];
  metrics?: IntelCardMetric[];
  riskFactors?: string[];
  keyFactors?: string[];
  modelConsensus?: number;
  dataQuality?: number;
  historicalAccuracy?: number;

  /** Why it could fail items */
  failureReasons?: string[];

  /** Pre-rendered children shown when expanded */
  children?: React.ReactNode;

  /** Initial expanded state */
  defaultExpanded?: boolean;

  C: AppColors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function confidenceLevel(pct: number): ConfidenceLevel {
  if (pct >= 85) return 'elite';
  if (pct >= 72) return 'high';
  if (pct >= 58) return 'medium';
  return 'low';
}

function confidenceLevelConfig(level: ConfidenceLevel) {
  switch (level) {
    case 'elite': return { label: 'ELITE', color: '#22C55E', bg: '#22C55E18' };
    case 'high':  return { label: 'HIGH',  color: '#4ECDC4', bg: '#4ECDC418' };
    case 'medium': return { label: 'MED',  color: '#F59E0B', bg: '#F59E0B18' };
    case 'low':   return { label: 'LOW',   color: '#EF4444', bg: '#EF444418' };
  }
}

function riskConfig(risk: string) {
  const r = risk.toLowerCase();
  if (r.includes('very low')) return { color: '#22C55E', bg: '#22C55E18' };
  if (r.includes('low'))       return { color: '#4ECDC4', bg: '#4ECDC418' };
  if (r.includes('very high')) return { color: '#EF4444', bg: '#EF444418' };
  if (r.includes('high'))      return { color: '#F97316', bg: '#F9731618' };
  return { color: '#F59E0B', bg: '#F59E0B18' };
}

// ─── Mini Progress Bar ─────────────────────────────────────────────────────────
function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: `${color}20`, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────
function MetricRow({ metric, C }: { metric: IntelCardMetric; C: AppColors }) {
  const color = metric.color ?? C.textSecondary;
  const ok = metric.ok;
  const indicator = ok === true ? '#22C55E' : ok === false ? '#EF4444' : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }}>
      {indicator ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: indicator, flexShrink: 0 }} /> : null}
      {metric.icon ? <Ionicons name={metric.icon as any} size={13} color={color} /> : null}
      <Text style={{ flex: 1, fontSize: 12, color: C.textMuted }}>{metric.label}</Text>
      <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color }}>{metric.value}</Text>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CollapsibleIntelCard({
  title, subtitle, confidence, riskLevel, odds, prediction, predictionColor,
  sportEmoji, category, categoryColor, accentColor,
  reasoning, historicalEvidence, metrics, riskFactors, keyFactors,
  modelConsensus, dataQuality, historicalAccuracy,
  failureReasons, children, defaultExpanded = false, C,
}: IntelCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotateAnim = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 260,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    setExpanded((prev) => {
      Animated.timing(rotateAnim, {
        toValue: prev ? 0 : 1,
        duration: 260,
        useNativeDriver: true,
      }).start();
      return !prev;
    });
  }, [rotateAnim]);

  const chevronRotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  const confLevel = confidence !== undefined ? confidenceLevel(confidence) : null;
  const confCfg = confLevel ? confidenceLevelConfig(confLevel) : null;
  const riskCfg = riskLevel ? riskConfig(riskLevel) : null;
  const accent = accentColor ?? (predictionColor ?? (confCfg?.color ?? C.primary));
  const catColor = categoryColor ?? accent;

  const hasExpandedContent = !!(
    reasoning ||
    (historicalEvidence && historicalEvidence.length > 0) ||
    (metrics && metrics.length > 0) ||
    (riskFactors && riskFactors.length > 0) ||
    (keyFactors && keyFactors.length > 0) ||
    modelConsensus !== undefined ||
    dataQuality !== undefined ||
    historicalAccuracy !== undefined ||
    (failureReasons && failureReasons.length > 0) ||
    children
  );

  return (
    <View style={[s.card, { backgroundColor: C.card, borderColor: expanded ? `${accent}55` : C.border }]}>
      {/* Accent bar */}
      <View style={[s.accentBar, { backgroundColor: accent }]} />

      <View style={{ flex: 1 }}>
        {/* ── COLLAPSED HEADER ──────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [s.header, pressed ? { opacity: 0.85 } : null]}
          onPress={hasExpandedContent ? toggle : undefined}
          disabled={!hasExpandedContent}
          hitSlop={4}
        >
          {/* Left: emoji + text */}
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {sportEmoji ? <Text style={s.sportEmoji}>{sportEmoji}</Text> : null}
              {category ? (
                <View style={[s.categoryBadge, { backgroundColor: `${catColor}18`, borderColor: `${catColor}33` }]}>
                  <Text style={[s.categoryText, { color: catColor }]}>{category}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[s.title, { color: C.textPrimary }]}>{title}</Text>
            {subtitle ? <Text style={[s.subtitle, { color: C.textMuted }]} numberOfLines={2}>{subtitle}</Text> : null}

            {/* Collapsed pill row */}
            <View style={s.pillRow}>
              {prediction ? (
                <View style={[s.pill, { backgroundColor: `${predictionColor ?? C.primary}18`, borderColor: `${predictionColor ?? C.primary}33` }]}>
                  <FontAwesome5 name="brain" size={8} color={predictionColor ?? C.primary} />
                  <Text style={[s.pillText, { color: predictionColor ?? C.primary }]}>{prediction}</Text>
                </View>
              ) : null}
              {confCfg && confidence !== undefined ? (
                <View style={[s.pill, { backgroundColor: confCfg.bg, borderColor: `${confCfg.color}44` }]}>
                  <Text style={[s.pillText, { color: confCfg.color }]}>{confidence}% {confCfg.label}</Text>
                </View>
              ) : null}
              {riskCfg && riskLevel ? (
                <View style={[s.pill, { backgroundColor: riskCfg.bg, borderColor: `${riskCfg.color}33` }]}>
                  <Text style={[s.pillText, { color: riskCfg.color }]}>{riskLevel} Risk</Text>
                </View>
              ) : null}
              {odds ? (
                <View style={[s.pill, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Text style={[s.pillText, { color: C.textSecondary }]}>@ {odds.toFixed(2)}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Right: chevron */}
          {hasExpandedContent ? (
            <Animated.View style={{ transform: [{ rotate: chevronRotate }], alignSelf: 'flex-start', marginTop: 4 }}>
              <Ionicons name="chevron-down" size={17} color={C.textMuted} />
            </Animated.View>
          ) : null}
        </Pressable>

        {/* ── EXPANDED BODY ──────────────────────────────────────────────── */}
        {expanded ? (
          <View style={[s.expandedBody, { borderTopColor: C.border }]}>

            {/* WHY WE LIKE IT */}
            {(reasoning || (keyFactors && keyFactors.length > 0)) ? (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionDot, { backgroundColor: '#22C55E' }]} />
                  <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Why We Like It</Text>
                </View>
                {reasoning ? (
                  <Text style={[s.reasoningText, { color: C.textSecondary }]}>{reasoning}</Text>
                ) : null}
                {keyFactors && keyFactors.length > 0 ? (
                  <View style={{ gap: 6, marginTop: reasoning ? 8 : 0 }}>
                    {keyFactors.slice(0, 4).map((f, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        <View style={[s.factorDot, { backgroundColor: accent }]} />
                        <Text style={[s.factorText, { color: C.textSecondary }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* HISTORICAL EVIDENCE */}
            {historicalEvidence && historicalEvidence.length > 0 ? (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionDot, { backgroundColor: '#4ECDC4' }]} />
                  <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Historical Evidence</Text>
                </View>
                {historicalEvidence.map((ev, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: 5 }}>
                    <Text style={{ fontSize: 11, color: '#4ECDC4', marginTop: 1 }}>•</Text>
                    <Text style={[s.evidenceText, { color: C.textSecondary }]}>{ev}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* TEAM / PLAYER METRICS */}
            {metrics && metrics.length > 0 ? (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionDot, { backgroundColor: '#A78BFA' }]} />
                  <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Supporting Metrics</Text>
                </View>
                <View style={[s.metricsBox, { backgroundColor: C.surface, borderColor: C.border }]}>
                  {metrics.map((m, i) => (
                    <MetricRow key={i} metric={m} C={C} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* CONFIDENCE + DATA QUALITY + ACCURACY */}
            {(modelConsensus !== undefined || dataQuality !== undefined || historicalAccuracy !== undefined) ? (
              <View style={[s.section, { gap: 10 }]}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionDot, { backgroundColor: C.primary }]} />
                  <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Model Intelligence</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {confidence !== undefined ? (
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 11, color: C.textMuted }}>AI Confidence</Text>
                        <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: confCfg?.color ?? C.primary }}>{confidence}%</Text>
                      </View>
                      <MiniBar value={confidence} color={confCfg?.color ?? C.primary} />
                    </View>
                  ) : null}
                  {modelConsensus !== undefined ? (
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 11, color: C.textMuted }}>Model Consensus</Text>
                        <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: '#38BDF8' }}>{modelConsensus}%</Text>
                      </View>
                      <MiniBar value={modelConsensus} color="#38BDF8" />
                    </View>
                  ) : null}
                  {dataQuality !== undefined ? (
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 11, color: C.textMuted }}>Data Quality Score</Text>
                        <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: '#F59E0B' }}>{dataQuality}/100</Text>
                      </View>
                      <MiniBar value={dataQuality} color="#F59E0B" />
                    </View>
                  ) : null}
                  {historicalAccuracy !== undefined ? (
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 11, color: C.textMuted }}>Historical Accuracy</Text>
                        <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: historicalAccuracy >= 65 ? '#22C55E' : '#EF4444' }}>{historicalAccuracy}%</Text>
                      </View>
                      <MiniBar value={historicalAccuracy} color={historicalAccuracy >= 65 ? '#22C55E' : '#EF4444'} />
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* WHY IT COULD FAIL */}
            {failureReasons && failureReasons.length > 0 ? (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionDot, { backgroundColor: '#EF4444' }]} />
                  <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Risk Factors</Text>
                </View>
                <View style={[s.failureBox, { backgroundColor: '#EF444408', borderColor: '#EF444422' }]}>
                  {failureReasons.map((reason, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: i < failureReasons.length - 1 ? 6 : 0 }}>
                      <Ionicons name="warning-outline" size={12} color="#EF4444" style={{ marginTop: 2 }} />
                      <Text style={[s.failureText, { color: '#EF4444' }]}>{reason}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* CUSTOM CHILDREN */}
            {children ? <View style={{ marginTop: 4 }}>{children}</View> : null}

            {/* Collapse hint */}
            <Pressable onPress={toggle} style={s.collapseHint} hitSlop={8}>
              <Text style={[s.collapseText, { color: C.textMuted }]}>Tap to collapse</Text>
              <Ionicons name="chevron-up" size={12} color={C.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 10,
  },
  accentBar: { width: 4, flexShrink: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 10,
  },
  sportEmoji: { fontSize: 16 },
  categoryBadge: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  categoryText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.7 },
  title: { fontSize: 14, fontWeight: FONTS.bold, lineHeight: 20 },
  subtitle: { fontSize: 11, lineHeight: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { fontSize: 10, fontWeight: FONTS.semiBold },
  expandedBody: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    gap: 14,
  },
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  sectionTitle: { fontSize: 12, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  reasoningText: { fontSize: 13, lineHeight: 21 },
  factorDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  factorText: { flex: 1, fontSize: 12, lineHeight: 19 },
  evidenceText: { flex: 1, fontSize: 12, lineHeight: 18 },
  metricsBox: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  failureBox: { borderRadius: RADIUS.md, borderWidth: 1, padding: 12 },
  failureText: { flex: 1, fontSize: 12, lineHeight: 18 },
  collapseHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 6, marginTop: 2 },
  collapseText: { fontSize: 10 },
});

// ─── Intelligence Summary Bar ─────────────────────────────────────────────────
export interface IntelSummaryItem {
  label: string;
  value: string;
  icon: string;
  color: string;
}

export function IntelSummaryBar({ items, C }: { items: IntelSummaryItem[]; C: AppColors }) {
  return (
    <View style={[ib.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? <View style={[ib.divider, { backgroundColor: C.border }]} /> : null}
          <View style={ib.cell}>
            <Ionicons name={item.icon as any} size={14} color={item.color} />
            <Text style={[ib.val, { color: item.color }]}>{item.value}</Text>
            <Text style={[ib.label, { color: C.textMuted }]}>{item.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const ib = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 14, marginBottom: 12 },
  cell: { flex: 1, alignItems: 'center', gap: 3 },
  val: { fontSize: 18, fontWeight: FONTS.extraBold, lineHeight: 22 },
  label: { fontSize: 9, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { width: 1, marginVertical: 6 },
});
