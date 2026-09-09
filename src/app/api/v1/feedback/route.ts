// WEDJAT v4 — POST /api/v1/feedback (§58): platforms report answer validations
// and corrections. Corrections are ADDITIONS (§8): new knowledge + lineage +
// improvement signal — the previous answer is never erased.
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface FeedbackBody {
  platform?: string;
  question?: string;
  answer?: string;
  correction?: string;
  reason?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['feedback:write'], {}, async ({ identity }) => {
    const body = await readServiceJson<FeedbackBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");
    if (typeof body.question !== 'string' || body.question.trim().length < 8) {
      return fail('VALIDATION', "field 'question' is required (min 8 chars)");
    }
    const isCorrection = typeof body.correction === 'string' && body.correction.trim().length > 0;
    if (!isCorrection && (typeof body.answer !== 'string' && body.answer !== undefined)) {
      // validation-only feedback: answer present, no correction
    } else if (!isCorrection && body.answer === undefined) {
      return fail('VALIDATION', "provide 'answer' (validation) or 'correction' (correction)");
    }
    const normalized = validateEnvelope(
      {
        eventType: isCorrection ? 'ai.answer.corrected' : 'feedback.submitted',
        sourcePlatform: platform,
        payload: {
          title: isCorrection ? `Answer correction — ${platform}` : `Answer feedback — ${platform}`,
          question: body.question.slice(0, 2000),
          answer: body.answer?.slice(0, 4000),
          corrected: isCorrection ? body.correction?.slice(0, 4000) : undefined,
          previous: body.answer?.slice(0, 2000),
          correctedFull: isCorrection ? body.correction?.slice(0, 4000) : undefined,
          reason: body.reason?.slice(0, 1000),
          content: [
            `# ${isCorrection ? 'Correction' : 'Feedback'} — ${platform}`,
            '',
            `**Question:** ${body.question.slice(0, 500)}`,
            body.answer ? `\n**Answer given:** ${body.answer.slice(0, 800)}` : '',
            isCorrection ? `\n**Corrected answer:** ${body.correction?.slice(0, 800)}` : '',
            body.reason ? `\n**Reason:** ${body.reason.slice(0, 500)}` : '',
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
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'feedback already received (idempotent §58)' }
      : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: isCorrection ? 'correction accepted — knowledge chain will be updated additively (§8)' : 'feedback accepted — learning signal recorded' };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
