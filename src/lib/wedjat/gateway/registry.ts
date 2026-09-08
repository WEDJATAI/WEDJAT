// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Model capability registry (§19).
//
// WHY: the router must CONSULT a registry rather than hard-coding models. The
// registry is configuration-driven; remote providers activate only when their
// keys exist. "wedjat" is the sanctioned internal inference gateway (local class,
// backed by the platform SDK) — NOT OpenAI.
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';

export type TaskType =
  | 'chat'
  | 'deep_analysis'
  | 'classification'
  | 'summarization'
  | 'synthesis'
  | 'embedding'
  | 'reranking';

export type QualityClass = 'FAST' | 'BALANCED' | 'HIGH';
export type CostClass = 'FREE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ProviderClass = 'LOCAL' | 'REMOTE';

export interface RegistryEntry {
  provider: string;
  model: string;
  modelVersion: string;
  providerClass: ProviderClass;
  contextLimit: number;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  supportsEmbedding: boolean;
  supportsReranking: boolean;
  supportsFinetuning: boolean;
  supportsLocalInference: boolean;
  estimatedLatencyMs: number;
  qualityClass: QualityClass;
  costClass: CostClass;
  gpuRequirement: string;
  status: 'EXPERIMENTAL' | 'ACTIVE' | 'STANDBY' | 'DEPRECATED';
  notes: string;
  /** Tasks this model is preferred for. */
  tasks: TaskType[];
}

/**
 * The canonical registry. Seeded into the DB (ModelRegistry) for lineage and
 * surfaced through /api/models; routing decisions read from here (fast) and are
 * reconciled with DB health rows.
 */
export function buildRegistry(): RegistryEntry[] {
  const entries: RegistryEntry[] = [];

  // ── Sanctioned internal gateway (LOCAL class, always available) ────────────
  entries.push({
    provider: 'wedjat',
    model: 'wedjat-internal-chat',
    modelVersion: 'v1',
    providerClass: 'LOCAL',
    contextLimit: 64_000,
    supportsStructuredOutput: true,
    supportsToolUse: false,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: true,
    estimatedLatencyMs: 2500,
    qualityClass: 'HIGH',
    costClass: 'LOW',
    gpuRequirement: 'none',
    status: 'ACTIVE',
    notes: 'Sanctioned WEDJAT internal inference gateway (platform SDK). Default for all LOCAL-policy workloads.',
    tasks: ['chat', 'deep_analysis', 'classification', 'summarization', 'synthesis'],
  });

  // ── Google Gemini (REMOTE; activates with GEMINI_API_KEY) ──────────────────
  const geminiActive = config.keys.gemini;
  entries.push({
    provider: 'google',
    model: 'gemini-2.5-pro',
    modelVersion: 'latest',
    providerClass: 'REMOTE',
    contextLimit: 1_000_000,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: false,
    estimatedLatencyMs: 6000,
    qualityClass: 'HIGH',
    costClass: 'MEDIUM',
    gpuRequirement: 'none',
    status: geminiActive ? 'ACTIVE' : 'STANDBY',
    notes: geminiActive
      ? 'Large-context teacher/reference model for difficult architecture analysis.'
      : 'STANDBY — activate by setting GEMINI_API_KEY. Teacher/reference generation, large-context synthesis.',
    tasks: ['deep_analysis', 'synthesis', 'summarization', 'chat'],
  });
  entries.push({
    provider: 'google',
    model: 'gemini-2.5-flash',
    modelVersion: 'latest',
    providerClass: 'REMOTE',
    contextLimit: 1_000_000,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: false,
    estimatedLatencyMs: 2000,
    qualityClass: 'BALANCED',
    costClass: 'LOW',
    gpuRequirement: 'none',
    status: geminiActive ? 'ACTIVE' : 'STANDBY',
    notes: 'Fast Gemini tier for high-throughput classification and interactive workloads.',
    tasks: ['classification', 'chat', 'summarization'],
  });

  // ── Groq (REMOTE; activates with GROQ_API_KEY) ─────────────────────────────
  const groqActive = config.keys.groq;
  entries.push({
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    modelVersion: 'latest',
    providerClass: 'REMOTE',
    contextLimit: 128_000,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: false,
    estimatedLatencyMs: 800,
    qualityClass: 'BALANCED',
    costClass: 'LOW',
    gpuRequirement: 'none',
    status: groqActive ? 'ACTIVE' : 'STANDBY',
    notes: 'Low-latency inference, routing and evaluation workloads where suitable.',
    tasks: ['classification', 'chat', 'summarization'],
  });
  entries.push({
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    modelVersion: 'latest',
    providerClass: 'REMOTE',
    contextLimit: 128_000,
    supportsStructuredOutput: true,
    supportsToolUse: false,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: false,
    estimatedLatencyMs: 300,
    qualityClass: 'FAST',
    costClass: 'FREE',
    gpuRequirement: 'none',
    status: groqActive ? 'ACTIVE' : 'STANDBY',
    notes: 'Ultra-low-latency classification / fast routing tier.',
    tasks: ['classification'],
  });

  // ── Hugging Face (LOCAL in-process components + optional remote inference) ─
  entries.push({
    provider: 'huggingface',
    model: 'wedjat-local-embed-v1',
    modelVersion: 'v1',
    providerClass: 'LOCAL',
    contextLimit: 8192,
    supportsStructuredOutput: false,
    supportsToolUse: false,
    supportsEmbedding: true,
    supportsReranking: false,
    supportsFinetuning: false,
    supportsLocalInference: true,
    estimatedLatencyMs: 5,
    qualityClass: 'BALANCED',
    costClass: 'FREE',
    gpuRequirement: 'none',
    status: 'ACTIVE',
    notes: 'In-process deterministic embedder. Embedding policy is LOCAL_ONLY so proprietary text never leaves for indexing.',
    tasks: ['embedding'],
  });
  entries.push({
    provider: 'huggingface',
    model: 'wedjat-local-rerank-v1',
    modelVersion: 'v1',
    providerClass: 'LOCAL',
    contextLimit: 8192,
    supportsStructuredOutput: false,
    supportsToolUse: false,
    supportsEmbedding: false,
    supportsReranking: true,
    supportsFinetuning: false,
    supportsLocalInference: true,
    estimatedLatencyMs: 8,
    qualityClass: 'BALANCED',
    costClass: 'FREE',
    gpuRequirement: 'none',
    status: 'ACTIVE',
    notes: 'In-process heuristic reranker (lexical/semantic/coverage/priority/freshness fusion). Reranks candidates before context assembly.',
    tasks: ['reranking'],
  });
  entries.push({
    provider: 'huggingface',
    model: 'Qwen2.5-7B-Instruct',
    modelVersion: 'latest',
    providerClass: 'REMOTE',
    contextLimit: 32_768,
    supportsStructuredOutput: false,
    supportsToolUse: false,
    supportsEmbedding: false,
    supportsReranking: false,
    supportsFinetuning: true,
    supportsLocalInference: false,
    estimatedLatencyMs: 3000,
    qualityClass: 'BALANCED',
    costClass: 'LOW',
    gpuRequirement: 'A10G/T4 24GB',
    status: config.keys.huggingface ? 'STANDBY' : 'STANDBY',
    notes: 'PEFT/LoRA fine-tuning target and optional local inference once GPU nodes are attached. Registry lineage maintained in advance.',
    tasks: ['classification', 'chat'],
  });

  return entries;
}

/** In-memory registry singleton (rebuilt rarely; config-driven). */
let registryCache: RegistryEntry[] | null = null;

export function getRegistry(): RegistryEntry[] {
  if (!registryCache) registryCache = buildRegistry();
  return registryCache;
}

export function findEntry(provider: string, model: string): RegistryEntry | undefined {
  return getRegistry().find((e) => e.provider === provider && e.model === model);
}
