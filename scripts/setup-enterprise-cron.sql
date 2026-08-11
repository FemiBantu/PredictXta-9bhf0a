/**
 * scripts/setup-enterprise-cron.sql
 *
 * pg_cron schedules for the enterprise data pipeline.
 *
 * IMPORTANT: Run this in the Supabase SQL editor.
 * Requires pg_cron extension (available in Supabase Pro).
 *
 * Schedule Summary:
 *
 *   Every 15s  → live-scores-sse (handled by SSE, not cron)
 *   Every 5min → smart-refresh (live matches only, if any active)
 *   Every 15min → smart-refresh (pre-match: next 2h kickoffs)
 *   Every 30min → fetch-matches (today's fixtures refresh)
 *   Every 60min → fetch-odds
 *   Every 60min → sync-standings
 *   Every 60min → quota-monitor (usage tracking)
 *   Every 5min  → materialized view refresh
 *
 *   23:00 → midnight-preload (fixtures for today+3 days)
 *   23:20 → midnight-preload (metadata)
 *   23:30 → midnight-preload (standings)
 *   23:40 → midnight-preload (odds)
 *   23:45 → midnight-preload (stats)
 *   23:50 → midnight-preload (predictions)
 *   23:55 → midnight-preload (reports)
 *   23:58 → midnight-preload (cache warm)
 *
 *   18:00 → daily-scheduler (fixtures)
 *   19:00 → daily-scheduler (odds)
 *   20:00 → daily-scheduler (predictions)
 *   21:00 → daily-scheduler (full safety net)
 *   23:00 → daily-scheduler (settle expert picks)
 */

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── Helper function to invoke edge functions from pg_cron ────────────────────
CREATE OR REPLACE FUNCTION invoke_edge_function(fn_name text, body jsonb DEFAULT '{}'::jsonb)
RETURNS void AS $$
DECLARE
  result text;
BEGIN
  SELECT content INTO result
  FROM http_post(
    'https://osmkbrryalhtpnayosmk.backend.onspace.ai/functions/v1/' || fn_name,
    body::text,
    'application/json',
    ARRAY[
      http_header('Authorization', 'Bearer ' || current_setting('app.service_role_key', true)),
      http_header('Content-Type', 'application/json')
    ]
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_edge_function failed for %: %', fn_name, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── LIVE REFRESH SCHEDULES ───────────────────────────────────────────────────

-- Every 5 minutes: refresh live scores (active during matches)
SELECT cron.schedule(
  'smart-refresh-live',
  '*/5 * * * *',
  $$SELECT invoke_edge_function('smart-refresh', '{"mode":"live"}'::jsonb)$$
);

-- Every 15 minutes: pre-match refresh (kickoffs in next 2h)
SELECT cron.schedule(
  'smart-refresh-prematch',
  '*/15 * * * *',
  $$SELECT invoke_edge_function('smart-refresh', '{"mode":"pre-match"}'::jsonb)$$
);

-- Every 30 minutes: full fixture sync
SELECT cron.schedule(
  'smart-refresh-fixtures',
  '*/30 * * * *',
  $$SELECT invoke_edge_function('smart-refresh', '{"mode":"fixtures"}'::jsonb)$$
);

-- Every 60 minutes: odds refresh
SELECT cron.schedule(
  'smart-refresh-odds',
  '0 * * * *',
  $$SELECT invoke_edge_function('smart-refresh', '{"mode":"odds"}'::jsonb)$$
);

-- Every 60 minutes: standings refresh
SELECT cron.schedule(
  'smart-refresh-standings',
  '30 * * * *',
  $$SELECT invoke_edge_function('smart-refresh', '{"mode":"standings"}'::jsonb)$$
);


-- ─── QUOTA MONITORING ────────────────────────────────────────────────────────

-- Every hour: log quota usage and check alerts
SELECT cron.schedule(
  'quota-monitor-hourly',
  '0 * * * *',
  $$SELECT invoke_edge_function('quota-monitor', '{"action":"report"}'::jsonb)$$
);


-- ─── MATERIALIZED VIEW REFRESH ───────────────────────────────────────────────

-- Every 5 minutes: refresh provider health view
SELECT cron.schedule(
  'refresh-provider-health-view',
  '*/5 * * * *',
  $$SELECT refresh_provider_health_view()$$
);

-- Every 15 minutes: refresh sport coverage view
SELECT cron.schedule(
  'refresh-sport-coverage-view',
  '*/15 * * * *',
  $$SELECT refresh_sport_coverage_view()$$
);


-- ─── MIDNIGHT PRELOAD SCHEDULES ──────────────────────────────────────────────

-- 23:00 UTC — Download fixtures for today + next 3 days
SELECT cron.schedule(
  'midnight-preload-fixtures',
  '0 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"fixtures"}'::jsonb)$$
);

-- 23:20 UTC — Download team/league metadata
SELECT cron.schedule(
  'midnight-preload-metadata',
  '20 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"metadata"}'::jsonb)$$
);

-- 23:30 UTC — Sync standings
SELECT cron.schedule(
  'midnight-preload-standings',
  '30 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"standings"}'::jsonb)$$
);

-- 23:40 UTC — Download odds
SELECT cron.schedule(
  'midnight-preload-odds',
  '40 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"odds"}'::jsonb)$$
);

-- 23:45 UTC — Download statistics
SELECT cron.schedule(
  'midnight-preload-stats',
  '45 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"stats"}'::jsonb)$$
);

-- 23:50 UTC — Generate AI predictions
SELECT cron.schedule(
  'midnight-preload-predictions',
  '50 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"predictions"}'::jsonb)$$
);

-- 23:55 UTC — Generate AI reports
SELECT cron.schedule(
  'midnight-preload-reports',
  '55 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"reports"}'::jsonb)$$
);

-- 23:58 UTC — Warm all caches
SELECT cron.schedule(
  'midnight-preload-warm',
  '58 23 * * *',
  $$SELECT invoke_edge_function('midnight-preload', '{"stage":"warm"}'::jsonb)$$
);


-- ─── DAILY SCHEDULER PIPELINE SCHEDULES ──────────────────────────────────────

-- 18:00 UTC — Fetch today's fixtures
SELECT cron.schedule(
  'daily-scheduler-18h',
  '0 18 * * *',
  $$SELECT invoke_edge_function('daily-scheduler', '{"mode":"fixtures"}'::jsonb)$$
);

-- 19:00 UTC — Fetch odds
SELECT cron.schedule(
  'daily-scheduler-odds-19h',
  '0 19 * * *',
  $$SELECT invoke_edge_function('daily-scheduler', '{"mode":"stage","stage":"fetch_odds"}'::jsonb)$$
);

-- 20:00 UTC — Generate predictions
SELECT cron.schedule(
  'daily-scheduler-20h',
  '0 20 * * *',
  $$SELECT invoke_edge_function('daily-scheduler', '{"mode":"predictions"}'::jsonb)$$
);

-- 21:00 UTC — Full safety-net pipeline
SELECT cron.schedule(
  'daily-scheduler-full-21h',
  '0 21 * * *',
  $$SELECT invoke_edge_function('daily-scheduler', '{"mode":"full"}'::jsonb)$$
);

-- 23:00 UTC — Settle expert picks
SELECT cron.schedule(
  'daily-scheduler-settle-23h',
  '0 23 * * *',
  $$SELECT invoke_edge_function('daily-scheduler', '{"mode":"settle"}'::jsonb)$$
);


-- ─── DATA CLEANUP SCHEDULES ───────────────────────────────────────────────────

-- Every 3 hours: fix stale live matches
SELECT cron.schedule(
  'auto-fix-stale-live',
  '0 */3 * * *',
  $$SELECT auto_fix_stale_live_matches()$$
);

-- Daily at 00:30 UTC: cleanup stale data
SELECT cron.schedule(
  'daily-cleanup-midnight',
  '30 0 * * *',
  $$SELECT cleanup_stale_data_midnight()$$
);

-- Daily at 01:00 UTC: auto-resolve and track predictions
SELECT cron.schedule(
  'daily-resolve-predictions',
  '0 1 * * *',
  $$SELECT auto_resolve_and_track_predictions()$$
);

-- Daily at 01:30 UTC: auto-resolve finished matches
SELECT cron.schedule(
  'daily-resolve-matches',
  '30 1 * * *',
  $$SELECT auto_resolve_finished_matches()$$
);


-- ─── Verify all cron jobs ────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
