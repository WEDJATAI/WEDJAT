// WEDJAT v4 — POST /api/fabric/events/[id]/replay (ADMIN+) — §57 event replay.
// Accepts the publisher eventId OR the internal record id. Replay re-derives
// state WITHOUT deleting history (ingestion is idempotent — §58).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { replayEvent } from '@/lib/wedjat/fabric/dispatch';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { after } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { id } = await params;
      // The frontend passes the publisher eventId; accept both forms.
      const record = (await db.eventRecord.findFirst({
        where: { orgId: principal.org.id, OR: [{ eventId: id }, { id }] },
      })) ?? null;
      if (!record) {
        return ok({ replayed: false, newRecordId: null, message: 'event not found' }, 404);
      }
      const result = await replayEvent(record.id, principal.userId);
      // Ensure any freshly-dispatched follow-up work completes on serverless.
      const { jobId } = await enqueueJob(
        { kind: 'fabric-dispatch', orgId: principal.org.id, userId: principal.userId, eventRecordId: record.id },
        { idempotencyKey: `replay-${record.id}-${Date.now()}` }
      );
      after(async () => { await processJobNow(jobId).catch(() => {}); });
      return ok({ replayed: result.replayed, newRecordId: record.id, note: result.note });
    } catch (err) {
      return failFrom(err);
    }
  });
}
