// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — POST /api/intake/[id]/reprocess (§145).
//
// Re-runs the intake pipeline on the PRESERVED source artifact with the CURRENT
// engine version — the user never re-uploads the source. Old runs remain
// immutable; knowledge supersession is handled by §158 in the engine.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { INTAKE_ENGINE_VERSION } from '@/lib/wedjat/intake/engine';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { recordAudit } from '@/lib/wedjat/observability/audit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);
      const { id } = await params;
      const source = await db.sourceDatabase.findFirst({ where: { id, orgId: principal.org.id } });
      if (!source) throw new WedjatError('NOT_FOUND', 'Source database not found');
      // Serverless: the DB blob (§108) is authoritative; the FS path is a cache.
      if (!source.artifactData && (!source.artifactPath || source.artifactPath === 'pending')) {
        throw new WedjatError('VALIDATION', 'Source artifact is not available for reprocessing');
      }

      const activeRun = await db.intakeRun.findFirst({
        where: { sourceDatabaseId: source.id, status: { in: ['RAW', 'STAGED', 'ANALYZED', 'MAPPED', 'VALIDATED'] } },
      });
      if (activeRun) {
        throw new WedjatError('VALIDATION', `an intake run is already in progress (${activeRun.status})`);
      }

      const run = await db.intakeRun.create({
        data: {
          sourceDatabaseId: source.id,
          orgId: principal.org.id,
          status: 'RAW',
          trigger: 'REPROCESS',
          engineVersion: INTAKE_ENGINE_VERSION,
        },
      });
      const { jobId } = await enqueueJob(
        { kind: 'database-intake', orgId: principal.org.id, userId: principal.userId, runId: run.id },
        { idempotencyKey: `intake-run-${run.id}` }
      );
      await db.intakeRun.update({ where: { id: run.id }, data: { jobId } });
      await db.sourceDatabase.update({
        where: { id: source.id },
        data: { status: 'PROCESSING', latestRunId: run.id },
      });
      // Deterministic serverless execution (same pattern as the upload route).
      after(async () => {
        try {
          await processJobNow(jobId);
        } catch {
          // Job stays queued for the interval worker; failures surface on the run.
        }
      });
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'intake.reprocess',
        targetType: 'sourceDatabase',
        targetId: source.id,
        severity: 'INFO',
        details: { runId: run.id, engineVersion: INTAKE_ENGINE_VERSION },
      });

      return ok({ runId: run.id, jobId });
    } catch (err) {
      return failFrom(err);
    }
  });
}
