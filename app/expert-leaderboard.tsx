/**
 * app/expert-leaderboard.tsx
 *
 * Expert Tipster Leaderboard — ranks verified experts by Overall Rating
 * with filters for time period and sport.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpertProfile {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  tier: 'bronze' | 'silver' | 'gold' | 'elite';
  sport_specialties: string[];
  accuracy_pct: number;
  profitability_score: number;
  roi_pct: number;
  avg_odds: number;
  total_predictions: number;
  correct_predictions: number;
  total_slips: number;
  current_streak: number;
  followers_count: number;
  overall_rating: number;
  total_coins_earned: number;
  status: string;
}

const TIME_FILTERS = ['Today', '7 Days', '30 Days', 'All Time'] as const;
const SPORT_FILTERS = ['All Sports', 'Football', 'Basketball', 'Tennis', 'Cricket', 'Baseball', 'Hockey', 'MMA', 'Rugby', 'Esports'] as const;

const TIER_CONFIG = {
  elite:  { label: 'ELITE',  color: '#A855F7', bg: '#A855F714', icon: '👑' },
  gold:   { label: 'GOLD',   color: '#F59E0B', bg: '#F59E0B14', icon: '🥇' },
  silver: { label: 'SILVER', color: '#94A3B8', bg: '#94A3B814', icon: '🥈' },
  bronze: { label: 'BRONZE', color: '#CD7F32', bg: '#CD7F3214', icon: '🥉' },
};

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// ─── Expert Row ───────────────────────────────────────────────────────────────

function ExpertRow({ expert, rank, isFollowing, onFollow, C }: {
  expert: ExpertProfile;
  rank: number;
  isFollowing: boolean;
  onFollow: (expertId: string) => void;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const router = useRouter();
  const tier = TIER_CONFIG[expert.tier] ?? TIER_CONFIG.bronze;
  const medal = RANK_MEDALS[rank];

  return (
    <Pressable
      onPress={() => router.push(`/expert-profile/${expert.id}` as any)}
      style={({ pressed }) => [
        row.wrap,
        { backgroundColor: rank <= 3 ? `${tier.color}08` : C.card, borderColor: rank <= 3 ? `${tier.color}22` : C.border },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      {/* Rank */}
      <View style={row.rankWrap}>
        {medal ? (
          <Text style={{ fontSize: 18 }}>{medal}</Text>
        ) : (
          <Text style={[row.rankNum, { color: C.textMuted }]}>#{rank}</Text>
        )}
      </View>

      {/* Avatar */}
      <View style={row.avatarWrap}>
        {expert.avatar_url ? (
          <Image source={{ uri: expert.avatar_url }} style={row.avatar} contentFit="cover" />
        ) : (
          <View style={[row.avatar, { backgroundColor: `${tier.color}22`, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 18 }}>{tier.icon}</Text>
          </View>
        )}
        <View style={[row.tierDot, { backgroundColor: tier.color }]} />
      </View>

      {/* Info */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[row.name, { color: C.textPrimary }]} numberOfLines={1}>{expert.username}</Text>
          <View style={[row.tierBadge, { backgroundColor: tier.bg, borderColor: `${tier.color}44` }]}>
            <Text style={[row.tierText, { color: tier.color }]}>{tier.label}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 }}>
          <Text style={[row.meta, { color: C.textMuted }]}>
            <Text style={{ color: '#22C55E', fontWeight: FONTS.bold }}>{expert.accuracy_pct.toFixed(1)}%</Text> acc
          </Text>
          <Text style={[row.meta, { color: C.textMuted }]}>
            <Text style={{ color: C.primary, fontWeight: FONTS.bold }}>{expert.overall_rating.toFixed(0)}</Text> rating
          </Text>
          {expert.current_streak > 2 ? (
            <Text style={[row.meta, { color: '#F59E0B' }]}>🔥 {expert.current_streak}d</Text>
          ) : null}
        </View>
      </View>

      {/* Stats column */}
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[row.roi, { color: expert.roi_pct >= 0 ? '#22C55E' : '#EF4444' }]}>
          {expert.roi_pct >= 0 ? '+' : ''}{expert.roi_pct.toFixed(1)}% ROI
        </Text>
        <Text style={[row.meta, { color: C.textMuted }]}>
          {expert.total_predictions} picks · {expert.followers_count} followers
        </Text>
      </View>

      {/* Follow button */}
      <Pressable
        onPress={() => onFollow(expert.id)}
        hitSlop={8}
        style={({ pressed }) => [
          row.followBtn,
          {
            backgroundColor: isFollowing ? `${C.primary}14` : C.primary,
            borderColor: C.primary,
          },
          pressed ? { opacity: 0.75 } : null,
        ]}
      >
        <Ionicons
          name={isFollowing ? 'person-remove-outline' : 'person-add-outline'}
          size={13}
          color={isFollowing ? C.primary : '#fff'}
        />
      </Pressable>
    </Pressable>
  );
}

const row = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 8 },
  rankWrap: { width: 30, alignItems: 'center' },
  rankNum: { fontSize: 13, fontWeight: FONTS.bold },
  avatarWrap: { position: 'relative' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  tierDot: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#fff' },
  name: { fontSize: 13, fontWeight: FONTS.bold, maxWidth: 100 },
  tierBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  tierText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  meta: { fontSize: 10 },
  roi: { fontSize: 11, fontWeight: FONTS.bold },
  followBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ─── Top 3 Podium ─────────────────────────────────────────────────────────────

function PodiumCard({ expert, rank, C }: {
  expert: ExpertProfile;
  rank: 1 | 2 | 3;
  C: ReturnType<typeof useTheme>['colors'];
}) {
  const router = useRouter();
  const tier = TIER_CONFIG[expert.tier] ?? TIER_CONFIG.bronze;
  const heights = { 1: 90, 2: 70, 3: 60 } as const;
  const podiumH = heights[rank];

  return (
    <Pressable
      onPress={() => router.push(`/expert-profile/${expert.id}` as any)}
      style={{ alignItems: 'center', flex: rank === 1 ? 1.2 : 1 }}
    >
      <View style={[podium.medalWrap, { borderColor: `${tier.color}55`, backgroundColor: `${tier.color}12` }]}>
        {expert.avatar_url ? (
          <Image source={{ uri: expert.avatar_url }} style={podium.avatar} contentFit="cover" />
        ) : (
          <View style={[podium.avatar, { backgroundColor: `${tier.color}22`, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: rank === 1 ? 26 : 20 }}>{tier.icon}</Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 20, marginTop: 4 }}>{RANK_MEDALS[rank]}</Text>
      <Text style={[podium.name, { color: C.textPrimary, fontSize: rank === 1 ? 14 : 12 }]} numberOfLines={1}>
        {expert.username}
      </Text>
      <Text style={[podium.rating, { color: tier.color }]}>{expert.overall_rating.toFixed(0)} pts</Text>
      <Text style={[podium.acc, { color: C.textMuted }]}>{expert.accuracy_pct.toFixed(1)}% acc</Text>
      <View style={[podium.base, { height: podiumH, backgroundColor: `${tier.color}22`, borderColor: `${tier.color}44` }]}>
        <Text style={[podium.baseRank, { color: tier.color }]}>#{rank}</Text>
      </View>
    </Pressable>
  );
}

const podium = StyleSheet.create({
  medalWrap: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, overflow: 'hidden' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  name: { fontWeight: FONTS.bold, marginTop: 2, maxWidth: 80, textAlign: 'center' },
  rating: { fontSize: 11, fontWeight: FONTS.extraBold, marginTop: 1 },
  acc: { fontSize: 9, marginTop: 1 },
  base: { width: '100%', borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  baseRank: { fontSize: 16, fontWeight: FONTS.extraBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ExpertLeaderboardScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [experts, setExperts] = useState<ExpertProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeFilter, setTimeFilter] = useState<typeof TIME_FILTERS[number]>('All Time');
  const [sportFilter, setSportFilter] = useState<typeof SPORT_FILTERS[number]>('All Sports');
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());

  const fetchExperts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('expert_profiles')
        .select('*')
        .eq('status', 'active')
        .order('overall_rating', { ascending: false })
        .limit(50);

      if (sportFilter !== 'All Sports') {
        query = query.contains('sport_specialties', [sportFilter.toLowerCase()]);
      }

      const { data } = await query;
      setExperts(data ?? []);

      // Fetch following state
      if (user?.id) {
        const { data: follows } = await supabase
          .from('expert_followers')
          .select('expert_id')
          .eq('follower_id', user.id);
        setFollowingSet(new Set((follows ?? []).map(f => f.expert_id)));
      }
    } catch { /* non-blocking */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sportFilter, user?.id]);

  useEffect(() => { fetchExperts(); }, [fetchExperts]);

  const toggleFollow = useCallback(async (expertId: string) => {
    if (!user?.id) { router.push('/login' as any); return; }
    const supabase = getSupabaseClient();
    const isNowFollowing = followingSet.has(expertId);

    setFollowingSet(prev => {
      const next = new Set(prev);
      isNowFollowing ? next.delete(expertId) : next.add(expertId);
      return next;
    });
    setExperts(prev => prev.map(e => e.id === expertId
      ? { ...e, followers_count: e.followers_count + (isNowFollowing ? -1 : 1) }
      : e));

    if (isNowFollowing) {
      await supabase.from('expert_followers')
        .delete()
        .eq('expert_id', expertId)
        .eq('follower_id', user.id);
    } else {
      await supabase.from('expert_followers').insert({ expert_id: expertId, follower_id: user.id });
    }
    await supabase.from('expert_profiles')
      .update({ followers_count: experts.find(e => e.id === expertId)?.followers_count ?? 0 })
      .eq('id', expertId);
  }, [user?.id, followingSet, experts]);

  const top3 = experts.slice(0, 3);
  const rest = experts.slice(3);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Leaderboard</Text>
            <Text style={{ fontSize: 11, color: C.textMuted }}>Top Verified Tipsters</Text>
          </View>
          <Pressable
            onPress={() => router.push('/expert-slips' as any)}
            style={[s.headerBtn, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}
          >
            <FontAwesome5 name="plus" size={11} color={C.primary} />
            <Text style={{ fontSize: 11, color: C.primary, fontWeight: FONTS.bold }}>Slip</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchExperts(true)} tintColor={C.primary} />}
      >
        {/* Time Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {TIME_FILTERS.map(f => (
            <Pressable
              key={f}
              onPress={() => setTimeFilter(f)}
              style={[s.chip, { backgroundColor: timeFilter === f ? C.primary : C.surface, borderColor: timeFilter === f ? C.primary : C.border }]}
            >
              <Text style={{ fontSize: 12, fontWeight: FONTS.semiBold, color: timeFilter === f ? '#fff' : C.textSecondary }}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Sport Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.filterRow, { paddingTop: 0 }]}>
          {SPORT_FILTERS.map(f => (
            <Pressable
              key={f}
              onPress={() => setSportFilter(f)}
              style={[s.chip, { backgroundColor: sportFilter === f ? `${C.primary}18` : 'transparent', borderColor: sportFilter === f ? C.primary : 'transparent', paddingHorizontal: 10, paddingVertical: 5 }]}
            >
              <Text style={{ fontSize: 11, color: sportFilter === f ? C.primary : C.textMuted, fontWeight: sportFilter === f ? FONTS.bold : FONTS.normal }}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={{ color: C.textMuted, marginTop: 12 }}>Loading experts...</Text>
          </View>
        ) : experts.length === 0 ? (
          <View style={{ padding: 48, alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 40 }}>🏆</Text>
            <Text style={{ color: C.textPrimary, fontSize: 16, fontWeight: FONTS.bold }}>No Experts Yet</Text>
            <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Be the first! Achieve 100% accuracy for 3 consecutive days in Daily Challenge.
            </Text>
          </View>
        ) : (
          <>
            {/* Podium - Top 3 */}
            {top3.length >= 3 ? (
              <View style={[s.podiumSection, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[s.podiumTitle, { color: C.textPrimary }]}>🏆 Top Experts</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, gap: 4 }}>
                  {top3[1] ? <PodiumCard expert={top3[1]} rank={2} C={C} /> : null}
                  {top3[0] ? <PodiumCard expert={top3[0]} rank={1} C={C} /> : null}
                  {top3[2] ? <PodiumCard expert={top3[2]} rank={3} C={C} /> : null}
                </View>
              </View>
            ) : null}

            {/* Stats summary */}
            <View style={[s.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
              {[
                { label: 'Active Experts', value: String(experts.length), color: C.primary },
                { label: 'Avg Accuracy', value: `${(experts.reduce((s, e) => s + e.accuracy_pct, 0) / experts.length).toFixed(1)}%`, color: '#22C55E' },
                { label: 'Top ROI', value: experts.length > 0 ? `${Math.max(...experts.map(e => e.roi_pct)).toFixed(1)}%` : '—', color: '#F59E0B' },
              ].map(stat => (
                <View key={stat.label} style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: FONTS.extraBold, color: stat.color }}>{stat.value}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {/* Full Rankings */}
            <View style={s.rankSection}>
              <Text style={[s.sectionTitle, { color: C.textPrimary }]}>Full Rankings</Text>
              {experts.map((expert, idx) => (
                <ExpertRow
                  key={expert.id}
                  expert={expert}
                  rank={idx + 1}
                  isFollowing={followingSet.has(expert.id)}
                  onFollow={toggleFollow}
                  C={C}
                />
              ))}
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  filterRow: { paddingHorizontal: SPACING.md, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  chip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  podiumSection: { margin: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, padding: 16 },
  podiumTitle: { fontSize: 14, fontWeight: FONTS.bold, textAlign: 'center', marginBottom: 16 },
  statsRow: { flexDirection: 'row', marginHorizontal: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  rankSection: { paddingHorizontal: SPACING.md },
  sectionTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: 10 },
});
