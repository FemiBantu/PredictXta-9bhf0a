/**
 * app/expert-profile/[id].tsx
 *
 * Expert Profile Page — full stats, recent slips, performance chart,
 * follow/unfollow, and comparison CTA.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';

const { width: SW } = Dimensions.get('window');

const TIER_CONFIG = {
  elite:  { label: 'ELITE',  color: '#A855F7', bg: '#A855F714', icon: '👑' },
  gold:   { label: 'GOLD',   color: '#F59E0B', bg: '#F59E0B14', icon: '🥇' },
  silver: { label: 'SILVER', color: '#94A3B8', bg: '#94A3B814', icon: '🥈' },
  bronze: { label: 'BRONZE', color: '#CD7F32', bg: '#CD7F3214', icon: '🥉' },
};

interface ExpertProfile {
  id: string; user_id: string; username: string; avatar_url: string | null;
  tier: string; bio: string | null; sport_specialties: string[];
  accuracy_pct: number; profitability_score: number; roi_pct: number;
  avg_odds: number; total_predictions: number; correct_predictions: number;
  total_slips: number; winning_slips: number; current_streak: number; best_streak: number;
  followers_count: number; overall_rating: number; total_coins_earned: number;
  consistency_score: number; accuracy_score: number; profitability_rating: number;
  support_score: number; activity_score: number; promoted_at: string;
}

interface ExpertSlip {
  id: string; slip_date: string; sport: string; title: string | null;
  total_picks: number; correct_picks: number; accuracy_pct: number | null;
  status: string; coins_awarded: number; profitability_pct: number | null;
}

interface DailyStat {
  stat_date: string; accuracy_pct: number; below_threshold: boolean;
}

// ─── Stat Cell ────────────────────────────────────────────────────────────────
function StatCell({ label, value, color, C }: { label: string; value: string; color?: string; C: any }) {
  return (
    <View style={[cell.wrap, { backgroundColor: C.surface, borderColor: C.border }]}>
      <Text style={[cell.value, { color: color ?? C.primary }]}>{value}</Text>
      <Text style={[cell.label, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}
const cell = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 10, minWidth: 70 },
  value: { fontSize: 16, fontWeight: FONTS.extraBold },
  label: { fontSize: 9, marginTop: 2, textAlign: 'center' },
});

// ─── Rating Bar ───────────────────────────────────────────────────────────────
function RatingBar({ label, value, color, C }: { label: string; value: number; color: string; C: any }) {
  return (
    <View style={{ gap: 4, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 11, color: C.textSecondary }}>{label}</Text>
        <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color }}>{value.toFixed(0)}/100</Text>
      </View>
      <View style={[rb.track, { backgroundColor: C.border }]}>
        <View style={[rb.fill, { width: `${Math.min(100, value)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}
const rb = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});

// ─── Mini Chart ───────────────────────────────────────────────────────────────
function AccuracyChart({ stats, C }: { stats: DailyStat[]; C: any }) {
  const chartW = SW - SPACING.md * 4;
  const barW = Math.max(6, (chartW - (stats.length - 1) * 4) / Math.max(stats.length, 1));

  return (
    <View>
      <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: C.textPrimary, marginBottom: 8 }}>
        Daily Accuracy (Last 14 Days)
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 60 }}>
        {stats.slice(-14).map((stat, i) => {
          const h = Math.max(3, (stat.accuracy_pct / 100) * 60);
          const barColor = stat.accuracy_pct >= 70 ? '#22C55E' : '#EF4444';
          return (
            <View key={i} style={{ alignItems: 'center', gap: 2 }}>
              <View style={{ width: barW, height: h, backgroundColor: barColor, borderRadius: 2, opacity: 0.85 }} />
              {i % 3 === 0 ? (
                <Text style={{ fontSize: 7, color: C.textMuted }}>
                  {stat.stat_date.slice(5)}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#22C55E' }} />
          <Text style={{ fontSize: 9, color: C.textMuted }}>≥70% Good</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#EF4444' }} />
          <Text style={{ fontSize: 9, color: C.textMuted }}>Below threshold</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Slip Card ────────────────────────────────────────────────────────────────
function SlipCard({ slip, C }: { slip: ExpertSlip; C: any }) {
  const router = useRouter();
  const statusColor = slip.status === 'settled'
    ? (slip.accuracy_pct ?? 0) >= 70 ? '#22C55E' : '#EF4444'
    : '#F59E0B';

  return (
    <Pressable
      onPress={() => router.push(`/expert-slip-detail/${slip.id}` as any)}
      style={({ pressed }) => [sc.wrap, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[sc.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[sc.date, { color: C.textMuted }]}>{slip.slip_date}</Text>
        <Text style={[sc.sport, { color: C.textSecondary }]}>· {slip.sport}</Text>
        {slip.title ? <Text style={[sc.title, { color: C.textPrimary }]} numberOfLines={1}>{slip.title}</Text> : null}
        <View style={{ flex: 1 }} />
        {slip.status === 'settled' ? (
          <Text style={[sc.acc, { color: statusColor }]}>{(slip.accuracy_pct ?? 0).toFixed(1)}%</Text>
        ) : (
          <Text style={[sc.acc, { color: '#F59E0B' }]}>Open</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
        <Text style={{ fontSize: 10, color: C.textMuted }}>
          <Text style={{ color: C.textSecondary, fontWeight: FONTS.semiBold }}>{slip.correct_picks}</Text>/{slip.total_picks} correct
        </Text>
        {slip.coins_awarded > 0 ? (
          <Text style={{ fontSize: 10, color: '#F59E0B' }}>🪙 +{slip.coins_awarded}</Text>
        ) : null}
        {slip.profitability_pct !== null ? (
          <Text style={{ fontSize: 10, color: C.textMuted }}>
            Profit: <Text style={{ color: (slip.profitability_pct ?? 0) >= 50 ? '#22C55E' : C.textMuted }}>
              {(slip.profitability_pct ?? 0).toFixed(1)}%
            </Text>
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
const sc = StyleSheet.create({
  wrap: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, marginBottom: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  date: { fontSize: 11 },
  sport: { fontSize: 11 },
  title: { fontSize: 12, fontWeight: FONTS.semiBold, flex: 1 },
  acc: { fontSize: 13, fontWeight: FONTS.extraBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ExpertProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();

  const [expert, setExpert] = useState<ExpertProfile | null>(null);
  const [recentSlips, setRecentSlips] = useState<ExpertSlip[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'slips' | 'stats'>('overview');

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const [profileRes, slipsRes, statsRes, followRes] = await Promise.all([
        supabase.from('expert_profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('expert_slips').select('*').eq('expert_id', id).order('slip_date', { ascending: false }).limit(20),
        supabase.from('expert_daily_stats').select('stat_date, accuracy_pct, below_threshold').eq('expert_id', id).order('stat_date', { ascending: true }).limit(30),
        user?.id ? supabase.from('expert_followers').select('id').eq('expert_id', id).eq('follower_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setExpert(profileRes.data);
      setRecentSlips(slipsRes.data ?? []);
      setDailyStats(statsRes.data ?? []);
      setIsFollowing(!!followRes.data);
    } catch { /* */ } finally { setLoading(false); }
  }, [id, user?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleFollow = async () => {
    if (!user?.id) { router.push('/login' as any); return; }
    if (!expert) return;
    const supabase = getSupabaseClient();
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setExpert(prev => prev ? { ...prev, followers_count: prev.followers_count + (wasFollowing ? -1 : 1) } : prev);

    if (wasFollowing) {
      await supabase.from('expert_followers').delete().eq('expert_id', expert.id).eq('follower_id', user.id);
    } else {
      await supabase.from('expert_followers').insert({ expert_id: expert.id, follower_id: user.id });
      await supabase.from('expert_profiles').update({ followers_count: (expert.followers_count ?? 0) + 1 }).eq('id', expert.id);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}><View style={[s.header, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="arrow-back" size={22} color={C.textPrimary} /></Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Profile</Text>
          <View style={{ width: 32 }} />
        </View></SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  if (!expert) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: C.textMuted }}>Expert not found</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.primary }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const tier = TIER_CONFIG[expert.tier as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.bronze;
  const isOwnProfile = user?.id === expert.user_id;

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Profile</Text>
          <Pressable
            onPress={toggleFollow}
            style={[s.followBtn, { backgroundColor: isFollowing ? `${C.primary}14` : C.primary, borderColor: C.primary }]}
          >
            <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: isFollowing ? C.primary : '#fff' }}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={[s.heroCard, { backgroundColor: C.card, borderColor: `${tier.color}33`, borderBottomColor: C.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
            <View>
              {expert.avatar_url ? (
                <Image source={{ uri: expert.avatar_url }} style={s.avatar} contentFit="cover" />
              ) : (
                <View style={[s.avatar, { backgroundColor: `${tier.color}22`, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 32 }}>{tier.icon}</Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={[s.expertName, { color: C.textPrimary }]}>{expert.username}</Text>
                <View style={[s.tierPill, { backgroundColor: tier.bg, borderColor: `${tier.color}55` }]}>
                  <Text style={[s.tierText, { color: tier.color }]}>{tier.icon} {tier.label}</Text>
                </View>
              </View>
              {expert.bio ? (
                <Text style={[s.bio, { color: C.textSecondary }]} numberOfLines={2}>{expert.bio}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{expert.followers_count}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>Followers</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{expert.total_slips}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>Slips</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: FONTS.extraBold, color: '#F59E0B' }}>{expert.total_coins_earned}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted }}>Coins Earned</Text>
                </View>
              </View>
            </View>
            {/* Rating badge */}
            <View style={[s.ratingBadge, { backgroundColor: `${tier.color}14`, borderColor: `${tier.color}44` }]}>
              <Text style={[s.ratingNum, { color: tier.color }]}>{expert.overall_rating.toFixed(0)}</Text>
              <Text style={[s.ratingLabel, { color: tier.color }]}>Rating</Text>
            </View>
          </View>

          {/* Sport specialties */}
          {expert.sport_specialties?.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}
              contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
              {expert.sport_specialties.map(sp => (
                <View key={sp} style={[s.sportChip, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
                  <Text style={{ fontSize: 10, color: C.primary, fontWeight: FONTS.semiBold }}>
                    {sp.charAt(0).toUpperCase() + sp.slice(1)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {/* Streak & promoted date */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
            {expert.current_streak > 0 ? (
              <View style={[s.streakBadge, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B33' }]}>
                <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: FONTS.bold }}>🔥 {expert.current_streak}-Day Streak</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 10, color: C.textMuted, alignSelf: 'center' }}>
              Expert since {new Date(expert.promoted_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Tab Bar */}
        <View style={[s.tabBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          {(['overview', 'slips', 'stats'] as const).map(tab => (
            <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[s.tabBtn, activeTab === tab ? { borderBottomColor: C.primary, borderBottomWidth: 2 } : null]}>
              <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: activeTab === tab ? C.primary : C.textMuted }}>
                {tab === 'overview' ? 'Overview' : tab === 'slips' ? 'Slips' : 'Stats'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ padding: SPACING.md }}>
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' ? (
            <>
              {/* Key metrics grid */}
              <View style={s.metricsGrid}>
                {[
                  { label: 'Accuracy', value: `${expert.accuracy_pct.toFixed(1)}%`, color: '#22C55E' },
                  { label: 'Profitability', value: `${expert.profitability_score.toFixed(1)}%`, color: C.primary },
                  { label: 'ROI', value: `${expert.roi_pct >= 0 ? '+' : ''}${expert.roi_pct.toFixed(1)}%`, color: expert.roi_pct >= 0 ? '#22C55E' : '#EF4444' },
                  { label: 'Avg Odds', value: expert.avg_odds.toFixed(2), color: '#F59E0B' },
                  { label: 'Predictions', value: String(expert.total_predictions), color: C.textPrimary },
                  { label: 'Correct', value: String(expert.correct_predictions), color: '#22C55E' },
                  { label: 'Best Streak', value: `${expert.best_streak}d`, color: '#F59E0B' },
                  { label: 'Winning Slips', value: `${expert.winning_slips}/${expert.total_slips}`, color: C.primary },
                ].map(m => (
                  <StatCell key={m.label} label={m.label} value={m.value} color={m.color} C={C} />
                ))}
              </View>

              {/* Rating breakdown */}
              <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[s.cardTitle, { color: C.textPrimary }]}>Rating Breakdown</Text>
                <RatingBar label="Accuracy (40%)" value={expert.accuracy_score} color="#22C55E" C={C} />
                <RatingBar label="Profitability (30%)" value={expert.profitability_rating} color={C.primary} C={C} />
                <RatingBar label="Consistency (15%)" value={expert.consistency_score} color="#F59E0B" C={C} />
                <RatingBar label="User Support (10%)" value={expert.support_score} color="#8B5CF6" C={C} />
                <RatingBar label="Activity (5%)" value={expert.activity_score} color="#06B6D4" C={C} />
              </View>

              {/* Daily accuracy chart */}
              {dailyStats.length > 0 ? (
                <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                  <AccuracyChart stats={dailyStats} C={C} />
                </View>
              ) : null}

              {/* CTA if own profile */}
              {isOwnProfile ? (
                <Pressable
                  onPress={() => router.push('/expert-slips' as any)}
                  style={[s.ctaBtn, { backgroundColor: C.primary }]}
                >
                  <FontAwesome5 name="plus" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: FONTS.bold }}>Submit New Slip</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {/* SLIPS TAB */}
          {activeTab === 'slips' ? (
            <>
              {recentSlips.length === 0 ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: C.textMuted, fontSize: 13 }}>No slips submitted yet</Text>
                </View>
              ) : (
                recentSlips.map(slip => <SlipCard key={slip.id} slip={slip} C={C} />)
              )}
            </>
          ) : null}

          {/* STATS TAB */}
          {activeTab === 'stats' ? (
            <>
              {dailyStats.length > 0 ? (
                <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
                  <Text style={[s.cardTitle, { color: C.textPrimary }]}>Daily Performance History</Text>
                  {dailyStats.slice().reverse().slice(0, 14).map(stat => (
                    <View key={stat.stat_date} style={[s.dailyRow, { borderBottomColor: C.border }]}>
                      <Text style={{ fontSize: 11, color: C.textSecondary }}>{stat.stat_date}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={[rb.track, { backgroundColor: C.border }]}>
                          <View style={[rb.fill, { width: `${Math.min(100, stat.accuracy_pct)}%`, backgroundColor: stat.accuracy_pct >= 70 ? '#22C55E' : '#EF4444' }]} />
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: stat.accuracy_pct >= 70 ? '#22C55E' : '#EF4444', width: 42, textAlign: 'right' }}>
                        {stat.accuracy_pct.toFixed(0)}%
                      </Text>
                      {stat.below_threshold ? (
                        <Ionicons name="warning-outline" size={12} color="#F59E0B" />
                      ) : (
                        <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: C.textMuted }}>No daily stats yet</Text>
                </View>
              )}
            </>
          ) : null}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold, flex: 1, textAlign: 'center' },
  followBtn: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  heroCard: { borderBottomWidth: 1, padding: SPACING.md },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  expertName: { fontSize: 18, fontWeight: FONTS.extraBold },
  tierPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  tierText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  bio: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  ratingBadge: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 8, alignItems: 'center', minWidth: 56 },
  ratingNum: { fontSize: 22, fontWeight: FONTS.extraBold },
  ratingLabel: { fontSize: 8, fontWeight: FONTS.bold },
  sportChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  streakBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 13 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: FONTS.bold, marginBottom: 12 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: 8 },
  dailyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
