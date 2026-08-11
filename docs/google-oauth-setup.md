# Google OAuth Configuration Guide for PredictXta

## Package / Bundle ID Quick Reference

| Platform | Identifier |
|----------|------------|
| **Android** | `com.predictxta.sports` |
| **iOS** | `com.predictxta.app` |

> These are **intentionally different**. Use the correct one for each Google Cloud Console OAuth client.

---

## Root Cause (Fixed)

The error `"Cannot make a deep link into a standalone app with no custom scheme defined"` had **5 compounding causes**:

1. **`expo-web-browser` was shimmed to no-ops** — `openAuthSessionAsync` returned `{ type: 'cancel' }` immediately without opening a browser, so OAuth never launched.
2. **`expo-auth-session` plugin missing** from `app.json` — the plugin is required to register the scheme in native manifests at build time.
3. **`intentFilters` missing from Android config** — Android `AndroidManifest.xml` had no `VIEW` intent filter for `predictxta://` so the OS couldn't route OAuth redirects back to the app.
4. **`CFBundleURLTypes` missing from iOS config** — iOS `Info.plist` had no URL scheme registration.
5. **Password reset redirect used `onspaceapp://`** instead of the registered `predictxta://` scheme.

---

## Files Modified

| File | Change |
|------|--------|
| `app.json` | Added 7 Android `intentFilters`, iOS `CFBundleURLTypes` |
| `shims/expo-web-browser/index.js` | Replaced no-op shim with real native module adapter |
| `app/login.tsx` | Replaced `signInWithGoogle()` template call with `signInWithGoogleOAuth()`, fixed reset redirect to `predictxta://reset-password` |
| `app/_layout.tsx` | Universal deep-link handler for both OAuth callbacks and password reset |
| `services/googleAuthService.ts` | Full OAuth flow: build Supabase OAuth URL → open browser → capture redirect → exchange code for session |
| `app/auth/callback.tsx` | Visual callback screen shown while session exchange runs |
| `app/deep-link-diagnostics.tsx` | **New** — Full deep-link and OAuth diagnostics panel |

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
  https://*.supabase.co/auth/v1/callback
```

### 2. Supabase Dashboard → Authentication → Providers → Google

- Toggle **Google** to **Enabled**
- **Client ID**: paste your Web OAuth Client ID from Google Cloud Console
- **Client Secret**: paste your Web OAuth Client Secret

### 3. Google Cloud Console → APIs & Services → Credentials

#### Web Application OAuth Client
- **Authorized JavaScript Origins**: `https://osmkbrryalhtpnayosmk.supabase.co`
- **Authorized Redirect URIs**: `https://osmkbrryalhtpnayosmk.supabase.co/auth/v1/callback`

> ⚠️ This is the **only** redirect URI Google needs. Do NOT add `predictxta://auth/callback` here — that is a Supabase-side URL, not a Google-side URL.

#### Android OAuth Client
- **Package name**: `com.predictxta.sports` ← `.sports` not `.app`
- **SHA-1 certificate fingerprint (debug)**: Run `keytool -keystore ~/.android/debug.keystore -list -v` (password: `android`)
- **SHA-1 certificate fingerprint (release)**: Run `keytool -keystore release.keystore -list -v`
- **SHA-256 certificate fingerprint**: Same tool, copy SHA-256 output

#### iOS OAuth Client  
- **Bundle ID**: `com.predictxta.app` ← `.app` not `.sports`

### 4. Google Cloud Console → OAuth Consent Screen

- **App name**: PredictXta
- **User support email**: your email
- **Authorized domains**: `osmkbrryalhtpnayosmk.supabase.co`
- **Scopes**: `openid`, `email`, `profile`
- **Status**: Published (or add test users for testing)

---

## Android Intent Filters (app.json)

The following 7 intent-filter entries are registered in `app.json → android.intentFilters` and generate corresponding `<intent-filter>` blocks in `AndroidManifest.xml`:

| # | Scheme | Host | Path | Purpose |
|---|--------|------|------|---------|
| 1 | predictxta | — | — | Bare scheme catch-all |
| 2 | predictxta | auth | — | OAuth host |
| 3 | predictxta | auth | /callback (prefix) | OAuth pathPrefix |
| 4 | predictxta | auth | /callback (exact) | OAuth exact path |
| 5 | predictxta | login-callback | — | Alternate OAuth path |
| 6 | predictxta | reset-password | — | Password reset |
| 7 | predictxta | account-deleted | — | Post-deletion landing |

All entries use `category: ["BROWSABLE", "DEFAULT"]` and `action: VIEW`.

---

## How the Fixed OAuth Flow Works

```
User taps "Continue with Google"
  │
  ▼
signInWithGoogleOAuth() in googleAuthService.ts
  │
  ├─ 1. Calls supabase.auth.signInWithOAuth({ provider: 'google', skipBrowserRedirect: true })
  │     Returns the Google OAuth URL with redirect_uri = predictxta://auth/callback
  │
  ├─ 2. Registers pending resolver BEFORE opening browser (key Android fix)
  │
  ├─ 3. Opens Google OAuth URL via WebBrowser.openAuthSessionAsync(url, 'predictxta://auth/callback')
  │     System browser opens → User signs in with Google
  │
  ├─ 4. Google redirects to predictxta://auth/callback?code=XXXX
  │     Android: CCT fires deep link BEFORE openAuthSessionAsync resolves
  │     → Deep-link handler calls handleOAuthCallback(url)
  │     → Exchanges code for session
  │     → Resolves pending resolver
  │     iOS: openAuthSessionAsync captures redirect and resolves with { type: 'success', url }
  │
  ├─ 5. Extract ?code= from URL
  │     Call supabase.auth.exchangeCodeForSession(code)
  │     Dedup guard prevents double-exchange on Android
  │     Supabase returns { session: { access_token, refresh_token, user } }
  │
  └─ 6. Session stored in Supabase client
        AuthRouter detects authenticated state → navigates to /(tabs)
```

---

## AuthSession.makeRedirectUri() — BANNED

`AuthSession.makeRedirectUri()` is **not used** in this project. It wraps `Linking.createURL()` and is environment-dependent:

| Environment | makeRedirectUri() output |
|-------------|-------------------------|
| Expo Go | `exp://192.168.x.x:8081/--/...` |
| EAS build (no projectId) | **THROWS error** |
| Standalone | `predictxta://auth/callback` (when configured) |

We hardcode `'predictxta://auth/callback'` directly in `getRedirectUri()` to avoid all environment-dependent behavior.

---

## Expo Go Limitation

⚠️ Custom URL scheme deep links **do not work in Expo Go** on any platform.

- Expo Go intercepts all URLs through its own scheme (`exp://`)
- The OS cannot route `predictxta://auth/callback` back to your app inside Expo Go
- `canOpenURL('predictxta://')` returns `false` in Expo Go

**You must use a native development build or production APK/IPA to test Google OAuth.**

Use `app/deep-link-diagnostics.tsx` to verify your build environment automatically detects this condition and warns you before testing.

---

## Build Instructions

Google OAuth **only works in native builds**, not in Expo Go or web preview.

### Android APK (development build)
```bash
eas build --platform android --profile development
```

### Android APK (preview — installable APK without Play Store)
```bash
eas build --platform android --profile preview
```
Or use the Download button in the top-right toolbar → Download APK.

### Android AAB (production — Play Store)
```bash
eas build --platform android --profile production
```
Ensure your production keystore SHA-1/SHA-256 is registered in Google Cloud Console.

### iOS (App Store)
```bash
eas build --platform ios --profile production
```
Ensure Bundle ID `com.predictxta.app` is registered as iOS OAuth client in Google Cloud Console.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot make a deep link` | Old `Linking.createURL()` call | Use hardcoded `'predictxta://auth/callback'` |
| Browser opens but no callback | `predictxta://auth/callback` missing from Supabase Redirect URLs | Add predictxta://** to Supabase |
| `redirect_uri_mismatch` from Google | Wrong URI in Google Cloud Web client | Set to `https://osmkbrryalhtpnayosmk.supabase.co/auth/v1/callback` |
| `403: access_denied` | OAuth consent screen not published | Publish or add test user in Google Cloud |
| E006 on Android | Chrome Custom Tab fires before promise resolves | Handled by pre-registered resolver + retry loop |
| Works debug, fails release | Wrong SHA-1 (release vs debug) | Register release keystore SHA-1 in Google Cloud Android client |
| iOS: browser opens, no callback | Missing `CFBundleURLTypes` | Already fixed in app.json ios.infoPlist |
| canOpenURL returns false | Running in Expo Go | Install native Dev Build or Production APK |
| Package name mismatch | Using iOS bundle ID for Android client | Android = `com.predictxta.sports`, iOS = `com.predictxta.app` |
