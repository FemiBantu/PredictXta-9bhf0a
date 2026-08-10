'use strict';
// Stub for hermes-parser Babel plugin — used for web/SSR where Hermes is not active.
// Returns an empty visitor so Babel continues without error.
module.exports = function hermesParserPlugin() {
  return { visitor: {} };
};
module.exports.default = module.exports;
