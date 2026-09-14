// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT — Platform database token resolution (§34/§35 + §20/§91 pattern).
//
// WHY: platform Turso tokens previously lived ONLY in the local sandbox
// .env.local — sandbox reset #5 wiped them and production had no copies, so
// the §34/§35 database probes stalled until the OWNER re-supplied. Following
// the provider-keys precedent (org-managed ConfigVersion settings, DB value
// authoritative), platform DB tokens can now be stored in the ORG SETTINGS
// from the app (/api/settings/platform-db) — they survive sandbox resets and
// redeployments, and the local sandbox can resolve them through the app.
//
// Security (§41): token material NEVER leaves the server. Reads are masked
// (last-4 hint only); the probe API resolves on demand and never echoes the
// value. Resolution order: org-managed settings FIRST (authoritative, §91),
// then process.env (deployment environment fallback).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { DB_TARGETS } from './intake/db-probe';
import { WedjatError } from './errors';

export const PLATFORM_DB_TOKENS_CONFIG_KEY = 'platform.db.tokens';

export type PlatformTokenMap = Record<string, string>;

async function primaryOrgId(): Promise<string | null> {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return org?.id ?? null;
}

/** Loads the ACTIVE org-managed platform token map (empty when none stored). */
export async function loadPlatformDbTokens(orgId: string): Promise<PlatformTokenMap> {
  const row = await db.configVersion.findFirst({
    where: { orgId, key: PLATFORM_DB_TOKENS_CONFIG_KEY, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { valueJson: true },
  });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.valueJson) as PlatformTokenMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolves the token for a §34/§35 target: org-managed settings FIRST
 * (authoritative — survives sandbox resets, §91), then process.env.
 */
export async function resolvePlatformDbToken(
  orgId: string,
  slug: string,
  managed: PlatformTokenMap
): Promise<string | undefined> {
  const target = DB_TARGETS.find((t) => t.slug === slug);
  if (!target) throw new WedjatError('VALIDATION', `unknown platform '${slug}'`);
  const fromSettings = managed[slug]?.trim();
  if (fromSettings) return fromSettings;
  const fromEnv = process.env[target.tokenEnv];
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : undefined;
}

/** Loads the org-managed map for the primary org (convenience for callers). */
export async function loadPrimaryOrgPlatformTokens(): Promise<{ orgId: string | null; managed: PlatformTokenMap }> {
  const orgId = await primaryOrgId();
  const managed = orgId ? await loadPlatformDbTokens(orgId) : {};
  return { orgId, managed };
}

/**
 * Upserts one platform token into the org-managed settings (new ConfigVersion
 * row; previous ACTIVE versions are ARCHIVED — append-only §58). Empty string
 * clears it. Never returns or logs the token material.
 */
export async function savePlatformDbToken(
  orgId: string,
  slug: string,
  token: string
): Promise<void> {
  const target = DB_TARGETS.find((t) => t.slug === slug);
  if (!target) {
    throw new WedjatError('VALIDATION', `unknown platform '${slug}' (known: ${DB_TARGETS.map((t) => t.slug).join(', ')})`);
  }
  const current = await loadPlatformDbTokens(orgId);
  const next: PlatformTokenMap = { ...current };
  const trimmed = token.trim();
  if (trimmed) next[slug] = trimmed;
  else delete next[slug];

  await db.configVersion.updateMany({
    where: { orgId, key: PLATFORM_DB_TOKENS_CONFIG_KEY, status: 'ACTIVE' },
    data: { status: 'ARCHIVED' },
  });
  await db.configVersion.create({
    data: {
      orgId,
      key: PLATFORM_DB_TOKENS_CONFIG_KEY,
      version: `v${Date.now()}`,
      valueJson: JSON.stringify(next),
      status: 'ACTIVE',
    },
  });
}

/**
 * Masked view for the settings UI: per §34/§35 target, whether a token is
 * configured, whether it is org-managed, and a last-4 hint of the MANAGED
 * value only (env-only tokens show no hint). Never returns key material.
 */
export async function platformDbTokenStatusMasked(): Promise<
  { slug: string; name: string; instanceUrl: string; configured: boolean; managed: boolean; hint: string | null }[]
> {
  const { managed } = await loadPrimaryOrgPlatformTokens();
  return DB_TARGETS.map((t) => {
    const envToken = process.env[t.tokenEnv];
    const managedToken = managed[t.slug];
    const token = managedToken ?? (envToken && envToken.trim() !== '' ? envToken : undefined);
    return {
      slug: t.slug,
      name: t.name,
      instanceUrl: t.databaseUrl,
      configured: Boolean(token),
      managed: Boolean(managedToken),
      hint: managedToken ? `…${managedToken.slice(-4)}` : null,
    };
  });
}
