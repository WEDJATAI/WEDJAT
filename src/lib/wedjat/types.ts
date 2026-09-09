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

/**
 * Login response — the session token is mirrored here so the client can send
 * it as a Bearer header in contexts where cookies are blocked (embedded
 * preview iframes with third-party cookie restrictions).
 */
export interface LoginResponse {
  principal: Principal;
  token: string;
  expiresAt: string;
}

// ───────────────────── settings & administration ─────────────────────

/** Admin user listing row (Settings → Users). */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: Principal['role'];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  lastActiveAt: string | null;
}

/** Masked AI provider key status (Settings → AI Providers). */
export interface ProviderKeyInfo {
  configured: boolean;
  managed: boolean;
  hint: string | null;
}

export interface ProviderSettings {
  groq: ProviderKeyInfo;
  gemini: ProviderKeyInfo;
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

// ═════════════════════ DATABASE INTAKE (§106–§160) ═══════════════════════════

// Staging pipeline (§114): RAW → STAGED → ANALYZED → MAPPED → VALIDATED → IMPORTED
export type IntakeStageName =
  | "RAW"
  | "STAGED"
  | "ANALYZED"
  | "MAPPED"
  | "VALIDATED"
  | "IMPORTED"
  | "FAILED"
  | "CANCELLED";

export interface IntakeStageEvent {
  stage: string;
  status: "OK" | "WARN" | "FAILED" | "RUNNING";
  detail: string;
  latencyMs: number;
  at: string;
}

export interface IntakeRunDto {
  id: string;
  sourceDatabaseId: string;
  jobId: string | null;
  status: IntakeStageName;
  stage: string;
  trigger: "UPLOAD" | "REPROCESS";
  autonomyLevel: number;
  engineVersion: string;
  snapshotId: string | null;
  stageEvents: IntakeStageEvent[];
  errors: string[];
  warnings: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface IntakeImportCheck {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
  metric?: string;
}

export interface IntakeImportReport {
  checks: IntakeImportCheck[];
  passed: number;
  warned: number;
  failed: number;
  blocked: boolean;
  importable: boolean;
}

export interface IntakeDqFinding {
  kind: string;
  table?: string;
  column?: string;
  detail: string;
  severity: "INFO" | "WARN" | "FAIL";
  count?: number;
}

export interface IntakeDqReport {
  score: number; // 0..100
  findings: IntakeDqFinding[];
  checkedTables: number;
  checkedRows: number;
}

export interface IntakeColumnDto {
  name: string;
  rawType: string;
  normalizedType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  purpose: string; // column purpose (§109)
  defaultValue?: string | null;
  enumValues?: string[];
  nullPct?: number;
  distinct?: number;
}

export interface IntakeTableDto {
  name: string;
  purpose: string; // table purpose (§109)
  entityType: string;
  canonicalEntity: string | null;
  rowCount: number;
  primaryKey: string[];
  foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  columns: IntakeColumnDto[];
}

export interface IntakeSnapshotDto {
  id: string;
  version: number;
  engine: string;
  detection: { method: string; confidence: number; detail: string };
  tablesCount: number;
  columnsCount: number;
  fksCount: number;
  indexesCount: number;
  viewsCount: number;
  createdAt: string;
  tables: IntakeTableDto[];
  tablesTruncated?: boolean;
}

export interface IntakeMappingEvidence {
  kind:
    | "NAME"
    | "COLUMNS"
    | "RELATIONSHIPS"
    | "DATA"
    | "CONSTRAINTS"
    | "INDEXES"
    | "AI_SEMANTIC";
  detail: string;
  weight: number;
}

export interface IntakeColumnMapping {
  sourceColumn: string;
  canonicalField: string;
  rule: string; // IDENTITY | TYPE_CAST | NORMALIZE | ...
  ruleVersion: string;
  confidence: number;
  notes?: string;
}

export interface IntakeMappingDto {
  id: string;
  intakeRunId: string;
  sourceTable: string;
  tablePurpose: string;
  entityType: string;
  canonicalEntity: string | null;
  confidence: number; // 0..100
  confidenceLabel:
    | "HIGH_CONFIDENCE"
    | "MEDIUM_CONFIDENCE"
    | "LOW_CONFIDENCE"
    | "UNRESOLVED";
  reason: string;
  evidence: IntakeMappingEvidence[];
  columnMappings: IntakeColumnMapping[];
  decision:
    | "AUTO_APPLIED"
    | "PENDING_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "PRESERVED_SOURCE";
  rowCount: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface IntakePreservedFieldDto {
  tableName: string;
  columnName: string;
  columnType: string;
  reason: string;
}

export interface IntakeKgEdgeDto {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  classification:
    | "EXPLICIT_SOURCE_FACT"
    | "HIGH_CONFIDENCE_INFERENCE"
    | "MEDIUM_CONFIDENCE_INFERENCE"
    | "LOW_CONFIDENCE_INFERENCE";
  evidence: string;
  provenance: string;
}

export interface IntakeCandidateGate {
  name: string;
  passed: boolean;
  detail: string;
}

export interface IntakeCandidateDto {
  id: string;
  kind: string;
  prompt: string;
  completion: string;
  qualityScore: number;
  status:
    | "TRAINING_CANDIDATE"
    | "TRAINING_APPROVED"
    | "TRAINING_REJECTED"
    | "QUARANTINED";
  gates: IntakeCandidateGate[];
  lineage: string;
  createdAt: string;
}

export interface IntakeDriftChange {
  kind: "ADDED" | "REMOVED" | "MODIFIED" | "RENAMED" | "DEPRECATED";
  objectType: "TABLE" | "COLUMN" | "INDEX" | "CONSTRAINT";
  name: string;
  detail: string;
}

export interface IntakeDriftReportDto {
  changes: IntakeDriftChange[];
  summary: string;
  fromVersion: string;
  toVersion: string;
  createdAt: string;
}

export interface IntakeDuplicateDto {
  kind: "EXACT" | "NEAR" | "SEMANTIC";
  left: string;
  right: string;
  status: "DUPLICATE" | "POSSIBLE_DUPLICATE" | "RELATED";
  evidence: string;
}

export interface IntakeSourceDto {
  id: string;
  name: string;
  platform: string;
  engine: string;
  versionLabel: string;
  checksum: string; // short form
  byteSize: number;
  status: string;
  tablesTotal: number;
  rowsTotal: number;
  dqScore: number | null;
  mapping: { high: number; medium: number; low: number; unresolved: number };
  knowledgeRecords: number;
  trainingCandidates: number;
  errors: string[];
  warnings: string[];
  createdAt: string;
  latestRun: {
    id: string;
    status: IntakeStageName;
    stage: string;
    trigger: "UPLOAD" | "REPROCESS";
    autonomyLevel: number;
    finishedAt: string | null;
  } | null;
}

export interface IntakeListPayload {
  sources: IntakeSourceDto[];
  reviewQueue: { mappings: number; candidates: number };
  autonomy: { level: number; label: string; description: string };
  openImprovements: number;
}

export interface IntakeDetailPayload {
  source: IntakeSourceDto;
  snapshot: IntakeSnapshotDto;
  runs: IntakeRunDto[];
  mappings: IntakeMappingDto[];
  preserved: IntakePreservedFieldDto[];
  kgEdges: IntakeKgEdgeDto[];
  candidates: IntakeCandidateDto[];
  drift: IntakeDriftReportDto | null;
  duplicates: IntakeDuplicateDto[];
  narrative: string[];
  importReport?: IntakeImportReport | null;
  dqReport?: IntakeDqReport | null;
}

export interface IntakeUploadResult {
  sourceDatabaseId: string;
  runId: string;
  jobId: string;
  detected: { engine: string; method: string; confidence: number; detail: string };
  byteSize: number;
  checksum: string;
}

export interface AutonomyCapability {
  name: string;
  minLevel: number;
  enabled: boolean;
}

export interface AutonomyPayload {
  level: number;
  label: string;
  description: string;
  capabilities: AutonomyCapability[];
  governance: string[]; // §152 never-autonomous list (always enforced)
  updatedAt: string;
}

export interface LearningPoint {
  date: string;
  count: number;
  total: number;
}

export interface ImprovementItemDto {
  id: string;
  kind: string;
  description: string;
  priority: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  proposedAction: string;
  createdAt: string;
}

export interface LearningPayload {
  knowledgeGrowth: LearningPoint[];
  totals: {
    sources: number;
    documents: number;
    knowledgeRecords: number;
    chunks: number;
    kgEdges: number;
    trainingExamples: number;
    trainingCandidates: number;
    trainingRuns: number;
    canonicalEntities: number;
  };
  canonicalEntities: { entity: string; tables: number }[];
  kgPredicates: { predicate: string; count: number; classification: string }[];
  evalTrends: { runLabel: string; passRate: number; groundedness: number | null; latencyMs: number }[];
  feedbackTrends: { label: string; count: number }[];
  improvementQueue: ImprovementItemDto[];
  lastHealthCheck: {
    ranAt: string;
    issuesFound: number;
    checks: { check: string; status: string; detail: string }[];
  } | null;
}

export const AUTONOMY_LEVELS: { level: number; label: string; description: string }[] = [
  { level: 0, label: "LEVEL 0 — MANUAL", description: "Nothing is automatically imported or trained." },
  { level: 1, label: "LEVEL 1 — AUTO INGESTION", description: "Upload → analyze → import." },
  { level: 2, label: "LEVEL 2 — AUTO KNOWLEDGE", description: "Upload → ingest → knowledge extraction → RAG." },
  { level: 3, label: "LEVEL 3 — AUTO TRAINING DATA", description: "Upload → knowledge → training candidate generation." },
  { level: 4, label: "LEVEL 4 — AUTO TRAINING", description: "Upload → approved dataset → training → evaluation." },
  { level: 5, label: "LEVEL 5 — CONTROLLED AUTO-DEPLOYMENT", description: "Training → evaluation → canary. Production promotion remains human-controlled (§127/§152)." },
];
