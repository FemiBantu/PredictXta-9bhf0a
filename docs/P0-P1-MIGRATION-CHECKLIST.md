# PredictXta — P0/P1 Migration Checklist
# Authoritative pre-submission gate

> Cross-reference: `docs/PRODUCTION_SOURCE_OF_TRUTH.md`  
> Last updated: 2026-09-19

---

## STATUS LEGEND
- ✅ Complete (code-level — no manual action needed)
- ⚙️  Automated (CI enforces)
- ⏳ Manual action required (developer portal / secrets)
- ❌ Blocked (depends on package.json write access)

---

## P0 ITEMS — MUST ALL PASS BEFORE STORE SUBMISSION

### P0-1: Expo SDK Migration
| Sub-item | Status | Action |
|----------|--------|--------|
| `app.json` sdkVersion = 57.0.0 | ✅ Done | — |
| `app.json` newArchEnabled = true | ✅ Done | — |
| `app.json` targetSdkVersion = 36 | ✅ Done | — |
| `eas.json` all profiles use `"image": "latest"` | ✅ Done | — |
| `Dockerfile` uses Node 22, pnpm 10 | ✅ Done | — |
| CI validates SDK 57 + API 36 | ✅ Done | — |
| `package.json` runtime deps (expo@~57, RN 0.79) | ❌ Blocked | Run: `pnpm add expo@~57.0.0 react-native@0.79.2 react@19.0.0` then `pnpm install` |

**Manual command to unblock P0-1:**
```bash
# In project root — requires write access to package.json
pnpm add expo@~57.0.0 react-native@0.79.2 react@19.0.0
pnpm add -D @types/react@~19.0.0
# Add scripts block to package.json (manually edit):
#   "typecheck": "tsc --noEmit",
#   "lint": "eslint . --ext .ts,.tsx",
#   "prebuild": "expo prebuild --clean"
pnpm install
npx expo doctor
```

---

### P0-2: Lockfile Regeneration
| Sub-item | Status | Action |
|----------|--------|--------|
| pnpm-lock.yaml consistent with package.json | ❌ Blocked | Run `pnpm install` after P0-1 |
| CI uses `--frozen-lockfile` | ✅ Done | — |
| Dockerfile uses `--frozen-lockfile` | ✅ Done | — |

---

### P0-3: Real Native IAP
| Sub-item | Status | Action |
|----------|--------|--------|
| `babel.config.js` IAP shim scoped to web/SSR only | ✅ Done | — |
| `metro.config.js` IAP shim scoped to web/SSR only | ✅ Done | — |
| Native android/ios builds get real `react-native-iap` | ✅ Done | — |
| `react-native-iap` in package.json | ⏳ Verify | Run `pnpm ls react-native-iap` |
| IAP lazy `require()` with try/catch in `iapService.ts` | ✅ Done | — |

---

### P0-4: Apple/Google Purchase Verification
| Sub-item | Status | Action |
|----------|--------|--------|
| `verify-purchase` Edge Function implemented | ✅ Done | — |
| Apple App Store Server API (ES256 JWT) | ✅ Done | — |
| Google Play Developer API (RS256 OAuth2) | ✅ Done | — |
| Idempotency keys (user-scoped) | ✅ Done | — |
| `APPLE_ISSUER_ID` secret set in Supabase | ⏳ Manual | Supabase Dashboard → Secrets |
| `APPLE_KEY_ID` secret set in Supabase | ⏳ Manual | Supabase Dashboard → Secrets |
| `APPLE_PRIVATE_KEY` (.p8) set in Supabase | ⏳ Manual | Supabase Dashboard → Secrets |
| `APPLE_SHARED_SECRET` set in Supabase | ⏳ Manual | Supabase Dashboard → Secrets |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` set in Supabase | ⏳ Manual | Supabase Dashboard → Secrets |
| `GOOGLE_PLAY_PACKAGE_NAME` = com.predictxta.sports | ⏳ Manual | Supabase Dashboard → Secrets |
| Products created in App Store Connect | ⏳ Manual | See docs/phase4-iap-entitlements.md §5 |
| Products created in Google Play Console | ⏳ Manual | See docs/phase4-iap-entitlements.md §6 |
| Sandbox testers configured | ⏳ Manual | App Store Connect → Users & Access |
| License testers configured | ⏳ Manual | Play Console → Setup → License testing |

---

### P0-5: Firebase Credentials (Replace Placeholders)
| Sub-item | Status | Action |
|----------|--------|--------|
| `google-services.json` — placeholder detected | ⏳ Manual | See instructions below |
| `GoogleService-Info.plist` — placeholder detected | ⏳ Manual | See instructions below |
| Real credentials committed to EAS secrets | ⏳ Manual | `eas secret:create --type file` |
| SHA-1 fingerprint added to Firebase | ⏳ Manual | After first EAS build |

**Steps to replace Firebase placeholders:**
```bash
# 1. Firebase Console → console.firebase.google.com
# 2. Select project: predictxta-c6bcb
# 3. Project Settings → Your apps

# Android:
# → Click Android app (com.predictxta.sports)
# → Download google-services.json → overwrite project root file

# iOS:
# → Click iOS app (com.predictxta.sports)
# → Download GoogleService-Info.plist → overwrite project root file

# 4. Add APNs key for iOS push:
# Firebase → Project Settings → Cloud Messaging → iOS app configuration
# → Upload .p8 key from Apple Developer → Keys

# 5. Upload to EAS:
eas secret:create --name GOOGLE_SERVICES_JSON --value @./google-services.json --type file
eas secret:create --name GOOGLE_SERVICES_PLIST --value @./GoogleService-Info.plist --type file

# 6. After first EAS Android build, add SHA-1 to Firebase:
eas credentials --platform android  # copy SHA-1
# Firebase → Android app → Add fingerprint

# 7. Add real Firebase API keys to .env (local only, never commit):
# EXPO_PUBLIC_FIREBASE_API_KEY=...
# EXPO_PUBLIC_FIREBASE_PROJECT_ID=predictxta-c6bcb
# EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=409581654804
# EXPO_PUBLIC_FIREBASE_APP_ID=...
```

**Note:** `google-services.json` contains `project_number: 409581654804` and
`project_id: predictxta-c6bcb` which appear real. Only the OAuth client IDs,
API keys, and SHA-1 fingerprints are placeholder strings. Replace those values
with real values from Firebase Console before any EAS build.

---

### P0-6: Android AAB Production Build
| Sub-item | Status | Action |
|----------|--------|--------|
| EAS `production` profile targets AAB | ✅ Done | — |
| CI triggers EAS build on main branch push | ✅ Done | — |
| `EXPO_TOKEN` secret in GitHub | ⏳ Manual | GitHub → Settings → Secrets → Actions |
| `GOOGLE_SERVICES_JSON` secret in GitHub | ⏳ Manual | GitHub → Settings → Secrets → Actions |
| EAS build succeeds | ⏳ Pending | Requires P0-1 + P0-5 first |
| Play Console internal track upload | ⏳ Pending | After build succeeds |

```bash
# Trigger manually:
eas build --platform android --profile production
```

---

### P0-7: iOS IPA Production Build
| Sub-item | Status | Action |
|----------|--------|--------|
| EAS `production` profile configured for iOS | ✅ Done | — |
| Apple Developer account + App ID registered | ⏳ Manual | developer.apple.com |
| `APPLE_ID`, `APP_STORE_CONNECT_APP_ID`, `APPLE_TEAM_ID` EAS secrets | ⏳ Manual | `eas secret:create` |
| `GOOGLE_SERVICES_PLIST` EAS secret | ⏳ Manual | `eas secret:create --type file` |
| EAS build succeeds | ⏳ Pending | Requires P0-1 + P0-5 first |
| TestFlight upload | ⏳ Pending | `eas submit --platform ios --profile production` |

```bash
# Trigger manually:
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

---

## P1 ITEMS — MUST PASS BEFORE PUBLIC RELEASE

### P1-1: Bundle ID — Zero Contradictions
| Sub-item | Status |
|----------|--------|
| `app.json` android.package = com.predictxta.sports | ✅ |
| `app.json` ios.bundleIdentifier = com.predictxta.sports | ✅ |
| CI enforces both via Phase 2 gate | ✅ |
| CI scans for stale `com.predictxta.app` in runtime code | ✅ |
| All docs marked HISTORICAL ONLY with correct canonical values | ✅ |
| Apple Service ID `com.predictxta.app` documented as separate | ✅ |

---

### P1-2: Metro/Babel Shim Simplification
| Sub-item | Status |
|----------|--------|
| IAP/nitro shims scoped to web/SSR in `babel.config.js` | ✅ |
| IAP/nitro shims scoped to web/SSR in `metro.config.js` (resolveRequest) | ✅ |
| Native android/ios paths never shimmed for IAP/nitro | ✅ |
| `expo-video` shim: documented as OnSpace preview workaround | ✅ |
| Reanimated: real pnpm package served to native builds | ✅ |
| i18next/react-i18next: real pnpm packages preferred over shims | ✅ |
| All shim rationale documented in `docs/phase1-dependency-audit.md` | ✅ |

**Future simplification path** (after package.json write access + SDK 57 native build confirmed):
1. Test removing `expo-video` shim on EAS build → verify no crash
2. Test removing `expo-auth-session` shim → verify SSR works
3. Remove shims one by one in CI gate until only truly needed ones remain

---

### P1-3: Android Permissions — Minimal & Justified
| Permission | Justification | Deferred |
|-----------|--------------|---------|
| INTERNET | All network calls | No |
| ACCESS_NETWORK_STATE | Offline detection | No |
| RECEIVE_BOOT_COMPLETED | FCM background | No |
| VIBRATE | Push haptics | No |
| CAMERA | Profile photo | ✅ Yes — prompted on action |
| READ_MEDIA_IMAGES | Profile photo library | ✅ Yes — prompted on action |
| POST_NOTIFICATIONS | Push (Android 13+) | ✅ Yes — prompted at appropriate time |

Status: ✅ Minimal. No unnecessary permissions. All deferred where possible.

---

### P1-4: OAuth / Deep Links
| Sub-item | Status | Action |
|----------|--------|--------|
| Deep link scheme: `predictxta://` | ✅ Done | — |
| Android intentFilters cover all OAuth paths | ✅ Done | — |
| iOS CFBundleURLSchemes: `predictxta` | ✅ Done | — |
| `handleOAuthCallback` processes all deep link patterns | ✅ Done | — |
| `autoVerify: false` on Android intentFilters | ✅ Known limitation | Play Console App Links verification needed for production |
| Google OAuth redirect URI registered in Google Cloud Console | ⏳ Manual | Add `predictxta://auth` and `predictxta://auth/callback` |
| Supabase Auth Site URL = `predictxta://auth` | ⏳ Manual | Supabase Dashboard → Auth → URL Configuration |
| Supabase redirect URLs include all predictxta:// paths | ⏳ Manual | Supabase Dashboard → Auth → URL Configuration |

**Supabase Auth URL Configuration (required):**
```
Site URL: predictxta://auth
Redirect URLs:
  predictxta://auth
  predictxta://auth/callback
  predictxta://reset-password
  predictxta://account-deleted
```

---

### P1-5: Cloudflare / PWA
| Sub-item | Status | Action |
|----------|--------|--------|
| `web/manifest.json` present | ✅ Done | — |
| `web/robots.txt` present | ✅ Done | — |
| `web/sitemap.xml` present | ✅ Done | — |
| Cloudflare Worker `px-gateway.ts` auth validation | ✅ Done | — |
| Cloudflare Worker `sports-cache.ts` | ✅ Done | — |
| `wrangler.toml` configured | ✅ Done | — |
| `CLOUDFLARE_API_TOKEN` in GitHub secrets | ⏳ Manual | GitHub → Settings → Secrets |
| Cloudflare zone ID configured | ⏳ Manual | `CLOUDFLARE_ZONE_ID` secret |
| PWA meta tags (OG, twitter card) verified on predictxta.app | ⏳ Manual | After web deployment |
| HTTPS enforced on predictxta.app | ⏳ Manual | Cloudflare SSL → Full (strict) |

---

### P1-6: Privacy / Store Policies
| Sub-item | Status | Action |
|----------|--------|--------|
| Privacy policy page: `app/privacy.tsx` | ✅ Done | — |
| Terms page: `app/terms.tsx` | ✅ Done | — |
| Web privacy: `app/privacy-web.tsx` | ✅ Done | — |
| Privacy URL: https://predictxta.app/privacy | ⏳ Manual | Verify accessible after web deploy |
| Terms URL: https://predictxta.app/terms | ⏳ Manual | Verify accessible after web deploy |
| Disclaimer banner on AI picks screens | ✅ Done | — |
| App Store age rating: 17+ (simulated gambling) | ⏳ Manual | App Store Connect |
| Play Store content rating: 17+ | ⏳ Manual | Play Console |
| Play Store Data Safety form | ⏳ Manual | Play Console → Policy → App content |
| App Store privacy nutrition labels | ⏳ Manual | App Store Connect |

---

### P1-7: Deterministic CI/CD
| Sub-item | Status |
|----------|--------|
| CI uses `pnpm install --frozen-lockfile` | ✅ |
| CI validates SDK 57 + API 36 in app.json | ✅ |
| CI validates bundle IDs | ✅ |
| CI validates IAP product ID consistency | ✅ |
| CI scans for hardcoded secrets | ✅ |
| CI scans for Math.random() in prediction paths | ✅ |
| CI scans for removed sports | ✅ |
| CI runs gitleaks on every push | ✅ |
| EAS build triggered on main push | ✅ |
| `EXPO_TOKEN` GitHub secret | ⏳ Manual |
| iOS EAS build added to CI (see P0-7) | ⏳ Add iOS build step |

---

## SUBMISSION READINESS GATE

Run this checklist before triggering any store submission:

```bash
# 1. Package versions aligned
pnpm ls expo react-native react | head -5

# 2. Expo doctor
npx expo doctor

# 3. TypeScript
npx tsc --noEmit

# 4. Lint
pnpm lint

# 5. Verify app.json
node -e "const c=require('./app.json'); console.log(c.expo.sdkVersion, c.expo.android.targetSdkVersion, c.expo.newArchEnabled)"
# Expected: 57.0.0 36 true

# 6. Verify bundle IDs
node -e "const c=require('./app.json'); console.log(c.expo.android.package, c.expo.ios.bundleIdentifier)"
# Expected: com.predictxta.sports com.predictxta.sports

# 7. Verify Firebase credentials are NOT placeholders
grep -c "YOUR_" google-services.json && echo "PLACEHOLDER DETECTED" || echo "✓ Looks real"

# 8. EAS secrets present
eas secret:list | grep -E "GOOGLE_SERVICES|APPLE_|EXPO_TOKEN"

# 9. IAP product IDs consistent
node -e "
const fs = require('fs');
const ids = ['predictxta_vip_monthly','predictxta_vip_6month','predictxta_vip_yearly','predictxta_coins_500','predictxta_coins_2500','predictxta_coins_5000'];
const iap = fs.readFileSync('services/iapService.ts','utf8');
const edge = fs.readFileSync('supabase/functions/verify-purchase/index.ts','utf8');
ids.forEach(id => {
  if (!iap.includes(id)) console.error('MISSING in iapService:', id);
  if (!edge.includes(id)) console.error('MISSING in verify-purchase:', id);
});
console.log('Product ID check complete');
"

# 10. Trigger builds
eas build --platform android --profile production
eas build --platform ios --profile production
```

---

## KNOWN LIMITATIONS (non-blocking for internal testing)

1. **`autoVerify: false`** on Android intentFilters — App Links (HTTPS-verified deep links) require Play Console App Links verification. OAuth still works via custom scheme.
2. **OTA updates disabled** (`updates.enabled: false`) — manual app store release required for all updates.
3. **`expo-video` shimmed** — OnSpace preview builds only. EAS production builds are unaffected once the host app conflict is resolved.
4. **pnpm-lock.yaml** may be stale relative to package.json until P0-1 is unblocked.

---

*This document is the authoritative pre-submission gate for PredictXta.*  
*See `docs/PRODUCTION_SOURCE_OF_TRUTH.md` for all canonical values.*
