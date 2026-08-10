// SSR / web shim for i18next
// Provides a minimal i18next instance that works without the real package.
'use strict';

const subscribers = [];

const i18n = {
  _resources: {},
  _lng: 'en',
  _fallbackLng: 'en',
  isInitialized: false,

  use: function(plugin) {
    // Accept plugins silently (e.g. initReactI18next)
    if (plugin && typeof plugin.init === 'function') {
      try { plugin.init(this); } catch (e) { /* ignore */ }
    }
    if (plugin && typeof plugin.type === 'string' && plugin.type === '3rdParty') {
      try { plugin.init(this); } catch (e) { /* ignore */ }
    }
    return this;
  },

  init: function(options) {
    if (options) {
      if (options.resources) this._resources = options.resources;
      if (options.lng) this._lng = options.lng;
      if (options.fallbackLng) this._fallbackLng = options.fallbackLng;
    }
    this.isInitialized = true;
    subscribers.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    return Promise.resolve(this.t.bind(this));
  },

  t: function(key, options) {
    if (!key) return '';
    const lang = this._lng || 'en';
    const res = this._resources;
    const ns = (options && options.ns) || 'translation';
    const bundle = (res[lang] && res[lang][ns]) || (res['en'] && res['en'][ns]) || {};
    // Support dot-notation keys
    const parts = String(key).split('.');
    let val = bundle;
    for (const part of parts) {
      if (val && typeof val === 'object') val = val[part];
      else { val = undefined; break; }
    }
    if (typeof val === 'string') {
      // Basic interpolation: {{variable}}
      if (options && typeof options === 'object') {
        return val.replace(/\{\{(\w+)\}\}/g, (_, k) =>
          options[k] !== undefined ? String(options[k]) : `{{${k}}}`
        );
      }
      return val;
    }
    return key;
  },

  changeLanguage: function(lng) {
    this._lng = lng;
    subscribers.forEach(fn => { try { fn(lng); } catch (e) { /* ignore */ } });
    return Promise.resolve(this.t.bind(this));
  },

  getFixedT: function(lng, ns) {
    const self = this;
    return function(key, opts) {
      return self.t(key, Object.assign({}, opts, { lng, ns }));
    };
  },

  language: 'en',

  on: function(event, fn) { if (event === 'initialized' || event === 'languageChanged') subscribers.push(fn); },
  off: function(event, fn) {
    const idx = subscribers.indexOf(fn);
    if (idx !== -1) subscribers.splice(idx, 1);
  },

  exists: function(key) { return typeof this.t(key) === 'string'; },

  // Allow plugins to attach
  services: {},
  store: { data: {} },
  options: {},
  modules: { external: [] },
};

Object.defineProperty(i18n, 'language', {
  get: function() { return this._lng; },
  set: function(v) { this._lng = v; },
  configurable: true,
});

module.exports = i18n;
module.exports.default = i18n;
module.exports.createInstance = function() { return Object.assign({}, i18n); };
