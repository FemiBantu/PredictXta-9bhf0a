/**
 * services/providers/index.ts
 *
 * Provider layer barrel export.
 *
 * Usage in services/components:
 *   import { getProviderPriority, providerSupports, isDataStale } from '@/services/providers';
 *   import type { CanonicalMatch, CanonicalOdds } from '@/services/providers';
 */

// Provider configuration (priority, capability matrix, rate limits, freshness TTLs)
export {
  getProviderPriority,
  providerSupports,
  getBestProvider,
  isDataStale,
  normalizeProviderSport,
  isValidCanonicalSport,
  PROVIDER_CAPABILITIES,
  PROVIDER_RATE_LIMITS,
  PROVIDER_BASE_URLS,
  PROVIDER_SPORT_ALIASES,
  DATA_FRESHNESS_TTL_MS,
  CANONICAL_TO_DB_STATUS,
} from './providerConfig';

export type {
  ProviderId,
  CapabilityLevel,
  DataType,
  CanonicalMatchStatus,
} from './providerConfig';

// Canonical internal types (frontend contract — never expose provider types)
export type {
  CanonicalMatch,
  CanonicalOdds,
  CanonicalStanding,
  CanonicalMatchEvent,
  CanonicalLineup,
  CanonicalMatchStat,
  CanonicalStatus,
  DbMatchStatus,
  OddsMarket,
  CanonicalEventType,
  FetchState,
  DataWithState,
  EntityType,
  ProviderEntityMapping,
  IngestionResult,
} from './providerTypes';

// Provider interface and registry
export {
  registerProvider,
  getProvider,
  getAllRegisteredProviders,
} from './sportsProviderInterface';

export type {
  SportsProvider,
  FetchOptions,
} from './sportsProviderInterface';
