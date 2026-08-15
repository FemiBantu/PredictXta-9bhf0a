/**
 * app/admin-experts.tsx
 *
 * Admin Expert Management Dashboard — view all experts, suspend/reinstate,
 * monitor performance, review fraud flags, and export data.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { getSupabaseClient, useAuth, useAlert } from '@/template';
import { useAdminRole } from '@/hooks/useAdminRole';
import { FunctionsHttpError } from '@supabase/supabase-js';

const TIER_CONFIG = {
  elite:  { label: 'ELITE',  color: '#A855F7' },
  gold:   { label: 'GOLD',   color: '#F59E0B' },
  silver: { label: 'SILVER', color: '#94A3B8' },
  bronze: { label: 'BRONZE', color: '#CD7F32' },
};

interface Expert {
  id: string; user_id: string; username: string; avatar_url: string | null;
  tier: string; status: string; accuracy_pct: number; overall_rating: number;
  total_slips: number; total_predictions: number; followers_count: number;
  total_coins_earned: number; consecutive_below_threshold: number;
  promoted_at: string; last_active_at: string;
}

interface ExpertWarning {
  id: string; warning_date: string; accuracy_pct: number; consecutive_days: number; reason: string;
}

function ExpertCard({ expert, onAction, C }: {
  expert: Expert;
  onAction: (expertId: string, action: 'suspend' | 'reinstate' | 'recalculate') => void;
  C: any;
}) {
  const tier = TIER_CONFIG[expert.tier as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.bronze;
  const statusColor = expert.status === 'active' ? '#22C55E' : expert.status === 'suspended' ? '#F59E0B' : '#EF4444';

  return (
    <View style={[ec.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        {expert.avatar_url ? (
          <Image source={{ uri: expert.avatar_url }} style={ec.avatar} contentFit="cover" />
        ) : (
          <View style={[ec.avatar, { backgroundColor: `${tier.color}22`, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 18 }}>👤</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={[ec.name, { color: C.textPrimary }]}>{expert.username}</Text>
            <View style={[ec.tierBadge, { backgroundColor: `${tier.color}14`, borderColor: `${tier.color}44` }]}>
              <Text style={[ec.tierText, { color: tier.color }]}>{tier.label}</Text>
            </View>
            <View style={[ec.statusBadge, { backgroundColor: `${statusColor}14`, borderColor: `${statusColor}33` }]}>
              <Text style={[ec.statusText, { color: statusColor }]}>{expert.status.toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            {[
              { label: 'Rating', value: expert.overall_rating.toFixed(0), color: tier.color },
              { label: 'Accuracy', value: `${expert.accuracy_pct.toFixed(1)}%`, color: '#22C55E' },
              { label: 'Slips', value: String(expert.total_slips), color: C.primary },
              { label: 'Followers', value: String(expert.followers_count), color: C.textSecondary },
              { label: 'Coins', value: String(expert.total_coins_earned), color: '#F59E0B' },
            ].map(m => (
              <View key={m.label}>
                <Text style={{ fontSize: 12, fontWeight: FONTS.bold, color: m.color }}>{m.value}</Text>
                <Text style={{ fontSize: 9, color: C.textMuted }}>{m.label}</Text>
              </View>
            ))}
          </View>
          {expert.consecutive_below_threshold > 0 ? (
            <View style={[ec.warningBadge, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B33' }]}>
              <Ionicons name="warning-outline" size={11} color="#F59E0B" />
              <Text style={{ fontSize: 10, color: '#F59E0B', fontWeight: FONTS.semiBold }}>
                {expert.consecutive_below_threshold}/3 warnings
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {expert.status === 'active' ? (
          <Pressable
            onPress={() => onAction(expert.id, 'suspend')}
            style={({ pressed }) => [ec.actionBtn, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B33' }, pressed ? { opacity: 0.75 } : null]}
          >
            <Text style={{ fontSize: 11, color: '#F59E0B', fontWeight: FONTS.semiBold }}>Suspend</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onAction(expert.id, 'reinstate')}
            style={({ pressed }) => [ec.actionBtn, { backgroundColor: '#22C55E14', borderColor: '#22C55E33' }, pressed ? { opacity: 0.75 } : null]}
          >
            <Text style={{ fontSize: 11, color: '#22C55E', fontWeight: FONTS.semiBold }}>Reinstate</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onAction(expert.id, 'recalculate')}
          style={({ pressed }) => [ec.actionBtn, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }, pressed ? { opacity: 0.75 } : null]}
        >
          <Ionicons name="refresh" size={11} color={C.primary} />
          <Text style={{ fontSize: 11, color: C.primary, fontWeight: FONTS.semiBold }}>Recalc</Text>
        </Pressable>
        <Text style={{ fontSize: 9, color: C.textMuted, alignSelf: 'center', flex: 1, textAlign: 'right' }}>
          Active {new Date(expert.last_active_at).toLocaleDateString()}
        </Text>
      </View>
    </View>
  );
}

const ec = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontSize: 14, fontWeight: FONTS.bold },
  tierBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  tierText: { fontSize: 8, fontWeight: FONTS.extraBold },
  statusBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 8, fontWeight: FONTS.extraBold },
  warningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, alignSelf: 'flex-start' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
});

export default function AdminExpertsScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { isAdmin, loading: adminLoading } = useAdminRole(user?.id);

  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'removed'>('all');
  const [stats, setStats] = useState({ total: 0, active: 0, suspended: 0, removed: 0, totalCoins: 0 });

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('expert_profiles')
        .select('*')
        .order('overall_rating', { ascending: false });
      const all = data ?? [];
      setExperts(all);
      setStats({
        total: all.length,
        active: all.filter(e => e.status === 'active').length,
        suspended: all.filter(e => e.status === 'suspended').length,
        removed: all.filter(e => e.status === 'removed').length,
        totalCoins: all.reduce((s, e) => s + (e.total_coins_earned ?? 0), 0),
      });
    } catch { /* */ } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = useCallback(async (expertId: string, action: 'suspend' | 'reinstate' | 'recalculate') => {
    const supabase = getSupabaseClient();

    if (action === 'recalculate') {
      const { error } = await supabase.functions.invoke('expert-promotion', {
        body: { action: 'recalculate', expert_id: expertId },
      });
      if (error) { showAlert('Error', 'Recalculation failed'); return; }
      showAlert('Done', 'Stats recalculated');
      fetchData(true);
      return;
    }

    const newStatus = action === 'suspend' ? 'suspended' : 'active';
    const { error } = await supabase.from('expert_profiles')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', expertId);
    if (error) { showAlert('Error', error.message); return; }
    setExperts(prev => prev.map(e => e.id === expertId ? { ...e, status: newStatus } : e));
    showAlert('Done', `Expert ${action}d successfully`);
  }, [fetchData]);

  const triggerDailyReview = async () => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.functions.invoke('expert-promotion', {
      body: { action: 'daily_review' },
    });
    if (error) { showAlert('Error', 'Daily review failed'); return; }
    showAlert('Done', 'Daily review completed');
    fetchData(true);
  };

  const triggerSettleDaily = async () => {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const { data: result, error } = await supabase.functions.invoke('expert-promotion', {
      body: { action: 'settle_daily', date: today },
    });
    if (error) {
      let msg = error.message;
      try { if (error instanceof FunctionsHttpError) msg = await error.context?.text() ?? msg; } catch { /* */ }
      showAlert('Error', msg); return;
    }
    showAlert('Settled', `${result?.picksSettled ?? 0} picks · ${result?.slipsSettled ?? 0} slips settled`);
    fetchData(true);
  };

  const filtered = experts.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (search && !e.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (adminLoading || loading) {
    return (
      <View style={[s.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']}><View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="arrow-back" size={22} color={C.textPrimary} /></Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Management</Text>
          <View style={{ width: 32 }} />
        </View></SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={C.primary} /></View>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <Ionicons name="lock-closed" size={48} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: 15 }}>Admin access required</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: C.primary }}>Go Back</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.headerTitle, { color: C.textPrimary }]}>Expert Management</Text>
          <Pressable onPress={() => fetchData(true)} hitSlop={8} disabled={refreshing}>
            {refreshing ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="refresh" size={20} color={C.primary} />}
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={C.primary} />}
      >
        {/* Stats overview */}
        <View style={[s.statsGrid, { backgroundColor: C.card, borderColor: C.border }]}>
          {[
            { label: 'Total', value: stats.total, color: C.primary },
            { label: 'Active', value: stats.active, color: '#22C55E' },
            { label: 'Suspended', value: stats.suspended, color: '#F59E0B' },
            { label: 'Removed', value: stats.removed, color: '#EF4444' },
            { label: 'Coins Paid', value: stats.totalCoins, color: '#F59E0B' },
          ].map(m => (
            <View key={m.label} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: m.color }}>{m.value}</Text>
              <Text style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={{ paddingHorizontal: SPACING.md, paddingBottom: 8, flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={triggerDailyReview}
            style={({ pressed }) => [s.actionBtn, { backgroundColor: C.primary }, pressed ? { opacity: 0.8 } : null]}
          >
            <Ionicons name="analytics-outline" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: FONTS.bold }}>Run Daily Review</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/expert-leaderboard' as any)}
            style={({ pressed }) => [s.actionBtn, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33`, borderWidth: 1 }, pressed ? { opacity: 0.8 } : null]}
          >
            <Ionicons name="trophy-outline" size={14} color={C.primary} />
            <Text style={{ color: C.primary, fontSize: 12, fontWeight: FONTS.bold }}>Leaderboard</Text>
          </Pressable>
          <Pressable
            onPress={triggerSettleDaily}
            style={({ pressed }) => [s.actionBtn, { backgroundColor: '#22C55E14', borderColor: '#22C55E33', borderWidth: 1 }, pressed ? { opacity: 0.8 } : null]}
          >
            <Ionicons name="checkmark-done-outline" size={14} color="#22C55E" />
            <Text style={{ color: '#22C55E', fontSize: 12, fontWeight: FONTS.bold }}>Settle Daily</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={[s.searchWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Ionicons name="search" size={15} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search experts..."
            style={[s.searchInput, { color: C.textPrimary }]}
            placeholderTextColor={C.textMuted}
          />
        </View>

        {/* Status filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {(['all', 'active', 'suspended', 'removed'] as const).map(f => (
            <Pressable
              key={f}
              onPress={() => setStatusFilter(f)}
              style={[s.chip, { backgroundColor: statusFilter === f ? C.primary : C.surface, borderColor: statusFilter === f ? C.primary : C.border }]}
            >
              <Text style={{ fontSize: 12, color: statusFilter === f ? '#fff' : C.textSecondary, fontWeight: FONTS.semiBold }}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Expert list */}
        <View style={{ paddingHorizontal: SPACING.md }}>
          {filtered.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ color: C.textMuted, fontSize: 14 }}>No experts found</Text>
            </View>
          ) : (
            filtered.map(expert => (
              <ExpertCard key={expert.id} expert={expert} onAction={handleAction} C={C} />
            ))
          )}
        </View>
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold, flex: 1 },
  statsGrid: { flexDirection: 'row', margin: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.md, marginBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 13 },
  filterRow: { paddingHorizontal: SPACING.md, paddingBottom: 10, gap: 8, flexDirection: 'row' },
  chip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
});
