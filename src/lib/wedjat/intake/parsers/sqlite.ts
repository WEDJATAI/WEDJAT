// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake parser: SQLite database files (§106).
//
// Opens the uploaded database READ-ONLY via node:sqlite (works in Node and Bun) and extracts the complete
// structural truth: sqlite_master DDL, PRAGMA table_info/index_list/foreign_key_
// list, row counts, sample rows and per-column value statistics. The source file
// is never written to (§108 source preservation).
// ═══════════════════════════════════════════════════════════════════════════════

import { DatabaseSync } from 'node:sqlite';
import {
  cleanIdent,
  computeColumnStat,
  detectNamingPattern,
  normalizeType,
  snapshotCounts,
  type ColumnDef,
  type ConstraintDef,
  type IndexDef,
  type SchemaSnapshot,
  type TableDef,
} from '../schema-model';

export function parseSqliteDatabase(path: string): SchemaSnapshot {
  const db = new DatabaseSync(path, { readOnly: true });

  try {
    const objects = db
      .prepare(
        "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string; type: string; sql: string | null }[];

    const tables: TableDef[] = [];
    const views: { name: string; sql: string }[] = [];

    for (const obj of objects) {
      if (obj.type === 'view') {
        views.push({ name: cleanIdent(obj.name), sql: obj.sql ?? '' });
        continue;
      }
      tables.push(parseTable(db, cleanIdent(obj.name)));
    }

    const snapshot: SchemaSnapshot = {
      engine: 'SQLITE',
      dialect: 'sqlite3',
      detection: {
        method: 'magic-bytes',
        confidence: 0.99,
        detail: 'SQLite database file opened read-only; schema read from sqlite_master.',
      },
      tables,
      views,
      naming: detectNamingPattern(tables),
      counts: { tables: 0, columns: 0, fks: 0, indexes: 0, constraints: 0, views: 0 },
    };
    return snapshotCounts(snapshot);
  } finally {
    db.close();
  }
}

function parseTable(db: DatabaseSync, name: string): TableDef {
  const quoted = `"${name.replace(/"/g, '""')}"`;
  const info = db
    .prepare(
      `PRAGMA table_info(${quoted})`
    )
    .all() as { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];

  const fkRaw = db
    .prepare(
      `PRAGMA foreign_key_list(${quoted})`
    )
    .all() as { id: number; seq: number; table: string; from: string; to: string }[];

  // PRAGMA index_list: seq, name, unique, origin, partial
  const idxList = db
    .prepare(
      `PRAGMA index_list(${quoted})`
    )
    .all() as { seq: number; name: string; unique: number; origin: string; partial: number }[];

  const pkColumns: string[] = info
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);

  const fkColumns = new Set(fkRaw.map((f) => f.from));
  const indexes: IndexDef[] = [];
  for (const idx of idxList) {
    if (idx.origin === 'pk') continue; // rowid PK — implicit
    const cols = (
      db
        .prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`)
        .all() as { seqno: number; cid: number; name: string | null }[]
    )
      .filter((c) => c.name)
      .map((c) => c.name as string);
    if (cols.length > 0) indexes.push({ name: idx.name, columns: cols, unique: idx.unique === 1 });
  }

  const columns: ColumnDef[] = info.map((c) => ({
    name: c.name,
    rawType: c.type || 'UNKNOWN',
    type: normalizeType(c.type || ''),
    nullable: c.notnull === 0 && c.pk === 0,
    isPrimaryKey: c.pk > 0,
    isForeignKey: fkColumns.has(c.name),
    defaultValue: c.dflt_value,
  }));

  const constraints: ConstraintDef[] = [];
  if (pkColumns.length > 0) constraints.push({ name: 'PRIMARY KEY', type: 'PRIMARY_KEY', detail: `(${pkColumns.join(', ')})` });
  for (const c of info.filter((c) => c.notnull === 1 && c.pk === 0)) {
    constraints.push({ name: `${c.name}_nn`, type: 'NOT_NULL', detail: `${c.name} NOT NULL` });
  }
  for (const f of groupFks(fkRaw)) constraints.push({ name: `fk_${f.columns.join('_')}`, type: 'FOREIGN_KEY', detail: `${f.columns.join(',')} → ${f.refTable}(${f.refColumns.join(',')})` });
  for (const idx of indexes.filter((i) => i.unique)) constraints.push({ name: idx.name, type: 'UNIQUE', detail: `(${idx.columns.join(', ')})` });

  // FK grouping (compound FKs share the id)
  const foreignKeys = groupFks(fkRaw);

  let rowCount = 0;
  let sampleRows: Record<string, unknown>[] = [];
  const stats: ReturnType<typeof computeColumnStat>[] = [];
  try {
    rowCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n;
    sampleRows =
      rowCount > 0
        ? (db.prepare(`SELECT * FROM ${quoted} LIMIT 40`).all() as Record<string, unknown>[])
        : [];

    for (const col of columns) {
      const colQ = `"${col.name.replace(/"/g, '""')}"`;
      const nullCount =
        rowCount - (db.prepare(`SELECT COUNT(${colQ}) AS n FROM ${quoted}`).get() as { n: number }).n;
      let distinct: number | null = null;
      let enumValues: string[] = [];
      if (rowCount > 0 && rowCount <= 200_000) {
        distinct = (db.prepare(`SELECT COUNT(DISTINCT ${colQ}) AS n FROM ${quoted}`).get() as { n: number }).n;
        if (distinct > 0 && distinct <= 25) {
          const vals = (
            db.prepare(`SELECT DISTINCT ${colQ} AS v FROM ${quoted} WHERE ${colQ} IS NOT NULL LIMIT 26`).all() as { v: unknown }[]
          ).map((r) => (typeof r.v === 'object' ? JSON.stringify(r.v) : String(r.v)));
          enumValues = vals.slice(0, 25);
        }
      }
      let min: number | undefined;
      let max: number | undefined;
      let avg: number | undefined;
      if ((col.type === 'INTEGER' || col.type === 'REAL' || col.type === 'NUMERIC') && rowCount > 0) {
        const agg = db
          .prepare(`SELECT MIN(${colQ}) AS mn, MAX(${colQ}) AS mx, AVG(${colQ}) AS av FROM ${quoted}`)
          .get() as { mn: number | null; mx: number | null; av: number | null };
        min = agg.mn ?? undefined;
        max = agg.mx ?? undefined;
        avg = agg.av != null ? Math.round(agg.av * 100) / 100 : undefined;
      }
      const values = sampleRows.map((r) => r[col.name]);
      const stat = computeColumnStat(col.name, values, Math.max(rowCount, values.length), col.type);
      if (distinct != null) stat.distinct = distinct;
      if (enumValues.length > 0) {
        stat.enumValues = enumValues;
        stat.isEnumLike = true;
      }
      stat.nullCount = nullCount;
      stat.nullPct = rowCount > 0 ? Math.round((nullCount / rowCount) * 1000) / 10 : 0;
      stat.min = min;
      stat.max = max;
      stat.avg = avg;
      stats.push(stat);
    }
  } catch {
    // Virtual tables / edge cases — schema still returned without data stats.
  }

  return { name, columns, primaryKey: pkColumns, foreignKeys, indexes, constraints, rowCount, sampleRows, stats };
}

function groupFks(
  fkRaw: { id: number; seq: number; table: string; from: string; to: string }[],
): { columns: string[]; refTable: string; refColumns: string[] }[] {
  const byId = new Map<number, { table: string; pairs: [string, string][] }>();
  for (const f of fkRaw) {
    if (!byId.has(f.id)) byId.set(f.id, { table: cleanIdent(f.table), pairs: [] });
    byId.get(f.id)!.pairs.push([f.from, f.to]);
  }
  return [...byId.entries()].map(([id, g]) => ({
    columns: g.pairs.map((p) => p[0]),
    refTable: g.table,
    refColumns: g.pairs.map((p) => p[1]),
  }));
}
