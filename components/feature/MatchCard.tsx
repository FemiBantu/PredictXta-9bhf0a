
import React, { useCallback, memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING, SPORT_ICONS, getSportIcon, normalizeSportName } from '@/constants/theme';
import { Match } from '@/services/types';
import Badge from '@/components/ui/Badge';
import SportStatsBar from '@/components/feature/SportStatsBar';
import { getLogoUrlSync, teamKey, leagueKey } from '@/services/logoCache';
import { useFollowedMatches } from '@/hooks/useFollowedMatches';
import { useFollowedClubs } from '@/hooks/useFollowedClubs';
import { useMatchLiveScore } from '@/services/realtimeService';

interface MatchCardProps {
  match: Match;
  featured?: boolean;
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    // Convert UTC timestamp to local device time
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

// ─── Team Logo — shows API image or falls back to abbrev circle ───────────────
function TeamLogo({
  name, logoUrl, size = 44, winner, loser, finished,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  winner?: boolean;
  loser?: boolean;
  finished?: boolean;
}) {
  const abbr = name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const resolvedUrl = logoUrl ?? getLogoUrlSync(teamKey(name));

  const circleStyle = [
    styles.teamLogoCircle,
    { width: size, height: size, borderRadius: size / 2 },
    finished ? styles.finishedLogoCircle : null,
    winner ? styles.winnerLogoCircle : null,
    loser ? styles.loserLogoCircle : null,
  ];

  if (resolvedUrl) {
    return (
      <View style={[circleStyle, { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5 }]}>
        <Image
          source={{ uri: resolvedUrl }}
          style={{ width: size * 0.72, height: size * 0.72 }}
          contentFit="contain"
          transition={150}
        />
      </View>
    );
  }

  return (
    <View style={circleStyle}>
      <Text style={[
        styles.teamAbbr,
        winner ? styles.winnerAbbr : null,
        finished && !winner ? styles.finishedAbbr : null,
      ]}>
        {abbr}
      </Text>
    </View>
  );
}

// ─── Club Follow Button ───────────────────────────────────────────────────────
function ClubFollowButton({
  teamName, isFollowing, onToggle,
}: {
  teamName: string;
  isFollowing: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={(e) => { e.stopPropagation?.(); onToggle(); }}
      hitSlop={8}
      style={({ pressed }) => [
        clubBtn.wrap,
        isFollowing ? clubBtn.active : clubBtn.inactive,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Ionicons
        name={isFollowing ? 'notifications' : 'notifications-outline'}
        size={11}
        color={isFollowing ? COLORS.primary : COLORS.textMuted}
      />
      <Text style={[clubBtn.label, isFollowing ? { color: COLORS.primary } : { color: COLORS.textMuted }]}>
        {isFollowing ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}

const clubBtn = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1,
  },
  active: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderColor: 'rgba(255,215,0,0.4)',
  },
  inactive: {
    backgroundColor: 'rgba(120,120,130,0.1)',
    borderColor: 'rgba(120,120,130,0.25)',
  },
  label: { fontSize: 9, fontWeight: FONTS.bold, letterSpacing: 0.3 },
});

// ─── Match Pin Button ─────────────────────────────────────────────────────────
function MatchPinButton({
  isPinned, onToggle,
}: {
  isPinned: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={(e) => { e.stopPropagation?.(); onToggle(); }}
      hitSlop={10}
      style={({ pressed }) => [
        pinBtn.wrap,
        isPinned ? pinBtn.active : pinBtn.inactive,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Ionicons
        name={isPinned ? 'bookmark' : 'bookmark-outline'}
        size={14}
        color={isPinned ? COLORS.primary : COLORS.textMuted}
      />
    </Pressable>
  );
}

const pinBtn = StyleSheet.create({
  wrap: {
    width: 30, height: 30, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  active: {
    backgroundColor: 'rgba(255,215,0,0.14)',
    borderColor: 'rgba(255,215,0,0.45)',
  },
  inactive: {
    backgroundColor: 'rgba(120,120,130,0.08)',
    borderColor: 'rgba(120,120,130,0.22)',
  },
});

// ─── League Logo chip ─────────────────────────────────────────────────────────
function LeagueLogo({
  logoUrl, leagueName, size = 16,
}: {
  logoUrl?: string | null;
  leagueName?: string;
  size?: number;
}) {
  const resolvedUrl = logoUrl ?? (leagueName ? getLogoUrlSync(leagueKey(leagueName)) : null);
  if (!resolvedUrl) return null;
  return (
    <Image
      source={{ uri: resolvedUrl }}
      style={{ width: size, height: size, borderRadius: 3 }}
      contentFit="contain"
      transition={100}
    />
  );
}

function TeamBlock({ name, score, status, logoUrl }: { name: string; score: number; status: string; logoUrl?: string | null }) {
  return (
    <View style={styles.teamBlock}>
      <TeamLogo name={name} logoUrl={logoUrl} />
      <Text style={styles.teamName} numberOfLines={1}>{name}</Text>
      {status !== 'upcoming' ? (
        <Text style={[styles.score, status === 'live' ? styles.liveScore : null]}>{score}</Text>
      ) : null}
    </View>
  );
}

const MatchCard = memo(function MatchCard({ match, featured }: MatchCardProps) {
  const router = useRouter();
  const { isFollowing, toggleFollow } = useFollowedMatches();
  const { isFollowingClub, toggleFollowClub } = useFollowedClubs();

  // ─── Independent live score subscription ──────────────────────────────────
  // One connection per sport (singleton). Only this card's state updates when
  // ITS matchId receives an event — sibling cards never re-render.
  const liveScore = useMatchLiveScore(match.id, match.sport);

  const matchPinned = isFollowing(match.id);
  const homeFollowed = isFollowingClub(match.homeTeam);
  const awayFollowed = isFollowingClub(match.awayTeam);

  const isFinished = match.status === 'finished' || match.status === 'ft';
  const isLiveStatus = match.status === 'live';

  // Live score overrides prop values for live matches only.
  // Finished matches always use the authoritative prop values.
  const displayHomeScore = (isLiveStatus && liveScore) ? liveScore.homeScore : match.homeScore;
  const displayAwayScore = (isLiveStatus && liveScore) ? liveScore.awayScore : match.awayScore;
  const displayMinute    = (isLiveStatus && liveScore) ? liveScore.minute : (match.minute ?? 0);

  const handleToggleMatch = useCallback(() => {
    toggleFollow(match.id);
  }, [match.id, toggleFollow]);

  const handleToggleHome = useCallback(() => {
    toggleFollowClub(match.homeTeam);
  }, [match.homeTeam, toggleFollowClub]);

  const handleToggleAway = useCallback(() => {
    toggleFollowClub(match.awayTeam);
  }, [match.awayTeam, toggleFollowClub]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        featured ? styles.featuredCard : null,
        isFinished ? styles.finishedCard : null,
        matchPinned ? styles.pinnedCard : null,
        pressed ? styles.pressed : null,
      ]}
      onPress={() => router.push(`/match/${match.id}` as any)}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.leagueRow}>
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/sports/[sport]', params: { sport: match.sport?.toLowerCase().replace(/\s+/g, '-') ?? 'football' } } as any); }}
            hitSlop={8}
            style={({ pressed }) => [styles.sportEmojiBtn, pressed ? { opacity: 0.65 } : null]}
            accessibilityLabel={`View ${normalizeSportName(match.sport)} sports page`}
            accessibilityRole="button"
          >
            <Text style={styles.sportEmoji}>{getSportIcon(match.sport)}</Text>
          </Pressable>
          <LeagueLogo logoUrl={match.leagueLogo} leagueName={match.league} />
          <Text style={[styles.league, isFinished ? styles.finishedLeague : null]} numberOfLines={1}>{match.league}</Text>
        </View>
        <View style={styles.headerActions}>
          {match.status === 'live' ? (
            <Badge label={`${displayMinute}'`} variant="live" dot />
          ) : isFinished ? (
            <View style={styles.ftBadge}>
              <Text style={styles.ftBadgeText}>FT</Text>
            </View>
          ) : (
            <Text style={styles.matchTime}>{formatTime(match.matchTime)}</Text>
          )}
          {/* Match pin button — bookmark this match for score alerts */}
          <MatchPinButton isPinned={matchPinned} onToggle={handleToggleMatch} />
        </View>
      </View>

      {/* Pinned indicator strip */}
      {matchPinned ? (
        <View style={styles.pinnedStrip}>
          <Ionicons name="notifications" size={10} color={COLORS.primary} />
          <Text style={styles.pinnedStripText}>Pinned · You will receive score alerts for this match</Text>
        </View>
      ) : null}

      {/* Teams + Score */}
      {isFinished ? (
        (() => {
          const homeWin = match.homeScore > match.awayScore;
          const awayWin = match.awayScore > match.homeScore;
          return (
            <View>
              <View style={styles.finishedTeamsRow}>
                {/* Home team */}
                <View style={styles.finishedTeamBlock}>
                  <TeamLogo
                    name={match.homeTeam}
                    logoUrl={match.homeLogo}
                    size={48}
                    finished
                    winner={homeWin}
                    loser={!homeWin && awayWin}
                  />
                  <Text style={[
                    styles.teamName,
                    styles.finishedTeamName,
                    homeWin ? styles.winnerTeamName : null,
                    !homeWin && awayWin ? styles.loserTeamName : null,
                  ]} numberOfLines={2}>
                    {match.homeTeam}
                  </Text>
                  {homeWin ? (
                    <View style={styles.winnerPill}>
                      <Text style={styles.winnerPillText}>WIN</Text>
                    </View>
                  ) : null}
                  <ClubFollowButton
                    teamName={match.homeTeam}
                    isFollowing={homeFollowed}
                    onToggle={handleToggleHome}
                  />
                </View>

                {/* Central scoreline */}
                <View style={styles.finishedScoreBlock}>
                  <View style={styles.finishedScoreRow}>
                    <Text style={[
                      styles.finishedScore,
                      homeWin ? styles.winnerScore : (!homeWin && awayWin ? styles.loserScore : null),
                    ]}>{match.homeScore}</Text>
                    <Text style={styles.finishedScoreSep}>-</Text>
                    <Text style={[
                      styles.finishedScore,
                      awayWin ? styles.winnerScore : (!awayWin && homeWin ? styles.loserScore : null),
                    ]}>{match.awayScore}</Text>
                  </View>
                  <View style={styles.finishedFtPill}>
                    <Text style={styles.finishedFtPillText}>FULL TIME</Text>
                  </View>
                </View>

                {/* Away team */}
                <View style={styles.finishedTeamBlock}>
                  <TeamLogo
                    name={match.awayTeam}
                    logoUrl={match.awayLogo}
                    size={48}
                    finished
                    winner={awayWin}
                    loser={!awayWin && homeWin}
                  />
                  <Text style={[
                    styles.teamName,
                    styles.finishedTeamName,
                    awayWin ? styles.winnerTeamName : null,
                    !awayWin && homeWin ? styles.loserTeamName : null,
                  ]} numberOfLines={2}>
                    {match.awayTeam}
                  </Text>
                  {awayWin ? (
                    <View style={styles.winnerPill}>
                      <Text style={styles.winnerPillText}>WIN</Text>
                    </View>
                  ) : null}
                  <ClubFollowButton
                    teamName={match.awayTeam}
                    isFollowing={awayFollowed}
                    onToggle={handleToggleAway}
                  />
                </View>
              </View>
            </View>
          );
        })()
      ) : (
        <View>
          <View style={styles.teamsRow}>
            <TeamBlock name={match.homeTeam} score={displayHomeScore} status={match.status} logoUrl={match.homeLogo} />
            <View style={styles.vsBlock}>
              {match.status === 'upcoming' ? (
                <Text style={styles.vsText}>VS</Text>
              ) : (
                <Text style={styles.scoreDivider}>-</Text>
              )}
            </View>
            <TeamBlock name={match.awayTeam} score={displayAwayScore} status={match.status} logoUrl={match.awayLogo} />
          </View>
          {/* Club follow buttons row — below team blocks for live/upcoming */}
          <View style={styles.clubFollowRow}>
            <ClubFollowButton
              teamName={match.homeTeam}
              isFollowing={homeFollowed}
              onToggle={handleToggleHome}
            />
            <View style={styles.clubFollowSpacer} />
            <ClubFollowButton
              teamName={match.awayTeam}
              isFollowing={awayFollowed}
              onToggle={handleToggleAway}
            />
          </View>
        </View>
      )}

      {/* Odds Row */}
      {match.homeOdds && match.status === 'upcoming' ? (
        <View style={styles.oddsRow}>
          <OddsChip label="1" value={match.homeOdds} />
          {match.drawOdds && match.drawOdds > 0 ? (
            <OddsChip label="X" value={match.drawOdds} />
          ) : null}
          <OddsChip label="2" value={match.awayOdds || 0} />
        </View>
      ) : null}

      {/* Sport-specific stats */}
      <SportStatsBar match={match} />

      {match.status === 'live' ? (
        <View style={styles.liveBar}>
          <View style={styles.livePulse} />
          <Text style={styles.liveText}>LIVE NOW</Text>
          <MaterialIcons name="chevron-right" size={14} color={COLORS.accent} />
        </View>
      ) : null}
    </Pressable>
  );
}, (prev, next) => {
  // Custom equality: structural changes trigger re-render; score/minute are
  // managed by useMatchLiveScore internally so we exclude them here, preventing
  // parent list re-renders from cascading into every card on every score tick.
  const pm = prev.match; const nm = next.match;
  return (
    pm.id          === nm.id          &&
    pm.status      === nm.status      &&
    pm.sport       === nm.sport       &&
    pm.homeTeam    === nm.homeTeam    &&
    pm.awayTeam    === nm.awayTeam    &&
    pm.league      === nm.league      &&
    pm.matchTime   === nm.matchTime   &&
    pm.homeLogo    === nm.homeLogo    &&
    pm.awayLogo    === nm.awayLogo    &&
    pm.leagueLogo  === nm.leagueLogo  &&
    pm.homeOdds    === nm.homeOdds    &&
    pm.drawOdds    === nm.drawOdds    &&
    pm.awayOdds    === nm.awayOdds    &&
    pm.stats       === nm.stats       &&
    prev.featured  === next.featured
  );
});

export default MatchCard;

function OddsChip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.oddsChip}>
      <Text style={styles.oddsLabel}>{label}</Text>
      <Text style={styles.oddsValue}>{value.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  pinnedCard: {
    borderColor: 'rgba(255,215,0,0.35)',
    backgroundColor: 'rgba(255,215,0,0.03)',
  },
  finishedCard: {
    backgroundColor: 'rgba(30,32,40,0.7)',
    borderColor: 'rgba(100,105,120,0.25)',
    opacity: 0.88,
  },
  finishedLeague: {
    color: COLORS.textMuted,
  },
  // Header row
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Pinned strip
  pinnedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderRadius: RADIUS.md,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.22)',
  },
  pinnedStripText: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: FONTS.medium,
    flex: 1,
  },
  // Club follow row (live / upcoming)
  clubFollowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  clubFollowSpacer: { flex: 1 },
  // FT badge in header
  ftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(100,105,120,0.18)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(100,105,120,0.35)',
  },
  ftBadgeText: {
    fontSize: 10,
    fontWeight: FONTS.extraBold,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
  },
  // Finished layout
  finishedTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  finishedTeamBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  finishedLogoCircle: {
    backgroundColor: 'rgba(60,65,80,0.6)',
    borderColor: 'rgba(100,105,120,0.3)',
  },
  winnerLogoCircle: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderColor: 'rgba(255,215,0,0.55)',
  },
  loserLogoCircle: {
    backgroundColor: 'rgba(40,42,50,0.4)',
    borderColor: 'rgba(80,85,100,0.2)',
    opacity: 0.55,
  },
  finishedAbbr: {
    color: COLORS.textMuted,
  },
  winnerAbbr: {
    color: COLORS.primary,
    fontWeight: FONTS.extraBold,
  },
  finishedTeamName: {
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  winnerTeamName: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
    textAlign: 'center',
  },
  loserTeamName: {
    color: COLORS.textMuted,
    opacity: 0.6,
    textAlign: 'center',
  },
  winnerScore: {
    color: COLORS.primary,
  },
  loserScore: {
    color: COLORS.textMuted,
  },
  winnerPill: {
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.4)',
  },
  winnerPillText: {
    fontSize: 8,
    fontWeight: FONTS.extraBold,
    color: COLORS.primary,
    letterSpacing: 0.8,
  },
  finishedScoreBlock: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  finishedScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  finishedScore: {
    fontSize: 32,
    fontWeight: FONTS.extraBold,
    color: COLORS.textPrimary,
    minWidth: 28,
    textAlign: 'center',
  },
  finishedScoreSep: {
    fontSize: 24,
    fontWeight: FONTS.bold,
    color: COLORS.textMuted,
  },
  finishedFtPill: {
    backgroundColor: 'rgba(100,105,120,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(100,105,120,0.3)',
  },
  finishedFtPillText: {
    fontSize: 9,
    fontWeight: FONTS.extraBold,
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  featuredCard: {
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.cardHighlight,
    padding: 18,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  leagueRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 5 },
  sportEmojiBtn: { padding: 2, borderRadius: RADIUS.sm },
  sportEmoji: { fontSize: 14 },
  league: { fontSize: 11, color: COLORS.textSecondary, fontWeight: FONTS.medium, flex: 1 },
  matchTime: { fontSize: 12, color: COLORS.primary, fontWeight: FONTS.semiBold },
  teamsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamBlock: { flex: 1, alignItems: 'center', gap: 6 },
  teamLogoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamAbbr: { fontSize: 12, color: COLORS.primary, fontWeight: FONTS.bold },
  teamName: { fontSize: 12, color: COLORS.textPrimary, fontWeight: FONTS.semiBold, textAlign: 'center', maxWidth: 100 },
  score: { fontSize: 22, color: COLORS.textPrimary, fontWeight: FONTS.extraBold },
  liveScore: { color: COLORS.accent },
  vsBlock: { paddingHorizontal: 12, alignItems: 'center' },
  vsText: { fontSize: 14, color: COLORS.textMuted, fontWeight: FONTS.bold },
  scoreDivider: { fontSize: 22, color: COLORS.textMuted, fontWeight: FONTS.bold },
  oddsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  oddsChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  oddsLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: FONTS.medium },
  oddsValue: { fontSize: 14, color: COLORS.primary, fontWeight: FONTS.bold, marginTop: 2 },
  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 6,
  },
  livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent },
  liveText: { fontSize: 11, color: COLORS.accent, fontWeight: FONTS.bold, flex: 1, letterSpacing: 1 },
});
