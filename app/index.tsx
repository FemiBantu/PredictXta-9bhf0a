import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ONBOARDING_KEY } from './onboarding';
import { COLORS, FONTS, RADIUS } from '@/constants/theme';

// ─── Splash Screen ────────────────────────────────────────────────────────────
function SplashScreen({ onFinish }: { onFinish: () => void }) {
  // Skip native splash on web — it flashes awkwardly
  useEffect(() => {
    if (Platform.OS === 'web') {
      const t = setTimeout(onFinish, 200);
      return () => clearTimeout(t);
    }
  }, []);

  const logoOpacity   = useRef(new Animated.Value(0)).current;
  const logoScale     = useRef(new Animated.Value(0.78)).current;
  const textOpacity   = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const dotsOpacity   = useRef(new Animated.Value(0)).current;
  const dotsAnim      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Phase 1 — logo fades + scales in (0–400 ms)
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 60,
        friction: 9,
        useNativeDriver: true,
      }),
    ]).start();

    // Phase 2 — app name fades in (250 ms delay)
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 380,
      delay: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Phase 3 — tagline fades in (450 ms delay)
    Animated.timing(taglineOpacity, {
      toValue: 1,
      duration: 360,
      delay: 460,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Phase 4 — loading dots appear + loop (600 ms delay)
    Animated.timing(dotsOpacity, {
      toValue: 1,
      duration: 300,
      delay: 600,
      useNativeDriver: true,
    }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotsAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(dotsAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
      ).start();
    });

    // Navigate away after minimum splash duration (skip on web)
    const timer = setTimeout(onFinish, Platform.OS === 'web' ? 400 : 1800);
    return () => clearTimeout(timer);
  }, []);

  // Three pulsing dots driven by dotsAnim (staggered opacity)
  const dot1Opacity = dotsAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.3, 1, 0.3, 0.3] });
  const dot2Opacity = dotsAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.3, 0.3, 1, 0.3] });
  const dot3Opacity = dotsAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.3, 0.3, 0.3, 1] });

  return (
    <LinearGradient
      colors={['#0B1120', '#070B14', '#040609']}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={splash.root}
    >
      {/* Subtle radial glow behind logo */}
      <View style={splash.glowRing} />

      {/* Logo */}
      <Animated.View style={[splash.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <Image
          source={require('@/assets/logo.png')}
          style={splash.logo}
          contentFit="contain"
          transition={0}
        />
      </Animated.View>

      {/* App name */}
      <Animated.View style={[splash.appNameRow, { opacity: textOpacity }]}>
        <Text style={splash.appNameText}>PredictXta</Text>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[splash.tagline, { opacity: taglineOpacity }]}>
        <Text style={{ color: '#FFFFFF' }}>AI PREDICTION - </Text>
        <Text style={{ color: '#6EDC1F' }}>BET SMART</Text>
        <Text style={{ color: '#FFFFFF' }}> - WIN MORE.</Text>
      </Animated.Text>

      {/* Pulsing dots */}
      <Animated.View style={[splash.dotsRow, { opacity: dotsOpacity }]}>
        {[dot1Opacity, dot2Opacity, dot3Opacity].map((op, i) => (
          <Animated.View key={i} style={[splash.dot, { opacity: op }]} />
        ))}
      </Animated.View>
    </LinearGradient>
  );
}

const splash = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  glowRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,215,0,0.055)',
    // soft halo effect
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 80,
  },
  logoWrap: {
    width: 120,
    height: 120,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  appNameText: {
    fontSize: 36,
    fontWeight: FONTS.extraBold,
    color: COLORS.primary,
    letterSpacing: 1.2,
    includeFontPadding: false,
  },
  gradientX: {
    width: 26,
    height: 46,
  },
  tagline: {
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 1.2,
    marginBottom: 48,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    position: 'absolute',
    bottom: 64,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
});

// ─── Root Screen ──────────────────────────────────────────────────────────────
export default function RootScreen() {
  const [splashDone, setSplashDone]     = useState(false);
  const [checking, setChecking]         = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Start async checks ASAP (in parallel with splash animation)
  const resultRef = useRef<{ needs: boolean } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((val) => { resultRef.current = { needs: val !== 'true' }; })
      .catch(() => { resultRef.current = { needs: false }; });
  }, []);

  const handleSplashFinish = () => {
    // Apply whatever the async check resolved (or default false if still pending)
    const result = resultRef.current ?? { needs: false };
    setNeedsOnboarding(result.needs);
    setSplashDone(true);
  };

  if (!splashDone) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  if (needsOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <AuthRouter loginRoute="/login" excludeRoutes={[]}>
      <Redirect href="/(tabs)" />
    </AuthRouter>
  );
}
