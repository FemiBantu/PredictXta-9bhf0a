# ⚠️ HISTORICAL ONLY — See docs/PRODUCTION_SOURCE_OF_TRUTH.md

> **Sports provider hierarchy, canonical 13-sport registry, and no-fabrication rules in this document are correct.  
> Canonical values are also defined in `docs/PRODUCTION_SOURCE_OF_TRUTH.md §5–§9`.**

---

# PredictXta — Phase 5 Production Gate: Sports Data, Prediction Engine & Data Integrity

**Status**: PASSED  
**Date**: 2026-09-08  
**Scope**: Provider architecture, canonical data, quality gates, AI pipeline, timezone validation

---

## 1. Provider Architecture

### Provider Hierarchy

| Priority | Provider | Sports | Capabilities |
|----------|----------|--------|-------------|
| 1 (Primary) | **API-Football** | Football only | Fixtures, live, standings, stats, odds, lineups, injuries |
| 1 (Primary) | **API-Sports** | Basketball, Baseball, Hockey, Rugby, Am. Football, Handball, Volleyball, MMA, Boxing, Esports | Fixtures, live, standings, stats |
| 2 (Secondary) | **TheSportsDB** | All 13 sports | Fixtures, historical, highlights, news (no live/odds) |

### Circuit Breaker State Machine

- **CLOSED** → normal operation
- **HALF_OPEN** → auto-test after cooldown (60–120s)
- **OPEN** → after 3 consecutive failures, skip provider until cooldown

Cooldown: OpenAI/Anthropic/Gemini = 120s, Groq = 60s

### Provider Abstraction

- Raw responses NEVER exposed to the frontend.
- All provider outputs normalized through `sportsDataNormalizer.ts` adapters.
- Canonical IDs assigned via `provider_entity_mappings` table (deterministic deduplication).

---

## 2. Canonical Data Schema

### Canonical ID Rules

| Field | Rule |
|-------|------|
| `matches.id` | UUID — PredictXta canonical primary key |
| `matches.external_id` | `{provider}:{provider_id}` — e.g. `api-football:1234` |
| `matches.source_provider` | String — `api-football`, `api-sports`, `thesportsdb` |
| `matches.sport` | Canonical DB key — one of the 13 supported sports |
| `matches.match_time` | UTC timestamptz — NEVER stored in local time |

Provider IDs are NEVER used as PredictXta primary keys.

---

## 3. Data Quality Classification

All records are classified before storage:

| Class | DQ Score | Description | Prediction Allowed |
|-------|----------|-------------|-------------------|
| **VALID** | ≥70 | Full enrichment: form, standings, H2H, odds | Yes — full confidence |
| **PARTIAL** | 50–69 | Some enrichment missing | Yes — confidence capped at 82% |
| **STALE** | Any | `last_updated` beyond TTL threshold | No — re-fetch required |
| **CONFLICT** | Any | Cross-provider data contradiction | Manual review |
| **INVALID** | <30 or hard errors | Missing required fields | No |

Only **VALID** and **PARTIAL** records feed production predictions.

### Confidence Ceiling by DQ Score

| DQ Score | Max Confidence |
|----------|---------------|
| < 30 | 55% |
| 30–49 | 58% |
| 50–59 | 68% |
| 60–69 | 72% |
| 70–79 | 82% |
| 80–89 | 84% |
| ≥ 90 | 92% |

---

## 4. No-Fabrication Policy

**Production MUST NEVER fabricate:**
- Fixture teams, dates, or leagues
- Odds values
- Player statistics (goals, assists, ratings)
- Form strings (WWDLL etc.)
- Confidence values derived from Math.random()
- Predictions without quantitative model anchor

**Enforcement mechanisms:**
1. LLM system prompt: "NEVER invent statistics. Only use the VERIFIED FACTS OBJECT."
2. Probability clamp: LLM output clamped to ±8% of quantitative model anchor.
3. Quality gate Stage 5: hallucination pattern detection (exact stat density, invented H2H).
4. If data unavailable: return `{"status":"insufficient_data"}` — never fabricate.
5. `prediction_eligibility` table: prevents pre-match predictions for started matches.

---

## 5. Canonical 13-Sport Registry

All verified active and in production:

| # | Key | Display | Primary Provider | Draw | BTTS |
|---|-----|---------|-----------------|------|------|
| 1 | `football` | Football | api-football | ✅ | ✅ |
| 2 | `basketball` | Basketball | api-sports | ❌ | ❌ |
| 3 | `tennis` | Tennis | thesportsdb | ❌ | ❌ |
| 4 | `cricket` | Cricket | thesportsdb | ✅ | ❌ |
| 5 | `baseball` | Baseball | api-sports | ❌ | ❌ |
| 6 | `hockey` | Ice Hockey | api-sports | ❌ | ❌ |
| 7 | `rugby` | Rugby | api-sports | ✅ | ❌ |
| 8 | `american-football` | American Football | api-sports | ❌ | ❌ |
| 9 | `mma` | MMA / UFC | api-sports | ❌ | ❌ |
| 10 | `boxing` | Boxing | thesportsdb | ✅* | ❌ |
| 11 | `volleyball` | Volleyball | api-sports | ❌ | ❌ |
| 12 | `handball` | Handball | api-sports | ✅ | ✅ |
| 13 | `esports` | Esports | thesportsdb | ❌ | ❌ |

*Boxing allows technical draw.

**REMOVED SPORTS** (permanently excluded):
Formula 1, AFL, Badminton, Table Tennis, Snooker, Darts, Cycling, Athletics, Motorsports, Squash, Golf

**Removed sports guard** implemented in:
- `sportsDataNormalizer.ts`: `REMOVED_SPORTS` set + `assertNotRemovedSport()`
- `dataValidator.ts`: hard error on removed sport keys
- `sportsRegistry.ts`: `assertSupportedSportRegistry()` throws if count != 13

---

## 6. Date/Time Architecture

### Storage
- All `match_time` values stored as PostgreSQL `timestamptz` (always UTC-normalized).
- No local-time strings in the database.
- `normalizeDateToISO()` in `sportsDataNormalizer.ts` handles all provider date formats.

### Frontend Date Navigation
- `services/dateUtils.ts` — all date navigation logic in one place
- `buildDateRange(localDateStr)`: converts user's local YYYY-MM-DD to UTC range query
- `getLocalOffsetMinutes()`: reads device timezone offset once per session

### Timezone Verification

| Timezone | UTC Offset | Previous Day | Today | Next Day |
|----------|-----------|--------------|-------|----------|
| WAT (Africa/Lagos) | UTC+1 | Correct | Correct | Correct |
| UTC | UTC+0 | Correct | Correct | Correct |
| EST (America/NY) | UTC-5/4 | Correct | Correct | Correct |
| PST (America/LA) | UTC-8/7 | Correct | Correct | Correct |
| IST (Asia/Kolkata) | UTC+5:30 | Correct | Correct | Correct |

**WAT edge case**: A match at 23:30 UTC on Sep 7 is Sep 8 in WAT.
`buildDateRange('2026-09-08')` in WAT correctly queries `>= 2026-09-07T23:00:00Z AND < 2026-09-08T23:00:00Z`.

---

## 7. Prediction Pipeline

### Full Pipeline (10 stages)

```
1. NORMALIZED DATA      ← sportsDataNormalizer.ts adapters
2. DATA QUALITY GATE    ← computeDataQualityScore() → DQ score 0–100
3. REMOVED SPORTS GUARD ← assertNotRemovedSport() — hard reject
4. ELIGIBILITY GATE     ← checkPredictionEligibility() — no started matches
5. FEATURE ENGINEERING  ← runQuantitativeModel() → VerifiedFactsText
6. SPORT-SPECIFIC MODEL ← Football: Dixon-Coles Poisson + Elo + Form + Market
                          Basketball: Adjusted Efficiency + Pace + Elo
                          Tennis: Surface Elo + Bradley-Terry + Serve
                          Cricket: Team Elo + Run-Rate
                          Baseball: Pitcher ERA + Run Expectancy
                          Hockey: Poisson + Skellam + Elo
                          Am. Football: Elo + EPA + Efficiency
                          Rugby: Elo + Points Model + Poisson
                          MMA/Boxing: Fighter Elo + Bayesian Ratings
                          Volleyball/Handball: Set-level B-T + Elo
                          Esports: Map-Pool Elo + Tournament Points
7. AI REPORT LAYER      ← LLM receives VerifiedFactsText (Verified Facts Object)
                          Constrained: ±8% deviation from model anchor
                          Provider: OpenAI → Anthropic → Gemini → Groq (circuit breakers)
8. PROBABILITY MERGE    ← mergeOutputs() clamps LLM to quantitative anchor
9. QUALITY GATE v3      ← 7-stage: completeness / plausibility / normalization /
                          calibration / hallucination / consensus / market_edge
10. PERSIST + AUDIT     ← predictions table + ai_audit_logs (non-blocking)
```

### LLM Role Separation

| Component | Role |
|-----------|------|
| Quantitative models | **Sole probability engine** — produces all numerical outputs |
| LLMs (GPT-5.5, Claude, Gemini, Llama) | Reasoning assistance, analysis text, market context synthesis |
| LLMs are NEVER used as the numerical probability source |

---

## 8. AI Provider Router

### Provider Registry

| Provider | Model(s) | Purpose | Timeout |
|----------|---------|---------|---------|
| OpenAI | gpt-5.5, gpt-4.1 | Primary LLM reasoning | 30s |
| Anthropic | claude-opus-4-5, claude-sonnet-4-5 | Secondary reasoning | 28s |
| Google | gemini-2.5-flash, gemini-2.0-flash | Tertiary | 25s |
| Groq (Meta Llama) | llama-4-scout-17b, llama-3.3-70b | Fast/cheap fallback | 20s |

### Routing Strategy

| Condition | Strategy |
|-----------|---------|
| DQ ≥ 80 + high-value league | `consensus_four` (all 4 providers) |
| DQ ≥ 75 | `consensus_three` (OpenAI + Anthropic + Gemini) |
| DQ ≥ 60 + high-value | `consensus_two` (OpenAI + Anthropic) |
| DQ < 40 or live match | `single_fast` (Groq/Llama) |
| Default | `primary_with_fallback` (sequential) |

### Security
- API keys resolved server-side only (`Deno.env.get()`)
- Never exposed to frontend clients
- Cost controls: per-token budgets per routing strategy

---

## 9. Quality Metrics

### Prediction Quality Gate (7 stages)

| Stage | Weight | Tests |
|-------|--------|-------|
| Completeness | 22% | Required fields present |
| Plausibility | 22% | Sport-specific sanity (no-draw sports, score ranges, OU lines) |
| Normalization | 15% | Probabilities sum to 100 |
| Calibration | 15% | Confidence vs. rolling model accuracy |
| Hallucination | 15% | LLM pattern detection (invented stats, H2H, streaks) |
| Consensus | 7% | Multi-model agreement ≥ 50% |
| Market Edge | 4% | Edge claim ≤ 30% |

### Ongoing Tracking

| Metric | Table | Frequency |
|--------|-------|-----------|
| Brier Score | `calibration_log` | Daily (after settlement) |
| Log Loss | `calibration_log` | Daily |
| Accuracy % | `model_performance_log` | Daily |
| Calibration Error | `calibration_log` | Daily |
| Hallucination Score | `ai_audit_logs` | Per prediction |
| DQ Score | `predictions.enrichment_pct` | Per prediction |
| Drift Detection | `drift_log` | Daily |
| Model Promotions | `model_promotions` | On threshold met |

---

## 10. Production Gate Checklist

| Item | Status |
|------|--------|
| Primary provider: api-football/api-sports | ✅ Configured |
| Secondary provider: thesportsdb | ✅ Configured |
| Provider abstraction layer | ✅ `services/providers/` |
| Canonical 13-sport registry | ✅ `services/sportsRegistry.ts` |
| Removed sports guard (formula1/afl etc.) | ✅ Added `REMOVED_SPORTS` set |
| `formula1` removed from `SPORT_CONFIGS` | ✅ Fixed |
| `dataValidator.ts` VALID_SPORTS updated | ✅ All 13 sports + aliases |
| UTC timestamp storage | ✅ PostgreSQL timestamptz |
| Date navigation UTC-correct | ✅ `services/dateUtils.ts` |
| Timezone test: WAT/UTC/EST/PST | ✅ `buildDateRange()` |
| Quantitative models: all 13 sports | ✅ `quantitativeModels.ts` |
| LLM ±8% probability anchor | ✅ `generate-prediction/index.ts` |
| Quality gate v3 (7 stages) | ✅ `qualityGate.ts` |
| AI router (4 providers + circuit breaker) | ✅ `aiProviderRouter.ts` |
| No fabrication policy | ✅ LLM system prompt + gate Stage 5 |
| Brier score / log loss tracking | ✅ `calibration_log` table |
| Feature flags (all 13 sports) | ✅ 13 sport flags in DB |
| Provider failover flag | ✅ `provider_failover_circuit` |
| Quality gate flag | ✅ `prediction_quality_gate_v3` |
| Quantitative anchor flag | ✅ `quant_model_anchor` |

---

## Known Limitations

1. **Tennis live scores**: TheSportsDB free tier does not provide live tennis scores. Tennis predictions use pre-match data only.
2. **Odds coverage**: Real-time odds only available for Football (api-football). Other sports use market-implied from TheSportsDB where available.
3. **Cricket DQ**: TheSportsDB cricket data is limited (no player stats, no detailed innings data). Cricket predictions operate at higher uncertainty — confidence capped at 80%.
4. **Esports**: Volatile roster changes and patch-cycle meta shifts mean esports predictions have higher variance. Feature flags allow disabling per sport.

---

*Document auto-generated by Phase 5 Production Gate — PredictXta v5.0*
