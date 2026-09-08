import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { registerFeedbackSources } from '@/lib/wedjat/training/lifecycle';
import { WedjatError } from '@/lib/wedjat/errors';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import type { FeedbackDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_LABELS = [
  'CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT', 'UNSUPPORTED',
  'HALLUCINATION', 'OUTDATED', 'HIGH_VALUE', 'LOW_VALUE',
];

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const body = await readJson<{ generationId?: string; label?: string; comment?: string }>(req);
    const generationId = requireString(body.generationId, 'generationId', 100);
    const label = requireString(body.label, 'label', 40);
    if (!VALID_LABELS.includes(label)) {
      throw new WedjatError('VALIDATION', `label must be one of ${VALID_LABELS.join(', ')}`);
    }

    // Ownership check: generation must belong to the principal's org.
    const generation = await db.aiGeneration.findUnique({
      where: { id: generationId },
      include: { message: { include: { conversation: true } } },
    });
    if (!generation || generation.message?.conversation.orgId !== principal.org.id) {
      throw new WedjatError('NOT_FOUND', 'Generation not found');
    }

    const feedback = await db.feedback.create({
      data: {
        generationId,
        userId: principal.userId,
        label,
        comment: body.comment?.slice(0, 2000),
      },
    });

    // §34: feedback drives the training-eligibility loop.
    await registerFeedbackSources(principal, generationId, label);
    // §72: negative labels become failure-memory entries.
    if (['INCORRECT', 'HALLUCINATION', 'UNSUPPORTED', 'OUTDATED'].includes(label)) {
      const userQuestion = await db.message.findFirst({
        where: { conversationId: generation.message!.conversationId, role: 'USER', createdAt: { lte: generation.message!.createdAt } },
        orderBy: { createdAt: 'desc' },
      });
      await db.failureMemory.create({
        data: {
          orgId: principal.org.id,
          question: userQuestion?.content.slice(0, 500) ?? 'unknown question',
          failureType: label === 'HALLUCINATION' ? 'HALLUCINATION' : label === 'OUTDATED' ? 'ONGOING' : 'INCORRECT_ANSWER',
          reason: body.comment?.slice(0, 500) ?? `human label ${label}`,
          modelVersion: generation.model,
        },
      });
    }

    await recordAudit({
      orgId: principal.org.id,
      actorType: 'user',
      actorId: principal.userId,
      action: 'feedback.submitted',
      targetType: 'aiGeneration',
      targetId: generationId,
      details: { label },
    });

    const dto: FeedbackDto = {
      id: feedback.id,
      generationId,
      label,
      comment: feedback.comment,
      userName: principal.name,
      createdAt: feedback.createdAt.toISOString(),
      questionExcerpt: (generation.message?.content ?? '').slice(0, 120),
    };
    return ok(dto, 201);
  });
}

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const feedback = await db.feedback.findMany({
      where: { user: { orgId: principal.org.id } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true } }, generation: { include: { message: true } } },
    });
    const dtos: FeedbackDto[] = feedback.map((f) => ({
      id: f.id,
      generationId: f.generationId,
      label: f.label,
      comment: f.comment,
      userName: f.user.name,
      createdAt: f.createdAt.toISOString(),
      questionExcerpt: (f.generation?.message?.content ?? '').slice(0, 120),
    }));
    return ok(dtos);
  });
}
