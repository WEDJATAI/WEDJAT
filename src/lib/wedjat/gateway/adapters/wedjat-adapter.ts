// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Sanctioned internal inference gateway adapter.
//
// WHY: this environment's sanctioned inference path. Backed by z-ai-web-dev-sdk
// (server-side ONLY — never imported in client code). Treated as LOCAL class so
// LOCAL_ONLY/APPROVED policies always have a viable provider. NOT OpenAI.
// ═══════════════════════════════════════════════════════════════════════════════

import ZAI from 'z-ai-web-dev-sdk';
import { AdapterError, estimateTokens, type CompletionRequest, type CompletionResult, type ProviderAdapter } from './types';
import { config } from '../../config';
import { logger } from '../../logger';

// Reuse one SDK instance across requests (perf tip from the SDK docs).
let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;

async function getZai() {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

export class WedjatInternalAdapter implements ProviderAdapter {
  readonly provider = 'wedjat';
  readonly providerClass = 'LOCAL' as const;

  isAvailable(): boolean {
    return true; // sanctioned internal gateway is always available
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    try {
      const zai = await getZai();
      const completion = await zai.chat.completions.create({
        // The SDK expects the system message with the 'assistant' role.
        messages: req.messages.map((m) => ({
          role: m.role === 'system' ? 'assistant' : m.role,
          content: m.content,
        })),
        thinking: { type: 'disabled' },
      });
      const text = completion.choices?.[0]?.message?.content ?? '';
      if (!text || text.trim().length === 0) {
        throw new AdapterError('Empty response from internal gateway', { transient: true });
      }
      const inputTokens =
        completion.usage?.prompt_tokens ??
        req.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const outputTokens = completion.usage?.completion_tokens ?? estimateTokens(text);
      logger.debug('adapter_wedjat_ok', {
        traceId: req.traceId,
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
      });
      return { text, inputTokens, outputTokens };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      // SDK/network failures are treated transient so the bounded retry can engage.
      const message = err instanceof Error ? err.message : 'internal gateway failure';
      // A missing gateway config file is DETERMINISTIC (e.g. serverless hosts
      // without the sandbox config) — fail fast so the failover chain reaches
      // the next sanctioned provider without retry delay.
      const transient = !/Configuration file not found/i.test(message);
      throw new AdapterError(message, { transient });
    }
  }
}
