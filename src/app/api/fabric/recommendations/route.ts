// WEDJAT v4 — GET /api/fabric/recommendations (§42/§64/§114). Optional
// ?platform=&status= filters; outcomes are included for the closed loop view.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import type { RecommendationDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const url = new URL(req.url);
      const platform = url.searchParams.get('platform');
      const status = url.searchParams.get('status');
      const rows = await db.recommendation.findMany({
        where: {
          orgId: principal.org.id,
          ...(platform ? { platformSlug: platform } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 100,
        include: { outcomes: { orderBy: { createdAt: 'desc' } } },
      });
      const recommendations: RecommendationDto[] = rows.map((r) => ({
        id: r.id,
        platformSlug: r.platformSlug,
        finding: r.finding,
        evidence: (() => {
          try { return JSON.parse(r.evidenceJson) as RecommendationDto['evidence']; } catch { return []; }
        })(),
        recommendation: r.recommendation,
        confidence: r.confidence,
        priority: r.priority as RecommendationDto['priority'],
        expectedBenefit: r.expectedBenefit,
        potentialRisk: r.potentialRisk,
        sourceType: r.sourceType,
        status: r.status,
        statusHistory: (() => {
          try { return JSON.parse(r.statusHistoryJson) as RecommendationDto['statusHistory']; } catch { return []; }
        })(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        outcomes: r.outcomes.map((o) => ({
          id: o.id,
          outcome: o.outcome,
          metricName: o.metricName,
          beforeValue: o.beforeValue,
          afterValue: o.afterValue,
          changePct: o.changePct,
          measuredAt: o.measuredAt?.toISOString() ?? null,
          notes: o.notes,
          reportedBy: o.reportedBy,
        })),
      }));
      return ok({ recommendations });
    } catch (err) {
      return failFrom(err);
    }
  });
}
