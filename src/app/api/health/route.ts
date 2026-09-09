import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom } from '@/lib/wedjat/api';
import { validateStartupConfig, providerKeyStatus, config } from '@/lib/wedjat/config';
import { syncProviderKeys } from '@/lib/wedjat/provider-keys';
import { healthSnapshot } from '@/lib/wedjat/gateway/provider-health';
import { uptimeSec } from '@/lib/wedjat/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Production health endpoints (§89): liveness + readiness in one route.
 * ?deep=1 adds component checks (database, retrieval, providers, jobs, GPU).
 * Never requires auth — health probes must not depend on sessions.
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const deep = new URL(req.url).searchParams.get('deep') === '1';
    const checks: { name: string; status: string; detail: string }[] = [];

    // Resolve org-managed provider keys first so reported status is accurate.
    await syncProviderKeys();

    const cfg = validateStartupConfig();
    checks.push({
      name: 'configuration',
      status: cfg.ok ? 'OK' : 'ERROR',
      detail: cfg.ok ? 'required configuration present' : cfg.problems.join('; '),
    });

    const dbStarted = Date.now();
    let dbOk = false;
    try {
      await db.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    checks.push({
      name: 'database',
      status: dbOk ? 'OK' : 'ERROR',
      detail: dbOk ? `reachable (${Date.now() - dbStarted}ms)` : 'unreachable',
    });

    if (deep) {
      const [chunks, postings, knowledge, jobs, sessions] = await Promise.all([
        db.documentChunk.count({ where: { status: 'INDEXED' } }),
        db.lexicalTerm.count(),
        db.knowledgeRecord.count(),
        db.job.groupBy({ by: ['status'], _count: true }),
        db.session.count(),
      ]);
      checks.push({
        name: 'retrieval',
        status: chunks > 0 ? 'OK' : 'WARN',
        detail: `${chunks} indexed chunks, ${postings} lexical postings, ${knowledge} knowledge records`,
      });
      const providers = healthSnapshot();
      const open = providers.filter((p) => p.circuitState === 'OPEN');
      checks.push({
        name: 'ai-providers',
        status: open.length === 0 ? 'OK' : 'WARN',
        detail:
          open.length === 0
            ? `all circuits healthy (${providers.map((p) => `${p.provider}:${p.circuitState}`).join(', ') || 'no calls yet'})`
            : `open circuits: ${open.map((p) => p.provider).join(', ')}`,
      });
      const queued = jobs.find((j) => j.status === 'QUEUED')?._count ?? 0;
      const failed = jobs.find((j) => j.status === 'FAILED')?._count ?? 0;
      checks.push({
        name: 'jobs',
        status: failed > 5 ? 'WARN' : 'OK',
        detail: `queued=${queued} failed=${failed}`,
      });
      checks.push({
        name: 'gpu',
        status: 'WARN',
        detail: 'no CUDA device in this environment — training lifecycle is simulated by design',
      });
      void sessions;
    }

    const status = checks.some((c) => c.status === 'ERROR') ? 'unhealthy' : 'healthy';
    return ok({
      status,
      version: config.version,
      uptimeSec: uptimeSec(),
      providerKeys: providerKeyStatus(), // booleans only — never values
      checks,
    });
  } catch (err) {
    return failFrom(err);
  }
}
