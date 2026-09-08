// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — /api/intake/autonomy (§151, §152).
//
// GET: current level + capability matrix + hard governance list.
// PUT: set level 0..5 (ADMIN+). Governance overrides are code-enforced and can
// NEVER be disabled by any level (§152).
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, readJson, withPrincipal } from '@/lib/wedjat/api';
import { WedjatError } from '@/lib/wedjat/errors';
import {
  AUTONOMY_CAPABILITIES,
  GOVERNANCE_NEVER,
  getAutonomyState,
  setAutonomyLevel,
} from '@/lib/wedjat/intake/autonomy';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import type { AutonomyPayload } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

async function payloadFor(orgId: string): Promise<AutonomyPayload> {
  const state = await getAutonomyState(orgId);
  const row = await db.autonomyConfig.findUnique({ where: { orgId } });
  return {
    level: state.level,
    label: state.label,
    description: state.description,
    capabilities: AUTONOMY_CAPABILITIES.map((c) => ({
      name: c.name,
      minLevel: c.minLevel,
      enabled: state.level >= c.minLevel,
    })),
    governance: GOVERNANCE_NEVER,
    updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
  };
}

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      return ok(await payloadFor(principal.org.id));
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function PUT(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      if (principal.role !== 'OWNER' && principal.role !== 'ADMIN') {
        throw new WedjatError('FORBIDDEN', 'Only OWNER or ADMIN may change the autonomy level (§151)');
      }
      const body = await readJson<{ level?: number }>(req);
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 0 || level > 5) {
        throw new WedjatError('VALIDATION', 'level must be an integer 0..5');
      }
      await setAutonomyLevel(principal.org.id, level, principal.userId);
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'intake.autonomy_changed',
        targetType: 'autonomyConfig',
        targetId: principal.org.id,
        severity: level >= 4 ? 'WARN' : 'INFO',
        details: { level, note: 'governance overrides (§152) remain enforced at every level' },
      });
      return ok(await payloadFor(principal.org.id));
    } catch (err) {
      return failFrom(err);
    }
  });
}
