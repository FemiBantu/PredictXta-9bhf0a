#!/bin/bash
# =============================================================================
# PredictXta — Deploy All Edge Functions
# =============================================================================
# Usage:
#   chmod +x scripts/deploy-functions.sh
#   ./scripts/deploy-functions.sh
#
# Prerequisites:
#   1. Supabase CLI installed: npm install -g supabase
#   2. Logged in:             supabase login
#   3. Project linked:        supabase link --project-ref <your-project-ref>
#
# Your project ref is in the Supabase dashboard URL:
#   https://supabase.com/dashboard/project/<PROJECT_REF>
# Or from your backend URL: https://osmkbrryalhtpnayosmk.backend.onspace.ai
#   → project ref = osmkbrryalhtpnayosmk
# =============================================================================

set -e  # exit on error

PROJECT_REF="${SUPABASE_PROJECT_REF:-osmkbrryalhtpnayosmk}"
DEPLOY_FLAGS="--no-verify-jwt"   # required for cron/scheduled functions

# ── Colour output ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Colour

log_info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $1"; }

# ── All functions to deploy ────────────────────────────────────────────────────
FUNCTIONS=(
  # Data Ingestion
  "fetch-matches"
  "fetch-odds"
  "sync-standings"
  "sync-highlights"
  "sync-news"
  "sync-live"

  # AI Prediction Engine
  "generate-prediction"
  "multi-model-prediction"
  "ai-intelligence"
  "ai-sports-chat"
  "rebalance-weights"

  # Scheduling & Pipeline
  "daily-scheduler"
  "generate-daily-challenge"
  "pipeline-audit"
  "monitoring-dashboard"
  "predictions-feed"
  "home-feed"
  "resolve-prediction"

  # User Services
  "send-push"
  "translate-content"
  "expert-promotion"

  # Live & Streaming
  "firebase-live"
  "live-stream"

  # Webhooks
  "webhook-receiver"
)

TOTAL=${#FUNCTIONS[@]}
PASS=0
FAIL=0
SKIPPED=0
FAILED_LIST=()

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     PredictXta — Edge Function Deployment            ║${NC}"
echo -e "${CYAN}║     Project: ${PROJECT_REF}           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
log_info "Deploying ${TOTAL} edge functions..."
echo ""

for fn in "${FUNCTIONS[@]}"; do
  FUNCTION_DIR="supabase/functions/${fn}"

  # Skip if directory doesn't exist
  if [ ! -d "$FUNCTION_DIR" ]; then
    log_warn "Skipping ${fn} — directory not found: ${FUNCTION_DIR}"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Skip if no index.ts
  if [ ! -f "${FUNCTION_DIR}/index.ts" ]; then
    log_warn "Skipping ${fn} — no index.ts found"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo -n "  Deploying ${fn}... "

  if supabase functions deploy "${fn}" ${DEPLOY_FLAGS} 2>/dev/null; then
    echo -e "${GREEN}✓ DEPLOYED${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAILED${NC}"
    FAIL=$((FAIL + 1))
    FAILED_LIST+=("$fn")
  fi
done

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "  Total:    ${TOTAL}"
echo -e "  ${GREEN}Deployed: ${PASS}${NC}"
[ $SKIPPED -gt 0 ] && echo -e "  ${YELLOW}Skipped:  ${SKIPPED}${NC}"
[ $FAIL -gt 0 ]    && echo -e "  ${RED}Failed:   ${FAIL}${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"

if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo ""
  log_error "The following functions failed to deploy:"
  for fn in "${FAILED_LIST[@]}"; do
    echo "    ✗ ${fn}"
  done
  echo ""
  log_info "Retry individual functions with:"
  for fn in "${FAILED_LIST[@]}"; do
    echo "    supabase functions deploy ${fn} --no-verify-jwt"
  done
  echo ""
  exit 1
fi

echo ""
log_success "All ${PASS} functions deployed successfully!"
echo ""
log_info "Verify deployment:"
echo "    supabase functions list"
echo ""
log_info "View logs for a function:"
echo "    supabase functions logs daily-scheduler --tail"
echo ""
