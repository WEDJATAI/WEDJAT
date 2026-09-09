// WEDJAT v4 — POST /api/fabric/recommendations/[id]/outcome (CURATOR+) — §43/§44:
// record a measured outcome (before/after) → closed-loop learning (§65/§66).
import { NextResponse } from 'next/server';
import { ok, fail, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { applyRecommendationOutcome } from '@/lib/wedjat/recommendations/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);
      const { id } = await params;
      const body = await readJson<{
        outcome?: string; metricName?: string; beforeValue?: string; afterValue?: string;
        notes?: string; commitRef?: string; measuredAt?: string;
      }>(req);
      if (typeof body.outcome !== 'string' || body.outcome.trim() === '') {
        return fail('VALIDATION', "field 'outcome' is required (IMPLEMENTED|NOT_IMPLEMENTED|PARTIALLY_IMPLEMENTED|FAILED|REVERTED|VALIDATED)");
      }
      const result = await applyRecommendationOutcome({
        orgId: principal.org.id,
        recommendationId: id,
        outcome: body.outcome.trim().toUpperCase(),
        metricName: body.metricName,
        beforeValue: body.beforeValue,
        afterValue: body.afterValue,
        notes: body.notes,
        reportedBy: `${principal.name} (${principal.role})`,
        commitRef: body.commitRef,
        measuredAt: body.measuredAt,
      });
      return ok({ recorded: true, learning: result.learning });
    } catch (err) {
      return failFrom(err);
    }
  });
}
