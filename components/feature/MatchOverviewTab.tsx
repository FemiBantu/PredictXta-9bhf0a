/**
 * MatchOverviewTab.tsx
 *
 * The complete Overview tab for match/[id].tsx.
 * Replaces the old monolithic OverviewTab with the new
 * SportPreMatchIntelligence hub + legacy supplemental sections.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';
import { getSupabaseClient, useAuth } from '@/template';
import { Image } from 'expo-image';
import SportPreMatchIntelligence from '@/components/feature/SportPreMatchIntelligence';
import SportOverviewMetrics from '@/components/feature/SportOverviewMetrics';
import { CollapsibleIntelCard, IntelSummaryBar } from '@/components/feature/CollapsibleIntelCard';
import type { DetailedMatchData } from '@/services/matchStatsService';
import type { H2HRecord } from '@/services/aiPicksService';

// ─── Colors ───────────────────────────────────────────────────────────────────
const OV_HOME = '#38BDF8';
const OV_AWAY = '#A78BFA';

const FORM_COLORS = {
  W: { bg: '#DCFCE7', border: '#22C55E', text: '#166534' },
  D: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  L: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' },
};

const MONTH_NAMES_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function fmtShortDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ''; }
}

function FormBubbleOv({ result, size = 30 }: { result: string; size?: number }) {
  const u = result.toUpperCase() as 'W' | 'D' | 'L';
  const c = FORM_COLORS[u] ?? { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' };
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.38, fontWeight: FONTS.extraBold as any, color: c.text }}>{u}</Text>
    </View>
  );
}

// Standings table (only shown for football/handball/rugby)
function StandingsTable({ match, C }: { match: any; C: AppColors }) {
  const [standings, setStandings] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    getSupabaseClient()
      .from('league_standings')
      .select('position, team_name, team_logo, played, wins, draws, losses, goal_diff, points, form, goals_for, goals_against')
      .eq('league_name', match.league)
      .order('position', { ascending: true })
      .limit(20)
      .then(({ data }) => { setStandings(data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [match.league]);

  if (loading) return <View style={{ alignItems: 'center', paddingVertical: 24 }}><ActivityIndicator size="small" color={C.primary} /></View>;
  if (standings.length === 0) return (
    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
      <Ionicons name="podium-outline" size={28} color={C.textMuted} />
      <Text style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>No standings for {match.league}</Text>
    </View>
  );

  const displayRows = expanded ? standings : standings.slice(0, 8);
  return (
    <View>
      {/* Header */}
      <View style={[std.headerRow, { backgroundColor: C.surface, borderColor: C.border }]}>
        {['#','Team','P','W','D','L','GD','Pts'].map((h, i) => (
          <Text key={i} style={[i === 1 ? std.hTeam : i === 0 ? std.hPos : i === 7 ? std.hPts : std.hStat, { color: C.textMuted }]}>{h}</Text>
        ))}
      </View>
      {displayRows.map((row, idx) => {
        const isHome = row.team_name === match.homeTeam;
        const isAway = row.team_name === match.awayTeam;
        const highlight = isHome || isAway;
        const rowColor = isHome ? OV_HOME : isAway ? OV_AWAY : null;
        const gdColor = (row.goal_diff ?? 0) > 0 ? '#22C55E' : (row.goal_diff ?? 0) < 0 ? '#EF4444' : C.textMuted;
        return (
          <View key={row.team_name} style={[std.row, { borderBottomColor: C.border }, highlight ? { backgroundColor: `${rowColor}10` } : idx % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.card }]}>
            <View style={[std.posWrap, highlight ? { backgroundColor: `${rowColor}25`, borderRadius: 5 } : null]}>
              <Text style={[std.pos, { color: highlight ? rowColor! : C.textMuted, fontWeight: highlight ? FONTS.bold : FONTS.regular }]}>{row.position}</Text>
            </View>
            <View style={std.teamCell}>
              {row.team_logo ? <Image source={{ uri: row.team_logo }} style={{ width: 16, height: 16, borderRadius: 3 }} contentFit="contain" /> : null}
              <Text style={[std.teamName, { color: highlight ? rowColor! : C.textPrimary, fontWeight: highlight ? FONTS.bold : FONTS.medium }]} numberOfLines={1}>{row.team_name}</Text>
              {highlight ? (
                <View style={[std.matchPill, { backgroundColor: `${rowColor}22`, borderColor: `${rowColor}44` }]}>
                  <Text style={[std.matchPillText, { color: rowColor! }]}>{isHome ? 'H' : 'A'}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[std.stat, { color: C.textSecondary }]}>{row.played}</Text>
            <Text style={[std.stat, { color: C.textSecondary }]}>{row.wins}</Text>
            <Text style={[std.stat, { color: C.textSecondary }]}>{row.draws}</Text>
            <Text style={[std.stat, { color: C.textSecondary }]}>{row.losses}</Text>
            <Text style={[std.stat, { color: gdColor, fontWeight: FONTS.semiBold }]}>{(row.goal_diff ?? 0) > 0 ? `+${row.goal_diff}` : row.goal_diff}</Text>
            <Text style={[std.pts, { color: highlight ? rowColor! : C.textPrimary, fontWeight: highlight ? FONTS.extraBold : FONTS.semiBold }]}>{row.points}</Text>
          </View>
        );
      })}
      {standings.length > 8 ? (
        <Pressable style={[std.expandBtn, { backgroundColor: C.surface, borderColor: C.border }]} onPress={() => setExpanded(!expanded)}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
          <Text style={{ fontSize: 12, color: C.primary, fontWeight: FONTS.semiBold as any }}>{expanded ? 'Show less' : `Show all ${standings.length} teams`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const std = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderTopLeftRadius: RADIUS.md, borderTopRightRadius: RADIUS.md },
  hPos: { width: 22, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' },
  hTeam: { flex: 1, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5 },
  hStat: { width: 22, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' },
  hPts: { width: 28, fontSize: 9, fontWeight: FONTS.extraBold, letterSpacing: 0.5, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  posWrap: { width: 22, alignItems: 'center', paddingVertical: 2 },
  pos: { fontSize: 12, textAlign: 'center' },
  teamCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  teamName: { flex: 1, fontSize: 12 },
  matchPill: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 4, paddingVertical: 1 },
  matchPillText: { fontSize: 8, fontWeight: FONTS.extraBold },
  stat: { width: 22, fontSize: 11, textAlign: 'center' },
  pts: { width: 28, fontSize: 13, textAlign: 'center' },
  expandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
});

// ─── Season highlights ─────────────────────────────────────────────────────────
function SeasonHighlights({ match, C }: { match: any; C: AppColors }) {
  const [homeStats, setHomeStats] = useState<any>(null);
  const [awayStats, setAwayStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const mapRows = (rows: any[], teamName: string) =>
      (rows ?? []).map((r: any) => ({ hs: r.home_score ?? 0, as_: r.away_score ?? 0, isHome: r.home_team === teamName }));
    const buildStats = (rows: Array<{ hs: number; as_: number; isHome: boolean }>) => {
      if (!rows.length) return null;
      let biggestWin = '—'; let biggestWinGoals = -1;
      let biggestLoss = '—'; let biggestLossGoals = -1;
      let lowestWin = '—'; let lowestWinGoals = 999;
      let totalGoalsFor = 0; let totalGoalsAgainst = 0;
      for (const m of rows) {
        const scored = m.isHome ? m.hs : m.as_;
        const conceded = m.isHome ? m.as_ : m.hs;
        totalGoalsFor += scored; totalGoalsAgainst += conceded;
        const diff = scored - conceded;
        if (diff > 0) {
          if (scored > biggestWinGoals) { biggestWin = `${scored}-${conceded}`; biggestWinGoals = scored; }
          if (scored < lowestWinGoals) { lowestWin = `${scored}-${conceded}`; lowestWinGoals = scored; }
        } else if (diff < 0 && conceded > biggestLossGoals) { biggestLoss = `${scored}-${conceded}`; biggestLossGoals = conceded; }
      }
      const n = rows.length;
      return { biggestWin, biggestLoss, lowestWin, avgScored: Math.round((totalGoalsFor / n) * 10) / 10, avgConceded: Math.round((totalGoalsAgainst / n) * 10) / 10, totalGames: n, totalGoalsFor, totalGoalsAgainst };
    };
    Promise.allSettled([
      supabase.from('matches').select('home_team, away_team, home_score, away_score').or(`home_team.eq.${match.homeTeam},away_team.eq.${match.homeTeam}`).eq('status', 'finished').eq('sport', match.sport ?? 'football').order('match_time', { ascending: false }).limit(38),
      supabase.from('matches').select('home_team, away_team, home_score, away_score').or(`home_team.eq.${match.awayTeam},away_team.eq.${match.awayTeam}`).eq('status', 'finished').eq('sport', match.sport ?? 'football').order('match_time', { ascending: false }).limit(38),
    ]).then(([hRes, aRes]) => {
      if (hRes.status === 'fulfilled' && hRes.value.data) setHomeStats(buildStats(mapRows(hRes.value.data, match.homeTeam)));
      if (aRes.status === 'fulfilled' && aRes.value.data) setAwayStats(buildStats(mapRows(aRes.value.data, match.awayTeam)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [match.homeTeam, match.awayTeam, match.sport]);

  if (loading) return <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator size="small" color={C.primary} /></View>;
  if (!homeStats && !awayStats) return null;

  return (
    <View style={{ gap: 8 }}>
      {[{ label: '🏆 Biggest Win', hv: homeStats?.biggestWin ?? '—', av: awayStats?.biggestWin ?? '—' }, { label: '💔 Biggest Loss', hv: homeStats?.biggestLoss ?? '—', av: awayStats?.biggestLoss ?? '—' }].map(row => (
        <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 8 }}>
          <Text style={{ flex: 1.2, fontSize: 11, color: OV_HOME, fontWeight: FONTS.semiBold as any }} numberOfLines={2}>{row.hv}</Text>
          <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: C.textMuted, textAlign: 'center', minWidth: 90 }}>{row.label}</Text>
          <Text style={{ flex: 1.2, fontSize: 11, color: OV_AWAY, fontWeight: FONTS.semiBold as any, textAlign: 'right' }} numberOfLines={2}>{row.av}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {[{ team: match.homeTeam, color: OV_HOME, s: homeStats }, { team: match.awayTeam, color: OV_AWAY, s: awayStats }].map(t => (
          <View key={t.team} style={{ flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, gap: 5, backgroundColor: `${t.color}10`, borderColor: `${t.color}33` }}>
            <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: t.color }} numberOfLines={1}>{t.team}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 10, color: C.textMuted }}>Avg Scored</Text><Text style={{ fontSize: 12, fontWeight: FONTS.extraBold as any, color: '#22C55E' }}>{t.s?.avgScored ?? '—'}</Text></View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 10, color: C.textMuted }}>Avg Conceded</Text><Text style={{ fontSize: 12, fontWeight: FONTS.extraBold as any, color: '#EF4444' }}>{t.s?.avgConceded ?? '—'}</Text></View>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 10, color: C.textMuted }}>{t.s?.totalGames ?? 0}G</Text>
              <Text style={{ fontSize: 11, fontWeight: FONTS.bold as any, color: C.textSecondary }}>{t.s?.totalGoalsFor ?? 0}F / {t.s?.totalGoalsAgainst ?? 0}A</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main OverviewTab component export ─────────────────────────────────────────
interface OverviewTabProps {
  /** VIP / coin state for gating AI Best 3 Predictions (passed down to SportPreMatchIntelligence) */
  isVip?: boolean;
  coinBalance?: number;
  match: {
    id: string; sport: string; homeTeam: string; awayTeam: string;
    homeScore: number; awayScore: number;
    status: 'live' | 'upcoming' | 'finished';
    matchTime: string; league: string; venue?: string; minute?: number;
    homeLogo?: string | null; awayLogo?: string | null; leagueLogo?: string | null;
    stats?: any; homeForm?: string[]; awayForm?: string[];
  };
  C: AppColors;
  detailData: DetailedMatchData | null;
  h2hRecords: H2HRecord[];
  h2hLoading: boolean;
  prediction?: {
    id: string; matchId: string; homeWinProb: number; drawProb: number; awayWinProb: number;
    predictedResult: string; confidence: number; overUnder: string; overUnderLine: number;
    btts: string; aiAnalysis: string | null; keyFactors: string[];
    createdAt: string;
  } | null;
}

export default function OverviewTab({
  match, C, detailData, h2hRecords, h2hLoading, prediction,
  isVip: isVipProp, coinBalance: coinBalanceProp,
}: OverviewTabProps) {
  const { user } = useAuth();
  const [isVip, setIsVip] = useState(isVipProp ?? false);
  const [coinBalance, setCoinBalance] = useState(coinBalanceProp ?? 0);
  const [best3Unlocked, setBest3Unlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const UNLOCK_COST = 5;

  // Load VIP + coin state if not provided by parent
  useEffect(() => {
    if (isVipProp !== undefined) { setIsVip(isVipProp); return; }
    if (!user?.id) return;
    const supabase = getSupabaseClient();
    supabase.from('vip_subscriptions').select('id').eq('user_id', user.id).eq('status','active').gt('expires_at', new Date().toISOString()).maybeSingle().then(({ data }) => setIsVip(!!data));
    supabase.from('user_coins').select('balance').eq('user_id', user.id).maybeSingle().then(({ data }) => { if (data) setCoinBalance((data as any).balance ?? 0); });
  }, [user?.id, isVipProp]);

  useEffect(() => { if (coinBalanceProp !== undefined) setCoinBalance(coinBalanceProp); }, [coinBalanceProp]);

  const handleUnlockBest3 = useCallback(async () => {
    if (!user?.id || unlocking) return;
    if (coinBalance < UNLOCK_COST) return;
    setUnlocking(true);
    try {
      const { error } = await getSupabaseClient().rpc('add_user_coins', { p_user_id: user.id, p_amount: -UNLOCK_COST });
      if (!error) { setCoinBalance(prev => prev - UNLOCK_COST); setBest3Unlocked(true); }
    } catch { /* ignore */ } finally { setUnlocking(false); }
  }, [user?.id, coinBalance, unlocking]);
  const homeFormArr: string[] = Array.isArray((match as any).homeForm) ? (match as any).homeForm : [];
  const awayFormArr: string[] = Array.isArray((match as any).awayForm) ? (match as any).awayForm : [];
  const sport = match.sport ?? 'football';
  const spLow = sport.toLowerCase();
  const isFootballSport = spLow === 'football' || spLow === 'soccer';
  const isHandball = spLow === 'handball';
  const isRugby = spLow.includes('rugby');
  const showStandings = isFootballSport || isHandball || isRugby;

  // Map prediction to IntelligenceProps shape
  const predForIntel = prediction ? {
    homeWinProb: prediction.homeWinProb ?? 40,
    drawProb: prediction.drawProb ?? 25,
    awayWinProb: prediction.awayWinProb ?? 35,
    predictedResult: prediction.predictedResult,
    confidence: prediction.confidence,
    overUnder: prediction.overUnder,
    overUnderLine: prediction.overUnderLine,
    btts: prediction.btts,
    riskLevel: (prediction as any).riskLevel ?? null,
    valueScore: (prediction as any).valueScore ?? null,
    aiAnalysis: prediction.aiAnalysis,
    keyFactors: prediction.keyFactors,
  } : null;

  const h2hMapped = h2hRecords.map(r => ({
    id: r.id,
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    matchTime: r.matchTime,
  }));

  return (
    <View style={{ gap: 14 }}>

      {/* ═══ INTELLIGENCE SUMMARY BAR ═══ */}
      {predForIntel ? (
        <IntelSummaryBar
          items={[
            { label: 'AI Pick', value: predForIntel.predictedResult === 'home_win' ? '1 Home' : predForIntel.predictedResult === 'draw' ? 'X Draw' : '2 Away', icon: 'brain-outline', color: C.primary },
            { label: 'Confidence', value: `${predForIntel.confidence}%`, icon: 'analytics-outline', color: predForIntel.confidence >= 75 ? '#22C55E' : '#F59E0B' },
            { label: 'H2H', value: h2hMapped.length > 0 ? `${h2hMapped.length} games` : '—', icon: 'git-compare-outline', color: '#38BDF8' },
            { label: 'Risk', value: predForIntel.riskLevel ?? 'Med', icon: 'shield-outline', color: '#F59E0B' },
          ]}
          C={C}
        />
      ) : null}

      {/* ═══ AI QUICK INTELLIGENCE CARD (collapsed by default) ═══ */}
      {predForIntel?.keyFactors && predForIntel.keyFactors.length > 0 ? (
        <CollapsibleIntelCard
          title="AI Pre-Match Intelligence"
          subtitle="Tap to reveal key factors, analysis, and risk assessment"
          sportEmoji="🧠"
          category="AI INSIGHT"
          categoryColor={C.primary}
          accentColor={C.primary}
          confidence={predForIntel.confidence}
          riskLevel={predForIntel.riskLevel ?? undefined}
          keyFactors={predForIntel.keyFactors}
          reasoning={predForIntel.aiAnalysis ?? undefined}
          failureReasons={[
            'AI predictions are probabilistic — upsets can occur',
            ...(!homeFormArr.length ? [`Limited recent form data for ${match.homeTeam}`] : []),
            ...(!awayFormArr.length ? [`Limited recent form data for ${match.awayTeam}`] : []),
          ].filter(Boolean)}
          defaultExpanded={false}
          C={C}
        />
      ) : null}

      {/* ═══ PRIMARY: Sport-Specific Pre-Match Intelligence Hub ═══ */}
      <SportPreMatchIntelligence
        sport={sport}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeLogo={match.homeLogo}
        awayLogo={match.awayLogo}
        homeForm={homeFormArr}
        awayForm={awayFormArr}
        homeScore={match.homeScore}
        awayScore={match.awayScore}
        matchStatus={match.status}
        matchTime={match.matchTime}
        league={match.league}
        venue={match.venue}
        prediction={predForIntel}
        h2hRecords={h2hMapped}
        isVip={isVip}
        coinBalance={coinBalance}
        best3Unlocked={best3Unlocked}
        onUnlockBest3={handleUnlockBest3}
        stats={detailData?.stats ? {
          homePossession: detailData.stats.homePossession,
          awayPossession: detailData.stats.awayPossession,
          homeShots: detailData.stats.homeShots,
          awayShots: detailData.stats.awayShots,
          homeShotsOnTarget: detailData.stats.homeShotsOnTarget,
          awayShotsOnTarget: detailData.stats.awayShotsOnTarget,
          homeXG: detailData.stats.homeXG,
          awayXG: detailData.stats.awayXG,
          homeCorners: detailData.stats.homeCorners,
          awayCorners: detailData.stats.awayCorners,
        } : null}
        C={C}
      />

      {/* ═══ SUPPLEMENTAL: Sport stat bar (compact) ═══ */}
      <SportOverviewMetrics sport={sport} C={C} />

      {/* ═══ SUPPLEMENTAL: League Standings (football / handball / rugby / basketball) ═══ */}
      {showStandings ? (
        <View style={[{ borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden' }, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 10 }}>
            <Ionicons name="podium-outline" size={16} color={C.primary} />
            <Text style={{ fontSize: 14, fontWeight: FONTS.bold as any, color: C.textPrimary, flex: 1 }}>{match.league}</Text>
            {match.leagueLogo ? <Image source={{ uri: match.leagueLogo }} style={{ width: 22, height: 22, borderRadius: 3 }} contentFit="contain" /> : null}
          </View>
          <StandingsTable match={match} C={C} />
        </View>
      ) : null}

      {/* ═══ SUPPLEMENTAL: Season Highlights (only football / handball / rugby) ═══ */}
      {isFootballSport || isHandball || isRugby ? (
        <View style={[{ borderRadius: RADIUS.xl, borderWidth: 1, padding: 16 }, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={{ fontSize: 11, fontWeight: FONTS.extraBold as any, letterSpacing: 0.9, color: C.textPrimary, marginBottom: 14 }}>SEASON HIGHLIGHTS</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            {[{ team: match.homeTeam, color: OV_HOME }, { team: match.awayTeam, color: OV_AWAY }].map((t, i) => (
              <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: i === 1 ? 'flex-end' : 'flex-start' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color }} />
                <Text style={{ fontSize: 12, fontWeight: FONTS.bold as any, color: t.color }} numberOfLines={1}>{t.team}</Text>
              </View>
            ))}
          </View>
          <SeasonHighlights match={match} C={C} />
        </View>
      ) : null}

    </View>
  );
}
