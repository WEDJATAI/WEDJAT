// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: continuous health check + AI improvement queue
// (§135–§138, §156).
//
// Periodically inspects retrieval failures, hallucination feedback, stale
// knowledge, conflicting sources, failed ingestion/training jobs, model
// regressions and provider degradation. Findings become prioritized
// ImprovementQueueItems with PROPOSED ACTIONS — auto-learning signals feed
// future knowledge expansion / retrieval improvement / dataset creation (§135),
// corrections (§136), failed-retrieval analysis (§137 — retrieval before
// fine-tuning!) and hallucination cases (§138).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

export interface HealthCheckItem {
  check: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
  metric: string;
}

export interface HealthCheckOutcome {
  checks: HealthCheckItem[];
  issuesFound: number;
  queueItemsCreated: number;
  durationMs: number;
}

interface QueueDraft {
  kind: string;
  description: string;
  evidence: Record<string, unknown>;
  priority: string;
  proposedAction: string;
}

export async function runHealthCheck(orgId: string): Promise<HealthCheckOutcome> {
  const started = Date.now();
  const checks: HealthCheckItem[] = [];
  const queue: QueueDraft[] = [];
  const since = new Date(Date.now() - 7 * 86_400_000);

  // ── retrieval failures (§137) ───────────────────────────────────────────────
  const emptyRetrievals = await db.retrievalEvent.count({
    where: { createdAt: { gte: since }, resultCount: 0, query: { not: '' } },
  });
  checks.push({
    check: 'retrieval_failures',
    status: emptyRetrievals > 3 ? 'WARN' : 'OK',
    detail: `${emptyRetrievals} queries in the last 7 days retrieved zero chunks`,
    metric: String(emptyRetrievals),
  });
  if (emptyRetrievals > 0) {
    queue.push({
      kind: 'RETRIEVAL_MISS',
      description: `${emptyRetrievals} retrieval miss(es) in the last 7 days — questions had sources available but retrieval missed them (§137).`,
      evidence: { count: emptyRetrievals, window: '7d' },
      priority: emptyRetrievals > 5 ? 'P1' : 'P2',
      proposedAction: 'Optimize chunking / metadata filters / query expansion / reranking FIRST — do not fine-tune the LLM when the problem is retrieval (§137).',
    });
  }

  // ── hallucination / unsupported feedback (§138) ─────────────────────────────
  const badFeedback = await db.feedback.count({
    where: { createdAt: { gte: since }, label: { in: ['HALLUCINATION', 'UNSUPPORTED', 'INCORRECT'] } },
  });
  checks.push({
    check: 'hallucination_feedback',
    status: badFeedback > 2 ? 'WARN' : 'OK',
    detail: `${badFeedback} hallucination/unsupported/incorrect feedback labels in 7 days`,
    metric: String(badFeedback),
  });
  if (badFeedback > 0) {
    queue.push({
      kind: 'HALLUCINATION',
      description: `${badFeedback} user-flagged unsupported or hallucinated answers (§138).`,
      evidence: { count: badFeedback, window: '7d' },
      priority: badFeedback > 3 ? 'P0' : 'P1',
      proposedAction: 'Create structured failure cases; verify grounding gaps; improve prompts/retrieval before any model training.',
    });
  }

  // ── corrections (§136) ──────────────────────────────────────────────────────
  const corrections = await db.feedback.count({
    where: { createdAt: { gte: since }, comment: { not: null } },
  });
  const failureMemory = await db.failureMemory.count({ where: { orgId } });
  checks.push({
    check: 'corrections_memory',
    status: failureMemory > 0 ? 'OK' : 'OK',
    detail: `${corrections} commented feedback items; ${failureMemory} failure-memory entries retained`,
    metric: String(failureMemory),
  });
  if (corrections > 0) {
    queue.push({
      kind: 'CORRECTION',
      description: `${corrections} human correction(s) to review — each is an evaluation case + knowledge-improvement candidate + training candidate (§136).`,
      evidence: { count: corrections },
      priority: 'P2',
      proposedAction: 'Review corrections; store original answer, correction, evidence and versions as evaluation cases.',
    });
  }

  // ── stale knowledge (§158) ──────────────────────────────────────────────────
  const totalKr = await db.knowledgeRecord.count({});
  const staleKr = await db.knowledgeRecord.count({
    where: { status: { in: ['HISTORICAL', 'SUPERSEDED'] } },
  });
  const stalePct = totalKr > 0 ? Math.round((staleKr / totalKr) * 100) : 0;
  checks.push({
    check: 'stale_knowledge',
    status: stalePct > 50 ? 'WARN' : 'OK',
    detail: `${stalePct}% of knowledge records are HISTORICAL/SUPERSEDED (${staleKr}/${totalKr}) — RAG prefers latest valid sources (§158)`,
    metric: `${stalePct}%`,
  });

  // ── conflicting sources (§156) ──────────────────────────────────────────────
  const conflicts = await db.knowledgeRecord.groupBy({
    by: ['topicKey'],
    where: { topicKey: { not: null }, status: 'CURRENT' },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    orderBy: { _count: { id: 'desc' } },
    take: 20,
  });
  checks.push({
    check: 'conflicting_sources',
    status: conflicts.length > 0 ? 'WARN' : 'OK',
    detail: `${conflicts.length} topic keys carry multiple CURRENT statements (potential contradictions)`,
    metric: String(conflicts.length),
  });
  if (conflicts.length > 0) {
    queue.push({
      kind: 'CONFLICTING_SOURCES',
      description: `${conflicts.length} knowledge topic(s) contain multiple CURRENT statements — possible contradictions (§156).`,
      evidence: { topics: conflicts.slice(0, 5).map((c) => c.topicKey) },
      priority: 'P2',
      proposedAction: 'Run the contradiction analysis workflow; supersede outdated statements (retain history §158).',
    });
  }

  // ── failed ingestion / training (§156) ──────────────────────────────────────
  const failedJobs = await db.job.count({ where: { status: 'FAILED' } });
  checks.push({
    check: 'failed_jobs',
    status: failedJobs > 0 ? 'WARN' : 'OK',
    detail: `${failedJobs} jobs in FAILED state (ingestion/training/eval)`,
    metric: String(failedJobs),
  });
  if (failedJobs > 0) {
    queue.push({
      kind: 'FAILED_INGESTION',
      description: `${failedJobs} failed job(s) need triage (§156).`,
      evidence: { count: failedJobs },
      priority: failedJobs > 3 ? 'P1' : 'P2',
      proposedAction: 'Inspect job lastError, retry or cancel; verify DB and provider health.',
    });
  }
  const failedRuns = await db.trainingRun.count({ where: { status: { in: ['FAILED', 'REJECTED', 'ROLLED_BACK'] } } });
  checks.push({
    check: 'failed_training',
    status: failedRuns > 0 ? 'WARN' : 'OK',
    detail: `${failedRuns} training run(s) failed/rejected/rolled back`,
    metric: String(failedRuns),
  });

  // ── model regression (§156/§131) — compare last two evaluation runs ──────────
  const latestResults = await db.evaluationResult.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { runLabel: true, passed: true, groundedness: true, createdAt: true },
  });
  const byLabel = new Map<string, { total: number; passed: number; grounded: number[] }>();
  for (const r of latestResults) {
    if (!byLabel.has(r.runLabel)) byLabel.set(r.runLabel, { total: 0, passed: 0, grounded: [] });
    const agg = byLabel.get(r.runLabel)!;
    agg.total += 1;
    if (r.passed) agg.passed += 1;
    if (r.groundedness != null) agg.grounded.push(r.groundedness);
  }
  const labels = [...byLabel.keys()].slice(0, 2);
  if (labels.length === 2) {
    const rate = (l: string) => byLabel.get(l)!.passed / Math.max(1, byLabel.get(l)!.total);
    const drop = rate(labels[0]) - rate(labels[1]);
    checks.push({
      check: 'model_regression',
      status: drop > 0.05 ? 'WARN' : 'OK',
      detail: `latest suite pass-rate ${Math.round(rate(labels[0]) * 100)}% vs previous ${Math.round(rate(labels[1]) * 100)}%`,
      metric: `${drop >= 0 ? '+' : ''}${Math.round(drop * 100)}pp`,
    });
    if (drop > 0.05) {
      queue.push({
        kind: 'MODEL_REGRESSION',
        description: `Benchmark pass-rate dropped ${Math.round(drop * 100)}pp between recent evaluation runs (§131).`,
        evidence: { latest: labels[0], previous: labels[1] },
        priority: 'P0',
        proposedAction: 'Investigate the failing cases; consider rollback if a candidate was promoted (§134).',
      });
    }
  } else {
    checks.push({ check: 'model_regression', status: 'OK', detail: 'insufficient evaluation history for trend', metric: 'n/a' });
  }

  // ── provider degradation (§156) ─────────────────────────────────────────────
  const openCircuits = await db.providerHealth.count({ where: { circuitState: { in: ['OPEN', 'HALF_OPEN'] } } });
  checks.push({
    check: 'provider_degradation',
    status: openCircuits > 0 ? 'WARN' : 'OK',
    detail: `${openCircuits} provider circuit(s) OPEN/HALF_OPEN`,
    metric: String(openCircuits),
  });
  if (openCircuits > 0) {
    queue.push({
      kind: 'PROVIDER_DEGRADATION',
      description: `${openCircuits} provider circuit breaker(s) open — failover active (§156).`,
      evidence: { count: openCircuits },
      priority: 'P1',
      proposedAction: 'Check provider keys/quotas; the router already fails over; verify answer quality did not degrade.',
    });
  }

  // ── database problems (§156) ────────────────────────────────────────────────
  try {
    await db.$queryRaw`SELECT 1`;
    checks.push({ check: 'database', status: 'OK', detail: 'SQLite control plane reachable', metric: 'ok' });
  } catch {
    checks.push({ check: 'database', status: 'FAIL', detail: 'control-plane database unreachable', metric: 'error' });
    queue.push({ kind: 'FAILED_INGESTION', description: 'Control-plane database connectivity failure.', evidence: {}, priority: 'P0', proposedAction: 'Inspect DATABASE_URL and disk health.' });
  }

  // ── persist report + queue items (dedupe by kind+description) ───────────────
  const issues = checks.filter((c) => c.status !== 'OK').length;
  let created = 0;
  for (const item of queue) {
    const existing = await db.improvementQueueItem.findFirst({
      where: { orgId, kind: item.kind, description: item.description, status: 'OPEN' },
    });
    if (existing) continue;
    await db.improvementQueueItem.create({
      data: {
        orgId,
        kind: item.kind,
        description: item.description,
        evidenceJson: JSON.stringify(item.evidence),
        priority: item.priority,
        proposedAction: item.proposedAction,
        status: 'OPEN',
      },
    });
    created += 1;
  }

  await db.healthCheckReport.create({
    data: {
      orgId,
      issuesFound: issues,
      durationMs: Date.now() - started,
      checksJson: JSON.stringify(checks),
      summaryJson: JSON.stringify({ queueItemsCreated: created, checks: checks.length }),
    },
  });

  return { checks, issuesFound: issues, queueItemsCreated: created, durationMs: Date.now() - started };
}
