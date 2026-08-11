/**
 * react-native.config.js
 *
 * Disables native auto-linking for packages whose native Android modules
 * conflict with the OnSpace preview environment.
 *
 * expo-video: its VideoManager initialises a media3 SimpleCache on app start
 * (before any JS runs), and throws "Another SimpleCache instance uses the
 * folder" when the preview APK already holds a SimpleCache lock — crashing
 * the Hermes runtime before AppRegistry.registerComponent is ever called.
 *
 * Disabling here prevents the VideoModule native code from being compiled
 * into the APK at all, so the SimpleCache is never instantiated.
 *
 * Combined with:
 *  - metro.config.js resolveRequest shim (JS-level no-op)
 *  - app.json newArchEnabled: false (avoids New Architecture TurboModule issues)
 *  - expo-build-properties excludePackages (Gradle-level exclusion)
 */
module.exports = {
  dependencies: {
    'expo-video': {
      platforms: {
        android: null, // disable native auto-linking on Android
        ios: null,     // disable native auto-linking on iOS
      },
    },
    'react-native-iap': {
      platforms: {
        android: null,
        ios: null,
      },
    },
    'react-native-nitro-modules': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
