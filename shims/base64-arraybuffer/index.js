'use strict';
// base64-arraybuffer shim — used when the npm package is not installed.
// Implements encode() and decode() compatible with the real package API.

var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode(arraybuffer) {
  var bytes = new Uint8Array(arraybuffer);
  var len = bytes.length;
  var base64 = '';
  for (var i = 0; i < len; i += 3) {
    base64 += CHARS[bytes[i] >> 2];
    base64 += CHARS[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    base64 += CHARS[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    base64 += CHARS[bytes[i + 2] & 63];
  }
  if (len % 3 === 2) {
    base64 = base64.substring(0, base64.length - 1) + '=';
  } else if (len % 3 === 1) {
    base64 = base64.substring(0, base64.length - 2) + '==';
  }
  return base64;
}

function decode(base64) {
  var bufferLength = Math.floor(base64.length * 0.75);
  var len = base64.length;
  var p = 0;
  var encoded1, encoded2, encoded3, encoded4;

  if (base64[base64.length - 1] === '=') {
    bufferLength--;
    if (base64[base64.length - 2] === '=') bufferLength--;
  }

  var arraybuffer = new ArrayBuffer(bufferLength);
  var bytes = new Uint8Array(arraybuffer);
  var lookup = new Uint8Array(256);
  for (var i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;

  for (var j = 0; j < len; j += 4) {
    encoded1 = lookup[base64.charCodeAt(j)];
    encoded2 = lookup[base64.charCodeAt(j + 1)];
    encoded3 = lookup[base64.charCodeAt(j + 2)];
    encoded4 = lookup[base64.charCodeAt(j + 3)];
    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return arraybuffer;
}

exports.encode = encode;
exports.decode = decode;
module.exports = { encode: encode, decode: decode };
