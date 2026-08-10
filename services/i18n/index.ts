/**
 * i18n/index.ts — i18next initialization for PredictXta
 *
 * Supports: en, fr, es, pt, ar, sw, de, it, tr, hi, zh
 * RTL: Arabic uses right-to-left layout via I18nManager
 * All locale JSON files are bundled locally — no network dependency.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

// ─── Locale bundles ────────────────────────────────────────────────────────────
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import ar from './locales/ar.json';
import sw from './locales/sw.json';
import de from './locales/de.json';
import it from './locales/it.json';
import tr from './locales/tr.json';
import hi from './locales/hi.json';
import zh from './locales/zh.json';

// ─── Supported languages config ───────────────────────────────────────────────
export interface SupportedLanguage {
  code: string;
  name: string;        // English name
  nativeName: string;  // Native name shown in UI
  flag: string;        // Emoji flag
  rtl: boolean;
  region?: string;     // Common device locale prefix (e.g. 'fr' matches 'fr-FR')
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English',    nativeName: 'English',    flag: '🇬🇧', rtl: false, region: 'en' },
  { code: 'fr', name: 'French',     nativeName: 'Français',   flag: '🇫🇷', rtl: false, region: 'fr' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',    flag: '🇪🇸', rtl: false, region: 'es' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português',  flag: '🇧🇷', rtl: false, region: 'pt' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch',    flag: '🇩🇪', rtl: false, region: 'de' },
  { code: 'it', name: 'Italian',    nativeName: 'Italiano',   flag: '🇮🇹', rtl: false, region: 'it' },
  { code: 'tr', name: 'Turkish',    nativeName: 'Türkçe',     flag: '🇹🇷', rtl: false, region: 'tr' },
  { code: 'hi', name: 'Hindi',      nativeName: 'हिंदी',       flag: '🇮🇳', rtl: false, region: 'hi' },
  { code: 'zh', name: 'Chinese',    nativeName: '中文',         flag: '🇨🇳', rtl: false, region: 'zh' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',    flag: '🇸🇦', rtl: true,  region: 'ar' },
  { code: 'sw', name: 'Swahili',    nativeName: 'Kiswahili',  flag: '🇰🇪', rtl: false, region: 'sw' },
];

export const DEFAULT_LANGUAGE = 'en';
export const RTL_LANGUAGES = new Set<string>(['ar']);

/**
 * Country code → language code mapping for IP-geolocation fallback.
 * Maps ISO 3166-1 alpha-2 country codes to preferred language.
 */
export const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // French-speaking countries
  FR: 'fr', BE: 'fr', CH: 'fr', CA: 'fr', SN: 'fr', CI: 'fr',
  CM: 'fr', CD: 'fr', MG: 'fr', ML: 'fr', NE: 'fr', BF: 'fr',
  // Spanish-speaking countries
  ES: 'es', MX: 'es', CO: 'es', AR: 'es', CL: 'es', PE: 'es',
  VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es',
  HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es',
  UY: 'es', GQ: 'es',
  // Portuguese-speaking countries
  BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', GW: 'pt', ST: 'pt',
  // German-speaking countries
  DE: 'de', AT: 'de', LI: 'de',
  // Italian-speaking countries
  IT: 'it', SM: 'it', VA: 'it',
  // Turkish
  TR: 'tr', CY: 'tr',
  // Hindi / Indian subcontinent
  IN: 'hi',
  // Chinese
  CN: 'zh', TW: 'zh', HK: 'zh', SG: 'zh', MO: 'zh',
  // Arabic-speaking countries
  SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar',
  IQ: 'ar', JO: 'ar', LB: 'ar', SY: 'ar', YE: 'ar', OM: 'ar',
  KW: 'ar', QA: 'ar', BH: 'ar', LY: 'ar', SD: 'ar', SO: 'ar',
  // Swahili-speaking countries
  KE: 'sw', TZ: 'sw', UG: 'sw', RW: 'sw',
};

/**
 * Map a device locale (e.g. 'fr-FR', 'ar-SA') to a supported language code.
 * Falls back to 'en' if no match found.
 */
export function detectLanguageFromLocale(locale: string): string {
  if (!locale) return DEFAULT_LANGUAGE;
  const lower = locale.toLowerCase();
  // Exact match first (e.g. 'zh-CN')
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lower === lang.code) return lang.code;
    if (lower === lang.region) return lang.code;
  }
  // Prefix match (e.g. 'fr-FR' → 'fr')
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lower.startsWith((lang.region ?? lang.code) + '-')) return lang.code;
    if (lower.startsWith(lang.code + '-')) return lang.code;
  }
  // Two-letter prefix
  const twoLetter = lower.substring(0, 2);
  for (const lang of SUPPORTED_LANGUAGES) {
    if ((lang.region ?? lang.code) === twoLetter) return lang.code;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Map a country code (ISO 3166-1 alpha-2) to a supported language code.
 */
export function detectLanguageFromCountry(countryCode: string): string {
  if (!countryCode) return DEFAULT_LANGUAGE;
  return COUNTRY_TO_LANGUAGE[countryCode.toUpperCase()] ?? DEFAULT_LANGUAGE;
}

/** Apply or remove RTL layout for the given language code. */
export function applyRtl(langCode: string): void {
  const shouldBeRtl = RTL_LANGUAGES.has(langCode);
  if (I18nManager.isRTL !== shouldBeRtl) {
    I18nManager.forceRTL(shouldBeRtl);
    I18nManager.allowRTL(shouldBeRtl);
  }
}

/** Return the SupportedLanguage object for a code, defaulting to English. */
export function getLanguageInfo(code: string): SupportedLanguage {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0];
}

// ─── i18next initialisation ───────────────────────────────────────────────────
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    pt: { translation: pt },
    de: { translation: de },
    it: { translation: it },
    tr: { translation: tr },
    hi: { translation: hi },
    zh: { translation: zh },
    ar: { translation: ar },
    sw: { translation: sw },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false, // React Native handles escaping
  },
  compatibilityJSON: 'v4',
});

export default i18n;
