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

---

## Database Intake Engine (§106–§160) — added v1.1

All routes follow the standard envelope. Upload/reprocess require CURATOR+;
autonomy changes require ADMIN+; review actions require CURATOR+.

### Endpoints

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/api/intake/upload` | multipart: `file`, `platform?`, `name?` | `IntakeUploadResult` |
| GET | `/api/intake` | — | `IntakeListPayload` |
| GET | `/api/intake/[id]` | — | `IntakeDetailPayload` |
| POST | `/api/intake/[id]/reprocess` | — | `{ runId, jobId }` (§145) |
| GET | `/api/intake/review` | — | `IntakeDetailPayload`-style review queue: `{ mappings: IntakeMappingDto[], candidates: IntakeCandidateDto[] }` |
| POST | `/api/intake/review` | `{ mappingId?, candidateId?, decision: 'APPROVE'\|'REJECT', note? }` | updated `IntakeMappingDto \| IntakeCandidateDto` |
| GET | `/api/intake/autonomy` | — | `AutonomyPayload` |
| PUT | `/api/intake/autonomy` | `{ level: 0..5 }` | `AutonomyPayload` |
| GET | `/api/learning` | — | `LearningPayload` |
| POST | `/api/learning/health-check` | — | `{ ranAt, issuesFound, checks }` (§156) |
| POST | `/api/learning/improvements/[id]` | `{ action: 'acknowledge'\|'resolve' }` | `ImprovementItemDto` |

### Semantics for the UI

- Upload parses the file (SQLite binary, SQL dump, CSV, JSON/JSONL — auto-detected,
  §106/§107) and enqueues an async `database-intake` job. Poll `GET /api/intake`
  while any run status ∈ {RAW, STAGED, ANALYZED, MAPPED, VALIDATED} (reuse the
  3s-poll-while-active pattern from the knowledge view). Stage events per run are
  in `IntakeRunDto.stageEvents` (stage chips RAW→STAGED→ANALYZED→MAPPED→VALIDATED→IMPORTED).
- `IntakeDetailPayload.narrative` is the §160 WEDJAT pipeline narrative — render it
  as a timeline/console block after a run reaches IMPORTED.
- Mapping review (§113): HIGH_CONFIDENCE → `AUTO_APPLIED`; MEDIUM_CONFIDENCE →
  `PENDING_REVIEW` (review queue); LOW/UNRESOLVED → `PRESERVED_SOURCE` (zero data
  loss §143 — fields are never discarded, only preserved).
- Candidate gates (§126): show each gate with pass/fail chips. TRAINING_APPROVED
  candidates become training examples at autonomy ≥ 4 (auto-curation §127) or via
  explicit review.
- Autonomy (§151): LEVEL 0..5 selector; `capabilities[]` shows what is enabled at
  the current level. `governance[]` lists what is NEVER automated (§152) — render
  it as a fixed amber warning card.
- Drift (§142): when a new version of the same platform database is uploaded,
  `IntakeDetailPayload.drift` lists ADDED/REMOVED/MODIFIED/RENAMED/DEPRECATED changes.
- `GET /api/learning` powers the learning dashboard (§155): growth series,
  KG predicate counts, eval/feedback trends, improvement queue, last health check.
