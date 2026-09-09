// WEDJAT v4 — GET /api/v1/platforms/[slug]/recommendations (§114):
// recommendations distributed back to the platform that owns them.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, withServiceIdentity } from '@/lib/wedjat/fabric/api';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;
  return withServiceIdentity(req, ['recommendations:read'], { platform: slug }, async ({ identity }) => {
    const platform = await db.platform.findFirst({ where: { orgId: identity.orgId, slug } });
    if (!platform) return fail('NOT_FOUND', `platform '${slug}' is not registered`);
    const statusParam = new URL(req.url).searchParams.get('status');
    const rows = await db.recommendation.findMany({
      where: {
        orgId: identity.orgId,
        platformSlug: slug,
        ...(statusParam ? { status: statusParam.toUpperCase() } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return ok({
      platform: slug,
      count: rows.length,
      recommendations: rows.map((r) => ({
        id: r.id,
        finding: r.finding,
        recommendation: r.recommendation,
        evidence: (() => { try { return JSON.parse(r.evidenceJson) as unknown[]; } catch { return []; } })(),
        confidence: r.confidence,
        priority: r.priority,
        expectedBenefit: r.expectedBenefit,
        potentialRisk: r.potentialRisk,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
}
