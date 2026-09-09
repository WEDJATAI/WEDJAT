// WEDJAT v4 — GET /api/v1/platforms/[slug]/insights (analysis:read): a
// deterministic, evidence-grounded platform summary (§75/§76): purpose from
// registry, knowledge coverage, current findings by type, risks and open
// recommendations. NO fabricated statements — counts and stored text only.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, withServiceIdentity } from '@/lib/wedjat/fabric/api';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;
  return withServiceIdentity(req, ['analysis:read'], { platform: slug }, async ({ identity }) => {
    const platform = await db.platform.findFirst({ where: { orgId: identity.orgId, slug } });
    if (!platform) return fail('NOT_FOUND', `platform '${slug}' is not registered`);
    const [krTotal, byType, risks, decisions, events, recos] = await Promise.all([
      db.knowledgeRecord.count({ where: { platformId: platform.id } }),
      db.knowledgeRecord.groupBy({ by: ['recordType'], where: { platformId: platform.id, status: 'CURRENT' }, _count: { _all: true } }),
      db.knowledgeRecord.findMany({
        where: { platformId: platform.id, recordType: 'RISK', status: 'CURRENT' },
        orderBy: { createdAt: 'desc' }, take: 5,
      }),
      db.knowledgeRecord.findMany({
        where: { platformId: platform.id, recordType: 'DECISION', status: 'CURRENT' },
        orderBy: { createdAt: 'desc' }, take: 5,
      }),
      db.eventRecord.count({ where: { orgId: identity.orgId, sourcePlatform: slug } }),
      db.recommendation.findMany({
        where: { orgId: identity.orgId, platformSlug: slug, status: { in: ['PROPOSED', 'ACCEPTED'] } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 5,
      }),
    ]);
    return ok({
      platform: {
        slug: platform.slug,
        name: platform.name,
        status: platform.status,
        connectionStatus: platform.connectionStatus ?? 'DISCOVERED',
        repositoryUrl: platform.repositoryUrl,
        deploymentUrl: platform.deploymentUrl,
        databaseUrl: platform.databaseUrl,
      },
      knowledge: {
        totalRecords: krTotal,
        currentByType: byType.map((t) => ({ type: t.recordType, count: t._count._all })).sort((a, b) => b.count - a.count),
      },
      currentRisks: risks.map((r) => ({ statement: r.statement.slice(0, 400), learnedAt: r.createdAt.toISOString() })),
      recentDecisions: decisions.map((r) => ({ statement: r.statement.slice(0, 400), learnedAt: r.createdAt.toISOString() })),
      eventsReceived: events,
      openRecommendations: recos.map((r) => ({
        id: r.id, priority: r.priority, status: r.status,
        recommendation: r.recommendation.slice(0, 400), confidence: r.confidence,
      })),
      evidenceBasis: 'deterministic counts + stored knowledge statements only (v4 §119 — no hallucinated facts)',
    });
  });
}
