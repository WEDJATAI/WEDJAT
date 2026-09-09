// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Service identities (§7-§10): scoped API keys for connected
// platforms calling /api/v1.
//
// SECURITY MODEL:
//   • Raw keys are generated server-side, shown to the caller EXACTLY ONCE
//     (create/rotate) and stored only as sha-256 hashes (§96: never exposed
//     through API responses or logs).
//   • Ownership is validated: an identity bound to platform "cirkle" cannot
//     submit events for "sgtx" (§8: never trust a client-supplied platform id).
//   • Scopes enforce least privilege (§10).
//   • Optional in-memory rate limiting per identity (§33) with local-memory
//     backpressure only — no external middleware in this environment.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { sha256 } from '../ids';
import { WedjatError } from '../errors';
import { logger } from '../logger';
import { recordAudit } from '../observability/audit';
import { API_SCOPES, type ApiScope } from '../types';

const KEY_PREFIX = 'wj';
const KEY_BYTES = 24; // 192-bit random → 48 hex chars

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey(platformSlug: string): { raw: string; hash: string; preview: string } {
  const slug = platformSlug.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'org';
  const raw = `${KEY_PREFIX}_${slug}_${randomHex(KEY_BYTES)}`;
  return { raw, hash: sha256(raw), preview: raw.slice(-4) };
}

export function normalizeScopes(scopes: unknown): ApiScope[] {
  if (!Array.isArray(scopes)) throw new WedjatError('VALIDATION', 'scopes must be an array');
  const out: ApiScope[] = [];
  for (const s of scopes) {
    if (typeof s !== 'string' || !API_SCOPES.includes(s as ApiScope)) {
      throw new WedjatError('VALIDATION', `unknown scope '${String(s)}' (allowed: ${API_SCOPES.join(', ')})`);
    }
    if (!out.includes(s as ApiScope)) out.push(s as ApiScope);
  }
  if (out.length === 0) throw new WedjatError('VALIDATION', 'at least one scope is required');
  return out;
}

// ── Identity lifecycle (admin, session-authenticated) ────────────────────────

export async function createServiceIdentity(input: {
  orgId: string;
  platformSlug: string;
  name: string;
  scopes: unknown;
  createdById: string;
}): Promise<{ id: string; apiKey: string; keyPreview: string; scopes: string[] }> {
  const scopes = normalizeScopes(input.scopes);
  const name = input.name.trim().slice(0, 100);
  if (name.length < 2) throw new WedjatError('VALIDATION', 'identity name is required');
  if (input.platformSlug !== '*') {
    const platform = await db.platform.findFirst({
      where: { orgId: input.orgId, slug: input.platformSlug },
    });
    if (!platform) throw new WedjatError('NOT_FOUND', `platform '${input.platformSlug}' is not registered`);
  }
  const key = generateApiKey(input.platformSlug);
  const row = await db.serviceIdentity.create({
    data: {
      orgId: input.orgId,
      platformSlug: input.platformSlug,
      name,
      keyHash: key.hash,
      keyPreview: key.preview,
      scopesJson: JSON.stringify(scopes),
      createdById: input.createdById,
    },
  });
  await recordAudit({
    orgId: input.orgId,
    actorType: 'user',
    actorId: input.createdById,
    action: 'service_identity.created',
    targetType: 'ServiceIdentity',
    targetId: row.id,
    severity: 'INFO',
    detailsJson: JSON.stringify({ platform: input.platformSlug, scopes }),
  });
  return { id: row.id, apiKey: key.raw, keyPreview: key.preview, scopes };
}

export async function rotateServiceIdentity(orgId: string, id: string, userId: string) {
  const row = await db.serviceIdentity.findFirst({ where: { id, orgId } });
  if (!row) throw new WedjatError('NOT_FOUND', 'service identity not found');
  if (row.status !== 'ACTIVE') throw new WedjatError('VALIDATION', 'identity is revoked');
  const key = generateApiKey(row.platformSlug);
  await db.serviceIdentity.update({
    where: { id },
    data: { keyHash: key.hash, keyPreview: key.preview, rotatedAt: new Date(), status: 'ACTIVE' },
  });
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'service_identity.rotated',
    targetType: 'ServiceIdentity', targetId: id, severity: 'WARN',
  });
  return { id, apiKey: key.raw, keyPreview: key.preview, scopes: JSON.parse(row.scopesJson) as string[] };
}

export async function revokeServiceIdentity(orgId: string, id: string, userId: string) {
  const row = await db.serviceIdentity.findFirst({ where: { id, orgId } });
  if (!row) throw new WedjatError('NOT_FOUND', 'service identity not found');
  await db.serviceIdentity.update({ where: { id }, data: { status: 'REVOKED' } });
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'service_identity.revoked',
    targetType: 'ServiceIdentity', targetId: id, severity: 'WARN',
  });
  return { revoked: true };
}

// ── Request authentication for /api/v1 (§8) ─────────────────────────────────

export interface AuthenticatedIdentity {
  id: string;
  orgId: string;
  platformSlug: string; // '*' = org-wide
  name: string;
  scopes: ApiScope[];
}

/** Per-identity in-memory token bucket (§33 rate limiting, local memory only). */
const buckets = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_PER_MINUTE = 120;
function rateAllow(identityId: string): boolean {
  const now = Date.now();
  const b = buckets.get(identityId) ?? { tokens: RATE_PER_MINUTE, lastRefill: now };
  const elapsed = now - b.lastRefill;
  b.tokens = Math.min(RATE_PER_MINUTE, b.tokens + (elapsed / 60_000) * RATE_PER_MINUTE);
  b.lastRefill = now;
  if (b.tokens < 1) {
    buckets.set(identityId, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(identityId, b);
  return true;
}

/**
 * Authenticates a /api/v1 request. Extracts the key from
 * `Authorization: Bearer <key>` or `X-API-Key: <key>`, verifies the hash,
 * status, scopes and platform ownership, and applies rate limiting.
 * Key material is NEVER logged (only identity id/name).
 */
export async function authenticateServiceIdentity(
  req: Request,
  requiredScopes: ApiScope[],
  opts: { platform?: string } = {}
): Promise<AuthenticatedIdentity> {
  const auth = req.headers.get('authorization');
  const headerKey = req.headers.get('x-api-key');
  const rawKey = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : headerKey?.trim();
  if (!rawKey) {
    throw new WedjatError('UNAUTHORIZED', 'missing API key: use Authorization: Bearer <key> or X-API-Key');
  }
  const keyHash = sha256(rawKey);
  const row = await db.serviceIdentity.findUnique({ where: { keyHash } });
  if (!row || row.status !== 'ACTIVE') {
    // Uniform message: never reveal whether the key exists (API security).
    throw new WedjatError('UNAUTHORIZED', 'invalid or revoked API key');
  }
  if (!rateAllow(row.id)) {
    throw new WedjatError('RATE_LIMITED', 'rate limit exceeded for this identity');
  }
  const scopes = JSON.parse(row.scopesJson) as ApiScope[];
  const missing = requiredScopes.filter((s) => !scopes.includes(s) && !scopes.includes('admin'));
  if (missing.length > 0) {
    throw new WedjatError('FORBIDDEN', `missing required scope(s): ${missing.join(', ')}`);
  }
  // §8 ownership: a platform-bound identity may only act for its own platform.
  if (opts.platform && row.platformSlug !== '*' && row.platformSlug !== opts.platform) {
    throw new WedjatError('FORBIDDEN', `identity is not authorized for platform '${opts.platform}'`);
  }
  // Best-effort last-used stamp (never blocks the request).
  void db.serviceIdentity.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  logger.info('service_identity_authenticated', { identityId: row.id, platform: row.platformSlug });
  return { id: row.id, orgId: row.orgId, platformSlug: row.platformSlug, name: row.name, scopes };
}
