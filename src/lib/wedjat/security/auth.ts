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
import type { Principal, LoginUserOption } from '../types';
import { logger } from '../logger';

export const SESSION_COOKIE = 'wedjat_session';
/** Shared demo password (override via WEDJAT_DEMO_PASSWORD env). */
export const DEMO_PASSWORD = process.env.WEDJAT_DEMO_PASSWORD || 'wedjat';

/** Demo password hashing — sha256 with static salt is acceptable for seeded demo identities. */
function hashPassword(pw: string): string {
  return sha256(`wedjat::${pw}::v1`);
}

/**
 * Demo sign-in normalization (fix for "demo sign in doesn't work"):
 * all seeded identities share ONE demo password, so the comparison tolerates
 * case variants and stray surrounding whitespace ("Wedjat", " wedjat ", …)
 * which are the most common demo-login failures. Real per-user credentials
 * (when they exist) would use the exact hash only.
 */
function demoPasswordMatches(pw: string, storedHash: string): boolean {
  const trimmed = pw.trim();
  const candidates = [trimmed, trimmed.toLowerCase()];
  return candidates.some((c) => safeEqual(hashPassword(c), storedHash));
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
  const valid = user ? demoPasswordMatches(password, user.passwordHash) : false;
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
