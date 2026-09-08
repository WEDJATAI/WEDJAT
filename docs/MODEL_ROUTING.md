# WEDJAT DOMAIN AI — Model Routing

This document details the routing decision made by the WEDJAT AI GATEWAY (§20) and the
backpressure controls around it (§24 rate limits, §67 budget): the decision inputs/outputs, the
scoring heuristics, the policy-engine rules that can veto a provider before scoring (§17/§66),
and the concrete limits. Code: `src/lib/wedjat/gateway/router.ts` (route),
`src/lib/wedjat/security/policy.ts` (policy/rate/budget), `src/lib/wedjat/config.ts` (values).

## Decision inputs → outputs

Inputs (`RouteRequest`): `taskType`, `contextChars`, `requiredQuality` (FAST/BALANCED/HIGH),
`latencyRequirement` (LOW/MEDIUM/HIGH), `orgPolicy` (the org's data-sharing policy), the
`classifications` of the evidence in context, `userId`, `traceId`. Output: an ordered
`chain` (≤ `failover.maxHops = 3` hops, each `{provider, model, providerClass, reason}`) plus
`rejected[]` (`{provider, model, reason}`) — e.g. `standby (key not configured)`,
`policy forbids remote providers`, `circuit OPEN`, `context exceeds limit`, `deprecated`.

Example logged decision (dev.log): `task=deep_analysis, chain=["wedjat/wedjat-internal-chat"],
rejected=1` — the standby remote models were rejected because no keys are set.

## Pre-scoring filters (rejections)

1. Registry task match; DEPRECATED and STANDBY entries are rejected outright.
2. Adapter availability (`isAvailable()` — remote adapters return false without their env key).
3. **Policy engine** (below) — can veto REMOTE providers regardless of score.
4. Circuit breaker state (§23) — OPEN circuits excluded from the chain.
5. Context fit: `contextChars > contextLimit × 3.5` → rejected.

## Scoring heuristics

Quality floor: `+2` if the model's quality class ≥ the required class, `−2` below. Latency
(when requirement is LOW): `+2` if est. latency < 1000 ms, `+1` < 2500 ms, `−1` otherwise.
Task-type preference: deep_analysis/synthesis `+3` HIGH / `+1` BALANCED / `−1` FAST;
classification `+2` FAST. Cost penalty: `−0.5 × costRank` (FREE 0, LOW 1, MEDIUM 2, HIGH 3).
Highest score first; ties resolved by registry order. The chat pipeline requests quality HIGH
for analysis intents and BALANCED for GENERAL chat, with taskType deep_analysis vs. chat.

## Policy engine rules (§17, §66) — `security/policy.ts:resolveGenerationPolicy`

| Org policy | LOCAL provider | REMOTE provider |
|---|---|---|
| `LOCAL_ONLY` | allowed | **rejected** — "LOCAL_ONLY policy forbids remote providers" |
| `BLOCK_REMOTE` | allowed | **rejected** — "BLOCK_REMOTE policy forbids remote providers" |
| `APPROVED_REMOTE_PROVIDER` (default) | allowed | allowed unless any evidence classification is `CONFIDENTIAL` → rejected, "CONFIDENTIAL material requires local inference" |
| `RESTRICTED_REMOTE` | allowed | same CONFIDENTIAL rule — rejected |

Embedding policy is invariant (`security/policy.ts:EMBEDDING_POLICY` =
`config.policy.embedding`): `LOCAL_ONLY` — indexing never sends text to a remote provider.
`config.policy.remoteAllowedClassifications = ['INTERNAL','PUBLIC']` documents that CONFIDENTIAL
material never goes remote (§66). The seeded org uses `APPROVED_REMOTE_PROVIDER`; the org-level
value is stored on `Organization.dataPolicy` and read per request.

## Rate limits (§24) — in-memory token buckets

- Per user: **30 requests/min** (`config.rateLimits.perUserPerMinute`), applied to chat/search/
  analyze before any provider is touched; exceeded → `RATE_LIMITED` (HTTP 429) backpressure.
- Concurrency per user: `3` (`concurrencyPerUser`, config value).
- Per provider: **120 requests/min** (`providerPerMinute`), checked per hop.

## Budget (§67) — `recordSpend` / `checkBudget`

Daily cap **$50** (`config.budget.usdPerDay`), reset at UTC day rollover. Cost per request is
estimated from reported (or chars/4-estimated) tokens × provider rates per 1k tokens:

| Provider | USD / 1k tokens |
|---|---|
| wedjat (internal) | 0.002 |
| google | 0.0035 |
| groq | 0.0008 |
| huggingface | 0.001 |

`checkBudget()` runs before routing; exhaustion throws `BUDGET_EXCEEDED` ("expensive operations
are paused until tomorrow"). Per-generation `costEstimateUsd` is persisted on `AiGeneration` and
the running total is shown on the Observability view (`budgetSnapshot()`).

## Task-type → model preferences (summary)

| Task | Prefers |
|---|---|
| deep_analysis / synthesis | HIGH quality (gemini-2.5-pro when active; internal gateway now) |
| chat / summarization | BALANCED quality, latency-aware |
| classification | FAST tier (llama-3.1-8b-instant when Groq active) |
| embedding / reranking | LOCAL components (always local per policy) |

See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) for registry contents, retry/circuit mechanics and
the failover chain, and [DEPLOYMENT.md](DEPLOYMENT.md) for enabling remote providers by setting
their API keys.
