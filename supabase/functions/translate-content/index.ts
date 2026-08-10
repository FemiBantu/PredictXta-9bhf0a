/**
 * translate-content edge function
 *
 * Translates text (or a batch of texts) using OnSpace AI (Gemini 3 Flash)
 * with sports-context-aware system prompts and terminology protection.
 *
 * Request body (single):
 *   { text: string, targetLanguage: string, sourceLanguage?: string, contentType?: string }
 *
 * Request body (batch):
 *   { texts: string[], targetLanguage: string, sourceLanguage?: string, contentType?: string, batch: true }
 *
 * Response (single):
 *   { translated: string, model: string, cached: false }
 *
 * Response (batch):
 *   { translations: string[], model: string }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Language name lookup ─────────────────────────────────────────────────────
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',   fr: 'French',     es: 'Spanish',   pt: 'Portuguese',
  ar: 'Arabic',    sw: 'Swahili',    de: 'German',    it: 'Italian',
  tr: 'Turkish',   hi: 'Hindi',      zh: 'Chinese',   ja: 'Japanese',
  ko: 'Korean',    ru: 'Russian',    nl: 'Dutch',      pl: 'Polish',
  id: 'Indonesian', th: 'Thai',      vi: 'Vietnamese', uk: 'Ukrainian',
};

// ─── Content-type specific translation instructions ───────────────────────────
const CONTENT_TYPE_INSTRUCTIONS: Record<string, string> = {
  ai_analysis:    'sports betting analysis — use natural sports terminology for the target language sports culture, keep probabilities and statistics unchanged',
  expert_tip:     'expert betting tip — use natural local sports terminology, preserve odds values',
  match_preview:  'match preview article — use natural sports commentary style',
  notification:   'push notification — keep it short, punchy, and action-oriented',
  chat_message:   'informal chat message — casual and conversational tone',
  odds_analysis:  'odds and probability analysis — preserve all numbers and use proper local sports betting terms',
  key_factor:     'match analysis key factor — concise and clear, one sentence',
  news_headline:  'news headline — concise, punchy, journalistic style',
  news_body:      'sports news article — natural journalistic style with proper sports terminology',
  general:        'sports app content — natural and clear language',
};

// ─── Terms that must NEVER be translated (presentation-layer protection) ──────
// These are injected into the system prompt to instruct the model.
const NEVER_TRANSLATE_INSTRUCTION = `
CRITICAL RULES — NEVER translate these:
- Team names (Manchester United, Real Madrid, FC Barcelona, Bayern Munich, Arsenal, Liverpool, etc.)
- Player names (Messi, Ronaldo, Mbappé, Haaland, etc.)
- Competition names (Premier League, La Liga, Serie A, Bundesliga, Champions League, World Cup, etc.)
- Stadium names
- Sponsor names and brand names
- Numbers, scores, percentages, and odds values
- The app name "PredictXta"
- "VIP", "AI", "GPT"
- Placeholder tokens like __PXTX0__
Keep all of the above EXACTLY as they appear in the source text.
`;

serve(async (req: Request) => {
  // ── CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      text,
      texts,
      targetLanguage = 'en',
      sourceLanguage = 'en',
      contentType = 'general',
      batch = false,
    } = body as {
      text?: string;
      texts?: string[];
      targetLanguage: string;
      sourceLanguage?: string;
      contentType?: string;
      batch?: boolean;
    };

    // ── Validate
    const isBatch = batch === true && Array.isArray(texts) && texts.length > 0;
    const singleText = text?.trim() ?? '';

    if (!isBatch && !singleText) {
      return new Response(
        JSON.stringify({ error: 'text or texts is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Passthrough when target === source
    if (targetLanguage === sourceLanguage || targetLanguage === 'en') {
      if (isBatch) {
        return new Response(
          JSON.stringify({ translations: texts, model: 'passthrough' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ translated: singleText, model: 'passthrough', cached: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const targetLangName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
    const sourceLangName = LANGUAGE_NAMES[sourceLanguage] ?? sourceLanguage;
    const typeInstructions = CONTENT_TYPE_INSTRUCTIONS[contentType] ?? CONTENT_TYPE_INSTRUCTIONS.general;

    // ── OnSpace AI setup
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!apiKey || !baseUrl) {
      throw new Error('OnSpace AI not configured');
    }

    const systemPrompt = `You are a professional sports content translator.
Task: translate ${sourceLangName} → ${targetLangName}.
Context: ${typeInstructions}
${NEVER_TRANSLATE_INSTRUCTION}
Output format: Return ONLY the translated text — no explanations, no quotes, no labels.
Use natural, fluent ${targetLangName} that sounds native to local sports fans.
Preserve emojis, special characters, and text formatting.`;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Batch translation (single AI call with structured output)
    if (isBatch) {
      const batchPrompt = `Translate each numbered item from ${sourceLangName} to ${targetLangName}.
Return a JSON array of translated strings in the same order, same count.
Format: ["translated1", "translated2", ...]
Source items:
${(texts as string[]).map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

      const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: batchPrompt },
          ],
          max_tokens: 2048,
          temperature: 0.1,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        throw new Error(`AI API error ${aiResponse.status}: ${errText.slice(0, 200)}`);
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content?.trim() ?? '[]';

      let translations: string[];
      try {
        // Strip markdown fences if present
        const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        translations = JSON.parse(cleaned);
        if (!Array.isArray(translations) || translations.length !== (texts as string[]).length) {
          throw new Error('length mismatch');
        }
      } catch {
        // Fallback: return originals
        translations = texts as string[];
      }

      // Log stats async
      const today = new Date().toISOString().split('T')[0];
      supabaseAdmin.from('translation_stats').upsert({
        date: today, target_language: targetLanguage, content_type: contentType,
        request_count: translations.length, cache_hit_count: 0, error_count: 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date,target_language,content_type' }).then(() => {}).catch(() => {});

      return new Response(
        JSON.stringify({ translations, model: 'google/gemini-3-flash-preview' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Single translation
    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: singleText },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error('Translation request failed');
    }

    const aiData = await aiResponse.json();
    const translated = aiData.choices?.[0]?.message?.content?.trim() ?? singleText;

    // ── Log stats (non-blocking)
    const today = new Date().toISOString().split('T')[0];
    supabaseAdmin.from('translation_stats').upsert({
      date: today, target_language: targetLanguage, content_type: contentType,
      request_count: 1, cache_hit_count: 0, error_count: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,target_language,content_type' }).then(() => {}).catch(() => {});

    return new Response(
      JSON.stringify({ translated, model: 'google/gemini-3-flash-preview', cached: false, targetLanguage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Translation service unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
