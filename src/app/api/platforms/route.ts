import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal } from '@/lib/wedjat/api';
import type { PlatformSummary } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    // Tenant scoping from the SERVER-SIDE principal (§53 — client IDs never trusted).
    const platforms = await db.platform.findMany({
      where: { orgId: principal.org.id },
      orderBy: { name: 'asc' },
      include: {
        blueprints: { include: { versions: true } },
        versions: { orderBy: { releasedAt: 'desc' }, take: 1 },
      },
    });

    const summaries: PlatformSummary[] = [];
    for (const p of platforms) {
      const blueprintIds = p.blueprints.map((b) => b.id);
      const [documents, chunks, currentBpvIds] = await Promise.all([
        db.document.count({
          where: { blueprintVersion: { blueprint: { platformId: p.id } } },
        }),
        db.documentChunk.count({
          where: {
            status: 'INDEXED',
            documentVersion: { document: { blueprintVersion: { blueprint: { platformId: p.id } } } },
          },
        }),
        db.blueprintVersion.findMany({
          where: { blueprintId: { in: blueprintIds }, status: 'CURRENT' },
          select: { id: true },
        }),
      ]);
      void currentBpvIds;
      summaries.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        criticality: p.criticality as PlatformSummary['criticality'],
        status: p.status,
        blueprintCount: p.blueprints.length,
        documentCount: documents,
        chunkCount: chunks,
        currentPlatformVersion: p.versions[0]?.version ?? null,
        updatedAt: p.updatedAt.toISOString(),
      });
    }
    return ok(summaries);
  });
}
