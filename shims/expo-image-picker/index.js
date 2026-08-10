// SSR / web shim for expo-image-picker
'use strict';

const noop = () => Promise.resolve({ canceled: true, assets: [] });

module.exports = {
  requestCameraPermissionsAsync: () => Promise.resolve({ status: 'denied', granted: false }),
  requestMediaLibraryPermissionsAsync: () => Promise.resolve({ status: 'denied', granted: false }),
  launchCameraAsync: noop,
  launchImageLibraryAsync: noop,
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
  ImagePickerResult: {},
};
