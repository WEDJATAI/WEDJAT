// WEDJAT v4 — POST /api/fabric/registry/[slug]/disconnect (ADMIN+) — §114:
// disconnection changes the connection status ONLY. Knowledge, events,
// provenance and history are preserved.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { disconnectPlatform, toRegistryDtos } from '@/lib/wedjat/fabric/registry';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { slug } = await params;
      const platform = await disconnectPlatform(principal.org.id, slug, principal.userId);
      const [dto] = await toRegistryDtos(principal.org.id, [platform]);
      return ok(dto);
    } catch (err) {
      return failFrom(err);
    }
  });
}
