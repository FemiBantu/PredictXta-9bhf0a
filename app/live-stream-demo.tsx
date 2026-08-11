/**
 * live-stream-demo.tsx
 * Demonstrates the SSE live stream connection using useLiveStream hook.
 * Shows connection state, live match count, latest event, and real-time score updates.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useLiveStream, type StreamConnectionState } from '@/hooks/useLiveStream';
import type { AppColors } from '@/constants/theme';

// ─── Connection state badge ───────────────────────────────────────────────────
function ConnectionBadge({ state, C }: { state: StreamConnectionState; C: AppColors }) {
  const meta: Record<StreamConnectionState, { color: string; label: string; icon: string }> = {
    connected:    { color: '#22C55E', label: 'Connected · SSE',    icon: 'wifi' },
    connecting:   { color: '#F59E0B', label: 'Connecting…',        icon: 'sync' },
    fallback:     { color: '#3B82F6', label: 'Fallback · Polling', icon: 'cloud-download-outline' },
    disconnected: { color: C.textMuted, label: 'Disconnected',     icon: 'wifi-outline' },
    error:        { color: '#EF4444', label: 'Error',              icon: 'warning-outline' },
  };
  const m = meta[state];
  return (
    <View style={[st.connBadge, { backgroundColor: `${m.color}14`, borderColor: `${m.color}44` }]}>
      <Ionicons name={m.icon as any} size={13} color={m.color} />
      <Text style={[st.connLabel, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

// ─── Sport emoji map ──────────────────────────────────────────────────────────
const SPORT_EMOJI: Record<string, string> = {
  football: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏸',
  mma: '🥊', baseball: '⚾', hockey: '🏒', rugby: '🏉',
};

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function LiveStreamDemoScreen() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [sport, setSport] = useState<string | undefined>(undefined);
  const [includeOdds, setIncludeOdds] = useState(false);

  const {
    liveMatches,
    latestEvent,
    oddsMap,
    connectionState,
    lastUpdated,
    liveCount,
    reconnect,
  } = useLiveStream({ sport, includeOdds, enabled: true });

  const sportOptions = ['All', 'football', 'basketball', 'tennis', 'cricket'];

  return (
    <View style={[st.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[st.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}
            style={({ pressed }) => [st.backBtn, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}>
            <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
          </Pressable>
          <Text style={[st.title, { color: C.textPrimary }]}>Live Stream</Text>
          <ConnectionBadge state={connectionState} C={C} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Controls */}
        <View style={[st.section, { borderBottomColor: C.border }]}>
          <View style={st.controlRow}>
            <Text style={[st.controlLabel, { color: C.textMuted }]}>Sport Filter</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {sportOptions.map((sp) => {
                const active = (sp === 'All' ? undefined : sp) === sport;
                return (
                  <Pressable key={sp}
                    style={[st.chip, { backgroundColor: C.card, borderColor: C.border }, active ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : null]}
                    onPress={() => setSport(sp === 'All' ? undefined : sp)}>
                    <Text style={[st.chipText, { color: C.textSecondary }, active ? { color: C.primary, fontWeight: FONTS.bold } : null]}>
                      {SPORT_EMOJI[sp] ?? ''} {sp}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={st.controlRow}>
            <Text style={[st.controlLabel, { color: C.textMuted }]}>Include Odds</Text>
            <Pressable
              style={[st.toggle, includeOdds ? { backgroundColor: C.primaryGlow, borderColor: C.primary } : { backgroundColor: C.card, borderColor: C.border }]}
              onPress={() => setIncludeOdds((v) => !v)}>
              <Text style={[st.toggleText, { color: includeOdds ? C.primary : C.textMuted }]}>
                {includeOdds ? 'ON' : 'OFF'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Stats row */}
        <View style={[st.statsRow, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={st.stat}>
            <Text style={[st.statVal, { color: C.accentRed }]}>{liveCount}</Text>
            <Text style={[st.statLbl, { color: C.textMuted }]}>Live</Text>
          </View>
          <View style={[st.statDivider, { backgroundColor: C.border }]} />
          <View style={st.stat}>
            <Text style={[st.statVal, { color: C.primary }]}>{Object.keys(oddsMap).length}</Text>
            <Text style={[st.statLbl, { color: C.textMuted }]}>Odds</Text>
          </View>
          <View style={[st.statDivider, { backgroundColor: C.border }]} />
          <View style={st.stat}>
            <Text style={[st.statVal, { color: C.accentBlue }]}>
              {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
            </Text>
            <Text style={[st.statLbl, { color: C.textMuted }]}>Updated</Text>
          </View>
          <Pressable
            onPress={reconnect}
            style={({ pressed }) => [st.reconnectBtn, { backgroundColor: C.card, borderColor: C.border }, pressed ? { opacity: 0.7 } : null]}>
            <Ionicons name="refresh" size={16} color={C.primary} />
          </Pressable>
        </View>

        {/* Latest event banner */}
        {latestEvent ? (
          <View style={[st.eventBanner, { backgroundColor: `${C.accent}12`, borderColor: `${C.accent}33` }]}>
            <Text style={st.eventIcon}>
              {latestEvent.event_type === 'goal' || latestEvent.event_type === 'penalty_goal' ? '⚽'
                : latestEvent.event_type === 'yellow_card' ? '🟨'
                : latestEvent.event_type === 'red_card' ? '🟥'
                : latestEvent.event_type === 'substitution' ? '🔄' : '📍'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[st.eventTitle, { color: C.textPrimary }]}>
                {latestEvent.player_name || 'Event'} — {latestEvent.minute}'
              </Text>
              <Text style={[st.eventSub, { color: C.textMuted }]} numberOfLines={1}>
                {latestEvent.home_team} vs {latestEvent.away_team}
                {latestEvent.detail ? ` · ${latestEvent.detail}` : ''}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Live matches list */}
        <View style={[st.section, { paddingTop: 0 }]}>
          <Text style={[st.sectionTitle, { color: C.textPrimary }]}>🔴 Live Matches</Text>
          {liveCount === 0 ? (
            <View style={[st.empty, { borderColor: C.border }]}>
              <MaterialIcons name="sports" size={40} color={C.border} />
              <Text style={[st.emptyText, { color: C.textMuted }]}>
                {connectionState === 'connecting' ? 'Connecting to stream…' : 'No live matches right now'}
              </Text>
            </View>
          ) : (
            liveMatches.map((m) => {
              const odds = oddsMap[m.id];
              return (
                <View key={m.id} style={[st.matchRow, { backgroundColor: C.card, borderColor: C.border }]}>
                  <View style={st.matchInfo}>
                    <Text style={[st.matchSport, { color: C.textMuted }]}>
                      {SPORT_EMOJI[m.sport?.toLowerCase()] ?? '🏆'} {m.league}
                    </Text>
                    <View style={st.teamsRow}>
                      <Text style={[st.teamName, { color: C.textPrimary }]} numberOfLines={1}>{m.homeTeam}</Text>
                      <View style={[st.scoreBox, { backgroundColor: C.bg, borderColor: `${C.accentRed}44` }]}>
                        <Text style={[st.score, { color: C.accentRed }]}>{m.homeScore}</Text>
                        <Text style={[st.scoreSep, { color: C.textMuted }]}>-</Text>
                        <Text style={[st.score, { color: C.accentRed }]}>{m.awayScore}</Text>
                      </View>
                      <Text style={[st.teamName, { color: C.textPrimary, textAlign: 'right' }]} numberOfLines={1}>{m.awayTeam}</Text>
                    </View>
                    <Text style={[st.minute, { color: C.accentRed }]}>{m.minute ? `${m.minute}'` : 'Live'}</Text>
                  </View>
                  {odds ? (
                    <View style={[st.oddsRow, { borderTopColor: C.border }]}>
                      {odds.home_win ? <Text style={[st.odd, { color: C.primary }]}>1: {odds.home_win.toFixed(2)}</Text> : null}
                      {odds.draw ? <Text style={[st.odd, { color: C.textMuted }]}>X: {odds.draw.toFixed(2)}</Text> : null}
                      {odds.away_win ? <Text style={[st.odd, { color: C.primary }]}>2: {odds.away_win.toFixed(2)}</Text> : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.md, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, flexShrink: 0 },
  title: { fontSize: 17, fontWeight: FONTS.bold, flex: 1 },
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  connLabel: { fontSize: 11, fontWeight: FONTS.semiBold },
  section: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm, borderBottomWidth: 0 },
  sectionTitle: { fontSize: 15, fontWeight: FONTS.bold, marginBottom: 10 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  controlLabel: { fontSize: 12, fontWeight: FONTS.semiBold, width: 90, flexShrink: 0 },
  chip: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: FONTS.medium },
  toggle: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  toggleText: { fontSize: 12, fontWeight: FONTS.bold },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.md, marginTop: SPACING.sm, borderRadius: RADIUS.lg, borderWidth: 1, paddingVertical: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { fontSize: 18, fontWeight: FONTS.extraBold },
  statLbl: { fontSize: 9, fontWeight: FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 30 },
  reconnectBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginRight: 12 },
  eventBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: SPACING.md, marginTop: SPACING.sm, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12 },
  eventIcon: { fontSize: 22 },
  eventTitle: { fontSize: 13, fontWeight: FONTS.bold },
  eventSub: { fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 48, marginTop: 8 },
  emptyText: { fontSize: 14, fontWeight: FONTS.medium },
  matchRow: { borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  matchInfo: { padding: 12, gap: 4 },
  matchSport: { fontSize: 10, fontWeight: FONTS.medium },
  teamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { flex: 1, fontSize: 13, fontWeight: FONTS.bold },
  scoreBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, flexShrink: 0 },
  score: { fontSize: 16, fontWeight: FONTS.extraBold, minWidth: 14, textAlign: 'center' },
  scoreSep: { fontSize: 12, fontWeight: FONTS.bold },
  minute: { fontSize: 10, fontWeight: FONTS.semiBold, alignSelf: 'flex-start' },
  oddsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1 },
  odd: { fontSize: 12, fontWeight: FONTS.bold },
});
