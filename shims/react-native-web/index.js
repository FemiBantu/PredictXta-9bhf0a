/**
 * shims/react-native-web/index.js
 *
 * Minimal react-native SSR/server shim.
 * Used when platform === 'server' or platform == null so that modules that
 * import from 'react-native' don't crash with "Cannot read properties of
 * undefined (reading 'OS')".
 *
 * Only stubs out the handful of APIs that SSR paths actually access.
 * Real react-native is still used on native (android/ios) and web.
 */

'use strict';

// ─── Platform ────────────────────────────────────────────────────────────────
const Platform = {
  OS: 'web',
  Version: 0,
  isPad: false,
  isTesting: false,
  isTV: false,
  select: function(spec) {
    return spec.web !== undefined ? spec.web
      : spec.default !== undefined ? spec.default
      : undefined;
  },
};

// ─── Dimensions ──────────────────────────────────────────────────────────────
const Dimensions = {
  get: function() { return { width: 375, height: 812, scale: 1, fontScale: 1 }; },
  set: function() {},
  addEventListener: function() { return { remove: function() {} }; },
  removeEventListener: function() {},
};

// ─── StyleSheet ──────────────────────────────────────────────────────────────
const StyleSheet = {
  create: function(styles) { return styles; },
  flatten: function(style) { return style; },
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
};

// ─── Animated ────────────────────────────────────────────────────────────────
function AnimatedValue(v) { this._value = v; }
AnimatedValue.prototype.setValue = function() {};
AnimatedValue.prototype.addListener = function() { return '0'; };
AnimatedValue.prototype.removeListener = function() {};
AnimatedValue.prototype.interpolate = function() { return this; };
AnimatedValue.prototype.stopAnimation = function() {};
const Animated = {
  Value: AnimatedValue,
  ValueXY: function(v) { this.x = new AnimatedValue((v || {}).x || 0); this.y = new AnimatedValue((v || {}).y || 0); },
  timing: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  spring: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  decay: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  sequence: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  parallel: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  loop: function(a) { return a; },
  add: function(a) { return a; },
  divide: function(a) { return a; },
  multiply: function(a) { return a; },
  modulo: function(a) { return a; },
  subtract: function(a) { return a; },
  diffClamp: function(a) { return a; },
  event: function() { return function() {}; },
  createAnimatedComponent: function(C) { return C; },
  FlatList: null,
  Image: null,
  ScrollView: null,
  SectionList: null,
  Text: null,
  View: null,
};

// ─── NullComponent – any UI component that renders nothing in SSR ────────────
function NullComponent() { return null; }
NullComponent.displayName = 'SSRNullComponent';

// ─── EventEmitter stub ───────────────────────────────────────────────────────
function NativeEventEmitter() {}
NativeEventEmitter.prototype.addListener = function() { return { remove: function() {} }; };
NativeEventEmitter.prototype.removeAllListeners = function() {};
NativeEventEmitter.prototype.emit = function() {};

// ─── AppState stub ───────────────────────────────────────────────────────────
const AppState = {
  currentState: 'active',
  addEventListener: function() { return { remove: function() {} }; },
  removeEventListener: function() {},
};

// ─── Linking stub ────────────────────────────────────────────────────────────
const Linking = {
  addEventListener: function() { return { remove: function() {} }; },
  removeEventListener: function() {},
  getInitialURL: function() { return Promise.resolve(null); },
  openURL: function() { return Promise.resolve(); },
  canOpenURL: function() { return Promise.resolve(false); },
  openSettings: function() { return Promise.resolve(); },
};

// ─── Keyboard stub ───────────────────────────────────────────────────────────
const Keyboard = {
  addListener: function() { return { remove: function() {} }; },
  removeListener: function() {},
  removeAllListeners: function() {},
  dismiss: function() {},
};

// ─── AccessibilityInfo stub ──────────────────────────────────────────────────
const AccessibilityInfo = {
  isReduceMotionEnabled: function() { return Promise.resolve(false); },
  isScreenReaderEnabled: function() { return Promise.resolve(false); },
  addEventListener: function() { return { remove: function() {} }; },
  removeEventListener: function() {},
  announceForAccessibility: function() {},
};

// ─── Alert stub ──────────────────────────────────────────────────────────────
const Alert = {
  alert: function() {},
  prompt: function() {},
};

// ─── BackHandler stub ────────────────────────────────────────────────────────
const BackHandler = {
  addEventListener: function() { return { remove: function() {} }; },
  removeEventListener: function() {},
  exitApp: function() {},
};

// ─── Vibration stub ──────────────────────────────────────────────────────────
const Vibration = { vibrate: function() {}, cancel: function() {} };

// ─── Share stub ──────────────────────────────────────────────────────────────
const Share = { share: function() { return Promise.resolve({ action: 'dismissedAction' }); } };

// ─── Clipboard stub ──────────────────────────────────────────────────────────
const Clipboard = {
  getString: function() { return Promise.resolve(''); },
  setString: function() {},
};

// ─── PixelRatio stub ─────────────────────────────────────────────────────────
const PixelRatio = {
  get: function() { return 1; },
  getPixelSizeForLayoutSize: function(n) { return n; },
  roundToNearestPixel: function(n) { return n; },
  getFontScale: function() { return 1; },
};

// ─── I18nManager stub ────────────────────────────────────────────────────────
const I18nManager = { isRTL: false, allowRTL: function() {}, forceRTL: function() {} };

// ─── InteractionManager stub ─────────────────────────────────────────────────
const InteractionManager = {
  runAfterInteractions: function(cb) { if (cb) cb(); return { cancel: function() {} }; },
  createInteractionHandle: function() { return 0; },
  clearInteractionHandle: function() {},
  addListener: function() { return { remove: function() {} }; },
};

// ─── NativeModules stub ──────────────────────────────────────────────────────
const NativeModules = {};

// ─── requireOptionalNativeModule stub ───────────────────────────────────────
function requireOptionalNativeComponent() { return NullComponent; }
function requireNativeComponent() { return NullComponent; }

module.exports = {
  // Core
  Platform,
  Dimensions,
  StyleSheet,
  Animated,
  PixelRatio,
  I18nManager,
  InteractionManager,
  NativeModules,

  // Components (null in SSR)
  View: NullComponent,
  Text: NullComponent,
  Image: NullComponent,
  ImageBackground: NullComponent,
  ScrollView: NullComponent,
  FlatList: NullComponent,
  SectionList: NullComponent,
  VirtualizedList: NullComponent,
  TextInput: NullComponent,
  TouchableOpacity: NullComponent,
  TouchableHighlight: NullComponent,
  TouchableWithoutFeedback: NullComponent,
  TouchableNativeFeedback: NullComponent,
  Pressable: NullComponent,
  Button: NullComponent,
  Switch: NullComponent,
  Slider: NullComponent,
  ActivityIndicator: NullComponent,
  Modal: NullComponent,
  RefreshControl: NullComponent,
  KeyboardAvoidingView: NullComponent,
  SafeAreaView: NullComponent,
  StatusBar: NullComponent,
  DrawerLayoutAndroid: NullComponent,
  ToolbarAndroid: NullComponent,
  ViewPager: NullComponent,

  // APIs
  Alert,
  AppState,
  Linking,
  Keyboard,
  BackHandler,
  Vibration,
  Share,
  Clipboard,
  AccessibilityInfo,
  NativeEventEmitter,

  // Internal / deprecated
  requireOptionalNativeComponent,
  requireNativeComponent,
  UIManager: { dispatchViewManagerCommand: function() {}, measure: function() {}, measureLayout: function() {} },
  DeviceEventEmitter: new NativeEventEmitter(),
  TurboModuleRegistry: { get: function() { return null; }, getEnforcing: function() { return {}; } },
  RCTEventEmitter: NativeEventEmitter,

  // Hooks
  useWindowDimensions: function() { return { width: 375, height: 812, scale: 1, fontScale: 1 }; },
  useColorScheme: function() { return 'dark'; },
};
