// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Context assembly (§13) + grounding check (§14, §15, §45).
//
// Context blocks carry STRUCTURED SOURCE METADATA (platform/blueprint/version/
// document/section/status/effective date) — never raw text alone. Retrieved
// content is FENCED as untrusted evidence (§16). Post-generation grounding
// verifies the answer is supported before the user ever sees it.
// ═══════════════════════════════════════════════════════════════════════════════

import type { RerankedCandidate } from './reranker';
import { fenceEvidence } from '../security/injection';
import { tokenize } from '../knowledge/embeddings';

export interface AssembledContext {
  evidenceBlocks: string[];
  usedCandidates: RerankedCandidate[];
  tokenEstimate: number;
}

/**
 * Assembles evidence blocks [S1..Sn] with metadata headers per §13.
 */
export function assembleContext(candidates: RerankedCandidate[], maxTokens = 9000): AssembledContext {
  const evidenceBlocks: string[] = [];
  const used: RerankedCandidate[] = [];
  let tokens = 0;

  for (const c of candidates) {
    const meta = `PLATFORM: ${c.platformName} | BLUEPRINT: ${c.blueprintTitle} | VERSION: ${c.blueprintVersion} | DOCUMENT: ${c.documentTitle} | SECTION: ${c.sectionHeading ?? '—'} | SOURCE STATUS: ${c.knowledgeStatus} (${c.blueprintVersionStatus} blueprint) | EFFECTIVE: ${c.effectiveFrom.toISOString().slice(0, 10)} | DOC TYPE: ${c.docType} | SOURCE PRIORITY: ${c.sourcePriority}`;
    const block = fenceEvidence(c.rank, meta, c.content);
    const blockTokens = Math.ceil(block.length / 4);
    if (tokens + blockTokens > maxTokens) break; // budget-bounded context
    evidenceBlocks.push(block);
    used.push(c);
    tokens += blockTokens;
  }

  return { evidenceBlocks, usedCandidates: used, tokenEstimate: tokens };
}

// ── Grounding check (§14/§15/§45) ─────────────────────────────────────────────

/**
 * Heuristic groundedness: measures how much of the answer's content vocabulary
 * is covered by the cited evidence. Answers drifting off-evidence score low,
 * triggering a LOW confidence label + warning (§79), never silent fabrication.
 */
export function groundingCheck(answer: string, sources: RerankedCandidate[]): { groundedness: number } {
  const answerTokens = new Set(tokenize(answer));
  if (answerTokens.size === 0) return { groundedness: 0 };
  const evidenceText = sources.map((s) => s.content).join(' ');
  const evidenceTokens = new Set(tokenize(evidenceText));

  let covered = 0;
  for (const t of answerTokens) {
    if (evidenceTokens.has(t)) covered += 1;
  }
  const coverage = covered / answerTokens.size;

  // Citation markers [S1]..[Sn] present?
  const citations = (answer.match(/\[S\d+\]/g) ?? []).length;
  const citationBonus = citations > 0 ? 0.1 : -0.1;

  const groundedness = Math.max(0, Math.min(1, coverage * 0.9 + citationBonus));
  return { groundedness: Math.round(groundedness * 100) / 100 };
}

/**
 * Confidence derivation (§79): NEVER a fake score. Signals: retrieval quality
 * (top rerank score + margin), source agreement, freshness, groundedness.
 */
export function deriveConfidence(
  sources: RerankedCandidate[],
  groundedness: number,
  sourceAgreementScore: number
): { level: 'HIGH' | 'MEDIUM' | 'LOW'; score: number; signals: string[] } {
  if (sources.length === 0) {
    return { level: 'LOW', score: 0, signals: ['no evidence retrieved'] };
  }
  const signals: string[] = [];
  const top = sources[0].rerankScore;
  const margin = sources.length > 1 ? top - sources[1].rerankScore : 0.1;
  signals.push(`top rerank score ${top.toFixed(2)}`);
  signals.push(`score margin ${margin.toFixed(2)}`);
  signals.push(`source agreement ${sourceAgreementScore.toFixed(2)} across ${new Set(sources.map((s) => s.documentId)).size} document(s)`);
  signals.push(`groundedness ${groundedness.toFixed(2)}`);
  const fresh = sources.filter((s) => s.knowledgeStatus === 'CURRENT').length / sources.length;
  signals.push(`${Math.round(fresh * 100)}% current sources`);

  // Composite (bounded, explainable).
  const score = Math.max(
    0,
    Math.min(1, top * 0.45 + sourceAgreementScore * 0.2 + groundedness * 0.25 + fresh * 0.1)
  );
  const level = score >= 0.62 ? 'HIGH' : score >= 0.38 ? 'MEDIUM' : 'LOW';
  return { level, score: Math.round(score * 100) / 100, signals };
}
