-- =============================================================================
-- PredictXta — Cron Monitoring Views & Dashboard Queries  v2.0
-- Supabase 2026 / pg_cron 1.6+ / PostgreSQL 15-17 Compatible
-- =============================================================================
--
-- WHAT'S NEW IN v2.0 (over v1.0):
--   ✓ v_pipeline_alerts       — recent unresolved alerts (24 h)
--   ✓ v_stuck_jobs            — in-flight invocations > 10 min
--   ✓ v_retry_status          — pending/completed retry queue summary
--   ✓ v_cron_system_health    — one-row executive summary (alert + health + retries)
--   ✓ v_execution_log_detail  — raw invocation log with full error messages
--   ✓ v_cron_daily_trend      — 14-day per-job success rate trend
--   ✓ Enhanced v_cron_dashboard — p50/p95 latency, next_run_approx
--   ✓ Optimized v_pipeline_job_performance with FILTER (WHERE end_time IS NOT NULL)
--   ✓ All views use ONLY cron.job + cron.job_run_details (no deprecated columns)
--
-- DEPRECATED COLUMNS NEVER REFERENCED IN THIS FILE:
--   ✗ cron.job.runcount         (pg_cron 1.6+ removed)
--   ✗ cron.job.last_run_status  (pg_cron 1.6+ removed)
--   ✗ cron.job.last_run_time    (pg_cron 1.6+ removed)
--   → Modern replacement: cron.job_run_details (start_time, end_time, status, return_message)
--
-- PREREQUISITES:
--   setup-cron-schedules.sql v4.0 must be run first (creates all tables + base views).
--   This file replaces/upgrades those views with enhanced versions.
--
-- USAGE:
--   Paste into Supabase SQL Editor → Run.
--   Views are then queryable from the admin dashboard or SQL Editor.
-- =============================================================================

-- =============================================================================
-- VIEW 1: v_cron_dashboard
-- Per-job status, timing, 7-day aggregates, colour-coded health status.
-- Primary view for the admin monitoring panel.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_dashboard AS
WITH last_run AS (
  -- One row per job: the most recent execution record
  SELECT DISTINCT ON (d.jobid)
    d.jobid,
    d.start_time,
    d.end_time,
    d.status                                                                  AS run_status,
    d.return_message,
    EXTRACT(EPOCH FROM (d.end_time - d.start_time))::int                      AS duration_sec
  FROM cron.job_run_details d
  ORDER BY d.jobid, d.start_time DESC
),
week_stats AS (
  -- Per-job 7-day aggregates (excludes still-running rows for latency calcs)
  SELECT
    d.jobid,
    COUNT(*)                                                                   AS total_runs,
    COUNT(*) FILTER (WHERE d.status = 'succeeded')                             AS successes,
    COUNT(*) FILTER (WHERE d.status = 'failed')                                AS failures,
    COUNT(*) FILTER (WHERE d.status = 'running')                               AS currently_running,
    ROUND(AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
      FILTER (WHERE d.end_time IS NOT NULL), 1)                                AS avg_sec,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
      FILTER (WHERE d.end_time IS NOT NULL), 1)                                AS p50_sec,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
      FILTER (WHERE d.end_time IS NOT NULL), 1)                                AS p95_sec,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.status = 'succeeded')
      / NULLIF(COUNT(*), 0), 1)                                                AS success_rate_pct
  FROM cron.job_run_details d
  WHERE d.start_time >= NOW() - INTERVAL '7 days'
  GROUP BY d.jobid
)
SELECT
  j.jobid,
  j.jobname                                                                    AS job_name,
  j.schedule,
  j.active,

  -- ── Latest execution ─────────────────────────────────────────────────────
  lr.start_time                                                                AS last_run_start,
  lr.end_time                                                                  AS last_run_end,
  lr.duration_sec                                                              AS last_run_sec,
  lr.run_status                                                                AS last_status,
  CASE WHEN lr.run_status = 'failed' THEN lr.return_message ELSE NULL END      AS last_error,

  -- ── 7-day metrics ────────────────────────────────────────────────────────
  COALESCE(ws.total_runs,       0)                                             AS runs_7d,
  COALESCE(ws.successes,        0)                                             AS successes_7d,
  COALESCE(ws.failures,         0)                                             AS failures_7d,
  COALESCE(ws.success_rate_pct, 0)                                             AS success_rate_pct,
  COALESCE(ws.avg_sec,          0)                                             AS avg_sec,
  COALESCE(ws.p50_sec,          0)                                             AS p50_sec,
  COALESCE(ws.p95_sec,          0)                                             AS p95_sec,

  -- ── Colour-coded health ───────────────────────────────────────────────────
  -- HEALTHY   : active, last run succeeded, ≥ 80% 7-day success rate
  -- WARNING   : active, last succeeded, 50–80% success rate OR ≥ 3 failures
  -- FAILED    : active, last run failed OR < 50% success rate
  -- NEVER_RUN : active, no history yet
  -- DISABLED  : job is inactive
  -- STALLED   : currently_running > 0 AND last_run_start > 15 min ago
  CASE
    WHEN NOT j.active                                          THEN 'DISABLED'
    WHEN lr.start_time IS NULL                                 THEN 'NEVER_RUN'
    WHEN COALESCE(ws.currently_running, 0) > 0
      AND lr.start_time < NOW() - INTERVAL '15 minutes'       THEN 'STALLED'
    WHEN lr.run_status = 'failed'                              THEN 'FAILED'
    WHEN COALESCE(ws.success_rate_pct, 100) < 50              THEN 'FAILED'
    WHEN COALESCE(ws.failures, 0) >= 3
      AND COALESCE(ws.success_rate_pct, 100) < 80             THEN 'WARNING'
    WHEN COALESCE(ws.success_rate_pct, 100) < 80              THEN 'WARNING'
    WHEN lr.run_status = 'succeeded'                           THEN 'HEALTHY'
    ELSE 'UNKNOWN'
  END                                                                          AS health_status,

  -- ── Approximate next scheduled run ───────────────────────────────────────
  -- pg_cron does not expose next_run natively; derived from schedule pattern.
  CASE j.schedule
    WHEN '*/5 * * * *'  THEN DATE_TRUNC('minute', NOW()) + INTERVAL '5 minutes'
    WHEN '*/15 * * * *' THEN DATE_TRUNC('minute', NOW()) + INTERVAL '15 minutes'
    WHEN '0 */2 * * *'  THEN DATE_TRUNC('hour',   NOW() + INTERVAL '2 hours')
    WHEN '0 */4 * * *'  THEN DATE_TRUNC('hour',   NOW() + INTERVAL '4 hours')
    WHEN '0 * * * *'    THEN DATE_TRUNC('hour',   NOW() + INTERVAL '1 hour')
    ELSE NULL
  END                                                                          AS next_run_approx

FROM cron.job j
LEFT JOIN last_run   lr ON lr.jobid = j.jobid
LEFT JOIN week_stats ws ON ws.jobid = j.jobid
WHERE j.jobname LIKE 'predictxta-%'
ORDER BY j.jobname;

COMMENT ON VIEW public.v_cron_dashboard IS
  'Main admin monitoring view. Uses cron.job + cron.job_run_details ONLY. '
  'pg_cron 1.6+ safe — zero deprecated columns. '
  'Health states: HEALTHY | WARNING | FAILED | NEVER_RUN | DISABLED | STALLED | UNKNOWN';

-- =============================================================================
-- VIEW 2: v_cron_health_score
-- Executive single-row pipeline health score (0-100) + per-state counts.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_health_score AS
WITH scores AS (
  SELECT
    health_status,
    CASE health_status
      WHEN 'HEALTHY'   THEN 100
      WHEN 'WARNING'   THEN  60
      WHEN 'STALLED'   THEN  20
      WHEN 'FAILED'    THEN   0
      WHEN 'NEVER_RUN' THEN  30
      WHEN 'DISABLED'  THEN  50
      ELSE                   20
    END AS score
  FROM public.v_cron_dashboard
)
SELECT
  COUNT(*)                                                      AS total_jobs,
  COUNT(*) FILTER (WHERE health_status = 'HEALTHY')             AS healthy,
  COUNT(*) FILTER (WHERE health_status = 'WARNING')             AS warning,
  COUNT(*) FILTER (WHERE health_status = 'FAILED')              AS failed,
  COUNT(*) FILTER (WHERE health_status = 'STALLED')             AS stalled,
  COUNT(*) FILTER (WHERE health_status = 'NEVER_RUN')           AS never_run,
  COUNT(*) FILTER (WHERE health_status = 'DISABLED')            AS disabled,
  ROUND(AVG(score), 0)::int                                     AS health_score,
  CASE
    WHEN ROUND(AVG(score), 0) >= 85 THEN 'HEALTHY'
    WHEN ROUND(AVG(score), 0) >= 60 THEN 'WARNING'
    ELSE                                  'CRITICAL'
  END                                                           AS pipeline_status,
  NOW()                                                         AS evaluated_at
FROM scores;

COMMENT ON VIEW public.v_cron_health_score IS
  'Executive summary: 0-100 pipeline health score. '
  '>= 85 → HEALTHY | 60-84 → WARNING | < 60 → CRITICAL';

-- =============================================================================
-- VIEW 3: v_cron_run_history
-- All run records for the past 7 days, newest first, with status icons.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_run_history AS
SELECT
  j.jobname                                                                    AS job_name,
  d.start_time,
  d.end_time,
  EXTRACT(EPOCH FROM (d.end_time - d.start_time))::int                         AS duration_sec,
  d.status,
  CASE d.status
    WHEN 'succeeded' THEN 'PASS'
    WHEN 'failed'    THEN 'FAIL'
    WHEN 'running'   THEN 'RUNNING'
    ELSE                  'UNKNOWN'
  END                                                                          AS status_label,
  CASE WHEN d.status = 'failed' THEN d.return_message ELSE NULL END            AS error_message
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname  LIKE 'predictxta-%'
  AND d.start_time >= NOW() - INTERVAL '7 days'
ORDER BY d.start_time DESC;

COMMENT ON VIEW public.v_cron_run_history IS
  'All pg_cron run records for PredictXta jobs (7-day window), newest first. '
  'pg_cron retains job_run_details for the configured retention (default 7 days).';

-- =============================================================================
-- VIEW 4: v_cron_failure_summary
-- Jobs with failures in the last 7 days, ranked by failure count.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_failure_summary AS
SELECT
  j.jobname                                                                    AS job_name,
  COUNT(*)                                                                     AS failure_count,
  MIN(d.start_time)                                                            AS first_failure_at,
  MAX(d.start_time)                                                            AS last_failure_at,
  (
    SELECT d2.return_message FROM cron.job_run_details d2
    WHERE d2.jobid = j.jobid AND d2.status = 'failed'
    ORDER BY d2.start_time DESC LIMIT 1
  )                                                                            AS latest_error
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname  LIKE 'predictxta-%'
  AND d.status     = 'failed'
  AND d.start_time >= NOW() - INTERVAL '7 days'
GROUP BY j.jobname, j.jobid
ORDER BY failure_count DESC;

COMMENT ON VIEW public.v_cron_failure_summary IS
  'Jobs with failures (last 7 days), ranked by failure_count. '
  'latest_error contains the most recent return_message for root cause triage.';

-- =============================================================================
-- VIEW 5: v_pipeline_job_performance
-- Latency distribution: min, avg, p50, p95, max per job (7-day window).
-- Sort by avg_sec DESC to identify bottlenecks.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_pipeline_job_performance AS
SELECT
  j.jobname                                                                    AS job_name,
  j.schedule,
  COUNT(d.runid) FILTER (WHERE d.end_time IS NOT NULL)                         AS sample_count,
  ROUND(MIN(EXTRACT(EPOCH FROM (d.end_time - d.start_time))), 1)               AS min_sec,
  ROUND(AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
    FILTER (WHERE d.end_time IS NOT NULL), 1)                                  AS avg_sec,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
    FILTER (WHERE d.end_time IS NOT NULL), 1)                                  AS p50_sec,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
    FILTER (WHERE d.end_time IS NOT NULL), 1)                                  AS p95_sec,
  ROUND(MAX(EXTRACT(EPOCH FROM (d.end_time - d.start_time))), 1)               AS max_sec,
  ROUND(100.0 * COUNT(*) FILTER (WHERE d.status = 'succeeded')
    / NULLIF(COUNT(*), 0), 1)                                                  AS success_pct
FROM cron.job j
LEFT JOIN cron.job_run_details d
       ON d.jobid     = j.jobid
      AND d.start_time >= NOW() - INTERVAL '7 days'
WHERE j.jobname LIKE 'predictxta-%'
GROUP BY j.jobname, j.schedule, j.jobid
ORDER BY avg_sec DESC NULLS LAST;

COMMENT ON VIEW public.v_pipeline_job_performance IS
  'Latency distribution per job (7 days). avg/p50/p95 use completed runs only. '
  'Sort avg_sec DESC to identify slow jobs for optimization.';

-- =============================================================================
-- VIEW 6: v_execution_log_summary
-- Summary of HTTP invocations via invoke_edge_function() (7-day window).
-- Groups by job_name + function_name for quick status overview.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_execution_log_summary AS
SELECT
  job_name,
  function_name,
  COUNT(*)                                                                     AS total_invocations,
  COUNT(*) FILTER (WHERE status = 'invoked')                                   AS in_flight,
  COUNT(*) FILTER (WHERE status = 'skipped')                                   AS skipped,
  COUNT(*) FILTER (WHERE status = 'succeeded')                                 AS succeeded,
  COUNT(*) FILTER (WHERE status = 'failed')                                    AS failed,
  COUNT(*) FILTER (WHERE status = 'error')                                     AS errored,
  MAX(retry_count)                                                             AS max_retries_seen,
  SUM(retry_count)                                                             AS total_retries,
  MAX(started_at)                                                              AS last_invoked_at,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'succeeded')
      / NULLIF(COUNT(*) FILTER (WHERE status IN ('succeeded','failed','error')), 0),
  1)                                                                           AS success_rate_pct
FROM public.cron_execution_log
WHERE started_at >= NOW() - INTERVAL '7 days'
GROUP BY job_name, function_name
ORDER BY last_invoked_at DESC NULLS LAST;

COMMENT ON VIEW public.v_execution_log_summary IS
  'HTTP invocation summary from cron_execution_log (7-day window). '
  'in_flight = pg_net calls made but response not yet confirmed. '
  'skipped = overlap-prevention skip (previous call still in-flight).';

-- =============================================================================
-- VIEW 7: v_execution_log_detail
-- Raw invocation log with full error messages (last 24 h).
-- =============================================================================
CREATE OR REPLACE VIEW public.v_execution_log_detail AS
SELECT
  id,
  job_name,
  function_name,
  started_at,
  completed_at,
  EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))::int        AS running_sec,
  status,
  http_status,
  error_message,
  retry_count,
  correlation_id,
  request_body
FROM public.cron_execution_log
WHERE started_at >= NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;

COMMENT ON VIEW public.v_execution_log_detail IS
  'Full invocation log for the last 24 hours. '
  'Use correlation_id to match against Supabase Edge Function logs.';

-- =============================================================================
-- VIEW 8: v_pipeline_alerts
-- Unresolved pipeline alerts from the last 24 hours, ordered by severity.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_pipeline_alerts AS
SELECT
  id,
  alert_type,
  severity,
  message,
  details,
  resolved,
  resolved_at,
  created_at,
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'warning'  THEN 2
    ELSE                 3
  END                                                                          AS severity_rank
FROM public.pipeline_alerts
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY severity_rank, created_at DESC;

COMMENT ON VIEW public.v_pipeline_alerts IS
  'Pipeline alerts (last 24 h), ordered critical → warning → info. '
  'Resolve manually: UPDATE pipeline_alerts SET resolved=true, resolved_at=NOW() WHERE id=...';

-- =============================================================================
-- VIEW 9: v_stuck_jobs
-- Invocations that are still in "invoked" status beyond the 10-minute threshold.
-- process_retry_sweep() will auto-resolve these on next sweep (every 15 min).
-- =============================================================================
CREATE OR REPLACE VIEW public.v_stuck_jobs AS
SELECT
  cel.job_name,
  cel.function_name,
  cel.started_at,
  EXTRACT(EPOCH FROM (NOW() - cel.started_at))::int / 60                       AS running_min,
  cel.correlation_id,
  cel.retry_count,
  cel.request_body
FROM public.cron_execution_log cel
WHERE cel.status     = 'invoked'
  AND cel.started_at < NOW() - INTERVAL '10 minutes'
ORDER BY cel.started_at ASC;

COMMENT ON VIEW public.v_stuck_jobs IS
  'Invocations in "invoked" state > 10 min. These indicate edge function timeouts '
  'or pg_net HTTP failures. process_retry_sweep() marks them failed and queues retries.';

-- =============================================================================
-- VIEW 10: v_retry_status
-- Current state of the retry queue: pending, processed, and exhausted retries.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_retry_status AS
SELECT
  rq.job_name,
  rq.function_name,
  COUNT(*)                                                                     AS total_queued,
  COUNT(*) FILTER (WHERE NOT rq.processed AND rq.retry_at > NOW())             AS waiting,
  COUNT(*) FILTER (WHERE NOT rq.processed AND rq.retry_at <= NOW())            AS ready_to_retry,
  COUNT(*) FILTER (WHERE rq.processed)                                         AS completed,
  COUNT(*) FILTER (WHERE NOT rq.processed AND rq.retry_count >= rq.max_retries) AS exhausted,
  MAX(rq.retry_count)                                                          AS max_retry_seen,
  MIN(rq.retry_at) FILTER (WHERE NOT rq.processed)                            AS next_retry_at
FROM public.cron_retry_queue rq
WHERE rq.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY rq.job_name, rq.function_name
ORDER BY ready_to_retry DESC, waiting DESC;

COMMENT ON VIEW public.v_retry_status IS
  'Retry queue summary (last 24 h). '
  '"ready_to_retry" = overdue and waiting for next sweep. '
  '"exhausted" = failed all 3 attempts — manual intervention needed.';

-- =============================================================================
-- VIEW 11: v_cron_daily_trend
-- 14-day per-job success rate trend for detecting degradation over time.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_daily_trend AS
SELECT
  j.jobname                                                                    AS job_name,
  DATE_TRUNC('day', d.start_time)::date                                        AS run_date,
  COUNT(*)                                                                     AS total_runs,
  COUNT(*) FILTER (WHERE d.status = 'succeeded')                               AS successes,
  COUNT(*) FILTER (WHERE d.status = 'failed')                                  AS failures,
  ROUND(100.0 * COUNT(*) FILTER (WHERE d.status = 'succeeded')
    / NULLIF(COUNT(*), 0), 1)                                                  AS success_pct,
  ROUND(AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))
    FILTER (WHERE d.end_time IS NOT NULL), 1)                                  AS avg_sec
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname  LIKE 'predictxta-%'
  AND d.start_time >= NOW() - INTERVAL '14 days'
GROUP BY j.jobname, DATE_TRUNC('day', d.start_time)::date
ORDER BY j.jobname, run_date DESC;

COMMENT ON VIEW public.v_cron_daily_trend IS
  'Per-job daily success rate and average runtime over the last 14 days. '
  'Use to spot gradual degradation or sudden quality drops.';

-- =============================================================================
-- VIEW 12: v_cron_system_health
-- Single-row executive dashboard: health score + active alerts + retry queue.
-- Perfect for a status widget on the admin home screen.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_cron_system_health AS
SELECT
  hs.health_score,
  hs.pipeline_status,
  hs.total_jobs,
  hs.healthy,
  hs.warning,
  hs.failed,
  hs.stalled,
  hs.never_run,
  -- Open critical alerts (last 24 h, unresolved)
  COALESCE(al.critical_alerts, 0)                                              AS open_critical_alerts,
  COALESCE(al.warning_alerts,  0)                                              AS open_warning_alerts,
  -- Retry queue
  COALESCE(rq.pending_retries, 0)                                              AS pending_retries,
  COALESCE(rq.exhausted,       0)                                              AS exhausted_retries,
  -- Stuck invocations
  COALESCE(sk.stuck_count,     0)                                              AS stuck_invocations,
  hs.evaluated_at
FROM public.v_cron_health_score hs
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE severity = 'critical' AND NOT resolved) AS critical_alerts,
    COUNT(*) FILTER (WHERE severity = 'warning'  AND NOT resolved) AS warning_alerts
  FROM public.pipeline_alerts
  WHERE created_at >= NOW() - INTERVAL '24 hours'
) al ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE NOT processed AND retry_count < max_retries) AS pending_retries,
    COUNT(*) FILTER (WHERE NOT processed AND retry_count >= max_retries) AS exhausted
  FROM public.cron_retry_queue
  WHERE created_at >= NOW() - INTERVAL '24 hours'
) rq ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS stuck_count
  FROM public.cron_execution_log
  WHERE status = 'invoked' AND started_at < NOW() - INTERVAL '10 minutes'
) sk ON true;

COMMENT ON VIEW public.v_cron_system_health IS
  'Executive single-row health summary. Combines pipeline health score, '
  'alert counts, retry queue depth, and stuck invocation count. '
  'Ideal for the admin dashboard status widget.';

-- =============================================================================
-- PRODUCTION HEALTH CHECK QUERIES
-- Run any of these in SQL Editor for live monitoring.
-- =============================================================================

-- ── One-line status: ─────────────────────────────────────────────────────────
-- SELECT format('Pipeline: %s | Score: %s/100 | %s healthy / %s warning / %s failed | Alerts: %s critical | Retries: %s pending',
--   pipeline_status, health_score, healthy, warning, failed,
--   open_critical_alerts, pending_retries)
-- FROM public.v_cron_system_health;

-- ── Full dashboard: ───────────────────────────────────────────────────────────
-- SELECT job_name, schedule, active, last_run_start, last_status,
--        last_run_sec, runs_7d, success_rate_pct, health_status, next_run_approx
-- FROM public.v_cron_dashboard;

-- ── Health score: ────────────────────────────────────────────────────────────
-- SELECT health_score, pipeline_status, total_jobs, healthy, warning, failed
-- FROM public.v_cron_health_score;

-- ── Executive summary (single row): ──────────────────────────────────────────
-- SELECT * FROM public.v_cron_system_health;

-- ── Failed jobs: ─────────────────────────────────────────────────────────────
-- SELECT * FROM public.v_cron_failure_summary;

-- ── Slowest jobs: ────────────────────────────────────────────────────────────
-- SELECT job_name, avg_sec, p95_sec, success_pct
-- FROM public.v_pipeline_job_performance ORDER BY avg_sec DESC NULLS LAST;

-- ── Recent runs (50 rows): ───────────────────────────────────────────────────
-- SELECT job_name, start_time, duration_sec, status_label, error_message
-- FROM public.v_cron_run_history LIMIT 50;

-- ── 14-day trend for specific job: ───────────────────────────────────────────
-- SELECT run_date, success_pct, total_runs, avg_sec
-- FROM public.v_cron_daily_trend WHERE job_name = 'predictxta-fetch-matches'
-- ORDER BY run_date DESC;

-- ── Stuck invocations: ───────────────────────────────────────────────────────
-- SELECT * FROM public.v_stuck_jobs;

-- ── Pending retries: ─────────────────────────────────────────────────────────
-- SELECT * FROM public.v_retry_status WHERE pending_retries > 0 OR ready_to_retry > 0;

-- ── Unresolved alerts: ───────────────────────────────────────────────────────
-- SELECT alert_type, severity, message, created_at FROM public.v_pipeline_alerts;

-- ── HTTP invocation detail: ──────────────────────────────────────────────────
-- SELECT job_name, function_name, started_at, status, retry_count, error_message, correlation_id
-- FROM public.v_execution_log_detail WHERE status = 'failed';

-- ── Resolve all warnings (after issue fixed): ────────────────────────────────
-- UPDATE public.pipeline_alerts
-- SET resolved = true, resolved_at = NOW()
-- WHERE resolved = false AND severity = 'warning' AND created_at < NOW() - INTERVAL '1 hour';

-- =============================================================================
-- MIGRATION GUIDE: from deprecated pg_cron columns
-- =============================================================================
--
-- OLD (fails on pg_cron 1.6+):
--   SELECT jobname, runcount, last_run_status, last_run_time FROM cron.job;
--   ERROR: column "runcount" of relation "cron.job" does not exist
--
-- NEW (correct, compatible):
--   -- Latest run per job:
--   SELECT j.jobname, d.start_time, d.end_time, d.status
--   FROM cron.job j
--   LEFT JOIN LATERAL (
--     SELECT * FROM cron.job_run_details
--     WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1
--   ) d ON true;
--
--   -- Or use the view:
--   SELECT job_name, last_run_start, last_status, runs_7d FROM public.v_cron_dashboard;
--
-- COLUMN MAPPING TABLE:
--   cron.job.runcount        → COUNT(*) FROM cron.job_run_details WHERE jobid = ?
--   cron.job.last_run_status → cron.job_run_details.status           (latest DESC)
--   cron.job.last_run_time   → cron.job_run_details.start_time       (latest DESC)
--
-- =============================================================================
-- VALIDATION CHECKLIST (run after setup-cron-schedules.sql v4.0)
-- =============================================================================
--
-- □ 1. pg_cron installed:
--      SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
--
-- □ 2. pg_net installed:
--      SELECT extname FROM pg_extension WHERE extname = 'pg_net';
--
-- □ 3. Vault secrets stored:
--      SELECT name FROM vault.decrypted_secrets
--      WHERE name IN ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY');
--
-- □ 4. All 16 jobs active:
--      SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'predictxta-%' AND active;
--
-- □ 5. No deprecated column errors (must not raise exception):
--      SELECT * FROM public.v_cron_dashboard LIMIT 1;
--
-- □ 6. Tables exist:
--      SELECT table_name FROM information_schema.tables WHERE table_schema='public'
--      AND table_name IN ('cron_execution_log','cron_retry_queue',
--                         'cron_job_locks','pipeline_alerts');
--
-- □ 7. Helper functions exist:
--      SELECT routine_name FROM information_schema.routines
--      WHERE routine_schema='public'
--      AND routine_name IN ('invoke_edge_function','process_retry_sweep',
--                           'dispatch_pipeline_alert','ensure_cron_job','detect_stuck_jobs');
--
-- □ 8. All views queryable:
--      SELECT * FROM public.v_cron_system_health;
--      SELECT * FROM public.v_cron_health_score;
--      SELECT * FROM public.v_retry_status;
--      SELECT * FROM public.v_stuck_jobs;
--
-- □ 9. invoke_edge_function test call:
--      SELECT public.invoke_edge_function(
--        'test-call','monitoring-dashboard','{"section":"health"}'::jsonb);
--      SELECT job_name, status FROM public.cron_execution_log
--      ORDER BY started_at DESC LIMIT 1;
--
-- □ 10. First live-sync fires within 5 min of enabling pg_cron + pg_net:
--       SELECT start_time, status FROM cron.job_run_details d
--       JOIN cron.job j ON j.jobid = d.jobid
--       WHERE j.jobname = 'predictxta-sync-live'
--       ORDER BY start_time DESC LIMIT 1;
--
-- □ 11. Health score reaches 30 (NEVER_RUN baseline) then climbs to 100 (HEALTHY)
--       as jobs fire for the first time:
--       SELECT health_score, pipeline_status FROM public.v_cron_health_score;
--
-- □ 12. Alert dispatch works:
--       SELECT public.dispatch_pipeline_alert('test','info','Setup complete', '{}'::jsonb);
--       SELECT message FROM public.pipeline_alerts ORDER BY created_at DESC LIMIT 1;
--
-- =============================================================================
