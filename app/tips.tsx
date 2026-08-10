/**
 * app/tips.tsx — Public Expert Tips Browse Screen
 * Accessible to all users. Non-VIP sees free picks only.
 * VIP sees all including premium tips.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList,
  ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { getSupabaseClient } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HOME_VIP_CACHE_KEY = 'predictxta_is_vip_v1';

interface ExpertTip {
  id: string; expertName: string; sport: string; matchLabel: string;
  tipType: string; tipValue: string; odds: number | null; confidence: number;
  status: 'pending' | 'won' | 'lost' | 'void'; league: string | null;
  isPremium: boolean; analysis: string | null; createdAt: string;
}

const SPORT_FILTERS = ['All', 'Football', 'Basketball', 'Tennis', 'Cricket', 'MMA', 'Baseball', 'Hockey', 'Rugby'];
const STATUS_FILTERS = [
  { key: 'all', label: 'All', color: '#6B7280' },
  { key: 'pending', label: 'Pending', color: '#F59E0B' },
  { key: 'won', label: 'Won', color: '#22C55E' },
  { key: 'lost', label: 'Lost', color: '#EF4444' },
  { key: 'void', label: 'Void', color: '#9CA3AF' },
];
const SPORT_EMOJI: Record<string, string> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏸',
  mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉',
};

function statusMeta(status: string, C: AppColors) {
  switch (status) {
    case 'won':  return { label: 'WON',     color: '#22C55E', bg: '#22C55E18', icon: 'checkmark-circle' as const };
    case 'lost': return { label: 'LOST',    color: C.accentRed, bg: `${C.accentRed}18`, icon: 'close-circle' as const };
    case 'void': return { label: 'VOID',    color: C.textMuted, bg: C.surface, icon: 'remove-circle-outline' as const };
    default:     return { label: 'PENDING', color: '#F59E0B', bg: '#F59E0B18', icon: 'time-outline' as const };
  }
}

function TipCard({ tip, isVip, C }: { tip: ExpertTip; isVip: boolean; C: AppColors }) {
  const [expanded, setExpanded] = useState(false);
  const sm = statusMeta(tip.status, C);
  const sportEmoji = SPORT_EMOJI[tip.sport.toLowerCase()] ?? '🏆';
  const confColor = tip.confidence >= 80 ? '#22C55E' : tip.confidence >= 65 ? '#F59E0B' : C.textMuted;
  const isLocked = tip.isPremium && !isVip;

  return (
    <Pressable
      style={({ pressed }) => [card.wrap, { backgroundColor: C.card, borderColor: isLocked ? `${C.primary}33` : C.border }, pressed ? { opacity: 0.9 } : null]}
      onPress={() => { if (!isLocked && tip.analysis) setExpanded((v) => !v); }}>
      {/* Left accent stripe */}
      <View style={[card.stripe, { backgroundColor: sm.color }]} />

      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        {/* Header */}
        <View style={card.headerRow}>
          <Text style={card.sportEmoji}>{sportEmoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[card.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>{tip.matchLabel}</Text>
            {tip.league ? <Text style={[card.league, { color: C.textMuted }]} numberOfLines={1}>{tip.league}</Text> : null}
          </View>
          <View style={[card.statusBadge, { backgroundColor: sm.bg, borderColor: `${sm.color}44` }]}>
            <Ionicons name={sm.icon} size={11} color={sm.color} />
            <Text style={[card.statusText, { color: sm.color }]}>{sm.label}</Text>
          </View>
          {tip.isPremium ? (
            <View style={[card.vipBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
              <FontAwesome5 name="crown" size={8} color="#F59E0B" />
              <Text style={[card.vipText, { color: '#F59E0B' }]}>VIP</Text>
            </View>
          ) : null}
        </View>

        {/* Locked overlay */}
        {isLocked ? (
          <View style={[card.lockRow, { backgroundColor: `${C.primary}0D`, borderColor: `${C.primary}22` }]}>
            <Ionicons name="lock-closed-outline" size={13} color={C.primary} />
            <Text style={[card.lockText, { color: C.primary }]}>Premium tip — upgrade to VIP to unlock</Text>
          </View>
        ) : (
          <>
            {/* Tip value row */}
            <View style={card.tipRow}>
              <View style={[card.tipBox, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
                <Text style={[card.tipType, { color: C.textMuted }]}>{tip.tipType}</Text>
                <Text style={[card.tipValue, { color: C.primary }]} numberOfLines={1}>{tip.tipValue}</Text>
              </View>
              {tip.odds ? (
                <View style={[card.oddsPill, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Text style={[card.oddsAt, { color: C.textMuted }]}>@</Text>
                  <Text style={[card.oddsVal, { color: C.textPrimary }]}>{tip.odds.toFixed(2)}</Text>
                </View>
              ) : null}
              <View style={[card.confBadge, { backgroundColor: `${confColor}14`, borderColor: `${confColor}33` }]}>
                <Ionicons name="shield-checkmark-outline" size={10} color={confColor} />
                <Text style={[card.confText, { color: confColor }]}>{tip.confidence}%</Text>
              </View>
            </View>

            {/* Expert + time */}
            <View style={card.footerRow}>
              <Ionicons name="person-circle-outline" size={12} color={C.textMuted} />
              <Text style={[card.expertName, { color: C.textMuted }]}>{tip.expertName}</Text>
              <Text style={[card.dot, { color: C.textMuted }]}>·</Text>
              <Text style={[card.time, { color: C.textMuted }]}>{formatTime(tip.createdAt)}</Text>
            </View>

            {/* Expandable analysis */}
            {tip.analysis ? (
              <>
                <View style={[card.expandRow, { borderTopColor: C.border }]}>
                  <Text style={[card.expandLabel, { color: C.textMuted }]}>{expanded ? 'Hide' : 'Expert Analysis'}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.textMuted} />
                </View>
                {expanded ? (
                  <View style={[card.analysisBox, { backgroundColor: C.surface, borderColor: C.border }]}>
                    <Text style={[card.analysisText, { color: C.textSecondary }]}>{tip.analysis}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const card = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sportEmoji: { fontSize: 16, flexShrink: 0 },
  matchLabel: { fontSize: 14, fontWeight: FONTS.bold },
  league: { fontSize: 11, marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.4 },
  vipBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2 },
  vipText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  lockText: { fontSize: 12, fontWeight: FONTS.semiBold, flex: 1 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipBox: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, gap: 2 },
  tipType: { fontSize: 9, fontWeight: FONTS.medium },
  tipValue: { fontSize: 14, fontWeight: FONTS.extraBold },
  oddsPill: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7 },
  oddsAt: { fontSize: 11 },
  oddsVal: { fontSize: 14, fontWeight: FONTS.bold },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  confText: { fontSize: 10, fontWeight: FONTS.bold },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  expertName: { flex: 1, fontSize: 11, fontWeight: FONTS.semiBold },
  dot: { fontSize: 11 },
  time: { fontSize: 11 },
  expandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  expandLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  analysisBox: { borderRadius: RADIUS.md, borderWidth: 1, padding: 10 },
  analysisText: { fontSize: 13, lineHeight: 20 },
});

export default function TipsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [tips, setTips] = useState<ExpertTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isVip, setIsVip] = useState(false);
  const [sportFilter, setSportFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<'recent' | 'confidence' | 'odds'>('recent');

  // Load VIP status from cache
  useEffect(() => {
    AsyncStorage.getItem(HOME_VIP_CACHE_KEY).then((raw) => { if (raw === 'true') setIsVip(true); });
  }, []);

  const fetchTips = useCallback(async () => {
    try {
      const sb = getSupabaseClient();
      let query = sb.from('expert_tips')
        .select('id, expert_name, sport, match_label, tip_type, tip_value, odds, confidence, status, league, is_premium, analysis, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!isVip) query = query.eq('is_premium', false);
      const { data } = await query;
      setTips((data ?? []).map((r: any) => ({
        id: r.id, expertName: r.expert_name, sport: r.sport, matchLabel: r.match_label,
        tipType: r.tip_type, tipValue: r.tip_value, odds: r.odds ? Number(r.odds) : null,
        confidence: Number(r.confidence ?? 70), status: r.status, league: r.league ?? null,
        isPremium: r.is_premium ?? false, analysis: r.analysis ?? null, createdAt: r.created_at,
      })));
    } catch { /* non-blocking */ }
  }, [isVip]);

  useEffect(() => {
    setLoading(true);
    fetchTips().finally(() => setLoading(false));
  }, [fetchTips]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTips();
    setRefreshing(false);
  }, [fetchTips]);

  const filtered = useMemo(() => tips.filter((t) => {
    const sportMatch = sportFilter === 'All' || t.sport.toLowerCase() === sportFilter.toLowerCase();
    const statusMatch = statusFilter === 'all' || t.status === statusFilter;
    return sportMatch && statusMatch;
  }), [tips, sportFilter, statusFilter]);

  // Stats
  const won = tips.filter((t) => t.status === 'won').length;
  const settled = tips.filter((t) => t.status === 'won' || t.status === 'lost').length;
  const winPct = settled > 0 ? Math.round((won / settled) * 100) : null;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: C.textPrimary }]}>💡 Expert Tips</Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.lbBtn, { backgroundColor: `${C.accentBlue}14`, borderColor: `${C.accentBlue}44` }, pressed ? { opacity: 0.8 } : null]}
            onPress={() => router.push('/expert-leaderboard' as any)}>
            <Ionicons name="trophy-outline" size={14} color={C.accentBlue} />
            <Text style={[s.lbBtnText, { color: C.accentBlue }]}>Rankings</Text>
          </Pressable>
          {!isVip ? (
            <Pressable
              style={({ pressed }) => [s.vipBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }, pressed ? { opacity: 0.8 } : null]}
              onPress={() => router.push('/vip' as any)}>
              <FontAwesome5 name="crown" size={11} color={C.primary} />
              <Text style={[s.vipBtnText, { color: C.primary }]}>Go VIP</Text>
            </Pressable>
          ) : (
            <View style={[s.vipBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <FontAwesome5 name="crown" size={11} color={C.primary} />
              <Text style={[s.vipBtnText, { color: C.primary }]}>VIP</Text>
            </View>
          )}
        </View>

        {/* Win rate stats bar */}
        {tips.length > 0 ? (
          <View style={[s.statsBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
            {[
              { val: tips.filter((t) => t.status === 'won').length, label: 'Won', color: '#22C55E' },
              { val: tips.filter((t) => t.status === 'lost').length, label: 'Lost', color: C.accentRed },
              { val: tips.filter((t) => t.status === 'pending').length, label: 'Pending', color: '#F59E0B' },
              ...(winPct !== null ? [{ val: `${winPct}%`, label: 'Win Rate', color: winPct >= 60 ? '#22C55E' : C.primary }] : []),
            ].map((stat, i) => (
              <View key={stat.label} style={[s.statCell, i > 0 ? { borderLeftWidth: 1, borderLeftColor: C.border } : null]}>
                <Text style={[s.statVal, { color: stat.color as string }]}>{stat.val}</Text>
                <Text style={[s.statLbl, { color: C.textMuted }]}>{stat.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Sport filter */}
        <View style={[s.filterBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
            {SPORT_FILTERS.map((sp) => {
              const active = sportFilter === sp;
              return (
                <Pressable key={sp} style={[s.chip, active ? { backgroundColor: `${C.primary}18`, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }]} onPress={() => setSportFilter(sp)}>
                  <Text style={[s.chipText, { color: active ? C.primary : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{sp}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Status filter */}
        <View style={[s.filterBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key;
              const count = f.key === 'all' ? tips.length : tips.filter((t) => t.status === f.key).length;
              return (
                <Pressable key={f.key} style={[s.chip, active ? { backgroundColor: `${f.color}18`, borderColor: f.color } : { backgroundColor: C.card, borderColor: C.border }]} onPress={() => setStatusFilter(f.key)}>
                  <Text style={[s.chipText, { color: active ? f.color : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{f.label}</Text>
                  {count > 0 ? <View style={[s.countBubble, { backgroundColor: active ? f.color : C.border }]}><Text style={[s.countText, { color: active ? '#fff' : C.textMuted }]}>{count}</Text></View> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TipCard tip={item} isVip={isVip} C={C} />}
          contentContainerStyle={s.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="bulb-outline" size={44} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.textMuted }]}>No tips available</Text>
              <Text style={[s.emptySub, { color: C.textMuted }]}>Expert tips will appear here once posted</Text>
            </View>
          }
          ListFooterComponent={<View style={{ height: 40 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: FONTS.extraBold },
  vipBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  vipBtnText: { fontSize: 12, fontWeight: FONTS.bold },
  lbBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  lbBtnText: { fontSize: 12, fontWeight: FONTS.bold },
  statsBar: { flexDirection: 'row', borderBottomWidth: 1 },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  statVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterBar: { borderBottomWidth: 1 },
  filterScroll: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, height: 34 },
  chipText: { fontSize: 12, fontWeight: FONTS.medium },
  countBubble: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { fontSize: 9, fontWeight: FONTS.extraBold },
  listContent: { padding: SPACING.md },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: FONTS.semiBold },
  emptySub: { fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
});
