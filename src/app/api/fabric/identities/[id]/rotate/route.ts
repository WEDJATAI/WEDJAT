// WEDJAT v4 — POST /api/fabric/identities/[id]/rotate (ADMIN+) — issue a new
// key; the old key stops working immediately (§8 rotating API keys).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { rotateServiceIdentity } from '@/lib/wedjat/fabric/identity';
import type { ServiceIdentityCreatedDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { id } = await params;
      const rotated = await rotateServiceIdentity(principal.org.id, id, principal.userId);
      const row = await db.serviceIdentity.findUniqueOrThrow({ where: { id } });
      const dto: ServiceIdentityCreatedDto = {
        id,
        platformSlug: row.platformSlug,
        name: row.name,
        keyPreview: rotated.keyPreview,
        scopes: rotated.scopes,
        status: 'ACTIVE',
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        rotatedAt: row.rotatedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        apiKey: rotated.apiKey,
      };
      return ok(dto);
    } catch (err) {
      return failFrom(err);
    }
  });
}
