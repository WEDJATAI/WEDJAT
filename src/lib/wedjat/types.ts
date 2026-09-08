// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Shared API contract types.
//
// These types are the single source of truth for the HTTP API contract.
// The frontend imports them TYPE-ONLY; the backend implements them.
// Every API response is enveloped: { ok: true, data } | { ok: false, error }.
// ═══════════════════════════════════════════════════════════════════════════════

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

// ───────────────────────────── auth ─────────────────────────────

export interface Principal {
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'CURATOR' | 'MEMBER' | 'AUDITOR';
  org: { id: string; slug: string; name: string; dataPolicy: string };
}

export interface LoginUserOption {
  email: string;
  name: string;
  role: Principal['role'];
}

// ───────────────────────── knowledge graph ─────────────────────────

export interface PlatformSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  blueprintCount: number;
  documentCount: number;
  chunkCount: number;
  currentPlatformVersion: string | null;
  updatedAt: string;
}

export interface BlueprintSummary {
  id: string;
  slug: string;
  title: string;
  blueprintType: string;
  platformSlug: string;
  platformName: string;
  currentVersion: string | null;
  currentVersionStatus: string | null;
  versionCount: number;
  documentCount: number;
  knowledgeRecordCount: number;
  updatedAt: string;
}

export interface BlueprintVersionInfo {
  id: string;
  version: string;
  status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'CURRENT' | 'SUPERSEDED';
  summary: string | null;
  checksum: string;
  approvedAt: string | null;
  effectiveFrom: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface BlueprintDetail {
  blueprint: BlueprintSummary;
  versions: BlueprintVersionInfo[];
  documents: {
    id: string;
    title: string;
    slug: string;
    docType: string;
    classification: string;
    status: string;
    version: string;
    ingestedAt: string | null;
    sectionCount: number;
    chunkCount: number;
    blueprintVersion: string;
  }[];
  knowledgeStats: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
}

export interface SourceRef {
  rank: number;
  chunkId: string;
  platformName: string;
  platformSlug: string;
  blueprintTitle: string;
  blueprintSlug: string;
  blueprintVersion: string;
  blueprintVersionStatus: string;
  documentTitle: string;
  sectionHeading: string;
  status: string; // knowledge currentness
  effectiveFrom: string;
  content: string;
  lexicalScore: number;
  semanticScore: number;
  rerankScore: number;
  sourcePriority: number;
}

// ───────────────────────────── chat ─────────────────────────────

export interface ConfidenceSignal {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number; // 0..1 — derived, never fake (§79)
  signals: string[]; // human-readable derivation, e.g. "top rerank score 0.86"
}

export interface ChatResponse {
  traceId: string;
  conversationId: string;
  answer: string; // markdown with [S1]..[Sn] citation markers
  intent: string;
  scope: {
    platformSlug: string | null;
    platformName: string | null;
    blueprintSlug: string | null;
    blueprintTitle: string | null;
    blueprintVersion: string | null;
    resolution: 'EXPLICIT' | 'AUTO' | 'UNRESOLVED';
  };
  sources: SourceRef[];
  confidence: ConfidenceSignal;
  groundedness: number; // 0..1
  insufficientEvidence: boolean;
  blockedPatterns: string[];
  generation: {
    provider: string;
    model: string;
    promptVersion: string;
    retrieverVersion: string;
    latencyMs: number;
    retryCount: number;
    fallbackCount: number;
    fallbackChain: string[];
    status: 'OK' | 'DEGRADED' | 'FAILED' | 'BLOCKED_BY_POLICY' | 'INSUFFICIENT_EVIDENCE';
    inputTokens: number;
    outputTokens: number;
    costEstimateUsd: number;
  };
  generationId: string;
}

export interface ConversationMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
  generation?: {
    id: string;
    provider: string;
    model: string;
    status: string;
    confidence: number | null;
    groundedness: number | null;
    sourceCount: number;
  } | null;
}

// ───────────────────────── analysis workflows ─────────────────────────

export interface CtoSection {
  heading: string;
  content: string;
}

export interface AnalyzeResponse {
  traceId: string;
  type: 'cto-summary' | 'resilience' | 'contradictions' | 'compare' | 'cross-platform';
  title: string;
  scope: ChatResponse['scope'];
  report: {
    executiveSummary: string;
    sections: CtoSection[];
    risks: { title: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; detail: string }[];
    blockers: string[];
    missingEvidence: string[];
    recommendations: string[];
  };
  conflicts?: {
    topic: string;
    sourceA: string;
    sourceB: string;
    why: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    newerSource: string;
    recommendedResolution: string;
  }[];
  changes?: {
    kind: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'DEPRECATED' | 'RISK_INCREASED' | 'RISK_DECREASED' | 'DEPENDENCY_CHANGED' | 'ARCHITECTURE_CHANGED';
    section: string;
    summary: string;
    evidence: string;
  }[];
  sources: SourceRef[];
  confidence: ConfidenceSignal;
  generation: ChatResponse['generation'];
  generationId: string;
}

// ───────────────────────── ingestion / jobs ─────────────────────────

export interface IngestionEventDto {
  id: string;
  stage: string;
  status: string;
  detail: string | null;
  latencyMs: number;
  createdAt: string;
  documentTitle?: string;
}

export interface JobDto {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'RETRYING' | 'FAILED' | 'CANCELLED' | 'COMPLETED';
  progress: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface IngestionSubmitResult {
  jobId: string;
  documentId: string;
  documentVersionId: string;
  duplicate: boolean;
  message: string;
}

// ───────────────────────── search lab ─────────────────────────

export interface SearchResponse {
  traceId: string;
  query: string;
  results: SourceRef[];
  retrievalMeta: {
    mode: string;
    candidatesCount: number;
    latencyMs: number;
    filters: Record<string, string | number | null>;
    rerankerModel: string;
    embedderModel: string;
  };
}

// ───────────────────────── evaluation ─────────────────────────

export interface EvaluationSuiteDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  caseCount: number;
  lastRun: {
    runLabel: string;
    createdAt: string;
    passRate: number;
    avgRecall: number;
    avgPrecision: number;
    avgGroundedness: number | null;
    avgLatencyMs: number;
  } | null;
}

export interface EvaluationResultDto {
  id: string;
  runLabel: string;
  caseQuery: string;
  caseTask: string;
  retrievedCount: number;
  recallAtK: number;
  precisionAtK: number;
  keywordCoverage: number;
  groundedness: number | null;
  latencyMs: number;
  passed: boolean;
  createdAt: string;
}

export interface EvaluationsPayload {
  suites: EvaluationSuiteDto[];
  results: EvaluationResultDto[];
  runLabels: string[];
}

// ───────────────────────── training ─────────────────────────

export interface TrainingDatasetDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  currentVersion: {
    id: string;
    version: string;
    exampleCount: number;
    status: string;
    checksum: string;
    lockedAt: string | null;
  } | null;
  updatedAt: string;
}

export interface TrainingRunDto {
  id: string;
  status: string;
  method: string;
  progress: number;
  currentStep: string;
  datasetVersion: string;
  baseModel: string | null;
  candidateModel: string | null;
  gpuProfile: string;
  notes: string | null;
  evaluationSummary: {
    passRate: number;
    avgRecall: number;
    regression: boolean;
    gate: 'PASSED' | 'FAILED' | 'PENDING';
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  metrics: { step: number; loss: number | null; evalScore: number | null }[];
}

export interface TrainingPayload {
  datasets: TrainingDatasetDto[];
  runs: TrainingRunDto[];
  eligibleSources: { kind: string; count: number }[];
  feedbackStats: { label: string; count: number }[];
}

// ───────────────────────── model registry ─────────────────────────

export interface ModelRegistryDto {
  id: string;
  provider: string;
  model: string;
  modelVersion: string;
  contextLimit: number;
  supports: {
    structuredOutput: boolean;
    toolUse: boolean;
    embedding: boolean;
    reranking: boolean;
    finetuning: boolean;
    localInference: boolean;
  };
  estimatedLatencyMs: number;
  qualityClass: string;
  costClass: string;
  gpuRequirement: string;
  status: string;
  notes: string | null;
  versions: {
    id: string;
    version: string;
    baseModel: string;
    trainingMethod: string;
    status: string;
    datasetVersion: string | null;
    artifactChecksum: string;
    createdAt: string;
    deployment: {
      environment: string;
      stage: string;
      canaryPercent: number;
      rollbackToId: string | null;
      status: string;
      deployedAt: string;
    } | null;
  }[];
}

export interface ModelsPayload {
  registry: ModelRegistryDto[];
}

// ───────────────────────── observability ─────────────────────────

export interface ProviderHealthDto {
  provider: string;
  model: string;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  requests: number;
  successes: number;
  failures: number;
  rateLimited429: number;
  serverErrors5xx: number;
  timeouts: number;
  avgLatencyMs: number;
  successRate: number;
}

export interface AuditEventDto {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  severity: string;
  details: Record<string, unknown> | null;
  traceId: string | null;
  createdAt: string;
}

export interface SystemHealthPayload {
  application: { status: string; uptimeSec: number; version: string };
  database: { status: string; latencyMs: number; migrationStatus: string };
  retrieval: {
    status: string;
    indexedChunks: number;
    embeddingModel: string;
    lexicalPostings: number;
    knowledgeRecords: number;
  };
  providers: ProviderHealthDto[];
  jobs: { queued: number; running: number; failed: number; completed: number };
  gpu: { available: boolean; note: string };
  policies: { dataSharing: string; embeddingPolicy: string; budgetUsdPerDay: number; spentUsdToday: number };
  metrics: {
    aiRequests: number;
    aiSuccesses: number;
    aiFailures: number;
    avgLatencyMs: number;
    fallbackRate: number;
    retryRate: number;
    retrievalEvents: number;
    ingestionJobs: number;
  };
  configVersions: { key: string; version: string; status: string; createdAt: string; value: Record<string, unknown> }[];
  promptVersions: { promptId: string; version: string; task: string; status: string; approvedAt: string | null }[];
  recentAudit: AuditEventDto[];
  recentIngestion: IngestionEventDto[];
}

export interface DashboardStats {
  platforms: number;
  blueprints: number;
  documents: number;
  chunksIndexed: number;
  knowledgeRecords: number;
  conversations: number;
  aiGenerations: number;
  avgLatencyMs: number;
  avgConfidence: number;
  avgGroundedness: number;
  feedbackCount: number;
  unresolvedRecommendations: number;
  detectedConflicts: number;
  lastIngestionAt: string | null;
  lastEvaluationAt: string | null;
  health: { database: string; retrieval: string; providers: string; jobs: string };
}

// ───────────────────────── feedback ─────────────────────────

export interface FeedbackDto {
  id: string;
  generationId: string;
  label: string;
  comment: string | null;
  userName: string;
  createdAt: string;
  questionExcerpt: string;
}

export interface EligibilityStats {
  totalEligible: number;
  byKind: { kind: string; count: number }[];
}
