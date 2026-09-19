# ⚠️ HISTORICAL ONLY — See docs/PRODUCTION_SOURCE_OF_TRUTH.md

> **Deep-link routes, bundle IDs, and OAuth configuration in this document are correct and match `docs/PRODUCTION_SOURCE_OF_TRUTH.md §2 & §3`.**

---

# PredictXta Deep-Link & Authentication Audit Report

Generated: 2026-09-08 (Phase 2 revision — corrected bundle identifiers)

---

## Canonical Application Identifiers

| Platform | Identifier              | Source       |
|----------|-------------------------|--------------|
| Android  | `com.predictxta.sports` | app.json     |
| iOS      | `com.predictxta.sports` | app.json     |

> ✅ **Both platforms use the same package name.** An earlier version of this
> document incorrectly stated iOS used `com.predictxta.app`. That was wrong.
> `com.predictxta.app` is the **Apple Service ID** (a separate Apple Developer
> identifier used only for Sign In with Apple on web/Android OAuth via Supabase).
> It is NOT the iOS Bundle ID.

### Apple Service ID vs iOS Bundle ID

| Item | Value | Purpose |
|------|-------|---------|
| iOS Bundle ID | `com.predictxta.sports` | App Store, APNs, native Apple Sign-In |
| Apple Service ID | `com.predictxta.app` | Sign In with Apple on web/Android only — registered separately in Apple Developer Console → Identifiers → Services IDs. Entered in Supabase Auth → Apple provider as `client_id` |

---

## Root Cause of "Cannot make a deep link into a standalone app with no custom scheme defined"

**File:** `services/googleAuthService.ts` → `getRedirectUri()`
**File:** `services/appleAuthService.ts` → `signInWithAppleOAuth()`

Both files previously called `Linking.createURL('auth/callback')` to generate OAuth redirect URIs. In a standalone production build (APK/AAB/IPA), `Linking.createURL()` requires an EAS project ID or a properly configured `app.json` `extra.eas.projectId`. Without it, the function throws:

> `Cannot make a deep link into a standalone app with no custom scheme defined`

**Fix applied:** Replaced all `Linking.createURL()` calls with the hardcoded string `'predictxta://auth/callback'` for native builds.

---

## Deep-Link Routes

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

## Authentication Providers

### Google OAuth
- **Flow:** PKCE via Supabase + Chrome Custom Tabs (CCT)
- **Redirect URI:** `predictxta://auth/callback` (hardcoded, production-safe)
- **E006 fix:** Pre-registered resolver + 15s poll + 6×500ms post-CCT retry
- **Android intent filters:** 7 entries registered in app.json
- **Required Supabase config:**
  - Site URL: `predictxta://`
  - Redirect URLs: `predictxta://**`, `predictxta://auth/callback`, `predictxta://reset-password`, `exp://**`
  - Google provider: enabled with Web Client ID + Secret
- **Required Google Cloud Console:**
  - Web client → Authorized redirect URI: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`
  - Android client → Package: `com.predictxta.sports`, SHA-1 fingerprint from `eas credentials --platform android`
  - iOS client → Bundle ID: `com.predictxta.sports`

### Apple Sign-In
- **iOS flow:** Native `expo-apple-authentication` → `signInWithIdToken`
- **Android/Web flow:** OAuth via Supabase → `predictxta://auth/callback`
- **Required Supabase config:** Apple provider enabled with Team ID, Key ID, Private Key, Service ID: `com.predictxta.app`
- **Required Apple Console:**
  - Primary App ID: `com.predictxta.sports` (Capabilities: Sign In with Apple ✓, Push Notifications ✓)
  - Service ID: `com.predictxta.app` (for web/Android OAuth only), Return URL: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

### Email OTP
- **Redirect:** None (OTP code verified in-app via `verifyOTPAndLogin`)
- **Status:** No deep-link dependency

### Password Reset (Magic Link)
- **Redirect URI:** `predictxta://reset-password` (in `login.tsx` → `handleForgot`)
- **Route:** `app/reset-password.tsx`
- **Supabase redirectTo:** `predictxta://reset-password`

---

## Android Build Configuration (app.json verified)

```
Package:          com.predictxta.sports
Min SDK:          24
Target SDK:       36
Compile SDK:      36
Scheme:           predictxta
edgeToEdgeEnabled: true
```

**Intent Filters (7 entries in app.json):**
1. `predictxta://` — bare scheme (catch-all)
2. `predictxta://auth` — OAuth host
3. `predictxta://auth` (pathPrefix `/callback`) — OAuth path prefix
4. `predictxta://auth` (path `/callback`) — OAuth exact path
5. `predictxta://login-callback` — alternate OAuth path
6. `predictxta://reset-password` — password reset
7. `predictxta://account-deleted` — post-deletion landing

## iOS Build Configuration (app.json verified)

```
Bundle ID:        com.predictxta.sports
Scheme:           predictxta (CFBundleURLSchemes)
usesAppleSignIn:  true
aps-environment:  production
```

**URL Types (app.json infoPlist):**
- `CFBundleURLSchemes: ["predictxta"]`
- `CFBundleURLName: "com.predictxta.sports"`
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

---

## Supabase Auth URL Configuration

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
  https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

## Google Cloud Console OAuth Configuration

### Web Application Client
```
Authorized JavaScript Origins:
  https://osmkbrryalhtpnayosmk.backend.onspace.ai

Authorized Redirect URIs:
  https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

### Android Client
```
Package name:  com.predictxta.sports
SHA-1:         eas credentials --platform android → copy SHA-1 fingerprint
```

### iOS Client
```
Bundle ID:     com.predictxta.sports
```

---

## Production Build Verification Checklist

- [ ] Install APK/IPA (not Expo Go — custom schemes only work in standalone builds)
- [ ] Run `app/deep-link-diagnostics.tsx` — all critical checks pass
- [ ] Tap "Continue with Google" → browser opens → sign in → `predictxta://auth/callback?code=XXX` received → session established
- [ ] Tap "Continue with Apple" (iOS only) → native dialog → sign in → session established
- [ ] Tap "Forgot Password" → email sent → tap link → app opens reset screen
- [ ] Supabase Dashboard → Auth → URL Configuration → verify `predictxta://**` is listed
- [ ] Google Cloud Console → Android client → verify `com.predictxta.sports` + release SHA-1

---

## Why `Linking.createURL()` is Banned for OAuth in This Project

| Environment | Result |
|-------------|--------|
| Expo Go | `exp://192.168.x.x:8081/--/auth/callback` |
| EAS Dev Build | `predictxta://auth/callback` (if `extra.eas.projectId` set) |
| Standalone APK/IPA (no EAS) | **THROWS** `"Cannot make a deep link into a standalone app with no custom scheme defined"` |
| Web | `http://localhost:8081/auth/callback` |

Since we always want `predictxta://auth/callback` in production, the hardcoded string is the only safe approach.
`AuthSession.makeRedirectUri()` is explicitly banned — it wraps `Linking.createURL()` and has the same environment-dependent behavior.
