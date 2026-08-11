# PredictXta — Production Deployment Guide

## Prerequisites

- Node.js 18+, npm/pnpm
- EAS CLI: `npm install -g eas-cli`
- Logged in: `eas login`
- Expo account linked to project

---

## 1. Environment Configuration

### Required `.env` variables (client-side, EXPO_PUBLIC_ prefix):
```
EXPO_PUBLIC_SUPABASE_URL=https://osmkbrryalhtpnayosmk.backend.onspace.ai
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

### Required Edge Function secrets (set via Supabase Dashboard → Secrets):
```
API_FOOTBALL_KEY        # api-football.com API key
SPORTSDB_KEY            # thesportsdb.com API key (or "3" for free tier)
FIREBASE_API_KEY
FIREBASE_PROJECT_ID
FIREBASE_DATABASE_URL
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
OPENAI_API_KEY          # GPT-4 predictions
GEMINI_API_KEY          # Gemini predictions
Groq_API_Key            # Groq/LLaMA predictions
```

---

## 2. Pre-Build Checklist

Run these before every production build:

```bash
# Verify all dependencies installed
npm install

# Run TypeScript check
npx tsc --noEmit

# Check for any lint errors
npx expo-doctor
```

---

## 3. Web Deployment

```bash
# Export static web build
npx expo export --platform web

# Output is in: dist/

# Deploy to any static host (Vercel, Netlify, Cloudflare Pages, etc.)
# Example — Netlify:
npx netlify deploy --dir dist --prod

# Example — serve locally for testing:
npx serve dist
```

### Web SEO & PWA
- Meta tags and PWA manifest configured in `app.json` → `web`
- Theme color: `#070B14`, Display: `standalone`
- Favicon: `./assets/logo.png`

---

## 4. Android Build (Google Play)

### 4a. Development APK (internal testing)
```bash
eas build --platform android --profile development
```

### 4b. Preview APK (share link)
```bash
eas build --platform android --profile preview
```

### 4c. Production AAB (Play Store)
```bash
eas build --platform android --profile production
```

### 4d. Production APK (direct install)
```bash
eas build --platform android --profile production-apk
```

### Google Play Store Submission
```bash
# After AAB is built:
eas submit --platform android --profile production
```

**Required before submission:**
1. `google-services.json` in project root (from Firebase Console → Project Settings → Android)
2. `google-service-account.json` for automated Play Store upload
3. App signing key configured in EAS (`eas credentials`)
4. Privacy policy URL live and accessible
5. Data Safety form completed in Play Console
6. Content rating questionnaire completed

**Package name:** `com.predictxta.sports`  
**Min SDK:** 24 (Android 7.0)  
**Target SDK:** 35 (Android 15)

---

## 5. iOS Build (App Store)

### 5a. Development build (simulator)
```bash
eas build --platform ios --profile development
```

### 5b. Preview build (TestFlight)
```bash
eas build --platform ios --profile preview
```

### 5c. Production build (App Store)
```bash
eas build --platform ios --profile production
```

### App Store Submission
```bash
eas submit --platform ios --profile production
```

**Required before submission:**
1. Apple Developer account with active membership
2. Bundle ID registered: `com.predictxta.sports` (same as Android — both share this package name)
3. App Store Connect entry created
4. Apple Sign-In capability enabled
5. Push notification entitlement
6. Privacy policy & terms of service URLs
7. Age rating completed (likely 17+ for gambling-adjacent predictions)
8. Screenshots for iPhone and iPad

---

## 6. OTA Updates (Expo Updates)

After enabling `updates` in `app.json` and setting up EAS Update:

```bash
# Push an OTA update to production channel
eas update --channel production --message "Fix: live scores polling"

# Push to preview channel
eas update --channel preview --message "Test: new AI predictions UI"
```

OTA updates work for JS/assets only — native code changes require a full build.

---

## 7. OAuth Configuration

### Google Sign-In
1. Google Cloud Console → OAuth 2.0 Credentials
2. Add Android app: package `com.predictxta.sports` + SHA-1 from `eas credentials`
3. Add iOS app: bundle ID `com.predictxta.sports`
4. Supabase Dashboard → Authentication → Providers → Google → enable + add Client ID/Secret

### Apple Sign-In  
1. Apple Developer → Certificates → Sign In with Apple
2. Supabase Dashboard → Authentication → Providers → Apple → enable + add Service ID / Secret Key

### Redirect URLs (both must be in Supabase Auth → URL Configuration):
```
predictxta://auth
predictxta://auth/callback
predictxta://reset-password
```

---

## 8. Push Notifications

1. Firebase Console → Cloud Messaging → Server Key → add to Supabase secret `FIREBASE_SERVER_KEY`
2. iOS: Upload APNs key to Firebase Console → Project Settings → Cloud Messaging
3. Test via `send-push` edge function

---

## 9. Database & Backend

### Enable pg_cron (run once in Supabase SQL Editor):
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

Then run `scripts/setup-cron-schedules.sql` (v4.0) to activate all 16 pipeline jobs.

### Vault secrets (required for pg_cron → edge functions):
```sql
SELECT vault.create_secret('SUPABASE_URL',
  'https://osmkbrryalhtpnayosmk.backend.onspace.ai', 'Project URL');
SELECT vault.create_secret('SUPABASE_SERVICE_ROLE_KEY',
  '<your-service-role-key>', 'Service role key');
-- Optional: Slack/webhook for critical alerts
SELECT vault.create_secret('WEBHOOK_ALERT_URL',
  'https://hooks.slack.com/services/...', 'Critical alert webhook');
```

### Verify before launch:
```sql
-- Confirm all 16 cron jobs scheduled
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'predictxta-%';

-- Verify quota-aware dispatcher registered
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'invoke_sync_live_quota_aware';

-- Check sport coverage (13 sports)
SELECT * FROM v_sport_coverage;

-- Check provider health
SELECT * FROM v_provider_health_today;

-- Confirm predictions exist
SELECT COUNT(*) FROM predictions WHERE confidence >= 55;

-- Check quota baseline (~3,100/day expected for 13 sports)
SELECT SUM(request_count) FROM api_usage
WHERE date = to_char(NOW(), 'YYYY-MM-DD');

-- Pipeline health score
SELECT * FROM public.v_cron_health_score;
```

---

## 10. Version Bump Procedure

For each release:

1. Update `app.json`:
   - Increment `version` (semver: `1.0.1` → `1.0.2`)
   - Increment `android.versionCode` (`2` → `3`)
   - Increment `ios.buildNumber` (`"2"` → `"3"`)
2. Commit: `git commit -am "chore: bump version to 1.0.2"`
3. Tag: `git tag v1.0.2 && git push --tags`
4. Run EAS build for target platforms

---

## 11. Disclaimer (Legal)

The in-app disclaimer must be visible on:
- Onboarding screen (Step 3 — AI Prediction Preview)
- AI Picks tab header
- Individual prediction cards

**Text:** *"PredictXta predictions are generated by AI for entertainment and informational purposes only. They do not constitute financial or betting advice. Please gamble responsibly."*

---

## 12. Sports Coverage (v2.0 — 13 verified sports)

**API-Sports quota-consuming (10 sports):**
football, basketball, hockey, handball, volleyball, rugby, baseball, american-football, mma, afl

**TheSportsDB free tier (3 sports):**
tennis, cricket, formula1

**Removed (9 unsupported sports):**
boxing, motorsports, table-tennis, badminton, esports, snooker, darts, cycling, athletics

**Expected daily API quota:** ~3,100 calls/day (out of 7,000 limit — 57% headroom at baseline)

---

## 13. Bundle Identifier Note

Both iOS and Android share the same package name: **`com.predictxta.sports`**

- `app.json` → `ios.bundleIdentifier` = `com.predictxta.sports`
- `app.json` → `android.package` = `com.predictxta.sports`

Ensure the Apple Developer portal identifier, Google Cloud OAuth credential, and App Store Connect entry all use `com.predictxta.sports`.
