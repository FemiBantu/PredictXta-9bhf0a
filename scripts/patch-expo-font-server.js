/**
 * scripts/patch-expo-font-server.js
 *
 * Patches expo-font/build/server.js in the pnpm store to add the
 * resetServerContext and getServerResources exports required by
 * expo-router's SSR static renderer (renderStaticContent.js).
 *
 * Run via: node scripts/patch-expo-font-server.js
 * Or hook into package.json postinstall.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const pnpmDir = path.join(__dirname, '..', 'node_modules', '.pnpm');

const PATCH = `
// ── SSR patch: expo-router's renderStaticContent.js calls these ──────────────
if (typeof exports.resetServerContext !== 'function') {
  exports.resetServerContext = function resetServerContext() {};
}
if (typeof exports.getServerResources !== 'function') {
  exports.getServerResources = function getServerResources() { return []; };
}
`;

function patchFile(serverPath) {
  try {
    const content = fs.readFileSync(serverPath, 'utf8');
    if (content.includes('resetServerContext') && content.includes('getServerResources')) {
      console.log('[patch] Already patched:', serverPath);
      return;
    }
    fs.writeFileSync(serverPath, content + PATCH, 'utf8');
    console.log('[patch] Patched:', serverPath);
  } catch (e) {
    console.warn('[patch] Failed to patch', serverPath, ':', e.message);
  }
}

if (!fs.existsSync(pnpmDir)) {
  console.log('[patch] No .pnpm directory found — skipping.');
  process.exit(0);
}

const entries = fs.readdirSync(pnpmDir);
let patched = 0;

for (const entry of entries) {
  // expo-font@x.y.z
  if (entry.startsWith('expo-font@')) {
    const serverPath = path.join(pnpmDir, entry, 'node_modules', 'expo-font', 'build', 'server.js');
    if (fs.existsSync(serverPath)) { patchFile(serverPath); patched++; }
  }
  // expo-router@x.y.z may bundle its own copy of expo-font
  if (entry.startsWith('expo-router@') || entry.startsWith('expo@')) {
    const serverPath = path.join(pnpmDir, entry, 'node_modules', 'expo-font', 'build', 'server.js');
    if (fs.existsSync(serverPath)) { patchFile(serverPath); patched++; }
  }
}

if (patched === 0) {
  console.log('[patch] No expo-font/build/server.js files found to patch.');
}
