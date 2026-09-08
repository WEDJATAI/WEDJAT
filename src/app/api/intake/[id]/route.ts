// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — GET /api/intake/[id] — full intake detail (§153/§160):
// snapshot, runs + stage events, mappings w/ evidence, validation + DQ reports,
// preserved fields, KG edges, training candidates, drift, duplicates, narrative.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { WedjatError } from '@/lib/wedjat/errors';
import {
  parseDqReport,
  parseImportReport,
  toCandidateDto,
  toKgEdgeDto,
  toMappingDto,
  toRunDto,
  toSnapshotDto,
  toSourceDto,
  toDuplicateDto,
} from '@/lib/wedjat/intake/dto';
import type { IntakeDetailPayload, IntakeDriftReportDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const { id } = await params;
      const source = await db.sourceDatabase.findFirst({
        where: { id, orgId: principal.org.id },
      });
      if (!source) throw new WedjatError('NOT_FOUND', 'Source database not found');

      const runs = await db.intakeRun.findMany({
        where: { sourceDatabaseId: source.id },
        orderBy: { createdAt: 'desc' },
      });
      const latestRun = runs[0] ?? null;
      const latestSnapshot = source.latestRunId
        ? (runs.find((r) => r.id === source.latestRunId)?.snapshotId ?? null)
        : null;
      const snapshotRow =
        (latestSnapshot
          ? await db.schemaSnapshot.findUnique({ where: { id: latestSnapshot } })
          : null) ??
        (await db.schemaSnapshot.findFirst({
          where: { sourceDatabaseId: source.id },
          orderBy: { version: 'desc' },
        }));

      const mappings = latestRun
        ? await db.canonicalMapping.findMany({
            where: { intakeRunId: latestRun.id },
            orderBy: { confidence: 'desc' },
          })
        : [];
      const mappingByTable = new Map(mappings.map((m) => [m.sourceTable.toLowerCase(), m]));

      const snapshotDto = snapshotRow ? toSnapshotDto(snapshotRow, true) : null;
      if (snapshotDto) {
        // attach canonical entities to snapshot tables (§111 view)
        for (const t of snapshotDto.tables) {
          t.canonicalEntity = mappingByTable.get(t.name.toLowerCase())?.canonicalEntity ?? null;
        }
      }

      const runIds = runs.map((r) => r.id);
      const preserved = await db.preservedField.findMany({
        where: { sourceDatabaseId: source.id },
        take: 500,
      });
      const kgEdges = runIds.length
        ? await db.knowledgeGraphEdge.findMany({
            where: { intakeRunId: { in: runIds } },
            orderBy: { createdAt: 'desc' },
            take: 400,
          })
        : [];
      const candidates = await db.trainingCandidate.findMany({
        where: { sourceDatabaseId: source.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const driftRow = await db.driftReport.findFirst({
        where: { sourceDatabaseId: source.id },
        orderBy: { createdAt: 'desc' },
      });
      const duplicates = runIds.length
        ? await db.duplicateMarker.findMany({
            where: { intakeRunId: { in: runIds } },
            orderBy: { createdAt: 'desc' },
            take: 100,
          })
        : [];

      const drift: IntakeDriftReportDto | null = driftRow
        ? {
            changes: JSON.parse(driftRow.changesJson || '[]') as IntakeDriftReportDto['changes'],
            summary: driftRow.summary,
            fromVersion: '',
            toVersion: '',
            createdAt: driftRow.createdAt.toISOString(),
          }
        : null;
      if (drift && latestRun?.driftJson) {
        const dj = JSON.parse(latestRun.driftJson) as { fromVersion?: string; toVersion?: string };
        drift.fromVersion = dj.fromVersion ?? '';
        drift.toVersion = dj.toVersion ?? '';
      }

      const narrative: string[] = latestRun?.narrativeJson
        ? (JSON.parse(latestRun.narrativeJson) as string[])
        : [];

      const payload: IntakeDetailPayload = {
        source: toSourceDto(source, latestRun),
        snapshot: snapshotDto ?? {
          id: 'none',
          version: 0,
          engine: source.engine,
          detection: { method: 'pending', confidence: 0, detail: 'Snapshot not created yet.' },
          tablesCount: 0,
          columnsCount: 0,
          fksCount: 0,
          indexesCount: 0,
          viewsCount: 0,
          createdAt: source.createdAt.toISOString(),
          tables: [],
        },
        runs: runs.map(toRunDto),
        mappings: mappings.map(toMappingDto),
        preserved: preserved.map((p) => ({
          tableName: p.tableName,
          columnName: p.columnName,
          columnType: p.columnType,
          reason: p.reason,
        })),
        kgEdges: kgEdges.map(toKgEdgeDto),
        candidates: candidates.map(toCandidateDto),
        drift,
        duplicates: duplicates.map(toDuplicateDto),
        narrative,
        importReport: latestRun ? parseImportReport(latestRun) : null,
        dqReport: latestRun ? parseDqReport(latestRun) : null,
      };
      return ok(payload);
    } catch (err) {
      return failFrom(err);
    }
  });
}
