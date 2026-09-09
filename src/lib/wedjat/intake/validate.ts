// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: import validation (§115).
//
// Pre-canonical-import gate: row counts, primary keys, foreign keys, nullability,
// data types, date formats, enum values, duplicate identifiers, orphan records,
// referential integrity, encoding and character corruption. FAIL on any critical
// check blocks the import (§107: never silently import broken data).
// ═══════════════════════════════════════════════════════════════════════════════

import type { DiscoveredTable } from './discovery';
import type { TableMapping } from './canonical';
import { looksLikeDate } from './parsers/tabular';
import { tableSignature } from './canonical';

export interface ImportCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
  metric?: string;
}

export interface ImportReport {
  checks: ImportCheck[];
  passed: number;
  warned: number;
  failed: number;
  blocked: boolean;
  importable: boolean;
}

interface PriorSnapshotTable {
  name: string;
  columns: { name: string; type: string }[];
}

export function validateImport(
  tables: DiscoveredTable[],
  mappings: TableMapping[],
  priorTables: PriorSnapshotTable[] = [],
): ImportReport {
  const checks: ImportCheck[] = [];
  const tableNames = new Set(tables.map((t) => t.def.name.toLowerCase()));

  // ── row counts ──────────────────────────────────────────────────────────────
  const totalRows = tables.reduce((n, t) => n + t.def.rowCount, 0);
  const empty = tables.filter((t) => t.def.rowCount === 0).map((t) => t.def.name);
  checks.push({
    name: 'ROW_COUNTS',
    status: totalRows === 0 ? 'FAIL' : empty.length > 0 ? 'WARN' : 'PASS',
    detail:
      totalRows === 0
        ? 'no data rows found in any table'
        : empty.length > 0
          ? `${tables.length} tables, ${totalRows.toLocaleString()} rows; empty tables: ${empty.slice(0, 5).join(', ')}`
          : `${tables.length} tables, ${totalRows.toLocaleString()} rows`,
    metric: String(totalRows),
  });

  // ── primary keys ────────────────────────────────────────────────────────────
  const noPk = tables.filter((t) => t.def.primaryKey.length === 0 && t.def.rowCount > 0).map((t) => t.def.name);
  checks.push({
    name: 'PRIMARY_KEYS',
    status: noPk.length > 0 ? 'WARN' : 'PASS',
    detail:
      noPk.length > 0
        ? `${noPk.length} data tables without declared primary keys: ${noPk.slice(0, 5).join(', ')} — canonical identity will use inferred keys`
        : 'all data tables declare primary keys',
    metric: `${tables.length - noPk.length}/${tables.length}`,
  });

  // ── duplicate identifiers (PK value dups in sample) ─────────────────────────
  let dupIdTables = 0;
  let dupIdCount = 0;
  for (const t of tables) {
    if (t.def.primaryKey.length === 0 || t.def.sampleRows.length < 2) continue;
    const seen = new Set<string>();
    let dups = 0;
    for (const row of t.def.sampleRows) {
      const key = t.def.primaryKey.map((k) => String(row[k] ?? '∅')).join('|');
      if (seen.has(key)) dups += 1;
      else seen.add(key);
    }
    if (dups > 0) {
      dupIdTables += 1;
      dupIdCount += dups;
    }
  }
  checks.push({
    name: 'DUPLICATE_IDENTIFIERS',
    status: dupIdCount > 0 ? 'FAIL' : 'PASS',
    detail: dupIdCount > 0 ? `${dupIdCount} duplicate primary-key values in sample (${dupIdTables} tables)` : 'no duplicate identifiers in sampled data',
    metric: String(dupIdCount),
  });

  // ── foreign keys + orphan records + referential integrity ───────────────────
  let missingTargets = 0;
  let orphanSamples = 0;
  for (const t of tables) {
    for (const fk of t.def.foreignKeys) {
      if (!tableNames.has(fk.refTable.toLowerCase())) {
        missingTargets += 1;
        continue;
      }
      const parent = tables.find((p) => p.def.name.toLowerCase() === fk.refTable.toLowerCase());
      if (!parent || parent.def.sampleRows.length === 0 || t.def.sampleRows.length === 0) continue;
      const parentKeys = new Set(
        parent.def.sampleRows.map((r) => fk.refColumns.map((c) => String(r[c] ?? r[Object.keys(r).find((k) => k.toLowerCase() === c.toLowerCase()) ?? ''] ?? '∅')).join('|')),
      );
      for (const row of t.def.sampleRows) {
        const v = fk.columns.map((c) => String(row[c] ?? '∅')).join('|');
        if (v.split('|').every((x) => x === '∅' || x === 'null')) continue; // NULL FK is allowed
        if (!parentKeys.has(v)) orphanSamples += 1;
      }
    }
  }
  checks.push({
    name: 'FOREIGN_KEYS',
    status: missingTargets > 0 ? 'FAIL' : 'PASS',
    detail:
      missingTargets > 0
        ? `${missingTargets} foreign keys reference missing tables (schema drift or partial export)`
        : 'all foreign keys reference tables present in the snapshot',
    metric: String(missingTargets),
  });
  checks.push({
    name: 'ORPHAN_RECORDS',
    status: orphanSamples > 5 ? 'WARN' : 'PASS',
    detail:
      orphanSamples > 5
        ? `${orphanSamples} sampled child rows reference parents absent from the parent sample — referential integrity needs full-check before canonical merge`
        : `${orphanSamples} sampled orphan references (within sample coverage)`,
    metric: String(orphanSamples),
  });

  // ── nullability violations ──────────────────────────────────────────────────
  const nnViol: string[] = [];
  for (const t of tables) {
    for (const col of t.def.columns) {
      if (col.nullable || col.isPrimaryKey) continue;
      const stat = t.def.stats.find((s) => s.name === col.name);
      if (stat && stat.nullCount > 0) nnViol.push(`${t.def.name}.${col.name}`);
    }
  }
  checks.push({
    name: 'NULLABILITY',
    status: nnViol.length > 0 ? 'WARN' : 'PASS',
    detail: nnViol.length > 0 ? `NOT NULL columns containing nulls: ${nnViol.slice(0, 5).join(', ')}` : 'no NOT NULL violations',
    metric: String(nnViol.length),
  });

  // ── data types + date formats + enum values ─────────────────────────────────
  let typeMismatches = 0;
  let badDates = 0;
  let enumViolations = 0;
  for (const t of tables) {
    for (const col of t.columns) {
      const stat = t.def.stats.find((s) => s.name === col.def.name);
      if (!stat) continue;
      if ((col.def.type === 'INTEGER' || col.def.type === 'REAL' || col.def.type === 'NUMERIC') && !col.def.isPrimaryKey) {
        const nonNumeric = stat.sampleValues.filter((v) => v && !/^-?\d+(\.\d+)?$/.test(v)).length;
        typeMismatches += nonNumeric;
      }
      if (col.purpose === 'TEMPORAL' || col.def.type === 'DATETIME') {
        badDates += stat.sampleValues.filter((v) => v && !looksLikeDate(v)).length;
      }
      if (col.purpose === 'ENUM' || col.purpose === 'STATUS') {
        // enum domain is derived from the same data — check for near-duplicate labels (case variants)
        const lower = stat.enumValues.map((v) => v.toLowerCase());
        const dupLabels = lower.length - new Set(lower).size;
        enumViolations += dupLabels;
      }
    }
  }
  checks.push({ name: 'DATA_TYPES', status: typeMismatches > 0 ? 'WARN' : 'PASS', detail: typeMismatches > 0 ? `${typeMismatches} sampled values do not match declared numeric types` : 'sampled values match declared types', metric: String(typeMismatches) });
  checks.push({ name: 'DATE_FORMATS', status: badDates > 0 ? 'WARN' : 'PASS', detail: badDates > 0 ? `${badDates} non-ISO date strings in temporal columns` : 'temporal columns parse as ISO-8601', metric: String(badDates) });
  checks.push({ name: 'ENUM_VALUES', status: enumViolations > 0 ? 'WARN' : 'PASS', detail: enumViolations > 0 ? `${enumViolations} case-variant duplicate enum labels` : 'enumeration domains are consistent', metric: String(enumViolations) });

  // ── encoding / character corruption ─────────────────────────────────────────
  let replacementChars = 0;
  let mojibake = 0;
  for (const t of tables) {
    for (const stat of t.def.stats) {
      replacementChars += stat.sampleValues.join('').split('\uFFFD').length - 1;
      mojibake += (stat.sampleValues.join('').match(/[\u00C3\u00C2][\u0080-\u00BF\u20AC]/g) ?? []).length;
    }
  }
  checks.push({ name: 'ENCODING', status: replacementChars > 0 ? 'FAIL' : 'PASS', detail: replacementChars > 0 ? `${replacementChars} U+FFFD replacement characters — source encoding is not valid UTF-8` : 'valid UTF-8 throughout', metric: String(replacementChars) });
  checks.push({ name: 'CHARACTER_CORRUPTION', status: mojibake > 0 ? 'WARN' : 'PASS', detail: mojibake > 0 ? `${mojibake} mojibake sequences (double-encoded text likely)` : 'no mojibake patterns detected', metric: String(mojibake) });

  // ── schema drift vs prior snapshot (§115 unexpected schema drift) ───────────
  if (priorTables.length > 0) {
    const prior = new Map(priorTables.map((t) => [t.name.toLowerCase(), t]));
    const added = tables.filter((t) => !prior.has(t.def.name.toLowerCase())).map((t) => t.def.name);
    const removed = priorTables.filter((p) => !tableNames.has(p.name.toLowerCase())).map((p) => p.name);
    const driftCount = added.length + removed.length;
    checks.push({
      name: 'SCHEMA_DRIFT',
      status: driftCount > 0 ? 'WARN' : 'PASS',
      detail: driftCount > 0 ? `drift vs prior snapshot: +${added.length} tables (${added.slice(0, 3).join(', ')}), -${removed.length} (${removed.slice(0, 3).join(', ')})` : 'schema identical to prior snapshot',
      metric: String(driftCount),
    });
  }

  // ── mapping sanity (mappings cover all tables — zero data loss §143) ────────
  const mapped = new Set(mappings.map((m) => m.sourceTable.toLowerCase()));
  const unmapped = tables.filter((t) => !mapped.has(t.def.name.toLowerCase())).map((t) => t.def.name);
  checks.push({
    name: 'MAPPING_COVERAGE',
    status: unmapped.length > 0 ? 'WARN' : 'PASS',
    detail: unmapped.length > 0 ? `${unmapped.length} tables preserved as unmapped source data (§143): ${unmapped.slice(0, 5).join(', ')}` : 'every table received a mapping decision (canonical or preserved)',
    metric: `${tables.length - unmapped.length}/${tables.length}`,
  });

  const passed = checks.filter((c) => c.status === 'PASS').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;
  const failed = checks.filter((c) => c.status === 'FAIL').length;
  // Critical gates: duplicates identifiers, broken FK targets, encoding, zero rows.
  const criticalFailed = checks.filter((c) => c.status === 'FAIL' && ['DUPLICATE_IDENTIFIERS', 'FOREIGN_KEYS', 'ENCODING', 'ROW_COUNTS'].includes(c.name));
  return { checks, passed, warned, failed, blocked: criticalFailed.length > 0, importable: failed === 0 };
}

/** Exposed for drift reports: signature comparison helper. */
export function signatureOf(t: { name: string; columns: { name: string; type: string }[] }): string {
  return tableSignature(t);
}
