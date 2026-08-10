import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Modal, Platform, Animated, RefreshControl,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { COLORS, FONTS, RADIUS, SPACING } from '@/constants/theme';
import { DisclaimerBanner, AgeBadge } from '@/components/ui/DisclaimerBanner';
import { useIAP } from '@/hooks/useIAP';
import type { IAPPlan } from '@/services/iapService';
import { COIN_PACKS } from '@/services/iapService';
import { useAdminRole } from '@/hooks/useAdminRole';

// ─── VIP expiry notification cooldown key ────────────────────────────────────
const VIP_EXPIRY_NOTIF_KEY = 'predictxta_vip_expiry_notif_v1';

// ─── Plan type alias (re-exported from iapService) ───────────────────────────
type Plan = IAPPlan;
type PlanId = string;

type VipTab = 'vip' | 'coins';

// ─── Feature comparison rows ─────────────────────────────────────────────────
interface Feature {
  label: string;
  icon: string;
  predictx_vip_monthly: boolean;
  predictx_vip_biannual: boolean;
  predictx_vip_annual: boolean;
  highlight?: boolean;
}

const FEATURES: Feature[] = [
  { label: 'Unlimited AI Picks', icon: 'brain', predictx_vip_monthly: true, predictx_vip_biannual: true, predictx_vip_annual: true, highlight: true },
  { label: 'VIP Expert Tips', icon: 'crown', predictx_vip_monthly: false, predictx_vip_biannual: true, predictx_vip_annual: true, highlight: true },
  { label: 'No Ads', icon: 'ban', predictx_vip_monthly: true, predictx_vip_biannual: true, predictx_vip_annual: true },
  { label: 'Priority Support', icon: 'headset', predictx_vip_monthly: false, predictx_vip_biannual: true, predictx_vip_annual: true },
  { label: 'Advanced Stats', icon: 'chart-bar', predictx_vip_monthly: false, predictx_vip_biannual: true, predictx_vip_annual: true },
  { label: 'Prediction History Export', icon: 'download', predictx_vip_monthly: false, predictx_vip_biannual: false, predictx_vip_annual: true },
  { label: 'Early Access Features', icon: 'bolt', predictx_vip_monthly: false, predictx_vip_biannual: false, predictx_vip_annual: true },
];



// ─── VIP Tips Data ───────────────────────────────────────────────────────────
type BetType = 'Home Win' | 'Away Win' | 'Draw' | 'Over 2.5' | 'Under 2.5' | 'BTTS Yes' | 'BTTS No' | 'Double Chance' | 'Asian Handicap';

interface VipTip {
  id: string;
  matchName: string;
  league: string;
  sport: string;
  betType: BetType;
  stars: number; // 1–5
  tipsterNote: string;
  tipsterName: string;
  tipsterAvatar: string;
  odds: string;
  confidence: number;
  kickoff: string;
}

// Fallback static tips shown when DB has no live tips yet
const FALLBACK_TIPS: VipTip[] = [
  {
    id: 't1',
    matchName: 'Manchester City vs Arsenal',
    league: 'Premier League',
    sport: '⚽',
    betType: 'Over 2.5',
    stars: 5,
    tipsterNote: 'Both sides average over 2.8 goals per game this season. City have failed to keep a clean sheet in 7 of the last 8 home matches vs top-6 opposition. Expect an open, high-scoring affair.',
    tipsterName: 'Expert Alex',
    tipsterAvatar: 'A',
    odds: '1.72',
    confidence: 91,
    kickoff: 'Today 17:30',
  },
  {
    id: 't2',
    matchName: 'Real Madrid vs Atletico',
    league: 'La Liga',
    sport: '⚽',
    betType: 'BTTS Yes',
    stars: 4,
    tipsterNote: 'The Madrid derby has seen BTTS land in 8 of the last 10 meetings. Atletico score in virtually every away trip; Real concede from set pieces. Value here at these odds.',
    tipsterName: 'Pro Tipster Sam',
    tipsterAvatar: 'S',
    odds: '1.85',
    confidence: 83,
    kickoff: 'Today 20:00',
  },
  {
    id: 't3',
    matchName: 'Djokovic vs Alcaraz',
    league: 'Roland Garros SF',
    sport: '🎾',
    betType: 'Over 2.5',
    stars: 5,
    tipsterNote: 'These two have never completed a match in under 3 sets. Alcaraz is finding top form and Djokovic thrives in long exchanges. Sets market has hit Over in their last 4 encounters.',
    tipsterName: 'Tennis Scout Elena',
    tipsterAvatar: 'E',
    odds: '1.58',
    confidence: 88,
    kickoff: 'Tomorrow 14:00',
  },
];

// ─── Hook: fetch live expert tips from DB ─────────────────────────────────────
function useExpertTips() {
  const [tips, setTips] = React.useState<VipTip[]>([]);
  const [loading, setLoading] = React.useState(true);

  const fetch = React.useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const since = new Date();
      since.setDate(since.getDate() - 3); // show tips from last 3 days
      const { data } = await supabase
        .from('expert_tips')
        .select('id, expert_name, sport, match_label, tip_type, odds, confidence, analysis, league, match_time, is_premium, created_at')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (data && data.length > 0) {
        const SPORT_EMOJIS: Record<string, string> = {
          football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
          mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉',
        };
        const mapped: VipTip[] = data.map((r: any) => ({
          id: r.id,
          matchName: r.match_label ?? 'TBD',
          league: r.league ?? '',
          sport: SPORT_EMOJIS[r.sport?.toLowerCase() ?? 'football'] ?? '🏆',
          betType: r.tip_type as BetType,
          stars: Math.min(5, Math.max(1, Math.round((r.confidence ?? 70) / 20))),
          tipsterNote: r.analysis ?? '',
          tipsterName: r.expert_name ?? 'Expert',
          tipsterAvatar: (r.expert_name ?? 'E')[0].toUpperCase(),
          odds: r.odds ? String(parseFloat(r.odds).toFixed(2)) : '—',
          confidence: r.confidence ?? 70,
          kickoff: r.match_time
            ? new Date(r.match_time).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
            : '',
        }));
        setTips(mapped);
      } else {
        setTips(FALLBACK_TIPS);
      }
    } catch {
      setTips(FALLBACK_TIPS);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetch(); }, [fetch]);

  return { tips, loading, refresh: fetch };
}

const BET_TYPE_COLORS: Record<string, string> = {
  'Home Win': COLORS.primary,
  'Away Win': COLORS.accentBlue,
  'Draw': COLORS.accentPurple,
  'Over 2.5': COLORS.accent,
  'Under 2.5': COLORS.accentBlue,
  'BTTS Yes': '#00C9A7',
  'BTTS No': COLORS.accentRed,
  'Double Chance': COLORS.primary,
  'Asian Handicap': '#FF9500',
};

// ─── Star Rating Component ────────────────────────────────────────────────────
function StarRating({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <FontAwesome5
          key={i}
          name="star"
          size={11}
          color={i <= count ? COLORS.primary : COLORS.border}
          solid={i <= count}
        />
      ))}
    </View>
  );
}

// ─── Confidence Arc ───────────────────────────────────────────────────────────
function ConfidenceArc({ value }: { value: number }) {
  const color = value >= 85 ? COLORS.accent : value >= 70 ? COLORS.primary : COLORS.accentBlue;
  return (
    <View style={[tipStyles.confArc, { borderColor: `${color}55`, backgroundColor: `${color}12` }]}>
      <Text style={[tipStyles.confNum, { color }]}>{value}%</Text>
      <Text style={tipStyles.confLabel}>AI</Text>
    </View>
  );
}

// ─── VIP Tip Card (unlocked) ──────────────────────────────────────────────────
function VipTipCard({ tip }: { tip: VipTip }) {
  const betColor = BET_TYPE_COLORS[tip.betType] ?? COLORS.primary;
  return (
    <View style={tipStyles.card}>
      {/* Header */}
      <View style={tipStyles.cardHeader}>
        <View style={tipStyles.headerLeft}>
          <Text style={tipStyles.sport}>{tip.sport}</Text>
          <View style={{ flex: 1 }}>
            <Text style={tipStyles.league}>{tip.league}</Text>
            <Text style={tipStyles.matchName} numberOfLines={1}>{tip.matchName}</Text>
          </View>
        </View>
        <ConfidenceArc value={tip.confidence} />
      </View>

      {/* Bet type + odds row */}
      <View style={tipStyles.betRow}>
        <View style={[tipStyles.betTypePill, { backgroundColor: `${betColor}18`, borderColor: `${betColor}44` }]}>
          <FontAwesome5 name="bookmark" size={9} color={betColor} solid />
          <Text style={[tipStyles.betTypeText, { color: betColor }]}>{tip.betType}</Text>
        </View>
        <View style={tipStyles.oddsChip}>
          <Text style={tipStyles.oddsLabel}>ODDS</Text>
          <Text style={tipStyles.oddsValue}>{tip.odds}</Text>
        </View>
        <View style={tipStyles.kickoffChip}>
          <Ionicons name="time-outline" size={11} color={COLORS.textMuted} />
          <Text style={tipStyles.kickoffText}>{tip.kickoff}</Text>
        </View>
      </View>

      {/* Stars */}
      <View style={tipStyles.starsRow}>
        <StarRating count={tip.stars} />
        <Text style={tipStyles.starsLabel}>{tip.stars === 5 ? 'Top Confidence' : tip.stars >= 4 ? 'High Value' : 'Good Pick'}</Text>
      </View>

      {/* Divider */}
      <View style={tipStyles.divider} />

      {/* Tipster analysis */}
      <View style={tipStyles.tipsterSection}>
        <View style={[tipStyles.tipsterAvatar, { backgroundColor: betColor }]}>
          <Text style={tipStyles.tipsterInitial}>{tip.tipsterAvatar}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={tipStyles.tipsterNameRow}>
            <Text style={tipStyles.tipsterName}>{tip.tipsterName}</Text>
            <View style={tipStyles.expertBadge}>
              <FontAwesome5 name="shield-alt" size={8} color={COLORS.primary} solid />
              <Text style={tipStyles.expertBadgeText}>EXPERT</Text>
            </View>
          </View>
          <Text style={tipStyles.tipsterNote}>{tip.tipsterNote}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Blurred Preview Card (locked) ───────────────────────────────────────────
function LockedTipCard({ tip }: { tip: VipTip }) {
  const betColor = BET_TYPE_COLORS[tip.betType] ?? COLORS.primary;
  return (
    <View style={tipStyles.lockedOuter}>
      {/* Blurred content behind */}
      <View style={tipStyles.lockedBlurTarget}>
        <View style={tipStyles.lockedFakeHeader}>
          <Text style={tipStyles.sport}>{tip.sport}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[tipStyles.league, { opacity: 0.5 }]}>{tip.league}</Text>
            <Text style={[tipStyles.matchName, { opacity: 0.5 }]} numberOfLines={1}>{'█'.repeat(tip.matchName.length / 2)}</Text>
          </View>
        </View>
        <View style={tipStyles.lockedFakeRow}>
          <View style={[tipStyles.betTypePill, { backgroundColor: `${betColor}18`, borderColor: `${betColor}44`, opacity: 0.6 }]}>
            <Text style={[tipStyles.betTypeText, { color: betColor }]}>{'▓'.repeat(tip.betType.length)}</Text>
          </View>
          <View style={[tipStyles.oddsChip, { opacity: 0.5 }]}>
            <Text style={tipStyles.oddsLabel}>ODDS</Text>
            <Text style={tipStyles.oddsValue}>?.??</Text>
          </View>
        </View>
        <View style={[tipStyles.lockedFakeNote, { opacity: 0.3 }]}>
          {[80, 95, 60].map((w, i) => (
            <View key={i} style={[tipStyles.lockedFakeLine, { width: `${w}%` }]} />
          ))}
        </View>
      </View>

      {/* Lock overlay */}
      <View style={tipStyles.lockOverlay}>
        {Platform.OS !== 'web' ? (
          <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,11,20,0.75)' }]} />
        )}
        <View style={tipStyles.lockContent}>
          <View style={tipStyles.lockIconWrap}>
            <FontAwesome5 name="lock" size={18} color={COLORS.primary} solid />
          </View>
          <Text style={tipStyles.lockTitle}>VIP Pick Locked</Text>
          <Text style={tipStyles.lockSub}>Upgrade to access this expert tip</Text>
        </View>
      </View>
    </View>
  );
}

// ─── VIP Tips Feed Section ─────────────────────────────────────────────────
function VipTipsFeed({ isVip, onUpgrade, canSubmit, onSubmit }: { isVip: boolean; onUpgrade: () => void; canSubmit?: boolean; onSubmit?: () => void }) {
  const { tips: VIP_TIPS, loading: tipsLoading, refresh: refreshTips } = useExpertTips();
  return (
    <View style={tipStyles.feedSection}>
      {/* Section header */}
      <View style={tipStyles.feedHeader}>
        <LinearGradient
          colors={[COLORS.primary, '#FFA500']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={tipStyles.feedHeaderLeft}
        >
          <FontAwesome5 name="crown" size={12} color={COLORS.textInverse} solid />
          <Text style={tipStyles.feedHeaderTitle}>VIP Expert Tips</Text>
        </LinearGradient>
        <View style={tipStyles.feedHeaderRight}>
          <View style={tipStyles.liveIndicator}>
            <View style={tipStyles.liveDot} />
            <Text style={tipStyles.liveText}>LIVE</Text>
          </View>
          <Text style={tipStyles.feedCount}>{VIP_TIPS.length} picks today</Text>
        </View>
      </View>

      {/* Sub-header description */}
      <View style={tipStyles.feedDesc}>
        <Ionicons name="information-circle-outline" size={14} color={COLORS.accentBlue} />
        <Text style={tipStyles.feedDescText}>
          Curated by our expert tipsters with 10+ years of experience. Updated daily.
        </Text>
      </View>

      {/* Expert submit button */}
      {canSubmit ? (
        <Pressable
          onPress={onSubmit}
          style={({ pressed }) => [tipStyles.submitExpertBtn, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
          <Text style={tipStyles.submitExpertBtnText}>Submit Expert Tip</Text>
          <View style={tipStyles.expertBadgeSmall}>
            <Text style={tipStyles.expertBadgeSmallText}>EXPERT</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Tips list */}
      {tipsLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {VIP_TIPS.map((tip, idx) => (
            isVip || idx === 0
              ? <VipTipCard key={tip.id} tip={tip} />
              : <LockedTipCard key={tip.id} tip={tip} />
          ))}
        </View>
      )}

      {/* Bottom upgrade CTA for non-VIP */}
      {!isVip && VIP_TIPS.length > 1 ? (
        <View style={tipStyles.upgradeCta}>
          <FontAwesome5 name="lock" size={14} color={COLORS.primary} solid />
          <View style={{ flex: 1 }}>
            <Text style={tipStyles.upgradeCtaTitle}>
              {VIP_TIPS.length - 1} more expert picks hidden
            </Text>
            <Text style={tipStyles.upgradeCtaSub}>
              Subscribe to VIP to unlock all daily tips
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [tipStyles.upgradeBtn, pressed ? { opacity: 0.85 } : null]}
            onPress={onUpgrade}
          >
            <Text style={tipStyles.upgradeBtnText}>Upgrade</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ─── Coin Pack Card ──────────────────────────────────────────────────────────
function CoinPackCard({
  pack, onBuy, purchasing, iapAvailable,
}: {
  pack: IAPPlan;
  onBuy: (pack: IAPPlan) => void;
  purchasing: boolean;
  iapAvailable: boolean;
}) {
  const coinEmojis: Record<number, string> = {
    500: '🥉',
    2500: '🥈',
    5000: '🥇',
  };
  const emoji = pack.coinAmount ? (coinEmojis[pack.coinAmount] ?? '🪙') : '🪙';

  return (
    <View style={coinStyles.card}>
      {pack.mostPopular ? (
        <View style={coinStyles.popularBadge}>
          <Text style={coinStyles.popularText}>BEST VALUE</Text>
        </View>
      ) : null}

      <View style={coinStyles.cardTop}>
        <Text style={coinStyles.emoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={coinStyles.packName}>{pack.name}</Text>
          <Text style={coinStyles.packDesc}>{pack.description}</Text>
        </View>
        {pack.savingLabel ? (
          <View style={[coinStyles.savingBadge, { backgroundColor: `${pack.accentColor}22`, borderColor: `${pack.accentColor}55` }]}>
            <Text style={[coinStyles.savingText, { color: pack.accentColor }]}>{pack.savingLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={coinStyles.cardBottom}>
        <View style={coinStyles.coinCount}>
          <FontAwesome5 name="coins" size={14} color={COLORS.primary} solid />
          <Text style={coinStyles.coinCountText}>{pack.coinAmount?.toLocaleString()} Coins</Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            coinStyles.buyBtn,
            { backgroundColor: pack.accentColor },
            (!iapAvailable || purchasing) ? coinStyles.buyBtnDisabled : null,
            pressed && iapAvailable && !purchasing ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
          ]}
          onPress={() => onBuy(pack)}
          disabled={!iapAvailable || purchasing}
        >
          {purchasing ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={coinStyles.buyBtnText}>{pack.fallbackPrice}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Coins Tab Content ────────────────────────────────────────────────────────
function CoinsTab({
  coinBalance, loadingBalance, coinPacks, onBuy, purchasing, iapAvailable, storeProducts,
}: {
  coinBalance: number | null;
  loadingBalance: boolean;
  coinPacks: IAPPlan[];
  onBuy: (pack: IAPPlan) => void;
  purchasing: boolean;
  iapAvailable: boolean;
  storeProducts: { productId: string; localizedPrice?: string }[];
}) {
  const packs = coinPacks.length > 0 ? coinPacks : COIN_PACKS;

  return (
    <View style={coinStyles.container}>
      {/* Balance card */}
      <View style={coinStyles.balanceCard}>
        <LinearGradient
          colors={['#2A1F00', '#1A1400']}
          style={coinStyles.balanceGradient}
        >
          <View style={coinStyles.balanceIconWrap}>
            <FontAwesome5 name="coins" size={28} color={COLORS.primary} solid />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={coinStyles.balanceLabel}>Your Coin Balance</Text>
            {loadingBalance ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
            ) : (
              <Text style={coinStyles.balanceAmount}>
                {(coinBalance ?? 0).toLocaleString()}
                <Text style={coinStyles.balanceUnit}> coins</Text>
              </Text>
            )}
          </View>
          <View style={coinStyles.balanceRightDecor}>
            <FontAwesome5 name="coins" size={48} color="rgba(255,215,0,0.06)" solid />
          </View>
        </LinearGradient>
      </View>

      {/* How coins work */}
      <View style={coinStyles.infoCard}>
        <Ionicons name="information-circle-outline" size={15} color={COLORS.accentBlue} />
        <Text style={coinStyles.infoText}>
          Coins unlock premium AI analysis, bonus predictions, and exclusive chat stickers. Earn free coins by completing the Daily Challenge.
        </Text>
      </View>

      {/* IAP unavailable notice */}
      {!iapAvailable ? (
        <View style={coinStyles.unavailableNotice}>
          <Ionicons name="alert-circle-outline" size={14} color="rgba(255,215,0,0.7)" />
          <Text style={coinStyles.unavailableText}>
            Coin purchases require a release build from the App Store or Google Play.
          </Text>
        </View>
      ) : null}

      {/* Pack list header */}
      <View style={coinStyles.packHeader}>
        <Text style={coinStyles.packHeaderTitle}>Choose a Pack</Text>
        <View style={coinStyles.packHeaderBadge}>
          <Text style={coinStyles.packHeaderBadgeText}>ONE-TIME</Text>
        </View>
      </View>

      {/* Coin pack cards */}
      <View style={coinStyles.packList}>
        {packs.map((pack) => (
          <CoinPackCard
            key={pack.id}
            pack={pack}
            onBuy={onBuy}
            purchasing={purchasing}
            iapAvailable={iapAvailable}
          />
        ))}
      </View>

      {/* Earn free coins section */}
      <View style={coinStyles.earnSection}>
        <Text style={coinStyles.earnTitle}>Earn Free Coins</Text>
        {[
          { icon: 'trophy', label: 'Daily Challenge', desc: 'Complete today\'s picks for +10 coins', color: COLORS.primary },
          { icon: 'share-alt', label: 'Refer a Friend', desc: 'Earn +50 coins when they sign up', color: COLORS.accentBlue },
          { icon: 'star', label: 'Perfect Week', desc: 'Go 7/7 in a week for +100 coins', color: COLORS.accent },
        ].map((item) => (
          <View key={item.label} style={coinStyles.earnRow}>
            <View style={[coinStyles.earnIconWrap, { backgroundColor: `${item.color}18`, borderColor: `${item.color}44` }]}>
              <FontAwesome5 name={item.icon as any} size={14} color={item.color} solid />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={coinStyles.earnLabel}>{item.label}</Text>
              <Text style={coinStyles.earnDesc}>{item.desc}</Text>
            </View>
            <View style={[coinStyles.earnCoinBadge, { backgroundColor: `${item.color}18`, borderColor: `${item.color}33` }]}>
              <FontAwesome5 name="coins" size={9} color={item.color} solid />
              <Text style={[coinStyles.earnCoinText, { color: item.color }]}>
                {item.label === 'Daily Challenge' ? '+10' : item.label === 'Refer a Friend' ? '+50' : '+100'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ height: 16 }} />
    </View>
  );
}

// ─── Animated Plan Card Wrapper ────────────────────────────────────────────────
function AnimatedPlanCardWrapper({ index, isSelected, children }: { index: number; isSelected: boolean; children: React.ReactNode }) {
  const opacity     = useRef(new Animated.Value(0)).current;
  const translateY  = useRef(new Animated.Value(18)).current;
  const selectScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay: index * 80,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        delay: index * 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Spring bounce when this card becomes selected
  useEffect(() => {
    if (isSelected) {
      Animated.sequence([
        Animated.spring(selectScale, {
          toValue: 1.04,
          useNativeDriver: true,
          tension: 220,
          friction: 5,
        }),
        Animated.spring(selectScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 180,
          friction: 8,
        }),
      ]).start();
    }
  }, [isSelected]);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }, { scale: selectScale }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function VipScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { adminRole } = useAdminRole(user?.id);
  const canSubmitTips = !!(adminRole as any)?.permissions?.manage_tips;

  // ─── Hero entrance animation ─────────────────────────────────────────────
  const heroOpacity    = useRef(new Animated.Value(0)).current;
  const heroScale      = useRef(new Animated.Value(0.85)).current;
  const titleOpacity   = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(heroScale, {
        toValue: 1,
        tension: 65,
        friction: 9,
        useNativeDriver: true,
      }),
      Animated.timing(heroOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
    Animated.timing(titleOpacity, {
      toValue: 1,
      duration: 350,
      delay: 200,
      useNativeDriver: true,
    }).start();
    Animated.timing(subtitleOpacity, {
      toValue: 1,
      duration: 350,
      delay: 340,
      useNativeDriver: true,
    }).start();
  }, []);

  // ─── Feature table column highlight animations ────────────────────────────
  // One Animated.Value per plan (0 = unselected, 1 = selected).
  // useNativeDriver: false is required for color interpolation.
  const planHighlightAnims = useRef<Record<string, Animated.Value>>({});

  const getPlanHighlightAnim = useCallback((planId: string, isInitiallySelected: boolean): Animated.Value => {
    if (!planHighlightAnims.current[planId]) {
      planHighlightAnims.current[planId] = new Animated.Value(isInitiallySelected ? 1 : 0);
    }
    return planHighlightAnims.current[planId];
  }, []);

  // Animate all plan columns whenever `selected` changes
  // Note: PLANS is derived later in the component but vipPlans is available here
  useEffect(() => {
    if (vipPlans.length === 0) return;
    vipPlans.forEach((p) => {
      const anim = planHighlightAnims.current[p.id];
      if (!anim) return;
      Animated.timing(anim, {
        toValue: p.id === selected ? 1 : 0,
        duration: 150,
        useNativeDriver: false,
      }).start();
    });
  }, [selected]);

  // ─── Active top tab ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<VipTab>('vip');
  const tabIndicatorAnim = useRef(new Animated.Value(0)).current;

  const switchTab = (tab: VipTab) => {
    setActiveTab(tab);
    Animated.spring(tabIndicatorAnim, {
      toValue: tab === 'vip' ? 0 : 1,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  };

  // ─── Coin balance ──────────────────────────────────────────────────────────
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const fetchCoinBalance = useCallback(async () => {
    if (!user?.id) return;
    setLoadingBalance(true);
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('user_coins')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      setCoinBalance(data?.balance ?? 0);
    } catch {
      setCoinBalance(0);
    } finally {
      setLoadingBalance(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchCoinBalance();
  }, [fetchCoinBalance]);

  // ─── IAP Hook ─────────────────────────────────────────────────────────────
  const {
    vipPlans,
    coinPacks,
    loadingProducts,
    purchasing,
    purchaseError,
    isVip,
    activePlan: activePlanId,
    vipExpiresAt,
    checkingVip,
    buyPlan,
    restorePurchases,
    clearError,
    connected,
    lastPurchasedId,
    iapAvailable,
    storeProducts,
  } = useIAP();

  const [selected, setSelected] = useState<PlanId>(vipPlans[1]?.id ?? 'predictx_vip_biannual');
  const [successVisible, setSuccessVisible] = useState(false);
  const [purchasedPlan, setPurchasedPlan] = useState<Plan | null>(null);
  const [coinSuccessVisible, setCoinSuccessVisible] = useState(false);
  const [purchasedCoinPack, setPurchasedCoinPack] = useState<Plan | null>(null);

  // Sync selected plan when vipPlans load
  useEffect(() => {
    if (vipPlans.length > 0 && !vipPlans.find((p) => p.id === selected)) {
      setSelected(vipPlans[1]?.id ?? vipPlans[0]?.id);
    }
  }, [vipPlans.length]);

  // Show success modal when a purchase completes
  useEffect(() => {
    if (lastPurchasedId) {
      const plan = vipPlans.find((p) => p.id === lastPurchasedId);
      if (plan) {
        setPurchasedPlan(plan);
        setSuccessVisible(true);
        return;
      }
      const coinPack = coinPacks.find((p) => p.id === lastPurchasedId) ??
        COIN_PACKS.find((p) => p.id === lastPurchasedId);
      if (coinPack) {
        setPurchasedCoinPack(coinPack);
        setCoinSuccessVisible(true);
        fetchCoinBalance(); // refresh balance after coin purchase
      }
    }
  }, [lastPurchasedId]);

  // Show purchase errors via alert
  useEffect(() => {
    if (purchaseError) {
      showAlert('Purchase Failed', purchaseError, [{ text: 'OK', onPress: clearError }]);
    }
  }, [purchaseError]);

  // ─── Schedule local notification when VIP is expiring within 7 days ─────────
  useEffect(() => {
    if (checkingVip || !isVip || !vipExpiresAt) return;

    const days = Math.max(0, Math.ceil((new Date(vipExpiresAt).getTime() - Date.now()) / 86400000));
    if (days > 7) return;

    const scheduleExpiryReminder = async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;

        // Cooldown: only fire once per 24 hours to avoid spam
        const lastRaw = await AsyncStorage.getItem(VIP_EXPIRY_NOTIF_KEY);
        if (lastRaw) {
          const lastTime = parseInt(lastRaw, 10);
          if (!isNaN(lastTime) && Date.now() - lastTime < 24 * 60 * 60 * 1000) return;
        }

        // Cancel any previously scheduled VIP expiry reminder
        const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
        const existing = allScheduled.filter((n) => n.identifier === 'vip_expiry_reminder');
        await Promise.all(existing.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));

        // Schedule the reminder to fire 5 seconds from now
        await Notifications.scheduleNotificationAsync({
          identifier: 'vip_expiry_reminder',
          content: {
            title: '⏳ VIP Expires Soon',
            body: `Your PredictXta VIP plan expires in ${days} day${days !== 1 ? 's' : ''}. Renew now to keep all your premium benefits.`,
            data: { screen: 'vip' },
          },
          trigger: { seconds: 5, repeats: false } as any,
        });

        await AsyncStorage.setItem(VIP_EXPIRY_NOTIF_KEY, String(Date.now()));
      } catch { /* non-blocking */ }
    };

    scheduleExpiryReminder();
  }, [checkingVip, isVip, vipExpiresAt]);

  const activePlan = vipPlans.find((p) => p.id === selected) ?? vipPlans[0];

  const handleSubscribe = useCallback(async () => {
    if (!user) {
      showAlert('Sign In Required', 'Please sign in to subscribe to VIP.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.replace('/login') },
      ]);
      return;
    }

    if (!connected) {
      showAlert(
        'Store Unavailable',
        'Unable to connect to the App Store. Please check your connection and try again.',
        [{ text: 'OK' }],
      );
      return;
    }

    if (!activePlan) return;
    await buyPlan(activePlan);
  }, [user, activePlan, showAlert, router, connected, buyPlan]);

  const handleBuyCoinPack = useCallback(async (pack: IAPPlan) => {
    if (!user) {
      showAlert('Sign In Required', 'Please sign in to purchase coins.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.replace('/login') },
      ]);
      return;
    }
    const result = await buyPlan(pack);
    if (!result.success && result.error && result.error !== 'cancelled') {
      showAlert('Purchase Failed', result.error, [{ text: 'OK' }]);
    }
  }, [user, buyPlan, showAlert, router]);

  const handleSuccessDismiss = () => {
    setSuccessVisible(false);
    router.back();
  };

  // Use vipPlans from hook as PLANS
  const PLANS = vipPlans;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#120D00', '#070B14']} style={StyleSheet.absoluteFill} />

      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={loadingBalance}
                onRefresh={fetchCoinBalance}
                tintColor={COLORS.primary}
                colors={[COLORS.primary]}
              />
            }
          >

          {/* Nav bar */}
          <View style={styles.nav}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </Pressable>
          </View>

          {/* Hero */}
          <View style={styles.hero}>
            {/* Logo glow ring — animated entrance matching splash/login/onboarding */}
            <Animated.View
              style={[
                styles.logoGlowOuter,
                { opacity: heroOpacity, transform: [{ scale: heroScale }] },
              ]}
            >
              <View style={styles.logoGlowInner}>
                <View style={styles.logoTile}>
                  <Image
                    source={require('@/assets/logo.png')}
                    style={styles.logoImg}
                    contentFit="contain"
                    transition={0}
                  />
                </View>
              </View>
            </Animated.View>
            <View style={styles.heroNameRow}>
              <Text style={[styles.heroNameWhite, { color: COLORS.primary }]}>PredictXta VIP</Text>
            </View>
            <Animated.Text style={[styles.heroSubtitle, { opacity: subtitleOpacity }]}>
              Unlock the full power of AI sports intelligence with expert tips and unlimited predictions.
            </Animated.Text>
          </View>

          {/* Tab Switcher */}
          <View style={styles.tabSwitcher}>
            <Pressable
              style={[styles.tabSwitcherBtn, activeTab === 'vip' ? styles.tabSwitcherBtnActive : null]}
              onPress={() => switchTab('vip')}
            >
              <FontAwesome5 name="crown" size={13} color={activeTab === 'vip' ? '#070B14' : COLORS.textMuted} solid />
              <Text style={[styles.tabSwitcherLabel, activeTab === 'vip' ? styles.tabSwitcherLabelActive : null]}>
                VIP Plans
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabSwitcherBtn, activeTab === 'coins' ? styles.tabSwitcherBtnActive : null]}
              onPress={() => switchTab('coins')}
            >
              <FontAwesome5 name="coins" size={13} color={activeTab === 'coins' ? '#070B14' : COLORS.textMuted} solid />
              <Text style={[styles.tabSwitcherLabel, activeTab === 'coins' ? styles.tabSwitcherLabelActive : null]}>
                Coins
              </Text>
              {coinBalance !== null && coinBalance > 0 ? (
                <View style={styles.tabCoinBadge}>
                  <Text style={styles.tabCoinBadgeText}>{coinBalance.toLocaleString()}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* ── COINS TAB ── */}
          {activeTab === 'coins' ? (
            <CoinsTab
              coinBalance={coinBalance}
              loadingBalance={loadingBalance}
              coinPacks={coinPacks}
              onBuy={handleBuyCoinPack}
              purchasing={purchasing}
              iapAvailable={iapAvailable}
              storeProducts={storeProducts}
            />
          ) : null}

          {/* ── VIP TAB ── */}
          {activeTab !== 'coins' ? (
          <>
          {/* VIP Tips Feed */}
          <VipTipsFeed
            isVip={isVip}
            canSubmit={canSubmitTips}
            onSubmit={() => router.push('/submit-tip' as any)}
            onUpgrade={() => {
              // Scroll to plan selection is handled by the same screen layout
              // Nudge user by highlighting the quarterly plan
              setSelected('predictx_vip_biannual');
            }}
          />

          {/* Plan Cards */}
          {loadingProducts ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 8 }}>Loading prices...</Text>
            </View>
          ) : (
          <View style={styles.plansRow}>
            {PLANS.map((plan, index) => {
              const isSelected = selected === plan.id;
              return (
                <AnimatedPlanCardWrapper key={plan.id} index={index} isSelected={isSelected}>
                <Pressable
                  style={[
                    styles.planCard,
                    isSelected ? { borderColor: plan.accentColor, backgroundColor: `${plan.accentColor}14` } : null,
                  ]}
                  onPress={() => setSelected(plan.id)}
                >
                  {/* Most Popular badge */}
                  {plan.mostPopular ? (
                    <View style={[styles.popularBadge, { backgroundColor: plan.accentColor }]}>
                      <Text style={styles.popularText}>POPULAR</Text>
                    </View>
                  ) : null}

                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={[styles.planPrice, { color: plan.accentColor }]}>{plan.fallbackPrice}</Text>
                  <Text style={styles.planBilling}>{plan.description}</Text>

                  {plan.savingLabel ? (
                    <View style={[styles.savingBadge, { backgroundColor: `${plan.accentColor}22`, borderColor: `${plan.accentColor}44` }]}>
                      <Text style={[styles.savingText, { color: plan.accentColor }]}>{plan.savingLabel}</Text>
                    </View>
                  ) : null}

                  {/* Selected checkmark */}
                  {isSelected ? (
                    <View style={[styles.checkWrap, { backgroundColor: plan.accentColor }]}>
                      <Ionicons name="checkmark" size={12} color={COLORS.textInverse} />
                    </View>
                  ) : null}
                </Pressable>
                </AnimatedPlanCardWrapper>
              );
            })}
          </View>
          )}

          {/* Feature Comparison Table */}
          <View style={styles.featureTable}>
            <Text style={styles.featureTableTitle}>Features Comparison</Text>

            {/* Header row */}
            <View style={styles.featureHeaderRow}>
              <View style={styles.featureLabelCol} />
              {PLANS.map((p) => {
                const hlAnim = getPlanHighlightAnim(p.id, selected === p.id);
                const animatedBg = hlAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['rgba(0,0,0,0)', `${p.accentColor}16`],
                });
                const animatedBorderColor = hlAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['rgba(0,0,0,0)', p.accentColor],
                });
                const animatedTextColor = hlAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [COLORS.textMuted, p.accentColor],
                });
                return (
                  <Animated.View
                    key={p.id}
                    style={[
                      styles.featureCol,
                      {
                        backgroundColor: animatedBg,
                        borderBottomWidth: 2,
                        borderBottomColor: animatedBorderColor,
                      },
                    ]}
                  >
                    <Animated.Text
                      style={[styles.featureColHeader, { color: animatedTextColor }]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Animated.Text>
                  </Animated.View>
                );
              })}
            </View>

            {/* Feature rows */}
            {FEATURES.map((f, idx) => (
              <View key={f.label} style={[styles.featureRow, idx % 2 === 0 ? styles.featureRowAlt : null]}>
                {/* Feature label */}
                <View style={styles.featureLabelCol}>
                  <FontAwesome5
                    name={f.icon as any}
                    size={11}
                    color={f.highlight ? COLORS.primary : COLORS.textMuted}
                  />
                  <Text style={[styles.featureLabel, f.highlight ? styles.featureLabelHighlight : null]}>
                    {f.label}
                  </Text>
                </View>
                {/* Availability per plan — animated column highlight */}
                {PLANS.map((p) => {
                  const included = f[p.id as keyof typeof f] as boolean | undefined;
                  const hlAnim = getPlanHighlightAnim(p.id, selected === p.id);
                  const animatedCellBg = hlAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['rgba(0,0,0,0)', `${p.accentColor}10`],
                  });
                  return (
                    <Animated.View
                      key={p.id}
                      style={[styles.featureCol, { backgroundColor: animatedCellBg }]}
                    >
                      {included ? (
                        <Ionicons name="checkmark-circle" size={18} color={p.accentColor} />
                      ) : (
                        <Ionicons name="remove-circle-outline" size={18} color={COLORS.border} />
                      )}
                    </Animated.View>
                  );
                })}
              </View>
            ))}
          </View>

          {/* Active VIP Banner */}
          {isVip ? (
            <View style={[styles.activeBanner, { backgroundColor: 'rgba(255,215,0,0.12)', borderColor: 'rgba(255,215,0,0.35)' }]}>
              <FontAwesome5 name="crown" size={16} color={COLORS.primary} solid />
              <View style={{ flex: 1 }}>
                <Text style={[styles.activeBannerTitle, { color: COLORS.primary }]}>VIP Active</Text>
                {vipExpiresAt ? (
                  <Text style={[styles.activeBannerSub, { color: COLORS.textMuted }]}>
                    Expires {new Date(vipExpiresAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                {vipExpiresAt ? (() => {
                  const days = Math.max(0, Math.ceil((new Date(vipExpiresAt).getTime() - Date.now()) / 86400000));
                  return (
                    <View style={styles.daysChip}>
                      <Text style={styles.daysChipText}>{days} day{days !== 1 ? 's' : ''} left</Text>
                    </View>
                  );
                })() : null}
              </View>
            </View>
          ) : null}

          {/* IAP not available banner */}
          {!iapAvailable ? (
            <View style={[styles.iapUnavailableBanner, { backgroundColor: 'rgba(255,215,0,0.08)', borderColor: 'rgba(255,215,0,0.25)' }]}>
              <Ionicons name="information-circle-outline" size={16} color="rgba(255,215,0,0.7)" />
              <Text style={styles.iapUnavailableText}>
                In-App Purchases require a release build from the App Store or Google Play. This preview build does not support native payments.
              </Text>
            </View>
          ) : null}

          {/* CTA */}
          {!isVip ? (
          <View style={styles.ctaSection}>
            <Pressable
              style={({ pressed }) => [
                styles.subscribeBtn,
                (purchasing || !iapAvailable) ? styles.subscribeBtnDisabled : null,
                pressed && !purchasing && iapAvailable ? styles.subscribeBtnPressed : null,
              ]}
              onPress={handleSubscribe}
              disabled={purchasing || !activePlan || !iapAvailable}
            >
              <LinearGradient
                colors={activePlan ? [activePlan.accentColor, `${activePlan.accentColor}BB`] as [string,string] : ['#FFD700', '#CC9900'] as [string,string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.subscribeGradient}
              >
                {purchasing ? (
                  <>
                    <ActivityIndicator size="small" color={COLORS.textInverse} />
                    <Text style={styles.subscribeBtnText}>Processing...</Text>
                  </>
                ) : (
                  <>
                    <FontAwesome5 name="crown" size={15} color={COLORS.textInverse} />
                    <Text style={styles.subscribeBtnText}>
                      {activePlan ? `Get ${activePlan.name} VIP — ${activePlan.fallbackPrice}` : 'Subscribe to VIP'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
            <Text style={styles.ctaNote}>
              {activePlan?.isSubscription ? 'Recurring subscription. Cancel anytime.' : 'One-time purchase. No recurring charges.'}
            </Text>
            {Platform.OS === 'ios' ? (
              <Pressable onPress={restorePurchases} style={styles.restoreBtn}>
                <Text style={styles.restoreBtnText}>Restore Purchases</Text>
              </Pressable>
            ) : null}
          </View>
          ) : null}

          {/* Testimonials */}
          <View style={styles.testimonialsSection}>
            <Text style={styles.testimonialsTitle}>What Members Say</Text>
            {TESTIMONIALS.map((t, i) => (
              <View key={i} style={styles.testimonialCard}>
                <View style={styles.testimonialHeader}>
                  <View style={[styles.testimonialAvatar, { backgroundColor: t.color }]}>
                    <Text style={styles.testimonialInitial}>{t.name[0]}</Text>
                  </View>
                  <View>
                    <Text style={styles.testimonialName}>{t.name}</Text>
                    <Text style={styles.testimonialStars}>{'★'.repeat(t.stars)}</Text>
                  </View>
                </View>
                <Text style={styles.testimonialText}>{t.text}</Text>
              </View>
            ))}
          </View>

          {/* Legal Disclaimer */}
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: 8 }}>
            <DisclaimerBanner variant="vip" compact />
          </View>
          <View style={{ height: 24 }} />
          </>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {/* ─── Coin Purchase Success Modal ──────────────────────────────────── */}
      <Modal
        visible={coinSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setCoinSuccessVisible(false); }}
      >
        <View style={modalStyles.overlay}>
          <View style={modalStyles.sheet}>
            <LinearGradient
              colors={[COLORS.primary, '#FFA500']}
              style={modalStyles.crownRing}
            >
              <FontAwesome5 name="coins" size={36} color="#070B14" solid />
            </LinearGradient>

            <Text style={modalStyles.successTitle}>Coins Added!</Text>
            <Text style={modalStyles.successPlan}>
              {purchasedCoinPack?.coinAmount?.toLocaleString()} Coins Credited
            </Text>
            <Text style={modalStyles.successBody}>
              Your coins have been added to your wallet. Use them to unlock premium AI analysis and exclusive features.
            </Text>

            <View style={modalStyles.expiryRow}>
              <FontAwesome5 name="coins" size={13} color={COLORS.primary} solid />
              <Text style={modalStyles.expiryText}>
                New balance: {((coinBalance ?? 0) + (purchasedCoinPack?.coinAmount ?? 0)).toLocaleString()} coins
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [modalStyles.doneBtn, pressed ? { opacity: 0.85 } : null]}
              onPress={() => setCoinSuccessVisible(false)}
            >
              <Text style={modalStyles.doneBtnText}>Great, Thanks!</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ─── Success Modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={successVisible}
        transparent
        animationType="fade"
        onRequestClose={handleSuccessDismiss}
      >
        <View style={modalStyles.overlay}>
          <View style={modalStyles.sheet}>
            {/* Glow ring */}
            <LinearGradient
              colors={[purchasedPlan?.accentColor ?? COLORS.primary, `${purchasedPlan?.accentColor ?? COLORS.primary}55`]}
              style={modalStyles.crownRing}
            >
              <FontAwesome5 name="crown" size={36} color={COLORS.textInverse} />
            </LinearGradient>

            <Text style={modalStyles.successTitle}>Welcome to VIP!</Text>
            <Text style={modalStyles.successPlan}>
              {purchasedPlan?.name} Plan Activated
            </Text>
            <Text style={modalStyles.successBody}>
              Your subscription is now active. Enjoy unlimited AI picks, VIP tips, and an ad-free experience.
            </Text>

            {/* Expiry info */}
            {purchasedPlan ? (
              <View style={modalStyles.expiryRow}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
                <Text style={modalStyles.expiryText}>
                  Valid for {purchasedPlan.daysValid} days — expires{' '}
                  {new Date(Date.now() + purchasedPlan.daysValid * 86400000).toLocaleDateString([], {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </View>
            ) : null}

            {/* Feature highlights */}
            <View style={modalStyles.highlights}>
              {FEATURES.filter((f) => purchasedPlan && f[purchasedPlan.id]).slice(0, 4).map((f) => (
                <View key={f.label} style={modalStyles.highlightRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.accent} />
                  <Text style={modalStyles.highlightText}>{f.label}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [modalStyles.doneBtn, pressed ? { opacity: 0.85 } : null]}
              onPress={handleSuccessDismiss}
            >
              <Text style={modalStyles.doneBtnText}>Start Exploring</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Testimonials data ───────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    name: 'Marcus T.',
    stars: 5,
    color: COLORS.accentBlue,
    text: 'The AI predictions are incredibly accurate. Up 30% on my portfolio since joining VIP.',
  },
  {
    name: 'Sarah K.',
    stars: 5,
    color: COLORS.accentPurple,
    text: 'Expert tips and the analytics dashboard are worth every penny. Best sports app out there.',
  },
  {
    name: 'Jordan R.',
    stars: 4,
    color: COLORS.accent,
    text: 'Real value in the AI picks. The BTTS and Over/Under predictions are especially sharp.',
  },
];

// ─── Coin Tab Styles ─────────────────────────────────────────────────────────
const coinStyles = StyleSheet.create({
  container: { paddingHorizontal: SPACING.md, gap: 12 },

  // Balance card
  balanceCard: { borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)' },
  balanceGradient: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14, overflow: 'hidden' },
  balanceIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,215,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  balanceLabel: { fontSize: 11, color: 'rgba(255,215,0,0.6)', fontWeight: FONTS.semiBold, marginBottom: 4 },
  balanceAmount: { fontSize: 30, fontWeight: FONTS.extraBold, color: COLORS.primary },
  balanceUnit: { fontSize: 14, fontWeight: FONTS.medium, color: 'rgba(255,215,0,0.6)' },
  balanceRightDecor: { position: 'absolute', right: -8, bottom: -8, opacity: 0.6 },

  // Info card
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: COLORS.accentBlueDim, borderRadius: RADIUS.md,
    padding: 12, borderWidth: 1, borderColor: `${COLORS.accentBlue}22`,
  },
  infoText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },

  // IAP unavailable notice
  unavailableNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: RADIUS.md,
    padding: 12, borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
  },
  unavailableText: { flex: 1, fontSize: 12, color: 'rgba(255,215,0,0.6)', lineHeight: 18 },

  // Pack header
  packHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  packHeaderTitle: { fontSize: 16, fontWeight: FONTS.bold, color: COLORS.textPrimary, flex: 1 },
  packHeaderBadge: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.border,
  },
  packHeaderBadgeText: { fontSize: 9, fontWeight: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.8 },

  // Pack list
  packList: { gap: 10 },

  // Coin pack card
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 16, gap: 12, overflow: 'hidden', position: 'relative',
  },
  popularBadge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  popularText: { fontSize: 9, fontWeight: FONTS.extraBold, color: '#070B14', letterSpacing: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { fontSize: 36, lineHeight: 42 },
  packName: { fontSize: 17, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginBottom: 2 },
  packDesc: { fontSize: 12, color: COLORS.textMuted },
  savingBadge: { borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  savingText: { fontSize: 11, fontWeight: FONTS.bold },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coinCount: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  coinCountText: { fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.primary },
  buyBtn: {
    borderRadius: RADIUS.full, paddingHorizontal: 20, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center', minWidth: 90,
  },
  buyBtnDisabled: { opacity: 0.55 },
  buyBtnText: { fontSize: 15, fontWeight: FONTS.extraBold, color: '#070B14' },

  // Earn section
  earnSection: { gap: 8, marginTop: 4 },
  earnTitle: { fontSize: 16, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginBottom: 4 },
  earnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  earnIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  earnLabel: { fontSize: 13, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginBottom: 2 },
  earnDesc: { fontSize: 11, color: COLORS.textMuted, lineHeight: 16 },
  earnCoinBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1,
  },
  earnCoinText: { fontSize: 12, fontWeight: FONTS.bold },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: 20 },

  // Nav
  nav: {
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm,
    alignItems: 'flex-end',
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },

  // Hero
  hero: {
    alignItems: 'center', paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm, paddingBottom: SPACING.lg,
  },
  logoGlowOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,215,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 10,
  },
  logoGlowInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTile: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.32)',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.40,
    shadowRadius: 14,
    elevation: 12,
  },
  logoImg: { width: '100%', height: '100%' },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroNameWhite: {
    fontSize: 30,
    fontWeight: FONTS.extraBold,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  heroGradientX: {
    width: 22,
    height: 40,
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22,
  },

  // Active banner
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    borderRadius: RADIUS.lg, padding: 14, borderWidth: 1,
  },
  activeBannerTitle: { fontSize: 14, fontWeight: FONTS.bold },
  activeBannerSub: { fontSize: 11, marginTop: 2 },
  daysChip: {
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  daysChipText: { fontSize: 10, fontWeight: FONTS.bold, color: COLORS.primary },

  // IAP unavailable banner
  iapUnavailableBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    borderRadius: RADIUS.lg, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  iapUnavailableText: {
    flex: 1, fontSize: 12, color: 'rgba(255,215,0,0.65)', lineHeight: 18,
  },

  // Restore button
  restoreBtn: { alignItems: 'center', paddingVertical: 6 },
  restoreBtnText: { fontSize: 12, color: COLORS.textMuted, textDecorationLine: 'underline' },

  // Tab switcher
  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.full,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabSwitcherBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, gap: 7, borderRadius: RADIUS.full,
  },
  tabSwitcherBtnActive: { backgroundColor: COLORS.primary },
  tabSwitcherLabel: { fontSize: 14, fontWeight: FONTS.semiBold, color: COLORS.textMuted },
  tabSwitcherLabelActive: { color: '#070B14', fontWeight: FONTS.bold },
  tabCoinBadge: {
    backgroundColor: '#070B14', borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  tabCoinBadgeText: { fontSize: 10, fontWeight: FONTS.bold, color: COLORS.primary },

  // Plan cards
  plansRow: {
    flexDirection: 'row', paddingHorizontal: SPACING.md,
    gap: 10, marginBottom: SPACING.lg,
  },
  planCard: {
    flex: 1, alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl, paddingVertical: 18, paddingHorizontal: 8,
    borderWidth: 1, borderColor: COLORS.border, gap: 5, position: 'relative',
    minHeight: 130,
  },
  popularBadge: {
    position: 'absolute', top: -11, borderRadius: RADIUS.full,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  popularText: {
    fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.textInverse, letterSpacing: 1.2,
  },
  planName: { fontSize: 12, color: COLORS.textSecondary, fontWeight: FONTS.semiBold, marginTop: 10 },
  planPrice: { fontSize: 24, fontWeight: FONTS.extraBold },
  planBilling: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center' },
  savingBadge: {
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, marginTop: 2,
  },
  savingText: { fontSize: 10, fontWeight: FONTS.bold },
  checkWrap: {
    position: 'absolute', bottom: 10, right: 10,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },

  // Feature table
  featureTable: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.lg,
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  featureTableTitle: {
    fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textSecondary,
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  featureHeaderRow: {
    flexDirection: 'row', paddingHorizontal: SPACING.md,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  featureLabelCol: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 7 },
  featureCol: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  featureColHeader: { fontSize: 11, fontWeight: FONTS.bold, color: COLORS.textMuted },
  featureRow: {
    flexDirection: 'row', paddingHorizontal: SPACING.md,
    paddingVertical: 11, alignItems: 'center',
  },
  featureRowAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  featureLabel: { fontSize: 12, color: COLORS.textSecondary, flex: 1 },
  featureLabelHighlight: { color: COLORS.textPrimary, fontWeight: FONTS.semiBold },

  // CTA
  ctaSection: { paddingHorizontal: SPACING.md, gap: 10, marginBottom: SPACING.lg },
  subscribeBtn: { borderRadius: RADIUS.full, overflow: 'hidden' },
  subscribeBtnDisabled: { opacity: 0.65 },
  subscribeBtnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  subscribeGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 17, gap: 10,
  },
  subscribeBtnText: {
    fontSize: 16, fontWeight: FONTS.extraBold, color: COLORS.textInverse, letterSpacing: 0.3,
  },
  ctaNote: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },

  // Testimonials
  testimonialsSection: { paddingHorizontal: SPACING.md, gap: 10 },
  testimonialsTitle: { fontSize: 16, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginBottom: 2 },
  testimonialCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 8,
  },
  testimonialHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  testimonialAvatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  testimonialInitial: { fontSize: 15, fontWeight: FONTS.bold, color: COLORS.textInverse },
  testimonialName: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  testimonialStars: { fontSize: 12, color: COLORS.primary },
  testimonialText: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
});

// ─── VIP Tip Styles ──────────────────────────────────────────────────────────
const tipStyles = StyleSheet.create({
  feedSection: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.lg,
    gap: 12,
  },
  feedHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  feedHeaderLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 7,
  },
  feedHeaderTitle: {
    fontSize: 14, fontWeight: FONTS.extraBold, color: COLORS.textInverse, letterSpacing: 0.3,
  },
  feedHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,71,87,0.15)', borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accentRed },
  liveText: { fontSize: 9, fontWeight: FONTS.extraBold, color: COLORS.accentRed, letterSpacing: 1 },
  feedCount: { fontSize: 11, color: COLORS.textMuted, fontWeight: FONTS.medium },
  feedDesc: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: COLORS.accentBlueDim, borderRadius: RADIUS.md,
    padding: 10, borderWidth: 1, borderColor: `${COLORS.accentBlue}22`,
  },
  feedDescText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, flex: 1 },

  // Unlocked tip card
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xl,
    padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sport: { fontSize: 20, lineHeight: 24 },
  league: { fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.medium },
  matchName: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary, marginTop: 1 },
  confArc: {
    width: 50, height: 50, borderRadius: 25, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  confNum: { fontSize: 13, fontWeight: FONTS.extraBold },
  confLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: FONTS.medium },
  betRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  betTypePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5,
  },
  betTypeText: { fontSize: 12, fontWeight: FONTS.bold },
  oddsChip: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  oddsLabel: { fontSize: 8, color: COLORS.textMuted, fontWeight: FONTS.bold, letterSpacing: 0.8 },
  oddsValue: { fontSize: 14, fontWeight: FONTS.extraBold, color: COLORS.accent },
  kickoffChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  kickoffText: { fontSize: 11, color: COLORS.textMuted, fontWeight: FONTS.medium },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  starsLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: FONTS.medium },
  divider: { height: 1, backgroundColor: COLORS.border },
  tipsterSection: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tipsterAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  tipsterInitial: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textInverse },
  tipsterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 },
  tipsterName: { fontSize: 12, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  expertBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  expertBadgeText: { fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.primary, letterSpacing: 0.8 },
  tipsterNote: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 19 },

  // Locked tip card
  lockedOuter: {
    borderRadius: RADIUS.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
    minHeight: 140,
  },
  lockedBlurTarget: {
    padding: 14, gap: 10,
    backgroundColor: COLORS.card,
  },
  lockedFakeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lockedFakeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedFakeNote: { gap: 6, marginTop: 4 },
  lockedFakeLine: {
    height: 8, borderRadius: 4, backgroundColor: COLORS.border,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  lockContent: { alignItems: 'center', gap: 6, zIndex: 2 },
  lockIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryGlow, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  lockTitle: { fontSize: 14, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  lockSub: { fontSize: 12, color: COLORS.textMuted },

  // Upgrade CTA bar
  upgradeCta: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  upgradeCtaTitle: { fontSize: 13, fontWeight: FONTS.bold, color: COLORS.textPrimary },
  upgradeCtaSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  upgradeBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  upgradeBtnText: { fontSize: 13, fontWeight: FONTS.bold, color: COLORS.textInverse },
  submitExpertBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.lg,
    padding: 12, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  submitExpertBtnText: { flex: 1, fontSize: 13, fontWeight: FONTS.bold, color: COLORS.primary },
  expertBadgeSmall: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  expertBadgeSmallText: { fontSize: 8, fontWeight: FONTS.extraBold, color: COLORS.textInverse, letterSpacing: 0.8 },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────
const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(7,11,20,0.9)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  sheet: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.xxl,
    padding: SPACING.xl, alignItems: 'center', gap: 14,
    width: '100%', maxWidth: 380,
    borderWidth: 1, borderColor: COLORS.border,
  },
  crownRing: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: {
    fontSize: 24, fontWeight: FONTS.extraBold, color: COLORS.textPrimary, textAlign: 'center',
  },
  successPlan: {
    fontSize: 14, fontWeight: FONTS.bold, color: COLORS.primary,
    backgroundColor: COLORS.primaryGlow, borderRadius: RADIUS.full,
    paddingHorizontal: 16, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  successBody: {
    fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21,
  },
  expiryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: COLORS.border, width: '100%',
  },
  expiryText: { fontSize: 12, color: COLORS.textMuted, flex: 1 },
  highlights: { width: '100%', gap: 8 },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  highlightText: { fontSize: 13, color: COLORS.textSecondary },
  doneBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: 32,
    alignItems: 'center', justifyContent: 'center',
    width: '100%', marginTop: 4,
  },
  doneBtnText: { fontSize: 16, fontWeight: FONTS.bold, color: COLORS.textInverse },
});
