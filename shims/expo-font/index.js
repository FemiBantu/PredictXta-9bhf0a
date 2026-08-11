'use strict';

/**
 * Web/SSR shim for expo-font.
 *
 * expo-font's web build (ExpoFontUtils.web.js) extends a class from
 * expo-modules-core that resolves to `undefined` in the Live Preview
 * bundler, causing "Class extends value undefined" crash.
 *
 * Additionally, expo-router's renderStaticContent.js calls:
 *   const Font = require("expo-font/build/server");
 *   Font.resetServerContext();   <-- requires this export
 *   Font.getServerResources();   <-- requires this export
 *
 * This shim stubs all public expo-font APIs including the server-side
 * SSR helpers so both web builds and SSR static export succeed.
 */

function noop() {}
function noopAsync() { return Promise.resolve(); }

var useFonts = function() { return [true, null]; };
var isLoaded = function() { return true; };
var isLoading = function() { return false; };

var FontDisplay = {
  AUTO: 'auto',
  BLOCK: 'block',
  SWAP: 'swap',
  FALLBACK: 'fallback',
  OPTIONAL: 'optional',
};

function loadAsync() { return Promise.resolve(); }
function unloadAllAsync() { return Promise.resolve(); }
function processFontFamily(name) { return name; }

// ── SSR server-context helpers (expo-font/build/server) ──────────────────────
// Called by expo-router's renderStaticContent.js before each static render.
function resetServerContext() {}
function getServerResources() { return []; }

var api = {
  loadAsync: loadAsync,
  unloadAllAsync: unloadAllAsync,
  isLoaded: isLoaded,
  isLoading: isLoading,
  useFonts: useFonts,
  processFontFamily: processFontFamily,
  FontDisplay: FontDisplay,
  // SSR
  resetServerContext: resetServerContext,
  getServerResources: getServerResources,
};

module.exports = Object.assign({}, api, { default: api });
