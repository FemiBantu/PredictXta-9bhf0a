/**
 * PROFILE — Sports Intelligence Personal Dashboard
 * Next-generation backend-driven UI
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  FlatList, ActivityIndicator, RefreshControl,
  TextInput, Keyboard, Animated, Platform, Alert, ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useAlert, getSupabaseClient } from '@/template';
import { FONTS, RADIUS, SPACING, COLORS } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';
import type { Prediction, Match } from '@/services/types';
import { getConfidenceColor, getRiskColor, rowToPrediction } from '@/services/predictionService';
import { ProfileSkeleton } from '@/components/feature/SkeletonLoader';
import { checkActiveSubscription } from '@/services/iapService';
import { useAdminRole, clearAdminRoleCache } from '@/hooks/useAdminRole';

type OutcomeStatus = 'win' | 'loss' | 'pending';
type ProfileTab = 'overview' | 'history' | 'achievements';

interface PredWithMatch extends Prediction { match: Match | null; }

// ─── Achievements ─────────────────────────────────────────────────────────────
interface Achievement {
  id: string; icon: string; title: string; desc: string;
  unlocked: boolean; rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

function buildAchievements(s: { total: number; wins: number; winRate: number; streak: number; perf: number; refs: number }): Achievement[] {
  return [
    { id: 'first_pick', icon: '🎯', title: 'First Pick', desc: 'Generate your first AI prediction', unlocked: s.total >= 1, rarity: 'common' },
    { id: 'sharp_eye', icon: '🦅', title: 'Sharp Eye', desc: '60%+ win rate on 5+ picks', unlocked: s.total >= 5 && s.winRate >= 60, rarity: 'common' },
    { id: 'on_fire', icon: '🔥', title: 'On Fire', desc: 'Win 3 predictions in a row', unlocked: s.streak >= 3, rarity: 'rare' },
    { id: 'hot_streak', icon: '⚡', title: 'Hot Streak', desc: 'Win 5 predictions in a row', unlocked: s.streak >= 5, rarity: 'rare' },
    { id: 'predictor', icon: '🧠', title: 'Predictor', desc: '25+ AI predictions made', unlocked: s.total >= 25, rarity: 'rare' },
    { id: 'oracle', icon: '🔮', title: 'Oracle', desc: '75%+ win rate on 10+ picks', unlocked: s.total >= 10 && s.winRate >= 75, rarity: 'epic' },
    { id: 'perfect_week', icon: '👑', title: 'Perfect Week', desc: 'Daily Challenge streak 7 days', unlocked: s.perf >= 7, rarity: 'epic' },
    { id: 'legend', icon: '🏆', title: 'Legend', desc: '100+ picks with 70%+ win rate', unlocked: s.total >= 100 && s.winRate >= 70, rarity: 'legendary' },
    { id: 'recruiter', icon: '🤝', title: 'Recruiter', desc: 'Refer 3 friends to PredictXta', unlocked: s.refs >= 3, rarity: 'rare' },
  ];
}

const RARITY_COLORS = { common: '#6B7280', rare: '#3B82F6', epic: '#8B5CF6', legendary: '#F59E0B' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOutcome(pred: Prediction, match: Match | null): OutcomeStatus {
  if (!match || match.status !== 'finished') return 'pending';
  const actual = match.homeScore > match.awayScore ? 'home_win' : match.homeScore < match.awayScore ? 'away_win' : 'draw';
  return actual === pred.predictedResult ? 'win' : 'loss';
}

function rowToMatch(r: Record<string, unknown>): Match {
  return {
    id: r.id as string, sport: (r.sport as string) ?? 'football',
    homeTeam: r.home_team as string, awayTeam: r.away_team as string,
    homeScore: Number(r.home_score ?? 0), awayScore: Number(r.away_score ?? 0),
    status: (r.status as Match['status']) ?? 'upcoming', matchTime: r.match_time as string,
    league: (r.league as string) ?? '', minute: Number(r.minute ?? 0),
  };
}

function computeStats(history: PredWithMatch[]) {
  const total = history.length;
  const finished = history.filter(p => p.match?.status === 'finished');
  const wins = finished.filter(p => getOutcome(p, p.match) === 'win').length;
  const winRate = finished.length > 0 ? Math.round((wins / finished.length) * 100) : 0;
  let streak = 0;
  for (const p of history) { if (p.match?.status !== 'finished') continue; if (getOutcome(p, p.match) === 'win') streak++; else break; }
  const sportMap: Record<string, { wins: number; total: number }> = {};
  for (const p of history) {
    const sp = p.match?.sport ?? 'football';
    if (!sportMap[sp]) sportMap[sp] = { wins: 0, total: 0 };
    sportMap[sp].total++;
    if (p.match?.status === 'finished' && getOutcome(p, p.match) === 'win') sportMap[sp].wins++;
  }
  return { total, wins, winRate, streak, pending: total - finished.length, lost: finished.length - wins, sportMap };
}

// ─── Win Rate Arc ──────────────────────────────────────────────────────────────
function WinArc({ winRate, wins, total, C }: { winRate: number; wins: number; total: number; C: AppColors }) {
  const size = 96;
  const color = winRate >= 70 ? '#22C55E' : winRate >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 8, borderColor: `${color}20` }} />
        <View style={[{
          position: 'absolute', width: size, height: size, borderRadius: size / 2,
          borderWidth: 8, borderColor: color,
          borderTopColor: `${color}20`, borderRightColor: winRate < 50 ? `${color}20` : color,
          transform: [{ rotate: `${(winRate / 100) * 360 - 90}deg` }],
        }]} />
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color }}>{winRate}%</Text>
          <Text style={{ fontSize: 8, color: C.textMuted, fontWeight: FONTS.semiBold, letterSpacing: 0.5 }}>WIN RATE</Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, color: C.textMuted }}>{wins}W / {total} picks</Text>
    </View>
  );
}

// ─── Sport Accuracy Bar ───────────────────────────────────────────────────────
function SportBar({ sport, wins, total, C }: { sport: string; wins: number; total: number; C: AppColors }) {
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const EMOJI: Record<string, string> = { football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏', mma: '🥊', baseball: '⚾', hockey: '🏒' };
  const color = pct >= 70 ? '#22C55E' : pct >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <View style={[spb.row, { marginBottom: 8 }]}>
      <Text style={spb.emoji}>{EMOJI[sport.toLowerCase()] ?? '🏆'}</Text>
      <View style={{ flex: 1 }}>
        <View style={spb.head}>
          <Text style={[spb.label, { color: C.textSecondary }]}>{sport.charAt(0).toUpperCase() + sport.slice(1)}</Text>
          <Text style={[spb.count, { color: C.textMuted }]}>{wins}W / {total}</Text>
        </View>
        <View style={[spb.track, { backgroundColor: C.border }]}>
          <View style={[spb.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={[spb.pct, { color }]}>{pct}%</Text>
    </View>
  );
}
const spb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { fontSize: 18, width: 26, textAlign: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: FONTS.semiBold },
  count: { fontSize: 11 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  pct: { fontSize: 13, fontWeight: FONTS.bold, width: 38, textAlign: 'right' },
});

// ─── Achievement Card ─────────────────────────────────────────────────────────
function AchCard({ a, C }: { a: Achievement; C: AppColors }) {
  const color = RARITY_COLORS[a.rarity];
  return (
    <View style={[ac.card, { backgroundColor: a.unlocked ? C.card : C.surface, borderColor: a.unlocked ? `${color}44` : C.border, opacity: a.unlocked ? 1 : 0.5 }]}>
      <View style={[ac.iconWrap, { backgroundColor: a.unlocked ? `${color}18` : C.surface, borderColor: a.unlocked ? `${color}33` : C.border }]}>
        <Text style={ac.icon}>{a.icon}</Text>
      </View>
      <Text style={[ac.title, { color: a.unlocked ? C.textPrimary : C.textMuted }]} numberOfLines={1}>{a.title}</Text>
      <Text style={[ac.desc, { color: C.textMuted }]} numberOfLines={2}>{a.desc}</Text>
      <View style={[ac.badge, { backgroundColor: a.unlocked ? `${color}18` : C.surface, borderColor: a.unlocked ? `${color}33` : C.border }]}>
        {!a.unlocked ? <Ionicons name="lock-closed" size={8} color={C.textMuted} /> : null}
        <Text style={[ac.badgeText, { color: a.unlocked ? color : C.textMuted }]}>{a.unlocked ? a.rarity.toUpperCase() : 'LOCKED'}</Text>
      </View>
    </View>
  );
}
const ac = StyleSheet.create({
  card: { width: 118, borderRadius: RADIUS.lg, borderWidth: 1, padding: 11, gap: 5, alignItems: 'center' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  icon: { fontSize: 22 },
  title: { fontSize: 12, fontWeight: FONTS.bold, textAlign: 'center' },
  desc: { fontSize: 9, textAlign: 'center', lineHeight: 13 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
});

// ─── Prediction History Card ─────────────────────────────────────────────────
function HistCard({ item, C, onPress }: { item: PredWithMatch; C: AppColors; onPress: () => void }) {
  const outcome = getOutcome(item, item.match);
  const confColor = getConfidenceColor(item.confidence);
  const matchName = item.match ? `${item.match.homeTeam} vs ${item.match.awayTeam}` : 'Unknown Match';
  const outcomeColor = outcome === 'win' ? '#22C55E' : outcome === 'loss' ? '#EF4444' : C.textSecondary;
  const outcomeLabel = outcome === 'win' ? '✓ WON' : outcome === 'loss' ? '✗ LOST' : item.match?.status === 'live' ? '🔴 Live' : '⏳ Pending';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [hc.card, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : null]}
    >
      {/* Left stripe */}
      <View style={[hc.stripe, { backgroundColor: outcomeColor }]} />
      <View style={hc.body}>
        <View style={hc.top}>
          <View style={{ flex: 1 }}>
            <Text style={[hc.matchName, { color: C.textPrimary }]} numberOfLines={1}>{matchName}</Text>
            {item.match?.league ? <Text style={[hc.league, { color: C.textMuted }]} numberOfLines={1}>{item.match.league}</Text> : null}
          </View>
          <View style={[hc.outcomePill, { backgroundColor: `${outcomeColor}18`, borderColor: `${outcomeColor}44` }]}>
            <Text style={[hc.outcomeText, { color: outcomeColor }]}>{outcomeLabel}</Text>
          </View>
        </View>

        {/* Prediction chips */}
        <View style={hc.chips}>
          {item.predictedResult ? (
            <View style={[hc.chip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
              <Text style={[hc.chipLabel, { color: C.textMuted }]}>Result</Text>
              <Text style={[hc.chipVal, { color: C.primary }]}>{item.predictedResult === 'home_win' ? '1' : item.predictedResult === 'draw' ? 'X' : '2'}</Text>
            </View>
          ) : null}
          {item.overUnder ? (
            <View style={[hc.chip, { backgroundColor: `${C.accentBlue}14`, borderColor: `${C.accentBlue}33` }]}>
              <Text style={[hc.chipLabel, { color: C.textMuted }]}>O/U</Text>
              <Text style={[hc.chipVal, { color: C.accentBlue }]}>{item.overUnder.toUpperCase()} {item.overUnderLine}</Text>
            </View>
          ) : null}
          {item.btts ? (
            <View style={[hc.chip, { backgroundColor: item.btts === 'yes' ? '#14B8A614' : '#F9731614', borderColor: item.btts === 'yes' ? '#14B8A633' : '#F9731633' }]}>
              <Text style={[hc.chipLabel, { color: C.textMuted }]}>BTTS</Text>
              <Text style={[hc.chipVal, { color: item.btts === 'yes' ? '#14B8A6' : '#F97316' }]}>{item.btts.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        {/* Confidence bar */}
        <View style={hc.confRow}>
          <Text style={[hc.confLabel, { color: C.textMuted }]}>Confidence</Text>
          <View style={[hc.confTrack, { backgroundColor: C.border }]}>
            <View style={[hc.confFill, { width: `${item.confidence}%` as any, backgroundColor: confColor }]} />
          </View>
          <Text style={[hc.confVal, { color: confColor }]}>{item.confidence}%</Text>
        </View>

        {/* Final score */}
        {item.match?.status === 'finished' ? (
          <View style={hc.scoreRow}>
            <Ionicons name="checkmark-circle-outline" size={11} color={C.textMuted} />
            <Text style={[hc.scoreText, { color: C.textMuted }]}>
              Final: {item.match.homeTeam.split(' ').slice(-1)[0]} {item.match.homeScore} - {item.match.awayScore} {item.match.awayTeam.split(' ').slice(-1)[0]}
            </Text>
          </View>
        ) : item.match?.status === 'live' ? (
          <View style={hc.scoreRow}>
            <View style={[hc.liveDot, { backgroundColor: '#FF4757' }]} />
            <Text style={[hc.scoreText, { color: '#FF4757' }]}>Live: {item.match.homeScore}-{item.match.awayScore} ({item.match.minute}')</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
const hc = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  stripe: { width: 4 },
  body: { flex: 1, padding: 12, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  matchName: { fontSize: 13, fontWeight: FONTS.bold },
  league: { fontSize: 11, marginTop: 1 },
  outcomePill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  outcomeText: { fontSize: 10, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { alignItems: 'center', borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5, minWidth: 50 },
  chipLabel: { fontSize: 8, fontWeight: FONTS.medium },
  chipVal: { fontSize: 13, fontWeight: '900' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confLabel: { fontSize: 10, width: 70 },
  confTrack: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 3 },
  confVal: { fontSize: 11, fontWeight: FONTS.bold, width: 36, textAlign: 'right' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scoreText: { fontSize: 11 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
});

// ─── Quick Stat Cell ──────────────────────────────────────────────────────────
function StatCell({ emoji, val, label, color, C }: { emoji: string; val: string | number; label: string; color: string; C: AppColors }) {
  return (
    <View style={[qsc.cell, { flex: 1, alignItems: 'center', gap: 2 }]}>
      <Text style={qsc.emoji}>{emoji}</Text>
      <Text style={[qsc.val, { color }]}>{val}</Text>
      <Text style={[qsc.label, { color: C.textMuted }]}>{label}</Text>
    </View>
  );
}
const qsc = StyleSheet.create({
  cell: {},
  emoji: { fontSize: 16 },
  val: { fontSize: 19, fontWeight: '900', lineHeight: 23 },
  label: { fontSize: 9, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.4 },
});

// ─── Menu Item ────────────────────────────────────────────────────────────────
function MenuItem({ icon, label, onPress, C, badge, isLast, danger }: {
  icon: any; label: string; onPress: () => void; C: AppColors;
  badge?: string; isLast?: boolean; danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [mi.item, { borderBottomColor: isLast ? 'transparent' : C.border }, pressed ? { backgroundColor: C.cardHighlight } : null]}
      onPress={onPress}
    >
      <View style={[mi.icon, { backgroundColor: danger ? '#EF444412' : C.surface }]}>
        <Ionicons name={icon} size={19} color={danger ? '#EF4444' : C.textSecondary} />
      </View>
      <Text style={[mi.label, { color: danger ? '#EF4444' : C.textPrimary }]}>{label}</Text>
      {badge ? (
        <View style={[mi.badge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
          <Text style={[mi.badgeText, { color: C.primary }]}>{badge}</Text>
        </View>
      ) : null}
      {!danger ? <MaterialIcons name="chevron-right" size={20} color={C.textMuted} /> : null}
    </Pressable>
  );
}
const mi = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 13, borderBottomWidth: 1 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 15, fontWeight: FONTS.medium },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: FONTS.bold },
});

// ─── Avatar upload hook ───────────────────────────────────────────────────────
function useAvatarUpload(userId?: string) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getSupabaseClient().from('user_profiles').select('avatar_url').eq('id', userId).maybeSingle().then(({ data }) => { if (data?.avatar_url) setAvatarUrl(data.avatar_url); });
  }, [userId]);

  const upload = useCallback(async (source: 'gallery' | 'camera') => {
    if (!userId) return;
    try {
      if (source === 'camera') { const { status } = await ImagePicker.requestCameraPermissionsAsync(); if (status !== 'granted') { Alert.alert('Permission needed'); return; } }
      else { const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (status !== 'granted') { Alert.alert('Permission needed'); return; } }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      setUploading(true);
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const filePath = `${userId}/avatar.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const ab = decode(base64);
      const sb = getSupabaseClient();
      await sb.storage.from('avatars').upload(filePath, ab, { contentType: mimeType, upsert: true });
      const { data } = sb.storage.from('avatars').getPublicUrl(filePath);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      await sb.from('user_profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
      setAvatarUrl(url);
    } catch { Alert.alert('Upload Failed', 'Please try again.'); } finally { setUploading(false); }
  }, [userId]);

  const showPicker = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 }, i => { if (i === 1) upload('camera'); else if (i === 2) upload('gallery'); });
    } else {
      Alert.alert('Update Photo', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Camera', onPress: () => upload('camera') }, { text: 'Library', onPress: () => upload('gallery') }]);
    }
  }, [upload]);

  return { avatarUrl, uploading, showPicker };
}

// ─── Earn Coins Grid ─────────────────────────────────────────────────────────
function EarnCoinsGrid({
  coins, challengeStreak, referrals, C, onPress,
}: {
  coins: number | null;
  challengeStreak: number;
  referrals: number;
  C: AppColors;
  onPress: (route: string) => void;
}) {
  const MAX_STREAK_GOAL = 7;
  const streakPct = Math.min(100, Math.round((challengeStreak / MAX_STREAK_GOAL) * 100));

  const EARN_METHODS = [
    {
      icon: '🏆',
      title: 'Daily Challenge',
      desc: challengeStreak > 0 ? `${challengeStreak}-day streak` : 'Pick 3 matches',
      reward: '+50 coins',
      route: '/challenge',
      color: '#F59E0B',
      showProgress: true,
      badge: challengeStreak > 0 ? `${challengeStreak}🔥` : null,
    },
    {
      icon: '🤝',
      title: 'Refer a Friend',
      desc: referrals > 0 ? `${referrals} joined` : 'Share your link',
      reward: '+100 coins',
      route: '/referral',
      color: '#22C55E',
      showProgress: false,
      badge: referrals > 0 ? String(referrals) : null,
    },
    {
      icon: '💡',
      title: 'Expert Tips',
      desc: 'Share picks · Earn rewards',
      reward: '+25 coins',
      route: '/expert-slips',
      color: '#3B82F6',
      showProgress: false,
      badge: null,
    },
  ];

  return (
    <View style={[ecg.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header */}
      <View style={ecg.header}>
        <View>
          <Text style={[ecg.title, { color: C.textPrimary }]}>Earn Coins</Text>
          <Text style={[ecg.subtitle, { color: C.textMuted }]}>Complete actions to earn</Text>
        </View>
        <Pressable
          onPress={() => onPress('/coin-history')}
          style={[ecg.balancePill, { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)' }]}
        >
          <Text style={ecg.balanceEmoji}>🪙</Text>
          <Text style={[ecg.balanceVal, { color: '#F59E0B' }]}>{coins !== null ? coins.toLocaleString() : '—'}</Text>
        </Pressable>
      </View>

      {/* Method cards */}
      <View style={ecg.grid}>
        {EARN_METHODS.map((m) => (
          <Pressable
            key={m.route}
            style={({ pressed }) => [
              ecg.card,
              { backgroundColor: `${m.color}0D`, borderColor: `${m.color}33` },
              pressed ? { opacity: 0.85, transform: [{ scale: 0.96 }] } : null,
            ]}
            onPress={() => onPress(m.route)}
          >
            <View style={ecg.cardTop}>
              <Text style={ecg.cardIcon}>{m.icon}</Text>
              {m.badge ? (
                <View style={[ecg.cardBadge, { backgroundColor: m.color }]}>
                  <Text style={ecg.cardBadgeText}>{m.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[ecg.cardTitle, { color: C.textPrimary }]}>{m.title}</Text>
            <Text style={[ecg.cardDesc, { color: C.textMuted }]} numberOfLines={2}>{m.desc}</Text>
            {m.showProgress ? (
              <View style={[ecg.progressTrack, { backgroundColor: C.border }]}>
                <View style={[ecg.progressFill, { width: `${streakPct}%` as any, backgroundColor: m.color }]} />
              </View>
            ) : null}
            <View style={[ecg.rewardPill, { backgroundColor: `${m.color}18`, borderColor: `${m.color}33` }]}>
              <Text style={[ecg.rewardText, { color: m.color }]}>{m.reward}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Footer — coin history + earn more */}
      <View style={ecg.footerRow}>
        <Pressable
          onPress={() => onPress('/coin-history')}
          style={({ pressed }) => [ecg.footerBtn, { backgroundColor: C.surface, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="time-outline" size={13} color={C.textMuted} />
          <Text style={[ecg.footerBtnText, { color: C.textMuted }]}>History</Text>
        </Pressable>
        <Pressable
          onPress={() => onPress('/coin-earn')}
          style={({ pressed }) => [ecg.footerBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44`, flex: 2 }, pressed ? { opacity: 0.8 } : null]}
        >
          <Ionicons name="add-circle-outline" size={13} color={C.primary} />
          <Text style={[ecg.footerBtnText, { color: C.primary, fontWeight: FONTS.bold }]}>All Ways to Earn</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ecg = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: FONTS.bold },
  subtitle: { fontSize: 11, marginTop: 2 },
  balancePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  balanceEmoji: { fontSize: 14 },
  balanceVal: { fontSize: 16, fontWeight: '900' },
  grid: { flexDirection: 'row', gap: 8 },
  card: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 10, gap: 5, alignItems: 'flex-start' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  cardIcon: { fontSize: 22 },
  cardBadge: { borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2 },
  cardBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  cardTitle: { fontSize: 11, fontWeight: FONTS.bold, lineHeight: 15 },
  cardDesc: { fontSize: 9, lineHeight: 13 },
  progressTrack: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  rewardPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, marginTop: 2 },
  rewardText: { fontSize: 9, fontWeight: '800' },
  footerRow: { flexDirection: 'row', gap: 8 },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 9 },
  footerBtnText: { fontSize: 12, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { showAlert } = useAlert();
  const { colors: C } = useTheme();
  const { avatarUrl, uploading, showPicker } = useAvatarUpload(user?.id);
  const { isAdmin, role: adminRole } = useAdminRole(user?.id);

  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [displayUsername, setDisplayUsername] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);

  const [history, setHistory] = useState<PredWithMatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);

  const [coins, setCoins] = useState<number | null>(null);
  const [challengeStreak, setChallengeStreak] = useState(0);
  const [perfectStreak, setPerfectStreak] = useState(0);
  const [referrals, setReferrals] = useState(0);
  const [vipStatus, setVipStatus] = useState<{ isVip: boolean; plan: string | null; expiresAt: string | null; loading: boolean }>({ isVip: false, plan: null, expiresAt: null, loading: true });

  const streakAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!user?.id) return;
    getSupabaseClient().from('user_profiles').select('username').eq('id', user.id).maybeSingle().then(({ data }) => { if (data?.username) setDisplayUsername(data.username); });
    getSupabaseClient().from('user_coins').select('balance').eq('user_id', user.id).maybeSingle().then(({ data }) => setCoins(data?.balance ?? 0)).catch(() => setCoins(0));
    getSupabaseClient().from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id).eq('status', 'completed').then(({ count }) => setReferrals(count ?? 0)).catch(() => {});
    checkActiveSubscription(user.id).then(s => setVipStatus({ isVip: s.isVip, plan: s.plan, expiresAt: s.expiresAt, loading: false }));
  }, [user?.id]);

  useEffect(() => {
    AsyncStorage.getItem('predictxta_challenge_history_v1').then(raw => {
      if (!raw) return;
      const hist: any[] = JSON.parse(raw);
      const sorted = hist.filter(e => e.submitted).sort((a, b) => b.date.localeCompare(a.date));
      let streak = 0;
      for (const e of sorted) { if (e.submitted) streak++; else break; }
      setChallengeStreak(streak);
      const resolved = sorted.filter(e => e.result && e.result !== 'pending');
      let perf = 0;
      for (const e of resolved) { if (e.result === 'win') perf++; else break; }
      setPerfectStreak(Math.min(perf, 7));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (perfectStreak < 2) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(streakAnim, { toValue: 1.12, duration: 600, useNativeDriver: true }),
      Animated.timing(streakAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    a.start(); return () => a.stop();
  }, [perfectStreak]);

  const loadHistory = useCallback(async (silent = false) => {
    if (!user?.id) return;
    if (!silent) setHistoryLoading(true);
    try {
      const sb = getSupabaseClient();
      const { data: predRows } = await sb.from('predictions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
      if (!predRows || predRows.length === 0) { setHistory([]); return; }
      const preds = (predRows as any[]).map(rowToPrediction);
      const matchIds = [...new Set(preds.map(p => p.matchId).filter(Boolean))];
      const { data: matchRows } = await sb.from('matches').select('*').in('id', matchIds);
      const matchMap = new Map<string, Match>();
      (matchRows as any[] ?? []).forEach(r => { const m = rowToMatch(r); matchMap.set(m.id, m); });
      setHistory(preds.map(p => ({ ...p, match: matchMap.get(p.matchId) ?? null })));
    } catch { setHistory([]); } finally { setHistoryLoading(false); setHistoryRefreshing(false); }
  }, [user?.id]);

  useEffect(() => { if (activeTab === 'history' && history.length === 0) loadHistory(); }, [activeTab]);

  const computed = computeStats(history);
  const achievements = buildAchievements({ total: computed.total, wins: computed.wins, winRate: computed.winRate, streak: computed.streak, perf: perfectStreak, refs: referrals });
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const sportEntries = Object.entries(computed.sportMap).sort((a, b) => b[1].total - a[1].total).slice(0, 4);
  const username = displayUsername || user?.username || user?.email?.split('@')[0] || 'User';
  const initial = username[0]?.toUpperCase() ?? 'U';

  const handleLogout = () => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          clearAdminRoleCache(user?.id);
          await logout();
          router.replace('/login' as any);
        },
      },
    ]);
  };

  const handleSaveUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (trimmed.length < 3) { setUsernameError('At least 3 characters required'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) { setUsernameError('Letters, numbers and _ only'); return; }
    setUsernameSaving(true);
    try {
      const { data: existing } = await getSupabaseClient().from('user_profiles').select('id').ilike('username', trimmed).neq('id', user?.id ?? '').maybeSingle();
      if (existing) { setUsernameError('Username already taken'); setUsernameSaving(false); return; }
      await getSupabaseClient().from('user_profiles').update({ username: trimmed }).eq('id', user?.id ?? '');
      setDisplayUsername(trimmed); setEditingUsername(false); Keyboard.dismiss();
    } catch { setUsernameError('Could not save — try again'); } finally { setUsernameSaving(false); }
  }, [usernameInput, user?.id]);

  if (vipStatus.loading && !user) {
    return (
      <View style={[ps.root, { backgroundColor: C.bg }]}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
          <View style={[ps.header, { backgroundColor: C.surface }]}><Text style={[ps.title, { color: C.textPrimary }]}>Profile</Text></View>
        </SafeAreaView>
        <ProfileSkeleton />
      </View>
    );
  }

  return (
    <View style={[ps.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[ps.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Text style={[ps.title, { color: C.textPrimary }]}>Profile</Text>
          <View style={ps.headerRight}>
            <Pressable style={[ps.iconBtn, { backgroundColor: C.card, borderColor: C.border }]} onPress={() => router.push('/notifications' as any)}>
              <Ionicons name="notifications-outline" size={20} color={C.textPrimary} />
            </Pressable>
            <Pressable style={[ps.iconBtn, { backgroundColor: C.card, borderColor: C.border }]} onPress={() => router.push('/settings' as any)}>
              <Ionicons name="settings-outline" size={20} color={C.textPrimary} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={activeTab === 'history' ? <RefreshControl refreshing={historyRefreshing} onRefresh={() => { setHistoryRefreshing(true); loadHistory(true); }} tintColor={C.primary} /> : undefined}
      >
        {/* Hero */}
        <LinearGradient colors={[C.cardHighlight, C.card] as [string, string]} style={[ps.hero, { borderColor: C.border }]}>
          {/* Avatar */}
          <Pressable style={ps.avatarWrap} onPress={showPicker} disabled={uploading}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={ps.avatar} contentFit="cover" transition={200} />
              : <LinearGradient colors={[C.primary, C.primaryDark ?? C.primary] as [string, string]} style={ps.avatar}><Text style={[ps.avatarInitial, { color: C.textInverse }]}>{initial}</Text></LinearGradient>
            }
            <View style={[ps.avatarEdit, { backgroundColor: 'rgba(0,0,0,0.55)', borderColor: C.primary }]}>
              {uploading ? <ActivityIndicator size="small" color={C.primary} /> : <Ionicons name="camera" size={13} color={C.primary} />}
            </View>
            <View style={[ps.onlineBadge, { backgroundColor: '#22C55E', borderColor: C.card }]} />
          </Pressable>

          {/* Username */}
          {editingUsername ? (
            <View style={ps.usernameEdit}>
              <View style={[ps.usernameInputRow, { backgroundColor: C.surface, borderColor: usernameError ? '#EF4444' : C.border }]}>
                <Text style={[ps.at, { color: C.textMuted }]}>@</Text>
                <TextInput
                  style={[ps.usernameInput, { color: C.textPrimary }]}
                  value={usernameInput}
                  onChangeText={t => { setUsernameInput(t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)); setUsernameError(null); }}
                  autoFocus autoCapitalize="none" autoCorrect={false} maxLength={20}
                  placeholder="username" placeholderTextColor={C.textMuted}
                  returnKeyType="done" onSubmitEditing={handleSaveUsername}
                />
              </View>
              {usernameError ? <Text style={[ps.usernameHint, { color: '#EF4444' }]}>{usernameError}</Text> : <Text style={[ps.usernameHint, { color: C.textMuted }]}>Letters, numbers and _ · 3–20 chars</Text>}
              <View style={ps.usernameActions}>
                <Pressable style={[ps.cancelBtn, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => { setEditingUsername(false); setUsernameError(null); }} disabled={usernameSaving}>
                  <Text style={[{ fontSize: 13, fontWeight: FONTS.semiBold, color: C.textMuted }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[ps.saveBtn, { backgroundColor: C.primary, opacity: usernameInput.trim().length < 3 || usernameSaving ? 0.4 : 1 }]} onPress={handleSaveUsername} disabled={usernameInput.trim().length < 3 || usernameSaving}>
                  {usernameSaving ? <ActivityIndicator size="small" color="#000" /> : <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: '#000' }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={ps.usernameRow} onPress={() => { setUsernameInput(username); setEditingUsername(true); }} hitSlop={8}>
              <Text style={[ps.heroName, { color: C.textPrimary }]}>{username}</Text>
              <View style={[ps.editPill, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Ionicons name="pencil" size={9} color={C.textMuted} />
                <Text style={[ps.editText, { color: C.textMuted }]}>Edit</Text>
              </View>
            </Pressable>
          )}

          <Text style={[ps.email, { color: C.textMuted }]}>{user?.email}</Text>

          {/* Badges row */}
          <View style={ps.badgeRow}>
            <View style={[ps.heroBadge, { backgroundColor: C.primaryGlow }]}>
              <Ionicons name="shield-checkmark" size={11} color={C.primary} />
              <Text style={[ps.heroBadgeText, { color: C.primary }]}>Verified</Text>
            </View>
            {vipStatus.isVip ? (
              <View style={[ps.heroBadge, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                <FontAwesome5 name="crown" size={9} color="#F59E0B" />
                <Text style={[ps.heroBadgeText, { color: '#F59E0B' }]}>VIP</Text>
              </View>
            ) : null}
            {unlockedCount > 0 ? (
              <View style={[ps.heroBadge, { backgroundColor: 'rgba(139,92,246,0.12)' }]}>
                <Text style={[ps.heroBadgeText, { color: '#8B5CF6' }]}>🏅 {unlockedCount} badges</Text>
              </View>
            ) : null}
          </View>
        </LinearGradient>

        {/* Quick Stats */}
        <View style={[ps.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
          <StatCell emoji="🎯" val={computed.total} label="Picks" color={C.primary} C={C} />
          <View style={[ps.statDivider, { backgroundColor: C.border }]} />
          <StatCell emoji="🏆" val={`${computed.winRate}%`} label="Win Rate" color={computed.winRate >= 60 ? '#22C55E' : '#F59E0B'} C={C} />
          <View style={[ps.statDivider, { backgroundColor: C.border }]} />
          <StatCell emoji="🔥" val={perfectStreak} label="Streak" color="#F59E0B" C={C} />
          <View style={[ps.statDivider, { backgroundColor: C.border }]} />
          <StatCell emoji="🪙" val={coins !== null ? coins : '—'} label="Coins" color="#F59E0B" C={C} />
        </View>

        {/* VIP Banner */}
        {!vipStatus.loading ? (
          vipStatus.isVip ? (
            <Pressable onPress={() => router.push('/vip' as any)} style={({ pressed }) => [ps.vipActiveCard, { borderColor: '#F59E0B33' }, pressed ? { opacity: 0.9 } : null]}>
              <LinearGradient colors={['#2A1F00', '#1A1400']} style={ps.vipActiveGradient}>
                <View style={[ps.vipActiveIcon, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B33' }]}>
                  <FontAwesome5 name="crown" size={16} color="#F59E0B" solid />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ps.vipActiveTitle, { color: '#F59E0B' }]}>VIP Active</Text>
                  <Text style={[ps.vipActiveSub, { color: 'rgba(245,158,11,0.55)' }]}>
                    {vipStatus.expiresAt ? `Expires ${new Date(vipStatus.expiresAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}` : 'Active subscription'}
                  </Text>
                </View>
                <View style={[ps.vipActiveBadge, { backgroundColor: 'rgba(110,220,31,0.12)', borderColor: 'rgba(110,220,31,0.3)' }]}>
                  <View style={[ps.vipActiveDot, { backgroundColor: '#6EDC1F' }]} />
                  <Text style={[ps.vipActiveBadgeText, { color: '#6EDC1F' }]}>ACTIVE</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#F59E0B" />
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/vip' as any)} style={({ pressed }) => [ps.vipBanner, pressed ? { opacity: 0.9 } : null]}>
              <LinearGradient colors={['#CC9900', '#FFD700', '#CC9900']} style={ps.vipBannerGradient}>
                <FontAwesome5 name="crown" size={22} color="#070B14" />
                <View style={{ flex: 1 }}>
                  <Text style={ps.vipBannerTitle}>Upgrade to VIP</Text>
                  <Text style={ps.vipBannerSub}>Unlimited AI predictions · Expert tips · Premium picks</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#070B14" />
              </LinearGradient>
            </Pressable>
          )
        ) : null}

        {/* Tabs */}
        <View style={[ps.tabs, { backgroundColor: C.card, borderColor: C.border }]}>
          {([['overview', '📊 Overview'], ['history', '🎯 History'], ['achievements', '🏅 Badges']] as const).map(([tab, label]) => (
            <Pressable
              key={tab}
              style={[ps.tab, { borderBottomColor: activeTab === tab ? C.primary : 'transparent' }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[ps.tabText, { color: activeTab === tab ? C.primary : C.textMuted }, activeTab === tab ? { fontWeight: FONTS.bold } : null]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Tab content */}
        <View style={ps.content}>
          {activeTab === 'overview' ? (
            <>
              {/* Analytics card */}
              <View style={[ps.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={ps.cardHeaderRow}>
                  <Text style={[ps.cardTitle, { color: C.textPrimary }]}>Prediction Analytics</Text>
                  <Pressable
                    style={({ pressed }) => [ps.analyticsPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }, pressed ? { opacity: 0.75 } : null]}
                    onPress={() => router.push('/accuracy' as any)}
                  >
                    <Ionicons name="stats-chart-outline" size={11} color={C.primary} />
                    <Text style={[{ fontSize: 10, fontWeight: FONTS.bold, color: C.primary }]}>Platform Stats</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                  <WinArc winRate={computed.winRate} wins={computed.wins} total={computed.total} C={C} />
                  <View style={{ flex: 1, paddingTop: 6 }}>
                    {sportEntries.length > 0
                      ? sportEntries.map(([sp, d]) => <SportBar key={sp} sport={sp} wins={d.wins} total={d.total} C={C} />)
                      : <Text style={[{ color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 }]}>Generate predictions to see your stats here.</Text>
                    }
                  </View>
                </View>
                {computed.total > 0 ? (
                  <View style={[ps.summaryRow, { borderTopColor: C.border }]}>
                    {[
                      { icon: '✅', val: computed.wins, label: 'Won', color: '#22C55E' },
                      { icon: '❌', val: computed.lost, label: 'Lost', color: '#EF4444' },
                      { icon: '⏳', val: computed.pending, label: 'Pending', color: C.textSecondary },
                      { icon: '🔥', val: computed.streak, label: 'Streak', color: '#F59E0B' },
                    ].map(item => (
                      <View key={item.label} style={ps.summaryCell}>
                        <Text style={ps.summaryIcon}>{item.icon}</Text>
                        <Text style={[ps.summaryVal, { color: item.color }]}>{item.val}</Text>
                        <Text style={[ps.summaryLabel, { color: C.textMuted }]}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {/* Earn Coins grid */}
              <EarnCoinsGrid
                coins={coins}
                challengeStreak={challengeStreak}
                referrals={referrals}
                C={C}
                onPress={(route) => router.push(route as any)}
              />

              {/* Menu items */}
              <View style={[ps.menuSection, { backgroundColor: C.card, borderColor: C.border }]}>
                <MenuItem icon="bookmark-outline" label="Bookmarks" C={C} onPress={() => router.push('/bookmarks' as any)} />
                <MenuItem icon="flash-outline" label="Daily Challenge" C={C} badge={perfectStreak > 0 ? `${perfectStreak}🔥` : undefined} onPress={() => router.push('/challenge' as any)} />
                <MenuItem icon="trophy-outline" label="Leaderboard" C={C} onPress={() => router.push('/leaderboard' as any)} />
                <MenuItem icon="stats-chart-outline" label="Accuracy Analytics" C={C} onPress={() => router.push('/accuracy' as any)} />
                <MenuItem icon="share-social-outline" label="Refer a Friend" C={C} badge={referrals > 0 ? `${referrals} joined` : undefined} onPress={() => router.push('/referral' as any)} />
                <MenuItem icon="notifications-outline" label="Notifications" C={C} onPress={() => router.push('/notification-preferences' as any)} />
                <MenuItem icon="language-outline" label="Language" C={C} onPress={() => router.push('/language-settings' as any)} isLast />
              </View>

              <View style={[ps.menuSection, { backgroundColor: C.card, borderColor: C.border }]}>
                <MenuItem icon="settings-outline" label="Settings" C={C} onPress={() => router.push('/settings' as any)} />
                <MenuItem icon="lock-closed-outline" label="Security" C={C} onPress={() => router.push('/security' as any)} />
                <MenuItem icon="trash-outline" label="Delete My Data" C={C} danger onPress={() => router.push('/account-deletion-request' as any)} isLast={!isAdmin} />
                {isAdmin ? (
                  <Pressable
                    style={({ pressed }) => [mi.item, { borderBottomColor: 'transparent' }, pressed ? { backgroundColor: C.cardHighlight } : null]}
                    onPress={() => router.push('/admin' as any)}
                  >
                    <View style={[mi.icon, { backgroundColor: '#EF444412' }]}>
                      <FontAwesome5 name="shield-alt" size={15} color={C.accentRed} />
                    </View>
                    <Text style={[mi.label, { color: C.textPrimary }]}>Admin Dashboard</Text>
                    <View style={[mi.badge, { backgroundColor: `${C.accentRed}18`, borderColor: `${C.accentRed}33` }]}>
                      <Text style={[mi.badgeText, { color: C.accentRed }]}>{adminRole === 'main_admin' ? 'SUPER ADMIN' : 'ADMIN'}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={C.textMuted} />
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                style={({ pressed }) => [ps.logoutBtn, { backgroundColor: '#EF444412', borderColor: '#EF444433' }, pressed ? { opacity: 0.8 } : null]}
                onPress={handleLogout}
              >
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={[ps.logoutText, { color: '#EF4444' }]}>Sign Out</Text>
              </Pressable>
            </>
          ) : activeTab === 'history' ? (
            <>
              {historyLoading ? (
                <View style={ps.centerWrap}>
                  <ActivityIndicator color={C.primary} size="large" />
                  <Text style={[{ fontSize: 13, color: C.textMuted, marginTop: 10 }]}>Loading your picks...</Text>
                </View>
              ) : history.length === 0 ? (
                <View style={ps.centerWrap}>
                  <Text style={{ fontSize: 48 }}>🎯</Text>
                  <Text style={[{ fontSize: 18, fontWeight: FONTS.bold, color: C.textSecondary, marginTop: 8 }]}>No picks yet</Text>
                  <Text style={[{ fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20, marginTop: 4 }]}>Generate AI predictions on match pages to build your history.</Text>
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: C.primary, borderRadius: RADIUS.full, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 }, pressed ? { opacity: 0.85 } : null]}
                    onPress={() => router.push('/(tabs)/predictions' as any)}
                  >
                    <FontAwesome5 name="brain" size={14} color="#000" />
                    <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: '#000' }}>View AI Picks</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {/* Summary */}
                  <View style={[ps.card, { backgroundColor: C.card, borderColor: C.border }]}>
                    <View style={ps.summaryRow}>
                      {[
                        { icon: '✅', val: computed.wins, label: 'Won', color: '#22C55E' },
                        { icon: '❌', val: computed.lost, label: 'Lost', color: '#EF4444' },
                        { icon: '⏳', val: computed.pending, label: 'Pending', color: C.textSecondary },
                        { icon: '🎯', val: `${computed.winRate}%`, label: 'Win Rate', color: C.primary },
                      ].map(item => (
                        <View key={item.label} style={ps.summaryCell}>
                          <Text style={ps.summaryIcon}>{item.icon}</Text>
                          <Text style={[ps.summaryVal, { color: item.color }]}>{item.val}</Text>
                          <Text style={[ps.summaryLabel, { color: C.textMuted }]}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {history.map(item => (
                    <HistCard
                      key={item.id}
                      item={item}
                      C={C}
                      onPress={() => item.match ? router.push(`/match/${item.match.id}` as any) : undefined}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              {/* Achievement header */}
              <View style={[ps.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[{ fontSize: 15, fontWeight: FONTS.bold, color: C.textPrimary }]}>Your Badges</Text>
                  <Text style={[{ fontSize: 12, color: C.textMuted }]}>{unlockedCount} / {achievements.length} unlocked</Text>
                </View>
                <View style={[{ height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' }]}>
                  <View style={{ height: '100%', width: `${Math.round((unlockedCount / achievements.length) * 100)}%` as any, backgroundColor: C.primary, borderRadius: 3 }} />
                </View>
              </View>
              <View style={ps.achieveGrid}>
                {achievements.map(a => <AchCard key={a.id} a={a} C={C} />)}
              </View>
              <View style={[ps.card, { backgroundColor: C.card, borderColor: C.border, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }]}>
                <Ionicons name="information-circle-outline" size={16} color={C.accentBlue} />
                <Text style={[{ flex: 1, fontSize: 12, lineHeight: 18, color: C.textMuted }]}>Keep predicting to unlock more badges and climb the leaderboard!</Text>
              </View>
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const ps = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontWeight: FONTS.bold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  hero: { alignItems: 'center', paddingVertical: SPACING.xl, marginHorizontal: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, marginBottom: SPACING.md, marginTop: SPACING.sm, gap: 6 },
  avatarWrap: { position: 'relative', marginBottom: 6 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarInitial: { fontSize: 32, fontWeight: '900' },
  avatarEdit: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  onlineBadge: { position: 'absolute', bottom: 2, left: 2, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroName: { fontSize: 22, fontWeight: FONTS.bold },
  editPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  editText: { fontSize: 10, fontWeight: FONTS.semiBold },
  email: { fontSize: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeText: { fontSize: 11, fontWeight: FONTS.semiBold },

  usernameEdit: { width: '88%', gap: 6 },
  usernameInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.lg, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  at: { fontSize: 16, fontWeight: FONTS.bold },
  usernameInput: { flex: 1, fontSize: 16, fontWeight: FONTS.bold, padding: 0 },
  usernameHint: { fontSize: 11, textAlign: 'center' },
  usernameActions: { flexDirection: 'row', gap: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 9 },
  saveBtn: { flex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full, paddingVertical: 9 },

  statsRow: { flexDirection: 'row', marginHorizontal: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 14, marginBottom: SPACING.md },
  statDivider: { width: 1, marginVertical: 6 },

  vipActiveCard: { marginHorizontal: SPACING.md, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, marginBottom: SPACING.md },
  vipActiveGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  vipActiveIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  vipActiveTitle: { fontSize: 16, fontWeight: FONTS.bold },
  vipActiveSub: { fontSize: 11, marginTop: 2 },
  vipActiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  vipActiveDot: { width: 6, height: 6, borderRadius: 3 },
  vipActiveBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  vipBanner: { marginHorizontal: SPACING.md, borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md },
  vipBannerGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  vipBannerTitle: { fontSize: 16, fontWeight: FONTS.bold, color: '#070B14' },
  vipBannerSub: { fontSize: 11, color: 'rgba(7,11,20,0.7)', marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 4, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2 },
  tabText: { fontSize: 13, fontWeight: FONTS.semiBold },

  content: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, gap: SPACING.sm },
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, gap: 12 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontWeight: FONTS.bold },
  analyticsPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  summaryRow: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 12 },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  summaryIcon: { fontSize: 14 },
  summaryVal: { fontSize: 16, fontWeight: '900' },
  summaryLabel: { fontSize: 9, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.4 },

  menuSection: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: RADIUS.xl, borderWidth: 1, padding: 14 },
  logoutText: { fontSize: 15, fontWeight: FONTS.semiBold },

  centerWrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  achieveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
