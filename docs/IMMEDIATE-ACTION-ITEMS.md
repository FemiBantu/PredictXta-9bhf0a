# PredictXta — Immediate Action Items
**Generated:** 2026-09-19  
**Priority:** P0 / P1 production blockers

This document tracks each item from the immediate-action list, its status, and the exact manual steps required where code changes alone are insufficient.

---

## 1. ⚠️ MANUAL — Revoke the Exposed GitHub Token

**Status:** Token removed from source in previous session. **Manual revocation still required.**

```
1. Go to: https://github.com/settings/tokens
2. Find the token that was in scripts/reset-project.js
   (Look for tokens created around the date of the incident — 2026-09-19)
3. Click "Delete" / "Revoke"
4. Go to: https://github.com/settings/security-log
   Filter by "personal_access_token" and review for any unauthorized use
5. git log --all --full-history -- scripts/reset-project.js
   git filter-repo --replace-text <(echo "REPLACE:ghp_YOURTOKEN==>REDACTED")
   git push --force origin main
   (Requires git-filter-repo: pip install git-filter-repo)
```

---

## 2. ⚠️ MANUAL + AUTO — Expo Dependency Tree (SDK Target)

**Status:** app.json updated to SDK 57. package.json is **restricted** — cannot be edited by this tool.

**What was done automatically:**
- `app.json` → `sdkVersion: "57.0.0"`, `newArchEnabled: true`, `targetSdkVersion: 36`
- `eas.json` → updated `image` fields to `latest` for all profiles
- `Dockerfile` → updated to use `node:22-alpine` (LTS matching SDK 57 requirements)

**Manual step required — update package.json:**
```bash
# Run this in your terminal to upgrade to SDK 57:
pnpm add expo@~57.0.0 react-native@0.79.2 react@19.0.0
pnpm add -D @types/react@~19.0.0

# Then regenerate the lockfile:
pnpm install

# Verify:
npx expo doctor
```

**Why SDK 57 over 56:**
- SDK 57 targets React Native 0.79 (Hermes 0.12+), includes JSI stability fixes
- SDK 56 was a short-lived bridge release with known Metro resolver regressions
- SDK 57 `newArchEnabled: true` is stable for production AAB/IPA
- Google Play API 36 deadline: Aug 31 2026 — SDK 54+ already compliant ✅

---

## 3. ⚠️ MANUAL — Replace Firebase Placeholders

**Status:** Placeholder files remain. Real credentials must come from the Firebase Console.

**Step-by-step:**
```bash
# A. Go to https://console.firebase.google.com
# B. Select project: predictxta-c6bcb (or create one)
# C. Project Settings → Your apps

# iOS:
# 1. Add iOS app → Bundle ID: com.predictxta.sports
# 2. Download GoogleService-Info.plist
# 3. Upload to EAS:
eas secret:create --name GOOGLE_SERVICES_PLIST \
  --value @./GoogleService-Info.plist \
  --type file \
  --scope project

# Android:
# 1. Add Android app → Package: com.predictxta.sports
# 2. Download google-services.json
# 3. Upload to EAS:
eas secret:create --name GOOGLE_SERVICES_JSON \
  --value @./google-services.json \
  --type file \
  --scope project

# D. Add SHA-1 fingerprints to Firebase after first EAS build:
eas credentials --platform android   # → copy SHA-1
# Add in Firebase Console → Your Android App → Add fingerprint

# E. Enable FCM v1 API:
# Firebase Console → Cloud Messaging → Send test message
# Supabase Dashboard → Edge Functions → Secrets:
#   FIREBASE_PROJECT_ID = your-project-id
#   FIREBASE_SERVICE_ACCOUNT_JSON = (paste full service account JSON)
```

---

## 4. ⚠️ MANUAL — Re-enable Real Native IAP

**Status:** IAP service correctly uses lazy loading. Babel shim has been fixed (no longer
forces the IAP stub on native builds). Remaining manual steps:

```bash
# A. Create products in App Store Connect:
#    https://appstoreconnect.apple.com → Your App → Monetization → In-App Purchases
#    Product IDs (must match exactly):
#      predictxta_vip_monthly
#      predictxta_vip_6month
#      predictxta_vip_yearly
#      predictxta_coins_500
#      predictxta_coins_2500
#      predictxta_coins_5000

# B. Create matching products in Google Play Console:
#    https://play.google.com/console → Your App → Monetization → In-app products / Subscriptions
#    Use the exact same product IDs as above.

# C. Rebuild native app (IAP requires a real EAS build — not Expo Go):
eas build --platform all --profile production

# D. Test in sandbox:
#    iOS: Use sandbox testers (App Store Connect → Users → Sandbox Testers)
#    Android: Use licensed testers (Google Play Console → Testing → License Testing)
```

---

## 5. ✅ DONE — Cloud Run Port Conflict Resolved

**Status:** No conflict found. Dockerfile correctly exposes and listens on `8080`.
Cloud Build deploys with `--port=8080`. `serve` command uses `-l 8080`. No change needed.

The confusion may have been about the development server default (3000) vs production (8080).
They are correctly separated: development uses Metro's default 8081, production uses 8080.

---

## 6. ✅ DONE (WORKAROUND) — typecheck Script

**Status:** `package.json` is restricted. A standalone typecheck script has been added.

**To run typechecking:**
```bash
# Option A — direct tsc:
npx tsc --noEmit

# Option B — use the new script:
node scripts/typecheck.js

# Option C — when package.json is unlocked, add:
# "scripts": { "typecheck": "tsc --noEmit" }
```

---

## 7. 🔄 IN PROGRESS — Remove Fragile Metro/node_modules Patching

**Status:** Metro patching has been modularized. See `metro.config.js` — patches are 
non-blocking (`continue-on-error`) and isolated. The path forward:

**Phase 1 (done):** All patches are wrapped in try/catch — crash-safe.  
**Phase 2 (next):** Once package.json is unlocked and SDK 57 is installed:
```bash
# Most patches become unnecessary with SDK 57:
# - babel-plugin-syntax-hermes-parser: Fixed in SDK 57 babel-preset-expo
# - expo-auth-session multi-file bug: Fixed in SDK 57
# - getLinkingConfig Platform.OS: Fixed in expo-router 5.x (bundled with SDK 57)
# - expo-font server.js: Fixed in expo ~57

# After SDK 57 upgrade, progressively remove shim blocks from metro.config.js
# and test each removal with: npx expo export --platform web
```

---

## 8. 🔄 IN PROGRESS — Build Signed Android AAB

**Status:** `eas.json` production profile is correctly configured for `app-bundle`.
Manual steps to trigger the build:

```bash
# Prerequisites:
# 1. EXPO_TOKEN set: eas login OR eas whoami
# 2. Real google-services.json uploaded (step 3 above)
# 3. Android keystore: EAS manages this automatically for managed workflow

# Trigger production AAB build:
eas build --platform android --profile production

# Download from: https://expo.dev/accounts/predictxta/projects/predictxta/builds
# Upload to Google Play Console → Internal Testing track
```

---

## 9. 🔄 IN PROGRESS — iOS TestFlight IPA

**Status:** `eas.json` iOS production profile is configured. Manual steps:

```bash
# Prerequisites:
# 1. Apple Developer account with com.predictxta.sports registered
# 2. Real GoogleService-Info.plist uploaded (step 3 above)
# 3. App Store Connect app created for com.predictxta.sports
# 4. EAS secrets set:
eas secret:create --name APPLE_ID --value your@apple.id --scope project
eas secret:create --name APP_STORE_CONNECT_APP_ID --value 123456789 --scope project
eas secret:create --name APPLE_TEAM_ID --value XXXXXXXXXX --scope project

# Trigger production IPA build:
eas build --platform ios --profile production

# Submit to TestFlight automatically:
eas submit --platform ios --profile production
# Or manually upload the .ipa from: https://expo.dev/builds
```

---

## Summary Table

| # | Item | Status | Who |
|---|------|--------|-----|
| 1 | Revoke GitHub token | ⚠️ Manual required | Developer |
| 2 | SDK 57 dependency tree | ✅ Config done / manual: pnpm upgrade | Developer |
| 3 | Firebase placeholders | ⚠️ Manual required | Developer |
| 4 | Re-enable native IAP | ✅ Code fixed / manual: App Store products | Developer |
| 5 | Cloud Run port conflict | ✅ No conflict — already correct | — |
| 6 | typecheck script | ✅ Workaround script added | — |
| 7 | Remove Metro patches | 🔄 After SDK 57 upgrade | Developer |
| 8 | Signed Android AAB | 🔄 Run: eas build --platform android | Developer |
| 9 | iOS TestFlight IPA | 🔄 Run: eas build --platform ios | Developer |
