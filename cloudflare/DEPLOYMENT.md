# PredictXta · Cloudflare Edge Security & Performance
## Deployment Guide

---

## Architecture Overview

```
PredictXta Mobile App (React Native)
         │
         ▼
Cloudflare Workers (px-gateway)           ← YOU ARE DEPLOYING THIS
    ├── WAF (SQL injection, XSS, path traversal)
    ├── Bot Detection (UA scoring, threat scoring)
    ├── Rate Limiting (Free: 100/min, VIP: 500/min, Anon: 30/min)
    ├── Edge Cache (KV-backed, route-aware TTLs)
    ├── HMAC Request Signing
    └── Security Headers (OWASP hardened)
         │
         ▼
OnSpace Edge Functions (Supabase-compatible)
    ├── home-feed          → Cache TTL: 30s
    ├── generate-prediction → Cache TTL: 300s
    ├── fetch-odds          → Cache TTL: 60s
    ├── translate-content   → Cache TTL: 3600s
    ├── ai-sports-chat      → No cache (streaming)
    ├── fetch-matches       → No cache (sync ops)
    └── sync-*              → No cache (sync ops)
         │
         ▼
Supabase PostgreSQL Database
```

---

## Prerequisites

1. **Node.js 18+** installed
2. **Cloudflare account** (Free plan works for Workers)
3. **Wrangler CLI**: `npm install -g wrangler`
4. API keys already configured in OnSpace Cloud Secrets

---

## Step 1: Authenticate Wrangler

```bash
npx wrangler login
```

---

## Step 2: Create KV Namespace

```bash
# Create production namespace
npx wrangler kv:namespace create "PX_CACHE"
# → Creates namespace, outputs:
#   [[kv_namespaces]]
#   binding = "PX_CACHE"
#   id = "abc123..."

# Create preview namespace (for local dev)
npx wrangler kv:namespace create "PX_CACHE" --preview
# → Outputs preview_id = "xyz789..."
```

Update `cloudflare/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "PX_CACHE"
id = "abc123..."           # ← Replace with your production ID
preview_id = "xyz789..."   # ← Replace with your preview ID
```

---

## Step 3: Set Secrets

```bash
cd cloudflare

# Signing secret (must match PX_SIGNING_SECRET in OnSpace Cloud Secrets)
npx wrangler secret put PX_SIGNING_SECRET

# Supabase anon key (for unauthenticated requests to origin)
npx wrangler secret put SUPABASE_ANON_KEY
```

---

## Step 4: Update Origin URL

In `cloudflare/wrangler.toml`, verify:
```toml
[vars]
ONSPACE_BASE_URL = "https://osmkbrryalhtpnayosmk.backend.onspace.ai"
```

---

## Step 5: Deploy Gateway Worker

```bash
cd cloudflare
npx wrangler deploy
```

Expected output:
```
✓ Uploaded px-gateway (X.XX sec)
✓ Deployed px-gateway triggers
  https://px-gateway.YOUR_SUBDOMAIN.workers.dev
```

---

## Step 6: Deploy Cache Manager Worker

```bash
npx wrangler deploy workers/sports-cache.ts --name px-cache-manager
```

Save the cache manager URL, then add it as a secret in OnSpace Cloud:
- Go to: OnSpace Cloud Dashboard → Secrets
- Add: `CLOUDFLARE_CACHE_MANAGER_URL` = `https://px-cache-manager.YOUR_SUBDOMAIN.workers.dev`

---

## Step 7: Configure Mobile App (Optional)

In your `.env` file:
```env
EXPO_PUBLIC_CLOUDFLARE_GATEWAY_URL=https://px-gateway.YOUR_SUBDOMAIN.workers.dev
```

When this variable is set, the app routes API calls through Cloudflare for edge caching and rate limiting.

---

## Step 8: Configure Custom Domain (Optional)

In Cloudflare Dashboard → Workers & Pages → px-gateway → Triggers:
1. Add Custom Domain: `api.predictxta.com`
2. Update `.env`: `EXPO_PUBLIC_CLOUDFLARE_GATEWAY_URL=https://api.predictxta.com`

---

## Rate Limiting Tiers

| Tier | Requests/60s | AI Calls/60s | Predictions/60s |
|------|-------------|-------------|-----------------|
| Anon | 30 | 9 | 15 |
| Free | 100 | 30 | 50 |
| VIP  | 500 | 150 | 250 |

The mobile app sends `X-PX-User-Tier: vip|free|anon` header. VIP status is verified server-side from the JWT.

---

## Cache TTL Reference

| Endpoint | TTL | Stale-While-Revalidate |
|----------|-----|----------------------|
| home-feed | 30s | 60s |
| generate-prediction | 300s | 600s |
| fetch-odds | 60s | 120s |
| translate-content | 3600s | 7200s |
| firebase-live | 12s | 24s |
| ai-sports-chat | No cache | — |
| fetch-matches | No cache | — |
| sync-* | No cache | — |

---

## Cache Invalidation

After each data sync, the edge functions automatically call the cache manager to purge stale entries:

```
sync-news   → purges: home-feed, sync-news
sync-live   → purges: home-feed, firebase-live
fetch-matches → purges: home-feed, fetch-matches
fetch-odds  → purges: fetch-odds
```

---

## Monitoring & Analytics

View cache stats:
```bash
curl https://px-cache-manager.YOUR_SUBDOMAIN.workers.dev/cache/stats
```

Health check:
```bash
curl https://px-cache-manager.YOUR_SUBDOMAIN.workers.dev/cache/health
```

Manual cache purge:
```bash
curl -X POST https://px-cache-manager.YOUR_SUBDOMAIN.workers.dev/cache/purge \
  -H "Content-Type: application/json" \
  -d '{"syncJob": "fetch-matches"}'
```

Pre-warm cache:
```bash
curl -X POST https://px-cache-manager.YOUR_SUBDOMAIN.workers.dev/cache/warm \
  -H "Content-Type: application/json" \
  -d '{"sports": ["all", "football", "basketball"]}'
```

---

## Security Policies Active

| Layer | Protection |
|-------|-----------|
| WAF | SQL injection, XSS, Path traversal, SSRF |
| Bot Detection | 14 scanner UA patterns, 5 betting bot patterns, CF threat score |
| Rate Limiting | Per-IP + per-user tier, distributed KV state |
| Request Signing | HMAC-SHA256 with 5-minute timestamp replay protection |
| Security Headers | HSTS, X-Frame-Options, CSP, Permissions-Policy |
| CORS | Allowlist with signing headers included |

---

## DDoS Auto-Mitigation

Cloudflare automatically absorbs L3/L4 DDoS (unlimited mitigation on all plans). For L7 (application layer), the Worker's rate limiter activates:
- Free tier: >30 req/min → blocked for 5 minutes
- All tiers: 5× burst rate → temporary block
- Bot UA match → immediate 403

Traffic spikes during Champions League finals, World Cup, etc. are handled by Cloudflare's global edge network (300+ PoPs).

---

## Cost Estimate

| Resource | Free Tier | Paid |
|----------|-----------|------|
| Worker Requests | 100K/day | $0.30/M |
| KV Reads | 100K/day | $0.50/M |
| KV Writes | 1K/day | $5/M |
| KV Storage | 1 GB | $0.50/GB |

For 1M users, expected monthly cost: ~$15-50/month in Cloudflare Workers.
Compare to: Direct Supabase Edge Function calls at scale without caching.

**Expected cache hit rate: 60-80%** for sports data (heavily read, infrequently written).
**Expected latency improvement: 200-400ms** for cached responses vs. cold Edge Function calls.
