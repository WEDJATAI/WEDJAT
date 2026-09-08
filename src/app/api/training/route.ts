import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { createDataset, promoteRun } from '@/lib/wedjat/training/lifecycle';
import { enqueueJob } from '@/lib/wedjat/observability/jobs';
import { WedjatError } from '@/lib/wedjat/errors';
import type { TrainingPayload, TrainingDatasetDto, TrainingRunDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const orgId = principal.org.id;

    const datasets = await db.trainingDataset.findMany({
      where: { orgId },
      include: { versions: true },
      orderBy: { updatedAt: 'desc' },
    });

    const datasetDtos: TrainingDatasetDto[] = [];
    for (const d of datasets) {
      const current = d.versions.find((v) => v.id === d.currentVersionId) ?? d.versions[d.versions.length - 1] ?? null;
      datasetDtos.push({
        id: d.id,
        name: d.name,
        slug: d.slug,
        description: d.description,
        status: d.status,
        currentVersion: current
          ? {
              id: current.id,
              version: current.version,
              exampleCount: current.exampleCount,
              status: current.status,
              checksum: current.checksum.slice(0, 16),
              lockedAt: current.lockedAt?.toISOString() ?? null,
            }
          : null,
        updatedAt: d.updatedAt.toISOString(),
      });
    }

    const runs = await db.trainingRun.findMany({
      where: { datasetVersion: { dataset: { orgId } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        metrics: { orderBy: { step: 'asc' } },
        datasetVersion: true,
        baseModel: true,
        candidateModel: true,
      },
    });

    const runDtos: TrainingRunDto[] = runs.map((r) => {
      const evalSummary = r.evaluationSummaryJson
        ? safeParse<{
            passRate: number;
            avgRecall: number;
            regression: boolean;
            gate: 'PASSED' | 'FAILED' | 'PENDING';
          }>(r.evaluationSummaryJson)
        : null;
      return {
        id: r.id,
        status: r.status,
        method: r.method,
        progress: r.progress,
        currentStep: r.currentStep,
        datasetVersion: r.datasetVersion.version,
        baseModel: r.baseModel ? `${r.baseModel.baseModel}@${r.baseModel.version}` : null,
        candidateModel: r.candidateModel ? `candidate@${r.candidateModel.version}` : null,
        gpuProfile: r.gpuProfile,
        notes: r.notes,
        evaluationSummary: evalSummary,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        metrics: r.metrics.map((m) => ({ step: m.step, loss: m.loss, evalScore: m.evalScore })),
      };
    });

    const eligible = await db.trainingSource.groupBy({
      by: ['kind'],
      where: { orgId, status: 'ELIGIBLE' },
      _count: true,
    });
    const feedbackStats = await db.feedback.groupBy({
      by: ['label'],
      where: { user: { orgId } },
      _count: true,
    });

    const payload: TrainingPayload = {
      datasets: datasetDtos,
      runs: runDtos,
      eligibleSources: eligible.map((e) => ({ kind: e.kind, count: e._count })),
      feedbackStats: feedbackStats.map((f) => ({ label: f.label, count: f._count })),
    };
    return ok(payload);
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    requireMutationRole(principal);
    const body = await readJson<Record<string, unknown>>(req);
    const action = requireString(body.action, 'action', 40);

    if (action === 'create-dataset') {
      const name = requireString(body.name, 'name', 120);
      const includeKinds = Array.isArray(body.includeKinds) ? (body.includeKinds as string[]) : undefined;
      const minQuality = typeof body.minQuality === 'number' ? body.minQuality : undefined;
      const description = typeof body.description === 'string' ? body.description : undefined;

      // Ensure synthetic sources exist when requested (teacher-path §36).
      if (!includeKinds || includeKinds.includes('SYNTHETIC')) {
        await enqueueJob(
          { kind: 'synthetic-registration', orgId: principal.org.id, userId: principal.userId },
          { idempotencyKey: `synthetic-${principal.org.id}-${new Date().toISOString().slice(0, 13)}` }
        );
      }
      const result = await createDataset(principal, {
        name,
        description,
        includeKinds,
        minQuality,
      });
      return ok(result, 201);
    }

    if (action === 'start-run') {
      const datasetVersionId = requireString(body.datasetVersionId, 'datasetVersionId', 100);
      const method = ['LORA', 'QLORA', 'SIMULATED'].includes(String(body.method)) ? String(body.method) : 'LORA';

      const dv = await db.trainingDatasetVersion.findUnique({
        where: { id: datasetVersionId },
        include: { dataset: true, examples: true },
      });
      if (!dv || dv.dataset.orgId !== principal.org.id) {
        throw new WedjatError('NOT_FOUND', 'Dataset version not found');
      }
      if (dv.status !== 'LOCKED') throw new WedjatError('VALIDATION', 'Dataset version must be LOCKED before training');

      // Base model version lineage: the production internal model.
      const baseRegistry = await db.modelRegistry.findFirst({ where: { provider: 'wedjat', model: 'wedjat-internal-chat' } });
      const baseVersion = baseRegistry
        ? (await db.modelVersion.findFirst({ where: { registryId: baseRegistry.id, status: 'PRODUCTION' } })) ??
          (await db.modelVersion.findFirst({ where: { registryId: baseRegistry.id } }))
        : null;

      const run = await db.trainingRun.create({
        data: {
          datasetVersionId: dv.id,
          baseModelVersionId: baseVersion?.id,
          method,
          status: 'QUEUED',
          currentStep: 'queued',
          stepsJson: JSON.stringify(['validate', 'train', 'evaluate-gate', 'candidate', 'canary', 'production']),
          notes: 'started via explicit user action — training is never automatic',
        },
      });
      // Candidate model version (EXPERIMENTAL until gate passes).
      if (baseRegistry) {
        const candidateCount = await db.modelVersion.count({ where: { registryId: baseRegistry.id } });
        const candidate = await db.modelVersion.create({
          data: {
            registryId: baseRegistry.id,
            version: `wedjat-1.${candidateCount + 1}-lora`,
            baseModel: baseRegistry.model,
            trainingMethod: method,
            datasetVersionId: dv.id,
            trainingRunId: run.id,
            codeVersion: 'git:wedjat-1.0.0',
            evaluationVersion: 'pending-gate',
            artifactChecksum: `sim-${dv.checksum.slice(0, 16)}`,
            status: 'TRAINING',
          },
        });
        await db.trainingRun.update({ where: { id: run.id }, data: { candidateModelVersionId: candidate.id } });
      }

      const { jobId } = await enqueueJob({
        kind: 'training-run-step',
        orgId: principal.org.id,
        userId: principal.userId,
        runId: run.id,
      });
      return ok({ runId: run.id, jobId }, 201);
    }

    if (action === 'advance-run') {
      const runId = requireString(body.runId, 'runId', 100);
      const to = String(body.to);
      if (!['candidate', 'canary', 'production'].includes(to)) {
        throw new WedjatError('VALIDATION', "to must be 'candidate', 'canary' or 'production'");
      }
      const result = await promoteRun(principal, runId, to as 'candidate' | 'canary' | 'production');
      return ok(result);
    }

    if (action === 'rollback') {
      const runId = requireString(body.runId, 'runId', 100);
      const result = await promoteRun(principal, runId, 'rollback');
      return ok(result);
    }

    throw new WedjatError('VALIDATION', "action must be 'create-dataset' | 'start-run' | 'advance-run' | 'rollback'");
  });
}

function safeParse<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return {} as T;
  }
}
