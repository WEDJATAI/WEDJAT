// WEDJAT v4 §34/§35 — POST /api/admin/probe-db (ADMIN+) — database DOWNLOAD.
//
// "Download all databases": runs the read-only platform Turso introspection
// SERVER-SIDE. The production environment is the only place the platform DB
// credentials exist (local sandbox resets wiped .env.local twice — §41),
// so the server probes its own env, measures every platform database
// (sqlite_master + COUNT(*)), publishes a versioned markdown snapshot
// through the REAL ingestion pipeline (blueprint <slug>-database), and
// reports the measured results. Tokens are never printed, echoed, logged,
// or persisted — only instance URLs appear in snapshots.
//
// body: { platforms?: string[] } — default: every configured target.
// Per-platform outcomes are honest (§5): PROBED / SKIPPED (no credentials
// configured) / FAILED (auth expired, instance down — exact error text).
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { ok, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { connectPlatform } from '@/lib/wedjat/fabric/registry';
import { enqueueJob, processJobNow } from '@/lib/wedjat/observability/jobs';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { WedjatError } from '@/lib/wedjat/errors';
import { contentHash } from '@/lib/wedjat/ids';
import {
  DB_TARGETS,
  introspectDatabase,
  buildSnapshotMarkdown,
  splitSnapshotMarkdown,
  type TableInfo,
} from '@/lib/wedjat/intake/db-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel serverless: probes + submissions must fit the request window; the
// pipeline itself runs in the after() window.
export const maxDuration = 60;

interface ProbeBody {
  platforms?: string[];
}

interface ProbeJobRef {
  jobId: string;
  duplicate: boolean;
  title: string;
}

interface PlatformProbeReport {
  slug: string;
  name: string;
  status: 'PROBED' | 'SKIPPED' | 'FAILED' | 'ERROR';
  tables?: number;
  totalRows?: number;
  parts?: number;
  jobs?: ProbeJobRef[];
  reason?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const body = await readJson<ProbeBody>(req).catch(() => ({}) as ProbeBody);
      const wanted = body.platforms?.length
        ? body.platforms.map((s) => s.trim()).filter(Boolean)
        : DB_TARGETS.map((t) => t.slug);
      for (const slug of wanted) {
        if (!DB_TARGETS.some((t) => t.slug === slug)) {
          throw new WedjatError('VALIDATION', `unknown platform '${slug}' (known: ${DB_TARGETS.map((t) => t.slug).join(', ')})`);
        }
      }

      const submitted: string[] = [];
      const reports: PlatformProbeReport[] = await Promise.all(
        wanted.map(async (slug): Promise<PlatformProbeReport> => {
          const target = DB_TARGETS.find((t) => t.slug === slug)!;
          const base: PlatformProbeReport = { slug, name: target.name, status: 'ERROR' };

          // §41: credentials exist ONLY in this process's env — never echoed.
          const url = process.env[target.urlEnv];
          const token = process.env[target.tokenEnv];
          if (!url || !token) {
            return {
              ...base,
              status: 'SKIPPED',
              reason: `${target.urlEnv}/${target.tokenEnv} not configured in this environment`,
            };
          }

          let tables: TableInfo[];
          try {
            tables = await introspectDatabase(url, token);
          } catch (err) {
            return {
              ...base,
              status: 'FAILED',
              reason: err instanceof Error ? err.message.slice(0, 200) : 'introspection failed',
            };
          }
          const totalRows = tables.reduce((s, t) => s + Math.max(t.rows, 0), 0);
          const snapshotTitle = `${target.name} Database Snapshot — tables, row counts & schema`;
          const markdown = buildSnapshotMarkdown(target, tables);
          const parts = splitSnapshotMarkdown(snapshotTitle, markdown);

          // §88 registry connect first (idempotent) so the platform row exists.
          try {
            await connectPlatform(
              principal.org.id,
              target.slug,
              {
                repositoryUrl: target.repositoryUrl,
                deploymentUrl: target.deploymentUrl,
                databaseUrl: target.databaseUrl,
              },
              principal.userId
            );
          } catch (err) {
            return {
              ...base,
              status: 'ERROR',
              reason: `registry connect failed: ${err instanceof Error ? err.message.slice(0, 160) : 'err'}`,
            };
          }

          // Unique-per-run documentVersion: a re-probe with CHANGED live data
          // appends a new immutable snapshot (§58); unchanged content is
          // caught by the job idempotency key (no redundant work).
          const documentVersion = `turso-probe-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
          const jobs: ProbeJobRef[] = [];
          for (let pi = 0; pi < parts.length; pi++) {
            const partTitle =
              parts.length > 1 ? `${snapshotTitle} — Part ${pi + 1}/${parts.length}` : snapshotTitle;
            const idem = contentHash(`${target.slug}|${target.slug}-database|${partTitle}|${parts[pi].slice(0, 2000)}`);
            const { jobId, duplicate } = await enqueueJob(
              {
                kind: 'ingestion',
                orgId: principal.org.id,
                userId: principal.userId,
                input: {
                  orgId: principal.org.id,
                  platformSlug: target.slug,
                  blueprintSlug: `${target.slug}-database`,
                  blueprintTitle: `${target.name} Database Intelligence (Turso)`,
                  title: partTitle,
                  docType: 'REFERENCE',
                  content: parts[pi],
                  documentVersion,
                  actorId: principal.userId,
                  idempotencyKey: idem,
                },
              },
              { idempotencyKey: `ingest-${idem}` }
            );
            jobs.push({ jobId, duplicate, title: partTitle });
            if (!duplicate) submitted.push(jobId);
          }

          return {
            ...base,
            status: 'PROBED',
            tables: tables.length,
            totalRows,
            parts: parts.length,
            jobs,
          };
        })
      );

      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'platform.database_probed',
        severity: 'WARN',
        details: {
          requested: wanted,
          reports: reports.map((r) => ({
            slug: r.slug,
            status: r.status,
            tables: r.tables ?? null,
            totalRows: r.totalRows ?? null,
          })),
        },
      });

      // Serverless-safe execution: run each submitted pipeline job
      // deterministically in the after() window (self-healing worker is the
      // fallback for anything evicted).
      if (submitted.length > 0) {
        after(async () => {
          for (const jobId of submitted) {
            try {
              await processJobNow(jobId);
            } catch {
              // Job stays QUEUED/RUNNING — the interval worker (with the
              // Task 26 stale-RUNNING self-heal) picks it up.
            }
          }
        });
      }

      return ok({
        probedAt: new Date().toISOString(),
        platformCount: reports.length,
        probed: reports.filter((r) => r.status === 'PROBED').length,
        jobsSubmitted: submitted.length,
        reports,
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}
