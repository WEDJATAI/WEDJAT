import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal } from '@/lib/wedjat/api';
import { WedjatError } from '@/lib/wedjat/errors';
import type { BlueprintSummary, BlueprintDetail } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/blueprints            → list (optionally ?platform=slug)
 * GET /api/blueprints?id=..&full=1 → full detail (versions, documents, knowledge stats)
 */
export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const platformSlug = url.searchParams.get('platform') ?? undefined;
    const full = url.searchParams.get('full') === '1';

    if (id && full) {
      return ok(await blueprintDetail(principal.org.id, id));
    }

    const blueprints = await db.blueprint.findMany({
      where: {
        platform: { orgId: principal.org.id, ...(platformSlug ? { slug: platformSlug } : {}) },
      },
      include: { platform: true, versions: true },
      orderBy: [{ platformId: 'asc' }, { title: 'asc' }],
    });

    const summaries: BlueprintSummary[] = [];
    for (const b of blueprints) {
      const current = b.versions.find((v) => v.id === b.currentVersionId) ?? null;
      const [documents, knowledgeCount] = await Promise.all([
        db.document.count({ where: { blueprintVersion: { blueprintId: b.id } } }),
        db.knowledgeRecord.count({ where: { blueprintId: b.id } }),
      ]);
      summaries.push({
        id: b.id,
        slug: b.slug,
        title: b.title,
        blueprintType: b.blueprintType,
        platformSlug: b.platform.slug,
        platformName: b.platform.name,
        currentVersion: current?.version ?? null,
        currentVersionStatus: current?.status ?? null,
        versionCount: b.versions.length,
        documentCount: documents,
        knowledgeRecordCount: knowledgeCount,
        updatedAt: b.updatedAt.toISOString(),
      });
    }
    return ok(summaries);
  });
}

async function blueprintDetail(orgId: string, blueprintId: string): Promise<BlueprintDetail> {
  const blueprint = await db.blueprint.findFirst({
    where: { id: blueprintId, platform: { orgId } },
    include: { platform: true, versions: true },
  });
  if (!blueprint) throw new WedjatError('NOT_FOUND', 'Blueprint not found');

  const versions = [...blueprint.versions].sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  );

  const documents = await db.document.findMany({
    where: { blueprintVersion: { blueprintId: blueprint.id } },
    include: {
      versions: true,
      blueprintVersion: true,
    },
    orderBy: { title: 'asc' },
  });

  const docDtos: BlueprintDetail['documents'] = [];
  for (const doc of documents) {
    const latest = doc.versions[doc.versions.length - 1] ?? null;
    const [sectionCount, chunkCount] = latest
      ? await Promise.all([
          db.documentSection.count({ where: { documentVersionId: latest.id } }),
          db.documentChunk.count({ where: { documentVersionId: latest.id } }),
        ])
      : [0, 0];
    docDtos.push({
      id: doc.id,
      title: doc.title,
      slug: doc.slug,
      docType: doc.docType,
      classification: doc.classification,
      status: doc.status,
      version: latest?.version ?? '—',
      ingestedAt: latest?.ingestedAt?.toISOString() ?? null,
      sectionCount,
      chunkCount,
      blueprintVersion: doc.blueprintVersion.version,
    });
  }

  const knowledge = await db.knowledgeRecord.findMany({
    where: { blueprintId: blueprint.id },
    select: { status: true, recordType: true },
  });
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const k of knowledge) {
    byStatus[k.status] = (byStatus[k.status] ?? 0) + 1;
    byType[k.recordType] = (byType[k.recordType] ?? 0) + 1;
  }

  const current = versions.find((v) => v.id === blueprint.currentVersionId) ?? null;
  const [documentsCount, knowledgeCount] = await Promise.all([
    db.document.count({ where: { blueprintVersion: { blueprintId: blueprint.id } } }),
    db.knowledgeRecord.count({ where: { blueprintId: blueprint.id } }),
  ]);

  const versionDtos: BlueprintDetail['versions'] = [];
  for (const v of versions) {
    const [docCount, chunkCount] = await Promise.all([
      db.document.count({ where: { blueprintVersionId: v.id } }),
      db.documentChunk.count({ where: { documentVersion: { document: { blueprintVersionId: v.id } }, status: 'INDEXED' } }),
    ]);
    versionDtos.push({
      id: v.id,
      version: v.version,
      status: v.status as BlueprintDetail['versions'][number]['status'],
      summary: v.summary,
      checksum: v.checksum,
      approvedAt: v.approvedAt?.toISOString() ?? null,
      effectiveFrom: v.effectiveFrom.toISOString(),
      documentCount: docCount,
      chunkCount,
      createdAt: v.createdAt.toISOString(),
    });
  }

  return {
    blueprint: {
      id: blueprint.id,
      slug: blueprint.slug,
      title: blueprint.title,
      blueprintType: blueprint.blueprintType,
      platformSlug: blueprint.platform.slug,
      platformName: blueprint.platform.name,
      currentVersion: current?.version ?? null,
      currentVersionStatus: current?.status ?? null,
      versionCount: versions.length,
      documentCount: documentsCount,
      knowledgeRecordCount: knowledgeCount,
      updatedAt: blueprint.updatedAt.toISOString(),
    },
    versions: versionDtos,
    documents: docDtos,
    knowledgeStats: { total: knowledge.length, byStatus, byType },
  };
}
