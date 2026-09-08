// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Google Gemini REST adapter (REMOTE class).
//
// WHY: Gemini is the approved high-quality analysis/teacher tier. The adapter is
// only ACTIVE when GEMINI_API_KEY is configured; otherwise the router treats it
// as STANDBY. Calls the Gemini REST API directly (no OpenAI SDK anywhere).
// The API key is read from env at call time and NEVER logged or returned.
// ═══════════════════════════════════════════════════════════════════════════════

import { AdapterError, estimateTokens, type CompletionRequest, type CompletionResult, type ProviderAdapter } from './types';
import { config } from '../../config';
import { logger } from '../../logger';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'google';
  readonly providerClass = 'REMOTE' as const;

  isAvailable(): boolean {
    return config.keys.gemini;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AdapterError('GEMINI_API_KEY not configured', { transient: false, status: 401 });

    const model = 'gemini-2.5-pro';
    const systemText = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.retry.requestTimeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents,
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          generationConfig: {
            temperature: req.temperature ?? 0.3,
            maxOutputTokens: req.maxOutputTokens ?? 4096,
          },
        }),
      });
      const body = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        throw new AdapterError(body.error?.message ?? `Gemini HTTP ${res.status}`, {
          status: res.status,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) {
        throw new AdapterError('Gemini returned empty content', { transient: true });
      }
      const inputTokens = body.usageMetadata?.promptTokenCount ?? estimateTokens(req.messages.map((m) => m.content).join(' '));
      const outputTokens = body.usageMetadata?.candidatesTokenCount ?? estimateTokens(text);
      logger.debug('adapter_gemini_ok', { traceId: req.traceId, latencyMs: Date.now() - started });
      return { text, inputTokens, outputTokens };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      const message = err instanceof Error ? err.message : 'gemini failure';
      throw new AdapterError(message, { transient: true }); // network/abort → transient
    } finally {
      clearTimeout(timeout);
    }
  }
}
