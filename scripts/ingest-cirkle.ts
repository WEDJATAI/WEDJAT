// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §54 — PULL ingestion from a connected platform's GitHub repository.
//
// Ingests curated CIRKLE repository knowledge (architecture docs, ADRs,
// blueprints, database schemas, service source) through the EXISTING intake
// pipeline (POST /api/ingestion) into the target WEDJAT app (local dev server
// or production). Markdown-aware chunking keeps section lineage; code files
// are wrapped as fenced markdown with provenance headings.
//
// Additive & idempotent: the ingestion API de-duplicates by content hash
// (§58/§61) — re-running never duplicates knowledge.
//
// Usage:
//   bun scripts/ingest-cirkle.ts                       (local  :3000)
//   bun scripts/ingest-cirkle.ts --app https://wedjat-ai.vercel.app
//
// Security: token read from .env.local; NEVER printed, committed or logged.
// Content is ingested as DATA only (§59) — never executed.
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const envMap = new Map(
  env.split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const APP = process.argv.includes('--app')
  ? process.argv[process.argv.indexOf('--app') + 1]
  : 'http://localhost:3000';
const TOKEN = envMap.get('CIRKLE_GITHUB_TOKEN')!;
const REPO = envMap.get('CIRKLE_GITHUB_REPO') ?? 'fortleem/CIRKLE';
const BRANCH = 'main';

if (!TOKEN) {
  console.error('CIRKLE_GITHUB_TOKEN missing in .env.local');
  process.exit(1);
}

// ── Curation ─────────────────────────────────────────────────────────────────

interface Selection {
  path: string;
  blueprintSlug: string;
  blueprintTitle: string;
  docType: string;
  title: string;
}

const ARCH = { blueprintSlug: 'cirkle-architecture', blueprintTitle: 'CIRKLE Architecture & Governance' };
const ENG = { blueprintSlug: 'cirkle-engineering', blueprintTitle: 'CIRKLE Engineering & Database' };
const BRAIN = { blueprintSlug: 'cirkle-brain-ai', blueprintTitle: 'CIRKLE Brain AI Service' };

function docTypeFor(name: string): string {
  const n = name.toUpperCase();
  if (n.includes('BLUEPRINT')) return 'BLUEPRINT';
  if (n.startsWith('ADR-')) return 'ADR';
  if (n.includes('SPECIFICATION') || n.includes('WIRING') || n.includes('PLAYBOOK') || n.includes('MOAT') || n.includes('ARCHITECTURE')) return 'SPEC';
  if (n.includes('AUDIT') || n.includes('COMPLIANCE')) return 'AUDIT';
  if (n.includes('DEPLOYMENT') || n.includes('ROLLBACK')) return 'RUNBOOK';
  return 'REFERENCE';
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(md|prisma|json|ts|tsx|py)$/i, '').replace(/[-_]+/g, ' ').trim();
}

function selectFiles(tree: { path: string; type: string; size?: number }[]): Selection[] {
  const out: Selection[] = [];
  const blobs = tree.filter((t) => t.type === 'blob');

  for (const it of blobs) {
    const p = it.path;
    const size = it.size ?? 0;
    if (size > 400_000) continue; // skip very large files (screenshots etc. anyway excluded)

    // 1) All architecture/governance docs.
    if (p.startsWith('docs/') && p.toLowerCase().endsWith('.md')) {
      out.push({ path: p, ...ARCH, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
      continue;
    }
    // 2) Root-level engineering documents.
    if (!p.includes('/') && /\.(md)$/i.test(p) && !/^worklog/i.test(p)) {
      out.push({ path: p, ...ARCH, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
      continue;
    }
    // 3) Main app engineering: schema + package manifest.
    if (p === 'prisma/schema.prisma' || p === 'package.json') {
      out.push({ path: p, ...ENG, docType: 'REFERENCE', title: `CIRKLE ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
      continue;
    }
    // 4) CIRKLE Brain AI service: manifest, schema, mini-service entries, modules.
    if (p.startsWith('download/cirkle-brain-ai/')) {
      const rel = p.slice('download/cirkle-brain-ai/'.length);
      const wanted =
        rel === 'package.json' ||
        rel === 'prisma/schema.prisma' ||
        /^mini-services\/[^/]+\/(index\.ts|package\.json)$/.test(rel) ||
        /^src\/lib\/[^/]+\/index\.ts$/.test(rel);
      if (wanted && size > 200) {
        out.push({ path: p, ...BRAIN, docType: 'REFERENCE', title: `CIRKLE Brain ${titleFromPath(p)}` });
      }
    }
  }
  return out;
}

// ── GitHub helpers ───────────────────────────────────────────────────────────

async function gh<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'wedjat-ingest' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url.split('?')[0].slice(0, 60)}`);
  return (await res.json()) as T;
}

async function rawContent(path: string): Promise<string> {
  // Contents API with raw media type: works for private repos with the token.
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'wedjat-ingest',
      },
    }
  );
  if (!res.ok) throw new Error(`raw ${res.status} for ${path}`);
  return await res.text();
}

// ── App API helpers (envelope-aware) ─────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!json.ok) throw new Error(`API ${json.error?.code}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function listJobs(): Promise<{ id: string; status: string; progress: number; lastError: string | null }[]> {
  const res = await fetch(`${APP}/api/jobs?limit=100`);
  const json = (await res.json()) as {
    ok: boolean;
    data?: { id: string; status: string; progress: number; lastError: string | null }[] | { jobs?: { id: string; status: string; progress: number; lastError: string | null }[] };
  };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.jobs ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────────────────

function wrapAsMarkdown(path: string, content: string): string {
  const ext = (path.split('.').pop() ?? 'txt').toLowerCase();
  const langMap: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', json: 'json', prisma: 'prisma', py: 'py', md: 'md', sh: 'sh' };
  if (ext === 'md') return content; // already markdown — ingest as-is
  const lang = langMap[ext] ?? '';
  return `# Source: ${path}\n\nProvenance: \`${path}\` in the ${REPO} repository (branch ${BRANCH}).\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
}

async function main(): Promise<void> {
  console.log(`CIRKLE pull ingestion → ${APP}`);
  const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`
  );
  if (tree.truncated) console.warn('  (tree truncated by GitHub API — some files may be missed)');
  const selections = selectFiles(tree.tree);
  const totalKB = Math.round(
    selections.reduce((s, x) => s + (tree.tree.find((t) => t.path === x.path)?.size ?? 0), 0) / 1024
  );
  console.log(`  selected ${selections.length} documents (~${totalKB}KB) from ${tree.tree.length} repo entries`);

  const results: { title: string; jobId: string; duplicate: boolean }[] = [];
  let failed = 0;
  for (const sel of selections) {
    try {
      const content = await rawContent(sel.path);
      if (content.trim().length < 40) {
        console.log(`  SKIP (too short): ${sel.path}`);
        continue;
      }
      const markdown = wrapAsMarkdown(sel.path, content);
      const r = await apiPost<{ jobId: string; duplicate: boolean }>('/api/ingestion', {
        platformSlug: 'cirkle',
        blueprintSlug: sel.blueprintSlug,
        blueprintTitle: sel.blueprintTitle,
        title: sel.title,
        docType: sel.docType,
        content: markdown,
        documentVersion: 'github-main',
      });
      results.push({ title: sel.title, jobId: r.jobId, duplicate: r.duplicate });
      console.log(`  ${r.duplicate ? 'DUPLICATE' : 'QUEUED'}: ${sel.title} [${sel.docType}] (${Math.round(markdown.length / 1024)}KB)`);
      if (!r.duplicate) {
        // Wait for THIS job to finish before the next submission: keeps the
        // pipeline serial (embeddings are CPU-bound; concurrent bursts can
        // exhaust a single dev-server process).
        const waitDeadline = Date.now() + 240_000;
        for (;;) {
          await sleep(3000);
          const jobs = await listJobs();
          const j = jobs.find((x) => x.id === r.jobId);
          if (!j) continue;
          if (j.status === 'COMPLETED') { console.log(`    ✓ completed`); break; }
          if (j.status === 'FAILED') {
            console.log(`    ✗ FAILED: ${(j.lastError ?? '').slice(0, 90)}`);
            break;
          }
          if (Date.now() > waitDeadline) { console.log('    ⏱ wait timeout (job still running)'); break; }
        }
      }
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${sel.path} — ${err instanceof Error ? err.message.slice(0, 80) : 'err'}`);
      // Server may be restarting after a burst — back off before continuing.
      await sleep(8000);
    }
  }

  // Poll job completion (bounded wait).
  const ids = new Set(results.map((r) => r.jobId));
  const deadline = Date.now() + 15 * 60 * 1000;
  let completed = 0;
  while (Date.now() < deadline && completed < ids.size) {
    await sleep(4000);
    const jobs = await listJobs();
    completed = 0;
    for (const j of jobs) {
      if (ids.has(j.id) && (j.status === 'COMPLETED' || j.status === 'FAILED')) completed++;
    }
  }
  const finalJobs = await listJobs();
  const byId = new Map(finalJobs.map((j) => [j.id, j]));
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    const j = byId.get(r.jobId);
    if (!j) continue;
    if (j.status === 'COMPLETED') okCount++;
    else if (j.status === 'FAILED') {
      failCount++;
      console.log(`  JOB FAILED: ${r.title} — ${(j.lastError ?? '').slice(0, 100)}`);
    }
  }
  const dupCount = results.filter((r) => r.duplicate).length;
  console.log(
    `\nSUMMARY: ${results.length} submitted (${dupCount} duplicates), ${okCount} completed, ${failCount} failed, ${failed} submit-errors`
  );
}

main().catch((e) => {
  console.error('ingest failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
