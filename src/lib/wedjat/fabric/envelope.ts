// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Event fabric: envelope validation + idempotent append (§13-§18,
// §56-§58).
//
// Events ADD knowledge — they never replace it. Repeated delivery is deduplicated
// via the unique idempotency key (§58) and the unique eventId. Payloads are
// size-bounded, secret-scanned (§41: detected secrets are redacted, the event is
// quarantined) and injection-neutralized before storage.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { WedjatError } from '../errors';
import { contentHash } from '../ids';
import { logger } from '../logger';
import { redactSecrets } from '../security/redact';

// ── Known event types (§13). Unknown types are still accepted but SKIPPED by
// dispatch — never dropped (zero event loss).
export const KNOWN_EVENT_TYPES = new Set([
  'platform.created', 'platform.updated', 'platform.deployed', 'platform.released',
  'blueprint.created', 'blueprint.updated', 'blueprint.deprecated',
  'schema.created', 'schema.changed', 'schema.migrated',
  'component.created', 'component.changed',
  'integration.created', 'integration.failed', 'integration.recovered',
  'incident.created', 'incident.resolved',
  'audit.created', 'audit.resolved',
  'recommendation.created', 'recommendation.accepted', 'recommendation.rejected',
  'ai.answer.created', 'ai.answer.corrected',
  'training.example.created', 'training.dataset.created',
  'model.candidate.created', 'model.promoted', 'model.rollback',
  'knowledge.published', 'feedback.submitted', 'outcome.reported',
] as string[]);

const CRITICAL_TYPES = new Set(['incident.created', 'integration.failed', 'model.rollback']);
const HIGH_TYPES = new Set([
  'schema.changed', 'schema.migrated', 'platform.deployed', 'recommendation.accepted',
  'recommendation.rejected', 'ai.answer.corrected', 'outcome.reported', 'audit.created',
]);

const MAX_PAYLOAD_CHARS = 200_000;
const MAX_EVENT_TYPE_LEN = 80;

export interface RawEventInput {
  eventId?: unknown;
  eventType?: unknown;
  sourcePlatform?: unknown;
  sourceEnvironment?: unknown;
  sourceVersion?: unknown;
  sourceCommit?: unknown;
  occurredAt?: unknown;
  correlationId?: unknown;
  causationId?: unknown;
  schemaVersion?: unknown;
  idempotencyKey?: unknown;
  criticality?: unknown;
  payload?: unknown;
}

export interface NormalizedEvent {
  eventId: string;
  eventType: string;
  sourcePlatform: string;
  sourceEnvironment: string;
  sourceVersion: string | null;
  sourceCommit: string | null;
  occurredAt: Date;
  correlationId: string | null;
  causationId: string | null;
  schemaVersion: string;
  idempotencyKey: string;
  criticality: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  payloadJson: string;
  payload: Record<string, unknown>;
  /** Set when secret material was detected and redacted (§41 quarantine note). */
  secretsRedacted: number;
}

function classifyCriticality(eventType: string, provided?: unknown): 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' {
  if (provided === 'CRITICAL' || provided === 'HIGH' || provided === 'NORMAL' || provided === 'LOW') return provided;
  if (CRITICAL_TYPES.has(eventType)) return 'CRITICAL';
  if (HIGH_TYPES.has(eventType)) return 'HIGH';
  return 'NORMAL';
}

function parseDate(v: unknown, field: string): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new WedjatError('VALIDATION', `field '${field}' must be a valid date`);
}

/**
 * Validates and normalizes an event envelope. Throws typed VALIDATION errors.
 * Secrets found in the payload are REDACTED in place and counted (§41).
 */
export function validateEnvelope(input: RawEventInput, platform: string): NormalizedEvent {
  const eventType = typeof input.eventType === 'string' ? input.eventType.trim() : '';
  if (!eventType || eventType.length > MAX_EVENT_TYPE_LEN || !/^[a-z][a-z0-9._-]*$/i.test(eventType)) {
    throw new WedjatError('VALIDATION', "field 'eventType' must be dotted lowercase (e.g. 'schema.changed')");
  }
  // Ownership: the envelope platform must match the authenticated platform.
  const sourcePlatform = typeof input.sourcePlatform === 'string' && input.sourcePlatform.trim() !== ''
    ? input.sourcePlatform.trim().toLowerCase()
    : platform;
  if (sourcePlatform !== platform) {
    throw new WedjatError('FORBIDDEN', `event sourcePlatform '${sourcePlatform}' does not match the authenticated platform '${platform}'`);
  }
  if (input.payload === undefined || input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new WedjatError('VALIDATION', "field 'payload' must be a JSON object");
  }

  const rawJson = JSON.stringify(input.payload);
  if (rawJson.length > MAX_PAYLOAD_CHARS) {
    throw new WedjatError('VALIDATION', `payload exceeds ${MAX_PAYLOAD_CHARS} characters (split large changes into multiple events)`);
  }

  // §41/§96: secret scan + redact BEFORE storage. Count = number of redactions.
  const { text: safeJson, count: secretsRedacted } = redactSecrets(rawJson);
  const payload = JSON.parse(safeJson) as Record<string, unknown>;

  const eventId = typeof input.eventId === 'string' && input.eventId.trim() !== ''
    ? input.eventId.trim().slice(0, 120)
    : `evt_${contentHash(`${platform}|${eventType}|${rawJson}`).slice(0, 24)}`;
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim() !== ''
    ? input.idempotencyKey.trim().slice(0, 160)
    : `idem_${contentHash(`${eventId}|${sourcePlatform}|${eventType}`)}`;

  if (secretsRedacted > 0) {
    logger.warn('event_secret_redacted', { eventType, sourcePlatform, count: secretsRedacted });
  }

  return {
    eventId,
    eventType,
    sourcePlatform,
    sourceEnvironment: typeof input.sourceEnvironment === 'string' ? input.sourceEnvironment.slice(0, 40) : 'production',
    sourceVersion: typeof input.sourceVersion === 'string' ? input.sourceVersion.slice(0, 80) : null,
    sourceCommit: typeof input.sourceCommit === 'string' ? input.sourceCommit.slice(0, 80) : null,
    occurredAt: input.occurredAt !== undefined ? parseDate(input.occurredAt, 'occurredAt') : new Date(),
    correlationId: typeof input.correlationId === 'string' ? input.correlationId.slice(0, 120) : null,
    causationId: typeof input.causationId === 'string' ? input.causationId.slice(0, 120) : null,
    schemaVersion: typeof input.schemaVersion === 'string' ? input.schemaVersion.slice(0, 20) : '1',
    idempotencyKey,
    criticality: classifyCriticality(eventType, input.criticality),
    payloadJson: safeJson,
    payload,
    secretsRedacted,
  };
}

export interface AppendResult {
  eventRecordId: string;
  duplicate: boolean;
  skipped: 'UNKNOWN_TYPE' | null;
}

/**
 * Idempotent append (§58): unique constraints on idempotencyKey and eventId make
 * repeated delivery a no-op that returns the original record. This store is
 * APPEND-ONLY — no event row is ever mutated by ingestion.
 */
export async function appendEvent(
  orgId: string,
  ev: NormalizedEvent,
  identityId: string | null
): Promise<AppendResult> {
  const existing = await db.eventRecord.findFirst({
    where: { OR: [{ idempotencyKey: ev.idempotencyKey }, { eventId: ev.eventId }] },
  });
  if (existing) {
    return { eventRecordId: existing.id, duplicate: true, skipped: null };
  }
  const row = await db.eventRecord.create({
    data: {
      orgId,
      eventId: ev.eventId,
      eventType: ev.eventType,
      sourcePlatform: ev.sourcePlatform,
      sourceEnvironment: ev.sourceEnvironment,
      sourceVersion: ev.sourceVersion,
      sourceCommit: ev.sourceCommit,
      occurredAt: ev.occurredAt,
      correlationId: ev.correlationId,
      causationId: ev.causationId,
      schemaVersion: ev.schemaVersion,
      idempotencyKey: ev.idempotencyKey,
      criticality: ev.criticality,
      payloadJson: ev.payloadJson,
      identityId,
      status: KNOWN_EVENT_TYPES.has(ev.eventType) ? 'RECEIVED' : 'SKIPPED',
    },
  });
  if (!KNOWN_EVENT_TYPES.has(ev.eventType)) {
    await db.eventRecord.update({
      where: { id: row.id },
      data: { processingError: `unknown event type '${ev.eventType}' — preserved, not dispatched`, processedAt: new Date() },
    });
    logger.info('event_skipped_unknown_type', { eventType: ev.eventType, platform: ev.sourcePlatform });
  }
  return { eventRecordId: row.id, duplicate: false, skipped: KNOWN_EVENT_TYPES.has(ev.eventType) ? null : 'UNKNOWN_TYPE' };
}
