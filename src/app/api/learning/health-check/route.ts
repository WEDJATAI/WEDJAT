// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — POST /api/learning/health-check (§156, ADMIN+).
// Manual trigger of the continuous health check (also runs every 5 min in the
// job worker). Findings feed the AI improvement queue.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { WedjatError } from '@/lib/wedjat/errors';
import { runHealthCheck } from '@/lib/wedjat/intake/health';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      if (principal.role !== 'OWNER' && principal.role !== 'ADMIN') {
        throw new WedjatError('FORBIDDEN', 'Only OWNER or ADMIN may trigger a health check (§156)');
      }
      const outcome = await runHealthCheck(principal.org.id);
      return ok({
        ranAt: new Date().toISOString(),
        issuesFound: outcome.issuesFound,
        checks: outcome.checks,
        queueItemsCreated: outcome.queueItemsCreated,
        durationMs: outcome.durationMs,
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}
