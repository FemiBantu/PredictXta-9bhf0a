-- Migration 0009: Phase 4 Prediction Governance (applied via execute_backend_sql)
-- Tables: feature_versions, calibration_log, backtesting_runs, prediction_eligibility
-- See pipeline-audit/index.ts for the data population logic.
-- This file documents the schema for version control purposes only.
-- All DDL has already been executed via execute_backend_sql in the Phase 4 implementation session.

-- feature_versions: tracks deployed feature engineering versions
-- calibration_log: rolling accuracy/brier/calibration error per model/sport
-- backtesting_runs: historical evaluation runs (chronological, no leakage)
-- prediction_eligibility: pre-match guard (marks started/finished matches ineligible)
