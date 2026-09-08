import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { runEvaluationSuite, latestRunSummaries } from '@/lib/wedjat/evaluation/runner';
import { enqueueJob } from '@/lib/wedjat/observability/jobs';
import { WedjatError } from '@/lib/wedjat/errors';
import type { EvaluationsPayload, EvaluationResultDto, EvaluationSuiteDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const suites = await db.evaluationSuite.findMany({
      where: { orgId: principal.org.id },
      include: { cases: true },
      orderBy: { name: 'asc' },
    });
    const summaries = await latestRunSummaries(principal.org.id);

    const suiteDtos: EvaluationSuiteDto[] = suites.map((s) => {
      const last = summaries.get(s.id);
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        caseCount: s.cases.length,
        lastRun: last
          ? {
              runLabel: last.runLabel,
              createdAt: new Date().toISOString(), // refreshed below with real ts
              passRate: last.passRate,
              avgRecall: last.avgRecall,
              avgPrecision: last.avgPrecision,
              avgGroundedness: last.avgGroundedness,
              avgLatencyMs: last.avgLatencyMs,
            }
          : null,
      };
    });

    // Real timestamps from the latest result rows.
    for (const dto of suiteDtos) {
      if (dto.lastRun) {
        const latest = await db.evaluationResult.findFirst({
          where: { suiteId: dto.id, runLabel: dto.lastRun.runLabel },
          orderBy: { createdAt: 'desc' },
        });
        dto.lastRun.createdAt = latest?.createdAt.toISOString() ?? new Date().toISOString();
      }
    }

    const results = await db.evaluationResult.findMany({
      where: { suite: { orgId: principal.org.id } },
      orderBy: { createdAt: 'desc' },
      take: 400,
      include: { case: true },
    });
    const resultDtos: EvaluationResultDto[] = results.map((r) => ({
      id: r.id,
      runLabel: r.runLabel,
      caseQuery: r.case.query,
      caseTask: r.case.task,
      retrievedCount: r.retrievedCount,
      recallAtK: r.recallAtK,
      precisionAtK: r.precisionAtK,
      keywordCoverage: r.keywordCoverage,
      groundedness: r.groundedness,
      latencyMs: r.latencyMs,
      passed: r.passed,
      createdAt: r.createdAt.toISOString(),
    }));

    const payload: EvaluationsPayload = {
      suites: suiteDtos,
      results: resultDtos,
      runLabels: [...new Set(results.map((r) => r.runLabel))].slice(0, 30),
    };
    return ok(payload);
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    requireMutationRole(principal);
    const body = await readJson<{ action?: string; suiteId?: string; label?: string; async?: boolean }>(req);
    if (body.action !== 'run') throw new WedjatError('VALIDATION', "action must be 'run'");
    const suiteId = body.suiteId ?? '';
    if (!suiteId) throw new WedjatError('VALIDATION', 'suiteId is required');

    const suite = await db.evaluationSuite.findFirst({
      where: { id: suiteId, orgId: principal.org.id },
      include: { cases: true },
    });
    if (!suite) throw new WedjatError('NOT_FOUND', 'Suite not found');
    if (suite.cases.some((c) => c.llmJudged) === false) {
      // Retrieval-only suites are fast → run synchronously.
      const summary = await runEvaluationSuite(principal, suiteId, body.label);
      return ok({ ...summary, suiteId });
    }
    // Suites with llmJudged cases may take a while → run as a job (§62).
    const { jobId } = await enqueueJob({
      kind: 'evaluation-run',
      orgId: principal.org.id,
      userId: principal.userId,
      suiteId,
      label: body.label,
    });
    return ok({ jobId, suiteId, queued: true, message: 'Evaluation job queued — results appear when complete.' }, 202);
  });
}
