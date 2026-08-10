// SSR / web shim for react-native-webview
'use strict';

const React = require('react');

/**
 * Web-compatible WebView shim.
 * Renders an <iframe> on browsers, returns null during SSR.
 * Forwards the caller's `style` prop so the parent's layout constraints apply.
 */
function WebView(props) {
  if (typeof document === 'undefined') return null;

  // Merge caller style with required iframe defaults.
  // React will map the RN-style object through react-native-web, so we only
  // add the CSS-only `border` key that RN doesn't know about.
  const baseStyle = {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
  };
  const callerStyle =
    Array.isArray(props.style)
      ? Object.assign({}, ...props.style.filter(Boolean))
      : props.style || {};
  const mergedStyle = Object.assign({}, callerStyle, baseStyle);

  const src =
    props.source && props.source.uri ? props.source.uri : undefined;
  const srcDoc =
    props.source && props.source.html ? props.source.html : undefined;

  return React.createElement('iframe', {
    src,
    srcDoc,
    style: mergedStyle,
    onLoad: props.onLoadEnd,
    onError: props.onError,
    allowFullScreen: props.allowsFullscreenVideo,
    allow: 'autoplay; fullscreen; picture-in-picture',
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms',
  });
}

WebView.displayName = 'WebView';

module.exports = { default: WebView, WebView };
