'use strict';
/**
 * shims/expo-device/index.js
 *
 * Web/SSR stub for expo-device.
 * expo-device/build/ExpoDevice.web.js reads `isDOMAvailable` from
 * expo-modules-core, which is undefined in the SSR Node.js context and
 * crashes. This shim exports safe no-op values for all exports so the
 * web bundle never loads the native module code.
 */

exports.isDevice = false;
exports.isTablet = false;
exports.brand = null;
exports.manufacturer = null;
exports.modelName = null;
exports.modelId = null;
exports.designName = null;
exports.productName = null;
exports.deviceYearClass = null;
exports.totalMemory = null;
exports.supportedCpuArchitectures = null;
exports.osName = 'web';
exports.osVersion = null;
exports.osBuildId = null;
exports.osInternalBuildId = null;
exports.osBuildFingerprint = null;
exports.platformApiLevel = null;
exports.deviceName = null;

exports.DeviceType = {
  UNKNOWN: 0,
  PHONE: 1,
  TABLET: 2,
  DESKTOP: 3,
  TV: 4,
};

exports.getDeviceTypeAsync = async function getDeviceTypeAsync() {
  return exports.DeviceType.DESKTOP;
};

exports.isRootedExperimentalAsync = async function isRootedExperimentalAsync() {
  return false;
};

exports.getUptimeAsync = async function getUptimeAsync() {
  return 0;
};

exports.getMaxMemoryAsync = async function getMaxMemoryAsync() {
  return 0;
};

exports.isSideLoadingEnabledAsync = async function isSideLoadingEnabledAsync() {
  return false;
};

// Default export mirrors named exports
exports.default = exports;
