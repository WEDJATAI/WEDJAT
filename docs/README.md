# WEDJAT DOMAIN AI — README

WEDJAT DOMAIN AI is a proprietary domain-intelligence platform implemented as a Next.js 16 App
Router application (single `/` route, API-first backend, TypeScript 5, Tailwind 4 + shadcn/ui,
Prisma/SQLite). It ingests the organization's platform blueprints through a 13-stage observable
pipeline, serves grounded chat/analysis over a hybrid retrieval stack, routes generation through
a policy-controlled multi-provider AI gateway, and manages a controlled (in this environment
**simulated**) training lifecycle with evaluation gates. This is a verified working
implementation of the "WEDJAT PROPRIETARY DOMAIN AI" master prompt v1.0 (§ numbers below map to
that prompt); it is NOT a production deployment and never claims to be (§97).

## Quickstart

```bash
bun install               # dependencies
bun run db:generate       # prisma client
bun run db:push           # schema → db/custom.db (skip if already seeded)
bun scripts/seed.ts       # wipes + seeds org, users, corpus, registry, benchmark, baseline
bun run dev               # next dev -p 3000, logs tee'd to dev.log
# open http://localhost:3000
```

Log in with any seeded demo user (password `wedjat`, overridable via `WEDJAT_DEMO_PASSWORD`):

| Email | Role |
|---|---|
| owner@wedjat.ai (Amara Djedi) | OWNER |
| curator@wedjat.ai (Yusuf Kahlout) | CURATOR |
| member@wedjat.ai (Layla Hassan) | MEMBER |
| auditor@wedjat.ai (Omar Farouk) | AUDITOR |

Prerequisites: `bun`, a populated `DATABASE_URL` (default `file:/home/z/my-project/db/custom.db`),
`bun run db:generate` after schema changes. Optional provider keys: `GEMINI_API_KEY`,
`GROQ_API_KEY`, `HF_TOKEN` — without them, remote adapters stay STANDBY and the sanctioned
internal gateway (z-ai-web-dev-sdk, server-side only) serves all traffic. See
[DEPLOYMENT.md](DEPLOYMENT.md).

## The 10 views (single-page client, role-gated)

Login → Dashboard → Chat → Knowledge → Analysis → Search → Training → Evaluations → Models →
Observability (view switching in `src/components/wedjat/views/*.tsx`, persisted in localStorage).
API surface is defined in [docs/API_CONTRACT.md](API_CONTRACT.md); all responses use the
`{ok,data}|{ok,error:{code,message}}` envelope.

## Architecture (ASCII)

```
                    Browser (single / route, 10 views, role-gated UI)
                                        │  HttpOnly session cookie
┌───────────────────────────────────────▼────────────────────────────────────────┐
│ API layer  src/app/api/*  (envelope + authz via src/lib/wedjat/api.ts)         │
│  auth health platforms blueprints dashboard search chat analyze               │
│  ingestion jobs feedback evaluations training models system                    │
├────────────────────────────────────────────────────────────────────────────────┤
│ Application/domain services  src/lib/wedjat/                                   │
│  reasoning/answer.ts (§46 pipeline)   reasoning/workflows.ts (§47–§50, §52)          │
│  knowledge/ingestion.ts (§8 13-stage)  training/lifecycle.ts (§32–§41)          │
│  evaluation/runner.ts (§42/§43)         security/{auth,policy,injection}.ts     │
│  retrieval/{hybrid,reranker,context}.ts (§11–§15)                              │
├────────────────────────────────────────────────────────────────────────────────┤
│ WEDJAT AI GATEWAY  gateway/{router,registry,circuit,retry,provider-health}.ts   │
│  model router (§20) → adapters: wedjat (internal SDK, LOCAL, ACTIVE)           │
│  google gemini-2.5-pro/flash (STANDBY)  groq llama-3.3-70b/llama-3.1-8b        │
│  (STANDBY)  NO OpenAI anywhere                                                │
├────────────────────────────────────────────────────────────────────────────────┤
│ Infrastructure: Prisma/SQLite (db/custom.db, Turso-portable libSQL)            │
│  job worker (src/instrumentation.ts, 1.5 s tick)  local embedder/reranker      │
└────────────────────────────────────────────────────────────────────────────────┘
```

Details: [ARCHITECTURE.md](ARCHITECTURE.md), [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md),
[RAG_ARCHITECTURE.md](RAG_ARCHITECTURE.md).

## Key capabilities ↔ master-prompt sections

| Capability | Where | § |
|---|---|---|
| RAG-first (knowledge > model training) | `src/lib/wedjat/reasoning/answer.ts`, retrieval never bypassed | §10, §45 |
| Hybrid retrieval (BM25 + 256-d local vectors + metadata filters) | `src/lib/wedjat/retrieval/hybrid.ts` | §11 |
| Reranking (6-feature fusion, weights in `config.retrieval.rerankWeights`) | `retrieval/reranker.ts` | §12 |
| Context assembly with §13 metadata + fenced evidence | `retrieval/context.ts`, `security/injection.ts` | §13 |
| Grounded answers + hallucination gate (threshold 0.18) | `reasoning/answer.ts`, `config.retrieval.minRerankScore` | §14, §15 |
| Prompt-injection defense (8 patterns, fencing, output validation) | `security/injection.ts` | §16, §81 |
| Data-sharing policy engine (LOCAL/REMOTE, CONFIDENTIAL stays local) | `security/policy.ts` | §17, §66 |
| Model router + registry + failover (maxHops 3) | `gateway/router.ts`, `gateway/registry.ts` | §19–§21 |
| Retry (2 retries, exp backoff+jitter, transient-only) / circuit breaker (5/60 s/30 s) | `gateway/retry.ts`, `gateway/circuit.ts` | §22, §23 |
| Evaluation gates + permanent benchmark + regression tolerance 0.02 | `evaluation/runner.ts`, `training/lifecycle.ts` | §42, §43 |
| Simulated training lifecycle (no GPU — honest labels) | `training/lifecycle.ts` | §37–§41, §97 |
| Observability (metrics, audit, provider health, jobs) | `observability/*.ts` | §56–§58, §88 |
| Prompt & config versioning | `reasoning/prompts.ts`, `ConfigVersion` rows | §74, §75 |
| Full lineage answer→chunk→blueprint version | `persistGeneration` + `GenerationSource` | §31 |

## Seeded state (from `bun scripts/seed.ts`)

1 organization (WEDJAT), 4 platforms (core-platform CRITICAL, analytics-platform HIGH,
mobile-gateway MEDIUM, shared-services MEDIUM), 6 blueprints, 7 documents ingested through the
REAL pipeline (no seed bypass) from `scripts/corpus/*.md`, 65 INDEXED chunks, 124 knowledge
records, 8 model-registry entries, 7 approved prompt versions, 10 config versions, and the
`core-benchmark` suite (14 cases: 12 retrieval + 2 grounded-chat) with baseline results
(passRate 0.917, recall 0.917, precision 0.917, ~10 ms/case). See [EVALUATION.md](EVALUATION.md).

## Honest status summary

- **Verified working**: login/roles, ingestion pipeline + job worker, hybrid retrieval +
  reranking, grounded chat + analysis workflows via the internal gateway, circuit breaker /
  retry / failover mechanics, evaluation suites, training lifecycle state machine, observability
  endpoints. Frontend verified with `tsc --noEmit` + lint + headless smoke test.
- **Simulated by design**: training runs (no GPU in this environment — method auto-degrades to
  SIMULATED with a recorded reason, §38/§97); remote providers are STANDBY until their env keys
  exist.
- **Demo limitations**: single-org seed, demo password, in-memory rate buckets / budget / circuit
  state (process-local). Not production-readiness claims.

## Documentation index

[ARCHITECTURE](ARCHITECTURE.md) · [AI_ARCHITECTURE](AI_ARCHITECTURE.md) ·
[RAG_ARCHITECTURE](RAG_ARCHITECTURE.md) · [TRAINING](TRAINING.md) ·
[MODEL_ROUTING](MODEL_ROUTING.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) ·
[DATA_GOVERNANCE](DATA_GOVERNANCE.md) · [EVALUATION](EVALUATION.md) ·
[OPERATIONS](OPERATIONS.md) · [DEPLOYMENT](DEPLOYMENT.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md) ·
[API_CONTRACT](API_CONTRACT.md)
