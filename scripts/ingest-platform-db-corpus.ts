// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 31 — platform-db-corpus ingestion driver.
//
// Ingests the research-compiled platform database-knowledge corpora
// (scripts/platform-db-corpus/<folder>/docs/*.md) through the REAL pipeline:
//   §88 registry connect → POST /api/ingestion → /api/jobs polling.
// Idempotent via the job-queue content-hash key (re-runs report DUPLICATE).
//
// CRITICAL contract (Task 30 lesson): always send `version` — the API maps it
// to BlueprintVersion; a corpus-wide shared version keeps every doc on ONE
// CURRENT row (per-document auto-versioning supersedes earlier versions and
// strands their docs out of retrieval).
//
// Flags: --app <url>  --platform <slug[,slug2]|all>  --dry-run  --no-connect
//        --parallel N   (serial against local dev — OOM discipline; the
//        embeddings run CPU-bound in one process)
// ═══════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const APP = arg('app') ?? 'http://localhost:3000';
const ROOT = 'scripts/platform-db-corpus';
const DRY_RUN = has('dry-run');
const CONNECT = !has('no-connect');
const PLATFORMS_ARG = arg('platform') ?? 'all';
const CORPUS_VERSION = 'platform-db-2026-09-18';
const PARALLEL = Math.max(1, Math.min(6, parseInt(arg('parallel') ?? '1', 10) || 1));

// ── Platform corpus configuration ────────────────────────────────────────────

interface PlatformConfig {
  platformSlug: string;
  folder: string;
  repositoryUrl: string;
  deploymentUrl?: string;
  databaseUrl?: string;
  blueprintSlug: string;
  blueprintTitle: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    // Same blueprint the automated §34 probe uses (<slug>-database) — all
    // WASL database knowledge consolidates in one place.
    platformSlug: 'wasl',
    folder: 'wasl',
    repositoryUrl: 'https://github.com/cirkle-superapp/wasl',
    deploymentUrl: 'https://cirkle-wasl.vercel.app',
    databaseUrl: 'libsql://wasl-fortleem.aws-us-east-1.turso.io',
    blueprintSlug: 'wasl-database',
    blueprintTitle: 'WASL Database Intelligence (Turso)',
  },
  {
    platformSlug: 'egycourt',
    folder: 'egycourt',
    repositoryUrl: 'https://github.com/egycourt/egycourt',
    blueprintSlug: 'egycourt-architecture',
    blueprintTitle: 'EGYCOURT Judicial Intelligence Architecture',
  },
];

// ── Frontmatter parsing (controlled subset) ──────────────────────────────────

interface Frontmatter { title?: string; docType?: string; jurisdiction?: string; sources: string[] }

function parseDoc(path: string): { fm: Frontmatter; body: string } | null {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  const fm: Frontmatter = { sources: [] };
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const raw = m[2].trim();
    if (key === 'sources') continue;
    if (key === 'title' || key === 'doctype' || key === 'jurisdiction') {
      (fm as Record<string, unknown>)[key === 'doctype' ? 'docType' : key] = raw.replace(/^"|"$/g, '');
    }
  }
  const srcBlock = fmText.split('\n').find((l) => /^sources:/.test(l));
  if (srcBlock) {
    const srcIdx = fmText.split('\n').indexOf(srcBlock);
    for (const l of fmText.split('\n').slice(srcIdx + 1)) {
      const sm = l.match(/^\s+-\s*(\S.*)$/);
      if (!sm) break;
      fm.sources.push(sm[1].trim());
    }
  }
  return { fm, body };
}

// ── API helpers ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!json.ok) throw new Error(`API ${json.error?.code}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function listJobs(): Promise<{ id: string; status: string; lastError: string | null }[]> {
  const res = await fetch(`${APP}/api/jobs?limit=100`);
  const json = (await res.json()) as { ok: boolean; data?: unknown };
  const d = json.data as { id: string; status: string; lastError: string | null }[] | { jobs?: { id: string; status: string; lastError: string | null }[] } | undefined;
  if (Array.isArray(d)) return d;
  return d?.jobs ?? [];
}

// ── Collection ───────────────────────────────────────────────────────────────

interface Doc {
  file: string;
  platform: PlatformConfig;
  title: string;
  docType: string;
  content: string;
  kb: number;
}

function collectDocs(p: PlatformConfig): { docs: Doc[]; errors: string[] } {
  const dir = join(ROOT, p.folder, 'docs');
  const docs: Doc[] = [];
  const errors: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); }
  catch { return { docs, errors: [`${p.folder}: no docs dir`] }; }
  for (const f of entries) {
    const path = join(dir, f);
    const parsed = parseDoc(path);
    if (!parsed) { errors.push(`${f}: frontmatter invalid`); continue; }
    const title = parsed.fm.title ?? f.replace(/\.md$/, '');
    const docType = (parsed.fm.docType ?? 'REFERENCE').toUpperCase();
    const provenance = [
      '',
      '---',
      `Platform: ${p.platformSlug} · Corpus version: ${CORPUS_VERSION}`,
      parsed.fm.jurisdiction ? `Jurisdiction: ${parsed.fm.jurisdiction}` : null,
      parsed.fm.sources.length ? `Sources: ${parsed.fm.sources.join(' · ')}` : null,
    ].filter(Boolean).join('\n');
    const content = `${parsed.body.trim()}\n${provenance}\n`;
    docs.push({
      file: f,
      platform: p,
      title,
      docType,
      content,
      kb: Math.round(content.length / 102.4) / 10,
    });
  }
  return { docs, errors };
}

// ── Registry connect (§88) ───────────────────────────────────────────────────

async function connectPlatform(p: PlatformConfig): Promise<void> {
  const dto = await apiPost<unknown>(`/api/fabric/registry/${p.platformSlug}/connect`, {
    repositoryUrl: p.repositoryUrl,
    ...(p.deploymentUrl ? { deploymentUrl: p.deploymentUrl } : {}),
    ...(p.databaseUrl ? { databaseUrl: p.databaseUrl } : {}),
  });
  void dto;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`platform-db-corpus ingestion → ${APP} (version ${CORPUS_VERSION}, parallel ${PARALLEL}${DRY_RUN ? ', DRY-RUN' : ''})`);
  const wanted = PLATFORMS_ARG === 'all'
    ? PLATFORMS.map((p) => p.platformSlug)
    : PLATFORMS_ARG.split(',').map((s) => s.trim()).filter(Boolean);

  let total = 0;
  for (const p of PLATFORMS) {
    if (!wanted.some((w) => w === p.platformSlug || w === p.folder)) continue;
    const { docs, errors } = collectDocs(p);
    for (const e of errors) console.log(`  ! ${e}`);
    console.log(`\n■ ${p.platformSlug} — ${docs.length} docs → blueprint ${p.blueprintSlug}`);
    total += docs.length;
    if (DRY_RUN) {
      for (const d of docs) console.log(`  DRY: ${d.title} [${d.docType}] (${d.kb}KB)`);
      continue;
    }
    if (docs.length === 0) continue;

    if (CONNECT) {
      try { await connectPlatform(p); console.log('  ✓ registry connected'); }
      catch (err) { console.error(`  ✗ registry connect failed: ${err instanceof Error ? err.message : err}`); }
    }

    const results: { title: string; jobId: string; duplicate: boolean }[] = [];
    let submitErrors = 0;
    let idx = 0;
    const submitNext = async (): Promise<void> => {
      for (;;) {
        const i = idx++;
        if (i >= docs.length) return;
        const d = docs[i];
        try {
          const r = await apiPost<{ jobId: string; duplicate: boolean }>('/api/ingestion', {
            platformSlug: d.platform.platformSlug,
            blueprintSlug: d.platform.blueprintSlug,
            blueprintTitle: d.platform.blueprintTitle,
            title: d.title,
            docType: d.docType,
            content: d.content,
            version: CORPUS_VERSION,
            documentVersion: CORPUS_VERSION,
          });
          results.push({ title: d.title, jobId: r.jobId, duplicate: r.duplicate });
          console.log(`  ${r.duplicate ? 'DUPLICATE' : 'QUEUED'}: ${d.title} [${d.docType}] (${d.kb}KB)`);
          if (!r.duplicate) {
            const waitDeadline = Date.now() + 75_000;
            for (;;) {
              await sleep(3000);
              const jobs = await listJobs();
              const j = jobs.find((x) => x.id === r.jobId);
              if (!j) continue;
              if (j.status === 'COMPLETED') { console.log('    ✓ completed'); break; }
              if (j.status === 'FAILED') { console.log(`    ✗ FAILED: ${(j.lastError ?? '').slice(0, 90)}`); break; }
              if (Date.now() > waitDeadline) { console.log('    ⏱ window elapsed (job checkpoints progress)'); break; }
            }
          }
        } catch (err) {
          submitErrors++;
          console.log(`  FAIL: ${d.title} — ${err instanceof Error ? err.message.slice(0, 80) : 'err'}`);
          await sleep(8000);
        }
      }
    };
    if (PARALLEL > 1) console.log(`  submitting with concurrency ${PARALLEL}`);
    await Promise.all(Array.from({ length: PARALLEL }, () => submitNext()));

    // final drain poll (up to 10 min)
    const drainDeadline = Date.now() + 600_000;
    for (;;) {
      const jobs = await listJobs();
      const tracked = new Set(results.filter((r) => !r.duplicate).map((r) => r.jobId));
      const relevant = jobs.filter((j) => tracked.has(j.id));
      const pending = relevant.filter((j) => j.status === 'QUEUED' || j.status === 'IN_FLIGHT');
      if (pending.length === 0 || Date.now() > drainDeadline) break;
      console.log(`  … drain: ${pending.length} in flight`);
      await sleep(15000);
    }
    const jobs = await listJobs();
    const tracked = new Set(results.filter((r) => !r.duplicate).map((r) => r.jobId));
    const completed = jobs.filter((j) => tracked.has(j.id) && j.status === 'COMPLETED').length;
    const failed = jobs.filter((j) => tracked.has(j.id) && j.status === 'FAILED').length;
    console.log(`  ▸ ${p.platformSlug}: ${results.length} submitted (${results.filter((r) => r.duplicate).length} duplicate), ${completed} completed, ${failed} failed, ${submitErrors} submit errors`);
  }
  console.log(`\ntotal docs: ${total}`);
}

main().catch((e) => { console.error('ingestion failed:', e instanceof Error ? e.message : e); process.exit(1); });
