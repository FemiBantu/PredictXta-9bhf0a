/**
 * MultiModelConsensusPanel.tsx
 *
 * Displays the 4-model consensus breakdown in the AI Pick report tab.
 * Shows per-model vote, agreement count, hallucination score, and DQ.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import {
  generateMultiModelPrediction,
  getConsensusBadge,
  getHallucinationBadge,
  type MultiModelConsensus,
} from '@/services/multiModelPredictionService';
import type { Prediction } from '@/services/types';

// ─── Color tokens (match ai-pick/[id].tsx) ───────────────────────────────────
const OV_HOME = '#38BDF8';
const OV_AWAY = '#A78BFA';

const MODEL_LABELS: Record<string, string> = {
  gpt41: 'GPT-4.1', gpt4mini: 'GPT-4o Mini', gemini: 'Gemini 2.0', llama: 'Llama 3.1', claude: 'Claude 3.5',
};
const MODEL_ICONS: Record<string, string> = {
  gpt41: '🧠', gpt4mini: '⚡', gemini: '💎', llama: '🦙', claude: '🤖',
};

interface Props {
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  status: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  userId?: string;
  initialConsensus?: MultiModelConsensus | null;
  onPredictionUpdate?: (pred: Prediction) => void;
  C: AppColors;
}

export function MultiModelConsensusPanel({
  matchId, sport, homeTeam, awayTeam, league, status, homeScore, awayScore, minute,
  userId, initialConsensus, onPredictionUpdate, C,
}: Props) {
  const [consensus, setConsensus] = useState<MultiModelConsensus | null>(initialConsensus ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    const result = await generateMultiModelPrediction(
      {
        id: matchId, sport, homeTeam, awayTeam, league,
        homeScore, awayScore, status, minute, stats: null,
      } as any,
      { userId, bypassCache: true },
    );
    setRunning(false);
    if (result.consensus) {
      setConsensus(result.consensus);
      if (result.prediction && onPredictionUpdate) onPredictionUpdate(result.prediction);
    } else {
      setError(result.error ?? 'Analysis failed. Please check API key configuration.');
    }
  };

  return (
    <View style={[p.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={p.header}>
        <Ionicons name="git-network-outline" size={13} color={C.accentBlue ?? C.primary} />
        <Text style={[p.title, { color: C.textPrimary }]}>5-MODEL CONSENSUS</Text>
        {consensus ? (() => {
          const badge = getConsensusBadge(consensus);
          return (
            <View style={[p.badge, { backgroundColor: `${badge.color}14`, borderColor: `${badge.color}33` }]}>
              <Ionicons name={badge.icon as any} size={9} color={badge.color} />
              <Text style={[p.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          );
        })() : null}
      </View>

      {consensus ? (
        <View style={{ gap: 12 }}>
          {/* Per-model breakdown */}
          <View style={p.grid}>
            {consensus.breakdown.map((m) => {
              const failed = m.result === 'failed';
              const rc = failed ? C.textMuted
                : m.result === 'home_win' ? OV_HOME
                : m.result === 'away_win' ? OV_AWAY : '#F59E0B';
              return (
                <View key={m.id} style={[p.modelCell, { backgroundColor: failed ? C.surface : `${rc}10`, borderColor: failed ? C.border : `${rc}33` }]}>
                  <View style={p.modelCellHeader}>
                    <Text style={{ fontSize: 12 }}>{MODEL_ICONS[m.id] ?? '🤖'}</Text>
                    <Text style={[p.modelLabel, { color: C.textPrimary }]} numberOfLines={1}>
                      {MODEL_LABELS[m.id] ?? m.id}
                    </Text>
                    <Ionicons name={failed ? 'close-circle' : 'checkmark-circle'} size={13} color={failed ? C.textMuted : rc} />
                  </View>
                  <Text style={[p.modelResult, { color: failed ? C.textMuted : rc }]}>
                    {failed ? 'Timeout' : m.result === 'home_win' ? '1 Home' : m.result === 'away_win' ? '2 Away' : 'X Draw'}
                  </Text>
                  {!failed ? (
                    <Text style={[p.modelMeta, { color: C.textMuted }]}>
                      {m.confidence}% · {m.latencyMs}ms
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Aggregate metrics */}
          <View style={p.metrics}>
            <View style={[p.metric, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[p.metricVal, { color: consensus.modelsAgreed >= 3 ? '#22C55E' : '#F59E0B' }]}>
                {consensus.modelsAgreed}/{consensus.modelsUsed}
              </Text>
              <Text style={[p.metricLabel, { color: C.textMuted }]}>AGREE</Text>
            </View>
            {(() => {
              const hb = getHallucinationBadge(consensus.hallucinationScore);
              return (
                <View style={[p.metric, { backgroundColor: `${hb.color}10`, borderColor: `${hb.color}33` }]}>
                  <Text style={[p.metricVal, { color: hb.color }]}>{consensus.hallucinationScore}</Text>
                  <Text style={[p.metricLabel, { color: hb.color }]}>HALLUC.</Text>
                </View>
              );
            })()}
            <View style={[p.metric, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[p.metricVal, { color: C.textSecondary }]}>{consensus.dqScore}</Text>
              <Text style={[p.metricLabel, { color: C.textMuted }]}>DQ SCORE</Text>
            </View>
          </View>

          {/* Footer */}
          <View style={[p.footer, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Ionicons name="time-outline" size={12} color={C.textMuted} />
            <Text style={[p.footerText, { color: C.textMuted }]}>
              {(consensus.latencyMs / 1000).toFixed(1)}s · {consensus.modelsUsed} providers
            </Text>
            <View style={[p.consPill, consensus.consensusPassed
              ? { backgroundColor: '#22C55E14', borderColor: '#22C55E33' }
              : { backgroundColor: '#F59E0B14', borderColor: '#F59E0B33' }]}>
              <Text style={[p.consPillText, { color: consensus.consensusPassed ? '#22C55E' : '#F59E0B' }]}>
                {consensus.consensusPassed ? 'CONSENSUS' : 'REVIEW'}
              </Text>
            </View>
          </View>

          {/* Re-run */}
          <Pressable
            style={({ pressed }) => [p.rerunBtn, { borderColor: C.border, backgroundColor: C.surface }, pressed ? { opacity: 0.75 } : null]}
            onPress={runAnalysis}
            disabled={running}>
            <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
            <Text style={[p.rerunText, { color: C.textMuted }]}>Re-run Analysis</Text>
          </Pressable>
        </View>
      ) : running ? (
        <View style={p.runningWrap}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[p.runningTitle, { color: C.textPrimary }]}>Running 4-model analysis...</Text>
          <View style={p.modelChips}>
            {[['🧠','GPT-4.1'],['⚡','GPT-4o Mini'],['💎','Gemini 2.0'],['🦙','Llama 3.1'],['🤖','Claude 3.5']].map(([icon, label]) => (
              <View key={label} style={[p.modelChip, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
                <Text style={{ fontSize: 12 }}>{icon}</Text>
                <Text style={[p.modelChipText, { color: C.primary }]}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={[p.desc, { color: C.textMuted }]}>
            Fan out to GPT-4.1, GPT-4o Mini, Gemini 2.0 Flash, Llama 3.1 70B, and Claude 3.5 Haiku simultaneously.
            Outputs are aggregated via weighted consensus voting with hallucination detection.
            Weights auto-adjust daily from model performance logs.
          </Text>
          {error ? (
            <View style={[p.errorRow, { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}33` }]}>
              <Ionicons name="warning-outline" size={13} color={C.accentRed} />
              <Text style={[p.errorText, { color: C.accentRed }]}>{error}</Text>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [p.runBtn, { backgroundColor: C.primary }, pressed ? { opacity: 0.88 } : null]}
            onPress={runAnalysis}>
            <Ionicons name="git-network-outline" size={16} color={C.textInverse} />
            <Text style={[p.runBtnText, { color: C.textInverse }]}>Run 5-Model Analysis</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const p = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.9, flex: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 9, fontWeight: FONTS.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modelCell: { flex: 1, minWidth: '45%', borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, gap: 3 },
  modelCellHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modelLabel: { fontSize: 11, fontWeight: FONTS.bold, flex: 1 },
  modelResult: { fontSize: 14, fontWeight: FONTS.extraBold },
  modelMeta: { fontSize: 9 },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 10, alignItems: 'center', gap: 2 },
  metricVal: { fontSize: 22, fontWeight: FONTS.extraBold },
  metricLabel: { fontSize: 8, fontWeight: FONTS.bold, letterSpacing: 0.5 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.md, padding: 9, borderWidth: 1 },
  footerText: { fontSize: 11, flex: 1 },
  consPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  consPillText: { fontSize: 9, fontWeight: FONTS.bold },
  rerunBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 10 },
  rerunText: { fontSize: 12, fontWeight: FONTS.semiBold },
  runningWrap: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  runningTitle: { fontSize: 14, fontWeight: FONTS.bold },
  modelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  modelChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  modelChipText: { fontSize: 11, fontWeight: FONTS.semiBold },
  desc: { fontSize: 13, lineHeight: 19 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { fontSize: 12, flex: 1 },
  runBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14 },
  runBtnText: { fontSize: 14, fontWeight: FONTS.bold },
});
