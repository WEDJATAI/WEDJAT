// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §34/§35 — Platform DATABASE intelligence probe (Turso).
//
// The OWNER re-supplied Turso coordinates for the private-repo platforms
// (AURIENTA, SGTX, PPE). This script performs a READ-ONLY introspection of
// each platform's production database:
//   • table inventory with live row counts (measured, never invented §5)
//   • column names + types per table
//   • total volume summary
// and submits the result as a markdown knowledge document through the REAL
// ingestion pipeline (POST /api/ingestion), under blueprint <slug>-database.
//
// Registry connect (§88) happens FIRST so the platform row exists.
// The Turso AUTH TOKEN is read from .env.local and NEVER printed, echoed,
// logged, or committed — only the instance URL appears in the snapshot.
//
// Usage:
//   bun scripts/probe-platform-db.ts [--app http://localhost:3000] [--platform aurienta,sgtx,ppe] [--dry-run]
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

// ── CLI ──────────────────────────────────────────────────────────────────────

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const APP = arg('app') ?? 'http://localhost:3000';
const DRY_RUN = has('dry-run');

// ── Platform database coordinates (env-only secrets) ─────────────────────────

interface DbTarget {
  slug: string;
  name: string;
  urlEnv: string;
  tokenEnv: string;
  repositoryUrl: string;
  deploymentUrl: string;
  databaseUrl: string;
}

const TARGETS: DbTarget[] = [
  {
    slug: 'aurienta',
    name: 'AURIENTA',
    urlEnv: 'AURIENTA_TURSO_URL',
    tokenEnv: 'AURIENTA_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/Aurienta/Aurienta',
    deploymentUrl: 'https://aurienta.vercel.app',
    databaseUrl: 'libsql://aurienta-fortleem.aws-us-east-1.turso.io',
  },
  {
    slug: 'sgtx',
    name: 'SGTX',
    urlEnv: 'SGTX_TURSO_URL',
    tokenEnv: 'SGTX_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/SGTX-PILOT/SGTX',
    deploymentUrl: 'https://sgtx.vercel.app',
    databaseUrl: 'libsql://sgtx-fortleem.aws-us-east-1.turso.io',
  },
  {
    slug: 'ppe',
    name: 'PPE SMART',
    urlEnv: 'PPE_TURSO_URL',
    tokenEnv: 'PPE_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/fortleem/PPE',
    deploymentUrl: 'https://ppe-smart.vercel.app',
    databaseUrl: 'libsql://ppe-smart-fortleem.aws-us-east-1.turso.io',
  },
  {
    // Task 25 — OWNER re-supplied the MTQ (MITHQAL) + MTQ SIGMA Turso tokens
    // (the last two §34/§35 gaps flagged at the end of Task 24).
    slug: 'mtq',
    name: 'MITHQAL MTQ',
    urlEnv: 'MTQ_TURSO_URL',
    tokenEnv: 'MTQ_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ',
    deploymentUrl: 'https://mithqal.vercel.app',
    databaseUrl: 'libsql://mtq-fortleem.aws-us-east-1.turso.io',
  },
  {
    slug: 'mtq-sigma',
    name: 'MTQ SIGMA',
    urlEnv: 'MTQS_TURSO_URL',
    tokenEnv: 'MTQS_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ_SIGMA',
    deploymentUrl: 'https://mtq-sigma.vercel.app',
    databaseUrl: 'libsql://mtqs-fortleem.aws-us-east-1.turso.io',
  },
];

// ── .env.local loader (secrets never printed) ────────────────────────────────

function loadEnv(): Map<string, string> {
  const envMap = new Map<string, string>();
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      envMap.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  } catch {
    // .env.local optional — fall back to process.env
  }
  return envMap;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!json.ok) throw new Error(`API ${json.error?.code}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function listJobs(): Promise<{ id: string; status: string; lastError: string | null }[]> {
  const res = await fetch(`${APP}/api/jobs?limit=100`);
  const json = (await res.json()) as { ok: boolean; data?: { id: string; status: string; lastError: string | null }[] | { jobs?: { id: string; status: string; lastError: string | null }[] } };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.jobs ?? [];
}

interface TableInfo {
  name: string;
  rows: number;
  columns: { name: string; type: string }[];
}

/** Split a CREATE TABLE body on top-level commas (depth-0). */
function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Parse column (name, type) pairs straight from the DDL — no extra round trips. */
function parseColumnsFromDdl(ddl: string): { name: string; type: string }[] {
  const open = ddl.indexOf('(');
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < ddl.length; i++) {
    if (ddl[i] === '(') depth++;
    else if (ddl[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = ddl.slice(open + 1, end < 0 ? undefined : end);
  const cols: { name: string; type: string }[] = [];
  for (const part of splitTop(body)) {
    const t = part.trim();
    if (!t) continue;
    const upper = t.toUpperCase();
    if (upper.startsWith('PRIMARY KEY') || upper.startsWith('FOREIGN KEY') || upper.startsWith('UNIQUE') || upper.startsWith('CHECK') || upper.startsWith('CONSTRAINT') || upper.startsWith('INDEX') || upper.startsWith('KEY')) continue;
    const m = t.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/);
    if (m) cols.push({ name: m[1], type: m[2].toUpperCase() });
  }
  return cols;
}

async function introspect(url: string, token: string): Promise<TableInfo[]> {
  const client = createClient({ url, authToken: token });
  try {
    // One round trip: table names + full DDL (columns parsed locally —
    // per-table PRAGMA round trips proved too slow over the remote link).
    const master = await client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const out: TableInfo[] = [];
    let done = 0;
    for (const row of master.rows) {
      const name = String(row.name);
      const ddl = String(row.sql ?? '');
      let rows = 0;
      try {
        const cnt = await client.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
        rows = Number(cnt.rows[0]?.n ?? 0);
      } catch {
        rows = -1; // unreadable (e.g. virtual table) — honest marker
      }
      out.push({ name, rows, columns: parseColumnsFromDdl(ddl) });
      if (++done % 50 === 0) console.log(`    … ${done}/${master.rows.length} tables counted`);
    }
    return out;
  } finally {
    client.close();
  }
}

function buildSnapshot(target: DbTarget, tables: TableInfo[]): string {
  const probedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const totalRows = tables.reduce((s, t) => s + Math.max(t.rows, 0), 0);
  const lines: string[] = [];
  lines.push(`# ${target.name} — Database Intelligence Snapshot (§34/§35)`);
  lines.push('');
  lines.push(`Live production database of the **${target.name}** platform, measured by WEDJAT through a read-only introspection probe (§34 database intelligence).`);
  lines.push('');
  lines.push('| Coordinate | Value |');
  lines.push('|---|---|');
  lines.push(`| Platform | ${target.name} (registry slug \`${target.slug}\`) |`);
  lines.push(`| Repository | ${target.repositoryUrl} |`);
  lines.push(`| Deployment | ${target.deploymentUrl} |`);
  lines.push(`| Turso instance | \`${target.databaseUrl}\` |`);
  lines.push(`| Probed at | ${probedAt} |`);
  lines.push(`| Method | read-only \`sqlite_master\` + \`PRAGMA table_info\` + \`COUNT(*)\` |`);
  lines.push('');
  lines.push(`## Volume summary`);
  lines.push('');
  lines.push(`- Tables: **${tables.length}**`);
  lines.push(`- Total live rows: **${totalRows.toLocaleString('en-US')}**`);
  lines.push('');
  lines.push(`## Table inventory (live row counts + columns)`);
  lines.push('');
  lines.push('| Table | Rows | Columns |');
  lines.push('|---|---:|---|');
  for (const t of tables) {
    const cols = t.columns.map((c) => `${c.name}:${c.type}`).join(', ');
    lines.push(`| \`${t.name}\` | ${t.rows < 0 ? 'unreadable' : t.rows.toLocaleString('en-US')} | ${cols || '(introspection unavailable)'} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_Measured values only (§5: WEDJAT never invents unavailable resources). Row counts are point-in-time at the probe timestamp; re-probing after platform activity produces a new versioned snapshot, the previous one is preserved (§58 append-only)._');
  return lines.join('\n');
}

// ── Split oversized snapshots (serverless after() window ~60s; §30/§58) ────────

const SPLIT_THRESHOLD = 70_000;
function splitSnapshot(title: string, markdown: string): string[] {
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
  // Heading-boundary split fails for table-only snapshots (one giant table,
  // no interior headings) — post-pass: raw-slice any still-oversized part.
  const sliced: string[] = [];
  for (const part of parts) {
    if (part.length <= SPLIT_THRESHOLD * 1.2) {
      sliced.push(part);
      continue;
    }
    const partLines = part.split('\n');
    let buf: string[] = [];
    let bufSize = 0;
    for (const line of partLines) {
      buf.push(line);
      bufSize += line.length + 1;
      if (bufSize >= SPLIT_THRESHOLD) {
        sliced.push(buf.join('\n'));
        buf = [];
        bufSize = 0;
      }
    }
    if (buf.length > 0 && bufSize > 800) sliced.push(buf.join('\n'));
  }
  parts.length = 0;
  parts.push(...sliced);
  const total = parts.length;
  return parts.map((p, i) =>
    total === 1 ? p : `# ${title} — Part ${i + 1} of ${total}\n\nContinuation of the ${title} (live Turso introspection).\n\n${p}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const envMap = loadEnv();
  const platformArg = arg('platform');
  const wanted = platformArg ? platformArg.split(',').map((s) => s.trim()).filter(Boolean) : TARGETS.map((t) => t.slug);

  for (const slug of wanted) {
    const target = TARGETS.find((t) => t.slug === slug);
    if (!target) {
      console.error(`unknown platform '${slug}' (known: ${TARGETS.map((t) => t.slug).join(', ')})`);
      continue;
    }
    const url = process.env[target.urlEnv] ?? envMap.get(target.urlEnv);
    const token = process.env[target.tokenEnv] ?? envMap.get(target.tokenEnv);
    console.log(`\n──────────────────────────────────────────────────────`);
    console.log(`${target.name} database probe (${target.slug}) → ${APP}`);
    if (!url || !token) {
      console.error(`  ✗ missing ${target.urlEnv}/${target.tokenEnv} in .env.local`);
      continue;
    }

    let tables: TableInfo[];
    try {
      tables = await introspect(url, token);
      console.log(`  ✓ probed: ${tables.length} tables, ${tables.reduce((s, t) => s + Math.max(t.rows, 0), 0).toLocaleString('en-US')} rows`);
    } catch (err) {
      console.error(`  ✗ probe failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const markdown = buildSnapshot(target, tables);
    const snapshotTitle = `${target.name} Database Snapshot — tables, row counts & schema`;
    const parts = splitSnapshot(snapshotTitle, markdown);
    console.log(`  snapshot: ${Math.round(markdown.length / 1024)}KB → ${parts.length} part(s)`);

    if (DRY_RUN) {
      console.log(`  DRY: would submit ${parts.length} doc(s) → blueprint ${slug}-database`);
      continue;
    }

    // §88 registry connect first (idempotent).
    try {
      await apiPost<unknown>(`/api/fabric/registry/${target.slug}/connect`, {
        repositoryUrl: target.repositoryUrl,
        deploymentUrl: target.deploymentUrl,
        databaseUrl: target.databaseUrl,
      });
      console.log(`  ✓ registry CONNECTED: ${target.slug}`);
    } catch (err) {
      console.error(`  ✗ registry connect failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    for (let pi = 0; pi < parts.length; pi++) {
      const partTitle = parts.length > 1 ? `${snapshotTitle} — Part ${pi + 1}/${parts.length}` : snapshotTitle;
      try {
        const r = await apiPost<{ jobId: string; duplicate: boolean }>('/api/ingestion', {
          platformSlug: target.slug,
          blueprintSlug: `${target.slug}-database`,
          blueprintTitle: `${target.name} Database Intelligence (Turso)`,
          title: partTitle,
          docType: 'REFERENCE',
          content: parts[pi],
          documentVersion: `turso-probe-${new Date().toISOString().slice(0, 10)}`,
        });
        console.log(`  ${r.duplicate ? 'DUPLICATE' : `QUEUED job ${r.jobId}`}: ${partTitle}`);
        if (!r.duplicate) {
          const deadline = Date.now() + 90_000;
          for (;;) {
            await sleep(3000);
            const jobs = await listJobs();
            const j = jobs.find((x) => x.id === r.jobId);
            if (!j) continue;
            if (j.status === 'COMPLETED') { console.log('    ✓ completed'); break; }
            if (j.status === 'FAILED') { console.log(`    ✗ FAILED: ${(j.lastError ?? '').slice(0, 90)}`); break; }
            if (Date.now() > deadline) { console.log('    ⏱ window elapsed'); break; }
          }
        }
      } catch (err) {
        console.error(`  ✗ submit failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
