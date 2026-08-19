/**
 * services/providers/providerConfig.ts
 *
 * PredictXta Centralized Provider Configuration — Phase 3
 *
 * SINGLE SOURCE OF TRUTH for:
 *  - Provider hierarchy and priority
 *  - Provider capability matrix
 *  - Sport→provider mapping
 *  - Rate limits and thresholds
 *  - Provider health thresholds
 *
 * All other services MUST import provider information from here.
 * Never hard-code provider selection elsewhere in the application.
 */

import { getAllSportKeys } from '@/services/sportsRegistry';

// ─── Provider types ────────────────────────────────────────────────────────────
export type ProviderId = 'api-football' | 'api-sports' | 'thesportsdb';

export type CapabilityLevel = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'NOT_SUPPORTED';

export type DataType =
  | 'fixtures'
  | 'live'
  | 'standings'
  | 'teams'
  | 'players'
  | 'statistics'
  | 'events'
  | 'lineups'
  | 'injuries'
  | 'odds'
  | 'historical'
  | 'seasons'
  | 'news'
  | 'highlights';

// ─── Provider capability matrix ────────────────────────────────────────────────
/**
 * Complete capability matrix for all providers.
 * Structure: provider → sport → dataType → CapabilityLevel
 */
export const PROVIDER_CAPABILITIES: Record<
  ProviderId,
  Record<string, Partial<Record<DataType, CapabilityLevel>>>
> = {
  'api-football': {
    football: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      players:    'SUPPORTED',
      statistics: 'SUPPORTED',
      events:     'SUPPORTED',
      lineups:    'SUPPORTED',
      injuries:   'PARTIALLY_SUPPORTED',
      odds:       'SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
    },
  },

  'api-sports': {
    basketball: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      players:    'PARTIALLY_SUPPORTED',
      statistics: 'SUPPORTED',
      lineups:    'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      events:     'NOT_SUPPORTED',
      injuries:   'NOT_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    baseball: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      players:    'PARTIALLY_SUPPORTED',
      statistics: 'SUPPORTED',
      lineups:    'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    hockey: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      statistics: 'PARTIALLY_SUPPORTED',
      lineups:    'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    rugby: {
      fixtures:   'SUPPORTED',
      live:       'PARTIALLY_SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      statistics: 'NOT_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    'american-football': {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      statistics: 'SUPPORTED',
      lineups:    'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    handball: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      statistics: 'NOT_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    volleyball: {
      fixtures:   'SUPPORTED',
      live:       'SUPPORTED',
      standings:  'SUPPORTED',
      teams:      'SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      statistics: 'NOT_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    mma: {
      fixtures:   'SUPPORTED',
      live:       'PARTIALLY_SUPPORTED',
      standings:  'NOT_SUPPORTED',
      teams:      'NOT_SUPPORTED',
      players:    'SUPPORTED',
      statistics: 'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      seasons:    'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    boxing: {
      fixtures:   'PARTIALLY_SUPPORTED',
      live:       'NOT_SUPPORTED',
      standings:  'NOT_SUPPORTED',
      players:    'PARTIALLY_SUPPORTED',
      historical: 'PARTIALLY_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    esports: {
      fixtures:   'PARTIALLY_SUPPORTED',
      live:       'PARTIALLY_SUPPORTED',
      standings:  'NOT_SUPPORTED',
      teams:      'PARTIALLY_SUPPORTED',
      historical: 'PARTIALLY_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
  },

  thesportsdb: {
    football: {
      fixtures:   'SUPPORTED',
      live:       'PARTIALLY_SUPPORTED',
      standings:  'NOT_SUPPORTED',
      teams:      'SUPPORTED',
      players:    'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      highlights: 'SUPPORTED',
      news:       'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    basketball: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      teams:      'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    tennis: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      teams:      'NOT_SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    cricket: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      standings:  'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    baseball: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    hockey: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    rugby: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    'american-football': {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    mma: {
      fixtures:   'SUPPORTED',
      live:       'PARTIALLY_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    boxing: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    handball: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    volleyball: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
    esports: {
      fixtures:   'SUPPORTED',
      live:       'NOT_SUPPORTED',
      historical: 'SUPPORTED',
      odds:       'NOT_SUPPORTED',
    },
  },
};

// ─── Provider priority by sport + data type ────────────────────────────────────
/**
 * Returns the ordered list of providers to try for a given sport + data type.
 * First provider is primary; subsequent are fallbacks.
 */
export function getProviderPriority(sport: string, dataType: DataType): ProviderId[] {
  const s = sport.toLowerCase();

  switch (dataType) {
    case 'fixtures':
    case 'live':
    case 'events':
    case 'lineups':
    case 'injuries':
    case 'statistics':
      if (s === 'football')        return ['api-football', 'thesportsdb'];
      if (s === 'tennis')          return ['thesportsdb'];
      if (s === 'cricket')         return ['thesportsdb'];
      if (s === 'boxing')          return ['thesportsdb', 'api-sports'];
      if (s === 'esports')         return ['thesportsdb', 'api-sports'];
      // All other API-Sports sports: primary = api-sports, fallback = thesportsdb
      return ['api-sports', 'thesportsdb'];

    case 'standings':
    case 'seasons':
    case 'teams':
    case 'players':
      if (s === 'football')        return ['api-football', 'thesportsdb'];
      if (s === 'tennis')          return ['thesportsdb'];
      if (s === 'cricket')         return ['thesportsdb'];
      return ['api-sports', 'thesportsdb'];

    case 'odds':
      if (s === 'football')        return ['api-football'];
      return []; // No odds provider for other sports

    case 'historical':
      if (s === 'football')        return ['api-football', 'thesportsdb'];
      if (s === 'tennis' || s === 'cricket') return ['thesportsdb'];
      return ['api-sports', 'thesportsdb'];

    case 'news':
    case 'highlights':
      return ['thesportsdb', 'api-football'];

    default:
      return ['api-football', 'thesportsdb'];
  }
}

// ─── Provider capability check ─────────────────────────────────────────────────
/**
 * Check if a specific provider supports a data type for a sport.
 * Returns false for NOT_SUPPORTED or missing entries.
 */
export function providerSupports(
  provider: ProviderId,
  sport: string,
  dataType: DataType,
): boolean {
  const capability = PROVIDER_CAPABILITIES[provider]?.[sport.toLowerCase()]?.[dataType];
  return capability === 'SUPPORTED' || capability === 'PARTIALLY_SUPPORTED';
}

/**
 * Get the best provider for a sport+dataType that is currently considered healthy.
 * Pass a healthCheck function that returns true if the provider is available.
 */
export function getBestProvider(
  sport: string,
  dataType: DataType,
  healthCheck?: (provider: ProviderId) => boolean,
): ProviderId | null {
  const priority = getProviderPriority(sport, dataType);
  for (const provider of priority) {
    if (!healthCheck || healthCheck(provider)) return provider;
  }
  return null;
}

// ─── Rate limits ───────────────────────────────────────────────────────────────
export const PROVIDER_RATE_LIMITS: Record<ProviderId, {
  dailyLimit: number;
  criticalThreshold: number; // % of daily limit at which to throttle
  warningThreshold: number;
  minIntervalMs: number; // minimum ms between requests
}> = {
  'api-football': {
    dailyLimit: 7000,
    criticalThreshold: 90,
    warningThreshold: 75,
    minIntervalMs: 500,
  },
  'api-sports': {
    dailyLimit: 7000,
    criticalThreshold: 90,
    warningThreshold: 75,
    minIntervalMs: 500,
  },
  thesportsdb: {
    dailyLimit: 999999, // No hard daily limit on free tier; rate limited per second
    criticalThreshold: 999,
    warningThreshold: 999,
    minIntervalMs: 3000, // 3s minimum between TSDB requests
  },
};

// ─── Provider base URLs ────────────────────────────────────────────────────────
export const PROVIDER_BASE_URLS: Record<string, string> = {
  // API-Football / API-Sports sub-domains (same key, different hosts)
  'football':           'https://v3.football.api-sports.io',
  'basketball':         'https://v1.basketball.api-sports.io',
  'baseball':           'https://v1.baseball.api-sports.io',
  'hockey':             'https://v1.hockey.api-sports.io',
  'handball':           'https://v1.handball.api-sports.io',
  'volleyball':         'https://v1.volleyball.api-sports.io',
  'rugby':              'https://v1.rugby.api-sports.io',
  'american-football':  'https://v1.american-football.api-sports.io',
  'mma':                'https://v1.mma.api-sports.io',
  'boxing':             'https://v1.boxing.api-sports.io',
  'esports':            'https://v1.esports.api-sports.io',
  // TheSportsDB
  'tsdb-v2':            'https://www.thesportsdb.com/api/v2/json',
  'tsdb-v1':            'https://www.thesportsdb.com/api/v1/json',
};

// ─── Canonical status mapping ──────────────────────────────────────────────────
/**
 * Canonical match statuses.
 * Provider statuses must always be normalized to one of these values.
 */
export type CanonicalMatchStatus =
  | 'NOT_STARTED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'HALFTIME'
  | 'PAUSED'
  | 'FINISHED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'ABANDONED'
  | 'SUSPENDED';

/** Map canonical status to DB storage value */
export const CANONICAL_TO_DB_STATUS: Record<CanonicalMatchStatus, 'live' | 'upcoming' | 'finished'> = {
  NOT_STARTED: 'upcoming',
  SCHEDULED:   'upcoming',
  LIVE:        'live',
  HALFTIME:    'live',
  PAUSED:      'live',
  FINISHED:    'finished',
  POSTPONED:   'upcoming',
  CANCELLED:   'finished',
  ABANDONED:   'finished',
  SUSPENDED:   'live',
};

// ─── Sport key normalization (provider → canonical) ────────────────────────────
/**
 * Maps provider-specific sport terminology to PredictXta canonical sport keys.
 * MUST align with sportsRegistry.ts SPORTS_REGISTRY keys.
 */
export const PROVIDER_SPORT_ALIASES: Record<string, string> = {
  // Provider → Canonical key
  soccer:                     'football',
  'american_football':        'american-football',
  americanfootball:           'american-football',
  'ice_hockey':               'hockey',
  icehockey:                  'hockey',
  'ice hockey':               'hockey',
  'mixed_martial_arts':       'mma',
  'mixed martial arts':       'mma',
  'e-sports':                 'esports',
  e_sports:                   'esports',
  'rugby league':             'rugby',
  'rugby union':              'rugby',
  'rugby_league':             'rugby',
  'rugby_union':              'rugby',
};

/**
 * Normalize any provider-supplied sport string to the canonical PredictXta key.
 */
export function normalizeProviderSport(providerSport: string): string {
  const lower = providerSport.toLowerCase().trim();
  return PROVIDER_SPORT_ALIASES[lower] ?? lower;
}

/**
 * Check if a provider sport string maps to a valid PredictXta canonical sport.
 */
export function isValidCanonicalSport(providerSport: string): boolean {
  const canonical = normalizeProviderSport(providerSport);
  return getAllSportKeys().includes(canonical);
}

// ─── Data freshness TTLs (ms) ──────────────────────────────────────────────────
export const DATA_FRESHNESS_TTL_MS: Record<DataType | 'live_score', number> = {
  live_score:  30_000,        // 30 seconds — live match scores
  live:        30_000,        // 30 seconds
  fixtures:    6 * 3600_000,  // 6 hours — upcoming fixtures
  odds:        15 * 60_000,   // 15 minutes — odds change frequently
  standings:   24 * 3600_000, // 24 hours
  statistics:  24 * 3600_000, // 24 hours
  teams:       7 * 86400_000, // 7 days — team metadata is stable
  players:     24 * 3600_000, // 24 hours
  events:      60_000,        // 1 minute — live match events
  lineups:     3 * 3600_000,  // 3 hours — confirmed lineups
  injuries:    6 * 3600_000,  // 6 hours
  historical:  30 * 86400_000,// 30 days — historical data is immutable
  seasons:     7 * 86400_000, // 7 days
  news:        30 * 60_000,   // 30 minutes
  highlights:  60 * 60_000,   // 1 hour
};

/**
 * Check if a timestamp is stale for a given data type.
 */
export function isDataStale(
  lastUpdatedAt: string | null | undefined,
  dataType: DataType | 'live_score',
): boolean {
  if (!lastUpdatedAt) return true;
  const age = Date.now() - new Date(lastUpdatedAt).getTime();
  return age > (DATA_FRESHNESS_TTL_MS[dataType] ?? DATA_FRESHNESS_TTL_MS.fixtures);
}
