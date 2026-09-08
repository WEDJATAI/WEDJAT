# WEDJAT DOMAIN AI — Data Governance

This document describes how knowledge, generations, and training data are governed: immutable
versioning (§29), source hashing (§30), the full lineage chain from an answer back to blueprint
versions (§31), training-data governance (§83), deletion/exclusion support (§84), privacy and
data minimization (§85), and failure memory (§72). Code anchors:
`src/lib/wedjat/knowledge/ingestion.ts`, `src/lib/wedjat/reasoning/answer.ts`
(`persistGeneration`), `src/lib/wedjat/training/lifecycle.ts`, `src/lib/wedjat/ids.ts`.

## Versioning & immutability (§29)

A changed blueprint is a NEW `BlueprintVersion` row (auto minor-bump `1.0 → 1.1` or explicit),
status CURRENT, with `effectiveFrom`; the previous CURRENT version is set to SUPERSEDED with
`effectiveUntil` — never overwritten, never deleted. Retrieval prefers CURRENT versions by
default; contradiction analysis deliberately includes SUPERSEDED versions. Platform versions and
model registry entries follow the same append-not-mutate pattern. Historical answers cite the
version that produced them, so old generations remain interpretable.

## Source hashing (§30)

- `sha256` of raw content = `DocumentVersion.checksum` and `BlueprintVersion.checksum`
  (integrity verification; identical content on a new version is detected and marked duplicate).
- `contentHash` (whitespace-normalized, lowercase, alphanumeric-only, then sha256) per chunk =
  `DocumentChunk.checksum` — the global dedupe registry: any chunk whose hash already exists is
  created with status `EXCLUDED` at ingestion (§84-style exclusion, not deletion).
- `TrainingExample.dedupeHash` = contentHash of `prompt::completion` — dataset gate 2.
- Dataset-version checksum = contentHash of the sorted example dedupe hashes → LOCKED,
  verifiable artifact identity (§64).

## Lineage chain (§31)

Every answer persists an `AiGeneration` row and one `GenerationSource` row per cited source:

```
answer (ChatResponse / AiGeneration)
  └─ generation sources (GenerationSource: rank, score, sectionHeading)
       └─ chunk (DocumentChunk → DocumentSection)
            └─ document (Document → DocumentVersion: checksum, rawText)
                 └─ blueprint version (BlueprintVersion: version, status, effectiveFrom)
                      └─ blueprint → platform → organization (tenant scoping §53)
```

`AiGeneration` also stores `traceId`, `provider`, `model`, `promptVersion` (e.g.
`sys.chat.grounded@1.2.0`), `retrieverVersion` (`hybrid-v1`), token counts, latency, retries/
fallbacks, `confidence`, `groundedness`, `costEstimateUsd` — a generation is reconstructable
from recorded versions (§74/§75). Feedback links to the generation id, closing the loop.

## Training data governance (§83)

- Ingestion never auto-trains (§9): eligibility (feedback labels §34, or synthetic registration
  §36) → curation gates (schema, dedupe, quality ≥ 0.55 default, sensitive-data, label framing,
  source grounding §32) → LOCKED dataset version → explicit run start.
- Datasets are append-only versions; runs reference the exact `datasetVersionId` and record
  `baseModelVersionId` + `candidateModelVersionId` on `ModelVersion` rows (artifact checksums,
  evaluationVersion labels). Promotion beyond CANDIDATE is a human action with audit entries.
- Synthetic examples carry `[source-grounded: chunk <id>]` markers; the synthetic-teacher prompt
  contract requires validation + human review before entering any dataset (`HumanReview` model).
- Sensitive-data gate: any example matching api-key/jwt/private-key/db-url/gh-token patterns is
  excluded with the pattern names in the returned reasons.

## Deletion / exclusion support (§84)

- **EXCLUDED statuses** are the primary mechanism: duplicate chunks (dedupe) and low-quality
  chunks (qualityScore < 30) are stored but EXCLUDED from retrieval and from evaluation source
  selection; `TrainingSource.status` moves ELIGIBLE → CURATED when consumed into a dataset;
  SUPERSEDED blueprint versions stay queryable but rank down (freshness weight 0.15).
- Curation flags: `Document.classification` (CONFIDENTIAL material never leaves local inference
  §66) and ingestion-time sensitive-data WARN events steer what is eligible for training.
- **Honest limitation**: deleting rows from the DB removes them from retrieval and future
  datasets, but it cannot un-train a model that already consumed the data. In THIS environment
  that is moot because training is simulated (no weights ever change — see [TRAINING.md](TRAINING.md));
  in a real deployment §84 requires retraining-from-clean-dataset or model retirement for
  already-trained artifacts.

## Privacy / data minimization (§85)

Only what is needed is stored and sent: retrieval queries are truncated (2000 chars query cap,
500 chars in RetrievalEvent), evidence previews capped (700 chars in source refs), log strings
truncated at 400 chars with proprietary-content-avoidance (§56), and prompt payloads carry only
fenced evidence blocks with metadata. `POST /api/ingestion` stores rawText for integrity/
verification (needed for checksum re-verification and version diffs) — classification controls
where that text may travel (CONFIDENTIAL ⇒ local inference only). User inputs to login are
minimized in logs (3-char email prefix on failure). No PII beyond name/email is collected in the
seeded demo.

## Failure memory (§72)

`FailureMemory` rows capture operational failures for future improvement: degraded AI responses
(all provider hops exhausted) are recorded with the question, failure type LOW_CONFIDENCE, the
degradation reason, and the model version — explicitly positioned as future training signal.
Combined with `Feedback` (8 labels, `src/components/wedjat/shared/status-badge.tsx`: CORRECT,
PARTIALLY_CORRECT, INCORRECT, UNSUPPORTED, HALLUCINATION, OUTDATED, HIGH_VALUE, LOW_VALUE) and
`HumanReview`, this is the continuous-learning intake path
(§34, §71); positive/negative labels drive training-source eligibility (see [TRAINING.md](TRAINING.md)).
