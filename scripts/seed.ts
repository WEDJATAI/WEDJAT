// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Seed: initial proprietary corpus + governance entities.
//
// Implements §101 INITIAL DATA INGESTION:
//   1. discover every blueprint file in scripts/corpus/
//   2. run the REAL ingestion pipeline (no bypass — same code the API uses)
//   3. seed model registry / prompt versions / config versions
//   4. seed the permanent evaluation benchmark (core-benchmark)
//   5. establish BASELINE evaluation metrics (retrieval-only — no LLM at seed)
// No fine-tuning at seed (§101: "Do not fine-tune immediately").
// ═══════════════════════════════════════════════════════════════════════════════

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/wedjat/security/auth';
import { runIngestion } from '@/lib/wedjat/knowledge/ingestion';
import { buildRegistry } from '@/lib/wedjat/gateway/registry';
import { PROMPTS } from '@/lib/wedjat/reasoning/prompts';
import { runEvaluationSuite } from '@/lib/wedjat/evaluation/runner';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { logger } from '@/lib/wedjat/logger';
import { config } from '@/lib/wedjat/config';
import { sha256 } from '@/lib/wedjat/ids';

const CORPUS_DIR = join(process.cwd(), 'scripts', 'corpus');

// ── Corpus manifest: platform boundaries + document identity (§4: maintain
//    explicit platform and blueprint identity — never one flat knowledge base).
const CORPUS_MANIFEST: Record<string, {
  platformSlug: string;
  platformName: string;
  criticality: string;
  platformVersion: string;
  blueprintSlug: string;
  blueprintTitle: string;
  blueprintType: string;
  blueprintVersion: string;
  docType: string;
  classification?: string;
  documentVersion: string;
}> = {
  'core-platform-blueprint-v1.md': {
    platformSlug: 'core-platform', platformName: 'WEDJAT Core Platform', criticality: 'CRITICAL', platformVersion: '2.0',
    blueprintSlug: 'core-platform-architecture', blueprintTitle: 'Core Platform Architecture', blueprintType: 'ARCHITECTURE',
    blueprintVersion: '1.0', docType: 'BLUEPRINT', documentVersion: '1',
  },
  'core-platform-blueprint-v2.md': {
    platformSlug: 'core-platform', platformName: 'WEDJAT Core Platform', criticality: 'CRITICAL', platformVersion: '2.0',
    blueprintSlug: 'core-platform-architecture', blueprintTitle: 'Core Platform Architecture', blueprintType: 'ARCHITECTURE',
    blueprintVersion: '2.0', docType: 'BLUEPRINT', documentVersion: '1',
  },
  'core-adr-004-failover.md': {
    platformSlug: 'core-platform', platformName: 'WEDJAT Core Platform', criticality: 'CRITICAL', platformVersion: '2.0',
    blueprintSlug: 'adr-004-failover', blueprintTitle: 'ADR-004 Regional Failover Strategy', blueprintType: 'DECISION',
    blueprintVersion: '1.0', docType: 'ADR', documentVersion: '1',
  },
  'core-security-audit-2025.md': {
    platformSlug: 'core-platform', platformName: 'WEDJAT Core Platform', criticality: 'CRITICAL', platformVersion: '2.0',
    blueprintSlug: 'security-audit-2025', blueprintTitle: 'Security Audit 2025', blueprintType: 'AUDIT',
    blueprintVersion: '1.0', docType: 'AUDIT', documentVersion: '1',
  },
  'analytics-blueprint-v1.md': {
    platformSlug: 'analytics-platform', platformName: 'WEDJAT Analytics Platform', criticality: 'HIGH', platformVersion: '1.2',
    blueprintSlug: 'analytics-architecture', blueprintTitle: 'Analytics Platform Architecture', blueprintType: 'ARCHITECTURE',
    blueprintVersion: '1.2', docType: 'BLUEPRINT', documentVersion: '1',
  },
  'mobile-gateway-blueprint-v1.md': {
    platformSlug: 'mobile-gateway', platformName: 'WEDJAT Mobile Gateway', criticality: 'MEDIUM', platformVersion: '1.0',
    blueprintSlug: 'mobile-gateway-architecture', blueprintTitle: 'Mobile Gateway Architecture', blueprintType: 'ARCHITECTURE',
    blueprintVersion: '1.0', docType: 'BLUEPRINT', documentVersion: '1',
  },
  'shared-services-catalog.md': {
    platformSlug: 'shared-services', platformName: 'WEDJAT Shared Services', criticality: 'MEDIUM', platformVersion: '1.0',
    blueprintSlug: 'shared-services-catalog', blueprintTitle: 'Shared Services Catalog', blueprintType: 'REFERENCE',
    blueprintVersion: '1.0', docType: 'REFERENCE', documentVersion: '1',
  },
};

const USERS = [
  { email: 'owner@wedjat.ai', name: 'Amara Djedi', role: 'OWNER' },
  { email: 'curator@wedjat.ai', name: 'Yusuf Kahlout', role: 'CURATOR' },
  { email: 'member@wedjat.ai', name: 'Layla Hassan', role: 'MEMBER' },
  { email: 'auditor@wedjat.ai', name: 'Omar Farouk', role: 'AUDITOR' },
];

async function wipe(): Promise<void> {
  // FK-safe deletion order (children first).
  const tables = [
    'humanReview', 'feedback', 'failureMemory', 'evaluationResult', 'evaluationCase', 'evaluationSuite',
    'trainingMetric', 'trainingRun', 'trainingExample', 'trainingDatasetVersion', 'trainingDataset', 'trainingSource',
    'modelDeployment', 'modelVersion', 'modelRegistry', 'providerHealth',
    'generationSource', 'aiGeneration', 'message', 'conversation',
    'retrievalEvent', 'lexicalTerm', 'embeddingRecord', 'knowledgeRecord', 'documentChunk', 'documentSection',
    'ingestionEvent', 'documentVersion', 'document', 'blueprintVersion', 'blueprint',
    'platformVersion', 'platform', 'job', 'auditEvent', 'promptVersion', 'configVersion',
    'session', 'membership', 'user', 'organization',
  ] as const;
  const model = (db as any);
  for (const t of tables) {
    try {
      await model[t].deleteMany({});
    } catch (err) {
      logger.warn('wipe_failed', { table: t, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function main(): Promise<void> {
  logger.info('seed_start', {});
  await wipe();

  // ── Organization + users ─────────────────────────────────────────────────────
  const org = await db.organization.create({
    data: { slug: 'wedjat', name: 'WEDJAT Organization', dataPolicy: 'APPROVED_REMOTE_PROVIDER' },
  });
  const owner = await db.user.create({
    data: {
      orgId: org.id, email: USERS[0].email, name: USERS[0].name, role: USERS[0].role,
      passwordHash: hashPassword('wedjat'),
    },
  });
  for (const u of USERS.slice(1)) {
    const user = await db.user.create({
      data: { orgId: org.id, email: u.email, name: u.name, role: u.role, passwordHash: hashPassword('wedjat') },
    });
    await db.membership.create({ data: { userId: user.id, orgId: org.id, scope: '*' } });
  }
  await db.membership.create({ data: { userId: owner.id, orgId: org.id, scope: '*' } });

  // ── Platforms + versions ─────────────────────────────────────────────────────
  const platforms = new Map<string, string>();
  for (const m of Object.values(CORPUS_MANIFEST)) {
    if (platforms.has(m.platformSlug)) continue;
    const platform = await db.platform.create({
      data: {
        orgId: org.id,
        slug: m.platformSlug,
        name: m.platformName,
        criticality: m.criticality,
        description: `${m.platformName} — part of the WEDJAT proprietary platform portfolio.`,
      },
    });
    await db.platformVersion.create({
      data: {
        platformId: platform.id,
        version: m.platformVersion,
        notes: 'initial portfolio version',
        checksum: sha256(`${m.platformSlug}:${m.platformVersion}`),
        status: 'CURRENT',
      },
    });
    platforms.set(m.platformSlug, platform.id);
  }

  // ── Model registry (from the capability registry §19) ───────────────────────
  const registryRows = buildRegistry();
  const registryIds = new Map<string, string>();
  for (const entry of registryRows) {
    const row = await db.modelRegistry.create({
      data: {
        provider: entry.provider,
        model: entry.model,
        modelVersion: entry.modelVersion,
        contextLimit: entry.contextLimit,
        supportsStructuredOutput: entry.supportsStructuredOutput,
        supportsToolUse: entry.supportsToolUse,
        supportsEmbedding: entry.supportsEmbedding,
        supportsReranking: entry.supportsReranking,
        supportsFinetuning: entry.supportsFinetuning,
        supportsLocalInference: entry.supportsLocalInference,
        estimatedLatencyMs: entry.estimatedLatencyMs,
        qualityClass: entry.qualityClass,
        costClass: entry.costClass,
        gpuRequirement: entry.gpuRequirement,
        status: entry.status,
        notes: entry.notes,
      },
    });
    registryIds.set(`${entry.provider}/${entry.model}`, row.id);
  }
  // Production model version for the internal gateway + local components.
  const internalRegId = registryIds.get('wedjat/wedjat-internal-chat')!;
  const internalVersion = await db.modelVersion.create({
    data: {
      registryId: internalRegId,
      version: 'wedjat-1.0',
      baseModel: 'wedjat-internal-chat',
      trainingMethod: 'NONE',
      codeVersion: 'git:wedjat-1.0.0',
      evaluationVersion: 'core-benchmark@baseline',
      artifactChecksum: sha256('wedjat-internal-chat:v1:production'),
      status: 'PRODUCTION',
    },
  });
  await db.modelDeployment.create({
    data: {
      modelVersionId: internalVersion.id,
      environment: 'PRODUCTION',
      stage: 'PRODUCTION',
      canaryPercent: 100,
      status: 'ACTIVE',
      note: 'initial production deployment of the sanctioned internal gateway',
    },
  });
  for (const [key, id] of registryIds) {
    if (key === 'wedjat/wedjat-internal-chat') continue;
    await db.modelVersion.create({
      data: {
        registryId: id,
        version: 'v1',
        baseModel: key.split('/')[1],
        trainingMethod: 'NONE',
        codeVersion: 'git:wedjat-1.0.0',
        artifactChecksum: sha256(`${key}:v1`),
        status: key.startsWith('huggingface/wedjat-local') ? 'PRODUCTION' : 'EXPERIMENTAL',
      },
    });
  }

  // ── Prompt versions (§74 — approved at seed) ────────────────────────────────
  for (const spec of Object.values(PROMPTS)) {
    await db.promptVersion.create({
      data: {
        orgId: org.id,
        promptId: spec.promptId,
        version: spec.version,
        task: spec.task,
        template: spec.template,
        status: 'APPROVED',
        author: 'system',
        approvedAt: new Date(),
        notes: spec.notes,
      },
    });
  }

  // ── Config versions (§75 — generation reconstructability) ───────────────────
  const configVersions: { key: string; value: unknown }[] = [
    { key: 'model-routing', value: { failoverMaxHops: config.failover.maxHops, retryMax: config.retry.maxRetries, circuitThreshold: config.circuit.failureThreshold } },
    { key: 'retrieval', value: { candidateK: config.retrieval.candidateK, topK: config.retrieval.topK, minRerankScore: config.retrieval.minRerankScore, lexicalWeight: config.retrieval.lexicalWeight, semanticWeight: config.retrieval.semanticWeight } },
    { key: 'chunking', value: { targetTokens: config.chunking.targetTokens, overlapSentences: config.chunking.overlapSentences, qualityThreshold: config.chunking.qualityThreshold } },
    { key: 'embedding', value: { model: config.retrieval.embedderModel, dimension: config.retrieval.embedderDimension, policy: 'LOCAL_ONLY' } },
    { key: 'reranking', value: { model: config.retrieval.rerankerModel, weights: config.retrieval.rerankWeights } },
    { key: 'security-policy', value: { embeddingPolicy: config.policy.embedding, generationPolicy: config.policy.generation, remoteAllowedClassifications: config.policy.remoteAllowedClassifications } },
    { key: 'training', value: { minExampleQuality: config.training.minExampleQuality, regressionTolerance: config.training.regressionTolerance } },
    { key: 'evaluation', value: { suite: 'core-benchmark', baselineLabel: 'baseline-seed' } },
    { key: 'rate-limits', value: config.rateLimits },
    { key: 'budget', value: { usdPerDay: config.budget.usdPerDay, costPer1kTokens: config.budget.costPer1kTokens } },
  ];
  for (const cv of configVersions) {
    await db.configVersion.create({
      data: { orgId: org.id, key: cv.key, version: '1', valueJson: JSON.stringify(cv.value), status: 'ACTIVE' },
    });
  }

  // ── §101: discover + ingest every corpus file through the REAL pipeline ─────
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith('.md')).sort();
  logger.info('corpus_discovered', { files });
  const ingested: { file: string; chunks: number; duplicate: boolean }[] = [];
  for (const file of files) {
    const manifest = CORPUS_MANIFEST[file];
    if (!manifest) {
      logger.warn('corpus_file_without_manifest_skipped', { file });
      continue;
    }
    const content = await readFile(join(CORPUS_DIR, file), 'utf8');
    const result = await runIngestion({
      orgId: org.id,
      platformSlug: manifest.platformSlug,
      blueprintSlug: manifest.blueprintSlug,
      blueprintTitle: manifest.blueprintTitle,
      blueprintType: manifest.blueprintType,
      blueprintVersion: manifest.blueprintVersion,
      title: file.replace(/\.md$/, '').replace(/-/g, ' '),
      docType: manifest.docType,
      classification: manifest.classification ?? 'INTERNAL',
      content,
      documentVersion: manifest.documentVersion,
      sourcePath: `scripts/corpus/${file}`,
      actorId: owner.id,
      idempotencyKey: `seed-${file}`,
    });
    const chunkCount = await db.documentChunk.count({ where: { documentVersionId: result.documentVersionId, status: 'INDEXED' } });
    ingested.push({ file, chunks: chunkCount, duplicate: result.duplicate });
    logger.info('seed_ingested', { file, chunks: chunkCount, duplicate: result.duplicate });
  }

  // ── Permanent evaluation benchmark (§42) ────────────────────────────────────
  const suite = await db.evaluationSuite.create({
    data: {
      orgId: org.id,
      slug: 'core-benchmark',
      name: 'Core Benchmark — Retrieval & Grounding',
      description: 'Permanent regression benchmark: blueprint comprehension, source grounding, retrieval recall/precision, change detection, security analysis.',
      version: '1',
    },
  });

  const CASES: {
    task: string; query: string; keywords: string[]; platform?: string; blueprint?: string; sourcesMin?: number; llmJudged?: boolean;
  }[] = [
    { task: 'RETRIEVAL', query: 'Which database does the Core Platform use for its transactional schema?', keywords: ['postgresql', 'database'], platform: 'core-platform', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'What message broker does the Core Platform use in version 2.0?', keywords: ['kafka'], platform: 'core-platform', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'What replaced Redis in the Core Platform v2.0?', keywords: ['redis', 'cache', 'removed'], platform: 'core-platform', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'What store backs the Analytics speed layer?', keywords: ['clickhouse'], platform: 'analytics-platform', sourcesMin: 1 },
    { task: 'RETRIEVAL', query: 'Which edge runtime runs the Mobile Gateway?', keywords: ['cloudflare', 'workers'], platform: 'mobile-gateway', sourcesMin: 1 },
    { task: 'RETRIEVAL', query: 'What are the unresolved recommendations from the security audit?', keywords: ['restore', 'drill', 'unresolved'], platform: 'core-platform', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'Why was warm-standby chosen over active-active failover?', keywords: ['warm-standby', 'failover'], platform: 'core-platform', sourcesMin: 1 },
    { task: 'RETRIEVAL', query: 'How does the Mobile Gateway validate sessions against the Core Platform v2.0 contract?', keywords: ['session', 'validation'], platform: 'mobile-gateway', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'Which services are shared across platforms according to the catalog?', keywords: ['identity', 'kafka', 'notification'], platform: 'shared-services', sourcesMin: 2 },
    { task: 'RETRIEVAL', query: 'How is churn prediction computed in the Analytics Platform?', keywords: ['churn', 'features'], platform: 'analytics-platform', sourcesMin: 1 },
    { task: 'RETRIEVAL', query: 'Which single points of failure exist across our platforms?', keywords: ['single point', 'failure', 'redis', 'kafka'], sourcesMin: 3 },
    { task: 'RETRIEVAL', query: 'What is the backup restore strategy and has it been tested?', keywords: ['pitr', 'restore', 'drill'], platform: 'core-platform', sourcesMin: 2 },
    { task: 'GROUNDED_CHAT', query: 'How do I improve the resiliency of the Core Platform?', keywords: ['resilience', 'risk'], platform: 'core-platform', sourcesMin: 3, llmJudged: true },
    { task: 'GROUNDED_CHAT', query: 'What are the current production blockers?', keywords: ['blocker', 'drill'], sourcesMin: 2, llmJudged: true },
  ];

  for (const c of CASES) {
    await db.evaluationCase.create({
      data: {
        suiteId: suite.id,
        task: c.task,
        query: c.query,
        expectedKeywordsJson: JSON.stringify(c.keywords),
        expectedPlatformSlug: c.platform,
        expectedBlueprintSlug: c.blueprint,
        expectedSourcesMin: c.sourcesMin ?? 1,
        llmJudged: c.llmJudged ?? false,
        notes: c.llmJudged ? 'Runs the full grounded chat pipeline; measures groundedness + citations.' : null,
      },
    });
  }

  // ── Baseline evaluation (retrieval-only — no LLM at seed, §101 baseline) ────
  const principal = {
    userId: owner.id, name: owner.name, email: owner.email, role: 'OWNER' as const,
    org: { id: org.id, slug: org.slug, name: org.name, dataPolicy: org.dataPolicy },
  };
  const baseline = await runEvaluationSuite(principal, suite.id, 'baseline-seed', { onlyRetrieval: true });
  logger.info('baseline_evaluation', { ...baseline });

  await recordAudit({
    orgId: org.id,
    actorType: 'system',
    action: 'seed.complete',
    targetType: 'organization',
    targetId: org.id,
    severity: 'INFO',
    details: {
      files: files.length,
      ingested: ingested.map((i) => `${i.file}(${i.chunks})`),
      baselinePassRate: baseline.passRate,
      baselineRecall: baseline.avgRecall,
    },
  });

  logger.info('seed_complete', {
    platforms: platforms.size,
    documents: ingested.length,
    chunks: ingested.reduce((s, i) => s + i.chunks, 0),
    baseline: { passRate: baseline.passRate, avgRecall: baseline.avgRecall, avgPrecision: baseline.avgPrecision },
  });
}

main()
  .catch((err) => {
    logger.error('seed_failed', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
