// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — POST /api/account/credentials (§53).
//
// Self-service credential change for the signed-in principal: display name,
// username (email field) and password. The CURRENT password is always
// required; changing the password revokes every other session.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { changeOwnCredentials } from '@/lib/wedjat/security/auth';
import { recordAudit } from '@/lib/wedjat/observability/audit';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const body = await readJson<{
        currentPassword?: string;
        email?: string;
        name?: string;
        newPassword?: string;
      }>(req);
      const currentPassword = requireString(body.currentPassword, 'currentPassword', 200);
      const updated = await changeOwnCredentials(principal.userId, {
        currentPassword,
        email: body.email,
        name: body.name,
        newPassword: body.newPassword,
      });
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'account.credentials_changed',
        targetType: 'user',
        targetId: principal.userId,
        details: {
          usernameChanged: updated.email !== principal.email,
          nameChanged: updated.name !== principal.name,
          passwordChanged: Boolean(body.newPassword),
        },
      });
      return ok({ principal: updated });
    } catch (err) {
      return failFrom(err);
    }
  });
}
