// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Event fabric DISPATCH (§13-§17, §56-§60, §61-§62, §98-§107).
//
// Every event ADDS knowledge (§56: events never replace knowledge). Handlers
// route validated events into the EXISTING pipelines:
//   • knowledge-bearing events → runIngestion (the full DISCOVER→…→LEARN chain
//     from §14: chunk, embed, index, knowledge records, KG edges, candidates);
//   • incidents → FailureMemory + knowledge document;
//   • corrections → knowledge + KnowledgeLineage + improvement signal;
//   • outcome events → RecommendationOutcome + closed-loop learning (§65);
//   • recommendation decisions → status history append (never rewrite);
//   • platform state → registry update (connection status only — §114/§115:
//     disconnection NEVER deletes learned knowledge).
//
// Failures are classified (§105) and bounded; exhausted events go to the DLQ
// (§60: never silently discarded). Replay (§57) re-derives WITHOUT deleting.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { logger } from '../logger';
import { recordAudit } from '../observability/audit';
import { runIngestion } from '../knowledge/ingestion';
import { applyRecommendationOutcome } from '../recommendations/engine';
import { appendRecommendationStatus } from '../recommendations/engine';

const MAX_ATTEMPTS = 3;

export interface DispatchOutcome {
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED';
  summary: Record<string, unknown>;
  error?: string;
}

// §105 error classification.
export function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (/timeout|econn|network|temporarily|fetch failed|socket hang up/.test(m)) return 'TRANSIENT';
  if (/rate limit|429/.test(m)) return 'RATE_LIMIT';
  if (/unauthorized|401|invalid key|forbidden|403/.test(m)) return 'AUTH_ERROR';
  if (/validation|invalid|malformed|parse/.test(m)) return 'DATA_ERROR';
  if (/secret|injection|policy/.test(m)) return 'SECURITY_ERROR';
  return 'SYSTEM_ERROR';
}

interface EventRow {
  id: string;
  orgId: string;
  eventId: string;
  eventType: string;
  sourcePlatform: string;
  sourceVersion: string | null;
  sourceCommit: string | null;
  payloadJson: string;
  idempotencyKey: string;
}

// ── doc-type mapping: event family → blueprint/doc classification ───────────
function blueprintTypeFor(eventType: string): string {
  if (eventType.startsWith('blueprint.')) return 'BLUEPRINT';
  if (eventType.startsWith('schema.')) return 'DATABASE_SPEC';
  if (eventType.startsWith('incident.')) return 'INCIDENT';
  if (eventType.startsWith('audit.')) return 'AUDIT';
  if (eventType.startsWith('integration.')) return 'INTEGRATION';
  if (eventType.startsWith('component.')) return 'COMPONENT';
  if (eventType.startsWith('ai.answer')) return 'FEEDBACK';
  if (eventType.startsWith('training.')) return 'TRAINING_EXAMPLE';
  if (eventType.startsWith('model.')) return 'MODEL_EVENT';
  return 'EVENT_KNOWLEDGE';
}

function docTypeFor(eventType: string): string {
  const map: Record<string, string> = {
    'blueprint.created': 'BLUEPRINT', 'blueprint.updated': 'BLUEPRINT', 'blueprint.deprecated': 'BLUEPRINT',
    'schema.created': 'DATABASE_SPEC', 'schema.changed': 'DATABASE_SPEC', 'schema.migrated': 'DATABASE_SPEC',
    'incident.created': 'INCIDENT', 'incident.resolved': 'INCIDENT',
    'audit.created': 'AUDIT', 'audit.resolved': 'AUDIT',
    'component.created': 'COMPONENT', 'component.changed': 'COMPONENT',
    'integration.created': 'INTEGRATION', 'integration.failed': 'INTEGRATION', 'integration.recovered': 'INTEGRATION',
    'ai.answer.created': 'ANSWER', 'ai.answer.corrected': 'CORRECTION',
    'training.example.created': 'TRAINING_EXAMPLE',
    'model.candidate.created': 'MODEL_EVENT', 'model.promoted': 'MODEL_EVENT', 'model.rollback': 'MODEL_EVENT',
    'knowledge.published': 'EVENT_KNOWLEDGE', 'platform.deployed': 'DEPLOYMENT', 'platform.released': 'DEPLOYMENT',
  };
  return map[eventType] ?? 'EVENT_KNOWLEDGE';
}

function titleFor(eventType: string, payload: Record<string, unknown>): string {
  const t = (typeof payload.title === 'string' && payload.title.trim() !== '') ? payload.title.trim() : null;
  if (t) return t.slice(0, 160);
  const name = (typeof payload.name === 'string' && payload.name.trim() !== '') ? payload.name.trim() : null;
  if (name) return `${eventType} — ${name}`.slice(0, 160);
  return `${eventType} (${new Date().toISOString().slice(0, 16)})`;
}

/** Formats an event payload into a knowledge document (markdown). */
function payloadToContent(eventType: string, payload: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# ${titleFor(eventType, payload)}`);
  lines.push('');
  lines.push(`- Event type: ${eventType}`);
  if (typeof payload.description === 'string' && payload.description.trim() !== '') {
    lines.push('');
    lines.push('## Description');
    lines.push(payload.description.trim());
  }
  if (typeof payload.content === 'string' && payload.content.trim() !== '') {
    lines.push('');
    lines.push('## Content');
    lines.push(payload.content.trim());
  }
  const skip = new Set(['title', 'name', 'description', 'content']);
  const extra = Object.entries(payload).filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined);
  if (extra.length > 0) {
    lines.push('');
    lines.push('## Fields');
    for (const [k, v] of extra) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      lines.push(`- **${k}**: ${String(val).slice(0, 500)}`);
    }
  }
  lines.push('');
  lines.push('_Source: WEDJAT Intelligence API event (v4 §56)._');
  return lines.join('\n');
}

// ── Individual handlers ──────────────────────────────────────────────────────

async function handleKnowledgeEvent(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  const platform = await db.platform.findFirst({ where: { orgId: ev.orgId, slug: ev.sourcePlatform } });
  if (!platform) {
    return { skipped: `platform '${ev.sourcePlatform}' not registered — connect it first (§88 registry)` };
  }
  const blueprintSlug = `fabric-${ev.eventType.replace(/\./g, '-')}-${ev.sourcePlatform}`;
  const result = await runIngestion({
    orgId: ev.orgId,
    platformSlug: ev.sourcePlatform,
    blueprintSlug,
    blueprintTitle: `${docTypeFor(ev.eventType)} — ${ev.sourcePlatform}`,
    blueprintType: blueprintTypeFor(ev.eventType),
    blueprintVersion: ev.sourceVersion ?? undefined,
    title: titleFor(ev.eventType, payload),
    docType: docTypeFor(ev.eventType),
    classification: 'INTERNAL',
    content: payloadToContent(ev.eventType, payload),
    documentVersion: ev.sourceVersion ?? '1',
    sourcePath: `event:${ev.eventId}`,
    actorId: 'wedjat-fabric',
    idempotencyKey: `fabric-${ev.idempotencyKey}`,
  });
  return { documentVersionId: result.documentVersionId, duplicate: result.duplicate };
}

async function handleIncident(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  const description = typeof payload.description === 'string' ? payload.description : JSON.stringify(payload).slice(0, 800);
  const resolved = ev.eventType === 'incident.resolved' || payload.resolved === true;
  // §38: failures become knowledge — FailureMemory entry (never deleted).
  await db.failureMemory.create({
    data: {
      orgId: ev.orgId,
      question: typeof payload.title === 'string' ? payload.title : `Incident on ${ev.sourcePlatform}`,
      failureType: 'ONGOING',
      // Platform recorded in the reason so §38 failure-pattern mining can
      // attribute repeated failures to the right platform.
      reason: `[platform: ${ev.sourcePlatform}] ${description}`.slice(0, 1000),
      resolution: resolved ? (typeof payload.resolution === 'string' ? payload.resolution.slice(0, 1000) : 'reported resolved') : null,
      source: `event:${ev.eventId}`,
    },
  });
  const ingest = await handleKnowledgeEvent(ev);
  return { failureMemory: true, ...ingest };
}

async function handleCorrection(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  // §8: corrections are ADDITIONS. New knowledge doc + lineage link to the
  // previous statement (topicKey match) + improvement signal.
  const ingest = await handleKnowledgeEvent(ev);
  const correctedStatement = typeof payload.previous === 'string' ? payload.previous : null;
  if (correctedStatement) {
    const prior = await db.knowledgeRecord.findFirst({
      where: { statement: { contains: correctedStatement.slice(0, 120) } },
      orderBy: { createdAt: 'desc' },
    });
    const correctedText = typeof payload.corrected === 'string' ? payload.corrected.slice(0, 120) : (typeof payload.title === 'string' ? payload.title.slice(0, 120) : '');
    const newest = await db.knowledgeRecord.findFirst({
      where: { statement: { contains: correctedText } },
      orderBy: { createdAt: 'desc' },
    });
    if (prior && newest && prior.id !== newest.id) {
      await db.knowledgeLineage.create({
        data: {
          orgId: ev.orgId,
          fromRecordId: prior.id,
          toRecordId: newest.id,
          relation: 'CORRECTS',
          whatWasWrong: correctedStatement.slice(0, 500),
          whyWrong: typeof payload.reason === 'string' ? payload.reason.slice(0, 500) : 'corrected by platform event',
          correctedBy: `event:${ev.eventId}`,
        },
      });
      await db.knowledgeRecord.update({ where: { id: prior.id }, data: { status: 'CORRECTED' } }).catch(() => {});
    }
  }
  await db.improvementQueueItem.create({
    data: {
      orgId: ev.orgId,
      kind: 'CORRECTION',
      description: `Platform correction reported via event ${ev.eventId} on ${ev.sourcePlatform}`,
      evidenceJson: ev.payloadJson.slice(0, 4000),
      priority: 'P1',
      proposedAction: 'Review the correction, verify the source, and refresh affected knowledge (v4 §8).',
    },
  });
  return { correction: true, ...ingest };
}

async function handlePlatformState(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  // §114/§115: registry status change ONLY — knowledge is never deleted.
  const connectionStatus =
    payload.connected === false ? 'DISCONNECTED' :
    payload.retired === true ? 'RETIRED' :
    'CONNECTED';
  await db.platform.updateMany({
    where: { orgId: ev.orgId, slug: ev.sourcePlatform },
    data: { connectionStatus },
  });
  const ingest = await handleKnowledgeEvent(ev);
  return { connectionStatus, ...ingest };
}

async function handleRecommendationDecision(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  const recId = typeof payload.recommendationId === 'string' ? payload.recommendationId : null;
  if (!recId) return { skipped: 'no recommendationId in payload' };
  const status = ev.eventType === 'recommendation.accepted' ? 'ACCEPTED' : 'REJECTED';
  const updated = await appendRecommendationStatus(ev.orgId, recId, status, ev.sourcePlatform, `event ${ev.eventId}`);
  return { recommendation: updated.id, status };
}

async function handleOutcome(ev: EventRow): Promise<Record<string, unknown>> {
  const payload = JSON.parse(ev.payloadJson) as Record<string, unknown>;
  const recId = typeof payload.recommendationId === 'string' ? payload.recommendationId : null;
  if (recId) {
    const result = await applyRecommendationOutcome({
      orgId: ev.orgId,
      recommendationId: recId,
      outcome: typeof payload.outcome === 'string' ? payload.outcome : 'IMPLEMENTED',
      metricName: typeof payload.metricName === 'string' ? payload.metricName : undefined,
      beforeValue: typeof payload.beforeValue === 'string' ? payload.beforeValue : String(payload.before ?? ''),
      afterValue: typeof payload.afterValue === 'string' ? payload.afterValue : String(payload.after ?? ''),
      notes: typeof payload.notes === 'string' ? payload.notes : `reported via event ${ev.eventId}`,
      reportedBy: ev.sourcePlatform,
      commitRef: ev.sourceCommit ?? undefined,
    });
    return { outcomeRecorded: true, learning: result.learning };
  }
  // Outcome without a recommendation reference still becomes knowledge (§44).
  return handleKnowledgeEvent(ev);
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

async function dispatchOnce(ev: EventRow): Promise<Record<string, unknown>> {
  const t = ev.eventType;
  if (t.startsWith('incident.')) return handleIncident(ev);
  if (t === 'ai.answer.corrected') return handleCorrection(ev);
  if (t === 'feedback.submitted') return handleCorrection(ev); // feedback signal path
  if (t === 'outcome.reported') return handleOutcome(ev);
  if (t === 'recommendation.accepted' || t === 'recommendation.rejected') return handleRecommendationDecision(ev);
  if (t === 'platform.updated' || t === 'platform.created') return handlePlatformState(ev);
  return handleKnowledgeEvent(ev);
}

/**
 * Dispatch one event with bounded retries and DLQ routing. Event history is
 * immutable — only status/attempts/result fields are maintained.
 */
export async function dispatchEvent(eventRecordId: string): Promise<DispatchOutcome> {
  const ev = await db.eventRecord.findUnique({ where: { id: eventRecordId } });
  if (!ev) return { status: 'SKIPPED', summary: { reason: 'event record not found' } };
  if (ev.status === 'PROCESSED') return { status: 'SKIPPED', summary: { reason: 'already processed' } };

  const attempts = ev.attempts + 1;
  try {
    const summary = await dispatchOnce(ev as EventRow);
    await db.eventRecord.update({
      where: { id: ev.id },
      data: { status: 'PROCESSED', processedAt: new Date(), attempts, resultJson: JSON.stringify(summary), processingError: null },
    });
    await recordAudit({
      orgId: ev.orgId,
      actorType: 'system',
      actorId: 'wedjat-fabric',
      action: 'event.processed',
      targetType: 'EventRecord',
      targetId: ev.id,
      severity: ev.criticality === 'CRITICAL' ? 'WARN' : 'INFO',
      detailsJson: JSON.stringify({ eventType: ev.eventType, platform: ev.sourcePlatform }),
    });
    logger.info('event_processed', { eventId: ev.eventId, eventType: ev.eventType, attempts });
    return { status: 'PROCESSED', summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = classifyError(message);
    const dead = attempts >= MAX_ATTEMPTS;
    await db.eventRecord.update({
      where: { id: ev.id },
      data: {
        status: dead ? 'DEAD' : 'FAILED',
        attempts,
        processingError: `${errorClass}: ${message.slice(0, 400)}`,
        processedAt: dead ? new Date() : null,
      },
    });
    if (dead) {
      // §60: dead events are NEVER silently discarded.
      await db.deadLetterEvent.create({
        data: {
          orgId: ev.orgId,
          eventRecordId: ev.id,
          errorClass,
          reason: message.slice(0, 500),
          attempts,
          payloadSnapshotJson: ev.payloadJson.slice(0, 20_000),
        },
      });
      await recordAudit({
        orgId: ev.orgId, actorType: 'system', actorId: 'wedjat-fabric', action: 'event.dead_lettered',
        targetType: 'EventRecord', targetId: ev.id, severity: 'ERROR',
        detailsJson: JSON.stringify({ eventType: ev.eventType, errorClass }),
      });
      logger.error('event_dead_lettered', { eventId: ev.eventId, eventType: ev.eventType, errorClass });
    } else {
      logger.warn('event_dispatch_failed', { eventId: ev.eventId, attempts, error: message });
    }
    return { status: 'FAILED', summary: {}, error: `${errorClass}: ${message}` };
  }
}

/**
 * §57 EVENT REPLAY: re-derive state from a stored event WITHOUT deleting
 * anything. A replayed event re-runs its handler (ingestion is idempotent via
 * content hash — §58 — so duplicates are returned, not duplicated), and the
 * original record is preserved untouched.
 */
export async function replayEvent(eventRecordId: string, userId: string): Promise<{ replayed: boolean; note: string }> {
  const ev = await db.eventRecord.findUnique({ where: { id: eventRecordId } });
  if (!ev) throw new Error('event record not found');
  if (ev.status === 'RECEIVED' || ev.status === 'FAILED' || ev.status === 'DEAD') {
    // Not yet successfully processed: just dispatch it (bounded retries fresh).
    await db.eventRecord.update({ where: { id: ev.id }, data: { attempts: 0, status: 'RECEIVED', processingError: null } });
    await dispatchEvent(ev.id);
    await db.deadLetterEvent.updateMany({
      where: { eventRecordId: ev.id, resolved: false },
      data: { resolved: true, resolvedById: userId, resolutionNote: 'replayed', resolvedAt: new Date() },
    });
    return { replayed: true, note: 'dispatched (first successful pass)' };
  }
  // Already PROCESSED: re-run in replay mode — result is APPENDED to the
  // original record's resultJson trail; history stays intact.
  const outcome = await dispatchOnce(ev as EventRow);
  const trail = (() => {
    try { return JSON.parse(ev.resultJson ?? '[]') as unknown[]; } catch { return []; }
  })();
  const merged = Array.isArray(trail) ? trail : [trail];
  merged.push({ replay: true, at: new Date().toISOString(), summary: outcome, by: userId });
  await db.eventRecord.update({
    where: { id: ev.id },
    data: { resultJson: JSON.stringify(merged.length === 1 ? merged[0] : merged) },
  });
  await recordAudit({
    orgId: ev.orgId, actorType: 'user', actorId: userId, action: 'event.replayed',
    targetType: 'EventRecord', targetId: ev.id, severity: 'INFO',
  });
  return { replayed: true, note: 're-derived (idempotent); original history preserved (§57)' };
}
