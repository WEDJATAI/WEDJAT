// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Permanent evaluation benchmark (§42, §43, §73).
//
// WHY: every change to model/prompt/retriever/embedding/reranker/chunking/dataset
// must be measured against the SAME benchmark before promotion. Metrics:
// retrieval recall@k, precision@k, keyword coverage, groundedness (LLM-judged
// cases), latency, pass rate. Results are historical (evaluation memory §73).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { logger } from '../logger';
import { hybridRetrieve } from '../retrieval/hybrid';
import { rerank } from '../retrieval/reranker';
import { expandQuery } from '../reasoning/answer';
import { tokenize } from '../knowledge/embeddings';
import { recordAudit } from '../observability/audit';
import { runChatPipeline } from '../reasoning/answer';
import type { Principal } from '../types';
import { WedjatError } from '../errors';

export interface SuiteSummary {
  runLabel: string;
  suiteId: string;
  caseCount: number;
  passRate: number;
  avgRecall: number;
  avgPrecision: number;
  avgGroundedness: number | null;
  avgLatencyMs: number;
}

/**
 * Runs a suite. Retrieval-only cases exercise the full retrieval+rerank stack
 * (fast, deterministic). llmJudged cases run the FULL chat pipeline so
 * groundedness/citation behavior is measured end-to-end.
 */
export async function runEvaluationSuite(
  principal: Principal,
  suiteId: string,
  label?: string,
  opts: { onlyRetrieval?: boolean } = {}
): Promise<SuiteSummary> {
  const suite = await db.evaluationSuite.findFirst({
    where: { id: suiteId, orgId: principal.org.id },
    include: { cases: true },
  });
  if (!suite) throw new WedjatError('NOT_FOUND', 'Evaluation suite not found');
  if (suite.cases.length === 0) throw new WedjatError('VALIDATION', 'Suite has no cases');

  const runLabel = label ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let passCount = 0;
  let recallSum = 0;
  let precisionSum = 0;
  let groundedSum = 0;
  let groundedCount = 0;
  let latencySum = 0;

  for (const testCase of suite.cases) {
    if (opts.onlyRetrieval && testCase.llmJudged) continue; // baseline: skip LLM cases
    const started = Date.now();
    const expectedKeywords = safeParse(testCase.expectedKeywordsJson, [] as string[]);

    if (testCase.llmJudged) {
      // FULL pipeline case — measures groundedness end-to-end.
      const chat = await runChatPipeline({
        principal,
        message: testCase.query,
        explicitScope: {
          platform: testCase.expectedPlatformSlug ?? undefined,
          blueprint: testCase.expectedBlueprintSlug ?? undefined,
        },
      });
      const latencyMs = Date.now() - started;
      const recallAtK = testCase.expectedSourcesMin > 0
        ? Math.min(1, chat.sources.length / testCase.expectedSourcesMin)
        : 1;
      const kw = keywordCoverage(chat.answer, expectedKeywords);
      const passed =
        !chat.insufficientEvidence &&
        chat.groundedness >= 0.3 &&
        chat.sources.length >= testCase.expectedSourcesMin &&
        kw >= 0.3;
      await db.evaluationResult.create({
        data: {
          suiteId: suite.id, caseId: testCase.id, runLabel,
          retrievedCount: chat.sources.length,
          recallAtK: round(recallAtK), precisionAtK: round(chat.groundedness),
          keywordCoverage: round(kw), groundedness: round(chat.groundedness),
          latencyMs, passed,
          detailsJson: JSON.stringify({ intent: chat.intent, confidence: chat.confidence.level, provider: chat.generation.provider }),
        },
      });
      recallSum += recallAtK;
      precisionSum += chat.groundedness;
      groundedSum += chat.groundedness;
      groundedCount += 1;
      latencySum += latencyMs;
      if (passed) passCount += 1;
    } else {
      // Retrieval-only case — deterministic.
      const expanded = expandQuery(testCase.query);
      const retrieval = await hybridRetrieve(expanded, {
        orgId: principal.org.id,
        platformSlug: testCase.expectedPlatformSlug ?? undefined,
        blueprintSlug: testCase.expectedBlueprintSlug ?? undefined,
        versionStatus: 'CURRENT',
      });
      const ranked = rerank(expanded, retrieval.candidates, 8);
      const latencyMs = Date.now() - started;

      // Recall@k: expected source (platform/blueprint) present in top-k.
      const relevant = ranked.filter(
        (r) =>
          (!testCase.expectedPlatformSlug || r.platformSlug === testCase.expectedPlatformSlug) &&
          (!testCase.expectedBlueprintSlug || r.blueprintSlug === testCase.expectedBlueprintSlug)
      );
      const recallAtK = testCase.expectedSourcesMin > 0 ? Math.min(1, relevant.length / testCase.expectedSourcesMin) : (ranked.length > 0 ? 1 : 0);
      // Precision@k: fraction of retrieved that are in-scope.
      const precisionAtK = ranked.length > 0 ? relevant.length / ranked.length : 0;
      const kw = keywordCoverage(ranked.map((r) => r.content).join(' '), expectedKeywords);
      const passed = recallAtK >= 0.5 && precisionAtK >= 0.4 && kw >= 0.4 && latencyMs < 5000;

      await db.evaluationResult.create({
        data: {
          suiteId: suite.id, caseId: testCase.id, runLabel,
          retrievedCount: ranked.length,
          recallAtK: round(recallAtK), precisionAtK: round(precisionAtK),
          keywordCoverage: round(kw), latencyMs, passed,
          detailsJson: JSON.stringify({ topScore: ranked[0]?.rerankScore ?? 0, candidates: retrieval.candidatesCount }),
        },
      });
      recallSum += recallAtK;
      precisionSum += precisionAtK;
      latencySum += latencyMs;
      if (passed) passCount += 1;
    }
  }

  const evaluated = suite.cases.filter((c) => !(opts.onlyRetrieval && c.llmJudged)).length;
  if (evaluated === 0) {
    throw new WedjatError('VALIDATION', 'No cases were evaluated (suite is empty or filtered out)');
  }
  const summary: SuiteSummary = {
    runLabel,
    suiteId: suite.id,
    caseCount: evaluated,
    passRate: round(passCount / evaluated),
    avgRecall: round(recallSum / evaluated),
    avgPrecision: round(precisionSum / evaluated),
    avgGroundedness: groundedCount > 0 ? round(groundedSum / groundedCount) : null,
    avgLatencyMs: Math.round(latencySum / evaluated),
  };

  await recordAudit({
    orgId: principal.org.id,
    actorType: 'user',
    actorId: principal.userId,
    action: 'evaluation.run',
    targetType: 'evaluationSuite',
    targetId: suite.id,
    details: { runLabel, passRate: summary.passRate, avgRecall: summary.avgRecall },
  });
  logger.info('evaluation_run_complete', { suite: suite.slug, ...summary });
  return summary;
}

function keywordCoverage(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const tokens = new Set(tokenize(text));
  let hit = 0;
  for (const kw of keywords) {
    for (const t of tokenize(kw)) {
      if (tokens.has(t)) {
        hit += 1;
        break;
      }
    }
  }
  return hit / keywords.length;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Latest run summary per suite (evaluation memory §73). */
export async function latestRunSummaries(orgId: string): Promise<Map<string, SuiteSummary>> {
  const suites = await db.evaluationSuite.findMany({ where: { orgId }, include: { cases: true } });
  const out = new Map<string, SuiteSummary>();
  for (const suite of suites) {
    const results = await db.evaluationResult.findMany({
      where: { suiteId: suite.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (results.length === 0) continue;
    const latestLabel = results[0].runLabel;
    const latest = results.filter((r) => r.runLabel === latestLabel);
    const grounded = latest.filter((r) => r.groundedness != null);
    out.set(suite.id, {
      runLabel: latestLabel,
      suiteId: suite.id,
      caseCount: suite.cases.length,
      passRate: round(latest.filter((r) => r.passed).length / latest.length),
      avgRecall: round(latest.reduce((s, r) => s + r.recallAtK, 0) / latest.length),
      avgPrecision: round(latest.reduce((s, r) => s + r.precisionAtK, 0) / latest.length),
      avgGroundedness: grounded.length > 0 ? round(grounded.reduce((s, r) => s + (r.groundedness ?? 0), 0) / grounded.length) : null,
      avgLatencyMs: Math.round(latest.reduce((s, r) => s + r.latencyMs, 0) / latest.length),
    });
  }
  return out;
}
