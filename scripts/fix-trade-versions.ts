// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 30 — one-time repair: trade-corpus blueprint versioning.
//
// SYMPTOM: ingest-trade-knowledge.ts initially omitted the API's `version`
// field, so every submitted document spawned its own auto-numbered
// BlueprintVersion (0.1, 0.2, …) — each new one SUPERSEDING the previous.
// Documents attached to earlier versions became invisible to default
// (CURRENT-only) retrieval: 9 stranded docs per blueprint.
//
// REPAIR (additive, non-destructive): for each trade-* blueprint, keep the
// CURRENT version row, re-parent every stranded Document onto it, mark all
// sibling rows SUPERSEDED, and rename the kept row to `trade-corpus-v1` so
// the ingestion script (now sending version: trade-corpus-v1) stays
// idempotent on re-runs.
//
// Usage: bun scripts/fix-trade-versions.ts [--dry-run]
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_VERSION = 'trade-corpus-2026-09-14'; // must equal CORPUS_VERSION in ingest-trade-knowledge.ts

async function main(): Promise<void> {
  const blueprints = await db.blueprint.findMany({
    where: { slug: { startsWith: 'trade-' } },
    select: {
      id: true,
      slug: true,
      currentVersionId: true,
      versions: { select: { id: true, version: true, status: true, documents: { select: { id: true } } } },
    },
  });

  let totalMoved = 0;
  let totalRowsSuperseded = 0;
  for (const bp of blueprints) {
    const current = bp.versions.find((v) => v.id === bp.currentVersionId && v.status === 'CURRENT')
      ?? bp.versions.find((v) => v.status === 'CURRENT');
    if (!current) {
      console.log(`✗ ${bp.slug}: no CURRENT version — skipping (manual review)`);
      continue;
    }
    const siblings = bp.versions.filter((v) => v.id !== current.id);
    const stranded = siblings.flatMap((v) => v.documents.map((d) => d.id));
    console.log(
      `${bp.slug}: keep ${current.version} (${current.documents.length} docs)` +
      ` · re-parent ${stranded.length} stranded docs from ${siblings.length} superseded rows` +
      ` · rename to ${KEEP_VERSION}`
    );
    if (DRY_RUN) continue;

    await db.$transaction(async (tx) => {
      // 1. re-parent stranded documents onto the kept CURRENT row
      if (stranded.length > 0) {
        await tx.document.updateMany({ where: { id: { in: stranded } }, data: { blueprintVersionId: current.id } });
      }
      // 2. supersede every sibling row (0.1–0.9 style artifacts)
      const res = await tx.blueprintVersion.updateMany({
        where: { blueprintId: bp.id, id: { not: current.id }, status: { not: 'SUPERSEDED' } },
        data: { status: 'SUPERSEDED', effectiveUntil: new Date() },
      });
      totalRowsSuperseded += res.count;
      // 3. rename the kept row to the canonical corpus version
      await tx.blueprintVersion.update({ where: { id: current.id }, data: { version: KEEP_VERSION, status: 'CURRENT', effectiveUntil: null } });
      await tx.blueprint.update({ where: { id: bp.id }, data: { currentVersionId: current.id } });
    });
    totalMoved += stranded.length;
  }

  console.log(`\n${DRY_RUN ? 'DRY-RUN ' : ''}DONE: ${totalMoved} documents re-parented, ${totalRowsSuperseded} stale version rows superseded`);

  // verification: every trade doc must now sit on a CURRENT version
  const still = await db.document.count({
    where: { blueprintVersion: { blueprint: { slug: { startsWith: 'trade-' } }, status: { not: 'CURRENT' } } },
  });
  console.log(`verification — trade docs on non-CURRENT versions: ${still}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('repair failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
