/**
 * components/feature/SportAIPicks.tsx
 *
 * Full AI Picks display for a match — renders:
 *   1. TOP 3 AI RECOMMENDATIONS (highlighted medal cards)
 *   2. ADDITIONAL PICKS (compact card grid)
 *   3. ALL PREDICTION MARKETS (full market list)
 *
 * Every pick shows: market label · outcome · confidence % ·
 * probability % · risk badge · 2-4 bullet reasons.
 *
 * Sport-aware: never shows football-only markets for other sports.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { FONTS, RADIUS } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import {
  generateAISportPicks,
  type AIPredictionOutcome,
  type PredictionInput,
  type MatchContext,
} from '@/services/aiPicksEngine';
import { getSportTerms } from '@/services/sportConfig';

interface Props {
  prediction: PredictionInput;
  match: MatchContext;
  C: AppColors;
}

const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const MEDAL_LABELS = ['#1 TOP PICK', '#2 VALUE PICK', '#3 SOLID PICK'];
const MEDAL_ICONS  = ['trophy', 'star', 'award'] as const;

const RISK_COLORS: Record<string, string> = {
  Low:    '#22C55E',
  Medium: '#F59E0B',
  High:   '#EF4444',
};

const RISK_ICONS: Record<string, 'shield-checkmark' | 'warning' | 'flame'> = {
  Low:    'shield-checkmark',
  Medium: 'warning',
  High:   'flame',
};

// ─── Confidence ring ──────────────────────────────────────────────────────────
function ConfRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const confColor = pct >= 78 ? '#22C55E' : pct >= 62 ? '#F59E0B' : '#EF4444';
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      borderWidth: 2.5, borderColor: confColor,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: `${confColor}12`,
    }}>
      <Text style={{ fontSize: size * 0.3, fontWeight: FONTS.extraBold as any, color: confColor, lineHeight: size * 0.35 }}>
        {pct}%
      </Text>
      <Text style={{ fontSize: size * 0.18, color: confColor, opacity: 0.8, lineHeight: size * 0.22 }}>
        CONF
      </Text>
    </View>
  );
}

// ─── Risk badge ───────────────────────────────────────────────────────────────
function RiskBadge({ risk, compact = false }: { risk: 'Low' | 'Medium' | 'High'; compact?: boolean }) {
  const color = RISK_COLORS[risk] ?? '#9CA3AF';
  const icon  = RISK_ICONS[risk] ?? 'warning';
  return (
    <View style={[
      s.riskBadge,
      { backgroundColor: `${color}14`, borderColor: `${color}33` },
    ]}>
      <Ionicons name={icon} size={compact ? 9 : 10} color={color} />
      <Text style={[s.riskText, { color, fontSize: compact ? 8 : 9 }]}>
        {risk.toUpperCase()} RISK
      </Text>
    </View>
  );
}

// ─── Top-3 Medal Card ─────────────────────────────────────────────────────────
function MedalCard({
  pick, rank, C,
}: { pick: AIPredictionOutcome; rank: number; C: AppColors }) {
  const [expanded, setExpanded] = useState(rank === 0);
  const medalColor = MEDAL_COLORS[rank] ?? '#C0C0C0';
  const medalLabel = MEDAL_LABELS[rank] ?? `#${rank + 1} PICK`;

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={({ pressed }) => [
        s.medalCard,
        {
          backgroundColor: C.card,
          borderColor: `${medalColor}55`,
          borderLeftColor: medalColor,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {/* Medal banner */}
      <View style={[s.medalBanner, { backgroundColor: `${medalColor}14` }]}>
        <View style={s.medalLeft}>
          <Text style={{ fontSize: 16 }}>{pick.emoji}</Text>
          <Text style={[s.medalLabel, { color: medalColor }]}>{medalLabel}</Text>
        </View>
        <RiskBadge risk={pick.risk} />
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14} color={C.textMuted}
        />
      </View>

      {/* Market + Outcome + Confidence */}
      <View style={s.medalBody}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[s.marketLabel, { color: C.textMuted }]}>
            {pick.marketLabel}
            {pick.sublabel ? (
              <Text style={{ fontSize: 9, color: C.textMuted }}> {pick.sublabel}</Text>
            ) : null}
          </Text>
          <Text style={[s.outcomeText, { color: pick.color }]} numberOfLines={2}>
            {pick.outcome}
          </Text>
          <View style={s.probRow}>
            <View style={[s.probPill, { backgroundColor: `${pick.color}14`, borderColor: `${pick.color}33` }]}>
              <Text style={[s.probText, { color: pick.color }]}>
                {pick.probability}% probability
              </Text>
            </View>
          </View>
        </View>
        <ConfRing pct={pick.confidence} color={pick.color} size={58} />
      </View>

      {/* Expandable reasons */}
      {expanded ? (
        <View style={[s.reasonsBox, { borderTopColor: C.border }]}>
          <View style={s.reasonsHeader}>
            <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
            <Text style={[s.reasonsTitle, { color: C.textMuted }]}>WHY THIS PICK?</Text>
          </View>
          {pick.reasons.map((reason, i) => (
            <View key={i} style={s.reasonRow}>
              <View style={[s.reasonDot, { backgroundColor: pick.color }]} />
              <Text style={[s.reasonText, { color: C.textSecondary }]}>{reason}</Text>
            </View>
          ))}
          <View style={[s.updatedRow, { borderTopColor: C.border }]}>
            <Ionicons name="time-outline" size={10} color={C.textMuted} />
            <Text style={[s.updatedText, { color: C.textMuted }]}>
              Updated {new Date(pick.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Additional Picks Compact Card ────────────────────────────────────────────
function CompactPickCard({ pick, C }: { pick: AIPredictionOutcome; C: AppColors }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={({ pressed }) => [
        s.compactCard,
        { backgroundColor: C.surface, borderColor: C.border, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      <View style={s.compactTop}>
        <Text style={{ fontSize: 16 }}>{pick.emoji}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.compactMarket, { color: C.textMuted }]} numberOfLines={1}>{pick.marketLabel}</Text>
          <Text style={[s.compactOutcome, { color: pick.color }]} numberOfLines={1}>{pick.outcome}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[s.compactConf, { color: pick.confidence >= 78 ? '#22C55E' : pick.confidence >= 62 ? '#F59E0B' : '#EF4444' }]}>
            {pick.confidence}%
          </Text>
          <RiskBadge risk={pick.risk} compact />
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.textMuted} />
      </View>

      {expanded ? (
        <View style={[s.compactExpanded, { borderTopColor: C.border }]}>
          {/* Probability bar */}
          <View style={s.probBarRow}>
            <Text style={[s.probBarLabel, { color: C.textMuted }]}>Probability</Text>
            <View style={[s.probBarTrack, { backgroundColor: C.card }]}>
              <View style={[s.probBarFill, { width: `${pick.probability}%`, backgroundColor: pick.color }]} />
            </View>
            <Text style={[s.probBarValue, { color: pick.color }]}>{pick.probability}%</Text>
          </View>
          {/* Reasons */}
          {pick.reasons.map((r, i) => (
            <View key={i} style={s.reasonRow}>
              <View style={[s.reasonDot, { backgroundColor: pick.color }]} />
              <Text style={[s.reasonText, { color: C.textSecondary, fontSize: 11 }]}>{r}</Text>
            </View>
          ))}
          <View style={[s.updatedRow, { borderTopColor: C.border }]}>
            <Ionicons name="time-outline" size={10} color={C.textMuted} />
            <Text style={[s.updatedText, { color: C.textMuted }]}>
              Updated {new Date(pick.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Market Group Grid ────────────────────────────────────────────────────────
function AllMarketsGrid({ picks, C }: { picks: AIPredictionOutcome[]; C: AppColors }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? picks : picks.slice(0, 6);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.gridRow}>
        {visible.map((pick) => (
          <View
            key={pick.id}
            style={[s.gridCell, { backgroundColor: `${pick.color}12`, borderColor: `${pick.color}30` }]}
          >
            <Text style={{ fontSize: 15, marginBottom: 3 }}>{pick.emoji}</Text>
            <Text style={[s.gridMarket, { color: C.textMuted }]} numberOfLines={2}>{pick.marketLabel}</Text>
            <Text style={[s.gridOutcome, { color: pick.color }]} numberOfLines={2}>{pick.outcome}</Text>
            <Text style={[s.gridConf, { color: pick.color }]}>{pick.confidence}%</Text>
          </View>
        ))}
      </View>
      {picks.length > 6 ? (
        <Pressable
          style={({ pressed }) => [s.showMoreBtn, { backgroundColor: C.surface, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
          onPress={() => setExpanded((v) => !v)}
        >
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
          <Text style={[s.showMoreText, { color: C.primary }]}>
            {expanded ? 'Show less' : `Show all ${picks.length} markets`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function SportAIPicks({ prediction, match, C }: Props) {
  const picks = useMemo(
    () => generateAISportPicks(prediction, match),
    [
      match.homeTeam, match.awayTeam, match.sport,
      prediction.predictedResult, prediction.confidence,
      prediction.overUnder, prediction.btts, prediction.correctScore,
    ],
  );

  const terms = getSportTerms(match.sport);
  const hasTop3 = picks.top3.length > 0;

  if (!hasTop3) {
    return (
      <View style={[s.emptyState, { backgroundColor: C.card, borderColor: C.border }]}>
        <FontAwesome5 name="brain" size={28} color={C.textMuted} />
        <Text style={[s.emptyTitle, { color: C.textMuted }]}>No picks generated yet</Text>
        <Text style={[s.emptySub, { color: C.textMuted }]}>
          Generate a prediction first to see AI-ranked picks for this match.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>

      {/* ── Section 1: TOP 3 AI PICKS ──────────────────────────────────────── */}
      <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: `${C.primary}33` }]}>
        {/* Header */}
        <View style={[s.sectionHeader, { backgroundColor: `${C.primary}10` }]}>
          <View style={[s.sectionIconWrap, { backgroundColor: `${C.primary}22`, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="trophy" size={12} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { color: C.primary }]}>TOP 3 AI PICKS</Text>
            <Text style={[s.sectionSubtitle, { color: C.textMuted }]}>
              Ranked by confidence · probability · historical accuracy
            </Text>
          </View>
          <View style={[s.sportPill, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
            <Text style={{ fontSize: 13 }}>{terms.sportEmoji}</Text>
            <Text style={[s.sportPillText, { color: C.primary }]}>
              {match.sport.charAt(0).toUpperCase() + match.sport.slice(1)}
            </Text>
          </View>
        </View>

        {/* Medal cards */}
        <View style={s.medalList}>
          {picks.top3.map((pick, i) => (
            <MedalCard key={pick.id} pick={pick} rank={i} C={C} />
          ))}
        </View>

        {/* Disclaimer */}
        <View style={[s.disclaimer, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="information-circle-outline" size={11} color={C.textMuted} />
          <Text style={[s.disclaimerText, { color: C.textMuted }]}>
            Predictions are informational only and do not guarantee outcomes. Top 3 selected by AI composite score.
          </Text>
        </View>
      </View>

      {/* ── Section 2: ADDITIONAL PICKS ───────────────────────────────────── */}
      {picks.additional.length > 0 ? (
        <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[s.sectionHeader, { backgroundColor: C.surface }]}>
            <View style={[s.sectionIconWrap, { backgroundColor: `${C.accentBlue ?? '#38BDF8'}22`, borderColor: `${C.accentBlue ?? '#38BDF8'}44` }]}>
              <Ionicons name="layers-outline" size={13} color={C.accentBlue ?? '#38BDF8'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionTitle, { color: C.textPrimary }]}>ADDITIONAL PICKS</Text>
              <Text style={[s.sectionSubtitle, { color: C.textMuted }]}>
                {picks.additional.length} more markets · tap to expand
              </Text>
            </View>
          </View>
          <View style={s.medalList}>
            {picks.additional.map((pick) => (
              <CompactPickCard key={pick.id} pick={pick} C={C} />
            ))}
          </View>
        </View>
      ) : null}

      {/* ── Section 3: ALL PREDICTION MARKETS (grid) ──────────────────────── */}
      <View style={[s.sectionCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={[s.sectionHeader, { backgroundColor: C.surface }]}>
          <View style={[s.sectionIconWrap, { backgroundColor: `${C.accentRed ?? '#EF4444'}22`, borderColor: `${C.accentRed ?? '#EF4444'}44` }]}>
            <Ionicons name="grid-outline" size={13} color={C.accentRed ?? '#EF4444'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { color: C.textPrimary }]}>ALL PREDICTION MARKETS</Text>
            <Text style={[s.sectionSubtitle, { color: C.textMuted }]}>
              {picks.all.length} {terms.predictionTitle.toLowerCase()} outcomes generated
            </Text>
          </View>
        </View>
        <View style={{ padding: 12 }}>
          <AllMarketsGrid picks={picks.all} C={C} />
        </View>
      </View>

      {/* ── Summary Stats ─────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          { label: 'Total Markets', value: String(picks.all.length), icon: 'layers-outline' as const, color: C.primary },
          { label: 'Avg Confidence', value: `${Math.round(picks.all.reduce((s, p) => s + p.confidence, 0) / Math.max(1, picks.all.length))}%`, icon: 'analytics-outline' as const, color: '#22C55E' },
          { label: 'Low Risk Picks', value: String(picks.all.filter((p) => p.risk === 'Low').length), icon: 'shield-checkmark-outline' as const, color: '#38BDF8' },
        ].map((stat) => (
          <View key={stat.label} style={[s.statChip, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name={stat.icon} size={12} color={stat.color} />
            <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={[s.statLabel, { color: C.textMuted }]}>{stat.label}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  // Section cards
  sectionCard: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingBottom: 12 },
  sectionIconWrap: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  sectionSubtitle: { fontSize: 10, marginTop: 1 },
  sportPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  sportPillText: { fontSize: 10, fontWeight: FONTS.semiBold },

  // Medal cards
  medalList: { gap: 8, padding: 12, paddingTop: 4 },
  medalCard: { borderRadius: RADIUS.lg, borderWidth: 1, borderLeftWidth: 3, overflow: 'hidden' },
  medalBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  medalLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  medalLabel: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  medalBody: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  marketLabel: { fontSize: 10, fontWeight: FONTS.semiBold, letterSpacing: 0.4 },
  outcomeText: { fontSize: 18, fontWeight: FONTS.extraBold, lineHeight: 22 },
  probRow: { flexDirection: 'row', marginTop: 4 },
  probPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  probText: { fontSize: 10, fontWeight: FONTS.semiBold },

  // Reasons
  reasonsBox: { paddingHorizontal: 14, paddingVertical: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  reasonsHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reasonsTitle: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reasonDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  reasonText: { fontSize: 12, lineHeight: 18, flex: 1 },
  updatedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  updatedText: { fontSize: 9 },

  // Risk badge
  riskBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  riskText: { fontWeight: FONTS.extraBold, letterSpacing: 0.4 },

  // Compact card
  compactCard: { borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactMarket: { fontSize: 9, fontWeight: FONTS.semiBold, letterSpacing: 0.4 },
  compactOutcome: { fontSize: 13, fontWeight: FONTS.bold },
  compactConf: { fontSize: 15, fontWeight: FONTS.extraBold },
  compactExpanded: { paddingTop: 10, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  probBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  probBarLabel: { fontSize: 9, fontWeight: FONTS.semiBold, width: 60 },
  probBarTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  probBarFill: { height: '100%', borderRadius: 4 },
  probBarValue: { fontSize: 11, fontWeight: FONTS.bold, width: 36, textAlign: 'right' },

  // Market grid
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, alignItems: 'center', minWidth: '30%', flex: 1 },
  gridMarket: { fontSize: 8, fontWeight: FONTS.semiBold, textAlign: 'center', letterSpacing: 0.3, marginBottom: 3 },
  gridOutcome: { fontSize: 12, fontWeight: FONTS.extraBold, textAlign: 'center', marginBottom: 3 },
  gridConf: { fontSize: 11, fontWeight: FONTS.bold },
  showMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 8 },
  showMoreText: { fontSize: 12, fontWeight: FONTS.semiBold },

  // Summary stats
  statChip: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 9, fontWeight: FONTS.semiBold, textAlign: 'center' },

  // Disclaimer
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, margin: 12, marginTop: 0 },
  disclaimerText: { fontSize: 9, flex: 1, lineHeight: 14 },

  // Empty state
  emptyState: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 36, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.bold },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
