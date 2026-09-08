import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal } from '@/lib/wedjat/api';
import { healthSnapshot } from '@/lib/wedjat/gateway/provider-health';
import { metrics } from '@/lib/wedjat/observability/metrics';
import { budgetSnapshot } from '@/lib/wedjat/security/policy';
import { retrievalEventTotal } from '@/lib/wedjat/retrieval/hybrid';
import { config } from '@/lib/wedjat/config';
import type { SystemHealthPayload, ProviderHealthDto, AuditEventDto, IngestionEventDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const orgId = principal.org.id;

    const dbStart = Date.now();
    let dbStatus = 'OK';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'ERROR';
    }
    const dbLatency = Date.now() - dbStart;

    const [chunks, postings, knowledge, jobGroups, configVersions, promptVersions, audit, ingestionEvents] =
      await Promise.all([
        db.documentChunk.count({ where: { status: 'INDEXED' } }),
        db.lexicalTerm.count(),
        db.knowledgeRecord.count({ where: { blueprintVersion: { blueprint: { platform: { orgId } } } } }),
        db.job.groupBy({ by: ['status'], _count: true }),
        db.configVersion.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 12 }),
        db.promptVersion.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 12 }),
        db.auditEvent.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 40 }),
        db.ingestionEvent.findMany({
          where: { documentVersion: { document: { blueprintVersion: { blueprint: { platform: { orgId } } } } } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          include: { documentVersion: { include: { document: { select: { title: true } } } } },
        }),
      ]);

    const providers: ProviderHealthDto[] = healthSnapshot().map((p) => ({
      provider: p.provider,
      model: p.model,
      circuitState: p.circuitState,
      requests: p.requests,
      successes: p.successes,
      failures: p.failures,
      rateLimited429: p.rateLimited429,
      serverErrors5xx: p.serverErrors5xx,
      timeouts: p.timeouts,
      avgLatencyMs: p.avgLatencyMs,
      successRate: Math.round(p.successRate * 1000) / 1000,
    }));

    const jobCount = (status: string) => jobGroups.find((g) => g.status === status)?._count ?? 0;
    const snap = metrics.snapshot();
    const budget = budgetSnapshot();

    const auditDtos: AuditEventDto[] = audit.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      severity: a.severity,
      details: safeJson(a.detailsJson),
      traceId: a.traceId,
      createdAt: a.createdAt.toISOString(),
    }));

    const ingestionDtos: IngestionEventDto[] = ingestionEvents.map((e) => ({
      id: e.id,
      stage: e.stage,
      status: e.status,
      detail: e.detail,
      latencyMs: e.latencyMs,
      createdAt: e.createdAt.toISOString(),
      documentTitle: e.documentVersion?.document?.title,
    }));

    const payload: SystemHealthPayload = {
      application: { status: 'OK', uptimeSec: snap.uptimeSec, version: config.version },
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
        migrationStatus: 'schema-in-sync (prisma db push)',
      },
      retrieval: {
        status: chunks > 0 ? 'OK' : 'EMPTY',
        indexedChunks: chunks,
        embeddingModel: config.retrieval.embedderModel,
        lexicalPostings: postings,
        knowledgeRecords: knowledge,
      },
      providers,
      jobs: {
        queued: jobCount('QUEUED'),
        running: jobCount('RUNNING') + jobCount('RETRYING'),
        failed: jobCount('FAILED'),
        completed: jobCount('COMPLETED'),
      },
      gpu: {
        available: false,
        note: 'No CUDA device detected in this environment — training lifecycle runs in SIMULATED mode by design; inference uses the sanctioned internal gateway.',
      },
      policies: {
        dataSharing: principal.org.dataPolicy,
        embeddingPolicy: config.policy.embedding,
        budgetUsdPerDay: budget.budgetUsdPerDay,
        spentUsdToday: budget.spentUsdToday,
      },
      metrics: {
        aiRequests: snap.aiRequests,
        aiSuccesses: snap.aiSuccesses,
        aiFailures: snap.aiFailures,
        avgLatencyMs: snap.avgLatencyMs,
        fallbackRate: Math.round(snap.fallbackRate * 1000) / 1000,
        retryRate: Math.round(snap.retryRate * 1000) / 1000,
        retrievalEvents: retrievalEventTotal(),
        ingestionJobs: snap.ingestionJobs,
      },
      configVersions: configVersions.map((c) => ({
        key: c.key,
        version: c.version,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        value: safeJson(c.valueJson),
      })),
      promptVersions: promptVersions.map((p) => ({
        promptId: p.promptId,
        version: p.version,
        task: p.task,
        status: p.status,
        approvedAt: p.approvedAt?.toISOString() ?? null,
      })),
      recentAudit: auditDtos,
      recentIngestion: ingestionDtos,
    };
    return ok(payload);
  });
}

function safeJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { parseError: true };
  }
}
