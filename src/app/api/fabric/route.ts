// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — GET /api/fabric — Event-fabric console payload (§13-§18, §60).
// Events (append-only log), dead letters, stats + API-console examples.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import type { EventEnvelopeDto, DeadLetterDto, EventFabricPayload } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

function toEventDto(r: {
  id: string; eventId: string; eventType: string; sourcePlatform: string; sourceEnvironment: string;
  sourceVersion: string | null; sourceCommit: string | null; occurredAt: Date; receivedAt: Date;
  correlationId: string | null; causationId: string | null; schemaVersion: string;
  idempotencyKey: string; criticality: string; status: string; processingError: string | null;
  attempts: number; processedAt: Date | null; resultJson: string | null; replayOfId: string | null;
}): EventEnvelopeDto {
  let resultSummary: Record<string, unknown> | null = null;
  if (r.resultJson) {
    try {
      const parsed = JSON.parse(r.resultJson);
      resultSummary = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch { /* non-JSON trail — leave null */ }
  }
  return {
    eventId: r.eventId,
    eventType: r.eventType,
    sourcePlatform: r.sourcePlatform,
    sourceEnvironment: r.sourceEnvironment,
    sourceVersion: r.sourceVersion,
    sourceCommit: r.sourceCommit,
    occurredAt: r.occurredAt.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
    correlationId: r.correlationId,
    causationId: r.causationId,
    schemaVersion: r.schemaVersion,
    idempotencyKey: r.idempotencyKey,
    criticality: r.criticality as EventEnvelopeDto['criticality'],
    status: r.status as EventEnvelopeDto['status'],
    processingError: r.processingError,
    attempts: r.attempts,
    processedAt: r.processedAt?.toISOString() ?? null,
    resultSummary,
    replayOfId: r.replayOfId,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const url = new URL(req.url);
      const platform = url.searchParams.get('platform');
      const type = url.searchParams.get('type');
      const status = url.searchParams.get('status');
      const deadOnly = url.searchParams.get('deadletter') === '1';

      const where = {
        orgId: principal.org.id,
        ...(platform ? { sourcePlatform: platform } : {}),
        ...(type ? { eventType: type } : {}),
        ...(status ? { status } : {}),
        ...(deadOnly ? { status: 'DEAD' } : {}),
      };
      const [rows, deadRows, total, processed, received, failed, dead, byType, byPlatform] = await Promise.all([
        db.eventRecord.findMany({ where, orderBy: { receivedAt: 'desc' }, take: 100 }),
        db.deadLetterEvent.findMany({
          where: { orgId: principal.org.id, ...(deadOnly ? {} : { resolved: false }) },
          orderBy: { lastAttemptAt: 'desc' },
          take: 50,
          include: { eventRecord: true },
        }),
        db.eventRecord.count({ where: { orgId: principal.org.id } }),
        db.eventRecord.count({ where: { orgId: principal.org.id, status: 'PROCESSED' } }),
        db.eventRecord.count({ where: { orgId: principal.org.id, status: 'RECEIVED' } }),
        db.eventRecord.count({ where: { orgId: principal.org.id, status: 'FAILED' } }),
        db.eventRecord.count({ where: { orgId: principal.org.id, status: 'DEAD' } }),
        db.eventRecord.groupBy({ by: ['eventType'], where: { orgId: principal.org.id }, _count: { _all: true }, orderBy: { eventType: 'asc' }, take: 40 }),
        db.eventRecord.groupBy({ by: ['sourcePlatform'], where: { orgId: principal.org.id }, _count: { _all: true }, orderBy: { sourcePlatform: 'asc' }, take: 40 }),
      ]);

      const deadLetters: DeadLetterDto[] = deadRows.map((d) => ({
        id: d.id,
        eventRecordId: d.eventRecordId,
        eventType: d.eventRecord?.eventType ?? '(record missing)',
        sourcePlatform: d.eventRecord?.sourcePlatform ?? 'unknown',
        errorClass: d.errorClass,
        reason: d.reason,
        attempts: d.attempts,
        firstFailedAt: d.firstFailedAt.toISOString(),
        lastAttemptAt: d.lastAttemptAt.toISOString(),
        resolved: d.resolved,
        resolutionNote: d.resolutionNote,
      }));

      const payload: EventFabricPayload & { apiExamples?: unknown[] } = {
        events: rows.map(toEventDto),
        deadLetters,
        stats: {
          total,
          processed,
          received,
          failed,
          dead,
          byType: byType.map((t) => ({ eventType: t.eventType, count: t._count._all })).sort((a, b) => b.count - a.count),
          byPlatform: byPlatform.map((p) => ({ platform: p.sourcePlatform, count: p._count._all })).sort((a, b) => b.count - a.count),
        },
        // API-console reference (§7/§10) — served here so the console tab needs
        // no extra round-trip. Static, non-secret documentation only.
        apiExamples: [
          { title: 'Publish an event', method: 'POST', path: '/api/v1/events', scope: 'events:write', description: 'Append a knowledge-bearing event to the fabric (idempotent).' },
          { title: 'Publish knowledge', method: 'POST', path: '/api/v1/knowledge', scope: 'knowledge:write', description: 'Publish a validated document; it flows through the full ingestion pipeline.' },
          { title: 'Publish schema snapshot', method: 'POST', path: '/api/v1/schemas', scope: 'schema:write', description: 'Publish table/column metadata for canonical mapping (§34).' },
          { title: 'Submit feedback', method: 'POST', path: '/api/v1/feedback', scope: 'feedback:write', description: 'Report a correction or validation for an answer (§8).' },
          { title: 'Submit learning candidate', method: 'POST', path: '/api/v1/learning-candidates', scope: 'training:candidate', description: 'Submit a validated solution as training material (§44).' },
          { title: 'Report incident', method: 'POST', path: '/api/v1/incidents', scope: 'events:write', description: 'Report an incident — becomes failure memory + knowledge (§38).' },
          { title: 'Report outcome', method: 'POST', path: '/api/v1/outcomes', scope: 'events:write', description: 'Report a measured recommendation outcome (§66).' },
          { title: 'Read knowledge', method: 'GET', path: '/api/v1/knowledge', scope: 'knowledge:read', description: 'Query knowledge with platform + text filters.' },
          { title: 'Platform insights', method: 'GET', path: '/api/v1/platforms/{slug}/insights', scope: 'analysis:read', description: 'CTO-style platform summary grounded in current knowledge.' },
          { title: 'Platform recommendations', method: 'GET', path: '/api/v1/platforms/{slug}/recommendations', scope: 'recommendations:read', description: 'Open recommendations for a platform (§114).' },
          { title: 'Ask WEDJAT', method: 'POST', path: '/api/v1/query', scope: 'analysis:read', description: 'Grounded Q&A over organizational knowledge (§26).' },
          { title: 'Analyze platform', method: 'POST', path: '/api/v1/analyze', scope: 'analysis:read', description: 'Resilience/risk/security analysis for a platform (§76).' },
          { title: 'Health', method: 'GET', path: '/api/v1/health', scope: 'public', description: 'Liveness/readiness summary (§106).' },
        ],
      };
      return ok(payload);
    } catch (err) {
      return failFrom(err);
    }
  });
}
