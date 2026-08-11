/**
 * deployment-checklist.tsx — PredictXta Production Deployment Checklist
 * Comprehensive pre-release checklist for Web, Android (Play Store) and iOS (App Store).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/contexts/ThemeContext';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';
import type { AppColors } from '@/constants/theme';

const CHECKLIST_KEY = '@predictxta/deployment_checklist_v3';

interface CheckItem {
  id: string;
  category: string;
  label: string;
  description: string;
  critical: boolean;
  checked: boolean;
  platform?: 'all' | 'android' | 'ios' | 'web';
}

const INITIAL_ITEMS: CheckItem[] = [
  // ── App Configuration ─────────────────────────────────────────────────────
  { id: 'cfg_1', category: 'App Configuration', label: 'EAS Project ID confirmed', description: 'app.json extra.eas.projectId = 9c9238ac-123c-4ff5-966d-b3a036b0d66a (real UUID) — ✅ Confirmed in app.json', critical: true, checked: true },
  { id: 'cfg_2', category: 'App Configuration', label: 'OTA update URL configured', description: 'updates.url = https://u.expo.dev/9c9238ac-123c-4ff5-966d-b3a036b0d66a — ✅ Confirmed. Note: updates.enabled=false intentionally (enable when ready for OTA pushes)', critical: true, checked: true },
  { id: 'cfg_3', category: 'App Configuration', label: 'iOS bundle ID registered', description: 'com.predictxta.sports (app.json ios.bundleIdentifier) must be created in Apple Developer portal → Identifiers. Note: iOS and Android share the same package name.', critical: true, checked: false, platform: 'ios' },
  { id: 'cfg_4', category: 'App Configuration', label: 'Android package registered', description: 'com.predictxta.sports package name confirmed — cannot be changed after first Play Store upload', critical: true, checked: false, platform: 'android' },
  { id: 'cfg_5', category: 'App Configuration', label: 'Version 1.0.1 / versionCode 2 / buildNumber "2"', description: 'app.json: version "1.0.1", android.versionCode 2, ios.buildNumber "2" — ✅ Confirmed in app.json', critical: true, checked: true },
  { id: 'cfg_6', category: 'App Configuration', label: 'App icon is 1024×1024 PNG (no alpha)', description: 'assets/logo.png must be exactly 1024×1024 px, PNG format, no transparency for App Store submission', critical: true, checked: false, platform: 'ios' },
  { id: 'cfg_7', category: 'App Configuration', label: 'Splash screen configured', description: 'expo-splash-screen plugin in app.json pointing to assets/logo.png with backgroundColor #070B14', critical: false, checked: false },
  { id: 'cfg_8', category: 'App Configuration', label: 'NSAllowsArbitraryLoads: false', description: 'app.json ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads is false — ✅ Fixed (App Store would reject true)', critical: true, checked: true },
  { id: 'cfg_9', category: 'App Configuration', label: 'APS environment: production', description: 'app.json ios.entitlements.aps-environment set to "production" — ✅ Fixed (required for push notifications on real devices)', critical: true, checked: true },
  { id: 'cfg_10', category: 'App Configuration', label: 'PrivacyInfo.xcprivacy complete', description: 'ios/PrivacyInfo.xcprivacy has all 5 required API types: UserDefaults (CA92.1), FileTimestamp (C617.1), SystemBootTime (35F9.1), DiskSpace (E174.1) — ✅ Fixed', critical: true, checked: true },

  // ── Security ──────────────────────────────────────────────────────────────
  { id: 'sec_1', category: 'Security', label: 'RLS enabled on all tables — critical policies hardened', description: 'All 50+ Supabase tables have RLS enabled. CRITICAL POLICIES FIXED (Aug 2026): admin_roles INSERT/UPDATE/DELETE restricted to service_role (prevents privilege escalation); vip_subscriptions UPDATE restricted to service_role (prevents self-VIP grant); user_coins UPDATE restricted to service_role (prevents self-balance manipulation); expert_slips UPDATE restricted to open slips only. Verify in OnSpace Cloud → Data.', critical: true, checked: true },
  { id: 'sec_2', category: 'Security', label: 'No API keys in client bundle', description: 'Check .env: only EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are client-safe. All provider keys (API_FOOTBALL_KEY, OPENAI_API_KEY etc.) must be server-side only in Supabase Vault', critical: true, checked: false },
  { id: 'sec_3', category: 'Security', label: 'Auth redirect URLs set in Supabase', description: 'OnSpace Cloud → Users → Auth Settings: Site URL = predictxta://auth, Redirect URLs include predictxta://auth/callback and predictxta://auth', critical: true, checked: false },
  { id: 'sec_4', category: 'Security', label: 'google-services.json is real (not placeholder)', description: 'Replace the placeholder google-services.json with real file from Firebase Console → Project Settings → Android App (package: com.predictxta.sports)', critical: true, checked: false, platform: 'android' },
  { id: 'sec_5', category: 'Security', label: 'GoogleService-Info.plist is real (not placeholder)', description: 'Replace placeholder GoogleService-Info.plist with real file from Firebase Console → Project Settings → iOS App (bundle ID: com.predictxta.sports). Both Android and iOS use the same package name.', critical: true, checked: false, platform: 'ios' },
  { id: 'sec_6', category: 'Security', label: 'Credential files in .gitignore', description: 'google-services.json and GoogleService-Info.plist must NOT be committed to git. Verify they are in .gitignore', critical: true, checked: false },
  { id: 'sec_7', category: 'Security', label: 'EAS secret GOOGLE_SERVICES_JSON created', description: 'Run: eas secret:create --name GOOGLE_SERVICES_JSON --value @./google-services.json --type file --scope project', critical: true, checked: false, platform: 'android' },
  { id: 'sec_8', category: 'Security', label: 'EAS secret GOOGLE_SERVICES_PLIST created', description: 'Run: eas secret:create --name GOOGLE_SERVICES_PLIST --value @./GoogleService-Info.plist --type file --scope project', critical: true, checked: false, platform: 'ios' },
  { id: 'sec_9', category: 'Security', label: 'EAS secrets verified', description: 'Run: eas secret:list — both GOOGLE_SERVICES_JSON and GOOGLE_SERVICES_PLIST appear with type: file', critical: true, checked: false },
  { id: 'sec_10', category: 'Security', label: 'Firebase secrets in Supabase Vault', description: 'OnSpace Cloud → Secrets: FIREBASE_SERVICE_ACCOUNT_JSON (FCM v1), FIREBASE_DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_SERVER_KEY all set', critical: true, checked: false },
  { id: 'sec_11', category: 'Security', label: 'API provider keys in Supabase Vault', description: 'API_FOOTBALL_KEY, SPORTSDB_KEY, OPENAI_API_KEY, GEMINI_API_KEY, Groq_API_Key, HIGHLIGHTLY_API_KEY — all set in OnSpace Cloud → Secrets', critical: true, checked: false },
  { id: 'sec_12', category: 'Security', label: 'Rate limiting on Edge Functions', description: 'Security middleware in supabase/functions/_shared/security.ts enforcing rate limits on prediction and AI endpoints', critical: false, checked: false },

  // ── Android / Play Store ──────────────────────────────────────────────────
  { id: 'droid_1', category: 'Android / Play Store', label: 'SHA-1 fingerprint → Google Cloud Console', description: 'Run: eas credentials --platform android → copy SHA-1 → add to Google Cloud Console → OAuth 2.0 Client → Android', critical: true, checked: false, platform: 'android' },
  { id: 'droid_2', category: 'Android / Play Store', label: 'SHA-1 fingerprint → Firebase Android app', description: 'Firebase Console → Project Settings → Android App → Add fingerprint (SHA-1 from eas credentials)', critical: true, checked: false, platform: 'android' },
  { id: 'droid_3', category: 'Android / Play Store', label: 'Production AAB built (EAS)', description: 'Run: eas build --platform android --profile production → generates .aab for Play Store', critical: true, checked: false, platform: 'android' },
  { id: 'droid_4', category: 'Android / Play Store', label: '⚠️ targetSdkVersion 36 required by Aug 31 2026 — MANUAL UPGRADE NEEDED', description: '🚨 DEADLINE IN ~24 DAYS: Google Play requires API 36 for all app submissions from Aug 31 2026. MANUAL STEPS (package.json is restricted — run these in a terminal outside this editor): (1) npx expo install expo@^54.0.0 --fix (2) Review breaking changes: https://expo.dev/changelog/sdk-54 (3) Rebuild: eas build --platform android --profile production (4) Verify targetSdkVersion=36 in the built AAB. Note: Expo SDK 54+ targets Android API 36 by default. Until upgraded, this item must remain unchecked.', critical: true, checked: false, platform: 'android' },
  { id: 'droid_5', category: 'Android / Play Store', label: 'Feature graphic uploaded (1024×512)', description: 'assets/play-store-feature-graphic.png uploaded to Play Console → Store listing → Graphic assets → Feature Graphic', critical: true, checked: false, platform: 'android' },
  { id: 'droid_6', category: 'Android / Play Store', label: 'Phone screenshots prepared (6+)', description: 'Minimum 2, max 8 screenshots at 1080×1920 or 1242×2208. Capture via ScreenshotFrame component for all 6 screens', critical: true, checked: false, platform: 'android' },
  { id: 'droid_7', category: 'Android / Play Store', label: 'Store listing title + descriptions written', description: 'Short description (80 chars): "AI predictions for 13+ sports". Long description (4000 chars): full feature list including football, basketball, tennis, cricket, MMA, AFL and more', critical: true, checked: false, platform: 'android' },
  { id: 'droid_8', category: 'Android / Play Store', label: 'Data Safety form completed', description: 'Play Console → App content → Data Safety. Declare: email (collected, linked), device ID (collected, not linked), usage data, no data sold', critical: true, checked: false, platform: 'android' },
  { id: 'droid_9', category: 'Android / Play Store', label: 'Account deletion URL in Data Safety form', description: 'Play Console → Data Safety → "Does your app allow users to request deletion?" → Yes → URL: https://predictxta.app/account-deletion OR note in-app flow', critical: true, checked: false, platform: 'android' },
  { id: 'droid_10', category: 'Android / Play Store', label: 'IARC content rating completed', description: 'Play Console → App content → App content rating → complete IARC questionnaire. Expected: 17+ (Teen) due to simulated gambling content', critical: true, checked: false, platform: 'android' },
  { id: 'droid_11', category: 'Android / Play Store', label: 'Gambling disclaimer visible', description: 'AI Picks and prediction screens show "For entertainment only. Not financial advice." disclaimer (DisclaimerBanner component)', critical: true, checked: false, platform: 'android' },
  { id: 'droid_12', category: 'Android / Play Store', label: 'Privacy policy URL live', description: 'https://predictxta.app/privacy must return 200 and display the privacy policy. Add to Play Console → Store listing → Privacy policy URL', critical: true, checked: false, platform: 'android' },
  { id: 'droid_13', category: 'Android / Play Store', label: 'Account deletion flow tested end-to-end', description: 'Profile → Settings → Delete My Data → type CONFIRM → delete-account edge function executes → redirect to /account-deleted', critical: true, checked: false, platform: 'android' },
  { id: 'droid_14', category: 'Android / Play Store', label: 'EAS submit credentials configured', description: 'eas.json submit.production.android: serviceAccountKeyPath points to valid google-service-account.json (Play Console → Setup → API access)', critical: false, checked: false, platform: 'android' },

  // ── iOS / App Store ───────────────────────────────────────────────────────
  { id: 'ios_1', category: 'iOS / App Store', label: 'Sign In with Apple capability enabled', description: 'Apple Developer → Identifiers → com.predictxta.sports → Capabilities → Sign In with Apple: Enabled', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_2', category: 'iOS / App Store', label: 'Push Notifications capability enabled', description: 'Apple Developer → Identifiers → com.predictxta.sports → Capabilities → Push Notifications: Enabled', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_3', category: 'iOS / App Store', label: 'APNs key / certificate uploaded to Firebase', description: 'Firebase Console → Project Settings → Cloud Messaging → APNs Authentication Key (.p8) or APNs Certificate uploaded', critical: false, checked: false, platform: 'ios' },
  { id: 'ios_4', category: 'iOS / App Store', label: 'Production IPA built (EAS)', description: 'Run: eas build --platform ios --profile production → generates .ipa / archive for TestFlight / App Store. Bundle ID: com.predictxta.sports', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_5', category: 'iOS / App Store', label: 'App Store Connect entry created', description: 'Create new app at appstoreconnect.apple.com with bundle ID com.predictxta.sports, SKU: predictxta-ios-001 (matches eas.json)', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_6', category: 'iOS / App Store', label: 'Age rating questionnaire completed (17+)', description: 'App Store Connect → App Information → Age Rating → complete questionnaire. Mark "Simulated Gambling" → Infrequent/Mild → expected 17+. Bundle ID: com.predictxta.sports', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_7', category: 'iOS / App Store', label: 'Screenshots: 6.7-inch (1290×2796 px)', description: 'Required 6.7" iPhone 15 Pro Max screenshots (5-10). Capture from ScreenshotFrame component', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_8', category: 'iOS / App Store', label: 'Screenshots: 5.5-inch (1242×2208 px)', description: 'Required 5.5" iPhone 8 Plus screenshots. Same 5-10 screens as 6.7"', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_9', category: 'iOS / App Store', label: 'Screenshots: 12.9-inch iPad (2048×2732 px)', description: 'Optional but strongly recommended iPad Pro screenshots for better visibility in App Store', critical: false, checked: false, platform: 'ios' },
  { id: 'ios_10', category: 'iOS / App Store', label: 'Privacy policy URL in App Store metadata', description: 'App Store Connect → App Information → Privacy Policy URL: https://predictxta.app/privacy', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_11', category: 'iOS / App Store', label: 'Support URL in App Store metadata', description: 'App Store Connect → App Information → Support URL: https://predictxta.app or support@predictxta.app', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_12', category: 'iOS / App Store', label: 'EAS submit credentials configured', description: 'eas.json submit.production.ios still has YOUR_APPLE_ID@email.com, YOUR_APP_STORE_CONNECT_APP_ID, YOUR_APPLE_TEAM_ID — replace all three placeholders before running eas submit', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_13', category: 'iOS / App Store', label: 'App Review notes prepared', description: 'App Store Connect → Review Information: provide test account credentials (email + password) so Apple can review authenticated features. App is for com.predictxta.sports.', critical: true, checked: false, platform: 'ios' },
  { id: 'ios_14', category: 'iOS / App Store', label: 'IAP products configured (if applicable)', description: 'App Store Connect → In-App Purchases: create VIP subscription product with correct product ID matching services/iapService.ts', critical: false, checked: false, platform: 'ios' },
  { id: 'ios_15', category: 'iOS / App Store', label: 'TestFlight internal testing completed', description: 'Upload build to TestFlight → add internal testers → test all critical flows before App Store submission', critical: true, checked: false, platform: 'ios' },

  // ── Web / PWA ─────────────────────────────────────────────────────────────
  { id: 'web_1', category: 'Web / PWA', label: 'Static export builds cleanly', description: 'Run: npx expo export --platform web → dist/ folder created with no errors or missing module warnings', critical: true, checked: false, platform: 'web' },
  { id: 'web_2', category: 'Web / PWA', label: 'PWA manifest icons fixed', description: 'web/manifest.json icons now have separate "any" and "maskable" entries for 192×192 and 512×512 — ✅ Fixed', critical: true, checked: true, platform: 'web' },
  { id: 'web_3', category: 'Web / PWA', label: 'PWA manifest has id field', description: 'web/manifest.json has id: "/" for proper PWA identity — ✅ Fixed', critical: false, checked: true, platform: 'web' },
  { id: 'web_4', category: 'Web / PWA', label: 'OG meta tags have absolute URLs', description: 'web/index.html og:image and og:url use absolute https://predictxta.app/... URLs — ✅ Fixed', critical: false, checked: true, platform: 'web' },
  { id: 'web_5', category: 'Web / PWA', label: 'Web shims all resolve', description: 'All shims/ directory stubs work: expo-notifications, expo-video, expo-image, expo-auth-session all have web-safe fallbacks', critical: true, checked: false, platform: 'web' },
  { id: 'web_6', category: 'Web / PWA', label: 'CORS headers on all edge functions', description: 'Every function in supabase/functions/ handles OPTIONS preflight and returns Access-Control-Allow-Origin header', critical: true, checked: false, platform: 'web' },
  { id: 'web_7', category: 'Web / PWA', label: 'Cookie consent banner shown', description: 'CookieConsentBanner component renders on first web visit (GDPR compliance for EU users)', critical: false, checked: false, platform: 'web' },
  { id: 'web_8', category: 'Web / PWA', label: 'robots.txt accessible', description: 'Deploy a /robots.txt allowing Googlebot. Content: "User-agent: * / Allow: /" to ensure search indexing', critical: false, checked: false, platform: 'web' },
  { id: 'web_9', category: 'Web / PWA', label: 'Hosting platform configured', description: 'Choose deployment target: Netlify, Vercel, Cloudflare Pages, or Firebase Hosting — deploy dist/ output, set up custom domain', critical: true, checked: false, platform: 'web' },

  // ── Data & Backend ────────────────────────────────────────────────────────
  { id: 'data_1', category: 'Data & Backend', label: 'All 13 sports have fixture data', description: 'sport_coverage view shows FULL or PARTIAL coverage for all 13 verified sports. No sport returns 0 fixtures for current week. Sports: football, basketball, tennis, cricket, baseball, hockey, rugby, handball, volleyball, american-football, mma, formula1, afl', critical: true, checked: false },
  { id: 'data_2', category: 'Data & Backend', label: 'AI predictions generated (10,000+)', description: 'predictions table has 10,000+ rows with confidence ≥55%. Query: SELECT count(*) FROM predictions WHERE confidence >= 55', critical: true, checked: false },
  { id: 'data_3', category: 'Data & Backend', label: 'pg_cron v4.0 jobs active (16 jobs)', description: 'All 16 v4.0 scheduled jobs running: sync-live (quota-aware, */5), retry-sweep (*/15), sync-news (*/2h), sync-highlights (*/4h), cleanup-stale (hourly), cleanup-midnight, expert-promotion, rebalance-weights, fetch-matches-morning, sync-standings, daily-challenge, fetch-matches (18:00), fetch-odds, generate-predictions, pipeline-audit, settle-picks', critical: true, checked: false },
  { id: 'data_4', category: 'Data & Backend', label: 'Midnight preload pipeline tested', description: 'POST to midnight-preload edge function with {"stage":"all"} — all 8 stages complete successfully in sync_logs table', critical: true, checked: false },
  { id: 'data_5', category: 'Data & Backend', label: 'sync-live edge function active', description: 'sync-live function deployed and called every 5 min via invoke_sync_live_quota_aware() SQL function. Quota-aware: throttles to football+TSDB at >75% usage. Check cron_execution_log for status=succeeded rows.', critical: true, checked: false },
  { id: 'data_6', category: 'Data & Backend', label: 'Quota monitor within budget (13-sport calibration)', description: 'quota-monitor shows expected daily usage ~3,100/day (13 sports). Caution at 60% (~4,200), Warning at 75% (~5,250), Critical at 90% (~6,300). Emergency buffer: ~3,900 calls. Verify via GET /functions/v1/quota-monitor', critical: true, checked: false },
  { id: 'data_7', category: 'Data & Backend', label: 'Firebase RTDB connected', description: 'FIREBASE_DATABASE_URL configured in Supabase secrets. firebase-live edge function connects and broadcasts match updates', critical: false, checked: false },
  { id: 'data_8', category: 'Data & Backend', label: 'Daily Challenge generates automatically', description: 'generate-daily-challenge edge function scheduled at 09:00 UTC — test by calling manually and verifying daily_challenges table entry', critical: false, checked: false },
  { id: 'data_9', category: 'Data & Backend', label: 'Vault secrets for pg_cron configured', description: 'Run in Supabase SQL Editor: SELECT vault.create_secret(\"SUPABASE_URL\", \"https://osmkbrryalhtpnayosmk.backend.onspace.ai\", \"Project URL\"); SELECT vault.create_secret(\"SUPABASE_SERVICE_ROLE_KEY\", \"<key>\", \"Service role key\"); Optional: WEBHOOK_ALERT_URL for critical alerts', critical: true, checked: false },
  { id: 'data_10', category: 'Data & Backend', label: 'pg_net extension enabled', description: 'Supabase Dashboard → Database → Extensions → enable pg_net (required alongside pg_cron for async HTTP calls to edge functions)', critical: true, checked: false },
  { id: 'data_11', category: 'Data & Backend', label: 'setup-cron-schedules.sql v4.0 executed', description: 'Run scripts/setup-cron-schedules.sql in Supabase SQL Editor. Pre-flight block should print ✅ All pre-flight checks PASSED → scheduling 16 jobs. Verify: SELECT COUNT(*) FROM cron.job WHERE jobname LIKE \"predictxta-%\"; → expect 16', critical: true, checked: false },
  { id: 'data_12', category: 'Data & Backend', label: 'invoke_sync_live_quota_aware() SQL function deployed', description: 'Verify the quota-aware dispatcher exists: SELECT routine_name FROM information_schema.routines WHERE routine_name = \"invoke_sync_live_quota_aware\"; JOB 1 (sync-live) calls this instead of invoke_edge_function() directly', critical: true, checked: false },

  // ── Testing ───────────────────────────────────────────────────────────────
  { id: 'test_1', category: 'Testing', label: 'Google Sign-In tested on Android APK', description: 'Install production-apk build on Android device → tap Google Sign-In → OAuth completes without E006 error → lands in app', critical: true, checked: false, platform: 'android' },
  { id: 'test_2', category: 'Testing', label: 'Apple Sign-In tested on iOS device', description: 'Install TestFlight build on iOS device → tap Apple Sign-In → auth sheet appears → completes successfully → user created in Supabase', critical: true, checked: false, platform: 'ios' },
  { id: 'test_3', category: 'Testing', label: 'Push notifications delivered', description: 'Test: Daily Challenge (9 AM), Goal Alert (after live match event). Check notification arrives on both iOS (APNs) and Android (FCM v1)', critical: false, checked: false },
  { id: 'test_4', category: 'Testing', label: 'VIP subscription purchase + restore', description: 'Test: buy VIP → access unlocked, restore purchase on new install → VIP status restored. Verify vip_subscriptions table updated', critical: false, checked: false },
  { id: 'test_5', category: 'Testing', label: 'Account deletion end-to-end', description: 'Profile → Settings → Delete My Data → Proceed → type DELETE (all caps) → Permanently Delete My Account → all data deleted → redirected to /account-deleted → login no longer works. Confirmation word is DELETE (not CONFIRM).', critical: true, checked: false },
  { id: 'test_6', category: 'Testing', label: 'All 13 sports render correctly', description: 'Fixtures, predictions, and match details render for all 13 verified sports: football, basketball, tennis, cricket, baseball, hockey, rugby, handball, volleyball, american-football, mma, formula1, afl. Removed: boxing, esports, table-tennis, badminton, snooker, darts, cycling, athletics, motorsports', critical: true, checked: false },
  { id: 'test_7', category: 'Testing', label: 'Password reset flow', description: 'Request reset → email received → link opens predictxta://reset-password → new password set → login succeeds', critical: true, checked: false },
  { id: 'test_8', category: 'Testing', label: 'Dark/light mode on all platforms', description: 'Toggle theme on Android, iOS, and Web. No layout breaks, all text readable, all icons visible in both modes', critical: false, checked: false },
  { id: 'test_9', category: 'Testing', label: 'AI Best 3 paywall (coin + VIP)', description: 'Locked section shows lock overlay → "Unlock 5 coins" deducts balance → section unlocked → re-open screen → still unlocked (AsyncStorage keyed)', critical: false, checked: false },
  { id: 'test_10', category: 'Testing', label: 'Live scores SSE updates', description: 'Open Live tab during a live match → score updates every 15–30s → minute counter increments → no duplicate events', critical: false, checked: false },
  { id: 'test_11', category: 'Testing', label: 'Offline mode gracefully handled', description: 'Disable network → app shows cached data → "You are offline" banner appears (BackgroundSyncManager) → reconnect → data refreshes', critical: false, checked: false },

  // ── Legal & Compliance ────────────────────────────────────────────────────
  { id: 'legal_1', category: 'Legal & Compliance', label: 'Privacy policy live at public URL', description: 'https://predictxta.app/privacy returns HTTP 200 with full policy text. Required by both Play Store and App Store', critical: true, checked: false },
  { id: 'legal_2', category: 'Legal & Compliance', label: 'Terms of service live at public URL', description: 'https://predictxta.app/terms returns HTTP 200. Linked from login screen and settings', critical: true, checked: false },
  { id: 'legal_3', category: 'Legal & Compliance', label: 'Predictions disclaimer on all AI screens', description: 'DisclaimerBanner component (variant="predictions") renders on ai-pick/[id].tsx, predictions tab, and sport AI picks pages', critical: true, checked: false },
  { id: 'legal_4', category: 'Legal & Compliance', label: 'Under-18 protection — 17+ rating submitted', description: 'Both Play Store (IARC) and App Store (Age Rating) questionnaires submitted with simulated gambling marked → 17+/Mature rating applied', critical: true, checked: false },
  { id: 'legal_5', category: 'Legal & Compliance', label: 'GDPR cookie consent for EU web users', description: 'CookieConsentBanner shown on first web visit → user accepts/declines → choice persisted in AsyncStorage → analytics only after consent', critical: false, checked: false },
  { id: 'legal_6', category: 'Legal & Compliance', label: 'Data deletion pathway submitted to stores', description: 'Play Store Data Safety: account deletion URL declared. App Store: privacy policy lists data deletion contact (support@predictxta.com or in-app flow)', critical: true, checked: false },
  { id: 'legal_7', category: 'Legal & Compliance', label: 'No real sports betting / wagering', description: 'App does not accept real money bets, process wagers, or guarantee financial outcomes. Disclaimer clearly visible on every prediction screen', critical: true, checked: false },
  { id: 'legal_8', category: 'Legal & Compliance', label: 'COPPA compliance — no users under 13', description: '17+ age rating acts as gate. Privacy policy states we do not knowingly collect data from under-18s. No age verification prompt required (17+ gate)', critical: true, checked: false },

  // ── Performance ───────────────────────────────────────────────────────────
  { id: 'perf_1', category: 'Performance', label: 'Cold start < 2 seconds', description: 'Measure time from app launch to home tab rendering on a mid-range Android (Snapdragon 665) and iPhone 12', critical: false, checked: false },
  { id: 'perf_2', category: 'Performance', label: 'No memory leaks', description: 'All useEffect hooks return cleanup functions. Interval/subscription refs cleared on unmount. Verify in React DevTools Profiler', critical: false, checked: false },
  { id: 'perf_3', category: 'Performance', label: 'All images using expo-image', description: 'No instances of React Native built-in Image component remain (use search for "from \'react-native\'" near Image import)', critical: false, checked: false },
  { id: 'perf_4', category: 'Performance', label: 'Web bundle < 3 MB', description: 'After expo export --platform web, check dist/ folder total size. Use: du -sh dist/ or source-map-explorer for breakdown', critical: false, checked: false },
  { id: 'perf_5', category: 'Performance', label: 'No unhandled promise rejections', description: 'Run app in dev mode for 10 minutes navigating all tabs — no red screen errors, no "Possible Unhandled Promise Rejection" warnings in console', critical: false, checked: false },
];

// ─── Category Config ──────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  'App Configuration': 'settings-outline',
  'Security': 'shield-checkmark-outline',
  'Android / Play Store': 'logo-android',
  'iOS / App Store': 'logo-apple',
  'Web / PWA': 'globe-outline',
  'Data & Backend': 'server-outline',
  'Testing': 'bug-outline',
  'Legal & Compliance': 'document-text-outline',
  'Performance': 'speedometer-outline',
};

const PLATFORM_COLORS: Record<string, string> = {
  android: '#22C55E',
  ios: '#A78BFA',
  web: '#38BDF8',
  all: '#F59E0B',
};

function PlatformPill({ platform, C }: { platform?: string; C: AppColors }) {
  if (!platform || platform === 'all') return null;
  const color = PLATFORM_COLORS[platform] ?? C.primary;
  const label = platform === 'android' ? '🤖 Android' : platform === 'ios' ? '🍎 iOS' : '🌐 Web';
  return (
    <View style={[pp.wrap, { backgroundColor: `${color}14`, borderColor: `${color}33` }]}>
      <Text style={[pp.text, { color }]}>{label}</Text>
    </View>
  );
}
const pp = StyleSheet.create({
  wrap: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  text: { fontSize: 8, fontWeight: FONTS.extraBold, letterSpacing: 0.2 },
});

function CategoryGroup({ category, items, onToggle, C }: {
  category: string; items: CheckItem[]; onToggle: (id: string) => void; C: AppColors;
}) {
  const done = items.filter(i => i.checked).length;
  const criticalFailed = items.filter(i => i.critical && !i.checked).length;
  const statusColor = criticalFailed > 0 ? '#EF4444' : done === items.length ? '#22C55E' : '#F59E0B';
  const icon = CATEGORY_ICONS[category] ?? 'checkmark-circle-outline';
  const [collapsed, setCollapsed] = useState(false);

  return (
    <View style={[cg.wrap, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable style={cg.header} onPress={() => setCollapsed(v => !v)}>
        <View style={[cg.iconWrap, { backgroundColor: `${statusColor}18`, borderColor: `${statusColor}33` }]}>
          <Ionicons name={icon as any} size={14} color={statusColor} />
        </View>
        <Text style={[cg.title, { color: C.textPrimary }]}>{category}</Text>
        <Text style={[cg.count, { color: statusColor }]}>{done}/{items.length}</Text>
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color={C.textMuted} />
      </Pressable>
      {!collapsed ? items.map(item => (
        <Pressable key={item.id} style={[cg.item, { borderTopColor: C.border }]} onPress={() => onToggle(item.id)}>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={cg.itemRow}>
              {item.critical ? (
                <View style={[cg.critBadge, { backgroundColor: '#EF444414', borderColor: '#EF444433' }]}>
                  <Text style={cg.critText}>CRITICAL</Text>
                </View>
              ) : null}
              <PlatformPill platform={item.platform} C={C} />
              <Text style={[cg.itemLabel, { color: item.checked ? C.textMuted : C.textPrimary }, item.checked ? cg.itemDone : null]} numberOfLines={2}>
                {item.label}
              </Text>
            </View>
            <Text style={[cg.desc, { color: C.textMuted }]}>{item.description}</Text>
          </View>
          <Switch
            value={item.checked}
            onValueChange={() => onToggle(item.id)}
            trackColor={{ false: C.border, true: `${C.primary}55` }}
            thumbColor={item.checked ? C.primary : C.textMuted}
          />
        </Pressable>
      )) : null}
    </View>
  );
}

const cg = StyleSheet.create({
  wrap: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  iconWrap: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 14, fontWeight: FONTS.bold },
  count: { fontSize: 13, fontWeight: FONTS.extraBold },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 },
  itemLabel: { fontSize: 13, fontWeight: FONTS.semiBold, flex: 1 },
  itemDone: { textDecorationLine: 'line-through', opacity: 0.5 },
  desc: { fontSize: 11, lineHeight: 16 },
  critBadge: { borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  critText: { fontSize: 8, fontWeight: FONTS.extraBold, color: '#EF4444', letterSpacing: 0.3 },
});

export default function DeploymentChecklistScreen() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<CheckItem[]>(INITIAL_ITEMS);

  useEffect(() => {
    AsyncStorage.getItem(CHECKLIST_KEY).then(raw => {
      if (!raw) return;
      const saved: Record<string, boolean> = JSON.parse(raw);
      setItems(prev => prev.map(item => ({ ...item, checked: saved[item.id] ?? item.checked })));
    }).catch(() => {});
  }, []);

  const toggle = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item);
      const saved: Record<string, boolean> = {};
      next.forEach(i => { saved[i.id] = i.checked; });
      AsyncStorage.setItem(CHECKLIST_KEY, JSON.stringify(saved)).catch(() => {});
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    // Use INITIAL_ITEMS checked state as the canonical source of truth for pre-verified items
    const reset = INITIAL_ITEMS.map(i => ({ ...i, checked: i.checked }));
    setItems(reset);
    const saved: Record<string, boolean> = {};
    reset.forEach(i => { saved[i.id] = i.checked; });
    AsyncStorage.setItem(CHECKLIST_KEY, JSON.stringify(saved)).catch(() => {});
  }, []);

  const total = items.length;
  const done = items.filter(i => i.checked).length;
  const criticalTotal = items.filter(i => i.critical).length;
  const criticalDone = items.filter(i => i.critical && i.checked).length;
  const criticalFailed = criticalTotal - criticalDone;
  const pct = Math.round((done / total) * 100);
  const readyColor = criticalFailed === 0 && done === total ? '#22C55E' : criticalFailed > 0 ? '#EF4444' : '#F59E0B';

  const categories = [...new Set(items.map(i => i.category))];

  // Platform filter
  const [platformFilter, setPlatformFilter] = useState<'all' | 'android' | 'ios' | 'web'>('all');

  const filteredItems = (cat: string) => {
    const catItems = items.filter(i => i.category === cat);
    if (platformFilter === 'all') return catItems;
    return catItems.filter(i => !i.platform || i.platform === 'all' || i.platform === platformFilter);
  };

  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: C.surface }}>
        <View style={[s.header, { backgroundColor: C.surface, borderBottomColor: C.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </Pressable>
          <Text style={[s.title, { color: C.textPrimary }]}>Deployment Checklist</Text>
          <Pressable onPress={resetAll} hitSlop={8}>
            <Ionicons name="refresh-outline" size={20} color={C.textMuted} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Progress */}
        <View style={[s.progress, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={[s.progressTitle, { color: C.textPrimary }]}>Release Readiness</Text>
            <View style={[s.progressBar, { backgroundColor: C.border }]}>
              <View style={[s.progressFill, { width: `${pct}%` as any, backgroundColor: readyColor }]} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[s.progressSub, { color: C.textMuted }]}>{done}/{total} tasks complete</Text>
              <Text style={[s.progressSub, { color: criticalFailed > 0 ? '#EF4444' : '#22C55E' }]}>
                {criticalFailed > 0 ? `${criticalFailed} critical blocking` : `${criticalDone}/${criticalTotal} critical ✓`}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={[s.pct, { color: readyColor }]}>{pct}%</Text>
            {criticalFailed > 0 ? (
              <Text style={[s.statusLabel, { color: '#EF4444' }]}>BLOCKED</Text>
            ) : done === total ? (
              <Text style={[s.statusLabel, { color: '#22C55E' }]}>READY 🚀</Text>
            ) : (
              <Text style={[s.statusLabel, { color: '#F59E0B' }]}>IN PROGRESS</Text>
            )}
          </View>
        </View>

        {/* Platform Filter */}
        <View style={s.filterRow}>
          {(['all', 'android', 'ios', 'web'] as const).map(p => {
            const labels = { all: '🌍 All', android: '🤖 Android', ios: '🍎 iOS', web: '🌐 Web' };
            const colors2 = { all: C.primary, android: '#22C55E', ios: '#A78BFA', web: '#38BDF8' };
            const isActive = platformFilter === p;
            return (
              <Pressable key={p} style={[s.filterBtn, { borderColor: isActive ? colors2[p] : C.border, backgroundColor: isActive ? `${colors2[p]}18` : C.surface }]} onPress={() => setPlatformFilter(p)}>
                <Text style={[s.filterLabel, { color: isActive ? colors2[p] : C.textMuted }]}>{labels[p]}</Text>
              </Pressable>
            );
          })}
        </View>

        {categories.map(cat => {
          const filtered = filteredItems(cat);
          if (filtered.length === 0) return null;
          return (
            <CategoryGroup key={cat} category={cat} items={filtered} onToggle={toggle} C={C} />
          );
        })}

        {/* Deploy Commands Reference */}
        <View style={[s.cmdBox, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Ionicons name="terminal-outline" size={14} color={C.primary} />
            <Text style={{ fontSize: 13, fontWeight: FONTS.bold, color: C.textPrimary }}>Key Deploy Commands</Text>
          </View>
          {[
            { label: 'EAS Project Info', cmd: 'eas project:info' },
            { label: 'List secrets', cmd: 'eas secret:list' },
            { label: 'Android production AAB', cmd: 'eas build --platform android --profile production' },
            { label: 'iOS production IPA', cmd: 'eas build --platform ios --profile production' },
            { label: 'Android APK (sideload)', cmd: 'eas build --platform android --profile production-apk' },
            { label: 'Submit Android', cmd: 'eas submit --platform android --profile production' },
            { label: 'Submit iOS', cmd: 'eas submit --platform ios --profile production' },
            { label: 'Web export', cmd: 'npx expo export --platform web' },
            { label: 'Android credentials', cmd: 'eas credentials --platform android' },
          ].map(({ label, cmd }) => (
            <View key={cmd} style={[s.cmdRow, { borderBottomColor: C.border }]}>
              <Text style={[s.cmdLabel, { color: C.textMuted }]}>{label}</Text>
              <View style={[s.cmdPill, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[s.cmdText, { color: C.primary }]}>{cmd}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: 13, borderBottomWidth: 1 },
  title: { fontSize: 17, fontWeight: FONTS.bold },
  scroll: { padding: SPACING.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: RADIUS.xl, borderWidth: 1, padding: 16, marginBottom: 12 },
  progressTitle: { fontSize: 14, fontWeight: FONTS.bold },
  progressBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressSub: { fontSize: 11 },
  pct: { fontSize: 28, fontWeight: FONTS.extraBold },
  statusLabel: { fontSize: 10, fontWeight: FONTS.bold, letterSpacing: 0.4 },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  filterBtn: { flex: 1, alignItems: 'center', borderRadius: RADIUS.full, borderWidth: 1, paddingVertical: 7 },
  filterLabel: { fontSize: 10, fontWeight: FONTS.bold },
  cmdBox: { borderRadius: RADIUS.xl, borderWidth: 1, padding: 14, marginTop: 4 },
  cmdRow: { paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  cmdLabel: { fontSize: 10, fontWeight: FONTS.semiBold },
  cmdPill: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  cmdText: { fontSize: 10, fontFamily: 'monospace' },
});
