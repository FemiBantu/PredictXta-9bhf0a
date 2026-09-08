# PredictXta — App Store & Play Store Submission Guide

Updated: 2026-09-08 (Phase 2 — corrected to canonical bundle IDs)

---

## 📸 Generated Screenshots

All marketing screenshots are in `assets/screenshots/`.

| File | Screen | Use For |
|------|--------|---------|
| `screenshot-01-home.png` | Home Dashboard — AI picks & live hero | iOS 6.5", 6.7" / Android Phone |
| `screenshot-02-live.png` | Live Scores — SSE real-time stream | iOS 6.5", 6.7" / Android Phone |
| `screenshot-03-predictions.png` | AI Predictions — confidence analysis | iOS 6.5", 6.7" / Android Phone |
| `screenshot-04-sports.png` | 13 Sports — sport navigation | iOS 6.5", 6.7" / Android Phone |
| `screenshot-05-vip.png` | VIP Premium — expert tips & coins | iOS 6.5", 6.7" / Android Phone |
| `../og-image.png` | Social / OG image | Web, Twitter, FB cards |
| `../play-store-feature-graphic.png` | Play Store Feature Graphic | Google Play 1024×500 |

> **For actual App Store submissions**, screenshots must be taken on a real device or simulator at exact required resolutions.

### Required iOS Screenshot Sizes
- **iPhone 6.7"** — 1290 × 2796 px (Required — iPhone 15 Pro Max)
- **iPhone 6.5"** — 1242 × 2688 px (Required — iPhone 11 Pro Max)
- **iPhone 5.5"** — 1242 × 2208 px (Recommended — iPhone 8 Plus)
- **iPad Pro 12.9"** — 2048 × 2732 px (Required if supporting iPad)

### Required Android Screenshot Sizes
- Min 320px, Max 3840px per side, 16:9 or 9:16 ratio
- At least 2 screenshots required
- Feature Graphic: 1024 × 500 px (existing: `assets/play-store-feature-graphic.png`)

---

## ⚠️ Application Identifiers (Canonical)

| Platform | Bundle / Package ID     |
|----------|------------------------|
| Android  | `com.predictxta.sports` |
| iOS      | `com.predictxta.sports` |

> ✅ Both platforms share the same identifier. An earlier version of this guide
> listed `com.predictxta.app` as the iOS bundle ID — that was incorrect.
> `com.predictxta.app` is reserved as the **Apple Service ID** for Sign In with
> Apple on web/Android OAuth only (separate from the iOS Bundle ID).

---

## Pre-Submission Checklist

### EAS Project
**`app.json`** — EAS project ID already configured:
```json
"url": "https://u.expo.dev/9c9238ac-123c-4ff5-966d-b3a036b0d66a"
"projectId": "9c9238ac-123c-4ff5-966d-b3a036b0d66a"
```

**`eas.json`** — Fill in your Apple credentials:
```json
"appleId": "$APPLE_ID",
"ascAppId": "$APP_STORE_CONNECT_APP_ID",
"appleTeamId": "$APPLE_TEAM_ID"
```
Set via EAS secrets:
```bash
eas secret:create --scope project --name APPLE_ID --value your@email.com
eas secret:create --scope project --name APP_STORE_CONNECT_APP_ID --value 1234567890
eas secret:create --scope project --name APPLE_TEAM_ID --value ABCD1234EF
```

---

## 🍎 iOS App Store Submission

### Step 1: Create App in App Store Connect
1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. My Apps → **+** → New App
3. Platform: iOS
4. Name: **PredictXta**
5. Bundle ID: `com.predictxta.sports` ← **this is the canonical iOS bundle ID**
6. Primary Language: English (UK) or English (US)

### Step 2: Apple Developer — Identifier Setup
1. developer.apple.com → Identifiers
2. Create App ID: `com.predictxta.sports`
   - Capabilities: ✅ Push Notifications, ✅ Sign In with Apple
3. Create Service ID: `com.predictxta.app` (for Sign In with Apple web/Android OAuth only)
   - Domain: `osmkbrryalhtpnayosmk.backend.onspace.ai`
   - Return URL: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`

### Step 3: Fill App Information
```
Category: Sports (Primary), Entertainment (Secondary)
Age Rating: 17+ (simulated gambling content)
Price: Free
Privacy Policy URL: https://predictxta.app/privacy
Support URL: https://predictxta.app
```

### Step 4: App Description
```
PredictXta — AI Sports Predictions

Harness the power of a four-model AI ensemble to get expert-level predictions
for 13 sports. PredictXta combines OpenAI, Gemini, Claude and LLaMA consensus
scoring to deliver accurate, explainable predictions.

KEY FEATURES:
• 🧠 AI Predictions — 4-model consensus engine with calibrated confidence
• ⚡ Live Scores — Real-time streaming for all live matches
• 🏆 Daily Challenge — Pick 3 matches, earn coins, top the leaderboard
• 💎 VIP Expert Tips — Premium picks from verified expert tipsters
• 📊 13 Sports — Football, Basketball, Tennis, Cricket, MMA and more
• 💬 Live Chat — Real-time fan rooms linked to every match
• 🔔 Score Alerts — Follow teams and get instant goal notifications
• 🌐 11 Languages — Full internationalization support

DISCLAIMER: PredictXta is for entertainment and analysis purposes only.
AI predictions are not guaranteed. Please gamble responsibly.
```

### Step 5: Build & Upload
```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

### Step 6: Capabilities Checklist
- [ ] Push Notifications capability enabled on `com.predictxta.sports`
- [ ] Sign In with Apple capability enabled on `com.predictxta.sports`
- [ ] APNs key (.p8) uploaded to Firebase → Project Settings → Cloud Messaging
- [ ] PrivacyInfo.xcprivacy included (iOS/PrivacyInfo.xcprivacy) ✅

---

## 🤖 Google Play Store Submission

### Step 1: Create App in Play Console
1. Go to [play.google.com/console](https://play.google.com/console)
2. Create App
3. App name: **PredictXta — AI Sports Predictions**
4. Package: `com.predictxta.sports` (cannot be changed after first upload)
5. Default language: English (US)

### Step 2: Store Listing
```
Short Description (80 chars):
AI sports predictions, live scores & expert picks for 13 sports.

Category: Sports
Content Rating: 17+ (simulated gambling)
```

### Step 3: Google Cloud Console — OAuth Clients
- **Web Client** → Authorized redirect URI: `https://osmkbrryalhtpnayosmk.backend.onspace.ai/auth/v1/callback`
- **Android Client** → Package: `com.predictxta.sports`, SHA-1: `eas credentials --platform android`
- **iOS Client** → Bundle ID: `com.predictxta.sports`

### Step 4: Required Assets
- Feature Graphic: `assets/play-store-feature-graphic.png` (1024×500)
- App Icon: `assets/logo.png` (512×512 required, no alpha channel)
- Screenshots: minimum 2, maximum 8

### Step 5: Build & Upload
```bash
eas build --platform android --profile production
eas submit --platform android --profile production
```

### Step 6: Data Safety
| Data Type | Collected | Shared | Required |
|-----------|-----------|--------|----------|
| Email address | Yes | No | Yes (auth) |
| User IDs | Yes | No | Yes (auth) |
| Push tokens | Yes | No | Yes (notifications) |
| App interactions | Yes | No | Yes (analytics) |

Privacy policy: https://predictxta.app/privacy

---

## 🔐 Required Secrets (EAS)

```bash
# Firebase credentials (injected during EAS build)
eas secret:create --name GOOGLE_SERVICES_JSON  --value @./google-services.json   --type file
eas secret:create --name GOOGLE_SERVICES_PLIST --value @./GoogleService-Info.plist --type file

# Apple submission credentials
eas secret:create --name APPLE_ID                    --value your@email.com
eas secret:create --name APP_STORE_CONNECT_APP_ID    --value 1234567890
eas secret:create --name APPLE_TEAM_ID               --value ABCD1234EF
```

---

## Key Deploy Commands

```bash
eas project:info
eas secret:list
eas credentials --platform android        # Get SHA-1 for Google Cloud Console

# Builds
eas build --platform android --profile production   # AAB for Play Store
eas build --platform ios     --profile production   # IPA for App Store
eas build --platform android --profile production-apk  # APK for sideloading

# Submit
eas submit --platform android --profile production
eas submit --platform ios     --profile production

# Web export
npx expo export --platform web
```

---

## 🌐 Web (PWA) Deployment

Verify after deployment:
- ✅ OG image accessible at `https://predictxta.app/og-image.png`
- ✅ Privacy policy at `https://predictxta.app/privacy`
- ✅ Terms at `https://predictxta.app/terms`
- ✅ Sitemap submitted to Google Search Console
- ✅ HTTPS enforced

---

## Support
- Support URL: https://predictxta.app
- Privacy Policy: https://predictxta.app/privacy
- Terms: https://predictxta.app/terms
- Contact: support@predictxta.app
