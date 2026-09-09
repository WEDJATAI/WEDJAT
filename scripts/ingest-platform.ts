// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §5/§54/§96 — Multi-platform PULL ingestion from LOCAL GIT CLONES.
//
// Generalizes scripts/ingest-cirkle.ts into a per-platform profile driver:
//   • Sources are LOCAL shallow clones (default /tmp/repos) — no GitHub API
//     rate limits, works for public repos with NO token.
//   • Each platform profile declares §5 coordinates (repo/deployment/db URLs),
//     blueprint partitioning (§4 explicit boundaries) and curation rules.
//   • Registers the platform in the fabric registry (§88 connect) BEFORE
//     ingesting, then submits documents through the REAL intake pipeline
//     (POST /api/ingestion) — serial submit+wait, split oversized sources.
//   • Additive & idempotent: the API de-duplicates by content hash (§30/§58)
//     — re-running never duplicates knowledge.
//
// Provenance: every non-markdown file is wrapped as fenced code with the
// repo + branch + HEAD commit; content is ingested as DATA only (§59) —
// never executed.
//
// Usage:
//   bun scripts/ingest-platform.ts --platform cirkle
//   bun scripts/ingest-platform.ts --platform judge,sgtx-fable,mtq-sigma,mtq
//   bun scripts/ingest-platform.ts --platform mtq --app https://wedjat-ai.vercel.app
//   bun scripts/ingest-platform.ts --platform all            (all 5 profiles)
// Flags: --app <url>  --repos <dir>  --no-connect  --dry-run
// ═══════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// ── CLI ──────────────────────────────────────────────────────────────────────

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const APP = arg('app') ?? 'http://localhost:3000';
const REPOS_DIR = arg('repos') ?? '/tmp/repos';
const DRY_RUN = has('dry-run');
const CONNECT = !has('no-connect');
const PLATFORMS_ARG = arg('platform') ?? '';

// ── Platform profiles (§5 INITIAL REGISTERED PLATFORM SOURCES) ───────────────

interface BlueprintDef {
  slug: string;
  title: string;
}
interface Selection {
  path: string;
  blueprint: BlueprintDef;
  docType: string;
  title: string;
}
interface PlatformProfile {
  slug: string;
  name: string;
  clone: string;
  repositoryUrl: string;
  deploymentUrl?: string;
  databaseUrl?: string;
  titlePrefix: string;
  select: (files: string[]) => Selection[];
}

const ARCH = (p: string, t: string): BlueprintDef => ({ slug: `${p}-architecture`, title: t });

function docTypeFor(path: string): string {
  const n = path.toUpperCase();
  const base = n.split('/').pop() ?? n;
  if (base.includes('BLUEPRINT')) return 'BLUEPRINT';
  if (base.startsWith('ADR-')) return 'ADR';
  if (n.includes('SPECIFICATION') || n.includes('PLAYBOOK') || n.includes('ARCHITECTURE') || n.includes('GAP_ANALYSIS') || n.includes('MAPPING')) return 'SPEC';
  if (n.includes('AUDIT') || n.includes('COMPLIANCE')) return 'AUDIT';
  if (n.includes('DEPLOYMENT') || n.includes('ROLLBACK')) return 'RUNBOOK';
  return 'REFERENCE';
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base
    .replace(/\.(md|prisma|json|ts|tsx|py|sql|sol)$/i, '')
    .replace(/[-_.]+/g, ' ')
    .trim();
}

const profiles: PlatformProfile[] = [
  {
    slug: 'cirkle',
    name: 'CIRKLE',
    clone: 'fortleem_CIRKLE',
    repositoryUrl: 'https://github.com/fortleem/CIRKLE',
    deploymentUrl: 'https://cirkleapp.vercel.app/',
    databaseUrl: 'libsql://cirkle-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'CIRKLE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('cirkle', 'CIRKLE Architecture & Governance');
      const eng: BlueprintDef = { slug: 'cirkle-engineering', title: 'CIRKLE Engineering & Database' };
      const brain: BlueprintDef = { slug: 'cirkle-brain-ai', title: 'CIRKLE Brain AI Service' };
      for (const p of files) {
        if (p.startsWith('docs/') && p.toLowerCase().endsWith('.md')) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
        } else if (!p.includes('/') && p.toLowerCase().endsWith('.md') && !/^worklog/i.test(p)) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `CIRKLE ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (p.startsWith('download/cirkle-brain-ai/')) {
          const rel = p.slice('download/cirkle-brain-ai/'.length);
          const wanted =
            rel === 'package.json' ||
            rel === 'prisma/schema.prisma' ||
            /^mini-services\/[^/]+\/(index\.ts|package\.json)$/.test(rel) ||
            /^src\/lib\/[^/]+\/index\.ts$/.test(rel);
          if (wanted) out.push({ path: p, blueprint: brain, docType: 'REFERENCE', title: `CIRKLE Brain ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    slug: 'mtq',
    name: 'MITHQAL MTQ',
    clone: 'MITHQALMTQ_MTQ',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ',
    deploymentUrl: 'https://mithqal.vercel.app/',
    databaseUrl: 'libsql://mtq-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'MTQ',
    // Honest minimal repo (§5 EGYCOURT principle applies to all: never invent
    // unavailable resources) — the README carries the integration principle.
    select: (files) =>
      files
        .filter((p) => p === 'README.md')
        .map((p) => ({ path: p, blueprint: ARCH('mtq', 'MITHQAL Settlement Architecture'), docType: 'SPEC', title: 'MTQ Settlement Capability Overview' })),
  },
  {
    slug: 'judge',
    name: 'JUDGE SMART',
    clone: 'fortleem_judge_synapse',
    repositoryUrl: 'https://github.com/fortleem/judge_synapse',
    deploymentUrl: 'https://judge-smart.vercel.app',
    databaseUrl: 'libsql://judge-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'JUDGE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('judge', 'JUDGE SMART Architecture & Governance');
      const corpus: BlueprintDef = { slug: 'judge-legal-corpus', title: 'JUDGE SMART Legal Corpus (Egypt)' };
      const eng: BlueprintDef = { slug: 'judge-engineering', title: 'JUDGE SMART Engineering & Database' };
      const judicial: BlueprintDef = { slug: 'judge-judicial-engine', title: 'JUDGE SMART Judicial Engine' };
      for (const p of files) {
        if (p === 'README.md' || p === 'audit-report.md') {
          out.push({ path: p, blueprint: arch, docType: p.toLowerCase().includes('audit') ? 'AUDIT' : 'REFERENCE', title: `JUDGE SMART ${titleFromPath(p)}` });
        } else if (p.startsWith('legal-corpus/snapshots/') && p.endsWith('.md')) {
          out.push({ path: p, blueprint: corpus, docType: 'SPEC', title: `JUDGE Legal Corpus — ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `JUDGE SMART ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^src\/lib\/judicial\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: judicial, docType: 'REFERENCE', title: `JUDGE Judicial Engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    slug: 'sgtx-fable',
    name: 'SGTX FABLE',
    clone: 'fortleem_SGTX_FABLE',
    repositoryUrl: 'https://github.com/fortleem/SGTX_FABLE',
    titlePrefix: 'SGTX FABLE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('sgtx-fable', 'SGTX FABLE Trade Platform Architecture');
      const db: BlueprintDef = { slug: 'sgtx-fable-database', title: 'SGTX FABLE Database & Schema' };
      const eng: BlueprintDef = { slug: 'sgtx-fable-engineering', title: 'SGTX FABLE Engineering' };
      for (const p of files) {
        if (p === 'README.md' || p === 'GAP_ANALYSIS.md' || p === 'docs/COCKPIT_MAPPING.md') {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `SGTX FABLE ${titleFromPath(p)}` });
        } else if (
          p === 'migrations/0001_consolidated.sql' ||
          p === 'migrations/0005_canonical_schema_snapshot.sql' ||
          p === 'seed.sql'
        ) {
          out.push({ path: p, blueprint: db, docType: 'REFERENCE', title: `SGTX FABLE database — ${titleFromPath(p)}` });
        } else if (p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: 'SGTX FABLE package manifest' });
        } else if (/^src\/lib\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `SGTX FABLE engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    slug: 'mtq-sigma',
    name: 'MTQ SIGMA',
    clone: 'MITHQALMTQ_MTQ_SIGMA',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ_SIGMA',
    deploymentUrl: 'https://mtq-sigma.vercel.app',
    databaseUrl: 'libsql://mtqs-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'MTQ SIGMA',
    select: (files) => {
      const out: Selection[] = [];
      const proto: BlueprintDef = { slug: 'mtq-sigma-protocol', title: 'MTQ Σ Protocol & Collateralization' };
      const eng: BlueprintDef = { slug: 'mtq-sigma-engineering', title: 'MTQ Σ Engineering' };
      for (const p of files) {
        if (p.startsWith('contracts/') && p.endsWith('.sol') && !p.includes('deployments')) {
          out.push({ path: p, blueprint: proto, docType: 'SPEC', title: `MTQ Σ Solidity contract — ${titleFromPath(p)}` });
        } else if (p === 'package.json' || p === 'prisma/schema.prisma') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^mini-services\/[^/]+\/index\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ service — ${titleFromPath(p)}` });
        } else if (/^src\/lib\/mtq\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

/** All file paths in a clone (git-tracked list is implicit: everything except .git). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else out.push(relPath);
    }
  };
  walk('');
  return out;
}

function shortSha(cloneDir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: cloneDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const LANG_MAP: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', json: 'json', prisma: 'prisma', py: 'py', md: 'md', sh: 'sh', sql: 'sql', sol: 'sol' };

function wrapAsMarkdown(profile: PlatformProfile, path: string, content: string, sha: string): string {
  const ext = (path.split('.').pop() ?? 'txt').toLowerCase();
  if (ext === 'md') return content; // already markdown — ingest as-is
  const lang = LANG_MAP[ext] ?? '';
  return `# Source: ${path}\n\nProvenance: \`${path}\` in the ${profile.repositoryUrl.replace('https://github.com/', '')} repository (branch main @ ${sha}).\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
}

/**
 * Split oversized sources so each ingestion job fits the serverless after()
 * window (~60s). Markdown splits at heading boundaries; code splits RAW
 * content at line boundaries BEFORE wrapping (so fenced blocks stay intact).
 */
const SPLIT_THRESHOLD = 70_000;
function splitMarkdown(title: string, markdown: string, repo: string): string[] {
  if (markdown.length <= SPLIT_THRESHOLD) return [markdown];
  const lines = markdown.split('\n');
  const parts: string[] = [];
  let current: string[] = [];
  let currentSize = 0;
  const flush = () => {
    if (current.length > 0 && currentSize > 800) parts.push(current.join('\n'));
    current = [];
    currentSize = 0;
  };
  for (const line of lines) {
    if (/^#{1,2} \S/.test(line) && currentSize >= SPLIT_THRESHOLD) flush();
    current.push(line);
    currentSize += line.length + 1;
  }
  flush();
  if (parts.length === 0) {
    for (let i = 0; i < markdown.length; i += SPLIT_THRESHOLD) parts.push(markdown.slice(i, i + SPLIT_THRESHOLD));
  }
  const total = parts.length;
  return parts.map((p, i) =>
    total === 1 ? p : `# ${title} — Part ${i + 1} of ${total}\n\nContinuation of \`${title}\` (${repo}@main).\n\n${p}`
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function ingestPlatform(profile: PlatformProfile): Promise<void> {
  const cloneDir = join(REPOS_DIR, profile.clone);
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`${profile.name} (${profile.slug}) → ${APP}`);
  console.log(`  source: ${profile.repositoryUrl} @ local clone ${cloneDir}`);

  let files: string[];
  try {
    files = walkFiles(cloneDir);
  } catch {
    console.error(`  ✗ clone not found: ${cloneDir} (clone it first)`);
    return;
  }
  const sha = shortSha(cloneDir);
  console.log(`  HEAD ${sha} · ${files.length} repo entries`);

  const selections = profile.select(files);
  const totalKB = Math.round(
    selections.reduce((s, x) => {
      try {
        return s + statSync(join(cloneDir, x.path)).size;
      } catch {
        return s;
      }
    }, 0) / 1024
  );
  console.log(`  selected ${selections.length} documents (~${totalKB}KB)`);
  if (selections.length === 0) {
    console.log('  (nothing selected — profile matched no files)');
    return;
  }
  if (DRY_RUN) {
    for (const s of selections) console.log(`  DRY: [${s.docType}] ${s.title} → ${s.blueprint.slug}`);
    return;
  }

  // §88 registry connect first (creates/refreshes the Platform row; the
  // ingestion API requires the platform to exist).
  if (CONNECT) {
    try {
      const dto = await apiPost<unknown>(`/api/fabric/registry/${profile.slug}/connect`, {
        repositoryUrl: profile.repositoryUrl,
        deploymentUrl: profile.deploymentUrl,
        databaseUrl: profile.databaseUrl,
      });
      void dto;
      console.log(`  ✓ registry CONNECTED: ${profile.slug}`);
    } catch (err) {
      console.error(`  ✗ registry connect failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
  }

  const results: { title: string; jobId: string; duplicate: boolean }[] = [];
  let failed = 0;
  for (const sel of selections) {
    try {
      const raw = readFileSync(join(cloneDir, sel.path), 'utf8');
      if (raw.trim().length < 40) {
        console.log(`  SKIP (too short): ${sel.path}`);
        continue;
      }
      const markdown = wrapAsMarkdown(profile, sel.path, raw, sha);
      const parts = splitMarkdown(sel.title, markdown, profile.repositoryUrl.replace('https://github.com/', ''));
      for (let pi = 0; pi < parts.length; pi++) {
        const partTitle = parts.length > 1 ? `${sel.title} — Part ${pi + 1}/${parts.length}` : sel.title;
        const r = await apiPost<{ jobId: string; duplicate: boolean }>('/api/ingestion', {
          platformSlug: profile.slug,
          blueprintSlug: sel.blueprint.slug,
          blueprintTitle: sel.blueprint.title,
          title: partTitle,
          docType: sel.docType,
          content: parts[pi],
          documentVersion: `github-main-${sha}`,
        });
        results.push({ title: partTitle, jobId: r.jobId, duplicate: r.duplicate });
        console.log(`  ${r.duplicate ? 'DUPLICATE' : 'QUEUED'}: ${partTitle} [${sel.docType}] (${Math.round(parts[pi].length / 1024)}KB)`);
        if (!r.duplicate) {
          // Serial pipeline: embeddings are CPU-bound; a concurrent burst can
          // exhaust a single dev-server process (learned in Task 22). 75s ≈
          // the serverless after()-window cap — bigger docs checkpoint
          // progress and are resumed by a later re-run (resume-safe §58).
          const waitDeadline = Date.now() + 75_000;
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
            if (Date.now() > waitDeadline) { console.log('    ⏱ window elapsed (job checkpoints progress; re-run resumes it)'); break; }
          }
        }
      }
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${sel.path} — ${err instanceof Error ? err.message.slice(0, 80) : 'err'}`);
      await sleep(8000); // server may be restarting after a burst — back off
    }
  }

  // Poll job completion (bounded wait).
  const ids = new Set(results.filter((r) => !r.duplicate).map((r) => r.jobId));
  const deadline = Date.now() + 8 * 60 * 1000;
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
    `${profile.slug} SUMMARY: ${results.length} submitted (${dupCount} duplicates), ${okCount} completed, ${failCount} failed, ${failed} submit-errors`
  );
}

async function main(): Promise<void> {
  if (!PLATFORMS_ARG) {
    console.error('usage: bun scripts/ingest-platform.ts --platform <slug[,slug2…]|all> [--app url] [--repos dir] [--dry-run] [--no-connect]');
    console.error(`profiles: ${profiles.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }
  const wanted = PLATFORMS_ARG === 'all'
    ? profiles.map((p) => p.slug)
    : PLATFORMS_ARG.split(',').map((s) => s.trim()).filter(Boolean);
  for (const slug of wanted) {
    const profile = profiles.find((p) => p.slug === slug);
    if (!profile) {
      console.error(`unknown platform '${slug}' (known: ${profiles.map((p) => p.slug).join(', ')})`);
      continue;
    }
    await ingestPlatform(profile);
  }
}

main().catch((e) => {
  console.error('ingest failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
