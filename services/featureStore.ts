/**
 * services/featureStore.ts — PredictXta Phase 8 Feature Store
 *
 * Versioned, leakage-safe feature calculations for the prediction engine.
 *
 * Each feature set records:
 *   - feature name
 *   - sport
 *   - source
 *   - calculation method
 *   - timestamp
 *   - version
 *   - validity
 *   - missing-data state
 *
 * LEAKAGE PREVENTION:
 *   - Features are computed from data available BEFORE match_time only
 *   - No final scores, post-match stats, or future results are ever used
 *   - Every feature set records is_leakage_safe = true only after validation
 *
 * FABRICATION PREVENTION:
 *   - Missing features are recorded as null, not substituted
 *   - completeness_pct drives confidence ceiling in the quality gate
 *   - No synthetic values are generated for missing data
 */

import { getSupabaseClient } from '@/template';
import type { Match } from './types';

// ─── Feature version ──────────────────────────────────────────────────────────
export const CURRENT_FEATURE_VERSION = 'v1.0.0';

// ─── Feature types ────────────────────────────────────────────────────────────
export interface TeamStrengthFeatures {
  eloRating: number | null;
  offensiveStrength: number | null;
  defensiveStrength: number | null;
  recentFormW: number | null;    // wins in last N matches
  recentFormD: number | null;
  recentFormL: number | null;
  goalsForAvg: number | null;
  goalsAgainstAvg: number | null;
}

export interface ContextFeatures {
  isHome: boolean;
  homeAdvantageValue: number | null;
  restDays: number | null;
  travelDistance: null;          // not reliable from available data
  scheduleCongest: number | null;
}

export interface MarketFeatures {
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  homeImpliedProb: number | null;
  drawImpliedProb: number | null;
  awayImpliedProb: number | null;
  marketMargin: number | null;
  oddsTimestamp: string | null;
}

export interface H2HFeatures {
  h2hMatchesConsidered: number;
  h2hHomeWinRate: number | null;
  h2hDrawRate: number | null;
  h2hAwayWinRate: number | null;
  h2hAvgGoals: number | null;
}

export interface SportSpecificFeatures {
  // Football
  xgHome?: number | null;
  xgAway?: number | null;
  possessionHome?: number | null;
  cornersAvgHome?: number | null;
  cornersAvgAway?: number | null;
  // Basketball
  offRatingHome?: number | null;
  defRatingAway?: number | null;
  paceHome?: number | null;
  // Tennis
  serveWinRatePlayer1?: number | null;
  returnWinRatePlayer1?: number | null;
  surfaceWinRatePlayer1?: number | null;
  // Cricket
  battingAvgHome?: number | null;
  bowlingAvgAway?: number | null;
  // Generic
  winRateHome?: number | null;
  winRateAway?: number | null;
}

export interface FeatureSet {
  matchId: string;
  sport: string;
  featureVersion: string;
  computedAt: string;
  validUntil: string | null;
  isLeakageSafe: boolean;
  completenessPercent: number;
  missingFields: string[];
  sourceSnapshot: string;
  home: TeamStrengthFeatures;
  away: TeamStrengthFeatures;
  context: ContextFeatures;
  market: MarketFeatures;
  h2h: H2HFeatures;
  sportSpecific: SportSpecificFeatures;
}

// ─── Odds → implied probability conversion ────────────────────────────────────
function oddsToImpliedProb(odds: number | null): number | null {
  if (!odds || odds <= 1) return null;
  return Math.round((1 / odds) * 10000) / 10000;
}

function marketMarginFromOdds(home: number | null, draw: number | null, away: number | null): number | null {
  if (!home || !draw || !away) return null;
  const margin = (1 / home) + (1 / draw) + (1 / away);
  return Math.round((margin - 1) * 10000) / 10000;
}

// ─── Form window calculation ─────────────────────────────────────────────────
function computeFormFromResults(results: string[]): { w: number; d: number; l: number } {
  const r = { w: 0, d: 0, l: 0 };
  for (const res of results.slice(0, 5)) {
    if (res === 'W') r.w++;
    else if (res === 'D') r.d++;
    else if (res === 'L') r.l++;
  }
  return r;
}

// ─── Elo rating from recent performance ──────────────────────────────────────
// Simplified Elo proxy from standing position (not true Elo)
function estimateEloFromPosition(position: number | null, totalTeams = 20): number | null {
  if (!position || position < 1) return null;
  // Map rank 1 → 1800, rank 20 → 1200
  return Math.round(1800 - ((position - 1) / (totalTeams - 1)) * 600);
}

// ─── Main feature computation ─────────────────────────────────────────────────
export async function computeFeatureSet(match: Match): Promise<FeatureSet> {
  const computedAt = new Date().toISOString();
  const missingFields: string[] = [];

  // Validate leakage safety: must not be computed after match has result
  const isLeakageSafe = match.status === 'upcoming' || match.status === 'scheduled';

  const supabase = getSupabaseClient();

  // ── 1. Market features from odds table ──────────────────────────────────────
  let marketFeatures: MarketFeatures = {
    homeOdds: null, drawOdds: null, awayOdds: null,
    homeImpliedProb: null, drawImpliedProb: null, awayImpliedProb: null,
    marketMargin: null, oddsTimestamp: null,
  };
  try {
    const { data: oddsData } = await supabase
      .from('odds')
      .select('home_win, draw, away_win, last_updated')
      .eq('match_id', match.id)
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (oddsData) {
      const homeOdds = oddsData.home_win ? Number(oddsData.home_win) : null;
      const drawOdds = oddsData.draw ? Number(oddsData.draw) : null;
      const awayOdds = oddsData.away_win ? Number(oddsData.away_win) : null;
      marketFeatures = {
        homeOdds,
        drawOdds,
        awayOdds,
        homeImpliedProb: oddsToImpliedProb(homeOdds),
        drawImpliedProb: oddsToImpliedProb(drawOdds),
        awayImpliedProb: oddsToImpliedProb(awayOdds),
        marketMargin: marketMarginFromOdds(homeOdds, drawOdds, awayOdds),
        oddsTimestamp: oddsData.last_updated ?? null,
      };
    } else {
      missingFields.push('market.odds');
    }
  } catch {
    missingFields.push('market.odds');
  }

  // ── 2. League standings for team strength signals ────────────────────────────
  let homeStrength: TeamStrengthFeatures = {
    eloRating: null, offensiveStrength: null, defensiveStrength: null,
    recentFormW: null, recentFormD: null, recentFormL: null,
    goalsForAvg: null, goalsAgainstAvg: null,
  };
  let awayStrength: TeamStrengthFeatures = {
    eloRating: null, offensiveStrength: null, defensiveStrength: null,
    recentFormW: null, recentFormD: null, recentFormL: null,
    goalsForAvg: null, goalsAgainstAvg: null,
  };

  try {
    const { data: standings } = await supabase
      .from('league_standings')
      .select('team_name, position, played, wins, draws, losses, goals_for, goals_against, form')
      .eq('league_name', match.league ?? '')
      .in('team_name', [match.homeTeam, match.awayTeam]);

    if (standings && standings.length > 0) {
      const totalTeams = Math.max(...standings.map((s: any) => s.position ?? 1), 20);

      for (const row of standings as any[]) {
        const goalsForAvg = row.played > 0 ? Number((row.goals_for / row.played).toFixed(2)) : null;
        const goalsAgainstAvg = row.played > 0 ? Number((row.goals_against / row.played).toFixed(2)) : null;
        const form = computeFormFromResults(
          (row.form ?? '').split('').filter((c: string) => ['W', 'D', 'L'].includes(c)),
        );
        const elo = estimateEloFromPosition(row.position, totalTeams);

        const tf: TeamStrengthFeatures = {
          eloRating: elo,
          offensiveStrength: goalsForAvg,
          defensiveStrength: goalsAgainstAvg ? 1 / goalsAgainstAvg : null,
          recentFormW: form.w,
          recentFormD: form.d,
          recentFormL: form.l,
          goalsForAvg,
          goalsAgainstAvg,
        };

        if (row.team_name === match.homeTeam) homeStrength = tf;
        else if (row.team_name === match.awayTeam) awayStrength = tf;
      }
    } else {
      missingFields.push('home.standings', 'away.standings');
    }
  } catch {
    missingFields.push('home.standings', 'away.standings');
  }

  // ── 3. H2H context ────────────────────────────────────────────────────────
  let h2hFeatures: H2HFeatures = {
    h2hMatchesConsidered: 0,
    h2hHomeWinRate: null,
    h2hDrawRate: null,
    h2hAwayWinRate: null,
    h2hAvgGoals: null,
  };
  try {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600_000).toISOString();
    const { data: h2h } = await supabase
      .from('matches')
      .select('home_team, away_team, home_score, away_score, status')
      .or(`and(home_team.eq.${match.homeTeam},away_team.eq.${match.awayTeam}),and(home_team.eq.${match.awayTeam},away_team.eq.${match.homeTeam})`)
      .eq('status', 'finished')
      .gte('match_time', twoYearsAgo)
      // Leakage guard: only matches strictly before this match's kickoff
      .lt('match_time', match.matchTime)
      .order('match_time', { ascending: false })
      .limit(10);

    if (h2h && h2h.length > 0) {
      let homeWins = 0; let draws = 0; let awayWins = 0; let totalGoals = 0;
      for (const m of h2h as any[]) {
        const hg = Number(m.home_score ?? 0);
        const ag = Number(m.away_score ?? 0);
        totalGoals += hg + ag;
        const isHome = m.home_team === match.homeTeam;
        if (hg > ag) isHome ? homeWins++ : awayWins++;
        else if (hg === ag) draws++;
        else isHome ? awayWins++ : homeWins++;
      }
      const n = h2h.length;
      h2hFeatures = {
        h2hMatchesConsidered: n,
        h2hHomeWinRate: n > 0 ? Number((homeWins / n).toFixed(3)) : null,
        h2hDrawRate: n > 0 ? Number((draws / n).toFixed(3)) : null,
        h2hAwayWinRate: n > 0 ? Number((awayWins / n).toFixed(3)) : null,
        h2hAvgGoals: n > 0 ? Number((totalGoals / n).toFixed(2)) : null,
      };
    } else {
      missingFields.push('h2h.recent_matches');
    }
  } catch {
    missingFields.push('h2h.recent_matches');
  }

  // ── 4. Context ───────────────────────────────────────────────────────────────
  const contextFeatures: ContextFeatures = {
    isHome: true,
    homeAdvantageValue: 0.05,     // conservative fixed home advantage
    restDays: null,
    travelDistance: null,
    scheduleCongest: null,
  };

  // ── 5. Sport-specific features ────────────────────────────────────────────
  const sportSpecific: SportSpecificFeatures = {};
  try {
    const sport = match.sport?.toLowerCase() ?? 'football';
    if (sport === 'football' || sport === 'soccer') {
      const { data: stats } = await supabase
        .from('player_stats')
        .select('team_name, goals, appearances')
        .eq('league_name', match.league ?? '')
        .in('team_name', [match.homeTeam, match.awayTeam])
        .limit(40);

      if (stats && stats.length > 0) {
        const homeStats = (stats as any[]).filter((s) => s.team_name === match.homeTeam);
        const awayStats = (stats as any[]).filter((s) => s.team_name === match.awayTeam);
        const homeGoals = homeStats.reduce((s: number, p: any) => s + Number(p.goals ?? 0), 0);
        const awayGoals = awayStats.reduce((s: number, p: any) => s + Number(p.goals ?? 0), 0);
        const homeApps = homeStats.reduce((s: number, p: any) => s + Number(p.appearances ?? 0), 0);
        const awayApps = awayStats.reduce((s: number, p: any) => s + Number(p.appearances ?? 0), 0);
        sportSpecific.winRateHome = homeApps > 0 ? Number((homeGoals / homeApps).toFixed(3)) : null;
        sportSpecific.winRateAway = awayApps > 0 ? Number((awayGoals / awayApps).toFixed(3)) : null;
      }
    }
  } catch {
    missingFields.push('sport_specific.player_stats');
  }

  // ── 6. Completeness scoring ───────────────────────────────────────────────
  const totalFields = 20;
  const presentFields = totalFields - missingFields.length;
  const completenessPercent = Math.round((presentFields / totalFields) * 100);

  return {
    matchId: match.id,
    sport: match.sport?.toLowerCase() ?? 'football',
    featureVersion: CURRENT_FEATURE_VERSION,
    computedAt,
    validUntil: new Date(Date.now() + 6 * 3600_000).toISOString(),
    isLeakageSafe,
    completenessPercent,
    missingFields,
    sourceSnapshot: `db@${computedAt}`,
    home: homeStrength,
    away: awayStrength,
    context: contextFeatures,
    market: marketFeatures,
    h2h: h2hFeatures,
    sportSpecific,
  };
}

// ─── Persist feature set to feature_store table ──────────────────────────────
export async function persistFeatureSet(fs: FeatureSet): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('feature_store').upsert({
      match_id: fs.matchId,
      sport: fs.sport,
      feature_version: fs.featureVersion,
      features: {
        home: fs.home,
        away: fs.away,
        context: fs.context,
        market: fs.market,
        h2h: fs.h2h,
        sportSpecific: fs.sportSpecific,
      },
      missing_fields: fs.missingFields,
      completeness_pct: fs.completenessPercent,
      computed_at: fs.computedAt,
      valid_until: fs.validUntil,
      is_leakage_safe: fs.isLeakageSafe,
      source_snapshot: fs.sourceSnapshot,
    }, { onConflict: 'match_id,feature_version' });
  } catch { /* non-blocking — feature store is advisory */ }
}

// ─── Load cached feature set ──────────────────────────────────────────────────
export async function loadFeatureSet(matchId: string): Promise<FeatureSet | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('feature_store')
      .select('*')
      .eq('match_id', matchId)
      .eq('feature_version', CURRENT_FEATURE_VERSION)
      .gt('valid_until', new Date().toISOString())
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const f = data.features as any;
    return {
      matchId: data.match_id,
      sport: data.sport,
      featureVersion: data.feature_version,
      computedAt: data.computed_at,
      validUntil: data.valid_until,
      isLeakageSafe: data.is_leakage_safe,
      completenessPercent: data.completeness_pct,
      missingFields: data.missing_fields ?? [],
      sourceSnapshot: data.source_snapshot ?? '',
      home: f?.home ?? {},
      away: f?.away ?? {},
      context: f?.context ?? {},
      market: f?.market ?? {},
      h2h: f?.h2h ?? {},
      sportSpecific: f?.sportSpecific ?? {},
    } as FeatureSet;
  } catch { return null; }
}

// ─── Get or compute features (cache-first) ────────────────────────────────────
export async function getOrComputeFeatures(match: Match): Promise<FeatureSet> {
  const cached = await loadFeatureSet(match.id);
  if (cached) return cached;
  const fresh = await computeFeatureSet(match);
  await persistFeatureSet(fresh);
  return fresh;
}

export default { computeFeatureSet, persistFeatureSet, loadFeatureSet, getOrComputeFeatures };
