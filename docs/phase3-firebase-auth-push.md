# PredictXta — Phase 3: Firebase, Auth & Push Notifications Report

Generated: 2026-09-08

---

## 1. FIREBASE VALIDATION

### Architecture (no native SDK on client)

```
Mobile App ──► firebase-live edge fn  ──► Firebase RTDB ──► Live scores
Mobile App ──► send-push edge fn      ──► FCM v1 API    ──► Device push
                  ↑                          ↑
     service account JWT            OAuth2 access token
     (FIREBASE_SERVICE_ACCOUNT_JSON)
```

The mobile app bundle contains **zero Firebase credentials at runtime**. `google-services.json` and `GoogleService-Info.plist` are injected only at EAS **build time** (not embedded in the JS bundle) for:
- Android: FCM push token registration + Google Sign-In SHA-1 verification
- iOS: FCM push token registration + APNs configuration

### Placeholder vs Production Credential Status

| File | Status | Action required |
|------|--------|----------------|
| `google-services.json` | ⚠️ Placeholder | Download real file from Firebase Console — see §2 |
| `GoogleService-Info.plist` | ⚠️ Placeholder | Download real file from Firebase Console — see §2 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` (Supabase secret) | ⚠️ Must be set | See §5 below |
| `FIREBASE_PROJECT_ID` (Supabase secret) | ⚠️ Must be set | `predictxta-c6bcb` |
| `FIREBASE_DATABASE_URL` (Supabase secret) | ⚠️ Must be set | From Firebase Console |

> **Phase 3 cannot replace placeholder credential files with real values** because
> real Firebase credentials are external secrets that must be obtained from the
> Firebase Console by the project owner. This document provides exact steps.
> All code-level configurations are complete and production-ready.

### Corrections Applied in Phase 3

| File | Issue | Fix |
|------|-------|-----|
| `docs/FIREBASE_SETUP.md` Step 3 | iOS bundle ID listed as `com.predictxta.app` | Corrected to `com.predictxta.sports` |
| `GoogleService-Info.plist` | Missing `REVERSED_CLIENT_ID` field | Added (required for Google Sign-In URL scheme) |
| `google-services.json` | Missing type-1 Android OAuth client entry | Added (required for SHA-1 binding) |
| `services/firebaseIntegrationCheck.ts` | False-positive: `projectId === 'predictxta-app'` flagged valid Firebase IDs as placeholders | Fixed: only flags all-caps strings as unexpanded env vars |

---

## 2. REQUIRED MANUAL STEPS (developer action)

### 2a. Create Firebase project / register apps

```
Firebase Console → https://console.firebase.google.com

1. Project: predictxta-c6bcb (or create new with this name)

2. Add Android app:
   Package name: com.predictxta.sports
   Nickname:     PredictXta Android
   SHA-1 (debug): keytool -list -v -keystore ~/.android/debug.keystore \
                    -alias androiddebugkey -storepass android -keypass android
   → Download google-services.json → place at project root

3. Add iOS app:
   Bundle ID: com.predictxta.sports    ← canonical (same as Android)
   Nickname:  PredictXta iOS
   → Download GoogleService-Info.plist → place at project root

4. Enable services:
   - Cloud Messaging (FCM)
   - Realtime Database (locked mode) → copy URL
   - Authentication → Google Sign-In
```

### 2b. Upload real files as EAS secrets (never commit to git)

```bash
# Android
eas secret:create \
  --name GOOGLE_SERVICES_JSON \
  --value @./google-services.json \
  --type file \
  --scope project

# iOS
eas secret:create \
  --name GOOGLE_SERVICES_PLIST \
  --value @./GoogleService-Info.plist \
  --type file \
  --scope project

# Verify both are present
eas secret:list
# Expected output:
#   GOOGLE_SERVICES_JSON   file   project
#   GOOGLE_SERVICES_PLIST  file   project
```

### 2c. Set Supabase secrets (OnSpace Cloud → Secrets)

| Secret name | Value source |
|-------------|--------------|
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → Project ID |
| `FIREBASE_DATABASE_URL` | Firebase Console → Realtime Database → URL |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `FIREBASE_APP_ID` | Firebase Console → Project Settings → Your apps → App ID |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase Console → Project Settings → Cloud Messaging → Sender ID |

```bash
# Via Supabase CLI (or paste JSON content in OnSpace Cloud → Secrets UI)
supabase secrets set FIREBASE_PROJECT_ID="predictxta-c6bcb"
supabase secrets set FIREBASE_DATABASE_URL="https://predictxta-c6bcb-default-rtdb.firebaseio.com"
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ./firebase-service-account.json)"
```

> ⚠️ `FIREBASE_SERVICE_ACCOUNT_JSON` contains an RSA private key. Never commit it.
> Add `firebase-service-account.json` to `.gitignore`.

### 2d. Add production SHA-1 after first EAS build

```bash
eas build --platform android --profile production
eas credentials --platform android   # → copy SHA-1

# Then add in:
# Firebase Console → Project Settings → Android app → Add fingerprint
# Google Cloud Console → Credentials → Android OAuth client → Add fingerprint
```

### 2e. iOS APNs for push notifications

```
Apple Developer Portal → Keys → + → Apple Push Notifications service (APNs)
→ Download .p8 key file

Firebase Console → Project Settings → Cloud Messaging → Apple app configuration
→ Upload .p8 + enter Key ID + Team ID
```

---

## 3. GOOGLE OAUTH VALIDATION

### Implementation status: ✅ Production-ready

| Component | Status | Detail |
|-----------|--------|--------|
| PKCE flow | ✅ | `supabase.auth.signInWithOAuth({ skipBrowserRedirect: true })` + `exchangeCodeForSession` |
| Pre-registered resolver | ✅ | Resolver registered BEFORE browser opens (Android E006 fix) |
| Dedup guard | ✅ | `_exchangedCodes` Set prevents double-exchange |
| Android CCT cancel handling | ✅ | 15s wait + 6×500ms retry + `checkExistingSession()` |
| E006 false-positive protection | ✅ | Session check before returning E006 |
| Hardcoded redirect URI | ✅ | `predictxta://auth/callback` — never `Linking.createURL()` |
| Deep-link handler | ✅ | `handleOAuthCallback()` wired in `app/_layout.tsx` |
| Error catalogue | ✅ | E001–E013 with actionable messages |
| iOS bundle ID in OAuth clients | ✅ | `com.predictxta.sports` (corrected Phase 2) |
| Android package in OAuth clients | ✅ | `com.predictxta.sports` |

### Required external configuration (developer action)

```
Google Cloud Console → APIs & Services → Credentials:

  Web Application client:
    Authorized JavaScript Origins:
      https://osmkbrryalhtpnayosmk.backend.onspace.ai
    Authorized Redirect URIs:
      https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback

  Android client:
    Package name:  com.predictxta.sports
    SHA-1:         [from eas credentials --platform android]

  iOS client:
    Bundle ID:     com.predictxta.sports

Supabase Dashboard → Auth → Providers → Google:
  Enabled: ON
  Client ID:     [Web OAuth Client ID]
  Client Secret: [Web OAuth Client Secret]

Supabase Dashboard → Auth → URL Configuration:
  Site URL:      predictxta://
  Redirect URLs: predictxta://**
                 predictxta://auth/callback
                 predictxta://reset-password
                 exp://**
                 https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback
```

---

## 4. APPLE AUTH VALIDATION

### Implementation status: ✅ Production-ready

| Component | Status | Detail |
|-----------|--------|--------|
| iOS native dialog | ✅ | `expo-apple-authentication.signInAsync()` with nonce |
| Nonce generation | ✅ | 32-char random + SHA-256 via `expo-crypto` |
| `signInWithIdToken` | ✅ | nonce passed to Supabase for replay-attack protection |
| ERR_REQUEST_CANCELED handling | ✅ | Detected and returned as soft cancel (not crash) |
| Android/web OAuth fallback | ✅ | PKCE via Supabase + `expo-web-browser` |
| Bundle ID vs Service ID | ✅ | Clearly distinguished in code and docs |
| Hardcoded redirect URI | ✅ | `predictxta://auth/callback` |

### Required external configuration (developer action)

```
Apple Developer Portal → Identifiers:

  App ID: com.predictxta.sports
    Capabilities: ✅ Push Notifications, ✅ Sign In with Apple

  Service ID: com.predictxta.app   ← for web/Android OAuth only
    Domain: osmkbrryalhtpnayosmk.backend.onspace.ai
    Return URL: https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback

Supabase Dashboard → Auth → Providers → Apple:
  Enabled: ON
  Team ID:      [10-char Apple Team ID from developer.apple.com]
  Key ID:       [from Sign In with Apple key]
  Private Key:  [.p8 file content]
  Bundle ID:    com.predictxta.app   ← Service ID (not the iOS Bundle ID)
```

> **Bundle ID / Service ID distinction:**
> - `com.predictxta.sports` = iOS Bundle ID → used in app.json, native builds, App Store
> - `com.predictxta.app` = Apple Service ID → used ONLY as Supabase `client_id` for OAuth web flow

---

## 5. PUSH NOTIFICATION VALIDATION

### send-push edge function: ✅ Production-ready (FCM v1)

| Feature | Status | Detail |
|---------|--------|--------|
| FCM v1 API | ✅ | RS256 JWT → OAuth2 access token → FCM v1 HTTP endpoint |
| Service account JWT | ✅ | RS256 signed, 3600s TTL, module-level token cache |
| Expo Push API | ✅ | Batched (100/request) for `ExponentPushToken[...]` devices |
| Token type routing | ✅ | Expo tokens → Expo API; FCM tokens → FCM v1 |
| Multi-language | ✅ | `preferred_language` → translate-content edge function |
| Android channels | ✅ | `default`, `score-alerts`, `challenge` |
| iOS APNs payload | ✅ | `aps.alert.title/body + sound: default` |
| Stale token cleanup | ✅ | `UNREGISTERED`/`INVALID_ARGUMENT` logged, not retried |
| Concurrency | ✅ | FCM batch size 10 concurrent requests |

### usePushNotifications hook: ✅ Production-ready

| Feature | Status |
|---------|--------|
| Permission request (once, no re-spam) | ✅ |
| Android notification channels (3) | ✅ |
| Expo push token + Supabase sync | ✅ |
| Daily Challenge notification (9:00 AM) | ✅ |
| VIP Tips notification (12:00 PM) | ✅ |
| User preference respect | ✅ |
| Re-register on user login | ✅ |
| Graceful simulator fallback | ✅ |

### Push notification test matrix

| Scenario | Method | Expected |
|----------|--------|----------|
| Foreground notification | `Notifications.addNotificationReceivedListener` | Toast banner shown |
| Background notification | FCM/APNs system delivery | System notification tray |
| Killed-app notification | FCM/APNs system delivery | System notification tray |
| Tap → challenge screen | `addNotificationResponseReceivedListener` | Opens `/challenge` |
| Tap → vip screen | `addNotificationResponseReceivedListener` | Opens `/vip` |
| Tap → live tab | `addNotificationResponseReceivedListener` | Opens `/(tabs)/live` |
| Daily Challenge (9 AM) | Local scheduled trigger | Android: `challenge` channel |
| Score alert | `send-push` via `useScoreAlerts` | Android: `score-alerts` channel |

---

## 6. EAS SECRETS MATRIX

| Secret | Store | Used by | Never in |
|--------|-------|---------|---------|
| `GOOGLE_SERVICES_JSON` | EAS file secret | Android build only | git, .env, JS bundle |
| `GOOGLE_SERVICES_PLIST` | EAS file secret | iOS build only | git, .env, JS bundle |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Supabase Vault | `send-push` edge fn | git, .env, client bundle |
| `FIREBASE_PROJECT_ID` | Supabase Vault | `send-push`, `firebase-live` | client bundle |
| `FIREBASE_DATABASE_URL` | Supabase Vault | `firebase-live` | client bundle |
| `APPLE_ID` | EAS secret | `eas submit` | git, .env |
| `APP_STORE_CONNECT_APP_ID` | EAS secret | `eas submit` | git, .env |
| `APPLE_TEAM_ID` | EAS secret | `eas submit` | git, .env |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Vault | Edge functions only | git, EXPO_PUBLIC_, client |

---

## 7. SECURITY POSTURE

### Authorization model (server-derived, never client-trusted)

| Claim | Source |
|-------|--------|
| User identity | JWT subject from Supabase auth session |
| VIP status | `vip_subscriptions` table, queried server-side |
| Admin role | `admin_roles` table, queried server-side |
| Expert role | `expert_profiles` table, queried server-side |
| Coin balance | `user_coins` table, server-side only |
| Push token | `user_profiles.push_token`, updated via authenticated session |

No client-supplied entitlement, role, or subscription claim is trusted. All are derived from the database at request time via RLS-enforced queries.

---

## 8. DEEP-LINK TEST MATRIX

| URL | Handler | Platform | Expected |
|-----|---------|----------|----------|
| `predictxta://auth/callback?code=XXX` | `handleOAuthCallback()` | Both | PKCE exchange → session |
| `predictxta://auth?code=XXX` | `handleOAuthCallback()` | Both | PKCE exchange → session |
| `predictxta://reset-password?type=recovery&code=XXX` | `PasswordResetDeepLinkHandler` | Both | PKCE exchange → `/reset-password` |
| `predictxta://reset-password#access_token=XXX&type=recovery` | `PasswordResetDeepLinkHandler` | Both | setSession → `/reset-password` |
| `predictxta://account-deleted` | Intent filter → system | Android | App foreground (no handler needed) |
| Cold start: app closed, notification tapped | `Notifications.addNotificationResponseReceivedListener` | Both | Correct screen after mount |

---

## 9. PHASE 3 RELEASE GATE

### Code-level: ✅ COMPLETE

All code changes are done. The following manual steps remain before store submission:

| Step | Status | Priority |
|------|--------|----------|
| Download real `google-services.json` from Firebase | ⏳ Manual | P0 — blocks Android build |
| Download real `GoogleService-Info.plist` from Firebase | ⏳ Manual | P0 — blocks iOS build |
| Upload both as EAS secrets | ⏳ Manual | P0 — blocks CI builds |
| Set `FIREBASE_SERVICE_ACCOUNT_JSON` in Supabase secrets | ⏳ Manual | P0 — blocks push delivery |
| Set `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL` | ⏳ Manual | P0 — blocks live scores |
| Configure Google OAuth clients in Google Cloud Console | ⏳ Manual | P0 — blocks Google Sign-In |
| Configure Apple App ID + Service ID in Apple Developer | ⏳ Manual | P0 — blocks Apple Sign-In |
| Upload APNs .p8 key to Firebase | ⏳ Manual | P0 — blocks iOS push |
| Add production SHA-1 after first EAS build | ⏳ Post-build | P1 |
| Configure Supabase Apple provider | ⏳ Manual | P0 — blocks Apple Sign-In |

### Phase 3 is code-complete. All remaining items require developer portal access.
