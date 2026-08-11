/**
 * MmaFightCard — Specialized UFC/MMA fight card row component
 *
 * Displays fighter names, records, weight class, title fight badge,
 * fight result (for finished bouts), and card type (Main Card / Prelims).
 * Replaces the generic MatchCard when sport === 'mma'.
 */

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import type { AppColors } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface MmaFight {
  id: string;
  homeTeam: string;   // fighter A name
  awayTeam: string;   // fighter B name
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number;  // rounds won / judge scores (if finished)
  awayScore: number;
  status: 'live' | 'upcoming' | 'finished';
  matchTime: string;
  league: string;     // event name e.g. "UFC 315"
  minute: number;
  stats?: {
    event_name?: string;
    card_type?: string;       // "Main Card" | "Prelims" | "Early Prelims"
    weight_class?: string | null;
    weight_class_icon?: string;
    is_title_fight?: boolean;
    rounds?: number;
    result_method?: string | null;  // "KO/TKO" | "Submission" | "Decision"
    home_record?: string | null;
    away_record?: string | null;
    home_country?: string | null;
    away_country?: string | null;
    home_nickname?: string | null;
    away_nickname?: string | null;
  } | null;
}

// ─── Card-type pill colors ────────────────────────────────────────────────────
const CARD_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  'Main Card':     { bg: 'rgba(244,63,94,0.15)', text: '#F43F5E' },
  'Prelims':       { bg: 'rgba(249,115,22,0.15)', text: '#F97316' },
  'Early Prelims': { bg: 'rgba(107,114,128,0.15)', text: '#9CA3AF' },
};

function getCardTypeStyle(cardType: string | undefined) {
  return CARD_TYPE_COLORS[cardType ?? ''] ?? { bg: 'rgba(110,220,31,0.12)', text: '#6EDC1F' };
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function formatFightTime(isoTime: string): string {
  try {
    const d = new Date(isoTime);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// ─── Fighter avatar ───────────────────────────────────────────────────────────
function FighterAvatar({ logo, name, size = 52, accentColor }: {
  logo: string | null; name: string; size?: number; accentColor: string;
}) {
  const { colors: C } = useTheme();
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="contain"
        transition={150}
      />
    );
  }
  return (
    <View style={[
      av.placeholder,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: `${accentColor}18`, borderColor: `${accentColor}30` },
    ]}>
      <Text style={[av.initials, { color: accentColor, fontSize: size * 0.32 }]}>{initials}</Text>
    </View>
  );
}
const av = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  initials: { fontWeight: '800' },
});

// ─── Main component ───────────────────────────────────────────────────────────
export default function MmaFightCard({
  fight,
  accentColor = '#F43F5E',
  onPress,
}: {
  fight: MmaFight;
  accentColor?: string;
  onPress?: () => void;
}) {
  const { colors: C } = useTheme();
  const router = useRouter();

  const s = fight.stats ?? {};
  const cardTypeStyle = getCardTypeStyle(s.card_type);
  const isTitleFight  = s.is_title_fight ?? false;
  const weightClass   = s.weight_class ?? null;
  const wcIcon        = s.weight_class_icon ?? '🥊';
  const resultMethod  = s.result_method ?? null;
  const isLive        = fight.status === 'live';
  const isFinished    = fight.status === 'finished';

  const handlePress = () => {
    if (onPress) { onPress(); return; }
    router.push({ pathname: '/match/[id]', params: { id: fight.id } } as any);
  };

  const fightDateLabel = useMemo(() => formatFightTime(fight.matchTime), [fight.matchTime]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        st.card,
        { backgroundColor: C.card, borderColor: isTitleFight ? `${accentColor}50` : C.border },
        pressed ? { opacity: 0.88, transform: [{ scale: 0.985 }] } : null,
      ]}
      accessibilityLabel={`${fight.homeTeam} vs ${fight.awayTeam}, ${weightClass ?? 'MMA fight'}`}
    >
      {/* Title fight glow border */}
      {isTitleFight ? (
        <LinearGradient
          colors={[`${accentColor}40`, 'transparent', `${accentColor}40`]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={st.titleGlow}
        />
      ) : null}

      {/* Header row: event label + card type pill */}
      <View style={st.headerRow}>
        <View style={st.headerLeft}>
          {isTitleFight ? (
            <View style={[st.titlePill, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}40` }]}>
              <Text style={[st.titlePillText, { color: accentColor }]}>👑 TITLE FIGHT</Text>
            </View>
          ) : null}
          {s.card_type ? (
            <View style={[st.cardTypePill, { backgroundColor: cardTypeStyle.bg }]}>
              <Text style={[st.cardTypePillText, { color: cardTypeStyle.text }]}>{s.card_type.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        {/* Live / date badge */}
        {isLive ? (
          <View style={[st.livePill, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}40` }]}>
            <View style={[st.liveDot, { backgroundColor: accentColor }]} />
            <Text style={[st.liveText, { color: accentColor }]}>LIVE</Text>
          </View>
        ) : (
          <Text style={[st.dateLbl, { color: C.textMuted }]}>{fightDateLabel}</Text>
        )}
      </View>

      {/* Weight class row */}
      {weightClass ? (
        <View style={st.weightRow}>
          <Text style={[st.wcIcon]}>{wcIcon}</Text>
          <Text style={[st.wcLabel, { color: C.textMuted }]}>{weightClass}</Text>
          <Text style={[st.roundsLabel, { color: C.textMuted }]}>
            · {s.rounds ?? 3} rounds
          </Text>
        </View>
      ) : null}

      {/* Main fight matchup */}
      <View style={st.matchupRow}>
        {/* Fighter A */}
        <View style={st.fighterCol}>
          <FighterAvatar logo={fight.homeLogo} name={fight.homeTeam} size={54} accentColor={accentColor} />
          <Text style={[st.fighterName, { color: C.textPrimary }]} numberOfLines={2}>
            {fight.homeTeam}
          </Text>
          {s.home_nickname ? (
            <Text style={[st.nickname, { color: C.textMuted }]} numberOfLines={1}>
              "{s.home_nickname}"
            </Text>
          ) : null}
          {s.home_record ? (
            <Text style={[st.record, { color: C.textSecondary }]}>{s.home_record}</Text>
          ) : null}
          {s.home_country ? (
            <Text style={[st.country, { color: C.textMuted }]}>{s.home_country}</Text>
          ) : null}
        </View>

        {/* Center: VS / score / result */}
        <View style={st.vsCol}>
          {isFinished && resultMethod ? (
            <View style={st.resultWrap}>
              <Text style={[st.resultScore, { color: accentColor }]}>
                {fight.homeScore} — {fight.awayScore}
              </Text>
              <View style={[st.resultPill, { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}30` }]}>
                <Text style={[st.resultMethod, { color: accentColor }]}>{resultMethod}</Text>
              </View>
            </View>
          ) : isLive ? (
            <View style={st.vsLiveWrap}>
              <Text style={[st.vsLiveRound, { color: accentColor }]}>RD {fight.minute || '?'}</Text>
              <Text style={[st.vsLabel, { color: C.textMuted }]}>VS</Text>
            </View>
          ) : (
            <View style={st.vsWrap}>
              <Text style={[st.vsLabel, { color: C.textMuted }]}>VS</Text>
              <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={{ marginTop: 4 }} />
            </View>
          )}
        </View>

        {/* Fighter B */}
        <View style={[st.fighterCol, st.fighterColRight]}>
          <FighterAvatar logo={fight.awayLogo} name={fight.awayTeam} size={54} accentColor={accentColor} />
          <Text style={[st.fighterName, { color: C.textPrimary }]} numberOfLines={2}>
            {fight.awayTeam}
          </Text>
          {s.away_nickname ? (
            <Text style={[st.nickname, { color: C.textMuted }]} numberOfLines={1}>
              "{s.away_nickname}"
            </Text>
          ) : null}
          {s.away_record ? (
            <Text style={[st.record, { color: C.textSecondary }]}>{s.away_record}</Text>
          ) : null}
          {s.away_country ? (
            <Text style={[st.country, { color: C.textMuted }]}>{s.away_country}</Text>
          ) : null}
        </View>
      </View>

      {/* Bottom accent strip for title fights */}
      {isTitleFight ? (
        <View style={[st.bottomStrip, { backgroundColor: accentColor }]} />
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md,
    marginBottom: 10,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: SPACING.md,
    gap: 8,
    position: 'relative',
  },
  titleGlow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
  },
  bottomStrip: {
    height: 2,
    borderRadius: RADIUS.full,
    marginTop: 4,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerLeft: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flexShrink: 1 },

  titlePill: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  titlePillText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.4 },

  cardTypePill: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  cardTypePillText: { fontSize: 9, fontWeight: FONTS.bold, letterSpacing: 0.5 },

  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: FONTS.extraBold, letterSpacing: 0.6 },
  dateLbl: { fontSize: 11, fontWeight: FONTS.medium },

  weightRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  wcIcon: { fontSize: 14 },
  wcLabel: { fontSize: 12, fontWeight: FONTS.semiBold },
  roundsLabel: { fontSize: 11 },

  matchupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
  },
  fighterCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  fighterColRight: {
    // mirror left — same alignment
  },
  fighterName: {
    fontSize: 13,
    fontWeight: FONTS.bold,
    textAlign: 'center',
    lineHeight: 18,
  },
  nickname: {
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  record: {
    fontSize: 11,
    fontWeight: FONTS.semiBold,
    textAlign: 'center',
  },
  country: {
    fontSize: 10,
    textAlign: 'center',
  },

  vsCol: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  vsWrap: { alignItems: 'center', gap: 2 },
  vsLabel: { fontSize: 16, fontWeight: FONTS.extraBold, letterSpacing: 1 },
  vsLiveWrap: { alignItems: 'center', gap: 4 },
  vsLiveRound: { fontSize: 11, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },

  resultWrap: { alignItems: 'center', gap: 6 },
  resultScore: { fontSize: 18, fontWeight: FONTS.extraBold },
  resultPill: {
    borderRadius: RADIUS.full, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  resultMethod: { fontSize: 10, fontWeight: FONTS.bold },
});
