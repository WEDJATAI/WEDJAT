// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Durable async job system (§62).
//
// WHY: long-running operations (ingestion, embedding/reindex, dataset
// generation, training, evaluation, bulk analysis) must NEVER block HTTP.
// Jobs are persisted (Job rows) with statuses QUEUED/RUNNING/RETRYING/FAILED/
// CANCELLED/COMPLETED, bounded attempts, idempotency keys (§61), and progress.
// A single in-process worker polls the queue (started via instrumentation.ts).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { logger } from '../logger';
import { newTraceId } from '../ids';
import { runIngestion } from '../knowledge/ingestion';
import { advanceTrainingRun, registerSyntheticSources } from '../training/lifecycle';
import { runEvaluationSuite } from '../evaluation/runner';
import { metrics } from './metrics';
import { runIntake } from '../intake/engine';
import { runHealthCheck } from '../intake/health';
import { getAutonomyState, autonomyAllows } from '../intake/autonomy';
import { dispatchEvent } from '../fabric/dispatch';
export type JobType =
  | 'ingestion'
  | 'training-run-step'
  | 'evaluation-run'
  | 'synthetic-registration'
  | 'database-intake'
  | 'fabric-dispatch';

interface JobPayloadBase {
  orgId: string;
  userId?: string;
  traceId?: string;
}

export interface IngestJobPayload extends JobPayloadBase {
  kind: 'ingestion';
  input: {
    orgId: string;
    platformSlug: string;
    blueprintSlug: string;
    blueprintTitle?: string;
    blueprintVersion?: string;
    title: string;
    docType?: string;
    classification?: string;
    content: string;
    documentVersion?: string;
    sourcePath?: string;
    actorId?: string;
    idempotencyKey?: string;
  };
}

export interface TrainingRunJobPayload extends JobPayloadBase {
  kind: 'training-run-step';
  runId: string;
}

export interface EvaluationJobPayload extends JobPayloadBase {
  kind: 'evaluation-run';
  suiteId: string;
  label?: string;
}

export interface SyntheticJobPayload extends JobPayloadBase {
  kind: 'synthetic-registration';
  maxChunks?: number;
}

export interface DatabaseIntakeJobPayload extends JobPayloadBase {
  kind: 'database-intake';
  runId: string;
  /** Data classification applied to ingested documents (§66). */
  classification?: 'INTERNAL' | 'CONFIDENTIAL' | 'PUBLIC';
}

// v4 §56-§60: event-fabric dispatch (one job per received event; bounded
// retries + DLQ routing live inside dispatchEvent — §60/§104).
export interface FabricDispatchJobPayload extends JobPayloadBase {
  kind: 'fabric-dispatch';
  eventRecordId: string;
}

export type JobPayload =
  | IngestJobPayload
  | TrainingRunJobPayload
  | EvaluationJobPayload
  | SyntheticJobPayload
  | DatabaseIntakeJobPayload
  | FabricDispatchJobPayload;

/** Enqueue a job (idempotent via idempotencyKey §61). */
export async function enqueueJob(
  payload: JobPayload,
  opts: { idempotencyKey?: string; maxAttempts?: number } = {}
): Promise<{ jobId: string; duplicate: boolean }> {
  const traceId = newTraceId();
  if (opts.idempotencyKey) {
    const existing = await db.job.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return { jobId: existing.id, duplicate: true };
  }
  const job = await db.job.create({
    data: {
      type: payload.kind,
      status: 'QUEUED',
      payloadJson: JSON.stringify(payload),
      idempotencyKey: opts.idempotencyKey,
      traceId,
      maxAttempts: opts.maxAttempts ?? 3,
    },
  });
  metrics.bumpIngestionJob();
  logger.info('job_enqueued', { jobId: job.id, type: payload.kind, traceId });
  return { jobId: job.id, duplicate: false };
}

// ── Worker loop ───────────────────────────────────────────────────────────────

let workerRunning = false;
let healthCheckRunning = false;

export function startJobWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  logger.info('job_worker_started', {});
  const tick = async () => {
    try {
      await claimAndRunOneJob();
    } catch (err) {
      logger.error('job_worker_tick_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  setInterval(tick, 1500);

  // §156: continuous health check every 5 minutes (first run after 30s warmup).
  const healthTick = async () => {
    if (healthCheckRunning) return;
    healthCheckRunning = true;
    try {
      const orgs = await db.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const org of orgs) {
        await runHealthCheck(org.id);
      }
    } catch (err) {
      logger.warn('health_check_failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      healthCheckRunning = false;
    }
  };
  setTimeout(() => {
    void healthTick();
    setInterval(() => void healthTick(), 5 * 60_000);
  }, 30_000);
}

/** Claims ONE queued job (status → RUNNING) and executes it. */
async function claimAndRunOneJob(): Promise<void> {
  // Atomic-ish claim: find oldest QUEUED job and flip to RUNNING.
  const queued = await db.job.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  for (const job of queued) {
    const claimed = await db.job.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // another worker claimed it
    await executeJob(job.id, job.type, safeParse(job.payloadJson));
    return; // one job per tick keeps the loop responsive
  }
}

async function executeJob(jobId: string, type: string, payload: unknown): Promise<void> {
  const started = Date.now();
  try {
    let result: Record<string, unknown> = {};
    switch (type) {
      case 'ingestion': {
        const p = payload as IngestJobPayload;
        const ingest = await runIngestion(p.input);
        result = {
          documentVersionId: ingest.documentVersionId,
          duplicate: ingest.duplicate,
          stages: ingest.stages,
          traceId: ingest.traceId,
        };
        break;
      }
      case 'training-run-step': {
        const p = payload as TrainingRunJobPayload;
        const status = await advanceTrainingRun(p.runId, 'core-benchmark', {
          orgId: p.orgId,
          userId: p.userId ?? 'job-worker',
        });
        result = { runId: p.runId, status };
        // Non-terminal statuses that still need stepping → requeue a follow-up job.
        if (['VALIDATING', 'TRAINING', 'EVALUATING'].includes(status)) {
          await enqueueJob({ kind: 'training-run-step', orgId: p.orgId, userId: p.userId, runId: p.runId });
        }
        // §151 LEVEL 5: controlled auto-deployment — when evaluation + regression
        // gates pass, the candidate auto-advances to CANARY. PRODUCTION promotion
        // is NEVER automatic (§127/§152 governance override).
        if (status === 'CANDIDATE') {
          try {
            const autonomy = await getAutonomyState(p.orgId);
            if (autonomyAllows(autonomy.level, 'AUTO_CANARY')) {
              const next = await advanceTrainingRun(p.runId, 'core-benchmark', {
                orgId: p.orgId,
                userId: p.userId ?? 'job-worker',
              });
              result = { runId: p.runId, status: next, note: 'auto-canary (§151 LEVEL 5; production promotion remains human-controlled)' };
            }
          } catch (err) {
            logger.warn('auto_canary_failed', { runId: p.runId, error: err instanceof Error ? err.message : String(err) });
          }
        }
        break;
      }
      case 'evaluation-run': {
        const p = payload as EvaluationJobPayload;
        const owner = await db.user.findFirst({ where: { orgId: p.orgId, role: 'OWNER' } });
        if (!owner) throw new Error('no owner user found for evaluation');
        const summary = await runEvaluationSuite(
          {
            userId: owner.id,
            name: owner.name,
            email: owner.email,
            role: 'OWNER',
            org: { id: p.orgId, slug: 'wedjat', name: 'WEDJAT', dataPolicy: 'APPROVED_REMOTE_PROVIDER' },
          },
          p.suiteId,
          p.label
        );
        result = { ...summary };
        break;
      }
      case 'synthetic-registration': {
        const p = payload as SyntheticJobPayload;
        const created = await registerSyntheticSources(p.orgId, p.maxChunks ?? 40);
        result = { created };
        break;
      }
      case 'database-intake': {
        const p = payload as DatabaseIntakeJobPayload;
        const outcome = await runIntake(p.runId, p.userId ?? 'intake-job', p.classification ?? 'INTERNAL');
        result = {
          status: outcome.status,
          tables: outcome.tables,
          rows: outcome.rows,
          knowledgeRecords: outcome.knowledgeRecords,
          trainingCandidates: outcome.trainingCandidates,
          narrative: outcome.narrative,
        };
        break;
      }
      case 'fabric-dispatch': {
        const p = payload as FabricDispatchJobPayload;
        const outcome = await dispatchEvent(p.eventRecordId);
        result = { status: outcome.status, summary: outcome.summary };
        break;
      }
      default:
        throw new Error(`unknown job type ${type}`);
    }
    await db.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', progress: 100, completedAt: new Date(), resultJson: JSON.stringify(result) },
    });
    logger.info('job_completed', { jobId, type, latencyMs: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const job = await db.job.findUnique({ where: { id: jobId } });
    const attempts = job?.attempts ?? 1;
    const maxAttempts = job?.maxAttempts ?? 3;
    // Transient failures → RETRYING with backoff (bounded by maxAttempts).
    const retryable = /timeout|temporarily|network|fetch failed|ECONN/i.test(message);
    if (retryable && attempts < maxAttempts) {
      await db.job.update({
        where: { id: jobId },
        data: { status: 'RETRYING', lastError: message.slice(0, 500), progress: 0 },
      });
      // Requeue after backoff by resetting status once the delay elapses.
      setTimeout(async () => {
        try {
          await db.job.updateMany({ where: { id: jobId, status: 'RETRYING' }, data: { status: 'QUEUED' } });
        } catch { /* best effort */ }
      }, 2000 * attempts);
      logger.warn('job_retrying', { jobId, type, attempts, error: message });
    } else {
      await db.job.update({
        where: { id: jobId },
        data: { status: 'FAILED', lastError: message.slice(0, 500), completedAt: new Date() },
      });
      logger.error('job_failed', { jobId, type, error: message });
    }
  }
}

function safeParse(json: string): JobPayload {
  try {
    return JSON.parse(json) as JobPayload;
  } catch {
    throw new Error('job payload parse error');
  }
}

/**
 * Deterministic inline execution for serverless (Vercel): claims the job if it
 * is still QUEUED and executes it immediately. Called from route handlers via
 * after() so the function stays alive past the response. The interval worker
 * remains the fallback for jobs enqueued without a request context.
 */
export async function processJobNow(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status !== 'QUEUED') return; // already claimed/completed elsewhere
  const claimed = await db.job.updateMany({
    where: { id: job.id, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return; // raced with the interval worker — fine
  await executeJob(job.id, job.type, safeParse(job.payloadJson));
}

/** Retry / cancel controls for the UI. */
export async function retryJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('job not found');
  if (!['FAILED', 'CANCELLED'].includes(job.status)) throw new Error(`cannot retry job in status ${job.status}`);
  await db.job.update({
    where: { id: jobId },
    data: { status: 'QUEUED', lastError: null, progress: 0, attempts: 0 },
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('job not found');
  if (!['QUEUED', 'RETRYING'].includes(job.status)) {
    throw new Error(`cannot cancel job in status ${job.status}`);
  }
  await db.job.update({ where: { id: jobId }, data: { status: 'CANCELLED', completedAt: new Date() } });
}
