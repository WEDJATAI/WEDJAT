// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Server-side authentication & authorization (§53).
//
// WHY: the client is NEVER trusted with org/user/platform/blueprint ids.
// The principal is resolved server-side from the session cookie (or the
// Bearer token in cookie-blocked embedded contexts); org scoping is
// enforced on every query by orgId derived from the session, not the request.
// ═══════════════════════════════════════════════════════════════════════════════

import { cookies, headers } from 'next/headers';
import { db } from '@/lib/db';
import { sha256, safeEqual, newSessionToken } from '../ids';
import { WedjatError } from '../errors';
import type { Principal } from '../types';
import { logger } from '../logger';

export const SESSION_COOKIE = 'wedjat_session';

/** Credential hashing — sha256 with static salt. */
function hashPassword(pw: string): string {
  return sha256(`wedjat::${pw}::v1`);
}

/** Exact (timing-safe) credential comparison — real credentials, no tolerance. */
function passwordMatches(pw: string, storedHash: string): boolean {
  return safeEqual(hashPassword(pw), storedHash);
}

/**
 * Session token from the `Authorization: Bearer <token>` header.
 *
 * WHY: the preview panel renders this app inside a cross-site iframe, where
 * browsers drop `SameSite=Lax` session cookies (third-party cookie blocking).
 * The login response therefore mirrors the session token in its JSON body;
 * the client persists it and echoes it as a Bearer header. The principal is
 * still resolved 100% server-side from that token — org scoping and role
 * gates remain enforced exactly as with the cookie path.
 */
async function bearerToken(): Promise<string | null> {
  const authz = (await headers()).get('authorization');
  if (!authz || !authz.toLowerCase().startsWith('bearer ')) return null;
  const token = authz.slice(7).trim();
  return token || null;
}

/** All candidate session tokens for this request (cookie first, then bearer). */
async function candidateSessionTokens(): Promise<string[]> {
  const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const headerToken = await bearerToken();
  const tokens = [cookieToken, headerToken].filter(
    (t): t is string => typeof t === 'string' && t.length > 0
  );
  return [...new Set(tokens)];
}

/** Resolves the active session token (cookie or bearer) — used by logout. */
export async function resolveSessionToken(): Promise<string | undefined> {
  return (await candidateSessionTokens())[0];
}

/**
 * Resolves the current principal from the session cookie OR the bearer
 * header (server-side only). Tries each candidate token; throws
 * UNAUTHORIZED when none maps to a live session.
 */
export async function getPrincipal(): Promise<Principal> {
  const tokens = await candidateSessionTokens();
  if (tokens.length === 0) throw new WedjatError('UNAUTHORIZED', 'No session');
  let lastErr: unknown = null;
  for (const token of tokens) {
    try {
      return await getPrincipalByToken(token);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new WedjatError('UNAUTHORIZED', 'Session invalid or expired');
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
  const valid = user ? passwordMatches(password, user.passwordHash) : false;
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

// ── Account self-service (real credentials) ─────────────────────────────────

export interface CredentialChange {
  currentPassword: string;
  email?: string;
  name?: string;
  newPassword?: string;
}

/**
 * Self-service credential change. Requires the CURRENT password; changing the
 * password revokes every other session (the caller's session survives).
 * The new username/email must be unique — mapped to a clean VALIDATION error.
 */
export async function changeOwnCredentials(
  userId: string,
  change: CredentialChange
): Promise<Principal> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { org: true } });
  if (!user) throw new WedjatError('UNAUTHORIZED', 'Session user no longer exists');
  if (!passwordMatches(change.currentPassword, user.passwordHash)) {
    throw new WedjatError('UNAUTHORIZED', 'Current password is incorrect');
  }

  const data: { email?: string; name?: string; passwordHash?: string } = {};
  if (change.email !== undefined) {
    const email = change.email.toLowerCase().trim();
    if (email.length < 3 || email.length > 200 || /\s/.test(email)) {
      throw new WedjatError('VALIDATION', 'Username must be 3-200 characters without spaces');
    }
    if (email !== user.email) {
      const clash = await db.user.findUnique({ where: { email } });
      if (clash && clash.id !== user.id) {
        throw new WedjatError('VALIDATION', 'That username is already taken');
      }
      data.email = email;
    }
  }
  if (change.name !== undefined) {
    const name = change.name.trim();
    if (name.length < 2 || name.length > 100) {
      throw new WedjatError('VALIDATION', 'Display name must be 2-100 characters');
    }
    data.name = name;
  }
  if (change.newPassword !== undefined && change.newPassword !== '') {
    if (change.newPassword.length < 8 || change.newPassword.length > 200) {
      throw new WedjatError('VALIDATION', 'New password must be 8-200 characters');
    }
    data.passwordHash = hashPassword(change.newPassword);
  }
  if (Object.keys(data).length === 0) {
    throw new WedjatError('VALIDATION', 'Nothing to change');
  }

  const updated = await db.user.update({ where: { id: user.id }, data, include: { org: true } });

  if (data.passwordHash) {
    // Password changed: revoke every OTHER session, keep the caller alive.
    const keep = await resolveSessionToken();
    await db.session.deleteMany({
      where: { userId: user.id, ...(keep ? { token: { not: keep } } : {}) },
    });
  }

  return principalOf(updated);
}

function principalOf(user: { id: string; name: string; email: string; role: string; orgId: string; org: { slug: string; name: string; dataPolicy: string } }): Principal {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Principal['role'],
    org: { id: user.orgId, slug: user.org.slug, name: user.org.name, dataPolicy: user.org.dataPolicy },
  };
}

// ── User administration (OWNER / ADMIN) ──────────────────────────────────────

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt: string;
  lastActiveAt: string | null;
}

const ROLES = new Set(['OWNER', 'ADMIN', 'CURATOR', 'MEMBER', 'AUDITOR']);

/** Owner/admin listing for the Settings → Users tab. */
export async function adminListUsers(orgId: string): Promise<AdminUserRow[]> {
  const users = await db.user.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    include: { sessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    lastActiveAt: u.sessions[0]?.createdAt.toISOString() ?? null,
  }));
}

export interface NewUserInput {
  email: string;
  name: string;
  role: string;
  password: string;
}

/** Creates a user inside the admin's org with an org-wide membership. */
export async function adminCreateUser(orgId: string, input: NewUserInput): Promise<AdminUserRow> {
  const email = input.email.toLowerCase().trim();
  if (email.length < 3 || email.length > 200 || /\s/.test(email)) {
    throw new WedjatError('VALIDATION', 'Username must be 3-200 characters without spaces');
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) {
    throw new WedjatError('VALIDATION', 'Display name must be 2-100 characters');
  }
  if (!ROLES.has(input.role)) {
    throw new WedjatError('VALIDATION', 'Role must be one of OWNER/ADMIN/CURATOR/MEMBER/AUDITOR');
  }
  if (input.password.length < 8 || input.password.length > 200) {
    throw new WedjatError('VALIDATION', 'Password must be 8-200 characters');
  }
  const clash = await db.user.findUnique({ where: { email } });
  if (clash) throw new WedjatError('VALIDATION', 'That username is already taken');

  const user = await db.user.create({
    data: { orgId, email, name, role: input.role, passwordHash: hashPassword(input.password) },
  });
  await db.membership.create({ data: { userId: user.id, orgId, scope: '*' } });
  return {
    id: user.id, email: user.email, name: user.name, role: user.role, status: user.status,
    createdAt: user.createdAt.toISOString(), lastActiveAt: null,
  };
}

export interface UserUpdateInput {
  userId: string;
  status?: 'ACTIVE' | 'DISABLED';
  role?: string;
  name?: string;
  password?: string;
}

/** Updates a user; guards self-lockout and the last active OWNER. */
export async function adminUpdateUser(
  actor: Principal,
  input: UserUpdateInput
): Promise<AdminUserRow> {
  const target = await db.user.findUnique({ where: { id: input.userId }, include: { org: true } });
  if (!target || target.orgId !== actor.org.id) {
    throw new WedjatError('NOT_FOUND', 'User not found in this organization');
  }
  const data: { status?: string; role?: string; name?: string; passwordHash?: string } = {};

  if (input.status !== undefined) {
    if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') {
      throw new WedjatError('VALIDATION', 'Status must be ACTIVE or DISABLED');
    }
    if (target.id === actor.userId && input.status === 'DISABLED') {
      throw new WedjatError('VALIDATION', 'You cannot disable your own account');
    }
    if (target.role === 'OWNER' && input.status === 'DISABLED') {
      const activeOwners = await db.user.count({ where: { orgId: actor.org.id, role: 'OWNER', status: 'ACTIVE' } });
      if (activeOwners <= 1) {
        throw new WedjatError('VALIDATION', 'Cannot disable the last active OWNER of the organization');
      }
    }
    data.status = input.status;
    if (input.status === 'DISABLED') {
      await db.session.deleteMany({ where: { userId: target.id } });
    }
  }
  if (input.role !== undefined) {
    if (!ROLES.has(input.role)) {
      throw new WedjatError('VALIDATION', 'Role must be one of OWNER/ADMIN/CURATOR/MEMBER/AUDITOR');
    }
    if (target.id === actor.userId && input.role !== target.role && target.role === 'OWNER') {
      const activeOwners = await db.user.count({ where: { orgId: actor.org.id, role: 'OWNER', status: 'ACTIVE' } });
      if (activeOwners <= 1) {
        throw new WedjatError('VALIDATION', 'Cannot demote the last active OWNER of the organization');
      }
    }
    data.role = input.role;
  }
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) {
      throw new WedjatError('VALIDATION', 'Display name must be 2-100 characters');
    }
    data.name = name;
  }
  if (input.password !== undefined && input.password !== '') {
    if (input.password.length < 8 || input.password.length > 200) {
      throw new WedjatError('VALIDATION', 'Password must be 8-200 characters');
    }
    data.passwordHash = hashPassword(input.password);
  }
  if (Object.keys(data).length === 0) {
    throw new WedjatError('VALIDATION', 'Nothing to update');
  }

  const updated = await db.user.update({
    where: { id: target.id },
    data,
    include: { sessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
  });
  if (data.passwordHash) {
    await db.session.deleteMany({ where: { userId: target.id } });
  }
  return {
    id: updated.id, email: updated.email, name: updated.name, role: updated.role,
    status: updated.status, createdAt: updated.createdAt.toISOString(),
    lastActiveAt: updated.sessions[0]?.createdAt.toISOString() ?? null,
  };
}

export { hashPassword };

// ── Role gates ────────────────────────────────────────────────────────────────

const MUTATION_ROLES = new Set(['OWNER', 'ADMIN', 'CURATOR']);
const READ_ONLY_ROLES = new Set(['AUDITOR', 'MEMBER']);
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/** Owner/admin gate for user administration and platform settings. */
export function requireAdminRole(p: Principal): void {
  if (!ADMIN_ROLES.has(p.role)) {
    throw new WedjatError('FORBIDDEN', 'User administration requires ADMIN or OWNER');
  }
}

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
