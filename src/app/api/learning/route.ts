// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — GET /api/learning (§155 Model Learning dashboard).
//
// Knowledge growth series, totals, canonical entity + KG predicate tables,
// evaluation/feedback trends, improvement queue and the last health check.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import type { ImprovementItemDto, LearningPayload, LearningPoint } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const orgId = principal.org.id;

      // ── totals ────────────────────────────────────────────────────────────────
      const [sources, documents, knowledgeRecords, chunks, kgEdges, trainingExamples, trainingCandidates, trainingRuns] =
        await Promise.all([
          db.sourceDatabase.count({ where: { orgId } }),
          db.document.count({}),
          db.knowledgeRecord.count({}),
          db.documentChunk.count({ where: { status: 'INDEXED' } }),
          db.knowledgeGraphEdge.count({ where: { orgId } }),
          db.trainingExample.count({}),
          db.trainingCandidate.count({ where: { orgId } }),
          db.trainingRun.count({}),
        ]);

      // ── knowledge growth (14-day series) ─────────────────────────────────────
      const krRows = await db.knowledgeRecord.findMany({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const byDay = new Map<string, number>();
      for (const kr of krRows) {
        const key = kr.createdAt.toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      }
      const days: string[] = [];
      for (let i = 13; i >= 0; i--) {
        days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
      }
      let cumulative = 0;
      const totalToDate = new Map<string, number>();
      for (const kr of krRows) {
        const key = kr.createdAt.toISOString().slice(0, 10);
        totalToDate.set(key, (totalToDate.get(key) ?? 0) + 1);
      }
      const knowledgeGrowth: LearningPoint[] = [];
      let running = 0;
      // cumulative up to each day
      const counts = [...byDay.entries()];
      for (const day of days) {
        const dayCount = byDay.get(day) ?? 0;
        running += dayCount;
        void counts;
        void cumulative;
        void totalToDate;
        knowledgeGrowth.push({ date: day, count: dayCount, total: running });
      }

      // ── canonical entities (tables per entity across sources) ────────────────
      const mappings = await db.canonicalMapping.findMany({
        where: { orgId, canonicalEntity: { not: null } },
        select: { canonicalEntity: true },
      });
      const entityMap = new Map<string, number>();
      for (const m of mappings) {
        const key = m.canonicalEntity as string;
        entityMap.set(key, (entityMap.get(key) ?? 0) + 1);
      }

      // ── KG predicates by classification ──────────────────────────────────────
      const edges = await db.knowledgeGraphEdge.findMany({
        where: { orgId },
        select: { predicate: true, classification: true },
      });
      const predMap = new Map<string, { predicate: string; count: number; classification: string }>();
      for (const e of edges) {
        const key = `${e.predicate}:${e.classification}`;
        const entry = predMap.get(key) ?? { predicate: e.predicate, count: 0, classification: e.classification };
        entry.count += 1;
        predMap.set(key, entry);
      }

      // ── evaluation trends (latest 2 run labels) ──────────────────────────────
      const recentResults = await db.evaluationResult.findMany({
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { runLabel: true, passed: true, groundedness: true, latencyMs: true },
      });
      const labelAgg = new Map<string, { total: number; passed: number; grounded: number[]; latency: number[] }>();
      for (const r of recentResults) {
        if (!labelAgg.has(r.runLabel)) labelAgg.set(r.runLabel, { total: 0, passed: 0, grounded: [], latency: [] });
        const agg = labelAgg.get(r.runLabel)!;
        agg.total += 1;
        if (r.passed) agg.passed += 1;
        if (r.groundedness != null) agg.grounded.push(r.groundedness);
        agg.latency.push(r.latencyMs);
      }
      const evalTrends = [...labelAgg.entries()]
        .slice(0, 5)
        .map(([runLabel, a]) => ({
          runLabel,
          passRate: Math.round((a.passed / Math.max(1, a.total)) * 1000) / 10,
          groundedness:
            a.grounded.length > 0
              ? Math.round((a.grounded.reduce((n, g) => n + g, 0) / a.grounded.length) * 1000) / 10
              : null,
          latencyMs: Math.round(a.latency.reduce((n, l) => n + l, 0) / Math.max(1, a.latency.length)),
        }));

      // ── feedback trends ──────────────────────────────────────────────────────
      const feedbackRows = await db.feedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { label: true },
      });
      const labelCounts = new Map<string, number>();
      for (const f of feedbackRows) labelCounts.set(f.label, (labelCounts.get(f.label) ?? 0) + 1);

      // ── improvement queue + last health check ────────────────────────────────
      const openItems = await db.improvementQueueItem.findMany({
        where: { orgId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: 30,
      });
      const improvementQueue: ImprovementItemDto[] = openItems.map((i) => ({
        id: i.id,
        kind: i.kind,
        description: i.description,
        priority: i.priority,
        status: i.status as ImprovementItemDto['status'],
        proposedAction: i.proposedAction,
        createdAt: i.createdAt.toISOString(),
      }));
      const lastHealth = await db.healthCheckReport.findFirst({
        where: { orgId },
        orderBy: { ranAt: 'desc' },
      });
      const lastHealthCheck = lastHealth
        ? {
            ranAt: lastHealth.ranAt.toISOString(),
            issuesFound: lastHealth.issuesFound,
            checks: JSON.parse(lastHealth.checksJson || '[]') as { check: string; status: string; detail: string }[],
          }
        : null;

      const payload: LearningPayload = {
        knowledgeGrowth,
        totals: {
          sources,
          documents,
          knowledgeRecords,
          chunks,
          kgEdges,
          trainingExamples,
          trainingCandidates,
          trainingRuns,
          canonicalEntities: entityMap.size,
        },
        canonicalEntities: [...entityMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([entity, tables]) => ({ entity, tables })),
        kgPredicates: [...predMap.values()].sort((a, b) => b.count - a.count),
        evalTrends,
        feedbackTrends: [...labelCounts.entries()].map(([label, count]) => ({ label, count })),
        improvementQueue,
        lastHealthCheck,
      };
      return ok(payload);
    } catch (err) {
      return failFrom(err);
    }
  });
}
