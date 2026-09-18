// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 31 — WASL deep database probe (§34/§35 database intelligence).
//
// Goes beyond the generic schema/row-count snapshot: measures SAFE aggregate
// distributions (enum breakdowns, boolean ratios, activity windows) from the
// live WASL production database. NEVER extracts message content, usernames,
// emails, or any user-identifying material — counts and enum values only
// (§5/§41 privacy discipline). Token read from .env.local, never printed.
//
// Usage: bun scripts/probe-wasl-db.ts [--json out.json]
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ── env ──────────────────────────────────────────────────────────────────────

function loadEnv(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      m.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  } catch { /* optional */ }
  return m;
}

const env = loadEnv();
const URL = env.get('WASL_TURSO_URL') ?? process.env.WASL_TURSO_URL;
const TOKEN = env.get('WASL_TURSO_TOKEN') ?? process.env.WASL_TURSO_TOKEN;
if (!URL || !TOKEN) { console.error('Need WASL_TURSO_URL / WASL_TURSO_TOKEN'); process.exit(1); }

const outIdx = process.argv.indexOf('--json');
const jsonPath = outIdx >= 0 ? process.argv[outIdx + 1] : 'scripts/platform-db-corpus/wasl/probe-results.json';

// ── helpers ──────────────────────────────────────────────────────────────────

interface TableInfo { name: string; rows: number; columns: { name: string; type: string }[] }

function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseColumns(ddl: string): { name: string; type: string }[] {
  const open = ddl.indexOf('(');
  if (open < 0) return [];
  let depth = 0, end = -1;
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
    if (upper.startsWith('PRIMARY KEY') || upper.startsWith('FOREIGN KEY') || upper.startsWith('UNIQUE') ||
        upper.startsWith('CHECK') || upper.startsWith('CONSTRAINT') || upper.startsWith('INDEX') || upper.startsWith('KEY')) continue;
    const m = t.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/);
    if (m) cols.push({ name: m[1], type: m[2].toUpperCase() });
  }
  return cols;
}

async function main(): Promise<void> {
  const client = createClient({ url: URL, authToken: TOKEN });
  const result: Record<string, unknown> = {
    probedAt: new Date().toISOString(),
    instance: URL, // published coordinate, not a secret
  };

  try {
    // 1. schema inventory
    const master = await client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const tables: TableInfo[] = [];
    for (const row of master.rows) {
      const name = String(row.name);
      const ddl = String(row.sql ?? '');
      let rows = 0;
      try {
        const cnt = await client.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
        rows = Number(cnt.rows[0]?.n ?? 0);
      } catch { rows = -1; }
      tables.push({ name, rows, columns: parseColumns(ddl) });
    }
    result.tables = tables;
    result.tableCount = tables.length;
    result.totalRows = tables.reduce((s, t) => s + Math.max(t.rows, 0), 0);
    console.log(`tables: ${tables.length}, total rows: ${result.totalRows}`);

    // 2. SAFE aggregate distributions (enum fields only — never content)
    const dists: Record<string, { value: string; count: number }[]> = {};
    const distQueries: [string, string][] = [
      ['message.type', `SELECT type AS v, COUNT(*) AS c FROM Message GROUP BY type ORDER BY c DESC`],
      ['message.status', `SELECT status AS v, COUNT(*) AS c FROM Message GROUP BY status ORDER BY c DESC`],
      ['message.protected', `SELECT CASE protected WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END AS v, COUNT(*) AS c FROM Message GROUP BY protected ORDER BY c DESC`],
      ['commit.status', `SELECT status AS v, COUNT(*) AS c FROM "Commit" GROUP BY status ORDER BY c DESC`],
      ['commit.type', `SELECT type AS v, COUNT(*) AS c FROM "Commit" GROUP BY type ORDER BY c DESC`],
      ['commit.currency', `SELECT currency AS v, COUNT(*) AS c FROM "Commit" GROUP BY currency ORDER BY c DESC`],
      ['commit.counterpartySigned', `SELECT CASE counterpartySigned WHEN 1 THEN 'true' ELSE 'false' END AS v, COUNT(*) AS c FROM "Commit" GROUP BY counterpartySigned ORDER BY c DESC`],
      ['conversation.isGroup', `SELECT CASE isGroup WHEN 1 THEN 'group' ELSE 'direct' END AS v, COUNT(*) AS c FROM Conversation GROUP BY isGroup ORDER BY c DESC`],
      ['business.status', `SELECT status AS v, COUNT(*) AS c FROM Business GROUP BY status ORDER BY c DESC`],
      ['business.verified', `SELECT CASE verified WHEN 1 THEN 'true' ELSE 'false' END AS v, COUNT(*) AS c FROM Business GROUP BY verified ORDER BY c DESC`],
      ['user.verified', `SELECT CASE verified WHEN 1 THEN 'true' ELSE 'false' END AS v, COUNT(*) AS c FROM User GROUP BY verified ORDER BY c DESC`],
      ['user.ghostMode', `SELECT CASE ghostMode WHEN 1 THEN 'true' ELSE 'false' END AS v, COUNT(*) AS c FROM User GROUP BY ghostMode ORDER BY c DESC`],
      ['user.defaultProtectMessages', `SELECT CASE defaultProtectMessages WHEN 1 THEN 'true' ELSE 'false' END AS v, COUNT(*) AS c FROM User GROUP BY defaultProtectMessages ORDER BY c DESC`],
      ['story.expiresWindow', `SELECT CASE WHEN expiresAt > datetime('now') THEN 'live' ELSE 'expired' END AS v, COUNT(*) AS c FROM Story GROUP BY v ORDER BY c DESC`],
      ['poll.mode', `SELECT mode AS v, COUNT(*) AS c FROM Poll GROUP BY mode ORDER BY c DESC`],
    ];
    for (const [key, sql] of distQueries) {
      try {
        const res = await client.execute(sql);
        dists[key] = res.rows.map((r) => ({ value: String(r.v ?? 'null'), count: Number(r.c) }));
      } catch { /* table/column absent — skip honestly */ }
    }
    result.distributions = dists;

    // 3. scalar aggregates (no content)
    const scalars: Record<string, number> = {};
    const scalarQueries: [string, string][] = [
      ['users.total', `SELECT COUNT(*) AS v FROM User`],
      ['users.withAbout', `SELECT COUNT(*) AS v FROM User WHERE about != 'Hey there! I am using Wasl.'`],
      ['contacts.total', `SELECT COUNT(*) AS v FROM Contact`],
      ['phonenumbers.total', `SELECT COUNT(*) AS v FROM PhoneNumber`],
      ['messages.total', `SELECT COUNT(*) AS v FROM Message`],
      ['messages.edited', `SELECT COUNT(*) AS v FROM Message WHERE edited = 1`],
      ['messages.pinned', `SELECT COUNT(*) AS v FROM Message WHERE pinned = 1`],
      ['messages.withTranscription', `SELECT COUNT(*) AS v FROM Message WHERE transcription IS NOT NULL`],
      ['messages.avgLength', `SELECT CAST(AVG(LENGTH(content)) AS INT) AS v FROM Message WHERE type='text'`],
      ['commits.fullySigned', `SELECT COUNT(*) AS v FROM "Commit" WHERE creatorSigned = 1 AND counterpartySigned = 1`],
      ['commits.avgFairness', `SELECT CAST(AVG(fairnessScore) AS INT) AS v FROM Commit`],
      ['commits.withDeadline', `SELECT COUNT(*) AS v FROM "Commit" WHERE deadline IS NOT NULL AND deadline != ''`],
      ['commits.avgAmount', `SELECT CAST(AVG(amount) AS INT) AS v FROM "Commit" WHERE amount > 0`],
      ['business.total', `SELECT COUNT(*) AS v FROM Business`],
      ['businessmembers.total', `SELECT COUNT(*) AS v FROM BusinessMember`],
      ['broadcastchannels.total', `SELECT COUNT(*) AS v FROM BroadcastChannel`],
      ['broadcastsubscribers.total', `SELECT COUNT(*) AS v FROM BroadcastSubscriber`],
      ['stories.total', `SELECT COUNT(*) AS v FROM Story`],
      ['polls.total', `SELECT COUNT(*) AS v FROM Poll`],
      ['timecapsules.total', `SELECT COUNT(*) AS v FROM TimeCapsule`],
      ['threads.total', `SELECT COUNT(*) AS v FROM Thread`],
      ['whispermessages.total', `SELECT COUNT(*) AS v FROM WhisperMessage`],
      ['receiptsplits.total', `SELECT COUNT(*) AS v FROM ReceiptSplit`],
      ['scheduledmessages.total', `SELECT COUNT(*) AS v FROM ScheduledMessage`],
      ['reactions.total', `SELECT COUNT(*) AS v FROM Reaction`],
      ['drafts.total', `SELECT COUNT(*) AS v FROM Draft`],
    ];
    for (const [key, sql] of scalarQueries) {
      try {
        const res = await client.execute(sql);
        const v = res.rows[0]?.v;
        if (v !== null && v !== undefined) scalars[key] = Number(v);
      } catch { /* skip */ }
    }
    result.scalars = scalars;

    // 4. activity windows (timestamps only — no content)
    const windows: Record<string, { from: string; to: string }> = {};
    const windowQueries: [string, string][] = [
      ['message.createdAt', `SELECT MIN(createdAt) AS f, MAX(createdAt) AS t FROM Message`],
      ['user.createdAt', `SELECT MIN(createdAt) AS f, MAX(createdAt) AS t FROM User`],
      ['commit.createdAt', `SELECT MIN(createdAt) AS f, MAX(createdAt) AS t FROM Commit`],
      ['business.createdAt', `SELECT MIN(createdAt) AS f, MAX(createdAt) AS t FROM Business`],
    ];
    for (const [key, sql] of windowQueries) {
      try {
        const res = await client.execute(sql);
        const f = res.rows[0]?.f, t = res.rows[0]?.t;
        if (f && t) windows[key] = { from: String(f).slice(0, 19), to: String(t).slice(0, 19) };
      } catch { /* skip */ }
    }
    result.windows = windows;

    // write JSON
    mkdirSync(jsonPath.split('/').slice(0, -1).join('/'), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    console.log(`written: ${jsonPath}`);

    // human summary (enum values only)
    console.log('\n— distributions —');
    for (const [k, vals] of Object.entries(dists)) {
      console.log(`  ${k}: ${vals.map((v) => `${v.value}=${v.count}`).join(' ')}`);
    }
    console.log('\n— scalars —');
    for (const [k, v] of Object.entries(scalars)) console.log(`  ${k}: ${v}`);
    console.log('\n— windows —');
    for (const [k, v] of Object.entries(windows)) console.log(`  ${k}: ${v.from} → ${v.to}`);
  } finally {
    client.close();
  }
}

main().catch((e) => { console.error('probe failed:', e instanceof Error ? e.message : e); process.exit(1); });
