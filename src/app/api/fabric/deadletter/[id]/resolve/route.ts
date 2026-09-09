// WEDJAT v4 — POST /api/fabric/deadletter/[id]/resolve (ADMIN+) — §60: dead
// events are never silently discarded; resolution is explicit + audited.
// Body: { note?: string, replay?: boolean }
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { after } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { id } = await params;
      const body = await readJson<{ note?: string; replay?: boolean }>(req).catch(() => ({}) as { note?: string; replay?: boolean });
      const dlq = await db.deadLetterEvent.findFirst({ where: { id, orgId: principal.org.id } });
      if (!dlq) return ok({ resolved: false, message: 'dead-letter entry not found' }, 404);
      if (dlq.resolved) return ok({ resolved: true, message: 'already resolved' });

      if (body.replay) {
        // Fresh dispatch attempt with a reset attempt counter (bounded again).
        await db.eventRecord.update({
          where: { id: dlq.eventRecordId },
          data: { attempts: 0, status: 'RECEIVED', processingError: null },
        });
        const { jobId } = await enqueueJob(
          { kind: 'fabric-dispatch', orgId: principal.org.id, userId: principal.userId, eventRecordId: dlq.eventRecordId },
          { idempotencyKey: `dlq-replay-${dlq.id}-${Date.now()}` }
        );
        after(async () => { await processJobNow(jobId).catch(() => {}); });
      }

      await db.deadLetterEvent.update({
        where: { id: dlq.id },
        data: {
          resolved: true,
          resolvedById: principal.userId,
          resolutionNote: (body.note ?? (body.replay ? 'replayed from DLQ' : 'resolved manually')).slice(0, 500),
          resolvedAt: new Date(),
        },
      });
      await recordAudit({
        orgId: principal.org.id, actorType: 'user', actorId: principal.userId,
        action: 'dead_letter.resolved', targetType: 'DeadLetterEvent', targetId: dlq.id,
        severity: 'INFO', detailsJson: JSON.stringify({ replayed: Boolean(body.replay) }),
      });
      return ok({ resolved: true, replayed: Boolean(body.replay) });
    } catch (err) {
      return failFrom(err);
    }
  });
}
