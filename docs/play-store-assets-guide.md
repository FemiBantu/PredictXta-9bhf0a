# PredictXta Play Store & App Store Submission Guide

## Pre-Submission Checklist

### 1. Firebase & Push Notifications

**See `docs/FIREBASE_SETUP.md` for full Firebase setup.**

Quick checklist:
- [ ] Real `google-services.json` in project root (from Firebase Console)
- [ ] Real `GoogleService-Info.plist` in project root (from Firebase Console)
- [ ] `FIREBASE_SERVER_KEY` set in Supabase secrets
- [ ] Production SHA-1 fingerprint added to Firebase Android app
- [ ] APNs Auth Key uploaded to Firebase project (for iOS push)

### 2. EAS Project Configuration

```bash
# 1. Login to EAS
eas login

# 2. Get your real project ID
eas project:info
# Copy the UUID from the output

# 3. Update app.json and eas.json with the real UUID:
#    app.json → extra.eas.projectId
#    app.json → updates.url  (replace YOUR_EAS_PROJECT_ID)
#    eas.json → no change needed (references app.json)
```

### 3. Google Sign-In Configuration

After EAS build generates production keystore:

```bash
# Get production SHA-1
eas credentials --platform android
# Copy the "SHA-1 certificate fingerprint"
# Add it to Firebase Console → Project Settings → Android app → SHA certificate fingerprints
# Also add to Google Cloud Console → OAuth 2.0 Client → Android client → SHA-1
```

---

## Android / Play Store

### Build Commands

```bash
# Debug APK (for testing)
eas build --platform android --profile development

# Preview APK (for internal distribution)
eas build --platform android --profile preview

# Production AAB (for Play Store)
eas build --platform android --profile production

# Production APK (for direct download)
eas build --platform android --profile production-apk
```

### Play Store Submission Steps

#### 1. Create Play Console Entry
1. Go to [play.google.com/console](https://play.google.com/console)
2. Click **Create app**
3. App name: **PredictXta - AI Sports Predictions**
4. Default language: **English (United States)**
5. App type: **App**
6. Free or paid: **Free**
7. Accept policies → Create app

#### 2. Store Listing

**Short description (80 chars max):**
```
AI-powered sports predictions, live scores & expert tips for 21+ sports
```

**Full description (4000 chars max):**
```
PredictXta delivers AI-powered sports predictions using a 4-model ensemble 
(GPT, Gemini, Claude, LLaMA) with 85%+ accuracy across 21+ sports.

🤖 AI PREDICTIONS
• 4-model consensus predictions with confidence scores
• Real-time AI analysis with confidence drivers
• Sport-specific intelligence (xG, Elo, form, H2H)
• Pre-match intelligence hub for every fixture

⚽ 21+ SPORTS COVERED
Football • Basketball • Tennis • Baseball • Ice Hockey • Rugby • 
American Football • Cricket • MMA/UFC • Volleyball • Handball • 
Table Tennis • Badminton • Darts • Snooker • Golf • Boxing • Cycling

📊 LIVE DATA
• Live scores updated every 12 seconds
• In-play match events and statistics
• League standings across 500+ competitions

👑 EXPERT TIPSTERS
• Verified expert prediction system
• Performance tracking & accuracy ratings
• Daily expert slip submissions

🎮 GAMIFICATION
• Daily Challenge — pick 3 matches, earn coins
• Global leaderboard — compete with fans worldwide
• Earn coins for correct predictions

💬 FAN COMMUNITY
• Sport-specific chat rooms
• Match discussion with live reaction
• Real-time fan engagement

⚠️ DISCLAIMER: PredictXta provides AI-generated predictions for entertainment 
purposes only. Not financial or betting advice. Gamble responsibly.

Available in 11 languages: English, Spanish, French, Arabic, Hindi, 
Portuguese, German, Italian, Turkish, Chinese, Swahili
```

#### 3. Graphics Assets

**Feature Graphic (1024×500):**
- File: `assets/play-store-feature-graphic.png` ✅ Already generated
- Upload to: **Store listing → Graphic assets → Feature graphic**

**App Icon (512×512):**
- Use `assets/logo.png` at full resolution
- Must be PNG, no alpha channel required (Play Store adds rounded corners)

**Phone Screenshots (minimum 2, recommended 8):**
- Dimensions: 1080×1920 (portrait) or 1920×1080 (landscape)
- Use `ScreenshotFrame` component in dev mode to capture:
  1. AI Picks screen (home screen predictions)
  2. Live Scores screen
  3. Daily Challenge screen
  4. Expert Tips screen
  5. Match Detail with AI analysis
  6. Community Chat screen

**Tablet Screenshots (optional but recommended):**
- Dimensions: 1200×1920 minimum

#### 4. Data Safety Form

Go to **Policy → Data safety** and declare:

| Data type | Collected | Shared | Required |
|-----------|-----------|--------|----------|
| Email address | Yes | No | No (can delete) |
| User ID | Yes | No | Yes |
| Push token | Yes | No | No |
| Approximate location | No | — | — |
| Username | Yes | No | No |
| App interactions | Yes | No | No |

**Security practices:**
- [x] Data is encrypted in transit (TLS 1.3)
- [x] You provide a way for users to request that their data is deleted
- **Data deletion:** Available in app via Profile → Delete Account

**Deletion URL:** `predictxta.app/privacy` (add deletion instructions)

#### 5. Content Rating (IARC)

Answer the IARC questionnaire:
- Violence: **None**
- Sexual content: **None**
- Language: **None**
- Controlled substances: **None**
- Gambling: **YES — Simulated gambling** (sports prediction/odds display)

**Expected rating: PEGI 12 / TEEN (T)**

Note: If you show actual betting odds or link to betting sites → **17+ / MATURE**

#### 6. In-App Billing (VIP Subscriptions)

```bash
# 1. Create subscription products in Play Console:
#    Monetise → Products → Subscriptions

# Product IDs to create:
predictxta.vip.monthly    # £4.99/month
predictxta.vip.yearly     # £39.99/year (33% discount)

# 2. Update iapService.ts with real product IDs
# 3. Test with internal test track first
# 4. Add license testers in Play Console → Setup → License testing
```

---

## iOS / App Store

### Build Commands

```bash
# Development build
eas build --platform ios --profile development

# Production IPA
eas build --platform ios --profile production

# Submit to App Store Connect
eas submit --platform ios --profile production
```

### Apple Developer Prerequisites

1. **Apple Developer Account** — $99/year at developer.apple.com
2. **Bundle ID** registered: `com.predictxta.app`
3. Capabilities to enable:
   - Sign In with Apple ✅
   - Push Notifications ✅
   - In-App Purchase (for VIP)

### App Store Connect Setup

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. **My Apps → + → New App**
3. Platform: **iOS**
4. Name: **PredictXta - AI Sports Predictions**
5. Primary language: **English (U.S.)**
6. Bundle ID: `com.predictxta.app`
7. SKU: `predictxta-ios-v1`

### App Store Screenshots

Required sizes:
- iPhone 6.7" (1290×2796) — iPhone 15 Pro Max
- iPhone 6.5" (1242×2688) — iPhone 11 Pro Max
- iPad Pro 12.9" (2048×2732) — if tablet support

### Privacy Manifest (Required)

Create `ios/PrivacyInfo.xcprivacy`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeEmailAddress</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>
  </array>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
```

### APNs Configuration

1. Apple Developer → **Certificates, Identifiers & Profiles**
2. **Keys → + → Create new key**
3. Enable **Apple Push Notifications service (APNs)**
4. Download the `.p8` key file
5. Upload to Firebase Console → **Project Settings → Cloud Messaging → APNs Authentication Key**
6. Key ID and Team ID needed for Firebase

---

## OTA Updates (expo-updates)

After EAS build is created:

```bash
# Get your real project ID
eas project:info

# Update app.json:
# "updates": { "url": "https://u.expo.dev/YOUR_REAL_PROJECT_UUID" }

# Publish OTA update (no new build needed)
eas update --channel production --message "Bug fix: improved AI picks loading"
```

---

## Admin Dashboard & Paywall Testing

### Test VIP Paywall Flow

1. **Low Balance (<5 coins):**
   - Navigate to any match → AI Best 3 tab
   - Should show lock overlay with "Unlock with 5 coins" button
   - "Unlock" should show VIPUpgradeModal (insufficient funds)

2. **Sufficient Balance (≥5 coins):**
   - Navigate to match → AI Best 3 tab
   - "Unlock with 5 coins" should deduct 5 coins and reveal predictions

3. **VIP User:**
   - Should see predictions without lock overlay

### Test Admin Dashboard

1. Navigate to `/admin` (requires admin role in `admin_roles` table)
2. Check: Pipeline Monitor, Sync Controls, Data Integrity, Expert Management

---

## Quick Reference Commands

```bash
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Build for testing (APK)
eas build --platform android --profile preview --non-interactive

# Build for Play Store (AAB)
eas build --platform android --profile production

# Build for App Store (IPA)
eas build --platform ios --profile production

# Submit to Play Store
eas submit --platform android --profile production

# Submit to App Store
eas submit --platform ios --profile production

# Publish OTA update
eas update --channel production --message "Release notes here"

# Check build status
eas build:list

# View credentials
eas credentials --platform android
```
