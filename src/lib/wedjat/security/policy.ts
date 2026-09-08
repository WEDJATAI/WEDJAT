// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Data-sharing policy engine (§17, §66) + rate/budget control (§24, §67).
//
// WHY: the decision "which knowledge may leave for which provider" is a POLICY,
// not scattered if-statements. LOCAL_ONLY knowledge is embedded/reranked locally
// (always), and CONFIDENTIAL generation is restricted to the sanctioned internal
// gateway. Budgets and rate limits create backpressure instead of endless retries.
// ═══════════════════════════════════════════════════════════════════════════════

import { config, type DataSharingPolicy } from '../config';
import { WedjatError } from '../errors';

export type ProviderClass = 'LOCAL' | 'REMOTE';

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  providerClass: ProviderClass | null;
}

/**
 * Resolves whether a generation request carrying material of `classifications`
 * may be served by a provider of `providerClass` under the org policy.
 */
export function resolveGenerationPolicy(
  orgPolicy: string,
  classifications: string[],
  providerClass: ProviderClass
): PolicyDecision {
  const policy = (orgPolicy || config.policy.generation) as DataSharingPolicy;

  if (policy === 'BLOCK_REMOTE') {
    return providerClass === 'LOCAL'
      ? { allowed: true, reason: 'BLOCK_REMOTE policy — local provider only', providerClass }
      : { allowed: false, reason: 'BLOCK_REMOTE policy forbids remote providers', providerClass };
  }
  if (policy === 'LOCAL_ONLY') {
    return providerClass === 'LOCAL'
      ? { allowed: true, reason: 'LOCAL_ONLY policy — local provider only', providerClass }
      : { allowed: false, reason: 'LOCAL_ONLY policy forbids remote providers', providerClass };
  }

  // APPROVED_REMOTE_PROVIDER / RESTRICTED_REMOTE:
  const hasConfidential = classifications.includes('CONFIDENTIAL');
  if (hasConfidential && providerClass === 'REMOTE') {
    if (policy === 'RESTRICTED_REMOTE') {
      // Restricted mode: confidential material needs LOCAL even under restricted policy.
      return { allowed: false, reason: 'CONFIDENTIAL material requires local inference (RESTRICTED_REMOTE)', providerClass };
    }
    // Under APPROVED_REMOTE_PROVIDER, confidential still never leaves (§17: allow sensitive knowledge to remain local).
    return { allowed: false, reason: 'CONFIDENTIAL material requires local inference', providerClass };
  }
  return { allowed: true, reason: `policy ${policy} permits ${providerClass}`, providerClass };
}

/** Embedding policy is invariant: index building never sends text remotely (§17). */
export const EMBEDDING_POLICY = 'LOCAL_ONLY' as const;

// ── Rate limiting (in-memory token buckets; §24) ─────────────────────────────

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(scope: 'user' | 'provider', key: string, perMinute: number): void {
  const now = Date.now();
  const bucket = buckets.get(`${scope}:${key}`) ?? { tokens: perMinute, lastRefill: now };
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / 60_000) * perMinute;
  bucket.tokens = Math.min(perMinute, bucket.tokens + refill);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    buckets.set(`${scope}:${key}`, bucket);
    throw new WedjatError('RATE_LIMITED', 'Rate limit exceeded — backpressure applied. Try again shortly.');
  }
  bucket.tokens -= 1;
  buckets.set(`${scope}:${key}`, bucket);
}

// ── Budget control (§67) ──────────────────────────────────────────────────────

let spentTodayUsd = 0;
let budgetDayStart = new Date().toISOString().slice(0, 10);

export function recordSpend(provider: string, inputTokens: number, outputTokens: number): number {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDayStart) {
    budgetDayStart = day;
    spentTodayUsd = 0;
  }
  const per1k = config.budget.costPer1kTokens[provider] ?? 0.002;
  const cost = ((inputTokens + outputTokens) / 1000) * per1k;
  spentTodayUsd += cost;
  return cost;
}

export function checkBudget(): void {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDayStart) {
    budgetDayStart = day;
    spentTodayUsd = 0;
  }
  if (spentTodayUsd >= config.budget.usdPerDay) {
    throw new WedjatError(
      'BUDGET_EXCEEDED',
      `Daily AI budget of $${config.budget.usdPerDay} exhausted — expensive operations are paused until tomorrow.`
    );
  }
}

export function budgetSnapshot(): { spentUsdToday: number; budgetUsdPerDay: number } {
  return { spentUsdToday: Math.round(spentTodayUsd * 10000) / 10000, budgetUsdPerDay: config.budget.usdPerDay };
}
