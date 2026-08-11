/**
 * shims/expo-splash-screen/index.js
 *
 * Web-safe shim for expo-splash-screen.
 *
 * expo-router's splash.js + Splash.js call `requireOptionalNativeModule`
 * (a React Native internal) at module load time. In the web Live Preview
 * this crashes because the native module registry is not available.
 *
 * This shim:
 *  1. Patches `requireOptionalNativeModule` on BOTH react-native AND
 *     expo-modules-core BEFORE the real expo-splash-screen can call it.
 *  2. Attempts to load the real expo-splash-screen for native builds.
 *  3. Falls back to safe no-op implementations for web/preview.
 */

'use strict';

// ─── Patch helper ─────────────────────────────────────────────────────────────
function patchRequireOptionalNativeModule(mod) {
  if (!mod || typeof mod !== 'object') return;
  if (typeof mod.requireOptionalNativeModule !== 'function') {
    try {
      Object.defineProperty(mod, 'requireOptionalNativeModule', {
        value: function requireOptionalNativeModule() { return null; },
        writable: true,
        configurable: true,
      });
    } catch (e) {
      try { mod.requireOptionalNativeModule = function() { return null; }; } catch (_) {}
    }
  }
  // Also patch NativeModulesProxy and EventEmitter stubs
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

// ─── Patch react-native ───────────────────────────────────────────────────────
try { patchRequireOptionalNativeModule(require('react-native')); } catch (_) {}

// ─── Patch expo-modules-core ──────────────────────────────────────────────────
// Must happen before expo-splash-screen/build/index loads NativeModulesProxy
try { patchRequireOptionalNativeModule(require('expo-modules-core')); } catch (_) {}

// ─── Also patch via NativeModulesProxy path used in splash ───────────────────
try {
  var EMC = require('expo-modules-core');
  if (EMC && !EMC.NativeModulesProxy) {
    try {
      Object.defineProperty(EMC, 'NativeModulesProxy', {
        value: {},
        writable: true,
        configurable: true,
      });
    } catch (_) {}
  }
} catch (_) {}

// ─── Try loading the real package ────────────────────────────────────────────
var real = null;
try {
  real = require('expo-splash-screen/build/index');
} catch (e1) {
  try {
    real = require('expo-splash-screen/build/SplashScreen');
  } catch (e2) {
    real = null;
  }
}

// ─── No-op implementations ────────────────────────────────────────────────────
function noopAsync() { return Promise.resolve(); }
function noop() {}

// ─── Export ───────────────────────────────────────────────────────────────────
if (real && (real.preventAutoHideAsync || real.default)) {
  module.exports = real;
} else {
  var stub = {
    preventAutoHideAsync: noopAsync,
    hideAsync: noopAsync,
    hide: noop,
    show: noop,
    setOptions: noop,
    SplashScreenNativeModule: null,
  };
  // Named export default
  stub.default = {
    preventAutoHideAsync: noopAsync,
    hideAsync: noopAsync,
    hide: noop,
    show: noop,
    setOptions: noop,
  };
  module.exports = stub;
}
