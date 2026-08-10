import { corsHeaders } from '../_shared/cors.ts';
import {
  applySecurityMiddleware,
  applyUserRateLimit,
  secureHeaders,
  secureResponse,
  secureErrorResponse,
} from '../_shared/security.ts';

// ─── AI provider configuration (internal — not exposed to clients) ────────────
const AI_MODELS = {
  primary: 'gpt-4.1',
  fallback: 'gpt-4.1-mini',
  secondary: 'google/gemini-2.5-flash',
};
const OPENAI_BASE = 'https://api.openai.com/v1';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: secureHeaders });
  }

  try {
    // ── Security middleware ──────────────────────────────────────────────────
    const { guard, body: parsedBody, ip } = await applySecurityMiddleware(req, {
      rateLimit: { max: 30, windowSec: 60, blockSec: 60 },
      maxPayloadBytes: 32_000,
      rateLimitScope: 'chat',
      blockBotUa: true,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const aiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const aiBase = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!openaiKey && !aiKey) {
      return secureErrorResponse('Chat service unavailable', 503);
    }

    const body = parsedBody as Record<string, unknown>;
    const { messages, context } = body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      context?: {
        liveMatches?: Array<{ homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; league: string; minute?: number }>;
        todayMatches?: number;
        topPredictions?: Array<{ homeTeam: string; awayTeam: string; confidence: number; predictedResult: string; league: string }>;
      };
    };

    if (!messages || messages.length === 0) {
      return secureErrorResponse('messages array required', 400);
    }

    // ── Per-user rate limit ───────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const anonUserId = authHeader ? authHeader.slice(-20) : ip;
    const userGuard = applyUserRateLimit(anonUserId, 'chat', { max: 20, windowSec: 60, blockSec: 60 });
    if (userGuard) return userGuard;

    // ── Build context string from live match data ─────────────────────────────
    let contextStr = '';
    if (context?.liveMatches && context.liveMatches.length > 0) {
      const liveStr = context.liveMatches.slice(0, 5)
        .map((m) => `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.league}, ${m.minute ?? 0}')`)
        .join('; ');
      contextStr += `\n\nCURRENT LIVE MATCHES: ${liveStr}`;
    }
    if (context?.todayMatches !== undefined) {
      contextStr += `\n\nMATCHES TODAY: ${context.todayMatches} fixtures scheduled`;
    }
    if (context?.topPredictions && context.topPredictions.length > 0) {
      const predStr = context.topPredictions.slice(0, 3)
        .map((p) => `${p.homeTeam} vs ${p.awayTeam} → ${p.predictedResult.replace('_', ' ')} (${p.confidence}% conf, ${p.league})`)
        .join('; ');
      contextStr += `\n\nTOP AI PICKS TODAY: ${predStr}`;
    }

    const systemPrompt = `You are PX Analyst — the AI Sports Intelligence Assistant for PredictXta, a premium sports prediction platform.

You are an expert in:
- Football, Basketball, Tennis, Cricket, MMA, Baseball, Hockey, Rugby, F1, Esports
- Match analysis and match previews
- Betting markets (1X2, Over/Under, BTTS, Asian Handicap, Corners, Cards)
- Team and player statistics
- Historical trends and head-to-head records
- Odds interpretation and value betting
- Tournament progressions and standings
- AI prediction methodology and confidence scoring

PERSONALITY:
- Professional, confident, data-driven
- Concise but comprehensive — mobile-optimised responses
- Always clarify when data is unavailable rather than fabricating
- Use sports emojis tastefully for readability
- Format key stats in bold when responding

RULES:
- Never guarantee outcomes — always frame as probabilities
- If asked about a specific live match, reference the live context below if available
- Keep responses under 250 words unless deep analysis is requested
- If asked for predictions, give probabilities and key factors, not certainties
- Recommend checking the AI Picks tab for full predictions${contextStr}

You are here to help users understand sports, make informed decisions, and get the most from the PredictXta platform.`;

    const chatPayload = {
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10),
      ],
      temperature: 0.7,
      max_tokens: 600,
    };

    let reply = '';

    // ── Primary: OpenAI (primary model with fallback) ────────────────────────
    if (openaiKey) {
      for (const model of [AI_MODELS.primary, AI_MODELS.fallback]) {
        try {
          const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
            body: JSON.stringify({ ...chatPayload, model }),
          });
          if (res.ok) {
            const d = await res.json();
            const content = d.choices?.[0]?.message?.content ?? '';
            if (content.length > 10) { reply = content; break; }
          } else if (res.status !== 429 && res.status !== 503 && res.status !== 529) {
            break;
          }
        } catch { break; }
      }
    }

    // ── Fallback: Secondary AI provider ──────────────────────────────────────
    if (!reply && aiKey && aiBase) {
      try {
        const res = await fetch(`${aiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
          body: JSON.stringify({ ...chatPayload, model: AI_MODELS.secondary }),
        });
        if (res.ok) {
          const d = await res.json();
          reply = d.choices?.[0]?.message?.content ?? '';
        }
      } catch { /* secondary provider failed silently */ }
    }

    if (!reply) {
      reply = 'The assistant is temporarily unavailable. Please try again in a moment.';
    }

    return secureResponse({ reply });
  } catch {
    return secureErrorResponse('Internal server error', 500);
  }
});
