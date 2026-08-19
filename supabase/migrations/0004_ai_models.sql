-- =============================================================================
-- Migration 0004: AI Model Registry & Audit Tables
-- PredictXta — model_registry, ai_audit_logs, prediction_outcomes.
-- =============================================================================

-- ─── Model Registry ───────────────────────────────────────────────────────────
-- Canonical 4-provider AI model registry: gpt55, claude, gemini, llama
CREATE TABLE IF NOT EXISTS public.model_registry (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            text        NOT NULL UNIQUE,
  display_name        text        NOT NULL,
  provider            text        NOT NULL,
  current_weight      numeric(4,3) DEFAULT 0.800,
  rolling_accuracy    numeric(5,2) DEFAULT 0,
  brier_score         numeric(8,6) DEFAULT 0.25,
  total_predictions   integer     DEFAULT 0,
  correct_predictions integer     DEFAULT 0,
  calibration_drift   numeric(5,2) DEFAULT 0,
  drift_warning       boolean     DEFAULT false,
  last_retrained_at   timestamptz,
  is_active           boolean     DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_registry_active_idx ON public.model_registry(is_active) WHERE is_active = true;

ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_registry' AND policyname='authenticated_select_model_registry') THEN
    CREATE POLICY authenticated_select_model_registry ON public.model_registry FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_registry' AND policyname='authenticated_insert_model_registry') THEN
    CREATE POLICY authenticated_insert_model_registry ON public.model_registry FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_registry' AND policyname='authenticated_update_model_registry') THEN
    CREATE POLICY authenticated_update_model_registry ON public.model_registry FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed canonical 4-provider model set (idempotent)
INSERT INTO public.model_registry (model_id, display_name, provider, current_weight, is_active)
VALUES
  ('gpt55',  'GPT-5.5',            'OpenAI',    1.000, true),
  ('claude', 'Claude (Anthropic)', 'Anthropic', 0.970, true),
  ('gemini', 'Gemini 2.5 Flash',   'Google',    0.900, true),
  ('llama',  'Llama 4 (Groq)',      'Meta/Groq', 0.820, true)
ON CONFLICT (model_id) DO UPDATE
  SET display_name   = EXCLUDED.display_name,
      provider       = EXCLUDED.provider,
      current_weight = EXCLUDED.current_weight,
      is_active      = EXCLUDED.is_active,
      updated_at     = now();

-- Deactivate legacy model IDs
UPDATE public.model_registry
SET is_active = false, updated_at = now()
WHERE model_id IN ('gpt41', 'gpt4mini', 'gpt4mini-verify', 'groq', 'onspace')
  AND model_id NOT IN ('gpt55', 'claude', 'gemini', 'llama');

-- ─── AI Audit Logs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_audit_logs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              uuid        REFERENCES public.matches(id) ON DELETE SET NULL,
  user_id               uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  session_id            text,
  provider_code         text        NOT NULL DEFAULT 'unknown',
  function_name         text        NOT NULL,
  prompt_version        integer     NOT NULL DEFAULT 1,
  prediction_version    integer,
  facts_object          jsonb,
  pre_validation_passed  boolean    NOT NULL DEFAULT false,
  post_validation_passed boolean    NOT NULL DEFAULT false,
  hallucination_score   integer     DEFAULT 0,
  consensus_passed      boolean     NOT NULL DEFAULT false,
  approval_status       text        NOT NULL DEFAULT 'pending',
  dq_score              integer,
  confidence_output     integer,
  risk_level            text,
  output_tokens         integer,
  latency_ms            integer,
  warning_flags         text[]      DEFAULT '{}',
  rejection_reason      text,
  created_at            timestamptz DEFAULT now(),
  enrichment_pct        integer     DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ai_audit_match_id_idx   ON public.ai_audit_logs(match_id);
CREATE INDEX IF NOT EXISTS ai_audit_user_id_idx    ON public.ai_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS ai_audit_created_at_idx ON public.ai_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_function_idx   ON public.ai_audit_logs(function_name);
CREATE INDEX IF NOT EXISTS ai_audit_approval_idx   ON public.ai_audit_logs(approval_status);

ALTER TABLE public.ai_audit_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_audit_logs' AND policyname='authenticated_select_ai_audit') THEN
    CREATE POLICY authenticated_select_ai_audit ON public.ai_audit_logs FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_audit_logs' AND policyname='authenticated_insert_ai_audit') THEN
    CREATE POLICY authenticated_insert_ai_audit ON public.ai_audit_logs FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_audit_logs' AND policyname='authenticated_update_ai_audit') THEN
    CREATE POLICY authenticated_update_ai_audit ON public.ai_audit_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── Prediction Outcomes (Brier Score Tracking) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.prediction_outcomes (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id            uuid        REFERENCES public.predictions(id) ON DELETE CASCADE,
  match_id                 uuid        REFERENCES public.matches(id) ON DELETE SET NULL,
  sport                    text        NOT NULL DEFAULT 'football',
  predicted_result         text        NOT NULL,
  actual_result            text        NOT NULL,
  is_correct               boolean     NOT NULL,
  home_score_predicted     numeric(4,1),
  away_score_predicted     numeric(4,1),
  home_score_actual        integer,
  away_score_actual        integer,
  error_margin             numeric(6,3),
  confidence_at_prediction integer,
  model_version            integer,
  brier_score              numeric(8,6),
  prediction_version       integer,
  resolved_at              timestamptz DEFAULT now(),
  created_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pred_outcomes_match_idx          ON public.prediction_outcomes(match_id);
CREATE INDEX IF NOT EXISTS pred_outcomes_sport_idx          ON public.prediction_outcomes(sport);
CREATE INDEX IF NOT EXISTS pred_outcomes_correct_idx        ON public.prediction_outcomes(is_correct);
CREATE INDEX IF NOT EXISTS pred_outcomes_resolved_idx       ON public.prediction_outcomes(resolved_at DESC);
CREATE INDEX IF NOT EXISTS pred_outcomes_sport_correct_idx  ON public.prediction_outcomes(sport, is_correct);
CREATE INDEX IF NOT EXISTS pred_outcomes_resolved_sport_idx ON public.prediction_outcomes(resolved_at DESC, sport);

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prediction_outcomes' AND policyname='anon_select_outcomes') THEN
    CREATE POLICY anon_select_outcomes          ON public.prediction_outcomes FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prediction_outcomes' AND policyname='authenticated_select_outcomes') THEN
    CREATE POLICY authenticated_select_outcomes ON public.prediction_outcomes FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prediction_outcomes' AND policyname='authenticated_insert_outcomes') THEN
    CREATE POLICY authenticated_insert_outcomes ON public.prediction_outcomes FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prediction_outcomes' AND policyname='authenticated_update_outcomes') THEN
    CREATE POLICY authenticated_update_outcomes ON public.prediction_outcomes FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── Model Performance Log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.model_performance_log (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_date            text        NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  model_id               text        NOT NULL,
  sport                  text        NOT NULL DEFAULT 'all',
  total_predictions      integer     NOT NULL DEFAULT 0,
  correct_predictions    integer     NOT NULL DEFAULT 0,
  accuracy_pct           numeric(5,2) GENERATED ALWAYS AS (
    CASE WHEN total_predictions > 0
      THEN round((correct_predictions::numeric / total_predictions::numeric) * 100, 2)
      ELSE 0
    END
  ) STORED,
  avg_confidence         numeric(5,2),
  avg_latency_ms         integer,
  avg_hallucination_score numeric(5,2),
  consensus_weight       numeric(4,3) DEFAULT 0.800,
  weight_adjusted        boolean     DEFAULT false,
  notes                  text,
  created_at             timestamptz DEFAULT now(),
  UNIQUE(logged_date, model_id, sport)
);

CREATE INDEX IF NOT EXISTS model_perf_date_idx  ON public.model_performance_log(logged_date DESC);
CREATE INDEX IF NOT EXISTS model_perf_model_idx ON public.model_performance_log(model_id);
CREATE INDEX IF NOT EXISTS model_perf_sport_idx ON public.model_performance_log(sport);

ALTER TABLE public.model_performance_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_performance_log' AND policyname='authenticated_select_model_perf') THEN
    CREATE POLICY authenticated_select_model_perf ON public.model_performance_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_performance_log' AND policyname='authenticated_insert_model_perf') THEN
    CREATE POLICY authenticated_insert_model_perf ON public.model_performance_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='model_performance_log' AND policyname='authenticated_update_model_perf') THEN
    CREATE POLICY authenticated_update_model_perf ON public.model_performance_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
