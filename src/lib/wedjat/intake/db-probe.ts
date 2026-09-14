// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §34/§35 — Platform DATABASE intelligence core (shared library).
//
// WHY a shared core: the platform Turso credentials exist ONLY in the
// environment that runs the probe (production Vercel env after local sandbox
// resets wiped .env.local twice). The ADMIN API route imports this module so
// the SERVER can download database intel using its own env — tokens are read
// from process.env ONLY and are never printed, echoed, logged, or persisted
// (§41 secret discipline).
//
// Introspection is strictly READ-ONLY:
//   • table inventory with live row counts (measured, never invented §5)
//   • column names + types parsed from the DDL (sqlite_master)
//   • total volume summary
// The result is published as a versioned markdown knowledge document through
// the REAL ingestion pipeline under blueprint <slug>-database (§58 append-only).
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';

// ── Platform database coordinates (tokens stay env-only) ────────────────────

export interface DbTarget {
  slug: string;
  name: string;
  urlEnv: string;
  tokenEnv: string;
  repositoryUrl: string;
  deploymentUrl: string;
  databaseUrl: string;
}

export const DB_TARGETS: DbTarget[] = [
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
    // repositoryUrl = the REAL MITHQAL flagship repo (Task 26 source of
    // record); the 5KB MITHQALMTQ/MTQ stub is deprecated as a coordinate.
    slug: 'mtq',
    name: 'MITHQAL MTQ',
    urlEnv: 'MTQ_TURSO_URL',
    tokenEnv: 'MTQ_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/MITHQALMTQ/mithqal',
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
  {
    // Master-prompt platform A (cirkle-superapp). Instance URL read from the
    // repo's own push-turso references (mashahd-fortleem, aws-us-east-1).
    slug: 'mashahd',
    name: 'MASHAHD',
    urlEnv: 'MASHAHD_TURSO_URL',
    tokenEnv: 'MASHAHD_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/cirkle-superapp/mashahd',
    deploymentUrl: 'https://mashahd.vercel.app',
    databaseUrl: 'libsql://mashahd-fortleem.aws-us-east-1.turso.io',
  },
  {
    // Master-prompt platform B. The verify-specific instance is
    // validate-fortleem (aws-us-east-2, referenced by scripts in the repo);
    // cirkle-fortleem is the shared CIRKLE core DB, not VERIFY's own.
    slug: 'verify',
    name: 'CIRKLE VERIFY',
    urlEnv: 'VERIFY_TURSO_URL',
    tokenEnv: 'VERIFY_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/cirkle-superapp/verify',
    deploymentUrl: 'https://cirkle-verify.vercel.app',
    databaseUrl: 'libsql://validate-fortleem.aws-us-east-2.turso.io',
  },
  {
    // Master-prompt platform C. Instance URL published in the repo README.
    slug: 'wasl',
    name: 'WASL',
    urlEnv: 'WASL_TURSO_URL',
    tokenEnv: 'WASL_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/cirkle-superapp/wasl',
    deploymentUrl: 'https://cirkle-wasl.vercel.app',
    databaseUrl: 'libsql://wasl-fortleem.aws-us-east-1.turso.io',
  },
  {
    // Master-prompt platform G ("Turso — Judge"). The platform knowledge
    // already lives under registry slug 'judge' (judge_synapse ingestion);
    // this target extends §34/§35 database learning to its live instance.
    slug: 'judge',
    name: 'JUDGE SMART',
    urlEnv: 'JUDGE_TURSO_URL',
    tokenEnv: 'JUDGE_TURSO_TOKEN',
    repositoryUrl: 'https://github.com/fortleem/judge_synapse',
    deploymentUrl: 'https://judge-smart.vercel.app',
    databaseUrl: 'libsql://judge-fortleem.aws-us-east-1.turso.io',
  },
];

// ── Introspection (read-only) ───────────────────────────────────────────────

export interface TableInfo {
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

/** Read-only live introspection: sqlite_master DDL + COUNT(*) per table. */
export async function introspectDatabase(url: string, token: string): Promise<TableInfo[]> {
  const client = createClient({ url, authToken: token });
  try {
    // One round trip: table names + full DDL (columns parsed locally —
    // per-table PRAGMA round trips proved too slow over the remote link).
    const master = await client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const out: TableInfo[] = [];
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
    }
    return out;
  } finally {
    client.close();
  }
}

// ── Snapshot markdown (measured values only — §5) ───────────────────────────

export function buildSnapshotMarkdown(target: DbTarget, tables: TableInfo[]): string {
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
  lines.push(`| Method | read-only \`sqlite_master\` + \`COUNT(*)\` (server-side probe) |`);
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

// ── Split oversized snapshots (serverless after() window ~60s; §30/§58) ───────

const SPLIT_THRESHOLD = 70_000;

export function splitSnapshotMarkdown(title: string, markdown: string): string[] {
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
  const total = sliced.length;
  return sliced.map((p, i) =>
    total === 1 ? p : `# ${title} — Part ${i + 1} of ${total}\n\nContinuation of the ${title} (live Turso introspection).\n\n${p}`
  );
}
