// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Model Router + failover execution engine (§20, §21, §68).
//
// THE GATEWAY. Domain logic NEVER calls provider SDKs; it calls routeAndComplete.
// Inputs: task type, context size, quality/latency requirements, data policy,
// provider/model health. Output: selected provider+model with bounded fallback
// chain. Failover: PRIMARY → transient retry → SECONDARY → TERTIARY → controlled
// DEGRADED response. Never infinite (maxHops hard cap).
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';
import { logger } from '../logger';
import { WedjatError } from '../errors';
import { getRegistry, type RegistryEntry, type TaskType, type QualityClass } from './registry';
import { allowRequest, noteProbe, recordFailure, recordSuccess, getCircuitState } from './circuit';
import { withRetry, isRetryableError } from './retry';
import { recordProviderCall, persistHealth } from './provider-health';
import { checkRateLimit, checkBudget, resolveGenerationPolicy } from '../security/policy';
import { syncProviderKeys } from '../provider-keys';
import { WedjatInternalAdapter } from './adapters/wedjat-adapter';
import { GeminiAdapter } from './adapters/gemini-adapter';
import { GroqAdapter } from './adapters/groq-adapter';
import type { CompletionRequest, CompletionResult, ProviderAdapter } from './adapters/types';

// ── Adapter registry (single instances) ───────────────────────────────────────

const adapters: ProviderAdapter[] = [
  new WedjatInternalAdapter(),
  new GeminiAdapter(),
  new GroqAdapter(),
];

function adapterFor(entry: RegistryEntry): ProviderAdapter | undefined {
  return adapters.find((a) => a.provider === entry.provider);
}

// ── Routing decision ──────────────────────────────────────────────────────────

export interface RouteRequest {
  taskType: TaskType;
  contextChars: number;
  requiredQuality?: QualityClass;
  latencyRequirement?: 'LOW' | 'MEDIUM' | 'HIGH';
  orgPolicy: string;
  classifications: string[];
  userId: string;
  traceId: string;
}

export interface RoutingDecision {
  chain: { provider: string; model: string; providerClass: string; reason: string }[];
  rejected: { provider: string; model: string; reason: string }[];
}

const QUALITY_RANK: Record<QualityClass, number> = { FAST: 0, BALANCED: 1, HIGH: 2 };

/**
 * Consults the capability registry + policy + health and returns an ORDERED
 * fallback chain (bounded by config.failover.maxHops).
 */
export function route(req: RouteRequest): RoutingDecision {
  const registry = getRegistry();
  const rejected: RoutingDecision['rejected'] = [];

  // Prefetch: remote providers must be available (keys) AND policy-permitted.
  const candidates = registry.filter((entry) => {
    if (!entry.tasks.includes(req.taskType)) return false;
    if (entry.status === 'DEPRECATED') {
      rejected.push({ provider: entry.provider, model: entry.model, reason: 'deprecated' });
      return false;
    }
    if (entry.status === 'STANDBY') {
      rejected.push({ provider: entry.provider, model: entry.model, reason: 'standby (key not configured)' });
      return false;
    }
    const adapter = adapterFor(entry);
    if (!adapter || !adapter.isAvailable()) {
      rejected.push({ provider: entry.provider, model: entry.model, reason: 'adapter unavailable' });
      return false;
    }
    // Policy engine decision (§17/§66): confidential material never goes remote.
    const policy = resolveGenerationPolicy(req.orgPolicy, req.classifications, entry.providerClass);
    if (!policy.allowed) {
      rejected.push({ provider: entry.provider, model: entry.model, reason: policy.reason });
      return false;
    }
    // Circuit breaker (§23): OPEN circuits are excluded from the primary chain.
    if (!allowRequest(entry.provider, entry.model)) {
      rejected.push({ provider: entry.provider, model: entry.model, reason: `circuit ${getCircuitState(entry.provider, entry.model)}` });
      return false;
    }
    // Context must fit.
    if (req.contextChars > entry.contextLimit * 3.5) {
      rejected.push({ provider: entry.provider, model: entry.model, reason: 'context exceeds limit' });
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    throw new WedjatError(
      'PROVIDER_UNAVAILABLE',
      'No model satisfies policy/health constraints for this request',
      { detail: rejected.map((r) => `${r.provider}/${r.model}: ${r.reason}`).join('; ') }
    );
  }

  // Scoring: quality requirement, latency requirement, cost class, health.
  const qualityFloor = req.requiredQuality ? QUALITY_RANK[req.requiredQuality] : 0;
  const scored = candidates.map((entry) => {
    let score = 0;
    // Task-quality routing (§68): deep analysis wants HIGH quality models.
    score += (QUALITY_RANK[entry.qualityClass] - qualityFloor) >= 0 ? 2 : -2;
    if (req.latencyRequirement === 'LOW') score += entry.estimatedLatencyMs < 1000 ? 2 : entry.estimatedLatencyMs < 2500 ? 1 : -1;
    if (req.taskType === 'deep_analysis' || req.taskType === 'synthesis') {
      score += entry.qualityClass === 'HIGH' ? 3 : entry.qualityClass === 'BALANCED' ? 1 : -1;
    }
    if (req.taskType === 'classification') {
      score += entry.qualityClass === 'FAST' ? 2 : 0;
    }
    // Cost control (§67): avoid expensive models for simple operations.
    const costRank: Record<string, number> = { FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
    score -= costRank[entry.costClass] * 0.5;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const chain = scored.slice(0, config.failover.maxHops).map(({ entry }) => ({
    provider: entry.provider,
    model: entry.model,
    providerClass: entry.providerClass,
    reason: `score-selected for ${req.taskType} (quality=${entry.qualityClass}, latency=${entry.estimatedLatencyMs}ms)`,
  }));

  logger.info('router_decision', {
    traceId: req.traceId,
    task: req.taskType,
    chain: chain.map((c) => `${c.provider}/${c.model}`),
    rejected: rejected.length,
  });

  return { chain, rejected };
}

// ── Failover execution (§21) ──────────────────────────────────────────────────

export interface GatewayExecution {
  result: CompletionResult;
  provider: string;
  model: string;
  providerClass: string;
  retryCount: number;
  fallbackCount: number;
  fallbackChain: string[]; // every hop attempted, in order
  degraded: boolean;
  degradedReason?: string;
}

/**
 * Executes the routing decision with per-hop bounded retry and circuit tracking.
 * The last viable hop producing a result wins; if everything fails, a CONTROLLED
 * DEGRADED response is returned (never an unbounded loop, never a raw crash).
 */
export async function routeAndComplete(
  routeReq: RouteRequest,
  completionReq: CompletionRequest
): Promise<GatewayExecution> {
  // Resolve provider keys (env + org-managed settings) BEFORE routing so
  // standby/active status reflects the current configuration.
  await syncProviderKeys();
  // Rate limit + budget backpressure BEFORE touching providers (§24, §67).
  checkRateLimit('user', routeReq.userId, config.rateLimits.perUserPerMinute);
  checkBudget();

  const decision = route(routeReq);
  const fallbackChain: string[] = [];
  let retryCount = 0;
  let fallbackCount = 0;

  for (const hop of decision.chain) {
    const hopLabel = `${hop.provider}/${hop.model}`;
    fallbackChain.push(hopLabel);
    const entry = getRegistry().find((e) => e.provider === hop.provider && e.model === hop.model)!;
    const adapter = adapterFor(entry)!;
    checkRateLimit('provider', hop.provider, config.rateLimits.providerPerMinute);

    noteProbe(hop.provider, hop.model); // counts HALF_OPEN probes
    const started = Date.now();
    try {
      const outcome = await withRetry(
        (attempt) => adapter.complete({ ...completionReq, traceId: routeReq.traceId }),
        hopLabel
      );
      retryCount += outcome.transientRetries;
      const latencyMs = Date.now() - started;
      recordProviderCall(hop.provider, hop.model, { ok: true, latencyMs });
      recordSuccess(hop.provider, hop.model);
      void persistHealth();
      return {
        result: outcome.result,
        provider: hop.provider,
        model: hop.model,
        providerClass: hop.providerClass,
        retryCount,
        fallbackCount,
        fallbackChain,
        degraded: false,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const status = (err as { status?: number }).status;
      recordProviderCall(hop.provider, hop.model, { ok: false, latencyMs, status });
      const newState = recordFailure(hop.provider, hop.model);
      const message = err instanceof Error ? err.message : String(err);
      const transient = isRetryableError(err);
      logger.error('gateway_hop_failed', {
        traceId: routeReq.traceId,
        hop: hopLabel,
        status,
        transient,
        circuit: newState,
        error: message,
      });
      fallbackCount += 1; // moving to next hop (or terminal degradation)
    }
  }

  // CONTROLLED DEGRADED RESPONSE (§21) — all hops exhausted.
  void persistHealth();
  return {
    result: {
      text: 'The AI inference layer is temporarily unavailable (all sanctioned providers failed or are circuit-broken). This is a controlled degraded response: no answer was fabricated. Please retry shortly.',
      inputTokens: 0,
      outputTokens: 0,
    },
    provider: 'none',
    model: 'degraded-response',
    providerClass: 'LOCAL',
    retryCount,
    fallbackCount,
    fallbackChain,
    degraded: true,
    degradedReason: 'all provider hops exhausted',
  };
}

export function providerKeyStatusForApi(): Record<string, boolean> {
  return {
    wedjat_internal_gateway: true,
    gemini: config.keys.gemini,
    groq: config.keys.groq,
    huggingface: config.keys.huggingface,
  };
}
