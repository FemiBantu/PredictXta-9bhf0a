/**
 * _shared/providerHealth.ts — PredictXta Enterprise Provider Health Engine v3
 *
 * CRITICAL FIXES v3:
 *  ✓ Circuit breaker failureThreshold raised 3→5 (was too aggressive)
 *  ✓ openToHalfOpenSec reduced 60→30s (faster recovery)
 *  ✓ 404 responses NO LONGER trip the circuit (plan limitation, not outage)
 *  ✓ Auth errors (401/403) trip circuit immediately (bad key)
 *  ✓ fetchWithTimeout uses globalThis.fetch (Deno-safe)
 *  ✓ recordSuccess properly resets failure count
 *  ✓ resetAllCircuits() export for admin recovery
 *  ✓ getOrInitState() thread-safe init
 *
 * Circuit Breaker States:
 *   CLOSED  → Normal operation
 *   OPEN    → Provider skipped; health-check retries after cooldown
 *   HALF    → Testing recovery; one probe request allowed
 */

export type ProviderStatus = 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';
export type CircuitState  = 'CLOSED' | 'OPEN' | 'HALF';

// ─── Configuration ─────────────────────────────────────────────────────────────
const CIRCUIT_CONFIG = {
  /** Consecutive failures before opening circuit */
  failureThreshold: 5,
  /** Seconds before attempting HALF-OPEN probe */
  openToHalfOpenSec: 30,
  /** Consecutive successes needed to close from HALF */
  halfOpenSuccessRequired: 2,
  /** Default fetch timeout ms */
  defaultTimeoutMs: 10_000,
  /** Max retry attempts (0 = no retry, just one attempt) */
  maxRetries: 2,
  /** Base backoff ms */
  baseBackoffMs: 1_000,
};

// ─── In-Memory Provider State ─────────────────────────────────────────────────
interface ProviderState {
  name: string;
  state: CircuitState;
  /** Consecutive failures (resets on success) */
  consecutiveFailures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  openedAt: number;
  halfOpenAttempts: number;
  totalRequests: number;
  totalErrors: number;
  lastError: string | null;
  avgLatencyMs: number;
  latencySamples: number[];
}

const _providerStates = new Map<string, ProviderState>();

function getOrInitState(provider: string): ProviderState {
  if (!_providerStates.has(provider)) {
    _providerStates.set(provider, {
      name: provider,
      state: 'CLOSED',
      consecutiveFailures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      openedAt: 0,
      halfOpenAttempts: 0,
      totalRequests: 0,
      totalErrors: 0,
      lastError: null,
      avgLatencyMs: 0,
      latencySamples: [],
    });
  }
  return _providerStates.get(provider)!;
}

// ─── Circuit Breaker Logic ────────────────────────────────────────────────────

export function recordSuccess(provider: string, latencyMs: number): void {
  const s = getOrInitState(provider);
  s.successes++;
  s.totalRequests++;
  s.lastSuccessTime = Date.now();
  s.consecutiveFailures = 0; // reset on ANY success

  s.latencySamples.push(latencyMs);
  if (s.latencySamples.length > 20) s.latencySamples.shift();
  s.avgLatencyMs = s.latencySamples.reduce((a, b) => a + b, 0) / s.latencySamples.length;

  if (s.state === 'HALF') {
    s.halfOpenAttempts++;
    if (s.halfOpenAttempts >= CIRCUIT_CONFIG.halfOpenSuccessRequired) {
      console.log(`[Circuit] ${provider}: HALF→CLOSED after ${s.halfOpenAttempts} successes`);
      s.state = 'CLOSED';
      s.halfOpenAttempts = 0;
    }
  }
  _providerStates.set(provider, s);
}

/**
 * Record a failure. 404 responses do NOT trip the circuit (plan limitation).
 * Auth errors (401/403) trip immediately.
 */
export function recordFailure(
  provider: string,
  error: string,
  options: { isAuthError?: boolean; is404?: boolean } = {},
): void {
  const s = getOrInitState(provider);
  s.totalRequests++;
  s.totalErrors++;
  s.lastFailureTime = Date.now();
  s.lastError = error.substring(0, 200);

  // 404 = endpoint not on plan, NOT a circuit-trip condition
  if (options.is404) {
    console.log(`[Circuit] ${provider}: 404 (plan limitation) — circuit stays CLOSED`);
    _providerStates.set(provider, s);
    return;
  }

  s.consecutiveFailures++;

  // Auth errors open circuit immediately
  if (options.isAuthError) {
    console.warn(`[Circuit] ${provider}: Auth error → OPEN immediately`);
    s.state = 'OPEN';
    s.openedAt = Date.now();
    s.halfOpenAttempts = 0;
    _providerStates.set(provider, s);
    return;
  }

  if (s.state === 'CLOSED' && s.consecutiveFailures >= CIRCUIT_CONFIG.failureThreshold) {
    console.warn(`[Circuit] ${provider}: CLOSED→OPEN after ${s.consecutiveFailures} consecutive failures`);
    s.state = 'OPEN';
    s.openedAt = Date.now();
    s.halfOpenAttempts = 0;
  } else if (s.state === 'HALF') {
    console.warn(`[Circuit] ${provider}: HALF→OPEN (probe failed)`);
    s.state = 'OPEN';
    s.openedAt = Date.now();
    s.halfOpenAttempts = 0;
  }
  _providerStates.set(provider, s);
}

export function canUseProvider(provider: string): boolean {
  const s = getOrInitState(provider);
  if (s.state === 'CLOSED') return true;
  if (s.state === 'OPEN') {
    const elapsedSec = (Date.now() - s.openedAt) / 1000;
    if (elapsedSec >= CIRCUIT_CONFIG.openToHalfOpenSec) {
      console.log(`[Circuit] ${provider}: OPEN→HALF (elapsed ${elapsedSec.toFixed(0)}s)`);
      s.state = 'HALF';
      s.halfOpenAttempts = 0;
      _providerStates.set(provider, s);
      return true;
    }
    return false;
  }
  return true; // HALF: allow probe
}

export function getCircuitState(provider: string): CircuitState {
  return getOrInitState(provider).state;
}

export function getProviderStatus(provider: string): ProviderStatus {
  const s = getOrInitState(provider);
  if (s.totalRequests === 0) return 'HEALTHY';
  const errorRate = s.totalErrors / s.totalRequests;
  if (errorRate < 0.02) return 'HEALTHY';
  if (errorRate < 0.05) return 'WARNING';
  if (errorRate < 0.15) return 'DEGRADED';
  if (errorRate < 0.30) return 'CRITICAL';
  return 'OFFLINE';
}

export function resetCircuit(provider: string): void {
  _providerStates.delete(provider);
  console.log(`[Circuit] ${provider}: Manual reset`);
}

/** Reset ALL provider circuits — use after fixing keys/config */
export function resetAllCircuits(): void {
  const providers = [..._providerStates.keys()];
  _providerStates.clear();
  console.log(`[Circuit] All circuits reset: ${providers.join(', ')}`);
}

export function getAllProviderHealth(): Record<string, {
  state: CircuitState;
  status: ProviderStatus;
  errorRate: number;
  totalRequests: number;
  totalErrors: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  lastError: string | null;
}> {
  const result: Record<string, ReturnType<typeof getAllProviderHealth>[string]> = {};
  for (const [name, s] of _providerStates) {
    const errorRate = s.totalRequests > 0 ? s.totalErrors / s.totalRequests : 0;
    result[name] = {
      state: s.state,
      status: getProviderStatus(name),
      errorRate,
      totalRequests: s.totalRequests,
      totalErrors: s.totalErrors,
      consecutiveFailures: s.consecutiveFailures,
      avgLatencyMs: Math.round(s.avgLatencyMs),
      lastError: s.lastError,
    };
  }
  return result;
}

// ─── Timeout-Aware Fetch Wrapper ──────────────────────────────────────────────
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = CIRCUIT_CONFIG.defaultTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`TIMEOUT: Request to ${new URL(url).hostname} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Retry with Exponential Backoff + Jitter ────────────────────────────────
function jitteredBackoff(attempt: number): number {
  const base = CIRCUIT_CONFIG.baseBackoffMs * Math.pow(2, attempt);
  return Math.round(base + Math.random() * base * 0.3);
}

type FetchFn<T> = () => Promise<T>;

export async function withRetry<T>(
  provider: string,
  operation: FetchFn<T>,
  maxRetries: number = CIRCUIT_CONFIG.maxRetries,
): Promise<T> {
  if (!canUseProvider(provider)) {
    throw new Error(`CIRCUIT_OPEN: Provider ${provider} circuit is open — skipping`);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const waitMs = jitteredBackoff(attempt - 1);
      console.log(`[Retry] ${provider} attempt ${attempt}/${maxRetries} — waiting ${waitMs}ms`);
      await new Promise<void>((r) => setTimeout(r, waitMs));
      if (!canUseProvider(provider)) {
        throw new Error(`CIRCUIT_OPEN: ${provider} opened during retry`);
      }
    }

    const start = Date.now();
    try {
      const result = await operation();
      recordSuccess(provider, Date.now() - start);
      return result;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      lastError = error;
      const msg = error.message;

      if (msg.includes('CIRCUIT_OPEN')) throw error;

      const isTimeout = msg.includes('TIMEOUT') || msg.includes('AbortError');
      const isNetwork = msg.includes('error sending request') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network');

      console.warn(`[Retry] ${provider} attempt ${attempt} failed: ${msg.substring(0, 100)}`);

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || (!isTimeout && !isNetwork)) {
        recordFailure(provider, msg);
        if (!isTimeout && !isNetwork) throw error;
      }
    }
  }
  throw lastError ?? new Error(`${provider}: All ${maxRetries + 1} attempts failed`);
}

// ─── Failover Chain Executor ──────────────────────────────────────────────────
interface FailoverResult<T> {
  data: T | null;
  provider: string | null;
  error: string | null;
  triedProviders: string[];
}

export async function tryWithFailover<T>(
  providers: Array<{
    name: string;
    fn: () => Promise<T>;
    validate?: (result: T) => boolean;
  }>,
): Promise<FailoverResult<T>> {
  const triedProviders: string[] = [];
  for (const { name, fn, validate } of providers) {
    if (!canUseProvider(name)) {
      triedProviders.push(`${name}(circuit-open)`);
      continue;
    }
    triedProviders.push(name);
    const start = Date.now();
    try {
      const result = await fn();
      const valid = !validate || validate(result);
      if (valid) {
        recordSuccess(name, Date.now() - start);
        return { data: result, provider: name, error: null, triedProviders };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('CIRCUIT_OPEN')) recordFailure(name, msg);
      console.warn(`[Failover] ${name} failed: ${msg.substring(0, 80)}`);
    }
  }
  return { data: null, provider: null, error: `All providers failed: ${triedProviders.join(' → ')}`, triedProviders };
}
