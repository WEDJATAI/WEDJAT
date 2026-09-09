// WEDJAT v4 — POST /api/v1/learning-candidates (§44/§45): platforms submit
// validated solutions/lessons as training material with mandatory provenance.
// Candidates flow through the standard ingestion pipeline (governed by the
// existing quality gates — §47 synthetic data validation).
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface CandidateBody {
  platform?: string;
  taskType?: string; // QA | SUMMARY | CLASSIFICATION | ARCHITECTURE_ANALYSIS | …
  input?: string;
  output?: string;
  evidence?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['training:candidate'], {}, async ({ identity }) => {
    const body = await readServiceJson<CandidateBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");
    if (typeof body.input !== 'string' || body.input.trim().length < 8) {
      return fail('VALIDATION', "field 'input' is required (min 8 chars)");
    }
    if (typeof body.output !== 'string' || body.output.trim().length < 8) {
      return fail('VALIDATION', "field 'output' is required (min 8 chars)");
    }
    const taskType = (body.taskType ?? 'QA').toUpperCase().slice(0, 40);
    const normalized = validateEnvelope(
      {
        eventType: 'training.example.created',
        sourcePlatform: platform,
        payload: {
          title: `Learning candidate (${taskType}) — ${platform}`,
          taskType,
          content: [
            `# Learning candidate — ${taskType}`,
            '',
            '## Input',
            body.input.slice(0, 8000),
            '',
            '## Output',
            body.output.slice(0, 8000),
            body.evidence ? `\n## Evidence\n${body.evidence.slice(0, 4000)}` : '',
            '',
            `_Submitted by platform '${platform}' via the Intelligence API (v4 §44). Validation gates apply (§47)._`,
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
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'candidate already received (idempotent §58)' }
      : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: 'candidate accepted — quality gates + review apply before any training use (§47)' };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
