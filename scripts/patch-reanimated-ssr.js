/**
 * scripts/patch-reanimated-ssr.js
 *
 * Patches react-native-reanimated's Node.js module to add resetServerContext
 * as a no-op, so expo-router's static SSR renderer doesn't crash.
 *
 * This runs via the "postinstall" script or can be called manually.
 * It finds the actual reanimated index.js that Node.js resolves and appends
 * the missing export if not already present.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

// Resolve the reanimated main entry exactly as Node.js would
let reanimatedPath;
try {
  reanimatedPath = require.resolve('react-native-reanimated');
} catch (e) {
  console.log('[patch-reanimated-ssr] Could not resolve react-native-reanimated:', e.message);
  process.exit(0);
}

console.log('[patch-reanimated-ssr] Found reanimated at:', reanimatedPath);

try {
  const content = fs.readFileSync(reanimatedPath, 'utf8');

  if (content.includes('resetServerContext')) {
    console.log('[patch-reanimated-ssr] resetServerContext already present — no patch needed.');
    process.exit(0);
  }

  // Append the no-op export
  const patch = `
// ── SSR patch: expo-router's renderStaticContent.js calls resetServerContext ──
if (typeof exports !== 'undefined' && typeof exports.resetServerContext !== 'function') {
  exports.resetServerContext = function resetServerContext() {};
}
if (typeof module !== 'undefined' && module.exports && typeof module.exports.resetServerContext !== 'function') {
  module.exports.resetServerContext = function resetServerContext() {};
}
`;

  fs.writeFileSync(reanimatedPath, content + patch, 'utf8');
  console.log('[patch-reanimated-ssr] Patched successfully.');
} catch (e) {
  console.warn('[patch-reanimated-ssr] Patch failed (non-fatal):', e.message);
}
