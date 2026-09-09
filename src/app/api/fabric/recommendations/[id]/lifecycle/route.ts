// WEDJAT v4 — POST /api/fabric/recommendations/[id]/lifecycle (CURATOR+) —
// §64: status transitions APPEND to history; nothing is rewritten.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { appendRecommendationStatus, RECO_STATUSES } from '@/lib/wedjat/recommendations/engine';
import type { RecommendationDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);
      const { id } = await params;
      const body = await readJson<{ status?: string; note?: string }>(req);
      const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
      if (!RECO_STATUSES.includes(status as (typeof RECO_STATUSES)[number])) {
        return fail('VALIDATION', `status must be one of ${RECO_STATUSES.join('|')}`);
      }
      await appendRecommendationStatus(
        principal.org.id, id, status as (typeof RECO_STATUSES)[number],
        principal.userId, typeof body.note === 'string' ? body.note : undefined
      );
      const r = await db.recommendation.findFirst({
        where: { id, orgId: principal.org.id },
        include: { outcomes: { orderBy: { createdAt: 'desc' } } },
      });
      if (!r) return fail('NOT_FOUND', 'recommendation not found');
      const dto: RecommendationDto = {
        id: r.id,
        platformSlug: r.platformSlug,
        finding: r.finding,
        evidence: (() => { try { return JSON.parse(r.evidenceJson) as RecommendationDto['evidence']; } catch { return []; } })(),
        recommendation: r.recommendation,
        confidence: r.confidence,
        priority: r.priority as RecommendationDto['priority'],
        expectedBenefit: r.expectedBenefit,
        potentialRisk: r.potentialRisk,
        sourceType: r.sourceType,
        status: r.status,
        statusHistory: (() => { try { return JSON.parse(r.statusHistoryJson) as RecommendationDto['statusHistory']; } catch { return []; } })(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        outcomes: r.outcomes.map((o) => ({
          id: o.id, outcome: o.outcome, metricName: o.metricName, beforeValue: o.beforeValue,
          afterValue: o.afterValue, changePct: o.changePct, measuredAt: o.measuredAt?.toISOString() ?? null,
          notes: o.notes, reportedBy: o.reportedBy,
        })),
      };
      return ok(dto);
    } catch (err) {
      return failFrom(err);
    }
  });
}
