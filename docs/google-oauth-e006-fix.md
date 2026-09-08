# Google OAuth E006 Fix — Setup Checklist

Updated: 2026-09-08 (Phase 2 — corrected to canonical bundle IDs)

---

## Canonical Identifiers

| Platform | Identifier              |
|----------|------------------------|
| Android  | `com.predictxta.sports` |
| iOS      | `com.predictxta.sports` |

> An earlier version of this document listed `com.predictxta.app` for both
> Android and iOS. The canonical identifier for all Google Cloud OAuth clients
> is `com.predictxta.sports`.

---

## Root Causes Fixed in Code

| # | Issue | Fix Applied |
|---|-------|-------------|
| 1 | **Android CCT false-positive E006** | After `cancel/dismiss` on Android, wait 6s for deep-link to resolve session via `waitForAndroidDeepLink()` |
| 2 | **`resolvePendingOAuth` not wired** | Deep-link handler in `_layout.tsx` now calls `handleOAuthCallback` which resolves the pending promise |
| 3 | **`WebBrowser.maybeCompleteAuthSession()` missing** | Added at module load — required for Expo web + Expo Go |
| 4 | **`autoVerify: true` on custom-scheme intent filter** | `autoVerify` set to `false` — verification only applies to HTTPS App Links |
| 5 | **Missing `auth-callback` host intent filter** | `predictxta://auth-callback` intent filter added in `app.json` |
| 6 | **`prompt: 'select_account'`** | Changed to `'consent'` — reduces CCT timing issues |
| 7 | **No user-friendly E006 retry** | Login screen shows "Try Again" button; rechecks session before showing error |
| 8 | **E006 shown even when auth succeeded** | After E006, `getSession()` is called first — if session exists, sign-in proceeds silently |

---

## Required External Configuration

### 1. Supabase Dashboard → Auth → URL Configuration

```
Site URL:        predictxta://

Redirect URLs:
  predictxta://**
  predictxta://auth/callback
  predictxta://auth-callback
  predictxta://reset-password
  predictxta://account-deleted
  exp://**
  https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

### 2. Supabase Dashboard → Auth → Providers → Google

- ✅ **Enabled**: ON
- **Client ID**: Web OAuth Client ID from Google Cloud Console
- **Client Secret**: Web OAuth Client Secret

### 3. Google Cloud Console → Credentials

#### Web Client (required for Supabase PKCE)
- **Authorized redirect URIs**: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

#### Android Client
- **Package name**: `com.predictxta.sports`
- **SHA-1 fingerprint**: `eas credentials --platform android` (production keystore)
  ```bash
  # Debug SHA-1 (local dev only)
  keytool -list -v -keystore ~/.android/debug.keystore \
    -alias androiddebugkey -storepass android -keypass android
  ```

#### iOS Client
- **Bundle ID**: `com.predictxta.sports`

### 4. Google Cloud Console → OAuth Consent Screen
- **Publishing status**: **Published** (or add test users)
- **Scopes**: `openid`, `email`, `profile`
- **App name**: PredictXta

---

## Testing Guide

### Android APK Test
1. Build: `eas build --platform android --profile production-apk`
2. Install on device
3. Tap "Continue with Google" → Select account → App opens ✅

### iOS Test
1. Build: `eas build --platform ios --profile production`
2. Install via TestFlight
3. Tap "Continue with Google" → Safari opens → App re-opens ✅

### Expo Go (Development)
> Google OAuth via custom scheme does NOT work in Expo Go.
> Use email/password sign-in for development testing.

---

## Error Code Reference

| Code | Meaning | Fix |
|------|---------|-----|
| E001 | Google provider not enabled | Supabase → Auth → Providers → Google → Enable |
| E002 | No OAuth URL from Supabase | Check Client ID / Client Secret |
| E003 | redirect_uri_mismatch | Add Supabase callback URL to Supabase Redirect URLs |
| E004 | access_denied | Publish OAuth Consent Screen or add test user |
| E005 | Custom scheme not registered | Rebuild native APK/IPA |
| E006 | Browser cancelled (Android timing) | Auto-retries; see §1 above |
| E011 | Package name mismatch | Use `com.predictxta.sports` in Google Cloud Android client |
| E012 | Bundle ID mismatch | Use `com.predictxta.sports` in Google Cloud iOS client |
| E013 | SHA-1 not registered | Add production keystore SHA-1 to Google Cloud Android OAuth client |
