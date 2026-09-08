// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Provider adapter contract (§1, §18).
//
// WHY: application/domain logic must NEVER call provider SDKs directly. All
// providers implement this single contract behind the WEDJAT AI GATEWAY, keeping
// the system provider-independent.
// ═══════════════════════════════════════════════════════════════════════════════

import type { ProviderClass } from '../registry';

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: GatewayMessage[];
  /** Rough expected output size — lets adapters pick sane max tokens. */
  maxOutputTokens?: number;
  temperature?: number;
  traceId: string;
}

export interface CompletionResult {
  text: string;
  inputTokens: number; // estimated when provider doesn't report
  outputTokens: number;
  raw?: unknown;
}

export interface AdapterErrorShape {
  status?: number; // HTTP status when applicable
  transient: boolean;
  message: string;
}

export class AdapterError extends Error {
  readonly status?: number;
  readonly transient: boolean;

  constructor(message: string, opts: { status?: number; transient?: boolean } = {}) {
    super(message);
    this.name = 'AdapterError';
    this.status = opts.status;
    this.transient = opts.transient ?? (opts.status !== undefined ? isTransientDefault(opts.status) : true);
  }
}

function isTransientDefault(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface ProviderAdapter {
  readonly provider: string;
  readonly providerClass: ProviderClass;
  /** Whether the adapter is usable right now (keys configured, not standby). */
  isAvailable(): boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Token estimation shared by adapters when the provider doesn't report usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
