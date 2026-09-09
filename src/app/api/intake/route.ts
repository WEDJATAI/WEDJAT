// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — GET /api/intake — Import dashboard list (§153).
// Sources with type, size, tables, records, schema quality, mapping confidence,
// knowledge extracted, training candidates, review-queue counts and autonomy.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { toSourceDto } from '@/lib/wedjat/intake/dto';
import { getAutonomyState } from '@/lib/wedjat/intake/autonomy';
import type { IntakeListPayload } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const sources = await db.sourceDatabase.findMany({
        where: { orgId: principal.org.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const sourceIds = sources.map((s) => s.id);
      const latestRuns = sourceIds.length
        ? await db.intakeRun.findMany({
            where: { sourceDatabaseId: { in: sourceIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const runBySource = new Map<string, typeof latestRuns[number]>();
      for (const r of latestRuns) {
        if (!runBySource.has(r.sourceDatabaseId)) runBySource.set(r.sourceDatabaseId, r);
      }

      // §113 review queue counts
      const pendingMappings = sourceIds.length
        ? await db.canonicalMapping.count({
            where: { orgId: principal.org.id, sourceDatabaseId: { in: sourceIds }, decision: 'PENDING_REVIEW' },
          })
        : 0;
      const pendingCandidates = sourceIds.length
        ? await db.trainingCandidate.count({
            where: { orgId: principal.org.id, sourceDatabaseId: { in: sourceIds }, status: 'TRAINING_CANDIDATE' },
          })
        : 0;
      const openImprovements = await db.improvementQueueItem.count({
        where: { orgId: principal.org.id, status: 'OPEN' },
      });

      const autonomy = await getAutonomyState(principal.org.id);

      const payload: IntakeListPayload = {
        sources: sources.map((s) => toSourceDto(s, runBySource.get(s.id) ?? null)),
        reviewQueue: { mappings: pendingMappings, candidates: pendingCandidates },
        autonomy: { level: autonomy.level, label: autonomy.label, description: autonomy.description },
        openImprovements,
      };
      return ok(payload);
    } catch (err) {
      return failFrom(err);
    }
  });
}
