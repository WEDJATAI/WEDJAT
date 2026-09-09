// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — /api/admin/users (§53).
//
// GET    → list organization users (ADMIN/OWNER).
// POST   → create a user (ADMIN/OWNER).
// PATCH  → update status/role/name/password (ADMIN/OWNER), with guards against
//          self-lockout and disabling the last active OWNER.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import {
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  requireAdminRole,
} from '@/lib/wedjat/security/auth';
import { recordAudit } from '@/lib/wedjat/observability/audit';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const users = await adminListUsers(principal.org.id);
      return ok({ users });
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const body = await readJson<{ email?: string; name?: string; role?: string; password?: string }>(req);
      const user = await adminCreateUser(principal.org.id, {
        email: requireString(body.email, 'email', 200),
        name: requireString(body.name, 'name', 100),
        role: requireString(body.role, 'role', 20),
        password: requireString(body.password, 'password', 200),
      });
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'admin.user_created',
        targetType: 'user',
        targetId: user.id,
        details: { email: user.email, role: user.role },
      });
      return ok({ user }, 201);
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const body = await readJson<{
        userId?: string;
        status?: 'ACTIVE' | 'DISABLED';
        role?: string;
        name?: string;
        password?: string;
      }>(req);
      const user = await adminUpdateUser(principal, {
        userId: requireString(body.userId, 'userId', 64),
        status: body.status,
        role: body.role,
        name: body.name,
        password: body.password,
      });
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'admin.user_updated',
        targetType: 'user',
        targetId: user.id,
        details: {
          status: user.status,
          role: user.role,
          passwordReset: Boolean(body.password),
        },
      });
      return ok({ user });
    } catch (err) {
      return failFrom(err);
    }
  });
}
