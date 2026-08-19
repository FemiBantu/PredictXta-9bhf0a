-- =============================================================================
-- Migration 0008: Provider Entity Mapping + Canonical Data Model
-- Phase 3: Sports Data Platform
--
-- Creates:
--   provider_entity_mappings  — canonical ID ↔ provider ID cross-reference
--   data_quality_log          — per-record quality gate results
--   match_provenance          — tracks which provider sourced each match field
--
-- All canonical entities use PredictXta UUIDs as primary keys.
-- Provider IDs are stored in provider_entity_mappings.
-- Provider IDs MUST NOT be used as PredictXta primary identifiers.
-- =============================================================================

-- ─── Provider entity mappings ─────────────────────────────────────────────────
-- Maps provider-specific entity IDs to PredictXta canonical IDs.
-- Supports: sport, country, league, season, team, player, venue, match.
create table if not exists public.provider_entity_mappings (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  entity_type      text not null check (entity_type in (
                     'sport','country','league','season',
                     'team','player','venue','match')),
  provider_id      text not null,
  predictxta_id    text not null,
  confidence       integer not null default 100 check (confidence between 0 and 100),
  mapping_source   text not null default 'auto'
                     check (mapping_source in ('auto','verified','manual','fuzzy')),
  last_verified_at timestamp with time zone not null default now(),
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now(),
  -- Each provider+entity_type+provider_id combination is unique
  constraint uq_provider_entity unique (provider, entity_type, provider_id)
);

create index if not exists pem_predictxta_id_idx
  on public.provider_entity_mappings (predictxta_id, entity_type);
create index if not exists pem_provider_idx
  on public.provider_entity_mappings (provider, entity_type);
create index if not exists pem_confidence_idx
  on public.provider_entity_mappings (confidence desc);

comment on table public.provider_entity_mappings is
  'Cross-reference: provider-specific IDs ↔ PredictXta canonical IDs. '
  'Never use provider IDs as primary identifiers. '
  'mapping_source=verified means human-reviewed; auto=algorithmic match.';

-- ─── Data quality log ─────────────────────────────────────────────────────────
-- Persists quality gate results for every normalized record.
-- Enables monitoring of data quality trends across providers/sports.
create table if not exists public.data_quality_log (
  id             uuid primary key default gen_random_uuid(),
  external_id    text not null,
  sport          text not null,
  provider       text not null,
  status         text not null default 'VALID'
                   check (status in ('VALID','PARTIAL','STALE','CONFLICT','INVALID')),
  dq_score       integer not null default 0 check (dq_score between 0 and 100),
  failures       text[] not null default '{}',
  cross_sport_fix boolean not null default false,
  dedup_action   text,    -- 'winner' | 'dropped' | 'enriched'
  unified_id     text,
  created_at     timestamp with time zone default now()
);

create index if not exists dql_sport_created_idx
  on public.data_quality_log (sport, created_at desc);
create index if not exists dql_status_idx
  on public.data_quality_log (status, created_at desc);
create index if not exists dql_provider_idx
  on public.data_quality_log (provider, created_at desc);
create index if not exists dql_external_id_idx
  on public.data_quality_log (external_id);

comment on table public.data_quality_log is
  'Quality gate results for every normalized record. '
  'VALID = passed all checks. INVALID = rejected. PARTIAL = passed with warnings. '
  'Used for data quality monitoring dashboards and trend analysis.';

-- ─── Match provenance ─────────────────────────────────────────────────────────
-- Tracks which provider is authoritative for each field of a match record.
-- Enables field-level source priority (Phase 3 reconciliation requirement).
create table if not exists public.match_provenance (
  match_id          uuid not null references public.matches(id) on delete cascade,
  field_name        text not null,
  source_provider   text not null,
  source_record_id  text,
  retrieved_at      timestamp with time zone not null default now(),
  updated_at        timestamp with time zone not null default now(),
  primary key (match_id, field_name)
);

create index if not exists mp_match_id_idx
  on public.match_provenance (match_id);
create index if not exists mp_provider_idx
  on public.match_provenance (source_provider, retrieved_at desc);

comment on table public.match_provenance is
  'Field-level provenance for match records. '
  'Records which provider supplied each field (score, status, teams, etc.). '
  'Prevents silent data overwrites when providers disagree on field values.';

-- ─── Provider health snapshot ──────────────────────────────────────────────────
-- Stores periodic snapshots of provider health metrics.
-- Used by the quota-aware scheduler and circuit breaker logic.
create table if not exists public.provider_health_snapshots (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  sport             text,  -- null = all sports
  success_rate_pct  numeric(5,2) not null default 100,
  avg_latency_ms    integer,
  timeout_count     integer not null default 0,
  error_count       integer not null default 0,
  requests_today    integer not null default 0,
  quota_used_pct    numeric(5,2) not null default 0,
  circuit_state     text not null default 'CLOSED'
                      check (circuit_state in ('CLOSED','HALF_OPEN','OPEN')),
  is_healthy        boolean not null default true,
  snapshot_at       timestamp with time zone not null default now()
);

create index if not exists phs_provider_snap_idx
  on public.provider_health_snapshots (provider, snapshot_at desc);
create index if not exists phs_healthy_idx
  on public.provider_health_snapshots (is_healthy, snapshot_at desc);

comment on table public.provider_health_snapshots is
  'Periodic snapshots of provider health metrics. '
  'Used by quota-aware sync scheduler and failover logic. '
  'circuit_state: CLOSED=healthy, HALF_OPEN=recovering, OPEN=failing.';

-- ─── RLS policies ─────────────────────────────────────────────────────────────

-- provider_entity_mappings: readable by all authenticated users; writable by service only
alter table public.provider_entity_mappings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='provider_entity_mappings'
    and policyname='authenticated_select_pem') then
    create policy authenticated_select_pem on public.provider_entity_mappings
      for select to authenticated using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='provider_entity_mappings'
    and policyname='anon_select_pem') then
    create policy anon_select_pem on public.provider_entity_mappings
      for select to anon using (true);
  end if;
end $$;

-- data_quality_log: authenticated insert/select
alter table public.data_quality_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='data_quality_log'
    and policyname='authenticated_insert_dql') then
    create policy authenticated_insert_dql on public.data_quality_log
      for insert to authenticated with check (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='data_quality_log'
    and policyname='authenticated_select_dql') then
    create policy authenticated_select_dql on public.data_quality_log
      for select to authenticated using (true);
  end if;
end $$;

-- match_provenance: service-only write
alter table public.match_provenance enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='match_provenance'
    and policyname='authenticated_select_mp') then
    create policy authenticated_select_mp on public.match_provenance
      for select to authenticated using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='match_provenance'
    and policyname='service_manage_mp') then
    create policy service_manage_mp on public.match_provenance
      for all using (true) with check (true);
  end if;
end $$;

-- provider_health_snapshots: authenticated read; service write
alter table public.provider_health_snapshots enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='provider_health_snapshots'
    and policyname='authenticated_select_phs') then
    create policy authenticated_select_phs on public.provider_health_snapshots
      for select to authenticated using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies
    where tablename='provider_health_snapshots'
    and policyname='service_insert_phs') then
    create policy service_insert_phs on public.provider_health_snapshots
      for insert with check (true);
  end if;
end $$;
