# WEDJAT DOMAIN AI — AI Architecture (the WEDJAT AI GATEWAY)

This document specifies the model-gateway layer: the capability registry (§19), the routing
decision (§20), bounded retry (§22), the circuit breaker (§23), provider health tracking (§57),
and failover with controlled degradation (§21). Domain code never calls provider SDKs; it calls
`routeAndComplete` in `src/lib/wedjat/gateway/router.ts`. There is NO OpenAI SDK, model, or API
anywhere in the system (master prompt §1); the sanctioned internal gateway and Groq's own REST
API are called directly.

## Capability registry (§19) — `src/lib/wedjat/gateway/registry.ts`

| Provider/Model | Class | Quality / Cost | Ctx | Est. latency | Status | Role |
|---|---|---|---|---|---|---|
| `wedjat/wedjat-internal-chat` (v1) | LOCAL | HIGH / LOW | 64k | 2500 ms | **ACTIVE** | sanctioned internal inference gateway (z-ai-web-dev-sdk, server-side only); default for all workloads |
| `google/gemini-2.5-pro` | REMOTE | HIGH / MEDIUM | 1M | 6000 ms | STANDBY → ACTIVE when `GEMINI_API_KEY` set | teacher/reference, large-context synthesis |
| `google/gemini-2.5-flash` | REMOTE | BALANCED / LOW | 1M | 2000 ms | STANDBY → ACTIVE with key | fast classification/interactive |
| `groq/llama-3.3-70b-versatile` | REMOTE | BALANCED / LOW | 128k | 800 ms | STANDBY → ACTIVE when `GROQ_API_KEY` set | low-latency routing/eval workloads |
| `groq/llama-3.1-8b-instant` | REMOTE | FAST / FREE | 128k | 300 ms | STANDBY → ACTIVE with key | ultra-fast classification |
| `huggingface/wedjat-local-embed-v1` | LOCAL | BALANCED / FREE | 8k | 5 ms | **ACTIVE** | in-process deterministic 256-d embedder (embedding policy LOCAL_ONLY) |
| `huggingface/wedjat-local-rerank-v1` | LOCAL | BALANCED / FREE | 8k | 8 ms | **ACTIVE** | in-process heuristic reranker (6-feature fusion) |
| `huggingface/Qwen2.5-7B-Instruct` | REMOTE | BALANCED / LOW | 32k | 3000 ms | STANDBY | PEFT/LoRA fine-tune target; gpuRequirement `A10G/T4 24GB` (§38); lineage maintained in advance |

The registry is config-driven: `config.keys.gemini/groq/huggingface` (booleans from env
presence) gate the STANDBY→ACTIVE transition. It is seeded into `ModelRegistry` rows by
`scripts/seed.ts` and surfaced at `GET /api/models`. Registry status values:
EXPERIMENTAL/ACTIVE/STANDBY/DEPRECATED.

## Routing decision (§20) — `router.ts:route()`

Inputs (`RouteRequest`): `taskType` (chat/deep_analysis/classification/summarization/synthesis/
embedding/reranking), `contextChars`, `requiredQuality` (FAST/BALANCED/HIGH),
`latencyRequirement` (LOW/MEDIUM/HIGH), `orgPolicy`, `classifications` of the evidence,
`userId`, `traceId`. Output (`RoutingDecision`): an ordered fallback chain (bounded by
`config.failover.maxHops = 3`) plus a `rejected[]` list with machine-readable reasons.

Candidate filter: task match → not DEPRECATED/STANDBY → adapter available →
`security/policy.ts:resolveGenerationPolicy` (§17/§66) → circuit allows (§23) → context fits
(`contextChars <= contextLimit × 3.5`). If no candidate survives, `PROVIDER_UNAVAILABLE` is
thrown (never a silent fallback to an unsanctioned provider).

Scoring heuristics: quality floor (+2 if model quality ≥ required, −2 below), latency bonus
(<1 s +2, <2.5 s +1, else −1 when LOW), task-type preference (deep_analysis/synthesis +3 HIGH
quality; classification +2 FAST), cost penalty (−0.5 × cost rank FREE=0…HIGH=3). Full scoring
details in [MODEL_ROUTING.md](MODEL_ROUTING.md).

## Failover execution (§21) — `router.ts:routeAndComplete()`

1. Backpressure first: `checkRateLimit('user', …, 30/min)` and `checkBudget()` (§24/§67).
2. For each hop in the chain: provider-level rate limit (`providerPerMinute = 120`),
   `noteProbe` (HALF_OPEN probe counting), `withRetry` execution, provider-call health
   recording, circuit success/failure recording, best-effort `persistHealth()`.
3. First successful hop wins; the response carries `provider`, `model`, `retryCount`,
   `fallbackCount`, and the full `fallbackChain` (surfaced in the UI generation metadata).
4. All hops exhausted → **controlled degraded response**: fixed text "The AI inference layer is
   temporarily unavailable…", `provider: 'none'`, `model: 'degraded-response'`, `degraded: true`
   — never a fabricated answer, never an unbounded loop.

## Retry policy (§22) — `gateway/retry.ts:withRetry()`

- Transient-only: HTTP 408/429/500/502/503/504, or message heuristics (timeout, econnreset,
  econnrefused, fetch failed, temporarily unavailable, socket hang up); `WedjatError.retryable`.
- `maxRetries = 2` per adapter attempt (total still bounded by maxHops), deadline
  `maxRetryDurationMs = 20 s`, `baseDelayMs = 400`, `maxDelayMs = 4000`.
- Exponential backoff `base × 2^(attempt−1)` with full jitter (×0.5–1.0).
- Permanent errors (401/403/validation) fail the hop immediately → failover, not retry.
- Timeouts: `connectTimeoutMs = 5000`, `requestTimeoutMs = 90 000` (per adapter `AbortController`).

## Circuit breaker (§23) — `gateway/circuit.ts`

Per `provider/model` key: CLOSED → OPEN after **5 failures in a 60 s window**; OPEN blocks calls
for **30 s cooldown**, then auto-transitions to HALF_OPEN; HALF_OPEN allows at most
**3 probes** (`halfOpenMax`); a failed probe re-opens immediately; any success closes and clears.
`allowRequest`/`recordFailure`/`recordSuccess`/`noteProbe`/`circuitSnapshot` are shared with the
router and the health dashboard so UI and routing agree.

## Provider health tracking (§57) — `gateway/provider-health.ts`

Rolling in-memory window per provider/model: requests, successes, failures, rateLimited429,
serverErrors5xx, timeouts, avgLatencyMs, successRate — merged with circuit states and ALL
registry entries (zero-state rows included). `healthSnapshot()` feeds `GET /api/system` and
`/api/health?deep=1`; `persistHealth()` upserts `ProviderHealth` rows best-effort (failure to
persist never breaks the request path, §58).

## Adapters — `gateway/adapters/`

- `types.ts`: the single `ProviderAdapter` contract (`isAvailable()`, `complete(req)`),
  `AdapterError` with `status`/`transient`, shared `estimateTokens` (chars/4).
- `wedjat-adapter.ts`: z-ai-web-dev-sdk chat completions, one cached SDK instance, empty
  responses treated as transient; server-side only, LOCAL class, always available. This is the
  **live default in this environment**.
- `gemini-adapter.ts`: direct REST `POST …/v1beta/models/gemini-2.5-pro:generateContent`, key
  read from env at call time, never logged; activates with `GEMINI_API_KEY`. (The single Gemini
  adapter executes `gemini-2.5-pro` for both Gemini registry entries — flash is registry
  lineage/scoring only.)
- `groq-adapter.ts`: direct REST call to `api.groq.com/openai/v1/chat/completions` with
  `llama-3.3-70b-versatile`; activates with `GROQ_API_KEY`. (Same pattern: one Groq adapter
  serves both Groq registry entries — requests scored for `llama-3.1-8b-instant` execute on
  `llama-3.3-70b-versatile`.) (Groq's own API — no OpenAI SDK.)

## Verified vs. configured-not-active

Verified in this environment: the internal-gateway adapter path (chat/analysis requests
completed through `routeAndComplete`), circuit/retry/failover mechanics, health snapshotting and
persistence, STANDBY gating. Configured but not exercised until keys exist: Gemini and Groq
remote calls. HF `Qwen2.5-7B-Instruct` is registry lineage only — no GPU exists here (§38), see
[TRAINING.md](TRAINING.md) for the honest simulation policy.
