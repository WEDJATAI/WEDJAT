// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake parser: CSV / JSON / JSONL exports (§106).
//
// Data-first sources: the schema is INFERRED from the rows (types, nullability,
// enum-like columns, stats), then wrapped into the same TableDef shape as live
// databases. JSON objects with array values become multiple named tables.
// ═══════════════════════════════════════════════════════════════════════════════

import { splitCsvLine } from '../detect';
import {
  computeColumnStat,
  detectNamingPattern,
  normalizeType,
  snapshotCounts,
  type ColumnDef,
  type ConstraintDef,
  type NormalizedType,
  type SchemaSnapshot,
  type TableDef,
} from '../schema-model';
import type { DetectedFormat } from '../detect';

export function parseCsvFile(text: string, fileName: string): SchemaSnapshot {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('CSV file contains no rows');

  // delimiter detection (reuse logic from detect but over more lines)
  let sep = ',';
  let bestCols = 1;
  for (const candidate of [',', '\t', ';', '|'] as const) {
    const cols = splitCsvLine(lines[0], candidate).length;
    const ok = lines.slice(1, 10).every((l) => splitCsvLine(l, candidate).length === cols);
    if (ok && cols > bestCols) {
      bestCols = cols;
      sep = candidate;
    }
  }

  const header = splitCsvLine(lines[0], sep).map((h, i) => (h.trim() || `col_${i + 1}`).trim().replace(/^"|"$/g, ''));
  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(1, 5000)) {
    const cells = splitCsvLine(line, sep);
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const raw = (cells[i] ?? '').trim();
      if (raw === '' || raw.toUpperCase() === 'NULL' || raw.toUpperCase() === 'N/A') row[h] = null;
      else if (raw.toUpperCase() === 'TRUE') row[h] = true;
      else if (raw.toUpperCase() === 'FALSE') row[h] = false;
      else row[h] = raw.replace(/^"|"$/g, '');
    });
    rows.push(row);
  }

  const table = inferTableFromRows(baseName(fileName) || 'csv_export', header, rows);
  const tables = [table];
  const snapshot: SchemaSnapshot = {
    engine: 'CSV',
    dialect: 'csv',
    detection: {
      method: 'delimiter-sniff',
      confidence: 0.9,
      detail: `Delimited export: ${header.length} columns, ${rows.length} rows parsed.`,
    },
    tables,
    views: [],
    naming: detectNamingPattern(tables),
    counts: { tables: 0, columns: 0, fks: 0, indexes: 0, constraints: 0, views: 0 },
  };
  return snapshotCounts(snapshot);
}

export function parseJsonFile(text: string, fileName: string): SchemaSnapshot {
  const doc = JSON.parse(text);
  const tables: TableDef[] = [];

  const rowsOf = (v: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(v) && v.length > 0 && v.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
      return v as Record<string, unknown>[];
    }
    return null;
  };

  if (rowsOf(doc)) {
    const rows = doc as Record<string, unknown>[];
    const header = unionKeys(rows);
    tables.push(inferTableFromRows(baseName(fileName) || 'json_records', header, rows));
  } else if (typeof doc === 'object' && doc !== null) {
    // Object of arrays → one table per key (name takes priority if present)
    const root = doc as Record<string, unknown>;
    const recordRows = rowsOf(root.records) ?? rowsOf(root.rows) ?? rowsOf(root.data) ?? rowsOf(root.items);
    if (recordRows) {
      const header = unionKeys(recordRows);
      tables.push(inferTableFromRows(baseName(fileName) || 'json_records', header, recordRows));
      for (const [key, value] of Object.entries(root)) {
        if (value === recordRows) continue;
        const sub = rowsOf(value);
        if (sub) tables.push(inferTableFromRows(key, unionKeys(sub), sub));
      }
    } else {
      // single object → one-row table
      tables.push(inferTableFromRows(baseName(fileName) || 'json_object', Object.keys(root), [root]));
    }
  }

  if (tables.length === 0) throw new Error('JSON document did not contain tabular records');

  const snapshot: SchemaSnapshot = {
    engine: 'JSON',
    dialect: 'json',
    detection: {
      method: 'json-parse',
      confidence: 0.95,
      detail: `JSON export: ${tables.length} record collection(s), ${tables.reduce((n, t) => n + t.rowCount, 0)} total rows.`,
    },
    tables,
    views: [],
    naming: detectNamingPattern(tables),
    counts: { tables: 0, columns: 0, fks: 0, indexes: 0, constraints: 0, views: 0 },
  };
  return snapshotCounts(snapshot);
}

export function parseJsonlFile(text: string, fileName: string): SchemaSnapshot {
  const rows: Record<string, unknown>[] = [];
  let badLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) rows.push(obj);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }
  if (rows.length === 0) throw new Error('JSONL file contained no object records');
  const header = unionKeys(rows);
  const tables = [inferTableFromRows(baseName(fileName) || 'jsonl_records', header, rows)];
  const snapshot: SchemaSnapshot = {
    engine: 'JSONL',
    dialect: 'jsonl',
    detection: {
      method: 'line-parse',
      confidence: 0.95,
      detail: `JSON Lines export: ${rows.length} records${badLines > 0 ? `, ${badLines} unparsable lines skipped` : ''}.`,
    },
    tables,
    views: [],
    naming: detectNamingPattern(tables),
    counts: { tables: 0, columns: 0, fks: 0, indexes: 0, constraints: 0, views: 0 },
  };
  return snapshotCounts(snapshot);
}

// ── shared inference ─────────────────────────────────────────────────────────

function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

function inferTableFromRows(name: string, header: string[], rows: Record<string, unknown>[]): TableDef {
  const columns: ColumnDef[] = [];
  const constraints: ConstraintDef[] = [];
  const scanLimit = Math.min(rows.length, 2000);

  // ID-like column detection (first id-ish column becomes inferred PK)
  const idCol = header.find((h) => /^(id|uuid|guid)$/i.test(h.trim())) ?? header.find((h) => /(^|_)id$/i.test(h));

  for (const col of header) {
    const values: unknown[] = [];
    for (let i = 0; i < scanLimit; i++) if (col in rows[i]) values.push(rows[i][col]);
    const type = inferType(values);
    const nullable = values.some((v) => v === null || v === undefined || v === '');
    columns.push({
      name: col,
      rawType: type,
      type,
      nullable,
      isPrimaryKey: idCol === col,
      isForeignKey: /_id$|_uuid$/i.test(col) && idCol !== col,
      defaultValue: null,
    });
    if (idCol === col) constraints.push({ name: 'PRIMARY KEY', type: 'PRIMARY_KEY', detail: `${col} (inferred unique identifier)` });
  }

  const stats = columns.map((c) => {
    const values: unknown[] = [];
    for (let i = 0; i < scanLimit; i++) values.push(rows[i][c.name] ?? null);
    return computeColumnStat(c.name, values, rows.length, c.type);
  });

  // FK inference happens at engine level (cross-table), not within a single export.
  const foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[] = [];

  return {
    name,
    columns,
    primaryKey: idCol ? [idCol] : [],
    foreignKeys,
    indexes: idCol ? [{ name: `idx_${name}_${idCol}`, columns: [idCol], unique: true }] : [],
    constraints,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 40),
    stats,
  };
}

function inferType(values: unknown[]): NormalizedType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return 'UNKNOWN';
  let allInt = true;
  let allNum = true;
  let allBool = true;
  let allDate = true;
  for (const v of present) {
    if (typeof v === 'boolean') {
      allInt = false;
      allNum = false;
      allDate = false;
      continue;
    }
    if (typeof v === 'number') {
      allBool = false;
      allDate = false;
      if (!Number.isInteger(v)) allInt = false;
      continue;
    }
    if (typeof v === 'string') {
      allBool = false;
      if (!/^-?\d+$/.test(v)) allInt = false;
      if (!/^-?\d+(\.\d+)?$/.test(v)) allNum = false;
      if (!looksLikeDate(v)) allDate = false;
    } else {
      allInt = allNum = allBool = allDate = false;
    }
  }
  if (allBool) return 'BOOLEAN';
  if (allInt) return 'INTEGER';
  if (allNum) return 'REAL';
  if (allDate) return 'DATETIME';
  if (present.every((v) => typeof v === 'object')) return 'JSON';
  return 'TEXT';
}

export function looksLikeDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s.trim());
}

function baseName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

/** Column type normalization is re-applied post-inference for consistency. */
export function reNormalize(rawType: string): NormalizedType {
  return normalizeType(rawType);
}
