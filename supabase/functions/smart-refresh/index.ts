/**
 * smart-refresh — Dynamic Refresh Engine
 *
 * Implements intelligent refresh intervals based on match state and quota.
 *
 * Static Data (sports, countries, leagues, teams, venues): 24h
 * Fixtures: 30-60 min
 * Standings: 30-60 min
 * Odds pre-match: 30-60 sec (served from cache, not live API)
 * Odds live: 5-15 sec (served from cache)
 *
 * Live Match Refresh:
 *   24h before kickoff → poll every 60 min
 *   2h before kickoff  → poll every 15 min
 *   30min before KO    → poll every 5 min
 *   Live               → poll every 5-15 sec
 *   Halftime           → poll every 30 sec
 *   Finished           → stop
 *
 * This function coordinates all refresh workers and respects quota limits.
 * Called by pg_cron on multiple schedules.
 *
 * Body: { mode: 'live' | 'pre-match' | 'standings' | 'fixtures' | 'odds' | 'check' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface RefreshDecision {
  sport: string;
  matchId?: string;
  currentStatus: string;
  minutesToKickoff?: number;
  refreshIntervalSec: number;
  priority: 'critical' | 'high' | 'normal' | 'low' | 'skip';
  reason: string;
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function invoke(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, data: null, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
    return { ok: true, data: await res.json().catch(() => ({})) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, data: null, error: String(e) };
  }
}

// ─── Determine refresh priority for a match ──────────────────────────────────
function getRefreshDecision(match: Record<string, unknown>): RefreshDecision {
  const status = String(match.status ?? 'upcoming');
  const matchTime = match.match_time ? new Date(match.match_time as string) : null;
  const now = new Date();
  const minutesToKickoff = matchTime
    ? Math.floor((matchTime.getTime() - now.getTime()) / 60_000)
    : null;
  const sport = String(match.sport ?? 'football');

  if (status === 'finished') {
    return { sport, matchId: String(match.id), currentStatus: status, priority: 'skip', refreshIntervalSec: 0, reason: 'Finished match — no refresh needed' };
  }

  if (status === 'live') {
    const minute = Number(match.minute ?? 0);
    // Halftime detection (minute between 45-50 typically)
    if (minute >= 45 && minute <= 50 && sport === 'football') {
      return { sport, matchId: String(match.id), currentStatus: status, minutesToKickoff: 0, priority: 'high', refreshIntervalSec: 30, reason: 'Live — halftime break' };
    }
    return { sport, matchId: String(match.id), currentStatus: status, minutesToKickoff: 0, priority: 'critical', refreshIntervalSec: 10, reason: 'Live match — 10s refresh' };
  }

  if (minutesToKickoff !== null) {
    if (minutesToKickoff <= 30) {
      return { sport, matchId: String(match.id), currentStatus: status, minutesToKickoff, priority: 'critical', refreshIntervalSec: 300, reason: 'Pre-match <30min — 5min refresh' };
    }
    if (minutesToKickoff <= 120) {
      return { sport, matchId: String(match.id), currentStatus: status, minutesToKickoff, priority: 'high', refreshIntervalSec: 900, reason: 'Pre-match <2h — 15min refresh' };
    }
    if (minutesToKickoff <= 1440) {
      return { sport, matchId: String(match.id), currentStatus: status, minutesToKickoff, priority: 'normal', refreshIntervalSec: 3600, reason: 'Pre-match <24h — 60min refresh' };
    }
  }

  return { sport, currentStatus: status, minutesToKickoff: minutesToKickoff ?? undefined, priority: 'low', refreshIntervalSec: 3600, reason: 'Upcoming >24h — low priority' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = adminClient();
  const start = Date.now();

  try {
    let mode = 'live';
    try {
      const body = await req.json();
      mode = body?.mode ?? 'live';
    } catch { /* defaults */ }

    console.log(`[smart-refresh] mode=${mode}`);

    // ── Check mode: return refresh decisions without executing ────────────────
    if (mode === 'check') {
      const { data: matches } = await supabase
        .from('matches')
        .select('id, sport, status, match_time, minute')
        .in('status', ['live', 'upcoming'])
        .gte('match_time', new Date(Date.now() - 3600_000).toISOString())
        .lte('match_time', new Date(Date.now() + 2 * 24 * 3600_000).toISOString())
        .limit(200);

      const decisions = (matches ?? []).map(getRefreshDecision);
      const critical = decisions.filter(d => d.priority === 'critical').length;
      const high = decisions.filter(d => d.priority === 'high').length;

      return new Response(JSON.stringify({
        mode: 'check',
        totalMatches: decisions.length,
        critical, high,
        decisions: decisions.slice(0, 20),
        generatedAt: new Date().toISOString(),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Live mode: refresh all currently live matches ─────────────────────────
    if (mode === 'live') {
      const { data: liveMatches } = await supabase
        .from('matches')
        .select('id, sport, status, match_time, minute, external_id')
        .eq('status', 'live')
        .limit(50);

      const liveCount = liveMatches?.length ?? 0;
      console.log(`[smart-refresh] Live matches: ${liveCount}`);

      if (liveCount === 0) {
        return new Response(JSON.stringify({
          mode: 'live', refreshed: 0, message: 'No live matches — skipping',
          durationMs: Date.now() - start,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Group by sport for efficient batch fetching
      const sportGroups = new Map<string, number>();
      for (const m of (liveMatches ?? [])) {
        const sport = String(m.sport);
        sportGroups.set(sport, (sportGroups.get(sport) ?? 0) + 1);
      }

      const results = await Promise.allSettled(
        [...sportGroups.keys()].map(sport =>
          invoke('fetch-matches', { mode: 'live', sport }, 25_000)
        ),
      );

      const fetched = results
        .filter(r => r.status === 'fulfilled' && r.value.ok)
        .reduce((sum, r) => sum + Number((r as PromiseFulfilledResult<{ ok: boolean; data: unknown }>).value.data && ((r as PromiseFulfilledResult<{ ok: boolean; data: Record<string, unknown> }>).value.data as Record<string, unknown>)?.fetched ?? 0), 0);

      return new Response(JSON.stringify({
        mode: 'live',
        liveMatches: liveCount,
        sportsRefreshed: sportGroups.size,
        rowsFetched: fetched,
        durationMs: Date.now() - start,
        sportBreakdown: Object.fromEntries(sportGroups),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Pre-match mode: refresh matches starting in next 2 hours ─────────────
    if (mode === 'pre-match') {
      const { data: preMatches } = await supabase
        .from('matches')
        .select('id, sport, status, match_time')
        .eq('status', 'upcoming')
        .gte('match_time', new Date().toISOString())
        .lte('match_time', new Date(Date.now() + 2 * 3600_000).toISOString())
        .limit(50);

      const count = preMatches?.length ?? 0;
      if (count > 0) {
        await invoke('fetch-matches', { mode: 'today', sport: 'all' });
      }

      return new Response(JSON.stringify({
        mode: 'pre-match', matchesInNext2h: count, durationMs: Date.now() - start,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Standings mode ────────────────────────────────────────────────────────
    if (mode === 'standings') {
      const result = await invoke('sync-standings', { sport: 'football', leagues: [39, 140, 78, 135, 61] });
      return new Response(JSON.stringify({
        mode: 'standings', ok: result.ok, durationMs: Date.now() - start,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Fixtures mode: refresh today's fixtures ───────────────────────────────
    if (mode === 'fixtures') {
      const result = await invoke('fetch-matches', { mode: 'today', sport: 'all' });
      return new Response(JSON.stringify({
        mode: 'fixtures', ok: result.ok,
        fetched: (result.data as Record<string, unknown>)?.fetched ?? 0,
        durationMs: Date.now() - start,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Odds mode ─────────────────────────────────────────────────────────────
    if (mode === 'odds') {
      const result = await invoke('fetch-odds', { mode: 'today' });
      return new Response(JSON.stringify({
        mode: 'odds', ok: result.ok, durationMs: Date.now() - start,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[smart-refresh] Error:', err);
    return new Response(JSON.stringify({ error: String(err), durationMs: Date.now() - start }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
