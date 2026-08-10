/**
 * useTranslatedContent.ts — Hook for on-demand AI content translation
 *
 * Usage:
 *   const { translate, translateArray } = useTranslatedContent();
 *   const translated = await translate(aiAnalysisText, 'ai_analysis');
 *
 * Automatically uses the current app language as target.
 * Returns original text immediately if language is English.
 */

import { useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  translateText,
  batchTranslate,
  translateAIAnalysis,
  translateKeyFactors,
  translateNewsHeadline,
  translateNotification,
  type ContentType,
} from '@/services/translationService';

export function useTranslatedContent() {
  const { language } = useLanguage();

  /**
   * Translate a single string to the current app language.
   * Returns the original if language is 'en' or translation fails.
   */
  const translate = useCallback(async (
    text: string,
    contentType: ContentType = 'general',
  ): Promise<string> => {
    if (!text?.trim() || language === 'en') return text;
    const result = await translateText({ text, targetLanguage: language, contentType });
    return result.translated;
  }, [language]);

  /**
   * Translate an array of strings (e.g. key factors) to the current language.
   */
  const translateArray = useCallback(async (
    texts: string[],
    contentType: ContentType = 'general',
  ): Promise<string[]> => {
    if (!texts.length || language === 'en') return texts;
    return batchTranslate({ texts, targetLanguage: language, contentType });
  }, [language]);

  /**
   * Translate AI analysis text with sports-aware context.
   */
  const translateAnalysis = useCallback(async (text: string): Promise<string> => {
    if (!text?.trim() || language === 'en') return text;
    return translateAIAnalysis(text, language);
  }, [language]);

  /**
   * Translate key factors array.
   */
  const translateFactors = useCallback(async (factors: string[]): Promise<string[]> => {
    if (!factors.length || language === 'en') return factors;
    return translateKeyFactors(factors, language);
  }, [language]);

  /**
   * Translate a news headline with sports terminology protection.
   */
  const translateHeadline = useCallback(async (text: string): Promise<string> => {
    if (!text?.trim() || language === 'en') return text;
    return translateNewsHeadline(text, language);
  }, [language]);

  /**
   * Translate a push notification title + body pair.
   */
  const translatePushNotification = useCallback(async (
    title: string,
    body: string,
  ): Promise<{ title: string; body: string }> => {
    if (language === 'en') return { title, body };
    return translateNotification(title, body, language);
  }, [language]);

  return {
    translate,
    translateArray,
    translateAnalysis,
    translateFactors,
    translateHeadline,
    translatePushNotification,
    currentLanguage: language,
    needsTranslation: language !== 'en',
  };
}
