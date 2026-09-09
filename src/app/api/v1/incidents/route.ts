// WEDJAT v4 — POST /api/v1/incidents (§13/§38): platforms report incidents.
// Failures become knowledge: FailureMemory entry + incident document, and the
// event is CRITICAL priority in the fabric.
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface IncidentBody {
  platform?: string;
  title?: string;
  description?: string;
  severity?: string;
  resolved?: boolean;
  resolution?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['events:write'], {}, async ({ identity }) => {
    const body = await readServiceJson<IncidentBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");
    if (typeof body.title !== 'string' || body.title.trim().length < 4) {
      return fail('VALIDATION', "field 'title' is required (min 4 chars)");
    }
    if (typeof body.description !== 'string' || body.description.trim().length < 20) {
      return fail('VALIDATION', "field 'description' is required (min 20 chars)");
    }
    const resolved = body.resolved === true;
    const normalized = validateEnvelope(
      {
        eventType: resolved ? 'incident.resolved' : 'incident.created',
        criticality: resolved ? 'NORMAL' : 'CRITICAL',
        sourcePlatform: platform,
        payload: {
          title: body.title.slice(0, 200),
          description: body.description.slice(0, 10_000),
          severity: body.severity?.slice(0, 40),
          resolved,
          resolution: body.resolution?.slice(0, 4000),
        },
      },
      platform
    );
    const appended = await appendEvent(identity.orgId, normalized, identity.id);
    let jobId: string | null = null;
    if (!appended.duplicate) {
      const queued = await enqueueJob(
        { kind: 'fabric-dispatch', orgId: identity.orgId, userId: `identity:${identity.id}`, eventRecordId: appended.eventRecordId },
        { idempotencyKey: `fabric-${normalized.idempotencyKey}` }
      );
      jobId = queued.jobId;
      after(async () => { await processJobNow(jobId as string).catch(() => {}); });
    }
    const result: EventSubmitResult = appended.duplicate
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'incident already received (idempotent §58)' }
      : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: resolved ? 'incident resolution accepted — failure memory + knowledge updated' : 'incident accepted (CRITICAL) — failure memory + knowledge will record it (§38)' };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
