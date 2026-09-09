// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Permanent organizational memory inspector (§107-§113, §85-§86).
//
//   • §108/§109 "Why does WEDJAT know this?" — provenance lookup: source doc,
//     platform, lineage/correction chain, creating events, model usage.
//   • §110 "When did WEDJAT learn this?" — timestamps from the chain.
//   • §107 LEARNING TIMELINE — a unified view of what was learned/changed.
//   • §85/§86 GAP DETECTION — retrieval failures and insufficient-evidence
//     answers become KnowledgeGap rows → improvement tasks (never deletions).
//   • §113 KNOWLEDGE EXPORT — authorized, non-destructive (export never removes
//     knowledge from WEDJAT).
// All queries are READ-ONLY against historical data — nothing here mutates or
// deletes knowledge (§5/§6).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { WedjatError } from '../errors';
import type {
  TimelineEntryDto, ProvenanceDto, MemoryInspectorPayload, KnowledgeGapDto,
} from '../types';
import { recordAudit } from '../observability/audit';

// ── §108/§109/§110: provenance lookup ───────────────────────────────────────

export async function getProvenance(orgId: string, recordId: string): Promise<ProvenanceDto> {
  const rec = await db.knowledgeRecord.findUnique({ where: { id: recordId } });
  if (!rec || !(await orgOwnsPlatform(orgId, rec.platformId))) {
    throw new WedjatError('NOT_FOUND', 'knowledge record not found');
  }
  const platform = await db.platform.findUnique({ where: { id: rec.platformId } });
  const chunk = await db.documentChunk.findUnique({
    where: { id: rec.chunkId },
    include: {
      section: {
        include: {
          documentVersion: {
            include: {
              document: {
                include: {
                  blueprintVersion: {
                    include: { blueprint: { include: { platform: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const doc = chunk?.section?.documentVersion?.document ?? null;
  const bp = doc?.blueprintVersion?.blueprint ?? null;

  // Lineage: corrections/supersessions touching this record (§7/§8/§9).
  const lineageOut = await db.knowledgeLineage.findMany({ where: { orgId, fromRecordId: rec.id } });
  const lineageIn = await db.knowledgeLineage.findMany({ where: { orgId, toRecordId: rec.id } });
  const relatedIds = [...lineageOut.map((l) => l.toRecordId), ...lineageIn.map((l) => l.fromRecordId)];
  const related = relatedIds.length
    ? await db.knowledgeRecord.findMany({ where: { id: { in: relatedIds } } })
    : [];
  const byId = new Map(related.map((r) => [r.id, r]));
  const lineage = [
    ...lineageIn.map((l) => ({
      relation: l.relation,
      recordId: l.fromRecordId,
      statement: byId.get(l.fromRecordId)?.statement ?? '(record preserved)',
      note: l.whatWasWrong ? `${l.whatWasWrong}${l.whyWrong ? ` — ${l.whyWrong}` : ''}` : (l.correctedBy ?? null),
      at: l.createdAt.toISOString(),
    })),
    ...lineageOut.map((l) => ({
      relation: l.relation,
      recordId: l.toRecordId,
      statement: byId.get(l.toRecordId)?.statement ?? '(record preserved)',
      note: l.correctedBy ?? null,
      at: l.createdAt.toISOString(),
    })),
  ];

  // Creating events: event payloads whose ingestion produced this platform's
  // knowledge (best-effort evidence link via sourcePath on the document).
  const events = doc
    ? await db.eventRecord.findMany({
        where: { orgId, sourcePlatform: bp?.platform.slug ?? 'unknown', eventType: { in: ['knowledge.published', 'blueprint.created', 'blueprint.updated'] } },
        orderBy: { occurredAt: 'desc' },
        take: 5,
        select: { eventId: true, eventType: true, occurredAt: true },
      })
    : [];

  // Model usage: generations that cited this chunk (§108 "model usage").
  const sources = await db.generationSource.findMany({
    where: { chunkId: rec.chunkId },
    select: { generation: { select: { model: true } } },
    take: 20,
  });
  const usedByModels = [...new Set(sources.map((s) => s.generation?.model).filter((m): m is string => Boolean(m)))];

  return {
    recordId: rec.id,
    statement: rec.statement,
    status: rec.status,
    platform: platform?.slug ?? null,
    document: doc
      ? {
          id: doc.id,
          title: doc.title,
          docType: doc.docType,
          version: doc.blueprintVersion?.version ?? '1',
        }
      : null,
    learnedAt: rec.createdAt.toISOString(),
    lastVerifiedAt: rec.lastVerifiedAt.toISOString(),
    lineage,
    events: events.map((e) => ({ eventId: e.eventId, eventType: e.eventType, at: e.occurredAt.toISOString() })),
    usedByModels,
  };
}

async function orgOwnsPlatform(orgId: string, platformId: string): Promise<boolean> {
  const platform = await db.platform.findUnique({ where: { id: platformId } });
  return platform?.orgId === orgId;
}

// ── §107: learning timeline ──────────────────────────────────────────────────

export async function getTimeline(orgId: string, limit = 120): Promise<TimelineEntryDto[]> {
  const entries: (TimelineEntryDto & { atMs: number })[] = [];
  const orgPlatforms = await db.platform.findMany({ where: { orgId }, select: { id: true, slug: true } });
  const idToSlug = new Map(orgPlatforms.map((p) => [p.id, p.slug]));
  const platformIds = orgPlatforms.map((p) => p.id);

  const records = platformIds.length
    ? await db.knowledgeRecord.findMany({
        where: { platformId: { in: platformIds } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      })
    : [];
  for (const r of records) {
    entries.push({
      atMs: r.createdAt.getTime(),
      at: r.createdAt.toISOString(),
      kind: 'KNOWLEDGE_ADDED',
      platform: idToSlug.get(r.platformId) ?? null,
      summary: r.statement.slice(0, 160),
      refId: r.id,
    });
  }

  const events = await db.eventRecord.findMany({
    where: { orgId },
    orderBy: { occurredAt: 'desc' },
    take: 40,
  });
  for (const e of events) {
    entries.push({
      atMs: e.occurredAt.getTime(),
      at: e.occurredAt.toISOString(),
      kind: 'EVENT',
      platform: e.sourcePlatform,
      summary: `${e.eventType} (${e.status.toLowerCase()})`,
      refId: e.id,
    });
  }

  const lineages = await db.knowledgeLineage.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 20 });
  for (const l of lineages) {
    entries.push({
      atMs: l.createdAt.getTime(),
      at: l.createdAt.toISOString(),
      kind: 'CORRECTION',
      platform: null,
      summary: `${l.relation}: ${l.whatWasWrong ?? 'knowledge chain updated'}`.slice(0, 160),
      refId: l.id,
    });
  }

  const recos = await db.recommendation.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' }, take: 20 });
  for (const r of recos) {
    entries.push({
      atMs: r.updatedAt.getTime(),
      at: r.updatedAt.toISOString(),
      kind: 'RECOMMENDATION',
      platform: r.platformSlug,
      summary: `[${r.status}] ${r.recommendation.slice(0, 120)}`,
      refId: r.id,
    });
  }

  const outcomes = await db.recommendationOutcome.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 15 });
  for (const o of outcomes) {
    entries.push({
      atMs: o.createdAt.getTime(),
      at: o.createdAt.toISOString(),
      kind: 'OUTCOME',
      platform: o.reportedBy,
      summary: `${o.outcome}${o.metricName ? ` (${o.metricName}: ${o.beforeValue ?? '?'} → ${o.afterValue ?? '?'})` : ''}`,
      refId: o.id,
    });
  }

  // ModelRegistry is a global capability catalog (no org scoping) — the
  // timeline shows org-relevant model versions without leaking other data.
  const registries = await db.modelRegistry.findMany({ select: { id: true } });
  const models = registries.length
    ? await db.modelVersion.findMany({
        where: { registryId: { in: registries.map((r) => r.id) } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];
  for (const m of models) {
    entries.push({
      atMs: m.createdAt.getTime(),
      at: m.createdAt.toISOString(),
      kind: 'MODEL',
      platform: null,
      summary: `model ${m.version} ${m.status.toLowerCase()}`,
      refId: m.id,
    });
  }

  const gaps = await db.knowledgeGap.findMany({ where: { orgId, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 10 });
  for (const g of gaps) {
    entries.push({
      atMs: g.createdAt.getTime(),
      at: g.createdAt.toISOString(),
      kind: 'GAP',
      platform: g.platformSlug,
      summary: `gap: ${g.description.slice(0, 140)}`,
      refId: g.id,
    });
  }

  return entries.sort((a, b) => b.atMs - a.atMs).slice(0, limit).map(({ atMs: _atMs, ...rest }) => rest);
}

// ── §85/§86: knowledge gap detection ────────────────────────────────────────

export async function detectKnowledgeGaps(orgId: string): Promise<{ openGaps: number; created: number }> {
  // Weak-evidence chats: RetrievalEvents with low top scores signal missing
  // knowledge (§85 "weak retrieval" / "insufficient source evidence").
  const weakRetrievals = await db.retrievalEvent.findMany({
    where: { topScore: { lt: 0.18 }, createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  let created = 0;
  for (const r of weakRetrievals) {
    const description = `Weak retrieval for: "${r.query.slice(0, 120)}" (top score ${r.topScore.toFixed(2)})`;
    const existing = await db.knowledgeGap.findFirst({
      where: { orgId, query: r.query.slice(0, 200), status: 'OPEN' },
    });
    if (existing) {
      // §12 additive: occurrences INCREASE — the gap row is never rewritten away.
      await db.knowledgeGap.update({ where: { id: existing.id }, data: { occurrences: { increment: 1 } } });
      continue;
    }
    const priority = r.resultCount === 0 ? 'P1' : 'P2';
    await db.knowledgeGap.create({
      data: {
        orgId,
        gapType: r.resultCount === 0 ? 'UNANSWERED_QUESTION' : 'WEAK_RETRIEVAL',
        description,
        query: r.query.slice(0, 200),
        priority,
      },
    });
    created += 1;
  }
  const openGaps = await db.knowledgeGap.count({ where: { orgId, status: 'OPEN' } });
  return { openGaps, created };
}

/** Converts a gap into an ImprovementQueueItem (§85: "convert gaps into
 *  improvement tasks") — the gap row stays OPEN→CONVERTED (never deleted). */
export async function convertGapToTask(orgId: string, gapId: string, userId: string): Promise<{ itemId: string }> {
  const gap = await db.knowledgeGap.findFirst({ where: { id: gapId, orgId } });
  if (!gap) throw new WedjatError('NOT_FOUND', 'knowledge gap not found');
  if (gap.status !== 'OPEN') throw new WedjatError('VALIDATION', `gap already ${gap.status.toLowerCase()}`);
  const item = await db.improvementQueueItem.create({
    data: {
      orgId,
      kind: 'RETRIEVAL_MISS',
      description: gap.description,
      evidenceJson: JSON.stringify({ gapId: gap.id, query: gap.query, occurrences: gap.occurrences }),
      priority: gap.priority,
      proposedAction: 'Ingest or improve source material covering this query; then re-evaluate retrieval (v4 §59).',
    },
  });
  await db.knowledgeGap.update({ where: { id: gap.id }, data: { status: 'CONVERTED', convertedItemId: item.id } });
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'knowledge_gap.converted',
    targetType: 'KnowledgeGap', targetId: gap.id, severity: 'INFO',
  });
  return { itemId: item.id };
}

// ── §107-§112 payload assembly ──────────────────────────────────────────────

export async function getMemoryInspectorPayload(orgId: string): Promise<MemoryInspectorPayload> {
  const [timeline, gapRows] = await Promise.all([
    getTimeline(orgId, 120),
    db.knowledgeGap.findMany({ where: { orgId, status: 'OPEN' }, orderBy: [{ priority: 'asc' }, { occurrences: 'desc' }], take: 50 }),
  ]);
  const gaps: KnowledgeGapDto[] = gapRows.map((g) => ({
    id: g.id,
    gapType: g.gapType,
    description: g.description,
    platformSlug: g.platformSlug,
    query: g.query,
    priority: g.priority,
    status: g.status,
    occurrences: g.occurrences,
    createdAt: g.createdAt.toISOString(),
  }));
  const orgPlatformIds = await db.platform.findMany({ where: { orgId }, select: { id: true } }).then((ps) => ps.map((p) => p.id));
  const [knowledgeRecords, lineages, patterns, gapsOpen, eventsTotal, corrections] = await Promise.all([
    db.knowledgeRecord.count({ where: { platformId: { in: orgPlatformIds } } }),
    db.knowledgeLineage.count({ where: { orgId } }),
    db.orgPattern.count({ where: { orgId } }),
    db.knowledgeGap.count({ where: { orgId, status: 'OPEN' } }),
    db.eventRecord.count({ where: { orgId } }),
    db.knowledgeLineage.count({ where: { orgId, relation: 'CORRECTS' } }),
  ]);
  return {
    timeline,
    gaps,
    stats: { knowledgeRecords, lineages, patterns, gapsOpen, eventsTotal, corrections },
  };
}

// ── §113: knowledge export (non-destructive) ────────────────────────────────

export async function exportKnowledgeBundle(orgId: string, userId: string): Promise<Record<string, unknown>> {
  const exportPlatforms = await db.platform.findMany({ where: { orgId }, select: { id: true, slug: true } });
  const exportIdToSlug = new Map(exportPlatforms.map((p) => [p.id, p.slug]));
  const records = await db.knowledgeRecord.findMany({
    where: { platformId: { in: exportPlatforms.map((p) => p.id) } },
    include: { chunk: { include: { section: { include: { documentVersion: { include: { document: true } } } } } } },
    take: 2000,
    orderBy: { createdAt: 'asc' },
  });
  const lineages = await db.knowledgeLineage.findMany({ where: { orgId } });
  const platforms = await db.platform.findMany({ where: { orgId } });
  const patterns = await db.orgPattern.findMany({ where: { orgId } });
  const bundle = {
    exportedAt: new Date().toISOString(),
    exportedBy: userId,
    nonDestructive: true,
    counts: {
      knowledgeRecords: records.length,
      lineages: lineages.length,
      platforms: platforms.length,
      patterns: patterns.length,
    },
    platforms: platforms.map((p) => ({ slug: p.slug, name: p.name, status: p.status, connectionStatus: p.connectionStatus })),
    knowledge: records.map((r) => ({
      id: r.id,
      statement: r.statement,
      status: r.status,
      recordType: r.recordType,
      platform: exportIdToSlug.get(r.platformId) ?? null,
      document: r.chunk?.section?.documentVersion?.document?.title ?? null,
      documentVersion: r.chunk?.section?.documentVersion?.document?.blueprintVersionId ?? null,
      sourcePriority: r.sourcePriority,
      learnedAt: r.createdAt.toISOString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    })),
    lineages: lineages.map((l) => ({
      relation: l.relation, fromRecordId: l.fromRecordId, toRecordId: l.toRecordId,
      whatWasWrong: l.whatWasWrong, correctedBy: l.correctedBy, at: l.createdAt.toISOString(),
    })),
    patterns: patterns.map((p) => ({
      name: p.name, type: p.patternType, status: p.status,
      platforms: JSON.parse(p.platformSlugsJson) as string[], confidence: p.confidence,
    })),
  };
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'knowledge.exported',
    severity: 'WARN', detailsJson: JSON.stringify({ records: records.length }),
  });
  return bundle;
}
