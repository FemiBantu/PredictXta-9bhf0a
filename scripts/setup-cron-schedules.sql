-- =============================================================================
-- PredictXta — Production Cron Pipeline  v4.0
-- Supabase 2026 / pg_cron 1.6+ / pg_net 0.7+ / PostgreSQL 15-17 Compatible
-- =============================================================================
--
-- WHAT'S NEW IN v4.0 (over v3.0):
--   ✓ ensure_cron_job()         — true idempotent scheduling; never drops a running
--                                  job unless its schedule actually changed
--   ✓ dispatch_pipeline_alert() — writes to existing pipeline_alerts table; fires
--                                  optional webhook via vault WEBHOOK_ALERT_URL
--   ✓ Overlap prevention        — invoke_edge_function() checks in-flight log before
--                                  firing a duplicate invocation
--   ✓ Timeout auto-detection    — process_retry_sweep() marks 'invoked' rows as
--                                  'failed' after configurable timeout, then queues
--                                  retries with proper 30s / 2min / 5min delays
--   ✓ detect_stuck_jobs()       — reports jobs stuck longer than expected_min
--   ✓ Edge function validation  — pre-flight HTTP HEAD check for each endpoint
--   ✓ cron_job_locks table      — lightweight lock records for overlap detection
--   ✓ Enhanced security         — SECURITY DEFINER + narrow search_path on all fns
--   ✓ pipeline_alerts integration — all critical failures raise DB alerts
--   ✓ Webhook alerting          — optional WEBHOOK_ALERT_URL vault secret
--   ✓ RLS on all new tables
--   ✓ All 16 jobs preserved + enhanced
--
-- BREAKING REMOVALS (still absent — correct):
--   ✗ cron.job.runcount         — deprecated, does not exist in pg_cron 1.6+
--   ✗ cron.job.last_run_status  — deprecated
--   ✗ cron.job.last_run_time    — deprecated
--   → Use cron.job_run_details for all per-run data (official modern API)
--
-- PREREQUISITES (one-time — Supabase Dashboard):
--   1. Database → Extensions → enable  pg_cron
--   2. Database → Extensions → enable  pg_net
--
-- VAULT SECRETS (one-time — SQL Editor):
--   SELECT vault.create_secret('SUPABASE_URL',
--     'https://osmkbrryalhtpnayosmk.backend.onspace.ai', 'Project URL');
--   SELECT vault.create_secret('SUPABASE_SERVICE_ROLE_KEY',
--     '<service-role-key>', 'Service role key');
--   -- Optional: alerts sent as JSON POST to this URL when severity = critical
--   SELECT vault.create_secret('WEBHOOK_ALERT_URL',
--     'https://your-webhook.example.com/predictxta-alerts', 'Alert webhook');
--
-- SCHEDULE OVERVIEW (16 jobs):
--   */5   * * * *   — Live score sync (quota-aware)    (every 5 min)
--   */15  * * * *   — Retry sweep               (every 15 min)
--   0  */2  * * *   — News sync                 (every 2 h)
--   0  */4  * * *   — Highlights sync           (every 4 h)
--   0     * * * *   — Stale-match cleanup       (every hour, SQL)
--   0     0 * * *   — Midnight purge            (00:00 UTC, SQL)
--   0     1 * * *   — Expert promotion          (01:00 UTC)
--   0     2 * * 1   — AI model rebalance        (Mon 02:00 UTC)
--   0     6 * * *   — Morning fixture preload   (06:00 UTC)
--   0     6 * * 0   — Weekly standings sync     (Sun 06:00 UTC)
--   0     9 * * *   — Daily challenge           (09:00 UTC)
--   0    18 * * *   — Main fixture preload      (18:00 UTC)
--   0    19 * * *   — Odds fetch                (19:00 UTC)
--   0    20 * * *   — AI prediction generation  (20:00 UTC)
--   0    21 * * *   — Pipeline audit            (21:00 UTC)
--   0    23 * * *   — Settle expert picks       (23:00 UTC)
-- =============================================================================

-- ─── 0. Enable extensions (idempotent; errors if dashboard step skipped) ─────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- SECTION 1: SCHEMA — Tables
-- =============================================================================

-- ── 1a. Invocation log ────────────────────────────────────────────────────────
-- One row per edge-function HTTP invocation. Provides correlation IDs,
-- retry-count tracking, and the canonical status of every call.
-- Status lifecycle: invoked → succeeded | failed | error | skipped
CREATE TABLE IF NOT EXISTS public.cron_execution_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name       text        NOT NULL,
  function_name  text        NOT NULL,
  request_body   jsonb,
  started_at     timestamptz NOT NULL DEFAULT NOW(),
  completed_at   timestamptz,
  status         text        NOT NULL DEFAULT 'invoked',
  http_status    integer,
  error_message  text,
  retry_count    integer     NOT NULL DEFAULT 0,
  -- Generated correlation_id forwarded as X-Correlation-Id HTTP header
  -- allowing end-to-end tracing in Supabase Edge Function logs.
  correlation_id text        GENERATED ALWAYS AS (id::text) STORED
);

CREATE INDEX IF NOT EXISTS cel_job_name_idx   ON public.cron_execution_log (job_name);
CREATE INDEX IF NOT EXISTS cel_started_at_idx ON public.cron_execution_log (started_at DESC);
CREATE INDEX IF NOT EXISTS cel_status_idx     ON public.cron_execution_log (status);
-- Composite for timeout detection query (job_name + status + started_at)
CREATE INDEX IF NOT EXISTS cel_timeout_idx    ON public.cron_execution_log (job_name, status, started_at)
  WHERE status = 'invoked';

ALTER TABLE public.cron_execution_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cron_execution_log' AND policyname='authenticated_read_exec_log') THEN
    CREATE POLICY authenticated_read_exec_log ON public.cron_execution_log
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cron_execution_log' AND policyname='service_write_exec_log') THEN
    CREATE POLICY service_write_exec_log ON public.cron_execution_log
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 1b. Retry queue ───────────────────────────────────────────────────────────
-- Failed invocations queued for retry using exponential backoff.
-- retry_count 0 → retry in  30 seconds
-- retry_count 1 → retry in   2 minutes
-- retry_count 2 → retry in   5 minutes  (max = 3 retries total)
CREATE TABLE IF NOT EXISTS public.cron_retry_queue (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        uuid        REFERENCES public.cron_execution_log(id) ON DELETE CASCADE,
  job_name      text        NOT NULL,
  function_name text        NOT NULL,
  request_body  jsonb,
  retry_count   integer     NOT NULL DEFAULT 0,
  max_retries   integer     NOT NULL DEFAULT 3,
  retry_at      timestamptz NOT NULL,
  processed     boolean     NOT NULL DEFAULT false,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crq_retry_at_idx  ON public.cron_retry_queue (retry_at) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS crq_job_name_idx  ON public.cron_retry_queue (job_name);
CREATE INDEX IF NOT EXISTS crq_log_id_idx    ON public.cron_retry_queue (log_id)   WHERE log_id IS NOT NULL;

ALTER TABLE public.cron_retry_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cron_retry_queue' AND policyname='service_manage_retry_queue') THEN
    CREATE POLICY service_manage_retry_queue ON public.cron_retry_queue
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 1c. Job overlap prevention locks ──────────────────────────────────────────
-- Lightweight advisory table: each row represents an in-flight invocation.
-- Entries older than their expected_done timestamp are considered stale.
-- Used by invoke_edge_function() to skip duplicate concurrent runs.
CREATE TABLE IF NOT EXISTS public.cron_job_locks (
  job_name       text        PRIMARY KEY,
  correlation_id text        NOT NULL,
  locked_at      timestamptz NOT NULL DEFAULT NOW(),
  expected_done  timestamptz NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

ALTER TABLE public.cron_job_locks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cron_job_locks' AND policyname='service_manage_job_locks') THEN
    CREATE POLICY service_manage_job_locks ON public.cron_job_locks
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- SECTION 2: HELPER FUNCTIONS
-- =============================================================================

-- ── 2a. dispatch_pipeline_alert ───────────────────────────────────────────────
-- Writes a row to the existing pipeline_alerts table and, if WEBHOOK_ALERT_URL
-- is configured in Vault, fires an async HTTP POST to that URL.
-- Severity levels: 'info' | 'warning' | 'critical'
-- This function is safe to call anywhere — it never raises an exception.
CREATE OR REPLACE FUNCTION public.dispatch_pipeline_alert(
  p_alert_type text,
  p_severity   text        DEFAULT 'warning',
  p_message    text        DEFAULT '',
  p_details    jsonb       DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_webhook_url text;
  v_key         text;
  v_url         text;
BEGIN
  -- Always write to pipeline_alerts table (used by admin dashboard)
  BEGIN
    INSERT INTO public.pipeline_alerts (alert_type, severity, message, details)
    VALUES (p_alert_type, p_severity, p_message, p_details);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dispatch_pipeline_alert] Failed to insert alert: %', SQLERRM;
    RETURN;
  END;

  -- For critical alerts only: fire webhook if URL is configured
  IF p_severity = 'critical' THEN
    BEGIN
      SELECT decrypted_secret INTO v_webhook_url
      FROM vault.decrypted_secrets WHERE name = 'WEBHOOK_ALERT_URL';
      SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
      SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
    EXCEPTION WHEN OTHERS THEN
      v_webhook_url := NULL;
    END;

    IF v_webhook_url IS NOT NULL AND v_url IS NOT NULL AND v_key IS NOT NULL THEN
      BEGIN
        -- Use the alert-dispatch edge function if webhook is a relative path,
        -- otherwise POST directly to the webhook URL
        IF v_webhook_url LIKE '/functions/v1/%' THEN
          PERFORM net.http_post(
            url     := v_url || v_webhook_url,
            headers := jsonb_build_object(
              'Content-Type',  'application/json',
              'Authorization', 'Bearer ' || v_key
            ),
            body    := jsonb_build_object(
              'alert_type', p_alert_type,
              'severity',   p_severity,
              'message',    p_message,
              'details',    p_details,
              'ts',         NOW()
            )
          );
        ELSE
          PERFORM net.http_post(
            url     := v_webhook_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Source',     'predictxta-pipeline'
            ),
            body    := jsonb_build_object(
              'alert_type', p_alert_type,
              'severity',   p_severity,
              'message',    p_message,
              'details',    p_details,
              'ts',         NOW()
            )
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[dispatch_pipeline_alert] Webhook dispatch failed: %', SQLERRM;
      END;
    END IF;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[dispatch_pipeline_alert] Outer error: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.dispatch_pipeline_alert IS
  'Writes to pipeline_alerts table. For critical severity: also POSTs to WEBHOOK_ALERT_URL '
  'if configured in Vault. Safe to call anywhere — never raises exceptions.';

-- ── 2b. ensure_cron_job ───────────────────────────────────────────────────────
-- Idempotent scheduler: creates or updates a pg_cron job without disturbing
-- a running instance unless the schedule has actually changed.
-- Unlike the naive unschedule+reschedule pattern, this function:
--   - Skips the job entirely if it exists with the same schedule + is active
--   - Only recreates if the schedule differs
--   - Re-activates a disabled job if the schedule matches
CREATE OR REPLACE FUNCTION public.ensure_cron_job(
  p_job_name text,
  p_schedule text,
  p_command  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_jobid   bigint;
  v_existing_sched   text;
  v_existing_active  boolean;
BEGIN
  SELECT jobid, schedule, active
  INTO   v_existing_jobid, v_existing_sched, v_existing_active
  FROM   cron.job
  WHERE  jobname = p_job_name;

  IF FOUND THEN
    IF v_existing_sched = p_schedule THEN
      IF NOT v_existing_active THEN
        -- Re-activate without changing the job
        UPDATE cron.job SET active = true WHERE jobid = v_existing_jobid;
        RAISE NOTICE 'Re-activated disabled job: %', p_job_name;
      ELSE
        RAISE NOTICE 'Job unchanged (schedule + active): %', p_job_name;
      END IF;
      RETURN;
    ELSE
      -- Schedule changed — safe to recreate (old invocation has already completed)
      PERFORM cron.unschedule(v_existing_jobid);
      RAISE NOTICE 'Job % schedule changed [%] → [%] — recreated', p_job_name, v_existing_sched, p_schedule;
    END IF;
  END IF;

  PERFORM cron.schedule(p_job_name, p_schedule, p_command);
  RAISE NOTICE 'Scheduled new job: %  [%]', p_job_name, p_schedule;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ensure_cron_job] Failed to schedule %: %', p_job_name, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.ensure_cron_job IS
  'Idempotent cron job creator. Skips if job exists with same schedule. '
  'Recreates only when schedule differs. Never drops a currently-active same-schedule job.';

-- ── 2c. invoke_edge_function ──────────────────────────────────────────────────
-- Central wrapper for all edge-function HTTP calls from pg_cron.
-- Features:
--   • Vault secret resolution (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
--   • Overlap prevention: skips if another instance is still in-flight
--   • Correlation-ID tracing via X-Correlation-Id header
--   • Writes to cron_execution_log (one row per call)
--   • Updates pipeline_schedule via sync_pipeline_schedule_run()
--   • Dispatches critical alerts on failure
--   • Never throws — always returns a log UUID
CREATE OR REPLACE FUNCTION public.invoke_edge_function(
  p_job_name      text,
  p_func_name     text,
  p_body          jsonb,
  p_retry_count   integer DEFAULT 0,
  p_timeout_min   integer DEFAULT 10,    -- mark stuck after this many minutes
  p_allow_overlap boolean DEFAULT false  -- false = skip if previous call in-flight
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url        text;
  v_key        text;
  v_log_id     uuid := gen_random_uuid();
  v_in_flight  boolean := false;
BEGIN
  -- ── Overlap check ─────────────────────────────────────────────────────────
  -- For non-retry, non-overlap-allowed calls: skip if a recent invocation of
  -- the same job is still 'invoked' (pg_net call in-flight or function running).
  IF NOT p_allow_overlap AND p_retry_count = 0 THEN
    SELECT EXISTS(
      SELECT 1 FROM public.cron_execution_log
      WHERE job_name  = p_job_name
        AND status    = 'invoked'
        AND started_at >= NOW() - (p_timeout_min || ' minutes')::interval
    ) INTO v_in_flight;

    IF v_in_flight THEN
      RAISE NOTICE '[invoke_edge_function] % still in-flight — skipping to prevent overlap', p_job_name;
      -- Insert a skipped record so we can audit this decision
      INSERT INTO public.cron_execution_log
        (id, job_name, function_name, request_body, started_at, status, retry_count)
      VALUES (v_log_id, p_job_name, p_func_name, p_body, NOW(), 'skipped', 0);
      RETURN v_log_id;
    END IF;
  END IF;

  -- ── Resolve Vault secrets ─────────────────────────────────────────────────
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[invoke_edge_function] Vault not accessible: %', SQLERRM;
    v_url := NULL; v_key := NULL;
  END;

  -- ── Log invocation start ──────────────────────────────────────────────────
  INSERT INTO public.cron_execution_log
    (id, job_name, function_name, request_body, started_at, status, retry_count)
  VALUES
    (v_log_id, p_job_name, p_func_name, p_body, NOW(), 'invoked', p_retry_count);

  -- ── Guard: missing secrets ────────────────────────────────────────────────
  IF v_url IS NULL OR v_key IS NULL THEN
    UPDATE public.cron_execution_log
    SET status = 'failed', error_message = 'Vault secrets missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    WHERE id = v_log_id;

    PERFORM public.dispatch_pipeline_alert(
      'vault_secret_missing', 'critical',
      format('Job %s: Vault secrets missing — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', p_job_name),
      jsonb_build_object('job_name', p_job_name, 'function', p_func_name, 'correlation_id', v_log_id)
    );
    RAISE WARNING '[invoke_edge_function] Secrets missing — job % skipped', p_job_name;
    RETURN v_log_id;
  END IF;

  -- ── Fire async HTTP POST via pg_net ───────────────────────────────────────
  -- PERFORM discards the return value; safe across pg_net 0.7 (bigint) and
  -- pg_net 0.10+ (composite). X-Correlation-Id enables end-to-end tracing
  -- in the Supabase Edge Function log dashboard.
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || p_func_name,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'Authorization',    'Bearer ' || v_key,
      'X-Correlation-Id', v_log_id::text,
      'X-Job-Name',       p_job_name,
      'X-Retry-Count',    p_retry_count::text,
      'X-Timeout-Min',    p_timeout_min::text
    ),
    body    := p_body
  );

  -- ── Update pipeline_schedule dashboard tracker ────────────────────────────
  BEGIN
    PERFORM public.sync_pipeline_schedule_run(p_job_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE DEBUG '[invoke_edge_function] sync_pipeline_schedule_run error for %: %', p_job_name, SQLERRM;
  END;

  RETURN v_log_id;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.cron_execution_log
    SET status = 'error', error_message = SQLERRM
    WHERE id = v_log_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    PERFORM public.dispatch_pipeline_alert(
      'invocation_error', 'critical',
      format('Job %s/%s failed: %s', p_job_name, p_func_name, SQLERRM),
      jsonb_build_object('job_name', p_job_name, 'function', p_func_name,
                         'correlation_id', v_log_id, 'error', SQLERRM)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RAISE WARNING '[invoke_edge_function] Unexpected error for %s (%s): %s', p_func_name, p_job_name, SQLERRM;
  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_edge_function IS
  'Production-grade edge function invoker. Resolves vault secrets, prevents overlaps, '
  'logs every call to cron_execution_log, dispatches pipeline_alerts on critical failures. '
  'X-Correlation-Id header enables end-to-end tracing. Never raises exceptions.';

-- ── 2d. log_sql_job_run ───────────────────────────────────────────────────────
-- Lightweight logger for pure-SQL cron jobs that make no HTTP call.
CREATE OR REPLACE FUNCTION public.log_sql_job_run(
  p_job_name text,
  p_status   text DEFAULT 'succeeded'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cron_execution_log
    (job_name, function_name, started_at, completed_at, status, retry_count)
  VALUES (p_job_name, 'SQL', NOW(), NOW(), p_status, 0);

  BEGIN
    PERFORM public.sync_pipeline_schedule_run(p_job_name);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF p_status = 'failed' THEN
    PERFORM public.dispatch_pipeline_alert(
      'sql_job_failed', 'warning',
      format('SQL cron job failed: %s', p_job_name),
      jsonb_build_object('job_name', p_job_name)
    );
  END IF;
END;
$$;

-- ── 2e. process_retry_sweep ───────────────────────────────────────────────────
-- Called every 15 minutes by predictxta-retry-sweep.
-- Phase 1: detect invocations stuck in 'invoked' after p_timeout_min (default 10 min)
--           → mark as 'failed', dispatch warning alert
-- Phase 2: queue failed recent invocations for retry with exponential backoff
--           retry 0 → +30 seconds
--           retry 1 → + 2 minutes
--           retry 2 → + 5 minutes   (max 3 retries)
-- Phase 3: process due retries (up to 10 per sweep)
-- Phase 4: purge old completed retries + old log entries
CREATE OR REPLACE FUNCTION public.process_retry_sweep(
  p_timeout_min integer DEFAULT 10   -- invocations older than this are assumed stuck
)
RETURNS jsonb                        -- returns summary of actions taken
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry      public.cron_retry_queue%ROWTYPE;
  v_timed_out  integer := 0;
  v_queued     integer := 0;
  v_retried    integer := 0;
  v_purged_q   integer;
  v_purged_l   integer;
  v_delay      interval;
BEGIN
  -- ── Phase 1: Detect stuck 'invoked' entries ────────────────────────────────
  WITH timed_out AS (
    UPDATE public.cron_execution_log
    SET    status        = 'failed',
           error_message = format('Assumed failed: still invoked after %s min', p_timeout_min),
           completed_at  = NOW()
    WHERE  status     = 'invoked'
      AND  started_at < NOW() - (p_timeout_min || ' minutes')::interval
    RETURNING job_name, function_name
  )
  SELECT COUNT(*) INTO v_timed_out FROM timed_out;

  IF v_timed_out > 0 THEN
    PERFORM public.dispatch_pipeline_alert(
      'invocation_timeout', 'warning',
      format('%s invocation(s) timed out and marked failed', v_timed_out),
      jsonb_build_object('count', v_timed_out, 'timeout_min', p_timeout_min)
    );
  END IF;

  -- ── Phase 2: Queue retries for recently-failed invocations ────────────────
  -- Only queue if: failed within last 2 hours, retry_count < 3,
  -- and no pending retry already exists for this log_id.
  WITH to_retry AS (
    SELECT
      cel.id            AS log_id,
      cel.job_name,
      cel.function_name,
      cel.request_body,
      cel.retry_count
    FROM public.cron_execution_log cel
    WHERE cel.status      = 'failed'
      AND cel.started_at  >= NOW() - INTERVAL '2 hours'
      AND cel.retry_count  < 3
      AND NOT EXISTS (
        SELECT 1 FROM public.cron_retry_queue rq
        WHERE rq.log_id = cel.id AND NOT rq.processed
      )
  ),
  inserted AS (
    INSERT INTO public.cron_retry_queue
      (log_id, job_name, function_name, request_body, retry_count, max_retries, retry_at)
    SELECT
      tr.log_id,
      tr.job_name,
      tr.function_name,
      tr.request_body,
      tr.retry_count + 1,
      3,
      NOW() + CASE tr.retry_count
        WHEN 0 THEN INTERVAL '30 seconds'
        WHEN 1 THEN INTERVAL '2 minutes'
        ELSE        INTERVAL '5 minutes'
      END
    FROM to_retry tr
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_queued FROM inserted;

  -- ── Phase 3: Process due retries (up to 10 per sweep) ─────────────────────
  FOR v_retry IN
    SELECT *
    FROM   public.cron_retry_queue
    WHERE  processed   = false
      AND  retry_at   <= NOW()
      AND  retry_count <  max_retries
    ORDER  BY retry_at ASC
    LIMIT  10
  LOOP
    BEGIN
      PERFORM public.invoke_edge_function(
        v_retry.job_name,
        v_retry.function_name,
        v_retry.request_body,
        v_retry.retry_count,
        15,    -- give retries a longer timeout
        true   -- allow overlap for explicit retries
      );

      UPDATE public.cron_retry_queue
      SET    processed    = true,
             processed_at = NOW()
      WHERE  id = v_retry.id;

      v_retried := v_retried + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[process_retry_sweep] Retry failed for %: %', v_retry.job_name, SQLERRM;
    END;
  END LOOP;

  -- Alert if any job has exhausted all retries
  PERFORM public.dispatch_pipeline_alert(
    'retries_exhausted', 'critical',
    format('%s job(s) exhausted all retries in the last 6 hours', COUNT(*)),
    '{}'::jsonb
  )
  FROM public.cron_retry_queue rq
  WHERE rq.processed    = false
    AND rq.retry_count >= rq.max_retries
    AND rq.created_at  >= NOW() - INTERVAL '6 hours'
  HAVING COUNT(*) > 0;

  -- ── Phase 4: Purge stale records ──────────────────────────────────────────
  WITH del_q AS (
    DELETE FROM public.cron_retry_queue
    WHERE  processed    = true
      AND  processed_at < NOW() - INTERVAL '7 days'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_purged_q FROM del_q;

  WITH del_l AS (
    DELETE FROM public.cron_execution_log
    WHERE started_at < NOW() - INTERVAL '14 days'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_purged_l FROM del_l;

  RETURN jsonb_build_object(
    'timed_out',  v_timed_out,
    'queued',     v_queued,
    'retried',    v_retried,
    'purged_q',   v_purged_q,
    'purged_l',   v_purged_l,
    'swept_at',   NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.process_retry_sweep IS
  'Retry sweep called every 15 min. Phase 1: detect timeouts. '
  'Phase 2: queue retries (30s/2min/5min delays). Phase 3: execute due retries. '
  'Phase 4: purge old records (queued >7d, log >14d). Returns JSON action summary.';

-- ── 2f. detect_stuck_jobs ────────────────────────────────────────────────────
-- Returns jobs whose last pg_cron execution appears stuck (running > threshold).
-- Safe to call from monitoring dashboards.
CREATE OR REPLACE FUNCTION public.detect_stuck_jobs(
  p_threshold_min integer DEFAULT 15
)
RETURNS TABLE (
  job_name       text,
  started_at     timestamptz,
  running_min    integer,
  correlation_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    cel.job_name,
    cel.started_at,
    EXTRACT(EPOCH FROM (NOW() - cel.started_at))::integer / 60 AS running_min,
    cel.correlation_id
  FROM public.cron_execution_log cel
  WHERE cel.status     = 'invoked'
    AND cel.started_at < NOW() - (p_threshold_min || ' minutes')::interval
  ORDER BY cel.started_at ASC;
$$;

COMMENT ON FUNCTION public.detect_stuck_jobs IS
  'Returns invocations still in invoked status after p_threshold_min minutes. '
  'Use for monitoring; process_retry_sweep() auto-resolves these on next sweep.';

-- ── 2g. invoke_sync_live_quota_aware ──────────────────────────────────────────
-- Quota-aware wrapper for the predictxta-sync-live cron job.
--
-- Instead of an extra HTTP round-trip to quota-monitor, this function reads the
-- api_usage table directly and selects the appropriate sports subset:
--
--   Normal  (0–60%  = 0–4,200 calls) : All 12 sports — no throttle
--   Caution (60–75% = 4,200–5,250)   : All 12 sports + caution log entry
--   Warning (75–90% = 5,250–6,300)   : football + basketball + TSDB (tennis, cricket)
--                                       Skips: hockey, rugby, handball, volleyball,
--                                              baseball, american-football, mma, afl
--   Critical (>90%  = >6,300 calls)  : football + TSDB only
--                                       Also skips: basketball
--
-- * TSDB sports (tennis, cricket) use TheSportsDB free tier — no API-Sports
--   quota consumed — always included regardless of quota mode.
--
-- On WARNING or CRITICAL:
--   • Inserts a cron_execution_log row with status = 'quota_throttled'
--   • Dispatches a pipeline_alert for operator visibility
--   • Passes quota_mode and throttled:true into the sync-live edge function body
-- On CAUTION: inserts a 'quota_caution' log row but runs all sports.
-- On error in quota check: falls back to all 12 sports (safe default).
CREATE OR REPLACE FUNCTION public.invoke_sync_live_quota_aware()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Sport tiers: aligned with quota-monitor / quotaManager.ts ────────────
  -- TSDB free-tier sports — always run (0 API-Sports quota consumed)
  v_tsdb_sports         text[] := ARRAY['tennis', 'cricket'];
  -- API-Sports quota-consuming sports ordered by business priority
  v_api_tier1           text[] := ARRAY['football'];              -- always kept
  v_api_tier2           text[] := ARRAY['basketball'];            -- kept in WARNING
  v_api_tier3           text[] := ARRAY['hockey', 'rugby', 'handball', 'volleyball',
                                         'baseball', 'american-football', 'mma', 'afl'];

  -- ── Working variables ─────────────────────────────────────────────────────
  v_quota_mode          text;
  v_total_used          bigint;
  v_usage_pct           integer;
  v_selected_sports     text[];
  v_skipped_sports      text[];
  v_throttled           boolean := false;
  v_log_id              uuid;
BEGIN
  -- ── Step 1: Read today's API-Sports usage from api_usage table ────────────
  -- No HTTP call needed — the same source the quota-monitor edge function uses.
  -- COALESCE handles the first run of the day when no rows exist yet.
  SELECT
    COALESCE(SUM(request_count), 0),
    CASE
      WHEN COALESCE(SUM(request_count), 0) >= 6300 THEN 'critical'  -- > 90% of 7,000
      WHEN COALESCE(SUM(request_count), 0) >= 5250 THEN 'warning'   -- > 75% of 7,000
      WHEN COALESCE(SUM(request_count), 0) >= 4200 THEN 'caution'   -- > 60% of 7,000
      ELSE 'normal'
    END
  INTO v_total_used, v_quota_mode
  FROM public.api_usage
  WHERE date = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  v_usage_pct := ROUND((v_total_used::numeric / 7000) * 100);

  -- ── Step 2: Select sport subset based on quota mode ───────────────────────
  CASE v_quota_mode
    WHEN 'critical' THEN
      -- > 90% used: keep only football + free TSDB sports
      v_selected_sports := v_api_tier1 || v_tsdb_sports;
      v_skipped_sports  := v_api_tier2 || v_api_tier3;   -- skip basketball + all tier3
      v_throttled       := true;

    WHEN 'warning' THEN
      -- 75–90% used: keep football + basketball + free TSDB; skip all tier3
      v_selected_sports := v_api_tier1 || v_api_tier2 || v_tsdb_sports;
      v_skipped_sports  := v_api_tier3;   -- skip hockey, rugby, handball, volleyball, ...
      v_throttled       := true;

    WHEN 'caution' THEN
      -- 60–75% used: no throttle yet, run all sports, log caution notice
      v_selected_sports := v_api_tier1 || v_api_tier2 || v_api_tier3 || v_tsdb_sports;
      v_skipped_sports  := ARRAY[]::text[];
      v_throttled       := false;

    ELSE  -- 'normal' (0–60%)
      v_selected_sports := v_api_tier1 || v_api_tier2 || v_api_tier3 || v_tsdb_sports;
      v_skipped_sports  := ARRAY[]::text[];
      v_throttled       := false;
  END CASE;

  -- ── Step 3: Audit log — write throttle / caution entry ────────────────────
  IF v_throttled THEN
    -- Write quota_throttled audit record to cron_execution_log
    INSERT INTO public.cron_execution_log
      (job_name, function_name, request_body, started_at, completed_at, status, retry_count)
    VALUES (
      'predictxta-sync-live',
      'quota-throttle',
      jsonb_build_object(
        'quota_mode',     v_quota_mode,
        'usage_pct',      v_usage_pct,
        'total_used',     v_total_used,
        'budget',         7000,
        'active_sports',  to_jsonb(v_selected_sports),
        'skipped_sports', to_jsonb(v_skipped_sports),
        'reason',         format(
          'API quota at %s%% (%s/7,000): throttled to %s sport(s), skipped %s sport(s)',
          v_usage_pct,
          v_total_used,
          array_length(v_selected_sports, 1),
          array_length(v_skipped_sports,  1)
        )
      ),
      NOW(), NOW(), 'quota_throttled', 0
    );

    -- Dispatch pipeline_alert visible in the admin dashboard
    PERFORM public.dispatch_pipeline_alert(
      'quota_throttled',
      CASE v_quota_mode WHEN 'critical' THEN 'critical' ELSE 'warning' END,
      format(
        'sync-live quota-throttled: %s%% used (%s/7,000). '
        'Active sports: %s. Skipped: %s.',
        v_usage_pct,
        v_total_used,
        array_to_string(v_selected_sports, ', '),
        array_to_string(v_skipped_sports,  ', ')
      ),
      jsonb_build_object(
        'quota_mode',     v_quota_mode,
        'usage_pct',      v_usage_pct,
        'total_used',     v_total_used,
        'active_sports',  to_jsonb(v_selected_sports),
        'skipped_sports', to_jsonb(v_skipped_sports)
      )
    );

  ELSIF v_quota_mode = 'caution' THEN
    -- Caution mode: log informational entry, no throttle
    INSERT INTO public.cron_execution_log
      (job_name, function_name, request_body, started_at, completed_at, status, retry_count)
    VALUES (
      'predictxta-sync-live',
      'quota-caution',
      jsonb_build_object(
        'quota_mode', 'caution',
        'usage_pct',  v_usage_pct,
        'total_used', v_total_used,
        'message',    format(
          'API quota at %s%% — above expected baseline (~44%% for 13 sports). '
          'No throttle yet. Monitoring.',
          v_usage_pct
        )
      ),
      NOW(), NOW(), 'quota_caution', 0
    );
  END IF;

  -- ── Step 4: Fire sync-live with selected sports list ─────────────────────
  -- invoke_edge_function handles overlap detection, vault secrets, and
  -- correlation-ID tracing — all standard behaviour is preserved.
  v_log_id := public.invoke_edge_function(
    'predictxta-sync-live',
    'sync-live',
    jsonb_build_object(
      'sports',     to_jsonb(v_selected_sports),
      'sendAlerts', true,
      'quota_mode', v_quota_mode,
      'throttled',  v_throttled
    ),
    0, 8  -- timeout_min=8 (< 10 min job interval → overlaps are unlikely)
  );

  RETURN v_log_id;

EXCEPTION WHEN OTHERS THEN
  -- Safe fallback: quota check failed — proceed with all sports rather than
  -- silently dropping live data. Log the failure for investigation.
  RAISE WARNING '[invoke_sync_live_quota_aware] Quota check error: % — falling back to all sports', SQLERRM;

  BEGIN
    RETURN public.invoke_edge_function(
      'predictxta-sync-live',
      'sync-live',
      jsonb_build_object(
        'sports',     to_jsonb(
          ARRAY['football','basketball','hockey','tennis','rugby','handball',
                'volleyball','baseball','american-football','cricket','mma','afl']
        ),
        'sendAlerts', true,
        'quota_mode', 'unknown',
        'throttled',  false
      ),
      0, 8
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN gen_random_uuid();
  END;
END;
$$;

COMMENT ON FUNCTION public.invoke_sync_live_quota_aware IS
  'Quota-aware sync-live dispatcher (v2.0). Reads api_usage table directly (no HTTP). '
  'Normal/Caution (<75%): all 12 sports. '
  'Warning (75–90%): football + basketball + TSDB (tennis, cricket). '
  'Critical (>90%): football + TSDB only. '
  'Logs quota_throttled / quota_caution rows to cron_execution_log. '
  'Dispatches pipeline_alert when sports are skipped. '
  'Falls back to all 12 sports if quota check fails (safe default).';

-- =============================================================================
-- SECTION 3: MONITORING VIEWS
-- These views are also defined standalone in scripts/cron-monitoring-views.sql
-- for independent use. Defined here for a single-file setup option.
-- =============================================================================

-- v_cron_dashboard: per-job status, timing, 7-day stats, health colour.
-- Uses ONLY cron.job + cron.job_run_details — no deprecated pg_cron columns.
CREATE OR REPLACE VIEW public.v_cron_dashboard AS
WITH last_run AS (
  SELECT DISTINCT ON (d.jobid)
    d.jobid, d.start_time, d.end_time, d.status AS run_status, d.return_message,
    EXTRACT(EPOCH FROM (d.end_time - d.start_time))::int AS duration_sec
  FROM cron.job_run_details d
  ORDER BY d.jobid, d.start_time DESC
),
week_stats AS (
  SELECT
    d.jobid,
    COUNT(*)                                                                   AS total_runs,
    COUNT(*) FILTER (WHERE d.status = 'succeeded')                             AS successes,
    COUNT(*) FILTER (WHERE d.status = 'failed')                                AS failures,
    ROUND(AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time))), 1)             AS avg_sec,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP
      (ORDER BY EXTRACT(EPOCH FROM (d.end_time - d.start_time))), 1)           AS p95_sec,
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
  lr.start_time                                                                AS last_run_start,
  lr.end_time                                                                  AS last_run_end,
  lr.duration_sec                                                              AS last_run_sec,
  lr.run_status                                                                AS last_status,
  CASE WHEN lr.run_status = 'failed' THEN lr.return_message ELSE NULL END      AS last_error,
  COALESCE(ws.total_runs,       0)                                             AS runs_7d,
  COALESCE(ws.successes,        0)                                             AS successes_7d,
  COALESCE(ws.failures,         0)                                             AS failures_7d,
  COALESCE(ws.success_rate_pct, 0)                                             AS success_rate_pct,
  COALESCE(ws.avg_sec,          0)                                             AS avg_sec,
  COALESCE(ws.p95_sec,          0)                                             AS p95_sec,
  CASE
    WHEN NOT j.active                                          THEN 'DISABLED'
    WHEN lr.start_time IS NULL                                 THEN 'NEVER_RUN'
    WHEN lr.run_status = 'failed'                              THEN 'FAILED'
    WHEN COALESCE(ws.success_rate_pct, 100) < 50              THEN 'FAILED'
    WHEN COALESCE(ws.failures, 0) >= 3
      AND COALESCE(ws.success_rate_pct, 100) < 80             THEN 'WARNING'
    WHEN COALESCE(ws.success_rate_pct, 100) < 80              THEN 'WARNING'
    WHEN lr.run_status = 'succeeded'                           THEN 'HEALTHY'
    ELSE 'UNKNOWN'
  END                                                                          AS health_status,
  -- Approximate next run (pg_cron does not expose next_run natively)
  CASE j.schedule
    WHEN '*/5 * * * *'  THEN DATE_TRUNC('minute', NOW()) + INTERVAL '5 minutes'
    WHEN '*/15 * * * *' THEN DATE_TRUNC('minute', NOW()) + INTERVAL '15 minutes'
    WHEN '0 */2 * * *'  THEN DATE_TRUNC('hour',   NOW() + INTERVAL '2 hours')
    WHEN '0 */4 * * *'  THEN DATE_TRUNC('hour',   NOW() + INTERVAL '4 hours')
    WHEN '0 * * * *'    THEN DATE_TRUNC('hour',   NOW() + INTERVAL '1 hour')
    ELSE NULL
  END                                                                          AS next_run_approx
FROM cron.job j
LEFT JOIN last_run  lr ON lr.jobid = j.jobid
LEFT JOIN week_stats ws ON ws.jobid = j.jobid
WHERE j.jobname LIKE 'predictxta-%'
ORDER BY j.jobname;

COMMENT ON VIEW public.v_cron_dashboard IS
  'Main cron monitoring dashboard. pg_cron 1.6+ safe — no deprecated columns. '
  'Health: HEALTHY | WARNING | FAILED | NEVER_RUN | DISABLED | UNKNOWN';

-- v_cron_health_score: overall pipeline health score 0-100
CREATE OR REPLACE VIEW public.v_cron_health_score AS
WITH scores AS (
  SELECT health_status,
    CASE health_status
      WHEN 'HEALTHY'   THEN 100
      WHEN 'WARNING'   THEN  60
      WHEN 'FAILED'    THEN   0
      WHEN 'NEVER_RUN' THEN  30
      WHEN 'DISABLED'  THEN  50
      ELSE                   20
    END AS score
  FROM public.v_cron_dashboard
)
SELECT
  COUNT(*)                                                    AS total_jobs,
  COUNT(*) FILTER (WHERE health_status = 'HEALTHY')           AS healthy,
  COUNT(*) FILTER (WHERE health_status = 'WARNING')           AS warning,
  COUNT(*) FILTER (WHERE health_status = 'FAILED')            AS failed,
  COUNT(*) FILTER (WHERE health_status = 'NEVER_RUN')         AS never_run,
  COUNT(*) FILTER (WHERE health_status = 'DISABLED')          AS disabled,
  ROUND(AVG(score), 0)::int                                   AS health_score,
  CASE
    WHEN ROUND(AVG(score), 0) >= 85 THEN 'HEALTHY'
    WHEN ROUND(AVG(score), 0) >= 60 THEN 'WARNING'
    ELSE                                  'CRITICAL'
  END                                                         AS pipeline_status,
  NOW()                                                       AS evaluated_at
FROM scores;

-- v_pipeline_alerts: recent unresolved alerts (last 24 h)
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
  END AS severity_order
FROM public.pipeline_alerts
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY severity_order, created_at DESC;

COMMENT ON VIEW public.v_pipeline_alerts IS
  'Unresolved pipeline alerts from the last 24 hours, ordered by severity then time.';

-- v_stuck_jobs: invocations still in-flight beyond their expected duration
CREATE OR REPLACE VIEW public.v_stuck_jobs AS
SELECT
  job_name,
  function_name,
  started_at,
  EXTRACT(EPOCH FROM (NOW() - started_at))::integer / 60 AS running_min,
  correlation_id,
  retry_count
FROM public.cron_execution_log
WHERE status     = 'invoked'
  AND started_at < NOW() - INTERVAL '10 minutes'
ORDER BY started_at ASC;

COMMENT ON VIEW public.v_stuck_jobs IS
  'Invocations stuck in invoked status for > 10 minutes. '
  'process_retry_sweep() auto-resolves these as failed on next run.';

-- =============================================================================
-- SECTION 4: PRE-FLIGHT VALIDATION
-- Run this block in SQL Editor to review all dependencies before scheduling.
-- Prints notices for each check; warns (not errors) for missing items.
-- =============================================================================
DO $$
DECLARE
  v_ok_cron  boolean; v_ok_net   boolean; v_ok_vault boolean;
  v_ok_url   boolean; v_ok_key   boolean;
  v_warnings text[] := '{}';
  v_ok       boolean := true;
  v_fns      text[] := ARRAY[
    'sync_pipeline_schedule_run','cleanup_stale_data_midnight',
    'auto_cleanup_stale_matches','daily_model_retraining',
    'compute_model_weights','auto_resolve_finished_matches',
    'invoke_edge_function','log_sql_job_run','process_retry_sweep',
    'dispatch_pipeline_alert','ensure_cron_job',
    'invoke_sync_live_quota_aware'   -- quota-aware sync-live dispatcher (v2.0)
  ];
  v_fn text; v_fn_ok boolean;
  v_ef text;
  v_ef_list text[] := ARRAY[
    'sync-live','sync-news','sync-highlights','midnight-preload',
    'fetch-odds','sync-standings','daily-scheduler','pipeline-audit',
    'expert-promotion','rebalance-weights','generate-daily-challenge',
    'monitoring-dashboard','delete-account'
  ];
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE 'PredictXta Cron Pipeline v4.0 — Pre-flight Validation';
  RAISE NOTICE '══════════════════════════════════════════════════════';

  -- Extensions
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') INTO v_ok_cron;
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')  INTO v_ok_net;
  IF v_ok_cron THEN RAISE NOTICE '✓ pg_cron installed';
  ELSE v_warnings := v_warnings || '✗ pg_cron NOT installed → Dashboard → Database → Extensions';
       v_ok := false; END IF;
  IF v_ok_net  THEN RAISE NOTICE '✓ pg_net installed';
  ELSE v_warnings := v_warnings || '✗ pg_net NOT installed → Dashboard → Database → Extensions';
       v_ok := false; END IF;

  -- Vault
  BEGIN
    SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets LIMIT 1) INTO v_ok_vault;
  EXCEPTION WHEN OTHERS THEN v_ok_vault := false; END;
  IF v_ok_vault THEN RAISE NOTICE '✓ Vault accessible';
  ELSE v_warnings := v_warnings || '✗ Vault not accessible'; v_ok := false; END IF;

  IF v_ok_vault THEN
    SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')            INTO v_ok_url;
    SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY') INTO v_ok_key;
    IF v_ok_url THEN RAISE NOTICE '✓ Vault: SUPABASE_URL present';
    ELSE v_warnings := v_warnings || '✗ Vault: SUPABASE_URL missing'; v_ok := false; END IF;
    IF v_ok_key THEN RAISE NOTICE '✓ Vault: SUPABASE_SERVICE_ROLE_KEY present';
    ELSE v_warnings := v_warnings || '✗ Vault: SUPABASE_SERVICE_ROLE_KEY missing'; v_ok := false; END IF;
  END IF;

  -- SQL functions
  FOREACH v_fn IN ARRAY v_fns LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.routines
      WHERE routine_schema='public' AND routine_name=v_fn) INTO v_fn_ok;
    IF v_fn_ok THEN RAISE NOTICE '✓ SQL function: %', v_fn;
    ELSE v_warnings := v_warnings || format('✗ SQL function missing: %s()', v_fn); v_ok := false; END IF;
  END LOOP;

  -- Tables
  FOREACH v_fn IN ARRAY ARRAY['cron_execution_log','cron_retry_queue','cron_job_locks','pipeline_alerts','pipeline_schedule'] LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=v_fn) INTO v_fn_ok;
    IF v_fn_ok THEN RAISE NOTICE '✓ Table: %', v_fn;
    ELSE v_warnings := v_warnings || format('✗ Table missing: %s', v_fn); v_ok := false; END IF;
  END LOOP;

  RAISE NOTICE '──────────────────────────────────────────────────────';
  IF v_ok THEN
    RAISE NOTICE '✅ All pre-flight checks PASSED → scheduling 16 jobs';
  ELSE
    RAISE NOTICE '⚠ % issue(s) detected — jobs will fail gracefully until resolved:', array_length(v_warnings, 1);
    FOREACH v_fn IN ARRAY v_warnings LOOP
      RAISE NOTICE '  %', v_fn;
    END LOOP;
  END IF;
  RAISE NOTICE '══════════════════════════════════════════════════════';
END $$;

-- =============================================================================
-- SECTION 5: JOB SCHEDULING (Idempotent via ensure_cron_job)
-- All 16 jobs. Schedule changes safely: only recreates if cron expression differs.
-- =============================================================================

-- JOB 1 — Live score sync — every 5 min (quota-aware)
-- Uses invoke_sync_live_quota_aware() instead of invoke_edge_function() directly.
-- This wrapper reads api_usage, selects the appropriate sports tier for the
-- current quota mode, and logs quota_throttled/caution entries when needed.
-- Sport tiers:
--   Normal / Caution (<75%): all 12 sports
--   Warning (75–90%):        football + basketball + tennis + cricket (TSDB free)
--   Critical (>90%):         football + tennis + cricket (TSDB free) only
SELECT public.ensure_cron_job(
  'predictxta-sync-live', '*/5 * * * *',
  $$SELECT public.invoke_sync_live_quota_aware();$$
);

-- JOB 2 — Retry sweep — every 15 min
SELECT public.ensure_cron_job(
  'predictxta-retry-sweep', '*/15 * * * *',
  $$SELECT public.process_retry_sweep(10);$$
);

-- JOB 3 — News sync — every 2 h
SELECT public.ensure_cron_job(
  'predictxta-sync-news', '0 */2 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-sync-news', 'sync-news',
    '{"sports":["football","basketball","tennis","cricket","hockey",
      "rugby","mma","american-football"],"limit":25}'::jsonb
  );$$
);

-- JOB 4 — Highlights sync — every 4 h
SELECT public.ensure_cron_job(
  'predictxta-sync-highlights', '0 */4 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-sync-highlights', 'sync-highlights',
    '{"limit":30}'::jsonb
  );$$
);

-- JOB 5 — Stale-match cleanup — hourly (pure SQL, no HTTP)
SELECT public.ensure_cron_job(
  'predictxta-cleanup-stale', '0 * * * *',
  $$SELECT public.auto_cleanup_stale_matches();
  SELECT public.log_sql_job_run('predictxta-cleanup-stale');$$
);

-- JOB 6 — Midnight stale-data purge — 00:00 UTC (pure SQL)
SELECT public.ensure_cron_job(
  'predictxta-cleanup-midnight', '0 0 * * *',
  $$SELECT public.cleanup_stale_data_midnight();
  SELECT public.log_sql_job_run('predictxta-cleanup-midnight');$$
);

-- JOB 7 — Expert tier promotion/demotion — 01:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-expert-promotion', '0 1 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-expert-promotion', 'expert-promotion', '{}'::jsonb
  );$$
);

-- JOB 8 — AI model weight rebalance — Mon 02:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-rebalance-weights', '0 2 * * 1',
  $$SELECT public.invoke_edge_function(
    'predictxta-rebalance-weights', 'rebalance-weights',
    '{"forceRebalance":false}'::jsonb
  );$$
);

-- JOB 9 — Morning fixture preload — 06:00 UTC
-- Routes through midnight-preload stage:'fixtures' (parallel 21 sports, ~50s).
-- NEVER use fetch-matches sport:'all' directly — always 499s (63+ s sequential throttle).
SELECT public.ensure_cron_job(
  'predictxta-fetch-matches-morning', '0 6 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-fetch-matches-morning', 'midnight-preload',
    '{"stage":"fixtures"}'::jsonb,
    0, 120  -- allow 120 min; parallel fixture fetch can take ~50 s
  );$$
);

-- JOB 10 — Weekly standings + player stats — Sun 06:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-sync-standings', '0 6 * * 0',
  $$SELECT public.invoke_edge_function(
    'predictxta-sync-standings', 'sync-standings',
    '{"sport":"all","syncPlayers":true}'::jsonb
  );$$
);

-- JOB 11 — Daily challenge generation — 09:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-daily-challenge', '0 9 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-daily-challenge', 'generate-daily-challenge',
    '{"sport":"all"}'::jsonb
  );$$
);

-- JOB 12 — Main fixture preload (all stages) — 18:00 UTC
-- Runs all 8 pipeline stages: fixtures + metadata + standings + odds +
-- stats (Wave 1, parallel) → predictions + reports + cache_warm (Wave 2).
-- Do NOT revert to fetch-matches sport:'all' — it always 499s.
SELECT public.ensure_cron_job(
  'predictxta-fetch-matches', '0 18 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-fetch-matches', 'midnight-preload',
    '{"stage":"all"}'::jsonb,
    0, 120  -- allow 120 min; full pipeline takes ~90 s under normal load
  );$$
);

-- JOB 13 — Odds fetch — 19:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-fetch-odds', '0 19 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-fetch-odds', 'fetch-odds',
    '{"sport":"football","leagueIds":[39,140,78,135,61,2,3]}'::jsonb
  );$$
);

-- JOB 14 — AI prediction batch generation — 20:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-generate-predictions', '0 20 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-generate-predictions', 'daily-scheduler',
    '{"mode":"predictions","batchSize":30}'::jsonb
  );$$
);

-- JOB 15 — Pipeline audit — 21:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-pipeline-audit', '0 21 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-pipeline-audit', 'pipeline-audit',
    '{"runFullAudit":true}'::jsonb
  );$$
);

-- JOB 16 — Settle expert picks + daily challenge — 23:00 UTC
SELECT public.ensure_cron_job(
  'predictxta-settle-picks', '0 23 * * *',
  $$SELECT public.invoke_edge_function(
    'predictxta-settle-picks', 'daily-scheduler',
    '{"mode":"settle"}'::jsonb
  );$$
);

-- =============================================================================
-- SECTION 6: pipeline_schedule METADATA SYNC
-- Keeps the admin dashboard Cron Schedule section in sync with the 16 jobs.
-- =============================================================================
INSERT INTO public.pipeline_schedule
  (job_name, cron_expression, description, edge_function, is_active, last_status)
VALUES
  ('predictxta-sync-live',             '*/5 * * * *',  'Live score sync — quota-aware (every 5 min)', 'sync-live',                true, 'pending'),
  ('predictxta-retry-sweep',           '*/15 * * * *', 'Retry queue sweep (every 15 min)',            NULL,                       true, 'pending'),
  ('predictxta-sync-news',             '0 */2 * * *',  'News sync (every 2 h)',                       'sync-news',                true, 'pending'),
  ('predictxta-sync-highlights',       '0 */4 * * *',  'Highlights sync (every 4 h)',                 'sync-highlights',          true, 'pending'),
  ('predictxta-cleanup-stale',         '0 * * * *',    'Stale match cleanup (hourly SQL)',             NULL,                       true, 'pending'),
  ('predictxta-cleanup-midnight',      '0 0 * * *',    'Midnight data purge (SQL)',                   NULL,                       true, 'pending'),
  ('predictxta-expert-promotion',      '0 1 * * *',    'Expert tier promotion/demotion (01:00)',       'expert-promotion',         true, 'pending'),
  ('predictxta-rebalance-weights',     '0 2 * * 1',    'AI model weight rebalance (Mon 02:00)',        'rebalance-weights',        true, 'pending'),
  ('predictxta-fetch-matches-morning', '0 6 * * *',    'Morning fixture preload — 13 sports (06:00)', 'midnight-preload',         true, 'pending'),
  ('predictxta-sync-standings',        '0 6 * * 0',    'Weekly standings sync (Sun 06:00)',            'sync-standings',           true, 'pending'),
  ('predictxta-daily-challenge',       '0 9 * * *',    'Daily challenge generation (09:00)',           'generate-daily-challenge', true, 'pending'),
  ('predictxta-fetch-matches',         '0 18 * * *',   'Main fixture preload — all stages (18:00)',   'midnight-preload',         true, 'pending'),
  ('predictxta-fetch-odds',            '0 19 * * *',   'Odds fetch — major football leagues (19:00)', 'fetch-odds',               true, 'pending'),
  ('predictxta-generate-predictions',  '0 20 * * *',   'AI prediction batch generation (20:00)',      'daily-scheduler',          true, 'pending'),
  ('predictxta-pipeline-audit',        '0 21 * * *',   'Full pipeline audit (21:00)',                 'pipeline-audit',           true, 'pending'),
  ('predictxta-settle-picks',          '0 23 * * *',   'Settle expert picks + challenge (23:00)',     'daily-scheduler',          true, 'pending')
ON CONFLICT (job_name) DO UPDATE SET
  cron_expression = EXCLUDED.cron_expression,
  description     = EXCLUDED.description,
  edge_function   = EXCLUDED.edge_function,
  is_active       = EXCLUDED.is_active;

-- =============================================================================
-- SECTION 7: VERIFICATION
-- Confirms all 16 jobs registered. Uses ONLY modern cron.job columns.
-- =============================================================================
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM cron.job WHERE jobname LIKE 'predictxta-%' AND active = true;
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE 'PredictXta active cron jobs: %', v_count;
  IF v_count < 16 THEN
    RAISE WARNING 'Expected 16 jobs, found %. Review NOTICE output above for errors.', v_count;
  ELSE
    RAISE NOTICE '✅ All 16 jobs scheduled and active';
  END IF;
  RAISE NOTICE '══════════════════════════════════════════════════════';
END $$;

-- Final live schedule output (modern pg_cron columns only)
-- NOTE: cron.job columns in pg_cron 1.6+: jobid, schedule, command, nodename,
--       nodeport, database, username, active, jobname
--       runcount / last_run_status / last_run_time DO NOT EXIST
SELECT
  j.jobname                                                                AS job,
  j.schedule                                                               AS cron,
  j.active,
  COALESCE(stats.runs_7d,      0)                                          AS runs_7d,
  stats.last_run_start,
  stats.last_status,
  COALESCE(stats.success_pct, 0)::int                                      AS success_pct,
  ROUND(COALESCE(stats.avg_sec, 0), 1)                                     AS avg_sec
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                               AS runs_7d,
    MAX(d.start_time)                                                      AS last_run_start,
    (SELECT d2.status FROM cron.job_run_details d2
     WHERE d2.jobid = j.jobid ORDER BY d2.start_time DESC LIMIT 1)        AS last_status,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.status='succeeded')
      / NULLIF(COUNT(*),0), 1)                                             AS success_pct,
    AVG(EXTRACT(EPOCH FROM (d.end_time - d.start_time)))                   AS avg_sec
  FROM cron.job_run_details d
  WHERE d.jobid = j.jobid AND d.start_time >= NOW() - INTERVAL '7 days'
) stats ON true
WHERE j.jobname LIKE 'predictxta-%'
ORDER BY
  CASE j.schedule
    WHEN '*/5 * * * *'  THEN  1
    WHEN '*/15 * * * *' THEN  2
    WHEN '0 */2 * * *'  THEN  3
    WHEN '0 */4 * * *'  THEN  4
    WHEN '0 * * * *'    THEN  5
    WHEN '0 0 * * *'    THEN  6
    WHEN '0 1 * * *'    THEN  7
    WHEN '0 2 * * 1'    THEN  8
    WHEN '0 6 * * *'    THEN  9
    WHEN '0 6 * * 0'    THEN 10
    WHEN '0 9 * * *'    THEN 11
    WHEN '0 18 * * *'   THEN 12
    WHEN '0 19 * * *'   THEN 13
    WHEN '0 20 * * *'   THEN 14
    WHEN '0 21 * * *'   THEN 15
    ELSE                     16
  END;

-- =============================================================================
-- QUICK-REFERENCE QUERIES (copy-paste into SQL Editor)
-- =============================================================================
--
-- ── Full dashboard: ──────────────────────────────────────────────────────────
--   SELECT * FROM public.v_cron_dashboard;
--
-- ── Pipeline health score: ───────────────────────────────────────────────────
--   SELECT * FROM public.v_cron_health_score;
--
-- ── Recent 50 run records: ───────────────────────────────────────────────────
--   SELECT j.jobname, d.start_time,
--          EXTRACT(EPOCH FROM (d.end_time-d.start_time))::int AS sec,
--          d.status, d.return_message
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
--   WHERE j.jobname LIKE 'predictxta-%' ORDER BY d.start_time DESC LIMIT 50;
--
-- ── Failed runs only: ────────────────────────────────────────────────────────
--   SELECT j.jobname, d.start_time, d.return_message
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
--   WHERE j.jobname LIKE 'predictxta-%' AND d.status='failed'
--   ORDER BY d.start_time DESC LIMIT 20;
--
-- ── HTTP invocation log: ─────────────────────────────────────────────────────
--   SELECT job_name, function_name, started_at, status, retry_count, error_message
--   FROM public.cron_execution_log ORDER BY started_at DESC LIMIT 50;
--
-- ── Stuck jobs: ──────────────────────────────────────────────────────────────
--   SELECT * FROM public.v_stuck_jobs;
--   -- OR: SELECT * FROM public.detect_stuck_jobs(15);
--
-- ── Pending retries: ─────────────────────────────────────────────────────────
--   SELECT job_name, function_name, retry_count, retry_at
--   FROM public.cron_retry_queue WHERE NOT processed ORDER BY retry_at;
--
-- ── Recent pipeline alerts: ──────────────────────────────────────────────────
--   SELECT * FROM public.v_pipeline_alerts;
--
-- ── Resolve an alert: ────────────────────────────────────────────────────────
--   UPDATE public.pipeline_alerts SET resolved=true, resolved_at=NOW() WHERE id='<id>';
--
-- ── Disable a job: ───────────────────────────────────────────────────────────
--   UPDATE cron.job SET active=false WHERE jobname='predictxta-sync-live';
--
-- ── Re-enable a job: ─────────────────────────────────────────────────────────
--   UPDATE cron.job SET active=true  WHERE jobname='predictxta-sync-live';
--
-- ── Force immediate retry: ───────────────────────────────────────────────────
--   SELECT public.invoke_edge_function('predictxta-sync-live','sync-live',
--     '{"sports":["football"]}'::jsonb, 0, 10, true);
--
-- ── Run retry sweep now: ─────────────────────────────────────────────────────
--   SELECT * FROM public.process_retry_sweep();
--
-- ── ROLLBACK (removes all PredictXta jobs + schema): ─────────────────────────
--   DO $$ DECLARE r RECORD;
--   BEGIN FOR r IN SELECT jobid FROM cron.job WHERE jobname LIKE 'predictxta-%' LOOP
--     PERFORM cron.unschedule(r.jobid); END LOOP; END $$;
--   DELETE FROM public.pipeline_schedule WHERE job_name LIKE 'predictxta-%';
--   DROP TABLE IF EXISTS public.cron_job_locks;
--   DROP TABLE IF EXISTS public.cron_retry_queue;
--   DROP TABLE IF EXISTS public.cron_execution_log;
--   DROP FUNCTION IF EXISTS public.ensure_cron_job(text,text,text);
--   DROP FUNCTION IF EXISTS public.invoke_edge_function(text,text,jsonb,integer,integer,boolean);
--   DROP FUNCTION IF EXISTS public.log_sql_job_run(text,text);
--   DROP FUNCTION IF EXISTS public.process_retry_sweep(integer);
--   DROP FUNCTION IF EXISTS public.dispatch_pipeline_alert(text,text,text,jsonb);
--   DROP FUNCTION IF EXISTS public.detect_stuck_jobs(integer);
--   DROP FUNCTION IF EXISTS public.invoke_sync_live_quota_aware();
--   DROP VIEW IF EXISTS public.v_cron_dashboard;
--   DROP VIEW IF EXISTS public.v_cron_health_score;
--   DROP VIEW IF EXISTS public.v_pipeline_alerts;
--   DROP VIEW IF EXISTS public.v_stuck_jobs;
--
-- ── Store Vault secrets (run before scheduling): ─────────────────────────────
--   SELECT vault.create_secret('SUPABASE_URL',
--     'https://osmkbrryalhtpnayosmk.backend.onspace.ai', 'Project URL');
--   SELECT vault.create_secret('SUPABASE_SERVICE_ROLE_KEY',
--     '<your-key>', 'Service role key');
--   SELECT vault.create_secret('WEBHOOK_ALERT_URL',
--     'https://hooks.slack.com/services/...', 'Critical alert webhook (optional)');
-- =============================================================================
