# WEDJAT DOMAIN AI — API CONTRACT (v1)

All responses: `{ ok: true, data: <T> }` or `{ ok: false, error: { code, message } }`.
Auth: HttpOnly cookie `wedjat_session` set by `POST /api/auth/login`. All routes
(except login/health) require it and return 401 `{ok:false, error:{code:'UNAUTHORIZED'}}` otherwise.

TS types live in `src/lib/wedjat/types.ts` — import type-only. **Import `ApiResponse`, `Principal`, `ChatResponse`, etc. from `@/lib/wedjat/types` — this file has zero runtime code so it is safe in client components.**

## Endpoints

| Method | Path | Body / Query | Success `data` type |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` (demo password: `wedjat`) | `Principal` |
| POST | `/api/auth/logout` | — | `true` |
| GET | `/api/auth/me` | — | `Principal` |
| GET | `/api/auth/users` | — | `LoginUserOption[]` (demo user picker) |
| GET | `/api/health` | `?deep=1` | `{ status, checks: {name, status, detail}[] }` |
| GET | `/api/platforms` | — | `PlatformSummary[]` |
| GET | `/api/blueprints` | `?platform=<slug>` | `BlueprintSummary[]` |
| GET | `/api/blueprints` | `?id=<blueprintId>&full=1` | `BlueprintDetail` |
| GET | `/api/dashboard` | — | `DashboardStats` |
| POST | `/api/search` | `{ query, platform?, blueprint?, version?, docType?, topK? }` | `SearchResponse` |
| POST | `/api/chat` | `{ message, conversationId?, platform?, blueprint?, version? }` | `ChatResponse` |
| GET | `/api/chat` | `?conversationId=<id>` | `ConversationMessage[]` |
| POST | `/api/analyze` | `{ type: 'cto-summary'\|'resilience'\|'contradictions'\|'compare'\|'cross-platform', platform?, blueprint?, fromVersionId?, toVersionId? }` | `AnalyzeResponse` |
| POST | `/api/ingestion` | `{ platformSlug, blueprintSlug, title, docType, classification, content, version? }` | `IngestionSubmitResult` |
| GET | `/api/ingestion` | — | `{ events: IngestionEventDto[], jobs: JobDto[] }` |
| GET | `/api/jobs` | `?status=` | `JobDto[]` |
| POST | `/api/jobs` | `{ action: 'retry'\|'cancel', jobId }` | `JobDto` |
| POST | `/api/feedback` | `{ generationId, label, comment? }` | `FeedbackDto` |
| GET | `/api/feedback` | — | `FeedbackDto[]` |
| GET | `/api/evaluations` | — | `EvaluationsPayload` |
| POST | `/api/evaluations` | `{ action: 'run', suiteId, label? }` | `{ runLabel, suiteId, summary: { passRate, avgRecall, avgPrecision, avgGroundedness, avgLatencyMs, caseCount } }` |
| GET | `/api/training` | — | `TrainingPayload` |
| POST | `/api/training` | see below | see below |
| GET | `/api/models` | — | `ModelsPayload` |
| POST | `/api/models` | `{ action: 'promote'\|'rollback', modelVersionId, stage? }` | `ModelsPayload` |
| GET | `/api/system` | — | `SystemHealthPayload` |

### POST /api/training actions
- `{ action: 'create-dataset', name, description?, includeKinds?: ('FEEDBACK'|'SYNTHETIC'|'CORRECTION')[], minQuality?: number }` → `{ datasetId, datasetVersionId, exampleCount, excluded: number, reasons: string[] }`
- `{ action: 'start-run', datasetVersionId, method: 'LORA'|'QLORA'|'SIMULATED' }` → `{ runId, jobId }`
- `{ action: 'advance-run', runId, to: 'candidate'|'canary'|'production' }` → `{ runId, status, note }` (explicit promotion gates — never automatic)
- `{ action: 'rollback', runId }` → `{ runId, status }`

### Error codes
`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `INTERNAL`. Rate limits: 30 req/min per user (chat/search/analyze), backpressure error `RATE_LIMITED`.

### Semantics worth knowing for the UI
- Chat answers are markdown containing `[S1]`, `[S2]`… citation markers that map to `sources[]` (rank order).
- `insufficientEvidence: true` → the system refused to answer (hallucination control §15) and `answer` contains the canned refusal + what's missing.
- `generation.fallbackChain` shows e.g. `["google/gemini-2.5-pro", "wedjat/internal"]` — which models were tried.
- Training runs advance through statuses: `QUEUED → VALIDATING → TRAINING → EVALUATING → CANDIDATE → CANARY → PRODUCTION` (+ `FAILED/REJECTED/ROLLED_BACK`). The job worker auto-progresses until `EVALUATING`; promotion to `CANDIDATE/CANARY/PRODUCTION` requires explicit user action. In this environment training is **SIMULATED** (no GPU) — the UI must show this honestly.
- `POST /api/ingestion` returns immediately with a job; poll `GET /api/ingestion` for pipeline events (stages: DISCOVERED→VALIDATED→…→READY_FOR_RAG).
