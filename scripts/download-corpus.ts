// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §113 — Corpus downloader: "download all databases needed to extend
// knowledge and learning".
//
// Two-phase driver:
//   1. DOWNLOAD — pages through GET /api/admin/export-corpus on the SOURCE app
//      (default: production, the environment that holds every ingested doc)
//      and writes the full knowledge database to a JSON artifact on disk
//      (db/downloads/corpus-<timestamp>.json): platform registry coordinates +
//      every INGESTED DocumentVersion with its rawText.
//   2. IMPORT — re-materializes the corpus on the TARGET app (default: local
//      dev) through the REAL intake pipeline: §88 registry connect per
//      platform, then POST /api/ingestion per document version with the
//      original blueprint/document version identity. Idempotent — content
//      checksums make re-runs duplicate-safe (§30/§58), so a sandbox reset
//      can be recovered any time with one command.
//
// Usage:
//   bun scripts/download-corpus.ts
//   bun scripts/download-corpus.ts --source https://wedjat-ai.vercel.app --target http://localhost:3000
//   bun scripts/download-corpus.ts --platform mtq-sigma --dry-run
// Flags: --source <url>  --target <url>  --platform <slug>  --parallel <n>
//        --dry-run (download only)  --out <file>
// ═══════════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── CLI ──────────────────────────────────────────────────────────────────────

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const SOURCE = arg('source') ?? 'https://wedjat-ai.vercel.app';
const TARGET = arg('target') ?? 'http://localhost:3000';
const PLATFORM = arg('platform');
const PARALLEL = Math.max(Number(arg('parallel') ?? 3) || 3, 1);
const DRY_RUN = has('dry-run');
const OUT = arg('out');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(app: string, path: string): Promise<T> {
  const res = await fetch(`${app}${path}`);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!json.ok) throw new Error(`GET ${path}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function apiPost<T>(app: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${app}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!json.ok) throw new Error(`POST ${path}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

interface JobDto {
  id: string;
  status: string;
  lastError: string | null;
}

async function listJobs(app: string, status: string): Promise<JobDto[]> {
  return apiGet<JobDto[]>(app, `/api/jobs?status=${status}`);
}

// ── Types (mirror the export route response) ─────────────────────────────────

interface RegistryPlatform {
  slug: string;
  name: string;
  criticality: string;
  status: string;
  connectionStatus: string | null;
  repositoryUrl: string | null;
  deploymentUrl: string | null;
  databaseUrl: string | null;
  blueprints: { slug: string; title: string; versions: string[] }[];
}

interface ExportedDoc {
  platformSlug: string;
  platformName: string;
  blueprintSlug: string;
  blueprintTitle: string;
  blueprintType: string;
  blueprintVersion: string;
  title: string;
  slug: string;
  docType: string;
  classification: string;
  documentVersion: string;
  content: string;
}

interface ExportPage {
  registry: RegistryPlatform[];
  page: { count: number; bytes: number; done: boolean; nextCursor: string | null };
  documents: ExportedDoc[];
}

// ── Phase 1: DOWNLOAD ────────────────────────────────────────────────────────

async function download(): Promise<{ registry: RegistryPlatform[]; documents: ExportedDoc[]; artifact: string }> {
  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Phase 1 — DOWNLOAD knowledge database from ${SOURCE}`);
  const registry: RegistryPlatform[] = [];
  const documents: ExportedDoc[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const q = new URLSearchParams({ limit: '40' });
    if (PLATFORM) q.set('platform', PLATFORM);
    if (cursor) q.set('cursor', cursor);
    const page = await apiGet<ExportPage>(SOURCE, `/api/admin/export-corpus?${q.toString()}`);
    pages++;
    if (pages === 1) {
      registry.push(...page.registry);
      console.log(`  registry: ${registry.length} platform(s) — ${registry.map((p) => p.slug).join(', ')}`);
    }
    documents.push(...page.documents);
    const mb = (page.page.bytes / 1_000_000).toFixed(2);
    console.log(`  page ${pages}: ${page.page.count} doc(s), ${mb}MB${page.page.done ? ' (final)' : ''}`);
    cursor = page.page.nextCursor ?? undefined;
    if (page.page.done || !cursor) break;
  }
  const totalBytes = documents.reduce((s, d) => s + d.content.length, 0);
  console.log(`  downloaded: ${documents.length} document version(s), ${(totalBytes / 1_000_000).toFixed(2)}MB across ${pages} page(s)`);

  const artifact =
    OUT ??
    join(process.cwd(), 'db', 'downloads', `corpus-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  mkdirSync(join(process.cwd(), 'db', 'downloads'), { recursive: true });
  writeFileSync(artifact, JSON.stringify({ downloadedAt: new Date().toISOString(), source: SOURCE, registry, documents }));
  console.log(`  artifact: ${artifact}`);
  return { registry, documents, artifact };
}

// ── Phase 2: IMPORT (real pipeline) ──────────────────────────────────────────

async function waitForDrain(app: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietTicks = 0;
  let netFails = 0;
  for (;;) {
    try {
      const [queued, running] = await Promise.all([listJobs(app, 'QUEUED'), listJobs(app, 'RUNNING')]);
      netFails = 0;
      if (queued.length === 0 && running.length === 0) {
        quietTicks++;
        if (quietTicks >= 2) return true; // two consecutive quiet samples
      } else {
        quietTicks = 0;
      }
    } catch {
      // Transient app unavailability (e.g. dev-server restart under load) —
      // tolerate up to 12 consecutive failures (~30s) before giving up.
      if (++netFails > 12) return false;
    }
    if (Date.now() > deadline) return false;
    await sleep(2500);
  }
}

async function importCorpus(registry: RegistryPlatform[], documents: ExportedDoc[]): Promise<void> {
  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Phase 2 — IMPORT into ${TARGET} (real ingestion pipeline, parallel=${PARALLEL})`);

  // §88 registry connect per platform (idempotent).
  for (const p of registry) {
    try {
      await apiPost<unknown>(TARGET, `/api/fabric/registry/${p.slug}/connect`, {
        repositoryUrl: p.repositoryUrl ?? undefined,
        deploymentUrl: p.deploymentUrl ?? undefined,
        databaseUrl: p.databaseUrl ?? undefined,
      });
      console.log(`  ✓ registry CONNECTED: ${p.slug} (${p.blueprints.length} blueprint(s))`);
    } catch (err) {
      console.error(`  ✗ registry connect FAILED: ${p.slug} — ${err instanceof Error ? err.message : err}`);
    }
  }

  const failedBefore = new Set((await listJobs(TARGET, 'FAILED')).map((j) => j.id));

  // Bounded parallel submission — content-hash idempotency makes replays safe.
  let submitted = 0;
  let duplicates = 0;
  let errors = 0;
  let idx = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = idx++;
      if (i >= documents.length) return;
      const d = documents[i];
      try {
        const r = await apiPost<{ jobId: string; duplicate: boolean }>(TARGET, '/api/ingestion', {
          platformSlug: d.platformSlug,
          blueprintSlug: d.blueprintSlug,
          blueprintTitle: d.blueprintTitle,
          version: d.blueprintVersion,
          title: d.title,
          docType: d.docType,
          classification: d.classification,
          documentVersion: d.documentVersion,
          content: d.content,
        });
        if (r.duplicate) duplicates++;
        else submitted++;
      } catch (err) {
        errors++;
        console.error(`  ✗ submit FAILED: [${d.platformSlug}] ${d.title} — ${err instanceof Error ? err.message.slice(0, 120) : err}`);
      }
      // Submission failures (e.g. the app restarting under load) are retried
      // by re-running this idempotent script — content-hash dedup makes the
      // re-run safe (§30/§58).
      if ((submitted + duplicates) % 100 === 0 && (submitted + duplicates) > 0) {
        console.log(`  … ${submitted + duplicates}/${documents.length} submitted`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
  console.log(`  submitted: ${submitted} new, ${duplicates} duplicate(s), ${errors} submit error(s)`);

  // Wait for the queue to drain (after() + interval worker).
  console.log(`  waiting for pipeline to drain…`);
  const drained = await waitForDrain(TARGET, 15 * 60_000);
  if (!drained) console.log(`  ⚠ drain timeout — some jobs still QUEUED/RUNNING (worker self-heal will finish them)`);

  // Honest failure accounting: only NEW failures are ours.
  const failedAfter = (await listJobs(TARGET, 'FAILED')).filter((j) => !failedBefore.has(j.id));
  if (failedAfter.length > 0) {
    console.log(`  ⚠ ${failedAfter.length} NEW failed job(s):`);
    for (const j of failedAfter.slice(0, 10)) {
      console.log(`    ✗ ${j.id}: ${(j.lastError ?? '').slice(0, 110)}`);
    }
    // One controlled retry pass (Task 26 SQLITE_BUSY precedent).
    for (const j of failedAfter) {
      try {
        await apiPost<unknown>(TARGET, '/api/jobs', { action: 'retry', jobId: j.id });
      } catch {
        // retried jobs that fail again are reported honestly below
      }
    }
    if (failedAfter.length > 0) {
      console.log(`  retrying ${failedAfter.length} job(s) once…`);
      await waitForDrain(TARGET, 5 * 60_000);
    }
    const still = (await listJobs(TARGET, 'FAILED')).filter((j) => failedAfter.some((f) => f.id === j.id));
    console.log(still.length > 0 ? `  ✗ ${still.length} job(s) failed even after retry` : `  ✓ all retried jobs recovered`);
  } else {
    console.log(`  ✓ zero pipeline failures`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { registry, documents, artifact } = await download();
  if (DRY_RUN) {
    console.log(`DRY-RUN: artifact saved, import skipped (${documents.length} doc(s) ready at ${artifact})`);
    return;
  }
  if (documents.length === 0) {
    console.log('nothing to import (no INGESTED document versions on the source)');
    return;
  }
  await importCorpus(registry, documents);

  // Final verification against the target's own platform inventory.
  try {
    const platforms = await apiGet<{ slug: string; documentCount: number; chunkCount: number }[]>(TARGET, '/api/platforms');
    console.log(`──────────────────────────────────────────────────────────`);
    console.log('TARGET knowledge inventory after import:');
    for (const p of platforms) {
      console.log(`  ${p.slug.padEnd(14)} docs ${String(p.documentCount).padStart(5)}  chunks ${String(p.chunkCount).padStart(6)}`);
    }
  } catch {
    console.log('(target inventory unavailable — check the app logs)');
  }
}

main().catch((e) => {
  console.error('download-corpus failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
