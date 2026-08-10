# Google OAuth Audit Report — PredictXta
**Generated:** 2026-07-15

---

## ✅ Passed Checks

| # | Check | Detail |
|---|-------|--------|
| 1 | **expo-web-browser shim intact** | `shims/expo-web-browser/index.js` correctly delegates to `expo-web-browser/build/WebBrowser` in native builds and falls back to no-ops only when unavailable. |
| 2 | **Custom URL scheme registered (iOS)** | `app.json → ios.infoPlist.CFBundleURLTypes` contains `predictxta` scheme with `CFBundleURLName: com.predictxta.app`. |
| 3 | **Custom URL scheme registered (Android)** | `app.json → android.intentFilters` contains two VIEW intents for `predictxta://` and `predictxta://auth/callback`. |
| 4 | **iOS Bundle ID** | `app.json → ios.bundleIdentifier = "com.predictxta.app"` ✓ |
| 5 | **Redirect URI in googleAuthService** | `getRedirectUri()` uses `Linking.createURL('auth/callback')` on native which resolves to `predictxta://auth/callback`. |
| 6 | **PKCE code flow implemented** | `exchangeCodeForSession(params.code)` called correctly after browser redirect. |
| 7 | **Implicit token fallback** | `setSession({ access_token, refresh_token })` used as fallback for legacy providers. |
| 8 | **Deep link handler in _layout.tsx** | `PasswordResetDeepLinkHandler` calls `handleOAuthCallback(url)` which parses both `?code=` and `#access_token=` flows. |
| 9 | **Auth callback screen** | `app/auth/callback.tsx` handles cold-start deep links, exchanges code, shows animated UI. |
| 10 | **Google provider enabled in Supabase** | Backend context confirms `enable_google_sign_in: true`. |
| 11 | **skipBrowserRedirect: true** | Set correctly — required for PKCE flow to work with `openAuthSessionAsync`. |
| 12 | **Error codes added** | `googleAuthService.ts` now exports `GOOGLE_AUTH_ERRORS` with 13 specific error codes (E001–E013). |

---

## ❌ Failed / Warning Checks

| # | Check | Status | Issue | Fix |
|---|-------|--------|-------|-----|
| 1 | **Android package name** | ⚠️ MISMATCH | The audit brief mentions `com.predictxta.sports` but `app.json` uses `com.predictxta.app`. Google Cloud Android OAuth client must match exactly. | Use `com.predictxta.app` everywhere. If the Play Store listing uses `com.predictxta.sports`, update `app.json`. |
| 2 | **SHA-1 / SHA-256 fingerprints** | ❓ UNVERIFIABLE | Cannot verify fingerprints from code alone — requires the actual keystore file. Debug fingerprint (`~/.android/debug.keystore`) differs from release. | Register BOTH debug and release SHA-1 + SHA-256 in Google Cloud Console. |
| 3 | **google-services.json** | ❓ MISSING | No `google-services.json` found in repository root or `android/app/`. Firebase push notifications require this file. | Download from Firebase Console → Project Settings → Android app → `google-services.json` → place in project root. |
| 4 | **Web Client ID not in code** | ⚠️ NOT CONFIGURED | `signInWithOAuth({ provider: 'google' })` relies on Supabase to provide the OAuth URL — the Web Client ID is configured in Supabase Dashboard, not in app code. This is correct. But the **Supabase Redirect URL** must be `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`. | Verify in Supabase → Auth → Providers → Google that the `Authorized Redirect URIs` in Google Cloud Web Client matches the Supabase callback URL exactly. |
| 5 | **expo-auth-session plugin** | ⚠️ MISSING | `app.json → plugins` does not include `expo-auth-session`. Without this plugin the Android `AndroidManifest.xml` may not get the `CustomTabsService` intent filter, which Chrome Custom Tabs requires for the OAuth redirect capture. | Add `"expo-auth-session"` to the plugins array in `app.json`. |
| 6 | **Google OAuth in Expo Go** | ⚠️ EXPECTED FAIL | `predictxta://` scheme is NOT available in Expo Go. `openAuthSessionAsync` will return `{ type: 'cancel' }` in Expo Go. | Test Google OAuth only in native builds (APK/IPA). Error code E005 now surfaces a clear message. |
| 7 | **0 Google users in DB** | ℹ️ INFO | Current 10 users are all email-authenticated. This could mean OAuth was never tested end-to-end on a real device. | Test with an APK build. |

---

## Files Requiring Changes

### 1. `app.json` — Add `expo-auth-session` plugin

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-apple-authentication",
      "expo-auth-session",          // ← ADD THIS
      ...
    ]
  }
}
```

### 2. `app.json` — Verify package name matches Google Cloud

Current: `"package": "com.predictxta.app"`  
If Play Store / Firebase uses `com.predictxta.sports`, update to match.

### 3. `google-services.json` — Place in project root

Download from Firebase Console → Project Settings → Your Android App.  
The file maps `com.predictxta.app` (or `com.predictxta.sports`) to Firebase project `predictxta`.

---

## Required External Settings

### Supabase Dashboard → Auth → URL Configuration
```
Site URL:       predictxta://
Redirect URLs:
  predictxta://
  predictxta://**
  predictxta://auth/callback
  predictxta://reset-password
  exp://**
  https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

### Supabase Dashboard → Auth → Providers → Google
- Enabled: **ON**
- Client ID: `<Web OAuth Client ID from Google Cloud>`
- Client Secret: `<Web OAuth Client Secret from Google Cloud>`

### Google Cloud Console → Credentials → Web Application Client
- **Authorized Redirect URIs**: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

### Google Cloud Console → Credentials → Android Client
- **Package name**: `com.predictxta.app` ← must match `app.json`
- **SHA-1**: run `keytool -keystore ~/.android/debug.keystore -list -v -alias androiddebugkey -storepass android -keypass android`
- **SHA-256**: same command, copy SHA-256 line
- Also add **release keystore** SHA-1 and SHA-256

### Google Cloud Console → Credentials → iOS Client
- **Bundle ID**: `com.predictxta.app`

### Google Cloud Console → OAuth Consent Screen
- Status: **Published** (or add test user emails)
- Scopes: `openid`, `email`, `profile`
- App name: `PredictXta`
- Support email: your email

---

## SHA-1 / SHA-256 Commands

```bash
# Debug keystore (for development / Expo Go builds)
keytool -keystore ~/.android/debug.keystore \
  -list -v \
  -alias androiddebugkey \
  -storepass android \
  -keypass android

# Release keystore (EAS build)
eas credentials   # shows fingerprints for your EAS project

# Or manual release keystore
keytool -keystore your-release.keystore -list -v
```

---

## Error Code Reference (E001–E013)

| Code | Meaning | Fix |
|------|---------|-----|
| E001 | Google provider not enabled in Supabase | Dashboard → Auth → Providers → Google → Enable |
| E002 | No OAuth URL from Supabase | Check Client ID + Secret in Supabase Google settings |
| E003 | redirect_uri_mismatch | Add `predictxta://auth/callback` to Supabase Redirect URLs |
| E004 | access_denied | Publish OAuth consent screen or add test user |
| E005 | No custom scheme in Expo Go | Test on real APK/IPA build only |
| E006 | User cancelled browser | User dismissed the sign-in screen |
| E007 | Browser no redirect URL | OAuth flow incomplete; check redirect URI config |
| E008 | PKCE code exchange failed | Code expired; try again |
| E009 | Implicit token session failed | Token expired or malformed |
| E010 | No code or token in redirect | Check Google Cloud OAuth client redirect URI |
| E011 | Android package name mismatch | Use `com.predictxta.app` in Google Cloud Android client |
| E012 | iOS bundle ID mismatch | Use `com.predictxta.app` in Google Cloud iOS client |
| E013 | SHA-1 not registered | Add keystore SHA-1 to Google Cloud Android OAuth client |
