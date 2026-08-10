# Firebase Setup Guide — PredictXta

## Architecture Overview

PredictXta uses a **proxy architecture** — the mobile app does NOT use the native Firebase SDK.
All Firebase operations go through Supabase Edge Functions:

```
Mobile App ──► send-push edge fn  ──► Firebase FCM  ──► Device push
Mobile App ──► firebase-live edge fn ──► Firebase RTDB ──► Live scores
```

**Benefits:**
- No native Firebase SDK required in the client
- Zero Firebase credentials in the app bundle
- Works in Expo Go and managed workflow out-of-the-box
- `google-services.json` only needed at **EAS build time**, not runtime

---

## What `google-services.json` Is Needed For

| Purpose | Required? | Notes |
|---------|-----------|-------|
| FCM push token registration | ✅ Yes | Android only; baked in at build time |
| Google Sign-In on Android | ✅ Yes | SHA-1 verified against this file |
| Firebase RTDB reads | ❌ No | Handled server-side by edge functions |
| Crashlytics / Analytics | ❌ No | Not used in this architecture |

---

## Step 1 — Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → Name: `predictxta-app`
3. Disable Google Analytics (can enable later) → **Create project**

---

## Step 2 — Register Android App

1. Click the **Android** icon on the project overview page
2. **Android package name:** `com.predictxta.sports`
3. **App nickname:** PredictXta Android
4. **SHA-1 (debug):** Get from your local keystore:
   ```bash
   keytool -list -v \
     -keystore ~/.android/debug.keystore \
     -alias androiddebugkey \
     -storepass android -keypass android
   ```
5. Click **Register app** → **Download `google-services.json`**
6. Place the downloaded file at the project root (same directory as `app.json`)
7. Add production SHA-1 later (see Step 6 below)

---

## Step 3 — Register iOS App

1. Click the **iOS** icon on the project overview page
2. **iOS bundle ID:** `com.predictxta.app`
3. **App nickname:** PredictXta iOS
4. Click **Register app** → **Download `GoogleService-Info.plist`**
5. Place at the project root (same directory as `app.json`)

> `app.json` already references both files:
> - Android: `"googleServicesFile": "./google-services.json"`
> - iOS: `"googleServicesFile": "./GoogleService-Info.plist"`

---

## Step 4 — Enable Firebase Services

### Cloud Messaging (FCM)

1. **Project Settings → Cloud Messaging** tab
2. Copy **Server key** (Legacy HTTP API) → add to Supabase secrets as `FIREBASE_SERVER_KEY`
3. Note the **Sender ID** (= GCM_SENDER_ID in `google-services.json`)

### Realtime Database

1. **Build → Realtime Database → Create database**
2. Choose region → start in **locked mode** → **Enable**
3. Copy the database URL: `https://predictxta-app-default-rtdb.firebaseio.com`

### Authentication (for Google Sign-In)

1. **Build → Authentication → Get started → Sign-in method**
2. Enable **Google** → save
3. Add SHA-1 fingerprints under **Project Settings → Your apps → Android app**

---

## Step 5 — Set Supabase Edge Function Secrets

In **OnSpace Cloud → Secrets** (or via Supabase CLI):

```bash
supabase secrets set \
  FIREBASE_DATABASE_URL="https://predictxta-app-default-rtdb.firebaseio.com" \
  FIREBASE_API_KEY="YOUR_WEB_API_KEY" \
  FIREBASE_PROJECT_ID="predictxta-app" \
  FIREBASE_APP_ID="1:YOUR_PROJECT_NUMBER:web:YOUR_APP_ID" \
  FIREBASE_MESSAGING_SENDER_ID="YOUR_PROJECT_NUMBER"
```

> All of the above values are visible in **Firebase Console → Project Settings → General**.

### 5a — FCM v1 Service Account (replaces legacy FIREBASE_SERVER_KEY)

The `send-push` edge function now uses **FCM v1 API** with OAuth2 service account auth.
The legacy `FIREBASE_SERVER_KEY` (HTTP API) is no longer needed.

1. **Firebase Console → Project Settings → Service Accounts**
2. Click **Generate new private key** → Download the JSON file
3. Upload it as a Supabase secret:

```bash
# Read the file and pipe it as a single-line JSON string
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ./firebase-service-account.json)"
```

Or paste the JSON content directly in **OnSpace Cloud → Secrets → Add Secret**
with the name `FIREBASE_SERVICE_ACCOUNT_JSON`.

> **Security**: The service account JSON contains a private RSA key. Never commit it to git.
> Add `firebase-service-account.json` to `.gitignore`.

```bash
supabase secrets set FIREBASE_PROJECT_ID="predictxta-app"
```

**Verify the secrets are set:**
```bash
supabase secrets list
# Should show: FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PROJECT_ID
```

---

## Step 6 — Upload `google-services.json` as an EAS Secret

This is the **recommended approach** — the real credential file stays out of git entirely.
EAS injects it at build time via the `$GOOGLE_SERVICES_JSON` variable in `eas.json`.

### 6a — Upload the secret (one time only)

```bash
# Install EAS CLI if needed
npm install -g eas-cli

# Login
eas login

# Upload google-services.json as a project-scoped EAS secret
# The --value @./path syntax reads the file contents automatically
eas secret:create \
  --name GOOGLE_SERVICES_JSON \
  --value @./google-services.json \
  --type file \
  --scope project
```

> **`--type file`** tells EAS this is a file secret. EAS writes the secret content
> to a temporary path at build time and exposes that path as `$GOOGLE_SERVICES_JSON`.

### 6b — Verify the secret was stored

```bash
eas secret:list
# Should show: GOOGLE_SERVICES_JSON   file   project
```

### 6c — How it works in `eas.json`

`eas.json` already references `$GOOGLE_SERVICES_JSON` in preview and production builds:

```json
"android": {
  "buildType": "app-bundle",
  "googleServicesFile": "$GOOGLE_SERVICES_JSON"
}
```

- **Development builds** still read `./google-services.json` from local disk.
- **Preview / Production** builds read from the EAS secret — no file on disk required.

### 6d — Update the secret when you rotate credentials

```bash
# Delete old secret
eas secret:delete --name GOOGLE_SERVICES_JSON

# Upload new file
eas secret:create \
  --name GOOGLE_SERVICES_JSON \
  --value @./google-services-new.json \
  --type file \
  --scope project
```

---

## Step 7 — Do the Same for `GoogleService-Info.plist` (iOS)

```bash
eas secret:create \
  --name GOOGLE_SERVICES_PLIST \
  --value @./GoogleService-Info.plist \
  --type file \
  --scope project
```

Then reference it in `eas.json` under each iOS build profile:

```json
"ios": {
  "googleServicesFile": "$GOOGLE_SERVICES_PLIST"
}
```

---

## Step 8 — Add Production SHA-1 to Firebase

After your first production EAS build:

```bash
# View keystore credentials (EAS-managed keystore)
eas credentials --platform android

# Copy the SHA-1 fingerprint from output, then:
# Firebase Console → Project Settings → Your Android apps → Add fingerprint
# Google Cloud Console → APIs & Services → Credentials → Android OAuth client → Add SHA-1
```

---

## Step 9 — iOS Push Notifications (APNs)

1. **Apple Developer Portal → Certificates, IDs & Profiles → Keys → +**
2. Enable **Apple Push Notifications service (APNs)**
3. Download the `.p8` key file
4. **Firebase Console → Project Settings → Cloud Messaging → Apple app configuration**
5. Upload the `.p8` file, enter the Key ID and Team ID

---

## Step 10 — Configure Expo Push Notifications

`expo-notifications` requires the EAS `projectId` to issue push tokens:

```bash
# Get your real project UUID
eas project:info

# Update app.json:
# "extra": { "eas": { "projectId": "YOUR_REAL_UUID" } }
# "updates": { "url": "https://u.expo.dev/YOUR_REAL_UUID" }
```

---

## Secret Summary

| Secret name | Where to create | Used by |
|-------------|----------------|---------|
| `GOOGLE_SERVICES_JSON` | EAS (`eas secret:create`) | Android build — FCM push token + Google Sign-In |
| `GOOGLE_SERVICES_PLIST` | EAS (`eas secret:create`) | iOS build — FCM + Google Sign-In |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Supabase secrets | `send-push` — FCM v1 OAuth2 auth (replaces FIREBASE_SERVER_KEY) |
| `FIREBASE_PROJECT_ID` | Supabase secrets | `send-push` + `firebase-live` edge functions |
| `FIREBASE_DATABASE_URL` | Supabase secrets | `firebase-live` edge function |
| `FIREBASE_API_KEY` | Supabase secrets | `firebase-live` edge function |
| `FIREBASE_MESSAGING_SENDER_ID` | Supabase secrets | Reference / verification |
| `FIREBASE_APP_ID` | Supabase secrets | Reference / verification |

---

## Git Safety

`google-services.json` and `GoogleService-Info.plist` must **never** be committed.
Add to `.gitignore`:

```
# Firebase — real credentials (use EAS secrets for CI/CD)
/google-services.json
/GoogleService-Info.plist
/google-service-account.json
```

The placeholder files in the repository contain only dummy values and are safe to commit.

---

## Verification Checklist

- [ ] Real `google-services.json` downloaded from Firebase Console
- [ ] `google-services.json` has `package_name: com.predictxta.sports`
- [ ] EAS secret `GOOGLE_SERVICES_JSON` created (`eas secret:list` shows it)
- [ ] Real `GoogleService-Info.plist` downloaded from Firebase Console
- [ ] `GoogleService-Info.plist` has `BUNDLE_ID: com.predictxta.app`
- [ ] EAS secret `GOOGLE_SERVICES_PLIST` created
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` set in Supabase secrets (replaces legacy FIREBASE_SERVER_KEY)
- [ ] `FIREBASE_DATABASE_URL` set in Supabase secrets
- [ ] `FIREBASE_PROJECT_ID` set in Supabase secrets
- [ ] Production SHA-1 added to Firebase Android app after first EAS build
- [ ] APNs `.p8` key uploaded to Firebase for iOS push
- [ ] `app.json → extra.eas.projectId` updated with real EAS UUID
- [ ] `app.json → updates.url` updated with real EAS UUID
- [ ] Preview build tested: `eas build --platform android --profile preview`
- [ ] Production build tested: `eas build --platform android --profile production`
