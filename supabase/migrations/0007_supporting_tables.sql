-- =============================================================================
-- Migration 0007: Additional Supporting Tables
-- PredictXta — news, highlights, standings, expert system, feed cache.
-- Safe to run on existing databases (CREATE IF NOT EXISTS throughout).
-- =============================================================================

-- ─── News Articles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.news_articles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  text        NOT NULL UNIQUE,
  source       text        NOT NULL DEFAULT 'highlightly',
  sport        text        NOT NULL DEFAULT 'football',
  title        text        NOT NULL,
  summary      text,
  content      text,
  author       text,
  url          text,
  image_url    text,
  tags         text[]      DEFAULT '{}',
  category     text        DEFAULT 'news',
  match_id     uuid        REFERENCES public.matches(id) ON DELETE SET NULL,
  home_team    text,
  away_team    text,
  league       text,
  published_at timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now(),
  like_count   integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS news_sport_published_v2_idx  ON public.news_articles(sport, published_at DESC);
CREATE INDEX IF NOT EXISTS news_articles_category_idx   ON public.news_articles(category);
CREATE INDEX IF NOT EXISTS news_articles_source_idx     ON public.news_articles(source);

ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='news_articles' AND policyname='anon_select_news') THEN
    CREATE POLICY anon_select_news          ON public.news_articles FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='news_articles' AND policyname='authenticated_select_news') THEN
    CREATE POLICY authenticated_select_news ON public.news_articles FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='news_articles' AND policyname='authenticated_insert_news') THEN
    CREATE POLICY authenticated_insert_news ON public.news_articles FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='news_articles' AND policyname='authenticated_update_news') THEN
    CREATE POLICY authenticated_update_news ON public.news_articles FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── League Standings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.league_standings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    integer     NOT NULL,
  league_name  text        NOT NULL,
  season       integer     NOT NULL DEFAULT 2024,
  sport        text        NOT NULL DEFAULT 'football',
  team_name    text        NOT NULL,
  team_logo    text,
  position     integer     NOT NULL DEFAULT 1,
  played       integer     NOT NULL DEFAULT 0,
  wins         integer     NOT NULL DEFAULT 0,
  draws        integer     NOT NULL DEFAULT 0,
  losses       integer     NOT NULL DEFAULT 0,
  goals_for    integer     NOT NULL DEFAULT 0,
  goals_against integer    NOT NULL DEFAULT 0,
  goal_diff    integer     NOT NULL DEFAULT 0,
  points       integer     NOT NULL DEFAULT 0,
  form         text,
  description  text,
  last_updated timestamptz DEFAULT now(),
  UNIQUE(league_id, season, team_name)
);

CREATE INDEX IF NOT EXISTS standings_league_id_idx  ON public.league_standings(league_id);
CREATE INDEX IF NOT EXISTS standings_sport_idx      ON public.league_standings(sport);
CREATE INDEX IF NOT EXISTS standings_league_pos_idx ON public.league_standings(league_id, position);

ALTER TABLE public.league_standings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='league_standings' AND policyname='anon_select_standings') THEN
    CREATE POLICY anon_select_standings          ON public.league_standings FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='league_standings' AND policyname='authenticated_select_standings') THEN
    CREATE POLICY authenticated_select_standings ON public.league_standings FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='league_standings' AND policyname='authenticated_insert_standings') THEN
    CREATE POLICY authenticated_insert_standings ON public.league_standings FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='league_standings' AND policyname='authenticated_update_standings') THEN
    CREATE POLICY authenticated_update_standings ON public.league_standings FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='league_standings' AND policyname='authenticated_delete_standings') THEN
    CREATE POLICY authenticated_delete_standings ON public.league_standings FOR DELETE TO authenticated  USING (true);
  END IF;
END $$;

-- ─── Feed Cache Meta ──────────────────────────────────────────────────────────
-- Per-sport cache freshness tracker. One row per sport + 'all'.
-- Canonical 13 sports + 'all' seeded below.
CREATE TABLE IF NOT EXISTS public.feed_cache_meta (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sport              text        NOT NULL UNIQUE,
  last_generated     timestamptz DEFAULT now(),
  live_count         integer     DEFAULT 0,
  upcoming_count     integer     DEFAULT 0,
  predictions_count  integer     DEFAULT 0
);

ALTER TABLE public.feed_cache_meta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feed_cache_meta' AND policyname='anon_select_feed_cache_meta') THEN
    CREATE POLICY anon_select_feed_cache_meta          ON public.feed_cache_meta FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feed_cache_meta' AND policyname='authenticated_select_feed_cache_meta') THEN
    CREATE POLICY authenticated_select_feed_cache_meta ON public.feed_cache_meta FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feed_cache_meta' AND policyname='authenticated_update_feed_cache_meta') THEN
    CREATE POLICY authenticated_update_feed_cache_meta ON public.feed_cache_meta FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feed_cache_meta' AND policyname='authenticated_upsert_feed_cache_meta') THEN
    CREATE POLICY authenticated_upsert_feed_cache_meta ON public.feed_cache_meta FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
END $$;

-- Seed feed_cache_meta for all 13 canonical sports + 'all'
INSERT INTO public.feed_cache_meta (sport, last_generated, live_count, upcoming_count, predictions_count)
VALUES
  ('all',              now(), 0, 0, 0),
  ('football',         now(), 0, 0, 0),
  ('basketball',       now(), 0, 0, 0),
  ('tennis',           now(), 0, 0, 0),
  ('cricket',          now(), 0, 0, 0),
  ('baseball',         now(), 0, 0, 0),
  ('hockey',           now(), 0, 0, 0),
  ('rugby',            now(), 0, 0, 0),
  ('american-football',now(), 0, 0, 0),
  ('mma',              now(), 0, 0, 0),
  ('boxing',           now(), 0, 0, 0),
  ('volleyball',       now(), 0, 0, 0),
  ('handball',         now(), 0, 0, 0),
  ('esports',          now(), 0, 0, 0)
ON CONFLICT (sport) DO NOTHING;

-- ─── AI Intelligence Cache ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_intelligence_cache (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  content_type    text        NOT NULL DEFAULT 'match_preview',
  content         text        NOT NULL,
  sport           text        NOT NULL DEFAULT 'football',
  facts_hash      text,
  dq_score        integer     DEFAULT 0,
  validation_passed boolean   DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz DEFAULT (now() + INTERVAL '6 hours'),
  UNIQUE(match_id, content_type)
);

CREATE INDEX IF NOT EXISTS ai_intel_cache_match_idx    ON public.ai_intelligence_cache(match_id);
CREATE INDEX IF NOT EXISTS ai_intel_cache_expires_idx  ON public.ai_intelligence_cache(expires_at) WHERE expires_at > now();

ALTER TABLE public.ai_intelligence_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_intelligence_cache' AND policyname='anon_select_ai_intel_cache') THEN
    CREATE POLICY anon_select_ai_intel_cache          ON public.ai_intelligence_cache FOR SELECT TO anon          USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_intelligence_cache' AND policyname='authenticated_select_ai_intel_cache') THEN
    CREATE POLICY authenticated_select_ai_intel_cache ON public.ai_intelligence_cache FOR SELECT TO authenticated  USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_intelligence_cache' AND policyname='authenticated_insert_ai_intel_cache') THEN
    CREATE POLICY authenticated_insert_ai_intel_cache ON public.ai_intelligence_cache FOR INSERT TO authenticated  WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_intelligence_cache' AND policyname='authenticated_update_ai_intel_cache') THEN
    CREATE POLICY authenticated_update_ai_intel_cache ON public.ai_intelligence_cache FOR UPDATE TO authenticated  USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_intelligence_cache' AND policyname='authenticated_delete_ai_intel_cache') THEN
    CREATE POLICY authenticated_delete_ai_intel_cache ON public.ai_intelligence_cache FOR DELETE TO authenticated  USING (true);
  END IF;
END $$;
