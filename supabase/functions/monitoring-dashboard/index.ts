/**
 * monitoring-dashboard — PredictXta System Health & Pipeline Monitor
 *
 * Returns a comprehensive real-time audit report covering:
 *  - API provider health (success rates, last errors, response times)
 *  - Sports coverage (fixtures per sport, prediction coverage %)
 *  - Pipeline readiness (next-day fixtures, odds, predictions)
 *  - AI prediction quality metrics (avg confidence, quality scores)
 *  - Odds coverage per sport
 *  - Recent alerts and incidents
 *  - Performance benchmarks vs targets
 *
 * GET /monitoring-dashboard          → Full dashboard
 * POST { section: 'api' }           → API health only
 * POST { section: 'coverage' }      → Sports coverage only
 * POST { section: 'predictions' }   → Prediction metrics only
 * POST { section: 'pipeline' }      → Pipeline stage status only
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    let section = 'all';
    try {
      const body = await req.json();
      section = body?.section ?? 'all';
    } catch { /* GET or empty body */ }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const week = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();

    const results: Record<string, unknown> = {
      generated_at: now.toISOString(),
      run_date: todayStr,
    };

    // ── API Health ──────────────────────────────────────────────────────────
    if (section === 'all' || section === 'api') {
      const { data: apiData } = await supabase
        .from('api_usage')
        .select('*')
        .gte('created_at', week);

      const providerMap: Record<string, {
        requests: number; successes: number; errors: number;
        lastCalled: string | null; lastError: string | null; endpoints: Set<string>;
      }> = {};

      for (const row of (apiData ?? [])) {
        if (!providerMap[row.provider_name]) {
          providerMap[row.provider_name] = {
            requests: 0, successes: 0, errors: 0,
            lastCalled: null, lastError: null, endpoints: new Set(),
          };
        }
        const p = providerMap[row.provider_name];
        p.requests += row.request_count ?? 0;
        p.successes += row.success_count ?? 0;
        p.errors += row.error_count ?? 0;
        if (!p.lastCalled || row.last_called > p.lastCalled) p.lastCalled = row.last_called;
        if (row.last_error) p.lastError = row.last_error;
        p.endpoints.add(row.endpoint);
      }

      results['api_health'] = Object.entries(providerMap).map(([name, stats]) => ({
        provider: name,
        total_requests: stats.requests,
        success_rate_pct: stats.requests > 0 ? Math.round((stats.successes / stats.requests) * 100) : 0,
        error_rate_pct: stats.requests > 0 ? Math.round((stats.errors / stats.requests) * 100) : 0,
        last_called: stats.lastCalled,
        last_error: stats.lastError,
        endpoint_count: stats.endpoints.size,
        status: stats.requests === 0 ? 'never_called'
          : stats.successes / stats.requests >= 0.95 ? 'healthy'
          : stats.successes / stats.requests >= 0.7 ? 'degraded'
          : 'critical',
      })).sort((a, b) => b.total_requests - a.total_requests);
    }

    // ── Sports Coverage ─────────────────────────────────────────────────────
    if (section === 'all' || section === 'coverage') {
      const { data: sportData } = await supabase
        .from('matches')
        .select('sport, status, last_updated')
        .in('status', ['upcoming', 'live', 'finished']);

      const sportMap: Record<string, { upcoming: number; live: number; finished: number; lastSync: string | null }> = {};
      for (const row of (sportData ?? [])) {
        if (!sportMap[row.sport]) sportMap[row.sport] = { upcoming: 0, live: 0, finished: 0, lastSync: null };
        sportMap[row.sport][row.status as 'upcoming' | 'live' | 'finished']++;
        if (!sportMap[row.sport].lastSync || row.last_updated > sportMap[row.sport].lastSync!) {
          sportMap[row.sport].lastSync = row.last_updated;
        }
      }

      const { data: predData } = await supabase
        .from('predictions')
        .select('match_id, confidence, risk_level')
        .gte('created_at', week);

      const predByMatch = new Set((predData ?? []).map((r: Record<string, unknown>) => r.match_id as string));
      const avgConfBySport: Record<string, number[]> = {};
      // Note: predictions don't have sport column directly — join would be needed
      // Using global average for now
      const globalAvgConf = predData && predData.length > 0
        ? Math.round((predData as Array<Record<string, unknown>>).reduce((s, r) => s + Number(r.confidence ?? 0), 0) / predData.length)
        : 0;

      results['sports_coverage'] = Object.entries(sportMap).map(([sport, stats]) => {
        const total = stats.upcoming + stats.live;
        const lastSyncDate = stats.lastSync ? new Date(stats.lastSync) : null;
        const hoursSinceSync = lastSyncDate ? Math.round((now.getTime() - lastSyncDate.getTime()) / 3600_000) : 999;
        return {
          sport,
          upcoming: stats.upcoming,
          live: stats.live,
          finished: stats.finished,
          last_sync: stats.lastSync,
          hours_since_sync: hoursSinceSync,
          sync_freshness: hoursSinceSync < 2 ? 'fresh' : hoursSinceSync < 6 ? 'ok' : hoursSinceSync < 24 ? 'stale' : 'very_stale',
          status: total > 0 ? 'has_data' : 'no_data',
        };
      }).sort((a, b) => b.upcoming - a.upcoming);
    }

    // ── Prediction Metrics ──────────────────────────────────────────────────
    if (section === 'all' || section === 'predictions') {
      const { data: predMetrics } = await supabase
        .from('predictions')
        .select('confidence, risk_level, warning_flags, prediction_version, created_at')
        .gte('created_at', yesterday)
        .limit(500);

      const preds = predMetrics ?? [];
      const avgConf = preds.length > 0
        ? Math.round(preds.reduce((s, r) => s + (r.confidence ?? 0), 0) / preds.length) : 0;
      const riskDist: Record<string, number> = { Low: 0, Medium: 0, High: 0 };
      const versionDist: Record<number, number> = {};
      for (const p of preds) {
        if (p.risk_level) riskDist[p.risk_level] = (riskDist[p.risk_level] ?? 0) + 1;
        const v = p.prediction_version ?? 0;
        versionDist[v] = (versionDist[v] ?? 0) + 1;
      }

      // Prediction outcomes for accuracy
      const { data: outcomes } = await supabase
        .from('prediction_outcomes')
        .select('is_correct, sport, created_at')
        .gte('created_at', week);

      const totalOutcomes = (outcomes ?? []).length;
      const correctOutcomes = (outcomes ?? []).filter((r: Record<string, unknown>) => r.is_correct).length;
      const accuracy = totalOutcomes > 0 ? Math.round((correctOutcomes / totalOutcomes) * 100) : null;

      results['prediction_metrics'] = {
        recent_24h: preds.length,
        avg_confidence: avgConf,
        risk_distribution: riskDist,
        version_distribution: versionDist,
        accuracy_7d: accuracy,
        outcomes_tracked_7d: totalOutcomes,
      };
    }

    // ── Odds Coverage ───────────────────────────────────────────────────────
    if (section === 'all' || section === 'odds') {
      const { data: oddsData } = await supabase
        .from('odds')
        .select('match_id, bookmaker')
        .gte('last_updated', yesterday);

      const { data: upcomingMatches } = await supabase
        .from('matches')
        .select('id, sport')
        .eq('status', 'upcoming')
        .gte('match_time', now.toISOString());

      const matchSportMap = new Map<string, string>();
      for (const m of (upcomingMatches ?? [])) matchSportMap.set(m.id, m.sport);

      const oddsMatchIds = new Set((oddsData ?? []).map((r: Record<string, unknown>) => r.match_id as string));
      const bookmakerSet = new Set((oddsData ?? []).map((r: Record<string, unknown>) => r.bookmaker as string));

      const sportOddsCoverage: Record<string, { total: number; withOdds: number }> = {};
      for (const [matchId, sport] of matchSportMap.entries()) {
        if (!sportOddsCoverage[sport]) sportOddsCoverage[sport] = { total: 0, withOdds: 0 };
        sportOddsCoverage[sport].total++;
        if (oddsMatchIds.has(matchId)) sportOddsCoverage[sport].withOdds++;
      }

      results['odds_coverage'] = {
        total_odds_records_24h: (oddsData ?? []).length,
        bookmakers: [...bookmakerSet],
        by_sport: Object.entries(sportOddsCoverage).map(([sport, stats]) => ({
          sport,
          upcoming_matches: stats.total,
          matches_with_odds: stats.withOdds,
          coverage_pct: stats.total > 0 ? Math.round((stats.withOdds / stats.total) * 100) : 0,
        })).sort((a, b) => b.coverage_pct - a.coverage_pct),
      };
    }

    // ── Pipeline Status ─────────────────────────────────────────────────────
    if (section === 'all' || section === 'pipeline') {
      // Check if daily_pipeline_log table exists
      const { data: pipelineData, error: pipelineErr } = await supabase
        .from('daily_pipeline_log')
        .select('*')
        .eq('run_date', todayStr)
        .order('created_at', { ascending: false });

      // Unresolved alerts
      const { data: alertsData } = await supabase
        .from('pipeline_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(20);

      results['pipeline'] = {
        run_date: todayStr,
        stages: pipelineData ?? [],
        unresolved_alerts: alertsData ?? [],
        table_exists: !pipelineErr,
      };
    }

    // ── Next-day readiness ──────────────────────────────────────────────────
    if (section === 'all' || section === 'readiness') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = new Date(tomorrow);
      tomorrowStart.setHours(0, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(23, 59, 59, 999);

      const { data: tomorrowMatches } = await supabase
        .from('matches')
        .select('id, sport, status')
        .gte('match_time', tomorrowStart.toISOString())
        .lte('match_time', tomorrowEnd.toISOString());

      const matchIds = (tomorrowMatches ?? []).map((m: Record<string, unknown>) => m.id as string);

      let predCoverage = 0;
      if (matchIds.length > 0) {
        const { count: predCount } = await supabase
          .from('predictions')
          .select('id', { count: 'exact', head: true })
          .in('match_id', matchIds.slice(0, 1000));
        predCoverage = Math.round(((predCount ?? 0) / matchIds.length) * 100);
      }

      const sportBySport: Record<string, number> = {};
      for (const m of (tomorrowMatches ?? [])) {
        sportBySport[(m as Record<string, unknown>).sport as string] = (sportBySport[(m as Record<string, unknown>).sport as string] ?? 0) + 1;
      }

      const readinessTargets = [
        { metric: 'fixtures_loaded', target: matchIds.length > 0, value: matchIds.length > 0 },
        { metric: 'prediction_coverage_80pct', target: predCoverage >= 80, value: `${predCoverage}%` },
        { metric: 'multi_sport_coverage', target: Object.keys(sportBySport).length >= 5, value: Object.keys(sportBySport).length },
      ];

      results['next_day_readiness'] = {
        target_date: tomorrowStart.toISOString().split('T')[0],
        total_fixtures: matchIds.length,
        prediction_coverage_pct: predCoverage,
        sports_with_fixtures: sportBySport,
        readiness_targets: readinessTargets,
        is_ready: readinessTargets.every(t => t.target),
      };
    }

    // ── Cache Health ────────────────────────────────────────────────────────
    if (section === 'all' || section === 'cache') {
      const { data: cacheData } = await supabase
        .from('match_fetch_cache')
        .select('provider, sport, fetch_date, row_count, hit_count, expires_at, created_at')
        .gte('created_at', yesterday)
        .order('created_at', { ascending: false })
        .limit(100);

      const cacheEntries = cacheData ?? [];
      const totalHits = cacheEntries.reduce((s: number, r: Record<string, unknown>) => s + Number(r.hit_count ?? 0), 0);
      const validEntries = cacheEntries.filter((r: Record<string, unknown>) => new Date(r.expires_at as string) > now).length;
      const expiredEntries = cacheEntries.length - validEntries;

      const byProvider: Record<string, { entries: number; hits: number; rows: number }> = {};
      for (const e of cacheEntries) {
        const p = e.provider as string;
        if (!byProvider[p]) byProvider[p] = { entries: 0, hits: 0, rows: 0 };
        byProvider[p].entries++;
        byProvider[p].hits += Number(e.hit_count ?? 0);
        byProvider[p].rows += Number(e.row_count ?? 0);
      }

      results['cache_health'] = {
        total_entries_24h: cacheEntries.length,
        valid_entries: validEntries,
        expired_entries: expiredEntries,
        total_cache_hits: totalHits,
        cache_hit_rate_pct: cacheEntries.length > 0 ? Math.round((totalHits / (cacheEntries.length * 4)) * 100) : 0,
        ttl_hours: 6,
        by_provider: Object.entries(byProvider).map(([p, s]) => ({ provider: p, ...s })),
      };
    }

    // ── Acceptance test summary ─────────────────────────────────────────────
    if (section === 'all') {
      const apiHealth = (results['api_health'] as Array<Record<string, unknown>> | undefined) ?? [];
      const sportsCoverage = (results['sports_coverage'] as Array<Record<string, unknown>> | undefined) ?? [];
      const predMetrics = results['prediction_metrics'] as Record<string, unknown> | undefined;
      const nextDay = results['next_day_readiness'] as Record<string, unknown> | undefined;

      const healthyApis = apiHealth.filter(a => a.status === 'healthy').length;
      const degradedApis = apiHealth.filter(a => a.status === 'degraded').length;
      const criticalApis = apiHealth.filter(a => a.status === 'critical').length;
      const sportsWithData = sportsCoverage.filter(s => s.status === 'has_data').length;

      results['acceptance_report'] = {
        timestamp: now.toISOString(),
        checks: [
          { name: 'API providers connected', passed: healthyApis >= 2, value: `${healthyApis} healthy, ${degradedApis} degraded, ${criticalApis} critical` },
          { name: 'Sports data populated', passed: sportsWithData >= 5, value: `${sportsWithData} sports with data` },
          { name: 'Recent predictions exist', passed: Number(predMetrics?.recent_24h ?? 0) > 0, value: `${predMetrics?.recent_24h ?? 0} in last 24h` },
          { name: 'Next-day fixtures loaded', passed: (nextDay?.total_fixtures as number ?? 0) > 0, value: `${nextDay?.total_fixtures ?? 0} fixtures` },
          { name: 'Prediction coverage 80%+', passed: (nextDay?.prediction_coverage_pct as number ?? 0) >= 80, value: `${nextDay?.prediction_coverage_pct ?? 0}%` },
          { name: 'Multi-sport coverage (5+)', passed: (nextDay?.sports_with_fixtures as Record<string, unknown> ?? {}) && Object.keys(nextDay?.sports_with_fixtures as Record<string, unknown> ?? {}).length >= 5, value: `${Object.keys(nextDay?.sports_with_fixtures as Record<string, unknown> ?? {}).length} sports` },
          { name: 'Cache layer operational', passed: ((results['cache_health'] as Record<string, unknown> | undefined)?.total_entries_24h as number ?? 0) > 0, value: `${(results['cache_health'] as Record<string, unknown> | undefined)?.total_entries_24h ?? 0} entries` },
        ],
        overall_score: 0, // will be computed below
      };

      const checks = (results['acceptance_report'] as Record<string, unknown>).checks as Array<{ passed: boolean }>;
      const passedCount = checks.filter(c => c.passed).length;
      (results['acceptance_report'] as Record<string, unknown>).overall_score = Math.round((passedCount / checks.length) * 100);
      (results['acceptance_report'] as Record<string, unknown>).deployment_ready = passedCount === checks.length;
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[monitoring-dashboard] error:', err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
