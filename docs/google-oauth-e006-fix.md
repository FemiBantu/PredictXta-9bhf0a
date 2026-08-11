# Google OAuth E006 Fix — Setup Checklist

## Root Causes Fixed in Code

| # | Issue | Fix Applied |
|---|-------|-------------|
| 1 | **Android CCT false-positive E006** | After `cancel/dismiss` on Android, wait 6s for deep-link to resolve session via `waitForAndroidDeepLink()` |
| 2 | **`resolvePendingOAuth` not wired** | Deep-link handler in `_layout.tsx` now calls `handleOAuthCallback` (static import, not `require()`) which resolves the pending promise |
| 3 | **`WebBrowser.maybeCompleteAuthSession()` missing** | Added at module load — required for Expo web + Expo Go |
| 4 | **`autoVerify: true` on custom-scheme intent filter** | `autoVerify` set to `false` — verification only applies to HTTPS App Links, not custom schemes |
| 5 | **Missing `auth-callback` host intent filter** | Added `predictxta://auth-callback` intent filter in `app.json` |
| 6 | **`prompt: 'select_account'`** | Changed to `'consent'` — `select_account` can cause CCT to reuse an existing tab differently, worsening the timing issue |
| 7 | **No user-friendly E006 retry** | Login screen now shows "Try Again" button for E006 and rechecks Supabase session before showing the error |
| 8 | **E006 shown even when auth succeeded** | After E006, `getSession()` is called first — if a session exists, sign-in proceeds silently |

---

## Required External Configuration

### 1. Supabase Dashboard → Auth → URL Configuration

```
Site URL:        predictxta://
Redirect URLs:   predictxta://**
                 predictxta://auth/callback
                 predictxta://auth-callback
                 predictxta://reset-password
                 exp://**
```

> ⚠️ The wildcard `predictxta://**` must be **exactly** that — Supabase validates against this list.

### 2. Supabase Dashboard → Auth → Providers → Google

- ✅ **Enabled**: ON
- **Client ID**: Web OAuth Client ID (from Google Cloud Console)
- **Client Secret**: Web OAuth Client Secret

### 3. Google Cloud Console → Credentials

#### Web Client (required for Supabase PKCE)
- **Authorized JavaScript origins**: `https://YOUR_PROJECT.supabase.co`
- **Authorized redirect URIs**: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

#### Android Client
- **Package name**: `com.predictxta.app`
- **SHA-1 fingerprint**: Your debug or release keystore SHA-1
  ```bash
  # Get debug SHA-1
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

  # Get release SHA-1 (replace paths)
  keytool -list -v -keystore /path/to/release.keystore -alias YOUR_ALIAS
  ```
- **SHA-256 fingerprint**: Same keystore, SHA-256

#### iOS Client
- **Bundle ID**: `com.predictxta.app`

### 4. Google Cloud Console → OAuth Consent Screen

- **Publishing status**: **Published** (or add your test email to Test Users)
- **Scopes**: `openid`, `email`, `profile`
- **App name**: PredictXta
- **Authorized domains**: `supabase.co` (for the callback)

---

## Testing Guide

### Android APK Test
1. Build APK: Click **Download** → **Download APK** in OnSpace toolbar
2. Install on device
3. Tap "Continue with Google"
4. Select account → Grant permissions
5. App should open automatically ✅

### iOS Test
1. Use OnSpace App scan (QR code in Preview panel)
2. Tap "Continue with Google"
3. Safari opens → Select account
4. App re-opens automatically ✅

### Expo Go (Development)
> Google OAuth via custom scheme does NOT work in Expo Go.
> Use email/password sign-in for development testing.

---

## Diagnostic: Reading Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| E001 | Google provider not enabled in Supabase | Dashboard → Auth → Providers → Google → Enable |
| E002 | No OAuth URL from Supabase | Check Client ID / Client Secret |
| E003 | redirect_uri_mismatch | Add `predictxta://auth/callback` to Supabase Redirect URLs |
| E004 | access_denied | Publish OAuth Consent Screen or add test user |
| E005 | Custom scheme not registered | Rebuild native app (APK/IPA) |
| E006 | Browser cancelled (usually Android timing) | Code now auto-retries; see Section 1 above |
| E013 | SHA-1 not registered | Add SHA-1 to Android OAuth client in Google Cloud |
