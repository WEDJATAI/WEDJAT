# WEDJAT DOMAIN AI — Architecture

This document describes the layered structure of the codebase: the HTTP/API layer, application
and domain services, the WEDJAT AI GATEWAY, and infrastructure adapters (database, job worker,
local embedding/reranking). It also maps the knowledge hierarchy (§5/§26) to concrete Prisma
models and lists the module inventory with source paths. Ground truth is the code itself; every
path below exists in this repository.

## Layering

```
┌─ API layer ──────────────────────────────────────────────────────────────────┐
│ src/app/api/*/route.ts (19 routes, see docs/API_CONTRACT.md)                  │
│ Envelope {ok,data}|{ok,error} + central authz: src/lib/wedjat/api.ts          │
│ withPrincipal() resolves the Principal server-side; failFrom() maps the typed │
│ error taxonomy (errors.ts §60) to safe messages — never stack traces.         │
├─ Application / domain services ──────────────────────────────────────────────┤
│ reasoning/    answer pipeline (§46) + 5 analysis workflows (§47–§50, §52) + prompts │
│ knowledge/    13-stage ingestion pipeline (§8) + local embedder/chunker/quality│
│ retrieval/    hybrid retrieval (§11) → reranker (§12) → context (§13)          │
│ training/     dataset curation gates (§32) + run lifecycle (§41)               │
│ evaluation/   permanent benchmark runner (§42/§43)                             │
│ security/     auth (§53), data-sharing policy (§17/§66), injection (§16/§81)   │
│ observability/ jobs (§62), metrics (§56/§88), audit (§82)                      │
├─ WEDJAT AI GATEWAY (domain logic NEVER calls provider SDKs) ──────────────────┤
│ gateway/router.ts  routeAndComplete(): rate/budget → route() → per-hop        │
│ bounded retry → circuit tracking → failover (maxHops 3) → controlled degraded │
│ response (§20/§21/§24/§67). Adapters in gateway/adapters/*.ts.                │
├─ Infrastructure ──────────────────────────────────────────────────────────────┤
│ Prisma client (src/lib/db.ts) over SQLite (db/custom.db, Turso-portable)      │
│ Job worker started by src/instrumentation.ts (§62, §91)                        │
│ In-process embedder/reranker (LOCAL class, §18)                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

Request flow example (`POST /api/chat`): `route.ts` → `withPrincipal` →
`reasoning/answer.ts:runChatPipeline` → intent classification → scope resolution → query
expansion → `retrieval/hybrid.ts:hybridRetrieve` → `retrieval/reranker.ts:rerank` →
hallucination gate (§15) → `retrieval/context.ts:assembleContext` →
`gateway/router.ts:routeAndComplete` → output validation (§81) → grounding check (§14) →
lineage persistence (§31) → DTO.

## Knowledge hierarchy (§5, §26)

`Organization > Platform > Blueprint > BlueprintVersion > Document > DocumentVersion >
Section > Chunk > KnowledgeRecord` — Prisma models in `prisma/schema.prisma`:

| Level | Model | Notes |
|---|---|---|
| Organization | `Organization` | `dataPolicy` = LOCAL_ONLY \| APPROVED_REMOTE_PROVIDER \| RESTRICTED_REMOTE \| BLOCK_REMOTE |
| Platform | `Platform`, `PlatformVersion` | slug, criticality (CRITICAL/HIGH/MEDIUM), CURRENT version rows |
| Blueprint | `Blueprint` | belongs to one platform (tenant isolation via platform.orgId, §53) |
| Blueprint version | `BlueprintVersion` | IMMUTABLE (§29): status CURRENT/SUPERSEDED, sha256 `checksum`, effectiveFrom/Until |
| Document | `Document` | slug, docType (BLUEPRINT/ADR/SPEC/AUDIT/RUNBOOK/REVIEW/REFERENCE/PROMPT), classification (INTERNAL/PUBLIC/CONFIDENTIAL) |
| Document version | `DocumentVersion` | rawText, checksum (§30), status PENDING→INGESTED |
| Section | `DocumentSection` | markdown-heading extraction, ordinal/level lineage |
| Chunk | `DocumentChunk` | status INDEXED/EXCLUDED (dedupe §30 / quality gate), tokenEstimate, qualityScore, checksum |
| Knowledge atom | `KnowledgeRecord` | recordType FACT/DECISION/REQUIREMENT/RISK/COMPONENT/DEPENDENCY/RECOMMENDATION, topicKey, status CURRENT/RECENT/HISTORICAL/SUPERSEDED, sourcePriority (§6) |

Retrieval plane: `EmbeddingRecord` (256-d JSON vector + norm, model wedjat-local-embed-v1),
`LexicalTerm` (inverted-index postings: term, chunkId, tf), `RetrievalEvent` (per-query
telemetry). Conversation/AI plane: `Conversation`, `Message`, `AiGeneration` (traceId, provider,
model, promptVersion, retrieverVersion, tokens, latency, confidence, groundedness, cost,
fallbackChain), `GenerationSource` (rank, chunkId → document → blueprint version, §31).

## Job system (§62)

Long operations never block HTTP. `observability/jobs.ts` persists `Job` rows
(statuses QUEUED/RUNNING/RETRYING/FAILED/CANCELLED/COMPLETED, maxAttempts 3 default,
idempotency keys §61) and runs a single in-process worker (1.5 s tick, one job per tick,
started in `src/instrumentation.ts`). Job types:

- `ingestion` → `knowledge/ingestion.ts:runIngestion` (13 stages, each an `IngestionEvent` row)
- `training-run-step` → `training/lifecycle.ts:advanceTrainingRun`; non-terminal states requeue
  themselves; the worker auto-progresses only up to EVALUATING → CANDIDATE/REJECTED
- `evaluation-run` → `evaluation/runner.ts:runEvaluationSuite`
- `synthetic-registration` → `training/lifecycle.ts:registerSyntheticSources` (§36)

Transient failures (timeout/network regex) go RETRYING with `2 s × attempts` backoff and
requeue; UI retry/cancel controls via `POST /api/jobs {action:'retry'|'cancel', jobId}`.

## Module map

| Module | Files | Purpose |
|---|---|---|
| Config/errors/logging | `src/lib/wedjat/{config,errors,logger,ids}.ts` | every knob (§54/§75), typed error taxonomy (§60), redacting logger (§55/§56), ULID traces + sha256/contentHash (§26/§30) |
| Gateway | `src/lib/wedjat/gateway/{router,registry,circuit,retry,provider-health}.ts`, `adapters/{types,wedjat,gemini,groq}-adapter.ts` | routing/failover/circuit/retry/health + provider adapters (no OpenAI, §1) |
| Knowledge | `src/lib/wedjat/knowledge/{ingestion,chunker,embeddings,quality}.ts` | pipeline, section-aware chunking, local 256-d hashed embedder, quality/sensitive/classification/atom extraction |
| Retrieval | `src/lib/wedjat/retrieval/{hybrid,reranker,context}.ts` | BM25 + cosine + filters, 6-feature rerank, context assembly + grounding + confidence |
| Reasoning | `src/lib/wedjat/reasoning/{answer,workflows,prompts,source-refs}.ts` | §46 pipeline, §47–§50, §52 workflows, versioned prompts (§74) |
| Training | `src/lib/wedjat/training/lifecycle.ts` | feedback/synthetic sources, curation gates, LOCKED datasets, run lifecycle, promotion/rollback |
| Evaluation | `src/lib/wedjat/evaluation/runner.ts` | benchmark execution + evaluation memory (§73) |
| Security | `src/lib/wedjat/security/{auth,policy,injection}.ts` | sessions/roles (§53), policy engine + rate/budget (§17/§24/§67), injection defense (§16/§81) |
| Observability | `src/lib/wedjat/observability/{jobs,metrics,audit}.ts` | jobs, in-memory counters, audit trail |
| API | `src/app/api/**/route.ts` | 19 endpoints per docs/API_CONTRACT.md |
| Frontend | `src/components/wedjat/**`, `src/hooks/*`, `src/app/page.tsx` | single-route app, 10 views, contract-driven DTO consumption |
| Seed | `scripts/seed.ts`, `scripts/corpus/*.md` | §101 initial corpus via the real pipeline |

## Cross-cutting invariants

- Domain logic never imports provider SDKs — only `routeAndComplete` does (§1/§18).
- Every org-scoped query derives `orgId` from the server-side session, never the request (§53).
- Every stage of ingestion/generation/evaluation writes observable rows (§56).
- Versioned assets (prompts §74, config §75, retriever `hybrid-v1`, dataset checksums) make
  generations reconstructable.
- Failure paths are bounded: failover maxHops 3, retry budget 20 s, job maxAttempts 3 (§99).
