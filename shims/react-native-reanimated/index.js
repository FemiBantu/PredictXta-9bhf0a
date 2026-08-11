'use strict';

/**
 * Web/SSR shim for react-native-reanimated.
 *
 * expo-router's static renderer (Node.js SSR context) calls
 * `resetServerContext()` on reanimated before rendering each route.
 * The real reanimated native module doesn't export this in the web/SSR
 * bundle, causing "s.resetServerContext is not a function".
 *
 * This shim stubs all reanimated APIs so the SSR pass succeeds.
 * On native (iOS/Android) the real react-native-reanimated is used — this
 * file is only loaded when platform === 'web' via metro.config.js.
 */

var React = require('react');

// ─── SSR hook ──────────────────────────────────────────────────────────────────
function resetServerContext() {}

// Patch onto global so Node.js SSR context always has it, even if the module
// is loaded outside Metro's resolver (e.g. from expo-router's CLI Node process).
if (typeof global !== 'undefined' && !global.__reanimatedResetServerContextPatched) {
  global.__reanimatedResetServerContextPatched = true;
  try {
    var Module = require('module');
    var _origLoad = Module._load;
    Module._load = function(req, parent, isMain) {
      if (req === 'react-native-reanimated') {
        var result = _origLoad.apply(this, arguments);
        if (result && typeof result.resetServerContext !== 'function') {
          result.resetServerContext = function() {};
        }
        if (result && result.default && typeof result.default.resetServerContext !== 'function') {
          result.default.resetServerContext = function() {};
        }
        return result;
      }
      return _origLoad.apply(this, arguments);
    };
  } catch (e) { /* non-blocking — Module API unavailable in some envs */ }
}

// ─── Shared values ─────────────────────────────────────────────────────────────
function useSharedValue(init) {
  var ref = React.useRef({ value: init });
  return ref.current;
}
function makeMutable(init) { return { value: init }; }
function useAnimatedRef() { return React.useRef(null); }

// ─── Worklets / derived ────────────────────────────────────────────────────────
function useDerivedValue(fn) { return { value: fn() }; }
function useAnimatedReaction() {}
function runOnJS(fn) { return fn; }
function runOnUI(fn) { return fn; }

// ─── Animated style/props ──────────────────────────────────────────────────────
function useAnimatedStyle() { return {}; }
function useAnimatedProps() { return {}; }
function useAnimatedScrollHandler() { return function() {}; }
function useAnimatedGestureHandler() { return {}; }

// ─── Layout animations ─────────────────────────────────────────────────────────
var FadeIn = { duration: function() { return FadeIn; }, delay: function() { return FadeIn; } };
var FadeOut = { duration: function() { return FadeOut; }, delay: function() { return FadeOut; } };
var FadeInUp = { duration: function() { return FadeInUp; }, delay: function() { return FadeInUp; } };
var FadeInDown = { duration: function() { return FadeInDown; }, delay: function() { return FadeInDown; } };
var SlideInRight = { duration: function() { return SlideInRight; }, delay: function() { return SlideInRight; } };
var SlideOutLeft = { duration: function() { return SlideOutLeft; }, delay: function() { return SlideOutLeft; } };
var ZoomIn = { duration: function() { return ZoomIn; }, delay: function() { return ZoomIn; } };
var ZoomOut = { duration: function() { return ZoomOut; }, delay: function() { return ZoomOut; } };
var Layout = { springify: function() { return Layout; }, duration: function() { return Layout; } };
var LinearTransition = Layout;
var BounceIn = FadeIn;
var BounceOut = FadeOut;
var FlipInYRight = FadeIn;
var FlipOutYRight = FadeOut;
var LightSpeedInRight = FadeIn;
var LightSpeedOutRight = FadeOut;
var StretchInX = FadeIn;
var StretchOutX = FadeOut;

// ─── Easing ────────────────────────────────────────────────────────────────────
var Easing = {
  linear: function(t) { return t; },
  ease: function(t) { return t; },
  quad: function(t) { return t; },
  cubic: function(t) { return t; },
  poly: function() { return function(t) { return t; }; },
  sin: function(t) { return t; },
  circle: function(t) { return t; },
  exp: function(t) { return t; },
  elastic: function() { return function(t) { return t; }; },
  back: function() { return function(t) { return t; }; },
  bounce: function(t) { return t; },
  bezier: function() { return function(t) { return t; }; },
  bezierFn: function() { return function(t) { return t; }; },
  in: function(e) { return e; },
  out: function(e) { return e; },
  inOut: function(e) { return e; },
};

// ─── Animation helpers ─────────────────────────────────────────────────────────
function withTiming(val) { return val; }
function withSpring(val) { return val; }
function withDelay(_, val) { return val; }
function withSequence() { return arguments[arguments.length - 1]; }
function withRepeat(val) { return val; }
function withDecay() { return 0; }
function cancelAnimation() {}
function interpolate(val, input, output) {
  if (!input || !output || input.length < 2) return output ? output[0] : val;
  for (var i = 0; i < input.length - 1; i++) {
    if (val <= input[i + 1]) {
      var t = (val - input[i]) / (input[i + 1] - input[i]);
      return output[i] + t * (output[i + 1] - output[i]);
    }
  }
  return output[output.length - 1];
}
function interpolateColor(val, input, output) { return output ? output[0] : '#000'; }

// ─── Extrapolation ─────────────────────────────────────────────────────────────
var Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
var ExtrapolationType = Extrapolation;

// ─── Animated component factory ────────────────────────────────────────────────
var { View, Text, Image, ScrollView, FlatList } = require('react-native');

function createAnimatedComponent(Component) {
  return Component;
}

var Animated = {
  View: View,
  Text: Text,
  Image: Image,
  ScrollView: ScrollView,
  FlatList: FlatList,
  createAnimatedComponent: createAnimatedComponent,
  // Value API (legacy)
  Value: function(v) {
    this.value = v;
    this._listeners = [];
    this.setValue = function(val) { this.value = val; }.bind(this);
    this.addListener = function(cb) { this._listeners.push(cb); return String(Math.random()); }.bind(this);
    this.removeListener = function() {};
    this.interpolate = function() { return this; }.bind(this);
  },
  event: function() { return function() {}; },
  timing: function(val) { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  spring: function(val) { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  decay: function(val) { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  sequence: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  parallel: function() { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
  loop: function(anim) { return { start: function() {}, stop: function() {} }; },
  delay: function(_, anim) { return anim; },
  stagger: function(_, anims) { return { start: function(cb) { if (cb) cb({ finished: true }); } }; },
};

// ─── Gesture integrations ──────────────────────────────────────────────────────
var useAnimatedGestureHandler2 = useAnimatedGestureHandler;

// ─── Keyboard ──────────────────────────────────────────────────────────────────
function useAnimatedKeyboard() { return { height: { value: 0 } }; }

// ─── Scroll ────────────────────────────────────────────────────────────────────
function useScrollViewOffset() { return { value: 0 }; }
function scrollTo() {}
function measure() {}

// ─── clamp ─────────────────────────────────────────────────────────────────────
function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

module.exports = {
  default: Animated,
  Animated: Animated,
  resetServerContext: resetServerContext,

  // Shared value
  useSharedValue: useSharedValue,
  makeMutable: makeMutable,
  useAnimatedRef: useAnimatedRef,

  // Worklets
  useDerivedValue: useDerivedValue,
  useAnimatedReaction: useAnimatedReaction,
  runOnJS: runOnJS,
  runOnUI: runOnUI,

  // Style/props
  useAnimatedStyle: useAnimatedStyle,
  useAnimatedProps: useAnimatedProps,
  useAnimatedScrollHandler: useAnimatedScrollHandler,
  useAnimatedGestureHandler: useAnimatedGestureHandler,

  // Animations
  withTiming: withTiming,
  withSpring: withSpring,
  withDelay: withDelay,
  withSequence: withSequence,
  withRepeat: withRepeat,
  withDecay: withDecay,
  cancelAnimation: cancelAnimation,
  interpolate: interpolate,
  interpolateColor: interpolateColor,

  // Easing
  Easing: Easing,

  // Extrapolation
  Extrapolation: Extrapolation,
  ExtrapolationType: ExtrapolationType,

  // Layout animations
  FadeIn: FadeIn,
  FadeOut: FadeOut,
  FadeInUp: FadeInUp,
  FadeInDown: FadeInDown,
  SlideInRight: SlideInRight,
  SlideOutLeft: SlideOutLeft,
  ZoomIn: ZoomIn,
  ZoomOut: ZoomOut,
  Layout: Layout,
  LinearTransition: LinearTransition,
  BounceIn: BounceIn,
  BounceOut: BounceOut,
  FlipInYRight: FlipInYRight,
  FlipOutYRight: FlipOutYRight,
  LightSpeedInRight: LightSpeedInRight,
  LightSpeedOutRight: LightSpeedOutRight,
  StretchInX: StretchInX,
  StretchOutX: StretchOutX,

  // Components
  createAnimatedComponent: createAnimatedComponent,

  // Keyboard / scroll
  useAnimatedKeyboard: useAnimatedKeyboard,
  useScrollViewOffset: useScrollViewOffset,
  scrollTo: scrollTo,
  measure: measure,

  // Utils
  clamp: clamp,
};
