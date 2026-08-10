/**
 * components/feature/AIReportConsensus.tsx
 *
 * AI Report — Comprehensive prediction intelligence dashboard.
 * Shows: AI Pick, Expert Pick, Consensus Engine, Community Voting, Confidence Meters.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, Animated,
} from 'react-native';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/template';
import { useRouter } from 'expo-router';
import type { AIPredictionOutcome } from '@/services/aiPicksEngine';
import { generateAISportPicks } from '@/services/aiPicksEngine';
import type { PredictionInput, MatchContext } from '@/services/aiPicksEngine';
import {
  fetchVoteCounts, castVote, fetchExpertPredictions, computeConsensus,
} from '@/services/predictionVoteService';
import type { VoteCount, ExpertPrediction, ConsensusResult } from '@/services/predictionVoteService';
import { getSportFamily } from '@/services/sportConfig';

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const OV_HOME = '#38BDF8';
const OV_AWAY = '#A78BFA';
const AGREE_COLOR: Record<string, string> = {
  YES: '#22C55E',
  PARTIAL: '#F59E0B',
  NO: '#EF4444',
};
const CONF_COLOR = (pct: number) =>
  pct >= 81 ? '#22C55E' : pct >= 61 ? '#3B82F6' : pct >= 41 ? '#F59E0B' : '#EF4444';
const CONF_LABEL = (pct: number) =>
  pct >= 81 ? 'Elite' : pct >= 61 ? 'High' : pct >= 41 ? 'Moderate' : 'Low';
const RISK_COLOR: Record<string, string> = {
  Low: '#22C55E', Medium: '#F59E0B', High: '#EF4444',
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  matchId: string;
  prediction: PredictionInput;
  matchCtx: MatchContext;
  sport: string;
}

// ─── Animated counter ─────────────────────────────────────────────────────────
function AnimCounter({ value, color, style }: { value: number; color: string; style?: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: value, duration: 600, useNativeDriver: false }).start();
  }, [value]);
  return (
    <Animated.Text style={[style, { color }]}>
      {anim.interpolate({ inputRange: [0, Math.max(1, value)], outputRange: ['0', String(value)] })}
    </Animated.Text>
  );
}

// ─── Confidence Meter ─────────────────────────────────────────────────────────
function ConfidenceMeter({ label, pct, color, C }: { label: string; pct: number; color: string; C: AppColors }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 800, useNativeDriver: false }).start();
  }, [pct]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, backgroundColor: `${color}0A`, borderColor: `${color}33` }}>
      <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: C.textMuted, letterSpacing: 0.7 }}>{label}</Text>
      <Text style={{ fontSize: 28, fontWeight: FONTS.extraBold, color }}>{pct}%</Text>
      <View style={{ width: '100%', height: 5, borderRadius: 3, backgroundColor: `${color}22`, overflow: 'hidden' }}>
        <Animated.View style={{ width, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color }}>
        {CONF_LABEL(pct)}
      </Text>
    </View>
  );
}

// ─── Vote Button ──────────────────────────────────────────────────────────────
function VoteButton({
  type, count, active, loading, onPress, C,
}: {
  type: 'like' | 'dislike';
  count: number;
  active: boolean;
  loading: boolean;
  onPress: () => void;
  C: AppColors;
}) {
  const isLike = type === 'like';
  const activeColor = isLike ? '#22C55E' : '#EF4444';
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        disabled={loading}
        style={({ pressed }) => [
          s.voteBtn,
          {
            backgroundColor: active ? `${activeColor}18` : C.surface,
            borderColor: active ? `${activeColor}66` : C.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={activeColor} />
        ) : (
          <Text style={{ fontSize: 18 }}>{isLike ? '👍' : '👎'}</Text>
        )}
        <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: active ? activeColor : C.textMuted }}>
          {count.toLocaleString()}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Prediction Vote Card ────────────────────────────────────────────────────
function PredVoteCard({
  pick, voteData, matchId, onVote, C,
}: {
  pick: AIPredictionOutcome;
  voteData: VoteCount;
  matchId: string;
  onVote: (predictionId: string, voteType: 'like' | 'dislike') => Promise<void>;
  C: AppColors;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [votingId, setVotingId] = useState<string | null>(null);

  const total = voteData.likes + voteData.dislikes;
  const likeRate = total > 0 ? Math.round((voteData.likes / total) * 100) : 0;
  const dislikeRate = 100 - likeRate;

  const communityConf = likeRate >= 70 ? 'High' : likeRate >= 50 ? 'Medium' : 'Low';
  const communityColor = likeRate >= 70 ? '#22C55E' : likeRate >= 50 ? '#F59E0B' : '#EF4444';

  const handleVote = async (vType: 'like' | 'dislike') => {
    if (!user) {
      router.push('/login' as any);
      return;
    }
    setVotingId(vType);
    await onVote(pick.id, vType);
    setVotingId(null);
  };

  return (
    <View style={[s.voteCard, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={s.voteCardHeader}>
        <View style={[s.marketBadge, { backgroundColor: `${pick.color}18`, borderColor: `${pick.color}33` }]}>
          <Text style={{ fontSize: 14 }}>{pick.emoji}</Text>
          <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: pick.color, letterSpacing: 0.5 }}>
            {pick.marketLabel}
          </Text>
        </View>
        <View style={[s.riskPill, { backgroundColor: `${RISK_COLOR[pick.risk]}18`, borderColor: `${RISK_COLOR[pick.risk]}44` }]}>
          <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: RISK_COLOR[pick.risk] }}>{pick.risk} Risk</Text>
        </View>
      </View>

      {/* Outcome */}
      <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold, color: pick.color, marginVertical: 6 }}>
        {pick.outcome}
      </Text>

      {/* Confidence + Probability row */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        {[
          { label: 'Confidence', val: pick.confidence, color: CONF_COLOR(pick.confidence) },
          { label: 'Probability', val: pick.probability, color: OV_HOME },
        ].map((m) => (
          <View key={m.label} style={{ flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 8, alignItems: 'center', gap: 2, backgroundColor: `${m.color}0A`, borderColor: `${m.color}22` }}>
            <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.semiBold }}>{m.label}</Text>
            <Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: m.color }}>{m.val}%</Text>
          </View>
        ))}
      </View>

      {/* Reasons */}
      <View style={{ gap: 5, marginBottom: 12 }}>
        {pick.reasons.slice(0, 3).map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: pick.color, marginTop: 7, flexShrink: 0 }} />
            <Text style={{ fontSize: 12, color: C.textSecondary, flex: 1, lineHeight: 18 }}>{r}</Text>
          </View>
        ))}
      </View>

      {/* Vote section */}
      <View style={[s.voteSection, { borderTopColor: C.border }]}>
        <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textMuted, marginBottom: 8 }}>
          COMMUNITY SENTIMENT
        </Text>

        {/* Bars */}
        {total > 0 ? (
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: '#22C55E' }}>{likeRate}% Support</Text>
              <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: '#EF4444' }}>{dislikeRate}% Oppose</Text>
            </View>
            <View style={{ height: 6, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: C.surface }}>
              <View style={{ flex: likeRate, backgroundColor: '#22C55E', borderRadius: 4 }} />
              <View style={{ width: 2, backgroundColor: C.bg }} />
              <View style={{ flex: dislikeRate || 1, backgroundColor: '#EF4444', borderRadius: 4 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
              <View style={[s.commConfPill, { backgroundColor: `${communityColor}18`, borderColor: `${communityColor}44` }]}>
                <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: communityColor }}>Community Confidence: {communityConf}</Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, textAlign: 'center' }}>
            Be the first to vote on this prediction
          </Text>
        )}

        {/* Vote buttons */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <VoteButton
            type="like"
            count={voteData.likes}
            active={voteData.userVote === 'like'}
            loading={votingId === 'like'}
            onPress={() => handleVote('like')}
            C={C}
          />
          <VoteButton
            type="dislike"
            count={voteData.dislikes}
            active={voteData.userVote === 'dislike'}
            loading={votingId === 'dislike'}
            onPress={() => handleVote('dislike')}
            C={C}
          />
        </View>
        {!user ? (
          <Text style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 6 }}>
            Login to vote on this prediction
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Expert vs AI Comparison Card ────────────────────────────────────────────
function ExpertAICompareCard({
  aiPick, expertPick, consensus, C,
}: {
  aiPick: AIPredictionOutcome;
  expertPick: ExpertPrediction;
  consensus: ConsensusResult;
  C: AppColors;
}) {
  const agreeColor = AGREE_COLOR[consensus.agreementLabel] ?? '#F59E0B';
  const consensusScore = consensus.agreementScore;

  return (
    <View style={[s.compareCard, { backgroundColor: C.card, borderColor: `${agreeColor}44` }]}>
      {/* Consensus header */}
      <LinearGradient
        colors={[`${agreeColor}18`, 'transparent']}
        style={s.compareHeader}
      >
        <View style={s.compareHeaderLeft}>
          <MaterialIcons name="compare-arrows" size={16} color={agreeColor} />
          <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold, color: agreeColor }}>
            AI vs EXPERT CONSENSUS
          </Text>
        </View>
        <View style={[s.agreePill, { backgroundColor: `${agreeColor}22`, borderColor: `${agreeColor}55` }]}>
          <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold, color: agreeColor }}>
            {consensus.agreementLabel}
          </Text>
        </View>
      </LinearGradient>

      {/* Side by side */}
      <View style={s.compareRow}>
        {/* AI Side */}
        <View style={[s.compareSide, { backgroundColor: `${C.primary}0A`, borderColor: `${C.primary}33` }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <FontAwesome5 name="brain" size={11} color={C.primary} />
            <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: C.primary, letterSpacing: 0.6 }}>AI PICK</Text>
          </View>
          <Text style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>Prediction:</Text>
          <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.textPrimary, marginBottom: 8 }} numberOfLines={2}>
            {aiPick.outcome}
          </Text>
          <View style={s.compareMetaRow}>
            <View style={[s.metaPill, { backgroundColor: `${CONF_COLOR(aiPick.confidence)}18`, borderColor: `${CONF_COLOR(aiPick.confidence)}33` }]}>
              <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: CONF_COLOR(aiPick.confidence) }}>
                {aiPick.confidence}% Conf.
              </Text>
            </View>
            <View style={[s.metaPill, { backgroundColor: `${RISK_COLOR[aiPick.risk]}18`, borderColor: `${RISK_COLOR[aiPick.risk]}33` }]}>
              <Text style={{ fontSize: 10, fontWeight: FONTS.bold, color: RISK_COLOR[aiPick.risk] }}>
                {aiPick.risk}
              </Text>
            </View>
          </View>
        </View>

        {/* Divider with agreement icon */}
        <View style={{ alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 4 }}>
          <View style={[s.agreeDot, { backgroundColor: agreeColor }]} />
          <View style={{ width: 1, flex: 1, backgroundColor: C.border }} />
          <View style={[s.agreeDot, { backgroundColor: agreeColor }]} />
        </View>

        {/* Expert Side */}
        <View style={[s.compareSide, { backgroundColor: '#F59E0B0A', borderColor: '#F59E0B33' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <Ionicons name="people" size={11} color="#F59E0B" />
            <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: '#F59E0B', letterSpacing: 0.6 }}>EXPERT PICK</Text>
          </View>
          <Text style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>Prediction:</Text>
          <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: C.textPrimary, marginBottom: 8 }} numberOfLines={2}>
            {expertPick.prediction}
          </Text>
          <View style={s.compareMetaRow}>
            <View style={[s.metaPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B33' }]}>
              <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: '#F59E0B' }}>
                {expertPick.expertsSupporting}/{expertPick.totalExperts}
              </Text>
            </View>
            <View style={[s.metaPill, { backgroundColor: '#22C55E18', borderColor: '#22C55E33' }]}>
              <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: '#22C55E' }}>
                {Math.round((expertPick.expertsSupporting / Math.max(1, expertPick.totalExperts)) * 100)}%
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Consensus score bar */}
      <View style={{ marginTop: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textMuted }}>Consensus Strength</Text>
          <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold, color: agreeColor }}>
            {consensus.consensusRating} · {consensusScore}%
          </Text>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: C.surface, overflow: 'hidden' }}>
          <View style={{ width: `${consensusScore}%`, height: '100%', backgroundColor: agreeColor, borderRadius: 4 }} />
        </View>
        {consensus.agreementLabel === 'NO' ? (
          <View style={[s.warningRow, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
            <Ionicons name="warning-outline" size={13} color="#EF4444" />
            <Text style={{ fontSize: 11, color: '#EF4444', flex: 1 }}>
              Experts and AI disagree. Proceed with caution.
            </Text>
          </View>
        ) : consensus.agreementLabel === 'PARTIAL' ? (
          <View style={[s.warningRow, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B33' }]}>
            <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
            <Text style={{ fontSize: 11, color: '#F59E0B', flex: 1 }}>
              Partial agreement — both lean the same direction with different lines.
            </Text>
          </View>
        ) : (
          <View style={[s.warningRow, { backgroundColor: '#22C55E14', borderColor: '#22C55E33' }]}>
            <Ionicons name="checkmark-circle-outline" size={13} color="#22C55E" />
            <Text style={{ fontSize: 11, color: '#22C55E', flex: 1 }}>
              Strong agreement between AI and expert panel.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Expert Panel Card ────────────────────────────────────────────────────────
function ExpertPanelCard({ ep, C }: { ep: ExpertPrediction; C: AppColors }) {
  const consensusPct = Math.round((ep.expertsSupporting / Math.max(1, ep.totalExperts)) * 100);
  const barColor = consensusPct >= 70 ? '#22C55E' : consensusPct >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <View style={[s.expertCard, { backgroundColor: C.surface, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <View style={[s.expertIcon, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B33' }]}>
          <Ionicons name="people" size={14} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: '#F59E0B', letterSpacing: 0.6 }}>
            {ep.predictionType}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: C.textPrimary }}>{ep.prediction}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 11, color: C.textMuted, flex: 1 }}>
          {ep.expertsSupporting} of {ep.totalExperts} experts supporting
        </Text>
        <Text style={{ fontSize: 13, fontWeight: FONTS.extraBold, color: barColor }}>{consensusPct}%</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: `${barColor}22`, overflow: 'hidden', marginBottom: 6 }}>
        <View style={{ width: `${consensusPct}%`, height: '100%', backgroundColor: barColor, borderRadius: 3 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 10, color: C.textMuted }}>Historical Accuracy</Text>
        <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: '#22C55E' }}>{ep.expertAccuracy.toFixed(0)}%</Text>
      </View>
    </View>
  );
}

// ─── Most Supported Leaderboard ───────────────────────────────────────────────
function TopSupportedPicks({
  picks, votes, C,
}: {
  picks: AIPredictionOutcome[];
  votes: Record<string, VoteCount>;
  C: AppColors;
}) {
  const ranked = picks
    .map((p) => ({ ...p, likes: votes[p.id]?.likes ?? 0 }))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 3);

  if (ranked.every((r) => r.likes === 0)) return null;

  const medals = ['🥇', '🥈', '🥉'];
  return (
    <View style={[s.section, { backgroundColor: '#F59E0B0A', borderColor: '#F59E0B33' }]}>
      <View style={s.sectionHeader}>
        <FontAwesome5 name="fire" size={13} color="#F59E0B" />
        <Text style={[s.sectionTitle, { color: C.textPrimary }]}>MOST SUPPORTED PICKS</Text>
      </View>
      {ranked.map((r, i) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: i < 2 ? StyleSheet.hairlineWidth : 0, borderBottomColor: C.border }}>
          <Text style={{ fontSize: 18 }}>{medals[i]}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: r.color }}>{r.outcome}</Text>
            <Text style={{ fontSize: 10, color: C.textMuted }}>{r.marketLabel}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 16 }}>👍</Text>
            <Text style={{ fontSize: 14, fontWeight: FONTS.extraBold, color: '#22C55E' }}>{r.likes.toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Confidence Dashboard Row ─────────────────────────────────────────────────
function ConfidenceDashboard({
  aiConf, expertConf, communityConf, C,
}: {
  aiConf: number; expertConf: number; communityConf: number; C: AppColors;
}) {
  return (
    <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[s.sectionTitle, { color: C.textPrimary, marginBottom: 14 }]}>CONFIDENCE METERS</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ConfidenceMeter label="AI" pct={aiConf} color={CONF_COLOR(aiConf)} C={C} />
        <ConfidenceMeter label="EXPERT" pct={expertConf} color="#F59E0B" C={C} />
        <ConfidenceMeter label="COMMUNITY" pct={communityConf} color={CONF_COLOR(communityConf)} C={C} />
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIReportConsensus({ matchId, prediction, matchCtx, sport }: Props) {
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [picks, setPicks] = useState<AIPredictionOutcome[]>([]);
  const [votes, setVotes] = useState<Record<string, VoteCount>>({});
  const [experts, setExperts] = useState<ExpertPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mainPrediction = prediction.predictedResult === 'home_win'
    ? matchCtx.homeTeam
    : prediction.predictedResult === 'away_win'
    ? matchCtx.awayTeam
    : 'Draw';

  // Generate sport-specific picks
  useEffect(() => {
    if (!prediction.predictedResult && !prediction.homeWinProb) return;
    const result = generateAISportPicks(prediction, matchCtx);
    setPicks(result.all);
  }, [matchId, prediction.predictedResult]);

  // Fetch votes + experts
  const loadData = useCallback(async () => {
    if (picks.length === 0) return;
    try {
      const [voteCounts, expertData] = await Promise.all([
        fetchVoteCounts(matchId, picks.map((p) => p.id), user?.id),
        fetchExpertPredictions(
          matchId, sport,
          matchCtx.homeTeam, matchCtx.awayTeam,
          prediction.predictedResult, prediction.homeWinProb, prediction.awayWinProb,
        ),
      ]);
      setVotes(voteCounts);
      setExperts(expertData);
    } catch { /* non-blocking */ }
    finally { setLoading(false); }
  }, [matchId, picks.length, user?.id]);

  useEffect(() => {
    if (picks.length === 0) return;
    loadData();
    // Poll votes every 30s for near-real-time updates
    pollRef.current = setInterval(loadData, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadData]);

  const handleVote = useCallback(async (predictionId: string, voteType: 'like' | 'dislike') => {
    if (!user?.id) return;
    // Optimistic update
    setVotes((prev) => {
      const current = prev[predictionId] ?? { predictionId, likes: 0, dislikes: 0, userVote: null };
      const wasLike = current.userVote === 'like';
      const wasDislike = current.userVote === 'dislike';
      const sameVote = current.userVote === voteType;

      let newLikes = current.likes;
      let newDislikes = current.dislikes;
      let newUserVote: 'like' | 'dislike' | null = voteType;

      if (sameVote) {
        // Toggle off
        if (voteType === 'like') newLikes = Math.max(0, newLikes - 1);
        else newDislikes = Math.max(0, newDislikes - 1);
        newUserVote = null;
      } else {
        // Switch or new
        if (wasLike) newLikes = Math.max(0, newLikes - 1);
        if (wasDislike) newDislikes = Math.max(0, newDislikes - 1);
        if (voteType === 'like') newLikes++;
        else newDislikes++;
      }

      return {
        ...prev,
        [predictionId]: {
          predictionId,
          likes: newLikes,
          dislikes: newDislikes,
          userVote: newUserVote,
        },
      };
    });

    // Actual DB write
    await castVote(matchId, predictionId, voteType, user.id);
  }, [matchId, user?.id]);

  if (loading && picks.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={{ color: C.textMuted, fontSize: 13 }}>Loading prediction intelligence...</Text>
      </View>
    );
  }

  if (picks.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
        <FontAwesome5 name="brain" size={32} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center' }}>
          No predictions available for this match yet.
        </Text>
      </View>
    );
  }

  // Compute aggregate metrics
  const allLikes = Object.values(votes).reduce((s, v) => s + v.likes, 0);
  const allDislikes = Object.values(votes).reduce((s, v) => s + v.dislikes, 0);
  const totalVotes = allLikes + allDislikes;
  const communityConf = totalVotes > 0 ? Math.round((allLikes / totalVotes) * 100) : 50;

  // Main result expert pick
  const mainExpert = experts.find((e) =>
    e.predictionType.toLowerCase().includes('match') ||
    e.predictionType.toLowerCase().includes('result') ||
    e.predictionType.toLowerCase().includes('winner') ||
    e.predictionType.toLowerCase().includes('fight'),
  ) ?? experts[0];

  const mainAIPick = picks[0];
  const expertConf = mainExpert
    ? Math.round((mainExpert.expertsSupporting / Math.max(1, mainExpert.totalExperts)) * 100)
    : 70;

  // Compute consensus for main prediction
  const consensus = mainAIPick && mainExpert
    ? computeConsensus(mainAIPick.outcome, mainExpert.prediction, matchCtx.homeTeam, matchCtx.awayTeam)
    : null;

  const top3 = picks.slice(0, 3);
  const rest = picks.slice(3);

  return (
    <View style={{ gap: 16 }}>

      {/* ── Confidence Dashboard ── */}
      <ConfidenceDashboard
        aiConf={prediction.confidence ?? 68}
        expertConf={expertConf}
        communityConf={communityConf}
        C={C}
      />

      {/* ── AI vs Expert Consensus ── */}
      {mainAIPick && mainExpert && consensus ? (
        <ExpertAICompareCard
          aiPick={mainAIPick}
          expertPick={mainExpert}
          consensus={consensus}
          C={C}
        />
      ) : null}

      {/* ── Expert Panel ── */}
      {experts.length > 0 ? (
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.sectionHeader}>
            <Ionicons name="people" size={14} color="#F59E0B" />
            <Text style={[s.sectionTitle, { color: C.textPrimary }]}>EXPERT PANEL</Text>
          </View>
          <View style={{ gap: 10 }}>
            {experts.map((ep) => <ExpertPanelCard key={ep.id} ep={ep} C={C} />)}
          </View>
        </View>
      ) : null}

      {/* ── Top 3 Predictions with Vote ── */}
      <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={s.sectionHeader}>
          <FontAwesome5 name="brain" size={13} color={C.primary} />
          <Text style={[s.sectionTitle, { color: C.textPrimary }]}>TOP AI PREDICTIONS</Text>
          <View style={[s.proPill, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
            <Text style={{ fontSize: 9, fontWeight: FONTS.extraBold, color: C.primary }}>VOTE</Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 18, marginBottom: 14 }}>
          Support or oppose each prediction. Community votes update in real-time.
        </Text>
        {top3.map((pick, i) => (
          <View key={pick.id} style={{ marginBottom: i < top3.length - 1 ? 14 : 0 }}>
            {/* Medal label */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 18 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textMuted }}>
                {i === 0 ? 'STRONGEST PICK' : i === 1 ? 'SECOND PICK' : 'THIRD PICK'}
              </Text>
            </View>
            <PredVoteCard
              pick={pick}
              voteData={votes[pick.id] ?? { predictionId: pick.id, likes: 0, dislikes: 0, userVote: null }}
              matchId={matchId}
              onVote={handleVote}
              C={C}
            />
          </View>
        ))}
      </View>

      {/* ── Most Supported ── */}
      <TopSupportedPicks picks={picks} votes={votes} C={C} />

      {/* ── Additional Picks with Vote ── */}
      {rest.length > 0 ? (
        <AdditionalPicksSection
          picks={rest}
          votes={votes}
          matchId={matchId}
          onVote={handleVote}
          C={C}
        />
      ) : null}

      {/* ── Community Totals ── */}
      {totalVotes > 0 ? (
        <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.sectionHeader}>
            <Ionicons name="bar-chart" size={14} color={C.primary} />
            <Text style={[s.sectionTitle, { color: C.textPrimary }]}>COMMUNITY TOTALS</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { label: 'Total Votes', val: totalVotes, color: C.primary },
              { label: 'Supporters 👍', val: allLikes, color: '#22C55E' },
              { label: 'Opponents 👎', val: allDislikes, color: '#EF4444' },
            ].map((m) => (
              <View key={m.label} style={{ flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, backgroundColor: `${m.color}0A`, borderColor: `${m.color}22` }}>
                <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.semiBold, textAlign: 'center' }}>{m.label}</Text>
                <Text style={{ fontSize: 22, fontWeight: FONTS.extraBold, color: m.color }}>{m.val.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

    </View>
  );
}

// ─── Collapsible Additional Picks ─────────────────────────────────────────────
function AdditionalPicksSection({
  picks, votes, matchId, onVote, C,
}: {
  picks: AIPredictionOutcome[];
  votes: Record<string, VoteCount>;
  matchId: string;
  onVote: (id: string, v: 'like' | 'dislike') => Promise<void>;
  C: AppColors;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? picks : picks.slice(0, 2);

  return (
    <View style={[s.section, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={s.sectionHeader}>
        <Ionicons name="layers" size={14} color={C.textMuted} />
        <Text style={[s.sectionTitle, { color: C.textPrimary }]}>MORE PREDICTIONS</Text>
      </View>
      <View style={{ gap: 12 }}>
        {shown.map((pick) => (
          <PredVoteCard
            key={pick.id}
            pick={pick}
            voteData={votes[pick.id] ?? { predictionId: pick.id, likes: 0, dislikes: 0, userVote: null }}
            matchId={matchId}
            onVote={onVote}
            C={C}
          />
        ))}
      </View>
      {picks.length > 2 ? (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          style={({ pressed }) => [s.expandBtn, { borderColor: C.border, backgroundColor: C.surface, opacity: pressed ? 0.8 : 1 }]}
        >
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
          <Text style={{ fontSize: 12, color: C.primary, fontWeight: FONTS.semiBold }}>
            {expanded ? 'Show less' : `Show ${picks.length - 2} more predictions`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  section: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: FONTS.extraBold,
    letterSpacing: 0.9,
    flex: 1,
  },
  proPill: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  voteCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 14,
  },
  voteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  marketBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  riskPill: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  voteSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  voteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  commConfPill: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  compareCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  compareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    paddingBottom: 12,
  },
  compareHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compareRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 4,
  },
  compareSide: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: 12,
  },
  compareMetaRow: {
    flexDirection: 'row',
    gap: 5,
    flexWrap: 'wrap',
  },
  metaPill: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  agreePill: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  agreeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  expertCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: 12,
  },
  expertIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    marginTop: 12,
  },
});
