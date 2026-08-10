/**
 * app/challenge.tsx
 *
 * PredictXta Daily Challenge — Redesigned
 *
 * Features:
 *  - Multi-sport fixture support (Football, Basketball, Tennis, Cricket,
 *    Baseball, Hockey, Rugby, Volleyball, MMA, Handball, Esports, +more)
 *  - Server-side pick persistence to `challenge_picks` table
 *  - Auto-settlement polling every 90s for live/finished matches
 *  - Sport-aware outcome determination (no draw for tennis/basketball/MMA)
 *  - Difficulty banding: upset | competitive | favourite
 *  - Coin awards: 25 for perfect, 10 for partial
 *  - Perfect-week bonus: +100 for 7 consecutive perfect days (dedup via coin_claims)
 *  - Weekly leaderboard from DB
 *  - Streak tracker (consecutive perfect days)
 *  - Share card
 *  - Countdown to midnight reset
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Share, RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { Image } from 'expo-image';
import {
  ChallengeMatch, ChallengePick, DailyEntry, ChallengeStats, LeaderboardEntry,
  ChallengeOutcome, SettlementStatus,
  fetchDailyChallengeMatches,
  settleChallengeResults,
  persistChallengePicks,
  fetchWeeklyLeaderboard,
  saveResultToLeaderboard,
  awardChallengeCoins,
  checkAndAwardPerfectWeekBonus,
  loadTodayEntry,
  saveEntry,
  loadChallengeStats,
  getConsecutiveWinCount,
  getTodayKey, getWeekKey, getNextResetMs, formatCountdown,
  getSportChallengeConfig, COIN_AWARDS,
  determineOutcome,
} from '@/services/challengeService';

// ─── Types ────────────────────────────────────────────────────────────────────
type DifficultyBand = 'upset' | 'competitive' | 'favourite';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPredictionName(p: ChallengeOutcome, sport: string): string {
  const cfg = getSportChallengeConfig(sport);
  if (p === 'home_win') return cfg.drawPossible ? '1 Home Win' : 'Home Win';
  if (p === 'draw') return 'Draw';
  return cfg.drawPossible ? '2 Away Win' : 'Away Win';
}

// ─── Difficulty badge config ───────────────────────────────────────────────────
const DIFFICULTY_CONFIG: Record<DifficultyBand, { label: string; color: string; icon: string; desc: string }> = {
  upset:       { label: 'UPSET PICK',   color: '#EF4444', icon: 'bolt',          desc: 'Low win probability — unpredictable match' },
  competitive: { label: 'COMPETITIVE',  color: '#3B82F6', icon: 'balance-scale', desc: 'Medium probability — closely contested' },
  favourite:   { label: 'SAFE PICK',    color: '#22C55E', icon: 'shield-alt',    desc: 'High win probability — clear favourite' },
};

// ─── Team Logo ─────────────────────────────────────────────────────────────────
function TeamLogoMini({ name, logoUrl, size = 48 }: { name: string; logoUrl?: string | null; size?: number }) {
  const abbr = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (logoUrl) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Image source={{ uri: logoUrl }} style={{ width: size * 0.74, height: size * 0.74 }} contentFit="contain" transition={150} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.primaryGlow, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.22, fontWeight: FONTS.extraBold as any, color: COLORS.primary }}>{abbr}</Text>
    </View>
  );
}

// ─── Countdown Timer ──────────────────────────────────────────────────────────
function CountdownTimer() {
  const [remaining, setRemaining] = useState(getNextResetMs());
  useEffect(() => {
    const id = setInterval(() => setRemaining(getNextResetMs()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={timer.wrap}>
      <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
      <Text style={timer.label}>Resets in</Text>
      <View style={timer.clock}>
        <Text style={timer.clockText}>{formatCountdown(remaining)}</Text>
      </View>
    </View>
  );
}
const timer = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: COLORS.border, alignSelf: 'center' },
  label: { fontSize: 12, color: COLORS.textMuted, fontWeight: FONTS.medium },
  clock: { backgroundColor: COLORS.card, borderRadius: RADIUS.sm, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.border },
  clockText: { fontSize: 13, fontWeight: FONTS.extraBold as any, color: COLORS.primary, fontVariant: ['tabular-nums'] },
});

// ─── Settlement Status Banner ─────────────────────────────────────────────────
function SettlementBanner({ result, correctCount, settledCount }: { result: SettlementStatus; correctCount: number; settledCount: number }) {
  if (result === 'pending') {
    return (
      <View style={[sb.wrap, { backgroundColor: `${COLORS.accentBlue}18`, borderColor: `${COLORS.accentBlue}33` }]}>
        <Ionicons name="lock-closed-outline" size={16} color={COLORS.accentBlue} />
        <View style={{ flex: 1 }}>
          <Text style={[sb.title, { color: COLORS.textPrimary }]}>Predictions Locked</Text>
          <Text style={[sb.sub, { color: COLORS.textMuted }]}>
            {settledCount > 0 && settledCount < 3
              ? `${settledCount}/3 matches settled — waiting for the rest...`
              : 'Results calculated after all 3 matches finish'}
          </Text>
        </View>
        {settledCount > 0 ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: FONTS.extraBold as any, color: COLORS.primary }}>{correctCount}</Text>
            <Text style={{ fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.bold as any }}>CORRECT</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const isPerfect = result === 'win';
  const isPartial = result === 'partial';
  const coins = isPerfect ? COIN_AWARDS.perfect : isPartial ? COIN_AWARDS.partial : 0;

  return (
    <LinearGradient
      colors={isPerfect ? [COLORS.primary, COLORS.primaryDark ?? '#CC9900'] : isPartial ? ['#3B82F688', '#3B82F6'] : ['#EF444488', '#EF4444']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      style={sb.banner}
    >
      <FontAwesome5 name={isPerfect ? 'trophy' : isPartial ? 'medal' : 'times-circle'} size={24} color={isPerfect ? '#070B14' : '#fff'} solid />
      <View style={{ flex: 1 }}>
        <Text style={[sb.bannerTitle, { color: isPerfect ? '#070B14' : '#fff' }]}>
          {isPerfect ? 'Perfect Day! 🏆' : isPartial ? `${correctCount}/3 Correct` : 'Tough Luck — 0/3'}
        </Text>
        <Text style={[sb.bannerSub, { color: isPerfect ? 'rgba(7,11,20,0.7)' : 'rgba(255,255,255,0.8)' }]}>
          {isPerfect ? 'All 3 correct! Outstanding prediction!' : isPartial ? 'Solid effort — keep it going!' : 'Better luck tomorrow!'}
        </Text>
        {coins > 0 ? (
          <View style={sb.coinRow}>
            <FontAwesome5 name="coins" size={11} color={isPerfect ? '#070B14' : '#fff'} solid />
            <Text style={[sb.coinText, { color: isPerfect ? '#070B14' : '#fff' }]}>+{coins} 🪙 coins earned!</Text>
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}

const sb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.xl, padding: 14, borderWidth: 1 },
  title: { fontSize: 14, fontWeight: FONTS.bold as any },
  sub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.xl, padding: 16 },
  bannerTitle: { fontSize: 16, fontWeight: FONTS.extraBold as any },
  bannerSub: { fontSize: 12, marginTop: 2, lineHeight: 18 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  coinText: { fontSize: 11, fontWeight: FONTS.extraBold as any },
});

// ─── Streak Progress ──────────────────────────────────────────────────────────
function StreakBar({ count }: { count: number }) {
  const n = Math.min(count, 7);
  const done = n >= 7;
  return (
    <View style={streak.wrap}>
      <View style={streak.header}>
        <Text style={streak.title}>🔥 Perfect Week Progress</Text>
        <View style={[streak.chip, done ? streak.chipDone : null]}>
          <Text style={[streak.chipText, done ? streak.chipTextDone : null]}>{n}/7</Text>
        </View>
      </View>
      <View style={streak.dots}>
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={i} style={[streak.dot, i < n ? streak.dotOn : null]}>
            {i < n ? <Text style={streak.dotCheck}>✓</Text> : null}
          </View>
        ))}
      </View>
      <View style={streak.barTrack}>
        <View style={[streak.barFill, { width: `${(n / 7) * 100}%` as any }]} />
      </View>
      {done ? (
        <Text style={streak.achieved}>🎉 Perfect Week achieved! +{COIN_AWARDS.perfectWeek} bonus coins!</Text>
      ) : (
        <Text style={streak.hint}>{7 - n} more perfect {7 - n === 1 ? 'day' : 'days'} to earn <Text style={streak.hintHL}>+{COIN_AWARDS.perfectWeek} bonus coins</Text>!</Text>
      )}
    </View>
  );
}
const streak = StyleSheet.create({
  wrap: { backgroundColor: 'rgba(255,100,0,0.07)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(255,100,0,0.2)', padding: 12, gap: 10, marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: FONTS.bold as any, color: '#FF8C42' },
  chip: { backgroundColor: 'rgba(255,100,0,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,100,0,0.3)' },
  chipDone: { backgroundColor: COLORS.primaryGlow, borderColor: 'rgba(255,215,0,0.5)' },
  chipText: { fontSize: 13, fontWeight: FONTS.extraBold as any, color: '#FF8C42' },
  chipTextDone: { color: COLORS.primary },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { flex: 1, height: 24, borderRadius: RADIUS.sm, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,100,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: 'rgba(255,107,53,0.3)', borderColor: '#FF6B35' },
  dotCheck: { fontSize: 10, color: '#FF6B35', fontWeight: FONTS.extraBold as any },
  barTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.full, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: RADIUS.full, backgroundColor: '#FF6B35' },
  hint: { fontSize: 11, color: 'rgba(255,180,120,0.85)', lineHeight: 16 },
  hintHL: { color: COLORS.primary, fontWeight: FONTS.bold as any },
  achieved: { fontSize: 12, fontWeight: FONTS.bold as any, color: COLORS.primary, textAlign: 'center' },
});

// ─── Match Pick Card ───────────────────────────────────────────────────────────
function MatchPickCard({ match, pick, submitted, correctness, onPick, index }: {
  match: ChallengeMatch; pick: ChallengeOutcome | null; submitted: boolean;
  correctness?: boolean | null;  // null = pending, true = correct, false = wrong
  onPick: (matchId: string, prediction: ChallengeOutcome) => void; index: number;
}) {
  const sportCfg = getSportChallengeConfig(match.sport);
  const diffCfg = DIFFICULTY_CONFIG[match.difficultyBand as DifficultyBand] ?? DIFFICULTY_CONFIG.competitive;
  const kickoffDate = match.matchTime
    ? new Date(match.matchTime).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Today';
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';

  const options: { label: string; value: ChallengeOutcome }[] = match.sport && !getSportChallengeConfig(match.sport).drawPossible
    ? [
        { label: '1', value: 'home_win' },
        { label: '2', value: 'away_win' },
      ]
    : [
        { label: '1', value: 'home_win' },
        { label: 'X', value: 'draw' },
        { label: '2', value: 'away_win' },
      ];

  const optionColor = (value: ChallengeOutcome) => {
    if (value === 'home_win') return '#38BDF8';
    if (value === 'draw') return COLORS.primary;
    return '#A78BFA';
  };

  return (
    <View style={[card.wrap, { borderColor: COLORS.border }]}>
      {/* Header */}
      <View style={[card.header, { backgroundColor: COLORS.surface, borderBottomColor: COLORS.border }]}>
        <View style={[card.numBadge, { backgroundColor: COLORS.primaryGlow }]}>
          <Text style={[card.numText, { color: COLORS.primary }]}>#{index + 1}</Text>
        </View>
        <Text style={card.sportLabel}>{sportCfg.emoji} {match.sport?.charAt(0).toUpperCase() + match.sport?.slice(1)}</Text>
        <Text style={card.leagueLabel} numberOfLines={1}>{match.league}</Text>
        <View style={[card.diffBadge, { backgroundColor: `${diffCfg.color}18`, borderColor: `${diffCfg.color}44` }]}>
          <FontAwesome5 name={diffCfg.icon as any} size={8} color={diffCfg.color} />
          <Text style={[card.diffText, { color: diffCfg.color }]}>{diffCfg.label}</Text>
        </View>
        {/* Settlement result indicator */}
        {submitted && correctness !== null && correctness !== undefined ? (
          <View style={[card.resultPill, correctness ? card.resultCorrect : card.resultWrong]}>
            <Ionicons name={correctness ? 'checkmark' : 'close'} size={11} color={correctness ? '#22C55E' : '#EF4444'} />
          </View>
        ) : null}
      </View>

      {/* Difficulty strip */}
      <View style={[card.diffStrip, { backgroundColor: `${diffCfg.color}0A`, borderBottomColor: `${diffCfg.color}22` }]}>
        <Ionicons name="information-circle-outline" size={11} color={diffCfg.color} />
        <Text style={[card.diffStripText, { color: diffCfg.color }]}>{diffCfg.desc}</Text>
        <Text style={[card.settlementNote, { color: COLORS.textMuted }]}>{sportCfg.settlementNote}</Text>
      </View>

      {/* Teams row */}
      <View style={card.teamsRow}>
        <View style={card.teamBlock}>
          <TeamLogoMini name={match.homeTeam} logoUrl={match.homeLogo} size={52} />
          <Text style={card.teamName} numberOfLines={2}>{match.homeTeam}</Text>
          <Text style={card.teamRole}>Home</Text>
        </View>
        <View style={card.vsBlock}>
          {isLive ? (
            <>
              <Text style={card.liveScore}>{match.homeScore} - {match.awayScore}</Text>
              <View style={card.livePill}>
                <View style={card.liveDot} />
                <Text style={card.liveMin}>{match.minute}'</Text>
              </View>
            </>
          ) : isFinished ? (
            <>
              <Text style={[card.liveScore, { color: COLORS.textPrimary }]}>{match.homeScore} - {match.awayScore}</Text>
              <Text style={card.ftLabel}>FT</Text>
            </>
          ) : (
            <>
              <Text style={card.vsText}>VS</Text>
              <Text style={card.kickoff}>{kickoffDate}</Text>
            </>
          )}
        </View>
        <View style={card.teamBlock}>
          <TeamLogoMini name={match.awayTeam} logoUrl={match.awayLogo} size={52} />
          <Text style={card.teamName} numberOfLines={2}>{match.awayTeam}</Text>
          <Text style={card.teamRole}>Away</Text>
        </View>
      </View>

      {/* Pick buttons */}
      <View style={[card.pickRow, options.length === 2 ? { justifyContent: 'space-between' as const } : null]}>
        {options.map((opt) => {
          const isSelected = pick === opt.value;
          const clr = optionColor(opt.value);
          return (
            <Pressable
              key={opt.value}
              style={({ pressed }) => [
                card.pickBtn,
                options.length === 2 ? { flex: 1, maxWidth: '46%' } : null,
                isSelected ? { backgroundColor: `${clr}22`, borderColor: clr } : null,
                submitted ? { opacity: isSelected ? 1 : 0.35 } : null,
                pressed && !submitted ? { opacity: 0.75, transform: [{ scale: 0.95 }] } : null,
              ]}
              onPress={() => !submitted && onPick(match.id, opt.value)}
              disabled={submitted}
            >
              <Text style={[card.pickBtnLabel, isSelected ? { color: clr } : null]}>{opt.label}</Text>
              <Text style={[card.pickBtnSub, isSelected ? { color: clr } : null]}>
                {opt.value === 'home_win' ? 'Home' : opt.value === 'draw' ? 'Draw' : 'Away'}
              </Text>
              {isSelected ? (
                <View style={[card.pickCheck, { backgroundColor: clr }]}>
                  <Ionicons name="checkmark" size={8} color={COLORS.textInverse} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* Selected state row */}
      {pick ? (
        <View style={card.selRow}>
          <Ionicons name={submitted ? 'lock-closed' : 'checkmark-circle'} size={12} color={submitted ? COLORS.textMuted : COLORS.accent} />
          <Text style={[card.selText, submitted ? { color: COLORS.textMuted } : null]}>
            {submitted ? 'Locked: ' : 'Selected: '}
            <Text style={{ fontWeight: FONTS.bold as any }}>{getPredictionName(pick, match.sport)}</Text>
          </Text>
          {submitted && correctness !== null && correctness !== undefined ? (
            <Text style={{ fontSize: 11, color: correctness ? '#22C55E' : '#EF4444', fontWeight: FONTS.bold as any, marginLeft: 4 }}>
              {correctness ? '✓ Correct' : '✗ Wrong'}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={card.selRow}>
          <Ionicons name="ellipse-outline" size={12} color={COLORS.textMuted} />
          <Text style={card.unpickedText}>Tap a result to predict</Text>
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  wrap: { backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  numBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 10, fontWeight: FONTS.extraBold as any, lineHeight: 14 },
  sportLabel: { fontSize: 12, fontWeight: FONTS.bold as any, color: COLORS.textSecondary },
  leagueLabel: { fontSize: 11, color: COLORS.textMuted, flex: 1 },
  diffBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  diffText: { fontSize: 8, fontWeight: FONTS.extraBold as any, letterSpacing: 0.4 },
  resultPill: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  resultCorrect: { backgroundColor: '#22C55E18', borderColor: '#22C55E55' },
  resultWrong: { backgroundColor: '#EF444418', borderColor: '#EF444455' },
  diffStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1 },
  diffStripText: { fontSize: 11, fontWeight: FONTS.medium as any, flex: 1 },
  settlementNote: { fontSize: 9, fontStyle: 'italic' },
  teamsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 8 },
  teamBlock: { flex: 1, alignItems: 'center', gap: 7 },
  teamName: { fontSize: 13, fontWeight: FONTS.bold as any, color: COLORS.textPrimary, textAlign: 'center' },
  teamRole: { fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.medium as any },
  vsBlock: { alignItems: 'center', gap: 5, paddingHorizontal: 6 },
  vsText: { fontSize: 14, fontWeight: FONTS.extraBold as any, color: COLORS.textMuted, letterSpacing: 1 },
  kickoff: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center' },
  liveScore: { fontSize: 24, fontWeight: FONTS.extraBold as any, color: '#EF4444' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF444414', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#EF444433' },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' },
  liveMin: { fontSize: 9, fontWeight: FONTS.bold as any, color: '#EF4444' },
  ftLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.bold as any },
  pickRow: { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  pickBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, position: 'relative', gap: 2 },
  pickBtnLabel: { fontSize: 20, fontWeight: FONTS.extraBold as any, color: COLORS.textSecondary },
  pickBtnSub: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium as any },
  pickCheck: { position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  selRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 12, marginTop: -4 },
  selText: { fontSize: 12, color: COLORS.accent },
  unpickedText: { fontSize: 12, color: COLORS.textMuted },
});

// ─── Leaderboard Row ──────────────────────────────────────────────────────────
const RANK_COLORS = [COLORS.primary, '#B0B0B0', '#CD7F32', COLORS.accentBlue, COLORS.textMuted];
const RANK_ICONS = ['🥇', '🥈', '🥉', '4', '5'];

function LeaderboardRow({ entry, rank, currentUserId }: { entry: LeaderboardEntry; rank: number; currentUserId?: string }) {
  const isMe = entry.userId === currentUserId;
  const rankColor = RANK_COLORS[rank] ?? COLORS.textMuted;
  const initial = entry.username[0]?.toUpperCase() ?? '?';
  return (
    <View style={[lb.row, isMe ? lb.rowMe : null]}>
      <View style={[lb.rankBadge, rank < 3 ? { backgroundColor: `${rankColor}20`, borderColor: `${rankColor}44` } : null]}>
        <Text style={[lb.rankText, rank < 3 ? { color: rankColor } : null]}>{rank < 3 ? RANK_ICONS[rank] : String(rank + 1)}</Text>
      </View>
      <View style={[lb.avatar, { backgroundColor: `${rankColor}20`, borderColor: `${rankColor}44` }]}>
        <Text style={[lb.avatarText, { color: rankColor }]}>{initial}</Text>
      </View>
      <View style={lb.info}>
        <View style={lb.nameRow}>
          <Text style={lb.username} numberOfLines={1}>{entry.username}</Text>
          {isMe ? <View style={lb.meBadge}><Text style={lb.meBadgeText}>YOU</Text></View> : null}
        </View>
        <View style={lb.barRow}>
          <View style={lb.barTrack}>
            <View style={[lb.barFill, { width: `${Math.min(entry.winRate, 100)}%` as any, backgroundColor: rankColor }]} />
          </View>
          <Text style={[lb.barLabel, { color: rankColor }]}>{entry.winRate}%</Text>
        </View>
      </View>
      <View style={[lb.perfectWrap, { borderColor: `${rankColor}33` }]}>
        <Text style={[lb.perfectNum, { color: rankColor }]}>{entry.perfectDays}</Text>
        <Text style={lb.perfectLabel}>Perfect</Text>
      </View>
    </View>
  );
}

const lb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowMe: { backgroundColor: 'rgba(255,215,0,0.04)' },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  rankText: { fontSize: 13, fontWeight: FONTS.extraBold as any, color: COLORS.textMuted },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, flexShrink: 0 },
  avatarText: { fontSize: 14, fontWeight: FONTS.extraBold as any },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  username: { fontSize: 13, fontWeight: FONTS.bold as any, color: COLORS.textPrimary, flex: 1 },
  meBadge: { backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)' },
  meBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold as any, color: COLORS.primary, letterSpacing: 0.8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  barTrack: { flex: 1, height: 4, borderRadius: RADIUS.full, backgroundColor: COLORS.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: RADIUS.full },
  barLabel: { fontSize: 10, fontWeight: FONTS.bold as any, width: 30, textAlign: 'right' },
  perfectWrap: { alignItems: 'center', borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, minWidth: 50, backgroundColor: COLORS.surface },
  perfectNum: { fontSize: 18, fontWeight: FONTS.extraBold as any, lineHeight: 20 },
  perfectLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium as any },
});

// ─── Stats Card ───────────────────────────────────────────────────────────────
function StatsCard({ stats }: { stats: ChallengeStats }) {
  return (
    <View style={sc.card}>
      <View style={sc.header}>
        <Ionicons name="bar-chart-outline" size={13} color={COLORS.textMuted} />
        <Text style={sc.title}>YOUR CHALLENGE STATS</Text>
      </View>
      <View style={sc.grid}>
        {[
          { label: 'Days Played', value: `${stats.totalDays}`, icon: 'calendar', color: COLORS.accentBlue },
          { label: 'Perfect Days', value: `${stats.perfectDays}`, icon: 'trophy', color: COLORS.primary },
          { label: 'Partial Wins', value: `${stats.partialDays}`, icon: 'ribbon', color: COLORS.accent },
          { label: 'Perfect Rate', value: `${stats.perfectRate}%`, icon: 'stats-chart', color: '#A855F7' },
        ].map((item) => (
          <View key={item.label} style={sc.item}>
            <Ionicons name={item.icon as any} size={16} color={item.color} />
            <Text style={[sc.value, { color: item.color }]}>{item.value}</Text>
            <Text style={sc.label}>{item.label}</Text>
          </View>
        ))}
      </View>
      {stats.currentStreak >= 3 ? (
        <View style={sc.streakBadge}>
          <FontAwesome5 name="fire" size={11} color='#FF6B35' />
          <Text style={sc.streakText}>{stats.currentStreak} day streak 🔥</Text>
          {stats.bestStreak > stats.currentStreak ? (
            <Text style={sc.bestText}>Best: {stats.bestStreak}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
const sc = StyleSheet.create({
  card: { backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: FONTS.bold as any, color: COLORS.textMuted, letterSpacing: 1 },
  grid: { flexDirection: 'row' },
  item: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRightWidth: 1, borderRightColor: COLORS.border },
  value: { fontSize: 18, fontWeight: FONTS.extraBold as any },
  label: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium as any, textAlign: 'center' },
  streakBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,107,53,0.1)', borderRadius: RADIUS.full, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,107,53,0.25)' },
  streakText: { fontSize: 12, fontWeight: FONTS.bold as any, color: '#FF6B35' },
  bestText: { fontSize: 11, color: COLORS.textMuted, marginLeft: 8 },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function ChallengeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();

  const [matches, setMatches] = useState<ChallengeMatch[]>([]);
  const [picks, setPicks] = useState<Record<string, ChallengeOutcome>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SettlementStatus>('pending');
  const [correctCount, setCorrectCount] = useState(0);
  const [settledCount, setSettledCount] = useState(0);
  const [correctness, setCorrectness] = useState<Record<string, boolean | null>>({});
  const [stats, setStats] = useState<ChallengeStats>({ totalDays: 0, perfectDays: 0, partialDays: 0, lossDays: 0, perfectRate: 0, currentStreak: 0, bestStreak: 0 });
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [userRank, setUserRank] = useState<number | null>(null);

  // Coin toast
  const [coinToast, setCoinToast] = useState<{ visible: boolean; amount: number; label: string }>({ visible: false, amount: 0, label: '' });
  const coinToastAnim = useRef(new Animated.Value(0)).current;
  const perfectWeekAnim = useRef(new Animated.Value(0)).current;
  const [perfectWeekVisible, setPerfectWeekVisible] = useState(false);

  // ── Live score polling state ────────────────────────────────────────────
  // Map of matchId → { homeScore, awayScore, minute, status }
  interface LiveSnapshot { homeScore: number; awayScore: number; minute: number; status: string; }
  const [liveSnapshots, setLiveSnapshots] = useState<Record<string, LiveSnapshot>>({});
  // Score-change banner: { matchId, homeScore, awayScore, event, minute }
  interface ScoreEvent { matchId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; playerName: string; minute: number; isHome: boolean; }
  const [scoreBanner, setScoreBanner] = useState<ScoreEvent | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshotsRef = useRef<Record<string, LiveSnapshot>>({});
  const liveScorePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Settlement polling ref
  const settlePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Show score change banner ──────────────────────────────────────────────
  const showScoreBanner = useCallback((event: ScoreEvent) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setScoreBanner(event);
    bannerAnim.setValue(0);
    Animated.sequence([
      Animated.spring(bannerAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.delay(4000),
      Animated.timing(bannerAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start(() => {
      setScoreBanner(null);
      bannerTimer.current = null;
    });
  }, [bannerAnim]);

  // ── Live score polling (30s) ───────────────────────────────────────────────
  const pollLiveScores = useCallback(async () => {
    if (!submitted || matches.length === 0) return;
    // Only poll when at least one picked match is live or upcoming
    const liveOrUpcomingMatches = matches.filter((m) => m.status === 'live' || m.status === 'upcoming');
    if (liveOrUpcomingMatches.length === 0) return;

    const supabase = getSupabaseClient();
    const matchIds = liveOrUpcomingMatches.map((m) => m.id);

    // ── Fetch current match status & scores ──────────────────────────────
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id, home_score, away_score, minute, status')
      .in('id', matchIds);

    if (!matchRows || matchRows.length === 0) return;

    const newSnapshots: Record<string, LiveSnapshot> = { ...prevSnapshotsRef.current };
    let hasFinished = false;

    for (const row of matchRows as Array<{ id: string; home_score: number; away_score: number; minute: number; status: string }>) {
      const prev = prevSnapshotsRef.current[row.id];
      const next: LiveSnapshot = { homeScore: row.home_score ?? 0, awayScore: row.away_score ?? 0, minute: row.minute ?? 0, status: row.status };
      newSnapshots[row.id] = next;

      // Detect score change
      if (prev && (prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore)) {
        // Score changed — fetch latest goal event for context
        const match = matches.find((m) => m.id === row.id);
        const scoredHome = next.homeScore > prev.homeScore;
        const scoredAway = next.awayScore > prev.awayScore;

        if (match && (scoredHome || scoredAway)) {
          // Try to get the goal event for the scorer name
          const { data: goalEvents } = await supabase
            .from('match_events')
            .select('player_name, minute, is_home_team, event_type')
            .eq('match_id', row.id)
            .in('event_type', ['Goal', 'goal', 'GOAL', 'Penalty', 'penalty'])
            .order('minute', { ascending: false })
            .limit(1);

          const goalEvent = goalEvents?.[0];
          showScoreBanner({
            matchId: row.id,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            homeScore: next.homeScore,
            awayScore: next.awayScore,
            playerName: goalEvent?.player_name ?? (scoredHome ? match.homeTeam : match.awayTeam),
            minute: goalEvent?.minute ?? next.minute,
            isHome: scoredHome,
          });
        }
      }

      // Detect status change to finished
      if (prev?.status !== 'finished' && next.status === 'finished') {
        hasFinished = true;
      }
    }

    prevSnapshotsRef.current = newSnapshots;
    setLiveSnapshots({ ...newSnapshots });

    // Update match statuses locally so cards render FT
    if (matchRows.some((r: any) => r.status === 'live' || r.status === 'finished')) {
      // Mutate matches in-place for real-time rendering
      setMatches((prev) =>
        prev.map((m) => {
          const fresh = matchRows.find((r: any) => r.id === m.id) as any;
          if (!fresh) return m;
          return {
            ...m,
            homeScore: fresh.home_score ?? m.homeScore,
            awayScore: fresh.away_score ?? m.awayScore,
            minute: fresh.minute ?? m.minute,
            status: fresh.status ?? m.status,
          };
        })
      );
    }

    // Auto-settle if any match just finished
    if (hasFinished && result === 'pending' && user?.id) {
      // Trigger settlement immediately
      const settled = await settleChallengeResults(user.id, getTodayKey());
      setSettledCount(settled.settledCount);
      const newCorrectness: Record<string, boolean | null> = {};
      settled.details.forEach((d) => {
        newCorrectness[d.matchId] = d.actual !== null ? d.correct : null;
      });
      setCorrectness(newCorrectness);
      if (settled.settled && settled.result !== 'pending') {
        setResult(settled.result);
        setCorrectCount(settled.correctCount);
        const entry: DailyEntry = {
          date: getTodayKey(),
          picks: matches.map((m) => ({ matchId: m.id, prediction: picks[m.id] })),
          submitted: true,
          result: settled.result,
          correctCount: settled.correctCount,
          settledCount: settled.settledCount,
        };
        await saveEntry(entry);
        setStats(await loadChallengeStats());
        if (settled.result === 'win' || settled.result === 'partial') {
          const { awarded, newBalance } = await awardChallengeCoins(user.id, settled.result);
          if (awarded > 0) { setCoinBalance(newBalance); showCoinToast(awarded, settled.result === 'win' ? '🏆 Perfect! ' : ''); }
          if (settled.result === 'win') {
            const streakN = await getConsecutiveWinCount();
            setStreakCount(streakN);
            const { awarded: wkAwarded, newBalance: wkBal } = await checkAndAwardPerfectWeekBonus(user.id);
            if (wkAwarded) { setCoinBalance(wkBal); showPerfectWeekToast(); }
          }
        }
      }
    }
  }, [submitted, matches, picks, result, user?.id, showScoreBanner]);

  // Start/stop 30s live score polling
  useEffect(() => {
    if (!submitted) {
      if (liveScorePollRef.current) { clearInterval(liveScorePollRef.current); liveScorePollRef.current = null; }
      return;
    }
    // Initialize snapshots from current match data
    const initSnapshots: Record<string, LiveSnapshot> = {};
    matches.forEach((m) => {
      initSnapshots[m.id] = { homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0, minute: m.minute ?? 0, status: m.status };
    });
    prevSnapshotsRef.current = initSnapshots;
    setLiveSnapshots(initSnapshots);

    pollLiveScores(); // immediate
    liveScorePollRef.current = setInterval(pollLiveScores, 30_000);
    return () => {
      if (liveScorePollRef.current) { clearInterval(liveScorePollRef.current); liveScorePollRef.current = null; }
      if (bannerTimer.current) { clearTimeout(bannerTimer.current); bannerTimer.current = null; }
    };
  }, [submitted, pollLiveScores]);

  const showCoinToast = useCallback((amount: number, label = '') => {
    setCoinToast({ visible: true, amount, label });
    Animated.sequence([
      Animated.timing(coinToastAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(coinToastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setCoinToast({ visible: false, amount: 0, label: '' }));
  }, []);

  const showPerfectWeekToast = useCallback(() => {
    setTimeout(() => {
      setPerfectWeekVisible(true);
      Animated.sequence([
        Animated.timing(perfectWeekAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(3500),
        Animated.timing(perfectWeekAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start(() => setPerfectWeekVisible(false));
    }, 700);
  }, []);

  // ── Settlement polling ────────────────────────────────────────────────────
  const pollSettlement = useCallback(async () => {
    if (!user?.id || !submitted || result !== 'pending') return;

    const settled = await settleChallengeResults(user.id, getTodayKey());
    setSettledCount(settled.settledCount);

    // Update per-match correctness
    const newCorrectness: Record<string, boolean | null> = {};
    settled.details.forEach((d) => {
      newCorrectness[d.matchId] = d.actual !== null ? d.correct : null;
    });
    setCorrectness(newCorrectness);

    if (settled.settled && settled.result !== 'pending') {
      setResult(settled.result);
      setCorrectCount(settled.correctCount);

      // Update local storage
      const entry: DailyEntry = {
        date: getTodayKey(),
        picks: matches.map((m) => ({ matchId: m.id, prediction: picks[m.id] })),
        submitted: true,
        result: settled.result,
        correctCount: settled.correctCount,
        settledCount: settled.settledCount,
      };
      await saveEntry(entry);
      setStats(await loadChallengeStats());

      // Award coins
      if (user?.id && (settled.result === 'win' || settled.result === 'partial')) {
        const { awarded, newBalance } = await awardChallengeCoins(user.id, settled.result);
        if (awarded > 0) {
          setCoinBalance(newBalance);
          showCoinToast(awarded, settled.result === 'win' ? '🏆 Perfect! ' : '');
        }
      }

      // Check perfect-week bonus
      if (settled.result === 'win' && user?.id) {
        const streak = await getConsecutiveWinCount();
        setStreakCount(streak);
        const { awarded, newBalance } = await checkAndAwardPerfectWeekBonus(user.id);
        if (awarded) {
          setCoinBalance(newBalance);
          showPerfectWeekToast();
        }
      }

      // Stop polling
      if (settlePollRef.current) {
        clearInterval(settlePollRef.current);
        settlePollRef.current = null;
      }
    }
  }, [user?.id, submitted, result, matches, picks, showCoinToast, showPerfectWeekToast]);

  // Start/stop polling
  useEffect(() => {
    if (submitted && result === 'pending') {
      pollSettlement(); // immediate check
      settlePollRef.current = setInterval(pollSettlement, 90_000); // every 90s
    }
    return () => {
      if (settlePollRef.current) { clearInterval(settlePollRef.current); settlePollRef.current = null; }
    };
  }, [submitted, result, pollSettlement]);

  // ── Initialize ────────────────────────────────────────────────────────────
  const initialize = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);

    const [dailyMatches, todayEntry, loadedStats, lb, coinsRes] = await Promise.all([
      fetchDailyChallengeMatches(),
      loadTodayEntry(),
      loadChallengeStats(),
      fetchWeeklyLeaderboard(),
      user?.id
        ? getSupabaseClient().from('user_coins').select('balance').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setMatches(dailyMatches);
    setStats(loadedStats);
    setLeaderboard(lb);
    setCoinBalance((coinsRes as any)?.data?.balance ?? 0);

    if (user?.id && lb.length > 0) {
      const rankIdx = lb.findIndex((e) => e.userId === user.id);
      setUserRank(rankIdx >= 0 ? rankIdx + 1 : null);
    }

    if (todayEntry) {
      const pickMap: Record<string, ChallengeOutcome> = {};
      todayEntry.picks.forEach((p) => { pickMap[p.matchId] = p.prediction; });
      setPicks(pickMap);
      setSubmitted(todayEntry.submitted);
      setResult(todayEntry.result ?? 'pending');
      setCorrectCount(todayEntry.correctCount ?? 0);
      setSettledCount(todayEntry.settledCount ?? 0);

      if (todayEntry.result === 'win') {
        getConsecutiveWinCount().then(setStreakCount);
      }

      // If previously submitted but result pending, try settling now
      if (todayEntry.submitted && (todayEntry.result === 'pending' || !todayEntry.result)) {
        if (user?.id) {
          const settled = await settleChallengeResults(user.id, getTodayKey());
          setSettledCount(settled.settledCount);
          const newCorrectness: Record<string, boolean | null> = {};
          settled.details.forEach((d) => {
            newCorrectness[d.matchId] = d.actual !== null ? d.correct : null;
          });
          setCorrectness(newCorrectness);
          if (settled.settled && settled.result !== 'pending') {
            setResult(settled.result);
            setCorrectCount(settled.correctCount);
          }
        }
      }
    }

    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useEffect(() => { initialize(); }, [initialize]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initialize(true);
  }, [initialize]);

  const handlePick = (matchId: string, prediction: ChallengeOutcome) => {
    if (submitted) return;
    setPicks((prev) => ({ ...prev, [matchId]: prediction }));
  };

  const allPicked = matches.length === 3 && matches.every((m) => picks[m.id]);
  const pickedCount = matches.filter((m) => picks[m.id]).length;

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!allPicked) {
      showAlert('Incomplete', 'Please make a prediction for all 3 matches before submitting.', [{ text: 'OK' }]);
      return;
    }
    setSubmitting(true);

    const today = getTodayKey();
    const entry: DailyEntry = {
      date: today,
      picks: matches.map((m) => ({ matchId: m.id, prediction: picks[m.id] })),
      submitted: true,
      result: 'pending',
    };
    await saveEntry(entry);
    setSubmitted(true);
    setResult('pending');

    // Persist picks to DB for server-side settlement
    if (user?.id) {
      await persistChallengePicks(
        user.id,
        matches.map((m) => ({
          matchId: m.id,
          matchLabel: `${m.homeTeam} vs ${m.awayTeam}`,
          sport: m.sport,
          prediction: picks[m.id],
        })),
      );

      // Also save to leaderboard
      const username = user.username || user.email?.split('@')[0] || 'Anonymous';
      await saveResultToLeaderboard({ userId: user.id, username, correctCount: 0, isPerfect: false });
    }

    // Try immediate settlement for already-finished matches
    const immediateSettlement = await settleChallengeResults(user?.id ?? '', today);
    setSettledCount(immediateSettlement.settledCount);
    const newCorrectness: Record<string, boolean | null> = {};
    immediateSettlement.details.forEach((d) => {
      newCorrectness[d.matchId] = d.actual !== null ? d.correct : null;
    });
    setCorrectness(newCorrectness);

    if (immediateSettlement.settled && immediateSettlement.result !== 'pending') {
      setResult(immediateSettlement.result);
      setCorrectCount(immediateSettlement.correctCount);
      const resolved: DailyEntry = { ...entry, result: immediateSettlement.result, correctCount: immediateSettlement.correctCount, settledCount: immediateSettlement.settledCount };
      await saveEntry(resolved);
      setStats(await loadChallengeStats());

      if (user?.id && (immediateSettlement.result === 'win' || immediateSettlement.result === 'partial')) {
        const { awarded, newBalance } = await awardChallengeCoins(user.id, immediateSettlement.result);
        if (awarded > 0) {
          setCoinBalance(newBalance);
          showCoinToast(awarded, immediateSettlement.result === 'win' ? '🏆 Perfect! ' : '');
        }
        if (immediateSettlement.result === 'win') {
          const streak = await getConsecutiveWinCount();
          setStreakCount(streak);
          const { awarded: wkAwarded, newBalance: wkBalance } = await checkAndAwardPerfectWeekBonus(user.id);
          if (wkAwarded) { setCoinBalance(wkBalance); showPerfectWeekToast(); }
        }
        if (user?.id) await saveResultToLeaderboard({ userId: user.id, username: user.username || user.email?.split('@')[0] || 'Anonymous', correctCount: immediateSettlement.correctCount, isPerfect: immediateSettlement.result === 'win' });
      }
    } else {
      showAlert('Locked In! 🎯', 'Your predictions are locked. Results will update automatically as matches finish.', [{ text: 'Got it' }]);
    }

    setSubmitting(false);
  };

  const handleShare = useCallback(async () => {
    const wk = getWeekKey(); const [yr, weekNum] = wk.split('-W');
    const message = [
      '🏆 PredictXta Daily Challenge',
      `━━━━━━━━━━━━━━━━`,
      `📆 Week ${weekNum}, ${yr}`,
      `⭐ Perfect Days: ${stats.perfectDays}`,
      `📈 Win Rate: ${stats.perfectRate}%`,
      `📅 Days Played: ${stats.totalDays}`,
      userRank != null ? `🏅 Weekly Rank: #${userRank}` : '',
      `━━━━━━━━━━━━━━━━`,
      stats.currentStreak >= 3 ? `🔥 ${stats.currentStreak}-day streak! Can you beat me?` : 'Join the Daily Challenge on PredictXta! 🚀',
    ].filter(Boolean).join('\n');
    try { await Share.share({ message, title: 'My PredictXta Challenge Stats' }); } catch { /* dismissed */ }
  }, [stats, userRank]);

  // Live matches count for polling indicator
  const liveMatchCount = useMemo(() =>
    matches.filter((m) => liveSnapshots[m.id]?.status === 'live').length,
    [matches, liveSnapshots]
  );

  return (
    <View style={s.root}>
      {/* Score Change Banner */}
      {scoreBanner ? (
        <Animated.View
          style={[
            s.scoreBanner,
            {
              opacity: bannerAnim,
              transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }],
            },
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['#0D2010', '#0A1A0C']}
            style={s.scoreBannerInner}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          >
            <View style={s.scoreBannerGoalBubble}>
              <Text style={{ fontSize: 20 }}>⚽</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.scoreBannerTitle} numberOfLines={1}>
                {scoreBanner.playerName}
                <Text style={s.scoreBannerMin}>  {scoreBanner.minute}'</Text>
              </Text>
              <Text style={s.scoreBannerTeams} numberOfLines={1}>
                {scoreBanner.homeTeam} <Text style={s.scoreBannerScore}>{scoreBanner.homeScore} - {scoreBanner.awayScore}</Text> {scoreBanner.awayTeam}
              </Text>
            </View>
            <View style={[s.scoreBannerPill, { backgroundColor: scoreBanner.isHome ? '#38BDF820' : '#A78BFA20', borderColor: scoreBanner.isHome ? '#38BDF844' : '#A78BFA44' }]}>
              <Text style={[s.scoreBannerPillText, { color: scoreBanner.isHome ? '#38BDF8' : '#A78BFA' }]}>GOAL</Text>
            </View>
          </LinearGradient>
        </Animated.View>
      ) : null}

      {/* Coin Toast */}
      {coinToast.visible ? (
        <Animated.View
          style={[s.coinToast, { opacity: coinToastAnim, transform: [{ translateY: coinToastAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
          pointerEvents="none"
        >
          <FontAwesome5 name="coins" size={15} color={COLORS.primary} solid />
          <Text style={s.coinToastText}>{coinToast.label}🪙 +{coinToast.amount} Coins!</Text>
        </Animated.View>
      ) : null}

      {/* Perfect Week Toast */}
      {perfectWeekVisible ? (
        <Animated.View
          style={[s.perfectWeekToast, { opacity: perfectWeekAnim, transform: [{ scale: perfectWeekAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] }]}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 22 }}>🔥</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.pwTitle}>Perfect Week!</Text>
            <Text style={s.pwSub}>+{COIN_AWARDS.perfectWeek} Bonus Coins</Text>
          </View>
          <FontAwesome5 name="coins" size={15} color={COLORS.primary} solid />
        </Animated.View>
      ) : null}

      <SafeAreaView edges={['top']} style={{ backgroundColor: COLORS.surface }}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Daily Challenge</Text>
            <Text style={s.headerSub}>{getTodayKey().replace(/-/g, '/')} · 3 Picks</Text>
          </View>
          <View style={s.headerRight}>
            <Pressable onPress={handleShare} style={s.shareBtn} hitSlop={8}>
              <Ionicons name="share-social-outline" size={18} color={COLORS.primary} />
            </Pressable>
            {coinBalance !== null ? (
              <View style={s.coinChip}>
                <FontAwesome5 name="coins" size={10} color={COLORS.primary} solid />
                <Text style={s.coinChipText}>{coinBalance.toLocaleString()}</Text>
              </View>
            ) : null}
            <View style={[s.progressPill, allPicked ? s.progressPillDone : null]}>
              <Text style={[s.progressText, allPicked ? s.progressTextDone : null]}>{pickedCount}/3</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={s.loaderText}>Loading today's challenge...</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        >
          {/* Hero */}
          <LinearGradient colors={['#1A1000', '#070B14']} style={s.hero}>
            <View style={s.heroBadge}>
              <FontAwesome5 name="bolt" size={13} color={COLORS.textInverse} solid />
              <Text style={s.heroBadgeText}>DAILY CHALLENGE</Text>
            </View>
            <Text style={s.heroTitle}>Predict Today's Matches</Text>
            <Text style={s.heroSub}>
              3 matches across multiple sports, selected by AI difficulty. All 3 correct = Perfect Day!
            </Text>
            <CountdownTimer />
            {/* Sport coverage chips */}
            {matches.length > 0 ? (
              <View style={s.sportChips}>
                {[...new Set(matches.map((m) => m.sport))].map((sp) => {
                  const cfg = getSportChallengeConfig(sp);
                  return (
                    <View key={sp} style={s.sportChip}>
                      <Text style={s.sportChipText}>{cfg.emoji} {sp.charAt(0).toUpperCase() + sp.slice(1)}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </LinearGradient>

          {/* Settlement / Result Banner */}
          {submitted ? (
            <View style={s.section}>
              <SettlementBanner result={result} correctCount={correctCount} settledCount={settledCount} />
              {result === 'win' && streakCount > 0 ? <StreakBar count={streakCount} /> : null}
              {result === 'pending' && submitted ? (
                <View style={[s.autoPollNote, { marginTop: 10 }]}>
                  <View style={s.autoPollDot} />
                  <Text style={s.autoPollText}>Auto-checking for results every 30 seconds...</Text>
                  {liveMatchCount > 0 ? (
                    <View style={s.liveMatchBadge}>
                      <View style={s.liveMatchDot} />
                      <Text style={s.liveMatchBadgeText}>{liveMatchCount} LIVE</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Pick Cards */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <FontAwesome5 name="calendar-check" size={13} color={COLORS.textMuted} />
              <Text style={s.sectionTitle}>Today's Matches</Text>
              {submitted ? (
                <View style={s.lockedChip}>
                  <Ionicons name="lock-closed" size={10} color={COLORS.textMuted} />
                  <Text style={s.lockedText}>LOCKED</Text>
                </View>
              ) : null}
            </View>
            <View style={s.cardsGap}>
              {matches.map((match, idx) => (
                <MatchPickCard
                  key={match.id}
                  match={match}
                  pick={picks[match.id] ?? null}
                  submitted={submitted}
                  correctness={submitted ? (correctness[match.id] ?? null) : undefined}
                  onPick={handlePick}
                  index={idx}
                />
              ))}
            </View>
          </View>

          {/* Submit / Return CTA */}
          {!submitted ? (
            <View style={s.section}>
              <View style={s.progressBarWrap}>
                <Text style={s.progressBarLabel}>
                  {pickedCount === 3 ? 'All picks made — ready to submit!' : `${3 - pickedCount} more pick${3 - pickedCount !== 1 ? 's' : ''} needed`}
                </Text>
                <View style={s.progressBarTrack}>
                  <View style={[s.progressBarFill, { width: `${(pickedCount / 3) * 100}%` as any }]} />
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  s.submitBtn,
                  !allPicked ? s.submitBtnOff : null,
                  pressed && allPicked ? { opacity: 0.88, transform: [{ scale: 0.98 }] } : null,
                  submitting ? { opacity: 0.6 } : null,
                ]}
                onPress={handleSubmit}
                disabled={!allPicked || submitting}
              >
                <LinearGradient
                  colors={allPicked ? [COLORS.primary, COLORS.primaryDark ?? '#CC9900'] : [COLORS.border, COLORS.border]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={s.submitBtnGradient}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color={COLORS.textInverse} />
                    : <FontAwesome5 name="paper-plane" size={14} color={allPicked ? COLORS.textInverse : COLORS.textMuted} solid />}
                  <Text style={[s.submitBtnText, !allPicked ? { color: COLORS.textMuted } : null]}>
                    {submitting ? 'Submitting...' : 'Submit Predictions'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={s.section}>
              <Pressable style={({ pressed }) => [s.backHomeBtn, pressed ? { opacity: 0.8 } : null]} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={15} color={COLORS.textSecondary} />
                <Text style={s.backHomeBtnText}>Back to Profile</Text>
              </Pressable>
            </View>
          )}

          {/* Stats */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <FontAwesome5 name="chart-line" size={13} color={COLORS.textMuted} />
              <Text style={s.sectionTitle}>Challenge Stats</Text>
            </View>
            <StatsCard stats={stats} />
          </View>

          {/* Weekly Leaderboard */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <FontAwesome5 name="trophy" size={13} color={COLORS.primary} />
              <Text style={s.sectionTitle}>Weekly Leaderboard</Text>
              {userRank != null ? (
                <View style={[s.rankChip, { backgroundColor: COLORS.primaryGlow, borderColor: 'rgba(255,215,0,0.3)' }]}>
                  <Text style={[s.rankChipText, { color: COLORS.primary }]}>You: #{userRank}</Text>
                </View>
              ) : null}
            </View>
            <View style={[s.lbCard, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}>
              <View style={[s.lbHeader, { backgroundColor: COLORS.surface, borderBottomColor: COLORS.border }]}>
                <FontAwesome5 name="trophy" size={12} color={COLORS.primary} solid />
                <Text style={s.lbHeaderTitle}>WEEKLY LEADERBOARD</Text>
                <View style={[s.weekChip, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}>
                  <Ionicons name="calendar-outline" size={10} color={COLORS.textMuted} />
                  <Text style={s.weekChipText}>{getWeekKey().replace('-', ' ')}</Text>
                </View>
              </View>
              {leaderboard.length === 0 ? (
                <View style={s.lbEmpty}>
                  <FontAwesome5 name="users" size={24} color={COLORS.border} />
                  <Text style={s.lbEmptyTitle}>No entries this week yet</Text>
                  <Text style={s.lbEmptySub}>Submit today's challenge to appear!</Text>
                </View>
              ) : (
                leaderboard.slice(0, 10).map((entry, idx) => (
                  <LeaderboardRow key={entry.userId} entry={entry} rank={idx} currentUserId={user?.id} />
                ))
              )}
              <View style={[s.lbFooter, { backgroundColor: COLORS.surface, borderTopColor: COLORS.border }]}>
                <Ionicons name="information-circle-outline" size={11} color={COLORS.textMuted} />
                <Text style={s.lbFooterText}>Ranked by Perfect Days · Resets Monday</Text>
              </View>
            </View>
          </View>

          {/* How it works */}
          <View style={s.section}>
            <View style={s.howCard}>
              <Text style={s.howTitle}>How It Works</Text>
              {[
                { n: 1, title: 'Pick a result for each match', desc: 'Choose Home Win (1), Draw (X), or Away Win (2). Draw unavailable for tennis, basketball, MMA and other no-draw sports.' },
                { n: 2, title: 'Submit before kickoff', desc: 'Lock in your picks. Once submitted they are final. Results auto-settle when matches finish.' },
                { n: 3, title: 'Earn coins when you win', desc: `Perfect 3/3 = +${COIN_AWARDS.perfect} 🪙 coins. Partial 1-2/3 = +${COIN_AWARDS.partial} 🪙 coins.` },
                { n: 4, title: 'Build a Perfect Week streak', desc: `7 consecutive perfect days earns +${COIN_AWARDS.perfectWeek} bonus coins and leaderboard glory!` },
              ].map((step) => (
                <View key={step.n} style={s.howRow}>
                  <View style={s.howNum}><Text style={s.howNumText}>{step.n}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.howStep}>{step.title}</Text>
                    <Text style={s.howDesc}>{step.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: FONTS.bold as any, color: COLORS.textPrimary },
  headerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  shareBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primaryGlow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)' },
  progressPill: { backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.border },
  progressPillDone: { backgroundColor: COLORS.primaryGlow, borderColor: COLORS.primary },
  progressText: { fontSize: 12, fontWeight: FONTS.extraBold as any, color: COLORS.textSecondary },
  progressTextDone: { color: COLORS.primary },
  coinChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)' },
  coinChipText: { fontSize: 11, fontWeight: FONTS.extraBold as any, color: COLORS.primary },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { fontSize: 14, color: COLORS.textMuted },
  scroll: { paddingBottom: 20 },
  hero: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.lg, alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 5 },
  heroBadgeText: { fontSize: 11, fontWeight: FONTS.extraBold as any, color: COLORS.textInverse, letterSpacing: 1.5 },
  heroTitle: { fontSize: 22, fontWeight: FONTS.extraBold as any, color: COLORS.textPrimary, textAlign: 'center', marginTop: 4 },
  heroSub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  sportChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 },
  sportChip: { backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.border },
  sportChipText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: FONTS.medium as any },
  section: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: FONTS.bold as any, color: COLORS.textPrimary, flex: 1 },
  lockedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.border },
  lockedText: { fontSize: 9, fontWeight: FONTS.bold as any, color: COLORS.textMuted, letterSpacing: 0.8 },
  cardsGap: { gap: 12 },
  autoPollNote: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 },
  autoPollDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accentBlue },
  autoPollText: { fontSize: 11, color: COLORS.textMuted, flex: 1 },
  liveMatchBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF444414', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#EF444433', paddingHorizontal: 8, paddingVertical: 3 },
  liveMatchDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#EF4444' },
  liveMatchBadgeText: { fontSize: 8, fontWeight: FONTS.extraBold as any, color: '#EF4444', letterSpacing: 0.6 },
  // Score banner
  scoreBanner: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 80, left: 16, right: 16, zIndex: 9998, borderRadius: RADIUS.xl, overflow: 'hidden', shadowColor: '#22C55E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 16 },
  scoreBannerInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: '#22C55E44', borderRadius: RADIUS.xl },
  scoreBannerGoalBubble: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#22C55E18', borderWidth: 1, borderColor: '#22C55E44', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scoreBannerTitle: { fontSize: 14, fontWeight: FONTS.bold as any, color: '#fff' },
  scoreBannerMin: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: FONTS.regular as any },
  scoreBannerTeams: { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  scoreBannerScore: { fontWeight: FONTS.extraBold as any, color: '#22C55E' },
  scoreBannerPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  scoreBannerPillText: { fontSize: 9, fontWeight: FONTS.extraBold as any, letterSpacing: 0.8 },
  progressBarWrap: { gap: 6, marginBottom: 12 },
  progressBarLabel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: FONTS.medium as any, textAlign: 'center' },
  progressBarTrack: { height: 5, backgroundColor: COLORS.border, borderRadius: RADIUS.full, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  submitBtn: { borderRadius: RADIUS.full, overflow: 'hidden' },
  submitBtnOff: { opacity: 0.6 },
  submitBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 10 },
  submitBtnText: { fontSize: 16, fontWeight: FONTS.extraBold as any, color: COLORS.textInverse },
  backHomeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.border },
  backHomeBtnText: { fontSize: 14, fontWeight: FONTS.semiBold as any, color: COLORS.textSecondary },
  rankChip: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  rankChipText: { fontSize: 10, fontWeight: FONTS.bold as any },
  lbCard: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  lbHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
  lbHeaderTitle: { fontSize: 11, fontWeight: FONTS.extraBold as any, color: COLORS.primary, letterSpacing: 1, flex: 1 },
  weekChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  weekChipText: { fontSize: 10, color: COLORS.textMuted },
  lbEmpty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  lbEmptyTitle: { fontSize: 14, fontWeight: FONTS.bold as any, color: COLORS.textSecondary },
  lbEmptySub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  lbFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1 },
  lbFooterText: { fontSize: 11, color: COLORS.textMuted },
  howCard: { backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 14 },
  howTitle: { fontSize: 14, fontWeight: FONTS.bold as any, color: COLORS.textSecondary, marginBottom: 2 },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  howNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primaryGlow, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  howNumText: { fontSize: 12, fontWeight: FONTS.extraBold as any, color: COLORS.primary },
  howStep: { fontSize: 13, fontWeight: FONTS.bold as any, color: COLORS.textPrimary, marginBottom: 2 },
  howDesc: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17 },
  // Toasts
  coinToast: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)', zIndex: 9999, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 12 },
  coinToastText: { fontSize: 14, fontWeight: FONTS.extraBold as any, color: COLORS.primary },
  perfectWeekToast: { position: 'absolute', bottom: 110, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1A0800', borderRadius: RADIUS.xl, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1.5, borderColor: '#FF6B35', zIndex: 9999, shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 14, minWidth: 240 },
  pwTitle: { fontSize: 15, fontWeight: FONTS.extraBold as any, color: '#FF6B35' },
  pwSub: { fontSize: 11, color: COLORS.primary, fontWeight: FONTS.bold as any, marginTop: 1 },
});
