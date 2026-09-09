// WEDJAT v4 — POST /api/v1/schemas (§34/§35): platforms PUBLISH database
// schema snapshots. WEDJAT never needs write access to source databases —
// the published metadata becomes knowledge + an auditable schema.changed
// event in the fabric (read-only ingestion, §39).
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { validateEnvelope, appendEvent } from '@/lib/wedjat/fabric/envelope';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import type { EventSubmitResult } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ColumnBody { name?: unknown; type?: unknown }
interface TableBody { name?: unknown; columns?: unknown }

interface SchemaBody {
  platform?: string;
  database?: string;
  version?: string;
  tables?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['schema:write'], {}, async ({ identity }) => {
    const body = await readServiceJson<SchemaBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");
    if (typeof body.database !== 'string' || body.database.trim() === '') {
      return fail('VALIDATION', "field 'database' is required (name of the source database)");
    }
    if (!Array.isArray(body.tables) || body.tables.length === 0) {
      return fail('VALIDATION', "field 'tables' must be a non-empty array");
    }
    if (body.tables.length > 500) {
      return fail('VALIDATION', 'schema snapshot exceeds 500 tables — split into multiple events');
    }
    // Validate table/column shapes (§85 schema validation).
    const tables: { name: string; columns: { name: string; type: string }[] }[] = [];
    for (const t of body.tables as TableBody[]) {
      if (typeof t?.name !== 'string' || t.name.trim() === '') {
        return fail('VALIDATION', 'every table requires a name');
      }
      const columns: { name: string; type: string }[] = [];
      if (Array.isArray(t.columns)) {
        for (const c of t.columns as ColumnBody[]) {
          if (typeof c?.name !== 'string' || c.name.trim() === '') {
            return fail('VALIDATION', `column of table '${t.name}' requires a name`);
          }
          columns.push({ name: c.name.slice(0, 120), type: String(c.type ?? 'UNKNOWN').slice(0, 60) });
        }
      }
      tables.push({ name: t.name.slice(0, 120), columns });
    }

    // Render the schema snapshot as a knowledge document (markdown) and route
    // it through the event fabric so the full pipeline runs (§14/§56).
    const lines: string[] = [
      `# Schema snapshot — ${body.database} (${platform})`,
      '',
      `- Database: ${body.database}`,
      `- Platform: ${platform}`,
      `- Version: ${body.version ?? 'v1'}`,
      `- Tables: ${tables.length}`,
      '',
    ];
    for (const t of tables) {
      lines.push(`## ${t.name}`);
      lines.push('');
      if (t.columns.length > 0) {
        lines.push('| Column | Type |');
        lines.push('| --- | --- |');
        for (const c of t.columns) lines.push(`| ${c.name} | ${c.type} |`);
      } else {
        lines.push('_No column metadata published._');
      }
      lines.push('');
    }
    lines.push('_Source: WEDJAT Intelligence API schema publish (v4 §34). Read-only ingestion — source databases are never modified (§39)._');

    const normalized = validateEnvelope(
      {
        eventType: 'schema.changed',
        sourcePlatform: platform,
        sourceVersion: body.version,
        payload: {
          title: `Schema snapshot — ${body.database}`,
          description: `Published schema snapshot: ${tables.length} tables, ${tables.reduce((n, t) => n + t.columns.length, 0)} columns.`,
          database: body.database,
          tables: tables.slice(0, 50), // evidence subset for the event payload
          content: lines.join('\n'),
        },
      },
      platform
    );
    const appended = await appendEvent(identity.orgId, normalized, identity.id);
    let jobId: string | null = null;
    if (!appended.duplicate) {
      const queued = await enqueueJob(
        { kind: 'fabric-dispatch', orgId: identity.orgId, userId: `identity:${identity.id}`, eventRecordId: appended.eventRecordId },
        { idempotencyKey: `fabric-${normalized.idempotencyKey}` }
      );
      jobId = queued.jobId;
      after(async () => { await processJobNow(jobId as string).catch(() => {}); });
    }
    const result: EventSubmitResult = appended.duplicate
      ? { eventId: normalized.eventId, status: 'DUPLICATE', jobId: null, message: 'schema snapshot already received (idempotent §58)' }
      : { eventId: normalized.eventId, status: 'RECEIVED', jobId, message: `schema snapshot accepted (${tables.length} tables) — queued for canonical mapping + knowledge extraction` };
    return ok(result, appended.duplicate ? 200 : 202);
  });
}
