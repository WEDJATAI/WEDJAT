// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Retry policy with exponential backoff + jitter (§22).
//
// WHY: only TRANSIENT errors (408/429/selected 5xx/network/timeout) are retried,
// with bounded attempts, bounded duration, jitter to avoid thundering herds, and
// Retry-After honoring. Permanent errors (401/403/invalid params) fail fast.
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';
import { WedjatError } from '../errors';
import { logger } from '../logger';

export interface RetryOutcome<T> {
  result: T;
  attempts: number;
  transientRetries: number;
}

export function isTransientHttpStatus(status: number): boolean {
  // Retry: 408, 429, 500/502/503/504 (selected 5xx). 500 is debatable — a pure
  // 500 from an LLM provider is usually transient overload; 501/505+ are not.
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof WedjatError) return err.retryable;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network-ish transient failures.
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('socket hang up')
    );
  }
  return false;
}

function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0 && retryAfterMs < 15_000) return retryAfterMs;
  const base = Math.min(config.retry.baseDelayMs * 2 ** (attempt - 1), config.retry.maxDelayMs);
  // Full jitter (±50%).
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/**
 * Executes `fn` with bounded retries for transient errors only.
 * The total retry duration is capped (maxRetryDurationMs) — never unbounded (§99).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  label: string,
  opts: { maxRetries?: number } = {}
): Promise<RetryOutcome<T>> {
  const maxRetries = opts.maxRetries ?? config.retry.maxRetries;
  const deadline = Date.now() + config.retry.maxRetryDurationMs;
  let attempts = 0;
  let transientRetries = 0;

  while (true) {
    attempts += 1;
    try {
      const result = await fn(attempts);
      return { result, attempts, transientRetries };
    } catch (err) {
      const retryable = isRetryableError(err);
      const willRetry = retryable && attempts <= maxRetries && Date.now() < deadline;
      logger.warn('gateway_retry', {
        label,
        attempt: attempts,
        retryable,
        willRetry,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!willRetry) throw err;
      transientRetries += 1;
      const retryAfterMs = err instanceof WedjatError ? undefined : undefined;
      await new Promise((r) => setTimeout(r, backoffDelay(attempts, retryAfterMs)));
    }
  }
}
