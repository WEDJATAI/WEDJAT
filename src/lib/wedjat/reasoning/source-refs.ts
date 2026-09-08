// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Shared DTO mappers (RerankedCandidate → SourceRef).
// ═══════════════════════════════════════════════════════════════════════════════

import type { RerankedCandidate } from '../retrieval/reranker';
import type { SourceRef } from '../types';

export function toSourceRefs(candidates: RerankedCandidate[]): SourceRef[] {
  return candidates.map((c) => ({
    rank: c.rank,
    chunkId: c.chunkId,
    platformName: c.platformName,
    platformSlug: c.platformSlug,
    blueprintTitle: c.blueprintTitle,
    blueprintSlug: c.blueprintSlug,
    blueprintVersion: c.blueprintVersion,
    blueprintVersionStatus: c.blueprintVersionStatus,
    documentTitle: c.documentTitle,
    sectionHeading: c.sectionHeading ?? '—',
    status: c.knowledgeStatus,
    effectiveFrom: c.effectiveFrom.toISOString(),
    content: c.content.length > 700 ? `${c.content.slice(0, 700)}…` : c.content,
    lexicalScore: c.lexicalScore,
    semanticScore: c.semanticScore,
    rerankScore: c.rerankScore,
    sourcePriority: c.sourcePriority,
  }));
}
