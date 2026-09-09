// WEDJAT v4 — POST /api/fabric/identities/[id]/revoke (ADMIN+) — revoke a key.
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { revokeServiceIdentity } from '@/lib/wedjat/fabric/identity';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { id } = await params;
      await revokeServiceIdentity(principal.org.id, id, principal.userId);
      return ok({ revoked: true });
    } catch (err) {
      return failFrom(err);
    }
  });
}
