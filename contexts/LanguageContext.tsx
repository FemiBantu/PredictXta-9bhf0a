/**
 * LanguageContext.tsx — Global language state & persistence
 *
 * Manages:
 *  - Device locale auto-detection on first launch
 *  - Manual language switching
 *  - Persisting preference in AsyncStorage + Supabase user_profiles
 *  - RTL layout management
 *  - i18next language switching
 *  - First-launch language prompt flag
 */

import React, {
  createContext, useContext, useEffect, useState, useCallback, useRef,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n, {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  detectLanguageFromLocale,
  detectLanguageFromCountry,
  applyRtl,
  getLanguageInfo,
  type SupportedLanguage,
} from '@/services/i18n';
import { clearTranslationMemCache } from '@/services/translationService';
import { getSupabaseClient } from '@/template';

// ─── AsyncStorage keys ─────────────────────────────────────────────────────────
const LANG_KEY = '@predictxta/preferred_language';
const FIRST_LAUNCH_KEY = '@predictxta/language_first_prompt_shown';

// ─── Context Type ─────────────────────────────────────────────────────────────
interface LanguageContextValue {
  /** Current active language code (e.g. 'en', 'ar') */
  language: string;
  /** Full info object for current language */
  languageInfo: SupportedLanguage;
  /** All supported languages */
  supportedLanguages: SupportedLanguage[];
  /** Whether we are still loading the persisted preference */
  loading: boolean;
  /** Whether this is the very first launch and we should show the language prompt */
  showFirstLaunchPrompt: boolean;
  /** Whether current language is RTL */
  isRtl: boolean;
  /** Switch the app to a new language code */
  setLanguage: (code: string, userId?: string | null) => Promise<void>;
  /** Dismiss the first-launch language prompt */
  dismissFirstLaunchPrompt: () => void;
  /** Detected device locale at launch */
  detectedLocale: string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(true);
  const [showFirstLaunchPrompt, setShowFirstLaunchPrompt] = useState(false);
  const [detectedLocale, setDetectedLocale] = useState('en');
  const initDone = useRef(false);

  // ── Bootstrap: load persisted preference or detect from device ──────────────
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    (async () => {
      try {
        // 1. Detect device locale
        const locales = Localization.getLocales?.() ?? [];
        const deviceLocale = (locales[0]?.languageCode ?? Localization.locale ?? 'en').toLowerCase();
        setDetectedLocale(deviceLocale);

        // 2. Check for stored preference
        const [stored, firstPromptShown] = await Promise.all([
          AsyncStorage.getItem(LANG_KEY),
          AsyncStorage.getItem(FIRST_LAUNCH_KEY),
        ]);

        if (stored && SUPPORTED_LANGUAGES.find((l) => l.code === stored)) {
          // Previously set preference — apply it directly
          await applyLanguage(stored);
        } else {
          // First launch — detect from device
          const detected = detectLanguageFromLocale(deviceLocale);
          await applyLanguage(detected);

          // Show language prompt only if device detected non-English
          // so the user can confirm or change on first run
          if (!firstPromptShown) {
            setShowFirstLaunchPrompt(true);
          }
        }
      } catch (e) {
        console.warn('[LanguageContext] Init error:', e);
        await applyLanguage(DEFAULT_LANGUAGE);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Internal helper: apply a language code without persisting ────────────────
  const applyLanguage = useCallback(async (code: string) => {
    const safe = SUPPORTED_LANGUAGES.find((l) => l.code === code)?.code ?? DEFAULT_LANGUAGE;
    setLanguageState(safe);
    await i18n.changeLanguage(safe);
    applyRtl(safe);
    clearTranslationMemCache();
  }, []);

  // ── Public: switch language, persist, and optionally sync to DB ──────────────
  const setLanguage = useCallback(async (code: string, userId?: string | null) => {
    const safe = SUPPORTED_LANGUAGES.find((l) => l.code === code)?.code ?? DEFAULT_LANGUAGE;
    await applyLanguage(safe);

    // Persist locally
    await AsyncStorage.setItem(LANG_KEY, safe);

    // Sync to user profile if logged in (non-blocking)
    if (userId) {
      try {
        const supabase = getSupabaseClient();
        await supabase
          .from('user_profiles')
          .update({ preferred_language: safe })
          .eq('id', userId);
      } catch { /* non-blocking */ }
    }
  }, [applyLanguage]);

  const dismissFirstLaunchPrompt = useCallback(() => {
    setShowFirstLaunchPrompt(false);
    AsyncStorage.setItem(FIRST_LAUNCH_KEY, 'true').catch(() => {});
  }, []);

  const value: LanguageContextValue = {
    language,
    languageInfo: getLanguageInfo(language),
    supportedLanguages: SUPPORTED_LANGUAGES,
    loading,
    showFirstLaunchPrompt,
    isRtl: I18nManager.isRTL,
    setLanguage,
    dismissFirstLaunchPrompt,
    detectedLocale,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
