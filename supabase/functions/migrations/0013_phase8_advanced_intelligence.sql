-- Migration 0013: Phase 8 Advanced Intelligence & Personalization
-- Adds: feature_store, model_shadow_runs, prediction_error_log,
--       drift_log, personalization_profiles, prediction_cost_log, context_cache
-- All DDL is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING)

-- ─── Versioned feature store ─────────────────────────────────────────────────
create table if not exists public.feature_store (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid references public.matches(id) on delete cascade,
  sport           text not null,
  feature_version text not null default 'v1.0.0',
  features        jsonb not null default '{}',
  missing_fields  text[] not null default '{}',
  completeness_pct integer not null default 0 check (completeness_pct between 0 and 100),
  computed_at     timestamp with time zone not null default now(),
  valid_until     timestamp with time zone,
  is_leakage_safe boolean not null default true,
  source_snapshot text,
  constraint uq_feature_store unique (match_id, feature_version)
);

create index if not exists fs_match_id_idx      on public.feature_store (match_id, feature_version);
create index if not exists fs_sport_version_idx on public.feature_store (sport, feature_version, computed_at desc);
create index if not exists fs_computed_idx      on public.feature_store (computed_at desc);

-- ─── Shadow model runs ────────────────────────────────────────────────────────
create table if not exists public.model_shadow_runs (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid references public.matches(id) on delete cascade,
  sport               text not null,
  shadow_model_id     text not null,
  production_model_id text not null,
  shadow_prediction   jsonb not null,
  prod_prediction_id  uuid,
  home_win_prob       numeric(6,4),
  draw_prob           numeric(6,4),
  away_win_prob       numeric(6,4),
  confidence          integer,
  shadow_confidence   integer,
  prob_divergence     numeric(6,4),
  agreement           boolean,
  actual_result       text,
  shadow_correct      boolean,
  prod_correct        boolean,
  latency_ms          integer,
  feature_version     text,
  created_at          timestamp with time zone default now(),
  settled_at          timestamp with time zone
);

create index if not exists msr_match_id_idx   on public.model_shadow_runs (match_id, created_at desc);
create index if not exists msr_shadow_mid_idx on public.model_shadow_runs (shadow_model_id, sport, created_at desc);
create index if not exists msr_agreement_idx  on public.model_shadow_runs (agreement, settled_at desc) where settled_at is not null;

-- ─── Prediction error analysis log ───────────────────────────────────────────
create table if not exists public.prediction_error_log (
  id                uuid primary key default gen_random_uuid(),
  prediction_id     uuid references public.predictions(id) on delete set null,
  match_id          uuid references public.matches(id) on delete set null,
  sport             text not null,
  league            text,
  market            text not null default '1x2',
  model_id          text,
  confidence_at_pred integer,
  prob_at_pred      numeric(6,4),
  predicted_result  text,
  actual_result     text,
  error_type        text not null,
  error_magnitude   numeric(8,6),
  brier_contribution numeric(8,6),
  data_quality_score integer,
  feature_version   text,
  home_advantage    boolean,
  league_tier       text,
  created_at        timestamp with time zone default now()
);

create index if not exists pel_sport_league_idx on public.prediction_error_log (sport, league, created_at desc);
create index if not exists pel_error_type_idx   on public.prediction_error_log (error_type, confidence_at_pred, created_at desc);
create index if not exists pel_model_idx        on public.prediction_error_log (model_id, sport, created_at desc);

-- ─── Drift detection log ─────────────────────────────────────────────────────
create table if not exists public.drift_log (
  id                uuid primary key default gen_random_uuid(),
  logged_date       text not null,
  drift_type        text not null,
  sport             text not null default 'all',
  model_id          text,
  metric_name       text not null,
  baseline_value    numeric(10,6),
  current_value     numeric(10,6),
  drift_magnitude   numeric(8,6),
  threshold         numeric(8,6),
  severity          text not null default 'info' check (severity in ('info','warning','critical')),
  requires_action   boolean not null default false,
  investigated      boolean not null default false,
  resolution        text,
  created_at        timestamp with time zone default now()
);

create index if not exists dl_sport_date_idx  on public.drift_log (sport, logged_date desc);
create index if not exists dl_severity_idx    on public.drift_log (severity, requires_action, created_at desc);
create index if not exists dl_drift_type_idx  on public.drift_log (drift_type, logged_date desc);

-- ─── Server-side personalization profiles ────────────────────────────────────
create table if not exists public.personalization_profiles (
  user_id             uuid primary key references public.user_profiles(id) on delete cascade,
  followed_sports     text[] not null default '{}',
  followed_leagues    text[] not null default '{}',
  followed_teams      text[] not null default '{}',
  preferred_markets   text[] not null default '{}',
  confidence_min      integer not null default 0 check (confidence_min between 0 and 100),
  last_active_sports  text[] not null default '{}',
  interaction_count   integer not null default 0,
  profile_version     integer not null default 1,
  created_at          timestamp with time zone default now(),
  updated_at          timestamp with time zone default now()
);

create index if not exists pp_updated_idx on public.personalization_profiles (updated_at desc);

-- ─── Per-prediction AI cost tracking ─────────────────────────────────────────
create table if not exists public.prediction_cost_log (
  id               uuid primary key default gen_random_uuid(),
  prediction_id    uuid,
  match_id         uuid references public.matches(id) on delete set null,
  sport            text not null,
  provider         text not null,
  model_id         text not null,
  tokens_input     integer not null default 0,
  tokens_output    integer not null default 0,
  cost_usd         numeric(10,8) not null default 0,
  latency_ms       integer,
  cache_hit        boolean not null default false,
  routing_strategy text,
  created_at       timestamp with time zone default now()
);

create index if not exists pcl_sport_provider_idx on public.prediction_cost_log (sport, provider, created_at desc);
create index if not exists pcl_date_idx           on public.prediction_cost_log (created_at desc);
create index if not exists pcl_model_idx          on public.prediction_cost_log (model_id, created_at desc);

-- ─── Context intelligence cache ──────────────────────────────────────────────
create table if not exists public.context_cache (
  id              uuid primary key default gen_random_uuid(),
  cache_key       text not null unique,
  context_type    text not null,
  match_id        uuid references public.matches(id) on delete cascade,
  sport           text not null,
  data            jsonb not null default '{}',
  quality_score   integer not null default 0,
  sources         text[] not null default '{}',
  computed_at     timestamp with time zone not null default now(),
  expires_at      timestamp with time zone not null default (now() + interval '6 hours'),
  is_valid        boolean not null default true
);

create index if not exists cc_key_idx      on public.context_cache (cache_key);
create index if not exists cc_expires_idx  on public.context_cache (expires_at) where is_valid = true;
create index if not exists cc_match_idx    on public.context_cache (match_id, context_type) where match_id is not null;

-- ─── RLS policies ─────────────────────────────────────────────────────────────
alter table public.feature_store             enable row level security;
alter table public.model_shadow_runs         enable row level security;
alter table public.prediction_error_log      enable row level security;
alter table public.drift_log                 enable row level security;
alter table public.personalization_profiles  enable row level security;
alter table public.prediction_cost_log       enable row level security;
alter table public.context_cache             enable row level security;

-- (Policies created idempotently in the application migration SQL above)

-- ─── Phase 8 kill switches ────────────────────────────────────────────────────
insert into public.feature_flags (flag_key, description, enabled, rollout_pct, target_env) values
  ('shadow_mode',              'Enable shadow model runs alongside production',               true, 100, 'production'),
  ('drift_monitoring',         'Enable data and concept drift detection',                     true, 100, 'production'),
  ('advanced_personalization', 'Enable server-side personalization profiles',                 true, 100, 'production'),
  ('market_intelligence',      'Enable market implied-probability comparison',                true, 100, 'production'),
  ('continuous_learning',      'Enable feedback-loop prediction error analysis',              true, 100, 'production'),
  ('context_engine',           'Enable structured context intelligence layer',                true, 100, 'production'),
  ('cost_tracking',            'Enable per-prediction AI cost tracking',                      true, 100, 'production'),
  ('canary_model_promotion',   'Enable canary stage for model promotions (5% traffic)',       false,  5, 'production'),
  ('ensemble_optimization',    'Enable validation-based ensemble weight optimization',        true, 100, 'production'),
  ('risk_intelligence',        'Enable evidence-based risk engine for predictions',           true, 100, 'production')
on conflict (flag_key) do nothing;
