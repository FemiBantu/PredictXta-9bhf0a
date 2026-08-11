/**
 * HOME — Sports Intelligence Command Center
 * Next-generation backend-driven UI
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  Animated, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth, getSupabaseClient, useAlert } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useMatches } from '@/hooks/useMatches';
import { usePredictions } from '@/hooks/usePredictions';
import { useFeed } from '@/hooks/useFeed';
import { useRecommendations } from '@/hooks/useRecommendations';
import MatchCard from '@/components/feature/MatchCard';
import { FONTS, RADIUS, SPACING, SPORTS, SPORT_ICONS, SPORT_API_KEY } from '@/constants/theme';
import { getConfidenceColor, getRiskColor } from '@/services/predictionService';
import type { AppColors } from '@/constants/theme';
import type { Match, Prediction } from '@/services/types';
import type { MatchRecommendation } from '@/services/recommendationEngine';

const HOME_VIP_KEY = 'predictxta_is_vip_v1';
const COIN_KEY = 'predictxta_coin_balance_v1';
const SPORT_PREFS_KEY = '@predictxta/sport_prefs';

// ─── Outdoor sports — show weather badge ────────────────────────────────────
const OUTDOOR_SPORTS = new Set(['football', 'soccer', 'rugby', 'cricket', 'baseball', 'american-football', 'american_football', 'athletics', 'cycling', 'afl']);

const WEATHER_CONDITIONS = [
  { label: 'Clear', emoji: '☀️', detail: 'Ideal conditions', color: '#F59E0B' },
  { label: 'Partly Cloudy', emoji: '⛅', detail: 'Mild conditions', color: '#64748B' },
  { label: 'Overcast', emoji: '🌥️', detail: 'Low visibility risk', color: '#94A3B8' },
  { label: 'Light Rain', emoji: '🌦️', detail: 'Wet pitch likely', color: '#38BDF8' },
  { label: 'Heavy Rain', emoji: '🌧️', detail: 'Affects passing game', color: '#3B82F6' },
  { label: 'Windy', emoji: '💨', detail: 'Wind affects play', color: '#A78BFA' },
  { label: 'Cold', emoji: '🥶', detail: 'Cold conditions', color: '#67E8F9' },
  { label: 'Hot', emoji: '🌡️', detail: 'High temp expected', color: '#EF4444' },
];

function getWeatherForMatch(homeTeam: string, matchTime: string): typeof WEATHER_CONDITIONS[0] {
  const seed = homeTeam.charCodeAt(0) * 13 + (homeTeam.charCodeAt(1) ?? 7) * 7 + new Date(matchTime).getDate();
  return WEATHER_CONDITIONS[seed % WEATHER_CONDITIONS.length];
}

// ─── Match Importance Badge ───────────────────────────────────────────────────
const DERBY_KEYWORDS: string[][] = [
  ['manchester city', 'manchester united'], ['arsenal', 'tottenham'], ['liverpool', 'everton'],
  ['chelsea', 'arsenal'], ['real madrid', 'atletico'], ['barcelona', 'real madrid'],
  ['inter milan', 'ac milan'], ['juventus', 'torino'], ['boca juniors', 'river plate'],
  ['celtic', 'rangers'], ['ajax', 'feyenoord'], ['dortmund', 'schalke'],
  ['lakers', 'clippers'], ['celtics', 'lakers'], ['yankees', 'red sox'],
];

function getMatchImportance(homeTeam: string, awayTeam: string, league: string): { label: string; emoji: string; color: string } | null {
  const hl = homeTeam.toLowerCase(); const al = awayTeam.toLowerCase(); const ll = (league ?? '').toLowerCase();
  for (const pair of DERBY_KEYWORDS) {
    if ((hl.includes(pair[0]) || hl.includes(pair[1])) && (al.includes(pair[0]) || al.includes(pair[1]))) {
      return { label: 'Derby Match', emoji: '🔥', color: '#EF4444' };
    }
  }
  if (ll.includes('champions league') || ll.includes('ucl') || ll.includes('world cup') || ll.includes('euro')) {
    return { label: 'Elite Fixture', emoji: '🏆', color: '#F59E0B' };
  }
  if (ll.includes('cup') || ll.includes('final') || ll.includes('playoff')) {
    return { label: 'Cup Fixture', emoji: '🥇', color: '#A78BFA' };
  }
  const seed = homeTeam.charCodeAt(0) * 7 + awayTeam.charCodeAt(0) * 11;
  const importance = seed % 7;
  if (importance === 0) return { label: 'Title Decider', emoji: '👑', color: '#FFD700' };
  if (importance === 1) return { label: 'Relegation Battle', emoji: '⚠️', color: '#EF4444' };
  if (importance === 2) return { label: 'Top 4 Race', emoji: '🎯', color: '#22C55E' };
  if (importance === 3) return { label: 'Promotion Push', emoji: '📈', color: '#38BDF8' };
  return null;
}

// ─── Pulsing dot ─────────────────────────────────────────────────────────────
function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    a.start(); return () => a.stop();
  }, []);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: op }} />;
}

// ─── Confidence Arc ───────────────────────────────────────────────────────────
function ConfArc({ value, color, size = 48 }: { value: number; color: string; size?: number }) {
  const deg = (value / 100) * 270;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: `${color}20` }]} />
      <View style={[{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 3, borderColor: color,
        borderRightColor: 'transparent', borderBottomColor: value < 50 ? 'transparent' : color,
        transform: [{ rotate: `${deg - 90}deg` }],
      }]} />
      <Text style={{ fontSize: size * 0.21, fontWeight: '800', color }}>{value}%</Text>
    </View>
  );
}

// ─── Hero Match Card ──────────────────────────────────────────────────────────
function HeroMatchCard({ match, prediction, C, onPress }: {
  match: Match; prediction?: Prediction; C: AppColors; onPress: () => void;
}) {
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const confColor = prediction ? getConfidenceColor(prediction.confidence) : C.primary;
  const abbr = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const predResult = prediction?.predictedResult;

  const isOutdoor = OUTDOOR_SPORTS.has(match.sport?.toLowerCase() ?? '');
  const weather = isOutdoor ? getWeatherForMatch(match.homeTeam, match.matchTime) : null;
  const importance = getMatchImportance(match.homeTeam, match.awayTeam, match.league ?? '');

  // Glassmorphism gradient
  const glassColors: [string, string, string] = isLive
    ? ['rgba(239,68,68,0.22)', 'rgba(30,10,10,0.95)', 'rgba(15,5,5,0.98)']
    : prediction
    ? [`${confColor}18`, 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.01)']
    : [`${C.primary}14`, 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0)'];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        hmc.card,
        { borderColor: isLive ? 'rgba(239,68,68,0.5)' : prediction ? `${confColor}33` : `${C.primary}22` },
        pressed ? { opacity: 0.92, transform: [{ scale: 0.992 }] } : null,
      ]}
    >
      <LinearGradient
        colors={glassColors}
        style={hmc.gradient}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      >
        {/* Glass shimmer overlay */}
        <View style={hmc.glassShimmer} pointerEvents="none" />

        {/* Header */}
        <View style={hmc.header}>
          <View style={hmc.leagueRow}>
            {match.leagueLogo ? <Image source={{ uri: match.leagueLogo }} style={hmc.leagueLogo} contentFit="contain" /> : null}
            <Text style={[hmc.league, { color: C.textMuted }]} numberOfLines={1}>{match.league}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {weather && !isLive ? (
              <View style={[hmc.weatherBadge, { backgroundColor: `${weather.color}15`, borderColor: `${weather.color}33` }]}>
                <Text style={hmc.weatherEmoji}>{weather.emoji}</Text>
                <Text style={[hmc.weatherLabel, { color: weather.color }]}>{weather.label}</Text>
              </View>
            ) : null}
            {isLive ? (
              <View style={hmc.liveBadge}>
                <PulseDot color="#FF4757" size={6} />
                <Text style={hmc.liveText}>LIVE {match.minute ? `${match.minute}'` : ''}</Text>
              </View>
            ) : isFinished ? (
              <View style={[hmc.ftBadge, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[hmc.ftText, { color: C.textMuted }]}>FT</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Match importance badge */}
        {importance ? (
          <View style={[hmc.importanceBadge, { backgroundColor: `${importance.color}18`, borderColor: `${importance.color}44` }]}>
            <Text style={hmc.importanceEmoji}>{importance.emoji}</Text>
            <Text style={[hmc.importanceLabel, { color: importance.color }]}>{importance.label}</Text>
          </View>
        ) : null}

        {/* Teams row */}
        <View style={hmc.teamsRow}>
          <View style={hmc.team}>
            {match.homeLogo
              ? <Image source={{ uri: match.homeLogo }} style={hmc.teamLogo} contentFit="contain" />
              : <View style={[hmc.teamLogoPlaceholder, { backgroundColor: `${C.primary}18` }]}><Text style={hmc.teamAbbr}>{abbr(match.homeTeam)}</Text></View>
            }
            <Text style={[hmc.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.homeTeam}</Text>
          </View>

          <View style={hmc.centerCol}>
            {isLive || isFinished ? (
              <View style={hmc.scoreWrap}>
                <Text style={[hmc.score, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.homeScore}</Text>
                <Text style={[hmc.scoreSep, { color: C.textMuted }]}>-</Text>
                <Text style={[hmc.score, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.awayScore}</Text>
              </View>
            ) : (
              <View style={[hmc.vsBox, { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' }]}>
                <Text style={[hmc.vsText, { color: C.textMuted }]}>VS</Text>
              </View>
            )}
            {prediction ? (
              <View style={hmc.arcWrap}>
                <ConfArc value={prediction.confidence} color={confColor} size={44} />
                <Text style={[hmc.arcLabel, { color: C.textMuted }]}>AI Conf.</Text>
              </View>
            ) : null}
          </View>

          <View style={[hmc.team, hmc.teamRight]}>
            {match.awayLogo
              ? <Image source={{ uri: match.awayLogo }} style={hmc.teamLogo} contentFit="contain" />
              : <View style={[hmc.teamLogoPlaceholder, { backgroundColor: `${C.primary}18` }]}><Text style={hmc.teamAbbr}>{abbr(match.awayTeam)}</Text></View>
            }
            <Text style={[hmc.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.awayTeam}</Text>
          </View>
        </View>

        {/* Weather detail strip for outdoor sports */}
        {weather && isOutdoor && !isLive ? (
          <View style={[hmc.weatherStrip, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' }]}>
            <Ionicons name="partly-sunny-outline" size={11} color={C.textMuted} />
            <Text style={[hmc.weatherDetail, { color: C.textMuted }]}>{weather.detail}</Text>
            <View style={[hmc.weatherDot, { backgroundColor: weather.color }]} />
            <Text style={[hmc.weatherDetailVal, { color: weather.color }]}>{weather.label}</Text>
          </View>
        ) : null}

        {/* AI prediction chips */}
        {prediction ? (
          <View style={hmc.chips}>
            <View style={[hmc.chip, { backgroundColor: `${confColor}18`, borderColor: `${confColor}33` }]}>
              <FontAwesome5 name="brain" size={9} color={confColor} />
              <Text style={[hmc.chipText, { color: confColor }]}>
                {predResult === 'home_win' ? '1 HOME' : predResult === 'draw' ? 'X DRAW' : '2 AWAY'}
              </Text>
            </View>
            {prediction.overUnder ? (
              <View style={[hmc.chip, { backgroundColor: prediction.overUnder === 'over' ? '#22C55E18' : '#EF444418', borderColor: prediction.overUnder === 'over' ? '#22C55E44' : '#EF444444' }]}>
                <Text style={[hmc.chipText, { color: prediction.overUnder === 'over' ? '#22C55E' : '#EF4444' }]}>
                  {prediction.overUnder.toUpperCase()} {prediction.overUnderLine}
                </Text>
              </View>
            ) : null}
            {prediction.riskLevel ? (() => {
              const rc = getRiskColor(prediction.riskLevel);
              return (
                <View style={[hmc.chip, { backgroundColor: `${rc}18`, borderColor: `${rc}33` }]}>
                  <Text style={[hmc.chipText, { color: rc }]}>{prediction.riskLevel} Risk</Text>
                </View>
              );
            })() : null}
            <View style={hmc.chipSpacer} />
            <View style={[hmc.detailBtn, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' }]}>
              <Text style={[hmc.detailBtnText, { color: C.textMuted }]}>Details</Text>
              <Ionicons name="chevron-forward" size={11} color={C.textMuted} />
            </View>
          </View>
        ) : (
          <View style={[hmc.chips, { justifyContent: 'flex-end' }]}>
            <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}
const hmc = StyleSheet.create({
  card: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 },
  gradient: { padding: SPACING.md, gap: 10 },
  glassShimmer: { position: 'absolute', top: 0, left: 0, right: 0, height: 60, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  leagueLogo: { width: 18, height: 18, borderRadius: 3 },
  league: { fontSize: 11, fontWeight: FONTS.medium, flex: 1 },
  weatherBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  weatherEmoji: { fontSize: 11 },
  weatherLabel: { fontSize: 9, fontWeight: FONTS.semiBold },
  weatherStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  weatherDetail: { flex: 1, fontSize: 10 },
  weatherDot: { width: 5, height: 5, borderRadius: 3 },
  weatherDetailVal: { fontSize: 10, fontWeight: FONTS.semiBold },
  importanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4 },
  importanceEmoji: { fontSize: 11 },
  importanceLabel: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.3 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,71,87,0.15)', borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(255,71,87,0.35)', paddingHorizontal: 8, paddingVertical: 3 },
  liveText: { fontSize: 10, fontWeight: '800', color: '#FF4757', letterSpacing: 0.6 },
  ftBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  ftText: { fontSize: 10, fontWeight: FONTS.semiBold },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { flex: 1, alignItems: 'center', gap: 6 },
  teamRight: {},
  teamLogo: { width: 52, height: 52, borderRadius: 8 },
  teamLogoPlaceholder: { width: 52, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  teamAbbr: { fontSize: 16, fontWeight: '800', color: '#6EDC1F' },
  teamName: { fontSize: 12, fontWeight: FONTS.semiBold, textAlign: 'center', lineHeight: 16 },
  centerCol: { alignItems: 'center', gap: 6, minWidth: 80 },
  arcWrap: { alignItems: 'center', gap: 2 },
  arcLabel: { fontSize: 8, fontWeight: FONTS.semiBold, letterSpacing: 0.4 },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  score: { fontSize: 28, fontWeight: '900', lineHeight: 32 },
  scoreSep: { fontSize: 18, fontWeight: '600' },
  vsBox: { borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  vsText: { fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: FONTS.semiBold },
  chipSpacer: { flex: 1 },
  detailBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  detailBtnText: { fontSize: 10, fontWeight: FONTS.semiBold },
});

// ─── Intelligence Stats Strip ─────────────────────────────────────────────────
function StatsStrip({ live, upcoming, picks, coins, C }: {
  live: number; upcoming: number; picks: number; coins: number; C: AppColors;
}) {
  const items = [
    { emoji: '⚡', val: live, label: 'Live', color: live > 0 ? '#FF4757' : C.textMuted },
    { emoji: '📅', val: upcoming, label: 'Today', color: C.primary },
    { emoji: '🧠', val: picks, label: 'AI Picks', color: '#3B82F6' },
    { emoji: '🪙', val: coins, label: 'Coins', color: '#F59E0B' },
  ];
  return (
    <View style={[ss.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? <View style={[ss.divider, { backgroundColor: C.border }]} /> : null}
          <View style={ss.cell}>
            <Text style={ss.emoji}>{item.emoji}</Text>
            <Text style={[ss.val, { color: item.color }]}>{item.val}</Text>
            <Text style={[ss.label, { color: C.textMuted }]}>{item.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
const ss = StyleSheet.create({
  wrap: { flexDirection: 'row', marginHorizontal: SPACING.md, marginBottom: 14, borderRadius: RADIUS.xl, borderWidth: 1, paddingVertical: 14 },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  emoji: { fontSize: 16 },
  val: { fontSize: 20, fontWeight: '900', lineHeight: 24 },
  label: { fontSize: 9, fontWeight: FONTS.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { width: 1, marginVertical: 6 },
});

// ─── Sport Navigation Rail ────────────────────────────────────────────────────
// ─── Sport Spotlight — AFL + top sports quick-nav cards ─────────────────────
const SPOTLIGHT_SPORTS = [
  { key: 'football',   label: 'Football',   emoji: '⚽', accent: '#6EDC1F' },
  { key: 'basketball', label: 'Basketball', emoji: '🏀', accent: '#F97316' },
  { key: 'rugby',      label: 'Rugby',      emoji: '🏉', accent: '#34D399' },
  { key: 'afl',        label: 'AFL',        emoji: '🏈', accent: '#00B140' },
];

function SportSpotlight({ C, router, liveMatches }: {
  C: AppColors;
  router: ReturnType<typeof useRouter>;
  liveMatches: Match[];
}) {
  const liveByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of liveMatches) {
      const k = m.sport?.toLowerCase() ?? '';
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [liveMatches]);

  return (
    <View style={spot.wrap}>
      {SPOTLIGHT_SPORTS.map((sp) => {
        const count = liveByKey[sp.key] ?? 0;
        return (
          <Pressable
            key={sp.key}
            style={({ pressed }) => [
              spot.card,
              { backgroundColor: C.card, borderColor: count > 0 ? `${sp.accent}55` : C.border },
              pressed ? { opacity: 0.82, transform: [{ scale: 0.96 }] } : null,
            ]}
            onPress={() => router.push({ pathname: '/sports/[sport]', params: { sport: sp.key } } as any)}
            accessibilityLabel={`${sp.label} sport page`}
            accessibilityRole="button"
          >
            <View style={[spot.iconRing, { backgroundColor: `${sp.accent}15`, borderColor: `${sp.accent}35` }]}>
              <Text style={spot.emoji}>{sp.emoji}</Text>
            </View>
            <Text style={[spot.label, { color: C.textPrimary }]}>{sp.label}</Text>
            {count > 0 ? (
              <View style={[spot.livePill, { backgroundColor: '#FF475718', borderColor: '#FF475744' }]}>
                <PulseDot color="#FF4757" size={5} />
                <Text style={spot.liveNum}>{count}</Text>
              </View>
            ) : (
              <View style={[spot.arrow, { borderColor: C.border }]}>
                <Ionicons name="chevron-forward" size={11} color={C.textMuted} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
const spot = StyleSheet.create({
  wrap: { flexDirection: 'row', paddingHorizontal: SPACING.md, gap: 8, marginBottom: 12 },
  card: {
    flex: 1, alignItems: 'center', borderRadius: RADIUS.lg, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 4, gap: 6,
  },
  iconRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  label: { fontSize: 10, fontWeight: FONTS.bold, textAlign: 'center' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2 },
  liveNum: { fontSize: 9, fontWeight: '800', color: '#FF4757' },
  arrow: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

function SportRail({ selected, onChange, C }: { selected: string; onChange: (s: string) => void; C: AppColors }) {
  return (
    <View style={sr.outer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sr.content}>
        {SPORTS.map((sp) => {
          const active = selected === sp;
          return (
            <Pressable
              key={sp}
              style={[sr.chip, { backgroundColor: C.card, borderColor: C.border }, active ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : null]}
              onPress={() => onChange(sp)}
            >
              <Text style={sr.emoji}>{SPORT_ICONS[sp]}</Text>
              <Text style={[sr.label, { color: active ? C.primary : C.textSecondary }, active ? { fontWeight: FONTS.bold } : null]}>{sp}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
const sr = StyleSheet.create({
  outer: { marginBottom: 10 },
  content: { paddingHorizontal: SPACING.md, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
  emoji: { fontSize: 14 },
  label: { fontSize: 13, fontWeight: FONTS.medium },
});

// ─── For You Horizontal Carousel ─────────────────────────────────────────────
function ForYouCard({ rec, C, onPress }: { rec: MatchRecommendation; C: AppColors; onPress: () => void }) {
  const { match, prediction, reasons, isLive } = rec;
  const confColor = prediction ? getConfidenceColor(prediction.confidence) : C.primary;
  const abbr = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const SPORT_EMOJI: Record<string, string> = {
    football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏',
    mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉', afl: '🏉',
    volleyball: '🏐', handball: '🤾', 'american-football': '🏈', formula1: '🏎️',
  };

  const reasonLabels: Record<string, string> = {
    high_confidence: '🔥 Hot Pick',
    live_now: '🔴 Live',
    high_value: '💰 Value',
    expert_tip_available: '💡 Expert',
    trending_league: '📈 Trending',
    kickoff_soon: '⏰ Soon',
  };
  const topReason = reasons.find(r => reasonLabels[r]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [fyc.card, { backgroundColor: C.card, borderColor: isLive ? '#FF475733' : C.border }, pressed ? { opacity: 0.88, transform: [{ scale: 0.97 }] } : null]}
    >
      <View style={[fyc.stripe, { backgroundColor: confColor }]} />
      <View style={fyc.body}>
        <View style={fyc.topRow}>
          <Text style={fyc.sportEmoji}>{SPORT_EMOJI[match.sport?.toLowerCase()] ?? '🏆'}</Text>
          <Text style={[fyc.league, { color: C.textMuted }]} numberOfLines={1}>{match.league}</Text>
          {topReason ? (
            <View style={[fyc.reasonBadge, { backgroundColor: `${confColor}18`, borderColor: `${confColor}33` }]}>
              <Text style={[fyc.reasonText, { color: confColor }]}>{reasonLabels[topReason]}</Text>
            </View>
          ) : null}
        </View>
        <View style={fyc.teams}>
          <View style={fyc.teamSide}>
            {match.homeLogo
              ? <Image source={{ uri: match.homeLogo }} style={fyc.logo} contentFit="contain" />
              : <View style={[fyc.logoPlaceholder, { backgroundColor: `${C.primary}18` }]}><Text style={fyc.logoAbbr}>{abbr(match.homeTeam)}</Text></View>
            }
            <Text style={[fyc.teamName, { color: C.textPrimary }]} numberOfLines={2}>{match.homeTeam}</Text>
          </View>
          <View style={fyc.center}>
            {isLive || match.status === 'finished' ? (
              <Text style={[fyc.score, { color: isLive ? '#FF4757' : C.textPrimary }]}>{match.homeScore}-{match.awayScore}</Text>
            ) : (
              <View style={[fyc.vsBox, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[fyc.vsText, { color: C.textMuted }]}>VS</Text>
              </View>
            )}
            {prediction ? (
              <View style={[fyc.predBubble, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}>
                <Text style={[fyc.predText, { color: C.primary }]}>
                  {prediction.predictedResult === 'home_win' ? '1' : prediction.predictedResult === 'draw' ? 'X' : '2'}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={[fyc.teamSide, fyc.teamRight]}>
            {match.awayLogo
              ? <Image source={{ uri: match.awayLogo }} style={fyc.logo} contentFit="contain" />
              : <View style={[fyc.logoPlaceholder, { backgroundColor: `${C.primary}18` }]}><Text style={fyc.logoAbbr}>{abbr(match.awayTeam)}</Text></View>
            }
            <Text style={[fyc.teamName, fyc.teamNameRight, { color: C.textPrimary }]} numberOfLines={2}>{match.awayTeam}</Text>
          </View>
        </View>
        {prediction ? (
          <View style={fyc.confRow}>
            <View style={[fyc.confTrack, { backgroundColor: `${confColor}20` }]}>
              <View style={[fyc.confFill, { width: `${prediction.confidence}%` as any, backgroundColor: confColor }]} />
            </View>
            <Text style={[fyc.confVal, { color: confColor }]}>{prediction.confidence}%</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
const fyc = StyleSheet.create({
  card: { width: 260, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', flexDirection: 'row' },
  stripe: { width: 4 },
  body: { flex: 1, padding: 12, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sportEmoji: { fontSize: 12, flexShrink: 0 },
  league: { flex: 1, fontSize: 10, fontWeight: FONTS.medium },
  reasonBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  reasonText: { fontSize: 9, fontWeight: '800' },
  teams: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamSide: { flex: 1, alignItems: 'center', gap: 4 },
  teamRight: {},
  logo: { width: 34, height: 34, borderRadius: 6 },
  logoPlaceholder: { width: 34, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  logoAbbr: { fontSize: 10, fontWeight: '800', color: '#6EDC1F' },
  teamName: { fontSize: 10, fontWeight: FONTS.semiBold, textAlign: 'center', lineHeight: 14 },
  teamNameRight: { textAlign: 'right' },
  center: { alignItems: 'center', gap: 4, minWidth: 48 },
  score: { fontSize: 18, fontWeight: '900' },
  vsBox: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  vsText: { fontSize: 11, fontWeight: '700' },
  predBubble: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  predText: { fontSize: 12, fontWeight: '900' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 2 },
  confVal: { fontSize: 10, fontWeight: '800', minWidth: 30, textAlign: 'right' },
});

// ─── Expert Tip Row ───────────────────────────────────────────────────────────
interface ExpertTip {
  id: string; expertName: string; sport: string; matchLabel: string;
  tipType: string; tipValue: string; odds: number | null; confidence: number;
  status: 'pending' | 'won' | 'lost' | 'void'; league: string | null; isPremium: boolean;
}

function ExpertTipRow({ tip, C }: { tip: ExpertTip; C: AppColors }) {
  const SPORT_EMOJI: Record<string, string> = {
    football: '⚽', basketball: '🏀', tennis: '🎾', mma: '🥊', baseball: '⚾',
    hockey: '🏒', rugby: '🏉', afl: '🏉', cricket: '🏏', volleyball: '🏐',
    handball: '🤾', 'american-football': '🏈', formula1: '🏎️',
  };
  const STATUS = {
    won: { color: '#22C55E', label: '✓ WON', bg: '#22C55E18' },
    lost: { color: '#EF4444', label: '✗ LOST', bg: '#EF444418' },
    void: { color: '#6B7280', label: 'VOID', bg: '#6B728018' },
    pending: { color: '#F59E0B', label: 'PENDING', bg: '#F59E0B18' },
  };
  const st = STATUS[tip.status] ?? STATUS.pending;
  const confColor = tip.confidence >= 80 ? '#22C55E' : tip.confidence >= 65 ? '#F59E0B' : C.textMuted;

  return (
    <View style={[etr.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[etr.stripe, { backgroundColor: st.color }]} />
      <View style={etr.body}>
        <View style={etr.row1}>
          <Text style={etr.sEmoji}>{SPORT_EMOJI[tip.sport?.toLowerCase()] ?? '🏆'}</Text>
          <Text style={[etr.matchLabel, { color: C.textPrimary }]} numberOfLines={1}>{tip.matchLabel}</Text>
          {tip.isPremium ? (
            <View style={[etr.vipPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
              <FontAwesome5 name="crown" size={8} color="#F59E0B" />
              <Text style={[etr.vipText, { color: '#F59E0B' }]}>VIP</Text>
            </View>
          ) : null}
        </View>
        <View style={etr.row2}>
          <View style={[etr.tipBox, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={[etr.tipType, { color: C.textMuted }]}>{tip.tipType}</Text>
            <Text style={[etr.tipValue, { color: C.primary }]}>{tip.tipValue}</Text>
          </View>
          {tip.odds ? (
            <View style={[etr.oddsPill, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[etr.oddsAt, { color: C.textMuted }]}>@</Text>
              <Text style={[etr.oddsVal, { color: C.textPrimary }]}>{tip.odds.toFixed(2)}</Text>
            </View>
          ) : null}
          <View style={[etr.stPill, { backgroundColor: st.bg, borderColor: `${st.color}44` }]}>
            <Text style={[etr.stText, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
        <View style={etr.row3}>
          <Ionicons name="person-circle-outline" size={11} color={C.textMuted} />
          <Text style={[etr.expertName, { color: C.textMuted }]}>{tip.expertName}</Text>
          <View style={[etr.confPill, { backgroundColor: `${confColor}14`, borderColor: `${confColor}33` }]}>
            <Text style={[etr.confText, { color: confColor }]}>{tip.confidence}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
const etr = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', width: 240 },
  stripe: { width: 4 },
  body: { flex: 1, padding: 11, gap: 6 },
  row1: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sEmoji: { fontSize: 14 },
  matchLabel: { flex: 1, fontSize: 12, fontWeight: FONTS.bold },
  vipPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2 },
  vipText: { fontSize: 8, fontWeight: '800' },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tipBox: { flex: 1, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4 },
  tipType: { fontSize: 9 },
  tipValue: { fontSize: 12, fontWeight: '800' },
  oddsPill: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4 },
  oddsAt: { fontSize: 10 },
  oddsVal: { fontSize: 12, fontWeight: '700' },
  stPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4 },
  stText: { fontSize: 9, fontWeight: '800' },
  row3: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  expertName: { flex: 1, fontSize: 10 },
  confPill: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  confText: { fontSize: 9, fontWeight: '700' },
});

// ─── Notification badge button ────────────────────────────────────────────────
function NotifBtn({ C, userId, onPress }: { C: AppColors; userId?: string; onPress: () => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const fetch = async () => {
      try {
        const { count } = await getSupabaseClient().from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('read', false);
        setUnread(count ?? 0);
      } catch { /* ignore */ }
    };
    fetch();
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [userId]);
  return (
    <Pressable style={[nb.btn, { backgroundColor: C.card, borderColor: C.border }]} onPress={onPress} hitSlop={6}>
      <Ionicons name="notifications-outline" size={22} color={C.textPrimary} />
      {unread > 0 ? <View style={[nb.dot, { backgroundColor: '#EF4444', borderColor: C.surface }]} /> : null}
    </Pressable>
  );
}
const nb = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
});

// ─── Trending League Chip ─────────────────────────────────────────────────────
function TrendingLeagueChip({ league, C, onPress }: {
  league: { leagueName: string; leagueLogo?: string; sport: string; matchCount: number; liveCount: number };
  C: AppColors;
  onPress: () => void;
}) {
  const EMOJI: Record<string, string> = { football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏', mma: '🥊' };
  return (
    <Pressable
      style={({ pressed }) => [tlc.chip, { backgroundColor: C.card, borderColor: league.liveCount > 0 ? '#FF475733' : C.border }, pressed ? { opacity: 0.8 } : null]}
      onPress={onPress}
    >
      {league.leagueLogo
        ? <Image source={{ uri: league.leagueLogo }} style={tlc.logo} contentFit="contain" />
        : <Text style={{ fontSize: 14 }}>{EMOJI[league.sport?.toLowerCase()] ?? '🏆'}</Text>
      }
      <View style={tlc.info}>
        <Text style={[tlc.name, { color: C.textPrimary }]} numberOfLines={1}>{league.leagueName.split(' — ')[0]}</Text>
        <Text style={[tlc.sub, { color: C.textMuted }]}>{league.matchCount} matches</Text>
      </View>
      {league.liveCount > 0 ? (
        <View style={[tlc.livePill, { backgroundColor: '#FF475718', borderColor: '#FF475744' }]}>
          <PulseDot color="#FF4757" size={5} />
          <Text style={[tlc.liveNum, { color: '#FF4757' }]}>{league.liveCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
const tlc = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9, width: 175 },
  logo: { width: 24, height: 24, borderRadius: 4 },
  info: { flex: 1 },
  name: { fontSize: 11, fontWeight: FONTS.bold },
  sub: { fontSize: 10, marginTop: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2 },
  liveNum: { fontSize: 9, fontWeight: '800' },
});

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHead({ title, action, onAction, C }: { title: string; action?: string; onAction?: () => void; C: AppColors }) {
  return (
    <View style={sh.row}>
      <Text style={[sh.title, { color: C.textPrimary }]}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[sh.action, { color: C.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: FONTS.bold },
  action: { fontSize: 13, fontWeight: FONTS.semiBold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors: C } = useTheme();
  const [sport, setSport] = useState('All');
  const [isVip, setIsVip] = useState(false);
  const [coins, setCoins] = useState(0);

  const { matches, liveMatches, upcomingMatches, loading, refreshing, onRefresh } = useMatches(sport);
  const { predictions } = usePredictions(sport);
  const { feed, unifiedFeed, isOffline, syncing, refresh: feedRefresh } = useFeed({ sport, isVip, userId: user?.id });

  const allMatchesMap = useMemo(() => {
    const map = new Map<string, Match>();
    [...(feed.liveMatches), ...(feed.upcomingMatches), ...(feed.recentMatches), ...matches].forEach(m => map.set(m.id, m));
    return map;
  }, [feed.liveMatches, feed.upcomingMatches, feed.recentMatches, matches]);

  const effectivePredictions = useMemo(() => {
    const seen = new Set<string>();
    return [...feed.predictions, ...predictions].filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }, [feed.predictions, predictions]);

  const effectiveLive = feed.liveMatches.length > 0 ? feed.liveMatches : liveMatches;
  const effectiveUpcoming = feed.upcomingMatches.length > 0 ? feed.upcomingMatches : upcomingMatches;
  const effectiveRecent = feed.recentMatches;

  const filteredLive = useMemo(() =>
    sport === 'All' ? effectiveLive : effectiveLive.filter(m => {
      const dbKey = m.sport.toLowerCase();
      const uiKey = (SPORT_API_KEY[sport] ?? sport.toLowerCase().replace(/\s+/g, '-'));
      return dbKey === uiKey || dbKey.replace(/[\s-]+/g, '') === uiKey.replace(/[\s-]+/g, '');
    }),
    [effectiveLive, sport]
  );
  const filteredUpcoming = useMemo(() =>
    sport === 'All' ? effectiveUpcoming : effectiveUpcoming.filter(m => {
      const dbKey = m.sport.toLowerCase();
      const uiKey = (SPORT_API_KEY[sport] ?? sport.toLowerCase().replace(/\s+/g, '-'));
      return dbKey === uiKey || dbKey.replace(/[\s-]+/g, '') === uiKey.replace(/[\s-]+/g, '');
    }),
    [effectiveUpcoming, sport]
  );

  const allMatches = useMemo(() => {
    const seen = new Set<string>();
    return [...effectiveLive, ...effectiveUpcoming, ...effectiveRecent, ...matches].filter(m => {
      if (seen.has(m.id)) return false; seen.add(m.id); return true;
    });
  }, [effectiveLive, effectiveUpcoming, effectiveRecent, matches]);

  const { recommendations, followedTeams, loading: recsLoading, followTeam, unfollowTeam, onPickViewed, onMatchInteracted } = useRecommendations({
    matches: allMatches,
    predictions: effectivePredictions,
    expertTips: [],
    trendingLeagues: feed.trendingLeagues,
    isVip,
    userId: user?.id ?? null,
    enabled: !loading,
  });

  const forYouItems = useMemo(() => {
    const all = [...(recommendations?.forYou ?? []), ...(recommendations?.topPicks ?? [])];
    const seen = new Set<string>();
    return all.filter(r => { if (seen.has(r.match.id)) return false; seen.add(r.match.id); return true; }).slice(0, 8);
  }, [recommendations]);

  const featuredMatch = filteredLive[0] ?? filteredUpcoming[0] ?? null;
  const featuredPred = featuredMatch ? effectivePredictions.find(p => p.matchId === featuredMatch.id) : undefined;
  const trendingLeagues = feed.trendingLeagues.slice(0, 8);

  const [expertTips, setExpertTips] = useState<ExpertTip[]>([]);
  useEffect(() => {
    const fetchTips = async () => {
      try {
        const { data } = await getSupabaseClient()
          .from('expert_tips')
          .select('id,expert_name,sport,match_label,tip_type,tip_value,odds,confidence,status,league,is_premium,created_at')
          .eq('is_premium', false)
          .order('created_at', { ascending: false })
          .limit(8);
        setExpertTips((data ?? []).map((r: any) => ({
          id: r.id, expertName: r.expert_name, sport: r.sport, matchLabel: r.match_label,
          tipType: r.tip_type, tipValue: r.tip_value, odds: r.odds ? Number(r.odds) : null,
          confidence: Number(r.confidence ?? 70), status: r.status, league: r.league, isPremium: r.is_premium,
        })));
      } catch { /* ignore */ }
    };
    fetchTips();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HOME_VIP_KEY).then(v => { if (v === 'true') setIsVip(true); }).catch(() => {});
    AsyncStorage.getItem(COIN_KEY).then(v => { if (v) setCoins(parseInt(v, 10) || 0); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    getSupabaseClient().from('vip_subscriptions').select('id').eq('user_id', user.id).eq('status', 'active').gt('expires_at', new Date().toISOString()).maybeSingle().then(({ data }) => { const v = !!data; setIsVip(v); AsyncStorage.setItem(HOME_VIP_KEY, v ? 'true' : 'false').catch(() => {}); });
    getSupabaseClient().from('user_coins').select('balance').eq('user_id', user.id).maybeSingle().then(({ data }) => { if (data) { setCoins(data.balance ?? 0); AsyncStorage.setItem(COIN_KEY, String(data.balance ?? 0)).catch(() => {}); } });
  }, [user?.id]);

  const username = user?.username || user?.email?.split('@')[0] || 'User';
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };

  const handleRefresh = async () => { await Promise.allSettled([onRefresh(), feedRefresh()]); };

  return (
    <View style={[ms.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[ms.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <View style={ms.brandRow}>
            <View style={[ms.logoWrap, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <Image source={require('@/assets/logo.png')} style={ms.logo} contentFit="contain" />
            </View>
            <View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={[ms.brandName, { color: C.textPrimary }]}>Predict</Text>
                <Text style={[ms.brandName, { color: C.primary }]}>X</Text>
                <Text style={[ms.brandName, { color: C.textPrimary }]}>ta</Text>
              </View>
              <Text style={[ms.greet, { color: C.textSecondary }]}>Good {greet()}, {username} 👋</Text>
            </View>
          </View>
          <View style={ms.actions}>
            <Pressable style={[ms.iconBtn, { backgroundColor: C.card, borderColor: C.border }]} onPress={() => router.push('/search' as any)}>
              <Ionicons name="search-outline" size={21} color={C.textPrimary} />
            </Pressable>
            <NotifBtn C={C} userId={user?.id} onPress={() => router.push('/notifications' as any)} />
            <Pressable
              style={({ pressed }) => [ms.vipBtn, { backgroundColor: C.primary }, pressed ? { opacity: 0.85 } : null]}
              onPress={() => router.push('/vip' as any)}
            >
              <FontAwesome5 name="crown" size={11} color="#000" />
              <Text style={ms.vipBtnText}>VIP</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        style={ms.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
      >
        {isOffline ? (
          <View style={[ms.banner, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
            <Ionicons name="cloud-offline-outline" size={14} color="#EF4444" />
            <Text style={[ms.bannerText, { color: '#EF4444' }]}>Offline — showing cached data</Text>
          </View>
        ) : syncing ? (
          <View style={[ms.banner, { backgroundColor: `${C.accentBlue}12`, borderColor: `${C.accentBlue}22` }]}>
            <Ionicons name="sync-outline" size={13} color={C.accentBlue} />
            <Text style={[ms.bannerText, { color: C.accentBlue }]}>Syncing latest data...</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 12, marginBottom: 0 }}>
          <StatsStrip
            live={filteredLive.length}
            upcoming={filteredUpcoming.length}
            picks={effectivePredictions.filter(p => allMatchesMap.has(p.matchId)).length}
            coins={coins}
            C={C}
          />
        </View>

        {featuredMatch ? (
          <View style={{ marginBottom: 4 }}>
            <SectionHead
              title={filteredLive.length > 0 ? '🔴 Featured Live Match' : '⭐ Featured Match'}
              action="See All"
              onAction={() => router.push('/(tabs)/live' as any)}
              C={C}
            />
            <HeroMatchCard
              match={featuredMatch}
              prediction={featuredPred}
              C={C}
              onPress={() => {
                onMatchInteracted(featuredMatch.id);
                router.push({ pathname: '/ai-pick/[id]', params: { id: featuredMatch.id } } as any);
              }}
            />
          </View>
        ) : null}

        <SportSpotlight C={C} router={router} liveMatches={effectiveLive} />
        <SportRail selected={sport} onChange={setSport} C={C} />

        {forYouItems.length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            <SectionHead title="💖 For You" action="All Picks" onAction={() => router.push('/(tabs)/predictions' as any)} C={C} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: 10 }}
              decelerationRate="fast"
              snapToInterval={272}
              snapToAlignment="start"
            >
              {forYouItems.map(rec => (
                <ForYouCard
                  key={rec.match.id}
                  rec={rec}
                  C={C}
                  onPress={() => {
                    onPickViewed(rec.match.id);
                    router.push({ pathname: '/ai-pick/[id]', params: { id: rec.match.id } } as any);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {trendingLeagues.length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            <SectionHead title="🔥 Trending Leagues" C={C} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: 8 }}
            >
              {trendingLeagues.map((lg, i) => (
                <TrendingLeagueChip
                  key={i}
                  league={lg}
                  C={C}
                  onPress={() => {
                    const sportLabel = lg.sport.charAt(0).toUpperCase() + lg.sport.slice(1);
                    setSport(sportLabel);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {expertTips.length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            <SectionHead title="💡 Expert Tips" action="All Tips" onAction={() => router.push('/tips' as any)} C={C} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: 10 }}
            >
              {expertTips.map(tip => <ExpertTipRow key={tip.id} tip={tip} C={C} />)}
            </ScrollView>
          </View>
        ) : null}

        {filteredUpcoming.length > 0 ? (
          <View style={{ paddingHorizontal: SPACING.md, marginBottom: 16 }}>
            <SectionHead title="⏰ Upcoming" action="AI Picks" onAction={() => router.push('/(tabs)/predictions' as any)} C={C} />
            {filteredUpcoming.slice(0, 5).map(m => <MatchCard key={m.id} match={m} />)}
          </View>
        ) : null}

        {filteredLive.length > 1 ? (
          <View style={{ paddingHorizontal: SPACING.md, marginBottom: 16 }}>
            <SectionHead title="🔴 All Live" action="See All" onAction={() => router.push('/(tabs)/live' as any)} C={C} />
            {filteredLive.slice(1, 6).map(m => <MatchCard key={m.id} match={m} />)}
          </View>
        ) : null}

        {effectiveRecent.length > 0 ? (
          <View style={{ paddingHorizontal: SPACING.md, marginBottom: 16 }}>
            <SectionHead title="✅ Recent Results" action="See All" onAction={() => router.push('/(tabs)/live' as any)} C={C} />
            {effectiveRecent.slice(0, 4).map(m => <MatchCard key={m.id} match={m} />)}
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [ms.challengeCta, { borderColor: `${C.primary}33` }, pressed ? { opacity: 0.88 } : null]}
          onPress={() => router.push('/challenge' as any)}
        >
          <LinearGradient
            colors={[`${C.primary}18`, `${C.primary}06`] as [string, string]}
            style={ms.challengeGradient}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <View style={[ms.challengeIcon, { backgroundColor: C.primaryGlow, borderColor: `${C.primary}44` }]}>
              <Text style={{ fontSize: 22 }}>🏆</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ms.challengeTitle, { color: C.textPrimary }]}>Daily Challenge</Text>
              <Text style={[ms.challengeSub, { color: C.textMuted }]}>Pick 3 matches · Earn coins · Compete daily</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </LinearGradient>
        </Pressable>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const ms = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  logoWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  logo: { width: 32, height: 32 },
  brandName: { fontSize: 17, fontWeight: '900', letterSpacing: 0.2 },
  greet: { fontSize: 11, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  vipBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 8 },
  vipBtnText: { fontSize: 12, fontWeight: '800', color: '#000' },
  scroll: { flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.md, marginTop: 10, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1 },
  bannerText: { fontSize: 12, fontWeight: FONTS.semiBold },
  challengeCta: { marginHorizontal: SPACING.md, marginBottom: 16, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' },
  challengeGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  challengeIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  challengeTitle: { fontSize: 15, fontWeight: FONTS.bold },
  challengeSub: { fontSize: 12, marginTop: 2 },
});
