// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — POST /api/v1/events (§13-§18, §56-§58) — the primary push
// endpoint of the Intelligence API.
//
// Envelope is validated, secret-scanned (§41), stored idempotently (§58:
// unique idempotencyKey + eventId — repeats return DUPLICATE, never double-
// knowledge) and dispatched asynchronously via the durable job system (§12:
// platforms never wait on WEDJAT processing).
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent, type RawEventInput } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['events:write'], {}, async ({ identity }) => {
    const body = await readServiceJson<RawEventInput & { platform?: string }>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) {
      return fail('VALIDATION', "field 'platform' (or sourcePlatform) is required for org-wide identities");
    }
    // Idempotency-Key header is honored when the body omits one (§15).
    const headerKey = req.headers.get('idempotency-key');
    const normalized = validateEnvelope(
      headerKey && body.idempotencyKey === undefined ? { ...body, idempotencyKey: headerKey } : body,
      platform
    );
    const appended = await appendEvent(identity.orgId, normalized, identity.id);
    await recordAudit({
      orgId: identity.orgId,
      actorType: 'system',
      actorId: `identity:${identity.id}`,
      action: 'event.received',
      targetType: 'EventRecord',
      targetId: appended.eventRecordId,
      severity: normalized.criticality === 'CRITICAL' ? 'WARN' : 'INFO',
      detailsJson: JSON.stringify({ eventType: normalized.eventType, platform, criticality: normalized.criticality }),
    });

    let jobId: string | null = null;
    if (!appended.duplicate && appended.skipped === null) {
      const queued = await enqueueJob(
        { kind: 'fabric-dispatch', orgId: identity.orgId, userId: `identity:${identity.id}`, eventRecordId: appended.eventRecordId },
        { idempotencyKey: `fabric-${normalized.idempotencyKey}` }
      );
      jobId = queued.jobId;
      // §12: acknowledge immediately; process in the after() window (serverless).
      after(async () => { await processJobNow(jobId as string).catch(() => {}); });
    }

    const result: EventSubmitResult = appended.duplicate
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'event already received (idempotent §58) — no duplicate knowledge created' }
      : appended.skipped === 'UNKNOWN_TYPE'
        ? { eventId: normalized.eventId, status: 'SKIPPED', jobId: null, message: `unknown event type '${normalized.eventType}' — event preserved, not dispatched` }
        : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: 'event accepted and queued for dispatch' };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
