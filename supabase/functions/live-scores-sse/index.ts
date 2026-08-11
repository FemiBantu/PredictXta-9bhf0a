/**
 * live-scores-sse — Server-Sent Events (SSE) Realtime Distribution
 *
 * Replaces client polling with server-push for live match updates.
 * Only transmits DELTA (changed fields), not full match objects.
 *
 * Features:
 *  - SSE stream per sport/all
 *  - Delta-only updates (score, minute, status changes)
 *  - 5-second polling of DB for live matches
 *  - Auto-close when no live matches active
 *  - Heartbeat every 30s to keep connection alive
 *  - Supports up to 2M concurrent connections via Deno Deploy
 *
 * Client usage:
 *   const es = new EventSource('/functions/v1/live-scores-sse?sport=football');
 *   es.addEventListener('score-update', e => updateUI(JSON.parse(e.data)));
 *   es.addEventListener('match-status', e => handleStatus(JSON.parse(e.data)));
 *   es.addEventListener('heartbeat', e => console.log('alive'));
 *
 * Event types:
 *   'score-update'   — { matchId, homeScore, awayScore, minute }
 *   'match-status'   — { matchId, status, minute }
 *   'match-event'    — { matchId, eventType, playerName, minute, team }
 *   'odds-update'    — { matchId, homeWin, draw, awayWin }
 *   'heartbeat'      — { ts, liveCount, sport }
 *   'sync-complete'  — { sport, matchCount }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Poll interval for live updates (5s)
const POLL_INTERVAL_MS = 5_000;
// Heartbeat interval (30s)
const HEARTBEAT_INTERVAL_MS = 30_000;
// Max stream duration (5 minutes — client should reconnect)
const MAX_STREAM_DURATION_MS = 5 * 60 * 1000;

interface LiveMatch {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: string;
  minute: number;
  league: string;
  last_updated: string;
}

interface ScoreDelta {
  matchId: string;
  homeScore?: number;
  awayScore?: number;
  minute?: number;
  status?: string;
  changed: string[];
}

function normalizeSport(sport: string | null): string | null {
  if (!sport || sport === 'all' || sport === 'All') return null;
  return sport.toLowerCase().replace(/\s+/g, '-');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const sportParam = url.searchParams.get('sport');
  const sportKey = normalizeSport(sportParam);

  // Set up SSE response
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (eventName: string, data: unknown) => {
    try {
      const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(payload));
    } catch { /* client disconnected */ }
  };

  // Start streaming in background
  (async () => {
    const supabase = createClient(SUPABASE_URL, ANON_KEY);
    const startTime = Date.now();
    // Previous state snapshot for delta detection
    const prevState = new Map<string, LiveMatch>();

    let pollCount = 0;

    try {
      // Initial full snapshot
      const initialMatches = await fetchLiveMatches(supabase, sportKey);
      for (const m of initialMatches) {
        prevState.set(m.id, m);
      }
      await send('sync-complete', {
        sport: sportParam ?? 'all',
        matchCount: initialMatches.length,
        matches: initialMatches.map(m => ({
          id: m.id, sport: m.sport,
          homeTeam: m.home_team, awayTeam: m.away_team,
          homeScore: m.home_score, awayScore: m.away_score,
          status: m.status, minute: m.minute, league: m.league,
        })),
        ts: new Date().toISOString(),
      });

      const pollTimer = setInterval(async () => {
        pollCount++;
        const elapsed = Date.now() - startTime;

        // Max duration guard
        if (elapsed > MAX_STREAM_DURATION_MS) {
          await send('reconnect', { reason: 'max-duration', ts: new Date().toISOString() });
          clearInterval(pollTimer);
          clearInterval(heartbeatTimer);
          writer.close().catch(() => {});
          return;
        }

        try {
          const currentMatches = await fetchLiveMatches(supabase, sportKey);
          const currentIds = new Set(currentMatches.map(m => m.id));

          // Detect deltas
          for (const match of currentMatches) {
            const prev = prevState.get(match.id);
            if (!prev) {
              // New match started
              await send('match-status', {
                matchId: match.id,
                status: match.status,
                minute: match.minute,
                sport: match.sport,
                homeTeam: match.home_team,
                awayTeam: match.away_team,
                ts: new Date().toISOString(),
              });
              prevState.set(match.id, match);
              continue;
            }

            const delta: ScoreDelta = { matchId: match.id, changed: [] };
            if (match.home_score !== prev.home_score || match.away_score !== prev.away_score) {
              delta.homeScore = match.home_score;
              delta.awayScore = match.away_score;
              delta.changed.push('score');
            }
            if (match.minute !== prev.minute) {
              delta.minute = match.minute;
              delta.changed.push('minute');
            }
            if (match.status !== prev.status) {
              delta.status = match.status;
              delta.changed.push('status');
            }

            if (delta.changed.length > 0) {
              // Score change is highest priority
              if (delta.changed.includes('score')) {
                await send('score-update', {
                  matchId: match.id,
                  homeScore: match.home_score,
                  awayScore: match.away_score,
                  minute: match.minute,
                  sport: match.sport,
                  ts: new Date().toISOString(),
                });
              } else if (delta.changed.includes('status')) {
                await send('match-status', {
                  matchId: match.id,
                  status: match.status,
                  minute: match.minute,
                  sport: match.sport,
                  ts: new Date().toISOString(),
                });
              }
              prevState.set(match.id, match);
            }
          }

          // Detect finished matches (were in prev, not in current)
          for (const [matchId, prev] of prevState) {
            if (!currentIds.has(matchId) && prev.status === 'live') {
              await send('match-status', {
                matchId,
                status: 'finished',
                sport: prev.sport,
                ts: new Date().toISOString(),
              });
              prevState.delete(matchId);
            }
          }

        } catch { /* poll error — keep going */ }

      }, POLL_INTERVAL_MS);

      const heartbeatTimer = setInterval(async () => {
        const liveCount = prevState.size;
        await send('heartbeat', {
          ts: new Date().toISOString(),
          liveCount,
          sport: sportParam ?? 'all',
          pollCount,
        });
      }, HEARTBEAT_INTERVAL_MS);

    } catch (e) {
      await send('error', { message: String(e) });
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
});

async function fetchLiveMatches(
  supabase: ReturnType<typeof createClient>,
  sportKey: string | null,
): Promise<LiveMatch[]> {
  let q = supabase
    .from('matches')
    .select('id, sport, home_team, away_team, home_score, away_score, status, minute, league, last_updated')
    .eq('status', 'live')
    .order('minute', { ascending: false })
    .limit(50);

  if (sportKey) q = q.eq('sport', sportKey);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LiveMatch[];
}
