import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson, requireString, failFrom } from '@/lib/wedjat/api';
import { requireMutationRole, requireAdminRole } from '@/lib/wedjat/security/auth';
import { enqueueJob } from '@/lib/wedjat/observability/jobs';
import { deleteKnowledgeDocument } from '@/lib/wedjat/intake/delete';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { WedjatError } from '@/lib/wedjat/errors';
import { contentHash } from '@/lib/wedjat/ids';
import type { IngestionSubmitResult, IngestionEventDto, JobDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IngestBody {
  platformSlug?: string;
  blueprintSlug?: string;
  blueprintTitle?: string;
  title?: string;
  docType?: string;
  classification?: string;
  content?: string;
  version?: string;
  documentVersion?: string;
}

/** POST — validate, resolve/create entities, enqueue the pipeline job (§62). */
export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    requireMutationRole(principal); // CURATOR+ may ingest (AUDITOR/MEMBER read-only)
    const body = await readJson<IngestBody>(req);

    const platformSlug = requireString(body.platformSlug, 'platformSlug', 80);
    const blueprintSlug = (body.blueprintSlug ?? slugify(requireString(body.blueprintTitle ?? body.title, 'blueprintTitle', 200)))
      .slice(0, 80);
    const title = requireString(body.title, 'title', 200);
    const content = requireString(body.content, 'content', 2_000_000);
    if (content.trim().length < 40) {
      throw new WedjatError('VALIDATION', 'Content too short to be a meaningful source (min 40 chars)');
    }

    // §59 document ingestion security: untrusted upload — never executed, size
    // and type validated; content stored as data only.
    const platform = await db.platform.findFirst({
      where: { orgId: principal.org.id, slug: platformSlug },
    });
    if (!platform) throw new WedjatError('NOT_FOUND', `Platform '${platformSlug}' not found`);

    // Idempotency key: same platform+blueprint+title+content → same job (§61).
    const idem = contentHash(`${platformSlug}|${blueprintSlug}|${title}|${content.slice(0, 2000)}`);

    const { jobId, duplicate } = await enqueueJob(
      {
        kind: 'ingestion',
        orgId: principal.org.id,
        userId: principal.userId,
        input: {
          orgId: principal.org.id,
          platformSlug,
          blueprintSlug,
          blueprintTitle: body.blueprintTitle,
          blueprintVersion: body.version || undefined,
          title,
          docType: body.docType || undefined,
          classification: body.classification || undefined,
          content,
          documentVersion: body.documentVersion || undefined,
          actorId: principal.userId,
          idempotencyKey: idem,
        },
      },
      { idempotencyKey: `ingest-${idem}` }
    );

    // Resolve (or pre-create) the document shell so the UI has stable ids.
    const bp = await db.blueprint.findFirst({ where: { platformId: platform.id, slug: blueprintSlug } });
    let documentVersionId = 'pending-job-creation';
    let documentId = 'pending-job-creation';
    if (bp) {
      const v = body.version
        ? await db.blueprintVersion.findFirst({ where: { blueprintId: bp.id, version: body.version } })
        : undefined;
      if (v) {
        const doc = await db.document.findFirst({ where: { blueprintVersionId: v.id, slug: slugify(title) }, include: { versions: true } });
        if (doc) {
          documentId = doc.id;
          documentVersionId = doc.versions[doc.versions.length - 1]?.id ?? 'pending';
        }
      }
    }

    const result: IngestionSubmitResult = {
      jobId,
      documentId,
      documentVersionId,
      duplicate,
      message: duplicate
        ? 'This document was already ingested (idempotency key matched) — showing the existing pipeline.'
        : 'Ingestion job queued. The pipeline stages will appear below as the worker processes the document.',
    };
    return ok(result, 201);
  });
}

/** DELETE ?documentId= — remove an ingested document and its derived index (ADMIN+). */
export async function DELETE(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const documentId = new URL(req.url).searchParams.get('documentId');
      if (!documentId) {
        throw new WedjatError('VALIDATION', 'documentId query parameter is required');
      }
      const report = await deleteKnowledgeDocument(principal.org.id, documentId);
      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'knowledge.document_deleted',
        targetType: 'document',
        targetId: documentId,
        severity: 'WARN',
        details: { title: report.title, chunks: report.chunks },
      });
      return ok({ deleted: report });
    } catch (err) {
      return failFrom(err);
    }
  });
}

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const events = await db.ingestionEvent.findMany({
      where: { documentVersion: { document: { blueprintVersion: { blueprint: { platform: { orgId: principal.org.id } } } } } },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: {
        documentVersion: { include: { document: { select: { title: true } } } },
      },
    });
    const jobs = await db.job.findMany({
      where: { type: { in: ['ingestion', 'synthetic-registration'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const eventDtos: IngestionEventDto[] = events.map((e) => ({
      id: e.id,
      stage: e.stage,
      status: e.status,
      detail: e.detail,
      latencyMs: e.latencyMs,
      createdAt: e.createdAt.toISOString(),
      documentTitle: e.documentVersion?.document?.title,
    }));

    const jobDtos: JobDto[] = jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status as JobDto['status'],
      progress: j.progress,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      lastError: j.lastError,
      payload: safeJson(j.payloadJson),
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
    }));

    return ok({ events: eventDtos, jobs: jobDtos });
  });
}

function safeJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Never echo full document content into job payloads surfaced to the UI.
    if (parsed && typeof parsed.input === 'object' && parsed.input !== null) {
      const input = parsed.input as Record<string, unknown>;
      if (typeof input.content === 'string') {
        input.content = `${input.content.slice(0, 80)}…[redacted ${input.content.length} chars]`;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}
