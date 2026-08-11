/**
 * shims/expo-notifications/index.js
 *
 * Web-safe shim for expo-notifications.
 *
 * Root cause: expo-notifications/build/NotificationsEmitter.js calls
 *   new ExpoModulesCore.LegacyEventEmitter(...)
 * at module load time. In the web Live Preview `LegacyEventEmitter` is
 * not a constructor (it's undefined on the web build of expo-modules-core),
 * which crashes the entire bundle.
 *
 * This shim:
 *  1. Patches a safe `LegacyEventEmitter` stub onto expo-modules-core BEFORE
 *     the real expo-notifications can import it.
 *  2. Attempts to load the real package for native builds.
 *  3. Falls back to complete no-op stubs for web / Live Preview.
 */

'use strict';

// ─── Patch LegacyEventEmitter on expo-modules-core ───────────────────────────
// Must run before the real expo-notifications loads its NotificationsEmitter.
try {
  var EMC = require('expo-modules-core');

  // Provide a no-op class constructor if missing
  if (typeof EMC.LegacyEventEmitter !== 'function') {
    function LegacyEventEmitter() {}
    LegacyEventEmitter.prototype.addListener = function(_, handler) {
      return { remove: function() {} };
    };
    LegacyEventEmitter.prototype.removeAllListeners = function() {};
    LegacyEventEmitter.prototype.emit = function() {};

    Object.defineProperty(EMC, 'LegacyEventEmitter', {
      value: LegacyEventEmitter,
      writable: true,
      configurable: true,
    });
  }

  // Also patch requireOptionalNativeModule while we're here
  if (typeof EMC.requireOptionalNativeModule !== 'function') {
    Object.defineProperty(EMC, 'requireOptionalNativeModule', {
      value: function() { return null; },
      writable: true,
      configurable: true,
    });
  }
} catch (e) { /* expo-modules-core unavailable — skip */ }

// Also patch on the react-native module for older expo packages
try {
  var RN = require('react-native');
  if (typeof RN.requireOptionalNativeModule !== 'function') {
    Object.defineProperty(RN, 'requireOptionalNativeModule', {
      value: function() { return null; },
      writable: true,
      configurable: true,
    });
  }
} catch (e) { /* skip */ }

// ─── Try loading the real expo-notifications ──────────────────────────────────
var real = null;
try {
  real = require('expo-notifications/build/index');
} catch (e) {
  real = null;
}

// ─── No-op subscription ───────────────────────────────────────────────────────
function noopSubscription() {
  return { remove: function() {} };
}

// ─── No-op async ─────────────────────────────────────────────────────────────
function noopAsync() { return Promise.resolve(null); }
function noop() {}

// ─── Safe notification permission result ─────────────────────────────────────
var permissionResult = {
  status: 'undetermined',
  expires: 'never',
  granted: false,
  canAskAgain: false,
};

// ─── Export ───────────────────────────────────────────────────────────────────
if (real && (real.addNotificationReceivedListener || real.default)) {
  module.exports = real;
} else {
  // Full no-op surface matching expo-notifications public API
  module.exports = {
    // ── Listener registration ───────────────────────────────────────────────
    addNotificationReceivedListener: function() { return noopSubscription(); },
    addNotificationResponseReceivedListener: function() { return noopSubscription(); },
    addPushTokenListener: function() { return noopSubscription(); },
    addNotificationsDroppedListener: function() { return noopSubscription(); },
    removeNotificationSubscription: noop,

    // ── Scheduling ─────────────────────────────────────────────────────────
    scheduleNotificationAsync: noopAsync,
    cancelScheduledNotificationAsync: noopAsync,
    cancelAllScheduledNotificationsAsync: noopAsync,
    getAllScheduledNotificationsAsync: function() { return Promise.resolve([]); },

    // ── Permissions ─────────────────────────────────────────────────────────
    requestPermissionsAsync: function() { return Promise.resolve(permissionResult); },
    getPermissionsAsync: function() { return Promise.resolve(permissionResult); },

    // ── Push tokens ─────────────────────────────────────────────────────────
    getExpoPushTokenAsync: function() { return Promise.resolve({ type: 'expo', data: '' }); },
    getDevicePushTokenAsync: function() { return Promise.resolve({ type: 'web', data: '' }); },

    // ── Badge ────────────────────────────────────────────────────────────────
    getBadgeCountAsync: function() { return Promise.resolve(0); },
    setBadgeCountAsync: noopAsync,

    // ── Presented notifications ──────────────────────────────────────────────
    getPresentedNotificationsAsync: function() { return Promise.resolve([]); },
    dismissNotificationAsync: noopAsync,
    dismissAllNotificationsAsync: noopAsync,

    // ── Last response ────────────────────────────────────────────────────────
    getLastNotificationResponseAsync: function() { return Promise.resolve(null); },

    // ── Handler ──────────────────────────────────────────────────────────────
    setNotificationHandler: noop,
    getNotificationChannelsAsync: function() { return Promise.resolve([]); },
    setNotificationChannelAsync: noopAsync,
    deleteNotificationChannelAsync: noopAsync,
    getNotificationChannelGroupsAsync: function() { return Promise.resolve([]); },
    setNotificationChannelGroupAsync: noopAsync,
    deleteNotificationChannelGroupAsync: noopAsync,

    // ── Category / trigger enums ──────────────────────────────────────────────
    AndroidImportance: { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
    AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
    IosAlertStyle: { NONE: 0, BANNER: 1, ALERT: 2 },
    SchedulableTriggerInputTypes: {
      DATE: 'date',
      DAILY: 'daily',
      WEEKLY: 'weekly',
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
      TIME_INTERVAL: 'timeInterval',
      CALENDAR: 'calendar',
    },

    // Named export default (some consumers: import Notifications from 'expo-notifications')
    default: {
      addNotificationReceivedListener: function() { return noopSubscription(); },
      addNotificationResponseReceivedListener: function() { return noopSubscription(); },
      addPushTokenListener: function() { return noopSubscription(); },
      scheduleNotificationAsync: noopAsync,
      cancelScheduledNotificationAsync: noopAsync,
      cancelAllScheduledNotificationsAsync: noopAsync,
      getAllScheduledNotificationsAsync: function() { return Promise.resolve([]); },
      requestPermissionsAsync: function() { return Promise.resolve(permissionResult); },
      getPermissionsAsync: function() { return Promise.resolve(permissionResult); },
      getExpoPushTokenAsync: function() { return Promise.resolve({ type: 'expo', data: '' }); },
      getDevicePushTokenAsync: function() { return Promise.resolve({ type: 'web', data: '' }); },
      getBadgeCountAsync: function() { return Promise.resolve(0); },
      setBadgeCountAsync: noopAsync,
      getPresentedNotificationsAsync: function() { return Promise.resolve([]); },
      dismissAllNotificationsAsync: noopAsync,
      getLastNotificationResponseAsync: function() { return Promise.resolve(null); },
      setNotificationHandler: noop,
    },
  };
}
