/**
 * services/sportsRegistry.ts — PredictXta Canonical Sports Registry v2.0
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR ALL SPORTS IN PREDICTXTA.
 * No other file may define a list of supported sports.
 * All consumers MUST import from this registry.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Exactly 13 supported sports:
 *   1. football          (API-Football primary)
 *   2. basketball        (API-Sports)
 *   3. tennis            (TheSportsDB — free tier)
 *   4. cricket           (TheSportsDB — free tier)
 *   5. baseball          (API-Sports)
 *   6. ice-hockey        (API-Sports)   [DB key: 'hockey']
 *   7. rugby             (API-Sports)
 *   8. american-football (API-Sports)
 *   9. mma               (API-Sports)
 *  10. boxing            (TheSportsDB)
 *  11. volleyball        (API-Sports)
 *  12. handball          (API-Sports)
 *  13. esports           (TheSportsDB)
 *
 * REMOVED (no reliable live fixture / standings / odds API):
 *   Formula 1, AFL, Badminton, Table Tennis, Snooker, Darts,
 *   Cycling, Athletics, Motorsports, Squash
 */

// ─── Sport family type ────────────────────────────────────────────────────────
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
  | 'boxing'
  | 'esports';

// ─── Provider capability type ─────────────────────────────────────────────────
export type ProviderType = 'api-sports' | 'thesportsdb' | 'api-football';

export interface ProviderCapability {
  provider: ProviderType;
  priority: 1 | 2 | 3;
  supportsFixtures: boolean;
  supportsLive: boolean;
  supportsStandings: boolean;
  supportsStatistics: boolean;
  supportsOdds: boolean;
  supportsLineups: boolean;
  apiSportsBase?: string;
  tsdbSlug?: string;
}

// ─── Sport definition ─────────────────────────────────────────────────────────
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
  /** Provider capabilities in priority order */
  providers: ProviderCapability[];
  /** Whether 1X2 draw market exists */
  hasDraw: boolean;
  /** Whether BTTS market applies (football/handball only) */
  hasBtts: boolean;
  /** Scoring unit label */
  scoringUnit: string;
  /** Whether standings table is available */
  hasStandings: boolean;
  /** Whether player lineups are relevant */
  hasLineups: boolean;
  /** Whether head-to-head history is tracked */
  hasH2H: boolean;
  /** Whether timeline/events feed is available */
  hasTimeline: boolean;
  /** Typical live update interval in seconds */
  liveUpdateIntervalSec: number;
  /** Display order in navigation rail (1 = first) */
  displayOrder: number;
  /** Whether this sport is actively supported in production */
  active: boolean;
}

// ─── Canonical Registry ───────────────────────────────────────────────────────
export const SPORTS_REGISTRY: SportDefinition[] = [
  // ── 1. Football ────────────────────────────────────────────────────────────
  {
    key: 'football',
    family: 'football',
    displayName: 'Football',
    emoji: '⚽',
    accentColor: '#6EDC1F',
    providers: [
      {
        provider: 'api-football',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: true,
        supportsOdds: true,
        supportsLineups: true,
        apiSportsBase: 'https://v3.football.api-sports.io',
        tsdbSlug: 'Soccer',
      },
    ],
    hasDraw: true,
    hasBtts: true,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: true,
    liveUpdateIntervalSec: 30,
    displayOrder: 1,
    active: true,
  },

  // ── 2. Basketball ──────────────────────────────────────────────────────────
  {
    key: 'basketball',
    family: 'basketball',
    displayName: 'Basketball',
    emoji: '🏀',
    accentColor: '#F97316',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: true,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.basketball.api-sports.io',
        tsdbSlug: 'Basketball',
      },
      {
        provider: 'thesportsdb',
        priority: 2,
        supportsFixtures: true,
        supportsLive: false,
        supportsStandings: false,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: false,
        tsdbSlug: 'Basketball',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 15,
    displayOrder: 2,
    active: true,
  },

  // ── 3. Tennis ──────────────────────────────────────────────────────────────
  {
    key: 'tennis',
    family: 'tennis',
    displayName: 'Tennis',
    emoji: '🎾',
    accentColor: '#FBBF24',
    providers: [
      {
        provider: 'thesportsdb',
        priority: 1,
        supportsFixtures: true,
        supportsLive: false,
        supportsStandings: false,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: true,
        tsdbSlug: 'Tennis',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Sets',
    hasStandings: false,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 3,
    active: true,
  },

  // ── 4. Cricket ─────────────────────────────────────────────────────────────
  {
    key: 'cricket',
    family: 'cricket',
    displayName: 'Cricket',
    emoji: '🏏',
    accentColor: '#A78BFA',
    providers: [
      {
        provider: 'thesportsdb',
        priority: 1,
        supportsFixtures: true,
        supportsLive: false,
        supportsStandings: true,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: true,
        tsdbSlug: 'Cricket',
      },
    ],
    hasDraw: true,
    hasBtts: false,
    scoringUnit: 'Runs',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 4,
    active: true,
  },

  // ── 5. Baseball ────────────────────────────────────────────────────────────
  {
    key: 'baseball',
    family: 'baseball',
    displayName: 'Baseball',
    emoji: '⚾',
    accentColor: '#C084FC',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: true,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.baseball.api-sports.io',
        tsdbSlug: 'Baseball',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Runs',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 5,
    active: true,
  },

  // ── 6. Ice Hockey ──────────────────────────────────────────────────────────
  {
    key: 'hockey',
    family: 'hockey',
    displayName: 'Ice Hockey',
    emoji: '🏒',
    accentColor: '#38BDF8',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: true,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.hockey.api-sports.io',
        tsdbSlug: 'Ice+Hockey',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 20,
    displayOrder: 6,
    active: true,
  },

  // ── 7. Rugby ───────────────────────────────────────────────────────────────
  {
    key: 'rugby',
    family: 'rugby',
    displayName: 'Rugby',
    emoji: '🏉',
    accentColor: '#34D399',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.rugby.api-sports.io',
        tsdbSlug: 'Rugby',
      },
    ],
    hasDraw: true,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 7,
    active: true,
  },

  // ── 8. American Football ───────────────────────────────────────────────────
  {
    key: 'american-football',
    family: 'american_football',
    displayName: 'American Football',
    emoji: '🏈',
    accentColor: '#F87171',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: true,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.american-football.api-sports.io',
        tsdbSlug: 'American+Football',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Points',
    hasStandings: true,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 8,
    active: true,
  },

  // ── 9. MMA / UFC ───────────────────────────────────────────────────────────
  {
    key: 'mma',
    family: 'mma',
    displayName: 'MMA / UFC',
    emoji: '🥊',
    accentColor: '#F43F5E',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: false,
        supportsStatistics: true,
        supportsOdds: false,
        supportsLineups: true,
        apiSportsBase: 'https://v1.mma.api-sports.io',
        tsdbSlug: 'Mixed+Martial+Arts',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Rounds',
    hasStandings: false,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 20,
    displayOrder: 9,
    active: true,
  },

  // ── 10. Boxing ─────────────────────────────────────────────────────────────
  {
    key: 'boxing',
    family: 'boxing',
    displayName: 'Boxing',
    emoji: '🥊',
    accentColor: '#EF4444',
    providers: [
      {
        provider: 'thesportsdb',
        priority: 1,
        supportsFixtures: true,
        supportsLive: false,
        supportsStandings: false,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: true,
        tsdbSlug: 'Boxing',
      },
    ],
    hasDraw: true, // Technical draw possible in boxing
    hasBtts: false,
    scoringUnit: 'Rounds',
    hasStandings: false,
    hasLineups: true,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 10,
    active: true,
  },

  // ── 11. Volleyball ─────────────────────────────────────────────────────────
  {
    key: 'volleyball',
    family: 'volleyball',
    displayName: 'Volleyball',
    emoji: '🏐',
    accentColor: '#60A5FA',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: false,
        apiSportsBase: 'https://v1.volleyball.api-sports.io',
        tsdbSlug: 'Volleyball',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Sets',
    hasStandings: true,
    hasLineups: false,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 15,
    displayOrder: 11,
    active: true,
  },

  // ── 12. Handball ───────────────────────────────────────────────────────────
  {
    key: 'handball',
    family: 'handball',
    displayName: 'Handball',
    emoji: '🤾',
    accentColor: '#FB923C',
    providers: [
      {
        provider: 'api-sports',
        priority: 1,
        supportsFixtures: true,
        supportsLive: true,
        supportsStandings: true,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: false,
        apiSportsBase: 'https://v1.handball.api-sports.io',
        tsdbSlug: 'Handball',
      },
    ],
    hasDraw: true,
    hasBtts: true,
    scoringUnit: 'Goals',
    hasStandings: true,
    hasLineups: false,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 20,
    displayOrder: 12,
    active: true,
  },

  // ── 13. Esports ────────────────────────────────────────────────────────────
  {
    key: 'esports',
    family: 'esports',
    displayName: 'Esports',
    emoji: '🎮',
    accentColor: '#8B5CF6',
    providers: [
      {
        provider: 'thesportsdb',
        priority: 1,
        supportsFixtures: true,
        supportsLive: false,
        supportsStandings: false,
        supportsStatistics: false,
        supportsOdds: false,
        supportsLineups: false,
        tsdbSlug: 'eSports',
      },
    ],
    hasDraw: false,
    hasBtts: false,
    scoringUnit: 'Maps',
    hasStandings: false,
    hasLineups: false,
    hasH2H: true,
    hasTimeline: false,
    liveUpdateIntervalSec: 30,
    displayOrder: 13,
    active: true,
  },
];

// ─── Validation (called at startup / build time) ──────────────────────────────

/**
 * assertSupportedSportRegistry() — validates the canonical registry.
 * Throws if: count != 13, duplicates found, or missing required fields.
 * Called in development/test environments to catch regressions.
 */
export function assertSupportedSportRegistry(): void {
  const EXPECTED_KEYS = new Set([
    'football', 'basketball', 'tennis', 'cricket', 'baseball',
    'hockey', 'rugby', 'american-football', 'mma', 'boxing',
    'volleyball', 'handball', 'esports',
  ]);

  const REMOVED_SPORTS = [
    'formula1', 'formula-1', 'afl', 'australian-football',
    'badminton', 'table-tennis', 'snooker', 'darts',
    'cycling', 'athletics', 'motorsports', 'squash',
  ];

  const active = SPORTS_REGISTRY.filter(s => s.active);

  if (active.length !== 13) {
    throw new Error(
      `[SportsRegistry] Expected exactly 13 active sports, found ${active.length}.`
    );
  }

  const keys = new Set(active.map(s => s.key));
  for (const expected of EXPECTED_KEYS) {
    if (!keys.has(expected)) {
      throw new Error(`[SportsRegistry] Missing required sport: ${expected}`);
    }
  }

  for (const removed of REMOVED_SPORTS) {
    if (keys.has(removed)) {
      throw new Error(
        `[SportsRegistry] Removed sport "${removed}" must not appear in active registry.`
      );
    }
  }

  // Check for duplicate keys
  const seen = new Set<string>();
  for (const s of SPORTS_REGISTRY) {
    if (seen.has(s.key)) {
      throw new Error(`[SportsRegistry] Duplicate sport key: ${s.key}`);
    }
    seen.add(s.key);
  }
}

// ─── Lookup helpers ────────────────────────────────────────────────────────────

/** Get sport definition by DB key */
export function getSportDef(key: string): SportDefinition | undefined {
  const normalized = key.toLowerCase().replace(/\s+/g, '-');
  return SPORTS_REGISTRY.find(
    (s) => s.key === normalized || s.key === key.toLowerCase()
  );
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
  return getSportDef(key)?.hasDraw ?? false;
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

/** Check if sport is a racket sport */
export function isRacketSport(key: string): boolean {
  const family = getSportDef(key)?.family;
  return family === 'tennis';
}

/** Get all active sport keys as string array */
export function getAllSportKeys(): string[] {
  return SPORTS_REGISTRY.filter((s) => s.active).map((s) => s.key);
}

/** Check if a sport key is in the active supported list */
export function isSupportedSport(key: string): boolean {
  const normalized = key.toLowerCase().replace(/\s+/g, '-');
  return SPORTS_REGISTRY.some(
    (s) => s.active && (s.key === normalized || s.key === key.toLowerCase())
  );
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
    {
      id: 'home_win',
      label: isFightSport(sportKey) ? 'Fighter 1' : 'Home Win',
      icon: 'home-outline',
      color: '#6366F1',
    },
    {
      id: 'away_win',
      label: isFightSport(sportKey) ? 'Fighter 2' : 'Away Win',
      icon: 'airplane-outline',
      color: '#EC4899',
    },
  ];

  if (def?.hasDraw) {
    base.splice(2, 0, { id: 'draw', label: 'Draw', icon: 'remove-outline', color: '#818CF8' });
  }

  if (!isFightSport(sportKey)) {
    base.push({
      id: 'over',
      label: `Over ${def?.scoringUnit ?? ''}`.trim(),
      icon: 'trending-up-outline',
      color: '#22C55E',
    });
    base.push({
      id: 'under',
      label: `Under ${def?.scoringUnit ?? ''}`.trim(),
      icon: 'trending-down-outline',
      color: '#EF4444',
    });
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

/**
 * Returns the primary provider for a sport's fixture data.
 */
export function getPrimaryProvider(key: string): ProviderCapability | undefined {
  const def = getSportDef(key);
  if (!def) return undefined;
  return def.providers.sort((a, b) => a.priority - b.priority)[0];
}

export default SPORTS_REGISTRY;
