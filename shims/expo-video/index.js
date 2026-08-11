/**
 * expo-video shim (all platforms)
 *
 * The native Android module (VideoManager → VideoCache → media3 SimpleCache)
 * throws "Another SimpleCache instance uses the folder" when the OnSpace
 * preview APK already holds a SimpleCache instance and our bundle tries to
 * register a second one via NativeUnimoduleProxy on startup.
 *
 * This shim operates at three JS layers:
 *  1. Babel plugin (babel.config.js) — rewrites all `import`/`require` of
 *     'expo-video' and 'expo-video/*' to this file at transform time.
 *  2. Metro resolveRequest (metro.config.js) — intercepts at bundler level.
 *  3. extraNodeModules (metro.config.js) — directory-level redirect.
 *
 * The native crash is prevented at the native layer by:
 *  4. react-native.config.js — disables native auto-linking.
 *  5. app.json expo-build-properties — excludePackages + blockedModules.
 *  6. shims/expo-video/package.json — expo.autolinking: false.
 *
 * If the native module still initialises (e.g. already present in the host
 * APK), this shim prevents any JS code from touching it.
 */

'use strict';

const React = require('react');
const { View } = require('react-native');

// ─── NativeUnimoduleProxy guard ───────────────────────────────────────────────
// The Android VideoManager registers itself via NativeUnimoduleProxy.getConstants()
// which crashes with "Another SimpleCache instance uses the folder" when the host
// APK (OnSpace preview) already holds the Media3 SimpleCache lock.
// We intercept NativeModules.NativeUnimoduleProxy before any module references
// it, replacing the crashing VideoManager constants with safe empty stubs.
//
// This must run synchronously at shim load time (before Expo module registry
// iterates registered modules), which is guaranteed because babel.config.js
// rewrites every `import 'expo-video'` to this file at transform time.
try {
  const { NativeModules } = require('react-native');
  if (NativeModules && NativeModules.NativeUnimoduleProxy) {
    const proxy = NativeModules.NativeUnimoduleProxy;
    const _origGetConstants = proxy.getConstants
      ? proxy.getConstants.bind(proxy)
      : null;
    if (_origGetConstants) {
      proxy.getConstants = function safeGetConstants() {
        try {
          return _origGetConstants();
        } catch (e) {
          // Swallow VideoCache / SimpleCache crashes; return minimal safe shape
          if (__DEV__) console.warn('[expo-video shim] NativeUnimoduleProxy.getConstants() suppressed:', e && e.message);
          return { modulesConstants: {}, viewManagersNames: [] };
        }
      };
    }
    // Also patch the exportedMethods / modulesConstants accessors used by
    // expo-modules-core when building the module registry.
    const _origExportedMethods = proxy.exportedMethods;
    if (_origExportedMethods && typeof _origExportedMethods === 'object') {
      try {
        // Remove ExpoVideo entries so the registry never tries to call the
        // crashing native VideoManager.
        delete _origExportedMethods['ExpoVideo'];
        delete _origExportedMethods['ExpoVideoView'];
      } catch (_) { /* read-only — ignore */ }
    }
  }
} catch (_) { /* NativeModules not available in SSR — safe to ignore */ }

// ─── VideoView ────────────────────────────────────────────────────────────────
function VideoView(props) {
  // Strip expo-video-specific props that View doesn't understand
  const { player, contentFit, nativeControls, allowsFullscreen, ...rest } = props || {};
  return React.createElement(View, rest || {});
}
VideoView.displayName = 'VideoView';

// ─── useVideoPlayer ───────────────────────────────────────────────────────────
function useVideoPlayer(_source, _setup) {
  return {
    play:                      function () {},
    pause:                     function () {},
    replace:                   function () {},
    seekBy:                    function () {},
    replay:                    function () {},
    generateThumbnailsAsync:   async function () { return []; },
    addListener:               function () { return { remove: function () {} }; },
    removeAllListeners:        function () {},
    currentTime:               0,
    duration:                  0,
    paused:                    true,
    playing:                   false,
    muted:                     false,
    volume:                    1,
    playbackRate:               1,
    status:                    'idle',
    loop:                      false,
    timeUpdateEventThrottle:   0,
    bufferedPosition:          0,
    playableDuration:           0,
  };
}

// ─── VideoPlayer class shim ───────────────────────────────────────────────────
function VideoPlayer() { this.status = 'idle'; }
VideoPlayer.prototype.play              = function () {};
VideoPlayer.prototype.pause             = function () {};
VideoPlayer.prototype.replace           = function () {};
VideoPlayer.prototype.seekBy            = function () {};
VideoPlayer.prototype.replay            = function () {};
VideoPlayer.prototype.generateThumbnailsAsync = async function () { return []; };
VideoPlayer.prototype.addListener       = function () { return { remove: function () {} }; };
VideoPlayer.prototype.removeAllListeners = function () {};

// ─── NativeExpoVideo shim ─────────────────────────────────────────────────────
// Prevents any code that reaches requireNativeModule('ExpoVideo') from crashing.
const NativeExpoVideo = {
  setAudioCategory: function () { return Promise.resolve(); },
  setAudioMode:     function () { return Promise.resolve(); },
};

// ─── requireNativeModule guard ────────────────────────────────────────────────
// expo-modules-core's requireNativeModule('ExpoVideo') is called at import
// time by the real expo-video JS. Intercept it here so this shim always
// returns a safe object even if the JS barrel import wasn't fully tree-shaken.
try {
  const expoModulesCore = require('expo-modules-core');
  if (expoModulesCore && typeof expoModulesCore.requireNativeModule === 'function') {
    const _orig = expoModulesCore.requireNativeModule.bind(expoModulesCore);
    expoModulesCore.requireNativeModule = function (name) {
      if (name === 'ExpoVideo' || name === 'expo-video') return NativeExpoVideo;
      return _orig(name);
    };
  }
} catch (_) { /* expo-modules-core not available — safe to ignore */ }

module.exports = {
  VideoView,
  useVideoPlayer,
  VideoPlayer,
  NativeExpoVideo,
  default: { VideoView, useVideoPlayer, VideoPlayer },
};
