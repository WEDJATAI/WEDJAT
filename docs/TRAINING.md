# WEDJAT DOMAIN AI — Training (honest simulation policy)

This document describes the training data path and the run lifecycle: eligibility from feedback
(§34), synthetic sources (§35/§36), curation gates (§32), LOCKED dataset versions with
checksums, the run state machine with the evaluation gate vs. baseline (§41/§43), explicit
promotion, and rollback (§65). Implementation: `src/lib/wedjat/training/lifecycle.ts`, driven by
`POST /api/training` and the `training-run-step` job. **Critical honesty: there is no GPU in this
environment — every run executes a SIMULATED lifecycle demonstration, never real weight
updates. The system labels this everywhere and records the degradation reason.**

## Eligibility → curation gates (§9, §32)

Ingestion NEVER auto-trains. Sources become eligible only via:

- **FEEDBACK** (§34): feedback labels CORRECT/HIGH_VALUE register `TrainingSource(kind=
  'FEEDBACK')`; INCORRECT/HALLUCINATION/UNSUPPORTED/OUTDATED register CORRECTION candidates.
  Idempotent per (org, kind, refId) upsert.
- **SYNTHETIC** (§35/§36): `registerSyntheticSources` (job `synthetic-registration`) upserts up
  to 40 top-quality INDEXED chunks (qualityScore ≥ 60) per run. Teacher-model QA generation uses
  the `sys.training.synthetic-qa@1.0.0` prompt; synthetic examples are tagged
  `[source-grounded: chunk <id>]` and the prompt contract states they require validation + human
  review (`HumanReview` model exists for that path) before entering any dataset.

`createDataset` (POST `/api/training {action:'create-dataset'}`) then runs every example through
six gates, in order — failures are counted, with reasons returned to the UI:

| Gate | Check |
|---|---|
| 1 schema | prompt ≥ 20 chars, completion ≥ 30 chars |
| 2 dedupe (§30) | contentHash of prompt::completion — duplicates excluded |
| 3 quality | mean text-quality score ≥ `minQuality` (default `config.training.minExampleQuality = 0.55`) |
| 4 sensitive (§32) | `detectSensitiveData` — api-key/jwt/private-key/db-url/gh-token patterns |
| 5 label | corrections explicitly framed `CORRECTION: …` |
| 6 grounding | synthetic completions carry the source-grounded marker |

## LOCKED dataset versions

On success a `TrainingDatasetVersion` row is created (version `<n>.0`), examples persisted with
`status: PASSED` and validation notes, then the version flips DRAFT → **LOCKED** with
`checksum = contentHash(sorted example dedupeHashes joined '|')` and `lockedAt`. The checksum
makes the dataset immutable and verifiable (§64); `start-run` refuses any version whose status
is not LOCKED. Corrupt/empty candidate sets delete the draft version and return a VALIDATION
error listing the gate reasons.

## Run lifecycle (§41) — `advanceTrainingRun` + `promoteRun`

```
QUEUED → VALIDATING → TRAINING → EVALUATING → CANDIDATE → CANARY → PRODUCTION
                     ↘ FAILED   ↘ REJECTED              ↘ REJECTED ↘ REJECTED
                                                (CANARY/PRODUCTION ↘ ROLLED_BACK, PRODUCTION ↘ DEPRECATED)
```

- The job worker auto-progresses QUEUED → VALIDATING → TRAINING → EVALUATING only
  (`training-run-step` jobs requeue themselves for non-terminal states).
- **VALIDATING** (§63): dataset version must be LOCKED, else FAILED.
- **TRAINING — SIMULATED**: GPU profile is probed; this environment reports
  `none-detected (no CUDA device in this environment)`. If the requested method is LORA or
  QLORA, the run auto-degrades: `method` is rewritten to `SIMULATED`, `gpuProfile` recorded,
  and `notes` set to `requested <LORA|QLORA>; no GPU available → simulated lifecycle only`.
  A clearly-labeled simulated loss curve (`loss = 1.1·e^(−0.35·s) + 0.08`, 6 steps) is written
  to `TrainingMetric` rows with progress 30→70. No weights change.
- **EVALUATING — the gate (§43)**: runs the permanent `core-benchmark` suite
  (`evaluation/runner.ts`) and compares `avgRecall` against the baseline (mean recall of runs
  labeled `baseline*`). Regression if `avgRecall < baseline − config.training.regressionTolerance
  (0.02)` → REJECTED (run FAILS the gate); otherwise CANDIDATE. Summary JSON (passRate, recall,
  baseline, gate PASSED/FAILED) is stored on the run; both outcomes are audited
  (`training.gate_passed` / `training.gate_rejected`).
- **Promotion is EXPLICIT and human-only**: CANDIDATE→CANARY→PRODUCTION via
  `POST /api/training {action:'advance-run', to:…}` (mutation roles only). CANARY creates a
  `ModelDeployment` at `canaryPercent: 10`; PRODUCTION at 100 and deactivates prior CANARY
  deployments. Every step is audited.
- **Rollback (§65)**: `rollback` requires PRODUCTION or CANARY; sets ROLLED_BACK, deactivates
  the candidate's ACTIVE deployments, preserves the previous production model as authoritative.

`start-run` also creates the candidate `ModelVersion` (EXPERIMENTAL/TRAINING status, method,
datasetVersionId, `artifactChecksum: sim-<dataset checksum prefix>`, evaluationVersion
`pending-gate`) so lineage exists even though the artifact is simulated.

## Synthetic data path (§35/§36) — what is real vs. not

Real: source selection (top-quality chunks), example persistence, gate execution, LOCKED
checksums, lineage fields. The teacher-prompted QA *generation* step is only exercised when a
generation provider is called; in the current dataset builder the completion is the grounded
chunk text itself (no LLM call), which is the conservative, fully-grounded variant. Any
LLM-generated synthetic example would additionally require validation and human review before
promotion into training data — the prompt and gates encode this contract.

## What to claim, what not to claim

- ✅ Verified: eligibility registration from feedback, dataset creation with all six gates,
  LOCKED checksums, run state machine with honest auto-degradation, evaluation-gate execution
  against the live benchmark, explicit promotion/rollback with audit trails.
- ❌ Never claim: real fine-tuning, GPU training, weight updates, or a fine-tuned model artifact
  in this environment. `GET /api/system` reports `gpu.available: false` with the simulation note;
  `GET /api/health?deep=1` shows a WARN gpu check; the UI shows an amber SIMULATED LIFECYCLE
  banner. Real training requires attaching a GPU node (§38: A10G/T4 24GB class, detected at run
  validation) — see [DEPLOYMENT.md](DEPLOYMENT.md).
