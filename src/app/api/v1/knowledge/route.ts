// WEDJAT v4 — GET /api/v1/knowledge (knowledge:read): platform-filtered
// knowledge search for connected platforms (§18/§80 multi-tenant isolation —
// a platform only reads its own knowledge unless its identity is org-wide).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, withServiceIdentity } from '@/lib/wedjat/fabric/api';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['knowledge:read'], {}, async ({ identity }) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 200);
    const platformParam = url.searchParams.get('platform');
    // §80: platform-bound identities are pinned to their own platform.
    const platformSlug = identity.platformSlug !== '*'
      ? identity.platformSlug
      : platformParam?.trim().toLowerCase() ?? '';
    const platforms = await db.platform.findMany({ where: { orgId: identity.orgId }, select: { id: true, slug: true } });
    const slugToId = new Map(platforms.map((p) => [p.slug, p.id]));
    if (platformSlug && !slugToId.has(platformSlug)) {
      return fail('NOT_FOUND', `platform '${platformSlug}' is not registered`);
    }
    const platformId = platformSlug ? slugToId.get(platformSlug) : undefined;
    const records = await db.knowledgeRecord.findMany({
      where: {
        platformId: platformId ?? { in: platforms.map((p) => p.id) },
        ...(q ? { statement: { contains: q } } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200),
    });
    const idToSlug = new Map(platforms.map((p) => [p.id, p.slug]));
    return ok({
      platform: platformSlug || 'all',
      count: records.length,
      knowledge: records.map((r) => ({
        id: r.id,
        statement: r.statement.slice(0, 600),
        status: r.status,
        recordType: r.recordType,
        platform: idToSlug.get(r.platformId) ?? null,
        learnedAt: r.createdAt.toISOString(),
        effectiveFrom: r.effectiveFrom.toISOString(),
      })),
    });
  });
}
