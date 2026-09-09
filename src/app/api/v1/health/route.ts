// WEDJAT v4 — GET /api/v1/health (§106): PUBLIC liveness/readiness summary.
// No secrets, no org data — just service state (safe to expose).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { uptimeSec } from '@/lib/wedjat/observability/metrics';
import { validateStartupConfig } from '@/lib/wedjat/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  let database = 'UP';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = 'DOWN';
  }
  const queue = await db.job.count({ where: { status: 'QUEUED' } }).catch(() => -1);
  const deadLetters = await db.deadLetterEvent.count({ where: { resolved: false } }).catch(() => -1);
  const configOk = validateStartupConfig();
  const healthy = database === 'UP' && configOk.ok;
  return NextResponse.json(
    {
      ok: healthy,
      status: healthy ? 'READY' : 'DEGRADED',
      checks: {
        liveness: 'UP',
        database,
        startupConfig: configOk.problems,
        jobQueue: queue,
        deadLetters,
      },
      fabric: { version: 'v4', uptimeSec: uptimeSec() },
      latencyMs: Date.now() - started,
    },
    { status: healthy ? 200 : 503 }
  );
}
