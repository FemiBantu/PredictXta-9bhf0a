/**
 * Shim for expo-auth-session.
 *
 * expo-auth-session@6.x has broken build/AuthRequest.js in this environment
 * (the compiled output files are missing from the package), causing a
 * hard ERR_MODULE_NOT_FOUND crash on startup.
 *
 * PredictXta does NOT use expo-auth-session directly — Google OAuth is
 * implemented via expo-web-browser + supabase.auth.signInWithOAuth().
 * The Supabase template auth service references makeRedirectUri() from this
 * package; we stub the entire API so that import resolves without error.
 *
 * The custom URL scheme (predictxta://) is already registered via the
 * top-level "scheme" field in app.json — expo-auth-session is not needed
 * for scheme registration.
 */

'use strict';

var Linking = null;
try { Linking = require('expo-linking'); } catch (e) {}

/**
 * makeRedirectUri — returns the correct deep-link URI for this environment.
 * Standalone builds → predictxta://auth/callback
 * Expo Go / web    → whatever expo-linking generates
 */
function makeRedirectUri(options) {
  options = options || {};

  if (options.native) return options.native;

  // Use expo-linking if available
  if (Linking) {
    try { return Linking.createURL(options.path || 'auth/callback'); } catch (e) {}
  }

  // Safe fallback
  return 'predictxta://auth/callback';
}

var AuthSessionResultType = {
  CANCEL: 'cancel',
  DISMISS: 'dismiss',
  OPENED: 'opened',
  LOCKED: 'locked',
  SUCCESS: 'success',
  ERROR: 'error',
};

function noop() {}
function noopPromise() { return Promise.resolve({ type: 'cancel' }); }

module.exports = {
  // Core helpers used by Supabase template
  makeRedirectUri: makeRedirectUri,

  // Session helpers
  startAsync: noopPromise,
  fetchDiscoveryAsync: noopPromise,

  // Request class stub
  AuthRequest: function AuthRequest() {
    this.promptAsync = noopPromise;
    this.parseReturnUrl = function() { return {}; };
  },

  // Hook stubs
  useAuthRequest: function() { return [null, null, noopPromise]; },
  useAutoDiscovery: function() { return null; },

  // Constants
  AuthSessionResultType: AuthSessionResultType,
  ResponseType: { Code: 'code', Token: 'token', IdToken: 'id_token' },
  CodeChallengeMethod: { S256: 'S256', Plain: 'plain' },
  Prompt: { None: 'none', Login: 'login', Consent: 'consent', SelectAccount: 'select_account' },
};
