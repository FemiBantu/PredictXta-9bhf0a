/**
 * FeedStatusBar — "Last Updated" ribbon for feed screens
 *
 * Shows a compact bar at the top of any feed screen indicating:
 * - How long ago each section was refreshed
 * - Whether data is live, cached, or historical
 * - Offline mode indicator
 * - Record counts for each data section
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS } from '@/constants/theme';
import type { UnifiedFeed } from '@/services/feedEngine';
import { getLastUpdatedLabel } from '@/services/feedEngine';

interface FeedStatusBarProps {
  unifiedFeed: UnifiedFeed;
  isOffline?: boolean;
  syncing?: boolean;
  onRefresh?: () => void;
}

export function FeedStatusBar({ unifiedFeed, isOffline, syncing, onRefresh }: FeedStatusBarProps) {
  const { colors: C } = useTheme();
  const { meta } = unifiedFeed;

  if (isOffline) {
    return (
      <Pressable
        style={[styles.bar, { backgroundColor: `${C.accentRed}14`, borderBottomColor: `${C.accentRed}33` }]}
        onPress={onRefresh}
      >
        <Ionicons name="cloud-offline-outline" size={13} color={C.accentRed} />
        <Text style={[styles.offlineText, { color: C.accentRed }]}>
          Offline — showing cached data. Tap to retry.
        </Text>
      </Pressable>
    );
  }

  if (meta.isFullyStale && !meta.hasAnyData) {
    return (
      <Pressable
        style={[styles.bar, { backgroundColor: `${C.primary}0A`, borderBottomColor: `${C.primary}22` }]}
        onPress={onRefresh}
      >
        <Ionicons name="sync-outline" size={13} color={C.primary} />
        <Text style={[styles.offlineText, { color: C.primary }]}>
          Syncing data… Tap to refresh manually.
        </Text>
      </Pressable>
    );
  }

  if (meta.offlineMode && meta.hasAnyData) {
    return (
      <View style={[styles.bar, { backgroundColor: `#F59E0B14`, borderBottomColor: '#F59E0B33' }]}>
        <Ionicons name="archive-outline" size={13} color="#F59E0B" />
        <Text style={[styles.offlineText, { color: '#F59E0B' }]}>
          Showing cached data · Updated {getLastUpdatedLabel(meta.upcomingSection.lastUpdated)}
        </Text>
      </View>
    );
  }

  // Show compact live indicator + last update time + match/prediction counts
  const liveCount = unifiedFeed.liveMatches.length;
  const upcomingCount = unifiedFeed.upcomingMatches.length;
  const predCount = unifiedFeed.predictions.length;
  const newsCount = unifiedFeed.news?.length ?? 0;
  const upcomingTs = meta.upcomingSection.lastUpdated;

  if (syncing) {
    return (
      <View style={[styles.bar, { backgroundColor: `${C.accent}0A`, borderBottomColor: `${C.accent}22` }]}>
        <Ionicons name="sync-outline" size={12} color={C.accent} />
        <Text style={[styles.infoText, { color: C.accent }]}>Syncing new fixtures…</Text>
      </View>
    );
  }

  // Determine source label
  const src = meta.upcomingSection.source;
  const srcColor = src === 'live' ? C.accent : src === 'cached' ? '#F59E0B' : src === 'historical' ? C.primary : C.textMuted;
  const srcLabel = src === 'live' ? 'Live' : src === 'cached' ? 'Cached' : src === 'historical' ? 'Historical' : 'Empty';
  const srcIcon: any = src === 'live' ? 'checkmark-circle-outline' : src === 'cached' ? 'time-outline' : src === 'historical' ? 'archive-outline' : 'alert-circle-outline';

  return (
    <View style={[styles.bar, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
      {liveCount > 0 ? (
        <View style={[styles.livePill, { backgroundColor: '#EF444418', borderColor: '#EF444444' }]}>
          <View style={[styles.liveDot, { backgroundColor: '#EF4444' }]} />
          <Text style={[styles.liveText, { color: '#EF4444' }]}>{liveCount} LIVE</Text>
        </View>
      ) : null}
      <Text style={[styles.infoText, { color: C.textMuted }]}>
        {upcomingCount > 0 ? `${upcomingCount} upcoming · ` : ''}{predCount > 0 ? `${predCount} picks · ` : ''}{newsCount > 0 ? `${newsCount} news · ` : ''}Updated {getLastUpdatedLabel(upcomingTs)}
      </Text>
      <View style={[styles.srcPill, { backgroundColor: `${srcColor}14`, borderColor: `${srcColor}33` }]}>
        <Ionicons name={srcIcon} size={9} color={srcColor} />
        <Text style={[styles.srcText, { color: srcColor }]}>{srcLabel}</Text>
      </View>
      {meta.recentSection.source === 'historical' ? (
        <View style={[styles.historicalPill, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
          <Ionicons name="time-outline" size={10} color={C.primary} />
          <Text style={[styles.historicalText, { color: C.primary }]}>Historical</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  offlineText: {
    flex: 1,
    fontSize: 12,
    fontWeight: FONTS.semiBold,
  },
  infoText: {
    fontSize: 11,
    fontWeight: FONTS.medium,
    flex: 1,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '800' as any,
    letterSpacing: 0.5,
  },
  srcPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  srcText: {
    fontSize: 9,
    fontWeight: FONTS.bold,
  },
  historicalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  historicalText: {
    fontSize: 9,
    fontWeight: FONTS.bold,
  },
});
