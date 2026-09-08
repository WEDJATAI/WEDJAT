// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — In-memory metrics registry (§56, §88).
//
// WHY: fast counters for the observability dashboard. Persistent aggregates
// come from the DB (AiGeneration, RetrievalEvent, Job); these live counters
// cover the current process window. Local memory caching is permitted (no
// external middleware in this environment).
// ═══════════════════════════════════════════════════════════════════════════════

const startedAt = Date.now();

interface Counters {
  aiRequests: number;
  aiSuccesses: number;
  aiFailures: number;
  degradedResponses: number;
  latencySumMs: number;
  latencySamples: number;
  retries: number;
  fallbacks: number;
  retrievalEvents: number;
  ingestionJobs: number;
  injectionBlocked: number;
  insufficientEvidence: number;
  chatRequests: number;
  analyzeRequests: number;
}

const counters: Counters = {
  aiRequests: 0,
  aiSuccesses: 0,
  aiFailures: 0,
  degradedResponses: 0,
  latencySumMs: 0,
  latencySamples: 0,
  retries: 0,
  fallbacks: 0,
  retrievalEvents: 0,
  ingestionJobs: 0,
  injectionBlocked: 0,
  insufficientEvidence: 0,
  chatRequests: 0,
  analyzeRequests: 0,
};

export const metrics = {
  startClock() {
    counters.aiRequests += 1;
  },
  recordAiLatency(ms: number) {
    counters.latencySumMs += ms;
    counters.latencySamples += 1;
  },
  recordAiOutcome(opts: { ok: boolean; degraded?: boolean; retries?: number; fallbacks?: number }) {
    if (opts.ok) counters.aiSuccesses += 1;
    else counters.aiFailures += 1;
    if (opts.degraded) counters.degradedResponses += 1;
    counters.retries += opts.retries ?? 0;
    counters.fallbacks += opts.fallbacks ?? 0;
  },
  bumpRetrieval() {
    counters.retrievalEvents += 1;
  },
  bumpIngestionJob() {
    counters.ingestionJobs += 1;
  },
  bumpInjectionBlocked() {
    counters.injectionBlocked += 1;
  },
  bumpInsufficientEvidence() {
    counters.insufficientEvidence += 1;
  },
  bumpChat() {
    counters.chatRequests += 1;
  },
  bumpAnalyze() {
    counters.analyzeRequests += 1;
  },
  snapshot() {
    return {
      ...counters,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      avgLatencyMs: counters.latencySamples > 0 ? Math.round(counters.latencySumMs / counters.latencySamples) : 0,
      fallbackRate: counters.aiRequests > 0 ? counters.fallbacks / counters.aiRequests : 0,
      retryRate: counters.aiRequests > 0 ? counters.retries / counters.aiRequests : 0,
      successRate: counters.aiRequests > 0 ? counters.aiSuccesses / counters.aiRequests : 0,
    };
  },
  startedAt,
};

export function uptimeSec(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}
