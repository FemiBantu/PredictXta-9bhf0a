/**
 * translationService.ts — AI-powered dynamic content translation
 *
 * Uses OnSpace AI (Gemini 3 Flash) via the translate-content edge function
 * with a two-tier cache (in-memory + Supabase translations_cache) to keep
 * latency low and API costs minimal.
 *
 * Architecture:
 *  1. Terminology Protection Engine — never translates team/league/player names
 *  2. In-memory LRU cache  (instant, per-session)
 *  3. Supabase DB cache    (persisted, shared across sessions)
 *  4. OnSpace AI edge fn  (Gemini 3 Flash translation)
 *
 * Rules enforced:
 *  - Source language is always English (master data language)
 *  - Backend DB / analytics data is NEVER translated
 *  - Translation only happens at the presentation layer
 */

import { getSupabaseClient } from '@/template';
import type { FunctionsHttpError } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ContentType =
  | 'ai_analysis'
  | 'expert_tip'
  | 'match_preview'
  | 'notification'
  | 'chat_message'
  | 'odds_analysis'
  | 'key_factor'
  | 'news_headline'
  | 'news_body'
  | 'general';

export interface TranslationRequest {
  text: string;
  targetLanguage: string;
  contentType?: ContentType;
  sourceLanguage?: string;
}

export interface TranslationResult {
  original: string;
  translated: string;
  fromCache: boolean;
  targetLanguage: string;
}

export interface BatchTranslationRequest {
  texts: string[];
  targetLanguage: string;
  contentType?: ContentType;
}

// ─── Terminology Protection Dictionary ───────────────────────────────────────
// These tokens are NEVER translated — always preserved verbatim.
// Covers: league names, competition names, sport brands, and team names.
// Add new entries as the platform expands to new sports/regions.

const PROTECTED_TERMS: RegExp[] = [
  // ─ Competition names
  /\bPremier League\b/gi,
  /\bLa Liga\b/gi,
  /\bSerie A\b/gi,
  /\bBundesliga\b/gi,
  /\bLigue 1\b/gi,
  /\bEredivisie\b/gi,
  /\bPrimeira Liga\b/gi,
  /\bChampions League\b/gi,
  /\bUEFA\b/gi,
  /\bFIFA World Cup\b/gi,
  /\bWorld Cup\b/gi,
  /\bEuro (20\d\d)?\b/gi,
  /\bAFCON\b/gi,
  /\bCopa America\b/gi,
  /\bEFL Championship\b/gi,
  /\bFA Cup\b/gi,
  /\bCarabao Cup\b/gi,
  /\bNBA\b/g,
  /\bNFL\b/g,
  /\bMLB\b/g,
  /\bNHL\b/g,
  /\bUFC\b/g,
  /\bIPL\b/g,
  /\bFormula 1\b/gi,
  /\bF1\b/g,
  /\bRoland Garros\b/gi,
  /\bWimbledon\b/gi,
  /\bUS Open\b/gi,
  /\bAustralian Open\b/gi,
  // ─ Common top club names (football)
  /\bManchester (United|City)\b/gi,
  /\bReal Madrid\b/gi,
  /\bFC Barcelona\b/gi,
  /\bBarcelona\b/gi,
  /\bBayern Munich\b/gi,
  /\bJuventus\b/gi,
  /\bAC Milan\b/gi,
  /\bInter Milan\b/gi,
  /\bPSG\b/g,
  /\bParis Saint-Germain\b/gi,
  /\bChelsea\b/gi,
  /\bArsenal\b/gi,
  /\bLiverpool\b/gi,
  /\bTottenham\b/gi,
  /\bBorussia Dortmund\b/gi,
  /\bAtletico Madrid\b/gi,
  // ─ Player names (top global stars)
  /\bLionel Messi\b/gi,
  /\bCristiano Ronaldo\b/gi,
  /\bKylian Mbapp[eé]\b/gi,
  /\bErling Haaland\b/gi,
  /\bNeymar\b/gi,
  /\bVinicius (Jr\.?)?\b/gi,
  /\bLeBron James\b/gi,
  /\bStephen Curry\b/gi,
  // ─ Brand / app terms
  /\bPredictXta\b/gi,
  /\bVIP\b/g,
  /\bGPT\b/g,
  /\bAI\b/g,
];

/**
 * Checks if text is trivially untranslatable:
 * - pure numbers, scores, percentages, odds values
 * - very short strings (< 3 chars)
 * - already non-ASCII (already in target script)
 */
function isTriviallyUntranslatable(text: string): boolean {
  if (!text?.trim() || text.trim().length < 3) return true;
  // Pure number / percentage / score (e.g. "73%", "2-1", "1.85", "45+2")
  if (/^[\d\s\-+.:/%,()]+$/.test(text.trim())) return true;
  return false;
}

/**
 * Replace protected terms with placeholders before translation,
 * then restore them after.  This prevents the AI from translating
 * team/league/player names.
 *
 * Returns { sanitized, restore } where restore(translated) puts the
 * original terms back.
 */
function protectTerminology(text: string): { sanitized: string; restore: (s: string) => string } {
  const placeholders: string[] = [];
  let sanitized = text;

  for (const pattern of PROTECTED_TERMS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `__PXTX${idx}__`;
    });
  }

  const restore = (translated: string): string => {
    let result = translated;
    for (let i = 0; i < placeholders.length; i++) {
      result = result.replace(new RegExp(`__PXTX${i}__`, 'g'), placeholders[i]);
    }
    return result;
  };

  return { sanitized, restore };
}

// ─── In-memory LRU cache (max 500 entries per session) ───────────────────────
const MAX_MEM_CACHE = 500;
const memCache = new Map<string, string>();

function memCacheSet(key: string, value: string): void {
  if (memCache.size >= MAX_MEM_CACHE) {
    // Evict oldest entry
    const firstKey = memCache.keys().next().value;
    if (firstKey) memCache.delete(firstKey);
  }
  memCache.set(key, value);
}

// ─── Simple hash (djb2) for cache key ────────────────────────────────────────
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}

function buildCacheKey(text: string, targetLang: string): string {
  return simpleHash(`${targetLang}::${text}`);
}

// ─── Core Translation Function ────────────────────────────────────────────────
/**
 * Translates a single piece of text using cache-first strategy:
 * 1. Skip if English or trivially untranslatable
 * 2. Protect terminology placeholders
 * 3. Check in-memory cache
 * 4. Check Supabase translations_cache table
 * 5. Call translate-content edge function (OnSpace AI Gemini)
 * 6. Restore terminology placeholders in translated result
 * 7. Store in both caches
 *
 * Always returns the original text as fallback if translation fails.
 */
export async function translateText(req: TranslationRequest): Promise<TranslationResult> {
  const { text, targetLanguage, contentType = 'general', sourceLanguage = 'en' } = req;

  // Skip trivially untranslatable or same-language
  if (!text?.trim() || targetLanguage === 'en' || targetLanguage === sourceLanguage) {
    return { original: text, translated: text, fromCache: true, targetLanguage };
  }

  if (isTriviallyUntranslatable(text)) {
    return { original: text, translated: text, fromCache: true, targetLanguage };
  }

  // Protect terminology before caching/translating
  const { sanitized, restore } = protectTerminology(text);
  const cacheKey = buildCacheKey(sanitized, targetLanguage);

  // 1. In-memory cache hit
  const memHit = memCache.get(cacheKey);
  if (memHit) {
    return { original: text, translated: restore(memHit), fromCache: true, targetLanguage };
  }

  try {
    const supabase = getSupabaseClient();

    // 2. DB cache lookup
    const { data: cached } = await supabase
      .from('translations_cache')
      .select('translated_text, hit_count')
      .eq('content_hash', cacheKey)
      .eq('target_language', targetLanguage)
      .maybeSingle();

    if (cached?.translated_text) {
      memCacheSet(cacheKey, cached.translated_text);
      // Increment hit count async (non-blocking)
      supabase
        .from('translations_cache')
        .update({ hit_count: (cached.hit_count ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq('content_hash', cacheKey)
        .eq('target_language', targetLanguage)
        .then(() => {}).catch(() => {});
      return { original: text, translated: restore(cached.translated_text), fromCache: true, targetLanguage };
    }

    // 3. Call edge function with sanitized text (no protected terms)
    const { data, error } = await supabase.functions.invoke('translate-content', {
      body: { text: sanitized, targetLanguage, sourceLanguage, contentType },
    });

    if (error) {
      let msg = (error as any).message ?? 'Translation failed';
      try {
        const fErr = error as FunctionsHttpError;
        if (fErr?.context) {
          const statusCode = fErr.context?.status ?? 500;
          const textContent = await fErr.context?.text();
          msg = `[${statusCode}] ${textContent || msg}`;
        }
      } catch { /* ignore */ }
      console.warn('[translationService] Edge function error:', msg);
      return { original: text, translated: text, fromCache: false, targetLanguage };
    }

    const rawTranslated: string = data?.translated ?? sanitized;
    if (!rawTranslated) {
      return { original: text, translated: text, fromCache: false, targetLanguage };
    }

    // 4. Restore protected terms in translated result
    const finalTranslated = restore(rawTranslated);

    // 5. Store sanitized version in DB cache (async, non-blocking)
    memCacheSet(cacheKey, rawTranslated);
    supabase
      .from('translations_cache')
      .upsert({
        content_hash: cacheKey,
        original_text: sanitized.slice(0, 2000),
        translated_text: rawTranslated.slice(0, 2000),
        source_language: sourceLanguage,
        target_language: targetLanguage,
        content_type: contentType,
        hit_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'content_hash,target_language', ignoreDuplicates: false })
      .then(() => {}).catch(() => {});

    return { original: text, translated: finalTranslated, fromCache: false, targetLanguage };
  } catch (e) {
    console.warn('[translationService] Unexpected error:', e);
    return { original: text, translated: text, fromCache: false, targetLanguage };
  }
}

/**
 * Batch translate multiple texts at once using server-side batching when possible.
 * Falls back to parallel individual requests with max concurrency of 5.
 */
export async function batchTranslate(req: BatchTranslationRequest): Promise<string[]> {
  const { texts, targetLanguage, contentType = 'general' } = req;
  if (!texts.length || targetLanguage === 'en') return texts;

  // Try server-side batch first (single edge function call for up to 10 texts)
  if (texts.length <= 10) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('translate-content', {
        body: { texts, targetLanguage, sourceLanguage: 'en', contentType, batch: true },
      });
      if (!error && Array.isArray(data?.translations)) {
        // Restore terminology for each result
        return data.translations.map((translated: string, i: number) => {
          const { restore } = protectTerminology(texts[i]);
          return restore(translated);
        });
      }
    } catch { /* fall through to parallel */ }
  }

  // Parallel individual requests (max 5 concurrent)
  const CONCURRENCY = 5;
  const results: string[] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const chunk = texts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((text) =>
        translateText({ text, targetLanguage, contentType })
          .then((r) => r.translated)
          .catch(() => text),
      ),
    );
    for (let j = 0; j < chunkResults.length; j++) {
      results[i + j] = chunkResults[j];
    }
  }
  return results;
}

/**
 * Translate an AI analysis text with sports context.
 */
export async function translateAIAnalysis(
  text: string,
  targetLanguage: string,
): Promise<string> {
  if (!text || targetLanguage === 'en') return text;
  const result = await translateText({ text, targetLanguage, contentType: 'ai_analysis' });
  return result.translated;
}

/**
 * Translate a news headline with proper sports terminology protection.
 */
export async function translateNewsHeadline(
  title: string,
  targetLanguage: string,
): Promise<string> {
  if (!title || targetLanguage === 'en') return title;
  const result = await translateText({ text: title, targetLanguage, contentType: 'news_headline' });
  return result.translated;
}

/**
 * Translate a push notification (title + body) together.
 */
export async function translateNotification(
  title: string,
  body: string,
  targetLanguage: string,
): Promise<{ title: string; body: string }> {
  if (targetLanguage === 'en') return { title, body };
  const [tTitle, tBody] = await batchTranslate({
    texts: [title, body],
    targetLanguage,
    contentType: 'notification',
  });
  return { title: tTitle, body: tBody };
}

/**
 * Translate key factors array from AI predictions.
 */
export async function translateKeyFactors(
  factors: string[],
  targetLanguage: string,
): Promise<string[]> {
  if (!factors.length || targetLanguage === 'en') return factors;
  return batchTranslate({ texts: factors, targetLanguage, contentType: 'key_factor' });
}

/**
 * Clear the in-memory translation cache (call after language switch).
 */
export function clearTranslationMemCache(): void {
  memCache.clear();
}

/**
 * Get approximate cache stats for the analytics dashboard.
 */
export function getTranslationCacheStats(): { memSize: number; maxSize: number } {
  return { memSize: memCache.size, maxSize: MAX_MEM_CACHE };
}
