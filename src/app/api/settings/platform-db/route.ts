// WEDJAT — /api/settings/platform-db (§34/§35 + §20/§91).
//
// GET  → masked per-platform token status (configured / org-managed / last-4
//        hint of the managed value). NEVER returns token material.
// POST → upsert one platform Turso token into org-managed settings
//        (OWNER only; empty token clears it). Stored tokens survive sandbox
//        resets and redeployments — the probe API resolves them at run time.
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { platformDbTokenStatusMasked, savePlatformDbToken } from '@/lib/wedjat/platform-db-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOKEN_LEN = 2000;

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const platforms = await platformDbTokenStatusMasked();
      return ok({ platforms });
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
        throw new WedjatError('FORBIDDEN', 'Only an OWNER may change platform database settings');
      }
      const body = await readJson<{ platform?: string; token?: string }>(req);
      const platform = requireString(body.platform, 'platform', 40);
      const token = typeof body.token === 'string' ? body.token : '';
      if (token.length > MAX_TOKEN_LEN) {
        throw new WedjatError('VALIDATION', `token exceeds ${MAX_TOKEN_LEN} characters`);
      }
      await savePlatformDbToken(principal.org.id, platform, token);
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: token ? 'platform_db.token_saved' : 'platform_db.token_cleared',
        targetType: 'Platform',
        targetId: platform,
        severity: 'WARN',
        details: { platform, managed: Boolean(token) }, // masked — no token material
      });
      const platforms = await platformDbTokenStatusMasked();
      return ok({ saved: { platform, cleared: !token }, platforms });
    } catch (err) {
      return failFrom(err);
    }
  });
}
