// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Provider health tracking (§57).
//
// WHY: the Model Router must use real health signals (latency, success rate,
// 429/5xx rates, circuit state). Rolling window kept in memory; reconciled to the
// ProviderHealth DB rows so dashboards and routing agree.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { getCircuitState, circuitSnapshot } from './circuit';
import { getRegistry } from './registry';
import { logger } from '../logger';

interface HealthWindow {
  requests: number;
  successes: number;
  failures: number;
  rateLimited429: number;
  serverErrors5xx: number;
  timeouts: number;
  latencySumMs: number;
  samples: number;
}

const health = new Map<string, HealthWindow>();

function key(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function window(provider: string, model: string): HealthWindow {
  let w = health.get(key(provider, model));
  if (!w) {
    w = { requests: 0, successes: 0, failures: 0, rateLimited429: 0, serverErrors5xx: 0, timeouts: 0, latencySumMs: 0, samples: 0 };
    health.set(key(provider, model), w);
  }
  return w;
}

export function recordProviderCall(
  provider: string,
  model: string,
  outcome: { ok: boolean; latencyMs: number; status?: number; timedOut?: boolean }
): void {
  const w = window(provider, model);
  w.requests += 1;
  w.latencySumMs += outcome.latencyMs;
  w.samples += 1;
  if (outcome.ok) {
    w.successes += 1;
  } else {
    w.failures += 1;
    if (outcome.status === 429) w.rateLimited429 += 1;
    else if (outcome.status !== undefined && outcome.status >= 500) w.serverErrors5xx += 1;
    if (outcome.timedOut) w.timeouts += 1;
  }
}

export interface ProviderHealthSnapshot {
  provider: string;
  model: string;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  requests: number;
  successes: number;
  failures: number;
  rateLimited429: number;
  serverErrors5xx: number;
  timeouts: number;
  avgLatencyMs: number;
  successRate: number;
}

export function healthSnapshot(): ProviderHealthSnapshot[] {
  const circuits = new Map(circuitSnapshot().map((c) => [key(c.provider, c.model), c.state]));
  // Include every registry entry (zero-state rows) so dashboards show all
  // sanctioned providers even before the first call.
  const registryKeys = new Set<string>();
  for (const entry of getRegistry()) {
    registryKeys.add(key(entry.provider, entry.model));
  }
  const allKeys = new Set([...registryKeys, ...health.keys(), ...circuits.keys()]);
  return [...allKeys].map((k) => {
    const [provider, model] = k.split('/');
    const w = health.get(k);
    const req = w?.requests ?? 0;
    return {
      provider,
      model,
      circuitState: circuits.get(k) ?? 'CLOSED',
      requests: req,
      successes: w?.successes ?? 0,
      failures: w?.failures ?? 0,
      rateLimited429: w?.rateLimited429 ?? 0,
      serverErrors5xx: w?.serverErrors5xx ?? 0,
      timeouts: w?.timeouts ?? 0,
      avgLatencyMs: w && w.samples > 0 ? Math.round(w.latencySumMs / w.samples) : 0,
      successRate: req > 0 ? (w!.successes / req) : 1,
    };
  });
}

/** Persist a snapshot to the DB (best-effort; never blocks the request path). */
export async function persistHealth(): Promise<void> {
  try {
    for (const snap of healthSnapshot()) {
      await db.providerHealth.upsert({
        where: { provider_model: { provider: snap.provider, model: snap.model } },
        create: {
          provider: snap.provider,
          model: snap.model,
          circuitState: snap.circuitState,
          requests: snap.requests,
          successes: snap.successes,
          failures: snap.failures,
          rateLimited429: snap.rateLimited429,
          serverErrors5xx: snap.serverErrors5xx,
          timeouts: snap.timeouts,
          avgLatencyMs: snap.avgLatencyMs,
        },
        update: {
          circuitState: snap.circuitState,
          requests: snap.requests,
          successes: snap.successes,
          failures: snap.failures,
          rateLimited429: snap.rateLimited429,
          serverErrors5xx: snap.serverErrors5xx,
          timeouts: snap.timeouts,
          avgLatencyMs: snap.avgLatencyMs,
          updatedAt: new Date(),
        },
      });
    }
  } catch (err) {
    // Observability persistence must never break the request path (§58 graceful degradation).
    logger.warn('provider_health_persist_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export { getCircuitState };
