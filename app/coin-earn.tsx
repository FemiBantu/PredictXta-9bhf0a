/**
 * Coin Earn Screen — app/coin-earn.tsx
 *
 * Shows all ways to earn coins with animated coin-drop on claim,
 * daily bonus countdown timer, and current balance at top.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Easing, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

// ─── Earn Path Config ──────────────────────────────────────────────────────────
interface EarnPath {
  id: string;
  icon: string;
  emoji: string;
  title: string;
  description: string;
  coins: number;
  action: string;
  route?: string;
  canClaimNow?: boolean;
  cooldownKey?: string;
  colorPrimary: string;
  colorSecondary: string;
}

const EARN_PATHS: EarnPath[] = [
  {
    id: 'daily_challenge',
    icon: 'flash',
    emoji: '⚡',
    title: 'Daily Challenge',
    description: 'Pick 3 winners correctly and earn coins. Perfect score resets your streak.',
    coins: 5,
    action: 'Play Now',
    route: '/challenge',
    cooldownKey: 'daily',
    colorPrimary: '#F59E0B',
    colorSecondary: '#FCD34D',
  },
  {
    id: 'refer_friend',
    icon: 'people',
    emoji: '🤝',
    title: 'Refer a Friend',
    description: 'Invite a friend to join PredictXta. Earn coins when they complete registration.',
    coins: 10,
    action: 'Invite Friends',
    route: '/referral',
    colorPrimary: '#22C55E',
    colorSecondary: '#86EFAC',
  },
  {
    id: 'watch_highlight',
    icon: 'play-circle',
    emoji: '🎬',
    title: 'Watch Highlights',
    description: 'Watch a match highlight video and earn a coin per view. Up to 5 per day.',
    coins: 1,
    action: 'Watch Now',
    route: '/(tabs)/live',
    cooldownKey: 'highlight',
    colorPrimary: '#38BDF8',
    colorSecondary: '#7DD3FC',
  },
  {
    id: 'share_tip',
    icon: 'share-social',
    emoji: '📤',
    title: 'Share a Tip',
    description: 'Share a prediction tip from the AI Picks page. Earn 2 coins per share, up to 3 per day.',
    coins: 2,
    action: 'Share a Tip',
    route: '/(tabs)/predictions',
    cooldownKey: 'share_tip',
    colorPrimary: '#A78BFA',
    colorSecondary: '#C4B5FD',
  },
];

// ─── Coin Drop Animation ───────────────────────────────────────────────────────
interface CoinParticle {
  id: string;
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  rotation: Animated.Value;
  coins: number;
  startX: number;
}

function useCoinDrop() {
  const [particles, setParticles] = useState<CoinParticle[]>([]);

  const triggerDrop = useCallback((coins: number, originX = 180) => {
    const count = Math.min(coins, 8);
    const newParticles: CoinParticle[] = Array.from({ length: count }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0.4),
      rotation: new Animated.Value(0),
      coins,
      startX: originX + (Math.random() - 0.5) * 80,
    }));

    setParticles((prev) => [...prev, ...newParticles]);

    newParticles.forEach((p, i) => {
      const delay = i * 60;
      const targetX = (Math.random() - 0.5) * 120;
      const targetY = -(80 + Math.random() * 60);

      Animated.parallel([
        Animated.timing(p.scale, {
          toValue: 1,
          duration: 200,
          delay,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(p.y, {
            toValue: targetY,
            duration: 400,
            delay,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(p.y, {
            toValue: targetY + 30,
            duration: 200,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(p.x, {
          toValue: targetX,
          duration: 600,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(delay + 400),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(p.rotation, {
          toValue: (Math.random() > 0.5 ? 1 : -1) * 2,
          duration: 600,
          delay,
          useNativeDriver: true,
        }),
      ]).start();
    });

    setTimeout(() => {
      setParticles((prev) =>
        prev.filter((p) => !newParticles.some((np) => np.id === p.id))
      );
    }, 1200);
  }, []);

  return { particles, triggerDrop };
}

function CoinDropOverlay({ particles }: { particles: CoinParticle[] }) {
  if (particles.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {particles.map((p) => {
        const rotate = p.rotation.interpolate({
          inputRange: [-2, 2],
          outputRange: ['-720deg', '720deg'],
        });
        return (
          <Animated.Text
            key={p.id}
            style={{
              position: 'absolute',
              left: p.startX,
              top: '50%',
              fontSize: 22,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { scale: p.scale },
                { rotate },
              ],
              opacity: p.opacity,
            }}
          >
            🪙
          </Animated.Text>
        );
      })}
    </View>
  );
}

// ─── Balance Header ────────────────────────────────────────────────────────────
function BalanceHeader({
  balance,
  loading,
  C,
}: { balance: number | null; loading: boolean; C: AppColors }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(shimmer, { toValue: 0, duration: 700, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [loading]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });

  return (
    <LinearGradient
      colors={['#2A1F00', '#1A1400', '#0F0A00']}
      style={bh.wrap}
    >
      <View style={bh.inner}>
        <View style={bh.iconCircle}>
          <FontAwesome5 name="coins" size={22} color="#FFD700" solid />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={bh.label}>Your Coin Balance</Text>
          {loading ? (
            <Animated.View style={[bh.shimmerBar, { opacity }]} />
          ) : (
            <Text style={bh.amount}>
              {(balance ?? 0).toLocaleString()}
            </Text>
          )}
        </View>
        <View style={bh.badge}>
          <Text style={bh.badgeText}>COINS</Text>
        </View>
      </View>
      <View style={bh.divider} />
      <Text style={bh.sub}>
        Earn coins to unlock AI analysis, VIP reports, and exclusive predictions.
      </Text>
    </LinearGradient>
  );
}

const bh = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
    padding: 18,
    gap: 10,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: FONTS.bold, color: 'rgba(255,215,0,0.55)', letterSpacing: 0.8 },
  amount: { fontSize: 32, fontWeight: FONTS.extraBold, color: '#FFD700', lineHeight: 38 },
  shimmerBar: { height: 28, borderRadius: 6, backgroundColor: 'rgba(255,215,0,0.2)', width: 100, marginTop: 4 },
  badge: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#FFD700', letterSpacing: 1.2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,215,0,0.12)' },
  sub: { fontSize: 11, color: 'rgba(255,215,0,0.45)', lineHeight: 16 },
});

// ─── Daily Countdown Timer ─────────────────────────────────────────────────────
function DailyCountdown({ C }: { C: AppColors }) {
  const [remaining, setRemaining] = useState<string>('');

  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      const diff = next.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      );
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={[dc.wrap, { backgroundColor: C.surface, borderColor: C.border }]}>
      <Ionicons name="time-outline" size={13} color={C.textMuted} />
      <Text style={[dc.label, { color: C.textMuted }]}>Daily reset in</Text>
      <Text style={[dc.timer, { color: C.primary }]}>{remaining}</Text>
    </View>
  );
}

const dc = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignSelf: 'center',
  },
  label: { fontSize: 11, fontWeight: FONTS.medium },
  timer: { fontSize: 14, fontWeight: FONTS.extraBold, letterSpacing: 1.5 },
});

// ─── Earn Card ─────────────────────────────────────────────────────────────────
interface EarnCardProps {
  path: EarnPath;
  claimed: boolean;
  claimCount: number;
  maxClaims: number;
  claiming: boolean;
  onPress: (path: EarnPath, ref: React.RefObject<View | null>) => void;
  C: AppColors;
}

function EarnCard({
  path,
  claimed,
  claimCount,
  maxClaims,
  claiming,
  onPress,
  C,
}: EarnCardProps) {
  const cardRef = useRef<View>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressWidth = maxClaims > 0 ? Math.min(1, claimCount / maxClaims) : 0;

  // Pulse effect when available
  useEffect(() => {
    if (!claimed && !claiming) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.02, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
    pulseAnim.setValue(1);
  }, [claimed, claiming]);

  const isExhausted = maxClaims > 1 && claimCount >= maxClaims;
  const isDisabled = isExhausted || claiming;
  const buttonLabel = claiming
    ? 'Claiming...'
    : isExhausted
    ? 'Limit Reached'
    : path.action;
  const buttonColor = isDisabled ? C.textMuted : path.colorPrimary;

  return (
    <Animated.View
      ref={cardRef as any}
      style={{ transform: [{ scale: isDisabled ? 1 : pulseAnim }] }}
    >
      <View
        style={[
          ec.card,
          {
            backgroundColor: C.card,
            borderColor: isDisabled
              ? C.border
              : `${path.colorPrimary}44`,
            opacity: isDisabled ? 0.6 : 1,
          },
        ]}
      >
        {/* Header */}
        <View style={ec.header}>
          <View
            style={[
              ec.iconWrap,
              {
                backgroundColor: `${path.colorPrimary}18`,
                borderColor: `${path.colorPrimary}33`,
              },
            ]}
          >
            <Text style={{ fontSize: 22 }}>{path.emoji}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[ec.title, { color: C.textPrimary }]}>{path.title}</Text>
            <Text style={[ec.desc, { color: C.textMuted }]} numberOfLines={2}>
              {path.description}
            </Text>
          </View>
          {/* Coin reward badge */}
          <View
            style={[
              ec.coinBadge,
              {
                backgroundColor: `${path.colorPrimary}14`,
                borderColor: `${path.colorPrimary}44`,
              },
            ]}
          >
            <Text style={{ fontSize: 14 }}>🪙</Text>
            <Text style={[ec.coinAmount, { color: path.colorPrimary }]}>
              +{path.coins}
            </Text>
          </View>
        </View>

        {/* Progress bar for multi-claim paths */}
        {maxClaims > 1 ? (
          <View style={ec.progressSection}>
            <View style={[ec.progressTrack, { backgroundColor: C.border }]}>
              <View
                style={[
                  ec.progressFill,
                  {
                    width: `${progressWidth * 100}%`,
                    backgroundColor: path.colorPrimary,
                  },
                ]}
              />
            </View>
            <Text style={[ec.progressLabel, { color: C.textMuted }]}>
              {claimCount} / {maxClaims} today
            </Text>
          </View>
        ) : null}

        {/* Action button */}
        <Pressable
          ref={cardRef as any}
          style={({ pressed }) => [
            ec.btn,
            {
              backgroundColor: isDisabled
                ? C.surface
                : `${path.colorPrimary}18`,
              borderColor: isDisabled ? C.border : `${path.colorPrimary}55`,
            },
            pressed && !isDisabled
              ? { opacity: 0.82, transform: [{ scale: 0.97 }] }
              : null,
          ]}
          onPress={() => !isDisabled && onPress(path, cardRef)}
          disabled={isDisabled}
          hitSlop={4}
        >
          {claiming ? (
            <ActivityIndicator size={14} color={buttonColor} />
          ) : isExhausted ? (
            <Ionicons name="checkmark-circle" size={14} color={C.textMuted} />
          ) : (
            <Ionicons name={path.icon as any} size={14} color={buttonColor} />
          )}
          <Text
            style={[
              ec.btnText,
              { color: buttonColor, fontWeight: isDisabled ? FONTS.medium : FONTS.bold },
            ]}
          >
            {buttonLabel}
          </Text>
          {!isDisabled ? (
            <Ionicons
              name="arrow-forward"
              size={12}
              color={path.colorPrimary}
              style={{ marginLeft: 'auto' }}
            />
          ) : null}
        </Pressable>
      </View>
    </Animated.View>
  );
}

const ec = StyleSheet.create({
  card: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: FONTS.bold },
  desc: { fontSize: 12, lineHeight: 17 },
  coinBadge: {
    alignItems: 'center',
    gap: 2,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 52,
    flexShrink: 0,
  },
  coinAmount: { fontSize: 15, fontWeight: FONTS.extraBold },
  progressSection: { gap: 5 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { fontSize: 10, fontWeight: FONTS.semiBold, textAlign: 'right' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
  },
  btnText: { fontSize: 14 },
});

// ─── Claim Toast ───────────────────────────────────────────────────────────────
function ClaimToast({ message, visible, C }: { message: string; visible: boolean; C: AppColors }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        opacity,
        transform: [{ translateY }],
        zIndex: 999,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#22C55E',
          borderRadius: RADIUS.full,
          paddingHorizontal: 20,
          paddingVertical: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Text style={{ fontSize: 16 }}>🪙</Text>
        <Text style={{ fontSize: 14, fontWeight: FONTS.bold, color: '#fff' }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── How Coins Work section ────────────────────────────────────────────────────
function HowCoinsWork({ C }: { C: AppColors }) {
  return (
    <View style={[hcw.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={hcw.titleRow}>
        <Ionicons name="information-circle-outline" size={15} color={C.accentBlue} />
        <Text style={[hcw.title, { color: C.textPrimary }]}>How to Use Coins</Text>
      </View>
      {[
        { icon: '🔓', label: 'Unlock AI Analysis', sub: '5 coins per match prediction report' },
        { icon: '⭐', label: 'VIP Tip Access', sub: 'Premium picks from expert analysts' },
        { icon: '🏆', label: 'Leaderboard Boosts', sub: 'Coming soon — spend coins for bonus rank' },
      ].map((item) => (
        <View key={item.label} style={[hcw.row, { borderColor: C.border }]}>
          <Text style={{ fontSize: 18 }}>{item.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[hcw.rowTitle, { color: C.textPrimary }]}>{item.label}</Text>
            <Text style={[hcw.rowSub, { color: C.textMuted }]}>{item.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const hcw = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 },
  title: { fontSize: 13, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 13, fontWeight: FONTS.semiBold },
  rowSub: { fontSize: 11, marginTop: 1 },
});

// ─── Claim state helpers ───────────────────────────────────────────────────────
interface ClaimState {
  claimed: boolean;
  count: number;
}

const MAX_CLAIMS: Record<string, number> = {
  daily_challenge: 1,
  refer_friend: 99, // unlimited referrals
  watch_highlight: 5,
  share_tip: 3,
};

async function loadTodayClaimCounts(userId: string): Promise<Record<string, number>> {
  try {
    const supabase = getSupabaseClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from('coin_claims')
      .select('claim_type')
      .eq('user_id', userId)
      .gte('claimed_at', todayStart.toISOString());

    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      counts[row.claim_type] = (counts[row.claim_type] ?? 0) + 1;
    });
    return counts;
  } catch {
    return {};
  }
}

async function awardCoins(
  userId: string,
  pathId: string,
  coins: number
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();

    // Award coins via RPC
    const { error: coinErr } = await supabase.rpc('add_user_coins', {
      p_user_id: userId,
      p_amount: coins,
    });
    if (coinErr) return false;

    // Record claim
    await supabase.from('coin_claims').insert({
      user_id: userId,
      claim_type: pathId,
      coins_awarded: coins,
    });

    return true;
  } catch {
    return false;
  }
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CoinEarnScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { colors: C } = useTheme();

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [claimCounts, setClaimCounts] = useState<Record<string, number>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { particles, triggerDrop } = useCoinDrop();

  // Load balance + claim counts
  const loadData = useCallback(async () => {
    if (!user?.id) { setBalanceLoading(false); return; }
    try {
      const supabase = getSupabaseClient();
      const [{ data: coinData }, counts] = await Promise.all([
        supabase
          .from('user_coins')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle(),
        loadTodayClaimCounts(user.id),
      ]);
      setBalance(coinData?.balance ?? 0);
      setClaimCounts(counts);
    } catch {
      setBalance(0);
    } finally {
      setBalanceLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 2500);
  }, []);

  const handleEarnPress = useCallback(
    async (path: EarnPath, ref: React.RefObject<View | null>) => {
      if (!user?.id) {
        showAlert('Sign In Required', 'Please sign in to earn coins.');
        router.push('/login' as any);
        return;
      }

      const currentCount = claimCounts[path.id] ?? 0;
      const max = MAX_CLAIMS[path.id] ?? 1;

      if (currentCount >= max) return;

      // For paths that navigate (referral, challenge), just navigate
      if (path.id === 'refer_friend') {
        router.push('/referral' as any);
        return;
      }

      if (path.id === 'daily_challenge') {
        router.push('/challenge' as any);
        return;
      }

      // For watch + share: award coins immediately (simulated action)
      setClaimingId(path.id);
      try {
        const ok = await awardCoins(user.id, path.id, path.coins);
        if (!ok) {
          showAlert('Error', 'Could not award coins. Please try again.');
          return;
        }

        // Update local state
        setBalance((prev) => (prev ?? 0) + path.coins);
        setClaimCounts((prev) => ({
          ...prev,
          [path.id]: (prev[path.id] ?? 0) + 1,
        }));

        // Trigger coin drop animation
        triggerDrop(path.coins, 180);

        // Show toast
        showToast(`+${path.coins} coin${path.coins > 1 ? 's' : ''} earned!`);

        // Navigate after short delay
        if (path.route) {
          setTimeout(() => router.push(path.route as any), 600);
        }
      } finally {
        setClaimingId(null);
      }
    },
    [user?.id, claimCounts, showAlert, router, triggerDrop, showToast]
  );

  const totalPossibleToday =
    EARN_PATHS.reduce((sum, p) => sum + p.coins * (MAX_CLAIMS[p.id] ?? 1), 0);

  const totalEarnedToday = EARN_PATHS.reduce((sum, p) => {
    const claimed = Math.min(claimCounts[p.id] ?? 0, MAX_CLAIMS[p.id] ?? 1);
    return sum + claimed * p.coins;
  }, 0);

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>Earn Coins</Text>
          <Pressable
            style={[s.historyBtn, { backgroundColor: C.surface, borderColor: C.border }]}
            onPress={() => router.push('/coin-history' as any)}
            hitSlop={8}
          >
            <Ionicons name="receipt-outline" size={16} color={C.textMuted} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: SPACING.md, gap: 14, paddingBottom: 60 }}
      >
        {/* Balance header */}
        <BalanceHeader balance={balance} loading={balanceLoading} C={C} />

        {/* Today's progress */}
        <View style={[s.todayCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="sunny-outline" size={14} color={C.primary} />
              <Text style={[s.todayTitle, { color: C.textPrimary }]}>Today's Progress</Text>
            </View>
            <Text style={[s.todayCount, { color: C.primary }]}>
              {totalEarnedToday} / {totalPossibleToday} coins
            </Text>
          </View>
          <View style={[s.todayTrack, { backgroundColor: C.border }]}>
            <View
              style={[
                s.todayFill,
                {
                  width: `${totalPossibleToday > 0 ? (totalEarnedToday / totalPossibleToday) * 100 : 0}%`,
                  backgroundColor: C.primary,
                },
              ]}
            />
          </View>
          <DailyCountdown C={C} />
        </View>

        {/* Section header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <FontAwesome5 name="coins" size={12} color={C.primary} solid />
          <Text style={[s.sectionHeader, { color: C.textPrimary }]}>Ways to Earn</Text>
        </View>

        {/* Earn paths */}
        {EARN_PATHS.map((path) => (
          <EarnCard
            key={path.id}
            path={path}
            claimed={(claimCounts[path.id] ?? 0) >= (MAX_CLAIMS[path.id] ?? 1)}
            claimCount={claimCounts[path.id] ?? 0}
            maxClaims={MAX_CLAIMS[path.id] ?? 1}
            claiming={claimingId === path.id}
            onPress={handleEarnPress}
            C={C}
          />
        ))}

        {/* How to use coins */}
        <HowCoinsWork C={C} />

        {/* VIP upsell */}
        <Pressable
          style={({ pressed }) => [{ borderRadius: RADIUS.xl, overflow: 'hidden' }, pressed ? { opacity: 0.9 } : null]}
          onPress={() => router.push('/vip' as any)}
        >
          <LinearGradient
            colors={['#2A1F00', '#FFD700', '#2A1F00']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.vipBanner}
          >
            <FontAwesome5 name="crown" size={18} color="#070B14" solid />
            <View style={{ flex: 1 }}>
              <Text style={s.vipTitle}>Upgrade to VIP</Text>
              <Text style={s.vipSub}>Unlimited AI picks — no coins needed</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color="#070B14" />
          </LinearGradient>
        </Pressable>
      </ScrollView>

      {/* Coin drop overlay */}
      <CoinDropOverlay particles={particles} />

      {/* Claim toast */}
      <ClaimToast message={toastMessage} visible={toastVisible} C={C} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: FONTS.bold },
  historyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCard: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, gap: 10 },
  todayTitle: { fontSize: 13, fontWeight: FONTS.extraBold, letterSpacing: 0.4 },
  todayCount: { fontSize: 13, fontWeight: FONTS.extraBold },
  todayTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  todayFill: { height: '100%', borderRadius: 3 },
  sectionHeader: { fontSize: 13, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  vipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: RADIUS.xl,
  },
  vipTitle: { fontSize: 14, fontWeight: FONTS.bold, color: '#070B14' },
  vipSub: { fontSize: 11, color: 'rgba(7,11,20,0.65)', marginTop: 2 },
});
