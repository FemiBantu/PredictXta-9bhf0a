#!/usr/bin/env bash
##############################################################################
#  PredictXta · Cloudflare Workers Deployment Script
#
#  Usage:
#    chmod +x cloudflare/deploy.sh
#    ./cloudflare/deploy.sh
#
#  Prerequisites:
#    - Node.js 18+
#    - Wrangler CLI: npm install -g wrangler
#    - Logged in: npx wrangler login
#
#  What this script does:
#    1. Creates the KV namespace (if not already created)
#    2. Injects the KV IDs into both wrangler configs
#    3. Sets required secrets for both Workers
#    4. Deploys px-gateway Worker
#    5. Deploys px-cache-manager Worker
#    6. Outputs the Worker URLs for .env and OnSpace Cloud Secrets
##############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATEWAY_TOML="$SCRIPT_DIR/wrangler.toml"
CACHE_TOML="$SCRIPT_DIR/wrangler-cache.toml"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      PredictXta · Cloudflare Workers Deployment             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: KV Namespace ──────────────────────────────────────────────────────
echo "▶ Step 1/5: Creating KV namespace..."
echo ""
echo "  Run these two commands and note the IDs returned:"
echo ""
echo "  npx wrangler kv:namespace create \"PX_CACHE\""
echo "  npx wrangler kv:namespace create \"PX_CACHE\" --preview"
echo ""
echo "  Then update BOTH wrangler.toml and wrangler-cache.toml:"
echo "  Replace 'replace_with_your_kv_namespace_id' with the production id"
echo "  Replace 'replace_with_your_preview_kv_namespace_id' with the preview id"
echo ""
read -p "  Press ENTER once you have updated both toml files with the KV IDs..."

# ── Step 2: Secrets for px-gateway ───────────────────────────────────────────
echo ""
echo "▶ Step 2/5: Setting secrets for px-gateway..."
echo "  (You will be prompted to enter each secret value)"
echo ""

cd "$SCRIPT_DIR"

echo "  → PX_SIGNING_SECRET (must match OnSpace Cloud Secrets value)"
npx wrangler secret put PX_SIGNING_SECRET

echo "  → SUPABASE_ANON_KEY (your Supabase/OnSpace anon key)"
npx wrangler secret put SUPABASE_ANON_KEY

# ── Step 3: Secrets for px-cache-manager ─────────────────────────────────────
echo ""
echo "▶ Step 3/5: Setting secrets for px-cache-manager..."
echo ""

echo "  → PX_SIGNING_SECRET"
npx wrangler secret put PX_SIGNING_SECRET --config "$CACHE_TOML"

echo "  → SUPABASE_ANON_KEY"
npx wrangler secret put SUPABASE_ANON_KEY --config "$CACHE_TOML"

# ── Step 4: Deploy px-gateway ─────────────────────────────────────────────────
echo ""
echo "▶ Step 4/5: Deploying px-gateway Worker..."
echo ""
GATEWAY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$GATEWAY_OUTPUT"
GATEWAY_URL=$(echo "$GATEWAY_OUTPUT" | grep -oE 'https://px-gateway\.[a-z0-9-]+\.workers\.dev' | head -1)

# ── Step 5: Deploy px-cache-manager ──────────────────────────────────────────
echo ""
echo "▶ Step 5/5: Deploying px-cache-manager Worker..."
echo ""
CACHE_OUTPUT=$(npx wrangler deploy --config "$CACHE_TOML" 2>&1)
echo "$CACHE_OUTPUT"
CACHE_URL=$(echo "$CACHE_OUTPUT" | grep -oE 'https://px-cache-manager\.[a-z0-9-]+\.workers\.dev' | head -1)

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Deployment Complete!                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Gateway URL  : ${GATEWAY_URL:-https://px-gateway.<subdomain>.workers.dev}"
echo "  Cache Mgr URL: ${CACHE_URL:-https://px-cache-manager.<subdomain>.workers.dev}"
echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "  NEXT STEPS:"
echo ""
echo "  1. Add to your .env file:"
echo "     EXPO_PUBLIC_CLOUDFLARE_GATEWAY_URL=${GATEWAY_URL:-<gateway-url>}"
echo ""
echo "  2. Add to OnSpace Cloud Secrets (Dashboard → Cloud → Secrets):"
echo "     Key:   CLOUDFLARE_CACHE_MANAGER_URL"
echo "     Value: ${CACHE_URL:-<cache-manager-url>}"
echo ""
echo "  3. Verify deployment:"
echo "     curl ${CACHE_URL:-<cache-manager-url>}/cache/health"
echo "─────────────────────────────────────────────────────────────────"
echo ""
