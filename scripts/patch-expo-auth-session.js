#!/usr/bin/env node
/**
 * scripts/patch-expo-auth-session.js
 *
 * Standalone pre-patch for expo-auth-session.
 *
 * Problem:
 *   expo-auth-session@6.x installed via pnpm sometimes has an *empty* build/
 *   directory — only index.js exists, but all the files it requires
 *   (AuthRequest, TokenRequest, PKCE, providers/*, …) are missing.
 *   During `expo export --platform web` the SSR renderer loads the package
 *   via raw Node.js *before* Metro's resolveRequest shim fires, so it crashes
 *   with ERR_MODULE_NOT_FOUND.
 *
 * Fix:
 *   Replace expo-auth-session/build/index.js with a self-contained CJS stub
 *   that exports every public symbol inline — no internal require() calls,
 *   no missing sub-files. The marker comment prevents re-patching.
 *
 * Usage (called automatically from metro.config.js and as a pre-script):
 *   node scripts/patch-expo-auth-session.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── Self-contained stub ──────────────────────────────────────────────────────
// All public symbols from expo-auth-session@6 exported inline.
// Native builds get the real package via Metro's resolveRequest hook.
const STUB = `'use strict';
// __EXPO_AUTH_SESSION_STUB__ — injected by scripts/patch-expo-auth-session.js
// Safe no-op shim used only during SSR / web static export.
// Native builds (android/ios) receive the real package via Metro resolveRequest.
Object.defineProperty(exports, '__esModule', { value: true });

// ── Enums ──────────────────────────────────────────────────────────────────────
exports.Prompt = { None: 'none', Login: 'login', Consent: 'consent', SelectAccount: 'select_account' };
exports.CodeChallengeMethod = { S256: 'S256', Plain: 'plain' };
exports.ResponseType = { Code: 'code', Token: 'token', IdToken: 'id_token' };

// ── Classes / constructors ──────────────────────────────────────────────────────
exports.AuthRequest          = function AuthRequest() {};
exports.AuthError            = function AuthError(code, desc) { this.code = code; this.description = desc; };
exports.TokenRequest         = function TokenRequest() {};
exports.TokenResponse        = function TokenResponse() {};
exports.RefreshTokenRequest  = function RefreshTokenRequest() {};
exports.RevokeTokenRequest   = function RevokeTokenRequest() {};
exports.AccessTokenRequest   = function AccessTokenRequest() {};

// ── Functions ──────────────────────────────────────────────────────────────────
exports.makeRedirectUri       = function makeRedirectUri() { return ''; };
exports.fetchDiscoveryAsync   = function fetchDiscoveryAsync() { return Promise.resolve(null); };
exports.exchangeCodeAsync     = function exchangeCodeAsync() { return Promise.resolve(null); };
exports.refreshAsync          = function refreshAsync() { return Promise.resolve(null); };
exports.revokeAsync           = function revokeAsync() { return Promise.resolve(null); };
exports.loadAsync             = function loadAsync() { return Promise.resolve(null); };
exports.getQueryParams        = function getQueryParams() { return {}; };

// ── Hooks ──────────────────────────────────────────────────────────────────────
exports.useAuthRequest   = function useAuthRequest() { return [null, null, function() { return Promise.resolve(null); }]; };
exports.useAutoDiscovery = function useAutoDiscovery() { return null; };

// ── Providers ─────────────────────────────────────────────────────────────────
exports.Google   = { Discovery: null };
exports.Facebook = { Discovery: null };
exports.Github   = { Discovery: null };
exports.Slack    = { Discovery: null };
exports.Fitbit   = { Discovery: null };
exports.Coinbase = { Discovery: null };
exports.Reddit   = { Discovery: null };
exports.Okta     = { Discovery: null };
exports.Uber     = { Discovery: null };
exports.Spotify  = { Discovery: null };
`;

// ─── Find and patch every pnpm copy of expo-auth-session ─────────────────────
function patchExpoAuthSession(projectRoot) {
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    console.log('[patch-expo-auth-session] No pnpm dir found — skipping');
    return;
  }

  let patched = 0;

  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('expo-auth-session@')) continue;

    const pkgRoot = path.join(pnpmDir, entry, 'node_modules', 'expo-auth-session');
    const buildDir = path.join(pkgRoot, 'build');

    // Ensure build directory exists
    if (!fs.existsSync(buildDir)) {
      try { fs.mkdirSync(buildDir, { recursive: true }); } catch (e) {
        console.warn('[patch-expo-auth-session] Cannot create build dir:', e.message);
        continue;
      }
    }

    const indexPath = path.join(buildDir, 'index.js');

    // Skip if already patched with our stub
    if (fs.existsSync(indexPath)) {
      try {
        const existing = fs.readFileSync(indexPath, 'utf8');
        if (existing.includes('__EXPO_AUTH_SESSION_STUB__')) {
          // Already patched — nothing to do
          continue;
        }
      } catch { /* fall through to overwrite */ }
    }

    // Write the self-contained stub
    try {
      fs.writeFileSync(indexPath, STUB, 'utf8');
      console.log('[patch-expo-auth-session] Patched', path.relative(projectRoot, indexPath));
      patched++;
    } catch (e) {
      console.warn('[patch-expo-auth-session] Write failed for', entry, ':', e.message);
    }

    // Also ensure the providers sub-directory exists (some code imports it directly)
    const providersDir = path.join(buildDir, 'providers');
    if (!fs.existsSync(providersDir)) {
      try { fs.mkdirSync(providersDir, { recursive: true }); } catch { /* */ }
    }
    for (const provider of ['Google', 'Facebook', 'Github', 'Slack', 'Fitbit', 'Coinbase', 'Reddit', 'Okta', 'Uber', 'Spotify', 'Identity']) {
      const provPath = path.join(providersDir, `${provider}.js`);
      if (!fs.existsSync(provPath)) {
        try {
          fs.writeFileSync(provPath,
            `'use strict';\nObject.defineProperty(exports,'__esModule',{value:true});\nexports.Discovery=null;\n`,
            'utf8');
        } catch { /* skip read-only */ }
      }
    }
  }

  if (patched === 0) {
    console.log('[patch-expo-auth-session] Nothing to patch (all copies already stubbed or not found)');
  } else {
    console.log(`[patch-expo-auth-session] Patched ${patched} copy/copies`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
const projectRoot = path.resolve(__dirname, '..');
patchExpoAuthSession(projectRoot);

module.exports = { patchExpoAuthSession };
