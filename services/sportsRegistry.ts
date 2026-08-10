/**
 * services/sportsRegistry.ts — PredictXta Unified Sports Registry
 *
 * Central source of truth for all supported sports.
 * Every screen is driven from this registry — no hardcoded sport lists anywhere.
 *
 * Covers all API-Sports sub-domains + TheSportsDB + Highlightly sports.
 */

export type SportFamily =
  | 'football'
  | 'basketball'
  | 'tennis'
  | 'baseball'
  | 'hockey'
  | 'rugby'
  | 'handball'
  | 'volleyball'
  | 'american_football'
  | 'cricket'
  | 'mma'
  | 'formula1'
  | 'afl';

export interface SportDefinition {
  /** Internal DB key — matches `matches.sport` column */
  key: string;
  /** Family for grouping (used by prediction engines) */
  family: SportFamily;
  /** Human-readable display name */
  displayName: string;
  /** Emoji icon */
  emoji: string;
  /** Accent color (hex) */
  accentColor: string;
  /** API-Sports sub-domain key or 'thesportsdb' / 'thesportsdb' */
  primaryProvider: 'api-sports' | 'thesportsdb' | 'thesportsdb';
  /** Whether 1X2 draw market exists */
  hasDraw: boolean;
  /** Whether BTTS market applies */
  hasBtts: boolean;
  /** Scoring unit label */
  scoringUnit: string;
  /** Whether standings are available */
  hasStandings: boolean;
  /** Whether lineups are relevant */
  hasLineups: boolean;
  /** Whether head-to-head history is tracked */
  hasH2H: boolean;
  /** Typical live update interval in seconds */
  liveUpdateIntervalSec: number;
  /** Display order in navigation rail */
  displayOrder: number;
  /** Whether this sport is actively supported */
  active: boolean;
  /** TheSportsDB slug for fallback */
  tsdbSlug?: string;
  /** API-Sports base URL */
  apiSportsBase?: string;
}

export const SPORTS_REGISTRY: SportDefinition[] = [
  {
    key: 'football',
    family: 'football',
    displayName: 'Football',
    emoji: '⚽',
    accentColor: '#6EDC1F',
    primaryProvider: 'api-sports',
    hasDraw: true,
    hasBtts: true,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 1,
    active: true,
    tsdbSlug: 'Soccer',
    apiSportsBase: 'https://v3.football.api-sports.io',
  },
  {
    key: 'basketball',
    family: 'basketball',
    displayName: 'Basketball',
    emoji: '🏀',
    accentColor: '#F97316',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 15,
    displayOrder: 2,
    active: true,
    tsdbSlug: 'Basketball',
    apiSportsBase: 'https://v1.basketball.api-sports.io',
  },
  {
    key: 'tennis',
    family: 'tennis',
    displayName: 'Tennis',
    emoji: '🎾',
    accentColor: '#FBBF24',
    primaryProvider: 'thesportsdb',  // Uses TSDB free tier — 0 API-Sports quota
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Sets',
    hasStandings: false,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 10,
    displayOrder: 3,
    active: true,
    tsdbSlug: 'Tennis',
    apiSportsBase: 'https://v1.tennis.api-sports.io',
  },
  {
    key: 'cricket',
    family: 'cricket',
    displayName: 'Cricket',
    emoji: '🏏',
    accentColor: '#A78BFA',
    primaryProvider: 'thesportsdb',
    hasDraw: true,
    hasBtts: false,
    scoringUnit: 'Runs',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 15,
    displayOrder: 4,
    active: true,
    tsdbSlug: 'Cricket',
  },
  {
    key: 'baseball',
    family: 'baseball',
    displayName: 'Baseball',
    emoji: '⚾',
    accentColor: '#C084FC',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Runs',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 5,
    active: true,
    tsdbSlug: 'Baseball',
    apiSportsBase: 'https://v1.baseball.api-sports.io',
  },
  {
    key: 'hockey',
    family: 'hockey',
    displayName: 'Ice Hockey',
    emoji: '🏒',
    accentColor: '#38BDF8',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 20,
    displayOrder: 6,
    active: true,
    tsdbSlug: 'Ice+Hockey',
    apiSportsBase: 'https://v1.hockey.api-sports.io',
  },
  {
    key: 'rugby',
    family: 'rugby',
    displayName: 'Rugby',
    emoji: '🏉',
    accentColor: '#34D399',
    primaryProvider: 'api-sports',
    hasDraw: true,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 7,
    active: true,
    tsdbSlug: 'Rugby',
    apiSportsBase: 'https://v1.rugby.api-sports.io',
  },
  {
    key: 'mma',
    family: 'mma',
    displayName: 'MMA / UFC',
    emoji: '🥊',
    accentColor: '#F43F5E',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Rounds',
    hasStandings: false,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 20,
    displayOrder: 8,
    active: true,
    tsdbSlug: 'Mixed+Martial+Arts',
    apiSportsBase: 'https://v1.mma.api-sports.io',
  },
  {
    key: 'american-football',
    family: 'american_football',
    displayName: 'American Football',
    emoji: '🏈',
    accentColor: '#F87171',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 9,
    active: true,
    tsdbSlug: 'American+Football',
    apiSportsBase: 'https://v1.american-football.api-sports.io',
  },
  {
    key: 'handball',
    family: 'handball',
    displayName: 'Handball',
    emoji: '🤾',
    accentColor: '#FB923C',
    primaryProvider: 'api-sports',
    hasDraw: true,
    hasBtts: true,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: false,
    hasH2H: true,
    liveUpdateIntervalSec: 20,
    displayOrder: 10,
    active: true,
    tsdbSlug: 'Handball',
    apiSportsBase: 'https://v1.handball.api-sports.io',
  },
  {
    key: 'volleyball',
    family: 'volleyball',
    displayName: 'Volleyball',
    emoji: '🏐',
    accentColor: '#60A5FA',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Sets',
    hasStandings: true,
    hasLineups: false,
    hasH2H: true,
    liveUpdateIntervalSec: 15,
    displayOrder: 11,
    active: true,
    tsdbSlug: 'Volleyball',
    apiSportsBase: 'https://v1.volleyball.api-sports.io',
  },
  {
    key: 'formula1',
    family: 'formula1',
    displayName: 'Formula 1',
    emoji: '🏎️',
    accentColor: '#E11D48',
    primaryProvider: 'thesportsdb',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Pos',
    hasStandings: true,
    hasLineups: false,
    hasH2H: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 13,
    active: true,
    tsdbSlug: 'Motorsport',
  },
  {
    key: 'afl',
    family: 'afl',
    displayName: 'AFL',
    emoji: '🏉',
    accentColor: '#00B140',
    primaryProvider: 'api-sports',
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: false,
    hasH2H: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 22,
    active: true,
    tsdbSlug: 'Australian+Football',
    apiSportsBase: 'https://v1.afl.api-sports.io',
  },
];

// ─── Lookup helpers ────────────────────────────────────────────────────────────

/** Get sport definition by DB key */
export function getSportDef(key: string): SportDefinition | undefined {
  return SPORTS_REGISTRY.find((s) => s.key === key.toLowerCase().replace(/\s+/g, '-'));
}

/** Get active sports sorted by displayOrder */
export function getActiveSports(): SportDefinition[] {
  return SPORTS_REGISTRY.filter((s) => s.active).sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Get emoji for a sport key */
export function getSportEmoji(key: string): string {
  return getSportDef(key)?.emoji ?? '🏆';
}

/** Get accent color for a sport key */
export function getSportAccentColor(key: string): string {
  return getSportDef(key)?.accentColor ?? '#6EDC1F';
}

/** Get display name for a sport key */
export function getSportDisplayName(key: string): string {
  return getSportDef(key)?.displayName ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Get live update interval in ms */
export function getSportUpdateInterval(key: string): number {
  return (getSportDef(key)?.liveUpdateIntervalSec ?? 30) * 1000;
}

/** Check if sport supports draw market */
export function sportHasDraw(key: string): boolean {
  return getSportDef(key)?.hasDraw ?? true;
}

/** Check if sport supports BTTS market */
export function sportHasBtts(key: string): boolean {
  return getSportDef(key)?.hasBtts ?? false;
}

/** Get scoring unit label */
export function getScoringUnit(key: string): string {
  return getSportDef(key)?.scoringUnit ?? 'Goals';
}

/** Check if sport is fight-based (MMA/Boxing) */
export function isFightSport(key: string): boolean {
  const family = getSportDef(key)?.family;
  return family === 'mma' || family === 'boxing';
}

/** Check if sport is racket-based (Tennis, Table Tennis, Badminton, Squash) */
export function isRacketSport(key: string): boolean {
  const family = getSportDef(key)?.family;
  return family === 'tennis' || family === 'table_tennis' || family === 'badminton';
}

/** Check if sport is motorsport */
export function isMotorSport(key: string): boolean {
  const family = getSportDef(key)?.family;
  return family === 'formula1' || family === 'motorsports' || family === 'cycling';
}

/** Get all sport keys as string array */
export function getAllSportKeys(): string[] {
  return SPORTS_REGISTRY.filter((s) => s.active).map((s) => s.key);
}

/** Build the predictions rail chips for a given sport */
export interface PredFilterChip {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export function getPredictionFiltersForSport(sportKey: string): PredFilterChip[] {
  const def = getSportDef(sportKey);
  const base: PredFilterChip[] = [
    { id: 'All', label: 'All', icon: 'apps-outline', color: '#F59E0B' },
    { id: 'home_win', label: isFightSport(sportKey) ? 'Fighter 1' : 'Home Win', icon: 'home-outline', color: '#6366F1' },
    { id: 'away_win', label: isFightSport(sportKey) ? 'Fighter 2' : 'Away Win', icon: 'airplane-outline', color: '#EC4899' },
  ];
  if (def?.hasDraw) base.splice(2, 0, { id: 'draw', label: 'Draw', icon: 'remove-outline', color: '#818CF8' });
  if (!isFightSport(sportKey) && !isMotorSport(sportKey)) {
    base.push({ id: 'over', label: `Over ${def?.scoringUnit ?? ''}`.trim(), icon: 'trending-up-outline', color: '#22C55E' });
    base.push({ id: 'under', label: `Under ${def?.scoringUnit ?? ''}`.trim(), icon: 'trending-down-outline', color: '#EF4444' });
  }
  if (def?.hasBtts) {
    base.push({ id: 'btts_yes', label: 'BTTS Yes', icon: 'swap-horizontal-outline', color: '#14B8A6' });
    base.push({ id: 'btts_no', label: 'BTTS No', icon: 'close-circle-outline', color: '#F97316' });
  }
  base.push({ id: 'high_conf', label: 'High Conf', icon: 'shield-checkmark-outline', color: '#A855F7' });
  return base;
}

/**
 * Get the result chip label appropriate for this sport.
 * e.g., "Home Win" for football, "Fighter 1 Win" for MMA.
 */
export function getResultLabel(
  sportKey: string,
  result: string,
  homeTeam: string,
  awayTeam: string,
): string {
  const fight = isFightSport(sportKey);
  if (result === 'home_win') return fight ? `${homeTeam.split(' ').slice(-1)[0]} Wins` : 'Home Win';
  if (result === 'away_win') return fight ? `${awayTeam.split(' ').slice(-1)[0]} Wins` : 'Away Win';
  if (result === 'draw') return fight ? 'Draw / NC' : 'Draw';
  return result;
}

export default SPORTS_REGISTRY;
