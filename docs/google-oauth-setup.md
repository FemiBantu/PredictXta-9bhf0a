# Google OAuth Configuration Guide for PredictXta

Updated: 2026-09-08 (Phase 2 — corrected to canonical bundle IDs)

---

## Canonical Bundle / Package IDs

| Platform | Identifier              |
|----------|------------------------|
| **Android** | `com.predictxta.sports` |
| **iOS** | `com.predictxta.sports` |

> ✅ **Both platforms use the same identifier.** An earlier version of this guide
> listed iOS as `com.predictxta.app`. That was incorrect.
>
> `com.predictxta.app` is an **Apple Service ID** — a separate Apple Developer
> identifier used only for Sign In with Apple on web/Android OAuth (entered in
> Supabase Auth → Apple provider as `client_id`). It is NOT the iOS Bundle ID.

### Google Cloud Console Mapping

| Client Type | Field | Value |
|-------------|-------|-------|
| Web Application | Authorized Redirect URI | `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback` |
| Android | Package name | `com.predictxta.sports` |
| iOS | Bundle ID | `com.predictxta.sports` |

---

## Root Cause (Fixed)

The error `"Cannot make a deep link into a standalone app with no custom scheme defined"` had compounding causes — all fixed:

1. **`expo-web-browser` was shimmed to no-ops** → replaced with real native adapter
2. **`intentFilters` missing from Android config** → 7 entries added to app.json
3. **`CFBundleURLTypes` missing from iOS config** → added to app.json infoPlist
4. **Password reset redirect used `onspaceapp://`** → fixed to `predictxta://reset-password`

---

## Files Modified (Historical)

| File | Change |
|------|--------|
| `app.json` | Added 7 Android `intentFilters`, iOS `CFBundleURLTypes`, corrected `CFBundleURLName` to `com.predictxta.sports` |
| `shims/expo-web-browser/index.js` | Replaced no-op shim with real native module adapter |
| `app/login.tsx` | Fixed reset redirect to `predictxta://reset-password` |
| `app/_layout.tsx` | Universal deep-link handler for OAuth + password reset |
| `services/googleAuthService.ts` | Full PKCE OAuth flow |
| `services/appleAuthService.ts` | Clarified Bundle ID vs Service ID |

---

## External Configuration Required

### 1. Supabase Dashboard → Authentication → URL Configuration

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
  https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

### 2. Supabase Dashboard → Authentication → Providers → Google

- Toggle **Google** to **Enabled**
- **Client ID**: Web OAuth Client ID from Google Cloud Console
- **Client Secret**: Web OAuth Client Secret

### 3. Google Cloud Console → APIs & Services → Credentials

#### Web Application OAuth Client
- **Authorized JavaScript Origins**: `https://osmkbrryalhtpnayosmk.backend.onspace.ai`
- **Authorized Redirect URIs**: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

> ⚠️ Do NOT add `predictxta://auth/callback` here — that is Supabase-side.

#### Android OAuth Client
- **Package name**: `com.predictxta.sports`
- **SHA-1 fingerprint**: `eas credentials --platform android` after first EAS build
- **SHA-256 fingerprint**: same tool

#### iOS OAuth Client
- **Bundle ID**: `com.predictxta.sports`

### 4. Google Cloud Console → OAuth Consent Screen
- **App name**: PredictXta
- **Scopes**: `openid`, `email`, `profile`
- **Status**: Published (or add test users)
- **Authorized domains**: `osmkbrryalhtpnayosmk.backend.onspace.ai`

---

## Android Intent Filters (app.json — verified)

7 entries registered:

| # | Scheme | Host | Path | Purpose |
|---|--------|------|------|---------|
| 1 | predictxta | — | — | Bare scheme catch-all |
| 2 | predictxta | auth | — | OAuth host |
| 3 | predictxta | auth | /callback (prefix) | OAuth pathPrefix |
| 4 | predictxta | auth | /callback (exact) | OAuth exact path |
| 5 | predictxta | login-callback | — | Alternate OAuth path |
| 6 | predictxta | reset-password | — | Password reset |
| 7 | predictxta | account-deleted | — | Post-deletion landing |

---

## How the Fixed OAuth Flow Works

```
User taps "Continue with Google"
  │
  ▼
signInWithGoogleOAuth() in googleAuthService.ts
  │
  ├─ 1. Calls supabase.auth.signInWithOAuth({ provider: 'google', skipBrowserRedirect: true })
  │     Returns the Google OAuth URL with redirect_uri pointing to Supabase callback
  │
  ├─ 2. Registers pending resolver BEFORE opening browser (key Android fix)
  │
  ├─ 3. Opens Google OAuth URL via WebBrowser.openAuthSessionAsync(url, 'predictxta://auth/callback')
  │     System browser opens → User signs in with Google
  │
  ├─ 4. Google redirects to Supabase → Supabase redirects to predictxta://auth/callback?code=XXXX
  │     Android: CCT fires deep link; deep-link handler calls handleOAuthCallback(url)
  │     iOS: openAuthSessionAsync captures redirect
  │
  ├─ 5. Extract ?code= from URL
  │     Call supabase.auth.exchangeCodeForSession(code)
  │     Dedup guard prevents double-exchange on Android
  │
  └─ 6. Session stored → AuthRouter redirects to /(tabs)
```

---

## AuthSession.makeRedirectUri() — BANNED

`AuthSession.makeRedirectUri()` is not used. It wraps `Linking.createURL()`:

| Environment | Output |
|-------------|--------|
| Expo Go | `exp://192.168.x.x:8081/--/...` |
| EAS build (no projectId) | **THROWS error** |
| Standalone | `predictxta://auth/callback` (when configured) |

We hardcode `'predictxta://auth/callback'` directly. This is the only safe approach.

---

## Build Instructions

Google OAuth **only works in native builds**.

```bash
eas build --platform android --profile preview        # APK for testing
eas build --platform android --profile production      # AAB for Play Store
eas build --platform ios --profile production          # IPA for App Store
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot make a deep link` | Old `Linking.createURL()` call | Already fixed — hardcoded redirect URI |
| Browser opens but no callback | `predictxta://auth/callback` missing from Supabase Redirect URLs | Add `predictxta://**` to Supabase |
| `redirect_uri_mismatch` | Wrong URI in Google Cloud Web client | Set to backend callback URL |
| `403: access_denied` | OAuth consent screen not published | Publish or add test user |
| E006 on Android | Chrome Custom Tab fires before promise resolves | Handled by pre-registered resolver + retry loop |
| Works debug, fails release | Wrong SHA-1 | Register release keystore SHA-1 via `eas credentials --platform android` |
| Package name mismatch | Old `.app` package in Google Cloud Android client | Update to `com.predictxta.sports` |
