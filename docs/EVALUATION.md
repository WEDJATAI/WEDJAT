# WEDJAT DOMAIN AI — Evaluation

This document describes the permanent benchmark (§42), its metrics and pass criteria, the
recorded baseline and full-suite results with honest failure analysis, regression gates and
evaluation memory (§73). Code: `src/lib/wedjat/evaluation/runner.ts`; suite seeded in
`scripts/seed.ts`; results in the `EvaluationResult` table; run via the Evaluations view
(`POST /api/evaluations {action:'run', suiteId, label?}`) or as a job.

## Core-benchmark suite

`slug: core-benchmark` (version 1) — 14 cases: **12 retrieval cases** (deterministic — exercise
hybrid retrieval + reranking only) and **2 grounded-chat cases** (`llmJudged: true` — run the
FULL chat pipeline through the AI gateway so groundedness and citation behavior are measured
end-to-end). Cases cover the four platforms: database/broker/cache questions for the Core
Platform v2.0, ClickHouse speed layer (Analytics), Cloudflare Workers runtime (Mobile Gateway),
shared-services dependencies, ADR-004 failover rationale, security-audit unresolved items,
cross-platform SPOFs, PITR restore testing, and two LLM-judged questions (resiliency
improvement, production blockers).

## Metrics & pass criteria

| Metric | Retrieval case | LLM-judged case |
|---|---|---|
| recall@k | in-scope retrieved (expected platform/blueprint) / expectedSourcesMin, capped at 1 | sources count / expectedSourcesMin, capped at 1 |
| precision@k | in-scope fraction of top-8 | recorded as groundedness (honest proxy — see notes) |
| keyword coverage | expected keywords present in retrieved text (tokenized match) | keywords present in the answer |
| groundedness | — (null) | chat-pipeline grounding check (§14) |
| latency | per-case wall time | per-case wall time |
| pass | recall ≥ 0.5 AND precision ≥ 0.4 AND keywords ≥ 0.4 AND latency < 5000 ms | not insufficient-evidence AND groundedness ≥ 0.3 AND sources ≥ min AND keywords ≥ 0.3 |

Summary per run: passRate, avgRecall, avgPrecision, avgGroundedness (LLM cases only),
avgLatencyMs, caseCount. Every result row is persisted with `runLabel` — results are historical
and comparable across runs (§73).

## Recorded results

| Run | Cases | passRate | avgRecall | avgPrecision | avgGroundedness | avgLatency |
|---|---|---|---|---|---|---|
| `baseline-seed` (retrieval-only, at seed, §101) | 12 | **0.917** | **0.917** | **0.917** | — | ~10 ms |
| `full-check-1` (all 14 cases incl. 2 grounded-chat) | 14 | **0.714** | **0.929** | **0.876** | **0.635** | 517 ms |

The baseline is deterministic and fast (no LLM calls at seed time — §101 requires no
fine-tuning and an LLM-free baseline). The full run's latency is dominated by the two
grounded-chat cases through the internal inference gateway (single LLM round-trips of several
hundred ms–seconds each; deep-analysis requests in normal use run 10–30 s).

## Honest failure analysis

- **Baseline miss (1/12)**: "Which services are shared across platforms according to the
  catalog?" scored recall 0 / keywords 0 — no shared-services catalog chunks made the top set.
  Likely cause: the query's phrasing ("services … shared … catalog") has weak lexical overlap
  with the catalog's document text (headings like "Identity Service", consumer lists), and the
  hashed 256-d embedder does not capture the "shared across platforms" paraphrase. Candidate
  improvement paths: broaden the synonym expansion table, or raise candidateK above 24.
- **Keyword-coverage strictness**: two passing baseline cases scored coverage 0.5 — exactly one
  of their two expected keywords matched (the `postgresql`/`database` pair and the
  `session`/`validation` pair). The metric is strict tokenized matching, not semantic — treat
  0.4–0.6 as partial, not failure.
- **Full-run passRate 0.714**: 4 of 14 cases failed. Recall stayed high (0.929), so the
  failures sit in the pass criteria (avg groundedness 0.635 vs. the 0.3 threshold on LLM-judged
  cases; strict keyword matching) rather than in retrieval. Per-case rows for every run are
  persisted by `runLabel` and inspectable in the Evaluations view.
- **precision@k on LLM cases** is recorded from the grounding score rather than a true relevance
  judgment — an honest proxy, not a claim of human-graded precision.

## Regression gates & memory (§43, §73)

- Training-run gate: at EVALUATING, `training/lifecycle.ts` runs this suite and compares
  avgRecall to the baseline (mean recall of `baseline*` runs). Regression if
  `avgRecall < baseline − 0.02` (`config.training.regressionTolerance`) → run REJECTED.
- Evaluation memory: all runs persist; `latestRunSummaries()` recomputes the newest run per
  suite for the dashboard; the Evaluations view groups results by `runLabel` with per-case bars.
- Any change to prompts (§74), retrieval weights, chunking, embedder, reranker, or datasets
  should re-run this suite before promotion — that is the stated workflow of the master prompt
  §43; nothing auto-promotes on eval results.
