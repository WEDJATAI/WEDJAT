// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Centralized configuration (§54, §75).
//
// WHY: every knob that affects routing, retrieval, security policy, budgets and
// limits lives here so that a generation can be reconstructed from the recorded
// configuration versions (§75) and no secret is ever hard-coded (§25/§54).
// ═══════════════════════════════════════════════════════════════════════════════

export type DataSharingPolicy =
  | 'LOCAL_ONLY'
  | 'APPROVED_REMOTE_PROVIDER'
  | 'RESTRICTED_REMOTE'
  | 'BLOCK_REMOTE';

export interface WedjatConfig {
  version: string;
  env: 'development' | 'staging' | 'production';
  /** Provider API keys — presence gates adapter activation. NEVER logged. */
  keys: {
    gemini: boolean;
    groq: boolean;
    huggingface: boolean;
  };
  /** §17 data-sharing policy engine defaults. */
  policy: {
    /** Embedding/indexing is always local: proprietary text never leaves to build indexes. */
    embedding: 'LOCAL_ONLY';
    /** Default generation policy (org-level override stored in Organization.dataPolicy). */
    generation: DataSharingPolicy;
    /** Document classifications allowed to be sent to REMOTE providers (gemini/groq). */
    remoteAllowedClassifications: string[];
  };
  /** §24 rate limiting (in-memory token buckets; local memory caching is allowed). */
  rateLimits: {
    perUserPerMinute: number;
    concurrencyPerUser: number;
    providerPerMinute: number;
  };
  /** §67 AI cost control. */
  budget: {
    usdPerDay: number;
    /** rough per-1k-token USD estimates by provider (order of magnitude only) */
    costPer1kTokens: Record<string, number>;
  };
  /** §22 retry policy defaults (per provider overridable). */
  retry: {
    connectTimeoutMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
    maxRetryDurationMs: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  /** §23 circuit breaker. */
  circuit: {
    failureThreshold: number; // failures in window → OPEN
    windowMs: number;
    cooldownMs: number;
    halfOpenMax: number; // max probe requests in HALF_OPEN
  };
  /** §21 failover: hard limits so failover can never loop forever. */
  failover: {
    maxHops: number;
  };
  retrieval: {
    embedderModel: string;
    embedderDimension: number;
    rerankerModel: string;
    retrieverVersion: string;
    candidateK: number; // candidates fetched before reranking
    topK: number;
    minRerankScore: number; // below this → insufficient evidence path (§15)
    lexicalWeight: number;
    semanticWeight: number;
    rerankWeights: {
      lexical: number;
      semantic: number;
      coverage: number;
      heading: number;
      priority: number;
      freshness: number;
    };
  };
  chunking: {
    targetTokens: number;
    minTokens: number;
    overlapSentences: number;
    qualityThreshold: number; // chunks below this score are EXCLUDED from retrieval
  };
  training: {
    minExampleQuality: number;
    maxExamplesPerDataset: number;
    regressionTolerance: number; // recall drop tolerated in eval gate
  };
  auth: {
    sessionTtlHours: number;
    demoPasswordHint: string;
  };
}

const env = (process.env.NODE_ENV === 'production' ? 'production' : 'development') as
  | 'development'
  | 'production';

export const config: WedjatConfig = {
  version: '1.0.0',
  env,
  keys: {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    huggingface: Boolean(process.env.HF_TOKEN),
  },
  policy: {
    embedding: 'LOCAL_ONLY',
    generation: 'APPROVED_REMOTE_PROVIDER',
    // CONFIDENTIAL material never goes to remote providers (§66)
    remoteAllowedClassifications: ['INTERNAL', 'PUBLIC'],
  },
  rateLimits: {
    perUserPerMinute: 30,
    concurrencyPerUser: 3,
    providerPerMinute: 120,
  },
  budget: {
    usdPerDay: 50,
    costPer1kTokens: {
      wedjat: 0.002,
      google: 0.0035,
      groq: 0.0008,
      huggingface: 0.001,
    },
  },
  retry: {
    connectTimeoutMs: 5_000,
    requestTimeoutMs: 90_000,
    maxRetries: 2, // per adapter attempt — total bounded by failover.maxHops
    maxRetryDurationMs: 20_000,
    baseDelayMs: 400,
    maxDelayMs: 4_000,
  },
  circuit: {
    failureThreshold: 5,
    windowMs: 60_000,
    cooldownMs: 30_000,
    halfOpenMax: 3,
  },
  failover: {
    maxHops: 3,
  },
  retrieval: {
    embedderModel: 'wedjat-local-embed-v1',
    embedderDimension: 256,
    rerankerModel: 'wedjat-local-rerank-v1',
    retrieverVersion: 'hybrid-v1',
    candidateK: 24,
    topK: 8,
    minRerankScore: 0.18,
    lexicalWeight: 0.5,
    semanticWeight: 0.5,
    rerankWeights: {
      lexical: 0.3,
      semantic: 0.3,
      coverage: 0.15,
      heading: 0.1,
      priority: 0.1,
      freshness: 0.05,
    },
  },
  chunking: {
    targetTokens: 180,
    minTokens: 25,
    overlapSentences: 1,
    qualityThreshold: 30,
  },
  training: {
    minExampleQuality: 0.55,
    maxExamplesPerDataset: 500,
    regressionTolerance: 0.02,
  },
  auth: {
    sessionTtlHours: 12,
    demoPasswordHint: 'wedjat',
  },
};

/**
 * Startup validation (§91): verifies required configuration exists.
 * Never prints secret values — only booleans.
 */
export function validateStartupConfig(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL missing');
  // Provider keys are optional (adapters fall back to the sanctioned internal
  // gateway), but if a policy forbids remote AND no provider is available we
  // still function — the answer pipeline degrades to retrieval-only responses.
  return { ok: problems.length === 0, problems };
}

/** Provider display helper — never exposes key material. */
export function providerKeyStatus(): Record<string, boolean> {
  return {
    GEMINI_API_KEY: config.keys.gemini,
    GROQ_API_KEY: config.keys.groq,
    HF_TOKEN: config.keys.huggingface,
  };
}
