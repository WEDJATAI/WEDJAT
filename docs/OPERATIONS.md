# WEDJAT DOMAIN AI — Operations

This document is the operator's view: health endpoints (§89), job-system operations (§62),
observability surfaces (§56–§58, §88), structured logging with redaction, and common failure
modes with their designed mitigations. Code anchors: `src/app/api/health/route.ts`,
`src/app/api/system/route.ts`, `src/lib/wedjat/observability/{jobs,metrics,audit}.ts`,
`src/lib/wedjat/logger.ts`, `src/instrumentation.ts`.

## Health endpoints (§89)

- `GET /api/health` — unauthenticated liveness/readiness: overall status, app version, uptime,
  provider-key booleans, plus checks for `configuration` (DATABASE_URL presence) and `database`
  (SELECT 1 latency).
- `GET /api/health?deep=1` — adds: `retrieval` (indexed chunk / lexical posting / knowledge
  record counts; WARN when 0 chunks), `ai-providers` (circuit states; WARN when any OPEN),
  `jobs` (queued/failed counts; WARN when failed > 5), and `gpu` (always WARN here: "no CUDA
  device in this environment — training lifecycle is simulated by design").
- `GET /api/system` (auth required; the Observability view polls it every 15 s): application
  status/uptime, database status+latency+migration status, retrieval stats (embedding model,
  postings, knowledge records), per-provider health (circuit state, requests, successes,
  failures, 429s, 5xxs, timeouts, avg latency, success rate), job counts by status, GPU honesty
  card, active policies (data-sharing, embedding policy, budget spent today vs $50/day), the
  metric counters (requests/successes/failures, avg latency, fallback/retry rates, retrieval
  events, ingestion jobs), config versions, prompt versions, and the last 40 audit + ingestion
  events.

## Job system operations (§62)

- Worker: single in-process loop started by `src/instrumentation.ts` (`startJobWorker`), one job
  per 1.5 s tick. Statuses: QUEUED → RUNNING → COMPLETED | RETRYING | FAILED | CANCELLED;
  `attempts` bounded by `maxAttempts` (default 3). Transient-looking errors (timeout/network
  regex) retry with `2 s × attempts` backoff; permanent errors fail with `lastError` recorded.
- Controls: `POST /api/jobs {action:'retry'|'cancel', jobId}` — retry allowed from
  FAILED/CANCELLED (resets attempts), cancel allowed from QUEUED/RETRYING. The Knowledge view
  shows live stage chips for ingestion jobs and polls every 3 s only while jobs are active.
- Job types: `ingestion`, `training-run-step` (self-requeues until EVALUATING; promotion beyond
  CANDIDATE is human-only), `evaluation-run`, `synthetic-registration`.
- Idempotency (§61): `Job.idempotencyKey` unique — duplicate submissions return the existing job
  (`{jobId, duplicate:true}`).

## Observability surfaces (§56, §57, §88)

- **Metrics** (`observability/metrics.ts`, in-process window): aiRequests/aiSuccesses/
  aiFailures, degradedResponses, avg latency, retryRate, fallbackRate, retrievalEvents,
  ingestionJobs, chat/analyze counters, uptime — exposed via `/api/system`.
- **Provider health (§57)**: rolling per-provider/model windows (requests, successes, failures,
  429, 5xx, timeouts, avg latency) merged with circuit states and zero-state registry rows;
  `persistHealth()` upserts `ProviderHealth` rows best-effort after gateway calls — persistence
  failure never breaks the request path (§58).
- **Audit (§82)**: `AuditEvent` rows for login outcomes, blueprint.created, document.ingested,
  ai.generation, ai.analysis, training.dataset_created, training.gate_passed/rejected,
  training.promoted_*, training.rolled_back, evaluation.run, seed.complete — with actor
  (user/system/job/router), severity, and redacted details JSON.
- **Ingestion events**: one row per pipeline stage (status OK/WARN/FAILED + latency) for every
  document version — the stage timeline rendered in the Knowledge and Observability views.
- **Retrieval events**: per-query row (filters, candidate counts, latency, top score).

## Structured logging with redaction (§55, §56)

All logs are single-line JSON `{ts, level, msg, …fields}` (level filtered by `WEDJAT_LOG_LEVEL`,
default `info`, `debug` to enable adapter/router debug lines). Everything passes the centralized
redaction funnel: key/JWT/token/Bearer/libsql/PEM patterns masked, sensitive object keys
`[REDACTED]`, long strings truncated at 400 chars, depth/size caps. Notable operational
messages: `startup_config_valid` / `startup_db_reachable` (§91), `router_decision`,
`gateway_retry`, `gateway_hop_failed`, `job_enqueued/completed/retrying/failed`,
`ingestion_complete`, `evaluation_run_complete`, `chat_pipeline_complete`,
`provider_health_persist_failed`. dev.log (tee'd by `bun run dev`) is the primary log sink.

## Common failure modes → designed mitigations

| Failure | Behavior | Where |
|---|---|---|
| Provider outage | 2 transient retries per hop → failure recorded → circuit trips after 5 failures/60 s → next hop in chain (max 3) → controlled degraded response ("no answer was fabricated") + FailureMemory row | `gateway/{retry,circuit,router}.ts` |
| Rate limit / budget | 429 RATE_LIMITED backpressure before provider touch; BUDGET_EXCEEDED pauses expensive ops until UTC day rollover | `security/policy.ts` |
| Turso/DB unavailable | health check reports database ERROR; audit/health persistence degrade gracefully (logged, never thrown into the request path); provider health keeps serving from memory | `observability/*`, §58 |
| Corrupt embedding row | skipped in semantic scoring (graceful degradation) | `retrieval/hybrid.ts` |
| Job payload/parse failure | job FAILED with lastError, retryable only via UI action | `observability/jobs.ts` |
| Empty LLM response | treated transient → retried → failover | `adapters/*` |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for symptom→fix lookup.
