// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT — apply Gemini provider key + Open Access mode (ADDITIVE, idempotent).
//
// Writes into BOTH the local SQLite database AND the production Turso database
// (when .env.local carries WEDJAT_TURSO_*):
//   1. provider.keys → merges { geminiApiKey } into the ACTIVE row (existing
//      values preserved; old row ARCHIVED, never deleted — append-only §58).
//   2. access.mode   → new ACTIVE row {"mode":"OPEN"} (login disabled per the
//      OWNER's instruction; reversible by archiving this row).
//
// Secrets are read from .env.local and NEVER printed, echoed, or committed.
//
// Usage: bun scripts/apply-gemini-and-open-access.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = readFileSync('.env.local', 'utf8');
const envMap = new Map(
  env.split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const GEMINI_KEY = envMap.get('GEMINI_API_KEY');
if (!GEMINI_KEY) {
  console.error('Need GEMINI_API_KEY in .env.local');
  process.exit(1);
}

const TURSO_URL = process.env.TURSO_DATABASE_URL ?? envMap.get('WEDJAT_TURSO_DATABASE_URL');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN ?? envMap.get('WEDJAT_TURSO_AUTH_TOKEN');

const local = createClient({ url: process.env.DATABASE_URL ?? 'file:db/custom.db' });
const remotes: Client[] = [];
if (TURSO_URL && TURSO_TOKEN) {
  remotes.push(createClient({ url: TURSO_URL, authToken: TURSO_TOKEN }));
}

function cuid(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

async function apply(client: Client, label: string): Promise<void> {
  // Primary org (earliest created).
  const org = await client.execute({
    sql: 'SELECT id FROM Organization ORDER BY createdAt ASC LIMIT 1',
    args: [],
  });
  if (org.rows.length === 0) {
    console.log(`  [${label}] no Organization row — skipped (nothing to scope to)`);
    return;
  }
  const orgId = String(org.rows[0].id);

  // ── 1. provider.keys: merge geminiApiKey into the ACTIVE row ───────────────
  const existing = await client.execute({
    sql: "SELECT id, valueJson FROM ConfigVersion WHERE orgId = ? AND key = 'provider.keys' AND status = 'ACTIVE' ORDER BY createdAt DESC LIMIT 1",
    args: [orgId],
  });
  let merged: Record<string, string> = {};
  if (existing.rows.length > 0) {
    try {
      merged = JSON.parse(String(existing.rows[0].valueJson)) as Record<string, string>;
    } catch {
      merged = {};
    }
  }
  merged.geminiApiKey = GEMINI_KEY;
  const version = `v${Date.now()}`;
  await client.execute({
    sql: "UPDATE ConfigVersion SET status = 'ARCHIVED' WHERE orgId = ? AND key = 'provider.keys' AND status = 'ACTIVE'",
    args: [orgId],
  });
  await client.execute({
    sql: "INSERT INTO ConfigVersion (id, orgId, key, version, valueJson, status, createdAt) VALUES (?, ?, 'provider.keys', ?, ?, 'ACTIVE', ?)",
    args: [cuid(), orgId, version, JSON.stringify(merged), new Date().toISOString()],
  });
  const keyCount = Object.keys(merged).length;
  console.log(
    `  [${label}] provider.keys ACTIVE row written (gemini set; ${keyCount} key(s) in map — values not printed)`
  );

  // ── 2. access.mode: OPEN (login disabled, user-directed) ───────────────────
  const accessExisting = await client.execute({
    sql: "SELECT id FROM ConfigVersion WHERE orgId = ? AND key = 'access.mode' AND status = 'ACTIVE' LIMIT 1",
    args: [orgId],
  });
  if (accessExisting.rows.length === 0) {
    await client.execute({
      sql: "INSERT INTO ConfigVersion (id, orgId, key, version, valueJson, status, createdAt) VALUES (?, ?, 'access.mode', ?, ?, 'ACTIVE', ?)",
      args: [cuid(), orgId, version, JSON.stringify({ mode: 'OPEN' }), new Date().toISOString()],
    });
    console.log(`  [${label}] access.mode = OPEN written (credential login disabled)`);
  } else {
    await client.execute({
      sql: "UPDATE ConfigVersion SET valueJson = ?, status = 'ACTIVE' WHERE id = ?",
      args: [JSON.stringify({ mode: 'OPEN' }), String(accessExisting.rows[0].id)],
    });
    console.log(`  [${label}] access.mode = OPEN already present — refreshed`);
  }
}

async function main(): Promise<void> {
  console.log('== local SQLite ==');
  await apply(local, 'local');
  if (remotes.length > 0) {
    await remotes[0].execute('SELECT 1');
    console.log('== production Turso (reachable) ==');
    await apply(remotes[0], 'turso');
  } else {
    console.log('== production Turso: WEDJAT_TURSO_* not set — skipped ==');
  }
  console.log('done.');
}

main().catch((err) => {
  console.error('failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
