/**
 * shims/global-polyfills.js
 *
 * Injected as the FIRST module via metro serializer.getPolyfills().
 * Runs before ANY app code on all platforms.
 *
 * 1. Patches requireOptionalNativeModule / LegacyEventEmitter onto
 *    react-native and expo-modules-core.
 *
 * 2. [Android] Guards NativeUnimoduleProxy.getConstants() against the
 *    "Another SimpleCache instance uses the folder" crash that occurs in the
 *    OnSpace preview APK when expo-video's VideoManager tries to create a
 *    second Media3 SimpleCache for the same cache directory.
 *
 *    Root cause: The OnSpace host APK bundles its own expo-video and creates
 *    a VideoCache singleton at app start. When our bundle is loaded into the
 *    same process the React Native bridge calls NativeUnimoduleProxy.getConstants()
 *    which triggers VideoManager.onModuleCreated → VideoCache.<init> → second
 *    SimpleCache init → IllegalStateException. This kills the entire Hermes
 *    runtime before AppRegistry.registerComponent is reached, producing
 *    Invariant Violation: "main" has not been registered.
 *
 *    Fix: Wrap getConstants() in a try/catch that returns a safe empty shape
 *    on failure. The VideoView / useVideoPlayer JS API is already shimmed by
 *    shims/expo-video/index.js, so no functionality is lost.
 */

'use strict';

// ─── 1. Core module patches ───────────────────────────────────────────────────
function patchTarget(mod) {
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

try { patchTarget(require('react-native')); } catch (_) {}
try { patchTarget(require('expo-modules-core')); } catch (_) {}

// ─── 2. NativeUnimoduleProxy VideoCache crash guard (Android) ─────────────────
// Must run at polyfill time (before any module loads) because the bridge calls
// getConstants() synchronously during module registry initialisation.
(function guardNativeUnimoduleProxy() {
  try {
    var RN = require('react-native');
    var NativeModules = RN && RN.NativeModules;
    if (!NativeModules) return;

    var proxy = NativeModules.NativeUnimoduleProxy;
    if (!proxy) return;

    // ── Guard getConstants ─────────────────────────────────────────────────────
    var _origGetConstants = proxy.getConstants;
    if (typeof _origGetConstants === 'function') {
      proxy.getConstants = function safeGetConstants() {
        try {
          return _origGetConstants.call(proxy);
        } catch (e) {
          // Swallow VideoCache / SimpleCache crashes
          // Return the minimal shape expected by expo-modules-core
          var msg = (e && (e.message || String(e))) || '';
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(
              '[global-polyfills] NativeUnimoduleProxy.getConstants() threw — ' +
              'suppressing to prevent app crash. Error: ' + msg
            );
          }
          return {
            modulesConstants: {},
            viewManagersNames: [],
            exportedMethods: {},
          };
        }
      };
    }

    // ── Remove ExpoVideo from exportedMethods / modulesConstants ──────────────
    // This prevents expo-modules-core from trying to call the crashing native
    // VideoManager even if getConstants() somehow succeeds partially.
    function safeDelete(obj, key) {
      if (!obj || typeof obj !== 'object') return;
      try { delete obj[key]; } catch (_) {}
    }

    // Try to patch modulesConstants (populated lazily after first getConstants call)
    var origConsts = null;
    try {
      origConsts = proxy.modulesConstants;
    } catch (_) {}
    if (origConsts && typeof origConsts === 'object') {
      safeDelete(origConsts, 'ExpoVideo');
      safeDelete(origConsts, 'ExpoVideoView');
    }

    // Also guard the exportedMethods object
    var origMethods = null;
    try {
      origMethods = proxy.exportedMethods;
    } catch (_) {}
    if (origMethods && typeof origMethods === 'object') {
      safeDelete(origMethods, 'ExpoVideo');
      safeDelete(origMethods, 'ExpoVideoView');
    }

  } catch (_) {
    // React Native not available (SSR / test env) — safe to ignore
  }
})();

// ─── 3. requireNativeModule('ExpoVideo') guard ────────────────────────────────
// expo-modules-core exports requireNativeModule() which is called at import
// time by various Expo packages. Intercept it so 'ExpoVideo' always returns
// a safe no-op object and never throws.
(function guardRequireNativeModule() {
  try {
    var emc = require('expo-modules-core');
    if (!emc || typeof emc.requireNativeModule !== 'function') return;

    var _origRequire = emc.requireNativeModule;
    emc.requireNativeModule = function safeRequireNativeModule(name) {
      if (name === 'ExpoVideo' || name === 'ExpoVideoView') {
        return {
          setAudioCategory: function() { return Promise.resolve(); },
          setAudioMode: function() { return Promise.resolve(); },
        };
      }
      try {
        return _origRequire.call(emc, name);
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[global-polyfills] requireNativeModule("' + name + '") threw:', e && e.message);
        }
        return {};
      }
    };
  } catch (_) {
    // expo-modules-core not available — ignore
  }
})();
