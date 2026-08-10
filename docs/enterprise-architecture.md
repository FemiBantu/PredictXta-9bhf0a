# PredictXta Enterprise Architecture — Sports Intelligence Platform

## System Overview

**Scale**: 50M+ registered users | 2M+ concurrent | 21+ sports | 99.99% uptime  
**API Budget**: 7,000 requests/day across all providers  
**Architecture**: Pre-loaded data → 3-layer cache → SSE realtime → Client

---

## Data Flow (CRITICAL RULE: Clients NEVER call sports APIs directly)

```
Sports Providers (API-Football, TheSportsDB)
          ↓
  Ingestion Workers (fetch-matches, fetch-odds, sync-standings)
          ↓
  Validation + Deduplication + Normalization (_shared/dataNormalizer.ts)
          ↓
  Unified Sports Schema (PostgreSQL)
          ↓
  ┌────────────────────────────────┐
  │  3-Layer Serving Cache         │
  │  L1: In-memory (0ms)           │
  │  L2: AsyncStorage (instant)    │
  │  L3: Supabase DB (<100ms)      │
  └────────────────────────────────┘
          ↓
  SSE Realtime / Smart Polling (live-scores-sse)
          ↓
  Mobile App / Web App
```

---

## Midnight Preload Pipeline (23:00–00:00 UTC)

Ensures ALL data is pre-loaded before midnight. Users never wait for API calls.

| Time  | Stage | Description |
|-------|-------|-------------|
| 23:00 | Fixtures | Download today + tomorrow + next 2 days |
| 23:20 | Metadata | Teams, venues, league info |
| 23:30 | Standings | All major leagues |
| 23:40 | Odds | Pre-match odds for upcoming matches |
| 23:45 | Stats | Player and team statistics |
| 23:50 | Predictions | AI predictions for all unpredicted matches |
| 23:55 | Reports | AI intelligence reports |
| 23:58 | Cache Warm | Pre-warm Supabase + Cloudflare cache |

**Edge Function**: `midnight-preload`  
**Trigger**: pg_cron at each time slot (UTC)

---

## API Quota Budget (7,000 req/day)

| Category | Daily Budget | % |
|----------|-------------|---|
| Football Live | 2,000 | 29% |
| Basketball Live | 1,000 | 14% |
| Tennis Live | 600 | 9% |
| Cricket Live | 500 | 7% |
| Other Sports Live | 1,200 | 17% |
| Fixtures | 900 | 13% |
| Standings | 300 | 4% |
| Metadata | 200 | 3% |
| Emergency Buffer | 300 | 4% |
| **Total** | **7,000** | **100%** |

**Monitoring**: `quota-monitor` edge function  
**Emergency Mode**: Auto-activates at 90% usage — suspends non-critical syncs  
**Dynamic Intervals**: Automatically slows refresh at 50%/75%/90% usage

---

## Smart Refresh Engine

Live match state → dynamic refresh interval:

| Match State | Refresh Interval |
|-------------|-----------------|
| >24h before kickoff | 60 minutes |
| <24h before kickoff | 60 minutes |
| <2h before kickoff | 15 minutes |
| <30min before kickoff | 5 minutes |
| Live (active play) | 10 seconds |
| Halftime | 30 seconds |
| Finished | Stop |

**Edge Function**: `smart-refresh`  
**Cron**: Every 5min (live), 15min (pre-match), 30min (fixtures)

---

## Realtime Distribution

### SSE (Web)
```
EventSource('/functions/v1/live-scores-sse?sport=football')
  .on('score-update', delta)   // Only changed fields
  .on('match-status', status)
  .on('heartbeat', liveCount)
```

### Polling Fallback (React Native)
- Automatic when SSE unavailable
- 10-second intervals
- Delta detection (only emits when data changes)
- Pauses when app goes to background

### Delta Updates Only
```
Old: { homeScore: 2, awayScore: 1 }
Goal scored →
Broadcast: { matchId, homeScore: 3, awayScore: 1, minute: 67 }
```
No full object retransmission. Only changed fields.

**Services**: `services/realtimeService.ts`, `supabase/functions/live-scores-sse/`

---

## Edge Functions Registry

| Function | Purpose | Schedule |
|----------|---------|----------|
| `fetch-matches` | Ingest fixtures from APIs | On-demand + hourly |
| `fetch-odds` | Ingest betting odds | Hourly |
| `sync-standings` | League tables | Every 30min |
| `home-feed` | Unified feed API | On-demand |
| `live-scores-sse` | SSE realtime distribution | Persistent stream |
| `smart-refresh` | Dynamic refresh coordinator | Every 5min |
| `midnight-preload` | Nightly data preparation | 23:00-23:58 UTC |
| `quota-monitor` | API budget tracking | Hourly |
| `daily-scheduler` | 10-stage pipeline | 18:00-23:00 UTC |
| `generate-prediction` | AI predictions | On-demand |
| `multi-model-prediction` | 4-model consensus | On-demand |
| `ai-intelligence` | AI match reports | On-demand |
| `send-push` | FCM v1 notifications | On-demand |
| `translate-content` | 11-language translation | On-demand |
| `delete-account` | GDPR data deletion | On-demand |

---

## Database Performance

### Indexes Added
- `matches_live_sport_minute_idx` — Live queries by sport (partial index)
- `matches_upcoming_sport_time_idx` — Upcoming by sport+time (partial index)
- `matches_finished_sport_time_idx` — Recent by sport (partial index)
- `predictions_confidence_v2_idx` — High-confidence feed (partial index ≥55)
- `odds_match_updated_v2_idx` — Latest odds per match
- `match_events_match_minute_v2_idx` — Match timeline

### Views
- `v_provider_health_today` — Real-time provider health (regular view)
- `v_sport_coverage` — Coverage status per sport (regular view)

### Functions
- `get_daily_quota_usage()` — Daily API budget report
- `get_unpredicted_matches()` — Matches needing AI predictions
- `auto_fix_stale_live_matches()` — Fix live matches stuck >3h
- `notify_match_change()` — PostgreSQL NOTIFY on score/status change

### Triggers
- `on_match_change` — Fires pg_notify when scores/status change (realtime)

---

## Client Data Layer

### Never call APIs directly
```typescript
// ✅ CORRECT — uses enterprise service
import { getLiveMatches } from '@/services/enterpriseDataService';
const { data, source } = await getLiveMatches('football');

// ❌ WRONG — direct API call
const res = await fetch('https://v3.football.api-sports.io/fixtures');
```

### Realtime Updates
```typescript
import { useLiveScores, useRealtimeMatchList } from '@/services/realtimeService';

// Get live scores map
const { scores, liveCount } = useLiveScores('football');

// Merge realtime into match list
const liveMatches = useRealtimeMatchList(baseMatches, 'football');
```

---

## pg_cron Schedules

Run `scripts/setup-enterprise-cron.sql` in Supabase SQL editor.

Key schedules:
- `*/5 * * * *` — Live refresh (smart-refresh)
- `*/30 * * * *` — Fixtures refresh
- `0 23 * * *` — Midnight preload start
- `0 21 * * *` — Daily pipeline safety net
- `0 */3 * * *` — Auto-fix stale live matches

---

## Provider Hierarchy

| Sport | Primary | Secondary |
|-------|---------|-----------|
| Football | API-Football | TheSportsDB |
| Basketball | API-Sports Basketball | TheSportsDB |
| Tennis | TheSportsDB (only) | — |
| Cricket | TheSportsDB | — |
| Baseball | API-Sports Baseball | TheSportsDB |
| Hockey | API-Sports Hockey | TheSportsDB |
| MMA | API-Sports MMA | TheSportsDB |
| Rugby | API-Sports Rugby | TheSportsDB |
| American Football | API-Sports AF | TheSportsDB |
| All others | TheSportsDB | — |

### Circuit Breaker
- Auto-triggers after repeated failures
- Automatic failover to secondary provider
- No frontend disruption during failover
- `resetCircuits: true` param to manually reset

---

## Performance Targets

| Metric | Target | Implementation |
|--------|--------|---------------|
| Initial Load | <2s | Pre-warmed L1 cache |
| API Response | <300ms | 3-layer cache |
| DB Query | <100ms | Partial indexes + views |
| Prediction Gen | <500ms | Parallel batch generation |
| Live Update | <2s | SSE delta distribution |
| Availability | 99.99% | Circuit breakers + failover |
| Cache Hit Ratio | 95%+ | TTL-based L1+L2+L3 |

---

## Security

- All sports API keys stored in Supabase Vault (never in client)
- Firebase credentials via EAS file-type secrets
- FCM v1 API with OAuth2 service account (RS256 JWT)
- RLS enabled on all 50+ tables
- Rate limiting: 60 req/min per IP on all edge functions
- Input sanitization on all edge function endpoints
