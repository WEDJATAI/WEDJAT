// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake engine: the autonomous pipeline orchestrator
// (§107, §114, §119, §124, §127–§130, §150, §160).
//
// UPLOAD → AUTO-DETECT → AUTO-ANALYZE → AUTO-MAP → AUTO-NORMALIZE →
// AUTO-VALIDATE → AUTO-IMPORT → AUTO-INDEX → AUTO-EXPAND KNOWLEDGE →
// AUTO-GENERATE TRAINING CANDIDATES → … → CONTROLLED MODEL IMPROVEMENT.
//
// Staging states RAW → STAGED → ANALYZED → MAPPED → VALIDATED → IMPORTED are
// persisted progressively (pollable). Every automatic action is traceable,
// versioned, auditable and autonomy-gated (§151); the source artifact is never
// modified (§108/§107 — never silently destroy or overwrite source data).
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { sha256, contentHash, newTraceId } from '../ids';
import { logger } from '../logger';
import { recordAudit } from '../observability/audit';
import { WedjatError } from '../errors';
import { routeAndComplete } from '../gateway/router';
import { runIngestion } from '../knowledge/ingestion';
import { enqueueJob } from '../observability/jobs';
import { detectFormat, type DetectionResult } from './detect';
import { loadArtifactBytes, materializeArtifactFile } from './artifact';
import { parseSqliteDatabase } from './parsers/sqlite';
import { parseSqlDump } from './parsers/sqldump';
import { parseCsvFile, parseJsonFile, parseJsonlFile } from './parsers/tabular';
import { discover, type DiscoveredTable } from './discovery';
import { mapTablesToCanonical, type TableMapping } from './canonical';
import { analyzeDataQuality, type DqReport } from './quality';
import { validateImport, type ImportReport } from './validate';
import { detectDrift, type DriftResult } from './drift';
import { extractKnowledge, detectCrossSourceDuplicates, type KnowledgeDoc, type KgEdgeDraft, type DuplicateDraft } from './extract';
import { generateCandidates, duplicateGate } from './candidates';
import { autonomyAllows, getAutonomyState } from './autonomy';
import type { SchemaSnapshot } from './schema-model';
import type { Principal } from '../types';

export const INTAKE_ENGINE_VERSION = 'wedjat-intake-1.0';
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
/** §128 batching: minimum NEW approved candidates before a training run is queued. */
const TRAINING_TRIGGER_THRESHOLD = 8;

export interface StageEvent {
  stage: string;
  status: 'OK' | 'WARN' | 'FAILED' | 'RUNNING';
  detail: string;
  latencyMs: number;
  at: string;
}

interface RunContext {
  runId: string;
  sourceId: string;
  orgId: string;
  userId: string;
  stageEvents: StageEvent[];
  errors: string[];
  warnings: string[];
  narrative: string[];
}

// ── staged persistence helpers ────────────────────────────────────────────────

async function pushEvent(
  ctx: RunContext,
  stage: string,
  status: StageEvent['status'],
  detail: string,
  latencyMs: number,
): Promise<void> {
  ctx.stageEvents.push({ stage, status, detail, latencyMs, at: new Date().toISOString() });
  // Run status tracks the STAGE (RAW→…→IMPORTED) so the UI can poll while
  // active; a FAILED event fails the run regardless of stage.
  const runStatus = status === 'FAILED' ? 'FAILED' : stage;
  await db.intakeRun.update({
    where: { id: ctx.runId },
    data: { stageEventsJson: JSON.stringify(ctx.stageEvents), status: runStatus },
  });
}

async function failRun(ctx: RunContext, detail: string, stage: string): Promise<void> {
  ctx.errors.push(detail);
  await pushEvent(ctx, 'FAILED', 'FAILED', `${stage}: ${detail}`, 0);
  await db.intakeRun.update({
    where: { id: ctx.runId },
    data: { status: 'FAILED', errorsJson: JSON.stringify(ctx.errors), warningsJson: JSON.stringify(ctx.warnings), finishedAt: new Date() },
  });
  await db.sourceDatabase.update({ where: { id: ctx.sourceId }, data: { status: 'FAILED' } });
}

async function loadSnapshot(snapshotId: string): Promise<SchemaSnapshot> {
  const row = await db.schemaSnapshot.findUnique({ where: { id: snapshotId } });
  if (!row) throw new WedjatError('NOT_FOUND', `snapshot ${snapshotId} missing`);
  return JSON.parse(row.snapshotJson) as SchemaSnapshot;
}

function principalLike(orgId: string, userId: string): Principal {
  return {
    userId,
    name: 'intake-engine',
    email: 'intake@wedjat.ai',
    role: 'CURATOR',
    org: { id: orgId, slug: 'wedjat', name: 'WEDJAT', dataPolicy: 'APPROVED_REMOTE_PROVIDER' },
  };
}

function recordAuditSafe(
  orgId: string,
  actorId: string,
  action: string,
  targetId: string,
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  details: Record<string, unknown>,
  traceId: string,
): void {
  void recordAudit({
    orgId,
    actorType: 'user',
    actorId,
    action,
    targetType: 'intakeRun',
    targetId,
    severity,
    details,
    traceId,
  }).catch((e) => logger.warn('intake_audit_failed', { error: e instanceof Error ? e.message : String(e) }));
}

// ── the pipeline ──────────────────────────────────────────────────────────────

export interface IntakeOutcome {
  status: string;
  narrative: string[];
  importReport: ImportReport | null;
  dqReport: DqReport | null;
  tables: number;
  rows: number;
  mappings: { high: number; medium: number; low: number; unresolved: number };
  knowledgeRecords: number;
  chunks: number;
  trainingCandidates: number;
}

export async function runIntake(runId: string, userId: string): Promise<IntakeOutcome> {
  const run = await db.intakeRun.findUnique({ where: { id: runId } });
  if (!run) throw new WedjatError('NOT_FOUND', 'Intake run not found');
  const source = await db.sourceDatabase.findUnique({ where: { id: run.sourceDatabaseId } });
  if (!source) throw new WedjatError('NOT_FOUND', 'Source database not found');

  const ctx: RunContext = {
    runId,
    sourceId: source.id,
    orgId: run.orgId,
    userId,
    stageEvents: JSON.parse(run.stageEventsJson || '[]') as StageEvent[],
    errors: JSON.parse(run.errorsJson || '[]') as string[],
    warnings: JSON.parse(run.warningsJson || '[]') as string[],
    narrative: [],
  };
  const traceId = newTraceId();
  const autonomy = await getAutonomyState(run.orgId);
  await db.intakeRun.update({ where: { id: runId }, data: { startedAt: new Date(), autonomyLevel: autonomy.level } });

  let artifactBytes: Uint8Array;
  let detection: DetectionResult;
  let snapshotId: string | null = null;
  let dq: DqReport | null = null;
  let report: ImportReport | null = null;
  let mappings: TableMapping[] = [];
  let discovered: DiscoveredTable[] = [];
  let knowledgeRecords = 0;
  let chunks = 0;
  let trainingCandidates = 0;

  // ══ STAGE 1 — RAW: verify immutable artifact (§108) ════════════════════════
  try {
    const t = Date.now();
    // DB-authoritative bytes (serverless-safe) with the FS cache as fallback.
    artifactBytes = await loadArtifactBytes(source);
    if (artifactBytes.length > MAX_ARTIFACT_BYTES) {
      throw new WedjatError('VALIDATION', 'Artifact exceeds the 25MB intake limit');
    }
    const liveHash = createHash('sha256').update(artifactBytes).digest('hex');
    if (liveHash !== source.checksum) {
      ctx.warnings.push(
        `artifact checksum mismatch (stored ${source.checksum.slice(0, 8)}…, computed ${liveHash.slice(0, 8)}…) — source preservation integrity alert (§108)`
      );
    }
    detection = detectFormat(artifactBytes);
    ctx.narrative.push(
      `Source preserved: ${source.platform}/${source.name} ${source.versionLabel} · ${source.byteSize.toLocaleString()} bytes · sha256 ${source.checksum.slice(0, 12)}…`
    );
    ctx.narrative.push(`Database detected: ${detection.format} (${detection.method}, ${Math.round(detection.confidence * 100)}% confidence).`);
    await pushEvent(ctx, 'RAW', 'OK', `artifact verified (${(source.byteSize / 1024).toFixed(1)} KB, checksum intact); format ${detection.format}`, Date.now() - t);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `RAW stage failed: ${msg}`, 'RAW');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  // ══ STAGE 2 — STAGED: parse into normalized snapshot (§106/§114) ═══════════
  try {
    const t = Date.now();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(artifactBytes);
    let snapshot: SchemaSnapshot;
    switch (detection.format) {
      case 'SQLITE':
        // SQLite parsing opens a real file — materialize if the FS copy is gone.
        snapshot = await parseSqliteDatabase(await materializeArtifactFile(source));
        break;
      case 'CSV':
        snapshot = parseCsvFile(text, source.originalName ?? source.name);
        break;
      case 'JSON':
        snapshot = parseJsonFile(text, source.originalName ?? source.name);
        break;
      case 'JSONL':
        snapshot = parseJsonlFile(text, source.originalName ?? source.name);
        break;
      default:
        snapshot = parseSqlDump(text, detection.format);
    }
    const priorSnapshot = await db.schemaSnapshot.findFirst({
      where: { sourceDatabaseId: source.id },
      orderBy: { version: 'desc' },
    });
    const version = (priorSnapshot?.version ?? 0) + 1;
    const snapRow = await db.schemaSnapshot.create({
      data: {
        sourceDatabaseId: source.id,
        version,
        engine: snapshot.engine,
        snapshotJson: JSON.stringify(snapshot),
        tablesCount: snapshot.counts.tables,
        columnsCount: snapshot.counts.columns,
        fksCount: snapshot.counts.fks,
        indexesCount: snapshot.counts.indexes,
        viewsCount: snapshot.counts.views,
        checksum: contentHash(snapshot.tables.map((tb) => `${tb.name}:${tb.columns.length}:${tb.rowCount}`).join('|')),
      },
    });
    snapshotId = snapRow.id;
    await db.intakeRun.update({ where: { id: runId }, data: { snapshotId } });
    await db.sourceDatabase.update({
      where: { id: source.id },
      data: {
        engine: snapshot.engine,
        tablesTotal: snapshot.counts.tables,
        rowsTotal: snapshot.tables.reduce((n, tb) => n + tb.rowCount, 0),
        status: 'PROCESSING',
      },
    });
    ctx.narrative.push(
      `Schema analyzed: ${snapshot.counts.tables} tables, ${snapshot.counts.columns} columns, ${snapshot.counts.fks} foreign keys, ${snapshot.counts.indexes} indexes, ${snapshot.counts.views} views. Snapshot v${version} stored (immutable).`
    );
    await pushEvent(ctx, 'STAGED', 'OK', `parsed ${snapshot.engine}: ${snapshot.counts.tables} tables / ${snapshot.counts.columns} columns → snapshot v${version}`, Date.now() - t);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `STAGED stage failed: ${msg}`, 'STAGED');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  // ══ STAGE 3 — ANALYZED: semantic discovery + data quality (§109/§117) ══════
  try {
    const t = Date.now();
    const snapshot = await loadSnapshot(snapshotId!);
    const discovery = discover(snapshot);
    discovered = discovery.tables;
    dq = analyzeDataQuality(discovery.tables);
    await db.intakeRun.update({ where: { id: runId }, data: { dqJson: JSON.stringify(dq) } });
    await db.sourceDatabase.update({ where: { id: source.id }, data: { dqScore: dq.score } });
    ctx.narrative.push(`Data quality report generated — score ${dq.score}/100 (${dq.findings.length} findings).`);
    ctx.warnings.push(...discovery.notes);
    await pushEvent(ctx, 'ANALYZED', dq.score >= 60 ? 'OK' : 'WARN', `${discovery.tables.length} tables classified; DQ score ${dq.score}/100`, Date.now() - t);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `ANALYZED stage failed: ${msg}`, 'ANALYZED');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  // ══ STAGE 4 — MAPPED: canonical mapping w/ evidence + AI assist (§110–§113) ═
  try {
    const t = Date.now();
    const snapshot = await loadSnapshot(snapshotId!);
    const discovery = discover(snapshot);
    const aiSuggestions = await aiSemanticAssist(source.platform, discovery.tables, ctx);
    mappings = mapTablesToCanonical(discovery.tables, aiSuggestions, INTAKE_ENGINE_VERSION);

    // §113 decisions — HIGH+autonomy≥1 auto-applied; MEDIUM review queue;
    // LOW/UNRESOLVED preserved as source data (never discarded §143).
    const decisionFor = (label: string): string => {
      if (label === 'HIGH_CONFIDENCE') return autonomyAllows(autonomy.level, 'CANONICAL_IMPORT') ? 'AUTO_APPLIED' : 'PENDING_REVIEW';
      if (label === 'MEDIUM_CONFIDENCE') return 'PENDING_REVIEW';
      return 'PRESERVED_SOURCE';
    };

    // zero-data-loss preserved fields (§143)
    const preservedRows: {
      tableName: string;
      columnName: string;
      columnType: string;
      reason: string;
      sampleJson: string | null;
    }[] = [];
    for (const m of mappings) {
      if (m.canonicalEntity) continue;
      const dt = discovery.tables.find((tb) => tb.def.name.toLowerCase() === m.sourceTable.toLowerCase());
      if (!dt) continue;
      for (const col of dt.def.columns) {
        preservedRows.push({
          tableName: m.sourceTable,
          columnName: col.name,
          columnType: col.rawType,
          reason: 'LOW/UNRESOLVED mapping — fields preserved verbatim for future engine versions (§143 zero data loss)',
          sampleJson: JSON.stringify(dt.def.stats.find((s) => s.name === col.name)?.sampleValues.slice(0, 2) ?? []),
        });
      }
    }
    if (preservedRows.length > 0) {
      await db.preservedField.createMany({
        data: preservedRows.slice(0, 2000).map((p) => ({ ...p, sourceDatabaseId: source.id, intakeRunId: runId, orgId: run.orgId })),
      });
    }

    await db.canonicalMapping.createMany({
      data: mappings.map((m) => ({
        intakeRunId: runId,
        sourceDatabaseId: source.id,
        orgId: run.orgId,
        sourceTable: m.sourceTable,
        tablePurpose: m.tablePurpose,
        entityType: m.entityType,
        canonicalEntity: m.canonicalEntity,
        confidenceLabel: m.confidenceLabel,
        confidence: m.confidence,
        reason: m.reason,
        evidenceJson: JSON.stringify(m.evidence),
        columnMappingsJson: JSON.stringify(m.columnMappings),
        decision: decisionFor(m.confidenceLabel),
        rowCount: m.rowCount,
      })),
    });

    const high = mappings.filter((m) => m.confidenceLabel === 'HIGH_CONFIDENCE').length;
    const medium = mappings.filter((m) => m.confidenceLabel === 'MEDIUM_CONFIDENCE').length;
    const low = mappings.filter((m) => m.confidenceLabel === 'LOW_CONFIDENCE').length;
    const unresolved = mappings.filter((m) => m.confidenceLabel === 'UNRESOLVED').length;
    await db.intakeRun.update({
      where: { id: runId },
      data: {
        mappingsJson: JSON.stringify({
          high,
          medium,
          low,
          unresolved,
          tables: mappings.map((m) => ({ table: m.sourceTable, entity: m.canonicalEntity, confidence: m.confidence, label: m.confidenceLabel, decision: decisionFor(m.confidenceLabel) })),
        }),
      },
    });
    await db.sourceDatabase.update({
      where: { id: source.id },
      data: { mappedHigh: high, mappedMedium: medium, mappedLow: low, mappedUnresolved: unresolved },
    });
    ctx.narrative.push(
      `${mappings.length} tables mapped: ${high} high-confidence${autonomyAllows(autonomy.level, 'CANONICAL_IMPORT') ? ' (auto-applied)' : ''}, ${medium} medium (review queue), ${low + unresolved} preserved as unmapped source data (zero data loss §143).`
    );
    await pushEvent(
      ctx,
      'MAPPED',
      'OK',
      `${high} HIGH / ${medium} MEDIUM / ${low} LOW / ${unresolved} UNRESOLVED${aiSuggestions.length > 0 ? `; AI semantic assist: ${aiSuggestions.length} suggestions` : ''}`,
      Date.now() - t
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `MAPPED stage failed: ${msg}`, 'MAPPED');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  // ══ STAGE 5 — VALIDATED: import validation + drift (§115/§142) ════════════
  try {
    const t = Date.now();
    const snapshot = await loadSnapshot(snapshotId!);
    const discovery = discover(snapshot);

    // §142 drift vs prior snapshot: first a prior snapshot of the SAME source
    // (reprocess §145), then the previous VERSION of the same platform database
    // (same org + platform + name, different source row — re-upload).
    let priorRow = await db.schemaSnapshot.findFirst({
      where: { sourceDatabaseId: source.id, id: { not: snapshotId! } },
      orderBy: { version: 'desc' },
    });
    let drift: DriftResult | null = null;
    const priorTables: { name: string; columns: { name: string; type: string }[] }[] = [];
    if (!priorRow) {
      const sibling = await db.sourceDatabase.findFirst({
        where: {
          orgId: run.orgId,
          platform: source.platform,
          name: source.name,
          id: { not: source.id },
          status: 'IMPORTED',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (sibling) {
        priorRow = await db.schemaSnapshot.findFirst({
          where: { sourceDatabaseId: sibling.id },
          orderBy: { version: 'desc' },
        });
      }
    }
    if (priorRow) {
      const priorSnapshot = JSON.parse(priorRow.snapshotJson) as SchemaSnapshot;
      const priorSource = await db.sourceDatabase.findUnique({ where: { id: priorRow.sourceDatabaseId } });
      const priorLabel = priorSource?.versionLabel ?? `snapshot v${priorRow.version}`;
      const currentLabel = source.versionLabel;
      drift = detectDrift(priorSnapshot, snapshot, priorLabel, currentLabel);
      priorTables.push(...priorSnapshot.tables.map((tb) => ({ name: tb.name, columns: tb.columns.map((c) => ({ name: c.name, type: c.type })) })));
      if (drift.changes.length > 0) {
        await db.driftReport.create({
          data: {
            sourceDatabaseId: source.id,
            orgId: run.orgId,
            intakeRunId: runId,
            fromSnapshotId: priorRow.id,
            toSnapshotId: snapshotId!,
            changesJson: JSON.stringify(drift.changes),
            summary: drift.summary,
          },
        });
        await db.intakeRun.update({
          where: { id: runId },
          data: {
            driftJson: JSON.stringify({
              changes: drift.changes,
              summary: drift.summary,
              fromVersion: priorLabel,
              toVersion: currentLabel,
              createdAt: new Date().toISOString(),
            }),
          },
        });
        ctx.narrative.push(`Schema drift detected: ${drift.summary}`);
      }
    }

    report = validateImport(discovery.tables, mappings, priorTables);
    await db.intakeRun.update({ where: { id: runId }, data: { reportJson: JSON.stringify(report) } });
    ctx.narrative.push(
      `Validation: ${report.passed} checks passed, ${report.warned} warnings, ${report.failed} failures${report.blocked ? ' — IMPORT BLOCKED by critical failures' : ''}.`
    );
    if (report.blocked) {
      await pushEvent(ctx, 'VALIDATED', 'FAILED', `import blocked: ${report.checks.filter((c) => c.status === 'FAIL').map((c) => c.name).join(', ')}`, Date.now() - t);
      await failRun(ctx, `validation blocked import: ${report.checks.filter((c) => c.status === 'FAIL').map((c) => `${c.name} (${c.detail})`).join('; ')}`, 'VALIDATED');
      return finalize(ctx, report, dq, discovered.length, discovered.reduce((n, d) => n + d.def.rowCount, 0), mappings, 0, 0, 0);
    }
    await pushEvent(ctx, 'VALIDATED', report.warned > 0 ? 'WARN' : 'OK', `${report.passed} pass / ${report.warned} warn / ${report.failed} fail`, Date.now() - t);

    // Autonomy gate (§151): LEVEL 0 stops before import.
    if (!autonomyAllows(autonomy.level, 'CANONICAL_IMPORT')) {
      ctx.narrative.push('Autonomy LEVEL 0: import paused — awaiting human approval (nothing is automatically imported).');
      await pushEvent(ctx, 'VALIDATED', 'OK', 'autonomy LEVEL 0 — import held for manual approval', 0);
      await db.intakeRun.update({
        where: { id: runId },
        data: { status: 'VALIDATED', finishedAt: new Date(), narrativeJson: JSON.stringify(ctx.narrative) },
      });
      await db.sourceDatabase.update({ where: { id: source.id }, data: { status: 'AWAITING_REVIEW', latestRunId: runId } });
      recordAuditSafe(run.orgId, userId, 'intake.awaiting_review', runId, 'INFO', { sourceId: source.id, autonomyLevel: autonomy.level }, traceId);
      return finalize(ctx, report, dq, discovered.length, discovered.reduce((n, d) => n + d.def.rowCount, 0), mappings, 0, 0, 0);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `VALIDATED stage failed: ${msg}`, 'VALIDATED');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  // ══ STAGE 6 — IMPORTED: knowledge + KG + candidates (§118–§126) ═══════════
  try {
    const t = Date.now();
    const snapshot = await loadSnapshot(snapshotId!);
    const discovery = discover(snapshot);

    if (autonomyAllows(autonomy.level, 'KNOWLEDGE_EXTRACTION')) {
      // §108/§158: reprocess → supersede previous knowledge from this source
      const priorRuns = await db.intakeRun.findMany({
        where: { sourceDatabaseId: source.id, status: 'IMPORTED', id: { not: runId } },
      });
      const supersededIds: string[] = [];
      for (const prior of priorRuns) {
        const kj = JSON.parse(prior.knowledgeJson || '{}') as { knowledgeRecordIds?: string[] };
        for (const krId of kj.knowledgeRecordIds ?? []) {
          await db.knowledgeRecord.update({ where: { id: krId }, data: { status: 'SUPERSEDED', effectiveUntil: new Date() } });
          supersededIds.push(krId);
        }
      }
      if (supersededIds.length > 0) {
        ctx.narrative.push(`${supersededIds.length} previously-extracted knowledge records marked SUPERSEDED (history retained, RAG prefers latest — §158).`);
      }

      // external platform shell for the REAL ingestion pipeline (§123 namespace)
      const extPlatformSlug = slugify(`ext-${source.platform}`);
      let platform = await db.platform.findFirst({ where: { orgId: run.orgId, slug: extPlatformSlug } });
      if (!platform) {
        platform = await db.platform.create({
          data: {
            orgId: run.orgId,
            slug: extPlatformSlug,
            name: `${source.platform} (external import)`,
            description: `External platform database ${source.name} — auto-ingested via the database intake engine (§106).`,
            criticality: 'HIGH',
            status: 'ACTIVE',
          },
        });
      }
      const blueprintSlug = slugify(`db-${source.name}`);
      const blueprintVersion = source.versionLabel.replace(/^v/, '');

      const { docs, kgEdges } = extractKnowledge(
        {
          id: source.id,
          name: source.name,
          platform: source.platform,
          versionLabel: source.versionLabel,
          engine: source.engine,
          checksum: source.checksum,
          byteSize: source.byteSize,
        },
        snapshot,
        discovery,
        mappings,
        dq!
      );

      const knowledgeRecordIds: string[] = [];
      const documentVersionIds: string[] = [];
      for (const doc of docs) {
        const res = await runIngestion({
          orgId: run.orgId,
          platformSlug: extPlatformSlug,
          blueprintSlug,
          blueprintTitle: `${source.platform} ${source.name} database`,
          blueprintType: 'REFERENCE',
          blueprintVersion,
          title: doc.title,
          docType: 'REFERENCE',
          classification: 'CONFIDENTIAL',
          content: doc.content,
          documentVersion: '1',
          sourcePath: source.artifactPath,
          actorId: userId,
        });
        documentVersionIds.push(res.documentVersionId);
        if (!res.duplicate) {
          const krs = await db.knowledgeRecord.findMany({
            where: { blueprintVersionId: res.blueprintVersionId },
            select: { id: true },
          });
          knowledgeRecordIds.push(...krs.map((k) => k.id));
        }
      }
      knowledgeRecords = knowledgeRecordIds.length;
      chunks = await db.documentChunk.count({
        where: {
          status: 'INDEXED',
          documentVersion: { document: { blueprintVersion: { blueprint: { platformId: platform.id } } } },
        },
      });

      // KG edges (§139/§140) + cross-source duplicates (§141)
      await persistKgEdges(run.orgId, runId, source.id, kgEdges, snapshotId!);
      const peers = await loadPeerContexts(run.orgId, source.id);
      const duplicateMarkers: DuplicateDraft[] = detectCrossSourceDuplicates(
        { sourceId: source.id, platform: source.platform, tables: discovery.tables, mappings },
        peers,
      );
      if (duplicateMarkers.length > 0) {
        await db.duplicateMarker.createMany({
          data: duplicateMarkers.map((d) => ({
            orgId: run.orgId,
            intakeRunId: runId,
            kind: d.kind,
            leftRef: d.left,
            rightRef: d.right,
            status: d.status,
            evidenceJson: JSON.stringify({ evidence: d.evidence }),
          })),
        });
        await db.intakeRun.update({ where: { id: runId }, data: { duplicatesJson: JSON.stringify(duplicateMarkers) } });
        ctx.narrative.push(`${duplicateMarkers.length} cross-source duplicate/related markers recorded (never deleted — §141).`);
      }

      ctx.narrative.push(
        `Knowledge extracted: ${docs.length} documents → ${knowledgeRecords} knowledge records, ${chunks} searchable chunks — embedded, indexed, RAG-ready (§119/§124).`
      );
      await db.intakeRun.update({
        where: { id: runId },
        data: { knowledgeJson: JSON.stringify({ documentVersionIds, knowledgeRecordIds, docs: docs.length, platformSlug: extPlatformSlug, blueprintSlug }) },
      });
      await db.sourceDatabase.update({ where: { id: source.id }, data: { knowledgeRecordsCount: knowledgeRecords, chunksCount: chunks } });

      // ── training candidates (§125/§126) ──
      if (autonomyAllows(autonomy.level, 'TRAINING_CANDIDATES')) {
        const candidates = generateCandidates(
          { id: source.id, name: source.name, platform: source.platform, versionLabel: source.versionLabel },
          discovery,
          mappings,
          dq!,
          docs,
          peers,
        );
        const existingCandidates = await db.trainingCandidate.findMany({
          where: { orgId: run.orgId },
          select: { prompt: true, dedupeHash: true },
          take: 2000,
        });
        const existingExamples = await db.trainingExample.findMany({ select: { prompt: true, dedupeHash: true }, take: 2000 });
        const existing = [...existingCandidates, ...existingExamples];
        let rejected = 0;
        for (const c of candidates) {
          const dup = duplicateGate(c, existing);
          const gates = [...c.gates, dup];
          const status = c.status === 'TRAINING_CANDIDATE' && !dup.passed ? 'TRAINING_REJECTED' : c.status;
          if (status === 'TRAINING_REJECTED') rejected += 1;
          existing.push({ prompt: c.prompt, dedupeHash: c.dedupeHash });
          await db.trainingCandidate.create({
            data: {
              orgId: run.orgId,
              intakeRunId: runId,
              sourceDatabaseId: source.id,
              kind: c.kind,
              prompt: c.prompt,
              completion: c.completion,
              qualityScore: Math.round(c.qualityScore * 100) / 100,
              dedupeHash: c.dedupeHash,
              status,
              gatesJson: JSON.stringify(gates),
              lineageJson: c.lineage,
            },
          });
        }

        // §127 auto-curation: autonomy ≥ 4 auto-approves gate-passing candidates
        let approved = 0;
        if (autonomyAllows(autonomy.level, 'TRAINING_DATASET')) {
          const passing = await db.trainingCandidate.findMany({
            where: { orgId: run.orgId, sourceDatabaseId: source.id, intakeRunId: runId, status: 'TRAINING_CANDIDATE' },
          });
          for (const c of passing) {
            await db.trainingCandidate.update({
              where: { id: c.id },
              data: { status: 'TRAINING_APPROVED', reviewedById: userId, reviewedAt: new Date(), reviewNote: 'auto-approved: all §126 gates passed + autonomy ≥ 4 (§127 auto-curation)' },
            });
          }
          approved = passing.length;
        }
        trainingCandidates = approved > 0 ? approved : candidates.filter((c) => c.status === 'TRAINING_CANDIDATE').length;
        ctx.narrative.push(
          `New training candidates generated: ${candidates.length} (${approved > 0 ? `${approved} auto-approved via §127 gates` : `${trainingCandidates} awaiting review`}, ${rejected} rejected by safety gates, ${candidates.filter((c) => c.status === 'QUARANTINED').length} quarantined).`
        );
        await db.intakeRun.update({
          where: { id: runId },
          data: { candidatesJson: JSON.stringify({ generated: candidates.length, approved, rejected, quarantined: candidates.filter((c) => c.status === 'QUARANTINED').length }) },
        });
        await db.sourceDatabase.update({ where: { id: source.id }, data: { trainingCandidatesCount: trainingCandidates } });

        // §128/§130: training trigger with batching threshold
        if (autonomyAllows(autonomy.level, 'TRAINING_RUN') && approved >= TRAINING_TRIGGER_THRESHOLD) {
          const trigger = await maybeTriggerTrainingRun(run.orgId, source.id, userId);
          if (trigger) {
            ctx.narrative.push(
              `Training threshold reached — dataset v${trigger.datasetVersion} built (${trigger.exampleCount} examples) and training run queued (§128 batching / §130 orchestrator).`
            );
            await db.intakeRun.update({ where: { id: runId }, data: { trainingJson: JSON.stringify(trigger) } });
          } else {
            ctx.narrative.push('Training batched: curated examples below build threshold — no run queued (§128).');
          }
        } else if (autonomyAllows(autonomy.level, 'TRAINING_RUN') && approved > 0) {
          ctx.narrative.push(`Training batched: ${approved}/${TRAINING_TRIGGER_THRESHOLD} new approved examples — waiting for batch threshold (§128: no retraining for every upload).`);
        }
      } else {
        ctx.narrative.push('Training-candidate generation skipped (autonomy < LEVEL 3).');
      }
    } else {
      ctx.narrative.push('Knowledge extraction skipped (autonomy LEVEL 1 — canonical import only).');
    }

    await pushEvent(ctx, 'IMPORTED', 'OK', `${knowledgeRecords} knowledge records · ${trainingCandidates} training candidates`, Date.now() - t);
    ctx.narrative.push('WEDJAT knowledge is now updated.');
    await db.intakeRun.update({
      where: { id: runId },
      data: {
        status: 'IMPORTED',
        finishedAt: new Date(),
        narrativeJson: JSON.stringify(ctx.narrative),
        errorsJson: JSON.stringify(ctx.errors),
        warningsJson: JSON.stringify(ctx.warnings),
      },
    });
    await db.sourceDatabase.update({ where: { id: source.id }, data: { status: 'IMPORTED', latestRunId: runId } });
    recordAuditSafe(run.orgId, userId, 'intake.imported', runId, 'INFO', { sourceId: source.id, knowledgeRecords, trainingCandidates }, traceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(ctx, `IMPORTED stage failed: ${msg}`, 'IMPORTED');
    return finalize(ctx, report, dq, 0, 0, mappings, 0, 0, 0);
  }

  const rows = discovered.reduce((n, d) => n + d.def.rowCount, 0);
  return finalize(ctx, report, dq, discovered.length, rows, mappings, knowledgeRecords, chunks, trainingCandidates);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function finalize(
  ctx: RunContext,
  report: ImportReport | null,
  dq: DqReport | null,
  tables: number,
  rows: number,
  mappings: TableMapping[],
  knowledgeRecords: number,
  chunks: number,
  trainingCandidates: number
): IntakeOutcome {
  const high = mappings.filter((m) => m.confidenceLabel === 'HIGH_CONFIDENCE').length;
  const medium = mappings.filter((m) => m.confidenceLabel === 'MEDIUM_CONFIDENCE').length;
  const low = mappings.filter((m) => m.confidenceLabel === 'LOW_CONFIDENCE').length;
  const unresolved = mappings.filter((m) => m.confidenceLabel === 'UNRESOLVED').length;
  void db.intakeRun
    .update({
      where: { id: ctx.runId },
      data: {
        narrativeJson: JSON.stringify(ctx.narrative),
        errorsJson: JSON.stringify(ctx.errors),
        warningsJson: JSON.stringify(ctx.warnings),
        finishedAt: new Date(),
      },
    })
    .catch(() => undefined);
  return {
    status: ctx.errors.length > 0 ? 'FAILED' : 'IMPORTED',
    narrative: ctx.narrative,
    importReport: report,
    dqReport: dq,
    tables,
    rows,
    mappings: { high, medium, low, unresolved },
    knowledgeRecords,
    chunks,
    trainingCandidates,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source';
}

function sha256Text(s: string): string {
  return sha256(s);
}
void sha256Text;

/** §110: one batched AI semantic-analysis call — advisory evidence only. */
async function aiSemanticAssist(
  platform: string,
  tables: DiscoveredTable[],
  ctx: RunContext
): Promise<{ table: string; entity: string; rationale?: string }[]> {
  try {
    const listing = tables
      .slice(0, 25)
      .map((t) => `${t.def.name} (${t.purpose}; columns: ${t.def.columns.slice(0, 8).map((c) => c.name).join(', ')})`)
      .join('\n');
    const entities = 'Party, Transaction, Agreement, Payment, Product, Inventory, Employee, Document, Configuration, AuditLog, ReferenceData, Workflow';
    const trace = newTraceId();
    const exec = await routeAndComplete(
      {
        taskType: 'classification',
        contextChars: listing.length + 400,
        orgPolicy: 'APPROVED_REMOTE_PROVIDER',
        classifications: ['CONFIDENTIAL'],
        userId: ctx.userId,
        traceId: trace,
      },
      {
        traceId: trace,
        maxOutputTokens: 900,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are a schema semantic classifier for the WEDJAT intake engine. Given tables from the "${platform}" platform database, classify each table into the best canonical entity. Respond ONLY with JSON: {"suggestions":[{"table":"<name>","entity":"<one of: ${entities}>","rationale":"<short reason>"}]}. Be conservative.`,
          },
          { role: 'user', content: `Tables:\n${listing}` },
        ],
      }
    );
    if (exec.degraded) {
      ctx.warnings.push('AI semantic assist skipped (inference gateway unavailable) — rule-based evidence only.');
      return [];
    }
    const match = /\{[\s\S]*\}/.exec(exec.result.text);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { suggestions?: { table: string; entity: string; rationale?: string }[] };
    const valid = new Set(entities.split(', ').map((s) => s.trim()));
    return (parsed.suggestions ?? []).filter((s) => s.table && valid.has(s.entity));
  } catch {
    ctx.warnings.push('AI semantic assist failed — rule-based evidence only (§110 fallback).');
    return [];
  }
}

async function persistKgEdges(
  orgId: string,
  runId: string,
  sourceId: string,
  edges: KgEdgeDraft[],
  snapshotId: string
): Promise<void> {
  if (edges.length === 0) return;
  const provenance = JSON.stringify({ sourceDatabaseId: sourceId, snapshotId, intakeRunId: runId });
  await db.knowledgeGraphEdge.createMany({
    data: edges.slice(0, 800).map((e) => ({
      orgId,
      intakeRunId: runId,
      subject: e.subject,
      predicate: e.predicate,
      object: e.object,
      classification: e.classification,
      evidence: e.evidence,
      provenanceJson: provenance,
    })),
  });
}

interface PeerContext {
  sourceId: string;
  platform: string;
  tables: DiscoveredTable[];
  mappings: TableMapping[];
}

async function loadPeerContexts(orgId: string, excludeSourceId: string): Promise<PeerContext[]> {
  const peers: PeerContext[] = [];
  const otherSources = await db.sourceDatabase.findMany({
    where: { orgId, id: { not: excludeSourceId }, status: 'IMPORTED' },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  for (const other of otherSources) {
    const snap = await db.schemaSnapshot.findFirst({ where: { sourceDatabaseId: other.id }, orderBy: { version: 'desc' } });
    if (!snap) continue;
    const snapshot = JSON.parse(snap.snapshotJson) as SchemaSnapshot;
    const discovery = discover(snapshot);
    const mappings = mapTablesToCanonical(discovery.tables, [], INTAKE_ENGINE_VERSION);
    peers.push({ sourceId: other.id, platform: other.platform, tables: discovery.tables, mappings });
  }
  return peers;
}

/**
 * §127–§130: build an INTAKE training dataset from approved candidates, then
 * queue an async training run. Batching is enforced by the caller threshold
 * (§128). Dataset + run creation reuses the governed lifecycle primitives.
 */
async function maybeTriggerTrainingRun(
  orgId: string,
  sourceDatabaseId: string,
  userId: string
): Promise<{ datasetId: string; datasetVersionId: string; datasetVersion: string; exampleCount: number; runId: string } | null> {
  const approved = await db.trainingCandidate.findMany({
    where: { orgId, sourceDatabaseId, status: 'TRAINING_APPROVED', trainingExampleId: null },
    take: 300,
  });
  if (approved.length === 0) return null;

  // §148 lineage: one INTAKE TrainingSource per candidate (refId = candidate id)
  for (const c of approved) {
    const existing = await db.trainingSource.findUnique({
      where: { orgId_kind_refId: { orgId, kind: 'INTAKE', refId: c.id } },
    });
    if (!existing) {
      await db.trainingSource.create({
        data: { orgId, kind: 'INTAKE', refId: c.id, status: 'ELIGIBLE', reason: 'intake-engine §127 auto-curation' },
      });
    }
  }

  const { createDataset } = await import('../training/lifecycle');
  const date = new Date().toISOString().slice(0, 10);
  const ds = await createDataset(principalLike(orgId, userId), {
    name: `intake-${date}`,
    description: `Auto-curated from database intake sources (§129 versioned batches) — ${approved.length} approved candidates.`,
    includeKinds: ['INTAKE'],
  });

  // Queue the async training run (§130: training must be asynchronous).
  const run = await db.trainingRun.create({
    data: {
      datasetVersionId: ds.datasetVersionId,
      method: 'SIMULATED',
      status: 'QUEUED',
      currentStep: 'queued',
      stepsJson: JSON.stringify(['validate', 'train', 'evaluate-gate', 'candidate', 'canary', 'production']),
      notes: 'auto-triggered by intake engine (§128 threshold reached) — training is SIMULATED in this environment; promotion remains human-controlled (§152)',
    },
  });
  await enqueueJob({ kind: 'training-run-step', orgId, userId, runId: run.id });

  return {
    datasetId: ds.datasetId,
    datasetVersionId: ds.datasetVersionId,
    datasetVersion: ds.excluded >= 0 ? `${ds.exampleCount}` : '1.0',
    exampleCount: ds.exampleCount,
    runId: run.id,
  };
}
