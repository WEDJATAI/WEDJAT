// WEDJAT v4 — POST /api/v1/outcomes (§43/§44/§66): platforms report measured
// outcomes of recommendations (before/after metrics). This is the feedback
// half of the closed learning loop (§65).
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface OutcomeBody {
  platform?: string;
  recommendationId?: string;
  outcome?: string;
  metricName?: string;
  beforeValue?: string;
  afterValue?: string;
  notes?: string;
}

const OUTCOMES = ['IMPLEMENTED', 'NOT_IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'FAILED', 'REVERTED', 'VALIDATED'];

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['events:write'], {}, async ({ identity }) => {
    const body = await readServiceJson<OutcomeBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");
    if (typeof body.outcome !== 'string' || !OUTCOMES.includes(body.outcome.toUpperCase())) {
      return fail('VALIDATION', `field 'outcome' must be one of ${OUTCOMES.join('|')}`);
    }
    if (!body.recommendationId && (body.beforeValue === undefined || body.afterValue === undefined)) {
      // Measured outcome without a recommendation reference is still valuable
      // (§44: deployment/performance outcomes) — allowed, recorded as knowledge.
    }
    const normalized = validateEnvelope(
      {
        eventType: 'outcome.reported',
        criticality: 'HIGH',
        sourcePlatform: platform,
        payload: {
          title: `Outcome (${body.outcome.toUpperCase()}) — ${platform}`,
          recommendationId: body.recommendationId,
          outcome: body.outcome.toUpperCase(),
          metricName: body.metricName,
          beforeValue: body.beforeValue,
          afterValue: body.afterValue,
          notes: body.notes,
          before: body.beforeValue,
          after: body.afterValue,
          content: [
            `# Outcome report — ${platform}`,
            '',
            `- Outcome: **${body.outcome.toUpperCase()}**`,
            body.recommendationId ? `- Recommendation: ${body.recommendationId}` : '',
            body.metricName ? `- Metric: ${body.metricName}` : '',
            body.beforeValue !== undefined || body.afterValue !== undefined
              ? `- Measured: ${body.beforeValue ?? '?'} → ${body.afterValue ?? '?'}`
              : '',
            body.notes ? `- Notes: ${body.notes.slice(0, 500)}` : '',
            '',
            '_Measured evidence preferred over assumptions (v4 §44/§67)._',
          ].filter(Boolean).join('\n'),
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
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'outcome already received (idempotent §58)' }
      : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: 'outcome accepted — measured learning will update knowledge (§65 closed loop)' };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
