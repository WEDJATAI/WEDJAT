// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Server-side authentication & authorization (§53).
//
// WHY: the client is NEVER trusted with org/user/platform/blueprint ids.
// The principal is resolved server-side from the session cookie; org scoping is
// enforced on every query by orgId derived from the session, not the request.
// ═══════════════════════════════════════════════════════════════════════════════

import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { sha256, safeEqual, newSessionToken } from '../ids';
import { WedjatError } from '../errors';
import type { Principal, LoginUserOption } from '../types';
import { logger } from '../logger';

export const SESSION_COOKIE = 'wedjat_session';
const DEMO_PASSWORD = process.env.WEDJAT_DEMO_PASSWORD || 'wedjat';

/** Demo password hashing — sha256 with static salt is acceptable for seeded demo identities. */
function hashPassword(pw: string): string {
  return sha256(`wedjat::${pw}::v1`);
}

/**
 * Resolves the current principal from the session cookie (server-side only).
 * Throws UNAUTHORIZED when no valid session exists.
 */
export async function getPrincipal(): Promise<Principal> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new WedjatError('UNAUTHORIZED', 'No session');
  return getPrincipalByToken(token);
}

export async function getPrincipalByToken(token: string): Promise<Principal> {
  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: { include: { org: true } },
    },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new WedjatError('UNAUTHORIZED', 'Session invalid or expired');
  }
  const { user } = session;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Principal['role'],
    org: { id: user.orgId, slug: user.org.slug, name: user.org.name, dataPolicy: user.org.dataPolicy },
  };
}

/** Optional variant for health endpoints. */
export async function tryGetPrincipal(): Promise<Principal | null> {
  try {
    return await getPrincipal();
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  password: string
): Promise<{ principal: Principal; token: string; expiresAt: Date }> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { org: true },
  });
  // Timing-safe compare against the stored hash; identical error either way.
  const valid = user ? safeEqual(hashPassword(password), user.passwordHash) : false;
  if (!user || !valid) {
    // Audit the failure WITHOUT logging the attempted password.
    logger.warn('login_failed', { email: email.slice(0, 3) + '***' });
    throw new WedjatError('UNAUTHORIZED', 'Invalid email or password');
  }
  if (user.status !== 'ACTIVE') throw new WedjatError('FORBIDDEN', 'User is not active');

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 12 * 3600 * 1000);
  await db.session.create({ data: { token, userId: user.id, expiresAt } });
  const principal: Principal = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Principal['role'],
    org: { id: user.orgId, slug: user.org.slug, name: user.org.name, dataPolicy: user.org.dataPolicy },
  };
  logger.info('login_ok', { userId: user.id, role: user.role });
  return { principal, token, expiresAt };
}

export async function logout(token: string | undefined): Promise<void> {
  if (token) await db.session.deleteMany({ where: { token } });
}

/** Demo user picker for the login screen. */
export async function listLoginUsers(): Promise<LoginUserOption[]> {
  const users = await db.user.findMany({
    where: { status: 'ACTIVE' },
    select: { email: true, name: true, role: true },
    orderBy: { role: 'asc' },
  });
  return users.map((u) => ({ email: u.email, name: u.name, role: u.role as LoginUserOption['role'] }));
}

export { hashPassword };

// ── Role gates ────────────────────────────────────────────────────────────────

const MUTATION_ROLES = new Set(['OWNER', 'ADMIN', 'CURATOR']);
const READ_ONLY_ROLES = new Set(['AUDITOR', 'MEMBER']);

/** Curator-level gate for ingestion/training/model mutations. */
export function requireMutationRole(p: Principal): void {
  if (!MUTATION_ROLES.has(p.role)) {
    throw new WedjatError(
      'FORBIDDEN',
      `Role ${p.role} is not permitted to perform this action (requires CURATOR or above)`
    );
  }
}

export function isReadOnly(p: Principal): boolean {
  return READ_ONLY_ROLES.has(p.role);
}
