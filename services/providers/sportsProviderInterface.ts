/**
 * services/providers/sportsProviderInterface.ts
 *
 * PredictXta SportsProvider — Provider-Independent Interface
 *
 * The frontend MUST NEVER consume provider API response objects directly.
 * All provider responses must pass through the adapters that implement this interface.
 *
 * Architecture:
 *   ProviderAdapter (implements SportsProvider)
 *     → fetch from external API
 *     → parse provider-specific response
 *     → return CanonicalMatch | CanonicalOdds | CanonicalStanding
 *     → validation in normalizePipeline
 *     → DB upsert
 *     → canonical API served to frontend
 */

import type {
  CanonicalMatch,
  CanonicalOdds,
  CanonicalStanding,
  CanonicalMatchEvent,
  CanonicalLineup,
  CanonicalMatchStat,
  IngestionResult,
} from './providerTypes';

// ─── Fetch options ─────────────────────────────────────────────────────────────
export interface FetchOptions {
  /** ISO date string e.g. '2026-08-19' */
  date?: string;
  /** ISO start of date range */
  dateFrom?: string;
  /** ISO end of date range */
  dateTo?: string;
  /** sport key from canonical registry */
  sport?: string;
  /** provider-specific league ID */
  leagueId?: number;
  /** season year */
  season?: number;
  /** max results */
  limit?: number;
  /** page number (provider pagination) */
  page?: number;
  /** 'live' | 'today' | 'all' | 'upcoming' */
  mode?: string;
}

// ─── Provider interface ────────────────────────────────────────────────────────
export interface SportsProvider {
  readonly providerId: string;
  readonly displayName: string;

  /**
   * Get all sports this provider supports.
   * Returns canonical PredictXta sport keys.
   */
  getSupportedSports(): string[];

  /**
   * Check if this provider supports a given capability for a sport.
   */
  supportsCapability(sport: string, capability: string): boolean;

  /**
   * Fetch upcoming and scheduled fixtures.
   * Must return canonical CanonicalMatch objects.
   * Must NEVER return provider-specific response shapes.
   * Must return empty array (not throw) when provider returns no data.
   */
  getFixtures(sport: string, opts?: FetchOptions): Promise<CanonicalMatch[]>;

  /**
   * Fetch currently live matches.
   * Must return canonical CanonicalMatch objects with status='live'.
   */
  getLiveMatches(sport: string): Promise<CanonicalMatch[]>;

  /**
   * Fetch a single match by provider-specific ID.
   */
  getFixture?(matchId: string, sport: string): Promise<CanonicalMatch | null>;

  /**
   * Fetch league standings.
   */
  getStandings?(sport: string, leagueId: number, season?: number): Promise<CanonicalStanding[]>;

  /**
   * Fetch match events (goals, cards, etc.).
   */
  getEvents?(matchId: string, sport: string): Promise<CanonicalMatchEvent[]>;

  /**
   * Fetch team lineups for a match.
   */
  getLineups?(matchId: string, sport: string): Promise<CanonicalLineup[]>;

  /**
   * Fetch match statistics.
   */
  getStatistics?(matchId: string, sport: string): Promise<CanonicalMatchStat[]>;

  /**
   * Fetch odds for a match.
   */
  getOdds?(matchId: string, sport: string): Promise<CanonicalOdds[]>;

  /**
   * Fetch historical results.
   */
  getHistoricalResults?(sport: string, opts?: FetchOptions): Promise<CanonicalMatch[]>;

  /**
   * Get provider health status.
   * Returns true if the provider is currently available.
   */
  isHealthy?(): Promise<boolean>;

  /**
   * Ingest all data for a sport and upsert to DB.
   * Returns an IngestionResult with metrics.
   */
  ingest?(sport: string, mode: string): Promise<IngestionResult>;
}

// ─── Provider registry ─────────────────────────────────────────────────────────
/**
 * Provider registry — holds registered provider instances.
 * Use getProvider() to retrieve the canonical adapter for a sport+dataType.
 */
const _providerRegistry = new Map<string, SportsProvider>();

export function registerProvider(provider: SportsProvider): void {
  _providerRegistry.set(provider.providerId, provider);
}

export function getProvider(providerId: string): SportsProvider | undefined {
  return _providerRegistry.get(providerId);
}

export function getAllRegisteredProviders(): SportsProvider[] {
  return Array.from(_providerRegistry.values());
}
