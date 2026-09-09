// WEDJAT v4 — GET /api/fabric/export (ADMIN+) — §113: authorized knowledge +
// provenance export. NON-DESTRUCTIVE: exporting never removes knowledge.
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { exportKnowledgeBundle } from '@/lib/wedjat/memory/inspector';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const bundle = await exportKnowledgeBundle(principal.org.id, principal.userId);
      return ok(bundle);
    } catch (err) {
      return failFrom(err);
    }
  });
}
