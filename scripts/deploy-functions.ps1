# =============================================================================
# PredictXta — Deploy All Edge Functions (Windows PowerShell)
# =============================================================================
# Usage (PowerShell):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\deploy-functions.ps1
#
# Prerequisites:
#   1. Supabase CLI: npm install -g supabase
#   2. Login:        supabase login
#   3. Link project: supabase link --project-ref osmkbrryalhtpnayosmk
# =============================================================================

$PROJECT_REF = "osmkbrryalhtpnayosmk"
$DEPLOY_FLAGS = "--no-verify-jwt"

$FUNCTIONS = @(
    # Data Ingestion
    "fetch-matches",
    "fetch-odds",
    "sync-standings",
    "sync-highlights",
    "sync-news",
    "sync-live",
    # AI Prediction Engine
    "generate-prediction",
    "multi-model-prediction",
    "ai-intelligence",
    "ai-sports-chat",
    "rebalance-weights",
    # Scheduling & Pipeline
    "daily-scheduler",
    "generate-daily-challenge",
    "pipeline-audit",
    "monitoring-dashboard",
    "predictions-feed",
    "home-feed",
    "resolve-prediction",
    # User Services
    "send-push",
    "translate-content",
    "expert-promotion",
    # Live & Streaming
    "firebase-live",
    "live-stream",
    # Webhooks
    "webhook-receiver"
)

Write-Host "`n╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     PredictXta — Edge Function Deployment            ║" -ForegroundColor Cyan
Write-Host "║     Project: $PROJECT_REF           ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$pass = 0; $fail = 0; $skipped = 0
$failedList = @()

foreach ($fn in $FUNCTIONS) {
    $dir = "supabase/functions/$fn"
    if (-not (Test-Path "$dir/index.ts")) {
        Write-Host "  [SKIP] $fn — not found" -ForegroundColor Yellow
        $skipped++
        continue
    }
    Write-Host "  Deploying $fn..." -NoNewline
    $result = & supabase functions deploy $fn $DEPLOY_FLAGS 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✓ DEPLOYED" -ForegroundColor Green
        $pass++
    } else {
        Write-Host " ✗ FAILED" -ForegroundColor Red
        $fail++
        $failedList += $fn
    }
}

Write-Host "`n══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Total:    $($FUNCTIONS.Count)"
Write-Host "  Deployed: $pass" -ForegroundColor Green
if ($skipped -gt 0) { Write-Host "  Skipped:  $skipped" -ForegroundColor Yellow }
if ($fail -gt 0)    { Write-Host "  Failed:   $fail" -ForegroundColor Red }
Write-Host "══════════════════════════════════════════════════════`n" -ForegroundColor Cyan

if ($failedList.Count -gt 0) {
    Write-Host "Failed functions:" -ForegroundColor Red
    foreach ($fn in $failedList) { Write-Host "    ✗ $fn" -ForegroundColor Red }
    Write-Host "`nRetry with: supabase functions deploy <name> --no-verify-jwt`n"
    exit 1
}

Write-Host "All $pass functions deployed successfully!`n" -ForegroundColor Green
Write-Host "Verify: supabase functions list"
Write-Host "Logs:   supabase functions logs daily-scheduler --tail`n"
