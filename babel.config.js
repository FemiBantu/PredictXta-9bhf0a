const path = require('path');

// Patch hermes-parser Babel plugin before Babel initialises — the transform
// worker requires babel-preset-expo which in turn loads
// babel-plugin-syntax-hermes-parser. If that plugin tries to load a missing
// native hermes-parser binding it crashes the entire worker process.
// Running the patch here ensures the stub is in place before any preset loads.
try { require('./scripts/patch-hermes-parser-plugin.js'); } catch (e) {
  console.warn('[babel] hermes-parser patch skipped:', e.message);
}

module.exports = function (api) {
  api.cache(false)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Inline Babel plugin: rewrite `expo-web-browser` imports to our shim
      // at source-transform time — before Metro bundling, before caching,
      // and before any native Android module can be initialized under Hermes.
      function nativeModuleShims() {
        const webBrowserShim = path.resolve(__dirname, 'shims/expo-web-browser/index.js');
        const expoVideoShim = path.resolve(__dirname, 'shims/expo-video/index.js');
        const iapShim = path.resolve(__dirname, 'shims/react-native-iap/index.js');
        const nitroShim = path.resolve(__dirname, 'shims/react-native-nitro-modules/index.js');
        const hermesParserStub = path.resolve(__dirname, 'stubs/hermes-parser-plugin.js');
        const SHIM_MAP = {
          'expo-web-browser': webBrowserShim,
          'expo-video': expoVideoShim,
          'react-native-iap': iapShim,
          'react-native-nitro-modules': nitroShim,
          'babel-plugin-syntax-hermes-parser': hermesParserStub,
        };
        // Prefix map for sub-path imports (e.g. 'expo-video/build/VideoView')
        const SHIM_PREFIX_MAP = {
          'expo-video/': expoVideoShim,
          'expo-web-browser/': webBrowserShim,
          'react-native-iap/': iapShim,
          'react-native-nitro-modules/': nitroShim,
          'babel-plugin-syntax-hermes-parser/': hermesParserStub,
        };
        function resolveShim(val) {
          if (SHIM_MAP[val]) return SHIM_MAP[val];
          for (const prefix of Object.keys(SHIM_PREFIX_MAP)) {
            if (val.startsWith(prefix)) return SHIM_PREFIX_MAP[prefix];
          }
          return null;
        }
        return {
          visitor: {
            ImportDeclaration(nodePath) {
              const val = nodePath.node.source.value;
              const shim = resolveShim(val);
              if (shim) nodePath.node.source.value = shim;
            },
            CallExpression(nodePath) {
              const { callee, arguments: args } = nodePath.node;
              if (
                callee.type === 'Identifier' && callee.name === 'require' &&
                args.length === 1 &&
                args[0].type === 'StringLiteral'
              ) {
                const shim = resolveShim(args[0].value);
                if (shim) args[0].value = shim;
              }
            },
          },
        };
      },
    ],
  }
}
