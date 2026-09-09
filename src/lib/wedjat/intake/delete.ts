// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake source deletion (§108 governance).
//
// Removes an uploaded source AND every entity the pipeline derived from it:
// runs, snapshots, mappings, candidates (+ their training sources/examples and
// reviews), documents/sections/chunks/lexical postings, knowledge records,
// graph edges (by intake run), generation-source lineage rows, and the
// auto-created blueprint/platform when nothing else references them.
//
// Non-destructive side effects are PRESERVED: chat history (conversations,
// messages, generations), audit events, retrieval events and jobs stay as
// operational records — only their lineage links to deleted chunks are removed.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { WedjatError } from '../errors';

export interface SourceDeletionReport {
  sourceId: string;
  sourceName: string;
  runs: number;
  documents: number;
  chunks: number;
  knowledgeRecords: number;
  graphEdges: number;
  trainingCandidates: number;
  trainingExamples: number;
  blueprints: number;
  platforms: number;
}

export async function deleteIntakeSource(
  orgId: string,
  sourceId: string
): Promise<SourceDeletionReport> {
  const source = await db.sourceDatabase.findFirst({ where: { id: sourceId, orgId } });
  if (!source) throw new WedjatError('NOT_FOUND', 'Source database not found');

  // ── 0. Runs of this source (graph edges + job linkage key off them) ────────
  const runs = await db.intakeRun.findMany({
    where: { sourceDatabaseId: sourceId },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);

  // ── 1. Document versions derived from this source's artifact ───────────────
  // The engine stamps DocumentVersion.sourcePath with the source artifact path
  // (…/db/sources/{sourceId}/artifact). Match on the sourceId segment.
  const docVersions = await db.documentVersion.findMany({
    where: { sourcePath: { contains: sourceId } },
    select: { id: true, documentId: true, document: { select: { blueprintVersionId: true } } },
  });
  const docVersionIds = docVersions.map((v) => v.id);
  const documentIds = [...new Set(docVersions.map((v) => v.documentId))];
  const blueprintVersionIdsOfDocs = [
    ...new Set(docVersions.map((v) => v.document.blueprintVersionId)),
  ];

  // ── 2. Chunks + their dependents ───────────────────────────────────────────
  const chunks = docVersionIds.length
    ? await db.documentChunk.findMany({
        where: { documentVersionId: { in: docVersionIds } },
        select: { id: true },
      })
    : [];
  const chunkIds = chunks.map((c) => c.id);

  let generationSources = 0;
  let lexicalTerms = 0;
  let knowledgeRecords = 0;
  if (chunkIds.length) {
    generationSources = await db.generationSource.count({ where: { chunkId: { in: chunkIds } } });
    await db.generationSource.deleteMany({ where: { chunkId: { in: chunkIds } } });
    // Embeddings (semantic index) reference chunks — remove before chunks.
    await db.embeddingRecord.deleteMany({ where: { chunkId: { in: chunkIds } } });
    lexicalTerms = await db.lexicalTerm.count({ where: { chunkId: { in: chunkIds } } });
    await db.lexicalTerm.deleteMany({ where: { chunkId: { in: chunkIds } } });
    // Knowledge records may also attach via blueprint version (§6).
    knowledgeRecords = await db.knowledgeRecord.count({
      where: { OR: [{ chunkId: { in: chunkIds } }, { blueprintVersionId: { in: blueprintVersionIdsOfDocs } }] },
    });
    await db.knowledgeRecord.deleteMany({
      where: { OR: [{ chunkId: { in: chunkIds } }, { blueprintVersionId: { in: blueprintVersionIdsOfDocs } }] },
    });
  }

  // ── 3. Sections, chunks, ingestion events, versions, documents ─────────────
  let sections = 0;
  let chunksDeleted = 0;
  let events = 0;
  if (docVersionIds.length) {
    sections = await db.documentSection.count({ where: { documentVersionId: { in: docVersionIds } } });
    await db.documentSection.deleteMany({ where: { documentVersionId: { in: docVersionIds } } });
    chunksDeleted = await db.documentChunk.deleteMany({
      where: { documentVersionId: { in: docVersionIds } },
    }).then((r) => r.count);
    events = await db.ingestionEvent.count({ where: { documentVersionId: { in: docVersionIds } } });
    await db.ingestionEvent.deleteMany({ where: { documentVersionId: { in: docVersionIds } } });
    await db.documentVersion.deleteMany({ where: { id: { in: docVersionIds } } });
  }

  // Documents: delete only those with no remaining versions (intake-created
  // docs always qualify; manually ingested docs sharing the slug survive).
  let documents = 0;
  for (const docId of documentIds) {
    const remaining = await db.documentVersion.count({ where: { documentId: docId } });
    if (remaining === 0) {
      await db.document.delete({ where: { id: docId } }).catch(() => undefined);
      documents += 1;
    }
  }

  // ── 4. Blueprint versions / blueprints / platform (when orphaned) ──────────
  let blueprints = 0;
  for (const bpvId of blueprintVersionIdsOfDocs) {
    const remainingDocs = await db.document.count({ where: { blueprintVersionId: bpvId } });
    if (remainingDocs > 0) continue;
    const bpv = await db.blueprintVersion.findUnique({
      where: { id: bpvId },
      select: { id: true, blueprintId: true },
    });
    if (!bpv) continue;
    await db.blueprintVersion.delete({ where: { id: bpvId } }).catch(() => undefined);
    const remainingVersions = await db.blueprintVersion.count({
      where: { blueprintId: bpv.blueprintId },
    });
    if (remainingVersions === 0) {
      const blueprint = await db.blueprint.findUnique({
        where: { id: bpv.blueprintId },
        select: { id: true, platformId: true },
      });
      if (blueprint) {
        await db.blueprint.delete({ where: { id: blueprint.id } }).catch(() => undefined);
        blueprints += 1;
      }
    }
  }

  // Platform: only auto-created external-import platforms that now have no
  // blueprints (the spec doc or other sources may still use it).
  let platforms = 0;
  const extPlatforms = await db.platform.findMany({
    where: { orgId, slug: { startsWith: 'ext-' } },
    select: { id: true },
  });
  for (const p of extPlatforms) {
    const remainingBlueprints = await db.blueprint.count({ where: { platformId: p.id } });
    if (remainingBlueprints === 0) {
      await db.platform.delete({ where: { id: p.id } }).catch(() => undefined);
      platforms += 1;
    }
  }

  // ── 5. Training chain: candidates → sources → examples → reviews ───────────
  const candidates = await db.trainingCandidate.findMany({
    where: { sourceDatabaseId: sourceId },
    select: { id: true },
  });
  const candidateIds = candidates.map((c) => c.id);
  let trainingExamples = 0;
  if (candidateIds.length) {
    const trainingSources = await db.trainingSource.findMany({
      where: { orgId, kind: 'INTAKE', refId: { in: candidateIds } },
      select: { id: true },
    });
    const trainingSourceIds = trainingSources.map((t) => t.id);
    if (trainingSourceIds.length) {
      const examples = await db.trainingExample.findMany({
        where: { sourceId: { in: trainingSourceIds } },
        select: { id: true },
      });
      const exampleIds = examples.map((e) => e.id);
      if (exampleIds.length) {
        await db.humanReview.deleteMany({ where: { trainingExampleId: { in: exampleIds } } });
      }
      trainingExamples = await db.trainingExample.deleteMany({
        where: { sourceId: { in: trainingSourceIds } },
      }).then((r) => r.count);
      await db.trainingSource.deleteMany({ where: { id: { in: trainingSourceIds } } });
    }
    await db.trainingCandidate.deleteMany({ where: { sourceDatabaseId: sourceId } });
  }

  // ── 6. Graph edges (by intake run), mappings, snapshots, runs, source ──────
  let graphEdges = 0;
  if (runIds.length) {
    graphEdges = await db.knowledgeGraphEdge.count({ where: { intakeRunId: { in: runIds } } });
    await db.knowledgeGraphEdge.deleteMany({ where: { intakeRunId: { in: runIds } } });
  }
  await db.canonicalMapping.deleteMany({ where: { sourceDatabaseId: sourceId } });
  await db.schemaSnapshot.deleteMany({ where: { sourceDatabaseId: sourceId } });
  await db.intakeRun.deleteMany({ where: { sourceDatabaseId: sourceId } });
  await db.sourceDatabase.delete({ where: { id: sourceId } });

  void sections;
  void chunksDeleted;
  void events;
  void lexicalTerms;
  void generationSources;

  return {
    sourceId,
    sourceName: source.name,
    runs: runIds.length,
    documents,
    chunks: chunkIds.length,
    knowledgeRecords,
    graphEdges,
    trainingCandidates: candidateIds.length,
    trainingExamples,
    blueprints,
    platforms,
  };
}

/**
 * Deletes a knowledge DOCUMENT (manual ingestion path): all its versions with
 * sections, chunks, embeddings, lexical postings, knowledge records and
 * generation-source lineage; then the blueprint version / blueprint / ext-
 * platform when orphaned. Chat history and audit events are preserved.
 */
export async function deleteKnowledgeDocument(
  orgId: string,
  documentId: string
): Promise<{ documentId: string; title: string; chunks: number; knowledgeRecords: number }> {
  const document = await db.document.findFirst({
    where: { id: documentId, blueprintVersion: { blueprint: { platform: { orgId } } } },
    include: { versions: { select: { id: true } } },
  });
  if (!document) throw new WedjatError('NOT_FOUND', 'Document not found');
  const docVersionIds = document.versions.map((v) => v.id);
  const blueprintVersionId = document.blueprintVersionId;

  let chunks = 0;
  let knowledgeRecords = 0;
  if (docVersionIds.length) {
    const chunkRows = await db.documentChunk.findMany({
      where: { documentVersionId: { in: docVersionIds } },
      select: { id: true },
    });
    const chunkIds = chunkRows.map((c) => c.id);
    if (chunkIds.length) {
      await db.generationSource.deleteMany({ where: { chunkId: { in: chunkIds } } });
      await db.embeddingRecord.deleteMany({ where: { chunkId: { in: chunkIds } } });
      await db.lexicalTerm.deleteMany({ where: { chunkId: { in: chunkIds } } });
      knowledgeRecords = await db.knowledgeRecord.count({
        where: { OR: [{ chunkId: { in: chunkIds } }, { blueprintVersionId }] },
      });
      await db.knowledgeRecord.deleteMany({
        where: { OR: [{ chunkId: { in: chunkIds } }, { blueprintVersionId }] },
      });
      chunks = chunkIds.length;
    }
    await db.documentSection.deleteMany({ where: { documentVersionId: { in: docVersionIds } } });
    await db.ingestionEvent.deleteMany({ where: { documentVersionId: { in: docVersionIds } } });
    await db.documentChunk.deleteMany({ where: { documentVersionId: { in: docVersionIds } } });
    await db.documentVersion.deleteMany({ where: { id: { in: docVersionIds } } });
  }
  await db.document.delete({ where: { id: documentId } });

  // Blueprint version → blueprint → ext-platform cleanup when orphaned.
  const remainingDocs = await db.document.count({ where: { blueprintVersionId } });
  if (remainingDocs === 0) {
    const bpv = await db.blueprintVersion.findUnique({
      where: { id: blueprintVersionId },
      select: { id: true, blueprintId: true },
    });
    if (bpv) {
      await db.blueprintVersion.delete({ where: { id: bpv.id } }).catch(() => undefined);
      const remainingVersions = await db.blueprintVersion.count({
        where: { blueprintId: bpv.blueprintId },
      });
      if (remainingVersions === 0) {
        const blueprint = await db.blueprint.findUnique({
          where: { id: bpv.blueprintId },
          select: { id: true, platformId: true },
        });
        if (blueprint) {
          await db.blueprint.delete({ where: { id: blueprint.id } }).catch(() => undefined);
          const remainingBlueprints = await db.blueprint.count({
            where: { platformId: blueprint.platformId },
          });
          const platform = await db.platform.findUnique({
            where: { id: blueprint.platformId },
            select: { slug: true },
          });
          if (remainingBlueprints === 0 && platform?.slug.startsWith('ext-')) {
            await db.platform.delete({ where: { id: blueprint.platformId } }).catch(() => undefined);
          }
        }
      }
    }
  }

  return { documentId, title: document.title, chunks, knowledgeRecords };
}
