/**
 * live-stream — Server-Sent Events (SSE) endpoint for live sports data
 *
 * Provides real-time streaming of:
 *   - Live match scores + minute
 *   - Live odds fluctuations
 *   - Match events (goals, cards, substitutions)
 *
 * Protocol: Server-Sent Events (SSE)
 *   - Mobile clients use fetch() with ReadableStream
 *   - Browser clients use EventSource API
 *   - Each event: `data: <JSON>\n\n`
 *
 * Event types:
 *   - `live_scores`   — array of live match scores
 *   - `odds_update`   — odds for a specific match
 *   - `match_event`   — goal/card/sub for a live match
 *   - `heartbeat`     — keep-alive ping every 15s
 *   - `error`         — error notification
 *
 * Query params:
 *   - sport: filter by sport (default: all)
 *   - match_id: subscribe to specific match
 *   - include_odds: include odds in live_scores events (default: false)
 *
 * Connection lifecycle:
 *   - Initial burst: current live matches within 500ms of connect
 *   - Poll interval: 15s (fast enough for goal detection)
 *   - Max connection time: 5 minutes (client must reconnect)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const POLL_INTERVAL_MS = 15_000;    // 15s between DB polls
const HEARTBEAT_INTERVAL_MS = 15_000; // 15s heartbeat
const MAX_DURATION_MS = 5 * 60_000; // 5 minute max connection

interface LiveMatchRow {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: string;
  minute: number;
  league: string;
  home_logo: string | null;
  away_logo: string | null;
  external_id: string | null;
  last_updated: string;
}

interface OddsRow {
  match_id: string;
  bookmaker: string;
  home_win: number | null;
  draw: number | null;
  away_win: number | null;
  over_2_5: number | null;
  under_2_5: number | null;
  btts_yes: number | null;
  btts_no: number | null;
  last_updated: string;
}

interface EventRow {
  id: string;
  match_id: string;
  event_type: string;
  player_name: string;
  team: string;
  is_home_team: boolean;
  minute: number;
  extra_minute: number | null;
  detail: string | null;
  created_at: string;
}

function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function formatHeartbeat(): string {
  return `event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`;
}

// Build a snapshot signature to detect changes
function buildScoreSignature(matches: LiveMatchRow[]): string {
  return matches.map((m) => `${m.id}:${m.home_score}:${m.away_score}:${m.minute}:${m.status}`).join('|');
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const sport = url.searchParams.get('sport') ?? null;
  const matchId = url.searchParams.get('match_id') ?? null;
  const includeOdds = url.searchParams.get('include_odds') === 'true';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── SSE Stream setup ──────────────────────────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = async (chunk: string) => {
    try { await writer.write(encoder.encode(chunk)); } catch { /* client disconnected */ }
  };

  const startTime = Date.now();
  let prevScoreSignature = '';
  let lastEventIds = new Set<string>();

  // ── Fetch helpers ────────────────────────────────────────────────────────
  async function fetchLiveMatches(): Promise<LiveMatchRow[]> {
    let q = supabase
      .from('matches')
      .select('id, sport, home_team, away_team, home_score, away_score, status, minute, league, home_logo, away_logo, external_id, last_updated')
      .eq('status', 'live')
      .order('minute', { ascending: false })
      .limit(50);

    if (sport) q = q.eq('sport', sport);
    if (matchId) q = q.eq('id', matchId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as LiveMatchRow[];
  }

  async function fetchOddsForMatches(matchIds: string[]): Promise<OddsRow[]> {
    if (matchIds.length === 0) return [];
    const { data } = await supabase
      .from('odds')
      .select('match_id, bookmaker, home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, last_updated')
      .in('match_id', matchIds.slice(0, 10))
      .order('last_updated', { ascending: false });
    return (data ?? []) as OddsRow[];
  }

  async function fetchRecentEvents(matchIds: string[], since: string): Promise<EventRow[]> {
    if (matchIds.length === 0) return [];
    const { data } = await supabase
      .from('match_events')
      .select('id, match_id, event_type, player_name, team, is_home_team, minute, extra_minute, detail, created_at')
      .in('match_id', matchIds.slice(0, 10))
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    return (data ?? []) as EventRow[];
  }

  // ── Main stream loop ──────────────────────────────────────────────────────
  (async () => {
    try {
      // Initial data burst on connect
      const initialMatches = await fetchLiveMatches();
      const initialPayload: any = { matches: initialMatches, ts: Date.now() };

      if (includeOdds && initialMatches.length > 0) {
        const odds = await fetchOddsForMatches(initialMatches.map((m) => m.id));
        initialPayload.odds = odds;
      }

      await write(formatSSE('live_scores', initialPayload));
      prevScoreSignature = buildScoreSignature(initialMatches);
      lastEventIds = new Set(
        (await fetchRecentEvents(initialMatches.map((m) => m.id), new Date(Date.now() - 60_000).toISOString()))
          .map((e) => e.id),
      );

      let lastPollTime = Date.now();
      let lastHeartbeat = Date.now();
      const sinceTime = new Date(Date.now() - 60_000).toISOString();

      while (Date.now() - startTime < MAX_DURATION_MS) {
        await new Promise((r) => setTimeout(r, 1000)); // 1s tick

        const now = Date.now();

        // ── Heartbeat every 15s ───────────────────────────────────────────
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          await write(formatHeartbeat());
          lastHeartbeat = now;
        }

        // ── Poll DB every 15s ─────────────────────────────────────────────
        if (now - lastPollTime >= POLL_INTERVAL_MS) {
          lastPollTime = now;

          const matches = await fetchLiveMatches();
          const newSignature = buildScoreSignature(matches);

          // Only emit live_scores if scores/minutes changed
          if (newSignature !== prevScoreSignature) {
            const payload: any = { matches, ts: Date.now(), changed: true };
            if (includeOdds && matches.length > 0) {
              payload.odds = await fetchOddsForMatches(matches.map((m) => m.id));
            }
            await write(formatSSE('live_scores', payload));
            prevScoreSignature = newSignature;
          }

          // Check for new events (goals, cards)
          if (matches.length > 0) {
            const recentEvents = await fetchRecentEvents(
              matches.map((m) => m.id),
              new Date(now - POLL_INTERVAL_MS - 5000).toISOString(),
            );

            for (const evt of recentEvents) {
              if (!lastEventIds.has(evt.id)) {
                lastEventIds.add(evt.id);
                const matchInfo = matches.find((m) => m.id === evt.match_id);
                await write(formatSSE('match_event', {
                  ...evt,
                  home_team: matchInfo?.home_team ?? null,
                  away_team: matchInfo?.away_team ?? null,
                  ts: Date.now(),
                }));
              }
            }
          }

          // Emit connection metadata every 60s
          if ((now - startTime) % 60_000 < POLL_INTERVAL_MS) {
            await write(formatSSE('connection_meta', {
              connected_since: startTime,
              uptime_ms: now - startTime,
              live_match_count: matches.length,
              max_duration_ms: MAX_DURATION_MS,
              remaining_ms: MAX_DURATION_MS - (now - startTime),
            }));
          }
        }
      }

      // Max duration reached — tell client to reconnect
      await write(formatSSE('reconnect', {
        reason: 'max_duration_reached',
        reconnect_after_ms: 1000,
      }));
      await writer.close();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await write(formatSSE('error', { message: errMsg, ts: Date.now() })).catch(() => {});
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
