/**
 * Admin Panel — Full-featured production dashboard
 *
 * Tabs: Overview · Users · Admins · Experts · Tips · Rooms · Matches · API Monitor
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList,
  ActivityIndicator, TextInput, ScrollView, RefreshControl,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { getSupabaseClient, useAlert, useAuth } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import {
  fetchApiUsageStats,
  triggerFetchOdds,
  triggerSyncStandings,
  triggerFetchMatches,
  type ApiUsageStat,
} from '@/services/oddsService';
import {
  triggerLiveSync,
  triggerFixtureSync,
  triggerOddsSync,
  triggerStandingsSync,
  triggerHighlightsSync,
} from '@/services/feedService';
import {
  getProviderHealth,
  getDbTableStats,
  clearAllFeedCaches,
  getLastUpdatedLabel,
  type ProviderHealth,
  type TableStat,
} from '@/services/feedEngine';
import { checkFirebaseStatus } from '@/services/firebaseService';
import { useAdminRole, clearAdminRoleCache } from '@/hooks/useAdminRole';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AdminUser { id: string; email: string; username: string; createdAt: string; }
interface AdminRole {
  id: string; userId: string; email: string; username: string;
  role: 'main_admin' | 'admin' | 'expert';
  permissions: { manage_users: boolean; manage_matches: boolean; manage_tips: boolean; broadcast: boolean; };
  isActive: boolean; createdAt: string;
}
interface ExpertTip {
  id: string; expertId: string; expertName: string; sport: string;
  matchLabel: string; tipType: string; tipValue: string;
  odds: number | null; confidence: number; analysis: string | null;
  status: 'pending' | 'won' | 'lost' | 'void'; league: string | null;
  isPremium: boolean; likes: number; createdAt: string;
}
interface AdminRoom { id: string; name: string; emoji: string; type: string; membersCount: number; createdAt: string; }
interface AdminMatch {
  id: string; homeTeam: string; awayTeam: string;
  homeScore: number; awayScore: number;
  status: 'upcoming' | 'live' | 'finished';
  minute: number; league: string; sport: string; matchTime: string;
}

type Tab = 'overview' | 'users' | 'admins' | 'experts' | 'tips' | 'rooms' | 'matches' | 'api' | 'translations' | 'sync' | 'feedhealth';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview',     label: 'Overview',     icon: '📊' },
  { id: 'users',        label: 'Users',        icon: '👥' },
  { id: 'admins',       label: 'Admins',       icon: '🛡️' },
  { id: 'experts',      label: 'Experts',      icon: '⭐' },
  { id: 'tips',         label: 'Tips',         icon: '💡' },
  { id: 'rooms',        label: 'Rooms',        icon: '💬' },
  { id: 'matches',      label: 'Matches',      icon: '⚽' },
  { id: 'api',          label: 'API',          icon: '🔌' },
  { id: 'translations', label: 'Translations', icon: '🌍' },
  { id: 'sync',         label: 'Sync',         icon: '🔄' },
  { id: 'feedhealth',   label: 'Feed Health',  icon: '🩺' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function statusColor(status: string, C: AppColors) {
  if (status === 'live') return C.accent;
  if (status === 'finished') return C.textMuted;
  return C.primary;
}
function statusBg(status: string, C: AppColors) {
  if (status === 'live') return `${C.accent}18`;
  if (status === 'finished') return C.surface;
  return C.primaryGlow;
}
function tipStatusColor(status: string, C: AppColors) {
  if (status === 'won') return '#22C55E';
  if (status === 'lost') return C.accentRed;
  if (status === 'void') return C.textMuted;
  return C.accent;
}
function roleColor(role: string, C: AppColors) {
  if (role === 'main_admin') return '#EF4444';
  if (role === 'admin') return C.primary;
  return '#F59E0B';
}
function roleLabel(role: string) {
  if (role === 'main_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  return 'Expert';
}
function roleBadgeLabel(role: string) {
  if (role === 'main_admin') return 'SUPER ADMIN';
  if (role === 'admin') return 'ADMIN';
  return 'EXPERT';
}

// ─── DB Fetchers ──────────────────────────────────────────────────────────────
async function fetchAdminUsers(): Promise<AdminUser[]> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('user_profiles').select('id, email, username, created_at').order('created_at', { ascending: false }).limit(100);
    return (data ?? []).map((r: any) => ({ id: r.id, email: r.email, username: r.username || 'No username', createdAt: r.created_at }));
  } catch { return []; }
}
async function fetchAdminRoles(): Promise<AdminRole[]> {
  try {
    const sb = getSupabaseClient();
    const { data: roles } = await sb.from('admin_roles').select('id, user_id, role, permissions, is_active, created_at').order('created_at', { ascending: false });
    if (!roles || roles.length === 0) return [];
    const userIds = roles.map((r: any) => r.user_id);
    const { data: profiles } = await sb.from('user_profiles').select('id, email, username').in('id', userIds);
    const pm: Record<string, { email: string; username: string }> = {};
    (profiles ?? []).forEach((p: any) => { pm[p.id] = { email: p.email, username: p.username || 'No username' }; });
    return (roles as any[]).map((r) => ({
      id: r.id, userId: r.user_id, email: pm[r.user_id]?.email ?? '', username: pm[r.user_id]?.username ?? 'Unknown',
      role: r.role, permissions: r.permissions ?? { manage_users: false, manage_matches: false, manage_tips: false, broadcast: false },
      isActive: r.is_active ?? true, createdAt: r.created_at,
    }));
  } catch { return []; }
}
async function fetchExpertTips(): Promise<ExpertTip[]> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('expert_tips').select('*').order('created_at', { ascending: false }).limit(100);
    return (data ?? []).map((r: any) => ({
      id: r.id, expertId: r.expert_id, expertName: r.expert_name, sport: r.sport, matchLabel: r.match_label,
      tipType: r.tip_type, tipValue: r.tip_value, odds: r.odds ? Number(r.odds) : null, confidence: Number(r.confidence ?? 70),
      analysis: r.analysis ?? null, status: r.status, league: r.league ?? null, isPremium: r.is_premium ?? false,
      likes: Number(r.likes ?? 0), createdAt: r.created_at,
    }));
  } catch { return []; }
}
async function fetchAdminRooms(): Promise<AdminRoom[]> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('chat_rooms').select('id, name, emoji, type, members_count, created_at').order('created_at', { ascending: false });
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, emoji: r.emoji || '💬', type: r.type || 'public', membersCount: Number(r.members_count ?? 0), createdAt: r.created_at }));
  } catch { return []; }
}
async function fetchAdminMatches(): Promise<AdminMatch[]> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('matches').select('id, home_team, away_team, home_score, away_score, status, minute, league, sport, match_time').order('match_time', { ascending: false }).limit(100);
    return (data ?? []).map((r: any) => ({
      id: r.id, homeTeam: r.home_team, awayTeam: r.away_team, homeScore: Number(r.home_score ?? 0), awayScore: Number(r.away_score ?? 0),
      status: r.status ?? 'upcoming', minute: Number(r.minute ?? 0), league: r.league ?? '', sport: r.sport ?? 'football', matchTime: r.match_time,
    }));
  } catch { return []; }
}
async function broadcastNotification(title: string, body: string): Promise<{ count: number; error: string | null }> {
  try {
    const sb = getSupabaseClient();
    const { data: users } = await sb.from('user_profiles').select('id');
    if (!users || users.length === 0) return { count: 0, error: 'No users found' };
    const rows = (users as any[]).map((u) => ({ user_id: u.id, title, body, type: 'system', read: false }));
    const { error } = await sb.from('notifications').insert(rows);
    if (error) return { count: 0, error: error.message };
    return { count: rows.length, error: null };
  } catch (e) { return { count: 0, error: String(e) }; }
}
async function updateMatch(id: string, payload: { home_score: number; away_score: number; status: string; minute: number }): Promise<string | null> {
  try {
    const { error } = await getSupabaseClient().from('matches').update(payload).eq('id', id);
    return error ? error.message : null;
  } catch (e) { return String(e); }
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ C }: { C: AppColors }) {
  const router = useRouter();
  const [stats, setStats] = useState({ users: 0, admins: 0, experts: 0, tips: 0, matches: 0, rooms: 0, liveMatches: 0, predictions: 0, pendingReports: 0, oddsCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = getSupabaseClient();
      const [users, roles, tips, matches, liveMatches, rooms, reports, preds, odds] = await Promise.allSettled([
        sb.from('user_profiles').select('id', { count: 'exact', head: true }),
        sb.from('admin_roles').select('id, role', { count: 'exact' }),
        sb.from('expert_tips').select('id', { count: 'exact', head: true }),
        sb.from('matches').select('id', { count: 'exact', head: true }),
        sb.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live'),
        sb.from('chat_rooms').select('id', { count: 'exact', head: true }),
        sb.from('reported_messages').select('id', { count: 'exact', head: true }),
        sb.from('predictions').select('id', { count: 'exact', head: true }),
        sb.from('odds').select('id', { count: 'exact', head: true }),
      ]);
      const rolesData = roles.status === 'fulfilled' ? (roles.value.data ?? []) : [];
      setStats({
        users: users.status === 'fulfilled' ? (users.value.count ?? 0) : 0,
        admins: rolesData.filter((r: any) => r.role === 'admin' || r.role === 'main_admin').length,
        experts: rolesData.filter((r: any) => r.role === 'expert').length,
        tips: tips.status === 'fulfilled' ? (tips.value.count ?? 0) : 0,
        matches: matches.status === 'fulfilled' ? (matches.value.count ?? 0) : 0,
        liveMatches: liveMatches.status === 'fulfilled' ? (liveMatches.value.count ?? 0) : 0,
        rooms: rooms.status === 'fulfilled' ? (rooms.value.count ?? 0) : 0,
        pendingReports: reports.status === 'fulfilled' ? (reports.value.count ?? 0) : 0,
        predictions: preds.status === 'fulfilled' ? (preds.value.count ?? 0) : 0,
        oddsCount: odds.status === 'fulfilled' ? (odds.value.count ?? 0) : 0,
      });
      setLoading(false);
    })();
  }, []);

  const cards = [
    { label: 'Total Users', value: stats.users, icon: 'people-outline', color: C.primary },
    { label: 'Live Matches', value: stats.liveMatches, icon: 'pulse-outline', color: C.accent },
    { label: 'Total Matches', value: stats.matches, icon: 'football-outline', color: C.accentBlue },
    { label: 'AI Predictions', value: stats.predictions, icon: 'brain-outline' as any, color: C.accentPurple },
    { label: 'Odds Records', value: stats.oddsCount, icon: 'trending-up-outline', color: '#22C55E' },
    { label: 'Expert Tips', value: stats.tips, icon: 'bulb-outline', color: '#F59E0B' },
    { label: 'Chat Rooms', value: stats.rooms, icon: 'chatbubbles-outline', color: C.accentBlue },
    { label: 'Pending Reports', value: stats.pendingReports, icon: 'flag-outline', color: '#EF4444' },
    { label: 'Admins', value: stats.admins, icon: 'shield-outline', color: '#EF4444' },
    { label: 'Experts', value: stats.experts, icon: 'star-outline', color: '#F59E0B' },
  ];

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SPACING.md, gap: 12 }}>
      <Text style={[ov.sectionTitle, { color: C.textPrimary }]}>Platform Overview</Text>
      <View style={ov.grid}>
        {cards.map((card) => (
          <View key={card.label} style={[ov.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={[ov.iconCircle, { backgroundColor: `${card.color}18`, borderColor: `${card.color}33` }]}>
              <Ionicons name={card.icon as any} size={22} color={card.color} />
            </View>
            <Text style={[ov.cardValue, { color: C.textPrimary }]}>{card.value.toLocaleString()}</Text>
            <Text style={[ov.cardLabel, { color: C.textMuted }]}>{card.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[ov.sectionTitle, { color: C.textPrimary, marginTop: 8 }]}>Quick Actions</Text>
      <View style={ov.actionsGrid}>
        {[
          { label: 'Post a Tip', icon: 'bulb-outline', color: '#22C55E', route: '/admin-tips' },
          { label: 'Add Expert', icon: 'star-outline', color: '#F59E0B', route: null },
          { label: 'Add Admin', icon: 'shield-outline', color: '#EF4444', route: null },
          { label: 'Pipeline', icon: 'pulse-outline', color: C.accentPurple, route: '/admin-pipeline' },
          { label: 'AI Audit', icon: 'analytics-outline', color: '#6366F1', route: '/admin-ai-audit' },
          { label: 'Chat Rooms', icon: 'chatbubbles-outline', color: '#3B82F6', route: '/admin-chat' },
          { label: 'Coverage Tests', icon: 'shield-checkmark-outline', color: '#22C55E', route: '/sport-coverage-test' },
          { label: 'Audit Report', icon: 'analytics-outline', color: '#8B5CF6', route: '/audit-report' },
          { label: 'Deploy Checklist', icon: 'rocket-outline', color: '#22C55E', route: '/deployment-checklist' },
          { label: 'Data Integrity', icon: 'shield-checkmark-outline', color: '#22C55E', route: '/admin-data-integrity' },
          { label: 'OAuth Debug', icon: 'logo-google', color: '#4285F4', route: '/oauth-debug' },
        ].map((a) => (
          <Pressable key={a.label} style={({ pressed }) => [ov.actionCard, { backgroundColor: `${a.color}12`, borderColor: `${a.color}33` }, pressed ? { opacity: 0.8 } : null]}
            onPress={() => a.route ? router.push(a.route as any) : null}>
            <Ionicons name={a.icon as any} size={20} color={a.color} />
            <Text style={[ov.actionLabel, { color: a.color }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
const ov = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: FONTS.bold, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '47%', flexGrow: 1, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 6, alignItems: 'flex-start' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cardValue: { fontSize: 24, fontWeight: FONTS.extraBold },
  cardLabel: { fontSize: 12, fontWeight: FONTS.medium },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { flex: 1, minWidth: '44%', borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  actionLabel: { fontSize: 12, fontWeight: FONTS.bold, textAlign: 'center' },
});

// ─── API Monitor Tab ──────────────────────────────────────────────────────────
function ApiMonitorTab({ C }: { C: AppColors }) {
  const { showAlert } = useAlert();
  const [stats, setStats] = useState<ApiUsageStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    const data = await fetchApiUsageStats(days);
    setStats(data);
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Aggregate by provider
  const byProvider = useMemo(() => {
    const map: Record<string, { totalReqs: number; totalSuccess: number; totalErrors: number; lastCalled: string; lastError: string | null }> = {};
    for (const s of stats) {
      if (!map[s.providerName]) map[s.providerName] = { totalReqs: 0, totalSuccess: 0, totalErrors: 0, lastCalled: s.lastCalled, lastError: s.lastError };
      map[s.providerName].totalReqs += s.requestCount;
      map[s.providerName].totalSuccess += s.successCount;
      map[s.providerName].totalErrors += s.errorCount;
      if (s.lastCalled > map[s.providerName].lastCalled) map[s.providerName].lastCalled = s.lastCalled;
      if (s.lastError) map[s.providerName].lastError = s.lastError;
    }
    return Object.entries(map);
  }, [stats]);

  const handleAction = async (action: 'matches' | 'odds' | 'standings') => {
    setRunning(action);
    let result: { success: boolean; message: string };
    if (action === 'matches') result = await triggerFetchMatches('today', 'all');
    else if (action === 'odds') result = await triggerFetchOdds('today');
    else result = await triggerSyncStandings();

    setRunning(null);
    showAlert(result.success ? 'Success' : 'Error', result.message);
    if (result.success) { await load(); }
  };

  const providerColor: Record<string, string> = {
    'api-football': '#EF4444',
    'api-sports': '#F59E0B',
    'thesportsdb': '#22C55E',
    'highlightly': C.accentBlue,
  };

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SPACING.md, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}>

      {/* Control Panel */}
      <View style={[api.section, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={api.sectionHeader}>
          <Ionicons name="settings-outline" size={16} color={C.primary} />
          <Text style={[api.sectionTitle, { color: C.textPrimary }]}>Data Controls</Text>
        </View>
        <Text style={[api.sectionSub, { color: C.textMuted }]}>Manually trigger data sync operations. These run automatically on schedule.</Text>

        <View style={api.controlGrid}>
          {[
            { key: 'matches', label: 'Fetch Matches', sub: 'All sports · Today', icon: 'football-outline', color: C.primary },
            { key: 'odds', label: 'Fetch Odds', sub: 'API-Football · Today', icon: 'trending-up-outline', color: '#22C55E' },
            { key: 'standings', label: 'Sync Standings', sub: 'Top 9 leagues', icon: 'podium-outline', color: C.accentBlue },
          ].map((ctrl) => {
            const isRunning = running === ctrl.key;
            return (
              <Pressable key={ctrl.key}
                style={({ pressed }) => [api.controlBtn, { backgroundColor: `${ctrl.color}10`, borderColor: `${ctrl.color}33` }, isRunning ? { opacity: 0.6 } : null, pressed && !isRunning ? { opacity: 0.8, transform: [{ scale: 0.97 }] } : null]}
                onPress={() => handleAction(ctrl.key as any)} disabled={isRunning || running !== null}>
                {isRunning ? (
                  <ActivityIndicator size="small" color={ctrl.color} />
                ) : (
                  <Ionicons name={ctrl.icon as any} size={22} color={ctrl.color} />
                )}
                <Text style={[api.controlLabel, { color: ctrl.color }]}>{isRunning ? 'Running…' : ctrl.label}</Text>
                <Text style={[api.controlSub, { color: C.textMuted }]}>{ctrl.sub}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Provider Summary Cards */}
      <Text style={[api.groupTitle, { color: C.textPrimary }]}>Provider Summary ({days}d)</Text>
      {byProvider.length === 0 ? (
        <View style={[api.emptyCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="analytics-outline" size={32} color={C.textMuted} />
          <Text style={[api.emptyText, { color: C.textMuted }]}>No API usage recorded yet.{'\n'}Trigger a data sync above to start tracking.</Text>
        </View>
      ) : byProvider.map(([provider, data]) => {
        const color = providerColor[provider] ?? C.textMuted;
        const successRate = data.totalReqs > 0 ? Math.round((data.totalSuccess / data.totalReqs) * 100) : 0;
        const errorRate = data.totalReqs > 0 ? Math.round((data.totalErrors / data.totalReqs) * 100) : 0;
        return (
          <View key={provider} style={[api.providerCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={[api.providerStripe, { backgroundColor: color }]} />
            <View style={{ flex: 1, padding: 12, gap: 10 }}>
              <View style={api.providerHeader}>
                <View style={[api.providerBadge, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
                  <Text style={[api.providerName, { color }]}>{provider}</Text>
                </View>
                <Text style={[api.providerLastCall, { color: C.textMuted }]}>{timeAgo(data.lastCalled)}</Text>
              </View>
              {/* Stats row */}
              <View style={api.statsRow}>
                <View style={api.statCell}>
                  <Text style={[api.statVal, { color: C.textPrimary }]}>{data.totalReqs.toLocaleString()}</Text>
                  <Text style={[api.statLbl, { color: C.textMuted }]}>Requests</Text>
                </View>
                <View style={[api.statDivider, { backgroundColor: C.border }]} />
                <View style={api.statCell}>
                  <Text style={[api.statVal, { color: '#22C55E' }]}>{data.totalSuccess.toLocaleString()}</Text>
                  <Text style={[api.statLbl, { color: C.textMuted }]}>Success</Text>
                </View>
                <View style={[api.statDivider, { backgroundColor: C.border }]} />
                <View style={api.statCell}>
                  <Text style={[api.statVal, { color: data.totalErrors > 0 ? C.accentRed : C.textMuted }]}>{data.totalErrors.toLocaleString()}</Text>
                  <Text style={[api.statLbl, { color: C.textMuted }]}>Errors</Text>
                </View>
                <View style={[api.statDivider, { backgroundColor: C.border }]} />
                <View style={api.statCell}>
                  <Text style={[api.statVal, { color: successRate >= 90 ? '#22C55E' : successRate >= 70 ? '#F59E0B' : C.accentRed }]}>{successRate}%</Text>
                  <Text style={[api.statLbl, { color: C.textMuted }]}>Rate</Text>
                </View>
              </View>
              {/* Success bar */}
              <View style={[api.progressTrack, { backgroundColor: C.surface }]}>
                <View style={[api.progressFill, { width: `${successRate}%` as any, backgroundColor: successRate >= 90 ? '#22C55E' : successRate >= 70 ? '#F59E0B' : C.accentRed }]} />
              </View>
              {/* Last error */}
              {data.lastError ? (
                <View style={[api.errorRow, { backgroundColor: `${C.accentRed}10`, borderColor: `${C.accentRed}33` }]}>
                  <Ionicons name="warning-outline" size={11} color={C.accentRed} />
                  <Text style={[api.errorText, { color: C.accentRed }]} numberOfLines={2}>{data.lastError}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      {/* Endpoint Detail Table */}
      {stats.length > 0 ? (
        <>
          <Text style={[api.groupTitle, { color: C.textPrimary }]}>Endpoint Details</Text>
          <View style={[api.tableCard, { backgroundColor: C.card, borderColor: C.border }]}>
            {/* Header */}
            <View style={[api.tableHeader, { borderBottomColor: C.border }]}>
              <Text style={[api.tableHeaderCell, { color: C.textMuted, flex: 2 }]}>Endpoint</Text>
              <Text style={[api.tableHeaderCell, { color: C.textMuted, width: 52 }]}>Req</Text>
              <Text style={[api.tableHeaderCell, { color: C.textMuted, width: 52 }]}>Err</Text>
              <Text style={[api.tableHeaderCell, { color: C.textMuted, width: 64 }]}>Last</Text>
            </View>
            {stats.slice(0, 30).map((s, idx) => {
              const color = providerColor[s.providerName] ?? C.textMuted;
              const hasErr = s.errorCount > 0;
              return (
                <View key={s.id} style={[api.tableRow, { borderBottomColor: C.border }, idx % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.card }]}>
                  <View style={{ flex: 2, gap: 1 }}>
                    <Text style={[api.tableCell, { color: C.textPrimary }]} numberOfLines={1}>{s.endpoint}</Text>
                    <View style={[api.providerPill, { backgroundColor: `${color}14`, borderColor: `${color}33` }]}>
                      <Text style={[api.providerPillText, { color }]}>{s.providerName}</Text>
                    </View>
                  </View>
                  <Text style={[api.tableCell, { width: 52, textAlign: 'right', color: C.textSecondary }]}>{s.requestCount}</Text>
                  <Text style={[api.tableCell, { width: 52, textAlign: 'right', color: hasErr ? C.accentRed : C.textMuted }]}>{s.errorCount}</Text>
                  <Text style={[api.tableCell, { width: 64, textAlign: 'right', color: C.textMuted, fontSize: 10 }]}>{timeAgo(s.lastCalled)}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
const api = StyleSheet.create({
  section: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: FONTS.bold },
  sectionSub: { fontSize: 12, lineHeight: 18 },
  controlGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  controlBtn: { flex: 1, minWidth: '44%', borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 90 },
  controlLabel: { fontSize: 13, fontWeight: FONTS.bold, textAlign: 'center' },
  controlSub: { fontSize: 10, textAlign: 'center' },
  groupTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: -4 },
  emptyCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  providerCard: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  providerStripe: { width: 4 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  providerName: { fontSize: 12, fontWeight: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  providerLastCall: { fontSize: 11 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 28, marginHorizontal: 4 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  errorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  tableCard: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  tableHeaderCell: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tableCell: { fontSize: 12, fontWeight: FONTS.medium },
  providerPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginTop: 2 },
  providerPillText: { fontSize: 9, fontWeight: FONTS.bold },
});

// ─── Add Role Modal ────────────────────────────────────────────────────────────
function AddRoleModal({ visible, onClose, targetRole, onAdded, C, currentUserId }: { visible: boolean; onClose: () => void; targetRole: 'admin' | 'expert'; onAdded: () => void; C: AppColors; currentUserId: string }) {
  const { showAlert } = useAlert();
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({ manage_users: false, manage_matches: true, manage_tips: true, broadcast: false });
  useEffect(() => { if (!visible) { setSearch(''); setUsers([]); } }, [visible]);
  const handleSearch = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setUsers([]); return; }
    setLoading(true);
    try {
      const sb = getSupabaseClient();
      const { data } = await sb.from('user_profiles').select('id, email, username, created_at').or(`email.ilike.%${q}%,username.ilike.%${q}%`).limit(10);
      setUsers((data ?? []).map((r: any) => ({ id: r.id, email: r.email, username: r.username || 'No username', createdAt: r.created_at })));
    } catch { setUsers([]); }
    setLoading(false);
  }, []);
  const handleGrant = useCallback(async (user: AdminUser) => {
    setSaving(user.id);
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.from('admin_roles').upsert({
        user_id: user.id, role: targetRole, granted_by: currentUserId,
        permissions: targetRole === 'admin' ? permissions : { manage_users: false, manage_matches: false, manage_tips: true, broadcast: false },
        is_active: true, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) showAlert('Error', error.message);
      else { showAlert('Success', `${user.username || user.email} granted ${roleLabel(targetRole)} access.`); onAdded(); onClose(); }
    } catch (e) { showAlert('Error', String(e)); }
    setSaving(null);
  }, [targetRole, permissions, currentUserId, onAdded, onClose, showAlert]);
  const color = targetRole === 'admin' ? C.primary : '#F59E0B';
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={modl.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={modl.sheet}>
        <View style={[modl.container, { backgroundColor: C.surface, borderTopColor: C.border }]}>
          <View style={[modl.handle, { backgroundColor: C.border }]} />
          <View style={[modl.header, { borderBottomColor: C.border }]}>
            <View style={[modl.iconCircle, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
              <Ionicons name={targetRole === 'admin' ? 'shield-outline' : 'star-outline'} size={20} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[modl.title, { color: C.textPrimary }]}>Add {roleLabel(targetRole)}</Text>
              <Text style={[modl.subtitle, { color: C.textMuted }]}>Search user by name or email</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={C.textMuted} /></Pressable>
          </View>
          {targetRole === 'admin' ? (
            <View style={[modl.permBox, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[modl.permTitle, { color: C.textMuted }]}>PERMISSIONS</Text>
              {(Object.entries(permissions) as [keyof typeof permissions, boolean][]).map(([key, val]) => (
                <Pressable key={key} style={modl.permRow} onPress={() => setPermissions((p) => ({ ...p, [key]: !p[key] }))}>
                  <View style={[modl.checkbox, val ? { backgroundColor: color, borderColor: color } : { borderColor: C.border }]}>
                    {val ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                  </View>
                  <Text style={[modl.permLabel, { color: C.textSecondary }]}>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={[modl.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name="search-outline" size={16} color={C.textMuted} />
            <TextInput style={[modl.searchInput, { color: C.textPrimary }]} value={search} onChangeText={handleSearch} placeholder="Search by name or email…" placeholderTextColor={C.textMuted} autoFocus />
            {loading ? <ActivityIndicator size="small" color={C.textMuted} /> : null}
          </View>
          <ScrollView style={modl.results} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {users.length === 0 && search.trim().length >= 2 && !loading ? <Text style={[modl.noResults, { color: C.textMuted }]}>No users found for "{search}"</Text> : null}
            {users.map((u) => (
              <Pressable key={u.id} style={[modl.userRow, { backgroundColor: C.card, borderColor: C.border }]} onPress={() => handleGrant(u)} disabled={saving === u.id}>
                <View style={[modl.userAvatar, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
                  <Text style={[modl.userAvatarText, { color }]}>{(u.username || u.email)[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[modl.userName, { color: C.textPrimary }]}>{u.username}</Text>
                  <Text style={[modl.userEmail, { color: C.textMuted }]}>{u.email}</Text>
                </View>
                {saving === u.id ? <ActivityIndicator size="small" color={color} /> : (
                  <View style={[modl.grantBtn, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}><Text style={[modl.grantBtnText, { color }]}>Grant</Text></View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const modl = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { flex: 1, justifyContent: 'flex-end' },
  container: { borderTopLeftRadius: RADIUS.xl + 4, borderTopRightRadius: RADIUS.xl + 4, borderTopWidth: 1, maxHeight: '85%', paddingBottom: 24 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, borderBottomWidth: 1 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  subtitle: { fontSize: 12, marginTop: 2 },
  permBox: { margin: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 10 },
  permTitle: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.8, marginBottom: 4 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  permLabel: { fontSize: 13, fontWeight: FONTS.medium },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: SPACING.md, marginTop: 8, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14 },
  results: { paddingHorizontal: SPACING.md, maxHeight: 300 },
  noResults: { textAlign: 'center', paddingVertical: 24, fontSize: 13 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, marginBottom: 8 },
  userAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 16, fontWeight: FONTS.bold },
  userName: { fontSize: 14, fontWeight: FONTS.semiBold },
  userEmail: { fontSize: 12, marginTop: 2 },
  grantBtn: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  grantBtnText: { fontSize: 12, fontWeight: FONTS.bold },
});

// ─── Role Card ─────────────────────────────────────────────────────────────────
function RoleCard({ role, onRevoke, C }: { role: AdminRole; onRevoke: (id: string) => void; C: AppColors }) {
  const color = roleColor(role.role, C);
  const isSuperAdmin = role.role === 'main_admin';
  // Super admin always shows all perms; others show active perms only
  const activePerms = isSuperAdmin
    ? ['manage users', 'manage matches', 'manage tips', 'broadcast']
    : Object.entries(role.permissions).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
  return (
    <View style={[rc.card, { backgroundColor: C.card, borderColor: isSuperAdmin ? `${color}44` : C.border }]}>
      <View style={[rc.stripe, { backgroundColor: color }]} />
      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        <View style={rc.header}>
          <View style={[rc.avatar, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
            {isSuperAdmin ? (
              <Ionicons name="shield-checkmark" size={18} color={color} />
            ) : (
              <Text style={[rc.avatarText, { color }]}>{(role.username[0] || '?').toUpperCase()}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[rc.name, { color: C.textPrimary }]}>{role.username}</Text>
            <Text style={[rc.email, { color: C.textMuted }]}>{role.email}</Text>
          </View>
          <View style={[rc.rolePill, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
            {isSuperAdmin ? <Ionicons name="shield-checkmark" size={10} color={color} /> : null}
            <Text style={[rc.rolePillText, { color }]}>{roleBadgeLabel(role.role)}</Text>
          </View>
        </View>
        {activePerms.length > 0 ? (
          <View style={rc.permsRow}>
            {activePerms.map((p) => (
              <View key={p} style={[rc.permChip, { backgroundColor: isSuperAdmin ? `${color}10` : C.surface, borderColor: isSuperAdmin ? `${color}33` : C.border }]}>
                <Text style={[rc.permChipText, { color: isSuperAdmin ? color : C.textMuted }]}>{p}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {isSuperAdmin ? (
          <View style={[rc.superAdminBanner, { backgroundColor: `${color}0D`, borderColor: `${color}33` }]}>
            <Ionicons name="infinite-outline" size={12} color={color} />
            <Text style={[rc.superAdminText, { color }]}>Unrestricted access · Cannot be revoked</Text>
          </View>
        ) : null}
        <View style={rc.footer}>
          <Text style={[rc.since, { color: C.textMuted }]}>Since {timeAgo(role.createdAt)}</Text>
          {!isSuperAdmin ? (
            <Pressable style={({ pressed }) => [rc.revokeBtn, { borderColor: `${C.accentRed}44`, backgroundColor: `${C.accentRed}0D` }, pressed ? { opacity: 0.7 } : null]} onPress={() => onRevoke(role.id)}>
              <Ionicons name="trash-outline" size={12} color={C.accentRed} />
              <Text style={[rc.revokeBtnText, { color: C.accentRed }]}>Revoke</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
const rc = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 16, fontWeight: FONTS.bold },
  name: { fontSize: 14, fontWeight: FONTS.bold },
  email: { fontSize: 11, marginTop: 1 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  rolePillText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  permsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  permChip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  permChipText: { fontSize: 10, fontWeight: FONTS.medium },
  superAdminBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  superAdminText: { fontSize: 11, fontWeight: FONTS.semiBold },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  since: { fontSize: 11 },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  revokeBtnText: { fontSize: 11, fontWeight: FONTS.semiBold },
});

// ─── Admins Tab ───────────────────────────────────────────────────────────────
function AdminsTab({ C, currentUserId }: { C: AppColors; currentUserId: string }) {
  const { showAlert } = useAlert();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const load = useCallback(async () => { const data = await fetchAdminRoles(); setRoles(data.filter((r) => r.role === 'admin' || r.role === 'main_admin')); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const handleRevoke = useCallback(async (id: string) => {
    // Super-admin (main_admin) cannot be revoked
    const target = roles.find(r => r.id === id);
    if (target?.role === 'main_admin') {
      showAlert('Protected', 'The Super Admin account cannot be revoked.');
      return;
    }
    showAlert('Revoke Admin Access', 'Remove this user from admin role?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        const { error } = await getSupabaseClient().from('admin_roles').delete().eq('id', id);
        if (error) showAlert('Error', error.message);
        else setRoles((prev) => prev.filter((r) => r.id !== id));
      }},
    ]);
  }, [showAlert]);
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;
  return (
    <View style={{ flex: 1 }}>
      <View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <Text style={[tabl.topBarText, { color: C.textMuted }]}>{roles.length} admin{roles.length !== 1 ? 's' : ''}</Text>
        <Pressable style={({ pressed }) => [tabl.addBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }, pressed ? { opacity: 0.7 } : null]} onPress={() => setShowAddModal(true)}>
          <Ionicons name="shield-outline" size={13} color={C.primary} />
          <Text style={[tabl.addBtnText, { color: C.primary }]}>Add Admin</Text>
        </Pressable>
      </View>
      <FlatList data={roles} keyExtractor={(r) => r.id} renderItem={({ item }) => <RoleCard role={item} onRevoke={handleRevoke} C={C} />}
        contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={<EmptyState icon="shield-outline" label="No admins yet" sub="Add admins to help manage the platform" C={C} />}
        ListFooterComponent={<View style={{ height: 40 }} />} showsVerticalScrollIndicator={false} />
      <AddRoleModal visible={showAddModal} onClose={() => setShowAddModal(false)} targetRole="admin" onAdded={load} C={C} currentUserId={currentUserId} />
    </View>
  );
}

// ─── Experts Tab ──────────────────────────────────────────────────────────────
function ExpertsTab({ C, currentUserId }: { C: AppColors; currentUserId: string }) {
  const { showAlert } = useAlert();
  const [experts, setExperts] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const load = useCallback(async () => { const data = await fetchAdminRoles(); setExperts(data.filter((r) => r.role === 'expert')); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const handleRevoke = useCallback(async (id: string) => {
    showAlert('Remove Expert', 'Remove this user from expert role?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await getSupabaseClient().from('admin_roles').delete().eq('id', id);
        if (error) showAlert('Error', error.message);
        else setExperts((prev) => prev.filter((r) => r.id !== id));
      }},
    ]);
  }, [showAlert]);
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;
  return (
    <View style={{ flex: 1 }}>
      <View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <Text style={[tabl.topBarText, { color: C.textMuted }]}>{experts.length} expert{experts.length !== 1 ? 's' : ''}</Text>
        <Pressable style={({ pressed }) => [tabl.addBtn, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }, pressed ? { opacity: 0.7 } : null]} onPress={() => setShowAddModal(true)}>
          <Ionicons name="star-outline" size={13} color="#F59E0B" />
          <Text style={[tabl.addBtnText, { color: '#F59E0B' }]}>Add Expert</Text>
        </Pressable>
      </View>
      <FlatList data={experts} keyExtractor={(r) => r.id} renderItem={({ item }) => <RoleCard role={item} onRevoke={handleRevoke} C={C} />}
        contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={<EmptyState icon="star-outline" label="No experts yet" sub="Add experts who can post winning tips" C={C} />}
        ListFooterComponent={<View style={{ height: 40 }} />} showsVerticalScrollIndicator={false} />
      <AddRoleModal visible={showAddModal} onClose={() => setShowAddModal(false)} targetRole="expert" onAdded={load} C={C} currentUserId={currentUserId} />
    </View>
  );
}

// ─── Tips Tab ─────────────────────────────────────────────────────────────────
const TIP_SPORTS = ['All','Football','Basketball','Tennis','Cricket','MMA','Baseball','Hockey','Rugby'];
const TIP_STATUS_FILTERS = [
  { key: 'all', label: 'All', color: '#6B7280' },
  { key: 'pending', label: 'Pending', color: '#F59E0B' },
  { key: 'won', label: 'Won', color: '#22C55E' },
  { key: 'lost', label: 'Lost', color: '#EF4444' },
  { key: 'void', label: 'Void', color: '#9CA3AF' },
];

function TipCard({ tip, onDelete, onUpdateStatus, C }: { tip: ExpertTip; onDelete: (id: string) => void; onUpdateStatus: (id: string, status: ExpertTip['status']) => void; C: AppColors }) {
  const statusC = tipStatusColor(tip.status, C);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const handleStatus = async (newStatus: ExpertTip['status']) => {
    setUpdatingStatus(true);
    const { error } = await getSupabaseClient().from('expert_tips').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', tip.id);
    if (!error) onUpdateStatus(tip.id, newStatus);
    setUpdatingStatus(false);
  };
  const sportEmoji: Record<string, string> = { football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏', mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉' };
  return (
    <View style={[tc.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[tc.stripe, { backgroundColor: statusC }]} />
      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        <View style={tc.header}>
          <Text style={tc.sportEmoji}>{sportEmoji[tip.sport.toLowerCase()] ?? '🏆'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[tc.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>{tip.matchLabel}</Text>
            {tip.league ? <Text style={[tc.league, { color: C.textMuted }]}>{tip.league}</Text> : null}
          </View>
          <View style={[tc.statusPill, { backgroundColor: `${statusC}18`, borderColor: `${statusC}44` }]}>
            <Text style={[tc.statusText, { color: statusC }]}>{tip.status.toUpperCase()}</Text>
          </View>
          {tip.isPremium ? <View style={[tc.premiumBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}><FontAwesome5 name="crown" size={9} color="#F59E0B" /><Text style={[tc.premiumText, { color: '#F59E0B' }]}>VIP</Text></View> : null}
        </View>
        <View style={tc.tipRow}>
          <View style={[tc.tipBox, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}>
            <Text style={[tc.tipType, { color: C.textMuted }]}>{tip.tipType}</Text>
            <Text style={[tc.tipValue, { color: C.primary }]}>{tip.tipValue}</Text>
          </View>
          {tip.odds ? <View style={[tc.oddsPill, { backgroundColor: C.surface, borderColor: C.border }]}><Text style={[tc.oddsText, { color: C.textPrimary }]}>{tip.odds.toFixed(2)}</Text><Text style={[tc.oddsLabel, { color: C.textMuted }]}>odds</Text></View> : null}
          <View style={[tc.confPill, { backgroundColor: tip.confidence >= 75 ? '#22C55E14' : `${C.accent}14`, borderColor: tip.confidence >= 75 ? '#22C55E33' : `${C.accent}33` }]}>
            <Text style={[tc.confText, { color: tip.confidence >= 75 ? '#22C55E' : C.accent }]}>{tip.confidence}%</Text>
          </View>
        </View>
        <View style={tc.meta}>
          <Ionicons name="person-circle-outline" size={13} color={C.textMuted} />
          <Text style={[tc.expertName, { color: C.textMuted }]}>{tip.expertName}</Text>
          <Text style={[tc.dot, { color: C.textMuted }]}>·</Text>
          <Text style={[tc.time, { color: C.textMuted }]}>{timeAgo(tip.createdAt)}</Text>
        </View>
        <View style={tc.statusRow}>
          {(['won','lost','void'] as ExpertTip['status'][]).map((s) => (
            <Pressable key={s}
              style={({ pressed }) => [tc.statusBtn, { backgroundColor: tip.status === s ? `${tipStatusColor(s, C)}18` : C.surface, borderColor: tip.status === s ? `${tipStatusColor(s, C)}55` : C.border }, pressed ? { opacity: 0.7 } : null]}
              onPress={() => handleStatus(s)} disabled={updatingStatus}>
              <Text style={[tc.statusBtnText, { color: tip.status === s ? tipStatusColor(s, C) : C.textMuted }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
            </Pressable>
          ))}
          <Pressable style={({ pressed }) => [tc.deleteBtn, { borderColor: `${C.accentRed}44`, backgroundColor: `${C.accentRed}0D` }, pressed ? { opacity: 0.7 } : null]} onPress={() => onDelete(tip.id)}>
            <Ionicons name="trash-outline" size={13} color={C.accentRed} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
const tc = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  stripe: { width: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sportEmoji: { fontSize: 18, flexShrink: 0 },
  matchLabel: { fontSize: 14, fontWeight: FONTS.bold },
  league: { fontSize: 11, marginTop: 1 },
  statusPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  premiumBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  premiumText: { fontSize: 9, fontWeight: FONTS.extraBold },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipBox: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, padding: 8, gap: 2 },
  tipType: { fontSize: 10, fontWeight: FONTS.medium },
  tipValue: { fontSize: 15, fontWeight: FONTS.extraBold },
  oddsPill: { borderRadius: RADIUS.md, borderWidth: 1, padding: 8, alignItems: 'center', gap: 1 },
  oddsText: { fontSize: 14, fontWeight: FONTS.extraBold },
  oddsLabel: { fontSize: 9 },
  confPill: { borderRadius: RADIUS.md, borderWidth: 1, padding: 8, alignItems: 'center' },
  confText: { fontSize: 13, fontWeight: FONTS.bold },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  expertName: { fontSize: 11, fontWeight: FONTS.semiBold },
  dot: { fontSize: 11 },
  time: { fontSize: 11 },
  statusRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  statusBtn: { flex: 1, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 7, alignItems: 'center' },
  statusBtnText: { fontSize: 11, fontWeight: FONTS.semiBold },
  deleteBtn: { width: 36, height: 36, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

function TipsTab({ C }: { C: AppColors }) {
  const router = useRouter();
  const { showAlert } = useAlert();
  const [tips, setTips] = useState<ExpertTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sportFilter, setSportFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const load = useCallback(async () => { const data = await fetchExpertTips(); setTips(data); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const filtered = useMemo(() => tips.filter((t) => {
    const sportMatch = sportFilter === 'All' || t.sport.toLowerCase() === sportFilter.toLowerCase();
    const statusMatch = statusFilter === 'all' || t.status === statusFilter;
    return sportMatch && statusMatch;
  }), [tips, sportFilter, statusFilter]);
  const handleDelete = useCallback(async (id: string) => {
    showAlert('Delete Tip', 'Permanently delete this tip?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await getSupabaseClient().from('expert_tips').delete().eq('id', id);
        if (error) showAlert('Error', error.message);
        else setTips((prev) => prev.filter((t) => t.id !== id));
      }},
    ]);
  }, [showAlert]);
  const handleUpdateStatus = useCallback((id: string, status: ExpertTip['status']) => {
    setTips((prev) => prev.map((t) => t.id === id ? { ...t, status } : t));
  }, []);
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;
  return (
    <View style={{ flex: 1 }}>
      <View style={[tabl.filterBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabl.filterScroll}>
          {TIP_SPORTS.map((s) => { const active = sportFilter === s;
            return <Pressable key={s} style={[tabl.chip, active ? { backgroundColor: `${C.primary}18`, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }]} onPress={() => setSportFilter(s)}>
              <Text style={[tabl.chipText, { color: active ? C.primary : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{s}</Text></Pressable>; })}
        </ScrollView>
      </View>
      <View style={[tabl.filterBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabl.filterScroll}>
          {TIP_STATUS_FILTERS.map((f) => { const active = statusFilter === f.key;
            const count = f.key === 'all' ? tips.length : tips.filter((t) => t.status === f.key).length;
            return <Pressable key={f.key} style={[tabl.chip, active ? { backgroundColor: `${f.color}18`, borderColor: f.color } : { backgroundColor: C.card, borderColor: C.border }]} onPress={() => setStatusFilter(f.key)}>
              <Text style={[tabl.chipText, { color: active ? f.color : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{f.label}</Text>
              {count > 0 ? <View style={[tabl.chipCount, { backgroundColor: active ? f.color : C.border }]}><Text style={[tabl.chipCountText, { color: active ? '#fff' : C.textMuted }]}>{count}</Text></View> : null}
            </Pressable>; })}
        </ScrollView>
      </View>
      <View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <Text style={[tabl.topBarText, { color: C.textMuted }]}>{filtered.length} tip{filtered.length !== 1 ? 's' : ''}</Text>
        <Pressable style={({ pressed }) => [tabl.addBtn, { backgroundColor: '#22C55E18', borderColor: '#22C55E44' }, pressed ? { opacity: 0.7 } : null]} onPress={() => router.push('/admin-tips' as any)}>
          <Ionicons name="add-circle-outline" size={13} color="#22C55E" /><Text style={[tabl.addBtnText, { color: '#22C55E' }]}>Post Tip</Text>
        </Pressable>
      </View>
      <FlatList data={filtered} keyExtractor={(t) => t.id} renderItem={({ item }) => <TipCard tip={item} onDelete={handleDelete} onUpdateStatus={handleUpdateStatus} C={C} />}
        contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={<EmptyState icon="bulb-outline" label="No tips posted yet" sub="Post your first winning tip" C={C} />}
        ListFooterComponent={<View style={{ height: 40 }} />} showsVerticalScrollIndicator={false} />
    </View>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab({ C, onBroadcast, broadcasting }: { C: AppColors; onBroadcast: (t: string, b: string) => void; broadcasting: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const ready = title.trim().length > 0 && body.trim().length > 0 && !broadcasting;
  const load = useCallback(async () => { const data = await fetchAdminUsers(); setUsers(data); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[bc.card, { backgroundColor: C.card, borderColor: `${C.accentPurple}33`, margin: SPACING.md, marginBottom: 0 }]}>
        <View style={bc.header}>
          <View style={[bc.iconCircle, { backgroundColor: `${C.accentPurple}18` }]}><Ionicons name="megaphone-outline" size={18} color={C.accentPurple} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[bc.title, { color: C.textPrimary }]}>Broadcast Notification</Text>
            <Text style={[bc.sub, { color: C.textMuted }]}>Sends to all {users.length} registered users</Text>
          </View>
        </View>
        <TextInput style={[bc.input, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]} value={title} onChangeText={setTitle} placeholder="Notification title..." placeholderTextColor={C.textMuted} maxLength={80} />
        <TextInput style={[bc.input, bc.textArea, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]} value={body} onChangeText={setBody} placeholder="Message body..." placeholderTextColor={C.textMuted} multiline numberOfLines={3} textAlignVertical="top" maxLength={300} />
        <Pressable style={({ pressed }) => [bc.btn, !ready ? { opacity: 0.4 } : null, pressed && ready ? { opacity: 0.85 } : null]}
          onPress={() => { onBroadcast(title.trim(), body.trim()); setTitle(''); setBody(''); }} disabled={!ready}>
          {broadcasting ? <ActivityIndicator size="small" color="#fff" /> : <><Ionicons name="send-outline" size={14} color="#fff" /><Text style={bc.btnText}>Send to All Users</Text></>}
        </Pressable>
      </View>
      <View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border, marginTop: 12 }]}>
        <Text style={[tabl.topBarText, { color: C.textMuted }]}>{users.length} registered users</Text>
        {loading ? <ActivityIndicator size="small" color={C.primary} /> : null}
      </View>
      <FlatList data={users} keyExtractor={(u) => u.id}
        renderItem={({ item }) => {
          const initial = (item.username || item.email)[0].toUpperCase();
          return (
            <View style={[tabl.userRow, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[tabl.userAvatar, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
                <Text style={[tabl.userAvatarText, { color: C.primary }]}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[tabl.userName, { color: C.textPrimary }]}>{item.username}</Text>
                <Text style={[tabl.userEmail, { color: C.textMuted }]}>{item.email}</Text>
              </View>
              <Text style={[tabl.userTime, { color: C.textMuted }]}>{timeAgo(item.createdAt)}</Text>
            </View>
          );
        }}
        contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={!loading ? <EmptyState icon="people-outline" label="No users" sub="Registered users will appear here" C={C} /> : null}
        ListFooterComponent={<View style={{ height: 40 }} />} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" />
    </KeyboardAvoidingView>
  );
}
const bc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: FONTS.bold },
  sub: { fontSize: 11, marginTop: 1 },
  input: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#7C3AED', borderRadius: RADIUS.full, paddingVertical: 11 },
  btnText: { fontSize: 13, fontWeight: FONTS.bold, color: '#fff' },
});

// ─── Rooms Tab ────────────────────────────────────────────────────────────────
function RoomsTab({ C }: { C: AppColors }) {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { const d = await fetchAdminRooms(); setRooms(d); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  return (
    <FlatList data={rooms} keyExtractor={(r) => r.id}
      renderItem={({ item }) => (
        <View style={[tabl.userRow, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[tabl.userAvatar, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[tabl.userName, { color: C.textPrimary }]}>{item.name}</Text>
            <Text style={[tabl.userEmail, { color: C.textMuted }]}>{item.type.toUpperCase()} · {item.membersCount.toLocaleString()} members</Text>
          </View>
          <Text style={[tabl.userTime, { color: C.textMuted }]}>{timeAgo(item.createdAt)}</Text>
        </View>
      )}
      contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      ListHeaderComponent={<View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border, marginBottom: SPACING.sm }]}><Text style={[tabl.topBarText, { color: C.textMuted }]}>{rooms.length} chat room{rooms.length !== 1 ? 's' : ''}</Text></View>}
      ListEmptyComponent={!loading ? <EmptyState icon="chatbubbles-outline" label="No chat rooms" sub="" C={C} /> : null}
      ListFooterComponent={<View style={{ height: 40 }} />} showsVerticalScrollIndicator={false} />
  );
}

// ─── Matches Tab ──────────────────────────────────────────────────────────────
const STATUS_OPTIONS: AdminMatch['status'][] = ['upcoming', 'live', 'finished'];

function MatchEditRow({ match, onSaved, C }: { match: AdminMatch; onSaved: (updated: AdminMatch) => void; C: AppColors }) {
  const { showAlert } = useAlert();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ homeScore: String(match.homeScore), awayScore: String(match.awayScore), status: match.status, minute: String(match.minute) });
  const isDirty = draft.homeScore !== String(match.homeScore) || draft.awayScore !== String(match.awayScore) || draft.status !== match.status || draft.minute !== String(match.minute);
  const handleSave = async () => {
    const hs = parseInt(draft.homeScore, 10); const as_ = parseInt(draft.awayScore, 10); const min = parseInt(draft.minute, 10);
    if (isNaN(hs) || hs < 0 || isNaN(as_) || as_ < 0 || isNaN(min) || min < 0) { showAlert('Validation', 'Enter valid non-negative numbers'); return; }
    setSaving(true);
    const err = await updateMatch(match.id, { home_score: hs, away_score: as_, status: draft.status, minute: min });
    setSaving(false);
    if (err) showAlert('Error', err);
    else { onSaved({ ...match, homeScore: hs, awayScore: as_, status: draft.status, minute: min }); setExpanded(false); }
  };
  const sC = statusColor(match.status, C); const sBg = statusBg(match.status, C);
  return (
    <View style={[me.card, expanded ? { borderColor: `${C.primary}44` } : { borderColor: C.border }, { backgroundColor: C.card }]}>
      <Pressable style={({ pressed }) => [me.header, pressed ? { opacity: 0.85 } : null]} onPress={() => setExpanded((v) => !v)}>
        <View style={[me.statusPill, { backgroundColor: sBg, borderColor: sC }]}>
          {match.status === 'live' ? <View style={[me.liveDot, { backgroundColor: C.accent }]} /> : null}
          <Text style={[me.statusText, { color: sC }]}>{match.status === 'live' ? `${match.minute}'` : match.status.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[me.teams, { color: C.textPrimary }]} numberOfLines={1}>{match.homeTeam} {match.status !== 'upcoming' ? `${match.homeScore} - ${match.awayScore}` : 'vs'} {match.awayTeam}</Text>
          <Text style={[me.league, { color: C.textMuted }]} numberOfLines={1}>{match.league}</Text>
        </View>
        {isDirty && !expanded ? <View style={[me.dirtyDot, { backgroundColor: C.primary }]} /> : null}
        <MaterialIcons name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={C.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={[me.form, { borderTopColor: C.border }]}>
          <View style={me.scoreRow}>
            <TextInput style={[me.scoreInput, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]} value={draft.homeScore} onChangeText={(t) => setDraft((d) => ({ ...d, homeScore: t.replace(/\D/g, '') }))} keyboardType="number-pad" maxLength={2} selectTextOnFocus placeholderTextColor={C.textMuted} />
            <Text style={[me.dash, { color: C.textMuted }]}>—</Text>
            <TextInput style={[me.scoreInput, { backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }]} value={draft.awayScore} onChangeText={(t) => setDraft((d) => ({ ...d, awayScore: t.replace(/\D/g, '') }))} keyboardType="number-pad" maxLength={2} selectTextOnFocus placeholderTextColor={C.textMuted} />
          </View>
          <View style={me.statusRow}>
            {STATUS_OPTIONS.map((s) => { const active = draft.status === s; const sc2 = statusColor(s, C);
              return <Pressable key={s} style={[me.statusBtn, { backgroundColor: C.surface, borderColor: C.border }, active ? { backgroundColor: statusBg(s, C), borderColor: sc2 } : null]} onPress={() => setDraft((d) => ({ ...d, status: s }))}>
                {s === 'live' ? <View style={[me.liveDot, { backgroundColor: C.accent }]} /> : null}
                <Text style={[me.statusBtnText, { color: C.textMuted }, active ? { color: sc2, fontWeight: FONTS.bold } : null]}>{s.toUpperCase()}</Text>
              </Pressable>; })}
          </View>
          <View style={[me.minWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
            <TextInput style={[me.minInput, { color: C.textPrimary }]} value={draft.minute} onChangeText={(t) => setDraft((d) => ({ ...d, minute: t.replace(/\D/g, '') }))} keyboardType="number-pad" maxLength={3} selectTextOnFocus placeholderTextColor={C.textMuted} />
            <Text style={[me.minSuffix, { color: C.textMuted }]}>'</Text>
          </View>
          <View style={me.actions}>
            <Pressable style={[me.discardBtn, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => { setDraft({ homeScore: String(match.homeScore), awayScore: String(match.awayScore), status: match.status, minute: String(match.minute) }); setExpanded(false); }} disabled={saving}>
              <Ionicons name="close-outline" size={14} color={C.textMuted} /><Text style={[me.discardText, { color: C.textMuted }]}>Discard</Text>
            </Pressable>
            <Pressable style={[me.saveBtn, { backgroundColor: C.primary }, !isDirty || saving ? { opacity: 0.4 } : null]} onPress={handleSave} disabled={!isDirty || saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <><Ionicons name="checkmark-outline" size={14} color="#fff" /><Text style={me.saveBtnText}>Save</Text></>}
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
const me = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  teams: { fontSize: 13, fontWeight: FONTS.bold },
  league: { fontSize: 11, marginTop: 1 },
  dirtyDot: { width: 7, height: 7, borderRadius: 4 },
  form: { borderTopWidth: 1, padding: 12, gap: 12 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center' },
  scoreInput: { width: 72, height: 52, borderRadius: RADIUS.md, borderWidth: 1.5, fontSize: 26, fontWeight: FONTS.extraBold, textAlign: 'center' },
  dash: { fontSize: 20 },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: RADIUS.md, borderWidth: 1 },
  statusBtnText: { fontSize: 11, fontWeight: FONTS.semiBold },
  minWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.md, borderWidth: 1.5, paddingHorizontal: 14, height: 44 },
  minInput: { flex: 1, fontSize: 18, fontWeight: FONTS.bold },
  minSuffix: { fontSize: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 16, borderRadius: RADIUS.full, borderWidth: 1 },
  discardText: { fontSize: 12 },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, paddingVertical: 10 },
  saveBtnText: { fontSize: 13, fontWeight: FONTS.bold, color: '#fff' },
});

function MatchesTab({ C }: { C: AppColors }) {
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | AdminMatch['status']>('all');
  const load = useCallback(async () => { const d = await fetchAdminMatches(); setMatches(d); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const filtered = statusFilter === 'all' ? matches : matches.filter((m) => m.status === statusFilter);
  const filterOpts = [
    { key: 'all', label: 'All', color: C.primary }, { key: 'live', label: 'Live', color: C.accent },
    { key: 'upcoming', label: 'Upcoming', color: C.primary }, { key: 'finished', label: 'Finished', color: C.textMuted },
  ];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[tabl.filterBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabl.filterScroll}>
          {filterOpts.map((f) => { const active = statusFilter === f.key;
            return <Pressable key={f.key} style={[tabl.chip, active ? { backgroundColor: `${f.color}18`, borderColor: f.color } : { backgroundColor: C.card, borderColor: C.border }]} onPress={() => setStatusFilter(f.key as any)}>
              <Text style={[tabl.chipText, { color: active ? f.color : C.textMuted }, active ? { fontWeight: FONTS.bold } : null]}>{f.label}</Text>
            </Pressable>; })}
        </ScrollView>
      </View>
      <View style={[tabl.topBar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
        <Text style={[tabl.topBarText, { color: C.textMuted }]}>{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</Text>
        <Text style={[tabl.hintText, { color: C.textMuted }]}>Tap row to edit</Text>
      </View>
      <FlatList data={filtered} keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MatchEditRow match={item} onSaved={(updated) => setMatches((prev) => prev.map((m) => m.id === updated.id ? updated : m))} C={C} />}
        contentContainerStyle={tabl.listContent} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={!loading ? <EmptyState icon="football-outline" label="No matches" sub="Sync matches via the fetch-matches edge function" C={C} /> : null}
        ListFooterComponent={<View style={{ height: 48 }} />} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" />
    </KeyboardAvoidingView>
  );
}

// ─── Shared tab styles ────────────────────────────────────────────────────────
const tabl = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 10, borderBottomWidth: 1 },
  topBarText: { fontSize: 12, fontWeight: FONTS.medium },
  hintText: { fontSize: 10, fontStyle: 'italic' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { fontSize: 12, fontWeight: FONTS.bold },
  filterBar: { borderBottomWidth: 1 },
  filterScroll: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, height: 34 },
  chipText: { fontSize: 12, fontWeight: FONTS.medium },
  chipCount: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chipCountText: { fontSize: 9, fontWeight: FONTS.extraBold },
  listContent: { padding: SPACING.md },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  userAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  userAvatarText: { fontSize: 16, fontWeight: FONTS.bold },
  userName: { fontSize: 13, fontWeight: FONTS.bold },
  userEmail: { fontSize: 11, marginTop: 2 },
  userTime: { fontSize: 10 },
});

// ─── Shared empty state ────────────────────────────────────────────────────────
function EmptyState({ icon, label, sub, C }: { icon: string; label: string; sub: string; C: AppColors }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, gap: 12, flex: 1 }}>
      <View style={[{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1 }, { backgroundColor: C.card, borderColor: C.border }]}>
        <Ionicons name={icon as any} size={32} color={C.textMuted} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: FONTS.semiBold, color: C.textMuted }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', paddingHorizontal: 40 }}>{sub}</Text> : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminScreen() {
  const router = useRouter();
  const { showAlert } = useAlert();
  const { user } = useAuth();
  const { colors: C } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [broadcasting, setBroadcasting] = useState(false);

  const currentUserId = user?.id ?? '';
  const { isSuperAdmin, role: currentUserRole } = useAdminRole(user?.id);

  const handleBroadcast = useCallback(async (title: string, body: string) => {
    setBroadcasting(true);
    const { count, error } = await broadcastNotification(title, body);
    setBroadcasting(false);
    if (error) showAlert('Broadcast Failed', error);
    else showAlert('Sent', `Notification delivered to ${count} user${count !== 1 ? 's' : ''}.`);
  }, [showAlert]);

  return (
    <View style={[root.container, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[root.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={root.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <View style={root.headerCenter}>
            <FontAwesome5 name="shield-alt" size={16} color={isSuperAdmin ? '#EF4444' : C.primary} />
            <Text style={[root.title, { color: C.textPrimary }]}>Admin Panel</Text>
            <View style={[root.badge, { backgroundColor: isSuperAdmin ? '#EF4444' : C.primary }]}>
              <Text style={root.badgeText}>{isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN'}</Text>
            </View>
          </View>
          <Pressable onPress={() => router.push('/admin-reports' as any)} hitSlop={8}
            style={({ pressed }) => [root.reportsBtn, { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}44` }, pressed ? { opacity: 0.7 } : null]}>
            <Ionicons name="flag" size={14} color={C.accentRed} />
            <Text style={[root.reportsBtnText, { color: C.accentRed }]}>Reports</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={root.tabBar} bounces={false}>
          {TABS.map((t) => (
            <Pressable key={t.id} style={[root.tab, activeTab === t.id ? root.tabActive : null]} onPress={() => setActiveTab(t.id)}>
              <Text style={root.tabEmoji}>{t.icon}</Text>
              <Text style={[root.tabLabel, { color: activeTab === t.id ? C.textPrimary : C.textMuted }, activeTab === t.id ? { fontWeight: FONTS.bold } : null]}>{t.label}</Text>
              {activeTab === t.id ? <View style={[root.tabIndicator, { backgroundColor: C.primary }]} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>

      {activeTab === 'overview' ? <OverviewTab C={C} /> : null}
      {activeTab === 'users' ? <UsersTab C={C} onBroadcast={handleBroadcast} broadcasting={broadcasting} /> : null}
      {activeTab === 'admins' ? <AdminsTab C={C} currentUserId={currentUserId} /> : null}
      {activeTab === 'experts' ? <ExpertsTab C={C} currentUserId={currentUserId} /> : null}
      {activeTab === 'tips' ? <TipsTab C={C} /> : null}
      {activeTab === 'rooms' ? <RoomsTab C={C} /> : null}
      {activeTab === 'matches' ? <MatchesTab C={C} /> : null}
      {activeTab === 'api' ? <ApiMonitorTab C={C} /> : null}
      {activeTab === 'translations' ? <TranslationsTab C={C} /> : null}
      {activeTab === 'sync' ? <SyncMonitorTab C={C} /> : null}
      {activeTab === 'feedhealth' ? <FeedHealthTab C={C} /> : null}
    </View>
  );
}

// ─── Sync All Data ─────────────────────────────────────────────────────────
type SyncAllStatus = 'idle' | 'running' | 'success' | 'error';

interface SyncAllJob {
  key: string; label: string; icon: string; color: string;
  status: SyncAllStatus; durationMs: number | null; errorMessage: string | null;
}

const SYNC_ALL_DEFINITIONS: Omit<SyncAllJob, 'status' | 'durationMs' | 'errorMessage'>[] = [
  { key: 'fetch-matches',  label: 'Fetch Matches',   icon: 'football-outline',     color: '#3B82F6' },
  { key: 'fetch-odds',     label: 'Fetch Odds',      icon: 'trending-up-outline',  color: '#22C55E' },
  { key: 'sync-standings', label: 'Sync Standings',  icon: 'podium-outline',       color: '#8B5CF6' },
  { key: 'sync-live',      label: 'Live Scores',     icon: 'pulse-outline',        color: '#EF4444' },
];

function makeFreshJobs(): SyncAllJob[] {
  return SYNC_ALL_DEFINITIONS.map((j) => ({ ...j, status: 'idle', durationMs: null, errorMessage: null }));
}

function SyncAllButton({ C, onComplete }: { C: AppColors; onComplete: () => void }) {
  const [jobs, setJobs] = useState<SyncAllJob[]>(makeFreshJobs());
  const [running, setRunning] = useState(false);
  const [overallStatus, setOverallStatus] = useState<'idle' | 'running' | 'done'>('idle');

  const setJobStatus = (key: string, patch: Partial<SyncAllJob>) =>
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const handleSyncAll = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setOverallStatus('running');
    setJobs(makeFreshJobs());

    const runJob = async (key: string) => {
      setJobStatus(key, { status: 'running' });
      const start = Date.now();
      try {
        if (key === 'fetch-matches')   await triggerFixtureSync('all');
        else if (key === 'fetch-odds') await triggerOddsSync();
        else if (key === 'sync-standings') await triggerStandingsSync(false);
        else if (key === 'sync-live') await triggerLiveSync(false);
        setJobStatus(key, { status: 'success', durationMs: Date.now() - start });
      } catch (e) {
        setJobStatus(key, { status: 'error', durationMs: Date.now() - start, errorMessage: String(e) });
      }
    };

    for (const job of SYNC_ALL_DEFINITIONS) { await runJob(job.key); }
    setRunning(false);
    setOverallStatus('done');
    onComplete();
  }, [running, onComplete]);

  const reset = () => { setJobs(makeFreshJobs()); setOverallStatus('idle'); };

  const statusIcon = (s: SyncAllStatus, color: string) => {
    if (s === 'running') return null;
    if (s === 'success') return <Ionicons name="checkmark-circle" size={16} color="#22C55E" />;
    if (s === 'error')   return <Ionicons name="close-circle" size={16} color="#EF4444" />;
    return <Ionicons name="ellipse-outline" size={16} color={C.textMuted} />;
  };

  const allDone = jobs.every((j) => j.status === 'success' || j.status === 'error');
  const hasErrors = jobs.some((j) => j.status === 'error');
  const doneCount = jobs.filter((j) => j.status === 'success' || j.status === 'error').length;
  const progressPct = Math.round((doneCount / SYNC_ALL_DEFINITIONS.length) * 100);

  const borderColor = overallStatus === 'running'
    ? `${C.primary}55`
    : overallStatus === 'done'
    ? (hasErrors ? `${C.accentRed}44` : '#22C55E44')
    : C.border;

  return (
    <View style={[sal.card, { backgroundColor: C.card, borderColor }]}>
      <View style={sal.header}>
        <View style={[sal.iconWrap, { backgroundColor: `${C.primary}15`, borderColor: `${C.primary}30` }]}>
          <Ionicons name="sync-circle-outline" size={22} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[sal.title, { color: C.textPrimary }]}>Sync All Data</Text>
          <Text style={[sal.sub, { color: C.textMuted }]}>
            {overallStatus === 'idle' ? '4 jobs in sequence: matches, odds, standings, live' :
             overallStatus === 'running' ? `Running job ${doneCount + 1} of ${SYNC_ALL_DEFINITIONS.length}...` :
             hasErrors ? 'Completed with errors — see details below' :
             'All 4 jobs completed successfully'}
          </Text>
        </View>
        {overallStatus === 'done' ? (
          <Pressable
            onPress={reset} hitSlop={8}
            style={({ pressed }) => [sal.resetBtn, { borderColor: C.border }, pressed ? { opacity: 0.6 } : null]}
          >
            <Ionicons name="refresh-outline" size={16} color={C.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {overallStatus !== 'idle' ? (
        <View style={[sal.jobList, { borderColor: C.border }]}>
          {jobs.map((job, idx) => {
            const isRunning = job.status === 'running';
            return (
              <View
                key={job.key}
                style={[
                  sal.jobRow,
                  { borderBottomColor: C.border },
                  idx === jobs.length - 1 ? { borderBottomWidth: 0 } : null,
                  isRunning ? { backgroundColor: `${job.color}08` } : null,
                ]}
              >
                <View style={[sal.stepBadge, { backgroundColor: `${job.color}15`, borderColor: `${job.color}30` }]}>
                  {isRunning ? (
                    <ActivityIndicator size="small" color={job.color} />
                  ) : (
                    <Ionicons name={job.icon as any} size={14}
                      color={job.status === 'idle' ? C.textMuted : job.color} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[sal.jobLabel, {
                    color: job.status === 'idle' ? C.textMuted : C.textPrimary,
                    fontWeight: isRunning ? FONTS.bold : FONTS.medium,
                  }]}>{job.label}</Text>
                  {job.errorMessage ? (
                    <Text style={[sal.jobError, { color: C.accentRed }]} numberOfLines={2}>
                      {job.errorMessage}
                    </Text>
                  ) : null}
                </View>
                <View style={sal.jobRight}>
                  {job.durationMs != null ? (
                    <Text style={[sal.jobDuration, { color: C.textMuted }]}>
                      {(job.durationMs / 1000).toFixed(1)}s
                    </Text>
                  ) : null}
                  {isRunning ? (
                    <View style={[sal.runningPill, { backgroundColor: `${job.color}15`, borderColor: `${job.color}44` }]}>
                      <Text style={[sal.runningPillText, { color: job.color }]}>RUNNING</Text>
                    </View>
                  ) : statusIcon(job.status, job.color)}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {overallStatus === 'running' ? (
        <View style={[sal.progressTrack, { backgroundColor: C.surface }]}>
          <View style={[sal.progressFill, { width: `${progressPct}%` as any, backgroundColor: C.primary }]} />
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          sal.btn,
          {
            backgroundColor: running
              ? `${C.primary}60`
              : overallStatus === 'done' && !hasErrors ? '#22C55E'
              : C.primary,
          },
          pressed && !running ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
        ]}
        onPress={overallStatus === 'done' ? reset : handleSyncAll}
        disabled={running}
      >
        {running ? (
          <><ActivityIndicator size="small" color="#fff" /><Text style={sal.btnText}>Syncing...</Text></>
        ) : overallStatus === 'done' ? (
          <><Ionicons name={hasErrors ? 'refresh-outline' : 'checkmark-circle-outline'} size={16} color="#fff" /><Text style={sal.btnText}>{hasErrors ? 'Retry Failed Jobs' : 'Sync Again'}</Text></>
        ) : (
          <><Ionicons name="sync-outline" size={16} color="#fff" /><Text style={sal.btnText}>Sync All Data Now</Text></>
        )}
      </Pressable>
    </View>
  );
}

const sal = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 15, fontWeight: FONTS.bold },
  sub: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  resetBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  jobList: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  stepBadge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  jobLabel: { fontSize: 13 },
  jobError: { fontSize: 10, lineHeight: 14 },
  jobRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobDuration: { fontSize: 10, fontWeight: FONTS.medium },
  runningPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  runningPillText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 13 },
  btnText: { fontSize: 14, fontWeight: FONTS.bold, color: '#fff' },
});

// ─── Webhook Test Panel ─────────────────────────────────────────────────────
interface WebhookTestResult {
  auth_method: string;
  upserted: number;
  durationMs: number;
  message: string;
  hmac_configured: boolean;
  px_configured?: boolean;
  supported_headers?: string[];
  error?: string;
}

function WebhookTestPanel({ C, onLog }: { C: AppColors; onLog: (line: string) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [hasError, setHasError] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    setHasError(false);
    const start = Date.now();
    onLog('⏳ Sending test ping to webhook-receiver...');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('webhook-receiver', {
        body: {
          type: 'test',
          admin_test: true,
          provider: 'admin-panel',
          timestamp: new Date().toISOString(),
          sample: { sport: 'football', note: 'Admin connectivity test' },
        },
      });
      const elapsed = Date.now() - start;
      if (error) {
        let msg = error.message;
        try {
          const txt = await (error as any).context?.text();
          if (txt) msg = txt;
        } catch { /* ignore */ }
        setHasError(true);
        setResult({ auth_method: 'none', upserted: 0, durationMs: elapsed, message: msg, hmac_configured: false, error: msg });
        onLog(`❌ Webhook test failed: ${msg.slice(0, 80)}`);
      } else {
        setResult({
          auth_method: data?.auth_method ?? 'unknown',
          upserted: data?.upserted ?? 0,
          durationMs: data?.durationMs ?? elapsed,
          message: data?.message ?? 'Test completed',
          hmac_configured: data?.hmac_configured ?? false,
          px_configured: data?.px_configured ?? false,
          supported_headers: data?.supported_headers,
        });
        onLog(`✅ Webhook test passed — auth=${data?.auth_method} ${data?.durationMs ?? elapsed}ms`);
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      const msg = String(e);
      setHasError(true);
      setResult({ auth_method: 'none', upserted: 0, durationMs: elapsed, message: msg, hmac_configured: false, error: msg });
      onLog(`❌ Webhook test error: ${msg.slice(0, 80)}`);
    }
    setTesting(false);
  }, [onLog]);

  return (
    <View style={[wt.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={wt.header}>
        <View style={[wt.iconWrap, { backgroundColor: `${C.accentPurple}15`, borderColor: `${C.accentPurple}30` }]}>
          <Ionicons name="git-merge-outline" size={18} color={C.accentPurple} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[wt.title, { color: C.textPrimary }]}>Webhook Test</Text>
          <Text style={[wt.sub, { color: C.textMuted }]}>Verify HMAC auth flow end-to-end</Text>
        </View>
        <View style={[wt.jwtPill, { backgroundColor: `${C.accentBlue}12`, borderColor: `${C.accentBlue}33` }]}>
          <Ionicons name="key-outline" size={10} color={C.accentBlue} />
          <Text style={[wt.jwtText, { color: C.accentBlue }]}>JWT bypass</Text>
        </View>
      </View>

      {/* Payload preview */}
      <View style={[wt.payloadBox, { backgroundColor: C.surface, borderColor: C.border }]}>
        <Text style={[wt.payloadLabel, { color: C.textMuted }]}>SAMPLE PAYLOAD</Text>
        <Text style={[wt.payloadCode, { color: C.textSecondary }]}>
          {'{ type: "test", admin_test: true,\n  provider: "admin-panel", timestamp: now }'}
        </Text>
      </View>

      {/* Test button */}
      <Pressable
        style={({ pressed }) => [
          wt.btn,
          { backgroundColor: testing ? `${C.accentPurple}60` : C.accentPurple },
          pressed && !testing ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : null,
        ]}
        onPress={handleTest}
        disabled={testing}
      >
        {testing ? (
          <><ActivityIndicator size="small" color="#fff" /><Text style={wt.btnText}>Sending...</Text></>
        ) : (
          <><Ionicons name="send-outline" size={14} color="#fff" /><Text style={wt.btnText}>Send Test Ping</Text></>
        )}
      </Pressable>

      {/* Result panel */}
      {result ? (
        <View style={[wt.resultBox, {
          backgroundColor: hasError ? `${C.accentRed}0A` : '#22C55E0A',
          borderColor: hasError ? `${C.accentRed}33` : '#22C55E33',
        }]}>
          <View style={wt.resultHeader}>
            <Ionicons
              name={hasError ? 'close-circle' : 'checkmark-circle'}
              size={16}
              color={hasError ? C.accentRed : '#22C55E'}
            />
            <Text style={[wt.resultStatus, { color: hasError ? C.accentRed : '#22C55E' }]}>
              {hasError ? 'Test Failed' : 'Test Passed'}
            </Text>
          </View>

          <View style={wt.resultGrid}>
            {[
              { label: 'Auth Method', value: result.auth_method, color: C.accentBlue },
              { label: 'Duration', value: `${result.durationMs}ms`, color: C.primary },
              { label: 'Upserted', value: String(result.upserted), color: '#22C55E' },
              { label: 'HMAC Secret', value: result.hmac_configured ? 'Set ✓' : 'Not set', color: result.hmac_configured ? '#22C55E' : '#F59E0B' },
            ].map((item) => (
              <View key={item.label} style={[wt.resultCell, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[wt.resultCellVal, { color: item.color }]}>{item.value}</Text>
                <Text style={[wt.resultCellLabel, { color: C.textMuted }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          {result.supported_headers ? (
            <View style={[wt.headersRow, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Ionicons name="shield-checkmark-outline" size={11} color={C.textMuted} />
              <Text style={[wt.headersText, { color: C.textMuted }]} numberOfLines={2}>
                Accepted: {result.supported_headers.join(' · ')}
              </Text>
            </View>
          ) : null}

          {result.message ? (
            <Text style={[wt.resultMessage, { color: hasError ? C.accentRed : C.textMuted }]} numberOfLines={3}>
              {result.message}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const wt = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontSize: 15, fontWeight: FONTS.bold },
  sub: { fontSize: 11, marginTop: 1 },
  jwtPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  jwtText: { fontSize: 9, fontWeight: FONTS.bold },
  payloadBox: { borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 4 },
  payloadLabel: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  payloadCode: { fontSize: 11, lineHeight: 17 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 12 },
  btnText: { fontSize: 14, fontWeight: FONTS.bold, color: '#fff' },
  resultBox: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 10 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultStatus: { fontSize: 14, fontWeight: FONTS.bold },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultCell: { flex: 1, minWidth: '44%', borderRadius: RADIUS.md, borderWidth: 1, padding: 10, gap: 3, alignItems: 'center' },
  resultCellVal: { fontSize: 14, fontWeight: FONTS.extraBold },
  resultCellLabel: { fontSize: 9, fontWeight: FONTS.medium },
  headersRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  headersText: { flex: 1, fontSize: 10, lineHeight: 15 },
  resultMessage: { fontSize: 11, lineHeight: 16 },
});

// ─── Sync Monitor Tab ────────────────────────────────────────────────────────
interface SyncLog {
  id: string;
  jobName: string;
  status: 'success' | 'error' | 'skipped';
  recordsAffected: number;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
}

const SYNC_JOBS = [
  { key: 'fixture-sync',    label: 'Fixtures',       icon: 'football-outline',        color: '#3B82F6',  desc: 'Syncs today\'s matches from API-Football & TheSportsDB' },
  { key: 'live-sync',       label: 'Live Scores',    icon: 'pulse-outline',           color: '#EF4444',  desc: 'Updates live match scores and triggers goal alerts' },
  { key: 'odds-sync',       label: 'Betting Odds',   icon: 'trending-up-outline',     color: '#22C55E',  desc: 'Fetches latest pre-match and in-play odds from API-Football' },
  { key: 'standings-sync',  label: 'Standings',      icon: 'podium-outline',          color: '#8B5CF6',  desc: 'Syncs league standings for top 9 football leagues' },
  { key: 'player-stats',    label: 'Player Stats',   icon: 'stats-chart-outline',     color: '#F59E0B',  desc: 'Syncs top scorer and player stats (runs with standings)' },
  { key: 'highlight-sync',  label: 'Highlights',     icon: 'videocam-outline',        color: '#EC4899',  desc: 'Pulls latest match highlights via Highlightly API' },
];

async function fetchSyncLogs(): Promise<SyncLog[]> {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb
      .from('sync_logs')
      .select('id, job_name, status, records_affected, duration_ms, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      jobName: r.job_name,
      status: r.status,
      recordsAffected: Number(r.records_affected ?? 0),
      durationMs: Number(r.duration_ms ?? 0),
      errorMessage: r.error_message ?? null,
      createdAt: r.created_at,
    }));
  } catch { return []; }
}

function SyncMonitorTab({ C }: { C: AppColors }) {
  const { showAlert } = useAlert();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [webhookLog, setWebhookLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchSyncLogs();
    setLogs(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Per-job stats derived from sync_logs
  const jobStats = useMemo(() => {
    const map: Record<string, {
      lastRun: string | null;
      successCount: number;
      errorCount: number;
      totalRecords: number;
      avgDurationMs: number;
      lastDurationMs: number;
      lastStatus: string;
      lastError: string | null;
      recentLogs: SyncLog[];
    }> = {};

    for (const job of SYNC_JOBS) {
      map[job.key] = { lastRun: null, successCount: 0, errorCount: 0, totalRecords: 0, avgDurationMs: 0, lastDurationMs: 0, lastStatus: 'never', lastError: null, recentLogs: [] };
    }

    for (const log of logs) {
      // Match log.jobName to one of our SYNC_JOBS keys (fuzzy match)
      const matchedJob = SYNC_JOBS.find((j) =>
        log.jobName.toLowerCase().includes(j.key.replace('-sync', '').replace('-', '')) ||
        j.key.replace('-sync', '').replace('-', '').includes(log.jobName.toLowerCase().split('-')[0])
      );
      if (!matchedJob) continue;
      const entry = map[matchedJob.key];
      entry.recentLogs.push(log);
      if (!entry.lastRun || log.createdAt > entry.lastRun) {
        entry.lastRun = log.createdAt;
        entry.lastDurationMs = log.durationMs;
        entry.lastStatus = log.status;
        entry.lastError = log.errorMessage;
      }
      if (log.status === 'success') entry.successCount++;
      else if (log.status === 'error') entry.errorCount++;
      entry.totalRecords += log.recordsAffected;
    }

    // Compute avg duration per job
    for (const key of Object.keys(map)) {
      const entry = map[key];
      const durLogs = entry.recentLogs.filter((l) => l.durationMs > 0);
      entry.avgDurationMs = durLogs.length > 0
        ? Math.round(durLogs.reduce((s, l) => s + l.durationMs, 0) / durLogs.length)
        : 0;
    }

    return map;
  }, [logs]);

  // Overall health stats
  const totalSuccess = Object.values(jobStats).reduce((s, j) => s + j.successCount, 0);
  const totalErrors = Object.values(jobStats).reduce((s, j) => s + j.errorCount, 0);
  const healthRate = totalSuccess + totalErrors > 0 ? Math.round((totalSuccess / (totalSuccess + totalErrors)) * 100) : 0;
  const jobsWithErrors = Object.values(jobStats).filter((j) => j.lastStatus === 'error').length;

  const handleTrigger = useCallback(async (jobKey: string) => {
    setTriggering(jobKey);
    const start = Date.now();
    try {
      if (jobKey === 'fixture-sync') {
        await triggerFixtureSync('all');
      } else if (jobKey === 'live-sync') {
        await triggerLiveSync(false);
      } else if (jobKey === 'odds-sync') {
        await triggerOddsSync();
      } else if (jobKey === 'standings-sync' || jobKey === 'player-stats') {
        await triggerStandingsSync(jobKey === 'player-stats');
      } else if (jobKey === 'highlight-sync') {
        await triggerHighlightsSync(20);
      } else {
        await new Promise((r) => setTimeout(r, 800));
      }
      const elapsed = Date.now() - start;
      showAlert('Triggered', `${SYNC_JOBS.find((j) => j.key === jobKey)?.label} sync completed in ${(elapsed / 1000).toFixed(1)}s`);
      await load();
    } catch (e) {
      showAlert('Error', `Sync failed: ${String(e)}`);
    }
    setTriggering(null);
  }, [load, showAlert]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: SPACING.md, gap: 14, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Webhook Test */}
      <WebhookTestPanel
        C={C}
        onLog={(line) => setWebhookLog((prev) => [line, ...prev].slice(0, 8))}
      />

      {/* Webhook test log */}
      {webhookLog.length > 0 ? (
        <View style={[sm.summaryCard, { backgroundColor: C.card, borderColor: C.border, gap: 6, paddingVertical: 10 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <Ionicons name="terminal-outline" size={12} color={C.primary} />
            <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.textPrimary, flex: 1 }}>Webhook Log</Text>
            <Pressable onPress={() => setWebhookLog([])} hitSlop={8}>
              <Ionicons name="close" size={14} color={C.textMuted} />
            </Pressable>
          </View>
          {webhookLog.map((line, i) => (
            <Text key={i} style={[{
              fontSize: 11, lineHeight: 16,
              color: line.startsWith('✅') ? '#22C55E' : line.startsWith('❌') ? C.accentRed : C.textMuted,
            }]} numberOfLines={2}>{line}</Text>
          ))}
        </View>
      ) : null}

      {/* Sync All Data */}
      <SyncAllButton C={C} onComplete={load} />

      {/* Health Summary */}
      <View style={[sm.summaryCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={sm.summaryHeader}>
          <View style={[sm.summaryIconWrap, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
            <Ionicons name="sync-outline" size={20} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[sm.summaryTitle, { color: C.textPrimary }]}>Sync Health</Text>
            <Text style={[sm.summarySub, { color: C.textMuted }]}>
              {jobsWithErrors > 0
                ? `${jobsWithErrors} job${jobsWithErrors !== 1 ? 's' : ''} need attention`
                : 'All jobs running normally'}
            </Text>
          </View>
          <View style={[sm.healthPill, {
            backgroundColor: healthRate >= 90 ? '#22C55E18' : healthRate >= 70 ? '#F59E0B18' : `${C.accentRed}18`,
            borderColor: healthRate >= 90 ? '#22C55E44' : healthRate >= 70 ? '#F59E0B44' : `${C.accentRed}44`,
          }]}>
            <Text style={[sm.healthPct, {
              color: healthRate >= 90 ? '#22C55E' : healthRate >= 70 ? '#F59E0B' : C.accentRed,
            }]}>{healthRate}%</Text>
            <Text style={[sm.healthLabel, { color: C.textMuted }]}>health</Text>
          </View>
        </View>

        {/* Health bar */}
        <View style={[sm.healthTrack, { backgroundColor: C.surface }]}>
          <View style={[
            sm.healthFill,
            {
              width: `${healthRate}%` as any,
              backgroundColor: healthRate >= 90 ? '#22C55E' : healthRate >= 70 ? '#F59E0B' : C.accentRed,
            },
          ]} />
        </View>

        {/* Stats row */}
        <View style={sm.summaryStatsRow}>
          <View style={sm.summaryStatCell}>
            <Text style={[sm.summaryStatVal, { color: '#22C55E' }]}>{totalSuccess}</Text>
            <Text style={[sm.summaryStatLbl, { color: C.textMuted }]}>Successes</Text>
          </View>
          <View style={[sm.summaryStatDivider, { backgroundColor: C.border }]} />
          <View style={sm.summaryStatCell}>
            <Text style={[sm.summaryStatVal, { color: totalErrors > 0 ? C.accentRed : C.textMuted }]}>{totalErrors}</Text>
            <Text style={[sm.summaryStatLbl, { color: C.textMuted }]}>Errors</Text>
          </View>
          <View style={[sm.summaryStatDivider, { backgroundColor: C.border }]} />
          <View style={sm.summaryStatCell}>
            <Text style={[sm.summaryStatVal, { color: C.primary }]}>{logs.length}</Text>
            <Text style={[sm.summaryStatLbl, { color: C.textMuted }]}>Total Runs</Text>
          </View>
          <View style={[sm.summaryStatDivider, { backgroundColor: C.border }]} />
          <View style={sm.summaryStatCell}>
            <Text style={[sm.summaryStatVal, { color: C.accentBlue }]}>{jobsWithErrors}</Text>
            <Text style={[sm.summaryStatLbl, { color: C.textMuted }]}>Alerts</Text>
          </View>
        </View>
      </View>

      {/* Job Cards */}
      <Text style={[sm.sectionTitle, { color: C.textPrimary }]}>Background Jobs</Text>
      {SYNC_JOBS.map((job) => {
        const stats = jobStats[job.key];
        const isExpanded = expandedJob === job.key;
        const isTriggering = triggering === job.key;
        const statusColor =
          stats.lastStatus === 'success' ? '#22C55E'
          : stats.lastStatus === 'error' ? C.accentRed
          : stats.lastStatus === 'skipped' ? '#F59E0B'
          : C.textMuted;
        const statusIcon =
          stats.lastStatus === 'success' ? 'checkmark-circle' as const
          : stats.lastStatus === 'error' ? 'close-circle' as const
          : stats.lastStatus === 'skipped' ? 'time-outline' as const
          : 'help-circle-outline' as const;

        return (
          <View key={job.key} style={[sm.jobCard, { backgroundColor: C.card, borderColor: isExpanded ? `${job.color}55` : C.border }]}>
            {/* Left accent stripe */}
            <View style={[sm.jobStripe, { backgroundColor: job.color }]} />

            <View style={{ flex: 1 }}>
              {/* Header row — tap to expand */}
              <Pressable
                style={({ pressed }) => [sm.jobHeader, pressed ? { opacity: 0.85 } : null]}
                onPress={() => setExpandedJob(isExpanded ? null : job.key)}
              >
                <View style={[sm.jobIconWrap, { backgroundColor: `${job.color}15`, borderColor: `${job.color}30` }]}>
                  <Ionicons name={job.icon as any} size={18} color={job.color} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[sm.jobLabel, { color: C.textPrimary }]}>{job.label}</Text>
                  <Text style={[sm.jobDesc, { color: C.textMuted }]} numberOfLines={1}>{job.desc}</Text>
                </View>

                {/* Status indicator */}
                <View style={sm.jobStatusGroup}>
                  <Ionicons name={statusIcon} size={16} color={statusColor} />
                  {stats.lastRun ? (
                    <Text style={[sm.jobLastRun, { color: C.textMuted }]}>{timeAgo(stats.lastRun)}</Text>
                  ) : (
                    <Text style={[sm.jobLastRun, { color: C.textMuted }]}>Never</Text>
                  )}
                  <MaterialIcons
                    name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={16}
                    color={C.textMuted}
                  />
                </View>
              </Pressable>

              {/* Collapsed mini-stats row */}
              {!isExpanded ? (
                <View style={[sm.jobMiniStats, { borderTopColor: C.border }]}>
                  <View style={sm.miniStatCell}>
                    <Text style={[sm.miniStatVal, { color: '#22C55E' }]}>{stats.successCount}</Text>
                    <Text style={[sm.miniStatLbl, { color: C.textMuted }]}>OK</Text>
                  </View>
                  <View style={[sm.miniStatDivider, { backgroundColor: C.border }]} />
                  <View style={sm.miniStatCell}>
                    <Text style={[sm.miniStatVal, { color: stats.errorCount > 0 ? C.accentRed : C.textMuted }]}>{stats.errorCount}</Text>
                    <Text style={[sm.miniStatLbl, { color: C.textMuted }]}>Err</Text>
                  </View>
                  <View style={[sm.miniStatDivider, { backgroundColor: C.border }]} />
                  <View style={sm.miniStatCell}>
                    <Text style={[sm.miniStatVal, { color: C.textSecondary }]}>{stats.totalRecords.toLocaleString()}</Text>
                    <Text style={[sm.miniStatLbl, { color: C.textMuted }]}>Records</Text>
                  </View>
                  <View style={[sm.miniStatDivider, { backgroundColor: C.border }]} />
                  <View style={sm.miniStatCell}>
                    <Text style={[sm.miniStatVal, { color: C.textSecondary }]}>
                      {stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                    </Text>
                    <Text style={[sm.miniStatLbl, { color: C.textMuted }]}>Avg</Text>
                  </View>

                  {/* Trigger button */}
                  <Pressable
                    style={({ pressed }) => [
                      sm.triggerBtnMini,
                      { backgroundColor: `${job.color}15`, borderColor: `${job.color}44` },
                      isTriggering ? { opacity: 0.5 } : null,
                      pressed && !isTriggering ? { opacity: 0.75, transform: [{ scale: 0.97 }] } : null,
                    ]}
                    onPress={() => handleTrigger(job.key)}
                    disabled={isTriggering || triggering !== null}
                  >
                    {isTriggering ? (
                      <ActivityIndicator size="small" color={job.color} />
                    ) : (
                      <Ionicons name="play" size={12} color={job.color} />
                    )}
                  </Pressable>
                </View>
              ) : null}

              {/* Expanded detail */}
              {isExpanded ? (
                <View style={[sm.jobExpanded, { borderTopColor: C.border }]}>
                  <Text style={[sm.expandedDesc, { color: C.textSecondary }]}>{job.desc}</Text>

                  {/* Full stats grid */}
                  <View style={sm.expandedGrid}>
                    {[
                      { label: 'Last Run', value: stats.lastRun ? timeAgo(stats.lastRun) : 'Never', color: C.textPrimary },
                      { label: 'Last Duration', value: stats.lastDurationMs > 0 ? `${(stats.lastDurationMs / 1000).toFixed(2)}s` : '—', color: C.textPrimary },
                      { label: 'Success Runs', value: String(stats.successCount), color: '#22C55E' },
                      { label: 'Error Runs', value: String(stats.errorCount), color: stats.errorCount > 0 ? C.accentRed : C.textMuted },
                      { label: 'Total Records', value: stats.totalRecords.toLocaleString(), color: C.accentBlue },
                      { label: 'Avg Duration', value: stats.avgDurationMs > 0 ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '—', color: C.textPrimary },
                    ].map((stat) => (
                      <View key={stat.label} style={[sm.expandedGridCell, { backgroundColor: C.surface, borderColor: C.border }]}>
                        <Text style={[sm.expandedGridVal, { color: stat.color }]}>{stat.value}</Text>
                        <Text style={[sm.expandedGridLbl, { color: C.textMuted }]}>{stat.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Last error */}
                  {stats.lastError ? (
                    <View style={[sm.lastErrorBox, { backgroundColor: `${C.accentRed}10`, borderColor: `${C.accentRed}33` }]}>
                      <Ionicons name="warning-outline" size={13} color={C.accentRed} />
                      <Text style={[sm.lastErrorText, { color: C.accentRed }]}>{stats.lastError}</Text>
                    </View>
                  ) : null}

                  {/* Recent run timeline (last 5) */}
                  {stats.recentLogs.length > 0 ? (
                    <>
                      <Text style={[sm.timelineTitle, { color: C.textMuted }]}>RECENT RUNS</Text>
                      {stats.recentLogs.slice(0, 5).map((log) => {
                        const lc = log.status === 'success' ? '#22C55E' : log.status === 'error' ? C.accentRed : '#F59E0B';
                        return (
                          <View key={log.id} style={sm.timelineRow}>
                            <View style={[sm.timelineDot, { backgroundColor: lc, borderColor: `${lc}44` }]} />
                            <View style={sm.timelineInfo}>
                              <View style={sm.timelineTopRow}>
                                <Text style={[sm.timelineStatus, { color: lc }]}>{log.status.toUpperCase()}</Text>
                                <Text style={[sm.timelineTime, { color: C.textMuted }]}>{timeAgo(log.createdAt)}</Text>
                              </View>
                              <View style={sm.timelineBottomRow}>
                                <Text style={[sm.timelineRecords, { color: C.textMuted }]}>
                                  {log.recordsAffected > 0 ? `${log.recordsAffected.toLocaleString()} records` : 'No records'}
                                </Text>
                                {log.durationMs > 0 ? (
                                  <Text style={[sm.timelineDuration, { color: C.textMuted }]}>
                                    {(log.durationMs / 1000).toFixed(2)}s
                                  </Text>
                                ) : null}
                              </View>
                              {log.errorMessage ? (
                                <Text style={[sm.timelineError, { color: C.accentRed }]} numberOfLines={2}>
                                  {log.errorMessage}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  ) : null}

                  {/* Manual trigger button */}
                  <Pressable
                    style={({ pressed }) => [
                      sm.triggerBtn,
                      { backgroundColor: job.color },
                      isTriggering ? { opacity: 0.5 } : null,
                      pressed && !isTriggering ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : null,
                    ]}
                    onPress={() => handleTrigger(job.key)}
                    disabled={isTriggering || triggering !== null}
                  >
                    {isTriggering ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="play-circle-outline" size={16} color="#fff" />
                        <Text style={sm.triggerBtnText}>Run {job.label} Now</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const sm = StyleSheet.create({
  sectionTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: -4 },
  summaryCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, gap: 14 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryIconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontSize: 16, fontWeight: FONTS.bold },
  summarySub: { fontSize: 12, marginTop: 2 },
  healthPill: { alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  healthPct: { fontSize: 20, fontWeight: FONTS.extraBold },
  healthLabel: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  healthTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 4 },
  summaryStatsRow: { flexDirection: 'row', alignItems: 'center' },
  summaryStatCell: { flex: 1, alignItems: 'center', gap: 3 },
  summaryStatVal: { fontSize: 22, fontWeight: FONTS.extraBold },
  summaryStatLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryStatDivider: { width: 1, height: 30, marginHorizontal: 4 },
  // Job cards
  jobCard: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  jobStripe: { width: 4 },
  jobHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  jobIconWrap: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  jobLabel: { fontSize: 14, fontWeight: FONTS.bold },
  jobDesc: { fontSize: 11 },
  jobStatusGroup: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  jobLastRun: { fontSize: 10, fontWeight: FONTS.medium },
  // Mini stats bar
  jobMiniStats: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10 },
  miniStatCell: { flex: 1, alignItems: 'center', gap: 2 },
  miniStatVal: { fontSize: 14, fontWeight: FONTS.extraBold },
  miniStatLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.4 },
  miniStatDivider: { width: 1, height: 24, marginHorizontal: 4 },
  triggerBtnMini: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginLeft: 4, flexShrink: 0,
  },
  // Expanded section
  jobExpanded: { borderTopWidth: 1, padding: 14, gap: 12 },
  expandedDesc: { fontSize: 12, lineHeight: 18 },
  expandedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  expandedGridCell: { width: '47%', flexGrow: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, gap: 3 },
  expandedGridVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  expandedGridLbl: { fontSize: 10, fontWeight: FONTS.medium },
  lastErrorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: RADIUS.md, borderWidth: 1, padding: 10 },
  lastErrorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  timelineTitle: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase' },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 3, flexShrink: 0 },
  timelineInfo: { flex: 1, gap: 2 },
  timelineTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineStatus: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  timelineTime: { fontSize: 10 },
  timelineBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineRecords: { fontSize: 11 },
  timelineDuration: { fontSize: 11 },
  timelineError: { fontSize: 10, lineHeight: 15 },
  triggerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: RADIUS.full, paddingVertical: 12, marginTop: 4,
  },
  triggerBtnText: { fontSize: 14, fontWeight: FONTS.bold, color: '#fff' },
});

// ─── Translations Tab ─────────────────────────────────────────────────────────
function TranslationsTab({ C }: { C: AppColors }) {
  const [stats, setStats] = useState<any[]>([]);
  const [cache, setCache] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState<'stats' | 'cache'>('stats');

  const LANG_FLAGS: Record<string, string> = {
    fr: '🇫🇷', es: '🇪🇸', pt: '🇧🇷', ar: '🇸🇦', sw: '🇰🇪', en: '🇬🇧',
    de: '🇩🇪', it: '🇮🇹', zh: '🇨🇳', ja: '🇯🇵',
  };

  const load = useCallback(async () => {
    try {
      const sb = getSupabaseClient();
      const [statsRes, cacheRes] = await Promise.all([
        sb.from('translation_stats').select('*').order('date', { ascending: false }).limit(50),
        sb.from('translations_cache').select('target_language, content_type, hit_count, created_at, original_text, translated_text').order('hit_count', { ascending: false }).limit(50),
      ]);
      setStats(statsRes.data ?? []);
      setCache(cacheRes.data ?? []);
    } catch { setStats([]); setCache([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Aggregate stats by language
  const byLang = useMemo(() => {
    const map: Record<string, { requests: number; cacheHits: number; errors: number }> = {};
    for (const s of stats) {
      if (!map[s.target_language]) map[s.target_language] = { requests: 0, cacheHits: 0, errors: 0 };
      map[s.target_language].requests += s.request_count ?? 0;
      map[s.target_language].cacheHits += s.cache_hit_count ?? 0;
      map[s.target_language].errors += s.error_count ?? 0;
    }
    return Object.entries(map).sort((a, b) => b[1].requests - a[1].requests);
  }, [stats]);

  const totalRequests = byLang.reduce((s, [, d]) => s + d.requests, 0);
  const totalCacheHits = byLang.reduce((s, [, d]) => s + d.cacheHits, 0);
  const cacheHitRate = totalRequests > 0 ? Math.round((totalCacheHits / (totalRequests + totalCacheHits)) * 100) : 0;

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: SPACING.md, gap: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}>

      {/* Summary cards */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { label: 'Total Requests', value: totalRequests, icon: 'language-outline', color: C.accentBlue },
          { label: 'Cache Hits', value: totalCacheHits, icon: 'flash-outline', color: '#22C55E' },
          { label: 'Cache Rate', value: `${cacheHitRate}%`, icon: 'pie-chart-outline', color: C.primary },
          { label: 'Cached Texts', value: cache.length, icon: 'archive-outline', color: '#F59E0B' },
        ].map((card) => (
          <View key={card.label} style={[{ flex: 1, borderRadius: RADIUS.xl, borderWidth: 1, padding: 10, gap: 6, alignItems: 'center' }, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name={card.icon as any} size={18} color={card.color} />
            <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{String(card.value)}</Text>
            <Text style={{ fontSize: 9, color: C.textMuted, textAlign: 'center', fontWeight: FONTS.medium }}>{card.label}</Text>
          </View>
        ))}
      </View>

      {/* Section toggle */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['stats', 'cache'] as const).map((s) => (
          <Pressable key={s}
            style={[{ flex: 1, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 9, alignItems: 'center' }, activeSection === s ? { backgroundColor: `${C.primary}18`, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }]}
            onPress={() => setActiveSection(s)}>
            <Text style={{ fontSize: 13, fontWeight: FONTS.semiBold, color: activeSection === s ? C.primary : C.textMuted }}>{s === 'stats' ? '📊 Usage Stats' : '💾 Translation Cache'}</Text>
          </Pressable>
        ))}
      </View>

      {activeSection === 'stats' ? (
        <>
          {byLang.length === 0 ? (
            <View style={[{ borderRadius: RADIUS.xl, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 }, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="language-outline" size={36} color={C.textMuted} />
              <Text style={{ color: C.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 20 }}>No translation requests yet.{`\n`}Language usage will appear here once users switch languages.</Text>
            </View>
          ) : (
            byLang.map(([lang, data]) => {
              const flag = LANG_FLAGS[lang] ?? '🌍';
              const apiRequests = data.requests;
              const totalCallsForLang = apiRequests + data.cacheHits;
              const rate = totalCallsForLang > 0 ? Math.round((data.cacheHits / totalCallsForLang) * 100) : 0;
              return (
                <View key={lang} style={[{ borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 }, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ fontSize: 28 }}>{flag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: FONTS.bold, color: C.textPrimary }}>{lang.toUpperCase()}</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted }}>{totalCallsForLang.toLocaleString()} total calls · {rate}% cache hit</Text>
                    </View>
                    {data.errors > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${C.accentRed}14`, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${C.accentRed}33` }}>
                        <Ionicons name="warning-outline" size={11} color={C.accentRed} />
                        <Text style={{ fontSize: 10, color: C.accentRed, fontWeight: FONTS.bold }}>{data.errors} err</Text>
                      </View>
                    ) : null}
                  </View>
                  {/* Mini bar */}
                  <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: C.surface, flexDirection: 'row', gap: 1 }}>
                    {data.cacheHits > 0 ? <View style={{ flex: data.cacheHits, backgroundColor: '#22C55E', borderRadius: 3 }} /> : null}
                    {data.requests > 0 ? <View style={{ flex: data.requests, backgroundColor: C.accentBlue, borderRadius: 3 }} /> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    {[{ color: '#22C55E', label: 'Cache hits', val: data.cacheHits }, { color: C.accentBlue, label: 'AI requests', val: data.requests }].map((item) => (
                      <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
                        <Text style={{ fontSize: 11, color: C.textMuted }}>{item.label}: <Text style={{ fontWeight: FONTS.bold, color: C.textSecondary }}>{item.val.toLocaleString()}</Text></Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </>
      ) : (
        <>
          <Text style={{ fontSize: 13, color: C.textMuted }}>Top {cache.length} cached translations by usage frequency</Text>
          {cache.length === 0 ? (
            <View style={[{ borderRadius: RADIUS.xl, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 }, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="archive-outline" size={36} color={C.textMuted} />
              <Text style={{ color: C.textMuted, textAlign: 'center', fontSize: 13 }}>No cached translations yet</Text>
            </View>
          ) : (
            cache.map((item, idx) => {
              const flag = LANG_FLAGS[item.target_language] ?? '🌍';
              return (
                <View key={idx} style={[{ borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 8 }, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 18 }}>{flag}</Text>
                    <View style={[{ borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 }, { backgroundColor: C.surface, borderColor: C.border }]}>
                      <Text style={{ fontSize: 9, fontWeight: FONTS.bold, color: C.textMuted }}>{item.content_type?.replace(/_/g, ' ')?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="flash-outline" size={11} color={C.primary} />
                      <Text style={{ fontSize: 11, fontWeight: FONTS.bold, color: C.primary }}>{item.hit_count}x</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }} numberOfLines={2}>{item.original_text}</Text>
                  <Text style={{ fontSize: 12, color: C.textSecondary }} numberOfLines={2}>{item.translated_text}</Text>
                </View>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Feed Health Tab ──────────────────────────────────────────────────────────
interface FirebaseStatus {
  configured: boolean;
  reachable: boolean;
  liveMatchCount: number;
  latencyMs: number;
}

function FeedHealthTab({ C }: { C: AppColors }) {
  const { showAlert } = useAlert();
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [tables, setTables] = useState<TableStat[]>([]);
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const load = useCallback(async () => {
    const [ph, ts, fb] = await Promise.all([
      getProviderHealth(),
      getDbTableStats(),
      checkFirebaseStatus(),
    ]);
    setProviders(ph);
    setTables(ts);
    setFirebaseStatus(fb);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleFlushCache = useCallback(async () => {
    showAlert(
      'Flush Feed Cache',
      'This clears all locally cached feed data. The app will re-fetch from the database on next load.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flush Cache', style: 'destructive',
          onPress: async () => {
            setFlushing(true);
            await clearAllFeedCaches();
            setFlushing(false);
            showAlert('Cache Cleared', 'All feed caches have been flushed. The app will reload fresh data on next access.');
          },
        },
      ],
    );
  }, [showAlert]);

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;

  const totalRecords = tables.reduce((s, t) => s + t.count, 0);
  const healthyProviders = providers.filter((p) => p.isHealthy).length;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: SPACING.md, gap: 14, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Firebase RTDB Status Card */}
      {firebaseStatus ? (
        <View style={[fh.summaryCard, {
          backgroundColor: C.card,
          borderColor: firebaseStatus.configured
            ? firebaseStatus.reachable ? '#22C55E33' : `${C.accentRed}33`
            : C.border,
        }]}>
          <View style={fh.summaryRow}>
            <View style={[fh.summaryIcon, {
              backgroundColor: firebaseStatus.configured && firebaseStatus.reachable
                ? '#22C55E18' : `${C.accentRed}18`,
              borderColor: firebaseStatus.configured && firebaseStatus.reachable
                ? '#22C55E33' : `${C.accentRed}33`,
            }]}>
              <Ionicons
                name={firebaseStatus.configured && firebaseStatus.reachable
                  ? 'flame-outline' : 'flame-outline'}
                size={22}
                color={firebaseStatus.configured && firebaseStatus.reachable ? '#22C55E' : C.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[fh.summaryTitle, { color: C.textPrimary }]}>Firebase Realtime Database</Text>
              <Text style={[fh.summarySub, { color: C.textMuted }]}>
                {!firebaseStatus.configured
                  ? 'Not configured — add EXPO_PUBLIC_FIREBASE_DATABASE_URL to .env'
                  : !firebaseStatus.reachable
                  ? 'Configured but unreachable — check Firebase security rules'
                  : `Connected · ${firebaseStatus.liveMatchCount} live keys · ${firebaseStatus.latencyMs}ms`}
              </Text>
            </View>
            <View style={[{
              borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4,
              backgroundColor: firebaseStatus.configured && firebaseStatus.reachable ? '#22C55E14' : `${C.accentRed}14`,
              borderColor: firebaseStatus.configured && firebaseStatus.reachable ? '#22C55E44' : `${C.accentRed}44`,
            }]}>
              <Text style={[{ fontSize: 10, fontWeight: FONTS.bold,
                color: firebaseStatus.configured && firebaseStatus.reachable ? '#22C55E' : C.accentRed,
              }]}>
                {firebaseStatus.configured && firebaseStatus.reachable ? 'ONLINE' : !firebaseStatus.configured ? 'NOT SET' : 'OFFLINE'}
              </Text>
            </View>
          </View>
          {firebaseStatus.configured && firebaseStatus.reachable ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {[
                { label: 'Live Matches', value: String(firebaseStatus.liveMatchCount), icon: 'pulse-outline', color: '#22C55E' },
                { label: 'Latency', value: `${firebaseStatus.latencyMs}ms`, icon: 'timer-outline', color: C.accentBlue },
                { label: 'Poll Rate', value: '12s', icon: 'refresh-outline', color: C.primary },
              ].map((stat) => (
                <View key={stat.label} style={[{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, alignItems: 'center', gap: 4 }, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Ionicons name={stat.icon as any} size={16} color={stat.color} />
                  <Text style={{ fontSize: 16, fontWeight: FONTS.extraBold, color: C.textPrimary }}>{stat.value}</Text>
                  <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: FONTS.medium }}>{stat.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={[fh.layerCard, { backgroundColor: C.surface, borderColor: C.border, marginTop: 0 }]}>
            <Text style={[fh.layerTitle, { color: C.textMuted }]}>LIVE SCORE DATA FLOW</Text>
            <View style={fh.layerRow}>
              <View style={[fh.layerDot, { backgroundColor: '#22C55E' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[fh.layerLabel, { color: C.textPrimary }]}>L0: Firebase RTDB (12s)</Text>
                <Text style={[fh.layerSub, { color: C.textMuted }]}>Fastest — written by sync-live edge function, read via REST</Text>
              </View>
            </View>
            <View style={fh.layerRow}>
              <View style={[fh.layerDot, { backgroundColor: C.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={[fh.layerLabel, { color: C.textPrimary }]}>L1: Supabase DB (45s)</Text>
                <Text style={[fh.layerSub, { color: C.textMuted }]}>Source of truth — all API data stored here first</Text>
              </View>
            </View>
            <View style={fh.layerRow}>
              <View style={[fh.layerDot, { backgroundColor: C.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={[fh.layerLabel, { color: C.textPrimary }]}>L2: AsyncStorage cache</Text>
                <Text style={[fh.layerSub, { color: C.textMuted }]}>Offline fallback — survives app restarts</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {/* Summary header */}
      <View style={[fh.summaryCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={fh.summaryRow}>
          <View style={[fh.summaryIcon, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
            <Ionicons name="heart-circle-outline" size={22} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[fh.summaryTitle, { color: C.textPrimary }]}>Feed Architecture Health</Text>
            <Text style={[fh.summarySub, { color: C.textMuted }]}>
              {providers.length > 0
                ? `${healthyProviders}/${providers.length} providers healthy · ${totalRecords.toLocaleString()} total records`
                : 'No API activity recorded yet'}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [fh.flushBtn, { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}44` }, pressed ? { opacity: 0.7 } : null]}
            onPress={handleFlushCache}
            disabled={flushing}
          >
            {flushing
              ? <ActivityIndicator size="small" color={C.accentRed} />
              : <Ionicons name="trash-outline" size={14} color={C.accentRed} />}
            <Text style={[fh.flushBtnText, { color: C.accentRed }]}>Flush Cache</Text>
          </Pressable>
        </View>

        {/* Architecture layers */}
        <View style={[fh.layerCard, { backgroundColor: C.surface, borderColor: C.border }]}>
          <Text style={[fh.layerTitle, { color: C.textMuted }]}>CACHE LAYERS</Text>
          {[
            { icon: 'flash-outline', label: 'L1 Memory Cache', sub: 'In-process, instant (30s TTL for live)', color: '#22C55E' },
            { icon: 'phone-portrait-outline', label: 'L2 AsyncStorage', sub: 'On-device, survives restarts (5–30min TTL)', color: C.accent },
            { icon: 'server-outline', label: 'L3 Supabase DB', sub: 'Source of truth, populated by edge functions', color: C.primary },
            { icon: 'time-outline', label: 'L4 Historical Fallback', sub: 'Last 7 days data when APIs are down', color: '#F59E0B' },
          ].map((layer) => (
            <View key={layer.label} style={fh.layerRow}>
              <View style={[fh.layerDot, { backgroundColor: layer.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[fh.layerLabel, { color: C.textPrimary }]}>{layer.label}</Text>
                <Text style={[fh.layerSub, { color: C.textMuted }]}>{layer.sub}</Text>
              </View>
              <Ionicons name={layer.icon as any} size={16} color={layer.color} />
            </View>
          ))}
        </View>
      </View>

      {/* DB Table Stats */}
      <Text style={[fh.sectionTitle, { color: C.textPrimary }]}>Database Records</Text>
      <View style={fh.tableGrid}>
        {tables.map((t) => (
          <View key={t.table} style={[fh.tableCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={[fh.tableIcon, { backgroundColor: `${t.color}18`, borderColor: `${t.color}33` }]}>
              <Ionicons name={t.icon as any} size={18} color={t.color} />
            </View>
            <Text style={[fh.tableCount, { color: t.count > 0 ? C.textPrimary : C.textMuted }]}>
              {t.count.toLocaleString()}
            </Text>
            <Text style={[fh.tableLabel, { color: C.textMuted }]}>{t.label}</Text>
            {t.count === 0 ? (
              <View style={[fh.emptyBadge, { backgroundColor: `${C.accentRed}14`, borderColor: `${C.accentRed}33` }]}>
                <Text style={[fh.emptyBadgeText, { color: C.accentRed }]}>Empty</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {/* Provider Health */}
      <Text style={[fh.sectionTitle, { color: C.textPrimary }]}>API Provider Health (7d)</Text>
      {providers.length === 0 ? (
        <View style={[fh.emptyCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Ionicons name="pulse-outline" size={36} color={C.textMuted} />
          <Text style={[fh.emptyCardText, { color: C.textMuted }]}>No API calls recorded yet.{`\n`}Run a data sync to start tracking provider health.</Text>
        </View>
      ) : providers.map((p) => {
        const color = p.isHealthy ? '#22C55E' : p.successRate >= 50 ? '#F59E0B' : C.accentRed;
        return (
          <View key={p.name} style={[fh.providerCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={[fh.providerStripe, { backgroundColor: color }]} />
            <View style={{ flex: 1, padding: 12, gap: 10 }}>
              <View style={fh.providerHeader}>
                <View style={[fh.providerBadge, { backgroundColor: `${color}18`, borderColor: `${color}33` }]}>
                  <View style={[fh.providerStatusDot, { backgroundColor: color }]} />
                  <Text style={[fh.providerName, { color }]}>{p.label}</Text>
                </View>
                <Text style={[fh.providerLastCall, { color: C.textMuted }]}>
                  {p.lastCalled ? getLastUpdatedLabel(p.lastCalled) : 'Never'}
                </Text>
              </View>
              <View style={fh.providerStats}>
                <View style={fh.providerStatCell}>
                  <Text style={[fh.providerStatVal, { color: C.textPrimary }]}>{p.totalRequests.toLocaleString()}</Text>
                  <Text style={[fh.providerStatLbl, { color: C.textMuted }]}>Requests</Text>
                </View>
                <View style={[fh.providerStatDiv, { backgroundColor: C.border }]} />
                <View style={fh.providerStatCell}>
                  <Text style={[fh.providerStatVal, { color: '#22C55E' }]}>{p.successRate}%</Text>
                  <Text style={[fh.providerStatLbl, { color: C.textMuted }]}>Success</Text>
                </View>
                <View style={[fh.providerStatDiv, { backgroundColor: C.border }]} />
                <View style={fh.providerStatCell}>
                  <Text style={[fh.providerStatVal, { color: p.recentErrors > 0 ? C.accentRed : C.textMuted }]}>{p.recentErrors}</Text>
                  <Text style={[fh.providerStatLbl, { color: C.textMuted }]}>Errors</Text>
                </View>
              </View>
              <View style={[fh.healthBar, { backgroundColor: C.surface }]}>
                <View style={[fh.healthFill, { width: `${p.successRate}%` as any, backgroundColor: color }]} />
              </View>
              {p.lastError ? (
                <View style={[fh.errorRow, { backgroundColor: `${C.accentRed}10`, borderColor: `${C.accentRed}33` }]}>
                  <Ionicons name="warning-outline" size={11} color={C.accentRed} />
                  <Text style={[fh.errorText, { color: C.accentRed }]} numberOfLines={2}>{p.lastError}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      {/* Data Pipeline diagram */}
      <Text style={[fh.sectionTitle, { color: C.textPrimary }]}>Data Pipeline</Text>
      <View style={[fh.pipelineCard, { backgroundColor: C.card, borderColor: C.border }]}>
        {[
          { step: '1', label: 'External APIs', desc: 'API-Football · TheSportsDB · Highlightly', icon: 'cloud-download-outline', color: '#3B82F6' },
          { step: '2', label: 'Edge Functions', desc: 'fetch-matches · fetch-odds · sync-live · sync-standings', icon: 'code-slash-outline', color: '#8B5CF6' },
          { step: '3', label: 'Supabase DB', desc: 'matches · predictions · odds · highlights · standings', icon: 'server-outline', color: C.primary },
          { step: '4', label: 'Feed Engine', desc: 'L1 memory → L2 AsyncStorage → L3 DB → L4 historical', icon: 'layers-outline', color: '#22C55E' },
          { step: '5', label: 'Mobile App', desc: 'Home · Live · AI Picks — always shows data', icon: 'phone-portrait-outline', color: C.accent },
        ].map((s, idx, arr) => (
          <View key={s.step}>
            <View style={fh.pipelineRow}>
              <View style={[fh.pipelineStepBadge, { backgroundColor: `${s.color}18`, borderColor: `${s.color}33` }]}>
                <Text style={[fh.pipelineStepNum, { color: s.color }]}>{s.step}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={fh.pipelineLabelRow}>
                  <Ionicons name={s.icon as any} size={14} color={s.color} />
                  <Text style={[fh.pipelineLabel, { color: C.textPrimary }]}>{s.label}</Text>
                </View>
                <Text style={[fh.pipelineDesc, { color: C.textMuted }]}>{s.desc}</Text>
              </View>
            </View>
            {idx < arr.length - 1 ? (
              <View style={[fh.pipelineConnector, { borderLeftColor: C.border }]} />
            ) : null}
          </View>
        ))}
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const fh = StyleSheet.create({
  summaryCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  summaryTitle: { fontSize: 15, fontWeight: FONTS.bold },
  summarySub: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  flushBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  flushBtnText: { fontSize: 11, fontWeight: FONTS.semiBold },
  layerCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 10 },
  layerTitle: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.8 },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  layerDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  layerLabel: { fontSize: 13, fontWeight: FONTS.semiBold },
  layerSub: { fontSize: 11, lineHeight: 16 },
  sectionTitle: { fontSize: 14, fontWeight: FONTS.bold, marginBottom: -4 },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tableCard: { width: '22%', flexGrow: 1, borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, gap: 4, alignItems: 'center', minHeight: 96 },
  tableIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tableCount: { fontSize: 20, fontWeight: FONTS.extraBold },
  tableLabel: { fontSize: 10, fontWeight: FONTS.medium, textAlign: 'center' },
  emptyBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  emptyBadgeText: { fontSize: 9, fontWeight: FONTS.bold },
  emptyCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyCardText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  providerCard: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  providerStripe: { width: 4 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  providerStatusDot: { width: 6, height: 6, borderRadius: 3 },
  providerName: { fontSize: 12, fontWeight: FONTS.bold },
  providerLastCall: { fontSize: 11 },
  providerStats: { flexDirection: 'row', alignItems: 'center' },
  providerStatCell: { flex: 1, alignItems: 'center', gap: 2 },
  providerStatVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  providerStatLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase' },
  providerStatDiv: { width: 1, height: 28, marginHorizontal: 4 },
  healthBar: { height: 5, borderRadius: 3, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  errorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  pipelineCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 0 },
  pipelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  pipelineStepBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  pipelineStepNum: { fontSize: 13, fontWeight: FONTS.extraBold },
  pipelineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  pipelineLabel: { fontSize: 14, fontWeight: FONTS.bold },
  pipelineDesc: { fontSize: 12, lineHeight: 18 },
  pipelineConnector: { marginLeft: 29, borderLeftWidth: 1, borderStyle: 'dashed', height: 12 },
});

const root = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: FONTS.bold },
  badge: { borderRadius: RADIUS.sm, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#fff', letterSpacing: 1 },
  reportsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  reportsBtnText: { fontSize: 11, fontWeight: FONTS.bold },
  tabBar: { flexDirection: 'row', minWidth: '100%', borderBottomWidth: 1 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: 14, position: 'relative' },
  tabActive: {},
  tabEmoji: { fontSize: 13 },
  tabLabel: { fontSize: 12, fontWeight: FONTS.medium },
  tabIndicator: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, borderRadius: 2 },
});
