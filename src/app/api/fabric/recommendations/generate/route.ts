// WEDJAT v4 — POST /api/fabric/recommendations/generate (ADMIN+) — §42:
// evidence-based generation from existing findings ONLY (no fabrication).
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { generateRecommendations } from '@/lib/wedjat/recommendations/engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const body = await readJson<{ platformSlug?: string }>(req).catch(() => ({}) as { platformSlug?: string });
      const result = await generateRecommendations(
        principal.org.id,
        typeof body.platformSlug === 'string' && body.platformSlug.trim() !== '' ? body.platformSlug.trim().toLowerCase() : undefined,
        principal.userId
      );
      return ok({ created: result.created, recommendations: [] });
    } catch (err) {
      return failFrom(err);
    }
  });
}
