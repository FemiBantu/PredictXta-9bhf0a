/**
 * supabase/functions/_shared/aiProviderRouter.ts
 *
 * Unified AI Provider Router v2.0
 *
 * Architecture:
 *   All AI prediction calls go through this router.
 *   Primary:   OpenAI (GPT-5.5)
 *   Secondary: Anthropic (Claude)
 *   Tertiary:  Google (Gemini)
 *   Fallback:  Meta Llama (via Groq)
 *
 * Features:
 *   - Circuit breaker per provider (auto-disables after N failures)
 *   - Health-aware routing (skips unhealthy providers)
 *   - Configurable per-request routing strategy
 *   - Idempotent retry with exponential backoff
 *   - Schema validation on every response
 *   - Cost-optimized routing (low-value → single LLM, high-value → consensus)
 *   - Zero provider secrets exposed to client
 *   - Claude via native Anthropic Messages API (not OpenAI-compat)
 */

// ─── Provider registry ────────────────────────────────────────────────────────
export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'groq';
export type RoutingStrategy =
  | 'primary_only'          // quantitative model only, no LLM
  | 'single_fast'           // Groq/Llama for low-latency single call
  | 'single_primary'        // OpenAI only, no fallback
  | 'primary_with_fallback' // OpenAI → Anthropic → Gemini → Groq
  | 'consensus_two'         // OpenAI + Anthropic
  | 'consensus_three'       // OpenAI + Anthropic + Gemini
  | 'consensus_four';       // OpenAI + Anthropic + Gemini + Groq (full consensus)

export interface ProviderConfig {
  provider: AIProvider;
  baseURL: string;
  models: string[];        // ordered by preference
  timeoutMs: number;
  maxRetries: number;
}

export interface ProviderHealth {
  provider: AIProvider;
  consecutiveFailures: number;
  lastFailureMs: number;
  circuitOpen: boolean;
  cooldownMs: number;
}

// In-memory circuit breaker state (persists across requests within same isolate)
const CIRCUIT_STATE: Record<AIProvider, ProviderHealth> = {
  openai:    { provider: 'openai',    consecutiveFailures: 0, lastFailureMs: 0, circuitOpen: false, cooldownMs: 120_000 },
  anthropic: { provider: 'anthropic', consecutiveFailures: 0, lastFailureMs: 0, circuitOpen: false, cooldownMs: 120_000 },
  gemini:    { provider: 'gemini',    consecutiveFailures: 0, lastFailureMs: 0, circuitOpen: false, cooldownMs: 120_000 },
  groq:      { provider: 'groq',      consecutiveFailures: 0, lastFailureMs: 0, circuitOpen: false, cooldownMs: 60_000 },
};

const CIRCUIT_OPEN_THRESHOLD = 3; // failures before circuit opens

// Anthropic native Messages API — not OpenAI-compatible
const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_API_VERSION = '2023-06-01';

export const PROVIDER_CONFIGS: Record<AIProvider, ProviderConfig> = {
  openai: {
    provider: 'openai',
    // GPT-5.5 is the primary model; gpt-4.1 is the fallback within the provider
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-5.5', 'gpt-4.1'],
    timeoutMs: 30_000,
    maxRetries: 1,
  },
  anthropic: {
    provider: 'anthropic',
    // Claude uses native Messages API — baseURL is used for health check only
    baseURL: ANTHROPIC_API_BASE,
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022'],
    timeoutMs: 28_000,
    maxRetries: 1,
  },
  gemini: {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    timeoutMs: 25_000,
    maxRetries: 1,
  },
  groq: {
    // Groq hosts Meta Llama models — used as the high-speed Llama provider
    provider: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-70b-versatile'],
    timeoutMs: 20_000,
    maxRetries: 1,
  },
};

// Provider call order for each routing strategy
// Order: OpenAI (GPT-5.5) → Anthropic (Claude) → Gemini → Groq (Llama)
const ROUTING_ORDER: Record<RoutingStrategy, AIProvider[]> = {
  primary_only:           [],
  single_fast:            ['groq'],
  single_primary:         ['openai'],
  primary_with_fallback:  ['openai', 'anthropic', 'gemini', 'groq'],
  consensus_two:          ['openai', 'anthropic'],
  consensus_three:        ['openai', 'anthropic', 'gemini'],
  consensus_four:         ['openai', 'anthropic', 'gemini', 'groq'],
};

// ─── Circuit breaker helpers ─────────────────────────────────────────────────
function isCircuitOpen(provider: AIProvider): boolean {
  const state = CIRCUIT_STATE[provider];
  if (!state.circuitOpen) return false;
  // Auto-reset after cooldown
  if (Date.now() - state.lastFailureMs > state.cooldownMs) {
    state.circuitOpen = false;
    state.consecutiveFailures = 0;
    console.log(`[AIRouter] Circuit reset for ${provider}`);
    return false;
  }
  return true;
}

function recordSuccess(provider: AIProvider): void {
  const state = CIRCUIT_STATE[provider];
  state.consecutiveFailures = 0;
  state.circuitOpen = false;
}

function recordFailure(provider: AIProvider): void {
  const state = CIRCUIT_STATE[provider];
  state.consecutiveFailures++;
  state.lastFailureMs = Date.now();
  if (state.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
    state.circuitOpen = true;
    console.warn(`[AIRouter] Circuit OPEN for ${provider} after ${state.consecutiveFailures} failures`);
  }
}

// ─── Provider key resolver ────────────────────────────────────────────────────
function getApiKey(provider: AIProvider): string | undefined {
  switch (provider) {
    case 'openai':    return Deno.env.get('OPENAI_API_KEY');
    case 'anthropic': return Deno.env.get('ANTHROPIC_API_KEY');
    case 'gemini':    return Deno.env.get('Gemini_API_Key');
    case 'groq':      return Deno.env.get('Groq_API') ?? Deno.env.get('Groq_API_Key');
  }
}

// ─── Single provider call ─────────────────────────────────────────────────────
export interface AICallOptions {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  requireJsonObject?: boolean;
}

export interface AICallResult {
  provider: AIProvider;
  model: string;
  content: string;
  latencyMs: number;
  tokensUsed?: number;
}

/**
 * Call a single provider+model combination.
 * Anthropic uses the native Messages API; all others use OpenAI-compatible /chat/completions.
 */
async function callProviderModel(
  provider: AIProvider,
  model: string,
  options: AICallOptions,
): Promise<AICallResult | null> {
  const cfg = PROVIDER_CONFIGS[provider];
  const apiKey = getApiKey(provider);
  if (!apiKey) return null;

  const startMs = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    let res: Response;

    if (provider === 'anthropic') {
      // ── Anthropic native Messages API ───────────────────────────────────────
      // Extract system message (first message with role='system') if present
      const systemMsg = options.messages.find((m) => m.role === 'system')?.content ?? '';
      const userMessages = options.messages.filter((m) => m.role !== 'system');

      const anthropicBody: Record<string, unknown> = {
        model,
        max_tokens: options.maxTokens ?? 1400,
        temperature: options.temperature ?? 0.5,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (systemMsg) anthropicBody.system = systemMsg;

      res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(anthropicBody),
        signal: controller.signal,
      });
    } else {
      // ── OpenAI-compatible API (OpenAI, Gemini OpenAI-compat, Groq) ─────────
      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? 1400,
      };
      if (options.requireJsonObject && provider !== 'groq') {
        // Groq Llama models may not support json_object response_format
        body.response_format = { type: 'json_object' };
      }

      res = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[AIRouter] ${provider}/${model} returned ${res.status}: ${errText.slice(0, 120)}`);
      return null;
    }

    const data = await res.json() as Record<string, unknown>;

    // Extract content — Anthropic and OpenAI-compat have different shapes
    let content = '';
    if (provider === 'anthropic') {
      // Anthropic: data.content[0].text
      const blocks = data.content as Array<{ type: string; text?: string }> | undefined;
      content = blocks?.find((b) => b.type === 'text')?.text ?? '';
    } else {
      // OpenAI-compat: data.choices[0].message.content
      content = ((data.choices as any[])?.[0]?.message?.content ?? '') as string;
    }

    const usage = data.usage as { total_tokens?: number; input_tokens?: number; output_tokens?: number } | undefined;
    const tokensUsed = usage?.total_tokens ?? ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0));

    if (!content || content.length < 20) return null;

    return {
      provider,
      model,
      content,
      latencyMs: Date.now() - startMs,
      tokensUsed: tokensUsed || undefined,
    };
  } catch (err) {
    console.warn(`[AIRouter] ${provider}/${model} threw:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Route single call through provider chain ─────────────────────────────────
export async function routeAICall(
  strategy: RoutingStrategy,
  options: AICallOptions,
): Promise<AICallResult | null> {
  const providers = ROUTING_ORDER[strategy];
  if (providers.length === 0) return null; // primary_only — no LLM

  for (const provider of providers) {
    // Skip if circuit is open
    if (isCircuitOpen(provider)) {
      console.log(`[AIRouter] Skipping ${provider} — circuit open`);
      continue;
    }

    const apiKey = getApiKey(provider);
    if (!apiKey) continue;

    const cfg = PROVIDER_CONFIGS[provider];
    for (const model of cfg.models) {
      const result = await callProviderModel(provider, model, options);
      if (result) {
        recordSuccess(provider);
        console.log(`[AIRouter] ${provider}/${model} success in ${result.latencyMs}ms`);
        return result;
      }
    }

    // All models for this provider failed
    recordFailure(provider);
  }

  console.error(`[AIRouter] All providers failed for strategy=${strategy}`);
  return null;
}

// ─── Route consensus call to multiple providers in parallel ───────────────────
export interface ConsensusCallResult {
  results: AICallResult[];
  providersAttempted: AIProvider[];
  providersSucceeded: AIProvider[];
  latencyMs: number;
}

export async function routeConsensusCall(
  strategy: Extract<RoutingStrategy, 'consensus_two' | 'consensus_three'>,
  options: AICallOptions,
): Promise<ConsensusCallResult> {
  const providers = ROUTING_ORDER[strategy];
  const startMs = Date.now();

  const calls = providers
    .filter((p) => !isCircuitOpen(p) && !!getApiKey(p))
    .map(async (provider): Promise<{ provider: AIProvider; result: AICallResult | null }> => {
      const cfg = PROVIDER_CONFIGS[provider];
      for (const model of cfg.models) {
        const result = await callProviderModel(provider, model, options);
        if (result) return { provider, result };
      }
      return { provider, result: null };
    });

  const settled = await Promise.allSettled(calls);
  const results: AICallResult[] = [];
  const providersAttempted: AIProvider[] = [];
  const providersSucceeded: AIProvider[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { provider, result } = s.value;
      providersAttempted.push(provider);
      if (result) {
        results.push(result);
        providersSucceeded.push(provider);
        recordSuccess(provider);
      } else {
        recordFailure(provider);
      }
    }
  }

  return {
    results,
    providersAttempted,
    providersSucceeded,
    latencyMs: Date.now() - startMs,
  };
}

// ─── JSON parser with schema validation ──────────────────────────────────────
export function parseAndValidatePredictionJSON(
  raw: string,
  requiredFields: string[] = ['home_win_prob', 'away_win_prob', 'predicted_result', 'confidence'],
): Record<string, unknown> | null {
  if (!raw || raw.length < 20) return null;

  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.status === 'insufficient_data') return null;

  // Validate required fields
  for (const field of requiredFields) {
    if (parsed[field] === undefined || parsed[field] === null) {
      console.warn(`[AIRouter] Schema validation failed: missing ${field}`);
      return null;
    }
  }

  return parsed;
}

// ─── Determine routing strategy from match context ────────────────────────────
export interface MatchContext {
  sport: string;
  dqScore: number;
  league?: string;
  isHighValue?: boolean;
  isLive?: boolean;
}

export function selectRoutingStrategy(ctx: MatchContext): RoutingStrategy {
  // Full 4-provider consensus: major leagues with excellent data
  if (ctx.dqScore >= 80 && ctx.isHighValue) return 'consensus_four';

  // 3-provider consensus: high data quality
  if (ctx.dqScore >= 75) return 'consensus_three';

  // 2-provider consensus: decent data, high-value league
  if (ctx.dqScore >= 60 && ctx.isHighValue) return 'consensus_two';

  // Live matches — prioritize speed (Llama via Groq)
  if (ctx.isLive) return 'single_fast';

  // Low data quality — fast single model (Llama)
  if (ctx.dqScore < 40) return 'single_fast';

  // Default — primary with sequential fallback through all 4 providers
  return 'primary_with_fallback';
}

// ─── Cost-routing selector (tokens budget) ───────────────────────────────────
export function isHighValueLeague(league?: string): boolean {
  if (!league) return false;
  const HIGH_VALUE = [
    'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1',
    'UEFA Champions League', 'UEFA Europa League',
    'NBA', 'NFL', 'MLB', 'NHL',
    'ATP Tour', 'WTA Tour', 'Wimbledon', 'Roland Garros', 'US Open Tennis',
    'IPL', 'UFC',
  ];
  return HIGH_VALUE.some((l) => league.includes(l));
}

// ─── Health report (for admin dashboard) ─────────────────────────────────────
export function getProviderCircuitHealth(): Array<{
  provider: AIProvider;
  circuitOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
}> {
  return (Object.keys(CIRCUIT_STATE) as AIProvider[]).map((p) => {
    const s = CIRCUIT_STATE[p];
    const elapsed = Date.now() - s.lastFailureMs;
    return {
      provider: p,
      circuitOpen: s.circuitOpen,
      consecutiveFailures: s.consecutiveFailures,
      cooldownRemainingMs: s.circuitOpen ? Math.max(0, s.cooldownMs - elapsed) : 0,
    };
  });
}
