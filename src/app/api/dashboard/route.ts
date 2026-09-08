import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal } from '@/lib/wedjat/api';
import { healthSnapshot } from '@/lib/wedjat/gateway/provider-health';
import type { DashboardStats } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const orgId = principal.org.id;

    const [
      platforms,
      blueprints,
      documents,
      chunksIndexed,
      knowledgeRecords,
      conversations,
      aiGenerations,
      feedbackCount,
      lastIngestion,
      lastEvaluation,
      genAgg,
    ] = await Promise.all([
      db.platform.count({ where: { orgId } }),
      db.blueprint.count({ where: { platform: { orgId } } }),
      db.document.count({ where: { blueprintVersion: { blueprint: { platform: { orgId } } } } }),
      db.documentChunk.count({
        where: { status: 'INDEXED', documentVersion: { document: { blueprintVersion: { blueprint: { platform: { orgId } } } } } },
      }),
      db.knowledgeRecord.count({
        where: { blueprintVersion: { blueprint: { platform: { orgId } } } },
      }),
      db.conversation.count({ where: { orgId } }),
      db.aiGeneration.count({}),
      db.feedback.count({}),
      db.documentVersion.findFirst({
        where: { document: { blueprintVersion: { blueprint: { platform: { orgId } } } } },
        orderBy: { ingestedAt: 'desc' },
        select: { ingestedAt: true },
      }),
      db.evaluationResult.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.aiGeneration.aggregate({ _avg: { latencyMs: true, confidence: true, groundedness: true } }),
    ]);

    // Detected conflicts: topics where knowledge records diverge (§49 signal).
    const recommendationRecords = await db.knowledgeRecord.count({
      where: {
        blueprintVersion: { blueprint: { platform: { orgId } } },
        recordType: 'RECOMMENDATION',
        status: { not: 'SUPERSEDED' },
      },
    });
    const topicRecords = await db.knowledgeRecord.findMany({
      where: {
        blueprintVersion: { blueprint: { platform: { orgId } } },
        topicKey: { not: null },
      },
      select: { topicKey: true, statement: true },
      take: 1000,
    });
    const topics = new Map<string, Set<string>>();
    for (const r of topicRecords) {
      const key = r.topicKey!;
      if (!topics.has(key)) topics.set(key, new Set());
      topics.get(key)!.add(r.statement);
    }
    const detectedConflicts = [...topics.values()].filter((stmts) => stmts.size >= 2).length;

    const providers = healthSnapshot();
    const openCircuits = providers.filter((p) => p.circuitState === 'OPEN').length;
    const failedJobs = await db.job.count({ where: { status: 'FAILED' } });

    const stats: DashboardStats = {
      platforms,
      blueprints,
      documents,
      chunksIndexed,
      knowledgeRecords,
      conversations,
      aiGenerations,
      avgLatencyMs: Math.round(genAgg._avg.latencyMs ?? 0),
      avgConfidence: round2(genAgg._avg.confidence ?? 0),
      avgGroundedness: round2(genAgg._avg.groundedness ?? 0),
      feedbackCount,
      unresolvedRecommendations: recommendationRecords,
      detectedConflicts,
      lastIngestionAt: lastIngestion?.ingestedAt?.toISOString() ?? null,
      lastEvaluationAt: lastEvaluation?.createdAt.toISOString() ?? null,
      health: {
        database: 'OK',
        retrieval: chunksIndexed > 0 ? 'OK' : 'EMPTY',
        providers: openCircuits === 0 ? 'OK' : `DEGRADED (${openCircuits} open circuit(s))`,
        jobs: failedJobs > 5 ? 'WARN' : 'OK',
      },
    };
    return ok(stats);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
