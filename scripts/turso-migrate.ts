// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Turso migration (one-shot, idempotent).
//
// Mirrors the local SQLite demo estate (schema + data + artifact blobs) into the
// remote Turso database so the live/Vercel deployment starts from the exact
// demo state: 4 imported sources, knowledge graph, RAG chunks, training
// candidates, review queue, learning dashboard.
//
// Usage:
//   DATABASE_URL=file:<local.db> \
//   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… \
//   bunx tsx scripts/turso-migrate.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';
import { promises as fs } from 'node:fs';

const LOCAL_URL = process.env.DATABASE_URL;
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!LOCAL_URL || !TURSO_URL || !TURSO_TOKEN) {
  console.error('Need DATABASE_URL (file:…), TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  process.exit(1);
}

const local = createClient({ url: LOCAL_URL });
const remote = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

type Value = string | number | bigint | ArrayBuffer | Uint8Array | null;

interface TableMeta {
  name: string;
  ddl: string;
  columns: { name: string; pk: boolean }[];
  rowCount: number;
  dependsOn: string[];
}

async function main(): Promise<void> {
  // 0. Remote reachable?
  await remote.execute('SELECT 1');
  console.log('✓ Turso reachable:', TURSO_URL);

  // 1. Backfill artifact blobs into the local DB (§108 DB-authoritative copy).
  const sources = await local.execute(
    'SELECT id, artifactPath, byteSize FROM SourceDatabase WHERE artifactData IS NULL'
  );
  let backfilled = 0;
  for (const row of sources.rows) {
    const path = String(row.artifactPath);
    try {
      const bytes = new Uint8Array(await fs.readFile(path));
      await local.execute({
        sql: 'UPDATE SourceDatabase SET artifactData = ? WHERE id = ?',
        args: [bytes, String(row.id)],
      });
      backfilled++;
    } catch {
      console.warn(`  ! artifact file missing for ${row.id} (${path}) — skipped`);
    }
  }
  console.log(`✓ artifact blobs backfilled locally: ${backfilled}/${sources.rows.length}`);

  // 2. Collect local schema.
  const tablesResult = await local.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const remoteTables = new Set(
    (await remote.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(
      (r) => String(r.name)
    )
  );

  const metas: TableMeta[] = [];
  for (const t of tablesResult.rows) {
    const name = String(t.name);
    const ddl = String(t.sql);
    const info = await local.execute(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
    const columns = info.rows.map((c) => ({
      name: String(c.name),
      pk: Number(c.pk) > 0,
    }));
    const fk = await local.execute(`PRAGMA foreign_key_list("${name.replace(/"/g, '""')}")`);
    const dependsOn = [...new Set(fk.rows.map((r) => String(r.table)))];
    const count = Number(
      (await local.execute(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`)).rows[0].n
    );
    metas.push({ name, ddl, columns, rowCount: count, dependsOn });
  }

  // 3. Topological order by FK dependencies (self-references ignored).
  const ordered: TableMeta[] = [];
  const pending = new Map(metas.map((m) => [m.name, m]));
  const placed = new Set<string>();
  let guard = 0;
  while (pending.size > 0 && guard++ < 1000) {
    let progressed = false;
    for (const [name, meta] of [...pending.entries()]) {
      const external = meta.dependsOn.filter((d) => pending.has(d) && d !== name);
      if (external.length === 0) {
        ordered.push(meta);
        placed.add(name);
        pending.delete(name);
        progressed = true;
      }
    }
    if (!progressed) {
      // FK cycle or missing target — fall back to insertion order.
      for (const [name, meta] of [...pending.entries()]) {
        ordered.push(meta);
        placed.add(name);
        pending.delete(name);
      }
    }
  }
  console.log(
    `✓ ${ordered.length} tables ordered (${ordered
      .slice(0, 6)
      .map((m) => m.name)
      .join(' → ')}…)`
  );

  // 4a. Ensure tables exist (topo order), then clear ALL of them in REVERSE
  //     topo order (children first) so FK constraints never block the wipe.
  for (const meta of ordered) {
    if (!remoteTables.has(meta.name)) {
      await remote.execute(meta.ddl);
      remoteTables.add(meta.name);
    }
  }
  for (const meta of [...ordered].reverse()) {
    await remote.execute(`DELETE FROM "${meta.name.replace(/"/g, '""')}"`);
  }

  // 4b. Mirror data in forward topo order.
  let totalRows = 0;
  for (const meta of ordered) {
    if (meta.rowCount === 0) continue;

    const colList = meta.columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(', ');
    const placeholders = meta.columns.map(() => '?').join(', ');
    const insertSql = `INSERT INTO "${meta.name.replace(/"/g, '""')}" (${colList}) VALUES (${placeholders})`;

    const all = await local.execute(`SELECT ${colList} FROM "${meta.name.replace(/"/g, '""')}"`);
    const BATCH = 200;
    for (let i = 0; i < all.rows.length; i += BATCH) {
      const slice = all.rows.slice(i, i + BATCH);
      await remote.batch(
        slice.map((row) => ({
          sql: insertSql,
          args: meta.columns.map((c) => {
            const v = (row as Record<string, Value>)[c.name];
            return v instanceof Uint8Array ? v : (v as Value);
          }),
        })),
        'write'
      );
    }
    totalRows += all.rows.length;
    console.log(`  · ${meta.name}: ${all.rows.length} rows`);
  }

  // 5. Indexes (skip auto-indexes; table DDL already covers inline constraints).
  const idx = await local.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
  );
  const remoteIdx = new Set(
    (await remote.execute("SELECT name FROM sqlite_master WHERE type='index'")).rows.map((r) => String(r.name))
  );
  let createdIdx = 0;
  for (const r of idx.rows) {
    const name = String(r.name);
    if (remoteIdx.has(name)) continue;
    await remote.execute(String(r.sql));
    createdIdx++;
  }

  // 6. Verify.
  const verify: string[] = [];
  for (const meta of ordered) {
    const n = Number(
      (await remote.execute(`SELECT COUNT(*) AS n FROM "${meta.name.replace(/"/g, '""')}"`)).rows[0].n
    );
    if (n !== meta.rowCount) verify.push(`${meta.name}: local ${meta.rowCount} ≠ remote ${n}`);
  }
  const blobCheck = await remote.execute(
    'SELECT COUNT(*) AS n FROM SourceDatabase WHERE artifactData IS NOT NULL'
  );
  console.log('──────────────────────────────────────────────');
  console.log(`✓ migration complete: ${totalRows} rows, ${createdIdx} indexes`);
  console.log(`✓ artifact blobs on Turso: ${blobCheck.rows[0].n}`);
  if (verify.length > 0) {
    console.error('✗ COUNT MISMATCHES:', verify.join('; '));
    process.exit(1);
  }
  console.log('✓ all row counts verified identical');
  await local.close();
  await remote.close();
}

main().catch((e) => {
  console.error('MIGRATION FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
