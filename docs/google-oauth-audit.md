# Google OAuth Audit Report — PredictXta
**Updated:** 2026-09-08 (Phase 2 — corrected canonical bundle IDs)

---

## Canonical Application Identifiers

| Platform | Identifier              |
|----------|------------------------|
| Android  | `com.predictxta.sports` |
| iOS      | `com.predictxta.sports` |

> ✅ Both platforms now use the same package name.
> An earlier version of this audit incorrectly stated iOS used `com.predictxta.app`.
> `com.predictxta.app` is the **Apple Service ID** — a separate Apple Developer
> identifier for Sign In with Apple on web/Android OAuth. It is NOT the iOS Bundle ID.
>
> For Google Cloud Console:
> - Android OAuth client → Package: `com.predictxta.sports`
> - iOS OAuth client → Bundle ID: `com.predictxta.sports`

---

## ✅ Passed Checks

| # | Check | Detail |
|---|-------|--------|
| 1 | **expo-web-browser shim intact** | `shims/expo-web-browser/index.js` correctly delegates to `expo-web-browser/build/WebBrowser` in native builds and falls back to no-ops only when unavailable. |
| 2 | **Custom URL scheme registered (iOS)** | `app.json → ios.infoPlist.CFBundleURLTypes` contains `predictxta` scheme with `CFBundleURLName: com.predictxta.sports`. ✅ |
| 3 | **Custom URL scheme registered (Android)** | `app.json → android.intentFilters` contains 7 VIEW intents covering all OAuth + deep-link paths. ✅ |
| 4 | **iOS Bundle ID** | `app.json → ios.bundleIdentifier = "com.predictxta.sports"` ✅ |
| 5 | **Android Package** | `app.json → android.package = "com.predictxta.sports"` ✅ |
| 6 | **PKCE code flow implemented** | `exchangeCodeForSession(params.code)` called correctly after browser redirect. |
| 7 | **Implicit token fallback** | `setSession({ access_token, refresh_token })` used as fallback for legacy providers. |
| 8 | **Deep link handler in _layout.tsx** | `PasswordResetDeepLinkHandler` calls `handleOAuthCallback(url)` which parses both `?code=` and `#access_token=` flows. |
| 9 | **Auth callback screen** | `app/auth/callback.tsx` handles cold-start deep links, exchanges code, shows animated UI. |
| 10 | **Google provider enabled in Supabase** | Backend context confirms `enable_google_sign_in: true`. |
| 11 | **skipBrowserRedirect: true** | Set correctly — required for PKCE flow to work with `openAuthSessionAsync`. |
| 12 | **Error codes added** | `googleAuthService.ts` exports `GOOGLE_AUTH_ERRORS` with 13 specific error codes (E001–E013). |
| 13 | **Hardcoded redirect URI** | `Linking.createURL()` is banned — `predictxta://auth/callback` hardcoded everywhere. ✅ |

---

## ❌ Failed / Warning Checks

| # | Check | Status | Issue | Fix |
|---|-------|--------|-------|-----|
| 1 | **SHA-1 / SHA-256 fingerprints** | ❓ UNVERIFIABLE | Cannot verify fingerprints from code alone. Debug key differs from release. | Run `eas credentials --platform android` after first build → register SHA-1 + SHA-256 in Google Cloud Console Android client. |
| 2 | **google-services.json** | ❓ PLACEHOLDER | Must be replaced with real file from Firebase Console → Project Settings → Android App (package: `com.predictxta.sports`). | Download and replace. Create EAS secret `GOOGLE_SERVICES_JSON`. |
| 3 | **Web Client ID in Supabase** | ⚠️ NOT CONFIGURED | Client ID is in Supabase Dashboard → Auth → Providers → Google. Authorized Redirect URI must be the backend callback URL. | Verify in Supabase: Authorized Redirect URI = `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback` |
| 4 | **Google OAuth in Expo Go** | ⚠️ EXPECTED FAIL | `predictxta://` scheme NOT available in Expo Go. | Test only in native APK/IPA builds. |

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
  predictxta://account-deleted
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
- **Package name**: `com.predictxta.sports` ← canonical Android identifier
- **SHA-1**: `eas credentials --platform android` (after first build)
- Also add release keystore SHA-1 and SHA-256

### Google Cloud Console → Credentials → iOS Client
- **Bundle ID**: `com.predictxta.sports` ← canonical iOS identifier

### Google Cloud Console → OAuth Consent Screen
- Status: **Published** (or add test user emails)
- Scopes: `openid`, `email`, `profile`
- App name: `PredictXta`

---

## SHA-1 / SHA-256 Commands

```bash
# Release keystore (EAS build — recommended)
eas credentials --platform android   # Shows SHA-1 fingerprint

# Debug keystore (local development only)
keytool -keystore ~/.android/debug.keystore \
  -list -v -alias androiddebugkey \
  -storepass android -keypass android
```

---

## Error Code Reference (E001–E013)

| Code | Meaning | Fix |
|------|---------|-----|
| E001 | Google provider not enabled in Supabase | Dashboard → Auth → Providers → Google → Enable |
| E002 | No OAuth URL from Supabase | Check Client ID + Secret in Supabase Google settings |
| E003 | redirect_uri_mismatch | Add Supabase callback URL to Google Cloud Web client |
| E004 | access_denied | Publish OAuth consent screen or add test user |
| E005 | No custom scheme in Expo Go | Test on real APK/IPA build only |
| E006 | User cancelled browser | User dismissed the sign-in screen |
| E007 | Browser no redirect URL | OAuth flow incomplete; check redirect URI config |
| E008 | PKCE code exchange failed | Code expired; try again |
| E009 | Implicit token session failed | Token expired or malformed |
| E010 | No code or token in redirect | Check Google Cloud OAuth client redirect URI |
| E011 | Android package name mismatch | Ensure `com.predictxta.sports` in Google Cloud Android client |
| E012 | iOS bundle ID mismatch | Ensure `com.predictxta.sports` in Google Cloud iOS client |
| E013 | SHA-1 not registered | Add production keystore SHA-1 to Google Cloud Android OAuth client |
