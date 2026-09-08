// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — POST /api/learning/improvements/[id] (§156).
// Acknowledge or resolve an AI improvement queue item (CURATOR+).
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, readJson, withPrincipal } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import type { ImprovementItemDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);
      const { id } = await params;
      const body = await readJson<{ action?: string }>(req);
      const action = String(body.action ?? '').toLowerCase();
      if (!['acknowledge', 'resolve'].includes(action)) {
        throw new WedjatError('VALIDATION', "action must be 'acknowledge' or 'resolve'");
      }
      const item = await db.improvementQueueItem.findFirst({ where: { id, orgId: principal.org.id } });
      if (!item) throw new WedjatError('NOT_FOUND', 'Improvement item not found');
      if (item.status === 'RESOLVED') throw new WedjatError('VALIDATION', 'item already resolved');

      const updated = await db.improvementQueueItem.update({
        where: { id: item.id },
        data:
          action === 'resolve'
            ? { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: principal.userId }
            : { status: 'ACKNOWLEDGED' },
      });
      const dto: ImprovementItemDto = {
        id: updated.id,
        kind: updated.kind,
        description: updated.description,
        priority: updated.priority,
        status: updated.status as ImprovementItemDto['status'],
        proposedAction: updated.proposedAction,
        createdAt: updated.createdAt.toISOString(),
      };
      return ok(dto);
    } catch (err) {
      return failFrom(err);
    }
  });
}
