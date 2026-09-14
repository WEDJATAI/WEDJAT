// WEDJAT v4 §113 — GET /api/admin/export-corpus (ADMIN+) — knowledge database
// DOWNLOAD (paginated, non-destructive).
//
// "Download all databases": exports WEDJAT's own knowledge database — the
// full versioned corpus (every INGESTED DocumentVersion with its rawText)
// plus the platform registry coordinates — so a fresh environment (e.g. a
// sandbox reset) can re-download everything and re-materialize the corpus
// through the REAL ingestion pipeline. Exporting never removes knowledge.
//
// Query params:
//   ?platform=<slug>   restrict to one platform (default: all org platforms)
//   ?cursor=<docVerId> pagination cursor (DocumentVersion.id, ascending)
//   ?limit=<n>         page size cap, 1–60 (default 25)
//   ?budget=<bytes>    soft response byte budget (default ~2.5MB)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { recordAudit } from '@/lib/wedjat/observability/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const params = new URL(req.url).searchParams;
      const platformSlug = params.get('platform')?.trim() || undefined;
      const cursor = params.get('cursor')?.trim() || undefined;
      const limit = Math.min(Math.max(Number(params.get('limit') ?? 25) || 25, 1), 60);
      const budget = Math.min(Math.max(Number(params.get('budget') ?? 2_500_000) || 2_500_000, 200_000), 4_000_000);

      // ── Registry coordinates (slug → platform + blueprint inventory) ──────
      const platformRows = await db.platform.findMany({
        where: {
          orgId: principal.org.id,
          ...(platformSlug ? { slug: platformSlug } : {}),
        },
        orderBy: { slug: 'asc' },
        include: {
          blueprints: {
            orderBy: { slug: 'asc' },
            include: { versions: { select: { version: true, status: true } } },
          },
        },
      });
      const registry = platformRows.map((p) => ({
        slug: p.slug,
        name: p.name,
        criticality: p.criticality,
        status: p.status,
        connectionStatus: p.connectionStatus,
        repositoryUrl: p.repositoryUrl,
        deploymentUrl: p.deploymentUrl,
        databaseUrl: p.databaseUrl,
        blueprints: p.blueprints.map((b) => ({
          slug: b.slug,
          title: b.title,
          blueprintType: b.blueprintType,
          status: b.status,
          versions: b.versions.map((v) => v.version),
        })),
      }));

      // ── Versioned corpus page (DocumentVersion.id ascending, stable) ─────
      const versionRows = await db.documentVersion.findMany({
        where: {
          status: 'INGESTED', // only successfully-ingested knowledge
          ...(cursor ? { id: { gt: cursor } } : {}),
          document: {
            blueprintVersion: {
              blueprint: {
                platform: {
                  orgId: principal.org.id,
                  ...(platformSlug ? { slug: platformSlug } : {}),
                },
              },
            },
          },
        },
        include: {
          document: {
            include: {
              blueprintVersion: {
                include: {
                  blueprint: { include: { platform: { select: { slug: true, name: true } } } },
                },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: limit,
      });

      // Accumulate under the byte budget (serverless response limit safety).
      let bytes = 0;
      let cut = 0;
      for (const v of versionRows) {
        const size = v.rawText.length;
        if (bytes + size > budget && cut > 0) break; // always include ≥1 doc
        bytes += size;
        cut++;
      }
      const included = versionRows.slice(0, cut);
      const done = versionRows.length < limit; // DB exhausted on this page
      const nextCursor = included.length > 0 ? included[included.length - 1].id : null;

      const documents = included.map((v) => ({
        platformSlug: v.document.blueprintVersion.blueprint.platform.slug,
        platformName: v.document.blueprintVersion.blueprint.platform.name,
        blueprintSlug: v.document.blueprintVersion.blueprint.slug,
        blueprintTitle: v.document.blueprintVersion.blueprint.title,
        blueprintType: v.document.blueprintVersion.blueprint.blueprintType,
        blueprintVersion: v.document.blueprintVersion.version,
        title: v.document.title,
        slug: v.document.slug,
        docType: v.document.docType,
        classification: v.document.classification,
        language: v.document.language,
        documentVersion: v.version,
        status: v.status,
        checksum: v.checksum,
        byteSize: v.byteSize,
        ingestedAt: v.ingestedAt?.toISOString() ?? null,
        content: v.rawText,
      }));

      await recordAudit({
        orgId: principal.org.id,
        actorType: 'user',
        actorId: principal.userId,
        action: 'knowledge.corpus_exported',
        severity: 'WARN',
        targetType: 'DocumentVersion',
        targetId: nextCursor ?? 'none',
        details: {
          page: { count: documents.length, bytes, done, platform: platformSlug ?? 'all' },
          registryPlatforms: registry.length,
        },
      });

      return ok({
        exportedAt: new Date().toISOString(),
        nonDestructive: true,
        org: principal.org.slug,
        registry,
        page: {
          count: documents.length,
          bytes,
          limit,
          budget,
          done,
          nextCursor,
        },
        documents,
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}
