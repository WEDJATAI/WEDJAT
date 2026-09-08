// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Per-provider/per-model circuit breaker (§23).
//
// WHY: a provider outage must not cascade through the application. CLOSED → OPEN
// after N failures in the window; OPEN blocks calls for cooldownMs; HALF_OPEN
// allows a few probes; success closes, failure re-opens. State is shared with the
// DB ProviderHealth rows so dashboards and the router agree.
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitRecord {
  state: CircuitState;
  failures: number[]; // timestamps of failures within window
  openedAt: number;
  halfOpenProbes: number;
}

const circuits = new Map<string, CircuitRecord>();

function key(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function getCircuitState(provider: string, model: string): CircuitState {
  const rec = circuits.get(key(provider, model));
  if (!rec) return 'CLOSED';
  if (rec.state === 'OPEN') {
    // Auto-transition OPEN → HALF_OPEN after cooldown.
    if (Date.now() - rec.openedAt >= config.circuit.cooldownMs) {
      rec.state = 'HALF_OPEN';
      rec.halfOpenProbes = 0;
    }
  }
  return rec.state;
}

/** Whether a call may proceed; HALF_OPEN allows a limited number of probes. */
export function allowRequest(provider: string, model: string): boolean {
  const state = getCircuitState(provider, model);
  if (state === 'CLOSED') return true;
  const rec = circuits.get(key(provider, model))!;
  if (state === 'HALF_OPEN') {
    return rec.halfOpenProbes < config.circuit.halfOpenMax;
  }
  return false; // OPEN
}

export function recordSuccess(provider: string, model: string): void {
  const k = key(provider, model);
  const rec = circuits.get(k);
  if (rec) {
    rec.state = 'CLOSED';
    rec.failures = [];
    rec.halfOpenProbes = 0;
  }
}

export function recordFailure(provider: string, model: string): CircuitState {
  const k = key(provider, model);
  const now = Date.now();
  const rec =
    circuits.get(k) ?? { state: 'CLOSED' as CircuitState, failures: [], openedAt: 0, halfOpenProbes: 0 };
  rec.failures.push(now);
  // Keep only failures inside the window.
  rec.failures = rec.failures.filter((t) => now - t < config.circuit.windowMs);
  if (rec.state === 'HALF_OPEN') {
    // A failed probe re-opens immediately.
    rec.state = 'OPEN';
    rec.openedAt = now;
  } else if (rec.failures.length >= config.circuit.failureThreshold) {
    rec.state = 'OPEN';
    rec.openedAt = now;
  }
  if (rec.state === 'HALF_OPEN') rec.halfOpenProbes += 1;
  circuits.set(k, rec);
  return rec.state;
}

/** Registers a HALF_OPEN probe without counting a failure (called before dispatch). */
export function noteProbe(provider: string, model: string): void {
  const rec = circuits.get(key(provider, model));
  if (rec && rec.state === 'HALF_OPEN') rec.halfOpenProbes += 1;
}

export function circuitSnapshot(): { provider: string; model: string; state: CircuitState }[] {
  return [...circuits.entries()].map(([k, rec]) => {
    const [provider, model] = k.split('/');
    return { provider, model, state: getCircuitState(provider, model) };
  });
}
