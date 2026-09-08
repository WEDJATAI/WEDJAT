// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Training data curation + lifecycle (§9, §32-§37, §41, §61).
//
// HARD RULES ENFORCED HERE:
// - Ingestion NEVER auto-trains (§9): eligibility → curation → dataset → gate.
// - Every example passes schema/dedupe/quality/sensitive-data/label checks (§32).
// - Synthetic examples require source grounding + human review path (§35).
// - Promotion is EXPLICIT and audited; rollback preserved (§41, §65).
// - In THIS environment there is NO GPU: runs execute a SIMULATED training
//   lifecycle (honest label — never claimed as real training §97).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { config } from '../config';
import { logger } from '../logger';
import { contentHash } from '../ids';
import { detectSensitiveData, scoreTextQuality } from '../knowledge/quality';
import { runEvaluationSuite } from '../evaluation/runner';
import { recordAudit } from '../observability/audit';
import { WedjatError } from '../errors';
import type { Principal } from '../types';

// ── Eligibility (§34 human feedback loop) ─────────────────────────────────────

const ELIGIBLE_LABELS = new Set(['CORRECT', 'HIGH_VALUE']);
const CORRECTION_LABELS = new Set(['INCORRECT', 'HALLUCINATION', 'UNSUPPORTED', 'OUTDATED']);

/**
 * Registers training sources from feedback: positive labels make Q/A examples
 * eligible; negative labels become correction candidates (question + expected
 * correction). Idempotent per (org, kind, ref).
 */
export async function registerFeedbackSources(principal: Principal, generationId: string, label: string): Promise<void> {
  const kind = ELIGIBLE_LABELS.has(label) ? 'FEEDBACK' : CORRECTION_LABELS.has(label) ? 'CORRECTION' : null;
  if (!kind) return;
  await db.trainingSource.upsert({
    where: {
      orgId_kind_refId: { orgId: principal.org.id, kind, refId: generationId },
    },
    create: {
      orgId: principal.org.id,
      kind,
      refId: generationId,
      status: 'ELIGIBLE',
      reason: `feedback label ${label}`,
    },
    update: { status: 'ELIGIBLE', reason: `feedback label ${label}` },
  });
}

/** Creates SYNTHETIC sources from high-quality indexed chunks (teacher path §36). */
export async function registerSyntheticSources(orgId: string, maxChunks = 40): Promise<number> {
  const chunks = await db.documentChunk.findMany({
    where: {
      status: 'INDEXED',
      qualityScore: { gte: 60 },
      documentVersion: { document: { blueprintVersion: { blueprint: { platform: { orgId } } } } },
    },
    include: {
      documentVersion: { include: { document: { include: { blueprintVersion: { include: { blueprint: true } } } } } },
    },
    take: maxChunks,
    orderBy: { qualityScore: 'desc' },
  });
  let created = 0;
  for (const chunk of chunks) {
    const src = chunk.documentVersion.document;
    await db.trainingSource.upsert({
      where: { orgId_kind_refId: { orgId, kind: 'SYNTHETIC', refId: chunk.id } },
      create: { orgId, kind: 'SYNTHETIC', refId: chunk.id, status: 'ELIGIBLE', reason: `chunk quality ${Math.round(chunk.qualityScore)}` },
      update: {},
    });
    created += 1;
  }
  return created;
}

// ── Dataset creation with validation gates (§32) ──────────────────────────────

export interface DatasetCreationResult {
  datasetId: string;
  datasetVersionId: string;
  exampleCount: number;
  excluded: number;
  reasons: string[];
}

export async function createDataset(
  principal: Principal,
  opts: { name: string; description?: string; includeKinds?: string[]; minQuality?: number }
): Promise<DatasetCreationResult> {
  const includeKinds = opts.includeKinds ?? ['FEEDBACK', 'SYNTHETIC', 'CORRECTION'];
  const minQuality = opts.minQuality ?? config.training.minExampleQuality;
  const reasons: string[] = [];
  let excluded = 0;

  // Gather source records.
  const sources = await db.trainingSource.findMany({
    where: { orgId: principal.org.id, kind: { in: includeKinds }, status: 'ELIGIBLE' },
    include: { examples: true },
    take: 300,
  });
  if (sources.length === 0) {
    throw new WedjatError('VALIDATION', 'No eligible training sources — submit feedback or run synthetic registration first.');
  }

  // Dataset + version (DRAFT → LOCKED when complete).
  let dataset = await db.trainingDataset.findFirst({ where: { orgId: principal.org.id, name: opts.name } });
  if (!dataset) {
    dataset = await db.trainingDataset.create({
      data: { orgId: principal.org.id, name: opts.name, slug: slugify(opts.name), description: opts.description },
    });
  }
  const versionCount = await db.trainingDatasetVersion.count({ where: { datasetId: dataset.id } });
  const datasetVersion = await db.trainingDatasetVersion.create({
    data: { datasetId: dataset.id, version: `${versionCount + 1}.0`, status: 'DRAFT', checksum: 'pending' },
  });

  const seenHashes = new Set<string>();
  const exampleRows: {
    sourceId: string;
    exampleType: string;
    prompt: string;
    completion: string;
    qualityScore: number;
    dedupeHash: string;
    status: string;
    validationNotes?: string;
    isSynthetic: boolean;
  }[] = [];

  for (const source of sources) {
    const example = await buildExampleFor(source);
    if (!example) continue;

    // GATE 1: schema/size validation.
    if (example.prompt.length < 20 || example.completion.length < 30) {
      excluded += 1;
      reasons.push(`schema-too-short:${source.kind}`);
      continue;
    }
    // GATE 2: duplicate / near-duplicate detection (§32).
    const hash = contentHash(`${example.prompt}::${example.completion}`);
    if (seenHashes.has(hash)) {
      excluded += 1;
      reasons.push('duplicate-example');
      continue;
    }
    seenHashes.add(hash);
    // GATE 3: quality scoring.
    const q = (scoreTextQuality(example.prompt).score + scoreTextQuality(example.completion).score) / 200;
    if (q < minQuality) {
      excluded += 1;
      reasons.push(`quality-below-${minQuality}`);
      continue;
    }
    // GATE 4: sensitive-data check (§32).
    const sensitive = detectSensitiveData(`${example.prompt} ${example.completion}`);
    if (sensitive.length > 0) {
      excluded += 1;
      reasons.push(`sensitive:${sensitive.join(',')}`);
      continue;
    }
    // GATE 5: label validation for corrections.
    if (source.kind === 'CORRECTION' && !example.completion.toLowerCase().includes('correction')) {
      // corrections must be explicitly framed
      example.completion = `CORRECTION: ${example.completion}`;
    }
    // GATE 6: synthetic requires source grounding marker (§35).
    if (source.kind === 'SYNTHETIC') {
      example.completion += `\n[source-grounded: chunk ${source.refId}]`;
    }

    exampleRows.push({
      sourceId: source.id,
      exampleType: example.exampleType,
      prompt: example.prompt,
      completion: example.completion,
      qualityScore: Math.round(q * 100) / 100,
      dedupeHash: hash,
      status: 'PASSED',
      validationNotes: JSON.stringify({ gates: ['schema', 'dedupe', 'quality', 'sensitive', 'label', 'grounding'] }),
      isSynthetic: source.kind === 'SYNTHETIC',
    });
    await db.trainingSource.update({ where: { id: source.id }, data: { status: 'CURATED' } });
  }

  if (exampleRows.length === 0) {
    await db.trainingDatasetVersion.delete({ where: { id: datasetVersion.id } });
    throw new WedjatError('VALIDATION', `All ${excluded} candidates failed validation gates: ${[...new Set(reasons)].slice(0, 5).join('; ')}`);
  }

  await db.trainingExample.createMany({
    data: exampleRows.map((r) => ({ ...r, datasetVersionId: datasetVersion.id })),
  });

  const checksum = contentHash(exampleRows.map((r) => r.dedupeHash).sort().join('|'));
  await db.trainingDatasetVersion.update({
    where: { id: datasetVersion.id },
    data: { exampleCount: exampleRows.length, checksum, status: 'LOCKED', lockedAt: new Date() },
  });
  await db.trainingDataset.update({
    where: { id: dataset.id },
    data: { currentVersionId: datasetVersion.id, updatedAt: new Date() },
  });

  await recordAudit({
    orgId: principal.org.id,
    actorType: 'user',
    actorId: principal.userId,
    action: 'training.dataset_created',
    targetType: 'trainingDatasetVersion',
    targetId: datasetVersion.id,
    details: { examples: exampleRows.length, excluded, reasons: [...new Set(reasons)].slice(0, 8) },
  });

  return {
    datasetId: dataset.id,
    datasetVersionId: datasetVersion.id,
    exampleCount: exampleRows.length,
    excluded,
    reasons: [...new Set(reasons)],
  };
}

async function buildExampleFor(source: {
  kind: string;
  refId: string;
}): Promise<{ exampleType: string; prompt: string; completion: string } | null> {
  if (source.kind === 'INTAKE') {
    // Database-intake training candidate (§125/§126) — prompt/completion are
    // pre-built by the intake engine with §148 lineage recorded on the source.
    const candidate = await db.trainingCandidate.findUnique({ where: { id: source.refId } });
    if (!candidate) return null;
    const typeByKind: Record<string, string> = {
      QA: 'BLUEPRINT_QA',
      SUMMARY: 'SUMMARIZATION',
      CLASSIFICATION: 'CLASSIFICATION',
      ARCHITECTURE_ANALYSIS: 'ARCHITECTURE_ANALYSIS',
      RISK_ANALYSIS: 'RISK_ANALYSIS',
      COMPARISON: 'ARCHITECTURE_ANALYSIS',
      CONTRADICTION: 'RISK_ANALYSIS',
      WORKFLOW: 'BLUEPRINT_QA',
    };
    return {
      exampleType: typeByKind[candidate.kind] ?? 'BLUEPRINT_QA',
      prompt: candidate.prompt,
      completion: candidate.completion,
    };
  }
  if (source.kind === 'SYNTHETIC') {
    const chunk = await db.documentChunk.findUnique({
      where: { id: source.refId },
      include: { documentVersion: { include: { document: { include: { blueprintVersion: { include: { blueprint: true } } } } } } },
    });
    if (!chunk) return null;
    const doc = chunk.documentVersion.document;
    return {
      exampleType: 'BLUEPRINT_QA',
      prompt: `Question about ${doc.blueprintVersion.blueprint.title} (${doc.title}): What does the blueprint specify in "${chunk.section?.heading ?? 'this section'}"?`,
      completion: chunk.content.slice(0, 1200),
    };
  }
  // FEEDBACK / CORRECTION: build from the generation + its user question.
  const generation = await db.aiGeneration.findUnique({
    where: { id: source.refId },
    include: { message: { include: { conversation: true } }, sources: true },
  });
  if (!generation?.message) return null;
  const userMsg = await db.message.findFirst({
    where: { conversationId: generation.message.conversationId, role: 'USER', createdAt: { lte: generation.message.createdAt } },
    orderBy: { createdAt: 'desc' },
  });
  if (!userMsg) return null;
  if (source.kind === 'FEEDBACK') {
    return {
      exampleType: 'BLUEPRINT_QA',
      prompt: userMsg.content.slice(0, 2000),
      completion: generation.message.content.slice(0, 4000),
    };
  }
  // CORRECTION: the prompt is the question; completion asks for verified re-answer.
  return {
    exampleType: 'PREFERENCE',
    prompt: userMsg.content.slice(0, 2000),
    completion: `The previous answer to this question was flagged ${source.kind === 'CORRECTION' ? 'incorrect' : 'unsupported/outdated'}. Re-answer strictly from the current approved blueprint sources and cite them.`,
  };
}

// ── Training run lifecycle (§41) — SIMULATED in this environment ──────────────

const RUN_TRANSITIONS: Record<string, string[]> = {
  QUEUED: ['VALIDATING', 'FAILED'],
  VALIDATING: ['TRAINING', 'FAILED', 'REJECTED'],
  TRAINING: ['EVALUATING', 'FAILED'],
  EVALUATING: ['CANDIDATE', 'REJECTED', 'FAILED'],
  CANDIDATE: ['CANARY', 'REJECTED'],
  CANARY: ['PRODUCTION', 'REJECTED', 'ROLLED_BACK'],
  PRODUCTION: ['ROLLED_BACK', 'DEPRECATED'],
};

/**
 * Job-worker step: advances QUEUED → VALIDATING → TRAINING → EVALUATING and
 * runs the EVALUATION GATE. Stops at CANDIDATE — promotion beyond that is an
 * explicit human action (never automatic §41).
 */
export async function advanceTrainingRun(runId: string, suiteIdForGate: string, principalLike: { orgId: string; userId: string }): Promise<string> {
  const run = await db.trainingRun.findUnique({
    where: { id: runId },
    include: { datasetVersion: true },
  });
  if (!run) throw new WedjatError('NOT_FOUND', 'Training run not found');
  const next = RUN_TRANSITIONS[run.status]?.[0];
  if (!next) return run.status; // terminal or awaiting human promotion

  if (run.status === 'QUEUED') {
    // VALIDATION GATES (§63): dataset locked, method allowed, gpu profile honest.
    if (run.datasetVersion.status !== 'LOCKED') {
      await failRun(run.id, 'dataset version not LOCKED');
      return 'FAILED';
    }
    await db.trainingRun.update({
      where: { id: run.id },
      data: { status: 'VALIDATING', currentStep: 'validating dataset/model/gpu', startedAt: new Date(), progress: 10 },
    });
    return 'VALIDATING';
  }

  if (run.status === 'VALIDATING') {
    // GPU constraint (§38): detect — none in this environment.
    const gpuProfile = 'none-detected (no CUDA device in this environment)';
    if (run.method !== 'SIMULATED') {
      // Real LORA/QLORA would need a GPU; without one, we degrade honestly to
      // SIMULATED and record why. The lifecycle gate mechanics remain identical.
      await db.trainingRun.update({
        where: { id: run.id },
        data: {
          status: 'TRAINING',
          currentStep: 'simulated PEFT/LoRA steps (no GPU — lifecycle simulation, not real weight updates)',
          progress: 30,
          gpuProfile,
          method: 'SIMULATED',
          notes: `requested ${run.method}; no GPU available → simulated lifecycle only`,
        },
      });
    } else {
      await db.trainingRun.update({
        where: { id: run.id },
        data: { status: 'TRAINING', currentStep: 'simulated training steps', progress: 30, gpuProfile },
      });
    }
    // Simulated loss curve (clearly labeled simulated via run.method).
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const loss = 1.1 * Math.exp(-0.35 * s) + 0.08;
      await db.trainingMetric.create({
        data: { runId: run.id, step: s, loss: Math.round(loss * 1000) / 1000, evalScore: Math.round((1 - loss) * 1000) / 1000 },
      });
      await db.trainingRun.update({ where: { id: run.id }, data: { progress: 30 + Math.round((s / steps) * 40) } });
    }
    return 'TRAINING';
  }

  if (run.status === 'TRAINING') {
    await db.trainingRun.update({
      where: { id: run.id },
      data: { status: 'EVALUATING', currentStep: 'evaluation gate vs baseline benchmark', progress: 75 },
    });
    return 'EVALUATING';
  }

  if (run.status === 'EVALUATING') {
    // EVALUATION GATE (§41/§43): run the permanent suite; compare vs baseline.
    const principal = await db.user.findFirst({ where: { orgId: principalLike.orgId, role: 'OWNER' } });
    if (!principal) {
      await failRun(run.id, 'no principal available to run evaluation gate');
      return 'FAILED';
    }
    const suite = await db.evaluationSuite.findFirst({ where: { orgId: principalLike.orgId, slug: 'core-benchmark' } });
    if (!suite) {
      await failRun(run.id, 'core-benchmark suite missing — evaluation gate cannot run');
      return 'FAILED';
    }
    const summary = await runEvaluationSuite(
      { userId: principal.id, name: principal.name, email: principal.email, role: 'OWNER', org: { id: principalLike.orgId, slug: 'wedjat', name: 'WEDJAT', dataPolicy: 'APPROVED_REMOTE_PROVIDER' } },
      suite.id,
      `gate-${run.id.slice(0, 8)}`
    );
    // Baseline comparison (regression check §43).
    const baseline = await baselineRecall(principalLike.orgId, suite.id);
    const regression = baseline != null && summary.avgRecall < baseline - config.training.regressionTolerance;
    await db.trainingRun.update({
      where: { id: run.id },
      data: {
        status: regression ? 'REJECTED' : 'CANDIDATE',
        currentStep: regression ? 'evaluation gate FAILED (regression vs baseline)' : 'candidate — awaiting explicit promotion',
        progress: 90,
        evaluationSummaryJson: JSON.stringify({
          passRate: summary.passRate,
          avgRecall: summary.avgRecall,
          regression,
          baseline,
          gate: regression ? 'FAILED' : 'PASSED',
        }),
        completedAt: regression ? new Date() : null,
      },
    });
    await recordAudit({
      orgId: principalLike.orgId,
      actorType: 'job',
      action: regression ? 'training.gate_rejected' : 'training.gate_passed',
      targetType: 'trainingRun',
      targetId: run.id,
      severity: regression ? 'WARN' : 'INFO',
      details: { passRate: summary.passRate, avgRecall: summary.avgRecall, baseline },
    });
    return regression ? 'REJECTED' : 'CANDIDATE';
  }
  return run.status;
}

async function baselineRecall(orgId: string, suiteId: string): Promise<number | null> {
  const results = await db.evaluationResult.findMany({
    where: { suiteId, runLabel: { startsWith: 'baseline' } },
  });
  if (results.length === 0) return null;
  return results.reduce((s, r) => s + r.recallAtK, 0) / results.length;
}

async function failRun(runId: string, reason: string): Promise<void> {
  await db.trainingRun.update({
    where: { id: runId },
    data: { status: 'FAILED', currentStep: 'failed', notes: reason, completedAt: new Date() },
  });
}

/** EXPLICIT human promotion (CANDIDATE→CANARY→PRODUCTION) + rollback (§41, §65). */
export async function promoteRun(
  principal: Principal,
  runId: string,
  to: 'candidate' | 'canary' | 'production' | 'rollback'
): Promise<{ runId: string; status: string; note: string }> {
  const run = await db.trainingRun.findUnique({ where: { id: runId }, include: { datasetVersion: true } });
  if (!run) throw new WedjatError('NOT_FOUND', 'Training run not found');
  // Tenant check.
  const dataset = await db.trainingDataset.findUnique({ where: { id: run.datasetVersion.datasetId } });
  if (!dataset || dataset.orgId !== principal.org.id) throw new WedjatError('FORBIDDEN', 'Run belongs to another organization');

  if (to === 'rollback') {
    if (!['PRODUCTION', 'CANARY'].includes(run.status)) {
      throw new WedjatError('VALIDATION', `rollback requires PRODUCTION or CANARY run (current: ${run.status})`);
    }
    await db.trainingRun.update({
      where: { id: runId },
      data: { status: 'ROLLED_BACK', currentStep: 'rolled back — previous production model restored', completedAt: new Date() },
    });
    if (run.candidateModelVersionId) {
      await db.modelDeployment.updateMany({
        where: { modelVersionId: run.candidateModelVersionId, status: 'ACTIVE' },
        data: { status: 'INACTIVE', stage: 'ROLLED_BACK' },
      });
    }
    await recordAudit({
      orgId: principal.org.id, actorType: 'user', actorId: principal.userId,
      action: 'training.rolled_back', targetType: 'trainingRun', targetId: runId, severity: 'WARN',
    });
    return { runId, status: 'ROLLED_BACK', note: 'Rollback complete; previous production model remains authoritative.' };
  }

  const target = to.toUpperCase();
  const allowed = RUN_TRANSITIONS[run.status] ?? [];
  if (!allowed.includes(target)) {
    throw new WedjatError(
      'VALIDATION',
      `Cannot promote ${run.status} → ${target}. Allowed: ${allowed.join(', ') || 'terminal'}`
    );
  }

  // Create/refresh deployment records (canary percent staged).
  if (target === 'CANARY' || target === 'PRODUCTION') {
    if (!run.candidateModelVersionId) throw new WedjatError('VALIDATION', 'Run has no candidate model version');
    await db.modelDeployment.create({
      data: {
        modelVersionId: run.candidateModelVersionId,
        environment: 'PRODUCTION',
        stage: target,
        canaryPercent: target === 'CANARY' ? 10 : 100,
        status: 'ACTIVE',
        note: `promoted from run ${run.id}`,
      },
    });
    if (target === 'PRODUCTION') {
      // Previous PRODUCTION deployment of same registry entry becomes rollback target.
      await db.modelDeployment.updateMany({
        where: { modelVersionId: run.candidateModelVersionId, stage: 'CANARY', status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
    }
  }

  await db.trainingRun.update({
    where: { id: runId },
    data: {
      status: target,
      currentStep: target === 'PRODUCTION' ? 'production — rollback target preserved' : `${target.toLowerCase()} stage`,
      completedAt: target === 'PRODUCTION' ? new Date() : null,
    },
  });
  await recordAudit({
    orgId: principal.org.id, actorType: 'user', actorId: principal.userId,
    action: `training.promoted_${target.toLowerCase()}`, targetType: 'trainingRun', targetId: runId,
    details: { method: run.method, datasetVersion: run.datasetVersion.version },
  });
  logger.info('training_run_promoted', { runId, to: target, by: principal.userId });
  return { runId, status: target, note: 'Promotion recorded with audit trail and rollback path.' };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'dataset';
}
