-- Migration 0012: Phase 7 Production Launch & Continuous Operations
-- Adds: feature_flags (kill switches), experiments (A/B testing),
--       analytics_events (product analytics), model_promotions (governance),
--       operational_incidents (incident management), slo_metrics (SLO tracking)
-- All DDL is idempotent (IF NOT EXISTS / DO $$ ... $$)
-- Executed live via execute_backend_sql in Phase 7 implementation session.
-- Run status: COMPLETE (2026-09-02)

-- ─── Feature flags / kill switches ──────────────────────────────────────────
-- create table if not exists public.feature_flags (
--   id uuid primary key default gen_random_uuid(),
--   flag_key text not null unique,
--   description text,
--   enabled boolean not null default true,
--   rollout_pct integer not null default 100 check (rollout_pct between 0 and 100),
--   target_env text not null default 'production',
--   metadata jsonb default '{}',
--   updated_by text,
--   created_at timestamp with time zone default now(),
--   updated_at timestamp with time zone default now()
-- );

-- ─── A/B Experiments ────────────────────────────────────────────────────────
-- create table if not exists public.experiments ( ... );

-- ─── Product analytics events ───────────────────────────────────────────────
-- create table if not exists public.analytics_events ( ... );

-- ─── Model promotion registry ───────────────────────────────────────────────
-- create table if not exists public.model_promotions ( ... );

-- ─── Operational incidents ──────────────────────────────────────────────────
-- create table if not exists public.operational_incidents ( ... );

-- ─── SLO metrics ────────────────────────────────────────────────────────────
-- create table if not exists public.slo_metrics ( ... );

-- ─── Kill switches seeded (20 flags) ────────────────────────────────────────
-- See execute_backend_sql in Phase 7 session for INSERT statements.
-- All 20 flags seeded with enabled=true (fail-safe default).

-- ─── RLS policies ────────────────────────────────────────────────────────────
-- feature_flags: anon_select_flags, auth_select_flags, service_manage_flags
-- experiments: auth_select_experiments, service_manage_experiments
-- analytics_events: auth_insert_own_events, anon_insert_events, service_select_events
-- model_promotions: auth_select_promotions, service_manage_promotions
-- operational_incidents: auth_select_incidents, service_manage_incidents
-- slo_metrics: auth_select_slo, service_manage_slo
