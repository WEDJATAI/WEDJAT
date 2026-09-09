// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Open Access mode (user-directed temporary login bypass).
//
// WHY: the OWNER reported their credentials are not working and explicitly
// requested "don't make login with credentials for now". In Open Access mode
// the principal is resolved server-side to the organization's primary OWNER
// whenever no live session exists — the app becomes usable without login
// while ALL server-side org scoping, role gates, audit logging and the
// /api/v1 service-identity layer remain fully enforced.
//
// Toggle (either, env wins for hard lock-down; DB row works WITHOUT redeploy):
//   • env      WEDJAT_OPEN_ACCESS=true
//   • DB       ConfigVersion key 'access.mode' ACTIVE value {"mode":"OPEN"}
//
// v4 §122: this change is classified ADDITIVE — no session/login code path
// was removed; sessions still work and take precedence when present.
// Re-enable credential login at any time: archive the access.mode row (or
// set {"mode":"STANDARD"}) and remove the env var.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { sha256 } from '../ids';
import type { Principal } from '../types';
import { logger } from '../logger';

export const ACCESS_MODE_CONFIG_KEY = 'access.mode';
const TTL_MS = 15_000;

let cacheAt = 0;
let cachedOpen: boolean | null = null;

async function primaryOrgId(): Promise<string | null> {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return org?.id ?? null;
}

/** Reads the org-managed access.mode row (absent → null). */
async function dbOpenAccess(): Promise<boolean | null> {
  try {
    const orgId = await primaryOrgId();
    if (!orgId) return null;
    const row = await db.configVersion.findFirst({
      where: { orgId, key: ACCESS_MODE_CONFIG_KEY, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { valueJson: true },
    });
    if (!row) return null;
    const parsed = JSON.parse(row.valueJson) as { mode?: string };
    return parsed?.mode === 'OPEN';
  } catch {
    return null; // DB unreachable → env decision only
  }
}

/** TTL-cached open-access decision (env OR org-managed DB row). */
export async function isOpenAccess(): Promise<boolean> {
  if (process.env.WEDJAT_OPEN_ACCESS === 'true') return true;
  if (cachedOpen !== null && Date.now() - cacheAt < TTL_MS) return cachedOpen;
  cachedOpen = await dbOpenAccess();
  cacheAt = Date.now();
  return cachedOpen ?? false;
}

/** Clears the TTL cache (call after the access mode row changes). */
export function resetOpenAccessCache(): void {
  cacheAt = 0;
  cachedOpen = null;
}

/**
 * The Open Access principal: the primary organization's first OWNER (falls
 * back to the earliest user when no OWNER exists). Never fabricates an org.
 */
export async function openAccessPrincipal(): Promise<Principal | null> {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    include: { users: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!org) return null;
  // 'ADMIN' < 'AUDITOR' < 'CURATOR' < 'MEMBER' < 'OWNER' alphabetically — the
  // orderBy above surfaces OWNER first; any user is acceptable as fallback.
  const owner = org.users.find((u) => u.role === 'OWNER') ?? org.users[0];
  if (!owner) return null;
  logger.debug('open_access_principal', { userId: owner.id });
  return {
    userId: owner.id,
    name: owner.name,
    email: owner.email,
    role: owner.role as Principal['role'],
    org: { id: org.id, slug: org.slug, name: org.name, dataPolicy: org.dataPolicy },
    authMethod: 'OPEN_ACCESS',
  };
}

/** Stable non-secret digest of the open-access decision for audit context. */
export function accessModeDigest(open: boolean): string {
  return sha256(`access::${open ? 'OPEN' : 'STANDARD'}`).slice(0, 12);
}
