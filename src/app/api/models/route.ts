import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import type { ModelsPayload, ModelRegistryDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async () => {
    const registry = await db.modelRegistry.findMany({
      orderBy: [{ provider: 'asc' }, { model: 'asc' }],
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          include: { deployments: { orderBy: { deployedAt: 'desc' }, take: 1 } },
        },
      },
    });

    const dtos: ModelRegistryDto[] = registry.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      modelVersion: r.modelVersion,
      contextLimit: r.contextLimit,
      supports: {
        structuredOutput: r.supportsStructuredOutput,
        toolUse: r.supportsToolUse,
        embedding: r.supportsEmbedding,
        reranking: r.supportsReranking,
        finetuning: r.supportsFinetuning,
        localInference: r.supportsLocalInference,
      },
      estimatedLatencyMs: r.estimatedLatencyMs,
      qualityClass: r.qualityClass,
      costClass: r.costClass,
      gpuRequirement: r.gpuRequirement,
      status: r.status,
      notes: r.notes,
      versions: r.versions.map((v) => {
        const deployment = v.deployments[0] ?? null;
        return {
          id: v.id,
          version: v.version,
          baseModel: v.baseModel,
          trainingMethod: v.trainingMethod,
          status: v.status,
          datasetVersion: v.datasetVersionId,
          artifactChecksum: v.artifactChecksum.slice(0, 20),
          createdAt: v.createdAt.toISOString(),
          deployment: deployment
            ? {
                environment: deployment.environment,
                stage: deployment.stage,
                canaryPercent: deployment.canaryPercent,
                rollbackToId: deployment.rollbackToId,
                status: deployment.status,
                deployedAt: deployment.deployedAt.toISOString(),
              }
            : null,
        };
      }),
    }));

    const payload: ModelsPayload = { registry: dtos };
    return ok(payload);
  });
}

const PROMOTE_TARGETS: Record<string, string[]> = {
  EXPERIMENTAL: ['EVALUATION', 'CANDIDATE'],
  TRAINING: ['EVALUATION'],
  EVALUATION: ['CANDIDATE', 'REJECTED'],
  CANDIDATE: ['CANARY', 'REJECTED'],
  CANARY: ['PRODUCTION', 'REJECTED'],
  PRODUCTION: ['DEPRECATED'],
};

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    requireMutationRole(principal);
    const body = await readJson<{ action?: string; modelVersionId?: string; stage?: string }>(req);
    const action = requireString(body.action, 'action', 40);
    const modelVersionId = requireString(body.modelVersionId, 'modelVersionId', 100);

    const version = await db.modelVersion.findUnique({
      where: { id: modelVersionId },
      include: { registry: true, deployments: true },
    });
    if (!version) throw new WedjatError('NOT_FOUND', 'Model version not found');

    if (action === 'promote') {
      const target = (body.stage ?? '').toUpperCase();
      const allowed = PROMOTE_TARGETS[version.status] ?? [];
      if (!allowed.includes(target)) {
        throw new WedjatError(
          'VALIDATION',
          `Cannot promote ${version.status} → ${target}. Allowed: ${allowed.join(', ') || 'terminal status'}`
        );
      }
      // Gate: promotion to CANDIDATE+ requires evaluation evidence (§41/§99).
      if (['CANDIDATE', 'CANARY', 'PRODUCTION'].includes(target) && !version.evaluationVersion) {
        throw new WedjatError('VALIDATION', 'Promotion requires evaluation evidence (evaluationVersion missing)');
      }
      await db.modelVersion.update({ where: { id: modelVersionId }, data: { status: target } });
      if (target === 'CANARY' || target === 'PRODUCTION') {
        await db.modelDeployment.create({
          data: {
            modelVersionId,
            environment: 'PRODUCTION',
            stage: target,
            canaryPercent: target === 'CANARY' ? 10 : 100,
            status: 'ACTIVE',
            note: `explicit promotion by ${principal.email}`,
          },
        });
        if (target === 'PRODUCTION') {
          // Preserve rollback: deactivate prior active deployments.
          await db.modelDeployment.updateMany({
            where: { modelVersionId, stage: 'CANARY', status: 'ACTIVE' },
            data: { status: 'INACTIVE' },
          });
        }
      }
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'model.promoted',
        targetType: 'modelVersion',
        targetId: modelVersionId,
        details: { from: version.status, to: target },
      });
      return ok({ modelVersionId, status: target });
    }

    if (action === 'rollback') {
      if (version.status !== 'PRODUCTION' && version.status !== 'CANARY') {
        throw new WedjatError('VALIDATION', `rollback requires PRODUCTION or CANARY (current: ${version.status})`);
      }
      await db.modelVersion.update({ where: { id: modelVersionId }, data: { status: 'DEPRECATED' } });
      await db.modelDeployment.updateMany({
        where: { modelVersionId, status: 'ACTIVE' },
        data: { status: 'INACTIVE', stage: 'ROLLED_BACK' },
      });
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'model.rolled_back',
        targetType: 'modelVersion',
        targetId: modelVersionId,
        severity: 'WARN',
      });
      return ok({ modelVersionId, status: 'DEPRECATED' });
    }

    throw new WedjatError('VALIDATION', "action must be 'promote' or 'rollback'");
  });
}
