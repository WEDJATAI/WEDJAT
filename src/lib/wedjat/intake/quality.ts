// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: automatic data quality engine (§117).
//
// Post-mapping quality analysis: duplicates, null-heavy fields, invalid values,
// orphan relationships, conflicting records, outliers, stale records, schema
// anomalies, inconsistent units, invalid timestamps, broken references →
// a weighted 0..100 quality score with human-readable findings.
// ═══════════════════════════════════════════════════════════════════════════════

import type { DiscoveredTable } from './discovery';
import { contentHash } from '../ids';
import { looksLikeDate } from './parsers/tabular';

export interface DqFinding {
  kind: string;
  table?: string;
  column?: string;
  detail: string;
  severity: 'INFO' | 'WARN' | 'FAIL';
  count?: number;
}

export interface DqReport {
  score: number; // 0..100
  findings: DqFinding[];
  checkedTables: number;
  checkedRows: number;
}

export function analyzeDataQuality(tables: DiscoveredTable[]): DqReport {
  const findings: DqFinding[] = [];
  let penalty = 0;
  const tableNames = new Set(tables.map((t) => t.def.name.toLowerCase()));
  const measureColumns = new Map<string, { avg?: number; max?: number; table: string }[]>();

  const rows = tables.reduce((n, t) => n + t.def.rowCount, 0);

  for (const t of tables) {
    const name = t.def.name;

    // ── schema anomalies ─────────────────────────────────────────────────────
    if (t.def.primaryKey.length === 0 && t.def.rowCount > 0 && t.def.columns.length > 0) {
      findings.push({ kind: 'SCHEMA_ANOMALY', table: name, detail: 'table has no primary key', severity: 'WARN' });
      penalty += 4;
    }
    if (t.def.rowCount === 0) {
      findings.push({ kind: 'SCHEMA_ANOMALY', table: name, detail: 'table is empty (0 rows)', severity: 'INFO' });
      penalty += 1;
    }

    // ── exact duplicate rows (§117 duplicates) ───────────────────────────────
    if (t.def.sampleRows.length >= 2) {
      const seen = new Map<string, number>();
      for (const row of t.def.sampleRows) {
        const h = contentHash(JSON.stringify(row));
        seen.set(h, (seen.get(h) ?? 0) + 1);
      }
      const dups = [...seen.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
      if (dups > 0) {
        findings.push({ kind: 'DUPLICATE_ROWS', table: name, detail: `${dups} exactly-duplicate rows in sample set`, severity: dups > 2 ? 'WARN' : 'INFO', count: dups });
        penalty += Math.min(6, dups * 2);
      }
    }

    for (const col of t.columns) {
      const stat = t.def.stats.find((s) => s.name === col.def.name);
      if (!stat) continue;
      const cname = `${name}.${col.def.name}`;

      // ── null-heavy fields ─────────────────────────────────────────────────
      if (stat.nullPct > 60 && col.def.nullable && col.purpose !== 'DESCRIPTION') {
        findings.push({ kind: 'NULL_HEAVY', table: name, column: col.def.name, detail: `${stat.nullPct}% null values`, severity: 'WARN', count: stat.nullCount });
        penalty += 3;
      }

      // ── invalid timestamps ────────────────────────────────────────────────
      if (col.def.type === 'DATETIME' || col.purpose === 'TEMPORAL') {
        const bad = stat.sampleValues.filter((v) => v && !looksLikeDate(v)).length;
        if (bad > 0) {
          findings.push({ kind: 'INVALID_TIMESTAMP', table: name, column: col.def.name, detail: `${bad} sampled values not ISO-parseable`, severity: 'WARN', count: bad });
          penalty += 2;
        }
        // ── stale records (§117) ────────────────────────────────────────────
        const asDate = stat.sampleValues.map((v) => (v ? Date.parse(v) : NaN)).filter((d) => Number.isFinite(d));
        if (asDate.length > 0) {
          const maxAge = (Date.now() - Math.max(...asDate)) / 86_400_000;
          if (maxAge > 365) {
            findings.push({ kind: 'STALE_RECORDS', table: name, column: col.def.name, detail: `newest sampled record is ${Math.round(maxAge)} days old`, severity: 'INFO' });
            penalty += 1;
          }
        }
      }

      // ── outliers (coarse numeric heuristic) ───────────────────────────────
      if (col.purpose === 'MEASURE' && stat.avg != null && stat.max != null && stat.avg > 0 && stat.max > stat.avg * 50) {
        findings.push({ kind: 'OUTLIER', table: name, column: col.def.name, detail: `max ${stat.max} vs avg ${stat.avg} — potential outliers or mixed units`, severity: 'WARN' });
        penalty += 2;
      }

      // ── track measure columns for cross-table unit inconsistency ─────────
      if (col.purpose === 'MEASURE' && stat.avg != null) {
        const key = col.def.name.toLowerCase().replace(/^(total_|sum_|net_)/, '');
        const list = measureColumns.get(key) ?? [];
        list.push({ avg: stat.avg, max: stat.max, table: name });
        measureColumns.set(key, list);
      }
    }

    // ── conflicting records: same natural key, different content ────────────
    const naturalKey = t.def.primaryKey.length > 0 ? t.def.primaryKey : [t.def.columns[0]?.name].filter(Boolean) as string[];
    if (naturalKey.length > 0 && t.def.sampleRows.length >= 2) {
      const byKey = new Map<string, Set<string>>();
      for (const row of t.def.sampleRows) {
        const key = naturalKey.map((k) => String(row[k] ?? '∅')).join('|');
        const h = contentHash(JSON.stringify(row));
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key)!.add(h);
      }
      const conflicts = [...byKey.values()].filter((s) => s.size > 1).length;
      if (conflicts > 0) {
        findings.push({ kind: 'CONFLICTING_RECORDS', table: name, detail: `${conflicts} keys with divergent content in sample`, severity: 'FAIL', count: conflicts });
        penalty += 5;
      }
    }

    // ── orphan relationships / broken references (§117) ─────────────────────
    for (const fk of t.def.foreignKeys) {
      if (!tableNames.has(fk.refTable.toLowerCase())) {
        findings.push({ kind: 'BROKEN_REFERENCE', table: name, detail: `FK → ${fk.refTable} references a missing table`, severity: 'FAIL' });
        penalty += 6;
      }
    }
  }

  // ── inconsistent units across tables (§117) ────────────────────────────────
  for (const [colKey, entries] of measureColumns) {
    if (entries.length < 2) continue;
    const avgs = entries.map((e) => e.avg ?? 0).sort((a, b) => a - b);
    const low = avgs[0];
    const high = avgs[avgs.length - 1];
    if (low > 0 && high / low > 100) {
      findings.push({
        kind: 'INCONSISTENT_UNITS',
        column: colKey,
        detail: `same-named measure differs ~${Math.round(high / low)}× across tables (${entries.map((e) => `${e.table}: ${e.avg}`).slice(0, 3).join(', ')}) — possible cents vs units`,
        severity: 'WARN',
      });
      penalty += 3;
    }
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { score, findings, checkedTables: tables.length, checkedRows: rows };
}
