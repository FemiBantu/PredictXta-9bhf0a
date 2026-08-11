/**
 * react-native-nitro-modules shim
 *
 * react-native-nitro-modules requires TurboModules / New Architecture which
 * is not available in the OnSpace preview environment. This no-op shim
 * prevents the "Failed to get NitroModules" crash on Android.
 */

'use strict';

module.exports = {};
