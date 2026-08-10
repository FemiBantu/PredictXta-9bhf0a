// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

const globalPolyfillsPath = path.resolve(__dirname, 'shims/global-polyfills.js');

const webBrowserShimDir       = path.resolve(__dirname, 'shims/expo-web-browser');
const expoImageShimDir        = path.resolve(__dirname, 'shims/expo-image');
const iapShimDir              = path.resolve(__dirname, 'shims/react-native-iap');
const expoVideoShimDir        = path.resolve(__dirname, 'shims/expo-video');
const nitroModulesShimDir     = path.resolve(__dirname, 'shims/react-native-nitro-modules');
const expoAuthSessionShimDir  = path.resolve(__dirname, 'shims/expo-auth-session');
const expoConstantsShimDir    = path.resolve(__dirname, 'shims/expo-constants');
const expoSplashScreenShimDir = path.resolve(__dirname, 'shims/expo-splash-screen');
const expoNotificationsShimDir = path.resolve(__dirname, 'shims/expo-notifications');
const expoAppleAuthShimDir    = path.resolve(__dirname, 'shims/expo-apple-authentication');
const expoFontShimDir         = path.resolve(__dirname, 'shims/expo-font');
const expoDeviceShimDir       = path.resolve(__dirname, 'shims/expo-device');
const reanimatedShimDir       = path.resolve(__dirname, 'shims/react-native-reanimated');
// SSR-safe react-native shim — only used via resolveRequest for server platform
const reactNativeSSRShimDir   = path.resolve(__dirname, 'shims/react-native-web');
const base64ArrayBufferShimPath = path.resolve(__dirname, 'shims/base64-arraybuffer/index.js');
const reactI18nextShimDir       = path.resolve(__dirname, 'shims/react-i18next');
const i18nextShimDir            = path.resolve(__dirname, 'shims/i18next');
const expoImagePickerShimDir    = path.resolve(__dirname, 'shims/expo-image-picker');
const expoFileSystemShimDir     = path.resolve(__dirname, 'shims/expo-file-system');
const rnWebViewShimDir          = path.resolve(__dirname, 'shims/react-native-webview');

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP PATCHES
//
// During `expo export --platform web` the SSR renderer runs in raw Node.js
// (NOT under Metro). Metro's resolveRequest hook never fires for SSR, so all
// the shim redirects below don't help for SSR rendering.
//
// We fix SSR crashes by:
//   1. Restoring node_modules/react-native/index.js if we previously wrote
//      our SSR shim there (old approach) — that caused Android Hermes to crash
//      with "Cannot read property 'bind' of undefined" because Metro's module
//      cache picked up the stub even after blockList was applied.
//   2. File-patching getLinkingConfig.js (the exact crash site) to guard
//      every bare Platform.OS access with a typeof check.
//   3. File-patching expo-font/build/server.js to add missing SSR exports.
//
// IMPORTANT: We do NOT write to node_modules/react-native/index.js anymore.
//            The SSR shim is delivered only via resolveRequest (platform ===
//            'server' | null), keeping native builds completely clean.
// ─────────────────────────────────────────────────────────────────────────────

// ── 0. Restore react-native/index.js if we previously shimmed it ─────────────
// Undoes the old "installReactNativeNodeShim" approach that broke Android.
(function restoreReactNativeIfShimmed() {
  try {
    const rnIdx = path.join(__dirname, 'node_modules', 'react-native', 'index.js');
    if (!fs.existsSync(rnIdx)) return;
    const content = fs.readFileSync(rnIdx, 'utf8');
    if (!content.includes('SSRNullComponent')) return; // not our shim — leave it alone

    // Our shim is present; find the real react-native in the pnpm store and restore it.
    const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
    if (!fs.existsSync(pnpmDir)) return;
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('react-native@')) continue;
      const realIdx = path.join(pnpmDir, entry, 'node_modules', 'react-native', 'index.js');
      if (!fs.existsSync(realIdx)) continue;
      const realContent = fs.readFileSync(realIdx, 'utf8');
      if (realContent.includes('SSRNullComponent')) continue; // also a shim — skip
      fs.writeFileSync(rnIdx, realContent, 'utf8');
      console.log('[metro] Restored node_modules/react-native/index.js from pnpm store');
      return;
    }
  } catch (e) {
    console.warn('[metro] react-native restore failed (non-fatal):', e.message);
  }
})();

// ── 1. Patch getLinkingConfig.js + related expo-router files ──────────────────
// expo-router/build/getLinkingConfig.js:  `Platform.OS !== 'web'`
// Crashes when Platform is undefined in SSR.
//
// REPLACEMENT: ((Platform||{}).OS||'web')
//   • Does NOT contain a bare `Platform.OS` substring, so it is immune to
//     recursive re-patching on subsequent Metro restarts.
//   • Negative lookbehind (?<!\.) ensures `react_native_1.Platform.OS`
//     (property chain) is never touched.
//
// REPAIR: If a previous run produced the broken double-patch
//   react_native_1.(typeof Platform ... ? Platform.OS ...) we restore the
//   original file from the pnpm store before re-applying.
(function patchGetLinkingConfig() {
  try {
    const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
    if (!fs.existsSync(pnpmDir)) return;

    // Collect pnpm-store originals keyed by basename for restore fallback
    const originals = {}; // { 'ExpoRoot.js': '/path/to/pnpm/.../ExpoRoot.js', ... }
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('expo-router@')) continue;
      const base = path.join(pnpmDir, entry, 'node_modules', 'expo-router', 'build');
      for (const f of ['ExpoRoot.js', 'getLinkingConfig.js',
                        path.join('global-state', 'router-store.js')]) {
        const full = path.join(base, f);
        if (fs.existsSync(full)) originals[path.basename(f)] = full;
      }
    }

    function applyPlatformPatch(filePath) {
      if (!fs.existsSync(filePath)) return;
      let content = fs.readFileSync(filePath, 'utf8');

      // Strip our marker so we always work on the logical content
      const hadMarker = content.startsWith('// __PLATFORM_PATCHED__\n');
      if (hadMarker) content = content.slice('// __PLATFORM_PATCHED__\n'.length);

      // Detect broken double-patch: `react_native_1.(typeof` is invalid JS.
      // Restore from pnpm store then re-apply cleanly.
      if (content.includes('react_native_1.(typeof')) {
        const basename = path.basename(filePath);
        const storeFile = originals[basename];
        if (storeFile && fs.existsSync(storeFile)) {
          const storeContent = fs.readFileSync(storeFile, 'utf8');
          // Only use it if the store copy is clean (not our shim)
          if (!storeContent.includes('react_native_1.(typeof') &&
              !storeContent.includes('__PLATFORM_PATCHED__')) {
            content = storeContent;
            console.log('[metro] Restored broken', path.relative(__dirname, filePath), 'from pnpm store');
          }
        }
        // If we cannot restore, surgically remove the double-nesting:
        // replace `(typeof Platform !== 'undefined' && Platform ? (typeof Platform !== 'undefined' && Platform ? Platform.OS : 'web') : 'web')`
        // back to `Platform.OS` so the clean replacement below can handle it.
        if (content.includes('react_native_1.(typeof')) {
          content = content.replace(
            /\(typeof Platform !== 'undefined' && Platform \? \(typeof Platform !== 'undefined' && Platform \? Platform\.OS : 'web'\) : 'web'\)/g,
            'Platform.OS',
          );
        }
      }

      // Check if already cleanly patched with our safe replacement
      if (content.includes("((Platform||{}).OS||'web')")) {
        // Already has the correct safe patch — just ensure marker is present
        if (!hadMarker) {
          fs.writeFileSync(filePath, '// __PLATFORM_PATCHED__\n' + content, 'utf8');
        }
        return;
      }

      // Apply the safe replacement.
      // ((Platform||{}).OS||'web') does NOT contain a bare `Platform.OS`
      // substring, so this regex will never match its own output.
      const patched = content.replace(
        /(?<!\.)\bPlatform\.OS\b/g,
        "((Platform||{}).OS||'web')",
      );
      if (patched === content && !hadMarker) return; // nothing changed

      fs.writeFileSync(filePath, '// __PLATFORM_PATCHED__\n' + patched, 'utf8');
      console.log('[metro] Patched Platform.OS guard in', path.relative(__dirname, filePath));
    }

    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('expo-router@')) continue;
      const base = path.join(pnpmDir, entry, 'node_modules', 'expo-router', 'build');
      applyPlatformPatch(path.join(base, 'getLinkingConfig.js'));
      applyPlatformPatch(path.join(base, 'global-state', 'router-store.js'));
      applyPlatformPatch(path.join(base, 'ExpoRoot.js'));
    }
  } catch (e) {
    console.warn('[metro] getLinkingConfig patch failed (non-fatal):', e.message);
  }
})();

// ── 3. Patch react-native webapis Performance.js multi-line import crash ─────
// react-native@0.79.x ships src/private/webapis/ files that use multi-line
// import statements the older Hermes parser in @react-native/babel-preset
// cannot handle. Symptom: SyntaxError '{' expected in import specifier clause.
// Fix: join multi-line imports onto a single line before Metro transforms them.
(function patchRNWebApisMultilineImports() {
  try {
    const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
    if (!fs.existsSync(pnpmDir)) return;

    function walkJs(dir) {
      const files = [];
      try {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          try {
            if (fs.statSync(full).isDirectory()) files.push(...walkJs(full));
            else if (f.endsWith('.js')) files.push(full);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return files;
    }

    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('react-native@')) continue;
      const webApiDir = path.join(
        pnpmDir, entry, 'node_modules', 'react-native',
        'src', 'private', 'webapis',
      );
      if (!fs.existsSync(webApiDir)) continue;

      for (const filePath of walkJs(webApiDir)) {
        try {
          let content = fs.readFileSync(filePath, 'utf8');
          if (content.startsWith('// __HERMES_IMPORT_PATCHED__')) continue;

          // Check for multi-line import patterns
          if (!/\bimport[\s\S]{0,4}\n/.test(content)) continue;

          // Collapse: import <newline> (spaces) -> import (space)
          const patched = content.replace(/\bimport(\s*)\n(\s*)/g, 'import ');
          if (patched === content) continue;

          fs.writeFileSync(filePath, '// __HERMES_IMPORT_PATCHED__\n' + patched, 'utf8');
          console.log('[metro] Fixed multi-line import in', path.relative(__dirname, filePath));
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.warn('[metro] webapis import patch failed (non-fatal):', e.message);
  }
})();

// ── 2b. Patch babel-plugin-syntax-hermes-parser ─────────────────────────────
// The plugin tries to load the native hermes-parser binding which doesn't
// exist in web/SSR environments, crashing the Metro transform worker.
// Replace its dist/index.js with a no-op Babel plugin stub.
//
// CRITICAL: The SSR renderer (expo-router/node/render.js) loads babel-preset-expo
// via raw Node.js require() BEFORE Metro is fully initialised. This means the
// resolveRequest hook below never fires for SSR. We must patch the actual files
// on disk so Node.js finds the stub when it traverses node_modules normally.
//
// The nested path that crashes:
//   babel-preset-expo/node_modules/babel-plugin-syntax-hermes-parser/index.js
//   (package.json "main": "index.js" but the file is missing)
(function patchHermesParserPlugin() {
  try {
    require('./scripts/patch-hermes-parser-plugin.js');
  } catch (e) {
    console.warn('[metro] hermes-parser-plugin patch failed (non-fatal):', e.message);
  }

  // Secondary direct patch: write stub to EVERY known nested location.
  // Covers: babel-preset-expo, @react-native/babel-preset, and any pnpm entry
  // that hosts a nested babel-plugin-syntax-hermes-parser copy.
  try {
    const STUB2 = `'use strict';\n// no-op hermes-parser stub (metro.config.js direct patch)\nmodule.exports = function() { return { visitor: {} }; };\nmodule.exports.default = module.exports;\n`;
    const STUB_MARKER = 'no-op hermes-parser stub';

    function writeHermesStub(baseDir) {
      if (!fs.existsSync(baseDir)) return;
      for (const rel of ['index.js', path.join('dist', 'index.js')]) {
        const target = path.join(baseDir, rel);
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
          if (!existing.includes(STUB_MARKER)) {
            // Also honour the package.json "main" field if present
            fs.writeFileSync(target, STUB2, 'utf8');
            console.log('[metro] Wrote hermes-parser stub:', path.relative(__dirname, target));
          }
        } catch { /* skip */ }
      }
      // Honour package.json "main" field
      const pkgPath = path.join(baseDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.main) {
            const mainTarget = path.resolve(baseDir, pkg.main);
            if (!mainTarget.endsWith('index.js')) { // avoid double-write
              try {
                fs.mkdirSync(path.dirname(mainTarget), { recursive: true });
                const existing = fs.existsSync(mainTarget) ? fs.readFileSync(mainTarget, 'utf8') : '';
                if (!existing.includes(STUB_MARKER)) fs.writeFileSync(mainTarget, STUB2, 'utf8');
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      }
    }

    const pnpmDir2 = path.join(__dirname, 'node_modules', '.pnpm');

    // ① babel-preset-expo nested copies
    if (fs.existsSync(pnpmDir2)) {
      for (const entry of fs.readdirSync(pnpmDir2)) {
        if (!entry.startsWith('babel-preset-expo@')) continue;
        writeHermesStub(path.join(
          pnpmDir2, entry, 'node_modules', 'babel-preset-expo',
          'node_modules', 'babel-plugin-syntax-hermes-parser'
        ));
        writeHermesStub(path.join(
          pnpmDir2, entry, 'node_modules', 'babel-plugin-syntax-hermes-parser'
        ));
      }
    }

    // ② @react-native/babel-preset nested copies (the new crash location)
    // Root flat path
    writeHermesStub(path.join(
      __dirname, 'node_modules', '@react-native', 'babel-preset',
      'node_modules', 'babel-plugin-syntax-hermes-parser'
    ));
    // pnpm store entries
    if (fs.existsSync(pnpmDir2)) {
      for (const entry of fs.readdirSync(pnpmDir2)) {
        if (!entry.startsWith('@react-native+babel-preset@') &&
            !entry.includes('babel-preset')) continue;
        writeHermesStub(path.join(
          pnpmDir2, entry, 'node_modules', '@react-native', 'babel-preset',
          'node_modules', 'babel-plugin-syntax-hermes-parser'
        ));
        writeHermesStub(path.join(
          pnpmDir2, entry, 'node_modules', 'babel-plugin-syntax-hermes-parser'
        ));
      }
    }

    // ③ Root-level flat path (npm/yarn installs)
    writeHermesStub(path.join(
      __dirname, 'node_modules', 'babel-plugin-syntax-hermes-parser'
    ));
  } catch (e) {
    console.warn('[metro] direct hermes-parser patch failed (non-fatal):', e.message);
  }
})();

// ── 2a. Patch expo-auth-session: replace index.js with self-contained stub ───
// expo-auth-session@6.x pnpm installs often have an *empty* build/ directory —
// only index.js exists but all files it requires (AuthRequest, TokenRequest,
// providers/*, …) are missing. When SSR runs in raw Node.js it loads the
// package *before* Metro's resolveRequest shim fires, causing ERR_MODULE_NOT_FOUND.
//
// Fix: overwrite expo-auth-session/build/index.js with a self-contained CJS stub
// that exports everything inline — no internal require() calls, no missing deps.
// The standalone script (scripts/patch-expo-auth-session.js) does the same work
// and is run as a pre-export step in package.json so the stub is always ready.
(function patchExpoAuthSessionStubs() {
  try {
    require('./scripts/patch-expo-auth-session.js');
  } catch (e) {
    console.warn('[metro] expo-auth-session patch failed (non-fatal):', e.message);
  }
})();

// ── 2. Patch expo-font/build/server.js ───────────────────────────────────────
// expo-router's renderStaticContent.js calls Font.resetServerContext() and
// Font.getServerResources(). These exports are missing in some pnpm copies.
(function patchExpoFontServer() {
  try {
    const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
    if (!fs.existsSync(pnpmDir)) return;

    const patch = `
// ── SSR patch injected by metro.config.js ──────────────────────────────────
if (typeof exports.resetServerContext !== 'function') {
  exports.resetServerContext = function resetServerContext() {};
}
if (typeof exports.getServerResources !== 'function') {
  exports.getServerResources = function getServerResources() { return []; };
}
`;
    function applyFontPatch(serverPath) {
      if (!fs.existsSync(serverPath)) return;
      const content = fs.readFileSync(serverPath, 'utf8');
      if (content.includes('resetServerContext') && content.includes('getServerResources')) return;
      fs.writeFileSync(serverPath, content + patch, 'utf8');
      console.log('[metro] Patched expo-font/build/server.js →', path.relative(__dirname, serverPath));
    }

    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('expo-font@')) {
        applyFontPatch(path.join(pnpmDir, entry, 'node_modules', 'expo-font', 'build', 'server.js'));
      }
      if (entry.startsWith('expo-router@')) {
        applyFontPatch(path.join(pnpmDir, entry, 'node_modules', 'expo-font', 'build', 'server.js'));
      }
    }
  } catch (e) {
    console.warn('[metro] expo-font/build/server.js patch failed (non-fatal):', e.message);
  }
})();

// ─── Helpers — locate real pnpm packages for native builds ───────────────────

function findRealReanimated() {
  const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('react-native-reanimated@')) continue;
      const candidate = path.join(pnpmDir, entry, 'node_modules', 'react-native-reanimated');
      const pkgPath = path.join(candidate, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        for (const rel of [meta.main, 'src/index.ts', 'src/index.js', 'lib/index.js', 'index.js'].filter(Boolean)) {
          const full = path.join(candidate, rel);
          if (fs.existsSync(full)) return { dir: candidate, main: full };
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

function findRealReactNative() {
  const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('react-native@')) continue;
      const candidate = path.join(pnpmDir, entry, 'node_modules', 'react-native');
      if (fs.existsSync(path.join(candidate, 'index.js'))) return candidate;
    }
  } catch { /* skip */ }
  return null;
}

function findWorkingExpoModulesCore() {
  const expoNested = path.join(__dirname, 'node_modules', 'expo', 'node_modules', 'expo-modules-core');
  if (fs.existsSync(path.join(expoNested, 'build', 'index.js'))) return expoNested;

  const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;

  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('expo-modules-core@')) continue;
    const c = path.join(pnpmDir, entry, 'node_modules', 'expo-modules-core');
    if (fs.existsSync(path.join(c, 'build', 'index.js'))) return c;
  }
  for (const entry of fs.readdirSync(pnpmDir)) {
    const nested = path.join(pnpmDir, entry, 'node_modules', 'expo-modules-core');
    if (fs.existsSync(path.join(nested, 'build', 'index.js'))) return nested;
  }
  for (const entry of fs.readdirSync(pnpmDir)) {
    const entryPath = path.join(pnpmDir, entry, 'node_modules');
    if (!fs.existsSync(entryPath)) continue;
    try {
      for (const sub of fs.readdirSync(entryPath)) {
        const deep = path.join(entryPath, sub, 'node_modules', 'expo-modules-core');
        if (fs.existsSync(path.join(deep, 'build', 'index.js'))) return deep;
      }
    } catch { /* skip */ }
  }

  const standard = path.join(__dirname, 'node_modules', 'expo-modules-core');
  if (fs.existsSync(path.join(standard, 'build', 'index.js'))) return standard;

  try {
    const result = require('child_process').execSync(
      `find "${pnpmDir}" -maxdepth 5 -name "index.js" -path "*/expo-modules-core/build/index.js" 2>/dev/null | head -1`,
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    if (result) {
      const resolved = result.replace('/build/index.js', '');
      if (fs.existsSync(path.join(resolved, 'build', 'index.js'))) return resolved;
    }
  } catch { /* non-blocking */ }

  return null;
}

// ─── Locate real i18next in pnpm store ──────────────────────────────────────
function findRealI18nextCore() {
  const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('i18next@')) continue;
      const candidate = path.join(pnpmDir, entry, 'node_modules', 'i18next');
      const pkgPath = path.join(candidate, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const main = meta.main ?? 'index.js';
        const full = path.join(candidate, main);
        if (fs.existsSync(full)) {
          console.log('[metro] Found real i18next at', path.relative(__dirname, candidate));
          return candidate;
        }
        const rootIdx = path.join(candidate, 'index.js');
        if (fs.existsSync(rootIdx)) return candidate;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

// ─── Locate real react-i18next in pnpm store ────────────────────────────────
function findRealI18next() {
  const pnpmDir = path.join(__dirname, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('react-i18next@')) continue;
      const candidate = path.join(pnpmDir, entry, 'node_modules', 'react-i18next');
      const pkgPath = path.join(candidate, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        // Prefer the CJS main field so Metro (and SSR Node) both resolve it cleanly
        const main = meta.main ?? 'index.js';
        const full = path.join(candidate, main);
        if (fs.existsSync(full)) {
          console.log('[metro] Found real react-i18next at', path.relative(__dirname, candidate));
          return candidate;
        }
        // Fallback: index.js at root
        const rootIdx = path.join(candidate, 'index.js');
        if (fs.existsSync(rootIdx)) return candidate;
      } catch { /* skip corrupt package */ }
    }
  } catch { /* skip */ }
  return null;
}

const realI18nextCoreDir     = findRealI18nextCore();
const realReanimated         = findRealReanimated();
const realReanimatedDir      = realReanimated ? realReanimated.dir  : null;
const realReanimatedMain     = realReanimated ? realReanimated.main : null;
const realReactNativeDir     = findRealReactNative();
const workingExpoModulesCore = findWorkingExpoModulesCore();
const realI18nextDir         = findRealI18next();

// ─── Global polyfills ─────────────────────────────────────────────────────────
config.serializer = config.serializer ?? {};
const originalGetPolyfills = config.serializer.getPolyfills;
config.serializer.getPolyfills = (ctx) => {
  const base = originalGetPolyfills ? originalGetPolyfills(ctx) : [];
  // Inject global-polyfills on ALL platforms (android/ios/web/server).
  // On Android it installs the NativeUnimoduleProxy VideoCache crash guard
  // BEFORE the module registry iterates native modules at bridge init time.
  return [globalPolyfillsPath, ...base];
};

// ─── Module resolution ────────────────────────────────────────────────────────
config.resolver = config.resolver ?? {};

// blockList — prevent local SSR stubs from leaking into native bundles.
// Metro falls through to resolveRequest / extraNodeModules for android/ios.
const existingBlockList = config.resolver.blockList;
const blockListRegexes = Array.isArray(existingBlockList)
  ? existingBlockList
  : existingBlockList ? [existingBlockList] : [];

function escapeReg(p) { return p.replace(/[\\/.+*?^${}()|[\]]/g, '\\$&'); }

// Block local react-native-reanimated SSR stub from native builds
blockListRegexes.push(new RegExp(
  '^' + escapeReg(path.join(__dirname, 'node_modules', 'react-native-reanimated')) + '(/.*)?$',
));

config.resolver.blockList = blockListRegexes;

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  ...(workingExpoModulesCore ? { 'expo-modules-core': workingExpoModulesCore } : {}),
  ...(realReanimatedDir      ? { 'react-native-reanimated': realReanimatedDir } : {}),
  ...(realReactNativeDir     ? { 'react-native': realReactNativeDir } : {}),
  'base64-arraybuffer': path.resolve(__dirname, 'shims/base64-arraybuffer'),
  // Use real react-i18next from pnpm store when available; fall back to shim
  'i18next': realI18nextCoreDir ?? i18nextShimDir,
  'react-i18next': realI18nextDir ?? reactI18nextShimDir,
  'expo-image-picker': expoImagePickerShimDir,
  'expo-file-system': expoFileSystemShimDir,
  'react-native-webview': rnWebViewShimDir,
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {

  // ── expo-modules-core (all platforms) ────────────────────────────────────────
  if (workingExpoModulesCore &&
      (moduleName === 'expo-modules-core' || moduleName.startsWith('expo-modules-core/'))) {
    const subPath = moduleName === 'expo-modules-core'
      ? 'build/index.js'
      : moduleName.slice('expo-modules-core/'.length);
    const full = path.join(workingExpoModulesCore, subPath);
    if (fs.existsSync(full)) return { filePath: full, type: 'sourceFile' };
    if (!subPath.endsWith('.js') && fs.existsSync(full + '.js')) return { filePath: full + '.js', type: 'sourceFile' };
    const idx = path.join(full, 'index.js');
    if (fs.existsSync(idx)) return { filePath: idx, type: 'sourceFile' };
    return { filePath: path.join(workingExpoModulesCore, 'build/index.js'), type: 'sourceFile' };
  }

  // ── i18next — all platforms: real pnpm package → shim fallback ──────────────
  if (moduleName === 'i18next' || moduleName.startsWith('i18next/')) {
    const i18nRoot = realI18nextCoreDir ?? i18nextShimDir;
    if (moduleName === 'i18next') {
      if (realI18nextCoreDir) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(realI18nextCoreDir, 'package.json'), 'utf8'));
          const main = meta.main ?? 'index.js';
          const full = path.join(realI18nextCoreDir, main);
          if (fs.existsSync(full)) return { filePath: full, type: 'sourceFile' };
        } catch { /* fall through */ }
      }
      return { filePath: path.join(i18nextShimDir, 'index.js'), type: 'sourceFile' };
    }
    // Sub-path import
    const subPath = moduleName.slice('i18next/'.length);
    if (realI18nextCoreDir) {
      for (const candidate of [
        path.join(realI18nextCoreDir, subPath),
        path.join(realI18nextCoreDir, subPath + '.js'),
        path.join(realI18nextCoreDir, subPath + '.cjs'),
        path.join(realI18nextCoreDir, subPath, 'index.js'),
      ]) {
        if (fs.existsSync(candidate)) return { filePath: candidate, type: 'sourceFile' };
      }
    }
    return { filePath: path.join(i18nextShimDir, 'index.js'), type: 'sourceFile' };
  }

  // ── react-i18next — all platforms: real pnpm package → shim fallback ─────────
  if (moduleName === 'react-i18next' || moduleName.startsWith('react-i18next/')) {
    const i18nextRoot = realI18nextDir ?? reactI18nextShimDir;
    if (moduleName === 'react-i18next') {
      // Point at the real CJS entry if we have it, otherwise the shim
      if (realI18nextDir) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(realI18nextDir, 'package.json'), 'utf8'));
          const main = meta.main ?? 'index.js';
          const full = path.join(realI18nextDir, main);
          if (fs.existsSync(full)) return { filePath: full, type: 'sourceFile' };
        } catch { /* fall through */ }
        const rootIdx = path.join(realI18nextDir, 'index.js');
        if (fs.existsSync(rootIdx)) return { filePath: rootIdx, type: 'sourceFile' };
      }
      return { filePath: path.join(reactI18nextShimDir, 'index.js'), type: 'sourceFile' };
    }
    // Sub-path import (e.g. 'react-i18next/initReactI18next')
    const subPath = moduleName.slice('react-i18next/'.length);
    if (realI18nextDir) {
      for (const candidate of [
        path.join(realI18nextDir, subPath),
        path.join(realI18nextDir, subPath + '.js'),
        path.join(realI18nextDir, subPath + '.cjs'),
        path.join(realI18nextDir, subPath, 'index.js'),
      ]) {
        if (fs.existsSync(candidate)) return { filePath: candidate, type: 'sourceFile' };
      }
    }
    // Sub-path not found — fall through to shim index (exports everything)
    return { filePath: path.join(reactI18nextShimDir, 'index.js'), type: 'sourceFile' };
  }

  // ── SSR / server platform ────────────────────────────────────────────────────
  // Metro fires this for platform === 'server' | null during web static export.
  // All problematic packages get safe shims here — native builds never hit this branch.
  if (platform === 'server' || platform == null) {
    // Intercept babel-plugin-syntax-hermes-parser at Metro resolution level too
    if (moduleName === 'babel-plugin-syntax-hermes-parser' ||
        moduleName.startsWith('babel-plugin-syntax-hermes-parser/'))
      return { filePath: path.join(expoAuthSessionShimDir, '..', '..', 'stubs', 'hermes-parser-plugin.js'), type: 'sourceFile' };
    if (moduleName === 'react-native')
      return { filePath: path.join(reactNativeSSRShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-reanimated' || moduleName.startsWith('react-native-reanimated/'))
      return { filePath: path.join(reanimatedShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-font' || moduleName.startsWith('expo-font/'))
      return { filePath: path.join(expoFontShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-device' || moduleName.startsWith('expo-device/'))
      return { filePath: path.join(expoDeviceShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-image' || moduleName.startsWith('expo-image/'))
      return { filePath: path.join(expoImageShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-notifications' || moduleName.startsWith('expo-notifications/'))
      return { filePath: path.join(expoNotificationsShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-splash-screen' || moduleName.startsWith('expo-splash-screen/'))
      return { filePath: path.join(expoSplashScreenShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-constants')
      return { filePath: path.join(expoConstantsShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-web-browser' || moduleName.startsWith('expo-web-browser/'))
      return { filePath: path.join(webBrowserShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-iap' || moduleName.startsWith('react-native-iap/'))
      return { filePath: path.join(iapShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-nitro-modules' || moduleName.startsWith('react-native-nitro-modules/'))
      return { filePath: path.join(nitroModulesShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-apple-authentication' || moduleName.startsWith('expo-apple-authentication/'))
      return { filePath: path.join(expoAppleAuthShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-video' || moduleName.startsWith('expo-video/'))
      return { filePath: path.join(expoVideoShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-auth-session' || moduleName.startsWith('expo-auth-session/'))
      return { filePath: path.join(expoAuthSessionShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-image-picker' || moduleName.startsWith('expo-image-picker/'))
      return { filePath: path.join(expoImagePickerShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-file-system' || moduleName.startsWith('expo-file-system/'))
      return { filePath: path.join(expoFileSystemShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-webview' || moduleName.startsWith('react-native-webview/'))
      return { filePath: path.join(rnWebViewShimDir, 'index.js'), type: 'sourceFile' };
  }

  // ── Web platform shims ───────────────────────────────────────────────────────
  if (platform === 'web') {
    if (moduleName === 'expo-image' || moduleName.startsWith('expo-image/'))
      return { filePath: path.join(expoImageShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-apple-authentication' || moduleName.startsWith('expo-apple-authentication/'))
      return { filePath: path.join(expoAppleAuthShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-font' || moduleName.startsWith('expo-font/'))
      return { filePath: path.join(expoFontShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-device' || moduleName.startsWith('expo-device/'))
      return { filePath: path.join(expoDeviceShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-notifications' || moduleName.startsWith('expo-notifications/'))
      return { filePath: path.join(expoNotificationsShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-splash-screen' || moduleName.startsWith('expo-splash-screen/'))
      return { filePath: path.join(expoSplashScreenShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-constants')
      return { filePath: path.join(expoConstantsShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-web-browser' || moduleName.startsWith('expo-web-browser/'))
      return { filePath: path.join(webBrowserShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-video' || moduleName.startsWith('expo-video/') ||
        moduleName.includes('/expo-video/') || moduleName.endsWith('/expo-video'))
      return { filePath: path.join(expoVideoShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-nitro-modules' || moduleName.startsWith('react-native-nitro-modules/'))
      return { filePath: path.join(nitroModulesShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-iap' || moduleName.startsWith('react-native-iap/'))
      return { filePath: path.join(iapShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-reanimated' || moduleName.startsWith('react-native-reanimated/'))
      return { filePath: path.join(reanimatedShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-auth-session' || moduleName.startsWith('expo-auth-session/'))
      return { filePath: path.join(expoAuthSessionShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-image-picker' || moduleName.startsWith('expo-image-picker/'))
      return { filePath: path.join(expoImagePickerShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'expo-file-system' || moduleName.startsWith('expo-file-system/'))
      return { filePath: path.join(expoFileSystemShimDir, 'index.js'), type: 'sourceFile' };
    if (moduleName === 'react-native-webview' || moduleName.startsWith('react-native-webview/'))
      return { filePath: path.join(rnWebViewShimDir, 'index.js'), type: 'sourceFile' };
  }

  // ── Native: force real reanimated (never the local SSR stub) ─────────────────
  if ((platform === 'android' || platform === 'ios') &&
      (moduleName === 'react-native-reanimated' || moduleName.startsWith('react-native-reanimated/'))) {
    if (realReanimatedMain) {
      if (moduleName === 'react-native-reanimated') return { filePath: realReanimatedMain, type: 'sourceFile' };
      const subPath = moduleName.slice('react-native-reanimated/'.length);
      for (const c of [
        path.join(realReanimatedDir, subPath),
        path.join(realReanimatedDir, subPath + '.ts'),
        path.join(realReanimatedDir, subPath + '.js'),
        path.join(realReanimatedDir, subPath, 'index.ts'),
        path.join(realReanimatedDir, subPath, 'index.js'),
      ]) {
        if (fs.existsSync(c)) return { filePath: c, type: 'sourceFile' };
      }
    }
  }

  // ── Native: redirect expo-video to shim to keep JS away from native VideoManager ──
  // The NativeUnimoduleProxy crash guard in global-polyfills.js handles the
  // native side; this redirect ensures the JS side also uses the safe shim.
  if ((platform === 'android' || platform === 'ios') &&
      (moduleName === 'expo-video' || moduleName.startsWith('expo-video/'))) {
    return { filePath: path.join(expoVideoShimDir, 'index.js'), type: 'sourceFile' };
  }

  // ── Native: force real react-native (never any local shim) ───────────────────
  if ((platform === 'android' || platform === 'ios') && moduleName === 'react-native') {
    if (realReactNativeDir) return { filePath: path.join(realReactNativeDir, 'index.js'), type: 'sourceFile' };
  }

  if (originalResolveRequest) return originalResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
