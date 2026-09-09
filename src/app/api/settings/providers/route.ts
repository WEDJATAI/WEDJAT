// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — /api/settings/providers (§20, §91).
//
// GET  → masked provider key status (which are configured, last-4 hint of the
//        org-managed value — NEVER the key material).
// POST → upsert/clear one provider key (OWNER only). Keys are stored in the
//        org-managed ConfigVersion settings and take effect immediately.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { providerKeyStatusMasked, saveProviderKey, resetProviderKeyCache } from '@/lib/wedjat/provider-keys';

export const runtime = 'nodejs';

const PROVIDERS = new Set(['groq', 'gemini']);
const MAX_KEY_LEN = 500;

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      resetProviderKeyCache();
      const status = await providerKeyStatusMasked();
      return ok({ providers: status });
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      if (principal.role !== 'OWNER') {
        throw new WedjatError('FORBIDDEN', 'Only an OWNER may change AI provider settings');
      }
      const body = await readJson<{ provider?: string; apiKey?: string }>(req);
      const provider = requireString(body.provider, 'provider', 20);
      if (!PROVIDERS.has(provider)) {
        throw new WedjatError('VALIDATION', "provider must be 'groq' or 'gemini'");
      }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (apiKey.length > MAX_KEY_LEN) {
        throw new WedjatError('VALIDATION', `apiKey exceeds ${MAX_KEY_LEN} characters`);
      }
      // Google issues newer Gemini keys containing dots (e.g. "AQ.Ab8…"), so
      // dots are allowed alongside word chars and dashes.
      if (apiKey && !/^[A-Za-z0-9_\-.]+$/.test(apiKey)) {
        throw new WedjatError('VALIDATION', 'apiKey contains invalid characters');
      }

      const org = await db.organization.findFirst({
        where: { id: principal.org.id },
        select: { id: true },
      });
      if (!org) throw new WedjatError('NOT_FOUND', 'Organization not found');

      await saveProviderKey(org.id, provider as 'groq' | 'gemini', apiKey);
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: apiKey ? 'settings.provider_key_set' : 'settings.provider_key_cleared',
        targetType: 'config',
        targetId: provider,
      });

      const status = await providerKeyStatusMasked();
      return ok({ providers: status });
    } catch (err) {
      return failFrom(err);
    }
  });
}
