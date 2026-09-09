// WEDJAT v4 — GET /api/fabric/memory/provenance?recordId=… (§108-§111):
// "Why does WEDJAT know this?" / "When did it learn it?" / "What changed?"
import { NextResponse } from 'next/server';
import { ok, fail, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { getProvenance } from '@/lib/wedjat/memory/inspector';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const recordId = new URL(req.url).searchParams.get('recordId');
      if (!recordId) return fail('VALIDATION', 'query parameter recordId is required');
      const provenance = await getProvenance(principal.org.id, recordId);
      return ok(provenance);
    } catch (err) {
      return failFrom(err);
    }
  });
}
