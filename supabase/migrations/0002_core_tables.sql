-- =============================================================================
-- Migration 0002: Core Match & Sports Tables
-- PredictXta — user_profiles, matches, odds, predictions.
-- Uses CREATE TABLE IF NOT EXISTS throughout — safe for existing databases.
-- =============================================================================

-- ─── User Profiles ────────────────────────────────────────────────────────────
-- Synced from auth.users via handle_new_user trigger.
-- Do NOT use auth.users directly in application queries.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                 uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username           text,
  email              text        NOT NULL,
  push_token         text,
  avatar_url         text,
  preferred_language text        DEFAULT 'en',
  country_code       text,
  device_locale      text
);

CREATE INDEX IF NOT EXISTS user_profiles_push_token_idx ON public.user_profiles(push_token)
  WHERE push_token IS NOT NULL;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_profiles' AND policyname='Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON public.user_profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_profiles' AND policyname='Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_profiles' AND policyname='Users can delete own profile') THEN
    CREATE POLICY "Users can delete own profile" ON public.user_profiles FOR DELETE USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_profiles' AND policyname='authenticated_select_all_profiles') THEN
    CREATE POLICY "authenticated_select_all_profiles" ON public.user_profiles FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ─── Matches ──────────────────────────────────────────────────────────────────
-- Canonical sport values (13): football, basketball, tennis, cricket, baseball,
-- hockey, rugby, american-football, mma, boxing, volleyball, handball, esports
CREATE TABLE IF NOT EXISTS public.matches (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sport                text        NOT NULL,
  home_team            text        NOT NULL,
  away_team            text        NOT NULL,
  home_score           integer     DEFAULT 0,
  away_score           integer     DEFAULT 0,
  status               text        DEFAULT 'upcoming',   -- upcoming|live|finished|cancelled|postponed
  match_time           timestamptz NOT NULL DEFAULT now(),
  league               text,
  home_logo            text,
  away_logo            text,
  venue                text,
  minute               integer     DEFAULT 0,
  created_at           timestamptz DEFAULT now(),
  stats                jsonb,
  league_id            integer,
  external_id          text        UNIQUE,               -- namespaced: "provider:id"
  league_logo          text,
  source_provider      text        DEFAULT 'api-football',
  last_updated         timestamptz DEFAULT now(),
  home_form            text[]      DEFAULT '{}',
  away_form            text[]      DEFAULT '{}',
  round                text,
  country              text,
  venue_info           jsonb,
  unified_match_id     text,
  canonical_home_team  text,
  canonical_away_team  text,
  canonical_league     text,
  data_integrity_flags jsonb       DEFAULT '{}'
);

-- Core access pattern indexes
CREATE INDEX IF NOT EXISTS matches_sport_status_idx         ON public.matches(sport, status);
CREATE INDEX IF NOT EXISTS matches_sport_status_time_idx    ON public.matches(sport, status, match_time);
CREATE INDEX IF NOT EXISTS matches_match_time_status_idx    ON public.matches(match_time, status);
CREATE INDEX IF NOT EXISTS matches_match_time_sport_status_idx ON public.matches(match_time, sport, status);
CREATE INDEX IF NOT EXISTS matches_status_sport_time_idx    ON public.matches(status, sport, match_time);
CREATE INDEX IF NOT EXISTS matches_last_updated_idx         ON public.matches(last_updated DESC);
CREATE INDEX IF NOT EXISTS matches_unified_match_id_idx     ON public.matches(unified_match_id) WHERE unified_match_id IS NOT NULL;
-- Partial indexes for frequent filtered queries
CREATE INDEX IF NOT EXISTS matches_live_sport_minute_idx    ON public.matches(sport, minute DESC)        WHERE status = 'live';
CREATE INDEX IF NOT EXISTS matches_upcoming_sport_time_idx  ON public.matches(sport, match_time ASC)     WHERE status = 'upcoming';
CREATE INDEX IF NOT EXISTS matches_finished_sport_time_idx  ON public.matches(sport, match_time DESC)    WHERE status = 'finished';
-- Logo lookups (used by logoCache.ts)
CREATE INDEX IF NOT EXISTS matches_home_logo_idx            ON public.matches(home_team) WHERE home_logo IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_away_logo_idx            ON public.matches(away_team) WHERE away_logo IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_league_logo_idx          ON public.matches(league)    WHERE league_logo IS NOT NULL;

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='anon_select_matches') THEN
    CREATE POLICY anon_select_matches          ON public.matches FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='authenticated_select_matches') THEN
    CREATE POLICY authenticated_select_matches ON public.matches FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='authenticated_insert_matches') THEN
    CREATE POLICY authenticated_insert_matches ON public.matches FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='authenticated_update_matches') THEN
    CREATE POLICY authenticated_update_matches ON public.matches FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='authenticated_delete_matches') THEN
    CREATE POLICY authenticated_delete_matches ON public.matches FOR DELETE TO authenticated  USING (true);
  END IF;
END $$;

-- ─── Odds ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.odds (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  external_match_id text        NOT NULL,
  bookmaker         text        NOT NULL DEFAULT 'Bet365',
  home_win          numeric(8,3),
  draw              numeric(8,3),
  away_win          numeric(8,3),
  over_2_5          numeric(8,3),
  under_2_5         numeric(8,3),
  btts_yes          numeric(8,3),
  btts_no           numeric(8,3),
  home_handicap     numeric(8,3),
  away_handicap     numeric(8,3),
  handicap_line     numeric(5,1),
  last_updated      timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE(match_id, bookmaker)
);

CREATE INDEX IF NOT EXISTS odds_match_id_idx           ON public.odds(match_id);
CREATE INDEX IF NOT EXISTS odds_external_match_id_idx  ON public.odds(external_match_id);
CREATE INDEX IF NOT EXISTS odds_match_updated_v2_idx   ON public.odds(match_id, last_updated DESC);

ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='odds' AND policyname='anon_select_odds') THEN
    CREATE POLICY anon_select_odds          ON public.odds FOR SELECT TO anon         USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='odds' AND policyname='authenticated_select_odds') THEN
    CREATE POLICY authenticated_select_odds ON public.odds FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='odds' AND policyname='authenticated_insert_odds') THEN
    CREATE POLICY authenticated_insert_odds ON public.odds FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='odds' AND policyname='authenticated_update_odds') THEN
    CREATE POLICY authenticated_update_odds ON public.odds FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='odds' AND policyname='authenticated_delete_odds') THEN
    CREATE POLICY authenticated_delete_odds ON public.odds FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ─── Predictions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.predictions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                uuid        REFERENCES public.matches(id),
  user_id                 uuid        REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  home_win_prob           numeric     DEFAULT 0,
  draw_prob               numeric     DEFAULT 0,
  away_win_prob           numeric     DEFAULT 0,
  predicted_result        text,
  confidence              numeric     DEFAULT 0,
  over_under              text,
  over_under_line         numeric     DEFAULT 2.5,
  btts                    text,
  ai_analysis             text,
  key_factors             text[],
  created_at              timestamptz DEFAULT now(),
  corners_over_under      text        DEFAULT 'over',
  corners_line            numeric(5,1) DEFAULT 9.5,
  correct_score           text        DEFAULT '1-1',
  ht_result               text,
  ht_home_prob            integer     DEFAULT 0,
  ht_draw_prob            integer     DEFAULT 0,
  ht_away_prob            integer     DEFAULT 0,
  cards_total             numeric(4,1) DEFAULT 3.5,
  cards_over_under        text        DEFAULT 'over',
  asian_handicap_line     numeric(4,1) DEFAULT 0,
  asian_handicap_pick     text        DEFAULT 'home',
  both_score_ht           text        DEFAULT 'no',
  clean_sheet_home        text        DEFAULT 'no',
  clean_sheet_away        text        DEFAULT 'no',
  first_goal              text        DEFAULT 'home',
  anytime_scorecast       text,
  predicted_home_goals    numeric(3,1) DEFAULT 1.5,
  predicted_away_goals    numeric(3,1) DEFAULT 1.2,
  prediction_version      integer     DEFAULT 2,
  risk_level              text        DEFAULT 'Medium',
  value_score             integer     DEFAULT 50,
  market_edge_pct         numeric(5,2) DEFAULT 0,
  sharp_signal            text        DEFAULT 'neutral',
  suggested_stake         text        DEFAULT 'medium',
  warning_flags           text[]      DEFAULT '{}',
  key_alpha_metric        text,
  enrichment_pct          integer     DEFAULT 0,
  quality_gate_score      integer
);

CREATE INDEX IF NOT EXISTS predictions_match_id_created_at_idx    ON public.predictions(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS predictions_match_id_version_idx       ON public.predictions(match_id, prediction_version DESC);
CREATE INDEX IF NOT EXISTS predictions_confidence_v2_idx          ON public.predictions(confidence DESC, created_at DESC) WHERE confidence >= 55;
CREATE INDEX IF NOT EXISTS predictions_match_confidence_v2_idx    ON public.predictions(match_id, confidence DESC);
CREATE INDEX IF NOT EXISTS predictions_version_created_idx        ON public.predictions(prediction_version DESC, created_at DESC);

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='predictions' AND policyname='anon_select_predictions') THEN
    CREATE POLICY anon_select_predictions          ON public.predictions FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='predictions' AND policyname='authenticated_select_predictions') THEN
    CREATE POLICY authenticated_select_predictions ON public.predictions FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='predictions' AND policyname='authenticated_insert_predictions') THEN
    CREATE POLICY authenticated_insert_predictions ON public.predictions FOR INSERT TO authenticated  WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
