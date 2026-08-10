/**
 * app/expert-rewards-history.tsx
 * Expert Rewards History — full expert_rewards_ledger with 30-day bar chart
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
interface RewardEntry {
  id: string;
  ledgerDate: string;
  accuracyPct: number;
  profitabilityScore: number;
  slipCount: number;
  predictionCount: number;
  correctCount: number;
  coinsAwarded: number;
  rewardTier: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

const TIER_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  bronze:   { label: 'Bronze',   emoji: '🥉', color: '#CD7F32' },
  silver:   { label: 'Silver',   emoji: '🥈', color: '#C0C0C0' },
  gold:     { label: 'Gold',     emoji: '🥇', color: '#FFD700' },
  perfect:  { label: 'Perfect',  emoji: '💎', color: '#22C55E' },
  no_reward:{ label: 'No Reward',emoji: '—',  color: '#6B7280' },
};

function getTierConfig(tier: string) {
  return TIER_CONFIG[tier?.toLowerCase()] ?? TIER_CONFIG.no_reward;
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────
function CoinsBarChart({ entries, C }: {
  entries: RewardEntry[];
  C: ReturnType<typeof useTheme>['colors'];
}) {
  if (entries.length === 0) return null;
  const last30 = entries.slice(0, 30).reverse();
  const maxCoins = Math.max(...last30.map((e) => e.coinsAwarded), 1);
  const chartWidth = SCREEN_WIDTH - SPACING.md * 2 - 32;
  const barWidth = Math.max(4, Math.floor(chartWidth / Math.max(last30.length, 1)) - 2);

  return (
    <View style={[bc.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[bc.title, { color: C.textSecondary }]}>Daily Coins (Last 30 Days)</Text>
      <View style={bc.chart}>
        {last30.map((entry, i) => {
          const heightPct = entry.coinsAwarded / maxCoins;
          const barH = Math.max(3, Math.round(72 * heightPct));
          const tierCfg = getTierConfig(entry.rewardTier);
          return (
            <View key={entry.id} style={[bc.barWrap, { width: barWidth }]}>
              <View style={[bc.bar, { height: barH, backgroundColor: tierCfg.color, width: barWidth - 2 }]} />
            </View>
          );
        })}
      </View>
      <View style={bc.legendRow}>
        {Object.entries(TIER_CONFIG).filter(([k]) => k !== 'no_reward').map(([key, cfg]) => (
          <View key={key} style={bc.legendItem}>
            <View style={[bc.legendDot, { backgroundColor: cfg.color }]} />
            <Text style={[bc.legendText, { color: C.textMuted }]}>{cfg.emoji} {cfg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const bc = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, marginBottom: 16 },
  title: { fontSize: 12, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 0 },
  barWrap: { alignItems: 'center', justifyContent: 'flex-end', height: 80 },
  bar: { borderRadius: 2 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10 },
});

// ─── Summary Cards ────────────────────────────────────────────────────────────
function SummaryCards({ entries, C }: {
  entries: RewardEntry[];
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const totalCoins  = entries.reduce((a, e) => a + e.coinsAwarded, 0);
  const avgAccuracy = entries.length > 0
    ? Math.round(entries.reduce((a, e) => a + e.accuracyPct, 0) / entries.length)
    : 0;
  const perfectDays = entries.filter((e) => e.rewardTier === 'perfect').length;
  const goldDays    = entries.filter((e) => e.rewardTier === 'gold').length;

  const items = [
    { icon: '🪙', val: String(totalCoins), label: 'Total Coins', color: C.vip ?? '#FFD700' },
    { icon: '🎯', val: `${avgAccuracy}%`, label: 'Avg Accuracy', color: C.primary },
    { icon: '💎', val: String(perfectDays), label: 'Perfect Days', color: '#22C55E' },
    { icon: '🥇', val: String(goldDays), label: 'Gold Days', color: '#FFD700' },
  ];

  return (
    <View style={[sum.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? <View style={[sum.divider, { backgroundColor: C.border }]} /> : null}
          <View style={sum.item}>
            <Text style={sum.icon}>{item.icon}</Text>
            <Text style={[sum.val, { color: item.color }]}>{item.val}</Text>
            <Text style={[sum.label, { color: C.textMuted }]}>{item.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
const sum = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 16, marginBottom: 16 },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  icon: { fontSize: 18 },
  val: { fontSize: 20, fontWeight: FONTS.extraBold },
  label: { fontSize: 9, textAlign: 'center', fontWeight: FONTS.medium, lineHeight: 12 },
  divider: { width: 1, marginVertical: 8 },
});

// ─── Reward Row ───────────────────────────────────────────────────────────────
function RewardRow({ entry, C }: {
  entry: RewardEntry;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const tierCfg = getTierConfig(entry.rewardTier);
  const hasCoins = entry.coinsAwarded > 0;

  return (
    <View style={[rr.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Tier badge */}
      <View style={[rr.tierBadge, { backgroundColor: `${tierCfg.color}18`, borderColor: `${tierCfg.color}44` }]}>
        <Text style={rr.tierEmoji}>{tierCfg.emoji}</Text>
      </View>

      {/* Info */}
      <View style={rr.info}>
        <View style={rr.topRow}>
          <Text style={[rr.date, { color: C.textPrimary }]}>{formatDate(entry.ledgerDate)}</Text>
          <View style={[rr.tierLabel, { backgroundColor: `${tierCfg.color}18`, borderColor: `${tierCfg.color}33` }]}>
            <Text style={[rr.tierText, { color: tierCfg.color }]}>{tierCfg.label}</Text>
          </View>
        </View>
        <View style={rr.metaRow}>
          <Text style={[rr.meta, { color: C.textMuted }]}>
            {entry.slipCount} slip{entry.slipCount !== 1 ? 's' : ''} ·{' '}
            {entry.correctCount}/{entry.predictionCount} correct ·{' '}
            {entry.accuracyPct.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Coins */}
      {hasCoins ? (
        <View style={[rr.coinsBadge, { backgroundColor: (C.vipGlow ?? '#FFD70018'), borderColor: '#FFD70044' }]}>
          <Text style={rr.coinsEmoji}>🪙</Text>
          <Text style={[rr.coinsVal, { color: C.vip ?? '#FFD700' }]}>+{entry.coinsAwarded}</Text>
        </View>
      ) : (
        <View style={[rr.coinsBadge, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Text style={[rr.coinsVal, { color: C.textMuted }]}>—</Text>
        </View>
      )}
    </View>
  );
}
const rr = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 12, marginBottom: 8 },
  tierBadge: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tierEmoji: { fontSize: 20 },
  info: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  date: { fontSize: 13, fontWeight: FONTS.semiBold, flex: 1 },
  tierLabel: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  tierText: { fontSize: 10, fontWeight: FONTS.bold },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  meta: { fontSize: 11 },
  coinsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  coinsEmoji: { fontSize: 12 },
  coinsVal: { fontSize: 13, fontWeight: FONTS.extraBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ExpertRewardsHistoryScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  const [entries, setEntries] = useState<RewardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expertId, setExpertId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const supabase = getSupabaseClient();

      // Get expert profile
      const { data: profile } = await supabase
        .from('expert_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) { setLoading(false); return; }
      setExpertId(profile.id);

      // Get rewards ledger
      const { data } = await supabase
        .from('expert_rewards_ledger')
        .select('*')
        .eq('expert_id', profile.id)
        .order('ledger_date', { ascending: false })
        .limit(60);

      const mapped: RewardEntry[] = (data ?? []).map((r: any) => ({
        id: r.id,
        ledgerDate: r.ledger_date,
        accuracyPct: Number(r.accuracy_pct ?? 0),
        profitabilityScore: Number(r.profitability_score ?? 0),
        slipCount: r.slip_count ?? 0,
        predictionCount: r.prediction_count ?? 0,
        correctCount: r.correct_count ?? 0,
        coinsAwarded: r.coins_awarded ?? 0,
        rewardTier: r.reward_tier ?? 'no_reward',
        status: r.status ?? 'credited',
        notes: r.notes ?? null,
        createdAt: r.created_at,
      }));
      setEntries(mapped);
    } catch { /* non-blocking */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.id]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistory();
  }, [fetchHistory]);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>Rewards History</Text>
          <Pressable
            onPress={() => router.push('/expert-slips' as any)}
            style={[s.slipsBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="clipboard-list" size={11} color={C.primary} />
            <Text style={[s.slipsBtnText, { color: C.primary }]}>My Slips</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={[s.loadingText, { color: C.textMuted }]}>Loading rewards…</Text>
          </View>
        ) : !user ? (
          <View style={s.centered}>
            <Text style={{ fontSize: 40 }}>🔒</Text>
            <Text style={[s.emptyTitle, { color: C.textPrimary }]}>Sign In Required</Text>
            <Text style={[s.emptyBody, { color: C.textMuted }]}>Sign in to view your expert rewards history.</Text>
          </View>
        ) : !expertId ? (
          <View style={s.centered}>
            <Text style={{ fontSize: 40 }}>🥊</Text>
            <Text style={[s.emptyTitle, { color: C.textPrimary }]}>Not an Expert Yet</Text>
            <Text style={[s.emptyBody, { color: C.textMuted }]}>
              Complete 3 consecutive perfect Daily Challenge days with VIP status to become a verified Expert Tipster.
            </Text>
            <Pressable
              style={[s.ctaBtn, { backgroundColor: C.primary }]}
              onPress={() => router.push('/challenge' as any)}>
              <FontAwesome5 name="trophy" size={12} color={C.textInverse} />
              <Text style={[s.ctaBtnText, { color: C.textInverse }]}>Play Daily Challenge</Text>
            </Pressable>
          </View>
        ) : entries.length === 0 ? (
          <View style={s.centered}>
            <Text style={{ fontSize: 40 }}>📊</Text>
            <Text style={[s.emptyTitle, { color: C.textPrimary }]}>No Rewards Yet</Text>
            <Text style={[s.emptyBody, { color: C.textMuted }]}>
              Submit expert slips and earn coins when your predictions are settled.
            </Text>
            <Pressable
              style={[s.ctaBtn, { backgroundColor: C.primary }]}
              onPress={() => router.push('/expert-slips' as any)}>
              <FontAwesome5 name="clipboard-list" size={12} color={C.textInverse} />
              <Text style={[s.ctaBtnText, { color: C.textInverse }]}>Submit a Slip</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Summary stats */}
            <SummaryCards entries={entries} C={C} />

            {/* Bar chart */}
            <CoinsBarChart entries={entries} C={C} />

            {/* Reward tiers guide */}
            <View style={[s.tierGuide, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[s.tierGuideTitle, { color: C.textSecondary }]}>Reward Tiers</Text>
              <View style={s.tierGuideGrid}>
                {[
                  { tier: 'bronze', range: '70–79%', coins: '50' },
                  { tier: 'silver', range: '80–89%', coins: '120' },
                  { tier: 'gold',   range: '90–99%', coins: '250' },
                  { tier: 'perfect',range: '100%',   coins: '500' },
                ].map((t) => {
                  const cfg = getTierConfig(t.tier);
                  return (
                    <View key={t.tier} style={[s.tierItem, { backgroundColor: `${cfg.color}12`, borderColor: `${cfg.color}33` }]}>
                      <Text style={s.tierEmoji}>{cfg.emoji}</Text>
                      <Text style={[s.tierLabel, { color: cfg.color }]}>{cfg.label}</Text>
                      <Text style={[s.tierRange, { color: C.textMuted }]}>{t.range}</Text>
                      <Text style={[s.tierCoins, { color: cfg.color }]}>🪙 {t.coins}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* History list */}
            <Text style={[s.sectionTitle, { color: C.textSecondary }]}>
              All Rewards ({entries.length})
            </Text>
            {entries.map((entry) => (
              <RewardRow key={entry.id} entry={entry} C={C} />
            ))}
          </>
        )}
      </ScrollView>
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
  title: { fontSize: 17, fontWeight: FONTS.bold },
  slipsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  slipsBtnText: { fontSize: 12, fontWeight: FONTS.bold },
  content: { paddingHorizontal: SPACING.md, paddingTop: 16, paddingBottom: 48 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: FONTS.bold, textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.full, paddingHorizontal: 24, paddingVertical: 11, marginTop: 4 },
  ctaBtnText: { fontSize: 14, fontWeight: FONTS.bold },
  tierGuide: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 16 },
  tierGuideTitle: { fontSize: 11, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  tierGuideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierItem: { flex: 1, minWidth: '45%', alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 10, gap: 3 },
  tierEmoji: { fontSize: 18 },
  tierLabel: { fontSize: 11, fontWeight: FONTS.bold },
  tierRange: { fontSize: 10 },
  tierCoins: { fontSize: 12, fontWeight: FONTS.extraBold },
  sectionTitle: { fontSize: 12, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
});
