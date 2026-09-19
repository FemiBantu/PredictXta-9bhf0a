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
  // Cache per-environment so native and web get different transforms.
  // Using api.cache(true) is safe here because we inspect env vars below
  // and the BABEL_ENV / NODE_ENV values are stable within a given build.
  api.cache.using(() => process.env.BABEL_ENV ?? process.env.NODE_ENV ?? 'development');

  // Detect web / SSR context.
  // Metro sets BABEL_ENV='development'|'production' for native;
  // expo export --platform web sets EXPO_METRO_PLATFORM='web' or 'server'.
  // We must NOT rewrite IAP/nitro imports for native builds — those packages
  // must resolve to their real native implementations via Metro resolveRequest.
  const isWebOrSSR =
    process.env.EXPO_METRO_PLATFORM === 'web' ||
    process.env.EXPO_METRO_PLATFORM === 'server' ||
    process.env.EXPO_TARGET === 'web';

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Inline Babel plugin: rewrite native-only imports to safe shims.
      //
      // IMPORTANT: react-native-iap and react-native-nitro-modules are ONLY
      // shimmed for web/SSR builds. Native builds (android/ios) must receive
      // the real packages so StoreKit / Google Play Billing link correctly.
      //
      // expo-video is shimmed everywhere via Metro resolveRequest (safer),
      // but we keep the Babel-level shim for SSR safety.
      function nativeModuleShims() {
        const webBrowserShim   = path.resolve(__dirname, 'shims/expo-web-browser/index.js');
        const expoVideoShim    = path.resolve(__dirname, 'shims/expo-video/index.js');
        const iapShim          = path.resolve(__dirname, 'shims/react-native-iap/index.js');
        const nitroShim        = path.resolve(__dirname, 'shims/react-native-nitro-modules/index.js');
        const hermesParserStub = path.resolve(__dirname, 'stubs/hermes-parser-plugin.js');

        // Web/SSR: shim ALL native-only modules
        const WEB_SHIM_MAP = {
          'expo-web-browser':                   webBrowserShim,
          'expo-video':                         expoVideoShim,
          'react-native-iap':                   iapShim,
          'react-native-nitro-modules':         nitroShim,
          'babel-plugin-syntax-hermes-parser':  hermesParserStub,
        };
        const WEB_SHIM_PREFIX_MAP = {
          'expo-video/':                        expoVideoShim,
          'expo-web-browser/':                  webBrowserShim,
          'react-native-iap/':                  iapShim,
          'react-native-nitro-modules/':        nitroShim,
          'babel-plugin-syntax-hermes-parser/': hermesParserStub,
        };

        // Native: ONLY shim the hermes-parser Babel plugin (not IAP/nitro).
        // expo-web-browser and expo-video are handled by Metro resolveRequest.
        const NATIVE_SHIM_MAP = {
          'babel-plugin-syntax-hermes-parser': hermesParserStub,
        };
        const NATIVE_SHIM_PREFIX_MAP = {
          'babel-plugin-syntax-hermes-parser/': hermesParserStub,
        };

        const SHIM_MAP        = isWebOrSSR ? WEB_SHIM_MAP        : NATIVE_SHIM_MAP;
        const SHIM_PREFIX_MAP = isWebOrSSR ? WEB_SHIM_PREFIX_MAP : NATIVE_SHIM_PREFIX_MAP;

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
  };
}
