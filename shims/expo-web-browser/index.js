/**
 * Shim for expo-web-browser.
 *
 * Uses the real expo-web-browser package when available (native builds),
 * falling back gracefully for web/preview environments where the native
 * module may not be registered.
 *
 * For Google OAuth this is critical: openAuthSessionAsync MUST open a real
 * browser session and resolve with the redirect URL containing the auth code.
 */

'use strict';

var WebBrowserResultType = {
  CANCEL: 'cancel',
  DISMISS: 'dismiss',
  OPENED: 'opened',
  LOCKED: 'locked',
};

function noop() {}
function noopAsync() { return Promise.resolve({ type: 'cancel' }); }
function noopBrowsers() {
  return Promise.resolve({
    browserPackages: [],
    defaultBrowserPackage: null,
    servicePackages: [],
    preferredBrowserPackage: null,
  });
}

// Try to use the real expo-web-browser native implementation.
// In a managed Expo build the native module IS registered and the real
// package works correctly. Only fall back to no-ops when unavailable.
var real = null;
try {
  // Attempt to require the actual package; bypass this shim file by using
  // the internal path resolution to the node_modules version.
  real = require('expo-web-browser/build/WebBrowser');
} catch (e) {
  try {
    // Second attempt — some bundler configs resolve differently
    var RNModules = require('react-native').NativeModules;
    if (RNModules && RNModules.ExpoWebBrowser) {
      real = require('expo-web-browser/src/WebBrowser');
    }
  } catch (e2) {
    // Native module not available — use no-ops below
    real = null;
  }
}

function pick(obj, key, fallback) {
  return (obj && typeof obj[key] === 'function') ? obj[key].bind(obj) : fallback;
}

module.exports = {
  openBrowserAsync:                     pick(real, 'openBrowserAsync',                     noopAsync),
  openAuthSessionAsync:                 pick(real, 'openAuthSessionAsync',                 noopAsync),
  dismissBrowser:                       pick(real, 'dismissBrowser',                       noop),
  dismissAuthSession:                   pick(real, 'dismissAuthSession',                   noop),
  coolDownAsync:                        pick(real, 'coolDownAsync',                        noopAsync),
  warmUpAsync:                          pick(real, 'warmUpAsync',                          noopAsync),
  mayInitWithUrlAsync:                  pick(real, 'mayInitWithUrlAsync',                  noopAsync),
  getCustomTabsSupportingBrowsersAsync: pick(real, 'getCustomTabsSupportingBrowsersAsync', noopBrowsers),
  maybeCompleteAuthSession:             pick(real, 'maybeCompleteAuthSession',             noop),
  WebBrowserResultType: WebBrowserResultType,
};
