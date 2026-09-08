// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Database intake: normalized schema model (§106, §109).
//
// Every supported input format (SQLite binary, SQL dumps, CSV, JSON/JSONL) is
// parsed into ONE SchemaSnapshot shape so discovery/mapping/validation operate
// format-independently. Snapshots are persisted verbatim (immutable, versioned)
// as the source_schema_snapshot of §108.
// ═══════════════════════════════════════════════════════════════════════════════

export type NormalizedType =
  | 'INTEGER'
  | 'REAL'
  | 'NUMERIC'
  | 'TEXT'
  | 'BOOLEAN'
  | 'DATETIME'
  | 'BLOB'
  | 'JSON'
  | 'UNKNOWN';

export interface ColumnDef {
  name: string;
  rawType: string;
  type: NormalizedType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue: string | null;
}

export interface FkDef {
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ConstraintDef {
  name: string;
  type: string; // PRIMARY_KEY | FOREIGN_KEY | UNIQUE | CHECK | NOT_NULL | DEFAULT
  detail: string;
}

export interface ColumnStat {
  name: string;
  nullCount: number;
  nullPct: number;
  distinct: number | null;
  enumValues: string[];
  isEnumLike: boolean;
  min?: number;
  max?: number;
  avg?: number;
  avgLength?: number;
  sampleValues: string[];
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey: string[];
  foreignKeys: FkDef[];
  indexes: IndexDef[];
  constraints: ConstraintDef[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  stats: ColumnStat[];
}

export interface ViewDef {
  name: string;
  sql: string;
}

export interface SchemaSnapshot {
  engine: string; // SQLITE | POSTGRESQL | MYSQL | MARIADB | SQLSERVER | SQLITE_DUMP | CSV | JSON | JSONL
  dialect: string;
  detection: { method: string; confidence: number; detail: string };
  tables: TableDef[];
  views: ViewDef[];
  naming: { pattern: string; detail: string };
  counts: { tables: number; columns: number; fks: number; indexes: number; constraints: number; views: number };
}

// ── Type normalization (dialect-tolerant) ─────────────────────────────────────

const TYPE_MAP: [RegExp, NormalizedType][] = [
  [/^(tiny|small|medium|big)?int(\(\d+\))?( unsigned)?$/i, 'INTEGER'],
  [/^int(eger)?/i, 'INTEGER'],
  [/^serial|^bigserial|^smallserial/i, 'INTEGER'],
  [/^(numeric|decimal)\(/i, 'NUMERIC'],
  [/^money/i, 'NUMERIC'],
  [/^real|^float|^double( precision)?|^binary_double/i, 'REAL'],
  [/^bit varying|^bit\(/i, 'BOOLEAN'],
  [/^bool(ean)?/i, 'BOOLEAN'],
  [/^uuid|^guid/i, 'TEXT'],
  [/^(var)?char(\(\d+\))?|^varchar2|^character varying|^n(var)?char|^clob|^string/i, 'TEXT'],
  [/^text|^tinytext|^mediumtext|^longtext|^ntext|^memo/i, 'TEXT'],
  [/^json(b)?|^jsonb/i, 'JSON'],
  [/^(date|time)(stamp)?(\s*(with|without)\s+time zone)?|^datetime2?|^smalldatetime/i, 'DATETIME'],
  [/^year/i, 'INTEGER'],
  [/^blob|^bytea|^image|^varbinary|^binary/i, 'BLOB'],
  [/^enum\(|^set\(/i, 'TEXT'],
];

export function normalizeType(raw: string): NormalizedType {
  const t = raw.trim().toLowerCase();
  if (!t) return 'UNKNOWN';
  for (const [re, norm] of TYPE_MAP) if (re.test(t)) return norm;
  return 'UNKNOWN';
}

/** Identifier cleanup: strip SQL Server brackets, backticks, double quotes. */
export function cleanIdent(raw: string): string {
  return raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^`|`$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/"/g, '');
}

// ── Utilities shared by parsers ───────────────────────────────────────────────

export function computeColumnStat(
  name: string,
  values: unknown[],
  totalRows: number,
  type: NormalizedType,
): ColumnStat {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  const nullCount = values.length - present.length;
  const distinctSet = new Set<string>();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let numericCount = 0;
  let lenSum = 0;
  for (const v of present) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    distinctSet.add(s);
    const n = typeof v === 'number' ? v : Number(v);
    if (typeof n === 'number' && Number.isFinite(n)) {
      min = Math.min(min, n);
      max = Math.max(max, n);
      sum += n;
      numericCount += 1;
    }
    lenSum += s.length;
  }
  const distinct = distinctSet.size;
  const isEnumLike =
    distinct > 0 &&
    distinct <= 25 &&
    present.length >= Math.max(2, distinct * 1.5) &&
    (type === 'TEXT' || type === 'INTEGER' || type === 'BOOLEAN' || distinct <= 12);
  return {
    name,
    nullCount,
    nullPct: totalRows > 0 ? Math.round((nullCount / totalRows) * 1000) / 10 : 0,
    distinct,
    enumValues: isEnumLike ? [...distinctSet].slice(0, 25) : [],
    isEnumLike,
    min: numericCount > 0 ? Math.round(min * 100) / 100 : undefined,
    max: numericCount > 0 ? Math.round(max * 100) / 100 : undefined,
    avg: numericCount > 0 ? Math.round((sum / numericCount) * 100) / 100 : undefined,
    avgLength: present.length > 0 ? Math.round((lenSum / present.length) * 10) / 10 : 0,
    sampleValues: [...distinctSet].slice(0, 3),
  };
}

export function snapshotCounts(s: SchemaSnapshot): SchemaSnapshot {
  let columns = 0;
  let fks = 0;
  let indexes = 0;
  let constraints = 0;
  for (const t of s.tables) {
    columns += t.columns.length;
    fks += t.foreignKeys.length;
    indexes += t.indexes.length;
    constraints += t.constraints.length;
  }
  s.counts = { tables: s.tables.length, columns, fks, indexes, constraints, views: s.views.length };
  return s;
}

/** Naming-pattern analysis (§106 naming patterns). */
export function detectNamingPattern(tables: TableDef[]): { pattern: string; detail: string } {
  let snake = 0;
  let camel = 0;
  let pascal = 0;
  let upper = 0;
  for (const t of tables) {
    if (t.name === t.name.toUpperCase() && /[A-Z]/.test(t.name)) upper += 1;
    else if (t.name.includes('_')) snake += 1;
    else if (/^[a-z]+([A-Z][a-z]+)+$/.test(t.name)) camel += 1;
    else if (/^[A-Z][a-z]+([A-Z][a-z]+)*$/.test(t.name)) pascal += 1;
  }
  const total = tables.length || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const detail = `snake_case ${pct(snake)}, camelCase ${pct(camel)}, PascalCase ${pct(pascal)}, UPPER ${pct(upper)}`;
  const pattern =
    snake >= camel && snake >= pascal && snake >= upper
      ? 'snake_case'
      : camel >= pascal
        ? 'camelCase'
        : upper > 0
          ? 'UPPER_SNAKE'
          : 'PascalCase';
  return { pattern, detail };
}
