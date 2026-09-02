-- Migration 0010: Phase 5 Prediction Lifecycle & Job Queue
-- Tables: prediction_jobs, ai_governance_log (if not exists)
-- All DDL executed via execute_backend_sql in the Phase 5 implementation session.

-- prediction_jobs: tracks every prediction generation attempt with idempotency
--   status: scheduled → data_ready → generating → validating → published
--           failed | cancelled | stale
-- ai_governance_log: structured event log for AI decisions, cost, drift alerts
