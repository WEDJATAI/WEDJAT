# WEDJAT DOMAIN AI — Troubleshooting

This document maps observed symptoms to causes and fixes, verified against the implementation.
Before anything else, check `dev.log`/`server.log` (structured JSON lines) and
`GET /api/health?deep=1` — the deep check reports database, retrieval, provider-circuit, job,
and GPU state in one response.

## Login & access

| Symptom | Cause | Fix |
|---|---|---|
| Login fails ("Invalid email or password") | DB not seeded, or seeded users were wiped | Run `bun scripts/seed.ts` (recreates users; demo password `wedjat`, overridable with `WEDJAT_DEMO_PASSWORD`). Confirm `db/custom.db` exists and `DATABASE_URL` points at it. |
| 401 on every API call after page load | Session cookie missing/expired (12 h TTL) | Log in again; `GET /api/auth/me` 401 bounces the UI to the login view by design. |
| 403 FORBIDDEN on mutations | Role is MEMBER or AUDITOR (read-only) | Use an OWNER/ADMIN/CURATOR demo user (e.g. `curator@wedjat.ai`). |
| Everything 500s after a schema edit | Prisma client out of sync with the schema | `bun run db:generate` then `bun run db:push`; restart the dev server. |

## Chat & answers

| Symptom | Cause | Fix |
|---|---|---|
| Chat returns "Insufficient evidence…" | Retrieval gate (§15): best rerank score < `config.retrieval.minRerankScore` (0.18) — by design the LLM is never called on weak evidence | Check the Knowledge view has indexed chunks (`/api/health?deep=1` retrieval check); ask more specifically, pin platform/blueprint scope in the chat selectors, or ingest the missing material. The refusal text lists what information is required. |
| Empty search results | Filters (platform/blueprint/docType) exclude everything, or no INDEXED chunks | Widen filters; run the seed; confirm ingestion events reached READY_FOR_RAG (stage chips in the Knowledge view). |
| Analysis takes 10–30 s | Expected: deep-analysis workflows run full retrieval plus one LLM generation via the internal gateway (~20 s observed in dev.log) | Not a fault; the UI shows staged loading ("Retrieving evidence… / Reasoning…"). If it exceeds ~90 s, check for `gateway_hop_failed`/timeout aborts in the log. |
| 429 RATE_LIMITED responses | More than 30 requests/min per user (chat/search/analyze) or 120/min per provider | Slow down — the token bucket refills continuously. Limits are process-local; a restart resets them. |
| BUDGET_EXCEEDED on expensive ops | Daily $50 estimated spend exhausted | Resets at UTC day rollover; or raise `config.budget.usdPerDay` (config is code — edit + restart). |
| Answer flags "low-groundedness" | Grounding check found the answer drifting from cited evidence (score < 0.25) | Inspect the cited sources; the flag is surfaced honestly rather than hidden — see [RAG_ARCHITECTURE.md](RAG_ARCHITECTURE.md). |

## Jobs & ingestion

| Symptom | Cause | Fix |
|---|---|---|
| Ingestion job stuck QUEUED | The job worker runs only inside the server process (`src/instrumentation.ts` starts it) — it is not running if the server was never started/restarted after enqueueing | Start/restart the dev server; the worker polls every 1.5 s and claims the job. Or use the retry action (POST /api/jobs). |
| Job FAILED with lastError | Non-transient error (or attempts exhausted: max 3) | Read `lastError` in the Knowledge view / jobs API; fix the input; retry re-queues from scratch. |
| Same document ingested twice / duplicate warnings | Content-hash dedupe (§30): identical checksum marks the version duplicate and duplicate chunks EXCLUDED | Intended idempotent behavior, not an error. For a genuinely new version, change content or bump `blueprintVersion`. |
| Duplicate job submitted | `Job.idempotencyKey` is unique — the second submission returns the existing job | Intended; the API response carries `duplicate: true`. |

## Providers & routing

| Symptom | Cause | Fix |
|---|---|---|
| Provider shows STANDBY in the Models view | Remote provider key not configured | Set `GEMINI_API_KEY` / `GROQ_API_KEY` and restart; the registry entry goes ACTIVE and the router includes it ([DEPLOYMENT.md](DEPLOYMENT.md)). |
| Circuit OPEN in Observability | 5 failures in a 60 s window trips the breaker; OPEN blocks calls for the 30 s cooldown | Wait out the cooldown (HALF_OPEN then permits up to 3 probes); inspect the provider's health row (429/5xx/timeout counts). |
| "controlled degraded response" answers | All hops in the failover chain exhausted (bounded at 3) | Controlled by design — nothing was fabricated. Check `gateway_hop_failed` logs and provider status; a FailureMemory row records the question for future training signal. |
| Turso unreachable in production | DB plane down | `/api/health` reports database ERROR; observability persistence degrades gracefully (§58) but org-scoped queries fail — restore the endpoint; provider health/circuits keep working from memory. |

## Training & evaluation

| Symptom | Cause | Fix |
|---|---|---|
| Training run stops at CANDIDATE | Promotion beyond CANDIDATE is explicitly human-only (§41) | Use `advance-run` (to canary/production) from the Training view with a mutation-role user. |
| Run REJECTED at the gate | Evaluation-gate regression: avgRecall < baseline − 0.02 (`regressionTolerance`) | Check the gate badge/`evaluationSummaryJson` (passRate, recall, baseline). Improve the dataset or retrieval, then start a new run. |
| Run FAILED immediately | Dataset version not LOCKED, or core-benchmark/baseline missing | Re-create the dataset (LOCKED at creation); ensure the seed ran so `baseline*` results exist. |
| "No eligible training sources" on create-dataset | No feedback submitted and synthetic registration hasn't run | Submit chat feedback first, or include the SYNTHETIC kind (the API enqueues a synthetic-registration job); retry. |
| Evaluation pass rate looks low | Shared-services recall miss + strict keyword matching (documented) | Read [EVALUATION.md](EVALUATION.md) — metrics and known strictness are analyzed there. |

For unlisted symptoms: search the log for `api_error` (full server-side detail is logged, never
returned to the client, §60), `gateway_hop_failed`, `job_failed`, or ingestion stage FAILED
events — the Observability view shows the same data live.

## Log/message quick reference

| Log message | Meaning | Emitted by |
|---|---|---|
| `startup_config_invalid` / `startup_db_unreachable` | §91 startup validation failed (missing DATABASE_URL / DB down) | `src/instrumentation.ts` |
| `router_decision` | routing chain chosen + rejected count (per trace) | `gateway/router.ts` |
| `gateway_retry` | a transient provider error was retried (attempt n) | `gateway/retry.ts` |
| `gateway_hop_failed` | a provider hop failed → failover (includes circuit state) | `gateway/router.ts` |
| `job_enqueued/completed/retrying/failed` | job lifecycle transitions with latency/error | `observability/jobs.ts` |
| `ingestion_complete` | pipeline finished (chunks, duplicate flag, traceId) | `knowledge/ingestion.ts` |
| `evaluation_run_complete` | suite run summary (passRate, recall, …) | `evaluation/runner.ts` |
| `chat_pipeline_complete` | answer served (provider, groundedness, confidence, degraded) | `reasoning/answer.ts` |
| `provider_health_persist_failed` | DB health snapshot write failed (non-fatal, §58) | `gateway/provider-health.ts` |
| `login_failed` | failed login (email masked to 3 chars) | `security/auth.ts` |
