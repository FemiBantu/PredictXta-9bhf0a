// PredictXta — Design Tokens
// Brand Identity: Dark sports-intelligence platform
// Primary color: #6EDC1F (PredictXta green — matches logo)
// Secondary: #FFD700 (gold — VIP, premium)
// Accent: #00FF87 (live/active)

// ─── Dark palette (default) ───────────────────────────────────────────────────
export const DARK_COLORS = {
  // Base
  bg: '#070B14',
  surface: '#0F1923',
  card: '#141E2E',
  cardHighlight: '#1A2740',
  border: '#1E2D45',
  borderLight: '#253550',

  // Brand — PredictXta Green (matches logo/header)
  primary: '#6EDC1F',
  primaryDark: '#52AA10',
  primaryLight: '#8AEE44',
  primaryGlow: 'rgba(110, 220, 31, 0.15)',

  // VIP/Premium — Gold
  vip: '#FFD700',
  vipGlow: 'rgba(255, 215, 0, 0.15)',

  // Accents
  accent: '#00FF87',
  accentDim: 'rgba(0, 255, 135, 0.15)',
  accentRed: '#FF4757',
  accentRedDim: 'rgba(255, 71, 87, 0.15)',
  accentBlue: '#4ECDC4',
  accentBlueDim: 'rgba(78, 205, 196, 0.15)',
  accentPurple: '#A855F7',
  accentPurpleDim: 'rgba(168, 85, 247, 0.15)',
  accentOrange: '#F97316',
  accentAmber: '#F59E0B',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8B9BB4',
  textMuted: '#4A5568',
  textInverse: '#070B14',

  // Overlays
  overlay: 'rgba(7, 11, 20, 0.85)',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
};

// ─── Light palette ────────────────────────────────────────────────────────────
export const LIGHT_COLORS = {
  // Base
  bg: '#F0F4FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardHighlight: '#EBF0FB',
  border: '#D1DCF0',
  borderLight: '#E4ECF7',

  // Brand — PredictXta Green (slightly darkened for light bg contrast)
  primary: '#4BAF0D',
  primaryDark: '#3A8A0A',
  primaryLight: '#6EDC1F',
  primaryGlow: 'rgba(75, 175, 13, 0.12)',

  // VIP/Premium — Gold
  vip: '#C9A800',
  vipGlow: 'rgba(201, 168, 0, 0.12)',

  // Accents — slightly deeper for legibility on white
  accent: '#00C96D',
  accentDim: 'rgba(0, 201, 109, 0.12)',
  accentRed: '#E8344A',
  accentRedDim: 'rgba(232, 52, 74, 0.10)',
  accentBlue: '#2AB5AB',
  accentBlueDim: 'rgba(42, 181, 171, 0.12)',
  accentPurple: '#8B3FD8',
  accentPurpleDim: 'rgba(139, 63, 216, 0.12)',
  accentOrange: '#EA6A0C',
  accentAmber: '#D97706',

  // Text
  textPrimary: '#0D1726',
  textSecondary: '#3D4F6E',
  textMuted: '#8899BB',
  textInverse: '#FFFFFF',

  // Overlays
  overlay: 'rgba(13, 23, 38, 0.65)',
  glass: 'rgba(0, 0, 0, 0.04)',
  glassBorder: 'rgba(0, 0, 0, 0.06)',
};

// ─── Default export (dark — kept for static imports across all files) ─────────
export const COLORS = DARK_COLORS;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 999,
};

export const FONTS = {
  regular: '400' as const,
  medium: '500' as const,
  semiBold: '600' as const,
  bold: '700' as const,
  extraBold: '800' as const,
};

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  primary: {
    shadowColor: '#6EDC1F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  accent: {
    shadowColor: '#00FF87',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
};

/**
 * SPORTS — Derived from canonical sports registry.
 * Do NOT add sports here. Add them to services/sportsRegistry.ts.
 * Exactly 13 supported sports + 'All'.
 */
export const SPORTS = [
  'All',
  'Football',
  'Basketball',
  'Tennis',
  'Cricket',
  'Baseball',
  'Hockey',
  'Rugby',
  'American Football',
  'MMA',
  'Boxing',
  'Volleyball',
  'Handball',
  'Esports',
];

export const SPORT_ICONS: Record<string, string> = {
  Football: '⚽',
  Basketball: '🏀',
  Tennis: '🎾',
  Baseball: '⚾',
  Hockey: '🏒',
  Rugby: '🏉',
  Handball: '🤾',
  Volleyball: '🏐',
  'American Football': '🏈',
  Cricket: '🏏',
  MMA: '🥊',
  Boxing: '🥊',
  Esports: '🎮',
  All: '🏆',
};

// Maps UI sport label → API sport key used in fetch-matches edge function
export const SPORT_API_KEY: Record<string, string> = {
  Football: 'football',
  Basketball: 'basketball',
  Tennis: 'tennis',
  Baseball: 'baseball',
  Hockey: 'hockey',
  Rugby: 'rugby',
  Handball: 'handball',
  Volleyball: 'volleyball',
  'American Football': 'american-football',
  Cricket: 'cricket',
  MMA: 'mma',
  Boxing: 'boxing',
  Esports: 'esports',
  All: 'all',
};

export type AppColors = typeof DARK_COLORS;
export type ThemeMode = 'dark' | 'light';

// ─── Sport name normalization ──────────────────────────────────────────────────
const SPORT_ICON_LOWER: Record<string, string> = {
  football: '⚽',
  soccer: '⚽',
  basketball: '🏀',
  tennis: '🎾',
  baseball: '⚾',
  hockey: '🏒',
  rugby: '🏉',
  handball: '🤾',
  volleyball: '🏐',
  'american-football': '🏈',
  americanfootball: '🏈',
  cricket: '🏏',
  mma: '🥊',
  boxing: '🥊',
  esports: '🎮',
  all: '🏆',
};

export function getSportIcon(sport: string): string {
  if (!sport) return '🏆';
  const direct = SPORT_ICONS[sport];
  if (direct) return direct;
  const normalized = sport.toLowerCase().replace(/\s+/g, '-');
  return SPORT_ICON_LOWER[normalized]
    ?? SPORT_ICON_LOWER[sport.toLowerCase()]
    ?? SPORT_ICON_LOWER[sport.toLowerCase().replace(/[^a-z]/g, '')]
    ?? '🏆';
}

export function normalizeSportName(sport: string): string {
  if (!sport) return 'Sport';
  if (SPORTS.includes(sport)) return sport;
  const MAP: Record<string, string> = {
    football: 'Football', soccer: 'Football',
    basketball: 'Basketball', tennis: 'Tennis',
    baseball: 'Baseball', hockey: 'Hockey',
    rugby: 'Rugby', handball: 'Handball',
    volleyball: 'Volleyball',
    'american-football': 'American Football',
    americanfootball: 'American Football',
    cricket: 'Cricket', mma: 'MMA',
    boxing: 'Boxing',
    esports: 'Esports',
  };
  return MAP[sport.toLowerCase()] ?? sport.charAt(0).toUpperCase() + sport.slice(1);
}

export const SPORT_PREFS_KEY = '@predictxta/sport_preferences_v1';
