/**
 * app/expert-slip-detail/[id].tsx
 * Expert Slip Detail — pick-by-pick breakdown with accuracy, odds, and share
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlipPick {
  id: string;
  matchLabel: string;
  sport: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  tipType: string;
  tipValue: string;
  odds: number;
  result: 'won' | 'lost' | 'pending' | null;
  actualOutcome: string | null;
  homeScoreActual: number | null;
  awayScoreActual: number | null;
  matchTime: string | null;
  settledAt: string | null;
}

interface SlipDetail {
  id: string;
  slipDate: string;
  sport: string;
  title: string | null;
  description: string | null;
  status: string;
  totalPicks: number;
  correctPicks: number;
  pendingPicks: number;
  accuracyPct: number | null;
  totalOdds: number;
  winningOdds: number;
  profitabilityPct: number | null;
  coinsAwarded: number;
  rewardStatus: string;
  isLocked: boolean;
  submittedAt: string;
  settledAt: string | null;
  picks: SlipPick[];
  expertName?: string;
}

const RESULT_CONFIG = {
  won:     { label: 'Won',     emoji: '✅', color: '#22C55E', bg: '#22C55E18', border: '#22C55E44' },
  lost:    { label: 'Lost',    emoji: '❌', color: '#EF4444', bg: '#EF444418', border: '#EF444444' },
  pending: { label: 'Pending', emoji: '⏳', color: '#F59E0B', bg: '#F59E0B18', border: '#F59E0B44' },
};

function getResultCfg(result: string | null) {
  return RESULT_CONFIG[(result ?? 'pending') as keyof typeof RESULT_CONFIG] ?? RESULT_CONFIG.pending;
}

function fmtDate(iso: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ─── Pick Card ────────────────────────────────────────────────────────────────
function PickCard({ pick, idx, C }: {
  pick: SlipPick; idx: number;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const resultCfg = getResultCfg(pick.result);
  const SPORT_EMOJI: Record<string, string> = {
    football: '⚽', basketball: '🏀', tennis: '🎾',
    cricket: '🏏', baseball: '⚾', hockey: '🏒',
    rugby: '🏉', mma: '🥊', boxing: '🥊',
    volleyball: '🏐', handball: '🤾', esports: '🎮',
  };
  const sportEmoji = SPORT_EMOJI[pick.sport?.toLowerCase()] ?? '🏆';

  return (
    <View style={[pk.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[pk.stripe, { backgroundColor: resultCfg.color }]} />
      <View style={pk.body}>
        {/* Header row */}
        <View style={pk.headerRow}>
          <View style={pk.numBadge}>
            <Text style={[pk.numText, { color: C.textMuted }]}>#{idx + 1}</Text>
          </View>
          <Text style={pk.sportEmoji}>{sportEmoji}</Text>
          <Text style={[pk.league, { color: C.textMuted }]} numberOfLines={1}>{pick.league ?? pick.sport}</Text>
          <View style={{ flex: 1 }} />
          <View style={[pk.resultBadge, { backgroundColor: resultCfg.bg, borderColor: resultCfg.border }]}>
            <Text style={pk.resultEmoji}>{resultCfg.emoji}</Text>
            <Text style={[pk.resultLabel, { color: resultCfg.color }]}>{resultCfg.label}</Text>
          </View>
        </View>

        {/* Teams */}
        <Text style={[pk.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>
          {pick.homeTeam} vs {pick.awayTeam}
        </Text>

        {/* Tip */}
        <View style={pk.tipRow}>
          <View style={[pk.tipChip, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="brain" size={8} color={C.primary} />
            <Text style={[pk.tipType, { color: C.primary }]}>{pick.tipType}</Text>
          </View>
          <View style={[pk.tipChip, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={[pk.tipValue, { color: C.textPrimary }]}>{pick.tipValue}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={[pk.oddsBadge, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
            <Text style={[pk.oddsVal, { color: C.primary }]}>{pick.odds.toFixed(2)}</Text>
          </View>
        </View>

        {/* Actual result if settled */}
        {pick.result !== 'pending' && pick.actualOutcome ? (
          <View style={[pk.outcomeRow, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
            <Text style={[pk.outcomeText, { color: C.textMuted }]}>
              Result: {pick.homeScoreActual !== null && pick.awayScoreActual !== null
                ? `${pick.homeTeam} ${pick.homeScoreActual} – ${pick.awayScoreActual} ${pick.awayTeam}`
                : pick.actualOutcome}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
const pk = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  stripe: { width: 4 },
  body: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  numBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 10, fontWeight: FONTS.bold },
  sportEmoji: { fontSize: 13 },
  league: { fontSize: 10, flex: 1 },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  resultEmoji: { fontSize: 11 },
  resultLabel: { fontSize: 10, fontWeight: FONTS.bold },
  matchLabel: { fontSize: 13, fontWeight: FONTS.bold },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  tipType: { fontSize: 10, fontWeight: FONTS.bold },
  tipValue: { fontSize: 10, fontWeight: FONTS.semiBold },
  oddsBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  oddsVal: { fontSize: 12, fontWeight: FONTS.extraBold },
  outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  outcomeText: { fontSize: 10, flex: 1 },
});

// ─── Accuracy Progress Bar ────────────────────────────────────────────────────
function AccuracyBar({ correct, total, pct, C }: {
  correct: number; total: number; pct: number;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const barColor = pct >= 90 ? '#22C55E' : pct >= 70 ? C.primary : '#F59E0B';
  return (
    <View style={[ab.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={ab.topRow}>
        <Text style={[ab.label, { color: C.textSecondary }]}>Accuracy</Text>
        <Text style={[ab.pctVal, { color: barColor }]}>{pct.toFixed(1)}%</Text>
        <Text style={[ab.fractionVal, { color: C.textMuted }]}>{correct}/{total}</Text>
      </View>
      <View style={[ab.track, { backgroundColor: C.surface }]}>
        <View style={[ab.fill, { width: `${Math.min(100, pct)}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}
const ab = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { flex: 1, fontSize: 12, fontWeight: FONTS.semiBold },
  pctVal: { fontSize: 20, fontWeight: FONTS.extraBold },
  fractionVal: { fontSize: 12 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ExpertSlipDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [slip, setSlip] = useState<SlipDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSlip = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();

      const [slipRes, picksRes] = await Promise.all([
        supabase.from('expert_slips').select('*, expert_profiles(username)').eq('id', id).single(),
        supabase.from('expert_slip_picks').select('*').eq('slip_id', id).order('created_at', { ascending: true }),
      ]);

      if (!slipRes.data) { setLoading(false); return; }
      const r = slipRes.data as any;

      const picks: SlipPick[] = (picksRes.data ?? []).map((p: any) => ({
        id: p.id,
        matchLabel: p.match_label,
        sport: p.sport ?? 'football',
        league: p.league ?? null,
        homeTeam: p.home_team,
        awayTeam: p.away_team,
        tipType: p.tip_type,
        tipValue: p.tip_value,
        odds: Number(p.odds ?? 1),
        result: p.result ?? null,
        actualOutcome: p.actual_outcome ?? null,
        homeScoreActual: p.home_score_actual ?? null,
        awayScoreActual: p.away_score_actual ?? null,
        matchTime: p.match_time ?? null,
        settledAt: p.settled_at ?? null,
      }));

      const detail: SlipDetail = {
        id: r.id,
        slipDate: r.slip_date,
        sport: r.sport ?? 'football',
        title: r.title ?? null,
        description: r.description ?? null,
        status: r.status ?? 'open',
        totalPicks: r.total_picks ?? picks.length,
        correctPicks: r.correct_picks ?? 0,
        pendingPicks: r.pending_picks ?? picks.filter((p) => !p.result).length,
        accuracyPct: r.accuracy_pct ? Number(r.accuracy_pct) : null,
        totalOdds: Number(r.total_odds ?? 0),
        winningOdds: Number(r.winning_odds ?? 0),
        profitabilityPct: r.profitability_pct ? Number(r.profitability_pct) : null,
        coinsAwarded: r.coins_awarded ?? 0,
        rewardStatus: r.reward_status ?? 'pending',
        isLocked: r.is_locked ?? false,
        submittedAt: r.submitted_at ?? r.created_at,
        settledAt: r.settled_at ?? null,
        picks,
        expertName: r.expert_profiles?.username ?? undefined,
      };
      setSlip(detail);
    } catch { /* non-blocking */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchSlip(); }, [fetchSlip]);

  const handleShare = useCallback(async () => {
    if (!slip) return;
    const wonCount = slip.picks.filter((p) => p.result === 'won').length;
    const text = [
      `🧠 Expert Slip — ${slip.slipDate}`,
      `📊 ${wonCount}/${slip.totalPicks} correct${slip.accuracyPct ? ` (${slip.accuracyPct.toFixed(1)}%)` : ''}`,
      slip.picks.slice(0, 5).map((p) => `  • ${p.homeTeam} vs ${p.awayTeam}: ${p.tipType} ${p.tipValue} @ ${p.odds.toFixed(2)}`).join('\n'),
      '',
      '📱 PredictXta — AI Sports Predictions',
    ].join('\n');
    try { await Share.share({ message: text }); } catch { /* user cancelled */ }
  }, [slip]);

  const wonPicks    = useMemo(() => slip?.picks.filter((p) => p.result === 'won').length ?? 0, [slip]);
  const lostPicks   = useMemo(() => slip?.picks.filter((p) => p.result === 'lost').length ?? 0, [slip]);
  const pendingCount = useMemo(() => slip?.picks.filter((p) => !p.result || p.result === 'pending').length ?? 0, [slip]);

  const statusColor = slip?.status === 'won' ? '#22C55E' : slip?.status === 'lost' ? '#EF4444' : C.primary;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]} numberOfLines={1}>
            Slip Detail
          </Text>
          <Pressable
            onPress={handleShare}
            style={[s.shareBtn, { backgroundColor: C.card, borderColor: C.border }]}
            hitSlop={8}>
            <Ionicons name="share-outline" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : !slip ? (
        <View style={s.centered}>
          <Text style={{ fontSize: 40 }}>🔍</Text>
          <Text style={[s.emptyTitle, { color: C.textPrimary }]}>Slip Not Found</Text>
          <Text style={[s.emptyBody, { color: C.textMuted }]}>This slip may have been removed or is inaccessible.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          {/* Hero gradient */}
          <LinearGradient
            colors={[`${statusColor}18`, `${statusColor}06`, C.bg] as [string, string, string]}
            style={[s.hero, { borderColor: `${statusColor}22` }]}
          >
            <View style={s.heroTop}>
              <View style={[s.statusBadge, { backgroundColor: `${statusColor}18`, borderColor: `${statusColor}44` }]}>
                <Text style={[s.statusText, { color: statusColor }]}>
                  {slip.status === 'won' ? '✅ Won' : slip.status === 'lost' ? '❌ Lost' : slip.isLocked ? '🔒 Locked' : '⏳ Open'}
                </Text>
              </View>
              {slip.coinsAwarded > 0 ? (
                <View style={[s.coinsBadge, { backgroundColor: (C.vipGlow ?? '#FFD70018'), borderColor: '#FFD70044' }]}>
                  <Text style={s.coinsEmoji}>🪙</Text>
                  <Text style={[s.coinsVal, { color: C.vip ?? '#FFD700' }]}>+{slip.coinsAwarded}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[s.heroDate, { color: C.textSecondary }]}>{fmtDate(slip.submittedAt)}</Text>
            {slip.title ? <Text style={[s.heroTitle, { color: C.textPrimary }]}>{slip.title}</Text> : null}
            <View style={s.heroStats}>
              {[
                { val: String(wonPicks), label: 'Won', color: '#22C55E' },
                { val: String(lostPicks), label: 'Lost', color: '#EF4444' },
                { val: String(pendingCount), label: 'Pending', color: '#F59E0B' },
                { val: slip.totalOdds > 0 ? slip.totalOdds.toFixed(2) : '—', label: 'Total Odds', color: C.primary },
              ].map((item, i) => (
                <React.Fragment key={item.label}>
                  {i > 0 ? <View style={[s.heroDivider, { backgroundColor: `${statusColor}22` }]} /> : null}
                  <View style={s.heroStat}>
                    <Text style={[s.heroStatVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={[s.heroStatLabel, { color: C.textMuted }]}>{item.label}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </LinearGradient>

          {/* Accuracy bar */}
          {slip.accuracyPct !== null ? (
            <AccuracyBar correct={slip.correctPicks} total={slip.totalPicks - pendingCount} pct={slip.accuracyPct} C={C} />
          ) : null}

          {/* Pick-by-pick breakdown */}
          <Text style={[s.sectionTitle, { color: C.textSecondary }]}>
            Picks ({slip.totalPicks})
          </Text>
          {slip.picks.map((pick, i) => (
            <PickCard key={pick.id} pick={pick} idx={i} C={C} />
          ))}

          {/* Profitability */}
          {slip.profitabilityPct !== null ? (
            <View style={[s.profitRow, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[s.profitLabel, { color: C.textSecondary }]}>Profitability</Text>
              <Text style={[s.profitVal, { color: slip.profitabilityPct >= 0 ? '#22C55E' : '#EF4444' }]}>
                {slip.profitabilityPct >= 0 ? '+' : ''}{slip.profitabilityPct.toFixed(2)}%
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: FONTS.bold, textAlign: 'center' },
  shareBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold },
  emptyBody: { fontSize: 13, textAlign: 'center', paddingHorizontal: 24, color: '#6B7280' },

  content: { paddingHorizontal: SPACING.md, paddingTop: 0, paddingBottom: 48 },

  hero: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, marginBottom: 12, gap: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 12, fontWeight: FONTS.bold },
  coinsBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  coinsEmoji: { fontSize: 13 },
  coinsVal: { fontSize: 15, fontWeight: FONTS.extraBold },
  heroDate: { fontSize: 11 },
  heroTitle: { fontSize: 16, fontWeight: FONTS.bold },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  heroStatLabel: { fontSize: 9, textAlign: 'center' },
  heroDivider: { width: 1, height: 28 },

  sectionTitle: { fontSize: 12, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },

  profitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 12, marginTop: 8 },
  profitLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  profitVal: { fontSize: 16, fontWeight: FONTS.extraBold },
});
