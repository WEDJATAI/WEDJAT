// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Recommendations + outcomes closed loop (§40-§44, §63-§67, §41).
//
// §41: learning never controls production — recommendations are PROPOSALS with
// evidence, confidence, priority, expected benefit and potential risk. Status
// history is APPENDED, never rewritten. Measured outcomes (§44: before/after)
// become LESSON_LEARNED knowledge through the standard ingestion pipeline —
// the closed loop (§65: recommendation → implementation → measured outcome →
// knowledge update → better recommendations).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { WedjatError } from '../errors';
import { logger } from '../logger';
import { recordAudit } from '../observability/audit';
import { runIngestion } from '../knowledge/ingestion';

export const RECO_STATUSES = [
  'PROPOSED', 'ACCEPTED', 'REJECTED', 'IMPLEMENTED', 'PARTIALLY_IMPLEMENTED',
  'FAILED', 'REVERTED', 'VALIDATED', 'SUPERSEDED',
] as const;
export type RecoStatus = (typeof RECO_STATUSES)[number];

export const OUTCOME_VALUES = [
  'IMPLEMENTED', 'NOT_IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'FAILED', 'REVERTED', 'VALIDATED',
] as const;

interface StatusHistoryEntry {
  status: string;
  at: string;
  by: string;
  note?: string;
}

async function appendStatus(orgId: string, id: string, status: RecoStatus, by: string, note?: string): Promise<void> {
  const rec = await db.recommendation.findFirst({ where: { id, orgId } });
  if (!rec) throw new WedjatError('NOT_FOUND', 'recommendation not found');
  const history = (() => {
    try { return JSON.parse(rec.statusHistoryJson) as StatusHistoryEntry[]; } catch { return []; }
  })();
  history.push({ status, at: new Date().toISOString(), by, note: note?.slice(0, 500) });
  await db.recommendation.update({
    where: { id },
    data: { status, statusHistoryJson: JSON.stringify(history) },
  });
}

/** Lifecycle transition (CURATOR+) — appends status, never rewrites history. */
export async function appendRecommendationStatus(
  orgId: string, id: string, status: RecoStatus, by: string, note?: string
): Promise<{ id: string; status: string }> {
  if (!RECO_STATUSES.includes(status)) throw new WedjatError('VALIDATION', `status must be one of ${RECO_STATUSES.join('|')}`);
  await appendStatus(orgId, id, status, by, note);
  await recordAudit({
    orgId, actorType: 'user', actorId: by, action: 'recommendation.status',
    targetType: 'Recommendation', targetId: id, severity: 'INFO',
    detailsJson: JSON.stringify({ status }),
  });
  return { id, status };
}

// ── §65 closed loop: measured outcomes become knowledge ─────────────────────

export interface OutcomeInput {
  orgId: string;
  recommendationId: string;
  outcome: string;
  metricName?: string;
  beforeValue?: string;
  afterValue?: string;
  notes?: string;
  reportedBy: string;
  commitRef?: string;
  deploymentRef?: string;
  measuredAt?: string;
}

export async function applyRecommendationOutcome(input: OutcomeInput): Promise<{ recorded: true; learning: string }> {
  if (!OUTCOME_VALUES.includes(input.outcome as (typeof OUTCOME_VALUES)[number])) {
    throw new WedjatError('VALIDATION', `outcome must be one of ${OUTCOME_VALUES.join('|')}`);
  }
  const rec = await db.recommendation.findFirst({ where: { id: input.recommendationId, orgId: input.orgId } });
  if (!rec) throw new WedjatError('NOT_FOUND', 'recommendation not found');

  let changePct: number | null = null;
  const before = parseFloat(input.beforeValue ?? '');
  const after = parseFloat(input.afterValue ?? '');
  if (Number.isFinite(before) && Number.isFinite(after) && before !== 0) {
    changePct = Math.round(((after - before) / Math.abs(before)) * 1000) / 10;
  }

  await db.recommendationOutcome.create({
    data: {
      recommendationId: rec.id,
      orgId: input.orgId,
      outcome: input.outcome,
      metricName: input.metricName?.slice(0, 120),
      beforeValue: input.beforeValue?.slice(0, 120),
      afterValue: input.afterValue?.slice(0, 120),
      changePct,
      notes: input.notes?.slice(0, 2000),
      reportedBy: input.reportedBy.slice(0, 120),
      commitRef: input.commitRef?.slice(0, 80),
      deploymentRef: input.deploymentRef?.slice(0, 120),
      measuredAt: input.measuredAt ? new Date(input.measuredAt) : new Date(),
    },
  });

  // Status sync (append-only): IMPLEMENTED/… map onto the lifecycle.
  const statusFor: Record<string, RecoStatus> = {
    IMPLEMENTED: 'IMPLEMENTED', PARTIALLY_IMPLEMENTED: 'PARTIALLY_IMPLEMENTED',
    NOT_IMPLEMENTED: 'REJECTED', FAILED: 'FAILED', REVERTED: 'REVERTED', VALIDATED: 'VALIDATED',
  };
  const mapped = statusFor[input.outcome];
  if (mapped && rec.status !== mapped) {
    await appendStatus(input.orgId, rec.id, mapped, input.reportedBy, `outcome reported: ${input.outcome}`);
  }

  // §67: recommendation + implementation + MEASURED outcome = high-quality
  // learning example. Stored as LESSON_LEARNED knowledge via ingestion.
  const improved = input.outcome === 'VALIDATED' || (changePct !== null && changePct < 0 && input.metricName?.match(/latency|error|failure|cost/i));
  const learning = [
    `# Lesson learned — ${rec.platformSlug}: ${rec.recommendation.slice(0, 120)}`,
    '',
    `- Outcome: **${input.outcome}**${input.metricName ? ` on ${input.metricName}` : ''}`,
    input.beforeValue !== undefined && input.afterValue !== undefined
      ? `- Measured: ${input.beforeValue} → ${input.afterValue}${changePct !== null ? ` (${changePct > 0 ? '+' : ''}${changePct}%)` : ''}`
      : null,
    `- Finding: ${rec.finding.slice(0, 300)}`,
    `- Assessment: ${improved ? 'SUCCESS — pattern validated by measured evidence (v4 §39/§66).' : 'INFORMATIVE — outcome recorded; monitor before reuse (v4 §67).'}`,
    input.notes ? `- Notes: ${input.notes.slice(0, 500)}` : null,
    input.commitRef ? `- Commit: ${input.commitRef}` : null,
    `- Reported by: ${input.reportedBy}`,
    '',
    `_Source: WEDJAT closed-loop learning (v4 §65). Recommendation ${rec.id}._`,
  ].filter((l): l is string => l !== null).join('\n');

  const platform = await db.platform.findFirst({ where: { orgId: input.orgId, slug: rec.platformSlug } });
  if (platform) {
    try {
      await runIngestion({
        orgId: input.orgId,
        platformSlug: rec.platformSlug,
        blueprintSlug: 'organizational-lessons',
        blueprintTitle: 'Organizational Lessons Learned',
        blueprintType: 'LESSON_LEARNED',
        title: `Outcome — ${rec.recommendation.slice(0, 100)}`,
        docType: 'LESSON_LEARNED',
        classification: 'INTERNAL',
        content: learning,
        documentVersion: '1',
        sourcePath: `outcome:${rec.id}:${input.outcome}`,
        actorId: 'wedjat-fabric',
        idempotencyKey: `outcome-${rec.id}-${input.outcome}-${input.measuredAt ?? Date.now()}`,
      });
    } catch (err) {
      logger.warn('outcome_learning_ingest_failed', { recId: rec.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await recordAudit({
    orgId: input.orgId, actorType: 'system', actorId: 'wedjat-fabric', action: 'recommendation.outcome',
    targetType: 'Recommendation', targetId: rec.id, severity: 'INFO',
    detailsJson: JSON.stringify({ outcome: input.outcome, changePct }),
  });
  return { recorded: true, learning };
}

// ── §42 evidence-based generation (deterministic — no fabricated findings) ──

interface FindingDraft {
  platformSlug: string;
  finding: string;
  recommendation: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  confidence: number;
  sourceType: string;
  sourceRef: string;
  evidence: { source: string; detail: string; version?: string }[];
}

/**
 * Generates recommendations from EXISTING evidence only: FailureMemory, open
 * ImprovementQueueItems, health-check findings and drift reports (§42/§104).
 * Every finding cites its evidence — nothing is invented (§119: no
 hallucinated organizational facts).
 */
export async function generateRecommendations(
  orgId: string,
  platformSlug?: string,
  byUserId = 'wedjat-analysis'
): Promise<{ created: number }> {
  const drafts: FindingDraft[] = [];
  const platformFilter = platformSlug ?? undefined;

  // 1. Failure memory (§38): repeated failures without resolution.
  const failures = await db.failureMemory.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const failByPlatform = new Map<string, number>();
  for (const f of failures) {
    const m = f.reason?.match(/\[platform:\s*([a-z0-9-]+)\]/i)
      ?? f.source?.match(/platform[:\s]*([a-z0-9-]+)/i) ?? null;
    const plat = m ? m[1].toLowerCase() : 'unknown';
    failByPlatform.set(plat, (failByPlatform.get(plat) ?? 0) + 1);
  }
  for (const [plat, count] of failByPlatform) {
    if (count >= 2) {
      drafts.push({
        platformSlug: platformFilter ?? plat,
        finding: `${count} recorded failure(s) reference this platform without a validated resolution.`,
        recommendation: 'Run a resilience review on the affected components and record the resolution so the lesson becomes reusable knowledge (v4 §38).',
        priority: count >= 4 ? 'P1' : 'P2',
        confidence: 0.6,
        sourceType: 'ANALYSIS',
        sourceRef: `failure-memory:${plat}`,
        evidence: [{ source: 'FailureMemory', detail: `${count} entries` }],
      });
    }
  }

  // 2. Open improvement queue items (auto-learning signals).
  const openItems = await db.improvementQueueItem.findMany({
    where: { orgId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const p0p1 = openItems.filter((i) => i.priority === 'P0' || i.priority === 'P1');
  if (p0p1.length > 0) {
    drafts.push({
      platformSlug: platformFilter ?? 'wedjat',
      finding: `${p0p1.length} high-priority improvement signal(s) remain open.`,
      recommendation: 'Triage the improvement queue: address P0/P1 signals or explicitly acknowledge them; unresolved signals degrade future recommendations.',
      priority: 'P1',
      confidence: 0.75,
      sourceType: 'ANALYSIS',
      sourceRef: 'improvement-queue:open',
      evidence: [{ source: 'ImprovementQueueItem', detail: p0p1.slice(0, 3).map((i) => i.kind).join(', ') }],
    });
  }

  // 3. Schema drift reports with removals/modifications (risk-relevant).
  const drifts = await db.driftReport.findMany({
    where: { orgId, ...(platformFilter ? {} : {}) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  for (const d of drifts.slice(0, 3)) {
    let removed = 0;
    try {
      const changes = JSON.parse(d.changesJson) as { kind: string }[];
      removed = changes.filter((c) => c.kind === 'REMOVED' || c.kind === 'MODIFIED').length;
    } catch { /* keep 0 */ }
    if (removed > 0) {
      drafts.push({
        platformSlug: platformFilter ?? 'wedjat',
        finding: `Schema drift detected: ${removed} structural change(s) in the latest source snapshot.`,
        recommendation: 'Review the drift report and confirm downstream knowledge reflects the current schema (v4 §64: change → ADD knowledge, mark superseded).',
        priority: 'P2',
        confidence: 0.65,
        sourceType: 'ANALYSIS',
        sourceRef: `drift:${d.id}`,
        evidence: [{ source: 'DriftReport', detail: d.summary.slice(0, 200) }],
      });
    }
  }

  // 4. Open knowledge gaps (§85) — recommendations to close them.
  const gaps = await db.knowledgeGap.count({ where: { orgId, status: 'OPEN' } });
  if (gaps > 2) {
    drafts.push({
      platformSlug: platformFilter ?? 'wedjat',
      finding: `${gaps} open knowledge gap(s) detected from retrieval/answer signals.`,
      recommendation: 'Prioritize ingestion of the missing source material for the highest-priority gaps (v4 §86: importance × frequency × risk).',
      priority: 'P2',
      confidence: 0.7,
      sourceType: 'ANALYSIS',
      sourceRef: 'knowledge-gaps:open',
      evidence: [{ source: 'KnowledgeGap', detail: `${gaps} open` }],
    });
  }

  if (drafts.length === 0) {
    return { created: 0 };
  }

  // Dedupe against existing PROPOSED/ACCEPTED recommendations with same finding.
  const existing = await db.recommendation.findMany({
    where: { orgId, status: { in: ['PROPOSED', 'ACCEPTED'] } },
    select: { finding: true },
  });
  const existingFindings = new Set(existing.map((e) => e.finding.slice(0, 80)));

  let created = 0;
  for (const d of drafts) {
    if (existingFindings.has(d.finding.slice(0, 80))) continue; // §24: no duplicate proposals
    await db.recommendation.create({
      data: {
        orgId,
        platformSlug: d.platformSlug,
        finding: d.finding,
        evidenceJson: JSON.stringify(d.evidence),
        recommendation: d.recommendation,
        confidence: d.confidence,
        priority: d.priority,
        expectedBenefit: 'Reusable organizational knowledge; reduced repeat-failure risk.',
        potentialRisk: 'Requires validation before reuse (v4 §67 — prefer measured outcomes).',
        sourceType: d.sourceType,
        sourceRef: d.sourceRef,
        status: 'PROPOSED',
        statusHistoryJson: JSON.stringify([{ status: 'PROPOSED', at: new Date().toISOString(), by: byUserId }]),
        generatedBy: 'wedjat-analysis',
      },
    });
    created += 1;
  }
  await recordAudit({
    orgId, actorType: 'user', actorId: byUserId, action: 'recommendations.generated',
    severity: 'INFO', detailsJson: JSON.stringify({ created, drafts: drafts.length }),
  });
  logger.info('recommendations_generated', { orgId, created });
  return { created };
}
