-- =============================================================================
-- Migration 0001: PostgreSQL Extensions
-- PredictXta — Foundation extensions required by all subsequent migrations.
-- Safe to run multiple times (IF NOT EXISTS guards).
-- =============================================================================

-- UUID generation (used as primary keys throughout)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Scheduled jobs (pg_cron must be enabled via Supabase Dashboard first)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Async HTTP from pg_cron jobs (must be enabled via Supabase Dashboard first)
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Full-text search (used by match/league search)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
