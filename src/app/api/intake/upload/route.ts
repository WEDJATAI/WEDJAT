// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — POST /api/intake/upload (§106, §107, §108).
//
// Zero-manual-mapping intake entry point: accepts a database/export file,
// auto-detects the format, preserves the artifact immutably (sha256, RAW stage)
// and enqueues the async intake pipeline. Requires CURATOR+.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { detectFormat } from '@/lib/wedjat/intake/detect';
import { persistArtifact } from '@/lib/wedjat/intake/artifact';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { INTAKE_ENGINE_VERSION } from '@/lib/wedjat/intake/engine';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { newTraceId } from '@/lib/wedjat/ids';

export const runtime = 'nodejs';
// Vercel serverless: the intake pipeline runs after the response via after();
// give the function enough runway for a full pipeline pass.
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const UPLOAD_CLASSIFICATIONS = new Set(['INTERNAL', 'CONFIDENTIAL', 'PUBLIC']);

function slugifyPlatform(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'external-platform'
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);

      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new WedjatError('VALIDATION', "multipart field 'file' is required");
      }
      if (file.size === 0) throw new WedjatError('VALIDATION', 'uploaded file is empty');
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new WedjatError(
          'VALIDATION',
          `file exceeds the 25MB intake limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`
        );
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const checksum = createHash('sha256').update(bytes).digest('hex');
      const detection = detectFormat(bytes);
      if (detection.format === 'UNKNOWN') {
        throw new WedjatError(
          'VALIDATION',
          'Could not detect a supported database format (SQLite, SQL dump, CSV, JSON or JSONL).'
        );
      }

      // §108: immutable source record — artifact bytes are written once and never modified.
      const originalName = file.name || 'upload.bin';
      const platform = slugifyPlatform(
        String(form.get('platform') ?? '')
          .trim() || originalName.replace(/\.[^.]+$/, '') || 'external-platform'
      );
      const name =
        String(form.get('name') ?? '')
          .trim() || originalName.replace(/\.[^.]+$/, '') || 'database';

      // Auto version label (§142 drift on re-upload of the same platform+name).
      let versionLabel = 'v1';
      for (let n = 2; n < 100; n++) {
        const exists = await db.sourceDatabase.findFirst({
          where: { orgId: principal.org.id, platform, name, versionLabel },
          select: { id: true },
        });
        if (!exists) break;
        versionLabel = `v${n}`;
      }

      const source = await db.sourceDatabase.create({
        data: {
          orgId: principal.org.id,
          name,
          platform,
          engine: detection.format,
          versionLabel,
          checksum,
          byteSize: bytes.length,
          artifactPath: 'pending',
          originalName,
          status: 'PROCESSING',
          uploadedById: principal.userId,
        },
      });
      // §108: immutable artifact — DB-authoritative bytes + best-effort FS cache
      // (persistArtifact handles read-only serverless filesystems gracefully).
      const { artifactData, artifactPath } = await persistArtifact(source.id, bytes);
      await db.sourceDatabase.update({
        where: { id: source.id },
        data: { artifactPath, artifactData },
      });

      const run = await db.intakeRun.create({
        data: {
          sourceDatabaseId: source.id,
          orgId: principal.org.id,
          status: 'RAW',
          trigger: 'UPLOAD',
          engineVersion: INTAKE_ENGINE_VERSION,
        },
      });
      await db.sourceDatabase.update({ where: { id: source.id }, data: { latestRunId: run.id } });

      // §66 data classification (uploader's choice; INTERNAL keeps chat
      // generation available on approved remote providers, CONFIDENTIAL
      // never leaves the org boundary).
      const requestedClassification = String(form.get('classification') ?? 'INTERNAL').trim().toUpperCase();
      const classification = (
        UPLOAD_CLASSIFICATIONS.has(requestedClassification) ? requestedClassification : 'INTERNAL'
      ) as 'INTERNAL' | 'CONFIDENTIAL' | 'PUBLIC';

      const { jobId } = await enqueueJob(
        {
          kind: 'database-intake',
          orgId: principal.org.id,
          userId: principal.userId,
          runId: run.id,
          classification,
        },
        { idempotencyKey: `intake-run-${run.id}` }
      );
      await db.intakeRun.update({ where: { id: run.id }, data: { jobId } });

      // Serverless-safe execution: the in-process interval worker only runs
      // while a function instance is warm. after() keeps this invocation alive
      // past the response so the pipeline deterministically executes NOW
      // (the interval worker remains a fallback for other job kinds).
      after(async () => {
        try {
          await processJobNow(jobId);
        } catch {
          // Job stays QUEUED/RUNNING in the DB — the worker (warm instances)
          // or the next upload picks it up; failures are surfaced on the run.
        }
      });

      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'intake.uploaded',
        targetType: 'sourceDatabase',
        targetId: source.id,
        severity: 'INFO',
        details: {
          platform,
          name,
          versionLabel,
          engine: detection.format,
          byteSize: bytes.length,
          runId: run.id,
          traceId: newTraceId(),
        },
      });

      return ok({
        sourceDatabaseId: source.id,
        runId: run.id,
        jobId,
        detected: {
          engine: detection.format,
          method: detection.method,
          confidence: detection.confidence,
          detail: detection.detail,
        },
        byteSize: bytes.length,
        checksum,
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}
