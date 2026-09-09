// WEDJAT v4 — GET /api/fabric/memory (§107-§112): learning timeline, open
// knowledge gaps (§85/§86 detection runs on read — additive only) and stats.
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { getMemoryInspectorPayload, detectKnowledgeGaps } from '@/lib/wedjat/memory/inspector';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      // §85: gap detection from weak-retrieval signals (creates rows; never deletes).
      await detectKnowledgeGaps(principal.org.id).catch(() => ({ openGaps: 0, created: 0 }));
      const payload = await getMemoryInspectorPayload(principal.org.id);
      return ok(payload);
    } catch (err) {
      return failFrom(err);
    }
  });
}
