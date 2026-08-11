/**
 * constants/mockData.ts
 *
 * ⚠️  DEV-ONLY FILE — Production must NEVER import or activate data from here.
 *
 * This file exists solely for:
 *   - UI component development in Expo Go / storybook environments
 *   - Snapshot tests of rendering logic
 *
 * PRODUCTION RULES:
 *   - None of these exports may be used as a fallback when Supabase is unavailable
 *   - No component or hook may import from this file in a production code path
 *   - If data is unavailable in production, show an honest empty/error state
 *   - Math.random() is FORBIDDEN for generating any user-visible business value
 *
 * To use in development:
 *   if (__DEV__ && process.env.EXPO_PUBLIC_USE_MOCK_DATA === 'true') { ... }
 *
 * All exports are typed to the canonical types but kept DEV-gated.
 */

import type { Match, Prediction, ChatMessage, Notification } from '@/services/types';

// ─── Guard: prevent accidental production import ──────────────────────────────
// This check fires at runtime in development builds.
if (typeof __DEV__ !== 'undefined' && !__DEV__) {
  // In production builds __DEV__ is false — log a warning if somehow imported
  console.warn(
    '[PredictXta] constants/mockData imported in production build. ' +
    'This file must only be used in development. Remove the import immediately.'
  );
}

// ─── VIP Plans (safe to export — no business data, just UI display config) ───
export const VIP_PLANS = [
  {
    id: 'monthly',
    name: 'Monthly VIP',
    price: '$1.99',
    period: '/month',
    features: [
      'Unlimited AI predictions',
      'VIP daily tips from experts',
      'Advanced match analytics',
      'H2H & form statistics',
      'Ad-free experience',
      'Priority chat badge',
    ],
    popular: false,
    color: '#4ECDC4',
  },
  {
    id: 'biannual',
    name: '6-Month VIP',
    price: '$8.39',
    period: '/6 months',
    badge: 'SAVE 30%',
    features: [
      'Everything in Monthly',
      'AI prediction history',
      'Bankroll management tools',
      'Private VIP chat room',
      'Early access to new features',
      'Personal prediction tracker',
    ],
    popular: true,
    color: '#FFD700',
  },
  {
    id: 'yearly',
    name: 'Annual VIP',
    price: '$14.99',
    period: '/year',
    badge: 'SAVE 37%',
    features: [
      'Everything in 6-Month',
      'Expert analyst access',
      'Priority support',
      'Beta features',
    ],
    popular: false,
    color: '#00FF87',
  },
];

// ─── DEV-ONLY: Mock fixtures (NOT for production use) ────────────────────────
// Only export when explicitly in development — never as a production fallback.
// These are intentionally minimal; add detail only as needed for UI tests.

/** @dev Only use in __DEV__ === true environments */
export const DEV_MOCK_MATCHES: Match[] = __DEV__ ? [
  {
    id: 'dev-match-1',
    sport: 'football',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    homeScore: 1,
    awayScore: 0,
    status: 'live',
    matchTime: new Date().toISOString(),
    league: 'Dev League',
    venue: 'Dev Stadium',
    minute: 45,
  },
  {
    id: 'dev-match-2',
    sport: 'basketball',
    homeTeam: 'Home Bulls',
    awayTeam: 'Away Lakers',
    homeScore: 58,
    awayScore: 62,
    status: 'live',
    matchTime: new Date().toISOString(),
    league: 'Dev NBA',
    minute: 0,
  },
] : [];

/** @dev Only use in __DEV__ === true environments */
export const DEV_MOCK_NOTIFICATIONS: Notification[] = __DEV__ ? [
  {
    id: 'dev-notif-1',
    userId: 'dev-user',
    title: 'Dev: Match Started',
    body: 'Home FC vs Away FC is now live.',
    type: 'live',
    read: false,
    createdAt: new Date().toISOString(),
  },
] : [];

// ─── Aliases kept for backward compatibility — these must NOT be used in production
// If any code imports MOCK_MATCHES, MOCK_PREDICTIONS, or MOCK_CHAT_MESSAGES
// it MUST be refactored to use real Supabase data with an honest empty state.

/** @deprecated Use real Supabase data. Shows empty array in production. */
export const MOCK_MATCHES: Match[] = __DEV__ ? DEV_MOCK_MATCHES : [];

/** @deprecated Use real Supabase data. Shows empty array in production. */
export const MOCK_PREDICTIONS: Prediction[] = [];

/** @deprecated Use real Supabase data. Shows empty array in production. */
export const MOCK_NOTIFICATIONS: Notification[] = __DEV__ ? DEV_MOCK_NOTIFICATIONS : [];

/** @deprecated Use real Supabase data. Shows empty array in production. */
export const MOCK_CHAT_MESSAGES: ChatMessage[] = [];
