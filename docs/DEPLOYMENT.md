# WEDJAT DOMAIN AI — Deployment

This document covers running the app in development and building it for production, the full
environment-variable table, how to enable remote providers (key presence → STANDBY → ACTIVE →
router inclusion), GPU attachment notes for real training (§38), and the seeding procedure.
Runtime: Next.js 16 App Router on bun; port 3000; job worker starts via
`src/instrumentation.ts` on server boot.

## Development

```bash
bun install
bun run db:generate        # prisma client
bun run db:push            # create/sync schema at DATABASE_URL
bun scripts/seed.ts        # seed org/users/corpus/registry/benchmark/baseline
bun run dev                # next dev -p 3000 | tee dev.log
```

Open http://localhost:3000, log in with `owner@wedjat.ai` / `wedjat`. The seed wipes existing
rows (FK-safe order) before writing; it ingests `scripts/corpus/*.md` through the REAL
ingestion pipeline and records the `baseline-seed` evaluation run (embedding + indexing of 7
documents runs in-process).

## Production build

```bash
bun run build              # next build + standalone assembly (copies static/, public/)
bun run start              # NODE_ENV=production bun .next/standalone/server.js | tee server.log
```

Startup sequence (§91): instrumentation validates `DATABASE_URL` presence, logs provider-key
booleans, starts the job worker, probes the DB with `SELECT 1`. Health probes:
`GET /api/health` and `GET /api/health?deep=1` (unauthenticated by design). In-memory state
(rate buckets, budget, circuits, IDF cache) is per-process — run a single instance, or accept
per-instance limits, until an external store is added.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | SQLite/libSQL URL. Dev: `file:/home/z/my-project/db/custom.db`. Turso production: the libSQL URL (carried as `TURSO_DATABASE_URL` + auth via `TURSO_AUTH_TOKEN` in the deployment environment and mapped to `DATABASE_URL` — Turso is the production target per §25) |
| `GEMINI_API_KEY` | no | activates `google/gemini-2.5-pro` + `gemini-2.5-flash` registry entries and the REST adapter |
| `GROQ_API_KEY` | no | activates `groq/llama-3.3-70b-versatile` + `llama-3.1-8b-instant` |
| `HF_TOKEN` | no | Hugging Face token (registry lineage for Qwen2.5-7B; not used for local embed/rank) |
| `WEDJAT_LOG_LEVEL` | no | `info` (default) or `debug` |
| `WEDJAT_DEMO_PASSWORD` | no | overrides the demo login password (`wedjat`) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | prod target | Turso connection coordinates for the production database plane |

Secrets are env-only; they are never logged or returned (booleans only — §54/§55). The schema
is Turso-portable without changes (no enums/arrays; JSON-text payloads) — see
[DATABASE.md](DATABASE.md).

## Enabling remote providers

1. Set the key (e.g. `GEMINI_API_KEY=…`) in the server environment; restart.
2. `config.keys.gemini` becomes true → `buildRegistry()` marks the Gemini entries ACTIVE and
   `GeminiAdapter.isAvailable()` returns true.
3. The router now includes them as candidates for permitted task types (subject to the §17/§66
   policy engine: org policy and evidence classifications; CONFIDENTIAL stays local) and health/
   circuit tracking applies to them exactly as to the internal gateway.
4. Verify: `GET /api/health` shows the key boolean; `GET /api/models` shows ACTIVE; Observability
   view shows provider rows. Without the key the entries remain STANDBY and are listed in the
   router's `rejected[]` reasons.

Note: the Groq adapter calls Groq's own REST endpoint (`api.groq.com/openai/v1/chat/completions`)
with `llama-3.3-70b-versatile`; Gemini is called via its `v1beta generateContent` REST API.
No OpenAI SDK or model is used anywhere.

## GPU attachment for real training (§38)

None exists in this environment: `/api/health?deep=1` reports a WARN gpu check and
`/api/system` reports `gpu.available: false`. Training runs therefore auto-degrade
LORA/QLORA → SIMULATED with a recorded reason (see [TRAINING.md](TRAINING.md)). To do real
training, attach a GPU node of the class recorded in the registry for
`huggingface/Qwen2.5-7B-Instruct` (`gpuRequirement: A10G/T4 24GB`); run validation
(`advanceTrainingRun` VALIDATING step) probes and records `gpuProfile`
(`none-detected (no CUDA device in this environment)` today) — with a GPU present, the same
lifecycle machinery (gates, evaluation, promotion, rollback) governs real runs. The fine-tuning
strategy (§37) remains PEFT/LoRA on the 7B target with the dataset-gate pipeline unchanged.

## Seeding procedure (fresh environment)

```bash
bun run db:push            # ensure schema exists
bun scripts/seed.ts        # wipe + seed: 1 org, 4 users, 4 platforms, 6 blueprints,
                           # 7 documents / 65 INDEXED chunks / 124 knowledge records,
                           # 8 registry models, 7 prompts, 10 config versions,
                           # 14-case core-benchmark + baseline run (passRate 0.917)
```

Re-running the seed resets all data (including sessions — log in again). Idempotency keys are
`seed-<file>` per corpus document, so a partially-failed seed can be re-run safely. After
seeding, generate feedback (chat + thumbs) before `create-dataset` will find eligible sources,
or let the synthetic-registration job register chunk-based examples (§36).
