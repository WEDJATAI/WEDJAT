# WEDJAT DOMAIN AI — Database (Prisma / SQLite / Turso-portable)

This document inventories the schema in `prisma/schema.prisma` grouped by plane, states the
integrity features built into the model design (§28), and documents the migration workflow and
the Turso portability path (§25). The live database is SQLite at `db/custom.db`
(`DATABASE_URL=file:/home/z/my-project/db/custom.db`); the schema deliberately avoids SQLite-
incompatible features so it can be pointed at Turso (libSQL) unchanged.

## Model inventory by plane

| Plane | Models |
|---|---|
| Tenancy / identity | `Organization` (dataPolicy), `User` (role, passwordHash), `Membership`, `Session` (token, expiresAt) |
| Knowledge hierarchy | `Platform`, `PlatformVersion`, `Blueprint`, `BlueprintVersion`, `Document`, `DocumentVersion`, `DocumentSection`, `DocumentChunk`, `KnowledgeRecord` |
| Retrieval | `EmbeddingRecord` (256-d JSON vector + norm), `LexicalTerm` (postings: term+chunkId+tf), `RetrievalEvent` |
| Conversation / AI | `Conversation`, `Message`, `AiGeneration`, `GenerationSource` |
| Model governance | `ModelRegistry` (capability row per provider/model), `ModelVersion` (baseModel, trainingMethod, artifactChecksum, evaluationVersion, datasetVersionId), `ModelDeployment` (stage, canaryPercent, status) |
| Training data governance | `TrainingSource`, `TrainingExample` (prompt/completion, qualityScore, dedupeHash, status, isSynthetic), `TrainingDataset`, `TrainingDatasetVersion` (LOCKED + checksum), `TrainingRun`, `TrainingMetric` |
| Evaluation | `EvaluationSuite`, `EvaluationCase` (query, expectedKeywordsJson, expectedPlatform/BlueprintSlug, expectedSourcesMin, llmJudged), `EvaluationResult` (per case per runLabel: recallAtK, precisionAtK, keywordCoverage, groundedness, latencyMs, passed) |
| Feedback / review | `Feedback` (generationId, label, comment), `HumanReview`, `FailureMemory` (§72) |
| Observability / control | `ProviderHealth`, `AuditEvent` (actor/action/target/severity/detailsJson/traceId), `IngestionEvent` (stage, status, latencyMs), `Job` (type, status, payloadJson, attempts, idempotencyKey, resultJson), `PromptVersion` (§74), `ConfigVersion` (§75) |

Counts after `bun scripts/seed.ts` (§101): 1 org, 4 platforms, 6 blueprints, 7 documents,
65 INDEXED chunks (66 total, 1 EXCLUDED), 124 knowledge records, 8 registry entries,
14 evaluation cases, 4 users.

## Integrity features (§28, §29, §30, §61, §64)

- **Immutable blueprint versions (§29)**: a changed blueprint creates a NEW `BlueprintVersion`
  with its own sha256 `checksum`; previous CURRENT rows are set to SUPERSEDED with
  `effectiveUntil` — historical rows are never overwritten or deleted. `DocumentVersion` rows
  carry `checksum` (§30) and `rawText` for verification.
- **Checksums everywhere**: documents/chunks (contentHash, normalized), blueprint versions
  (sha256), platform versions (sha256), dataset versions (contentHash of sorted example hashes),
  model artifact checksums (§64).
- **Idempotency (§61)**: `Job.idempotencyKey` unique — duplicate ingest submissions return the
  existing job; seed uses `seed-<file>` keys; `TrainingSource` has a unique (orgId, kind, refId).
- **Unique constraints**: `Organization.slug`, `User.email`, `Session.token`,
  `Membership.(userId,orgId,scope)`, `PlatformVersion.(platformId,version)`,
  `Blueprint.(platformId,slug)`, `BlueprintVersion.(blueprintId,version)`,
  `Document.(blueprintVersionId,slug)`, `DocumentVersion.(documentId,version)`,
  `DocumentChunk.(documentVersionId,ordinal)`, `EmbeddingRecord.chunkId`,
  `ModelVersion.(registryId,version)`, `PromptVersion.(promptId,version)`,
  `TrainingSource.(orgId,kind,refId)`, `ProviderHealth.(provider,model)`,
  `Job.idempotencyKey` (nullable when absent). `LexicalTerm` and retrieval/audit tables are
  index-backed (`@@index` on term/chunkId/traceId/createdAt/status).
- **Status machines validated in the app layer** (no SQLite enums): run/deployment/dataset
  transitions enforced in `training/lifecycle.ts`; chunk status INDEXED/EXCLUDED set by the
  ingestion gates.
- Vectors and structured payloads are stored as JSON text (libSQL-portable); ids are Prisma
  cuids; trace ids are `trc_*` ULIDs (`lib/wedjat/ids.ts`).

## Turso portability (§25)

SQLite here is Turso-compatible libSQL. The production target per the master prompt is Turso as
the transactional source of truth: swap `DATABASE_URL` to your libSQL URL (e.g.
`libsql://<db>.turso.io`) and provide the auth token — in deployments these are carried as
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` and mapped to `DATABASE_URL` for the Prisma client
(`prisma/schema.prisma` `datasource db { provider = "sqlite" url = env("DATABASE_URL") }`).
No schema change is required: no enums, no arrays, JSON-text payloads. The logger's redaction
patterns already mask `libsql://` URLs (§55) so connection strings never leak into logs.
Health checks degrade gracefully if Turso is unavailable (§58): `/api/health` reports database
`ERROR`, in-memory provider health/circuit state keeps serving, and observability persistence
fails soft (logged, never thrown into the request path) — see [OPERATIONS.md](OPERATIONS.md).

## Migration workflow

```bash
bun run db:generate   # prisma generate (after schema edits)
bun run db:push       # prisma db push --accept-data-loss (dev: sync schema)
bun run db:migrate    # prisma migrate dev (create/apply migrations)
bun run db:reset      # prisma migrate reset
bun scripts/seed.ts   # repopulate demo state (wipes first, FK-safe order)
```

`GET /api/system` reports `database.migrationStatus: 'schema-in-sync (prisma db push)'`.
Startup validation (`src/instrumentation.ts`, §91) runs `SELECT 1` and logs
`startup_db_reachable` / `startup_db_unreachable`; startup config validation fails if
`DATABASE_URL` is missing. Prisma query logging is intentionally disabled in `src/lib/db.ts`
because raw query logs would bypass the redacting structured logger (§56).
