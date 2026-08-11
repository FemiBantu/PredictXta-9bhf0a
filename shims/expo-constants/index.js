/**
 * shims/expo-constants/index.js
 *
 * Web-safe shim for expo-constants.
 *
 * Patches `requireOptionalNativeModule` on BOTH react-native AND
 * expo-modules-core before any expo package can call it at import time.
 */

'use strict';

// ─── Patch helper ─────────────────────────────────────────────────────────────
function patchModule(mod) {
  if (!mod || typeof mod !== 'object') return;
  if (typeof mod.requireOptionalNativeModule !== 'function') {
    try {
      Object.defineProperty(mod, 'requireOptionalNativeModule', {
        value: function() { return null; },
        writable: true, configurable: true,
      });
    } catch (_) {
      try { mod.requireOptionalNativeModule = function() { return null; }; } catch (__) {}
    }
  }
  if (typeof mod.LegacyEventEmitter !== 'function') {
    try {
      function LegacyEventEmitter() {}
      LegacyEventEmitter.prototype.addListener = function() { return { remove: function() {} }; };
      LegacyEventEmitter.prototype.removeAllListeners = function() {};
      LegacyEventEmitter.prototype.emit = function() {};
      Object.defineProperty(mod, 'LegacyEventEmitter', {
        value: LegacyEventEmitter, writable: true, configurable: true,
      });
    } catch (_) {}
  }
}

try { patchModule(require('react-native')); } catch (_) {}
try { patchModule(require('expo-modules-core')); } catch (_) {}

// ─── Try loading the real expo-constants ──────────────────────────────────────
var real = null;
try {
  real = require('expo-constants/build/Constants');
} catch (e1) {
  try { real = require('expo-constants/build/ExpoConstants'); } catch (e2) { real = null; }
}

// ─── Safe default manifest ────────────────────────────────────────────────────
var safeManifest = {
  name: 'PredictXta', slug: 'predictxta', version: '1.0.0',
  scheme: 'predictxta', extra: {},
};

var safeConstants = {
  appOwnership: null, debugMode: false, deviceName: undefined,
  deviceYearClass: null, executionEnvironment: 'standalone',
  experienceUrl: 'predictxta://', expoConfig: safeManifest,
  expoGoConfig: null, expoRuntimeVersion: null, expoVersion: null,
  installationId: 'web-preview', isDetached: false, isHeadless: false,
  linkingUri: 'predictxta://', manifest: safeManifest, manifest2: null,
  nativeAppVersion: '1.0.0', nativeBuildVersion: '1',
  platform: { web: {} }, sessionId: 'web-session',
  statusBarHeight: 0, systemFonts: [], systemVersion: undefined,
};

if (real && real.default && typeof real.default === 'object') {
  module.exports = real;
} else {
  module.exports = {
    default: safeConstants,
    ExecutionEnvironment: {
      Bare: 'bare', StoreClient: 'storeClient', Standalone: 'standalone',
    },
  };
}
