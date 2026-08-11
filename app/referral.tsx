import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Share, Clipboard, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getSupabaseClient, useAuth, useAlert } from '@/template';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────
const REFERRAL_COIN_REWARD = 50;

// ─── VIP milestone tiers (max 6 months) ──────────────────────────────────────
// 5 refs  → 3-day trial
// 10 refs → 7-day trial
// 15 refs → 1 month
// 20 refs → 3 months
// 30 refs → 6 months  ← maximum cap
const VIP_MILESTONES = [
  { referrals: 5,  vipDays: 3   },
  { referrals: 10, vipDays: 7   },
  { referrals: 15, vipDays: 30  },
  { referrals: 20, vipDays: 90  },
  { referrals: 30, vipDays: 180 },
];

// ─── Derive referral code from user ID ───────────────────────────────────────
function deriveCode(userId: string): string {
  const clean = userId.replace(/-/g, '').toUpperCase().slice(0, 8);
  return `PX-${clean}`;
}

// ─── DB: Referral stats ───────────────────────────────────────────────────────
interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  completedReferrals: number;
  coinsEarned: number;
  vipDaysEarned: number; // total cumulative VIP days from unlocked milestones
  loading: boolean;
}

async function fetchReferralStats(userId: string): Promise<Omit<ReferralStats, 'loading'>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('referrals')
      .select('status, coins_awarded')
      .eq('referrer_id', userId);

    if (error || !data) {
      return { totalReferrals: 0, pendingReferrals: 0, completedReferrals: 0, coinsEarned: 0, vipDaysEarned: 0 };
    }

    const rows = data as { status: string; coins_awarded: number }[];
    const total = rows.length;
    const completed = rows.filter((r) => r.status === 'completed').length;
    const pending = total - completed;
    const coinsEarned = rows.reduce((sum, r) => sum + (r.coins_awarded ?? 0), 0);

    // Sum VIP days from all unlocked milestones (capped at 180 days = 6 months)
    const vipDaysEarned = VIP_MILESTONES
      .filter((m) => completed >= m.referrals)
      .reduce((s, m) => s + m.vipDays, 0);

    return { totalReferrals: total, pendingReferrals: pending, completedReferrals: completed, coinsEarned, vipDaysEarned };
  } catch {
    return { totalReferrals: 0, pendingReferrals: 0, completedReferrals: 0, coinsEarned: 0, vipDaysEarned: 0 };
  }
}

function useReferralStats(userId: string | undefined): ReferralStats & { refresh: () => void } {
  const [stats, setStats] = useState<ReferralStats>({
    totalReferrals: 0, pendingReferrals: 0, completedReferrals: 0,
    coinsEarned: 0, vipDaysEarned: 0, loading: true,
  });

  const load = useCallback(async () => {
    if (!userId) { setStats((s) => ({ ...s, loading: false })); return; }
    setStats((s) => ({ ...s, loading: true }));
    const result = await fetchReferralStats(userId);
    setStats({ ...result, loading: false });
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return { ...stats, refresh: load };
}

// ─── Rewards tier display data ────────────────────────────────────────────────
// Milestones: 5=3d · 10=7d · 15=1mo · 20=3mo · 30=6mo (MAX)
const REWARD_TIERS = [
  {
    referrals: 5,
    reward: '3-Day VIP Trial',
    detail: '3 days of free VIP — try all premium features',
    icon: 'crown',
    color: COLORS.accentBlue,
    vipDays: 3,
    durationLabel: '3 Days',
  },
  {
    referrals: 10,
    reward: '7-Day VIP Trial',
    detail: '7 days of full VIP — perfect for a big match week',
    icon: 'crown',
    color: COLORS.primary,
    vipDays: 7,
    durationLabel: '7 Days',
  },
  {
    referrals: 15,
    reward: '1 Month VIP',
    detail: 'Full VIP features for 30 days',
    icon: 'gem',
    color: COLORS.accentPurple,
    vipDays: 30,
    durationLabel: '1 Month',
  },
  {
    referrals: 20,
    reward: '3 Months VIP',
    detail: 'Quarterly VIP — 90 days of premium predictions',
    icon: 'star',
    color: COLORS.accent,
    vipDays: 90,
    durationLabel: '3 Months',
  },
  {
    referrals: 30,
    reward: '6 Months VIP',
    detail: 'Half-year of VIP access — our biggest reward ever!',
    icon: 'fire',
    color: COLORS.accentRed,
    vipDays: 180,
    durationLabel: '6 Months',
  },
];

// ─── Copy feedback ────────────────────────────────────────────────────────────
function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const triggerCopy = useCallback((text: string) => {
    Clipboard.setString(text);
    setCopied(true);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setCopied(false), 2000);
  }, [scale]);

  return { copied, scale, triggerCopy };
}

// ─── Shimmer pulse for code box ───────────────────────────────────────────────
function useShimmer() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
}

// ─── Milestone Toast ─────────────────────────────────────────────────────────
type RewardTier = typeof REWARD_TIERS[number];

function MilestoneToast({
  visible, anim, tier,
}: {
  visible: boolean;
  anim: Animated.Value;
  tier: RewardTier | null;
}) {
  if (!visible || !tier) return null;
  return (
    <Animated.View
      style={[
        mToastStyles.wrap,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.8, 1.06, 1] }) },
          ],
        },
      ]}
      pointerEvents="none"
    >
      {/* Glow ring */}
      <View style={[mToastStyles.glowRing, { borderColor: `${tier.color}60`, backgroundColor: `${tier.color}14` }]}>
        <FontAwesome5 name={tier.icon as any} size={22} color={tier.color} />
      </View>
      <View style={mToastStyles.content}>
        <View style={mToastStyles.headerRow}>
          <Text style={mToastStyles.headline}>🎉 Milestone Unlocked!</Text>
          <View style={[mToastStyles.refBadge, { backgroundColor: `${tier.color}20`, borderColor: `${tier.color}50` }]}>
            <Text style={[mToastStyles.refBadgeText, { color: tier.color }]}>{tier.referrals} refs</Text>
          </View>
        </View>
        <Text style={[mToastStyles.rewardName, { color: tier.color }]}>{tier.reward}</Text>
        <Text style={mToastStyles.duration}>
          {tier.durationLabel} of free VIP access
        </Text>
      </View>
    </Animated.View>
  );
}

const mToastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 136, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    paddingHorizontal: 16, paddingVertical: 13,
    borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.5)',
    zIndex: 9998,
    maxWidth: 340,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 14,
  },
  glowRing: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  content: { flex: 1, gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headline: {
    fontSize: 12, fontWeight: FONTS.bold, color: COLORS.primary,
    letterSpacing: 0.3, flex: 1,
  },
  refBadge: {
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, flexShrink: 0,
  },
  refBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  rewardName: { fontSize: 15, fontWeight: FONTS.extraBold, lineHeight: 19 },
  duration: { fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },
});

// ─── Coin Toast ───────────────────────────────────────────────────────────────
function CoinToast({ visible, anim }: { visible: boolean; anim: Animated.Value }) {
  if (!visible) return null;
  return (
    <Animated.View
      style={[
        toastStyles.wrap,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
      pointerEvents="none"
    >
      <FontAwesome5 name="coins" size={16} color={COLORS.primary} solid />
      <Text style={toastStyles.text}>🪙 +{REFERRAL_COIN_REWARD} Coins Earned!</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 80, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 20, paddingVertical: 11,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)',
    zIndex: 9999,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 12,
  },
  text: { fontSize: 15, fontWeight: FONTS.extraBold, color: COLORS.primary },
});

// ─── Stat Chip ────────────────────────────────────────────────────────────────
function StatChip({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  return (
    <View style={styles.statChip}>
      <View style={[styles.statIconWrap, { backgroundColor: `${color}22` }]}>
        <FontAwesome5 name={icon as any} size={16} color={color} />
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Reward Tier Row ──────────────────────────────────────────────────────────
function RewardTierRow({ tier, completed }: { tier: typeof REWARD_TIERS[number]; completed: number }) {
  const isUnlocked = completed >= tier.referrals;
  const isNext = !isUnlocked;
  const progress = Math.min(1, completed / tier.referrals);
  const isMax = tier.referrals === 30;

  return (
    <View style={[styles.tierRow, isUnlocked ? styles.tierRowUnlocked : null]}>
      <View style={[
        styles.tierIconWrap,
        { backgroundColor: isUnlocked ? `${tier.color}22` : COLORS.surface },
        isUnlocked ? { borderColor: `${tier.color}44` } : null,
      ]}>
        <FontAwesome5 name={tier.icon as any} size={16} color={isUnlocked ? tier.color : COLORS.textMuted} />
      </View>
      <View style={styles.tierInfo}>
        <View style={styles.tierTitleRow}>
          <Text style={[styles.tierReward, isUnlocked ? { color: tier.color } : null]}>{tier.reward}</Text>
          <View style={styles.tierBadgeRow}>
            <View style={[
              styles.tierBadge,
              isUnlocked ? { backgroundColor: `${tier.color}22`, borderColor: `${tier.color}44` } : null,
            ]}>
              <Text style={[styles.tierBadgeText, isUnlocked ? { color: tier.color } : null]}>
                {tier.referrals} refs
              </Text>
            </View>
            {isMax ? (
              <View style={[styles.maxBadge, { backgroundColor: 'rgba(255,71,87,0.15)', borderColor: 'rgba(255,71,87,0.4)' }]}>
                <Text style={[styles.maxBadgeText, { color: COLORS.accentRed }]}>MAX</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={styles.tierDetail}>{tier.detail}</Text>
        {isNext && !isUnlocked ? (
          <View style={styles.tierProgress}>
            <View style={styles.tierProgressTrack}>
              <View style={[styles.tierProgressFill, { width: `${progress * 100}%`, backgroundColor: tier.color }]} />
            </View>
            <Text style={styles.tierProgressText}>{completed}/{tier.referrals}</Text>
          </View>
        ) : null}
      </View>
      {isUnlocked ? (
        <View style={styles.tierCheck}>
          <Ionicons name="checkmark-circle" size={22} color={tier.color} />
        </View>
      ) : (
        <View style={styles.tierLock}>
          <Ionicons name="lock-closed-outline" size={16} color={COLORS.textMuted} />
        </View>
      )}
    </View>
  );
}

// ─── How It Works steps ───────────────────────────────────────────────────────
const HOW_IT_WORKS = [
  { step: '1', title: 'Share your code', desc: 'Send your unique referral code to friends via any channel.' },
  { step: '2', title: 'Friend signs up', desc: 'They register with your code and make their first AI prediction.' },
  {
    step: '3', title: 'You both win',
    desc: `You earn ${REFERRAL_COIN_REWARD} coins per referral. Hit milestones to unlock VIP trials from 3 days all the way up to 6 months — the maximum!`,
  },
];

// ─── VIP days display helper ──────────────────────────────────────────────────
function formatVipDays(days: number): string {
  if (days === 0) return '0 days';
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`;
  const months = Math.round(days / 30);
  return `${months} month${months !== 1 ? 's' : ''}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ReferralScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { copied, scale, triggerCopy } = useCopyFeedback();
  const shimmerOpacity = useShimmer();

  const referralCode = user?.id ? deriveCode(user.id) : 'PX-XXXXXXXX';
  const referralLink = `https://predictxta.app/join?ref=${referralCode}`;

  // ─── Stats ────────────────────────────────────────────────────────────────
  const stats = useReferralStats(user?.id);

  // ─── Milestone toast ─────────────────────────────────────────────────────
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [activeMilestoneTier, setActiveMilestoneTier] = useState<RewardTier | null>(null);
  const milestoneAnim = useRef(new Animated.Value(0)).current;
  // Tracks the last known completedReferrals to detect crossings (-1 = not yet loaded)
  const prevCompletedRef = useRef<number>(-1);

  const showMilestoneToast = useCallback((tier: RewardTier) => {
    // Stop any in-flight animation before starting a new one
    milestoneAnim.stopAnimation();
    milestoneAnim.setValue(0);
    setActiveMilestoneTier(tier);
    setMilestoneVisible(true);
    Animated.sequence([
      Animated.timing(milestoneAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.delay(3200),
      Animated.timing(milestoneAnim, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start(() => setMilestoneVisible(false));
  }, [milestoneAnim]);

  // Detect milestone crossings whenever completedReferrals changes
  useEffect(() => {
    if (stats.loading) return;
    const current = stats.completedReferrals;
    const prev = prevCompletedRef.current;

    if (prev < 0) {
      // First load — record baseline without triggering toast
      prevCompletedRef.current = current;
      return;
    }

    if (current > prev) {
      // Find the highest milestone just crossed (in case multiple thresholds passed at once)
      const crossed = REWARD_TIERS.filter((t) => t.referrals > prev && t.referrals <= current);
      if (crossed.length > 0) {
        // Show toast for highest tier crossed; chain lower ones sequentially if needed
        const showNext = (idx: number) => {
          if (idx >= crossed.length) return;
          showMilestoneToast(crossed[idx]);
          // If more than one tier crossed, chain them with a delay
          if (idx + 1 < crossed.length) {
            setTimeout(() => showNext(idx + 1), 4200);
          }
        };
        showNext(0);
      }
    }

    prevCompletedRef.current = current;
  }, [stats.loading, stats.completedReferrals, showMilestoneToast]);

  // ─── Coin toast ───────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const showCoinToast = useCallback(() => {
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  }, [toastAnim]);

  // ─── Award coins to referrer ─────────────────────────────────────────────
  const awardReferralCoins = useCallback(async (referrerId: string): Promise<boolean> => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.rpc('add_user_coins', {
        p_user_id: referrerId,
        p_amount: REFERRAL_COIN_REWARD,
      });
      return !error;
    } catch {
      return false;
    }
  }, []);

  // ─── Simulate referral (demo) ─────────────────────────────────────────────
  const handleSimulateReferral = useCallback(async () => {
    if (!user?.id) {
      showAlert('Sign In Required', 'Please sign in to test the referral flow.');
      return;
    }

    const supabase = getSupabaseClient();
    const { data: existing } = await supabase
      .from('referrals')
      .select('id, status')
      .eq('referrer_id', user.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'completed') {
        showAlert('Already Completed', 'This demo referral is already marked as completed.');
        return;
      }
      await supabase
        .from('referrals')
        .update({ status: 'completed', coins_awarded: REFERRAL_COIN_REWARD, completed_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('referrals').insert({
        referrer_id: user.id,
        referred_id: user.id,
        referral_code: referralCode,
        status: 'completed',
        coins_awarded: REFERRAL_COIN_REWARD,
        completed_at: new Date().toISOString(),
      });
    }

    const ok = await awardReferralCoins(user.id);
    if (ok) {
      showCoinToast();
      try {
        const supabase2 = getSupabaseClient();
        await supabase2.from('notifications').insert({
          user_id: user.id,
          title: 'Referral Completed 🎉',
          body: `Your friend joined PredictXta! +${REFERRAL_COIN_REWARD} coins have been added to your wallet.`,
          type: 'referral',
          read: false,
        });
      } catch { /* non-blocking */ }
    }

    await stats.refresh();
  }, [user?.id, referralCode, awardReferralCoins, showCoinToast, stats, showAlert]);

  const handleShare = async () => {
    const shareMessage =
      `Join me on PredictXta Sports — the AI-powered match prediction app! 🏆\n\n` +
      `Use my referral code ${referralCode} when signing up and get a 3-day VIP trial free.\n\n` +
      `Download here: ${referralLink}`;
    try {
      await Share.share({ message: shareMessage, title: 'Join PredictX Sports' });
    } catch {
      showAlert('Error', 'Unable to open share sheet.');
    }
  };

  const handleCopyCode = () => triggerCopy(referralCode);
  const handleCopyLink = () => triggerCopy(referralLink);

  // Next locked milestone
  const nextTier = REWARD_TIERS.find((t) => !stats.loading && t.referrals > stats.completedReferrals);
  const allUnlocked = !stats.loading && stats.completedReferrals >= 30;

  return (
    <View style={styles.root}>
      {/* Coin Toast */}
      <CoinToast visible={toastVisible} anim={toastAnim} />
      {/* Milestone Achievement Toast */}
      <MilestoneToast visible={milestoneVisible} anim={milestoneAnim} tier={activeMilestoneTier} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: COLORS.surface }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Refer a Friend</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Hero Card ── */}
        <LinearGradient colors={['rgba(255,215,0,0.14)', 'rgba(255,215,0,0.04)']} style={styles.heroCard}>
          <Animated.View style={{ opacity: shimmerOpacity }}>
            <View style={styles.heroCrownWrap}>
              <FontAwesome5 name="crown" size={36} color={COLORS.primary} />
            </View>
          </Animated.View>
          <Text style={styles.heroTitle}>Earn Free VIP</Text>
          <Text style={styles.heroSub}>
            Invite friends and earn {REFERRAL_COIN_REWARD} coins per referral. Hit milestones to unlock VIP trials from 3 days up to 6 months — maximum!
          </Text>

          {/* Dual pills */}
          <View style={styles.heroPillRow}>
            <View style={styles.heroCoinPill}>
              <FontAwesome5 name="coins" size={11} color={COLORS.primary} solid />
              <Text style={styles.heroCoinPillText}>+{REFERRAL_COIN_REWARD} coins each</Text>
            </View>
            <View style={[styles.heroCoinPill, { backgroundColor: 'rgba(255,71,87,0.12)', borderColor: 'rgba(255,71,87,0.35)' }]}>
              <FontAwesome5 name="fire" size={11} color={COLORS.accentRed} />
              <Text style={[styles.heroCoinPillText, { color: COLORS.accentRed }]}>Up to 6 months VIP</Text>
            </View>
          </View>

          {/* Milestone quick-view strip */}
          <View style={styles.milestoneStrip}>
            {REWARD_TIERS.map((t, i) => (
              <View key={t.referrals} style={styles.milestoneItem}>
                <View style={[styles.milestoneDot, { backgroundColor: t.color }]} />
                <Text style={[styles.milestoneLabel, { color: t.color }]}>{t.durationLabel}</Text>
                <Text style={styles.milestoneCount}>{t.referrals} refs</Text>
                {i < REWARD_TIERS.length - 1 ? (
                  <View style={[styles.milestoneLine, { backgroundColor: COLORS.border }]} />
                ) : null}
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* ── Referral Code Box ── */}
        <View style={styles.codeSection}>
          <Text style={styles.sectionLabel}>YOUR REFERRAL CODE</Text>

          <View style={styles.codeBox}>
            <LinearGradient colors={['rgba(255,215,0,0.1)', 'rgba(255,215,0,0.04)']} style={styles.codeGradient}>
              <View style={styles.codeLeft}>
                <Text style={styles.codeText}>{referralCode}</Text>
                <Text style={styles.codeSub}>Tap to copy · Share with friends</Text>
              </View>
              <Animated.View style={{ transform: [{ scale }] }}>
                <Pressable style={[styles.copyBtn, copied ? styles.copyBtnActive : null]} onPress={handleCopyCode}>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? COLORS.textInverse : COLORS.primary} />
                  <Text style={[styles.copyBtnText, copied ? styles.copyBtnTextActive : null]}>
                    {copied ? 'Copied!' : 'Copy'}
                  </Text>
                </Pressable>
              </Animated.View>
            </LinearGradient>
          </View>

          {/* Referral link row */}
          <View style={styles.linkRow}>
            <Text style={styles.linkText} numberOfLines={1}>{referralLink}</Text>
            <Pressable style={({ pressed }) => [styles.linkCopyBtn, pressed ? { opacity: 0.7 } : null]} onPress={handleCopyLink}>
              <Ionicons name="copy-outline" size={14} color={COLORS.textMuted} />
            </Pressable>
          </View>

          {/* Share CTA */}
          <Pressable style={({ pressed }) => [styles.shareBtn, pressed ? styles.shareBtnPressed : null]} onPress={handleShare}>
            <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.shareBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Ionicons name="share-social" size={20} color={COLORS.textInverse} />
              <Text style={styles.shareBtnText}>Share with Friends</Text>
              <View style={styles.shareBtnArrow}>
                <MaterialIcons name="arrow-forward" size={18} color={COLORS.textInverse} />
              </View>
            </LinearGradient>
          </Pressable>

          {/* Demo simulate button */}
          {user ? (
            <Pressable
              style={({ pressed }) => [styles.simulateBtn, pressed ? { opacity: 0.8 } : null]}
              onPress={handleSimulateReferral}
            >
              <Ionicons name="flask-outline" size={14} color={COLORS.accentBlue} />
              <Text style={styles.simulateBtnText}>Simulate Referral (Demo)</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Stats Card ── */}
        <View style={styles.statsCard}>
          <View style={styles.statsHeader}>
            <Text style={styles.sectionLabel}>YOUR REFERRAL STATS</Text>
            {stats.loading ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
          </View>

          {stats.loading ? (
            <View style={styles.statsLoader}><ActivityIndicator color={COLORS.primary} /></View>
          ) : (
            <>
              {/* Row 1: referral counts */}
              <View style={styles.statsGrid}>
                <StatChip icon="users" value={stats.totalReferrals} label="Total" color={COLORS.accentBlue} />
                <StatChip icon="check-circle" value={stats.completedReferrals} label="Completed" color={COLORS.accent} />
                <StatChip icon="clock" value={stats.pendingReferrals} label="Pending" color={COLORS.textSecondary} />
              </View>

              {/* Row 2: coins & VIP days earned */}
              <View style={[styles.statsGrid, { marginTop: 8 }]}>
                <View style={[styles.statChipWide, { borderColor: 'rgba(255,215,0,0.35)', backgroundColor: COLORS.primaryGlow }]}>
                  <FontAwesome5 name="coins" size={18} color={COLORS.primary} solid />
                  <View>
                    <Text style={[styles.statValue, { color: COLORS.primary }]}>
                      {stats.coinsEarned.toLocaleString()}
                    </Text>
                    <Text style={styles.statLabel}>Coins from Referrals</Text>
                  </View>
                </View>
                <StatChip
                  icon="crown"
                  value={formatVipDays(stats.vipDaysEarned)}
                  label="VIP Earned"
                  color={COLORS.primary}
                />
              </View>

              {/* Progress to next tier */}
              <View style={styles.nextTierRow}>
                {allUnlocked ? (
                  <View style={styles.allUnlockedRow}>
                    <FontAwesome5 name="fire" size={14} color={COLORS.accentRed} />
                    <Text style={styles.allUnlockedText}>All rewards unlocked — maximum 6 months VIP!</Text>
                  </View>
                ) : nextTier ? (
                  <View style={styles.nextTierInfo}>
                    <View style={styles.nextTierLabelRow}>
                      <Text style={styles.nextTierText}>
                        <Text style={{ color: COLORS.primary, fontWeight: FONTS.bold }}>
                          {nextTier.referrals - stats.completedReferrals} more
                        </Text>
                        {' referral'}
                        {nextTier.referrals - stats.completedReferrals !== 1 ? 's' : ''}
                        {' to unlock '}
                        <Text style={{ color: nextTier.color, fontWeight: FONTS.bold }}>{nextTier.reward}</Text>
                      </Text>
                      <View style={[styles.nextTierDurationPill, { backgroundColor: `${nextTier.color}18`, borderColor: `${nextTier.color}44` }]}>
                        <FontAwesome5 name={nextTier.icon as any} size={9} color={nextTier.color} />
                        <Text style={[styles.nextTierDurationText, { color: nextTier.color }]}>{nextTier.durationLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.nextTierBar}>
                      <View style={[styles.nextTierFill, {
                        width: `${(stats.completedReferrals / nextTier.referrals) * 100}%`,
                        backgroundColor: nextTier.color,
                      }]} />
                    </View>
                    <Text style={styles.nextTierProgress}>{stats.completedReferrals} / {nextTier.referrals} referrals</Text>
                  </View>
                ) : null}
              </View>
            </>
          )}
        </View>

        {/* ── Rewards Tiers ── */}
        <View style={styles.tiersSection}>
          <Text style={styles.sectionLabel}>REWARDS TABLE</Text>
          <View style={styles.tiersCard}>
            {REWARD_TIERS.map((tier, i) => (
              <React.Fragment key={tier.referrals}>
                <RewardTierRow tier={tier} completed={stats.loading ? 0 : stats.completedReferrals} />
                {i < REWARD_TIERS.length - 1 ? <View style={styles.tierDivider} /> : null}
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* ── How It Works ── */}
        <View style={styles.howSection}>
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          <View style={styles.howCard}>
            {HOW_IT_WORKS.map((step, i) => (
              <View key={step.step} style={styles.howStep}>
                <View style={styles.howStepLeft}>
                  <View style={styles.howStepBubble}>
                    <Text style={styles.howStepNum}>{step.step}</Text>
                  </View>
                  {i < HOW_IT_WORKS.length - 1 ? <View style={styles.howStepLine} /> : null}
                </View>
                <View style={styles.howStepText}>
                  <Text style={styles.howStepTitle}>{step.title}</Text>
                  <Text style={styles.howStepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Coin reward callout ── */}
        <View style={styles.coinCallout}>
          <View style={styles.coinCalloutIconWrap}>
            <FontAwesome5 name="coins" size={22} color={COLORS.primary} solid />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.coinCalloutTitle}>+{REFERRAL_COIN_REWARD} Coins Per Referral</Text>
            <Text style={styles.coinCalloutDesc}>
              Coins are awarded when your friend completes registration and their first AI prediction. VIP trial rewards unlock automatically at 5, 10, 15, 20, and 30 referral milestones — capped at 6 months maximum.
            </Text>
          </View>
        </View>

        {/* ── Milestone summary note ── */}
        <View style={[styles.termsNote, { backgroundColor: COLORS.primaryGlow, borderColor: 'rgba(255,215,0,0.25)', marginBottom: 8 }]}>
          <FontAwesome5 name="trophy" size={12} color={COLORS.primary} />
          <Text style={[styles.termsText, { color: COLORS.primary }]}>
            {'5 refs=3d · 10 refs=7d · 15 refs=1mo · 20 refs=3mo · 30 refs=6mo (MAX)'}
          </Text>
        </View>

        {/* ── Terms note ── */}
        <View style={styles.termsNote}>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.termsText}>
            Coins and VIP rewards are credited after referrals complete email verification and their first AI prediction. Each milestone is cumulative — milestones do not reset. Rewards apply automatically within 24 hours. Maximum VIP reward is 6 months.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: 12, gap: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 18, fontWeight: FONTS.bold, color: COLORS.textPrimary,
  },

  scroll: { paddingBottom: 24 },

  sectionLabel: {
    fontSize: 11, fontWeight: FONTS.bold, color: COLORS.textMuted,
    letterSpacing: 1, marginBottom: 10,
  },

  // Hero
  heroCard: {
    margin: SPACING.md, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
    alignItems: 'center', padding: SPACING.lg, gap: 12,
  },
  heroCrownWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 26, fontWeight: FONTS.extraBold, color: COLORS.primary },
  heroSub: {
    fontSize: 13, color: COLORS.textSecondary,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: 8,
  },
  heroPillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  heroCoinPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  heroCoinPillText: { fontSize: 12, fontWeight: FONTS.bold, color: COLORS.primary },

  // Milestone strip
  milestoneStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', marginTop: 4,
  },
  milestoneItem: { alignItems: 'center', gap: 3, flex: 1, position: 'relative' },
  milestoneDot: { width: 10, height: 10, borderRadius: 5 },
  milestoneLabel: { fontSize: 9, fontWeight: FONTS.extraBold },
  milestoneCount: { fontSize: 8, color: COLORS.textMuted, fontWeight: FONTS.medium },
  milestoneLine: {
    position: 'absolute', top: 5, left: '55%',
    height: 1, width: '90%',
  },

  // Code section
  codeSection: { paddingHorizontal: SPACING.md, marginBottom: SPACING.md, gap: 10 },
  codeBox: {
    borderRadius: RADIUS.lg, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(255,215,0,0.35)',
  },
  codeGradient: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 16, gap: 12,
  },
  codeLeft: { flex: 1 },
  codeText: {
    fontSize: 26, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 3,
  },
  codeSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  copyBtnActive: { backgroundColor: COLORS.primary },
  copyBtnText: { fontSize: 13, fontWeight: FONTS.bold, color: COLORS.primary },
  copyBtnTextActive: { color: COLORS.textInverse },

  // Link row
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  linkText: { flex: 1, fontSize: 12, color: COLORS.textMuted },
  linkCopyBtn: { padding: 4 },

  // Share button
  shareBtn: { borderRadius: RADIUS.full, overflow: 'hidden' },
  shareBtnPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  shareBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, gap: 10,
  },
  shareBtnText: { fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.textInverse },
  shareBtnArrow: {
    position: 'absolute', right: 20,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(7,11,20,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Simulate button
  simulateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: COLORS.accentBlueDim, borderRadius: RADIUS.full,
    paddingVertical: 11, borderWidth: 1, borderColor: `${COLORS.accentBlue}33`,
  },
  simulateBtnText: { fontSize: 13, fontWeight: FONTS.semiBold, color: COLORS.accentBlue },

  // Stats
  statsCard: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
  },
  statsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsLoader: { paddingVertical: 20, alignItems: 'center' },
  statsGrid: { flexDirection: 'row', gap: 8 },
  statChip: {
    flex: 1, alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  statChipWide: {
    flex: 2, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  statIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium, textAlign: 'center' },

  // Next tier progress
  nextTierRow: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  nextTierInfo: { gap: 7 },
  nextTierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nextTierText: { fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  nextTierDurationPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  nextTierDurationText: { fontSize: 10, fontWeight: FONTS.bold },
  nextTierBar: {
    height: 6, backgroundColor: COLORS.border,
    borderRadius: RADIUS.full, overflow: 'hidden',
  },
  nextTierFill: { height: '100%', borderRadius: RADIUS.full },
  nextTierProgress: { fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.medium },
  allUnlockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
  },
  allUnlockedText: { fontSize: 13, color: COLORS.accentRed, fontWeight: FONTS.semiBold },

  // Tiers
  tiersSection: { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  tiersCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  tierRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
  },
  tierRowUnlocked: { backgroundColor: 'rgba(255,215,0,0.03)' },
  tierIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, flexShrink: 0,
  },
  tierInfo: { flex: 1, gap: 3 },
  tierTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tierReward: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  tierBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tierBadge: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tierBadgeText: { fontSize: 9, fontWeight: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.5 },
  maxBadge: {
    borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1,
  },
  maxBadgeText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.8 },
  tierDetail: { fontSize: 12, color: COLORS.textMuted },
  tierProgress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tierProgressTrack: {
    flex: 1, height: 4, backgroundColor: COLORS.border,
    borderRadius: RADIUS.full, overflow: 'hidden',
  },
  tierProgressFill: { height: '100%', borderRadius: RADIUS.full },
  tierProgressText: { fontSize: 10, color: COLORS.textMuted, width: 36, textAlign: 'right' },
  tierCheck: { flexShrink: 0 },
  tierLock: { flexShrink: 0, opacity: 0.5 },
  tierDivider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: 14 },

  // How It Works
  howSection: { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  howCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
  },
  howStep: { flexDirection: 'row', gap: 14 },
  howStepLeft: { alignItems: 'center', gap: 0, width: 32 },
  howStepBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  howStepNum: { fontSize: 14, fontWeight: FONTS.extraBold, color: COLORS.primary },
  howStepLine: { flex: 1, width: 1, backgroundColor: COLORS.border, minHeight: 24, marginVertical: 4 },
  howStepText: { flex: 1, paddingBottom: 20, gap: 3 },
  howStepTitle: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginTop: 5 },
  howStepDesc: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },

  // Coin reward callout
  coinCallout: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.xl,
    padding: 16, borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  coinCalloutIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,215,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  coinCalloutTitle: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.primary, marginBottom: 5 },
  coinCalloutDesc: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 19 },

  // Terms
  termsNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: SPACING.md, padding: 14,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  termsText: { flex: 1, fontSize: 11, color: COLORS.textMuted, lineHeight: 17 },
});
