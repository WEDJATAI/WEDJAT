// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake DTO mappers (DB rows → API contract DTOs).
// Shared by /api/intake list, detail and review routes.
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  IntakeCandidateDto,
  IntakeDqReport,
  IntakeImportReport,
  IntakeKgEdgeDto,
  IntakeMappingDto,
  IntakeRunDto,
  IntakeSnapshotDto,
  IntakeSourceDto,
  IntakeStageEvent,
  IntakeTableDto,
} from '../types';
import { discover } from './discovery';
import type { SchemaSnapshot } from './schema-model';
import type {
  CanonicalMapping,
  DuplicateMarker,
  IntakeRun,
  KnowledgeGraphEdge,
  SchemaSnapshot as SchemaSnapshotRow,
  SourceDatabase,
  TrainingCandidate,
} from '@prisma/client';

type IntakeStageName = IntakeRunDto['status'];

function stageOf(run: IntakeRun): string {
  const events = JSON.parse(run.stageEventsJson || '[]') as IntakeStageEvent[];
  return events.length > 0 ? events[events.length - 1].stage : run.status;
}

export function toSourceDto(
  source: SourceDatabase,
  latestRun: IntakeRun | null
): IntakeSourceDto {
  return {
    id: source.id,
    name: source.name,
    platform: source.platform,
    engine: source.engine,
    versionLabel: source.versionLabel,
    checksum: source.checksum.slice(0, 12),
    byteSize: source.byteSize,
    status: source.status,
    tablesTotal: source.tablesTotal,
    rowsTotal: source.rowsTotal,
    dqScore: source.dqScore,
    mapping: {
      high: source.mappedHigh,
      medium: source.mappedMedium,
      low: source.mappedLow,
      unresolved: source.mappedUnresolved,
    },
    knowledgeRecords: source.knowledgeRecordsCount,
    trainingCandidates: source.trainingCandidatesCount,
    errors: [],
    warnings: [],
    createdAt: source.createdAt.toISOString(),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status as IntakeStageName,
          stage: stageOf(latestRun),
          trigger: latestRun.trigger as 'UPLOAD' | 'REPROCESS',
          autonomyLevel: latestRun.autonomyLevel,
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export function toRunDto(run: IntakeRun): IntakeRunDto {
  return {
    id: run.id,
    sourceDatabaseId: run.sourceDatabaseId,
    jobId: run.jobId,
    status: run.status as IntakeStageName,
    stage: stageOf(run),
    trigger: run.trigger as 'UPLOAD' | 'REPROCESS',
    autonomyLevel: run.autonomyLevel,
    engineVersion: run.engineVersion,
    snapshotId: run.snapshotId,
    stageEvents: JSON.parse(run.stageEventsJson || '[]') as IntakeStageEvent[],
    errors: JSON.parse(run.errorsJson || '[]') as string[],
    warnings: JSON.parse(run.warningsJson || '[]') as string[],
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

export function toMappingDto(m: CanonicalMapping): IntakeMappingDto {
  return {
    id: m.id,
    intakeRunId: m.intakeRunId,
    sourceTable: m.sourceTable,
    tablePurpose: m.tablePurpose,
    entityType: m.entityType,
    canonicalEntity: m.canonicalEntity,
    confidence: m.confidence,
    confidenceLabel: m.confidenceLabel as IntakeMappingDto['confidenceLabel'],
    reason: m.reason,
    evidence: JSON.parse(m.evidenceJson || '[]') as IntakeMappingDto['evidence'],
    columnMappings: JSON.parse(m.columnMappingsJson || '[]') as IntakeMappingDto['columnMappings'],
    decision: m.decision as IntakeMappingDto['decision'],
    rowCount: m.rowCount,
    reviewedBy: m.reviewedById,
    reviewedAt: m.reviewedAt?.toISOString() ?? null,
    reviewNote: m.reviewNote,
  };
}

export function toCandidateDto(c: TrainingCandidate): IntakeCandidateDto {
  return {
    id: c.id,
    kind: c.kind,
    prompt: c.prompt,
    completion: c.completion,
    qualityScore: c.qualityScore,
    status: c.status as IntakeCandidateDto['status'],
    gates: JSON.parse(c.gatesJson || '[]') as IntakeCandidateDto['gates'],
    lineage: c.lineageJson,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toKgEdgeDto(e: KnowledgeGraphEdge): IntakeKgEdgeDto {
  let provenance = e.provenanceJson;
  try {
    const p = JSON.parse(e.provenanceJson) as Record<string, string>;
    provenance = `source=${p.sourceDatabaseId ?? '?'} snapshot=${p.snapshotId ?? '?'} run=${p.intakeRunId ?? '?'}`;
  } catch {
    /* keep raw */
  }
  return {
    id: e.id,
    subject: e.subject,
    predicate: e.predicate,
    object: e.object,
    classification: e.classification as IntakeKgEdgeDto['classification'],
    evidence: e.evidence,
    provenance,
  };
}

export function toSnapshotDto(
  row: SchemaSnapshotRow,
  includeTables: boolean,
  maxTables = 60
): IntakeSnapshotDto {
  const snapshot = JSON.parse(row.snapshotJson) as SchemaSnapshot;
  const discovery = discover(snapshot);
  const purposeByTable = new Map(discovery.tables.map((t) => [t.def.name.toLowerCase(), t]));

  const tables: IntakeTableDto[] = snapshot.tables.slice(0, maxTables).map((t) => {
    const dt = purposeByTable.get(t.name.toLowerCase());
    const canonical = dt?.entityType;
    return {
      name: t.name,
      purpose: dt?.purpose ?? 'UNKNOWN',
      entityType: dt?.entityType ?? 'Unknown',
      canonicalEntity: null,
      rowCount: t.rowCount,
      primaryKey: t.primaryKey,
      foreignKeys: t.foreignKeys.map((fk) => ({ columns: fk.columns, refTable: fk.refTable, refColumns: fk.refColumns })),
      indexes: t.indexes.map((ix) => ({ name: ix.name, columns: ix.columns, unique: ix.unique })),
      columns: t.columns.map((c) => {
        const stat = t.stats.find((s) => s.name === c.name);
        const discoveredCol = dt?.columns.find((cc) => cc.def.name === c.name);
        return {
          name: c.name,
          rawType: c.rawType,
          normalizedType: c.type,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
          purpose: discoveredCol?.purpose ?? 'UNKNOWN',
          defaultValue: c.defaultValue,
          enumValues: stat?.isEnumLike ? stat.enumValues.slice(0, 12) : undefined,
          nullPct: stat?.nullPct,
          distinct: stat?.distinct ?? undefined,
        };
      }),
      // canonicalEntity attached via mappings in the detail payload assembler
      ...(canonical ? {} : {}),
    } satisfies IntakeTableDto;
  });

  return {
    id: row.id,
    version: row.version,
    engine: snapshot.engine,
    detection: snapshot.detection,
    tablesCount: row.tablesCount,
    columnsCount: row.columnsCount,
    fksCount: row.fksCount,
    indexesCount: row.indexesCount,
    viewsCount: row.viewsCount,
    createdAt: row.createdAt.toISOString(),
    tables: includeTables ? tables : [],
    tablesTruncated: includeTables ? snapshot.tables.length > maxTables : undefined,
  };
}

export function parseImportReport(run: IntakeRun): IntakeImportReport | null {
  if (!run.reportJson) return null;
  return JSON.parse(run.reportJson) as IntakeImportReport;
}

export function parseDqReport(run: IntakeRun): IntakeDqReport | null {
  if (!run.dqJson) return null;
  return JSON.parse(run.dqJson) as IntakeDqReport;
}

export function toDuplicateDto(d: DuplicateMarker): {
  kind: 'EXACT' | 'NEAR' | 'SEMANTIC';
  left: string;
  right: string;
  status: 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'RELATED';
  evidence: string;
} {
  let evidence = d.evidenceJson;
  try {
    const p = JSON.parse(d.evidenceJson) as { evidence?: string };
    evidence = p.evidence ?? evidence;
  } catch {
    /* raw */
  }
  return {
    kind: d.kind as 'EXACT' | 'NEAR' | 'SEMANTIC',
    left: d.leftRef,
    right: d.rightRef,
    status: d.status as 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'RELATED',
    evidence,
  };
}
