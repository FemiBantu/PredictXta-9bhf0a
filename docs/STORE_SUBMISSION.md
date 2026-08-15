# PredictXta — App Store & Play Store Submission Guide

## 📸 Generated Screenshots

All marketing screenshots are in `assets/screenshots/`. Use these as reference or upload directly.

| File | Screen | Use For |
|------|--------|---------|
| `screenshot-01-home.png` | Home Dashboard — AI picks & live hero | iOS 6.5", 6.7" / Android Phone |
| `screenshot-02-live.png` | Live Scores — SSE real-time stream | iOS 6.5", 6.7" / Android Phone |
| `screenshot-03-predictions.png` | AI Predictions — confidence analysis | iOS 6.5", 6.7" / Android Phone |
| `screenshot-04-sports.png` | 21+ Sports — sport navigation | iOS 6.5", 6.7" / Android Phone |
| `screenshot-05-vip.png` | VIP Premium — expert tips & coins | iOS 6.5", 6.7" / Android Phone |
| `../og-image.png` | Social / OG image | Web, Twitter, FB cards |
| `../play-store-feature-graphic.png` | Play Store Feature Graphic | Google Play 1024×500 |

> **For actual App Store submissions**, screenshots must be taken on a real device or simulator at exact required resolutions. Use the generated images as visual templates.

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

## ⚠️ Pre-Submission Checklist

### 1. Fill In Placeholder Values

**`app.json`** — Replace both occurrences of `YOUR_EAS_PROJECT_ID`:
```json
"url": "https://u.expo.dev/YOUR_EAS_PROJECT_ID"
"projectId": "YOUR_EAS_PROJECT_ID"
```
Get your project ID from: [expo.dev](https://expo.dev) → Your Project → Settings

**`eas.json`** — Fill in your Apple credentials:
```json
"appleId": "YOUR_APPLE_ID@email.com",
"ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
"appleTeamId": "YOUR_APPLE_TEAM_ID"
```
- `appleId` — Apple ID email used for App Store Connect
- `ascAppId` — Found in App Store Connect → App → General → Apple ID
- `appleTeamId` — Found at developer.apple.com → Membership

---

## 🍎 iOS App Store Submission

### Step 1: Create App in App Store Connect
1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. My Apps → **+** → New App
3. Platform: iOS
4. Name: **PredictXta**
5. Bundle ID: `com.predictxta.app`
6. Primary Language: English (UK) or English (US)

### Step 2: Fill App Information
```
Category: Sports (Primary), Entertainment (Secondary)
Age Rating: 17+ (due to gambling/sports betting analysis)
Price: Free
Privacy Policy URL: https://predictxta.app/privacy
Support URL: https://predictxta.app
```

### Step 3: App Description
```
PredictXta — AI Sports Predictions

Harness the power of a four-model AI ensemble to get expert-level predictions for 21+ sports. PredictXta combines OpenAI, Gemini, Claude and LLaMA consensus scoring to deliver the most accurate predictions available.

KEY FEATURES:
• 🧠 AI Predictions — 4-model consensus engine with 70-84% confidence accuracy
• ⚡ Live Scores — Real-time SSE streaming for all live matches
• 🏆 Daily Challenge — Pick 3 matches, earn coins, top the leaderboard
• 💎 VIP Expert Tips — Premium insider picks from verified expert tipsters
• 📊 21+ Sports — Football, Basketball, Tennis, Cricket, MMA, F1 and more
• 💬 Live Chat — Real-time fan rooms linked to every match
• 🔔 Score Alerts — Follow teams and get instant goal/score notifications
• 🌐 11 Languages — Full internationalization support

SPORTS COVERED:
Football, Basketball, Tennis, Cricket, Baseball, Ice Hockey, Rugby, American Football, MMA/UFC, Boxing, Volleyball, Handball, Formula 1, Table Tennis, Badminton, Esports, Darts, Snooker, Cycling, Athletics, AFL

DISCLAIMER: PredictXta is for entertainment and analysis purposes only. AI predictions are not guaranteed. Please gamble responsibly.
```

### Step 4: Keywords (100 chars max)
```
sports predictions,AI picks,football tips,live scores,betting analysis,soccer,basketball,tennis
```

### Step 5: Build & Upload
```bash
# Run EAS build for iOS production
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios --profile production
```

### Step 6: Review Information
- Export Compliance: No encryption beyond standard HTTPS
- Content Rights: Yes, app uses licensed sports data APIs
- Advertising Identifier: No

---

## 🤖 Google Play Store Submission

### Step 1: Create App in Play Console
1. Go to [play.google.com/console](https://play.google.com/console)
2. Create App
3. App name: **PredictXta — AI Sports Predictions**
4. Default language: English (US)
5. App or Game: **App**
6. Free or Paid: **Free**

### Step 2: Store Listing
```
Short Description (80 chars):
AI-powered sports predictions, live scores & expert picks for 21+ sports.

Full Description:
[Use same description as iOS above]

Category: Sports
Content Rating: Teen (13+) or Mature 17+
```

### Step 3: Required Assets
- Feature Graphic: `assets/play-store-feature-graphic.png` (1024×500)
- Screenshots: At least 2, max 8 per device type
- App Icon: `assets/logo.png` (512×512 required)

### Step 4: Build & Upload
```bash
# Build Android App Bundle (AAB) for Play Store
eas build --platform android --profile production

# Submit to Play Store (internal track → promote to production)
eas submit --platform android --profile production
```

### Step 5: Google Play Data Safety
Declare the following in Data Safety section:

| Data Type | Collected | Shared | Required |
|-----------|-----------|--------|----------|
| Email address | Yes | No | Yes (auth) |
| User IDs | Yes | No | Yes (auth) |
| Push tokens | Yes | No | Yes (notifications) |
| App interactions | Yes | No | Yes (analytics) |

Privacy policy: https://predictxta.app/privacy

---

## 🌐 Web (PWA) Deployment

### Deploy via OnSpace
1. Click **Publish** button (top-right)
2. Select Web deployment
3. Domain: predictxta.app (configure custom domain in settings)

### Verify PWA Compliance
Run Lighthouse audit after deployment:
- Performance: target 90+
- Accessibility: target 90+
- PWA: target 100 (manifest ✅, HTTPS ✅, SW needed)

### Web Meta Tags (already configured in `web/index.html`)
- ✅ Open Graph image: `/og-image.png` (1200×630)
- ✅ Twitter Card: `summary_large_image`
- ✅ JSON-LD structured data
- ✅ Apple touch icons
- ✅ PWA manifest with 4 icon entries
- ✅ Theme color `#070B14`

### SEO
- ✅ `web/robots.txt` — allows crawling, blocks /admin
- ✅ `web/sitemap.xml` — 15 public URLs with priorities

---

## 🔐 Required Secrets (EAS)

Add these to your EAS project secrets at expo.dev → Project → Secrets:

| Secret Name | Description |
|-------------|-------------|
| `GOOGLE_SERVICES_JSON` | Contents of `google-services.json` (Android) |
| `GOOGLE_SERVICES_PLIST` | Contents of `GoogleService-Info.plist` (iOS) |
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase/OnSpace backend URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase/OnSpace anon key |

---

## 📋 Final Deployment Checklist

### Configuration
- [ ] Replace `YOUR_EAS_PROJECT_ID` in `app.json` (2 places)
- [ ] Fill Apple credentials in `eas.json` submit section
- [ ] Create `google-service-account.json` for Play Store submit
- [ ] Add EAS secrets (GOOGLE_SERVICES_JSON, GOOGLE_SERVICES_PLIST)

### iOS
- [ ] Apple Developer account active ($99/yr)
- [ ] App created in App Store Connect
- [ ] Bundle ID `com.predictxta.app` registered
- [ ] Certificates & provisioning profiles configured via EAS
- [ ] Screenshots uploaded (6.7" required)
- [ ] Privacy Policy URL active
- [ ] Build submitted and approved

### Android
- [ ] Google Play developer account active ($25 one-time)
- [ ] App created in Play Console
- [ ] Store listing complete (description, screenshots, feature graphic)
- [ ] Data Safety form filled
- [ ] Content rating questionnaire completed
- [ ] AAB uploaded to Internal Testing → promote to Production

### Web
- [ ] Custom domain configured (predictxta.app)
- [ ] HTTPS enforced
- [ ] OG image accessible at https://predictxta.app/og-image.png
- [ ] Sitemap submitted to Google Search Console

---

## 📞 Support

- Support URL: https://predictxta.app
- Privacy Policy: https://predictxta.app/privacy
- Terms: https://predictxta.app/terms
- Contact: support@predictxta.app
