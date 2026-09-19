# ⚠️ HISTORICAL ONLY — See docs/PRODUCTION_SOURCE_OF_TRUTH.md

> **Bundle IDs and deep-link scheme in this document are correct and match the canonical values.  
> All version numbers (SDK, RN) are historical; canonical values are in `docs/PRODUCTION_SOURCE_OF_TRUTH.md §7`.**

---

# PredictXta — Phase 2 Native Production Hardening Report

Generated: 2026-09-08

---

## 1. NATIVE CONFIGURATION AUDIT

### Application Identities

| Platform | Identifier              | Status  |
|----------|------------------------|---------|
| Android  | `com.predictxta.sports` | ✅ Correct |
| iOS      | `com.predictxta.sports` | ✅ Correct |

> **Apple Service ID** `com.predictxta.app` is a *separate* Apple Developer
> identifier used only for Sign In with Apple on web/Android OAuth. It is NOT
> the iOS Bundle ID. Both are required but serve different purposes.

### Stale `com.predictxta.app` References — All Corrected

| File | Old (Incorrect) | Correction |
|------|-----------------|------------|
| `docs/deep-link-audit.md` | iOS Bundle ID: `com.predictxta.app` | `com.predictxta.sports`; Apple Service ID documented separately |
| `docs/STORE_SUBMISSION.md` | `com.predictxta.app` for iOS App Store | `com.predictxta.sports` throughout |
| `docs/play-store-assets-guide.md` | `com.predictxta.app` bundle references | `com.predictxta.sports` |
| `docs/google-oauth-audit.md` | iOS Client Bundle ID: `com.predictxta.app` | `com.predictxta.sports` |
| `docs/google-oauth-setup.md` | iOS OAuth client: `com.predictxta.app` | `com.predictxta.sports` |
| `docs/google-oauth-e006-fix.md` | Android + iOS: `com.predictxta.app` | `com.predictxta.sports` |
| `services/appleAuthService.ts` | Comment conflated Bundle ID with Service ID | Clarified: Bundle ID `com.predictxta.sports`, Service ID `com.predictxta.app` are distinct |

Runtime code files (`app.json`, `eas.json`, `app/_layout.tsx`, `services/googleAuthService.ts`) were already correct and unchanged.

---

## 2. ANDROID RELEASE VALIDATION

### app.json Android Configuration (verified ✅)
```
package:              com.predictxta.sports
versionCode:          2
minSdkVersion:        24    (covers ~99% of active Android devices)
targetSdkVersion:     36    (Google Play API 36 — deadline Aug 31 2026 ✅)
compileSdkVersion:    36    ✅
edgeToEdgeEnabled:    true  (Android 15+ edge-to-edge content ✅)
allowBackup:          false (prevents adb backup of sensitive data ✅)
softwareKeyboardLayoutMode: pan  (keyboard inset handling ✅)
intentFilters:        7 entries (all OAuth + deep-link paths ✅)
permissions:          7 entries (see §4)
```

### Edge-to-Edge (Android 15+)
- `edgeToEdgeEnabled: true` ✅
- `useSafeAreaInsets()` used in all screens and tab layout ✅
- `softwareKeyboardLayoutMode: "pan"` handles keyboard insets ✅

### Build Command
```bash
eas build --platform android --profile production   # → .aab for Play Store
eas build --platform android --profile production-apk  # → .apk for sideloading
```

### Android Validation Checklist
- [ ] Production AAB build completes without errors
- [ ] `bundletool` inspection: `versionCode=2`, `compileSdkVersion=36`
- [ ] No crash on cold start (`adb logcat` clean)
- [ ] Google Play Console AAB upload: no policy violations
- [ ] OAuth deep link `predictxta://auth/callback` received after Google Sign-In
- [ ] Predictive back gesture works on Android 14+
- [ ] Edge-to-edge content renders correctly on Android 15

---

## 3. IOS RELEASE VALIDATION

### app.json iOS Configuration (verified ✅)
```
bundleIdentifier:   com.predictxta.sports   ✅
buildNumber:        "2"                     ✅
supportsTablet:     true                    ✅
usesAppleSignIn:    true                    ✅
aps-environment:    production              ✅ (required for push on device)
NSAllowsArbitraryLoads: false               ✅ (App Store requires false)
CFBundleURLSchemes: ["predictxta"]          ✅
CFBundleURLName:    "com.predictxta.sports" ✅
privacyManifests:   4 API types             ✅
```

### Build Command
```bash
eas build --platform ios --profile production   # → .ipa for App Store
```

### iOS Validation Checklist
- [ ] Production IPA build completes without errors
- [ ] Build appears in App Store Connect → TestFlight
- [ ] Apple Sign-In available on physical device
- [ ] Push notification received on physical device (APNs production cert)
- [ ] `aps-environment: production` entitlement present in signing
- [ ] `PrivacyInfo.xcprivacy` accepted by App Store review
- [ ] URL scheme `predictxta://` registered and opens app from Safari/Mail

---

## 4. PERMISSION MATRIX

### Android Permissions (app.json)

| Permission | Required By | Deferred |
|-----------|-------------|---------|
| `INTERNET` | All network calls | No (network baseline) |
| `ACCESS_NETWORK_STATE` | Offline detection | No (network baseline) |
| `RECEIVE_BOOT_COMPLETED` | FCM background delivery | No (system) |
| `VIBRATE` | Push notification haptics | No (system) |
| `CAMERA` | Profile photo capture | ✅ Yes — prompted on camera action |
| `READ_MEDIA_IMAGES` | Profile photo library (Android 13+) | ✅ Yes — prompted on gallery action |
| `POST_NOTIFICATIONS` | Push notifications (Android 13+) | ✅ Yes — prompted at appropriate time |

> ✅ No sensitive permissions requested on launch.

### iOS Permissions (infoPlist)

| Permission | Usage Description | Deferred |
|-----------|-------------------|---------|
| `NSCameraUsageDescription` | "Used to take profile photos" | ✅ Yes |
| `NSPhotoLibraryUsageDescription` | "Used to select profile photos" | ✅ Yes |
| Push Notifications | Requested at runtime via expo-notifications | ✅ Yes |

> ✅ No location, contacts, microphone, Bluetooth, or motion permissions requested.

---

## 5. APP ICON / SPLASH VALIDATION

| Asset | Configuration | Action Required |
|-------|--------------|-----------------|
| App icon | `assets/logo.png` | ⚠️ Verify: 1024×1024 px, PNG, **no alpha channel** |
| Android adaptive foreground | `assets/logo.png` | ✅ Configured |
| Android adaptive background | `#0A0F1E` (solid) | ✅ Configured |
| iOS icon | `assets/logo.png` | EAS generates all required sizes |
| Splash screen | `assets/logo.png` + `#070B14` | ✅ Configured |
| Web favicon | `assets/logo.png` | ✅ Configured |

> ⚠️ **Before App Store submission**: Verify logo has no alpha channel.
> ```bash
> # Check for alpha
> identify -verbose assets/logo.png | grep "Alpha"
> # Remove alpha if present
> convert assets/logo.png -background "#0A0F1E" -alpha remove assets/logo.png
> ```

---

## 6. DEEP-LINK VALIDATION

### Canonical URLs
- Scheme: `predictxta://`
- OAuth callback: `predictxta://auth/callback`
- Password reset: `predictxta://reset-password`

### Test Matrix

| Scenario | Expected Result |
|----------|-----------------|
| Cold launch — Google OAuth | Session established, redirected to tabs |
| Warm launch — Google OAuth | App foregrounds, session updated |
| Cold launch — Apple OAuth (iOS) | Native sheet → session established |
| Password reset link | App opens `/reset-password` screen |
| Notification tap — challenge | App opens `/challenge` |
| Notification tap — vip | App opens `/vip` |

---

## 7. SIGNING / CAPABILITY CHECKLIST

### Android
- [ ] EAS keystore generated on first build
- [ ] SHA-1: `eas credentials --platform android` → add to Google Cloud + Firebase
- [ ] `allowBackup: false` ✅

### iOS
- [ ] App ID `com.predictxta.sports`: Push Notifications ✓, Sign In with Apple ✓
- [ ] Service ID `com.predictxta.app`: for web/Android OAuth only
- [ ] APNs .p8 key uploaded to Firebase
- [ ] `aps-environment: production` ✅
- [ ] `usesAppleSignIn: true` ✅
- [ ] `PrivacyInfo.xcprivacy` complete ✅

---

## 8. PHASE 2 RELEASE GATE

**Configuration status: ✅ UNBLOCKED**

### Required before store submission

| Item | Status |
|------|--------|
| Firebase credentials (real google-services.json / .plist) | ⏳ Manual action |
| Apple Developer: App ID `com.predictxta.sports` with capabilities | ⏳ Manual action |
| Apple Developer: Service ID `com.predictxta.app` for OAuth | ⏳ Manual action |
| EAS secrets: `GOOGLE_SERVICES_JSON`, `GOOGLE_SERVICES_PLIST` | ⏳ Manual action |
| SHA-1 registration in Google Cloud + Firebase | ⏳ After first build |
| `assets/logo.png` — no alpha channel verified | ⏳ Verify locally |
| App Store Connect app entry created | ⏳ Manual action |
| Play Console store listing complete | ⏳ Manual action |

All code-level configurations are correct. Phase 2 gates on manual developer portal setup.

---

## 9. KEY COMMANDS

```bash
npx expo config --type public           # Validate app.json

# Builds
eas build --platform android --profile production
eas build --platform android --profile production-apk
eas build --platform ios     --profile production

# Credentials
eas credentials --platform android     # Extract SHA-1

# Submit
eas submit --platform android --profile production
eas submit --platform ios     --profile production

# Secrets
eas secret:list
eas secret:create --name GOOGLE_SERVICES_JSON  --value @./google-services.json   --type file
eas secret:create --name GOOGLE_SERVICES_PLIST --value @./GoogleService-Info.plist --type file
```
