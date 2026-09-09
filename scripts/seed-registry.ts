// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Platform registry seed (§87/§88) — RESTORES the org learning
// network: WEDJAT + CIRKLE + AURIENTA + SGTX + MTQ + JUDGE SMART + EGYCOURT +
// SGTX FABLE + PPE + MTQ SIGMA.
//
// IDEMPOTENT + ADDITIVE: upserts by slug, never deletes, never touches
// knowledge. EGYCOURT has only a repository (per spec: discover, do not
// invent). MTQ and MTQ SIGMA are separate platforms (§6 note).
//
// Usage: bun scripts/seed-registry.ts   (local) — or with TURSO_* for remote.
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';

const REGISTRY: {
  slug: string;
  name: string;
  criticality: string;
  repositoryUrl: string;
  deploymentUrl?: string;
  databaseUrl?: string;
  description: string;
}[] = [
  {
    slug: 'wedjat',
    name: 'WEDJAT',
    criticality: 'CRITICAL',
    repositoryUrl: 'https://github.com/WEDJATAI/WEDJAT',
    description: 'Central intelligence platform / control plane (the WEDJAT core itself).',
  },
  {
    slug: 'cirkle',
    name: 'CIRKLE',
    criticality: 'HIGH',
    repositoryUrl: 'https://github.com/fortleem/CIRKLE',
    deploymentUrl: 'https://cirkleapp.vercel.app/',
    databaseUrl: 'libsql://cirkle-fortleem.aws-us-east-1.turso.io',
    description: 'CIRKLE platform (GitHub + Vercel + Turso registered).',
  },
  {
    slug: 'aurienta',
    name: 'AURIENTA',
    criticality: 'HIGH',
    repositoryUrl: 'https://github.com/Aurienta/Aurienta',
    deploymentUrl: 'https://aurienta.vercel.app',
    databaseUrl: 'libsql://aurienta-fortleem.aws-us-east-1.turso.io',
    description: 'AURIENTA platform (GitHub + Vercel + Turso registered).',
  },
  {
    slug: 'sgtx',
    name: 'SGTX',
    criticality: 'HIGH',
    repositoryUrl: 'https://github.com/SGTX-PILOT/SGTX',
    deploymentUrl: 'https://sgtx.vercel.app',
    databaseUrl: 'libsql://sgtx-fortleem.aws-us-east-1.turso.io',
    description: 'SGTX platform (AIS Stream external data kept separate from proprietary data).',
  },
  {
    slug: 'mtq',
    name: 'MTQ',
    criticality: 'HIGH',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ',
    deploymentUrl: 'https://mithqal.vercel.app/',
    databaseUrl: 'libsql://mtq-fortleem.aws-us-east-1.turso.io',
    description: 'MTQ platform (Messari/Discord external secrets never ingested as knowledge).',
  },
  {
    slug: 'judge-smart',
    name: 'JUDGE SMART',
    criticality: 'MEDIUM',
    repositoryUrl: 'https://github.com/fortleem/judge_synapse',
    deploymentUrl: 'https://judge-smart.vercel.app',
    databaseUrl: 'libsql://judge-fortleem.aws-us-east-1.turso.io',
    description: 'Judge Smart platform (judge_synapse repository).',
  },
  {
    slug: 'egycourt',
    name: 'EGYCOURT',
    criticality: 'MEDIUM',
    repositoryUrl: 'https://github.com/egycourt/egycourt',
    description: 'EGYCOURT — new platform source; database/deployment to be discovered (not invented).',
  },
  {
    slug: 'sgtx-fable',
    name: 'SGTX FABLE',
    criticality: 'MEDIUM',
    repositoryUrl: 'https://github.com/fortleem/SGTX_FABLE',
    description: 'SGTX FABLE — separate source project with preserved lineage.',
  },
  {
    slug: 'ppe',
    name: 'PPE',
    criticality: 'MEDIUM',
    repositoryUrl: 'https://github.com/fortleem/PPE',
    deploymentUrl: 'https://ppe-smart.vercel.app',
    databaseUrl: 'libsql://ppe-smart-fortleem.aws-us-east-1.turso.io',
    description: 'PPE Smart platform.',
  },
  {
    slug: 'mtq-sigma',
    name: 'MTQ SIGMA',
    criticality: 'MEDIUM',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ_SIGMA',
    deploymentUrl: 'https://mtq-sigma.vercel.app',
    databaseUrl: 'libsql://mtqs-fortleem.aws-us-east-1.turso.io',
    description: 'MTQ SIGMA — separate platform from MTQ unless source analysis proves otherwise.',
  },
];

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.error('Need DATABASE_URL (local) or TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)');
    process.exit(1);
  }
  const client = createClient(token ? { url, authToken: token } : { url });

  // Idempotent: find or create each platform by (orgId, slug). WEDJAT's own org
  // is the first organization (single-org deployment; additive multi-org safe).
  const orgs = await client.execute('SELECT id FROM Organization ORDER BY createdAt LIMIT 1');
  if (orgs.rows.length === 0) {
    console.error('No organization found — run scripts/seed.ts first');
    process.exit(1);
  }
  const orgId = String(orgs.rows[0].id);
  console.log(`org: ${orgId} (${token ? 'remote Turso' : 'local SQLite'})`);

  let created = 0;
  let updated = 0;
  for (const p of REGISTRY) {
    const existing = await client.execute({
      sql: 'SELECT id, connectionStatus FROM Platform WHERE orgId = ? AND slug = ?',
      args: [orgId, p.slug],
    });
    if (existing.rows.length === 0) {
      await client.execute({
        sql: `INSERT INTO Platform (id, orgId, slug, name, description, criticality, status,
              repositoryUrl, deploymentUrl, databaseUrl, connectionStatus, registryMetaJson, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 'DISCOVERED', '{}', datetime('now'), datetime('now'))`,
        args: [
          `plt_${p.slug.replace(/-/g, '_')}`, orgId, p.slug, p.name, p.description, p.criticality,
          p.repositoryUrl, p.deploymentUrl ?? null, p.databaseUrl ?? null,
        ],
      });
      created += 1;
      console.log(`  + ${p.slug} (registered, DISCOVERED)`);
    } else {
      // Additive update: fill missing coordinates only; never downgrade status.
      await client.execute({
        sql: `UPDATE Platform SET
              repositoryUrl = COALESCE(repositoryUrl, ?),
              deploymentUrl = COALESCE(deploymentUrl, ?),
              databaseUrl = COALESCE(databaseUrl, ?),
              description = CASE WHEN description IS NULL OR description = '' THEN ? ELSE description END,
              updatedAt = datetime('now')
              WHERE orgId = ? AND slug = ?`,
        args: [p.repositoryUrl, p.deploymentUrl ?? null, p.databaseUrl ?? null, p.description, orgId, p.slug],
      });
      updated += 1;
      console.log(`  · ${p.slug} (coordinates ensured)`);
    }
  }
  console.log(`Registry restored: ${created} created, ${updated} ensured, ${REGISTRY.length} total platforms.`);
  console.log('Knowledge, events and history untouched (v4 §114/§115: additive only).');
  await client.close();
}

main().catch((e) => {
  console.error('SEED FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
