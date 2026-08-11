// SSR / web shim for expo-file-system
'use strict';

const EncodingType = { Base64: 'base64', UTF8: 'utf8' };

module.exports = {
  EncodingType,
  documentDirectory: null,
  cacheDirectory: null,
  readAsStringAsync: () => Promise.resolve(''),
  writeAsStringAsync: () => Promise.resolve(),
  deleteAsync: () => Promise.resolve(),
  getInfoAsync: () => Promise.resolve({ exists: false, isDirectory: false }),
  makeDirectoryAsync: () => Promise.resolve(),
  readDirectoryAsync: () => Promise.resolve([]),
  copyAsync: () => Promise.resolve(),
  moveAsync: () => Promise.resolve(),
  downloadAsync: () => Promise.resolve({ uri: '', status: 0, headers: {}, md5: '' }),
};
