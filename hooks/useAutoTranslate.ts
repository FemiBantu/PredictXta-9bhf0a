/**
 * useAutoTranslate.ts
 *
 * Zero-boilerplate hook for inline dynamic content translation at the
 * presentation layer.  Integrates with LanguageContext so it always uses
 * the current app language and refreshes when the user switches language.
 *
 * Usage (simple):
 *   const { value, loading } = useAutoTranslate(aiAnalysisText, 'ai_analysis');
 *   <Text>{value}</Text>
 *
 * Usage (multiple strings):
 *   const { values, loading } = useAutoTranslateMany(keyFactors, 'key_factor');
 *
 * Design rules:
 * - Returns original text immediately; translation arrives asynchronously
 * - Shows loading state during first translation; instant on cache hits
 * - English always bypasses translation (returns immediately)
 * - Never mutates backend data — presentation layer ONLY
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  translateText,
  batchTranslate,
  type ContentType,
} from '@/services/translationService';

// ─── Single string translation hook ─────────────────────────────────────────
export interface UseAutoTranslateResult {
  /** The translated text (or original while loading / if en) */
  value: string;
  /** True only during the initial async translation */
  loading: boolean;
  /** Error message if translation failed (original text still returned) */
  error: string | null;
  /** Whether translation was served from cache */
  fromCache: boolean;
}

export function useAutoTranslate(
  text: string | null | undefined,
  contentType: ContentType = 'general',
): UseAutoTranslateResult {
  const { language } = useLanguage();
  const [value, setValue] = useState<string>(text ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(true);

  // Track last translated (text + language) to avoid redundant calls
  const lastRef = useRef<{ text: string; lang: string } | null>(null);

  useEffect(() => {
    const safeText = text ?? '';
    // Always sync value to original immediately (no flicker)
    setValue(safeText);

    if (!safeText.trim() || language === 'en') {
      setLoading(false);
      setError(null);
      return;
    }

    // De-duplicate: skip if same (text + language) already processed
    if (lastRef.current?.text === safeText && lastRef.current?.lang === language) return;
    lastRef.current = { text: safeText, lang: language };

    let cancelled = false;
    setLoading(true);
    setError(null);

    translateText({ text: safeText, targetLanguage: language, contentType })
      .then((result) => {
        if (cancelled) return;
        setValue(result.translated);
        setFromCache(result.fromCache);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
        // Keep original text on error
      });

    return () => { cancelled = true; };
  }, [text, language, contentType]);

  return { value, loading, error, fromCache };
}

// ─── Array of strings translation hook ──────────────────────────────────────
export interface UseAutoTranslateManyResult {
  /** The translated strings (or originals while loading / if en) */
  values: string[];
  loading: boolean;
  error: string | null;
}

export function useAutoTranslateMany(
  texts: string[] | null | undefined,
  contentType: ContentType = 'general',
): UseAutoTranslateManyResult {
  const { language } = useLanguage();
  const safeTexts = texts ?? [];
  const [values, setValues] = useState<string[]>(safeTexts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyRef = useRef<string>('');

  useEffect(() => {
    setValues(safeTexts);

    if (!safeTexts.length || language === 'en') {
      setLoading(false);
      return;
    }

    const key = `${language}::${safeTexts.join('|')}`;
    if (keyRef.current === key) return;
    keyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);

    batchTranslate({ texts: safeTexts, targetLanguage: language, contentType })
      .then((result) => {
        if (cancelled) return;
        setValues(result);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [safeTexts.join('||'), language, contentType]);

  return { values, loading, error };
}

// ─── Imperative translation helper (for callbacks / event handlers) ───────────
/**
 * Returns a translate function that uses the current language.
 * Useful inside event handlers where hooks cannot be called conditionally.
 *
 * Example:
 *   const { translateNow } = useTranslateNow();
 *   const translated = await translateNow(dynamicText, 'notification');
 */
export function useTranslateNow() {
  const { language } = useLanguage();

  const translateNow = useCallback(
    async (text: string, contentType: ContentType = 'general'): Promise<string> => {
      if (!text?.trim() || language === 'en') return text;
      const result = await translateText({ text, targetLanguage: language, contentType });
      return result.translated;
    },
    [language],
  );

  return { translateNow, currentLanguage: language };
}
