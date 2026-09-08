import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { retryJob, cancelJob } from '@/lib/wedjat/observability/jobs';
import { WedjatError } from '@/lib/wedjat/errors';
import type { JobDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async () => {
    const status = new URL(req.url).searchParams.get('status') ?? undefined;
    const jobs = await db.job.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const dtos: JobDto[] = jobs.map(toDto);
    return ok(dtos);
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    requireMutationRole(principal);
    const body = await readJson<{ action?: string; jobId?: string }>(req);
    const action = body.action ?? '';
    const jobId = body.jobId ?? '';
    if (!jobId) throw new WedjatError('VALIDATION', 'jobId is required');
    if (action === 'retry') {
      await retryJob(jobId);
    } else if (action === 'cancel') {
      await cancelJob(jobId);
    } else {
      throw new WedjatError('VALIDATION', "action must be 'retry' or 'cancel'");
    }
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) throw new WedjatError('NOT_FOUND', 'Job not found');
    return ok(toDto(job));
  });
}

function toDto(j: { id: string; type: string; status: string; progress: number; attempts: number; maxAttempts: number; lastError: string | null; payloadJson: string; createdAt: Date; completedAt: Date | null }): JobDto {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(j.payloadJson) as Record<string, unknown>;
    if (parsed && typeof parsed.input === 'object' && parsed.input !== null) {
      const input = parsed.input as Record<string, unknown>;
      if (typeof input.content === 'string') {
        input.content = `${input.content.slice(0, 80)}…[redacted]`;
      }
    }
    payload = parsed;
  } catch {
    payload = {};
  }
  return {
    id: j.id,
    type: j.type,
    status: j.status as JobDto['status'],
    progress: j.progress,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    lastError: j.lastError,
    payload,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}
