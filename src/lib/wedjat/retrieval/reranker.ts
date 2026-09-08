// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Reranker (§12). Local heuristic cross-encoder substitute
// (the "Hugging Face reranker" role) fusing: lexical score, semantic score,
// query-term coverage, section-heading match, source priority (§6), freshness
// (§7). The first N vector results are NEVER sent directly to the LLM.
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';
import { tokenize } from '../knowledge/embeddings';
import type { RetrievedCandidate } from './hybrid';

export interface RerankedCandidate extends RetrievedCandidate {
  rank: number;
  rerankScore: number; // 0..1
  coverage: number; // fraction of query terms present in chunk
  headingMatch: boolean;
  freshnessWeight: number;
  priorityWeight: number;
}

const FRESHNESS_WEIGHT: Record<string, number> = {
  CURRENT: 1.0,
  RECENT: 0.8,
  HISTORICAL: 0.4,
  SUPERSEDED: 0.15,
  UNKNOWN: 0.5,
};

/** Priority 1..9 → weight: lower number = more authoritative (§6). */
function priorityWeight(priority: number): number {
  return Math.max(0, (10 - priority) / 9);
}

export function rerank(
  query: string,
  candidates: RetrievedCandidate[],
  topK = config.retrieval.topK
): RerankedCandidate[] {
  const w = config.retrieval.rerankWeights;
  const queryTokens = new Set(tokenize(query));

  const scored = candidates.map((c) => {
    const chunkTokens = tokenize(`${c.content} ${c.sectionHeading ?? ''}`);
    const coverage = queryTokens.size > 0
      ? [...queryTokens].filter((t) => chunkTokens.includes(t)).length / queryTokens.size
      : 0;
    const headingMatch = Boolean(
      c.sectionHeading &&
        [...queryTokens].some((t) => c.sectionHeading!.toLowerCase().includes(t))
    );
    const freshness = FRESHNESS_WEIGHT[c.knowledgeStatus] ?? 0.5;
    const priority = priorityWeight(c.sourcePriority);

    // Logistic fusion → 0..1.
    const z =
      w.lexical * c.lexicalScore +
      w.semantic * c.semanticScore +
      w.coverage * coverage +
      w.heading * (headingMatch ? 1 : 0) +
      w.priority * priority +
      w.freshness * freshness;
    const rerankScore = 1 / (1 + Math.exp(-(z * 4 - 2.2))); // centered calibration

    return {
      ...c,
      rerankScore: Math.round(rerankScore * 1000) / 1000,
      coverage: Math.round(coverage * 100) / 100,
      headingMatch,
      freshnessWeight: freshness,
      priorityWeight: Math.round(priority * 100) / 100,
      rank: 0,
    };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored.slice(0, topK).map((c, i) => ({ ...c, rank: i + 1 }));
}

export const RERANKER_MODEL = config.retrieval.rerankerModel;

/**
 * Source agreement (§79 confidence signal): do independent documents corroborate?
 * Two chunks from DIFFERENT documents with substantive scores count as corroboration.
 */
export function sourceAgreement(candidates: RerankedCandidate[]): number {
  const strong = candidates.filter((c) => c.rerankScore > 0.45);
  const docs = new Set(strong.map((c) => c.documentId));
  if (docs.size <= 1) return strong.length > 0 ? 0.4 : 0.1;
  // 2 docs → 0.7, 3+ → 0.9, saturating.
  return Math.min(0.9, 0.4 + docs.size * 0.15);
}
