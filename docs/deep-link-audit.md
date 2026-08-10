# PredictXta Deep-Link & Authentication Audit Report

Generated: 2026-07-22

---

## Root Cause of "Cannot make a deep link into a standalone app with no custom scheme defined"

**File:** `services/googleAuthService.ts` → `getRedirectUri()`  
**File:** `services/appleAuthService.ts` → `signInWithAppleOAuth()`

Both files previously called `Linking.createURL('auth/callback')` to generate OAuth redirect URIs. In a standalone production build (APK/AAB/IPA), `Linking.createURL()` requires an EAS project ID or a properly configured `app.json` `extra.eas.projectId`. Without it, the function throws:

> `Cannot make a deep link into a standalone app with no custom scheme defined`

**Fix applied:** Replaced all `Linking.createURL()` calls with the hardcoded string `'predictxta://auth/callback'` for native builds.

---

## Package / Bundle ID Reference

| Platform | Identifier                  |
|----------|-----------------------------|
| Android  | `com.predictxta.sports`     |
| iOS      | `com.predictxta.app`        |

> ⚠️ These are **different** — Android uses `.sports`, iOS uses `.app`.  
> Google Cloud Console must have **separate** Android and iOS OAuth clients configured with the correct identifiers.

---

## Files Modified

| File | Change |
|------|--------|
| `services/googleAuthService.ts` | Removed `Linking` import; replaced `Linking.createURL('auth/callback')` with `'predictxta://auth/callback'` in `getRedirectUri()` |
| `services/appleAuthService.ts` | Removed dynamic `import('expo-linking')`; replaced `Linking.createURL('auth/callback')` with `'predictxta://auth/callback'` in `signInWithAppleOAuth()` |
| `app.json` | Added 7 intent-filter entries covering all OAuth and deep-link paths; added `account-deleted` host filter; added `auth/callback` exact path filter |
| `app/_layout.tsx` | Enhanced `isOAuthCallback` detection to include `predictxta://auth` prefix; added guard to prevent OAuth handler from processing reset-password URLs |
| `app/deep-link-diagnostics.tsx` | **New** — Comprehensive deep-link diagnostics screen with canOpenURL tests, build-type detection, intent-filter audit, Supabase config check, and live OAuth E2E test |

---

## Deep-Link Routes Detected

| Route | Handler | Auth Flow |
|-------|---------|-----------|
| `predictxta://` | `_layout.tsx` → `PasswordResetDeepLinkHandler` | Bare scheme catch-all |
| `predictxta://auth` | `_layout.tsx` → `handleGoogleOAuthCallback` | OAuth entry point |
| `predictxta://auth/callback?code=XXX` | `googleAuthService.handleOAuthCallback()` | PKCE Google/Apple OAuth |
| `predictxta://auth/callback#access_token=XXX` | `googleAuthService.handleOAuthCallback()` | Implicit OAuth (legacy) |
| `predictxta://login-callback` | `_layout.tsx` → `handleGoogleOAuthCallback` | OAuth alternate path |
| `predictxta://reset-password` | `_layout.tsx` → `PasswordResetDeepLinkHandler` | Password reset |
| `predictxta://reset-password?type=recovery&code=XXX` | `_layout.tsx` → PKCE exchange | Password reset (PKCE) |
| `predictxta://reset-password#access_token=XXX&type=recovery` | `_layout.tsx` → setSession | Password reset (implicit) |
| `predictxta://account-deleted` | `app/account-deleted.tsx` | Post-deletion landing |
| `app/auth/callback` (Expo Router route) | `app/auth/callback.tsx` | OAuth screen handler |

---

## Authentication Providers Status

### Google OAuth
- **Flow:** PKCE via Supabase + Chrome Custom Tabs (CCT)
- **Redirect URI:** `predictxta://auth/callback` (hardcoded, production-safe)
- **E006 fix:** Pre-registered resolver + 15s poll + 6×500ms post-CCT retry
- **Android intent filters:** 7 entries (see below)
- **Required Supabase config:**
  - Site URL: `predictxta://`
  - Redirect URLs: `predictxta://**`, `predictxta://auth/callback`, `predictxta://reset-password`, `exp://**`
  - Google provider: enabled with Web Client ID + Secret
- **Required Google Cloud Console:**
  - Web client → Authorized redirect URI: `https://osmkbrryalhtpnayosmk.supabase.co/auth/v1/callback`
  - Android client → Package: `com.predictxta.sports` (NOT `.app`), SHA-1 fingerprint
  - iOS client → Bundle ID: `com.predictxta.app` (NOT `.sports`)

### Apple Sign-In
- **iOS flow:** Native `expo-apple-authentication` → `signInWithIdToken`
- **Android/Web flow:** OAuth via Supabase → `predictxta://auth/callback` (fixed)
- **Required Supabase config:** Apple provider enabled with Team ID, Key ID, Private Key
- **Required Apple Console:** Service ID `com.predictxta.app`, Return URL: `https://osmkbrryalhtpnayosmk.supabase.co/auth/v1/callback`

### Email OTP
- **Redirect:** None (OTP code verified in-app via `verifyOTPAndLogin`)
- **Status:** No deep-link dependency

### Password Reset (Magic Link)
- **Redirect URI:** `predictxta://reset-password` (in `login.tsx` → `handleForgot`)
- **Route:** `app/reset-password.tsx`
- **Supabase redirectTo:** `predictxta://reset-password`

### Email Verification
- **Redirect:** Handled by Supabase → lands on `app/auth/callback.tsx`

---

## Android Build Requirements

```
Package name: com.predictxta.sports
Min SDK: 24
Target SDK: 35
Scheme: predictxta
```

**Intent Filters registered (7 entries):**
1. `predictxta://` — bare scheme (catch-all)
2. `predictxta://auth` — OAuth host
3. `predictxta://auth/callback` (pathPrefix) — OAuth path prefix
4. `predictxta://auth/callback` (exact path) — OAuth exact path
5. `predictxta://login-callback` — alternate OAuth path
6. `predictxta://reset-password` — password reset
7. `predictxta://account-deleted` — post-deletion landing

## iOS Build Requirements

```
Bundle ID: com.predictxta.app
Scheme: predictxta (CFBundleURLSchemes)
usesAppleSignIn: true
```

**URL Types:**
- `CFBundleURLSchemes: ["predictxta"]`
- `CFBundleURLName: "com.predictxta.app"`
- `CFBundleTypeRole: "Editor"` (required for OAuth deep links)

---

## Expo Go Warning

⚠️ **Custom scheme deep links do NOT work in Expo Go.**

| Environment | canOpenURL('predictxta://') | OAuth works |
|-------------|----------------------------|-------------|
| Expo Go | false | ✗ No |
| Dev Build (EAS) | true | ✓ Yes |
| Production APK/IPA | true | ✓ Yes |
| Web Preview | false | ✗ No |

Use `app/deep-link-diagnostics.tsx` to verify your build environment before testing OAuth.

---

## Supabase Auth URL Configuration (Required Settings)

```
Site URL:
  predictxta://

Redirect URLs (add ALL):
  predictxta://
  predictxta://**
  predictxta://auth/callback
  predictxta://reset-password
  predictxta://account-deleted
  exp://**
  https://*.supabase.co/auth/v1/callback
```

## Google Cloud Console OAuth Configuration

### Web Application Client
```
Authorized JavaScript Origins:
  https://osmkbrryalhtpnayosmk.supabase.co

Authorized Redirect URIs:
  https://osmkbrryalhtpnayosmk.supabase.co/auth/v1/callback
```

### Android Client  
```
Package name:         com.predictxta.sports
SHA-1 (debug):        keytool -keystore ~/.android/debug.keystore -list -v
SHA-1 (release):      keytool -keystore release.keystore -list -v
```

### iOS Client
```
Bundle ID:            com.predictxta.app
```

---

## Production Build Verification Checklist

- [ ] Install APK/IPA (not Expo Go — custom schemes only work in standalone builds)
- [ ] Run `app/deep-link-diagnostics.tsx` — all critical checks pass
- [ ] Tap "Continue with Google" → browser opens → sign in → app receives `predictxta://auth/callback?code=XXX` → session established
- [ ] Tap "Continue with Apple" (iOS only) → native dialog → sign in → session established
- [ ] Tap "Forgot Password" → email sent → tap link → app opens reset screen
- [ ] Admin → OAuth Debug screen → Run Checks → all 5 checks pass
- [ ] Supabase Dashboard → Auth → URL Configuration → verify `predictxta://**` is listed
- [ ] Google Cloud Console → Android client → verify `com.predictxta.sports` + release SHA-1

---

## Why `Linking.createURL()` is Banned for OAuth in This Project

`Linking.createURL()` has different behavior across environments:

| Environment | Result |
|-------------|--------|
| Expo Go | `exp://192.168.x.x:8081/--/auth/callback` |
| EAS Dev Build | `predictxta://auth/callback` (if `extra.eas.projectId` set) |
| Standalone APK/IPA (no EAS) | **THROWS** `"Cannot make a deep link into a standalone app with no custom scheme defined"` |
| Web | `http://localhost:8081/auth/callback` |

Since we always want `predictxta://auth/callback` in production, the hardcoded string is the only safe approach. The Expo Go `exp://` URL is registered in Supabase redirect URLs separately for development testing.

---

## AuthSession.makeRedirectUri() — NOT USED

`AuthSession.makeRedirectUri()` is explicitly banned in this project (see `docs/google-oauth-setup.md`). It wraps `Linking.createURL()` and inherits the same environment-dependent behavior. All OAuth redirect URIs use the hardcoded `predictxta://auth/callback` string.
