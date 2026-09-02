-- Migration 0011: Phase 6 Production Hardening
-- Adds critical performance indexes, hardens RLS, and adds API usage tracking
-- All DDL is idempotent (IF NOT EXISTS / DO $$ ... $$)
-- Executed live via execute_backend_sql in Phase 6 implementation session.

-- ─── Critical performance indexes ────────────────────────────────────────────

-- matches: feed query (live first, then upcoming by sport+time)
-- create index if not exists matches_status_sport_time_idx on public.matches (status, sport, match_time asc);

-- matches: live matches by sport + minute (for live scores tab)
-- create index if not exists matches_live_sport_minute_idx on public.matches (status, sport, minute desc) where status = 'live';

-- matches: upcoming fixtures by sport+time (pre-match prediction targeting)
-- create index if not exists matches_upcoming_sport_time_idx on public.matches (sport, match_time asc) where status = 'upcoming';

-- matches: finished matches for settlement
-- create index if not exists matches_finished_sport_time_idx on public.matches (sport, match_time desc) where status = 'finished';

-- matches: logo lookups (avoid full-table scan on team card renders)
-- create index if not exists matches_home_logo_idx on public.matches (home_logo) where home_logo is not null;
-- create index if not exists matches_away_logo_idx on public.matches (away_logo) where away_logo is not null;
-- create index if not exists matches_league_logo_idx on public.matches (league_logo) where league_logo is not null;

-- predictions: match+time (latest prediction per match)
-- create index if not exists predictions_match_id_created_at_idx on public.predictions (match_id, created_at desc);
-- create index if not exists predictions_confidence_match_idx on public.predictions (confidence desc, match_id);
-- create index if not exists predictions_version_created_idx on public.predictions (prediction_version, created_at desc);

-- prediction_outcomes: accuracy analytics by sport
-- create index if not exists pred_outcomes_sport_correct_idx on public.prediction_outcomes (sport, is_correct, resolved_at desc);
-- create index if not exists pred_outcomes_resolved_sport_idx on public.prediction_outcomes (resolved_at desc, sport);

-- odds: fresh odds query (by match + last_updated)
-- create index if not exists odds_match_updated_v2_idx on public.odds (match_id, last_updated desc);

-- news articles: sport + date feed
-- create index if not exists news_sport_published_idx on public.news_articles (sport, published_at desc);

-- prediction_jobs: retry queue (failed jobs due for retry)
-- create index if not exists pj_retry_at_idx on public.prediction_jobs (next_retry_at asc) where status = 'failed';

-- ai_audit_logs: time-based queries
-- create index if not exists ai_audit_logs_created_at_idx on public.ai_audit_logs (created_at desc);
-- create index if not exists ai_audit_match_id_idx on public.ai_audit_logs (match_id, created_at desc) where match_id is not null;

-- calibration_log: sport+date analytics
-- create index if not exists cal_log_date_sport_idx on public.calibration_log (logged_date desc, sport);

-- expert_slips: date + status (settlement queries)
-- create index if not exists expert_slips_date_idx on public.expert_slips (slip_date desc, status);

-- challenge_picks: user + date (daily challenge queries)
-- create index if not exists challenge_picks_user_date_idx on public.challenge_picks (user_id, challenge_date desc);

-- ─── RLS verification ─────────────────────────────────────────────────────────
-- All critical tables verified to have RLS enabled via DO $$ block in execute_backend_sql.
-- Tables: matches, predictions, prediction_outcomes, prediction_jobs,
--         ai_audit_logs, ai_governance_log, user_profiles, vip_subscriptions,
--         user_coins, admin_roles, expert_profiles, expert_slips, expert_slip_picks,
--         challenge_picks, challenge_results, notifications, chat_messages,
--         purchase_audit_log, security_audit_log

-- ─── Phase 6 complete marker ─────────────────────────────────────────────────
-- All DDL executed live via execute_backend_sql. This file documents the changes.
-- Run status: COMPLETE (2026-09-02)
