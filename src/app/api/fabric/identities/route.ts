// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — GET/POST /api/fabric/identities — service identity management
// (§7-§10). POST is ADMIN+; the raw key is returned ONCE and never stored.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { createServiceIdentity } from '@/lib/wedjat/fabric/identity';
import type { ServiceIdentityDto, ServiceIdentityCreatedDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const rows = await db.serviceIdentity.findMany({
        where: { orgId: principal.org.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const identities: ServiceIdentityDto[] = rows.map((r) => ({
        id: r.id,
        platformSlug: r.platformSlug,
        name: r.name,
        keyPreview: r.keyPreview,
        scopes: JSON.parse(r.scopesJson) as string[],
        status: r.status as ServiceIdentityDto['status'],
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        rotatedAt: r.rotatedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
      return ok({ identities });
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const body = await readJson<{ platformSlug?: string; name?: string; scopes?: unknown }>(req);
      const created = await createServiceIdentity({
        orgId: principal.org.id,
        platformSlug: typeof body.platformSlug === 'string' ? body.platformSlug.trim().toLowerCase() : '',
        name: typeof body.name === 'string' ? body.name : '',
        scopes: body.scopes,
        createdById: principal.userId,
      });
      const row = await db.serviceIdentity.findUniqueOrThrow({ where: { id: created.id } });
      const dto: ServiceIdentityCreatedDto = {
        id: created.id,
        platformSlug: row.platformSlug,
        name: row.name,
        keyPreview: created.keyPreview,
        scopes: created.scopes,
        status: 'ACTIVE',
        lastUsedAt: null,
        rotatedAt: null,
        createdAt: row.createdAt.toISOString(),
        apiKey: created.apiKey,
      };
      return ok(dto, 201);
    } catch (err) {
      return failFrom(err);
    }
  });
}
