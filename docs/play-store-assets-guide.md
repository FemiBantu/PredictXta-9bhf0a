# PredictXta Play Store & App Store Submission Guide

Updated: 2026-09-08 (Phase 2 — corrected to canonical bundle IDs)

---

## Canonical Application Identifiers

| Platform | Bundle / Package ID     |
|----------|------------------------|
| Android  | `com.predictxta.sports` |
| iOS      | `com.predictxta.sports` |

> ✅ Both platforms share the same package name.
> `com.predictxta.app` is reserved as the **Apple Service ID** for Sign In
> with Apple web/Android OAuth only — not the iOS Bundle ID.

---

## Pre-Submission Checklist

### 1. Firebase & Push Notifications

- [ ] Real `google-services.json` (package: `com.predictxta.sports`) from Firebase Console
- [ ] Real `GoogleService-Info.plist` (bundle ID: `com.predictxta.sports`) from Firebase Console
- [ ] `FIREBASE_SERVER_KEY` and other secrets set in Supabase secrets vault
- [ ] Production SHA-1 fingerprint added to Firebase Android app
- [ ] APNs Auth Key (.p8) uploaded to Firebase project (iOS push)

### 2. EAS Project Configuration

```bash
eas login
eas project:info           # Confirm projectId = 9c9238ac-123c-4ff5-966d-b3a036b0d66a
eas secret:list            # Verify GOOGLE_SERVICES_JSON, GOOGLE_SERVICES_PLIST set
```

### 3. Google Sign-In Configuration

```bash
eas credentials --platform android     # Copy SHA-1 → register in Google Cloud + Firebase
```

---

## Android / Play Store

### Build Commands

```bash
eas build --platform android --profile development       # Debug APK
eas build --platform android --profile preview           # Preview APK
eas build --platform android --profile production        # Production AAB (Play Store)
eas build --platform android --profile production-apk    # Production APK (sideload)
```

### Play Store Submission Steps

#### 1. Create Play Console Entry
1. [play.google.com/console](https://play.google.com/console) → Create app
2. App name: **PredictXta - AI Sports Predictions**
3. Package: `com.predictxta.sports` (cannot be changed after first upload)
4. Language: English (US), Type: App, Free

#### 2. Store Listing

**Short description (80 chars):**
```
AI sports predictions, live scores & expert tips for 13 sports
```

**Full description:**
```
PredictXta delivers AI-powered sports predictions using a 4-model ensemble
(GPT, Gemini, Claude, LLaMA) with calibrated confidence scores.

🤖 AI PREDICTIONS
• 4-model consensus predictions with explainable confidence
• Sport-specific intelligence (xG, Elo, form, H2H)

⚽ 13 SPORTS COVERED
Football • Basketball • Tennis • Cricket • Baseball • Ice Hockey •
Rugby • American Football • MMA/UFC • Volleyball • Handball • Esports

📊 LIVE DATA
• Live scores updated every 15 seconds
• League standings across 500+ competitions

👑 EXPERT TIPSTERS
• Verified expert prediction system with performance tracking

🎮 GAMIFICATION
• Daily Challenge — pick 3 matches, earn coins
• Global leaderboard

💬 FAN COMMUNITY
• Sport-specific chat rooms with live reaction

⚠️ DISCLAIMER: For entertainment purposes only. Not betting advice.

Available in 11 languages.
```

#### 3. Graphics Assets

| Asset | File | Notes |
|-------|------|-------|
| Feature Graphic (1024×500) | `assets/play-store-feature-graphic.png` | Upload to Play Console |
| App Icon (512×512) | `assets/logo.png` | No alpha channel required |
| Screenshots | `assets/screenshots/` | Minimum 2, maximum 8 |

#### 4. Data Safety Form

| Data type | Collected | Shared | Purpose |
|-----------|-----------|--------|---------|
| Email address | Yes | No | Authentication |
| User ID | Yes | No | App functionality |
| Push token | Yes | No | Notifications |
| App interactions | Yes | No | Analytics |

- Data deletion: available in-app via Profile → Delete Account
- Data encrypted in transit: Yes (TLS 1.3)

#### 5. Content Rating (IARC)

- Simulated Gambling: **YES** (sports prediction with odds display)
- All other categories: **None**
- Expected rating: **17+**

#### 6. Google Cloud Console — OAuth Clients

- Android Client → Package: `com.predictxta.sports`
- iOS Client → Bundle ID: `com.predictxta.sports`
- Web Client → Redirect URI: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

---

## iOS / App Store

### Build Commands

```bash
eas build --platform ios --profile production           # IPA for App Store
eas submit --platform ios --profile production          # Submit to App Store Connect
```

### Apple Developer Prerequisites

1. **Apple Developer Account** — $99/year at developer.apple.com
2. **App ID**: `com.predictxta.sports` — Capabilities: Sign In with Apple ✓, Push Notifications ✓
3. **Service ID**: `com.predictxta.app` — for Sign In with Apple web/Android OAuth only
4. **APNs Key** (.p8) — upload to Firebase → Cloud Messaging

### App Store Connect Setup

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → My Apps → + → New App
2. Bundle ID: `com.predictxta.sports`
3. SKU: `predictxta-ios-001` (matches eas.json)
4. Name: **PredictXta - AI Sports Predictions**

### Screenshot Requirements

| Size | Dimensions | Required |
|------|-----------|---------|
| iPhone 6.7" | 1290×2796 | ✅ Required |
| iPhone 6.5" | 1242×2688 | ✅ Required |
| iPhone 5.5" | 1242×2208 | Recommended |
| iPad Pro 12.9" | 2048×2732 | Recommended |

### Age Rating
- Simulated Gambling: **Infrequent/Mild** (expected 17+)

### EAS Submit Credentials

```bash
eas secret:create --name APPLE_ID                 --value your@email.com
eas secret:create --name APP_STORE_CONNECT_APP_ID --value 1234567890
eas secret:create --name APPLE_TEAM_ID            --value ABCD1234EF
```

---

## Required EAS Secrets

```bash
eas secret:create --name GOOGLE_SERVICES_JSON  --value @./google-services.json   --type file
eas secret:create --name GOOGLE_SERVICES_PLIST --value @./GoogleService-Info.plist --type file
eas secret:create --name APPLE_ID              --value your@email.com
eas secret:create --name APP_STORE_CONNECT_APP_ID --value 1234567890
eas secret:create --name APPLE_TEAM_ID         --value ABCD1234EF
```

---

## Key Deploy Commands

```bash
eas project:info
eas secret:list
eas credentials --platform android                # Get SHA-1
eas build --platform android --profile production  # AAB
eas build --platform android --profile production-apk  # APK
eas build --platform ios     --profile production  # IPA
eas submit --platform android --profile production
eas submit --platform ios     --profile production
npx expo export --platform web
```

---

## Support
- Privacy Policy: https://predictxta.app/privacy
- Terms: https://predictxta.app/terms
- Contact: support@predictxta.app
