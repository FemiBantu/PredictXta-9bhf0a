/**
 * useLocale.ts — Convenience hook combining i18next + LanguageContext
 *
 * Usage:
 *   const { t, language, setLanguage, isRtl } = useLocale();
 *   <Text>{t('common.ok')}</Text>
 */

import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

export function useLocale() {
  const { t, i18n } = useTranslation();
  const langCtx = useLanguage();

  return {
    /** Translate a key (e.g. t('common.ok')) */
    t,
    /** i18next instance */
    i18n,
    /** Current language code */
    language: langCtx.language,
    /** Full language info (name, flag, rtl) */
    languageInfo: langCtx.languageInfo,
    /** All supported languages */
    supportedLanguages: langCtx.supportedLanguages,
    /** Whether layout should be RTL */
    isRtl: langCtx.isRtl,
    /** Switch language */
    setLanguage: langCtx.setLanguage,
    /** Whether first-launch prompt should show */
    showFirstLaunchPrompt: langCtx.showFirstLaunchPrompt,
    /** Dismiss first-launch prompt */
    dismissFirstLaunchPrompt: langCtx.dismissFirstLaunchPrompt,
    /** Whether language is still loading */
    loading: langCtx.loading,
  };
}
