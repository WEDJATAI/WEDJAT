// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: schema drift detection (§142).
//
// When a new version of an external platform database is uploaded, compares the
// new snapshot against the last imported one and reports ADDED / REMOVED /
// MODIFIED / RENAMED / DEPRECATED changes. Nothing is deleted — drift is
// informational and feeds the import report + narrative.
// ═══════════════════════════════════════════════════════════════════════════════

import type { SchemaSnapshot } from './schema-model';
import { tableSignature } from './canonical';

export interface DriftChange {
  kind: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'RENAMED' | 'DEPRECATED';
  objectType: 'TABLE' | 'COLUMN' | 'INDEX' | 'CONSTRAINT';
  name: string;
  detail: string;
}

export interface DriftResult {
  changes: DriftChange[];
  summary: string;
}

interface MinimalTable {
  name: string;
  columns: { name: string; type: string; rawType: string }[];
  rowCount: number;
}

export function detectDrift(
  from: SchemaSnapshot,
  to: SchemaSnapshot,
  fromVersion: string,
  toVersion: string,
): DriftResult {
  const changes: DriftChange[] = [];
  const fromMap = new Map(from.tables.map((t) => [t.name.toLowerCase(), t]));
  const toMap = new Map(to.tables.map((t) => [t.name.toLowerCase(), t]));

  const added = [...toMap.values()].filter((t) => !fromMap.has(t.name.toLowerCase()));
  const removed = [...fromMap.values()].filter((t) => !toMap.has(t.name.toLowerCase()));

  // RENAME detection: a removed table whose column signature matches an added table.
  const removedUsed = new Set<string>();
  for (const rem of removed) {
    const remSig = sig(rem);
    const match = added.find((a) => sig(a) === remSig && !changes.some((c) => c.kind === 'RENAMED' && c.name === a.name));
    if (match) {
      changes.push({ kind: 'RENAMED', objectType: 'TABLE', name: `${rem.name} → ${match.name}`, detail: `identical column signature (${match.columns.length} columns)` });
      changes.push({ kind: 'DEPRECATED', objectType: 'TABLE', name: rem.name, detail: `superseded by rename to ${match.name} (retained in source preservation layer)` });
      removedUsed.add(rem.name.toLowerCase());
    }
  }
  for (const rem of removed) {
    if (removedUsed.has(rem.name.toLowerCase())) continue;
    changes.push({ kind: 'REMOVED', objectType: 'TABLE', name: rem.name, detail: `present in ${fromVersion}, absent in ${toVersion} (${rem.columns.length} columns, ${rem.rowCount} rows lost from canonical view — preserved in source layer)` });
  }
  for (const add of added) {
    if (changes.some((c) => c.kind === 'RENAMED' && c.name.endsWith(`→ ${add.name}`))) continue;
    changes.push({ kind: 'ADDED', objectType: 'TABLE', name: add.name, detail: `new table (${add.columns.length} columns, ${add.rowCount} rows)` });
  }

  // Common tables: column-level drift.
  for (const [key, fromTable] of fromMap) {
    const toTable = toMap.get(key);
    if (!toTable) continue;
    const fromCols = new Map(fromTable.columns.map((c) => [c.name.toLowerCase(), c]));
    const toCols = new Map(toTable.columns.map((c) => [c.name.toLowerCase(), c]));
    for (const [colKey, col] of toCols) {
      if (!fromCols.has(colKey)) {
        // column rename heuristic: same type, name absent before
        const candidate = [...fromCols.values()].find(
          (fc) => fc.type === col.type && !toCols.has(fc.name.toLowerCase()),
        );
        if (candidate) {
          changes.push({ kind: 'RENAMED', objectType: 'COLUMN', name: `${fromTable.name}.${candidate.name} → ${col.name}`, detail: `same type ${col.type}` });
        } else {
          changes.push({ kind: 'ADDED', objectType: 'COLUMN', name: `${toTable.name}.${col.name}`, detail: `new ${col.rawType} column` });
        }
      } else if (fromCols.get(colKey)!.type !== col.type) {
        changes.push({ kind: 'MODIFIED', objectType: 'COLUMN', name: `${toTable.name}.${col.name}`, detail: `type ${fromCols.get(colKey)!.rawType} → ${col.rawType}` });
      }
    }
    for (const [colKey, col] of fromCols) {
      if (!toCols.has(colKey)) {
        changes.push({ kind: 'REMOVED', objectType: 'COLUMN', name: `${fromTable.name}.${col.name}`, detail: `column dropped in ${toVersion} — values retained in source preservation layer (§143)` });
      }
    }
    if (fromTable.rowCount !== toTable.rowCount) {
      changes.push({
        kind: 'MODIFIED',
        objectType: 'TABLE',
        name: toTable.name,
        detail: `row count ${fromTable.rowCount.toLocaleString()} → ${toTable.rowCount.toLocaleString()} (${toTable.rowCount > fromTable.rowCount ? '+' : ''}${(toTable.rowCount - fromTable.rowCount).toLocaleString()})`,
      });
    }
  }

  // View drift (coarse).
  const fromViews = new Set(from.views.map((v) => v.name.toLowerCase()));
  for (const v of to.views) if (!fromViews.has(v.name.toLowerCase())) changes.push({ kind: 'ADDED', objectType: 'CONSTRAINT', name: `view:${v.name}`, detail: 'new view definition' });

  const summary =
    changes.length === 0
      ? `No schema drift between ${fromVersion} and ${toVersion}.`
      : `Drift ${fromVersion} → ${toVersion}: ${count(changes, 'ADDED')} added, ${count(changes, 'REMOVED')} removed, ${count(changes, 'MODIFIED')} modified, ${count(changes, 'RENAMED')} renamed, ${count(changes, 'DEPRECATED')} deprecated.`;
  return { changes, summary };
}

function sig(t: MinimalTable): string {
  return tableSignature({ name: '', columns: t.columns.map((c) => ({ name: c.name, type: c.type })) });
}

function count(changes: DriftChange[], kind: DriftChange['kind']): number {
  return changes.filter((c) => c.kind === kind).length;
}
