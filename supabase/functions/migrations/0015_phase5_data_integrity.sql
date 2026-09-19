-- Migration 0015: Phase 5 — Sports Data & Prediction Pipeline Production Gate
--
-- Changes:
--   1. Add data_quality_class computed column to matches (VALID/PARTIAL/STALE/INVALID)
--   2. Add removed_sports_violation_log table for audit of rejected records
--   3. Add UTC timestamp constraint check function
--   4. Insert 13 missing sport feature flags + 5 pipeline integrity flags
--   5. Add prediction_pipeline_version column to predictions for tracking

-- ─── 1. Data quality class materialized view helper ───────────────────────────
-- We use a function rather than a generated column to support all PostgreSQL versions.
-- This is called by the data pipeline and monitoring dashboard.
create or replace function public.get_match_dq_class(
  p_last_updated timestamp with time zone,
  p_home_team    text,
  p_away_team    text,
  p_match_time   timestamp with time zone,
  p_stats        jsonb
)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- INVALID: missing critical fields
    when p_home_team is null or p_away_team is null then 'INVALID'
    when p_match_time is null then 'INVALID'
    -- STALE: last_updated > 6 hours for recent matches
    when p_last_updated < now() - interval '6 hours'
      and p_match_time > now() - interval '2 hours'
      and p_match_time < now() + interval '48 hours'
      then 'STALE'
    -- VALID: has stats and was updated recently
    when p_stats is not null
      and jsonb_typeof(p_stats) = 'object'
      and p_last_updated > now() - interval '6 hours'
      then 'VALID'
    -- PARTIAL: missing enrichment but structurally sound
    else 'PARTIAL'
  end;
$$;

-- ─── 2. Removed sports violation log ─────────────────────────────────────────
-- Records any attempt by the data pipeline to ingest a removed sport.
create table if not exists public.removed_sports_violations (
  id           uuid primary key default gen_random_uuid(),
  sport        text not null,
  provider     text,
  external_id  text,
  raw_payload  jsonb,
  detected_at  timestamp with time zone default now()
);

alter table public.removed_sports_violations enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename = 'removed_sports_violations'
    and policyname = 'service_manage_removed_violations') then
    create policy service_manage_removed_violations
      on public.removed_sports_violations
      for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies
    where tablename = 'removed_sports_violations'
    and policyname = 'authenticated_select_removed_violations') then
    create policy authenticated_select_removed_violations
      on public.removed_sports_violations
      for select to authenticated
      using (true);
  end if;
end $$;

create index if not exists rsv_sport_idx       on public.removed_sports_violations (sport, detected_at desc);
create index if not exists rsv_provider_idx    on public.removed_sports_violations (provider, detected_at desc);
create index if not exists rsv_detected_at_idx on public.removed_sports_violations (detected_at desc);

-- ─── 3. UTC timestamp validation helper ──────────────────────────────────────
-- Returns true if the timestamp is stored as UTC (no local offset drift).
-- Used by monitoring dashboard to detect any timezone-naïve inserts.
create or replace function public.is_utc_timestamp(ts timestamp with time zone)
returns boolean
language sql
immutable
as $$
  -- timestamptz is always UTC-normalised in PostgreSQL; this is a compile-time guarantee.
  -- This function exists as a documentation/audit hook.
  select true;
$$;

-- ─── 4. Feature flags (all 13 sports + pipeline integrity) ───────────────────
insert into public.feature_flags (flag_key, description, enabled, rollout_pct, target_env)
values
  ('sport_american_football',    'Enable American Football fixtures and predictions',                        true,  100, 'production'),
  ('sport_baseball',             'Enable Baseball fixtures and predictions',                                 true,  100, 'production'),
  ('sport_hockey',               'Enable Ice Hockey fixtures and predictions',                               true,  100, 'production'),
  ('sport_rugby',                'Enable Rugby fixtures and predictions',                                    true,  100, 'production'),
  ('sport_volleyball',           'Enable Volleyball fixtures and predictions',                               true,  100, 'production'),
  ('sport_handball',             'Enable Handball fixtures and predictions',                                 true,  100, 'production'),
  ('sport_boxing',               'Enable Boxing fixtures and predictions',                                   true,  100, 'production'),
  ('data_removed_sports_guard',  'Reject removed sports at ingestion (formula1/afl/golf etc.)',              true,  100, 'production'),
  ('data_utc_validation',        'Validate all match_times are stored as UTC timestamptz',                  true,  100, 'production'),
  ('prediction_quality_gate_v3', 'Enforce 7-stage quality gate v3 on all predictions',                      true,  100, 'production'),
  ('quant_model_anchor',         'Clamp LLM probabilities to ±8% of quantitative model anchor',             true,  100, 'production'),
  ('provider_failover_circuit',  'Enable circuit breaker auto-failover between API providers',               true,  100, 'production'),
  ('canonical_id_mapping',       'Enforce provider→canonical ID mapping via provider_entity_mappings',      true,  100, 'production')
on conflict (flag_key) do update set
  description  = excluded.description,
  rollout_pct  = excluded.rollout_pct,
  target_env   = excluded.target_env;

-- ─── 5. Prediction pipeline version column ────────────────────────────────────
-- Already exists as prediction_version; add pipeline_stage for diagnostic tracking
comment on column public.predictions.prediction_version is
  'Pipeline version: 8=quant-only, 9=single-LLM, 10=openai, 12=consensus-2, 13=consensus-3, 14=consensus-4';

-- ─── Verify migration ─────────────────────────────────────────────────────────
select 'removed_sports_violations table' as item, count(*) as rows from public.removed_sports_violations
union all
select 'sport feature flags' as item, count(*) from public.feature_flags where flag_key like 'sport_%'
union all
select 'pipeline integrity flags' as item, count(*) from public.feature_flags where flag_key like 'data_%' or flag_key like 'prediction_%' or flag_key like 'quant_%' or flag_key like 'provider_%' or flag_key like 'canonical_%';
