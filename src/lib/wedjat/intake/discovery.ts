// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: automatic schema discovery (§109, §120, §121).
//
// Semantically classifies every table and column — purpose, entity type,
// identifiers, enumerations/status models, temporal fields, tenant boundaries,
// audit models and document-bearing columns — rather than merely copying names.
// All classifications record WHY (reason strings) for downstream evidence (§110).
// ═══════════════════════════════════════════════════════════════════════════════

import type { ColumnDef, SchemaSnapshot, TableDef } from './schema-model';

export type ColumnPurpose =
  | 'IDENTIFIER'
  | 'NAME'
  | 'DESCRIPTION'
  | 'TEMPORAL'
  | 'STATUS'
  | 'AUDIT'
  | 'TENANT'
  | 'MEASURE'
  | 'CONTACT'
  | 'BOOLEAN'
  | 'EXTERNAL_REF'
  | 'ENUM'
  | 'STRUCTURED'
  | 'UNKNOWN';

export type TablePurpose =
  | 'TRANSACTIONAL'
  | 'REFERENCE_MASTER'
  | 'DOCUMENT'
  | 'CONFIGURATION'
  | 'AUDIT_LOG'
  | 'JUNCTION'
  | 'WORKFLOW'
  | 'GEOGRAPHIC'
  | 'UNKNOWN';

export interface DiscoveredColumn {
  def: ColumnDef;
  purpose: ColumnPurpose;
  enumValues: string[];
  reason: string;
}

export interface DiscoveredTable {
  def: TableDef;
  purpose: TablePurpose;
  entityType: string;
  reason: string;
  columns: DiscoveredColumn[];
  statusModel: string[]; // enum domain of the primary status column
  temporalFields: string[];
  tenantFields: string[];
  auditFields: string[];
  documentColumns: string[]; // §120 knowledge-bearing columns
  inboundRefs: string[]; // tables FK-ing into this one
  outboundRefs: string[]; // tables this one FKs to
}

export interface DiscoveryResult {
  tables: DiscoveredTable[];
  naming: { pattern: string; detail: string };
  notes: string[];
}

// ── Column purpose rules (ordered; first match wins) ──────────────────────────

interface PurposeRule {
  purpose: ColumnPurpose;
  test: (name: string, col: ColumnDef, isEnumLike: boolean) => boolean;
  reason: string;
}

const ID_RE = /^(id|uid|uuid|guid|key|pk|ref|refno|no|number|code|identifier|external_ref)$/i;
const ID_SUFFIX_RE = /(_id|_uuid|_guid|_key|_ref|_refno|_fk)$/i;
const NAME_RE = /(^|_)(name|title|label|display_name|full_name|first_name|last_name|username|login|handle|slug|short_desc)$/i;
const DESC_RE = /(^|_)(description|content|notes|note|comments|comment|body|text|specification|requirements|policy|documentation|analysis|audit_findings|findings|detail|details|summary|remark|remarks|message|bio|about|narrative|reason|justification|explanation|wiki|article)$/i;
const TEMPORAL_RE = /^(created|updated|modified|deleted|archived|effective|valid|expiry|expired|start|end|due|scheduled|completed|closed|opened|submitted|approved|rejected|paid|shipped|cancelled)_?(at|on|date|from|to|ts|time)?$/i;
const STATUS_RE = /(^|_)(status|state|stage|phase|workflow_state|lifecycle|lifecycle_state|order_status|approval_status)$/i;
const AUDIT_RE = /^(created_by|updated_by|modified_by|deleted_by|archived_by|approved_by|actor|actor_id|author|author_id|editor|change_reason|version|revision|rev|seq|sequence)$/i;
const TENANT_RE = /^(org_id|org_uuid|tenant_id|tenant_uuid|workspace_id|account_id|company_id|organization_id|organisation_id|site_id|merchant_id|franchise_id|region_scope)$/i;
const MEASURE_RE = /(^|_)(amount|total|price|unit_price|cost|qty|quantity|count|balance|weight|score|rate|fee|discount|tax|value|duration|latency|bytes|size|limit|revenue|spend|volume|frequency|priority)$/i;
const CONTACT_RE = /(^|_)(email|e_mail|phone|mobile|tel|telephone|fax|address|addr|street|city|postal|postcode|zip|zipcode|country|latitude|longitude|website|url|homepage|region|state_code)$/i;
const EXTERNAL_RE = /(^|_)(external_id|external_uuid|source_id|source_uuid|legacy_id|legacy_ref|upstream_id|third_party_id|partner_ref|ext_ref|origin_id)$/i;

const PURPOSE_RULES: PurposeRule[] = [
  {
    purpose: 'TENANT',
    test: (n) => TENANT_RE.test(n),
    reason: 'tenant-namespace column (multi-tenant boundary §109)',
  },
  {
    purpose: 'STATUS',
    test: (n, _c, isEnumLike) => STATUS_RE.test(n) && isEnumLike,
    reason: 'low-cardinality status/state column → status model (§109)',
  },
  {
    purpose: 'TEMPORAL',
    test: (n, c) => TEMPORAL_RE.test(n) || (c.type === 'DATETIME' && /(^|_)(at|on|date|time|from|to)$/i.test(n)),
    reason: 'temporal column (created/updated/effective/valid… §121)',
  },
  {
    purpose: 'AUDIT',
    test: (n) => AUDIT_RE.test(n),
    reason: 'audit-trail column (actor/version/revision §109)',
  },
  {
    purpose: 'IDENTIFIER',
    test: (n, c, isEnumLike) => (ID_RE.test(n) || ID_SUFFIX_RE.test(n)) && !isEnumLike && c.type !== 'DATETIME',
    reason: 'identifier column (id/uuid/key/ref…)',
  },
  {
    purpose: 'DESCRIPTION',
    test: (n, c, isEnumLike) => DESC_RE.test(n) && !isEnumLike && (c.type === 'TEXT' || c.type === 'UNKNOWN'),
    reason: 'knowledge-bearing text column (description/content/notes… §120)',
  },
  {
    purpose: 'CONTACT',
    test: (n) => CONTACT_RE.test(n),
    reason: 'contact/geo column (email/phone/address…)',
  },
  {
    purpose: 'EXTERNAL_REF',
    test: (n) => EXTERNAL_RE.test(n),
    reason: 'external-system reference (§123 lineage hint)',
  },
  {
    purpose: 'MEASURE',
    test: (n, c) => MEASURE_RE.test(n) && (c.type === 'INTEGER' || c.type === 'REAL' || c.type === 'NUMERIC'),
    reason: 'numeric measure column (amount/quantity/count…)',
  },
  {
    purpose: 'BOOLEAN',
    test: (n, c) => c.type === 'BOOLEAN' || /^(is|has|can|should|was)_/i.test(n) || /(_flag|_enabled|_active)$/i.test(n),
    reason: 'boolean flag column',
  },
  {
    purpose: 'NAME',
    test: (n, c, isEnumLike) => NAME_RE.test(n) && !isEnumLike && c.type !== 'DATETIME',
    reason: 'name/title column',
  },
  {
    purpose: 'ENUM',
    test: (_n, _c, isEnumLike) => isEnumLike,
    reason: 'low-cardinality enumeration column',
  },
  {
    purpose: 'STRUCTURED',
    test: (_n, c) => c.type === 'JSON',
    reason: 'structured JSON column',
  },
];

export function classifyColumn(col: ColumnDef, enumValues: string[], isEnumLike: boolean): DiscoveredColumn {
  const n = col.name.toLowerCase();
  for (const rule of PURPOSE_RULES) {
    if (rule.test(n, col, isEnumLike)) {
      return { def: col, purpose: rule.purpose, enumValues, reason: rule.reason };
    }
  }
  return { def: col, purpose: 'UNKNOWN', enumValues, reason: 'no semantic pattern matched — preserved as-is (§143)' };
}

// ── Table purpose + entity type ───────────────────────────────────────────────

const AUDIT_NAME_RE = /(^|_)(audit|logs?|log_|events?|activity|changelog|history|telemetry|journal|trace)/i;
const CONFIG_NAME_RE = /(^|_)(settings?|config|configuration|preferences?|parameters?|options?|feature_?flags?|flags)/i;
const DOC_NAME_RE = /(^|_)(documents?|docs?|notes?|articles?|wiki|knowledge_?base|attachments?|files?|contents?|pages?|posts?|policies)/i;
const REF_NAME_RE = /(^|_)(categor(y|ies)|lookups?|types?|statuses?|roles?|countries|regions?|currencies|taxonom(y|ies)|master_?data|reference)/i;
const WORKFLOW_NAME_RE = /(^|_)(workflows?|process(es)?|pipelines?|tasks?|jobs?|state_?machines?|queues?|steps)/i;
const GEO_NAME_RE = /(^|_)(addresses?|locations?|geo|places?|sites?|branches|venues?|zones?)/i;

const ENTITY_BY_PURPOSE: Record<TablePurpose, string> = {
  TRANSACTIONAL: 'Transaction',
  REFERENCE_MASTER: 'ReferenceData',
  DOCUMENT: 'Document',
  CONFIGURATION: 'Configuration',
  AUDIT_LOG: 'AuditLog',
  JUNCTION: 'Relationship',
  WORKFLOW: 'Workflow',
  GEOGRAPHIC: 'Location',
  UNKNOWN: 'Unknown',
};

export function discover(snapshot: SchemaSnapshot): DiscoveryResult {
  const tableByName = new Map(snapshot.tables.map((t) => [t.name.toLowerCase(), t]));
  // inbound/outbound reference counts (structural evidence)
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  for (const t of snapshot.tables) {
    for (const fk of t.foreignKeys) {
      const ref = fk.refTable.toLowerCase();
      if (tableByName.has(ref)) {
        if (!inbound.has(ref)) inbound.set(ref, new Set());
        inbound.get(ref)!.add(t.name);
        if (!outbound.has(t.name.toLowerCase())) outbound.set(t.name.toLowerCase(), new Set());
        outbound.get(t.name.toLowerCase())!.add(fk.refTable);
      }
    }
    // CSV/JSON exports: synthesize links from <singular>_id columns (§109 relationships)
    if (t.foreignKeys.length === 0) {
      for (const col of t.columns) {
        const m = /^(.+)_id$/i.exec(col.name.toLowerCase());
        if (!m) continue;
        const singular = m[1];
        for (const candidate of tableByName.keys()) {
          const c = candidate.toLowerCase();
          if (c === t.name.toLowerCase()) continue;
          if (c === singular || c === `${singular}s` || c === `${singular}es` || c.startsWith(`${singular}_`)) {
            if (!inbound.has(c)) inbound.set(c, new Set());
            inbound.get(c)!.add(t.name);
            if (!outbound.has(t.name.toLowerCase())) outbound.set(t.name.toLowerCase(), new Set());
            outbound.get(t.name.toLowerCase())!.add(tableByName.get(candidate)!.name);
          }
        }
      }
    }
  }

  const tables: DiscoveredTable[] = snapshot.tables.map((t) => {
    const columns = t.stats.map((stat) => {
      const col = t.columns.find((c) => c.name === stat.name) ?? {
        name: stat.name,
        rawType: 'UNKNOWN',
        type: 'UNKNOWN' as const,
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
        defaultValue: null,
      };
      return classifyColumn(col, stat.enumValues, stat.isEnumLike);
    });

    const docCols = columns
      .filter((c) => c.purpose === 'DESCRIPTION')
      .map((c) => c.def.name);
    const statusCols = columns.filter((c) => c.purpose === 'STATUS');
    const temporal = columns.filter((c) => c.purpose === 'TEMPORAL').map((c) => c.def.name);
    const tenant = columns.filter((c) => c.purpose === 'TENANT').map((c) => c.def.name);
    const audit = columns.filter((c) => c.purpose === 'AUDIT').map((c) => c.def.name);
    const measures = columns.filter((c) => c.purpose === 'MEASURE');
    const fks = t.foreignKeys.length + (outbound.get(t.name.toLowerCase())?.size ?? 0);
    const inb = inbound.get(t.name.toLowerCase())?.size ?? 0;

    const nameLower = t.name.toLowerCase();
    let purpose: TablePurpose;
    let reason: string;

    if (AUDIT_NAME_RE.test(nameLower)) {
      purpose = 'AUDIT_LOG';
      reason = 'name matches audit/log/event pattern';
    } else if (CONFIG_NAME_RE.test(nameLower)) {
      purpose = 'CONFIGURATION';
      reason = 'name matches settings/config pattern';
    } else if (
      WORKFLOW_NAME_RE.test(nameLower) ||
      (statusCols.length > 0 && columns.some((c) => /(assignee|owner|sequence|order|step)/i.test(c.def.name)))
    ) {
      purpose = 'WORKFLOW';
      reason = 'workflow markers (status + assignment/sequence columns)';
    } else if (fks >= 2 && columns.every((c) => ['IDENTIFIER', 'AUDIT', 'TEMPORAL', 'TENANT'].includes(c.purpose))) {
      purpose = 'JUNCTION';
      reason = 'only identifier/audit columns + ≥2 foreign keys → junction/link table';
    } else if (docCols.length > 0 || DOC_NAME_RE.test(nameLower)) {
      purpose = 'DOCUMENT';
      reason = docCols.length > 0 ? `knowledge-bearing columns: ${docCols.join(', ')}` : 'name matches document pattern';
    } else if (REF_NAME_RE.test(nameLower) || (inb >= 2 && t.rowCount <= 200)) {
      purpose = 'REFERENCE_MASTER';
      reason = REF_NAME_RE.test(nameLower) ? 'name matches reference/lookup pattern' : 'small table referenced by ≥2 others → master data';
    } else if (GEO_NAME_RE.test(nameLower)) {
      purpose = 'GEOGRAPHIC';
      reason = 'name matches address/location pattern';
    } else if (temporal.length > 0 && (statusCols.length > 0 || measures.length > 0) && fks >= 1) {
      purpose = 'TRANSACTIONAL';
      reason = 'temporal + status/measure + references → transactional table';
    } else if (temporal.length > 0 && measures.length > 0) {
      purpose = 'TRANSACTIONAL';
      reason = 'temporal + measures → transactional table';
    } else {
      purpose = 'UNKNOWN';
      reason = 'no strong structural signature — preserved for review';
    }

    return {
      def: t,
      purpose,
      entityType: ENTITY_BY_PURPOSE[purpose],
      reason,
      columns,
      statusModel: statusCols[0]?.enumValues ?? [],
      temporalFields: temporal,
      tenantFields: tenant,
      auditFields: audit,
      documentColumns: docCols,
      inboundRefs: [...(inbound.get(t.name.toLowerCase()) ?? [])],
      outboundRefs: [...(outbound.get(t.name.toLowerCase()) ?? [])],
    };
  });

  const notes: string[] = [];
  const tenantAll = new Set(tables.flatMap((t) => t.tenantFields));
  if (tenantAll.size > 0) notes.push(`Tenant boundary columns detected: ${[...tenantAll].join(', ')} (§109)`);
  const enumCount = tables.reduce((n, t) => n + t.columns.filter((c) => c.purpose === 'ENUM' || c.purpose === 'STATUS').length, 0);
  notes.push(`${enumCount} enumeration/status columns profiled (§109)`);
  const docBearing = tables.filter((t) => t.documentColumns.length > 0).length;
  if (docBearing > 0) notes.push(`${docBearing} tables contain knowledge-bearing text columns (§120)`);

  return { tables, naming: snapshot.naming, notes };
}
