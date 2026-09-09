// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — AI provider key resolution (§20, §91).
//
// WHY: provider API keys (GROQ_API_KEY / GEMINI_API_KEY) may come from the
// process environment OR from org-managed settings an OWNER stores in the
// ConfigVersion table (key 'provider.keys') via /api/settings/providers.
// The DB value is authoritative when present — this lets keys be managed
// from the app without redeploying. Resolved values are materialized into
// process.env so every consumer (adapters, registry, health) sees ONE truth.
//
// Security: keys never leave the server. Reads are masked; the TTL cache keeps
// the hot path off the database.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { logger } from './logger';
import { resetRegistryCache } from './gateway/registry';

export const PROVIDER_KEYS_CONFIG_KEY = 'provider.keys';
const TTL_MS = 15_000;

interface ProviderKeyMap {
  groqApiKey?: string;
  geminiApiKey?: string;
}

export interface ProviderKeyPresence {
  groq: boolean;
  gemini: boolean;
}

let cacheAt = 0;
let inflight: Promise<void> | null = null;
let lastPresence: ProviderKeyPresence | null = null;

function currentPresence(): ProviderKeyPresence {
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
}

function applyPresenceChange(): void {
  const now = currentPresence();
  // Reset when presence CHANGED or on the FIRST sync: the registry cache may
  // have been built by a non-syncing path (dashboard/system snapshots) before
  // keys were resolved, leaving remote entries stuck in STANDBY.
  const changed =
    !lastPresence || now.groq !== lastPresence.groq || now.gemini !== lastPresence.gemini;
  if (changed) resetRegistryCache();
  lastPresence = now;
}

/** Loads the ACTIVE org-managed key map (empty when none stored). */
async function loadActiveKeys(orgId: string): Promise<ProviderKeyMap> {
  const row = await db.configVersion.findFirst({
    where: { orgId, key: PROVIDER_KEYS_CONFIG_KEY, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { valueJson: true },
  });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.valueJson) as ProviderKeyMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function primaryOrgId(): Promise<string | null> {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return org?.id ?? null;
}

/**
 * Resolves provider keys (DB over env), materializes them into process.env and
 * reports presence. Cached for TTL_MS; safe to call on every request.
 */
export async function syncProviderKeys(): Promise<ProviderKeyPresence> {
  if (Date.now() - cacheAt < TTL_MS) return currentPresence();
  if (!inflight) {
    inflight = (async () => {
      try {
        const orgId = await primaryOrgId();
        if (orgId) {
          const keys = await loadActiveKeys(orgId);
          if (keys.groqApiKey) process.env.GROQ_API_KEY = keys.groqApiKey;
          if (keys.geminiApiKey) process.env.GEMINI_API_KEY = keys.geminiApiKey;
        }
        cacheAt = Date.now();
        applyPresenceChange();
      } catch (err) {
        // DB unreachable: env-only mode, still cached to avoid hammering.
        cacheAt = Date.now();
        logger.warn('provider_key_sync_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inflight = null;
      }
    })();
  }
  await inflight;
  return currentPresence();
}

/** Clears the TTL cache — call after an OWNER saves new provider settings. */
export function resetProviderKeyCache(): void {
  cacheAt = 0;
}

/**
 * Masked view for the settings UI: which providers have keys configured and a
 * last-4 hint of the ORG-MANAGED value (env-only keys show no hint).
 * Never returns key material. Syncs DB-managed keys into the process env
 * FIRST so a fresh serverless instance reports `configured: true` before any
 * generation call has materialized the env (DB is authoritative, §91).
 */
export async function providerKeyStatusMasked(): Promise<{
  groq: { configured: boolean; managed: boolean; hint: string | null };
  gemini: { configured: boolean; managed: boolean; hint: string | null };
}> {
  await syncProviderKeys();
  const orgId = await primaryOrgId();
  const managed = orgId ? await loadActiveKeys(orgId) : {};
  const presence = currentPresence();
  const mask = (v: string | undefined, configured: boolean) => ({
    configured,
    managed: Boolean(v),
    hint: v ? `…${v.slice(-4)}` : null,
  });
  return {
    groq: mask(managed.groqApiKey, presence.groq),
    gemini: mask(managed.geminiApiKey, presence.gemini),
  };
}

/**
 * Upserts one provider key into the org-managed settings (new ConfigVersion
 * version; previous ACTIVE versions are archived). Empty string clears it.
 */
export async function saveProviderKey(
  orgId: string,
  provider: 'groq' | 'gemini',
  apiKey: string
): Promise<void> {
  if (provider !== 'groq' && provider !== 'gemini') {
    throw new Error('unsupported provider');
  }
  const current = await loadActiveKeys(orgId);
  const next: ProviderKeyMap = { ...current };
  if (provider === 'groq') {
    if (apiKey) next.groqApiKey = apiKey;
    else delete next.groqApiKey;
  } else {
    if (apiKey) next.geminiApiKey = apiKey;
    else delete next.geminiApiKey;
  }

  await db.configVersion.updateMany({
    where: { orgId, key: PROVIDER_KEYS_CONFIG_KEY, status: 'ACTIVE' },
    data: { status: 'ARCHIVED' },
  });
  await db.configVersion.create({
    data: {
      orgId,
      key: PROVIDER_KEYS_CONFIG_KEY,
      version: `v${Date.now()}`,
      valueJson: JSON.stringify(next),
      status: 'ACTIVE',
    },
  });

  // Apply immediately in this process.
  if (provider === 'groq') {
    if (apiKey) process.env.GROQ_API_KEY = apiKey;
    else delete process.env.GROQ_API_KEY;
  } else {
    if (apiKey) process.env.GEMINI_API_KEY = apiKey;
    else delete process.env.GEMINI_API_KEY;
  }
  cacheAt = 0;
  lastPresence = null;
  applyPresenceChange();
  cacheAt = Date.now();
}
