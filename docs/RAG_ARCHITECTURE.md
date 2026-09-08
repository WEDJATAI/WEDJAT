# WEDJAT DOMAIN AI — RAG Architecture

This document describes the retrieval-augmented generation path: the §46 answer pipeline, hybrid
candidate retrieval (§11), the feature-fusion reranker (§12), context assembly with fenced
evidence and §13 metadata (§13/§16), the grounding check (§14), confidence derivation (§79),
and the two-layer hallucination control (§15). All behavior is grounded in
`src/lib/wedjat/reasoning/answer.ts`, `src/lib/wedjat/retrieval/{hybrid,reranker,context}.ts`,
and `src/lib/wedjat/config.ts`.

## Answer pipeline (§46) — `reasoning/answer.ts:runChatPipeline`

```
USER QUERY → AUTHZ (withPrincipal) → QUERY NORMALIZATION (trim, 2000-char cap,
injection scan §16) → INTENT CLASSIFICATION (7 intents: CTO_SUMMARY, RESILIENCE,
CONTRADICTION, COMPARE, CROSS_PLATFORM, KNOWLEDGE_QUERY, GENERAL) → BLUEPRINT
RESOLUTION (EXPLICIT scope from UI, else AUTO name-matching, else UNRESOLVED) →
VERSION RESOLUTION (explicit version or current) → QUERY EXPANSION (domain synonyms:
db→database, cache→redis…, queue→kafka…, auth→…, sla→slo…) → HYBRID RETRIEVAL →
RERANKING → CONTEXT ASSEMBLY → MODEL ROUTER → LLM → OUTPUT VALIDATION (§81) →
GROUNDING CHECK (§14) → RESPONSE (+ lineage persistence §31)
```

Analysis workflows (`reasoning/workflows.ts`) reuse the identical stage set with five
structured modes (§47 resilience 14-step, §48 CTO 16-section, §49 contradictions, §50 compare,
§52 cross-platform). CTO summaries retrieve ALL indexed chunks of the target blueprint version
(coverage over similarity, 11 000-token context budget); contradictions retrieve across ALL
version statuses including SUPERSEDED; compare retrieves both version id sets explicitly.

## Hybrid retrieval (§11) — `retrieval/hybrid.ts`

- **Metadata pre-filter in SQL**: `orgId` (server-side truth, §53) plus optional
  platform/blueprint/blueprintVersionId/versionStatus/docType/classification filters over
  `DocumentChunk.status = 'INDEXED'` with bounded working set (take 2000).
- **Lexical**: BM25 (k1 = 1.2, b = 0.75) over the `LexicalTerm` inverted-index postings built at
  ingestion (tf stored as `1 + ln(count)`), query tokens from `knowledge/embeddings.ts:tokenize`
  (lowercase, stopword strip, light suffix stemmer).
- **Semantic**: cosine similarity between the local query embedding and the stored
  `EmbeddingRecord` vectors — the in-process `wedjat-local-embed-v1` hashed bag-of-unigrams+bigrams
  projection to a fixed 256-d space, sublinear TF, FNV-1a hashing with sign trick, L2-normalized;
  deterministic, so the same text always yields the same vector (§18 local role, §17 LOCAL_ONLY
  policy — proprietary text never leaves for indexing).
- **Fusion**: per-channel max-normalization, weighted sum `lexicalWeight 0.5 + semanticWeight 0.5`,
  cut to `candidateK = 24` candidates. Retrieval is logged as a `RetrievalEvent` row
  (query 500-char cap, filters, counts, latency, top score).

## Reranker (§12) — `retrieval/reranker.ts`

First-N vector results are never sent raw to the LLM. Every candidate gets a logistic-fusion
score `1/(1+e^−(z·4−2.2))` over six features with weights from `config.retrieval.rerankWeights`:

| Feature | Weight | Source |
|---|---|---|
| lexical | 0.30 | normalized BM25 score |
| semantic | 0.30 | normalized cosine |
| coverage | 0.15 | fraction of query tokens present in the chunk |
| heading | 0.10 | section heading matches a query term |
| priority | 0.10 | source priority (§6: BLUEPRINT 2 … REFERENCE/PROMPT 8 → weight (10−p)/9) |
| freshness | 0.05 | knowledge status CURRENT 1.0 / RECENT 0.8 / HISTORICAL 0.4 / SUPERSEDED 0.15 (§7) |

Top `topK = 8` become ranked `[S1..Sn]` sources. `sourceAgreement()` counts corroborating
documents (score > 0.45) for the confidence signal: 1 doc → 0.4, saturating at 0.9.

## Context assembly (§13) — `retrieval/context.ts:assembleContext`

Budget-bounded (9000 tokens default, 11 000 for CTO summaries). Each evidence block is FENCED
(`security/injection.ts:fenceEvidence`):

```
<<<EVIDENCE-S3 PLATFORM: WEDJAT Core Platform | BLUEPRINT: Core Platform Architecture |
VERSION: 2.0 | DOCUMENT: core platform blueprint v2 | SECTION: Technology Stack |
SOURCE STATUS: CURRENT (CURRENT blueprint) | EFFECTIVE: 2026-09-08 | DOC TYPE: BLUEPRINT |
SOURCE PRIORITY: 2>>>
…chunk text (inner ``` and <<<EVIDENCE broken with zero-width chars)…
<<<END-EVIDENCE-S3>>>
```

Metadata headers are the §13 contract; the system prompt declares fence content UNTRUSTED DATA.

## Grounding check (§14) — `context.ts:groundingCheck`

Heuristic groundedness = fraction of the answer's content vocabulary covered by cited evidence
× 0.9, plus a citation bonus (+0.1 if `[Sn]` markers present, −0.1 otherwise), clamped to 0..1.
Answers drifting off-evidence score low → LOW confidence + warning flag
(`low-groundedness: answer drifts from evidence` when < 0.25), never silent fabrication.

## Confidence derivation (§79) — `context.ts:deriveConfidence`

Never a fabricated score. Composite `top rerank score × 0.45 + source agreement × 0.20 +
groundedness × 0.25 + % CURRENT sources × 0.10`, clamped 0..1; levels HIGH ≥ 0.62,
MEDIUM ≥ 0.38, LOW below. Every response lists its signals: top rerank score, score margin,
source agreement across N documents, groundedness, % current sources — displayed as a tooltip
in the chat UI.

## Hallucination control (§15) — two layers

1. **Retrieval gate before the LLM is ever called**: if no reranked candidate reaches
   `config.retrieval.minRerankScore = 0.18`, the pipeline returns an explicit "Insufficient
   evidence in the available blueprint material" response with what information would be
   required (missing-scope hints), `insufficientEvidence: true`, provider `none` /
   model `retrieval-gate`, and persists the generation with status INSUFFICIENT_EVIDENCE.
2. **Model-refusal detection**: if the model itself follows the prompt contract and returns an
   "Insufficient evidence" section despite passing the gate, the response honors it
   (regex `/^#*\s*insufficient evidence/i`, belt-and-suspenders).

## Prompt-injection defense (§16, §81) — `security/injection.ts`

`scanAndNeutralize()` runs on user queries and uploads BEFORE retrieval: 8 patterns
(ignore-previous, reveal-system-prompt, role-override, execute-command, exfiltrate-secrets,
disregard-policy, new-instructions, developer-mode); matched segments are replaced with
`[untrusted-instruction-removed]` and pattern names are returned to the UI as `blockedPatterns`.
Retrieved chunks are fenced as untrusted data (above); nested fences are defused with zero-width
characters. After generation, `validateOutput()` scans model output for system-prompt and secret
leakage and sanitizes matches before the user sees them (§81).

## Verified behavior

End-to-end chat and the five analysis workflows run through this stack against the sanctioned
internal gateway (see dev.log: e.g. `router_decision task=deep_analysis` → `POST /api/analyze
200`). The full-pipeline evaluation run (see [EVALUATION.md](EVALUATION.md)) exercises grounded
chat cases with groundedness scoring. Embeddings/reranking are local and deterministic; remote
generation is exercised only through the internal gateway in this environment.
