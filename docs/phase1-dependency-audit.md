# ⚠️ HISTORICAL ONLY — See docs/PRODUCTION_SOURCE_OF_TRUTH.md

> **This document describes the SDK 54 migration state as of 2026-09-08.  
> Current canonical target: Expo SDK 57 · React Native 0.81.  
> All version numbers and package targets below have been superseded.**

---

# PredictXta — Phase 1 Audit Report (HISTORICAL)
# Production Foundation, SDK 54 Migration & Dependency Stabilization

Generated: 2026-09-08

---

## 1. DEPENDENCY / CONFIGURATION MATRIX

| Item | Status | Notes |
|---|---|---|
| Expo SDK | 54.0.0 (app.json) | package.json restricted — see §2 |
| React Native | Target: 0.81.x | Required for SDK 54 |
| React | Target: 19.1.x | Required for SDK 54 |
| Expo Router | ~5.x | SDK 54 compatible |
| Package manager | pnpm | pnpm-lock.yaml is authoritative |
| Android targetSdkVersion | 36 | Google Play API 36 compliant |
| Android minSdkVersion | 24 | Covers 98%+ of devices |
| iOS | Configured | usesAppleSignIn, privacyManifests |
| newArchEnabled | true | Fabric/JSI New Architecture active |
| TypeScript | strict mode | tsconfig.json |
| CI/CD | GitHub Actions | pnpm frozen-lockfile throughout |
| Docker | pnpm install | Dockerfile corrected |
| EAS | production/preview/development | eas.json |
| Supabase | OnSpace Cloud backend | services/supabase.ts |
| Firebase | FCM v1 push | google-services.json, GoogleService-Info.plist |
| i18n | 11 languages | services/i18n/locales/ |

---

## 2. SDK VERSION STATE

### app.json (authoritative runtime config)
- `sdkVersion`: "54.0.0" ✓
- `newArchEnabled`: true ✓
- `android.targetSdkVersion`: 36 ✓
- `android.compileSdkVersion`: 36 ✓
- `android.minSdkVersion`: 24 ✓
- `experiments.reactCompiler`: false (package not installed — see §5)

### package.json (RESTRICTED — cannot be edited in this environment)
- Contains SDK 53 package versions (expo@~53.x, react-native@0.79, react@19.0)
- **Required action**: Run `npx expo install --fix` or manually update to SDK 54 versions after gaining package.json write access
- **SDK 54 target versions**:
  - `expo`: ~54.0.0
  - `react-native`: 0.81.x
  - `react`: 19.1.x
  - `expo-router`: ~5.1.x (already compatible)
  - `react-native-reanimated`: ~3.17.x
  - `react-native-web`: ~0.20.x
  - `@expo/metro-runtime`: ~4.0.x

---

## 3. FILES CHANGED IN PHASE 1

| File | Change | Reason |
|---|---|---|
| `react-native.config.js` | Removed stale `newArchEnabled: false` comment | Comment was from SDK 53 era; newArch is now true |
| `Dockerfile` | Replaced `npm ci` with `pnpm install --frozen-lockfile` | pnpm is authoritative; npm had no lockfile |
| `Dockerfile` | Added `corepack enable && corepack prepare pnpm@9` | Installs pnpm in Alpine without npm global install |
| `Dockerfile` | Copies `pnpm-lock.yaml` explicitly | Previously only copied `package-lock.json*` (wrong) |
| `.github/workflows/deploy.yml` | Moved `pnpm/action-setup` before `setup-node` with `cache: pnpm` | `cache: npm` was a bug — pnpm cache was not being used |
| `.github/workflows/deploy.yml` | Fixed Expo config validation JS | Used `?.` optional chaining which fails in Node 14; now uses `(obj || {}).prop` |
| `.github/workflows/deploy.yml` | Fixed `targetSdkVersion` check | Was checking `expo.android?.targetSdkVersion` which is correct but the double-check for `< 35` was redundant; streamlined |
| `.github/workflows/deploy.yml` | Removed duplicate `Install dependencies` step in build-production job | Was running install twice |
| `tsconfig.json` | Removed stale `expo-web-browser` path alias | Metro shims handle this at bundle time; TypeScript alias caused type confusion |
| `tsconfig.json` | Added `exclude` array | Prevents tsc from scanning `dist/` and `web-build/` |
| `app.json` | Added `compileSdkVersion: 36` | Aligns compile SDK with target for API 36 builds |

---

## 4. PATCHES RETAINED (WITH DOCUMENTED REASONS)

### A. `scripts/patch-hermes-parser-plugin.js`
**Reason**: `babel-preset-expo` (all versions through SDK 54) unconditionally loads  
`babel-plugin-syntax-hermes-parser` which requires a native Hermes binding. The binding  
is absent in web/SSR Node.js environments. This patch replaces every copy with a safe  
no-op Babel plugin stub.  
**Affected**: `babel-plugin-syntax-hermes-parser@0.25.x` nested in `babel-preset-expo`  
and `@react-native/babel-preset`  
**Idempotent**: Yes — checks for marker string before writing  
**Production impact**: None — stub only returns `{ visitor: {} }`

### B. `scripts/patch-expo-auth-session.js`
**Reason**: `expo-auth-session@6.x` installed via pnpm has an empty `build/` directory.  
SSR renderer loads the package before Metro fires, causing `ERR_MODULE_NOT_FOUND`.  
Stub exports all public symbols inline.  
**Affected**: `expo-auth-session@6.x` in pnpm store  
**Idempotent**: Yes — checks for `__EXPO_AUTH_SESSION_STUB__` marker  
**Production impact**: None — native builds get the real package via Metro `resolveRequest`

### C. `scripts/patch-expo-font-server.js`
**Reason**: Some pnpm copies of `expo-font/build/server.js` are missing  
`resetServerContext` and `getServerResources` exports required by  
`expo-router`'s SSR static renderer.  
**Affected**: `expo-font@~13.x` nested in expo-router pnpm entries  
**Idempotent**: Yes — checks for symbol presence before patching  
**Production impact**: None — server.js is only loaded during `expo export --platform web`

### D. `scripts/patch-reanimated-ssr.js`
**Reason**: `react-native-reanimated`'s Node.js entry missing `resetServerContext`.  
Required by `expo-router`'s static SSR renderer.  
**Affected**: `react-native-reanimated@~3.17.x` resolved by Node.js  
**Idempotent**: Yes — checks for `resetServerContext` before appending  
**Production impact**: None — SSR path only

### E. Metro `getLinkingConfig.js` / `ExpoRoot.js` / `router-store.js` patches (metro.config.js)
**Reason**: `expo-router` files contain bare `Platform.OS` references which crash  
SSR (Node.js) when `Platform` is `undefined`. Replaces with `((Platform||{}).OS||'web')`.  
**Affected**: `expo-router@~5.x` build files  
**Idempotent**: Yes — checks for `__PLATFORM_PATCHED__` marker and safe replacement  
**Production impact**: None — guard is semantically identical on native where Platform is always defined

### F. `shims/expo-video/` + `react-native.config.js` auto-linking disable
**Reason**: OnSpace preview APK holds a Media3 `SimpleCache` lock. When PredictXta's  
bundle registers `expo-video`'s `VideoManager` via `NativeUnimoduleProxy`, a second  
`SimpleCache` init throws `IllegalStateException` and kills the Hermes runtime before  
`AppRegistry.registerComponent` is called.  
**Affected**: `expo-video@~2.x` native Android module in OnSpace preview environment  
**Status**: Required for OnSpace Live Preview. For production EAS builds, this shim  
should be replaced with real `expo-video` native integration once the host app conflict  
is resolved.  
**Production impact**: Video playback is unavailable in OnSpace Live Preview. EAS  
production builds are unaffected because the host app constraint does not apply.

### G. `shims/global-polyfills.js` NativeUnimoduleProxy guard
**Reason**: Belt-and-suspenders guard for the same crash (§F). Wraps `getConstants()`  
with try/catch and removes `ExpoVideo` from `exportedMethods` at polyfill time.  
**Idempotent**: Yes — wraps existing function  
**Production impact**: None — catch only fires on crash; normal flow is unaffected

---

## 5. PACKAGES NOT INSTALLED (NOTED)

| Package | Reason absent | Impact |
|---|---|---|
| `babel-plugin-react-compiler` | Not in package.json | `experiments.reactCompiler` set to `false` in app.json |

---

## 6. REMOVED / CORRECTED ITEMS

- `tsconfig.json`: Removed `"expo-web-browser"` path alias (Metro handles at bundle time)
- `Dockerfile`: Removed `npm ci` and `package-lock.json*` reference
- CI `deploy.yml`: Removed `cache: npm` (replaced with `cache: pnpm`)
- CI `deploy.yml`: Removed stale `targetSdkVersion < 35` redundant check
- `react-native.config.js`: Removed stale `newArchEnabled: false` comment

---

## 7. VALIDATION STATUS

| Check | Status | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | Pending | Requires package.json write access to align SDK 54 |
| `pnpm lint` | Passes (ESLint flat config) | eslint-config-expo/flat |
| `npx expo config --type public` | Passes | app.json valid |
| `npx expo export --platform web` | Passes with patches | All SSR patches active |
| TypeScript strict mode | Passes | No implicit any, strict null checks |
| EAS build validation | Pending | Requires SDK 54 packages in package.json |

---

## 8. REQUIRED ACTION (BLOCKING)

The single blocking item is the **package.json version mismatch** (`expo@~53.x` vs `sdkVersion: "54.0.0"`).

To complete SDK 54 migration, after gaining package.json write access:

```bash
# 1. Update core SDK packages to SDK 54 versions
npx expo install --fix

# 2. Or manually pin:
pnpm add expo@~54.0.0 react-native@0.81.3 react@19.1.0 react-dom@19.1.0
pnpm add expo-router@~5.1.0 react-native-reanimated@~3.17.5
pnpm add @expo/metro-runtime@~4.0.0 react-native-web@~0.20.0

# 3. Regenerate lockfile
pnpm install

# 4. Validate
pnpm install --frozen-lockfile
npx expo config --type public
npx expo export --platform web
```

---

## 9. NEW ARCHITECTURE STATUS

`newArchEnabled: true` is set in `app.json`.

Native module compatibility audit:
| Module | New Arch compatible | Notes |
|---|---|---|
| expo-router | ✓ | SDK 54 Fabric support |
| react-native-reanimated | ✓ | ~3.17.x Fabric support |
| expo-notifications | ✓ | SDK 54 |
| expo-image | ✓ | SDK 54 |
| react-native-gesture-handler | ✓ | SDK 54 |
| react-native-safe-area-context | ✓ | SDK 54 |
| expo-video | Shimmed | OnSpace preview conflict — see §4F |
| react-native-iap | Shimmed | In-app purchases via server-side verify-purchase |
| react-native-nitro-modules | Shimmed | Not required for production features |
