// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Reset demo data for live use (idempotent).
//
// Removes ALL mock/demo domain data from the ACTIVE database (Turso when
// TURSO_DATABASE_URL is set — the same DB the Vercel deployment uses) so the
// operator can start uploading real data:
//   • KEEPS: Organization, User, Membership (login identity), ModelRegistry /
//     ModelVersion / ModelDeployment (system model catalog + the PRODUCTION
//     internal-chat deployment), PromptVersion / ConfigVersion (§74/§75 system
//     configuration), AutonomyConfig (org autonomy setting).
//   • WIPES: every demo platform/blueprint/document/chunk/knowledge record,
//     embedding/lexical index, intake source (§106 scarab demo etc.), schema
//     snapshots, mappings, KG edges, training sources/examples/datasets/runs,
//     evaluation suites/results, conversations/messages/generations, feedback,
//     reviews, audit events, jobs, sessions (fresh login required), health and
//     improvement records.
//   • Training-derived model versions (wedjat-1.x-lora demo candidates) and
//     their deployments are deleted so the model catalog returns to baseline.
//
// Usage:
//   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… bunx tsx scripts/reset-live.ts
//   (or DATABASE_URL=file:… to reset a local SQLite file instead)
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const FILE_URL = process.env.DATABASE_URL;

function target(): { url: string; authToken?: string; label: string } {
  if (TURSO_URL && TURSO_TOKEN) return { url: TURSO_URL, authToken: TURSO_TOKEN, label: `Turso ${TURSO_URL}` };
  if (FILE_URL?.startsWith('file:')) return { url: FILE_URL, label: `local ${FILE_URL}` };
  console.error('Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (remote) or DATABASE_URL=file:… (local).');
  process.exit(1);
}

// System identity + catalog/config tables — never wiped.
const KEEP = new Set([
  'Organization',
  'User',
  'Membership',
  'ModelRegistry',
  'ModelVersion',
  'ModelDeployment',
  'PromptVersion',
  'ConfigVersion',
  'AutonomyConfig',
]);

interface TableMeta {
  name: string;
  dependsOn: string[];
  rowCount: number;
}

async function main(): Promise<void> {
  const cfg = target();
  const client = createClient({ url: cfg.url, authToken: cfg.authToken });
  await client.execute('SELECT 1');
  console.log(`✓ target reachable: ${cfg.label}`);

  // 1. Collect all tables + FK dependencies.
  const tablesResult = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const metas: TableMeta[] = [];
  for (const row of tablesResult.rows) {
    const name = String(row.name);
    // NOTE: Turso's SQL parser rejects quoted args to PRAGMA — bare identifier.
    const fk = await client.execute(`PRAGMA foreign_key_list(${name})`);
    const dependsOn = [...new Set(fk.rows.map((r) => String(r.table)))].filter((t) => t !== name);
    const count = await client.execute(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`);
    metas.push({ name, dependsOn, rowCount: Number((count.rows[0] as { c: number | bigint }).c) });
  }

  // 2. Topological order (parents first) — deletion runs in REVERSE (children first).
  const ordered: TableMeta[] = [];
  const pending = new Set(metas.map((m) => m.name));
  while (pending.size > 0) {
    let progressed = false;
    for (const meta of metas) {
      if (!pending.has(meta.name)) continue;
      const external = meta.dependsOn.filter((d) => pending.has(d) && d !== meta.name);
      if (external.length === 0) {
        ordered.push(meta);
        pending.delete(meta.name);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cyclic FK graph safety net: fall back to raw name order for the remainder.
      for (const meta of metas) {
        if (pending.has(meta.name)) {
          ordered.push(meta);
          pending.delete(meta.name);
        }
      }
      console.warn('  ! FK cycle detected — remaining tables deleted in name order.');
    }
  }

  // 3. Delete training-derived model versions (+ their deployments) FIRST: these
  //    kept-table rows reference wiped tables (TrainingRun / TrainingDatasetVersion).
  const derivedVersions = await client.execute(
    'SELECT id FROM ModelVersion WHERE trainingRunId IS NOT NULL OR datasetVersionId IS NOT NULL'
  );
  if (derivedVersions.rows.length > 0) {
    const ids = derivedVersions.rows.map((r) => String(r.id));
    for (const id of ids) {
      await client.execute('DELETE FROM ModelDeployment WHERE modelVersionId = ?', [id]);
    }
    await client.execute(
      `DELETE FROM ModelVersion WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    console.log(`✓ removed training-derived model versions: ${ids.length} (+ their deployments)`);
  } else {
    console.log('✓ no training-derived model versions present');
  }

  // 4. Wipe everything outside the KEEP set, children first.
  let wipedRows = 0;
  const wipedTables: string[] = [];
  for (const meta of [...ordered].reverse()) {
    if (KEEP.has(meta.name)) continue;
    if (meta.rowCount === 0) continue;
    await client.execute(`DELETE FROM "${meta.name.replace(/"/g, '""')}"`);
    wipedRows += meta.rowCount;
    wipedTables.push(`${meta.name}(${meta.rowCount})`);
  }
  console.log(`✓ wiped ${wipedRows} demo rows across ${wipedTables.length} tables:`);
  console.log('  ' + wipedTables.join(', '));

  // 5. Post-state verification.
  console.log('— post-reset state —');
  for (const t of ['Organization', 'User', 'Membership', 'ModelRegistry', 'ModelVersion', 'ModelDeployment', 'PromptVersion', 'ConfigVersion']) {
    const c = await client.execute(`SELECT COUNT(*) AS c FROM "${t}"`);
    console.log(`  ${t}: ${Number((c.rows[0] as { c: number | bigint }).c)}`);
  }
  const leftovers: string[] = [];
  for (const meta of metas) {
    if (KEEP.has(meta.name)) continue;
    const c = await client.execute(`SELECT COUNT(*) AS c FROM "${meta.name.replace(/"/g, '""')}"`);
    const n = Number((c.rows[0] as { c: number | bigint }).c);
    if (n > 0) leftovers.push(`${meta.name}=${n}`);
  }
  if (leftovers.length > 0) {
    console.error('✗ LEFTOVER ROWS: ' + leftovers.join(', '));
    process.exit(1);
  }
  console.log('✓ demo estate fully cleared — logins preserved, system catalog intact.');
  console.log('  NOTE: all sessions were wiped — every user must sign in again.');
}

main().catch((err) => {
  console.error('reset failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
