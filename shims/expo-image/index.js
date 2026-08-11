/**
 * shims/expo-image/index.js
 *
 * Web-safe shim for expo-image.
 *
 * expo-image/src/web/ImageRef.ts extends from expo-modules-core's SharedRef,
 * which resolves to `undefined` in the web Live Preview environment, causing:
 *   "Class extends value undefined is not a constructor or null"
 *
 * This shim intercepts expo-image on web and replaces it with a plain
 * React Native Image wrapper that passes through all standard props.
 * On native (iOS/Android) this shim is never loaded — the real expo-image
 * is resolved by Metro for those platforms.
 */

'use strict';

const React = require('react');
const { Image: RNImage, StyleSheet } = require('react-native');

// ─── Map expo-image contentFit → resizeMode ─────────────────────────────────
function contentFitToResizeMode(contentFit) {
  switch (contentFit) {
    case 'contain': return 'contain';
    case 'cover':   return 'cover';
    case 'fill':    return 'stretch';
    case 'none':    return 'center';
    case 'scale-down': return 'contain';
    default:        return 'cover';
  }
}

// ─── Image component ─────────────────────────────────────────────────────────
function Image(props) {
  const {
    source,
    style,
    contentFit,
    contentPosition,
    transition,
    placeholder,
    placeholderContentFit,
    recyclingKey,
    cachePolicy,
    onLoad,
    onLoadStart,
    onLoadEnd,
    onError,
    onProgress,
    ...rest
  } = props || {};

  const resizeMode = contentFitToResizeMode(contentFit);

  return React.createElement(RNImage, {
    source,
    style,
    resizeMode,
    onLoad,
    onLoadStart,
    onLoadEnd,
    onError,
    ...rest,
  });
}
Image.displayName = 'Image';

// ─── ImageBackground shim ────────────────────────────────────────────────────
function ImageBackground(props) {
  const { children, style, imageStyle, source, contentFit, ...rest } = props || {};
  const resizeMode = contentFitToResizeMode(contentFit);
  const { ImageBackground: RNImageBackground } = require('react-native');
  return React.createElement(
    RNImageBackground,
    { source, style, imageStyle, resizeMode, ...rest },
    children,
  );
}
ImageBackground.displayName = 'ImageBackground';

// ─── useImage hook shim ──────────────────────────────────────────────────────
function useImage(source) {
  return source ? { width: 0, height: 0, mediaType: null } : null;
}

// ─── prefetch / clearDiskCache stubs ─────────────────────────────────────────
function prefetch() { return Promise.resolve(false); }
function clearDiskCache() { return Promise.resolve(false); }
function clearMemoryCache() { return Promise.resolve(false); }

// ─── ImageRef stub (avoids the class-extends error at module level) ───────────
function ImageRef() {}
ImageRef.prototype = Object.create(Object.prototype);
ImageRef.prototype.constructor = ImageRef;

module.exports = {
  Image,
  ImageBackground,
  useImage,
  prefetch,
  clearDiskCache,
  clearMemoryCache,
  ImageRef,
  default: Image,
};
