'use strict';
/**
 * react-i18next shim
 * Provides useTranslation, initReactI18next, Trans, and other commonly-used
 * exports so the app bundles on SSR/web when react-i18next is not installed.
 *
 * On native, metro.config.js resolveRequest redirects to the real package
 * found in node_modules/.pnpm.
 */

// ─── Minimal i18next instance proxy ──────────────────────────────────────────
let _i18nInstance = null;

function getI18n() {
  if (_i18nInstance) return _i18nInstance;
  // Try to load the real i18next singleton that services/i18n/index.ts initialised
  try {
    _i18nInstance = require('i18next').default || require('i18next');
    return _i18nInstance;
  } catch {
    return null;
  }
}

function defaultT(key) {
  if (!key) return '';
  // Return just the last segment after the last dot as a readable fallback
  const parts = String(key).split('.');
  return parts[parts.length - 1] || key;
}

// ─── useTranslation ───────────────────────────────────────────────────────────
function useTranslation(ns) {
  const i18n = getI18n();
  const t = i18n && typeof i18n.t === 'function'
    ? function(key, opts) { return i18n.t(key, opts); }
    : defaultT;
  return { t, i18n: i18n || {}, ready: !!i18n };
}

// ─── initReactI18next (i18next plugin) ────────────────────────────────────────
// This is passed to i18n.use() — it just needs a type and init method.
const initReactI18next = {
  type: '3rdParty',
  init: function(i18next) {
    // Store reference so useTranslation can access it without importing i18next
    _i18nInstance = i18next;
  },
};

// ─── Trans component (no-op passthrough) ─────────────────────────────────────
function Trans(props) {
  try {
    const React = require('react');
    const children = props.children;
    if (children != null) return children;
    const { t } = useTranslation(props.ns);
    return t(props.i18nKey || '');
  } catch {
    return props.i18nKey || '';
  }
}

// ─── I18nextProvider (passthrough wrapper) ────────────────────────────────────
function I18nextProvider(props) {
  try {
    const React = require('react');
    if (props.i18n && !_i18nInstance) _i18nInstance = props.i18n;
    return React.createElement(React.Fragment, null, props.children);
  } catch {
    return null;
  }
}

// ─── withTranslation HOC ─────────────────────────────────────────────────────
function withTranslation(ns) {
  return function(WrappedComponent) {
    return function WithTranslation(props) {
      try {
        const React = require('react');
        const { t, i18n } = useTranslation(ns);
        return React.createElement(WrappedComponent, Object.assign({}, props, { t, i18n }));
      } catch {
        return null;
      }
    };
  };
}

// ─── useI18n / other hooks ────────────────────────────────────────────────────
function useI18n() {
  const i18n = getI18n();
  return i18n || {};
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  useTranslation,
  initReactI18next,
  Trans,
  I18nextProvider,
  withTranslation,
  useI18n,
  // Aliases
  getI18n,
};

Object.defineProperty(module.exports, '__esModule', { value: true });
module.exports.default = module.exports;
