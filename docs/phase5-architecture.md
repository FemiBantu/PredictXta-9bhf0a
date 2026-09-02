## Phase 5 — Prediction Delivery, Automation, Monitoring & Scale

### Prediction Lifecycle

Every prediction follows a deterministic server-controlled lifecycle:

```
SCHEDULED → DATA_READY → GENERATING → VALIDATING → PUBLISHED
               ↓              ↓              ↓
           CANCELLED       FAILED        CANCELLED
                              ↓
                           STALE (match started without prediction)
```

**Idempotency keys** — format: `pred-{matchId[0:8]}-{YYYY-MM-DD}` — prevent duplicate generation.

### Automated Pipeline Schedule

| Time (UTC) | Job | Mode |
|-----------|-----|------|
| 18:00 | daily-scheduler | fixtures |
| 19:00 | daily-scheduler | stage=fetch_odds |
| 20:00 | daily-scheduler | predictions |
| 21:00 | daily-scheduler | full |
| 23:00 | daily-scheduler | settle |
| Every 2 min | smart-refresh | full (when live matches exist) |
| 00:00 | daily-scheduler | stage=midnight_cleanup |

### API Contracts

#### predictions-feed
`POST /functions/v1/predictions-feed`

Parameters:
- `sport` — football|basketball|...|all
- `date` — YYYY-MM-DD | today | yesterday | tomorrow | ±N
- `page`, `limit` (max 50)
- `sort` — time|confidence|value
- `min_conf` — 0–100
- `is_vip` — **IGNORED**: server derives VIP from JWT
- `status` — upcoming|live|finished|all

Response: `{ items: PredictionFeedItem[], pagination, meta }`

#### home-feed
`POST /functions/v1/home-feed`

- VIP status derived from JWT → server-side `vip_subscriptions` check
- Cache-Control: `public, max-age=30, stale-while-revalidate=60`

#### monitoring-dashboard (Admin only)
`POST /functions/v1/monitoring-dashboard`

Returns: provider health, prediction pipeline stats, accuracy, alerts.

### Security Controls

- **VIP authorization**: never trusted from client body. Derived from JWT → `vip_subscriptions` table.
- **Settlement**: `resolve-prediction` uses SERVICE_KEY only. No client result submission.
- **Cache isolation**: VIP content uses `private, no-store` headers. Public feed uses `public, max-age=30`.
- **Prediction generation**: `generate-prediction` derives userId from JWT. Body `user_id` is for audit only.
- **Admin endpoints**: gated by `useAdminRole()` (admin_roles DB table).

### Performance Targets

| Metric | Target |
|--------|--------|
| Cached feed response | < 300ms |
| Prediction generation | < 500ms (quant only) |
| Live score update | ≤ 2s |
| DB query (indexed) | < 100ms |

### Environment Variables

| Variable | Used By |
|----------|---------|
| SUPABASE_URL | All edge functions |
| SUPABASE_SERVICE_ROLE_KEY | All edge functions (server-only) |
| SUPABASE_ANON_KEY | User JWT verification |
| OPENAI_API_KEY | generate-prediction, multi-model-prediction |
| ANTHROPIC_API_KEY | generate-prediction, multi-model-prediction |
| Gemini_API_Key | generate-prediction, multi-model-prediction |
| Groq_API | generate-prediction, multi-model-prediction |
| API_FOOTBALL_KEY | fetch-matches, fetch-odds |
| ML_INGEST_HMAC_SECRET | Internal scheduler auth |

### Deployment Checklist

1. Run migrations 0001–0010 in order
2. Deploy all edge functions: `./scripts/deploy-functions.sh`
3. Verify secrets in OnSpace Cloud → Secrets
4. Confirm `pipeline_schedule` table has scheduler rows
5. Verify `feed_cache_meta` seeded for all 13 sports
6. Run `smart-refresh` in dry_run mode to verify eligibility logic
7. Test predictions-feed API for all 13 sports
8. Verify VIP field stripping for non-auth requests
9. Run phase5IntegrityTests via admin-ai-audit screen

### Rollback

If predictions fail quality gate:
1. Check `ai_governance_log` for `calibration_drift` events
2. Check `ai_audit_logs.approval_status` for rejection_reason
3. If model drift detected: invoke `rebalance-weights`
4. If provider failure: check circuit state via `monitoring-dashboard`
5. Quantitative-only predictions continue without LLM during outages

### Model Registry

Current model: `quantitative-ensemble-v1`
- Feature version: `v1.0.0` (feature_versions table)
- Sports: all 13 canonical sports
- Fallback: quantitative-only (no LLM required)
- Settlement: `resolve-prediction` → `prediction_outcomes` → `calibration_log`

### Phase 6 Preview

Phase 6 — Frontend Experience, Personalisation, Deep Linking & App Store Submission.
