# Credential Security Audit — PredictXta
**Date:** 2026-09-19  
**Scope:** Full repository scan for hardcoded credentials across all listed categories  
**Triggered by:** P0 GitHub token exposure incident in `scripts/reset-project.js`

---

## Audit Summary

| Credential Category | Status | Finding |
|---|---|---|
| Supabase Service Role Key | ✅ SAFE | Referenced only via `Deno.env.get()` in Edge Functions; never in client code |
| Supabase Anon Key | ✅ SAFE | Only in `.env.example` as placeholder; runtime value from `EXPO_PUBLIC_SUPABASE_ANON_KEY` env var |
| API Football Key | ✅ SAFE | Referenced as `Deno.env.get('API_FOOTBALL_KEY')` only; no hardcoded value |
| Firebase Credentials | ✅ SAFE | `GoogleService-Info.plist` and `google-services.json` are **placeholder files** (all values are `YOUR_*`); real files injected via EAS secrets at build time |
| Cloudflare Credentials | ✅ SAFE | All read via `Deno.env.get('CLOUDFLARE_API_TOKEN')` / `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_ACCOUNT_ID`; never hardcoded |
| Google Cloud Credentials | ✅ SAFE | FCM service account read from `Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')`; no key embedded in source |
| OpenAI API Key | ✅ SAFE | Read via `Deno.env.get('OPENAI_API_KEY')` in Edge Functions only; no `sk-*` value in source |
| Gemini API Key | ✅ SAFE | Read via `Deno.env.get('Gemini_API_Key')` in Edge Functions only |
| Groq API Key | ✅ SAFE | Read via `Deno.env.get('Groq_API')` in Edge Functions only |
| Expo/EAS Token | ✅ SAFE | Referenced only in `deploy.yml` as `${{ secrets.EXPO_TOKEN }}`; never in source files |
| GitHub Actions Secrets | ✅ SAFE | CI workflow references `${{ secrets.* }}` exclusively; no secret values committed |
| GitHub PAT (ghp_) | ⚠️ REMEDIATED | **Was exposed** in `scripts/reset-project.js`. Token removed. See `SECURITY-INCIDENT-2026-09-19.md` |

---

## Detailed Findings

### 1. Supabase Keys

**`SUPABASE_SERVICE_ROLE_KEY`**
- Used in 25+ Edge Functions via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
- **Correctly absent** from all client-side files (`app/`, `services/`, `hooks/`, `components/`)
- CI gate in `deploy.yml` explicitly scans for `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE` and fails the build if found

**`SUPABASE_ANON_KEY`**
- `.env.example` contains `your_supabase_anon_key_here` (placeholder only — safe to commit)
- Runtime value comes from `EXPO_PUBLIC_SUPABASE_ANON_KEY` set in EAS secrets / local `.env`
- `template/core/config.ts` reads `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` — correct pattern

### 2. API Football Key

- `Deno.env.get('API_FOOTBALL_KEY')` in `fetch-matches`, `fetch-odds`, `sync-live`, `sync-standings`
- Appears in `.env.example` as a comment only (`# API_FOOTBALL_KEY=`)
- **No hardcoded value** found anywhere in source

### 3. Firebase / Google Cloud Credentials

**`GoogleService-Info.plist`** (iOS)
- All sensitive fields contain `YOUR_IOS_CLIENT_ID`, `YOUR_IOS_API_KEY`, `YOUR_REVERSED_*`
- These are **placeholder stubs** — real file injected via `eas secret:create --name GOOGLE_SERVICES_PLIST`
- `GOOGLE_APP_ID` (`1:409581654804:ios:2f29fa76a637e4b1ef6801`) and `GCM_SENDER_ID` (`409581654804`) are **non-secret** project identifiers (safe to be in source)

**`google-services.json`** (Android)
- `mobilesdk_app_id` (`1:409581654804:android:...`) and `project_number` are **non-secret** identifiers
- OAuth client IDs are `YOUR_ANDROID_CLIENT_ID` / `YOUR_WEB_CLIENT_ID` — placeholders
- `current_key` is `YOUR_ANDROID_API_KEY` — placeholder
- `certificate_hash` is `YOUR_SHA1_FINGERPRINT` — placeholder

**FCM Service Account** (`FIREBASE_SERVICE_ACCOUNT_JSON`)
- The full service account JSON (with `private_key`) is loaded exclusively via `Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')` in `send-push/index.ts`
- **No private_key value** is embedded in any source file

**Firebase RTDB / Server Key** (`FIREBASE_SERVER_KEY`)
- Referenced only in `supabase/functions/send-push` logic, sourced from env var
- **No literal server key** found in source

### 4. Cloudflare Credentials

All three Cloudflare secrets are consumed exclusively server-side:
- `CLOUDFLARE_API_TOKEN` → `Deno.env.get()` in `_shared/cloudflare.ts`
- `CLOUDFLARE_ZONE_ID` → `Deno.env.get()` in `_shared/cloudflare.ts`
- `CLOUDFLARE_ACCOUNT_ID` → `Deno.env.get()` in `_shared/cloudflare.ts`

The `cloudflare/wrangler.toml` and `wrangler-cache.toml` reference variable names only — no token values.

### 5. AI Provider Keys (OpenAI / Gemini / Groq / Anthropic)

The CI `deploy.yml` **scans for** `EXPO_PUBLIC_OPENAI`, `EXPO_PUBLIC_GEMINI`, `EXPO_PUBLIC_GROQ` and fails the build if any are found in client code.

All AI keys are consumed server-side in Edge Functions only:
```
Deno.env.get('OPENAI_API_KEY')
Deno.env.get('Gemini_API_Key')
Deno.env.get('Groq_API')
Deno.env.get('ANTHROPIC_API_KEY')
```

No `sk-proj-`, `sk-org-`, `AIzaSy`, or `gsk_` literal values found in any source file.

### 6. Expo / EAS Credentials

`deploy.yml` uses `${{ secrets.EXPO_TOKEN }}` only. No `EXPO_TOKEN` value is hardcoded.

### 7. GitHub Actions Secrets

All secrets in `deploy.yml` follow the `${{ secrets.SECRET_NAME }}` pattern:
- `secrets.EXPO_TOKEN`
- `secrets.GOOGLE_SERVICES_JSON`

No secret values are committed.

---

## Remaining Risk: `.env` File

The `.env` file at project root **cannot be read** by this tool (protected). However:

1. `.gitignore` must list `.env` — **verify this manually**
2. `.env.example` contains only placeholders — safe to commit ✅
3. Any real values in `.env` stay local-only provided `.gitignore` is correct

**Action required:** Run `git status` and confirm `.env` is untracked:
```bash
git ls-files --others --exclude-standard | grep '\.env$'
# Should return nothing (meaning .env is gitignored)

git check-ignore -v .env
# Should output: .gitignore:N:.env
```

---

## Recommended Hardening Actions

### A. Add Gitleaks to CI (not yet present)
The current CI scans for `EXPO_PUBLIC_*` patterns but lacks a general-purpose secret scanner.  
See `docs/SECURITY-INCIDENT-2026-09-19.md` — add gitleaks step.

### B. Verify `.env` is gitignored
```bash
cat .gitignore | grep '\.env'
```
Expected: `.env` or `*.env` is listed.

### C. Confirm Firebase placeholder files are gitignored in production
The placeholder `GoogleService-Info.plist` and `google-services.json` are safe to commit because they contain no real secrets. Real files must be injected via EAS secrets — document this clearly in onboarding.

### D. Rotate `GCM_SENDER_ID` / `project_number` if project is ever compromised
These are non-secret Firebase identifiers but if the project itself is compromised, regenerate Firebase project keys entirely.

### E. Consider moving to GitHub fine-grained PATs for any automation
If `scripts/reset-project.js` ever needs a real GitHub token, use a fine-grained PAT scoped to minimum permissions (single repo, no admin scopes) stored in `eas secret` or GitHub Actions secrets only.

---

## Files Verified Clean (no hardcoded credential values)

```
supabase/functions/_shared/cloudflare.ts       — all env var refs
supabase/functions/send-push/index.ts          — all env var refs
supabase/functions/fetch-matches/index.ts      — all env var refs
supabase/functions/fetch-odds/index.ts         — all env var refs
supabase/functions/verify-purchase/index.ts    — all env var refs
supabase/functions/generate-prediction/index.ts — all env var refs
.github/workflows/deploy.yml                   — secrets.* only
.env.example                                   — placeholders only
GoogleService-Info.plist                       — placeholders only
google-services.json                           — placeholders only
scripts/reset-project.js                       — REMEDIATED (token removed)
```
