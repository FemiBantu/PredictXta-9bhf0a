-- =============================================================================
-- Migration 0006: Core DB Functions & Triggers
-- PredictXta — handle_new_user, add_user_coins, auth sync triggers.
-- =============================================================================

-- ─── Auto-create user_profile on signup ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Sync metadata updates (e.g., username changes) ──────────────────────────
CREATE OR REPLACE FUNCTION public.sync_user_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_profiles
  SET
    email    = COALESCE(NEW.email, email),
    username = COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      username
    )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_metadata();

-- ─── Add coins helper (SECURITY DEFINER — server-side only) ───────────────────
CREATE OR REPLACE FUNCTION public.add_user_coins(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Insert wallet if first time, then increment
  INSERT INTO public.user_coins (user_id, balance)
  VALUES (p_user_id, GREATEST(0, p_amount))
  ON CONFLICT (user_id) DO UPDATE
    SET balance    = public.user_coins.balance + GREATEST(0, p_amount),
        updated_at = now()
  WHERE public.user_coins.user_id = p_user_id;
END;
$$;

-- ─── Auto-cleanup stale live matches ─────────────────────────────────────────
-- Called hourly from pg_cron job predictxta-cleanup-stale.
CREATE OR REPLACE FUNCTION public.auto_cleanup_stale_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE fixed integer;
BEGIN
  WITH stale AS (
    UPDATE public.matches
    SET    status = 'finished', last_updated = now()
    WHERE  status = 'live'
      AND  last_updated < now() - INTERVAL '3 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO fixed FROM stale;
  RETURN fixed;
END;
$$;

-- ─── Cleanup stale data midnight ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_data_midnight()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Remove expired AI cache entries
  DELETE FROM public.ai_intelligence_cache WHERE expires_at < now();
  -- Remove match fetch cache entries older than 24h
  DELETE FROM public.match_fetch_cache WHERE expires_at < now();
END;
$$;

-- ─── Auto-resolve finished matches → prediction outcomes ─────────────────────
CREATE OR REPLACE FUNCTION public.auto_resolve_finished_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE resolved integer := 0;
BEGIN
  WITH to_resolve AS (
    SELECT
      p.id             AS prediction_id,
      p.match_id,
      p.predicted_result,
      p.confidence,
      p.prediction_version,
      m.sport,
      m.home_score,
      m.away_score,
      CASE
        WHEN m.home_score > m.away_score  THEN 'home_win'
        WHEN m.home_score = m.away_score  THEN 'draw'
        ELSE                                   'away_win'
      END AS actual_result
    FROM public.predictions p
    JOIN public.matches m ON m.id = p.match_id
    WHERE m.status = 'finished'
      AND NOT EXISTS (
        SELECT 1 FROM public.prediction_outcomes po
        WHERE po.prediction_id = p.id
      )
    LIMIT 200
  ),
  inserted AS (
    INSERT INTO public.prediction_outcomes
      (prediction_id, match_id, sport, predicted_result, actual_result, is_correct,
       home_score_actual, away_score_actual, confidence_at_prediction, prediction_version)
    SELECT
      prediction_id, match_id, sport, predicted_result, actual_result,
      predicted_result = actual_result,
      home_score, away_score, confidence, prediction_version
    FROM to_resolve
    RETURNING 1
  )
  SELECT COUNT(*) INTO resolved FROM inserted;
  RETURN resolved;
END;
$$;
