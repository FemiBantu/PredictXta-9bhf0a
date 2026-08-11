'use strict';

/**
 * Web shim for expo-apple-authentication.
 * Apple Sign-In is only available on native iOS builds.
 * On web / Android we stub all exports so the bundler doesn't crash.
 */

var AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };
var AppleAuthenticationOperation = { LOGIN: 0, REFRESH: 1, LOGOUT: 2, IMPLICIT: 3 };
var AppleAuthenticationButtonType = { SIGN_IN: 0, CONTINUE: 2 };
var AppleAuthenticationButtonStyle = { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 };
var AppleAuthenticationCredentialState = { REVOKED: 0, AUTHORIZED: 1, NOT_FOUND: 2, TRANSFERRED: 3 };
var AppleAuthenticationRealUserStatus = { UNSUPPORTED: 0, UNKNOWN: 1, LIKELY_REAL: 2 };

function isAvailableAsync() {
  return Promise.resolve(false);
}

function signInAsync() {
  return Promise.reject(new Error('Apple Sign-In is not available on this platform.'));
}

function refreshAsync() {
  return Promise.reject(new Error('Apple Sign-In is not available on this platform.'));
}

function signOutAsync() {
  return Promise.reject(new Error('Apple Sign-In is not available on this platform.'));
}

function getCredentialStateAsync() {
  return Promise.resolve(AppleAuthenticationCredentialState.NOT_FOUND);
}

function AppleAuthenticationButton() { return null; }

module.exports = {
  isAvailableAsync: isAvailableAsync,
  signInAsync: signInAsync,
  refreshAsync: refreshAsync,
  signOutAsync: signOutAsync,
  getCredentialStateAsync: getCredentialStateAsync,
  AppleAuthenticationButton: AppleAuthenticationButton,
  AppleAuthenticationScope: AppleAuthenticationScope,
  AppleAuthenticationOperation: AppleAuthenticationOperation,
  AppleAuthenticationButtonType: AppleAuthenticationButtonType,
  AppleAuthenticationButtonStyle: AppleAuthenticationButtonStyle,
  AppleAuthenticationCredentialState: AppleAuthenticationCredentialState,
  AppleAuthenticationRealUserStatus: AppleAuthenticationRealUserStatus,
  default: {
    isAvailableAsync: isAvailableAsync,
    signInAsync: signInAsync,
    refreshAsync: refreshAsync,
    signOutAsync: signOutAsync,
    getCredentialStateAsync: getCredentialStateAsync,
    AppleAuthenticationButton: AppleAuthenticationButton,
    AppleAuthenticationScope: AppleAuthenticationScope,
    AppleAuthenticationOperation: AppleAuthenticationOperation,
    AppleAuthenticationButtonType: AppleAuthenticationButtonType,
    AppleAuthenticationButtonStyle: AppleAuthenticationButtonStyle,
    AppleAuthenticationCredentialState: AppleAuthenticationCredentialState,
    AppleAuthenticationRealUserStatus: AppleAuthenticationRealUserStatus,
  },
};
