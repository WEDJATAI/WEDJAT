// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 30 — Trade-knowledge corpus ingestion (external public sources).
//
// Walks db/trade-corpus/<domain>/docs/*.md (compiled by build-hs-chapters.ts
// and the Task 30 research subagents), parses a simple frontmatter contract,
// maps domain+category → platform + blueprint, §88-registry-connects the
// platform, and submits every document through the REAL intake pipeline
// (POST /api/ingestion) with the standard job polling. Idempotent: the API
// de-duplicates by content hash (§30/§58) — re-running never duplicates.
//
// Frontmatter contract (exact):
//   ---
//   title: "..."            (required, quoted if it contains dashes)
//   docType: REFERENCE|SPEC (optional, default REFERENCE)
//   domain: hs|freight|customs|entities   (required)
//   category: overview|chapter|encyclopedia|incoterms|carrier|country
//   jurisdiction: GLOBAL|<Country>        (optional)
//   sources:                (required, list of URLs)
//     - https://…
//   ---
//
// Usage:
//   bun scripts/ingest-trade-knowledge.ts --dry-run
//   bun scripts/ingest-trade-knowledge.ts --domain hs
//   bun scripts/ingest-trade-knowledge.ts --app https://wedjat-ai.vercel.app --parallel 4
// Flags: --app <url>  --domain <d[,d2…]|all>  --dry-run  --no-connect  --parallel N
// ═══════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const APP = arg('app') ?? 'http://localhost:3000';
const ROOT = 'scripts/trade-corpus';
const DRY_RUN = has('dry-run');
const CONNECT = !has('no-connect');
const DOMAINS_ARG = arg('domain') ?? 'all';
const CORPUS_VERSION = 'trade-corpus-2026-09-14';
// Serial against LOCAL dev server (embeddings are CPU-bound in one process —
// Task 22/27/28 OOM lesson); parallel 4–6 against serverless --app targets.
const PARALLEL = Math.max(1, Math.min(6, parseInt(arg('parallel') ?? '1', 10) || 1));

// ── Domain → platform/blueprint configuration ────────────────────────────────

interface BlueprintMap { [category: string]: { slug: string; title: string } }
interface DomainConfig {
  platformSlug: string;
  platformName: string;
  repositoryUrl: string;
  description: string;
  blueprints: BlueprintMap;
  folder: string;
}

const DOMAINS: DomainConfig[] = [
  {
    platformSlug: 'trade-hs',
    platformName: 'TRADE HS CODES',
    repositoryUrl: 'https://github.com/datasets/harmonized-system',
    description: 'Universal WCO Harmonized System tariff nomenclature (UN Comtrade 6-digit dataset, PDDL) — chapter-by-chapter reference for product classification.',
    folder: 'hs',
    blueprints: {
      overview: { slug: 'trade-hs-overview', title: 'HS Nomenclature Overview & Structure' },
      chapter: { slug: 'trade-hs-chapters', title: 'HS Chapters — Headings & Subheadings' },
    },
  },
  {
    platformSlug: 'trade-freight',
    platformName: 'TRADE FREIGHT & SHIPPING DOCS',
    repositoryUrl: 'https://www.bimco.org/',
    description: 'Sea freight, port and carrier documentation reference — trade documents encyclopedia, Incoterms 2020, container operations, and shipping-line documentation requirements.',
    folder: 'freight',
    blueprints: {
      encyclopedia: { slug: 'trade-freight-documents', title: 'Freight & Trade Documents Encyclopedia' },
      incoterms: { slug: 'trade-freight-incoterms', title: 'Incoterms 2020 Reference' },
      carrier: { slug: 'trade-freight-carriers', title: 'Shipping Lines & Carrier Documentation' },
      operations: { slug: 'trade-freight-operations', title: 'Port, Container & Cargo Operations' },
    },
  },
  {
    platformSlug: 'trade-customs',
    platformName: 'TRADE CUSTOMS COUNTRY GUIDES',
    repositoryUrl: 'https://www.tfadatabase.org/',
    description: 'Per-country import and export customs documentation guides — required documents, procedures, authorities and single-window portals, compiled from official public sources.',
    folder: 'customs',
    blueprints: {
      country: { slug: 'trade-customs-guides', title: 'Country Import/Export Customs Guides' },
    },
  },
  {
    platformSlug: 'trade-entities',
    platformName: 'TRADE COMPANY ENTITIES',
    repositoryUrl: 'https://en.wikipedia.org/wiki/Types_of_business_entity',
    description: 'Company-type and legal-entity structuring reference per country — forms, liability, capital, registration authorities and trade suitability.',
    folder: 'entities',
    blueprints: {
      country: { slug: 'trade-entities-guides', title: 'Country Company & Entity Structure Guides' },
    },
  },
];

// ── Frontmatter parsing (controlled subset) ──────────────────────────────────

interface Frontmatter {
  title?: string;
  docType?: string;
  domain?: string;
  category?: string;
  jurisdiction?: string;
  sources: string[];
}

function parseDoc(path: string): { fm: Frontmatter; body: string } | null {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  const fm: Frontmatter = { sources: [] };
  let lastKey = '';
  for (const line of fmText.split('\n')) {
    if (/^\s+-\s+/.test(line) && lastKey === 'sources') {
      const u = line.replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, '');
      if (u) fm.sources.push(u);
    } else {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
      if (!m) { lastKey = ''; continue; }
      const key = m[1];
      let value = m[2].trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (key === 'sources') { lastKey = 'sources'; continue; }
      lastKey = key;
      if (key === 'title') fm.title = value;
      else if (key === 'docType') fm.docType = value;
      else if (key === 'domain') fm.domain = value;
      else if (key === 'category') fm.category = value;
      else if (key === 'jurisdiction') fm.jurisdiction = value;
    }
  }
  return { fm, body };
}

// ── Pipeline client (same contract as ingest-platform.ts) ────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!json.ok) throw new Error(`API ${json.error?.code}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function listJobs(): Promise<{ id: string; status: string; progress: number; lastError: string | null }[]> {
  const res = await fetch(`${APP}/api/jobs?limit=100`);
  const json = (await res.json()) as { ok: boolean; data?: unknown };
  const d = json.data as { jobs?: { id: string; status: string; progress: number; lastError: string | null }[] } | { id: string; status: string; progress: number; lastError: string | null }[] | undefined;
  if (Array.isArray(d)) return d;
  return d?.jobs ?? [];
}

/** Split oversized markdown at heading boundaries (serverless after() window). */
const SPLIT_THRESHOLD = 70_000;
function splitMarkdown(title: string, markdown: string): string[] {
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
  const total = parts.length;
  return parts.map((p, i) =>
    total === 1 ? p : `# ${title} — Part ${i + 1} of ${total}\n\nContinuation of \`${title}\` (trade corpus ${CORPUS_VERSION}).\n\n${p}`
  );
}

// ── Ingestion ────────────────────────────────────────────────────────────────

interface Doc {
  file: string;
  platform: DomainConfig;
  blueprintSlug: string;
  blueprintTitle: string;
  title: string;
  docType: string;
  content: string;
  kb: number;
}

function collectDocs(domain: DomainConfig): { docs: Doc[]; errors: string[] } {
  const dir = join(ROOT, domain.folder, 'docs');
  const docs: Doc[] = [];
  const errors: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    errors.push(`no docs folder: ${dir}`);
    return { docs, errors };
  }
  for (const f of files) {
    const path = join(dir, f);
    try {
      const parsed = parseDoc(path);
      if (!parsed) { errors.push(`${f}: missing/invalid frontmatter`); continue; }
      const { fm, body } = parsed;
      if (!fm.title) { errors.push(`${f}: frontmatter title required`); continue; }
      const category = fm.category ?? 'country';
      const bp = domain.blueprints[category];
      if (!bp) { errors.push(`${f}: unknown category '${category}' (known: ${Object.keys(domain.blueprints).join('/')})`); continue; }
      if (fm.sources.length === 0) { errors.push(`${f}: frontmatter requires at least one source URL`); continue; }
      const body2 = body.length > 400 ? body : body; // min length checked below
      const content = [
        `# ${fm.title}`,
        '',
        `Jurisdiction: ${fm.jurisdiction ?? 'GLOBAL'} · Category: ${category} · Corpus version: ${CORPUS_VERSION}`,
        '',
        `Sources: ${fm.sources.join(' , ')}`,
        '',
        body2,
      ].join('\n');
      if (content.trim().length < 400) { errors.push(`${f}: body too short (<400 chars)`); continue; }
      const parts = splitMarkdown(fm.title, content);
      for (let pi = 0; pi < parts.length; pi++) {
        docs.push({
          file: f,
          platform: domain,
          blueprintSlug: bp.slug,
          blueprintTitle: bp.title,
          title: parts.length > 1 ? `${fm.title} — Part ${pi + 1}/${parts.length}` : fm.title,
          docType: fm.docType && /^[A-Z]+$/.test(fm.docType) ? fm.docType : 'REFERENCE',
          content: parts[pi],
          kb: Math.round(parts[pi].length / 1024),
        });
      }
    } catch (err) {
      errors.push(`${f}: ${err instanceof Error ? err.message.slice(0, 80) : 'read error'}`);
    }
  }
  return { docs, errors };
}

async function connectPlatform(domain: DomainConfig): Promise<void> {
  const dto = await apiPost<unknown>(`/api/fabric/registry/${domain.platformSlug}/connect`, {
    repositoryUrl: domain.repositoryUrl,
    deploymentUrl: undefined,
    databaseUrl: undefined,
  });
  void dto;
  console.log(`  ✓ registry CONNECTED: ${domain.platformSlug}`);
}

async function main(): Promise<void> {
  const wantedDomains = DOMAINS_ARG === 'all'
    ? DOMAINS.map((d) => d.platformSlug)
    : DOMAINS_ARG.split(',').map((s) => s.trim()).filter(Boolean);

  const grandTotals = { submitted: 0, duplicates: 0, completed: 0, failed: 0, submitErrors: 0 };

  for (const domain of DOMAINS) {
    // accept either the platform slug (trade-hs) or the folder name (hs)
    if (!wantedDomains.some((w) => w === domain.platformSlug || w === domain.folder)) continue;
    console.log(`\n──────────────────────────────────────────────────────`);
    console.log(`${domain.platformName} (${domain.platformSlug}) → ${APP}`);
    const { docs, errors } = collectDocs(domain);
    for (const e of errors) console.log(`  ✗ ${e}`);
    const totalKB = Math.round(docs.reduce((s, d) => s + d.kb, 0));
    console.log(`  collected ${docs.length} documents (~${totalKB}KB) from ${domain.folder}/docs`);
    if (docs.length === 0) continue;
    if (DRY_RUN) {
      for (const d of docs) console.log(`  DRY: [${d.docType}] ${d.title} → ${d.blueprintSlug} (${d.kb}KB)`);
      continue;
    }

    if (CONNECT) {
      try { await connectPlatform(domain); }
      catch (err) {
        console.error(`  ✗ registry connect failed: ${err instanceof Error ? err.message : err}`);
        continue;
      }
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
            blueprintSlug: d.blueprintSlug,
            blueprintTitle: d.blueprintTitle,
            title: d.title,
            docType: d.docType,
            content: d.content,
            // The API maps `version` → BlueprintVersion: a corpus-wide shared
            // version keeps all docs on ONE CURRENT row (per-doc versions
            // supersede each other and strand earlier docs — Task 30 lesson).
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
              if (Date.now() > waitDeadline) { console.log('    ⏱ window elapsed (job checkpoints progress; self-heal requeues it)'); break; }
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

    // final drain poll
    const ids = new Set(results.filter((r) => !r.duplicate).map((r) => r.jobId));
    const deadline = Date.now() + 10 * 60 * 1000;
    let completed = 0;
    while (Date.now() < deadline && completed < ids.size) {
      await sleep(4000);
      const jobs = await listJobs();
      completed = 0;
      for (const j of jobs) if (ids.has(j.id) && (j.status === 'COMPLETED' || j.status === 'FAILED')) completed++;
    }
    const finalJobs = await listJobs();
    const byId = new Map(finalJobs.map((j) => [j.id, j]));
    let ok = 0, fail = 0;
    for (const r of results) {
      const j = byId.get(r.jobId);
      if (!j) continue;
      if (j.status === 'COMPLETED') ok++;
      else if (j.status === 'FAILED') { fail++; console.log(`  JOB FAILED: ${r.title} — ${(j.lastError ?? '').slice(0, 100)}`); }
    }
    const dup = results.filter((r) => r.duplicate).length;
    console.log(`${domain.platformSlug} SUMMARY: ${results.length} submitted (${dup} duplicates), ${ok} completed, ${fail} failed, ${submitErrors} submit-errors`);
    grandTotals.submitted += results.length;
    grandTotals.duplicates += dup;
    grandTotals.completed += ok;
    grandTotals.failed += fail;
    grandTotals.submitErrors += submitErrors;
  }
  if (!DRY_RUN) {
    console.log(`\nTRADE CORPUS TOTALS: ${grandTotals.submitted} submitted, ${grandTotals.completed} completed, ${grandTotals.duplicates} duplicates, ${grandTotals.failed} failed, ${grandTotals.submitErrors} submit-errors`);
  }
}

main().catch((e) => {
  console.error('ingest failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
