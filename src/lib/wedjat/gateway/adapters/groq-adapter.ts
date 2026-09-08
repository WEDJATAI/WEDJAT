// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Groq REST adapter (REMOTE class).
//
// WHY: Groq is the approved low-latency tier (routing/classification/interactive).
// Speaks Groq's native REST chat API directly. ACTIVE only with GROQ_API_KEY.
// We call Groq's own API — no OpenAI SDK is used anywhere in this system.
// ═══════════════════════════════════════════════════════════════════════════════

import { AdapterError, estimateTokens, type CompletionRequest, type CompletionResult, type ProviderAdapter } from './types';
import { config } from '../../config';
import { logger } from '../../logger';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number; message?: string };
}

export class GroqAdapter implements ProviderAdapter {
  readonly provider = 'groq';
  readonly providerClass = 'REMOTE' as const;

  isAvailable(): boolean {
    return config.keys.groq;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new AdapterError('GROQ_API_KEY not configured', { transient: false, status: 401 });

    const model = 'llama-3.3-70b-versatile';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.retry.requestTimeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxOutputTokens ?? 4096,
        }),
      });
      const body = (await res.json()) as GroqResponse;
      if (!res.ok) {
        throw new AdapterError(body.error?.message ?? `Groq HTTP ${res.status}`, {
          status: res.status,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      const text = body.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) throw new AdapterError('Groq returned empty content', { transient: true });
      const inputTokens = body.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join(' '));
      const outputTokens = body.usage?.completion_tokens ?? estimateTokens(text);
      logger.debug('adapter_groq_ok', { traceId: req.traceId, latencyMs: Date.now() - started });
      return { text, inputTokens, outputTokens };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(err instanceof Error ? err.message : 'groq failure', { transient: true });
    } finally {
      clearTimeout(timeout);
    }
  }
}
