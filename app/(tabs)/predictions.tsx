/**
 * AI Picks — Refactored UI/UX
 * - Header reduced 20%
 * - Date nav: perfectly centered, auto-scroll to selected, 11 dates (−3 to +7)
 * - Sports nav reduced 5%, "All" removed
 * - Market filter bar reduced 10%, sport-dynamic
 * - "All Predicted" compacted 40%
 * - Hierarchical drill-down: Sport → Country → League → Fixture
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, Pressable,
  ScrollView, RefreshControl, ActivityIndicator,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { useAIPicks } from '@/hooks/useAIPicks';
import type { AIPicksLeague, AIPick, BatchGenResult } from '@/services/aiPicksService';
import { usePredictionsFeed } from '@/hooks/usePredictionsFeed';
import { getConfidenceColor } from '@/services/predictionsFeedService';
import { useRouter } from 'expo-router';
import { getRiskColor } from '@/services/predictionService';
import { AIPicksSkeleton } from '@/components/feature/SkeletonLoader';
import { useRecommendations } from '@/hooks/useRecommendations';
import { useAuth } from '@/template';
import type { MatchRecommendation } from '@/services/recommendationEngine';
import { AccuracyBadge } from '@/components/feature/AccuracyBadge';
import { DisclaimerBanner } from '@/components/ui/DisclaimerBanner';
import {
  getPredChipConfig, getSportFamily, getAvailablePredFilters,
  getSportMarketGroups,
} from '@/services/sportConfig';

// ─── Constants ────────────────────────────────────────────────────────────────
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Date pill dimensions — reduced 5% from original
const DATE_PILL_W = 49;
const DATE_PILL_GAP = 5;

/** All sports that have DB data seeded / actively synced */
const DB_ACTIVE_SPORTS = new Set([
  'Football', 'Basketball', 'Tennis', 'Table Tennis', 'Cricket', 'Baseball',
  'Hockey', 'Rugby', 'American Football', 'MMA', 'Boxing', 'Volleyball',
  'Handball', 'Esports', 'Formula 1', 'Badminton', 'Snooker', 'Darts',
  'Cycling', 'Athletics', 'AFL',
]);
/** Sports that go off-season */
const DB_SEASONAL_SPORTS = new Set(['Basketball', 'Cricket', 'American Football', 'AFL']);

// Map DB sport keys (lowercase-hyphenated) → UI chip IDs (display names)
const DB_KEY_TO_CHIP_ID: Record<string, string> = {
  'football': 'Football', 'basketball': 'Basketball', 'tennis': 'Tennis',
  'table-tennis': 'Table Tennis', 'cricket': 'Cricket', 'baseball': 'Baseball',
  'hockey': 'Hockey', 'rugby': 'Rugby', 'american-football': 'American Football',
  'mma': 'MMA', 'boxing': 'Boxing', 'volleyball': 'Volleyball',
  'handball': 'Handball', 'esports': 'Esports', 'formula-1': 'Formula 1',
  'formula1': 'Formula 1', 'badminton': 'Badminton', 'snooker': 'Snooker',
  'darts': 'Darts', 'cycling': 'Cycling', 'athletics': 'Athletics', 'afl': 'AFL',
};

// ─── Supported sports — "All" removed per spec ───────────────────────────────
const SPORT_CHIPS = [
  { id: 'Football',          label: 'Football',          emoji: '⚽' },
  { id: 'Basketball',        label: 'Basketball',        emoji: '🏀' },
  { id: 'Tennis',            label: 'Tennis',            emoji: '🎾' },
  { id: 'Cricket',           label: 'Cricket',           emoji: '🏏' },
  { id: 'Baseball',          label: 'Baseball',          emoji: '⚾' },
  { id: 'Hockey',            label: 'Ice Hockey',        emoji: '🏒' },
  { id: 'Rugby',             label: 'Rugby',             emoji: '🏉' },
  { id: 'American Football', label: 'NFL/American FB',   emoji: '🏈' },
  { id: 'MMA',               label: 'MMA/UFC',           emoji: '🥊' },
  { id: 'Boxing',            label: 'Boxing',            emoji: '🥊' },
  { id: 'Volleyball',        label: 'Volleyball',        emoji: '🏐' },
  { id: 'Handball',          label: 'Handball',          emoji: '🤾' },
  { id: 'Esports',           label: 'Esports',           emoji: '🎮' },
  { id: 'Formula 1',         label: 'Formula 1',         emoji: '🏎️' },
  { id: 'Table Tennis',      label: 'Table Tennis',      emoji: '🏓' },
  { id: 'Badminton',         label: 'Badminton',         emoji: '🏸' },
  { id: 'Snooker',           label: 'Snooker',           emoji: '🎱' },
  { id: 'Darts',             label: 'Darts',             emoji: '🎯' },
  { id: 'Cycling',           label: 'Cycling',           emoji: '🚴' },
  { id: 'Athletics',         label: 'Athletics',         emoji: '🏃' },
  { id: 'AFL',               label: 'AFL',               emoji: '🏉' },
];

// ─── Sport-specific dynamic market filters ────────────────────────────────────
type PredFilter = 'All' | 'home_win' | 'draw' | 'away_win' | 'over' | 'under' | 'btts_yes' | 'btts_no' | 'high_conf';

const ALL_PRED_CHIPS: { id: PredFilter; label: string; icon: string; color: string }[] = [
  { id: 'All',       label: 'All',       icon: 'apps-outline',            color: '#F59E0B' },
  { id: 'home_win',  label: 'Home Win',  icon: 'home-outline',            color: '#6366F1' },
  { id: 'draw',      label: 'Draw',      icon: 'remove-outline',          color: '#818CF8' },
  { id: 'away_win',  label: 'Away Win',  icon: 'airplane-outline',        color: '#EC4899' },
  { id: 'over',      label: 'Over',      icon: 'trending-up-outline',     color: '#22C55E' },
  { id: 'under',     label: 'Under',     icon: 'trending-down-outline',   color: '#EF4444' },
  { id: 'btts_yes',  label: 'BTTS Yes',  icon: 'swap-horizontal-outline', color: '#14B8A6' },
  { id: 'btts_no',   label: 'BTTS No',   icon: 'close-circle-outline',    color: '#F97316' },
  { id: 'high_conf', label: 'High Conf', icon: 'shield-checkmark-outline',color: '#A855F7' },
];

function getChipsForSport(sport: string) {
  const allowed = new Set(getAvailablePredFilters(sport));
  return ALL_PRED_CHIPS.filter((c) => allowed.has(c.id));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
interface DateItem { offset: number; dayAbbr: string; dayNum: string; monthAbbr: string; isToday: boolean; isPast: boolean; }

// Phase 7 (updated): 6 dates — Day -2, Day -1, TODAY, Day +1, Day +2, Day +3
function buildDateItems(): DateItem[] {
  const today = new Date();
  return [-2, -1, 0, 1, 2, 3].map((offset) => {
    const d = new Date(today); d.setDate(today.getDate() + offset);
    return {
      offset,
      dayAbbr: DAY_NAMES[d.getDay()],
      dayNum: String(d.getDate()).padStart(2, '0'),
      monthAbbr: MONTH_NAMES[d.getMonth()],
      isToday: offset === 0,
      isPast: offset < 0,
    };
  });
}
const DATE_ITEMS = buildDateItems();
const TODAY_INDEX = 2; // always index 2 in the 6-pill row

function matchPassesPredFilter(m: AIPick, filter: PredFilter): boolean {
  if (filter === 'All') return true;
  if (!m.hasPrediction) return false;
  switch (filter) {
    case 'home_win':  return m.predictedResult === 'home_win';
    case 'draw':      return m.predictedResult === 'draw';
    case 'away_win':  return m.predictedResult === 'away_win';
    case 'over':      return m.overUnder === 'over';
    case 'under':     return m.overUnder === 'under';
    case 'btts_yes':  return m.btts === 'yes';
    case 'btts_no':   return m.btts === 'no';
    case 'high_conf': return (m.confidence ?? 0) >= 75;
    default: return true;
  }
}

// ─── Country groups ───────────────────────────────────────────────────────────
interface CountryGroup { country: string; flag: string; leagues: AIPicksLeague[]; totalMatches: number; totalLive: number; hasPredictions: boolean; }

function groupLeaguesByCountry(leagues: AIPicksLeague[]): CountryGroup[] {
  const map = new Map<string, CountryGroup>();
  for (const league of leagues) {
    const key = league.country || 'International';
    if (!map.has(key)) map.set(key, { country: key, flag: league.flag ?? '🌍', leagues: [], totalMatches: 0, totalLive: 0, hasPredictions: false });
    const g = map.get(key)!;
    g.leagues.push(league);
    g.totalMatches += league.matches.length;
    g.totalLive += league.matches.filter((m) => m.status === 'live').length;
    if (league.matches.some((m) => m.hasPrediction)) g.hasPredictions = true;
  }
  return Array.from(map.values()).sort((a, b) => b.totalLive - a.totalLive || a.country.localeCompare(b.country));
}

// ─── LivePulseDot ─────────────────────────────────────────────────────────────
function LivePulseDot({ color }: { color: string }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.15, duration: 550, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1,    duration: 550, useNativeDriver: true }),
    ])); p.start(); return () => p.stop();
  }, [op]);
  return <Animated.View style={[shared.pulseDot, { backgroundColor: color, opacity: op }]} />;
}

// ─── PulsingLiveBadge ─────────────────────────────────────────────────────────
function PulsingLiveBadge({ count }: { count: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1,   duration: 600, useNativeDriver: true }),
    ])); p.start(); return () => p.stop();
  }, [op]);
  return (
    <View style={plb.wrap}>
      <Animated.View style={[plb.dot, { opacity: op }]} />
      <Text style={plb.label}>LIVE</Text>
      {count > 1 ? <View style={plb.countBadge}><Text style={plb.countText}>{count}</Text></View> : null}
    </View>
  );
}
const plb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,71,87,0.12)', borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)', paddingHorizontal: 7, paddingVertical: 3 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4757' },
  label: { fontSize: 9, fontWeight: '800' as any, color: '#FF4757', letterSpacing: 0.5 },
  countBadge: { backgroundColor: '#FF4757', borderRadius: 99, minWidth: 14, height: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countText: { fontSize: 8, fontWeight: '800' as any, color: '#fff', lineHeight: 12 },
});

// ─── TeamLogo ─────────────────────────────────────────────────────────────────
function TeamLogo({ name, logoUrl, size = 30, C }: { name: string; logoUrl?: string | null; size?: number; C: AppColors }) {
  const abbr = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (logoUrl) return <Image source={{ uri: logoUrl }} style={{ width: size, height: size, borderRadius: size / 4 }} contentFit="contain" transition={150} />;
  return (
    <View style={[shared.logoFallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: `${C.primary}22`, borderColor: `${C.primary}44` }]}>
      <Text style={[shared.logoAbbr, { fontSize: size * 0.3, color: C.primary }]}>{abbr}</Text>
    </View>
  );
}

// ─── Shared base styles ───────────────────────────────────────────────────────
const shared = StyleSheet.create({
  pulseDot: { width: 5, height: 5, borderRadius: 3 },
  logoFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  logoAbbr: { fontWeight: FONTS.extraBold },
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. HEADER
// ═════════════════════════════════════════════════════════════════════════════
function PicksHeader({ isVip, coinBalance, C }: { isVip: boolean; coinBalance: number; C: AppColors }) {
  return (
    <View style={[hdr.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      <View style={hdr.left}>
        <Text style={[hdr.title, { color: C.textPrimary }]}>
          AI <Text style={{ color: C.primary }}>X</Text>ta
        </Text>
        <View style={[hdr.verifiedBadge, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
          <Ionicons name="shield-checkmark" size={9} color={C.primary} />
          <Text style={[hdr.verifiedText, { color: C.primary }]}>AI Picks</Text>
        </View>
      </View>
      <View style={hdr.right}>
        <AccuracyBadge compact />
        {isVip ? (
          <View style={[hdr.vipBadge, { backgroundColor: (C.vipGlow ?? C.primaryGlow), borderColor: `${C.vip ?? C.primary}55` }]}>
            <FontAwesome5 name="crown" size={9} color={C.vip ?? C.primary} />
            <Text style={[hdr.badgeText, { color: C.vip ?? C.primary }]}>VIP</Text>
          </View>
        ) : null}
        <View style={[hdr.coinBadge, { backgroundColor: (C.vipGlow ?? C.primaryGlow), borderColor: `${C.vip ?? C.primary}44` }]}>
          <Text style={hdr.coinEmoji}>🪙</Text>
          <Text style={[hdr.badgeText, { color: C.vip ?? C.primary }]}>{coinBalance}</Text>
        </View>
      </View>
    </View>
  );
}
const hdr = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 11, borderBottomWidth: 1 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 16, fontWeight: FONTS.extraBold, letterSpacing: -0.3 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  verifiedText: { fontSize: 9, fontWeight: FONTS.bold },
  vipBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  coinBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  coinEmoji: { fontSize: 10 },
  badgeText: { fontSize: 10, fontWeight: FONTS.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. DATE NAV — Perfectly centered, auto-scrolls to keep selected pill visible
// ═════════════════════════════════════════════════════════════════════════════
function DateSelectorBar({ selectedOffset, onSelect, C }: {
  selectedOffset: number;
  onSelect: (n: number) => void;
  C: AppColors;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const didInitialScroll = useRef(false);

  // Compute scroll position so the selected pill is centered in the bar
  const scrollToOffset = useCallback((offset: number, animated: boolean, width: number) => {
    if (width <= 0) return;
    const targetIndex = DATE_ITEMS.findIndex(d => d.offset === offset);
    if (targetIndex < 0) return;
    const totalItemW = DATE_PILL_W + DATE_PILL_GAP;
    // X position of the left edge of the target pill (+ horizontal padding)
    const pillLeft = SPACING.md + targetIndex * totalItemW;
    // Center it: scroll so pillLeft - (containerWidth - DATE_PILL_W) / 2
    const scrollX = pillLeft - (width - DATE_PILL_W) / 2;
    const maxScroll = Math.max(0, DATE_ITEMS.length * totalItemW - DATE_PILL_GAP + SPACING.md * 2 - width);
    scrollRef.current?.scrollTo({ x: Math.max(0, Math.min(scrollX, maxScroll)), animated });
  }, []);

  // Initial scroll to TODAY (no animation)
  const handleLayout = useCallback((w: number) => {
    setContainerWidth(w);
    if (!didInitialScroll.current && w > 0) {
      didInitialScroll.current = true;
      setTimeout(() => scrollToOffset(0, false, w), 50);
    }
  }, [scrollToOffset]);

  // Scroll when selected changes
  useEffect(() => {
    if (containerWidth > 0) {
      scrollToOffset(selectedOffset, true, containerWidth);
    }
  }, [selectedOffset, containerWidth, scrollToOffset]);

  return (
    <View
      style={[dsb.wrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}
      onLayout={(e) => handleLayout(e.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        contentContainerStyle={[dsb.scrollContent, { paddingHorizontal: SPACING.md }]}
      >
        {DATE_ITEMS.map((item) => {
          const isSel = item.offset === selectedOffset;
          return (
            <Pressable
              key={item.offset}
              style={({ pressed }) => [
                dsb.pill,
                isSel
                  ? { backgroundColor: C.primary, borderColor: C.primary }
                  : item.isPast
                  ? { backgroundColor: C.card, borderColor: C.border, opacity: 0.55 }
                  : { backgroundColor: C.card, borderColor: C.border },
                pressed && !isSel ? { opacity: 0.7 } : null,
              ]}
              onPress={() => onSelect(item.offset)}
              hitSlop={4}
            >
              {item.isToday ? (
                <View style={[dsb.todayDot, { backgroundColor: isSel ? C.textInverse : C.primary }]} />
              ) : null}
              <Text style={[dsb.dayAbbr, { color: isSel ? C.textInverse : item.isPast ? C.textMuted : C.textSecondary }]}>
                {item.isToday ? 'TODAY' : item.dayAbbr}
              </Text>
              <Text style={[
                dsb.dayNum,
                { color: isSel ? C.textInverse : item.isPast ? C.textMuted : C.textPrimary },
                isSel ? dsb.dayNumBold : null,
              ]}>
                {item.dayNum}
              </Text>
              <Text style={[dsb.monthAbbr, { color: isSel ? `${C.textInverse}AA` : C.textMuted }]}>
                {item.monthAbbr}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const dsb = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    gap: DATE_PILL_GAP,
  },
  pill: {
    width: DATE_PILL_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 3,
    gap: 1,
    position: 'relative',
  },
  todayDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dayAbbr: { fontSize: 7.5, fontWeight: FONTS.bold, letterSpacing: 0.4 },
  dayNum: { fontSize: 14, fontWeight: FONTS.bold, lineHeight: 18 },
  dayNumBold: { fontWeight: FONTS.extraBold },
  monthAbbr: { fontSize: 7.5, fontWeight: FONTS.medium },
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SPORT NAV (no "All")
// ═════════════════════════════════════════════════════════════════════════════
function SportNavBar({ selected, onSelect, availableSports, liveCountBySport, C }: {
  selected: string; onSelect: (s: string) => void;
  availableSports: Set<string>; liveCountBySport: Map<string, number>; C: AppColors;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // Track whether the chip was selected by a user tap (vs initial load)
  const isTapSelectionRef = useRef(false);

  const scrollToChip = useCallback((chipId: string, animated: boolean, width: number) => {
    if (width <= 0) return;
    const idx = SPORT_CHIPS.findIndex((c) => c.id === chipId);
    if (idx < 0) return;
    // Estimate chip width (~88px average including gap)
    const estChipW = 88;
    const pillLeft = SPACING.md + idx * estChipW;
    const scrollX = pillLeft - (width - estChipW) / 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, scrollX), animated });
  }, []);

  // Only scroll to the selected chip when the user actively taps one
  // (not on re-renders caused by other state changes)
  const handleSelect = useCallback((chipId: string) => {
    isTapSelectionRef.current = true;
    onSelect(chipId);
  }, [onSelect]);

  useEffect(() => {
    if (!isTapSelectionRef.current) return;
    isTapSelectionRef.current = false;
    if (containerWidth > 0) {
      setTimeout(() => scrollToChip(selected, true, containerWidth), 50);
    }
  }, [selected, containerWidth, scrollToChip]);

  return (
    <View style={[snb.wrap, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={snb.scrollContent}>
        {SPORT_CHIPS.map((chip) => {
          const isSel = chip.id === selected;
          const hasMatches = availableSports.has(chip.id);
          const liveCount = liveCountBySport.get(chip.id) ?? 0;
          const isLive = liveCount > 0;
          return (
            <Pressable key={chip.id}
              style={({ pressed }) => [
                snb.chip,
                isSel ? { backgroundColor: C.primaryGlow, borderColor: C.primary }
                  : isLive ? { backgroundColor: C.card, borderColor: `${C.accentRed}55` }
                  : hasMatches ? { backgroundColor: C.card, borderColor: C.border }
                  : { backgroundColor: C.card, borderColor: C.border, opacity: 0.4 },
                pressed ? snb.chipPressed : null,
              ]}
              onPress={() => onSelect(chip.id)}>
              <Text style={snb.chipEmoji}>{chip.emoji}</Text>
              <Text style={[snb.chipLabel, { color: isSel ? C.primary : hasMatches ? C.textSecondary : C.textMuted }, isSel ? snb.chipLabelActive : null]}>{chip.label}</Text>
              {isLive ? (
                <View style={[snb.livePill, { backgroundColor: `${C.accentRed}18`, borderColor: `${C.accentRed}44` }]}>
                  <LivePulseDot color={C.accentRed} />
                  <Text style={[snb.livePillText, { color: C.accentRed }]}>{liveCount > 9 ? '9+' : String(liveCount)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
const snb = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  scrollContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 7, gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, minHeight: 34 },
  chipPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  chipEmoji: { fontSize: 13 },
  chipLabel: { fontSize: 12, fontWeight: FONTS.semiBold },
  chipLabelActive: { fontWeight: FONTS.bold },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 1 },
  livePillText: { fontSize: 8, fontWeight: '800' as any, letterSpacing: 0.3 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. MARKET FILTER BAR (sport-dynamic)
// ═════════════════════════════════════════════════════════════════════════════
function PredictionFilterBar({ selected, onSelect, leagues, sport, C }: {
  selected: PredFilter; onSelect: (f: PredFilter) => void;
  leagues: AIPicksLeague[]; sport: string; C: AppColors;
}) {
  const chips = useMemo(() => getChipsForSport(sport), [sport]);

  const available = useMemo<Set<PredFilter>>(() => {
    const s = new Set<PredFilter>(['All'] as PredFilter[]);
    for (const l of leagues)
      for (const m of l.matches)
        for (const c of chips)
          if (c.id !== 'All' && matchPassesPredFilter(m, c.id)) s.add(c.id);
    return s;
  }, [leagues, chips]);

  const visibleChips = chips.filter((c) => available.has(c.id));
  if (visibleChips.length <= 1) return null;

  return (
    <View style={[pfb.wrap, { borderBottomColor: C.border, backgroundColor: C.surface }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pfb.scrollContent}>
        {visibleChips.map((chip) => {
          const isSel = chip.id === selected;
          const count = chip.id !== 'All'
            ? leagues.reduce((a, l) => a + l.matches.filter((m) => matchPassesPredFilter(m, chip.id)).length, 0)
            : 0;
          return (
            <Pressable key={chip.id}
              style={({ pressed }) => [
                pfb.chip,
                isSel ? { backgroundColor: `${chip.color}22`, borderColor: chip.color } : { backgroundColor: C.card, borderColor: C.border },
                pressed ? { opacity: 0.8 } : null,
              ]}
              onPress={() => onSelect(chip.id)}>
              <Ionicons name={chip.icon as any} size={11} color={isSel ? chip.color : C.textMuted} />
              <Text style={[pfb.chipLabel, { color: isSel ? chip.color : C.textSecondary }, isSel ? pfb.chipLabelActive : null]}>{chip.label}</Text>
              {chip.id !== 'All' && count > 0 ? (
                <View style={[pfb.countBadge, { backgroundColor: isSel ? chip.color : C.surface, borderColor: isSel ? chip.color : C.border }]}>
                  <Text style={[pfb.countText, { color: isSel ? '#fff' : C.textMuted }]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
const pfb = StyleSheet.create({
  wrap: { borderBottomWidth: 1 },
  scrollContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 6, gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5, height: 29 },
  chipLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  chipLabelActive: { fontWeight: FONTS.extraBold },
  countBadge: { minWidth: 16, height: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countText: { fontSize: 9, fontWeight: FONTS.bold, lineHeight: 13 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. GENERATE AI BAR
// ═════════════════════════════════════════════════════════════════════════════
const COVERAGE_DISMISSED_KEY_PREFIX = '@predictxta/picks_coverage_dismissed';

function GenerateAIBar({ leagues, loading, generating, genResult, onGenerate, dateOffset, selectedSport, C }: {
  leagues: AIPicksLeague[]; loading: boolean; generating: boolean;
  genResult: BatchGenResult | null; onGenerate: () => void;
  dateOffset: number; selectedSport: string; C: AppColors;
}) {
  const unpredicted = useMemo(() => leagues.reduce((a, l) => a + l.matches.filter((m) => !m.hasPrediction).length, 0), [leagues]);
  const total       = useMemo(() => leagues.reduce((a, l) => a + l.matches.length, 0), [leagues]);

  const [showStatus, setShowStatus]   = useState(true);
  const [showCoverage, setShowCoverage] = useState(true);
  const statusTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setShowStatus(true);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setShowStatus(false), 10000);
    return () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current); };
  }, [generating, genResult]);

  const coverageStorageKey = `${COVERAGE_DISMISSED_KEY_PREFIX}_${dateOffset}_${selectedSport}`;
  const coverageKeyRef = useRef(coverageStorageKey);

  useEffect(() => {
    coverageKeyRef.current = coverageStorageKey;
    AsyncStorage.getItem(coverageStorageKey)
      .then((val) => { if (val === '1') setShowCoverage(false); else setShowCoverage(true); })
      .catch(() => setShowCoverage(true));
    if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
    coverageTimerRef.current = setTimeout(() => {
      setShowCoverage(false);
      AsyncStorage.setItem(coverageStorageKey, '1').catch(() => {});
    }, 10000);
    return () => { if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current); };
  }, [coverageStorageKey]);

  useEffect(() => {
    AsyncStorage.getItem(coverageKeyRef.current).then((val) => {
      if (val === '1') return;
      setShowCoverage(true);
      if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
      coverageTimerRef.current = setTimeout(() => {
        setShowCoverage(false);
        AsyncStorage.setItem(coverageKeyRef.current, '1').catch(() => {});
      }, 10000);
    }).catch(() => {});
  }, [total, unpredicted]);

  if (loading || total === 0) return null;
  const allPredicted = unpredicted === 0;

  return (
    <View style={[gab.wrap, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      {showStatus ? (
        generating ? (
          <View style={[gab.statusRow, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={[gab.statusText, { color: C.primary }]}>Generating AI predictions…</Text>
          </View>
        ) : genResult && (genResult.generated > 0 || genResult.skipped > 0) ? (
          <View style={[gab.statusRow, { backgroundColor: '#22C55E14', borderColor: '#22C55E33' }]}>
            <Ionicons name="checkmark-circle" size={13} color="#22C55E" />
            <Text style={[gab.statusText, { color: '#22C55E' }]}>
              {genResult.generated > 0 ? `${genResult.generated} prediction${genResult.generated !== 1 ? 's' : ''} ready` : 'Generation complete'}
              {genResult.failed > 0 ? ` · ${genResult.failed} failed` : ''}
              {genResult.skipped > 0 ? ` · ${genResult.skipped} skipped (no data)` : ''}
            </Text>
          </View>
        ) : null
      ) : null}

      <View style={gab.actionRow}>
        {showCoverage ? (
          <View style={[gab.coveragePill, { backgroundColor: allPredicted ? '#22C55E14' : C.primaryGlow, borderColor: allPredicted ? '#22C55E33' : `${C.primary}44` }]}>
            <FontAwesome5 name="brain" size={9} color={allPredicted ? '#22C55E' : C.primary} />
            <Text style={[gab.coverageText, { color: allPredicted ? '#22C55E' : C.primary }]}>
              {allPredicted ? `${total}/${total}` : `${total - unpredicted}/${total}`}
            </Text>
          </View>
        ) : <View />}

        <Pressable
          style={({ pressed }) => [
            gab.genBtn,
            allPredicted || generating
              ? { backgroundColor: C.card, borderColor: C.border }
              : { backgroundColor: C.primary, borderColor: C.primary },
            pressed && !allPredicted && !generating ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
          ]}
          onPress={onGenerate} disabled={generating || allPredicted}>
          {generating
            ? <ActivityIndicator size="small" color={C.textMuted} />
            : <FontAwesome5 name="brain" size={10} color={allPredicted ? C.textMuted : C.textInverse} />}
          <Text style={[gab.genBtnText, { color: allPredicted || generating ? C.textMuted : C.textInverse }]}>
            {generating ? 'Generating…' : allPredicted ? 'All Predicted' : `Generate (${unpredicted})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
const gab = StyleSheet.create({
  wrap: { borderBottomWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 6, gap: 5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 11, fontWeight: FONTS.semiBold, flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  coveragePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  coverageText: { fontSize: 10, fontWeight: FONTS.semiBold },
  genBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, minWidth: 110, justifyContent: 'center' },
  genBtnText: { fontSize: 11, fontWeight: FONTS.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HIGH CONFIDENCE SECTION
// ═════════════════════════════════════════════════════════════════════════════
function HighConfCard({ rec, C, onPress }: { rec: MatchRecommendation; C: AppColors; onPress: () => void }) {
  const { match, prediction } = rec;
  if (!prediction) return null;
  const confColor = getConfidenceColor(prediction.confidence);
  const sportEmoji = SPORT_CHIPS.find((s) => s.id.toLowerCase() === (match.sport ?? '').toLowerCase())?.emoji ?? '🏆';
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const chipCfg = getPredChipConfig(match.sport);
  const family = getSportFamily(match.sport);
  const isFight = family === 'mma' || family === 'boxing';

  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [hcc.card, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.88, transform: [{ scale: 0.975 }] } : null]}>
      <View style={[hcc.accentBar, { backgroundColor: confColor }]} />
      <View style={hcc.body}>
        <View style={hcc.topRow}>
          <Text style={hcc.sportEmoji}>{sportEmoji}</Text>
          <Text style={[hcc.leagueLabel, { color: C.textMuted }]} numberOfLines={1}>{match.league}</Text>
          {isLive ? (
            <View style={[hcc.livePill, { backgroundColor: 'rgba(255,71,87,0.12)', borderColor: 'rgba(255,71,87,0.35)' }]}>
              <View style={hcc.liveDot} />
              <Text style={hcc.liveText}>LIVE{match.minute ? ` ${match.minute}'` : ''}</Text>
            </View>
          ) : isFinished ? (
            <View style={[hcc.ftPill, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[hcc.ftText, { color: C.textMuted }]}>FT {match.homeScore}–{match.awayScore}</Text>
            </View>
          ) : null}
          <View style={[hcc.confBadge, { backgroundColor: `${confColor}14`, borderColor: `${confColor}33` }]}>
            <Ionicons name="shield-checkmark" size={9} color={confColor} />
            <Text style={[hcc.confVal, { color: confColor }]}>{prediction.confidence}%</Text>
          </View>
        </View>
        <View style={hcc.teamsRow}>
          <Text style={[hcc.teamName, { color: C.textPrimary }]} numberOfLines={1}>{match.homeTeam}</Text>
          <View style={[hcc.vsBox, { backgroundColor: C.surface, borderColor: C.border }]}>
            {isLive || isFinished
              ? <Text style={[hcc.vsScore, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.homeScore}–{match.awayScore}</Text>
              : <Text style={[hcc.vsText, { color: C.textMuted }]}>VS</Text>}
          </View>
          <Text style={[hcc.teamName, hcc.teamRight, { color: C.textPrimary }]} numberOfLines={1}>{match.awayTeam}</Text>
        </View>
        <View style={hcc.chipsRow}>
          <View style={[hcc.chip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
            <FontAwesome5 name="brain" size={7} color={C.primary} />
            <Text style={[hcc.chipText, { color: C.primary }]}>{chipCfg.resultChipLabel(prediction.predictedResult, match.homeTeam, match.awayTeam)}</Text>
          </View>
          {!isFight && prediction.overUnder ? (
            <View style={[hcc.chip, { backgroundColor: prediction.overUnder === 'over' ? '#22C55E18' : '#EF444418', borderColor: prediction.overUnder === 'over' ? '#22C55E44' : '#EF444444' }]}>
              <Text style={[hcc.chipText, { color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444' }]}>O/U {prediction.overUnderLine ?? 2.5} {chipCfg.overUnderUnit} {prediction.overUnder.toUpperCase()}</Text>
            </View>
          ) : null}
          {chipCfg.showBTTS && prediction.btts ? (
            <View style={[hcc.chip, { backgroundColor: prediction.btts === 'yes' ? '#14B8A618' : '#F9731618', borderColor: prediction.btts === 'yes' ? '#14B8A644' : '#F9731644' }]}>
              <Text style={[hcc.chipText, { color: prediction.btts === 'yes' ? '#14B8A6' : '#F97316' }]}>BTTS {prediction.btts.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
const hcc = StyleSheet.create({
  card: { width: 220, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  accentBar: { height: 3 },
  body: { padding: 10, gap: 7 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sportEmoji: { fontSize: 11, flexShrink: 0 },
  leagueLabel: { flex: 1, fontSize: 9, fontWeight: FONTS.medium },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4757' },
  liveText: { fontSize: 8, fontWeight: '800' as any, color: '#FF4757' },
  ftPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2 },
  ftText: { fontSize: 8, fontWeight: FONTS.semiBold },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, flexShrink: 0 },
  confVal: { fontSize: 9, fontWeight: FONTS.extraBold },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teamName: { flex: 1, fontSize: 10, fontWeight: FONTS.bold },
  teamRight: { textAlign: 'right' },
  vsBox: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0 },
  vsText: { fontSize: 10, fontWeight: FONTS.bold },
  vsScore: { fontSize: 12, fontWeight: FONTS.extraBold },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontSize: 8, fontWeight: FONTS.semiBold },
});

function HighConfidenceSection({ recommendations, loading, C, onPress }: {
  recommendations: import('@/services/recommendationEngine').RecommendationSet | null;
  loading: boolean; C: AppColors; onPress: (matchId: string) => void;
}) {
  const highConf = useMemo(() => {
    if (!recommendations) return [];
    const all = [...(recommendations.forYou ?? []), ...(recommendations.topPicks ?? [])];
    const seen = new Set<string>();
    return all
      .filter((r) => r.prediction && r.prediction.confidence >= 72)
      .filter((r) => { if (seen.has(r.match.id)) return false; seen.add(r.match.id); return true; })
      .sort((a, b) => (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0))
      .slice(0, 4);
  }, [recommendations]);

  if (!loading && highConf.length === 0) return null;

  return (
    <View style={[hcs.wrap, { borderBottomColor: C.border }]}>
      <View style={hcs.titleRow}>
        <View style={[hcs.titleIcon, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
          <Ionicons name="shield-checkmark" size={11} color={C.primary} />
        </View>
        <Text style={[hcs.title, { color: C.textPrimary }]}>🎯 High Confidence</Text>
        <View style={[hcs.countBadge, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[hcs.countText, { color: C.textMuted }]}>{highConf.length} picks</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={hcs.scrollContent}
        decelerationRate="fast" snapToInterval={232} snapToAlignment="start">
        {loading && highConf.length === 0
          ? [1, 2, 3].map((i) => (
            <View key={i} style={[hcs.skeleton, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[hcs.skeletonBar, { backgroundColor: C.surface }]} />
              <View style={{ padding: 10, gap: 7 }}>
                <View style={[hcs.skeletonLine, { backgroundColor: C.surface, width: 90 }]} />
                <View style={[hcs.skeletonLine, { backgroundColor: C.surface, width: 150, height: 12 }]} />
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <View style={[hcs.skeletonChip, { backgroundColor: C.surface }]} />
                  <View style={[hcs.skeletonChip, { backgroundColor: C.surface, width: 55 }]} />
                </View>
              </View>
            </View>
          ))
          : highConf.map((rec) => (
            <HighConfCard key={rec.match.id} rec={rec} C={C} onPress={() => onPress(rec.match.id)} />
          ))}
      </ScrollView>
    </View>
  );
}
const hcs = StyleSheet.create({
  wrap: { paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: SPACING.md, marginBottom: 8 },
  titleIcon: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: FONTS.bold, flex: 1 },
  countBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  countText: { fontSize: 9, fontWeight: FONTS.semiBold },
  scrollContent: { paddingHorizontal: SPACING.md, paddingBottom: 4, gap: 9 },
  skeleton: { width: 220, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  skeletonBar: { height: 3 },
  skeletonLine: { height: 9, borderRadius: RADIUS.full },
  skeletonChip: { height: 18, width: 65, borderRadius: RADIUS.full },
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. INLINE MATCH CARD (sport-specific) + Why We Like It / Why It Could Fail
// ═════════════════════════════════════════════════════════════════════════════

function getConfidenceDrivers(match: AIPick): string[] {
  if (match.keyFactors && match.keyFactors.length > 0) return match.keyFactors.slice(0, 3);
  const drivers: string[] = [];
  const conf = match.confidence ?? 0;
  const hf = match.homeForm ?? []; const af = match.awayForm ?? [];
  const hwr = hf.length > 0 ? Math.round(hf.filter((r: string) => r.toUpperCase() === 'W').length / hf.length * 100) : null;
  const awr = af.length > 0 ? Math.round(af.filter((r: string) => r.toUpperCase() === 'W').length / af.length * 100) : null;
  if (conf >= 80) drivers.push(`Elite ${conf}% AI confidence — strong multi-model consensus`);
  else if (conf >= 70) drivers.push(`${conf}% AI confidence — reliable signal quality`);
  else drivers.push(`${conf}% AI confidence — moderate signal`);
  if (match.predictedResult === 'home_win' && hwr !== null && hwr >= 60)
    drivers.push(`${match.homeTeam.split(' ').slice(-1)[0]} winning ${hwr}% of recent matches`);
  else if (match.predictedResult === 'away_win' && awr !== null && awr >= 60)
    drivers.push(`${match.awayTeam.split(' ').slice(-1)[0]} in strong away form (${awr}% win rate)`);
  if (match.overUnder === 'over' && match.overUnderLine)
    drivers.push(`Goal expectation above ${match.overUnderLine} — attacking form supports Over`);
  else if (match.overUnder === 'under' && match.overUnderLine)
    drivers.push(`Defensive solidity from both sides — Under ${match.overUnderLine} backed by data`);
  if (match.btts === 'yes') drivers.push('Both teams have scored in majority of recent fixtures');
  return drivers.slice(0, 3);
}

function getFailureReasons(match: AIPick): string[] {
  const reasons: string[] = [];
  const conf = match.confidence ?? 0;
  const hf = match.homeForm ?? []; const af = match.awayForm ?? [];
  const family = getSportFamily(match.sport);
  if (conf < 70) reasons.push('Below-average AI confidence — outcome less certain');
  if (hf.length < 3) reasons.push(`Limited form data for ${match.homeTeam.split(' ').slice(-1)[0]}`);
  else if (af.length < 3) reasons.push(`Limited form data for ${match.awayTeam.split(' ').slice(-1)[0]}`);
  if (family === 'football') reasons.push('Set pieces and individual errors can swing any match');
  else if (family === 'tennis') reasons.push('Surface-specific performance and injury risk are wildcards');
  else if (family === 'basketball') reasons.push('Pace mismatches can produce unexpected totals');
  else if (family === 'mma' || family === 'boxing') reasons.push('Single strike KOs make combat sports inherently unpredictable');
  else reasons.push('Unexpected form reversals are always possible');
  if (match.riskLevel?.toLowerCase().includes('high')) reasons.push('High-risk pick — consider reducing stake');
  if (match.insufficientData) reasons.push('Insufficient historical data reduces model accuracy');
  return reasons.slice(0, 3);
}

function computeDataQuality(match: AIPick): number {
  let score = 40;
  const hf = match.homeForm ?? []; const af = match.awayForm ?? [];
  if (hf.length >= 5) score += 14; else if (hf.length >= 3) score += 7;
  if (af.length >= 5) score += 14; else if (af.length >= 3) score += 7;
  if (match.keyFactors && match.keyFactors.length > 0) score += 10;
  if (match.aiAnalysis) score += 10;
  if (match.homeWinProb && match.awayWinProb) score += 10;
  return Math.min(100, score);
}

function InlineMatchCard({ match, C }: { match: AIPick; C: AppColors }) {
  const router = useRouter();
  const [insightOpen, setInsightOpen] = useState(false);
  const insightAnim = useRef(new Animated.Value(0)).current;
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';

  const fmtTime = (iso: string) => {
    try { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    catch { return '--:--'; }
  };

  const predLabel = match.predictedResult === 'home_win' ? match.homeTeam
    : match.predictedResult === 'away_win' ? match.awayTeam
    : match.predictedResult === 'draw' ? 'Draw' : null;

  const handlePress = useCallback(() => {
    router.push({ pathname: '/ai-pick/[id]', params: { id: match.matchId, matchJson: JSON.stringify(match) } } as any);
  }, [match]);

  const toggleInsight = useCallback(() => {
    const toValue = insightOpen ? 0 : 1;
    setInsightOpen(!insightOpen);
    Animated.spring(insightAnim, { toValue, useNativeDriver: false, tension: 80, friction: 10 }).start();
  }, [insightOpen, insightAnim]);

  const chipCfg = getPredChipConfig(match.sport);
  const family = getSportFamily(match.sport);
  const isFight = family === 'mma' || family === 'boxing';
  const isTennis = family === 'tennis';
  const isBasket = family === 'basketball' || family === 'american_football';

  const confidenceDrivers = useMemo(() => match.hasPrediction ? getConfidenceDrivers(match) : [], [match.matchId, match.hasPrediction]);
  const failureReasons = useMemo(() => match.hasPrediction ? getFailureReasons(match) : [], [match.matchId, match.hasPrediction]);
  const dataQuality = useMemo(() => computeDataQuality(match), [match.matchId]);
  const modelConsensus = useMemo(() => {
    const c = match.confidence ?? 0;
    if (c >= 82) return 95; if (c >= 74) return 85; if (c >= 65) return 72; return 58;
  }, [match.confidence]);

  const confColor = match.confidence
    ? (match.confidence >= 80 ? '#22C55E' : match.confidence >= 65 ? '#F59E0B' : '#EF4444')
    : C.textMuted;
  const dqColor = dataQuality >= 75 ? '#22C55E' : dataQuality >= 55 ? '#F59E0B' : '#EF4444';

  const insightMaxHeight = insightAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 380] });
  const insightOpacity = insightAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });

  return (
    <Pressable onPress={handlePress}
      style={({ pressed }) => [mc.card, { backgroundColor: C.card, borderColor: insightOpen ? `${C.primary}44` : C.border }, pressed ? mc.cardPressed : null]}>
      <View style={[mc.stripe, { backgroundColor: isLive ? '#FF4757' : isFinished ? C.primary : match.hasPrediction ? '#22C55E' : C.border }]} />
      <View style={mc.body}>
        {/* Status row */}
        <View style={mc.statusRow}>
          {isLive ? <PulsingLiveBadge count={1} /> : isFinished ? (
            <View style={[mc.statusPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <Text style={[mc.statusText, { color: C.primary }]}>FT {match.homeScore} - {match.awayScore}</Text>
            </View>
          ) : (
            <View style={[mc.statusPill, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Ionicons name="time-outline" size={9} color={C.textMuted} />
              <Text style={[mc.statusText, { color: C.textMuted }]}>{fmtTime(match.matchTime)}</Text>
            </View>
          )}
          {match.insufficientData ? (
            <View style={[mc.insufficientPill, { backgroundColor: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.35)' }]}>
              <Ionicons name="warning-outline" size={9} color="#FBB724" />
              <Text style={[mc.insufficientText, { color: '#FBB724' }]}>Insufficient Data</Text>
            </View>
          ) : match.hasPrediction && predLabel ? (
            <View style={[mc.predPill, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <FontAwesome5 name="brain" size={7} color={C.primary} />
              <Text style={[mc.predPillText, { color: C.primary }]} numberOfLines={1}>{predLabel}</Text>
            </View>
          ) : null}
          {match.riskLevel ? (() => {
            const rc = getRiskColor(match.riskLevel);
            return (
              <View style={[mc.riskPill, { backgroundColor: `${rc}18`, borderColor: `${rc}44` }]}>
                <Text style={[mc.riskText, { color: rc }]}>{match.riskLevel}</Text>
              </View>
            );
          })() : null}
          <View style={mc.chevronSpacer} />
          {match.hasPrediction ? (
            <Pressable onPress={toggleInsight} hitSlop={8}
              style={[mc.insightBtn, insightOpen ? { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` } : { backgroundColor: C.surface, borderColor: C.border }]}>
              <FontAwesome5 name="lightbulb" size={8} color={insightOpen ? C.primary : C.textMuted} solid={insightOpen} />
              <Text style={[mc.insightBtnText, { color: insightOpen ? C.primary : C.textMuted }]}>Why?</Text>
              <Ionicons name={insightOpen ? 'chevron-up' : 'chevron-down'} size={8} color={insightOpen ? C.primary : C.textMuted} />
            </Pressable>
          ) : null}
          <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
        </View>

        {/* Teams row */}
        <View style={mc.teamsRow}>
          <View style={mc.teamBlock}>
            <TeamLogo name={match.homeTeam} logoUrl={match.homeLogo} size={32} C={C} />
            <Text style={[mc.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.homeTeam}</Text>
          </View>
          <View style={mc.scoreBlock}>
            {isLive ? (
              <>
                <Text style={[mc.bigScore, { color: C.textPrimary }]}>{match.homeScore} - {match.awayScore}</Text>
                <View style={mc.liveMinRow}>
                  <View style={mc.liveMinDot} />
                  <Text style={mc.liveMinText}>{match.minute}'</Text>
                </View>
              </>
            ) : isFinished ? (
              <Text style={[mc.bigScore, { color: C.textPrimary }]}>{match.homeScore} - {match.awayScore}</Text>
            ) : (
              <View style={[mc.vsWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[mc.vsText, { color: C.textMuted }]}>VS</Text>
              </View>
            )}
            {match.confidence ? (
              <View style={[mc.confPill, { borderColor: match.confidence >= 80 ? '#22C55E44' : '#EAB30844' }]}>
                <Text style={[mc.confText, { color: match.confidence >= 80 ? '#22C55E' : '#EAB308' }]}>{match.confidence}%</Text>
              </View>
            ) : null}
          </View>
          <View style={[mc.teamBlock, mc.teamBlockRight]}>
            <TeamLogo name={match.awayTeam} logoUrl={match.awayLogo} size={32} C={C} />
            <Text style={[mc.teamName, mc.teamNameRight, { color: C.textPrimary }]} numberOfLines={2}>{match.awayTeam}</Text>
          </View>
        </View>

        {/* Sport-specific prediction chips */}
        {match.hasPrediction ? (
          <View style={mc.chipsRow}>
            {match.predictedResult ? (
              <View style={[mc.chip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
                <Text style={[mc.chipText, { color: C.primary }]}>
                  {chipCfg.resultChipLabel(match.predictedResult, match.homeTeam, match.awayTeam)}
                </Text>
              </View>
            ) : null}
            {!isFight && match.overUnder ? (
              <View style={[mc.chip, { backgroundColor: match.overUnder === 'over' ? '#22C55E18' : '#EF444418', borderColor: match.overUnder === 'over' ? '#22C55E44' : '#EF444444' }]}>
                <Text style={[mc.chipText, { color: match.overUnder === 'over' ? '#22C55E' : '#EF4444' }]}>
                  O/U {match.overUnderLine ?? 2.5} {chipCfg.overUnderUnit} {match.overUnder.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {chipCfg.showBTTS && match.btts ? (
              <View style={[mc.chip, { backgroundColor: match.btts === 'yes' ? '#14B8A618' : '#F9731618', borderColor: match.btts === 'yes' ? '#14B8A644' : '#F9731644' }]}>
                <Text style={[mc.chipText, { color: match.btts === 'yes' ? '#14B8A6' : '#F97316' }]}>BTTS {match.btts.toUpperCase()}</Text>
              </View>
            ) : null}
            {isFight && match.htResult ? (
              <View style={[mc.chip, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
                <Text style={[mc.chipText, { color: '#EF4444' }]}>
                  {match.htResult === 'home_win' ? 'KO/TKO' : match.htResult === 'draw' ? 'DECISION' : 'SUB'}
                </Text>
              </View>
            ) : null}
            {(isTennis || family === 'volleyball') && match.correctScore ? (
              <View style={[mc.chip, { backgroundColor: `${C.accentBlue ?? C.primary}18`, borderColor: `${C.accentBlue ?? C.primary}44` }]}>
                <Text style={[mc.chipText, { color: C.accentBlue ?? C.primary }]}>Sets {match.correctScore}</Text>
              </View>
            ) : null}
            {isBasket && match.asianHandicapPick && match.asianHandicapLine !== null ? (
              <View style={[mc.chip, { backgroundColor: '#8B5CF618', borderColor: '#8B5CF644' }]}>
                <Text style={[mc.chipText, { color: '#8B5CF6' }]}>
                  {match.asianHandicapPick === 'home' ? match.homeTeam.split(' ').slice(-1)[0] : match.awayTeam.split(' ').slice(-1)[0]} {(match.asianHandicapLine ?? 0) > 0 ? '+' : ''}{match.asianHandicapLine}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Expandable Why We Like It / Why It Could Fail ─────────────── */}
        <Animated.View style={{ maxHeight: insightMaxHeight, opacity: insightOpacity, overflow: 'hidden' }}>
          <View style={[mc.insightPanel, { backgroundColor: C.surface, borderColor: C.border }]}>
            {/* Score row */}
            <View style={mc.insightScores}>
              {[
                { label: 'AI Conf', value: match.confidence ?? 0, color: confColor },
                { label: 'Data Quality', value: dataQuality, color: dqColor },
                { label: 'Consensus', value: modelConsensus, color: '#A78BFA' },
              ].map((item) => (
                <View key={item.label} style={[mc.insightScore, { backgroundColor: `${item.color}0A`, borderColor: `${item.color}22` }]}>
                  <Text style={[mc.insightScoreVal, { color: item.color }]}>{item.value}%</Text>
                  <Text style={[mc.insightScoreLabel, { color: C.textMuted }]}>{item.label}</Text>
                </View>
              ))}
            </View>
            {/* Why we like it */}
            <View style={mc.insightSection}>
              <View style={mc.insightSectionHdr}>
                <View style={[mc.insightDot, { backgroundColor: '#22C55E' }]} />
                <Text style={[mc.insightSectionTitle, { color: '#22C55E' }]}>Why We Like It</Text>
              </View>
              {confidenceDrivers.map((d, i) => (
                <View key={i} style={mc.insightBullet}>
                  <Text style={[mc.insightCheck, { color: '#22C55E' }]}>✓</Text>
                  <Text style={[mc.insightBulletText, { color: C.textSecondary }]}>{d}</Text>
                </View>
              ))}
            </View>
            {/* Why it could fail */}
            <View style={mc.insightSection}>
              <View style={mc.insightSectionHdr}>
                <View style={[mc.insightDot, { backgroundColor: '#EF4444' }]} />
                <Text style={[mc.insightSectionTitle, { color: '#EF4444' }]}>Why It Could Fail</Text>
              </View>
              {failureReasons.map((r, i) => (
                <View key={i} style={mc.insightBullet}>
                  <Text style={[mc.insightCheck, { color: '#EF4444' }]}>✕</Text>
                  <Text style={[mc.insightBulletText, { color: C.textSecondary }]}>{r}</Text>
                </View>
              ))}
            </View>
            {/* Full report CTA */}
            <Pressable onPress={handlePress}
              style={[mc.insightFullBtn, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
              <FontAwesome5 name="brain" size={10} color={C.primary} />
              <Text style={[mc.insightFullBtnText, { color: C.primary }]}>Full AI Report & Markets</Text>
              <Ionicons name="chevron-forward" size={11} color={C.primary} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}
const mc = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  stripe: { width: 3 },
  body: { flex: 1, paddingHorizontal: SPACING.md - 2, paddingTop: 10, paddingBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8, flexWrap: 'wrap' },
  insightBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  insightBtnText: { fontSize: 9, fontWeight: FONTS.bold },
  insightPanel: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 10, marginTop: 8 },
  insightScores: { flexDirection: 'row', gap: 6 },
  insightScore: { flex: 1, alignItems: 'center', gap: 2, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 8 },
  insightScoreVal: { fontSize: 15, fontWeight: FONTS.extraBold },
  insightScoreLabel: { fontSize: 8, fontWeight: FONTS.semiBold, textAlign: 'center' },
  insightSection: { gap: 4 },
  insightSectionHdr: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 },
  insightDot: { width: 6, height: 6, borderRadius: 3 },
  insightSectionTitle: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  insightBullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  insightCheck: { fontSize: 10, fontWeight: FONTS.bold, width: 12, marginTop: 2 },
  insightBulletText: { flex: 1, fontSize: 11, lineHeight: 17 },
  insightFullBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, justifyContent: 'center' },
  insightFullBtnText: { fontSize: 11, fontWeight: FONTS.bold, flex: 1, textAlign: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 9, fontWeight: FONTS.semiBold },
  insufficientPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  insufficientText: { fontSize: 9, fontWeight: FONTS.semiBold },
  predPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  predPillText: { fontSize: 9, fontWeight: FONTS.semiBold, maxWidth: 80 },
  riskPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  riskText: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.3 },
  chevronSpacer: { flex: 1 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  teamBlock: { flex: 1, alignItems: 'flex-start', gap: 4 },
  teamBlockRight: { alignItems: 'flex-end' },
  teamName: { fontSize: 12, fontWeight: FONTS.semiBold, lineHeight: 16 },
  teamNameRight: { textAlign: 'right' },
  scoreBlock: { alignItems: 'center', gap: 3, minWidth: 72 },
  bigScore: { fontSize: 24, fontWeight: FONTS.extraBold },
  liveMinRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  liveMinDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4757' },
  liveMinText: { fontSize: 10, fontWeight: FONTS.bold, color: '#FF4757' },
  vsWrap: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  vsText: { fontSize: 12, fontWeight: FONTS.bold },
  confPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  confText: { fontSize: 9, fontWeight: FONTS.bold },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 9, fontWeight: FONTS.semiBold },
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. INLINE LEAGUE SECTION
// ═════════════════════════════════════════════════════════════════════════════
function InlineLeagueSection({ league, predFilter, dateOffset, sport, C }: {
  league: AIPicksLeague; predFilter: PredFilter; dateOffset: number; sport: string; C: AppColors;
}) {
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => league.matches.filter((m) => matchPassesPredFilter(m, predFilter)), [league.matches, predFilter]);
  const liveCount = filtered.filter((m) => m.status === 'live').length;
  if (filtered.length === 0) return null;

  return (
    <View style={ils.wrap}>
      <Pressable
        style={({ pressed }) => [ils.header, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.8 } : null]}
        onPress={() => setExpanded((v) => !v)}>
        <View style={ils.headerLeft}>
          {league.leagueLogo ? (
            <Image source={{ uri: league.leagueLogo }} style={ils.leagueLogo} contentFit="contain" />
          ) : (
            <View style={[ils.leagueLogoFb, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
              <Text style={ils.leagueLogoEmoji}>🏆</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[ils.leagueName, { color: C.textPrimary }]} numberOfLines={1}>{league.leagueName}</Text>
            <Text style={[ils.matchCount, { color: C.textMuted }]}>{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</Text>
          </View>
        </View>
        <View style={ils.headerRight}>
          {liveCount > 0 ? <PulsingLiveBadge count={liveCount} /> : null}
          {league.isFavorite ? <FontAwesome5 name="star" size={9} color={C.primary} solid /> : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.textMuted} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={ils.matchList}>
          {filtered.map((m) => <InlineMatchCard key={m.matchId} match={m} C={C} />)}
        </View>
      ) : null}
    </View>
  );
}
const ils = StyleSheet.create({
  wrap: { marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1, marginRight: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  leagueLogo: { width: 24, height: 24, borderRadius: 5 },
  leagueLogoFb: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  leagueLogoEmoji: { fontSize: 11 },
  leagueName: { fontSize: 12, fontWeight: FONTS.semiBold },
  matchCount: { fontSize: 10, marginTop: 1 },
  matchList: { marginTop: 5, gap: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. COUNTRY CARD
// ═════════════════════════════════════════════════════════════════════════════
function CountryCard({ group, predFilter, dateOffset, sport, C }: {
  group: CountryGroup; predFilter: PredFilter; dateOffset: number; sport: string; C: AppColors;
}) {
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push({
      pathname: '/ai-picks-country/[country]',
      params: { country: encodeURIComponent(group.country), dateOffset: String(dateOffset), sport },
    } as any);
  }, [group.country, dateOffset, sport]);

  return (
    <Pressable onPress={handlePress}
      style={({ pressed }) => [
        cc.wrap,
        { backgroundColor: C.card, borderColor: group.totalLive > 0 ? 'rgba(255,71,87,0.35)' : C.border },
        pressed ? cc.wrapPressed : null,
      ]}>
      <View style={cc.left}>
        <Text style={cc.flag}>{group.flag}</Text>
        <View style={cc.textWrap}>
          <Text style={[cc.country, { color: C.textPrimary }]}>{group.country}</Text>
          <Text style={[cc.meta, { color: C.textMuted }]}>
            {group.leagues.length} league{group.leagues.length !== 1 ? 's' : ''} · {group.totalMatches} match{group.totalMatches !== 1 ? 'es' : ''}
          </Text>
        </View>
      </View>
      <View style={cc.right}>
        {group.totalLive > 0 ? <PulsingLiveBadge count={group.totalLive} /> : null}
        {group.hasPredictions ? (
          <View style={[cc.brainBadge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
            <FontAwesome5 name="brain" size={8} color={C.primary} />
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={15} color={C.textMuted} />
      </View>
    </Pressable>
  );
}
const cc = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: SPACING.md, paddingVertical: 11, marginBottom: 8 },
  wrapPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  left: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  flag: { fontSize: 22 },
  textWrap: { flex: 1 },
  country: { fontSize: 13, fontWeight: FONTS.bold },
  meta: { fontSize: 10, marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brainBadge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. SPORT EMPTY STATE
// ═════════════════════════════════════════════════════════════════════════════
function SportEmptyState({ sport, dateOffset, onDateChange, C }: {
  sport: string; dateOffset: number; onDateChange: (n: number) => void; C: AppColors;
}) {
  const chip = SPORT_CHIPS.find((c) => c.id === sport) ?? { emoji: '🏆', label: sport };
  const dateItem = DATE_ITEMS.find((d) => d.offset === dateOffset);
  const dateLabel = dateItem
    ? (dateItem.isToday ? 'today' : dateItem.offset === -1 ? 'yesterday' : dateItem.offset === 1 ? 'tomorrow' : `${dateItem.dayAbbr} ${dateItem.dayNum}`)
    : 'this day';
  const quickOffsets = [-1, 0, 1, 2, 3, 4].filter((o) => o !== dateOffset).slice(0, 4);
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const opAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
      Animated.timing(opAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <View style={ses.root}>
      <Animated.View style={[ses.iconWrap, { transform: [{ scale: scaleAnim }], opacity: opAnim, backgroundColor: C.primaryGlow, borderColor: `${C.primary}22` }]}>
        <Text style={ses.iconEmoji}>{chip.emoji}</Text>
      </Animated.View>
      {(() => {
        const hasNoData = !DB_ACTIVE_SPORTS.has(sport);
        const isOffSeason = DB_SEASONAL_SPORTS.has(sport);
        const headline = hasNoData ? `${chip.label} Coming Soon` : isOffSeason ? `${chip.label} Off-Season` : `No ${chip.label} matches ${dateLabel}`;
        const body = hasNoData ? `${chip.label} data is not yet in our system. We are actively adding more sports — check back soon!` : isOffSeason ? `${chip.label} is currently off-season. Browse earlier dates to see recent finished matches.` : 'Try another date or check a different sport.';
        return (<><Text style={[ses.headline, { color: C.textPrimary }]}>{headline}</Text><Text style={[ses.body, { color: C.textMuted }]}>{body}</Text></>);
      })()}
      {!DB_ACTIVE_SPORTS.has(sport) ? null : <View style={ses.dateRow}>
        {quickOffsets.map((offset) => {
          const d = DATE_ITEMS.find((x) => x.offset === offset);
          return (
            <Pressable key={offset}
              style={({ pressed }) => [
                ses.datePill,
                offset === 0 ? { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` } : { backgroundColor: C.card, borderColor: C.border },
                pressed ? { opacity: 0.75 } : null,
              ]}
              onPress={() => onDateChange(offset)}>
              <Text style={[ses.datePillDay, { color: offset === 0 ? C.primary : C.textMuted }]}>{d ? (d.isToday ? 'TODAY' : d.dayAbbr) : ''}</Text>
              <Text style={[ses.datePillNum, { color: offset === 0 ? C.primary : C.textPrimary }]}>{d?.dayNum}</Text>
              <Text style={[ses.datePillMonth, { color: C.textMuted }]}>{d?.monthAbbr}</Text>
            </Pressable>
          );
        })}
      </View>}
    </View>
  );
}
const ses = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 32, paddingBottom: 28, paddingHorizontal: SPACING.lg, gap: 10 },
  iconWrap: { width: 88, height: 88, borderRadius: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconEmoji: { fontSize: 38 },
  headline: { fontSize: 16, fontWeight: FONTS.extraBold, textAlign: 'center' },
  body: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  dateRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  datePill: { alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, minWidth: 56, gap: 1 },
  datePillDay: { fontSize: 8, fontWeight: FONTS.bold },
  datePillNum: { fontSize: 16, fontWeight: FONTS.bold },
  datePillMonth: { fontSize: 8 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. STATS BANNER
// ═════════════════════════════════════════════════════════════════════════════
function StatsBanner({ liveMatches, totalMatches, predictedMatches, accuracyPct, C }: {
  liveMatches: number; totalMatches: number; predictedMatches: number; accuracyPct?: number; C: AppColors;
}) {
  if (totalMatches === 0) return null;
  const items = [
    { icon: '⚡', val: String(liveMatches),       lbl: 'Live',    color: C.accentRed },
    { icon: '📅', val: String(totalMatches),      lbl: 'Matches', color: C.primary },
    { icon: '🧠', val: String(predictedMatches),  lbl: 'Picks',   color: '#4ECDC4' },
    ...(accuracyPct ? [{ icon: '🎯', val: `${accuracyPct}%`, lbl: 'Accuracy', color: getConfidenceColor(accuracyPct) }] : []),
  ];
  return (
    <LinearGradient colors={[C.cardHighlight, C.card] as [string, string]}
      style={[sb.banner, { borderColor: C.border }]}>
      {items.map((item, i) => (
        <React.Fragment key={item.lbl}>
          {i > 0 ? <View style={[sb.divider, { backgroundColor: C.border }]} /> : null}
          <View style={sb.item}>
            <Text style={sb.icon}>{item.icon}</Text>
            <Text style={[sb.val, { color: item.color }]}>{item.val}</Text>
            <Text style={[sb.lbl, { color: C.textMuted }]}>{item.lbl}</Text>
          </View>
        </React.Fragment>
      ))}
    </LinearGradient>
  );
}
const sb = StyleSheet.create({
  banner: { flexDirection: 'row', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: StyleSheet.hairlineWidth, marginTop: 8, marginBottom: 4 },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  icon: { fontSize: 16 },
  val: { fontSize: 20, fontWeight: FONTS.extraBold },
  lbl: { fontSize: 10 },
  divider: { width: 1, marginVertical: 4 },
});

// ═════════════════════════════════════════════════════════════════════════════
// AI PREDICTION INTELLIGENCE SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
function AIPredictionSummary({
  totalPredictions, elitePicks, highConf, medConf, totalMatches, liveMatches, C,
}: {
  totalPredictions: number; elitePicks: number; highConf: number; medConf: number;
  totalMatches: number; liveMatches: number; C: AppColors;
}) {
  if (totalPredictions === 0 && totalMatches === 0) return null;
  const items = [
    { label: 'Total Picks', value: String(totalPredictions), color: C.primary, icon: 'brain-outline' as const, bg: C.primaryGlow },
    { label: 'Elite (80%+)', value: String(elitePicks), color: '#22C55E', icon: 'shield-checkmark-outline' as const, bg: '#22C55E14' },
    { label: 'High Conf', value: String(highConf), color: '#F59E0B', icon: 'trending-up-outline' as const, bg: '#F59E0B14' },
    { label: 'Live Now', value: String(liveMatches), color: liveMatches > 0 ? '#EF4444' : C.textMuted, icon: 'radio-outline' as const, bg: liveMatches > 0 ? '#EF444414' : C.surface },
  ];
  return (
    <View style={[aps.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={aps.titleRow}>
        <FontAwesome5 name="brain" size={9} color={C.primary} />
        <Text style={[aps.title, { color: C.primary }]}>AI PREDICTION INTELLIGENCE</Text>
        <View style={[aps.badge, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}33` }]}>
          <Text style={[aps.badgeText, { color: C.primary }]}>{totalMatches} matches</Text>
        </View>
      </View>
      <View style={aps.grid}>
        {items.map((item) => (
          <View key={item.label} style={[aps.cell, { backgroundColor: item.bg, borderColor: `${item.color}22` }]}>
            <Ionicons name={item.icon} size={10} color={item.color} />
            <Text style={[aps.cellVal, { color: item.color }]}>{item.value}</Text>
            <Text style={[aps.cellLabel, { color: C.textMuted }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const aps = StyleSheet.create({
  wrap: { marginHorizontal: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, padding: 7, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.6, flex: 1 },
  badge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 8, fontWeight: FONTS.bold },
  grid: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, alignItems: 'center', gap: 2, borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: 4 },
  cellVal: { fontSize: 13, fontWeight: FONTS.extraBold, lineHeight: 16 },
  cellLabel: { fontSize: 7, fontWeight: FONTS.semiBold, textAlign: 'center' },
});

// ═════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// =════════════════════════════════════════════════════════════════════════════
export default function PredictionsScreen() {
  const { colors: C } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [dateOffset, setDateOffset] = useState(0);
  const [selectedSport, setSelectedSport] = useState('Football');
  const [predFilter, setPredFilter] = useState<PredFilter>('All');

  const {
    leagues, loading, refreshing, error, refresh,
    isVip, coinBalance, generating, genResult, generateForDate,
  } = useAIPicks(dateOffset, selectedSport);

  const { meta: feedMeta } = usePredictionsFeed({
    sport: selectedSport.toLowerCase(),
    date: String(dateOffset), status: 'all', sort: 'time', limit: 1, autoFetch: true,
  });

  const allMatches = useMemo(() => {
    const seen = new Set<string>();
    return leagues.flatMap((l) => l.matches).filter((m) => { if (seen.has(m.matchId)) return false; seen.add(m.matchId); return true; })
      .map((m) => ({ id: m.matchId, sport: m.sport ?? selectedSport.toLowerCase(), homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0, status: m.status, matchTime: m.matchTime, league: m.league ?? '', homeLogo: m.homeLogo, awayLogo: m.awayLogo, minute: m.minute }));
  }, [leagues, selectedSport]);

  const allPredictions = useMemo(() => {
    const seen = new Set<string>();
    return leagues.flatMap((l) => l.matches)
      .filter((m) => m.hasPrediction && m.matchId)
      .filter((m) => { if (seen.has(m.matchId)) return false; seen.add(m.matchId); return true; })
      .map((m) => ({ id: `pred-${m.matchId}`, matchId: m.matchId, homeWinProb: 0.4, drawProb: 0.25, awayWinProb: 0.35, predictedResult: (m.predictedResult ?? 'home_win') as 'home_win' | 'draw' | 'away_win', confidence: m.confidence ?? 65, overUnder: (m.overUnder ?? 'over') as 'over' | 'under', overUnderLine: m.overUnderLine ?? 2.5, btts: (m.btts ?? 'no') as 'yes' | 'no', aiAnalysis: '', keyFactors: [], riskLevel: m.riskLevel }));
  }, [leagues]);

  const { recommendations, loading: recsLoading } = useRecommendations({
    matches: allMatches as any, predictions: allPredictions as any, expertTips: [], trendingLeagues: [],
    isVip, userId: user?.id ?? null, enabled: !loading && allMatches.length > 0,
  });

  // Map DB sport keys from league data → chip IDs for accurate availability highlighting
  const availableSports = useMemo(() => {
    const s = new Set<string>();
    for (const l of leagues) {
      const dbKey = l.sport.toLowerCase();
      const chipId = DB_KEY_TO_CHIP_ID[dbKey] ??
        (dbKey.charAt(0).toUpperCase() + dbKey.slice(1));
      s.add(chipId);
    }
    return s;
  }, [leagues]);

  const liveCountBySport = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leagues) {
      const n = l.matches.filter((x) => x.status === 'live').length;
      if (n > 0) {
        const dbKey = l.sport.toLowerCase();
        const chipId = DB_KEY_TO_CHIP_ID[dbKey] ?? (dbKey.charAt(0).toUpperCase() + dbKey.slice(1));
        m.set(chipId, (m.get(chipId) ?? 0) + n);
      }
    }
    return m;
  }, [leagues]);

  const filteredLeagues = useMemo(() => {
    if (predFilter === 'All') return leagues;
    return leagues.map((l) => ({ ...l, matches: l.matches.filter((m) => matchPassesPredFilter(m, predFilter)) })).filter((l) => l.matches.length > 0);
  }, [leagues, predFilter]);

  const countryGroups = useMemo(() => groupLeaguesByCountry(filteredLeagues), [filteredLeagues]);

  const totalMatches     = useMemo(() => leagues.reduce((a, l) => a + l.matches.length, 0), [leagues]);
  const liveMatches      = useMemo(() => leagues.reduce((a, l) => a + l.matches.filter((m) => m.status === 'live').length, 0), [leagues]);
  const predictedMatches = useMemo(() => leagues.reduce((a, l) => a + l.matches.filter((m) => m.hasPrediction).length, 0), [leagues]);

  const handleSportChange = useCallback((sport: string) => { setSelectedSport(sport); setPredFilter('All'); }, []);
  const handleHighConfPress = useCallback((matchId: string) => {
    router.push({ pathname: '/ai-pick/[id]', params: { id: matchId } } as any);
  }, [router]);

  const sectionLabel = `${selectedSport} Matches`;
  const sectionCount = filteredLeagues.length;

  return (
    <SafeAreaView style={[scr.root, { backgroundColor: C.bg }]} edges={['top']}>

      {/* Header */}
      <PicksHeader isVip={isVip} coinBalance={coinBalance} C={C} />

      {/* Date Nav — perfectly centered, auto-scrolls */}
      <DateSelectorBar selectedOffset={dateOffset} onSelect={setDateOffset} C={C} />

      {/* Sport Nav */}
      <SportNavBar selected={selectedSport} onSelect={handleSportChange} availableSports={availableSports} liveCountBySport={liveCountBySport} C={C} />

      {/* Market Filter Bar */}
      <PredictionFilterBar selected={predFilter} onSelect={setPredFilter} leagues={leagues} sport={selectedSport} C={C} />

      {/* Generate AI Bar */}
      <GenerateAIBar leagues={leagues} loading={loading} generating={generating} genResult={genResult} onGenerate={generateForDate} dateOffset={dateOffset} selectedSport={selectedSport} C={C} />

      {/* AI Intelligence Summary */}
      {!loading && totalMatches > 0 ? (
        <AIPredictionSummary
          totalPredictions={predictedMatches}
          elitePicks={leagues.flatMap(l => l.matches).filter(m => m.hasPrediction && (m.confidence ?? 0) >= 80).length}
          highConf={leagues.flatMap(l => l.matches).filter(m => m.hasPrediction && (m.confidence ?? 0) >= 70 && (m.confidence ?? 0) < 80).length}
          medConf={leagues.flatMap(l => l.matches).filter(m => m.hasPrediction && (m.confidence ?? 0) >= 55 && (m.confidence ?? 0) < 70).length}
          totalMatches={totalMatches}
          liveMatches={liveMatches}
          C={C}
        />
      ) : null}

      {/* High Confidence strip */}
      <HighConfidenceSection recommendations={recommendations} loading={recsLoading && allMatches.length > 0} C={C} onPress={handleHighConfPress} />

      {/* Content */}
      {loading ? (
        <ScrollView showsVerticalScrollIndicator={false}><AIPicksSkeleton /></ScrollView>
      ) : error ? (
        <View style={[scr.errorWrap, { paddingHorizontal: SPACING.lg }]}>
          <Ionicons name="warning-outline" size={36} color={C.accentRed} />
          <Text style={[scr.errorText, { color: C.textPrimary }]}>{error}</Text>
          <Pressable style={[scr.retryBtn, { backgroundColor: C.primary }]} onPress={refresh}>
            <Text style={[scr.retryBtnText, { color: C.textInverse }]}>Retry</Text>
          </Pressable>
        </View>
      ) : countryGroups.length === 0 && filteredLeagues.length === 0 ? (
        <ScrollView
          contentContainerStyle={scr.emptyScroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}>
          <SportEmptyState sport={selectedSport} dateOffset={dateOffset} onDateChange={setDateOffset} C={C} />
        </ScrollView>
      ) : (
        <ScrollView
          style={scr.scroll}
          contentContainerStyle={scr.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.primary} />}
          showsVerticalScrollIndicator={false}>

          <View style={scr.sectionHeader}>
            <Text style={[scr.sectionTitle, { color: C.textPrimary }]}>{sectionLabel}</Text>
            <View style={[scr.countPill, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="layers-outline" size={11} color={C.textMuted} />
              <Text style={[scr.countPillText, { color: C.textMuted }]}>
                {countryGroups.length > 1
                  ? `${countryGroups.length} countries`
                  : `${sectionCount} league${sectionCount !== 1 ? 's' : ''}`}
              </Text>
            </View>
          </View>

          {countryGroups.length > 1 ? (
            countryGroups.map((group) => (
              <CountryCard key={group.country} group={group} predFilter={predFilter} dateOffset={dateOffset} sport={selectedSport} C={C} />
            ))
          ) : countryGroups.length === 1 ? (
            countryGroups[0].leagues
              .filter((l) => predFilter === 'All' || l.matches.some((m) => matchPassesPredFilter(m, predFilter)))
              .map((league) => (
                <InlineLeagueSection key={league.id} league={league} predFilter={predFilter} dateOffset={dateOffset} sport={selectedSport} C={C} />
              ))
          ) : null}

          <StatsBanner
            liveMatches={liveMatches}
            totalMatches={totalMatches}
            predictedMatches={predictedMatches}
            accuracyPct={feedMeta?.outcomeStats?.total > 0 ? feedMeta.outcomeStats.accuracy_pct : undefined}
            C={C}
          />

          <View style={{ marginTop: 8 }}>
            <DisclaimerBanner compact />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const scr = StyleSheet.create({
  root: { flex: 1 },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryBtn: { borderRadius: RADIUS.full, paddingHorizontal: 22, paddingVertical: 9 },
  retryBtnText: { fontSize: 13, fontWeight: FONTS.bold },
  emptyScroll: { flexGrow: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACING.md, paddingTop: 10, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: FONTS.bold },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  countPillText: { fontSize: 10, fontWeight: FONTS.medium },
});
