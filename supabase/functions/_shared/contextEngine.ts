/**
 * supabase/functions/_shared/contextEngine.ts — Phase 8 Context Intelligence
 *
 * Builds structured, source-tagged context objects for prediction reports.
 *
 * Every context item carries:
 *   - source (DB table or provider)
 *   - timestamp
 *   - confidence/quality score
 *   - expiration/freshness flag
 *
 * RULES:
 *   - Unverified information never becomes authoritative prediction input
 *   - External news/text is treated as untrusted; never injected raw into prompts
 *   - Context is cached in context_cache table (RLS-protected)
 *   - LLM never invents context facts; only summarises what is provided here
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ─── Context item ─────────────────────────────────────────────────────────────
export interface ContextItem {
  key: string;
  value: unknown;
  source: string;
  timestamp: string;
  confidenceScore: number;   // 0–100
  isFresh: boolean;
  expiresAt: string;
}

export interface MatchContext {
  matchId: string;
  sport: string;
  generatedAt: string;
  qualityScore: number;
  items: Record<string, ContextItem>;
  sources: string[];
}

// ─── Deterministic cache key ─────────────────────────────────────────────────
function contextCacheKey(matchId: string, contextType: string): string {
  return `ctx:${contextType}:${matchId}`;
}

// ─── Load context from cache ──────────────────────────────────────────────────
async function loadCachedContext(matchId: string, contextType: string): Promise<MatchContext | null> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from('context_cache')
      .select('data, quality_score, sources, computed_at')
      .eq('cache_key', contextCacheKey(matchId, contextType))
      .eq('is_valid', true)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!data) return null;
    return data.data as MatchContext;
  } catch { return null; }
}

// ─── Persist context to cache ─────────────────────────────────────────────────
async function persistContext(ctx: MatchContext, contextType: string): Promise<void> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    const expiresAt = new Date(Date.now() + 6 * 3600_000).toISOString();
    await supabase.from('context_cache').upsert({
      cache_key:    contextCacheKey(ctx.matchId, contextType),
      context_type: contextType,
      match_id:     ctx.matchId,
      sport:        ctx.sport,
      data:         ctx,
      quality_score: ctx.qualityScore,
      sources:       ctx.sources,
      computed_at:   ctx.generatedAt,
      expires_at:    expiresAt,
      is_valid:      true,
    }, { onConflict: 'cache_key' });
  } catch { /* non-blocking */ }
}

// ─── Build match context ──────────────────────────────────────────────────────
export async function buildMatchContext(params: {
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  matchTime: string;
  forceRefresh?: boolean;
}): Promise<MatchContext> {
  const { matchId, sport, homeTeam, awayTeam, league, matchTime, forceRefresh = false } = params;

  // Cache check
  if (!forceRefresh) {
    const cached = await loadCachedContext(matchId, 'full');
    if (cached) return cached;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const generatedAt = new Date().toISOString();
  const items: Record<string, ContextItem> = {};
  const sources: string[] = [];

  // ── 1. League standings context ────────────────────────────────────────────
  try {
    const { data: standings } = await supabase
      .from('league_standings')
      .select('team_name, position, played, wins, draws, losses, points, form, goals_for, goals_against')
      .eq('league_name', league ?? '')
      .in('team_name', [homeTeam, awayTeam]);

    if (standings && standings.length > 0) {
      for (const row of standings as any[]) {
        const teamKey = row.team_name === homeTeam ? 'home' : 'away';
        items[`${teamKey}_standing`] = {
          key: `${teamKey}_standing`,
          value: {
            position: row.position,
            played: row.played,
            wins: row.wins, draws: row.draws, losses: row.losses,
            points: row.points,
            form: row.form,
            goalsFor: row.goals_for,
            goalsAgainst: row.goals_against,
          },
          source: 'league_standings',
          timestamp: generatedAt,
          confidenceScore: 90,
          isFresh: true,
          expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
        };
      }
      sources.push('league_standings');
    }
  } catch { /* non-blocking */ }

  // ── 2. Latest odds context ────────────────────────────────────────────────
  try {
    const { data: odds } = await supabase
      .from('odds')
      .select('home_win, draw, away_win, over_2_5, under_2_5, btts_yes, bookmaker, last_updated')
      .eq('match_id', matchId)
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (odds) {
      const oddsAgeMs = Date.now() - new Date(odds.last_updated ?? 0).getTime();
      const isFresh = oddsAgeMs < 6 * 3600_000;
      items['market_odds'] = {
        key: 'market_odds',
        value: {
          homeWin: odds.home_win,
          draw: odds.draw,
          awayWin: odds.away_win,
          over25: odds.over_2_5,
          bttsYes: odds.btts_yes,
          bookmaker: odds.bookmaker,
        },
        source: 'odds',
        timestamp: odds.last_updated ?? generatedAt,
        confidenceScore: isFresh ? 85 : 50,
        isFresh,
        expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      };
      sources.push('odds');
    }
  } catch { /* non-blocking */ }

  // ── 3. Recent form from match history ────────────────────────────────────
  try {
    const since = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
    const { data: recentMatches } = await supabase
      .from('matches')
      .select('home_team, away_team, home_score, away_score, match_time, status')
      .or(`home_team.eq.${homeTeam},away_team.eq.${homeTeam}`)
      .eq('status', 'finished')
      .gte('match_time', since)
      .lt('match_time', matchTime)  // Leakage guard
      .order('match_time', { ascending: false })
      .limit(5);

    if (recentMatches && recentMatches.length > 0) {
      const results = (recentMatches as any[]).map((m) => {
        const isHome = m.home_team === homeTeam;
        const scored = isHome ? m.home_score : m.away_score;
        const conceded = isHome ? m.away_score : m.home_score;
        const outcome = scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
        return { matchTime: m.match_time, outcome, scored, conceded };
      });

      items['home_form'] = {
        key: 'home_form',
        value: results,
        source: 'matches_history',
        timestamp: generatedAt,
        confidenceScore: 80,
        isFresh: true,
        expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      };
      sources.push('matches_history');
    }
  } catch { /* non-blocking */ }

  // ── 4. Previous AI prediction context ────────────────────────────────────
  try {
    const { data: prevPred } = await supabase
      .from('predictions')
      .select('predicted_result, confidence, ai_analysis, prediction_version, created_at')
      .eq('match_id', matchId)
      .order('prediction_version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prevPred) {
      items['previous_prediction'] = {
        key: 'previous_prediction',
        value: {
          predictedResult: prevPred.predicted_result,
          confidence: prevPred.confidence,
          predictionVersion: prevPred.prediction_version,
          generatedAt: prevPred.created_at,
        },
        source: 'predictions',
        timestamp: prevPred.created_at ?? generatedAt,
        confidenceScore: 70,
        isFresh: true,
        expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      };
    }
  } catch { /* non-blocking */ }

  // ── Quality scoring ───────────────────────────────────────────────────────
  const itemCount = Object.keys(items).length;
  const qualityScore = Math.min(100, itemCount * 20); // up to 5 item types = 100%

  const ctx: MatchContext = {
    matchId,
    sport,
    generatedAt,
    qualityScore,
    items,
    sources: [...new Set(sources)],
  };

  await persistContext(ctx, 'full');
  return ctx;
}

// ─── Build LLM-safe prompt context (no raw external text) ────────────────────
export function buildSafePromptContext(ctx: MatchContext): string {
  const lines: string[] = [`Sport: ${ctx.sport}`, `Context Quality: ${ctx.qualityScore}%`, ''];

  for (const [key, item] of Object.entries(ctx.items)) {
    if (!item.isFresh) continue; // only fresh context enters LLM prompt
    lines.push(`[${key}] (source: ${item.source}, confidence: ${item.confidenceScore}%)`);
    lines.push(JSON.stringify(item.value, null, 2));
    lines.push('');
  }

  return lines.join('\n');
}
