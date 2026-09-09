// WEDJAT v4 — GET /api/fabric/registry (§87/§88): the org-wide learning network
// registry — platform coordinates, connection state, knowledge coverage.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { toRegistryDtos } from '@/lib/wedjat/fabric/registry';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const platforms = await db.platform.findMany({
        where: { orgId: principal.org.id },
        orderBy: { createdAt: 'asc' },
      });
      const registry = await toRegistryDtos(principal.org.id, platforms);
      return ok({ registry });
    } catch (err) {
      return failFrom(err);
    }
  });
}
