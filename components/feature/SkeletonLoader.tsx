/**
 * SkeletonLoader — Animated skeleton placeholder components
 * Used by Home, Live, AI Picks, and Profile screens during data loading.
 * Replaces ActivityIndicator spinners with contextual pulsing placeholders.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { RADIUS, SPACING } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Base Skeleton Block ───────────────────────────────────────────────────────
interface SkeletonBlockProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: object;
}

export function SkeletonBlock({ width = '100%', height = 16, borderRadius = RADIUS.sm, style }: SkeletonBlockProps) {
  const { colors: C } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: C.border },
        { opacity },
        style,
      ]}
    />
  );
}

// ─── Match Card Skeleton ───────────────────────────────────────────────────────
export function MatchCardSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* Header row */}
      <View style={sk.headerRow}>
        <SkeletonBlock width={16} height={16} borderRadius={8} />
        <SkeletonBlock width={120} height={11} borderRadius={6} />
        <View style={{ flex: 1 }} />
        <SkeletonBlock width={36} height={20} borderRadius={RADIUS.full} />
        <SkeletonBlock width={30} height={30} borderRadius={RADIUS.md} />
      </View>
      {/* Teams row */}
      <View style={sk.teamsRow}>
        {/* Home team */}
        <View style={sk.teamBlock}>
          <SkeletonBlock width={44} height={44} borderRadius={22} />
          <SkeletonBlock width={70} height={12} borderRadius={6} />
          <SkeletonBlock width={30} height={22} borderRadius={6} />
        </View>
        <SkeletonBlock width={16} height={16} borderRadius={4} style={{ marginHorizontal: 12 }} />
        {/* Away team */}
        <View style={sk.teamBlock}>
          <SkeletonBlock width={44} height={44} borderRadius={22} />
          <SkeletonBlock width={70} height={12} borderRadius={6} />
          <SkeletonBlock width={30} height={22} borderRadius={6} />
        </View>
      </View>
    </View>
  );
}

// ─── Prediction Card Skeleton ─────────────────────────────────────────────────
export function PredictionCardSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={sk.predTop}>
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBlock width="80%" height={14} borderRadius={6} />
          <SkeletonBlock width="50%" height={11} borderRadius={5} />
        </View>
        <SkeletonBlock width={48} height={48} borderRadius={24} />
      </View>
      <View style={sk.chipsRow}>
        <SkeletonBlock width={70} height={26} borderRadius={RADIUS.full} />
        <SkeletonBlock width={80} height={26} borderRadius={RADIUS.full} />
        <SkeletonBlock width={70} height={26} borderRadius={RADIUS.full} />
      </View>
      <View style={[sk.vipRow, { borderColor: C.border }]}>
        <SkeletonBlock width="30%" height={28} borderRadius={RADIUS.sm} />
        <SkeletonBlock width="30%" height={28} borderRadius={RADIUS.sm} />
        <SkeletonBlock width="30%" height={28} borderRadius={RADIUS.sm} />
      </View>
    </View>
  );
}

// ─── News Card Skeleton ───────────────────────────────────────────────────────
export function NewsCardSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.newsCard, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={sk.newsTop}>
        <SkeletonBlock width={50} height={16} borderRadius={RADIUS.full} />
        <SkeletonBlock width={60} height={10} borderRadius={4} />
      </View>
      <SkeletonBlock width="90%" height={13} borderRadius={5} />
      <SkeletonBlock width="70%" height={13} borderRadius={5} />
      <SkeletonBlock width="85%" height={11} borderRadius={4} />
    </View>
  );
}

// ─── Expert Tip Card Skeleton ─────────────────────────────────────────────────
export function ExpertTipSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.tipCard, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[sk.tipStripe, { backgroundColor: C.border }]} />
      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        <View style={sk.headerRow}>
          <SkeletonBlock width={16} height={16} borderRadius={8} />
          <SkeletonBlock width={100} height={13} borderRadius={5} />
        </View>
        <View style={sk.chipsRow}>
          <SkeletonBlock width="55%" height={36} borderRadius={RADIUS.md} />
          <SkeletonBlock width={44} height={36} borderRadius={RADIUS.md} />
        </View>
        <View style={sk.headerRow}>
          <SkeletonBlock width={70} height={10} borderRadius={4} />
          <SkeletonBlock width={40} height={18} borderRadius={RADIUS.full} />
        </View>
      </View>
    </View>
  );
}

// ─── Stats Banner Skeleton ─────────────────────────────────────────────────────
export function StatsBannerSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.statsBanner, { backgroundColor: C.card, borderColor: C.border }]}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={[sk.divider, { backgroundColor: C.border }]} /> : null}
          <View style={sk.statItem}>
            <SkeletonBlock width={28} height={28} borderRadius={14} />
            <SkeletonBlock width={32} height={22} borderRadius={6} />
            <SkeletonBlock width={44} height={10} borderRadius={4} />
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── Section Header Skeleton ──────────────────────────────────────────────────
export function SectionHeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <View style={[sk.sectionHeader, { paddingHorizontal: SPACING.md }]}>
      <SkeletonBlock width={wide ? 180 : 130} height={18} borderRadius={7} />
      <View style={{ flex: 1 }} />
      <SkeletonBlock width={56} height={14} borderRadius={5} />
    </View>
  );
}

// ─── Trending League Chip Skeleton ────────────────────────────────────────────
export function LeagueChipSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={[sk.leagueChip, { backgroundColor: C.card, borderColor: C.border }]}>
      <SkeletonBlock width={26} height={26} borderRadius={4} />
      <View style={{ gap: 5 }}>
        <SkeletonBlock width={90} height={12} borderRadius={5} />
        <SkeletonBlock width={60} height={10} borderRadius={4} />
      </View>
    </View>
  );
}

// ─── Full Home Screen Skeleton ─────────────────────────────────────────────────
export function HomeScreenSkeleton() {
  return (
    <View style={sk.screenPadding}>
      <StatsBannerSkeleton />
      <View style={{ height: SPACING.sm }} />
      {/* Trending leagues row */}
      <SectionHeaderSkeleton wide />
      <View style={sk.leaguesRow}>
        {[0, 1, 2].map((i) => <LeagueChipSkeleton key={i} />)}
      </View>
      {/* AI picks */}
      <SectionHeaderSkeleton />
      <PredictionCardSkeleton />
      <PredictionCardSkeleton />
      {/* News */}
      <SectionHeaderSkeleton wide />
      <View style={sk.newsRow}>
        {[0, 1].map((i) => <NewsCardSkeleton key={i} />)}
      </View>
      {/* Expert tips */}
      <SectionHeaderSkeleton />
      <View style={sk.newsRow}>
        {[0, 1].map((i) => <ExpertTipSkeleton key={i} />)}
      </View>
      {/* Upcoming matches */}
      <SectionHeaderSkeleton />
      {[0, 1, 2].map((i) => <MatchCardSkeleton key={i} />)}
    </View>
  );
}

// ─── Full Live Screen Skeleton ─────────────────────────────────────────────────
export function LiveScreenSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={sk.screenPadding}>
      {/* Banner */}
      <View style={[sk.liveBanner, { backgroundColor: C.card, borderColor: C.border }]}>
        <SkeletonBlock width={24} height={24} borderRadius={12} />
        <View style={{ flex: 1, gap: 5 }}>
          <SkeletonBlock width={80} height={11} borderRadius={4} />
          <SkeletonBlock width={140} height={13} borderRadius={5} />
        </View>
        <SkeletonBlock width={80} height={22} borderRadius={RADIUS.full} />
      </View>
      {/* Source pill */}
      <SkeletonBlock width={180} height={26} borderRadius={RADIUS.full} style={{ marginBottom: SPACING.sm }} />
      {/* Sport section header */}
      <View style={[sk.sportSectionHeader, { backgroundColor: C.card, borderColor: C.border }]}>
        <SkeletonBlock width={20} height={20} borderRadius={4} />
        <SkeletonBlock width={80} height={15} borderRadius={6} style={{ flex: 1 }} />
        <SkeletonBlock width={24} height={24} borderRadius={RADIUS.full} />
        <SkeletonBlock width={44} height={20} borderRadius={RADIUS.full} />
        <SkeletonBlock width={20} height={20} borderRadius={4} />
      </View>
      {[0, 1, 2, 3].map((i) => <MatchCardSkeleton key={i} />)}
    </View>
  );
}

// ─── AI Picks Skeleton ─────────────────────────────────────────────────────────
export function AIPicksSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={sk.screenPadding}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={[sk.countryCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={sk.headerRow}>
            <SkeletonBlock width={24} height={24} borderRadius={6} />
            <SkeletonBlock width={100} height={15} borderRadius={6} />
            <View style={{ flex: 1 }} />
            <SkeletonBlock width={32} height={20} borderRadius={RADIUS.full} />
          </View>
          {i < 2 ? (
            <>
              <View style={[sk.leagueRow, { borderTopColor: C.border }]}>
                <SkeletonBlock width={16} height={16} borderRadius={3} />
                <SkeletonBlock width={120} height={13} borderRadius={5} />
                <View style={{ flex: 1 }} />
                <SkeletonBlock width={24} height={24} borderRadius={12} />
              </View>
              <View style={[sk.leagueRow, { borderTopColor: C.border }]}>
                <SkeletonBlock width={16} height={16} borderRadius={3} />
                <SkeletonBlock width={90} height={13} borderRadius={5} />
                <View style={{ flex: 1 }} />
                <SkeletonBlock width={24} height={24} borderRadius={12} />
              </View>
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ─── Profile Skeleton ──────────────────────────────────────────────────────────
export function ProfileSkeleton() {
  const { colors: C } = useTheme();
  return (
    <View style={sk.screenPadding}>
      {/* Avatar + name */}
      <View style={[sk.profileHeader, { backgroundColor: C.card, borderColor: C.border }]}>
        <SkeletonBlock width={80} height={80} borderRadius={40} />
        <View style={{ gap: 8, flex: 1 }}>
          <SkeletonBlock width="60%" height={18} borderRadius={7} />
          <SkeletonBlock width="40%" height={12} borderRadius={5} />
          <SkeletonBlock width={120} height={28} borderRadius={RADIUS.full} />
        </View>
      </View>
      {/* Stats row */}
      <View style={[sk.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
        {[0, 1, 2, 3].map((i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={[sk.divider, { backgroundColor: C.border, height: '60%' }]} /> : null}
            <View style={sk.statItem}>
              <SkeletonBlock width={36} height={22} borderRadius={6} />
              <SkeletonBlock width={48} height={10} borderRadius={4} />
            </View>
          </React.Fragment>
        ))}
      </View>
      {/* Tabs */}
      <View style={[sk.tabsRow, { borderBottomColor: C.border }]}>
        {[80, 70, 100].map((w, i) => <SkeletonBlock key={i} width={w} height={13} borderRadius={5} />)}
      </View>
      {/* Content */}
      {[0, 1, 2].map((i) => (
        <View key={i} style={[sk.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={sk.headerRow}>
            <SkeletonBlock width="60%" height={14} borderRadius={6} />
            <View style={{ flex: 1 }} />
            <SkeletonBlock width={48} height={48} borderRadius={24} />
          </View>
          <SkeletonBlock width="100%" height={8} borderRadius={4} style={{ marginTop: 6 }} />
        </View>
      ))}
    </View>
  );
}

// ─── Error State ───────────────────────────────────────────────────────────────
interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message = 'Unable to load data. Please check your connection and try again.', onRetry }: ErrorStateProps) {
  const { colors: C } = useTheme();
  const { Pressable, Text } = require('react-native');
  return (
    <View style={[sk.errorState, { backgroundColor: `${C.accentRed}08`, borderColor: `${C.accentRed}22` }]}>
      <Text style={{ fontSize: 40, marginBottom: 8 }}>⚠️</Text>
      <Text style={[sk.errorTitle, { color: C.textPrimary }]}>{title}</Text>
      <Text style={[sk.errorMessage, { color: C.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [sk.retryBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.75 } : null]}
          onPress={onRetry}
        >
          <Text style={[sk.retryText, { color: C.primary }]}>Try Again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyStateCard({ icon = '📭', title, message, actionLabel, onAction }: EmptyStateProps) {
  const { colors: C } = useTheme();
  const { Pressable, Text } = require('react-native');
  return (
    <View style={[sk.emptyState, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={sk.emptyIcon}>{icon}</Text>
      <Text style={[sk.emptyTitle, { color: C.textPrimary }]}>{title}</Text>
      {message ? <Text style={[sk.emptyMessage, { color: C.textSecondary }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [sk.retryBtn, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}55` }, pressed ? { opacity: 0.75 } : null]}
          onPress={onAction}
        >
          <Text style={[sk.retryText, { color: C.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sk = StyleSheet.create({
  screenPadding: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },

  // Cards
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, marginBottom: 10, gap: 10 },
  newsCard: { width: 220, borderRadius: RADIUS.xl, borderWidth: 1, padding: 12, gap: 8 },
  tipCard: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', width: 240 },
  tipStripe: { width: 4 },
  countryCard: { borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },

  // Row layouts
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  teamBlock: { flex: 1, alignItems: 'center', gap: 6 },
  chipsRow: { flexDirection: 'row', gap: 6 },
  vipRow: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, gap: 8, justifyContent: 'space-between' },
  newsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  newsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  leaguesRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1 },

  // Banner/section components
  statsBanner: { flexDirection: 'row', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, marginBottom: SPACING.sm },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  divider: { width: 1, marginVertical: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  leagueChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, width: 170 },

  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, marginBottom: SPACING.sm },
  sportSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg, padding: 12, borderWidth: 1, marginBottom: 8 },

  // Profile
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: RADIUS.lg, borderWidth: 1, padding: 16, marginBottom: 10 },
  statsRow: { flexDirection: 'row', borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12, marginBottom: 10 },
  tabsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderBottomWidth: 1, marginBottom: 10 },

  // Error / Empty
  errorState: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 24, alignItems: 'center', gap: 10, marginVertical: 16 },
  errorTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  errorMessage: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyState: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 32, alignItems: 'center', gap: 10, marginVertical: 16 },
  emptyIcon: { fontSize: 48, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyMessage: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 9, marginTop: 6 },
  retryText: { fontSize: 13, fontWeight: '600' },

  predTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
