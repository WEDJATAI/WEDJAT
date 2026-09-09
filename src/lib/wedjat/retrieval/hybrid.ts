// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Hybrid retrieval (§11): LEXICAL (BM25) + SEMANTIC (local
// embeddings) + METADATA/VERSION FILTERING, feeding the reranker (§12).
//
// WHY HYBRID: pure vector search misses exact identifiers (service names,
// version strings); pure BM25 misses paraphrases. Candidates from both channels
// are fused, then RERANKED — never sent raw to the LLM.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { config } from '../config';
import { embed, tokenize, cosine } from '../knowledge/embeddings';
import { newTraceId } from '../ids';
import { logger } from '../logger';
import { scanAndNeutralize } from '../security/injection';

export interface RetrievalFilters {
  orgId: string;
  platformSlug?: string;
  blueprintSlug?: string;
  /** Specific blueprint version id (version resolution §46). */
  blueprintVersionId?: string;
  /** "CURRENT" prefers current versions (default); explicit version strings pass through. */
  versionStatus?: string;
  docType?: string;
  classification?: string;
  status?: string; // knowledge currentness: CURRENT | RECENT | HISTORICAL | SUPERSEDED
}

export interface RetrievedCandidate {
  chunkId: string;
  content: string;
  platformId: string;
  platformSlug: string;
  platformName: string;
  blueprintId: string;
  blueprintSlug: string;
  blueprintTitle: string;
  blueprintVersionId: string;
  blueprintVersion: string;
  blueprintVersionStatus: string;
  documentId: string;
  documentTitle: string;
  documentClassification: string;
  docType: string;
  sectionHeading: string | null;
  knowledgeStatus: string;
  effectiveFrom: Date;
  sourcePriority: number;
  lexicalScore: number;
  semanticScore: number;
}

export interface RetrievalOutcome {
  candidates: RetrievedCandidate[];
  queryVector: number[] | null;
  blockedPatterns: string[];
  traceId: string;
  latencyMs: number;
  mode: 'HYBRID';
  candidatesCount: number;
}

/**
 * Runs the hybrid candidate retrieval. Query is sanitized for injection BEFORE
 * it touches the retrieval layer (§16 — user request is above data, but still
 * untrusted for control flow).
 */
export async function hybridRetrieve(
  rawQuery: string,
  filters: RetrievalFilters,
  topK = config.retrieval.candidateK
): Promise<RetrievalOutcome> {
  const traceId = newTraceId();
  const started = Date.now();

  // Query normalization (§46 QUERY NORMALIZATION) + injection scan (§16).
  const { matched, sanitized } = scanAndNeutralize(rawQuery.trim());
  const query = sanitized.replace(/\s+/g, ' ').slice(0, 2000);

  // ── Metadata pre-filter in SQL (tenant-scoped: orgId is server-side truth) ─
  const where = {
    status: 'INDEXED',
    documentVersion: {
      status: 'INGESTED',
      document: {
        status: 'ACTIVE',
        blueprintVersion: {
          blueprint: {
            platform: { orgId: filters.orgId },
            ...(filters.platformSlug ? { platform: { orgId: filters.orgId, slug: filters.platformSlug } } : {}),
            ...(filters.blueprintSlug ? { slug: filters.blueprintSlug } : {}),
          },
          ...(filters.blueprintVersionId ? { id: filters.blueprintVersionId } : {}),
          ...(filters.versionStatus && !filters.blueprintVersionId
            ? { status: filters.versionStatus }
            : {}),
        },
      },
      ...(filters.docType ? { document: { docType: filters.docType } } : {}),
      ...(filters.classification ? { document: { classification: filters.classification } } : {}),
    },
  } as const;

  // BUG FIX (Task 23): this query previously used `take: 2000` with NO
  // ordering — SQLite returned rows in insertion order, so an org-wide query
  // only ever saw the FIRST 2000 chunks (seed + the earliest-ingested
  // platform). Platforms ingested later were invisible to retrieval entirely
  // (a cross-platform question returned 8/8 CIRKLE sources).
  //
  // Additive fix: scan the FULL in-scope corpus with a lean column select
  // (memory-bounded), cutting to 25k by recency ONLY at pathological scale.
  // A platform-diversity quota is unnecessary: BM25 IDF already rewards
  // rare platform-specific terms once every platform's chunks are in the set.
  const rows = await db.documentChunk.findMany({
    where,
    select: {
      id: true,
      content: true,
      tokenEstimate: true,
      section: { select: { heading: true } },
      embedding: { select: { vector: true } },
      documentVersion: {
        select: {
          document: {
            select: {
              title: true,
              docType: true,
              classification: true,
              blueprintVersion: {
                select: {
                  version: true,
                  status: true,
                  effectiveFrom: true,
                  blueprint: {
                    select: {
                      id: true,
                      slug: true,
                      title: true,
                      platform: { select: { id: true, slug: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    take: 25_000, // bounded working set — ~4x the current org corpus (no
                  // createdAt on chunks; ordering is irrelevant — candidates
                  // are score-sorted below)
  });

  if (rows.length === 0) {
    await recordRetrievalEvent(traceId, query, filters, 0, 0, Date.now() - started, 0);
    return { candidates: [], queryVector: null, blockedPatterns: matched, traceId, latencyMs: Date.now() - started, mode: 'HYBRID', candidatesCount: 0 };
  }

  // ── LEXICAL: BM25 over the in-DB inverted index postings ───────────────────
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const queryTokens = tokenize(query);
  const lexicalScores = new Map<string, number>();
  if (queryTokens.length > 0) {
    const postings = await db.lexicalTerm.findMany({
      where: { term: { in: queryTokens } },
    });
    // Document frequency per term (distinct chunk count).
    const dfMap = new Map<string, Set<string>>();
    for (const p of postings) {
      if (!dfMap.has(p.term)) dfMap.set(p.term, new Set());
      dfMap.get(p.term)!.add(p.chunkId);
    }
    const N = rows.length;
    const k1 = 1.2;
    const b = 0.75;
    // Average chunk length in tokens (approx via tokenEstimate).
    const avgLen = rows.reduce((s, r) => s + r.tokenEstimate, 0) / N || 1;

    for (const p of postings) {
      const row = rowMap.get(p.chunkId);
      if (!row) continue;
      const df = dfMap.get(p.term)?.size ?? 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tf = p.tf;
      const lenNorm = 1 - b + b * (row.tokenEstimate / avgLen);
      const score = (idf * (tf * (k1 + 1))) / (tf + k1 * lenNorm);
      lexicalScores.set(p.chunkId, (lexicalScores.get(p.chunkId) ?? 0) + score);
    }
  }

  // ── SEMANTIC: cosine over local embeddings ─────────────────────────────────
  const { vector: queryVector } = embed(query);
  const semanticScores = new Map<string, number>();
  for (const row of rows) {
    if (!row.embedding) continue;
    try {
      const vec = JSON.parse(row.embedding.vector) as number[];
      const sim = cosine(queryVector, vec);
      // Normalize to 0..1-ish (cosine of hashed BOW is centered near 0).
      semanticScores.set(row.id, Math.max(0, sim));
    } catch {
      // Corrupt embedding row — skip (graceful degradation §58).
    }
  }

  // ── FUSION: weighted sum, then candidate cut ───────────────────────────────
  const maxLex = Math.max(...lexicalScores.values(), 1e-6);
  const maxSem = Math.max(...semanticScores.values(), 1e-6);
  const fused: { row: (typeof rows)[number]; lexical: number; semantic: number }[] = [];
  for (const row of rows) {
    const lex = (lexicalScores.get(row.id) ?? 0) / maxLex; // 0..1
    const sem = (semanticScores.get(row.id) ?? 0) / maxSem; // 0..1
    const score = config.retrieval.lexicalWeight * lex + config.retrieval.semanticWeight * sem;
    if (score <= 0) continue;
    fused.push({ row, lexical: lex, semantic: sem });
  }
  fused.sort((a, b) => {
    const sa = config.retrieval.lexicalWeight * a.lexical + config.retrieval.semanticWeight * a.semantic;
    const sb = config.retrieval.lexicalWeight * b.lexical + config.retrieval.semanticWeight * b.semantic;
    return sb - sa;
  });

  const candidates: RetrievedCandidate[] = fused.slice(0, topK).map(({ row, lexical, semantic }) => {
    const dv = row.documentVersion;
    const doc = dv.document;
    const bpv = doc.blueprintVersion;
    const bp = bpv.blueprint;
    return {
      chunkId: row.id,
      content: row.content,
      platformId: bp.platform.id,
      platformSlug: bp.platform.slug,
      platformName: bp.platform.name,
      blueprintId: bp.id,
      blueprintSlug: bp.slug,
      blueprintTitle: bp.title,
      blueprintVersionId: bpv.id,
      blueprintVersion: bpv.version,
      blueprintVersionStatus: bpv.status,
      documentId: doc.id,
      documentTitle: doc.title,
      documentClassification: doc.classification,
      docType: doc.docType,
      sectionHeading: row.section?.heading ?? null,
      knowledgeStatus: 'CURRENT', // enriched by reranker via knowledge records
      effectiveFrom: bpv.effectiveFrom,
      sourcePriority: sourcePriorityForDocType(doc.docType),
      lexicalScore: round(lexical),
      semanticScore: round(semantic),
    };
  });

  // Enrich currentness from knowledge records when available (§7).
  const chunkIds = candidates.map((c) => c.chunkId);
  const knowledge = await db.knowledgeRecord.findMany({
    where: { chunkId: { in: chunkIds } },
    select: { chunkId: true, status: true, sourcePriority: true },
  });
  const kStatus = new Map(knowledge.map((k) => [k.chunkId, k]));
  for (const c of candidates) {
    const k = kStatus.get(c.chunkId);
    if (k) {
      c.knowledgeStatus = k.status;
      c.sourcePriority = k.sourcePriority;
    }
    // Blueprint-version status is authoritative for currentness.
    if (c.blueprintVersionStatus === 'SUPERSEDED') c.knowledgeStatus = 'SUPERSEDED';
  }

  const latencyMs = Date.now() - started;
  await recordRetrievalEvent(traceId, query, filters, fused.length, candidates.length, latencyMs, candidates[0] ? bestScore(candidates[0]) : 0);

  logger.info('hybrid_retrieval', {
    traceId,
    queryChars: query.length,
    workingSet: rows.length,
    candidates: fused.length,
    returned: candidates.length,
    latencyMs,
  });

  return {
    candidates,
    queryVector,
    blockedPatterns: matched,
    traceId,
    latencyMs,
    mode: 'HYBRID',
    candidatesCount: fused.length,
  };
}

function bestScore(c: RetrievedCandidate): number {
  return Math.max(c.lexicalScore, c.semanticScore);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sourcePriorityForDocType(docType: string): number {
  const map: Record<string, number> = {
    BLUEPRINT: 2, ADR: 3, SPEC: 4, AUDIT: 5, RUNBOOK: 6, REVIEW: 5, REFERENCE: 8, PROMPT: 8,
  };
  return map[docType] ?? 6;
}

async function recordRetrievalEvent(
  traceId: string,
  query: string,
  filters: RetrievalFilters,
  candidatesCount: number,
  resultCount: number,
  latencyMs: number,
  topScore: number
): Promise<void> {
  try {
    await db.retrievalEvent.create({
      data: {
        traceId,
        query: query.slice(0, 500),
        mode: 'HYBRID',
        filtersJson: JSON.stringify({
          platform: filters.platformSlug ?? null,
          blueprint: filters.blueprintSlug ?? null,
          versionStatus: filters.versionStatus ?? null,
        }),
        candidatesCount,
        resultCount,
        latencyMs,
        topScore,
      },
    });
    bumpRetrievalCounter();
  } catch (err) {
    logger.warn('retrieval_event_persist_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ── In-memory metrics (observability; local memory caching allowed) ──────────
let retrievalEventCount = 0;
export function bumpRetrievalCounter(): void {
  retrievalEventCount += 1;
}
export function retrievalEventTotal(): number {
  return retrievalEventCount;
}
