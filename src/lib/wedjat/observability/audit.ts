// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Audit log (§56, §82). Every security-relevant action
// (auth, ingestion, promotion, policy decisions, tool use) leaves an immutable
// audit trail. Details are redacted via the logger's redaction pipeline.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

export interface AuditInput {
  orgId?: string;
  actorType: 'user' | 'system' | 'job' | 'router';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  /** Structured details (preferred — redacted before storage). */
  details?: Record<string, unknown>;
  /** v4 additive: pre-serialized details (stored as-is; callers must not pass
   *  secret values — the same key-redaction applies to `details`). */
  detailsJson?: string;
  traceId?: string;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        orgId: input.orgId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        severity: input.severity ?? 'INFO',
        detailsJson: input.detailsJson ?? (input.details ? redactDetails(input.details) : undefined),
        traceId: input.traceId,
      },
    });
  } catch {
    // Audit failures must never break the primary flow; the structured logger
    // still emits to stdout so operations can reconstruct events.
  }
}

function redactDetails(details: Record<string, unknown>): string {
  // Reuse the logger's redaction by serializing through it.
  const seen = new Set<string>();
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (/token|secret|key|password|credential|authorization/i.test(k)) {
      safe[k] = '[REDACTED]';
    } else {
      safe[k] = v;
    }
    if (seen.size > 40) break;
  }
  return JSON.stringify(safe);
}
