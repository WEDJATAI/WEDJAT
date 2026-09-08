// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: database-to-knowledge pipeline (§118–§124, §139).
//
// Converts discovered schema + data aggregates into WEDJAT knowledge documents
// that flow through the REAL ingestion pipeline (chunking → quality → embedding
// → indexing → RAG-ready, §119). Knowledge derives from aggregates and schema
// facts, never raw row dumps (data minimization). Temporal knowledge is
// classified (§121); KG edges record fact-vs-inference (§140); duplicates are
// marked, never deleted (§141).
// ═══════════════════════════════════════════════════════════════════════════════

import type { DiscoveredTable, DiscoveryResult } from './discovery';
import type { TableMapping } from './canonical';
import type { DqReport } from './quality';
import type { SchemaSnapshot } from './schema-model';

export interface KnowledgeDoc {
  slug: string;
  title: string;
  content: string;
  kind: 'PLATFORM_PROFILE' | 'TABLE_PROFILE' | 'BUSINESS_RULES' | 'CROSS_PLATFORM';
}

export interface KgEdgeDraft {
  subject: string;
  predicate: string;
  object: string;
  classification: 'EXPLICIT_SOURCE_FACT' | 'HIGH_CONFIDENCE_INFERENCE' | 'MEDIUM_CONFIDENCE_INFERENCE' | 'LOW_CONFIDENCE_INFERENCE';
  evidence: string;
}

export interface DuplicateDraft {
  kind: 'EXACT' | 'NEAR' | 'SEMANTIC';
  left: string;
  right: string;
  status: 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'RELATED';
  evidence: string;
}

const DOC_KNOWLEDGE_WORTHY_AVG_LEN = 24; // §120: not every text column is knowledge — quality-scored

export function extractKnowledge(
  source: { id: string; name: string; platform: string; versionLabel: string; engine: string; checksum: string; byteSize: number },
  snapshot: SchemaSnapshot,
  discovery: DiscoveryResult,
  mappings: TableMapping[],
  dq: DqReport,
): { docs: KnowledgeDoc[]; kgEdges: KgEdgeDraft[]; supersededTableDocs: string[] } {
  const docs: KnowledgeDoc[] = [];
  const kgEdges: KgEdgeDraft[] = [];
  const plat = source.platform;
  const mappingByTable = new Map(mappings.map((m) => [m.sourceTable.toLowerCase(), m]));

  // ── §119 stage 1: platform profile document ────────────────────────────────
  const entityDistribution = new Map<string, number>();
  for (const m of mappings) {
    const key = m.canonicalEntity ?? 'PRESERVED';
    entityDistribution.set(key, (entityDistribution.get(key) ?? 0) + 1);
  }
  const totalRows = discovery.tables.reduce((n, t) => n + t.def.rowCount, 0);
  const profileLines: string[] = [
    `# ${plat} database profile — ${source.name} (${source.versionLabel})`,
    '',
    `Engine: ${snapshot.engine} (${snapshot.dialect}). Detected via ${snapshot.detection.method} (${Math.round(snapshot.detection.confidence * 100)}% confidence): ${snapshot.detection.detail}`,
    `Artifact checksum (sha256, short): ${source.checksum.slice(0, 12)}. Size: ${(source.byteSize / 1024).toFixed(1)} KB. Immutable source preserved (§108).`,
    '',
    '## Structure',
    '',
    `${snapshot.counts.tables} tables, ${snapshot.counts.columns} columns, ${snapshot.counts.fks} foreign keys, ${snapshot.counts.indexes} indexes, ${snapshot.counts.views} views. ${totalRows.toLocaleString()} total rows. Naming pattern: ${snapshot.naming.pattern} (${snapshot.naming.detail}).`,
    '',
    '## Canonical entity distribution (WEDJAT model)',
    '',
    ...[...entityDistribution.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `- ${e}: ${n} table(s)`),
    '',
    '## Data quality',
    '',
    `Quality score ${dq.score}/100 across ${dq.checkedTables} tables. ${dq.findings.length} findings (${dq.findings.filter((f) => f.severity === 'FAIL').length} critical).`,
    ...dq.findings.slice(0, 6).map((f) => `- ${f.severity} ${f.kind}${f.table ? ` on ${f.table}${f.column ? `.${f.column}` : ''}` : ''}: ${f.detail}`),
    '',
    '## Provenance',
    '',
    `Source namespace: platform=${plat}, database=${source.name}, version=${source.versionLabel}. All statements in profiles below derive from this snapshot only. Knowledge origin: ${plat} ${source.name} (source_database_id ${source.id}).`,
  ];
  docs.push({
    slug: `db-${source.name}-${source.versionLabel}-profile`,
    title: `${plat} ${source.name} ${source.versionLabel} — database profile`,
    content: profileLines.join('\n'),
    kind: 'PLATFORM_PROFILE',
  });

  // KG: platform → uses → technology; platform → contains → table; source preservation (§139)
  kgEdges.push({ subject: `platform:${plat}`, predicate: 'uses', object: `technology:${snapshot.engine}`, classification: 'EXPLICIT_SOURCE_FACT', evidence: `format detection (${snapshot.detection.method}) on artifact ${source.id}` });
  kgEdges.push({ subject: `platform:${plat}`, predicate: 'stores_data_in', object: `source:${source.name}`, classification: 'EXPLICIT_SOURCE_FACT', evidence: `uploaded artifact ${source.id} (${source.engine})` });

  // ── §119: per-table profile documents (knowledge-bearing tables only) ─────
  for (const t of discovery.tables) {
    const mapping = mappingByTable.get(t.def.name.toLowerCase());
    const canonical = mapping?.canonicalEntity ?? null;
    const isDocTable = t.documentColumns.length > 0;
    const knowledgeWorthy = t.documentColumns.some((c) => {
      const stat = t.def.stats.find((s) => s.name === c);
      return (stat?.avgLength ?? 0) >= DOC_KNOWLEDGE_WORTHY_AVG_LEN;
    });
    // Import tables with canonical mappings or doc-worthy content (§118/§120).
    if (!canonical && !isDocTable) continue;

    const lines: string[] = [
      `# ${plat} — ${t.def.name}${canonical ? ` (canonical: ${canonical})` : ' (preserved source table)'}`,
      '',
      `Table purpose: ${t.purpose}. ${t.reason}.`,
      `Rows: ${t.def.rowCount.toLocaleString()}. Canonical mapping confidence: ${mapping ? `${mapping.confidence}% (${mapping.confidenceLabel})` : 'unmapped — preserved (§143)'}.`,
      '',
      '## Columns',
      '',
      ...t.columns.slice(0, 30).map((c) => {
        const stat = t.def.stats.find((s) => s.name === c.def.name);
        const parts = [`- ${c.def.name} (${c.def.rawType}${c.def.isPrimaryKey ? ', PK' : ''}${c.def.isForeignKey ? ', FK' : ''}) — ${c.purpose.toLowerCase()}`];
        if (stat) {
          if (c.purpose === 'ENUM' || c.purpose === 'STATUS') parts.push(`; values: ${stat.enumValues.slice(0, 10).join(' | ')}`);
          if (c.purpose === 'TEMPORAL' && stat.min != null) parts.push(`; observed range ${stat.min}…${stat.max}`);
          if (c.purpose === 'MEASURE' && stat.avg != null) parts.push(`; avg ${stat.avg}, min ${stat.min}, max ${stat.max}`);
          if (stat.nullPct > 0) parts.push(`; null ${stat.nullPct}%`);
        }
        return parts.join('');
      }),
      '',
      '## Relationships',
      '',
      ...(t.def.foreignKeys.length > 0
        ? t.def.foreignKeys.map((fk) => `- references ${fk.refTable}(${fk.refColumns.join(', ')}) via ${fk.columns.join(', ')}`)
        : t.outboundRefs.length > 0
          ? t.outboundRefs.map((r) => `- inferred reference → ${r}`)
          : ['- none detected']),
      ...(t.inboundRefs.length > 0 ? [`- referenced by: ${t.inboundRefs.join(', ')}`] : []),
      '',
      '## Temporal model (§121)',
      '',
      ...(t.temporalFields.length > 0
        ? t.temporalFields.map((f) => {
            const stat = t.def.stats.find((s) => s.name === f);
            const range = stat?.sampleValues.filter(Boolean).slice(0, 2).join(' … ');
            return `- ${f}${range ? ` (observed: ${range})` : ''}`;
          })
        : ['- no temporal columns — records carry no explicit currency; treat as unknown-time facts']),
      ...(t.statusModel.length > 0 ? ['', `Status model: ${t.statusModel.join(' → ')} (state domain discovered from data).`] : []),
      '',
      '## Source lineage',
      '',
      `platform=${plat} · database=${source.name} · version=${source.versionLabel} · table=${t.def.name} · artifact=${source.checksum.slice(0, 12)}`,
    ];
    docs.push({
      slug: `db-${source.name}-${t.def.name}`,
      title: `${plat} ${t.def.name} — ${canonical ?? 'preserved'} table profile`,
      content: lines.join('\n'),
      kind: 'TABLE_PROFILE',
    });

    // KG edges per table (§139/§140)
    kgEdges.push({ subject: `platform:${plat}`, predicate: 'contains', object: `table:${t.def.name}`, classification: 'EXPLICIT_SOURCE_FACT', evidence: `schema snapshot of ${source.name} ${source.versionLabel}` });
    if (canonical) {
      const inferenceClass =
        mapping!.confidenceLabel === 'HIGH_CONFIDENCE'
          ? 'HIGH_CONFIDENCE_INFERENCE'
          : mapping!.confidenceLabel === 'MEDIUM_CONFIDENCE'
            ? 'MEDIUM_CONFIDENCE_INFERENCE'
            : 'LOW_CONFIDENCE_INFERENCE';
      kgEdges.push({ subject: `table:${t.def.name}`, predicate: 'maps_to', object: `entity:${canonical}`, classification: inferenceClass, evidence: `${mapping!.confidence}% — ${mapping!.reason}` });
    }
    for (const fk of t.def.foreignKeys) {
      kgEdges.push({ subject: `table:${t.def.name}`, predicate: 'depends_on', object: `table:${fk.refTable}`, classification: 'EXPLICIT_SOURCE_FACT', evidence: `declared FK (${fk.columns.join(', ')} → ${fk.refColumns.join(', ')})` });
    }
    for (const out of t.outboundRefs) {
      if (t.def.foreignKeys.some((fk) => fk.refTable.toLowerCase() === out.toLowerCase())) continue;
      kgEdges.push({ subject: `table:${t.def.name}`, predicate: 'depends_on', object: `table:${out}`, classification: 'MEDIUM_CONFIDENCE_INFERENCE', evidence: `column-name inferred relationship (${plat} export)` });
    }
  }

  // ── §119: business-rules document (workflow states, tenant boundaries, audit models)
  const ruleTables = discovery.tables.filter((t) => t.statusModel.length > 0 || t.tenantFields.length > 0 || t.auditFields.length > 0);
  if (ruleTables.length > 0) {
    const lines: string[] = [
      `# ${plat} — discovered business rules (${source.name} ${source.versionLabel})`,
      '',
      `Derived from schema + data aggregates of the ${source.name} database. OBSERVED PATTERNS, not recommendations (§159).`,
      '',
      ...ruleTables.flatMap((t) => {
        const block: string[] = [`## ${t.def.name}`, ''];
        if (t.statusModel.length > 0) {
          block.push(`Workflow states (observed): ${t.statusModel.join(', ')}.`);
          const archived = t.columns.find((c) => /archived|deleted_at|is_deleted/i.test(c.def.name));
          if (archived) block.push(`Historical records: ${archived.def.name} marks records as historical/superseded (§121 temporal classification).`);
        }
        if (t.tenantFields.length > 0) block.push(`Tenant scoping: ${t.tenantFields.join(', ')} partition records by tenant (§109 tenant boundary).`);
        if (t.auditFields.length > 0) block.push(`Audit model: ${t.auditFields.join(', ')} record authorship/revision (§109 audit fields).`);
        const measures = t.columns.filter((c) => c.purpose === 'MEASURE').map((c) => c.def.name);
        if (measures.length > 0) block.push(`Quantities tracked: ${measures.join(', ')}.`);
        block.push('');
        return block;
      }),
      '## Provenance', '',
      `platform=${plat} · database=${source.name} · version=${source.versionLabel} · derived=rules-discovery`,
    ];
    docs.push({
      slug: `db-${source.name}-rules`,
      title: `${plat} ${source.name} — discovered business rules`,
      content: lines.join('\n'),
      kind: 'BUSINESS_RULES',
    });
    for (const t of ruleTables) {
      if (t.statusModel.length > 0) {
        kgEdges.push({ subject: `table:${t.def.name}`, predicate: 'specifies', object: `workflow:${t.statusModel.slice(0, 6).join('-')}`, classification: 'MEDIUM_CONFIDENCE_INFERENCE', evidence: 'status domain discovered from column values' });
      }
    }
  }

  return { docs, kgEdges, supersededTableDocs: [] };
}

/** §141: cross-source duplicate detection (never deletes). */
export function detectCrossSourceDuplicates(
  current: { sourceId: string; platform: string; tables: DiscoveredTable[]; mappings: TableMapping[] },
  others: { sourceId: string; platform: string; tables: DiscoveredTable[]; mappings: TableMapping[] }[],
): DuplicateDraft[] {
  const out: DuplicateDraft[] = [];
  for (const other of others) {
    if (other.sourceId === current.sourceId) continue;
    for (const ct of current.tables) {
      const cm = current.mappings.find((m) => m.sourceTable.toLowerCase() === ct.def.name.toLowerCase());
      if (!cm?.canonicalEntity) continue;
      for (const ot of other.tables) {
        const om = other.mappings.find((m) => m.sourceTable.toLowerCase() === ot.def.name.toLowerCase());
        if (!om?.canonicalEntity) continue;
        const colOverlap = jaccard(
          new Set(ct.def.columns.map((c) => c.name.toLowerCase())),
          new Set(ot.def.columns.map((c) => c.name.toLowerCase())),
        );
        const sameEntity = cm.canonicalEntity === om.canonicalEntity;
        if (!sameEntity) continue;
        const left = `source:${current.sourceId}|table:${ct.def.name}`;
        const right = `source:${other.sourceId}|table:${ot.def.name}`;
        if (colOverlap >= 0.85) {
          out.push({ kind: 'NEAR', left, right, status: 'DUPLICATE', evidence: `same canonical entity ${cm.canonicalEntity}; ${Math.round(colOverlap * 100)}% column overlap` });
        } else if (colOverlap >= 0.5) {
          out.push({ kind: 'SEMANTIC', left, right, status: 'POSSIBLE_DUPLICATE', evidence: `same canonical entity ${cm.canonicalEntity}; ${Math.round(colOverlap * 100)}% column overlap — review before any merge (§141)` });
        } else if (ct.def.name.toLowerCase() === ot.def.name.toLowerCase()) {
          out.push({ kind: 'SEMANTIC', left, right, status: 'RELATED', evidence: `identical table names map to the same canonical entity ${cm.canonicalEntity} across platforms (§122 shared entities)` });
        }
      }
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
