'use strict';
/**
 * patch-hermes-parser-plugin.js
 *
 * babel-plugin-syntax-hermes-parser requires the native Hermes binding which
 * is missing in SSR/web/Node.js environments. This script patches every known
 * copy of the plugin with a safe no-op Babel plugin stub.
 *
 * Locations patched:
 *   1. Flat pnpm store:  .pnpm/babel-plugin-syntax-hermes-parser@x/...dist/index.js
 *   2. Nested inside babel-preset-expo's own node_modules
 *   3. Nested inside @react-native/babel-preset's own node_modules  ← NEW
 *   4. Nested inside every @react-native/babel-preset pnpm entry     ← NEW
 *   5. Well-known flat root paths (non-pnpm installs)
 */
const fs   = require('fs');
const path = require('path');

const STUB = `'use strict';
// Patched by scripts/patch-hermes-parser-plugin.js
// No-op Babel plugin — Hermes parser is not available in web/SSR builds.
module.exports = function() { return { visitor: {} }; };
module.exports.default = module.exports;
`;

const MARKER = 'Patched by scripts/patch-hermes-parser-plugin.js';

// ── Helper: write stub to a file path (idempotent) ──────────────────────────
function writeStub(target) {
  const dir = path.dirname(target);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, 'utf8');
      if (current.includes(MARKER)) return; // already patched
    }
    fs.writeFileSync(target, STUB, 'utf8');
    console.log('[patch] hermes-parser-plugin stub written to', path.relative(process.cwd(), target));
  } catch (e) {
    console.warn('[patch] failed to write stub to', target, ':', e.message);
  }
}

// ── Helper: patch all candidate entry points inside a plugin base dir ────────
function patchPluginBase(baseDir) {
  if (!fs.existsSync(baseDir)) return;

  // Candidates: declared "main" in package.json + common fallbacks
  const candidates = new Set([
    path.join(baseDir, 'index.js'),
    path.join(baseDir, 'dist', 'index.js'),
  ]);

  const pkgPath = path.join(baseDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      // "main" field
      if (pkg.main) candidates.add(path.resolve(baseDir, pkg.main));
      // "exports" field (handles {".":{require:...}} shape)
      const exportsField = pkg.exports;
      if (exportsField) {
        const tryExport = (v) => {
          if (typeof v === 'string') candidates.add(path.resolve(baseDir, v));
          else if (v && typeof v === 'object') {
            for (const k of Object.values(v)) tryExport(k);
          }
        };
        tryExport(exportsField);
      }
    } catch { /* ignore malformed package.json */ }
  }

  for (const target of candidates) writeStub(target);
}

const ROOT    = path.join(__dirname, '..');
const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');

// ── 1. Flat pnpm store copies of babel-plugin-syntax-hermes-parser ───────────
(function patchFlatStore() {
  if (!fs.existsSync(pnpmDir)) return;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('babel-plugin-syntax-hermes-parser@')) continue;
      const base = path.join(
        pnpmDir, entry, 'node_modules', 'babel-plugin-syntax-hermes-parser'
      );
      patchPluginBase(base);
    }
  } catch (e) {
    console.warn('[patch] flat-store scan failed (non-fatal):', e.message);
  }
})();

// ── 2. Nested inside every babel-preset-expo pnpm entry ──────────────────────
(function patchNestedInBabelPresetExpo() {
  if (!fs.existsSync(pnpmDir)) return;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('babel-preset-expo@')) continue;
      const searchRoots = [
        path.join(pnpmDir, entry, 'node_modules', 'babel-preset-expo',
          'node_modules', 'babel-plugin-syntax-hermes-parser'),
        path.join(pnpmDir, entry, 'node_modules',
          'babel-plugin-syntax-hermes-parser'),
      ];
      for (const base of searchRoots) patchPluginBase(base);
    }
  } catch (e) {
    console.warn('[patch] nested babel-preset-expo scan failed (non-fatal):', e.message);
  }
})();

// ── 3. Nested inside @react-native/babel-preset at root node_modules ─────────
//
//  Error seen:
//    node_modules/@react-native/babel-preset/node_modules/
//      babel-plugin-syntax-hermes-parser/index.js
//
//  @react-native/babel-preset/src/configs/main.js requires the plugin
//  at line 28 and Node resolves it into its own nested node_modules.
(function patchNestedInRNBabelPreset() {
  // Root flat install (npm / yarn / non-pnpm)
  patchPluginBase(path.join(ROOT, 'node_modules', '@react-native', 'babel-preset',
    'node_modules', 'babel-plugin-syntax-hermes-parser'));

  // Every pnpm store entry for @react-native/babel-preset
  if (!fs.existsSync(pnpmDir)) return;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('@react-native+babel-preset@') &&
          !entry.startsWith('react-native+babel-preset@') &&
          !entry.includes('babel-preset')) continue;

      // Pattern: .pnpm/@react-native+babel-preset@X/node_modules/@react-native/babel-preset/node_modules/...
      const searchRoots = [
        path.join(pnpmDir, entry, 'node_modules', '@react-native', 'babel-preset',
          'node_modules', 'babel-plugin-syntax-hermes-parser'),
        path.join(pnpmDir, entry, 'node_modules',
          'babel-plugin-syntax-hermes-parser'),
      ];
      for (const base of searchRoots) patchPluginBase(base);
    }
  } catch (e) {
    console.warn('[patch] nested @react-native/babel-preset scan failed (non-fatal):', e.message);
  }
})();

// ── 4. Broad scan: any pnpm entry that contains a nested copy ────────────────
//  Catches future new hosts without needing to add them explicitly.
(function broadScanPnpmStore() {
  if (!fs.existsSync(pnpmDir)) return;
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      // Only scan Babel-related packages to keep startup time low
      if (
        !entry.startsWith('babel-') &&
        !entry.startsWith('@babel+') &&
        !entry.startsWith('@react-native+') &&
        !entry.includes('babel-preset') &&
        !entry.includes('babel-plugin')
      ) continue;

      const entryNodeModules = path.join(pnpmDir, entry, 'node_modules');
      if (!fs.existsSync(entryNodeModules)) continue;

      // Look one level deep inside each package's own node_modules
      try {
        for (const pkg of fs.readdirSync(entryNodeModules)) {
          if (pkg !== 'babel-plugin-syntax-hermes-parser') {
            // Check nested @scope/package
            const scopeDir = path.join(entryNodeModules, pkg);
            try {
              if (fs.statSync(scopeDir).isDirectory()) {
                for (const sub of fs.readdirSync(scopeDir)) {
                  if (sub === 'babel-plugin-syntax-hermes-parser') {
                    patchPluginBase(path.join(scopeDir, sub));
                  }
                }
              }
            } catch { /* skip */ }
            continue;
          }
          patchPluginBase(path.join(entryNodeModules, pkg));
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    console.warn('[patch] broad pnpm scan failed (non-fatal):', e.message);
  }
})();

// ── 5. Well-known flat paths (non-pnpm installs) ─────────────────────────────
patchPluginBase(path.join(ROOT, 'node_modules', 'babel-plugin-syntax-hermes-parser'));
patchPluginBase(path.join(ROOT, 'node_modules', 'babel-preset-expo',
  'node_modules', 'babel-plugin-syntax-hermes-parser'));
patchPluginBase(path.join(ROOT, 'node_modules', '@react-native', 'babel-preset',
  'node_modules', 'babel-plugin-syntax-hermes-parser'));
