// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake parser: SQL dump files (PostgreSQL / MySQL / MariaDB
// / SQL Server / SQLite dumps, §106).
//
// Dialect-tolerant DDL extraction: CREATE TABLE / VIEW / INDEX, ALTER TABLE ADD
// CONSTRAINT (FK), and best-effort INSERT sampling for data evidence. Parsing
// never executes the dump (injection-safe by construction).
// ═══════════════════════════════════════════════════════════════════════════════

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
import type { DetectedFormat } from '../detect';

interface ParsedInsert {
  table: string;
  columns: string[];
  values: Record<string, unknown>[];
  statementCount: number;
}

export function parseSqlDump(text: string, format: DetectedFormat): SchemaSnapshot {
  const dialect = format === 'POSTGRESQL' ? 'postgresql' : format === 'MYSQL' ? 'mysql' : format === 'MARIADB' ? 'mariadb' : format === 'SQLSERVER' ? 'sqlserver' : 'sqlite';
  const statements = splitStatements(text);

  const tables = new Map<string, TableDef>();
  const views: { name: string; sql: string }[] = [];
  const indexes = new Map<string, IndexDef[]>();
  const alterFks: { table: string; columns: string[]; refTable: string; refColumns: string[] }[] = [];
  const inserts = new Map<string, ParsedInsert>();
  let parseWarnings = 0;

  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      if (/^CREATE\s+(OR\s+REPLACE\s+)?(TEMP(ORARY)?\s+)?TABLE/i.test(s)) {
        const t = parseCreateTable(s);
        if (t) tables.set(t.name, t);
      } else if (/^CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(s)) {
        const m = /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s+AS\s+([\s\S]+)$/i.exec(s);
        if (m) views.push({ name: cleanIdent(m[1]), sql: m[2].slice(0, 4000) });
      } else if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(s)) {
        const idx = parseCreateIndex(s);
        if (idx) {
          const list = indexes.get(idx.table) ?? [];
          list.push(idx.def);
          indexes.set(idx.table, list);
        }
      } else if (/^ALTER\s+TABLE/i.test(s)) {
        const fk = parseAlterFk(s);
        if (fk) alterFks.push(fk);
      } else if (/^INSERT\s+INTO/i.test(s)) {
        parseInsert(s, inserts);
      }
    } catch {
      parseWarnings += 1;
    }
  }

  // Attach ALTER TABLE FKs + indexes to their tables.
  for (const fk of alterFks) {
    const t = tables.get(fk.table);
    if (t) {
      t.foreignKeys.push({ columns: fk.columns, refTable: fk.refTable, refColumns: fk.refColumns });
      t.constraints.push({ name: `fk_${fk.columns.join('_')}`, type: 'FOREIGN_KEY', detail: `${fk.columns.join(',')} → ${fk.refTable}(${fk.refColumns.join(',')})` });
      for (const col of t.columns) if (fk.columns.includes(col.name)) col.isForeignKey = true;
    }
  }
  for (const [table, idxList] of indexes) {
    const t = tables.get(table);
    if (t) {
      t.indexes.push(...idxList);
      for (const idx of idxList.filter((i) => i.unique)) {
        t.constraints.push({ name: idx.name, type: 'UNIQUE', detail: `(${idx.columns.join(', ')})` });
      }
    }
  }

  // INSERT-derived data evidence: row counts + samples + stats.
  for (const [name, ins] of inserts) {
    const t = tables.get(name);
    if (!t) continue;
    t.rowCount = ins.statementCount + ins.values.length; // multi-row VALUES counted once per statement
    t.rowCount = Math.max(ins.values.length, ins.statementCount);
    t.sampleRows = ins.values.slice(0, 40);
    t.stats = t.columns.map((c) =>
      computeColumnStat(c.name, ins.values.map((r) => r[c.name]), Math.max(t.rowCount, ins.values.length), c.type),
    );
  }

  const tableList = [...tables.values()];
  const snapshot: SchemaSnapshot = {
    engine: format,
    dialect,
    detection: {
      method: 'ddl-sniff',
      confidence: 0.9,
      detail: `SQL dump parsed: ${tableList.length} tables, ${views.length} views${parseWarnings > 0 ? `, ${parseWarnings} statements skipped (parse warnings)` : ''}.`,
    },
    tables: tableList,
    views,
    naming: detectNamingPattern(tableList),
    counts: { tables: 0, columns: 0, fks: 0, indexes: 0, constraints: 0, views: 0 },
  };
  if (parseWarnings > 0) {
    (snapshot as SchemaSnapshot & { parseWarnings?: number }).parseWarnings = parseWarnings;
  }
  return snapshotCounts(snapshot);
}

// ── statement splitting (respect quotes, dollar-quoting-lite, GO batches) ─────
function splitStatements(text: string): string[] {
  const cleaned = text
    .replace(/^--[^\n]*$/gm, '')
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*GO\s*$/gim, ';');
  const parts: string[] = [];
  let cur = '';
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "'" && !inDquote) inSquote = !inSquote;
    else if (ch === '"' && !inSquote) inDquote = !inDquote;
    if (ch === ';' && !inSquote && !inDquote) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// ── CREATE TABLE ──────────────────────────────────────────────────────────────
function parseCreateTable(stmt: string): TableDef | null {
  const header = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/i.exec(stmt);
  if (!header) return null;
  const name = cleanIdent(header[1].split('.').pop() ?? header[1]);
  const body = extractParenBody(stmt, header[0].length - 1);
  if (!body) return null;

  const defs = splitTopLevel(body);
  const columns: ColumnDef[] = [];
  const constraints: ConstraintDef[] = [];
  const foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[] = [];
  const pkColumns: string[] = [];
  const uniqueIdx: IndexDef[] = [];

  for (const def of defs) {
    const d = def.trim();
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|KEY|INDEX)/i.test(d)) {
      const fk = parseTableConstraintFk(d);
      if (fk) {
        foreignKeys.push(fk);
        constraints.push({ name: `fk_${fk.columns.join('_')}`, type: 'FOREIGN_KEY', detail: `${fk.columns.join(',')} → ${fk.refTable}(${fk.refColumns.join(',')})` });
        continue;
      }
      const pk = /^PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(d);
      if (pk) {
        const cols = splitNameList(pk[1]);
        pkColumns.push(...cols);
        constraints.push({ name: 'PRIMARY KEY', type: 'PRIMARY_KEY', detail: `(${cols.join(', ')})` });
        continue;
      }
      const uq = /^UNIQUE\s*(?:KEY\s*\w+\s*)?\(([^)]+)\)/i.exec(d);
      if (uq) {
        const cols = splitNameList(uq[1]);
        constraints.push({ name: `unique_${cols.join('_')}`, type: 'UNIQUE', detail: `(${cols.join(', ')})` });
        continue;
      }
      constraints.push({ name: 'inline_constraint', type: 'CHECK', detail: d.slice(0, 120) });
      continue;
    }

    // Column definition: name type [modifiers]
    const m = /^([^\s(]+)\s*([^(]*?(?:\([^)]*\))?)/.exec(d);
    if (!m) continue;
    const colName = cleanIdent(m[1]);
    if (!colName) continue;
    const rawType = (m[2] || '').trim().split(/\s+/).slice(0, 2).join(' ') || 'UNKNOWN';
    const isPk = /PRIMARY\s+KEY/i.test(d);
    const notNull = /NOT\s+NULL/i.test(d);
    const dflt = /DEFAULT\s+('(?:[^']|'')*'|[\w().+-]+)/i.exec(d)?.[1] ?? null;
    const inlineRef = /REFERENCES\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i.exec(d);
    const fkCol = inlineRef
      ? { columns: [colName], refTable: cleanIdent(inlineRef[1].split('.').pop() ?? inlineRef[1]), refColumns: inlineRef[2] ? splitNameList(inlineRef[2]) : ['id'] }
      : null;
    columns.push({
      name: colName,
      rawType: rawType.toUpperCase(),
      type: normalizeType(rawType),
      nullable: !notNull && !isPk,
      isPrimaryKey: isPk,
      isForeignKey: !!fkCol,
      defaultValue: dflt,
    });
    if (isPk) pkColumns.push(colName);
    if (fkCol) {
      foreignKeys.push(fkCol);
      constraints.push({ name: `fk_${colName}`, type: 'FOREIGN_KEY', detail: `${colName} → ${fkCol.refTable}(${fkCol.refColumns.join(',')})` });
    }
    if (/AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|SERIAL/i.test(d)) {
      constraints.push({ name: `${colName}_auto`, type: 'DEFAULT', detail: `${colName} auto-generated identifier` });
    }
    if (notNull) constraints.push({ name: `${colName}_nn`, type: 'NOT_NULL', detail: `${colName} NOT NULL` });
  }

  const fkNames = new Set(foreignKeys.flatMap((f) => f.columns));
  for (const c of columns) if (fkNames.has(c.name)) c.isForeignKey = true;

  return {
    name,
    columns,
    primaryKey: [...new Set(pkColumns)],
    foreignKeys,
    indexes: uniqueIdx,
    constraints,
    rowCount: 0,
    sampleRows: [],
    stats: [],
  };
}

function extractParenBody(s: string, openIdx: number): string | null {
  if (s[openIdx] !== '(') return null;
  let depth = 0;
  let inS = false;
  let inD = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return s.slice(openIdx + 1, i);
      }
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inS = false;
  for (const ch of body) {
    if (ch === "'" && depth === 0) inS = !inS;
    if (!inS) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function splitNameList(s: string): string[] {
  return s.split(',').map((c) => cleanIdent(c.trim())).filter(Boolean);
}

function parseTableConstraintFk(d: string): { columns: string[]; refTable: string; refColumns: string[] } | null {
  const m = /(?:FOREIGN\s+KEY|CONSTRAINT\s+\S+\s+FOREIGN\s+KEY)\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i.exec(d);
  if (!m) return null;
  return {
    columns: splitNameList(m[1]),
    refTable: cleanIdent(m[2].split('.').pop() ?? m[2]),
    refColumns: m[3] ? splitNameList(m[3]) : ['id'],
  };
}

// ── CREATE INDEX ──────────────────────────────────────────────────────────────
function parseCreateIndex(stmt: string): { table: string; def: IndexDef } | null {
  const m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s+ON\s+([^\s(]+)\s*(?:USING\s+\w+\s*)?\(([\s\S]+)\)$/i.exec(stmt);
  if (!m) return null;
  const cols = splitTopLevel(m[4]).map((c) => cleanIdent(c.trim().split(/\s+/)[0]));
  return {
    table: cleanIdent(m[3].split('.').pop() ?? m[3]),
    def: { name: cleanIdent(m[2]), columns: cols, unique: !!m[1] },
  };
}

// ── ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY ───────────────────────────────
function parseAlterFk(stmt: string): { table: string; columns: string[]; refTable: string; refColumns: string[] } | null {
  const m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?(?:FOREIGN\s+KEY|INDEX)\s*(?:\([^)]*\)\s*)?\(?([\w\s,"]+?)\)?\s*REFERENCES\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i.exec(stmt);
  if (!m || !/FOREIGN\s+KEY/i.test(stmt)) return null;
  const table = cleanIdent(m[1].split('.').pop() ?? m[1]);
  const columns = m[2].split(',').map((c) => cleanIdent(c.trim())).filter(Boolean);
  if (columns.length === 0) return null;
  return {
    table,
    columns,
    refTable: cleanIdent(m[3].split('.').pop() ?? m[3]),
    refColumns: m[4] ? splitNameList(m[4]) : ['id'],
  };
}

// ── INSERT sampling ───────────────────────────────────────────────────────────
function parseInsert(stmt: string, inserts: Map<string, ParsedInsert>): void {
  const m = /^INSERT\s+INTO\s+([^\s(]+)\s*(?:\(([^)]+)\))?\s*VALUES\s*([\s\S]+)$/i.exec(stmt);
  if (!m) return;
  const table = cleanIdent(m[1].split('.').pop() ?? m[1]);
  const columns = m[2] ? splitNameList(m[2]) : [];
  const tuples = extractValueTuples(m[3]);
  const existing = inserts.get(table) ?? { table, columns, values: [], statementCount: 0 };
  existing.statementCount += 1;
  if (columns.length > 0 && existing.columns.length === 0) existing.columns = columns;
  for (const tuple of tuples.slice(0, 40)) {
    const row: Record<string, unknown> = {};
    const cols = columns.length > 0 ? columns : tuple.map((_, i) => `col_${i + 1}`);
    tuple.forEach((v, i) => {
      if (cols[i]) row[cols[i]] = v;
    });
    existing.values.push(row);
  }
  inserts.set(table, existing);
}

function extractValueTuples(valuesPart: string): unknown[][] {
  const tuples: unknown[][] = [];
  let i = 0;
  while (i < valuesPart.length) {
    while (i < valuesPart.length && /[\s,]/.test(valuesPart[i])) i++;
    if (valuesPart[i] !== '(') break;
    let depth = 0;
    let inS = false;
    let start = i + 1;
    let end = -1;
    for (let j = i; j < valuesPart.length; j++) {
      const ch = valuesPart[j];
      if (ch === "'" && depth === 1) {
        if (inS && valuesPart[j + 1] === "'") j++;
        else inS = !inS;
        continue;
      }
      if (inS) continue;
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    tuples.push(parseValueTuple(valuesPart.slice(start, end)));
    i = end + 1;
  }
  return tuples;
}

function parseValueTuple(tuple: string): unknown[] {
  const out: unknown[] = [];
  let cur = '';
  let inS = false;
  let hasVal = false;
  const push = () => {
    if (!hasVal) return;
    const v = cur.trim();
    if (v.toUpperCase() === 'NULL') out.push(null);
    else if (/^-?\d+(\.\d+)?$/.test(v)) out.push(Number(v));
    else if (/^'.*$/.test(v)) out.push(v.slice(1, v.endsWith("'") && v.length > 1 ? -1 : undefined).replace(/''/g, "'"));
    else out.push(v);
    cur = '';
    hasVal = false;
  };
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inS) {
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          cur += "'";
          i++;
        } else inS = false;
      } else cur += ch;
      continue;
    }
    if (ch === "'") {
      inS = true;
      hasVal = true;
      if (cur.trim().length > 0) {
        // e.g. E'…' or N'…' prefix — drop it
        cur = cur.trim().replace(/^[ENB]$/i, '');
      }
      continue;
    }
    if (ch === ',') {
      push();
      continue;
    }
    cur += ch;
    if (ch.trim().length > 0) hasVal = true;
  }
  push();
  return out;
}
