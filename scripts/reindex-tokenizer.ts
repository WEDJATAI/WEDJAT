// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 23 — Tokenizer-v2 corpus re-index (LOCAL maintenance script).
//
// WHY: the retrieval tokenizer was upgraded (Arabic support + identifier
// splitting, see src/lib/wedjat/knowledge/embeddings.ts). Chunks indexed
// BEFORE the upgrade carry postings/embeddings built with the old tokenizer:
//   • Arabic chunks (JUDGE SMART legal corpus) had ZERO tokens → invisible.
//   • Identifier-heavy code chunks ('MTQSigma') were unmatchable by prose.
//
// This script re-indexes EVERY INDEXED chunk with the current tokenizer:
// postings (delete + recreate), embeddings (delete + re-embed), missing
// knowledge atoms, and a full IDF rebuild. Idempotent: re-running converges.
//
// Usage:
//   bun scripts/reindex-tokenizer.ts            (local SQLite via DATABASE_URL)
//   bun scripts/reindex-tokenizer.ts --batch 200
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { embed, rebuildIdf, tokenize } from '@/lib/wedjat/knowledge/embeddings';
import { extractKnowledgeAtoms } from '@/lib/wedjat/knowledge/quality';
import { sourcePriorityFor } from '@/lib/wedjat/knowledge/ingestion';
import { config } from '@/lib/wedjat/config';
import { logger } from '@/lib/wedjat/logger';

const BATCH = Number(process.argv[process.argv.indexOf('--batch') + 1] ?? 500) || 500;

async function main(): Promise<void> {
  const total = await db.documentChunk.count({ where: { status: 'INDEXED' } });
  logger.info('reindex_start', { totalChunks: total, batch: BATCH, embedder: config.retrieval.embedderModel });

  // Load minimal context per chunk in stable (createdAt) order for batching.
  let processed = 0;
  let postingsWritten = 0;
  let embeddingsWritten = 0;
  let atomsWritten = 0;

  // Page through chunk IDs once (DocumentChunk has no createdAt — batch by id).
  const allIds = (
    await db.documentChunk.findMany({ where: { status: 'INDEXED' }, select: { id: true }, orderBy: { id: 'asc' } })
  ).map((r) => r.id);

  for (let offset = 0; offset < allIds.length; offset += BATCH) {
    const ids = allIds.slice(offset, offset + BATCH);
    const rows = await db.documentChunk.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        content: true,
        section: { select: { heading: true } },
        documentVersion: {
          select: {
            document: {
              select: {
                docType: true,
                blueprintVersion: {
                  select: {
                    status: true,
                    blueprint: {
                      select: {
                        id: true,
                        platform: { select: { id: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const tokens = tokenize(row.content);
      const tfMap = new Map<string, number>();
      for (const t of tokens) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);

      // Postings: replace with current-tokenizer terms.
      await db.lexicalTerm.deleteMany({ where: { chunkId: row.id } });
      if (tfMap.size > 0) {
        await db.lexicalTerm.createMany({
          data: [...tfMap.entries()].map(([term, count]) => ({
            term,
            chunkId: row.id,
            tf: 1 + Math.log(count),
          })),
        });
        postingsWritten += tfMap.size;
      }

      // Embedding: re-embed with the current tokenizer.
      await db.embeddingRecord.deleteMany({ where: { chunkId: row.id } });
      const { vector, norm } = embed(row.content);
      await db.embeddingRecord.create({
        data: {
          chunkId: row.id,
          model: config.retrieval.embedderModel,
          dimension: config.retrieval.embedderDimension,
          vector: JSON.stringify(vector),
          norm,
        },
      });
      embeddingsWritten++;

      // Knowledge atoms for chunks that have none (Arabic chunks previously
      // produced none because tokenization was empty).
      const hasAtoms = await db.knowledgeRecord.findFirst({ where: { chunkId: row.id }, select: { id: true } });
      if (!hasAtoms) {
        const bp = row.documentVersion.document.blueprintVersion;
        const atoms = extractKnowledgeAtoms(row.section?.heading ?? '', row.content);
        for (const atom of atoms) {
          await db.knowledgeRecord.create({
            data: {
              chunkId: row.id,
              platformId: bp.blueprint.platform.id,
              blueprintId: bp.blueprint.id,
              blueprintVersionId: bp.id,
              statement: atom.statement,
              recordType: atom.recordType,
              topicKey: atom.topicKey,
              status: bp.status === 'CURRENT' ? 'CURRENT' : 'RECENT',
              sourcePriority: sourcePriorityFor(row.documentVersion.document.docType),
            },
          });
          atomsWritten++;
        }
      }

      processed++;
      if (processed % 1000 === 0) {
        logger.info('reindex_progress', { processed, total });
      }
    }
  }

  // Full-corpus IDF rebuild with the current tokenizer.
  const corpus = await db.documentChunk.findMany({ where: { status: 'INDEXED' }, select: { content: true } });
  const idf = rebuildIdf(corpus.map((c) => tokenize(c.content)));

  logger.info('reindex_complete', {
    processed,
    postingsWritten,
    embeddingsWritten,
    atomsWritten,
    idfTerms: idf.size,
    corpusDocs: corpus.length,
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('reindex failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
