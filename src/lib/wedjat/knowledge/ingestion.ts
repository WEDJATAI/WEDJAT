// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Knowledge ingestion pipeline (§8, §4, §29, §101).
//
// PIPELINE (every stage observable + retryable via IngestionEvent rows):
//   SOURCE → INGESTION → VALIDATION → NORMALIZATION → DOCUMENT CLASSIFICATION →
//   VERSION DETECTION → SECTION EXTRACTION → CHUNKING → METADATA ENRICHMENT →
//   DEDUPLICATION → QUALITY SCORING → EMBEDDING → INDEXING → READY FOR RAG
//
// Versioning is IMMUTABLE (§29): a changed blueprint is a new BlueprintVersion
// with a new checksum; historical versions are never overwritten. Duplicate
// content is detected by checksum (§30) and idempotency keys (§61).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { logger } from '../logger';
import { WedjatError } from '../errors';
import { newTraceId, sha256, contentHash } from '../ids';
import { embed, rebuildIdf, tokenize } from './embeddings';
import { chunkSections, documentChecksum, extractSections } from './chunker';
import { classifyDocument, detectSensitiveData, extractKnowledgeAtoms } from './quality';
import { config } from '../config';
import { recordAudit } from '../observability/audit';

// ── Source priority resolution (§6) ───────────────────────────────────────────

const DOC_TYPE_PRIORITY: Record<string, number> = {
  BLUEPRINT: 2,
  ADR: 3,
  SPEC: 4,
  AUDIT: 5,
  RUNBOOK: 6,
  REVIEW: 5,
  REFERENCE: 8,
  PROMPT: 8,
};

/** §6 precedence: 1..9 (1 = most authoritative). */
export function sourcePriorityFor(docType: string): number {
  return DOC_TYPE_PRIORITY[docType] ?? 6;
}

// ── Pipeline stages ───────────────────────────────────────────────────────────

async function stage(
  documentVersionId: string,
  name: string,
  fn: () => Promise<{ status?: string; detail?: string }>
): Promise<{ status: string; detail?: string }> {
  const started = Date.now();
  try {
    const out = await fn();
    const status = out.status ?? 'OK';
    await db.ingestionEvent.create({
      data: {
        documentVersionId,
        stage: name,
        status,
        detail: out.detail,
        latencyMs: Date.now() - started,
      },
    });
    return { status, detail: out.detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestionEvent.create({
      data: { documentVersionId, stage: name, status: 'FAILED', detail: message, latencyMs: Date.now() - started },
    });
    throw err;
  }
}

export interface IngestInput {
  orgId: string;
  platformSlug: string;
  blueprintSlug: string;
  blueprintTitle?: string;
  blueprintType?: string;
  /** e.g. "2.0" — when omitted, auto-increments from the existing max. */
  blueprintVersion?: string;
  title: string;
  docType?: string;
  classification?: string;
  content: string;
  /** Document version; defaults to "1". */
  documentVersion?: string;
  sourcePath?: string;
  actorId?: string;
  idempotencyKey?: string;
}

export interface IngestResult {
  documentId: string;
  documentVersionId: string;
  blueprintVersionId: string;
  duplicate: boolean;
  traceId: string;
  stages: string[];
}

/**
 * Runs the FULL pipeline synchronously (called by the job worker). The HTTP
 * layer only enqueues jobs — long-running operations never block requests (§62).
 */
export async function runIngestion(input: IngestInput): Promise<IngestResult> {
  const traceId = newTraceId();
  const stages: string[] = [];

  // ── AUTHZ-side org scoping is the caller's duty; here we resolve entities.
  const platform = await db.platform.findFirst({
    where: { slug: input.platformSlug, orgId: input.orgId, status: 'ACTIVE' },
  });
  if (!platform) throw new WedjatError('NOT_FOUND', `Platform ${input.platformSlug} not found`);

  // ── INGESTION (create/find blueprint + version + document shell) ───────────
  let blueprint = await db.blueprint.findFirst({
    where: { platformId: platform.id, slug: input.blueprintSlug },
    include: { versions: true },
  });
  if (!blueprint) {
    blueprint = await db.blueprint.create({
      data: {
        platformId: platform.id,
        slug: input.blueprintSlug,
        title: input.blueprintTitle ?? input.blueprintSlug.replace(/-/g, ' '),
        blueprintType: input.blueprintType ?? 'ARCHITECTURE',
        status: 'ACTIVE',
      },
      include: { versions: true },
    });
    await recordAudit({
      orgId: input.orgId,
      actorType: input.actorId ? 'user' : 'system',
      actorId: input.actorId,
      action: 'blueprint.created',
      targetType: 'blueprint',
      targetId: blueprint.id,
      severity: 'INFO',
      details: { slug: input.blueprintSlug, platform: input.platformSlug },
      traceId,
    });
  }

  // VERSION DETECTION: immutable new BlueprintVersion rows (§29).
  const versionNumber =
    input.blueprintVersion ?? nextVersion(blueprint.versions.map((v) => v.version));
  const docChecksum = documentChecksum(input.content);
  let blueprintVersion = blueprint.versions.find((v) => v.version === versionNumber);
  const duplicate = Boolean(blueprintVersion?.checksum === docChecksum);

  if (!blueprintVersion) {
    blueprintVersion = await db.blueprintVersion.create({
      data: {
        blueprintId: blueprint.id,
        version: versionNumber,
        status: 'CURRENT',
        checksum: docChecksum,
        effectiveFrom: new Date(),
      },
    });
    // Supersede previous CURRENT versions — historical rows stay untouched.
    await db.blueprintVersion.updateMany({
      where: { blueprintId: blueprint.id, status: 'CURRENT', id: { not: blueprintVersion.id } },
      data: { status: 'SUPERSEDED', effectiveUntil: new Date() },
    });
    await db.blueprint.update({
      where: { id: blueprint.id },
      data: { currentVersionId: blueprintVersion.id },
    });
  }

  let document = await db.document.findFirst({
    where: { blueprintVersionId: blueprintVersion.id, slug: slugify(input.title) },
  });
  if (!document) {
    document = await db.document.create({
      data: {
        blueprintVersionId: blueprintVersion.id,
        slug: slugify(input.title),
        title: input.title,
        docType: input.docType ?? classifyDocument(input.title, input.content),
        classification: input.classification ?? 'INTERNAL',
        status: 'ACTIVE',
      },
    });
  }

  let documentVersion = await db.documentVersion.findFirst({
    where: { documentId: document.id, version: input.documentVersion ?? '1' },
  });
  if (!documentVersion) {
    documentVersion = await db.documentVersion.create({
      data: {
        documentId: document.id,
        version: input.documentVersion ?? '1',
        status: 'PENDING',
        sourcePath: input.sourcePath,
        rawText: input.content,
        checksum: docChecksum,
        byteSize: Buffer.byteLength(input.content, 'utf8'),
      },
    });
  }
  const dvId = documentVersion.id;
  stages.push('INGESTION');

  // ── v4 §58 IDEMPOTENT REPLAY GUARD (BUG FIX, additive) ─────────────────────
  // When the SAME content (checksum) was already fully ingested into this
  // document version, re-running the pipeline (event replay §57, duplicate
  // delivery, re-dispatch) must NOT re-create sections/chunks/embeddings —
  // it returns the existing result instead of violating (documentVersionId,
  // ordinal) uniqueness. No knowledge is lost or duplicated (§58).
  if (duplicate && documentVersion.status !== 'PENDING' && documentVersion.checksum === docChecksum) {
    const chunkCount = await db.documentChunk.count({ where: { documentVersionId: dvId } });
    if (chunkCount > 0) {
      return {
        documentId: document.id,
        documentVersionId: dvId,
        blueprintVersionId: blueprintVersion.id,
        duplicate: true,
        traceId,
        stages: [...stages, 'IDEMPOTENT_REPLAY'],
      };
    }
  }

  // ── VALIDATION: file-content integrity + untrusted-input checks (§59) ──────
  await stage(dvId, 'VALIDATED', async () => {
    if (Buffer.byteLength(input.content, 'utf8') > 2_000_000) {
      throw new WedjatError('VALIDATION', 'Document exceeds 2MB limit (resource exhaustion guard)');
    }
    if (input.content.trim().length < 40) {
      throw new WedjatError('VALIDATION', 'Document too short to be a meaningful source');
    }
    const sensitive = detectSensitiveData(input.content);
    return {
      status: sensitive.length > 0 ? 'WARN' : 'OK',
      detail: sensitive.length ? `sensitive patterns flagged: ${sensitive.join(',')} (kept, flagged for curation)` : 'content integrity ok',
    };
  });
  stages.push('VALIDATED');

  // ── NORMALIZATION ───────────────────────────────────────────────────────────
  const normalized = await stage(dvId, 'NORMALIZED', async () => {
    const norm = input.content.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
    return { detail: `normalized ${norm.length} chars` };
  });
  stages.push('NORMALIZED');

  // ── CLASSIFICATION ──────────────────────────────────────────────────────────
  const docTypeFinal = input.docType ?? classifyDocument(input.title, input.content);
  await stage(dvId, 'CLASSIFIED', async () => ({ detail: `docType=${docTypeFinal} classification=${document!.classification}` }));
  stages.push('CLASSIFIED');

  // ── VERSION DETECTION event ────────────────────────────────────────────────
  await stage(dvId, 'VERSIONED', async () => ({
    detail: `blueprint ${blueprint!.slug} v${versionNumber} ${duplicate ? '(duplicate checksum detected)' : '(new immutable version)'}`,
    status: duplicate ? 'WARN' : 'OK',
  }));
  stages.push('VERSIONED');

  // ── SECTION EXTRACTION ──────────────────────────────────────────────────────
  const sections = extractSections(input.content);
  await stage(dvId, 'SECTIONED', async () => ({ detail: `${sections.length} sections extracted` }));
  stages.push('SECTIONED');

  // ── CHUNKING ────────────────────────────────────────────────────────────────
  const chunks = chunkSections(sections);
  await stage(dvId, 'CHUNKED', async () => ({ detail: `${chunks.length} chunks (target ${config.chunking.targetTokens} tokens)` }));
  stages.push('CHUNKED');

  // ── METADATA ENRICHMENT + DEDUPLICATION + QUALITY SCORING + EMBEDDING + INDEX
  await stage(dvId, 'ENRICHED', async () => ({ detail: 'section lineage, platform/blueprint scope, source priority attached' }));

  // Dedup: global chunk checksum registry (§30).
  const existingHashes = new Set(
    (
      await db.documentChunk.findMany({
        where: { checksum: { in: chunks.map((c) => c.checksum) } },
        select: { checksum: true },
      })
    ).map((c) => c.checksum)
  );

  await stage(dvId, 'DEDUPLICATED', async () => ({
    status: existingHashes.size > 0 ? 'WARN' : 'OK',
    detail: `${existingHashes.size} duplicate chunks will be marked EXCLUDED`,
  }));
  stages.push('DEDUPLICATED');

  const qualityOk = chunks.filter((c) => c.qualityScore >= config.chunking.qualityThreshold);
  await stage(dvId, 'QUALITY_SCORED', async () => ({
    status: qualityOk.length < chunks.length ? 'WARN' : 'OK',
    detail: `${qualityOk.length}/${chunks.length} chunks pass quality threshold ${config.chunking.qualityThreshold}`,
  }));
  stages.push('QUALITY_SCORED');

  // Persist sections — RESUME-SAFE (§58 spirit, ADDITIVE §122): an interrupted
  // run may have already persisted some section ordinals (serverless timeout,
  // crash, re-dispatch). Update those in place and create only the missing
  // ones — never duplicates, never a uniqueness crash on re-run.
  const priorSections = await db.documentSection.findMany({
    where: { documentVersionId: dvId },
    select: { id: true, ordinal: true },
  });
  const priorSectionId = new Map(priorSections.map((s) => [s.ordinal, s.id]));
  const sectionRows = await Promise.all(
    sections.map((s) => {
      const data = {
        heading: s.heading,
        level: s.level,
        content: s.content,
      };
      const existing = priorSectionId.get(s.ordinal);
      return existing
        ? db.documentSection.update({ where: { id: existing }, data })
        : db.documentSection.create({
            data: { documentVersionId: dvId, ordinal: s.ordinal, qualityScore: 0, ...data },
          });
    })
  );
  const sectionByOrdinal = new Map(sectionRows.map((s) => [s.ordinal, s]));

  // Persist chunks — same resume-safe upsert (unique (documentVersionId, ordinal)).
  const priorChunks = await db.documentChunk.findMany({
    where: { documentVersionId: dvId },
    select: { id: true, ordinal: true },
  });
  const priorChunkId = new Map(priorChunks.map((c) => [c.ordinal, c.id]));
  const chunkRows = await Promise.all(
    chunks.map((c) => {
      const data = {
        sectionId: c.sectionOrdinal != null ? sectionByOrdinal.get(c.sectionOrdinal)?.id ?? null : null,
        content: c.content,
        tokenEstimate: c.tokenEstimate,
        qualityScore: c.qualityScore,
        status:
          existingHashes.has(c.checksum) || c.qualityScore < config.chunking.qualityThreshold
            ? 'EXCLUDED'
            : 'INDEXED',
        checksum: c.checksum,
      };
      const existing = priorChunkId.get(c.ordinal);
      return existing
        ? db.documentChunk.update({ where: { id: existing }, data })
        : db.documentChunk.create({ data: { documentVersionId: dvId, ordinal: c.ordinal, ...data } });
    })
  );

  // ── EMBEDDING (LOCAL_ONLY policy — text never leaves for indexing §17) ─────
  const indexed = chunkRows.filter((c) => c.status === 'INDEXED');
  // Resume-safe: skip chunks that already carry an embedding (unique chunkId).
  const embeddedChunkIds = new Set(
    (
      await db.embeddingRecord.findMany({
        where: { chunk: { documentVersionId: dvId } },
        select: { chunkId: true },
      })
    ).map((e) => e.chunkId)
  );
  await stage(dvId, 'EMBEDDED', async () => {
    for (const chunk of indexed) {
      if (embeddedChunkIds.has(chunk.id)) continue;
      const { vector, norm } = embed(chunk.content);
      await db.embeddingRecord.create({
        data: {
          chunkId: chunk.id,
          model: config.retrieval.embedderModel,
          dimension: config.retrieval.embedderDimension,
          vector: JSON.stringify(vector),
          norm,
        },
      });
    }
    return { detail: `${indexed.length} chunks embedded locally (${config.retrieval.embedderModel})` };
  });
  stages.push('EMBEDDED');

  // ── INDEXING (lexical postings + knowledge records) — RESUME-SAFE ──────────
  // Skip per-chunk index artifacts that a prior interrupted run already wrote
  // (postings + knowledge atoms); the IDF rebuild below is naturally idempotent.
  const indexedChunkIdsWithPostings = new Set(
    (await db.lexicalTerm.findMany({
      where: { chunk: { documentVersionId: dvId } },
      select: { chunkId: true },
    })).map((p) => p.chunkId)
  );
  const indexedChunkIdsWithKnowledge = new Set(
    (await db.knowledgeRecord.findMany({
      where: { chunk: { documentVersionId: dvId } },
      select: { chunkId: true },
    })).map((k) => k.chunkId)
  );
  await stage(dvId, 'INDEXED', async () => {
    for (const chunk of indexed) {
      const alreadyIndexed = indexedChunkIdsWithPostings.has(chunk.id);
      if (!alreadyIndexed) {
        const tokens = tokenize(chunk.content);
        const tfMap = new Map<string, number>();
        for (const t of tokens) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
        const postings = [...tfMap.entries()].map(([term, count]) => ({
          term,
          chunkId: chunk.id,
          tf: 1 + Math.log(count),
        }));
        if (postings.length > 0) {
          await db.lexicalTerm.createMany({ data: postings });
        }
      }

      // Knowledge records (atoms) with currentness + priority (§6/§7).
      // The extracted chunk list maps 1:1 to DB rows by ordinal.
      if (indexedChunkIdsWithKnowledge.has(chunk.id)) continue;
      const extracted = chunks[chunk.ordinal];
      const heading = extracted?.sectionOrdinal != null
        ? sectionByOrdinal.get(extracted.sectionOrdinal)?.heading ?? null
        : null;
      const atoms = extractKnowledgeAtoms(heading ?? '', chunk.content);
      for (const atom of atoms) {
        await db.knowledgeRecord.create({
          data: {
            chunkId: chunk.id,
            platformId: platform.id,
            blueprintId: blueprint!.id,
            blueprintVersionId: blueprintVersion!.id,
            statement: atom.statement,
            recordType: atom.recordType,
            topicKey: atom.topicKey,
            status: blueprintVersion!.status === 'CURRENT' ? 'CURRENT' : 'RECENT',
            sourcePriority: sourcePriorityFor(docTypeFinal),
          },
        });
      }
    }
    // Rebuild corpus IDF so query-time weighting matches the new corpus.
    const corpus = await db.documentChunk.findMany({
      where: { status: 'INDEXED' },
      select: { content: true },
    });
    rebuildIdf(corpus.map((c) => tokenize(c.content)));
    return { detail: `lexical postings + ${corpus.length}-doc IDF rebuilt` };
  });
  stages.push('INDEXED');

  // ── READY FOR RAG ───────────────────────────────────────────────────────────
  await stage(dvId, 'READY_FOR_RAG', async () => ({
    detail: duplicate
      ? 'document checksum matches existing version — marked duplicate'
      : `${indexed.length} chunks retrievable`,
  }));
  stages.push('READY_FOR_RAG');

  await db.documentVersion.update({
    where: { id: dvId },
    data: { status: 'INGESTED', ingestedAt: new Date() },
  });

  await recordAudit({
    orgId: input.orgId,
    actorType: input.actorId ? 'user' : 'system',
    actorId: input.actorId,
    action: 'document.ingested',
    targetType: 'documentVersion',
    targetId: dvId,
    severity: 'INFO',
    details: {
      platform: input.platformSlug,
      blueprint: blueprint.slug,
      version: versionNumber,
      chunks: indexed.length,
      duplicate,
    },
    traceId,
  });

  logger.info('ingestion_complete', {
    traceId,
    documentVersionId: dvId,
    chunks: indexed.length,
    duplicate,
  });

  return {
    documentId: document.id,
    documentVersionId: dvId,
    blueprintVersionId: blueprintVersion.id,
    duplicate,
    traceId,
    stages,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function nextVersion(versions: string[]): string {
  const nums = versions
    .map((v) => parseFloat(v))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  // Minor bump by default (1.0 → 1.1).
  const major = Math.floor(max);
  const minor = Math.round((max - major) * 10) + 1;
  return `${major}.${minor}`;
}
