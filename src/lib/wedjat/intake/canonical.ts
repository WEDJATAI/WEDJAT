// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: canonical semantic mapping (§110–§113, §111, §116).
//
// Maps source tables into the extensible WEDJAT canonical entity model using
// EVIDENCE (naming, signature columns, relationships, constraints, indexes,
// sample data) — never name similarity alone (§110). Every mapping carries a
// confidence score, label and evidence list; column-level transformation rules
// are recorded for auditability/reproducibility (§116).
// ═══════════════════════════════════════════════════════════════════════════════

import type { DiscoveredTable } from './discovery';
import { contentHash } from '../ids';

export interface CanonicalEntityDef {
  entity: string;
  description: string;
  synonyms: string[];
  // signature column evidence: regex on column names (+ optional type constraint)
  signatures: { re: RegExp; type?: 'TEXT' | 'NUMERIC' | 'DATETIME' | 'INTEGER' | 'BOOLEAN'; field: string; label: string; points: number }[];
}

// ── Canonical model (§111) — extensible registry ─────────────────────────────

export const CANONICAL_ENTITIES: CanonicalEntityDef[] = [
  {
    entity: 'Party',
    description: 'Any person or organization that transacts: customers, clients, buyers, accounts, members, users, vendors, partners.',
    synonyms: ['customer', 'client', 'buyer', 'account', 'member', 'user', 'contact', 'vendor', 'supplier', 'partner', 'organization', 'organisation', 'company', 'merchant', 'party', 'prospect', 'lead', 'client_account', 'account_holder', 'cust', 'patron', 'guest'],
    signatures: [
      { re: /(^|_)(email|e_mail)$/i, type: 'TEXT', field: 'party.contact.email', label: 'email', points: 3 },
      { re: /(^|_)(phone|mobile|tel|telephone)$/i, field: 'party.contact.phone', label: 'phone', points: 2 },
      { re: /(^|_)(first_name|last_name|full_name|display_name|company_name|legal_name)$/i, field: 'party.display_name', label: 'name', points: 3 },
      { re: /(^|_)(address|city|country|postal|zip)/i, field: 'party.contact.address', label: 'address', points: 2 },
      { re: /^(created_at|registered_at)$/i, type: 'DATETIME', field: 'party.audit.created_at', label: 'created_at', points: 1 },
      { re: /(status|state|segment|tier|kind|type)$/i, field: 'party.status', label: 'status', points: 1 },
    ],
  },
  {
    entity: 'Transaction',
    description: 'Business exchange events: orders, trades, deals, purchases, sales, bookings, shipments, invoices.',
    synonyms: ['order', 'trade', 'transaction', 'deal', 'purchase', 'sale', 'invoice', 'booking', 'shipment', 'fulfillment', 'order_header', 'sales_order', 'purchase_order', 'txn'],
    signatures: [
      { re: /(^|_)(amount|total|price|value|fee|cost)$/i, field: 'transaction.amount', label: 'amount', points: 3 },
      { re: /(status|state|stage|fulfillment_state)$/i, field: 'transaction.status', label: 'status', points: 3 },
      { re: /(^|_)(created_at|ordered_at|placed_at|paid_at|completed_at|transaction_date|order_date)$/i, type: 'DATETIME', field: 'transaction.occurred_at', label: 'temporal', points: 3 },
      { re: /(_id|_uuid)$/i, field: 'transaction.party_ref', label: 'party reference', points: 1 },
      { re: /(reference|reference_no|number|receipt)$/i, field: 'transaction.reference', label: 'reference', points: 1 },
    ],
  },
  {
    entity: 'Agreement',
    description: 'Formal commitments: contracts, agreements, licenses, SLAs, terms, subscriptions.',
    synonyms: ['contract', 'agreement', 'license', 'licence', 'sla', 'terms', 'subscription_agreement', 'commitment', 'lease'],
    signatures: [
      { re: /(effective_from|start_date|valid_from)/i, type: 'DATETIME', field: 'agreement.effective_from', label: 'effective_from', points: 3 },
      { re: /(effective_to|end_date|valid_to|expiry|expires_at)/i, type: 'DATETIME', field: 'agreement.effective_to', label: 'effective_to', points: 3 },
      { re: /(status|state)$/i, field: 'agreement.status', label: 'status', points: 2 },
      { re: /(renewal|auto_renew|term|duration)/i, field: 'agreement.terms', label: 'terms', points: 2 },
      { re: /(signed_at|executed_at|approved_at)/i, field: 'agreement.signed_at', label: 'signed_at', points: 2 },
    ],
  },
  {
    entity: 'Payment',
    description: 'Money movements: payments, charges, refunds, settlements, payouts, receipts.',
    synonyms: ['payment', 'charge', 'refund', 'settlement', 'payout', 'receipt', 'remittance', 'billing_record'],
    signatures: [
      { re: /(amount|total|value|paid|charge_amount)/i, field: 'payment.amount', label: 'amount', points: 3 },
      { re: /(status|state)$/i, field: 'payment.status', label: 'status', points: 3 },
      { re: /(paid_at|settled_at|captured_at|payment_date|paid_on)/i, type: 'DATETIME', field: 'payment.paid_at', label: 'paid_at', points: 3 },
      { re: /(currency|fx_rate|exchange_rate)/i, field: 'payment.currency', label: 'currency', points: 2 },
      { re: /(method|instrument|card|wallet|provider)/i, field: 'payment.method', label: 'method', points: 2 },
    ],
  },
  {
    entity: 'Product',
    description: 'Offered goods/services: products, items, SKUs, catalog entries, offerings.',
    synonyms: ['product', 'item', 'sku', 'catalog', 'catalogue', 'offering', 'service_item', 'part', 'article', 'variant', 'product_catalog'],
    signatures: [
      { re: /(sku|upc|ean|barcode|item_code|product_code)/i, field: 'product.code', label: 'sku', points: 3 },
      { re: /(^|_)(price|list_price|unit_price|msrp|cost)$/i, field: 'product.price', label: 'price', points: 3 },
      { re: /(name|title|label)$/i, field: 'product.name', label: 'name', points: 2 },
      { re: /(category|category_id|type|family|brand)$/i, field: 'product.category', label: 'category', points: 2 },
      { re: /(active|status|available|is_active|enabled)$/i, field: 'product.status', label: 'status', points: 1 },
    ],
  },
  {
    entity: 'Inventory',
    description: 'Stock positions: inventory levels, warehouse bins, lots, stock movements.',
    synonyms: ['inventory', 'stock', 'warehouse', 'bin', 'lot', 'storage', 'warehouse_level', 'stock_level', 'inventory_level'],
    signatures: [
      { re: /(quantity|qty|on_hand|available|reserved|level|count)/i, field: 'inventory.quantity', label: 'quantity', points: 3 },
      { re: /(warehouse|location|zone|aisle|bin)/i, field: 'inventory.location', label: 'location', points: 3 },
      { re: /(reorder|replenish|min|max|threshold)/i, field: 'inventory.policy', label: 'reorder_policy', points: 2 },
    ],
  },
  {
    entity: 'Employee',
    description: 'Workforce records: employees, staff, personnel, workers, HR records.',
    synonyms: ['employee', 'staff', 'personnel', 'worker', 'hr_record', 'team_member', 'agent', 'operator', 'crew'],
    signatures: [
      { re: /(first_name|last_name|full_name|display_name)$/i, field: 'employee.name', label: 'name', points: 3 },
      { re: /(salary|compensation|wage|pay_rate|grade|band)$/i, field: 'employee.compensation', label: 'compensation', points: 3 },
      { re: /(department|team|manager|reports_to|supervisor)/i, field: 'employee.org', label: 'org', points: 3 },
      { re: /(hire|hired|joined|start_date|employment_start)/i, field: 'employee.hired_at', label: 'hired_at', points: 2 },
      { re: /(role|title|position|job_title)$/i, field: 'employee.role', label: 'role', points: 2 },
    ],
  },
  {
    entity: 'Document',
    description: 'Knowledge-bearing content: documents, notes, articles, wiki entries, attachments.',
    synonyms: ['document', 'doc', 'note', 'article', 'wiki', 'knowledge', 'attachment', 'file', 'content', 'entry', 'post', 'page', 'policy'],
    signatures: [
      { re: /(description|content|body|text|html|markdown)/i, field: 'document.body', label: 'body', points: 3 },
      { re: /(title|subject|heading|name)$/i, field: 'document.title', label: 'title', points: 2 },
      { re: /(author|created_by|owner)/i, field: 'document.author', label: 'author', points: 2 },
      { re: /(status|state|published|visibility)/i, field: 'document.status', label: 'status', points: 1 },
    ],
  },
  {
    entity: 'Configuration',
    description: 'System settings and parameters: key-value configuration, feature flags, preferences.',
    synonyms: ['setting', 'settings', 'config', 'configuration', 'preference', 'parameter', 'option', 'feature_flag', 'flag', 'system_setting'],
    signatures: [
      { re: /^(key|name|setting|param|option|flag)$/i, field: 'configuration.key', label: 'key', points: 3 },
      { re: /^(value|val|setting_value|default)$/i, field: 'configuration.value', label: 'value', points: 3 },
      { re: /(enabled|active|is_active)/i, field: 'configuration.enabled', label: 'enabled', points: 2 },
      { re: /(environment|scope|namespace|category)$/i, field: 'configuration.scope', label: 'scope', points: 1 },
    ],
  },
  {
    entity: 'AuditLog',
    description: 'Activity trails: audit logs, event logs, changelogs, history tables.',
    synonyms: ['audit', 'log', 'event', 'activity', 'changelog', 'history', 'telemetry', 'journal', 'audit_log', 'event_log', 'audit_trail'],
    signatures: [
      { re: /(action|event|event_type|operation|change_type)$/i, field: 'audit.action', label: 'action', points: 3 },
      { re: /(actor|created_by|user_id|performed_by|modified_by)/i, field: 'audit.actor', label: 'actor', points: 3 },
      { re: /(at|timestamp|occurred_at|logged_at|date)$/i, type: 'DATETIME', field: 'audit.at', label: 'timestamp', points: 2 },
      { re: /(before|after|old_value|new_value|diff|payload|metadata)/i, field: 'audit.change', label: 'change', points: 2 },
    ],
  },
  {
    entity: 'ReferenceData',
    description: 'Master/reference data: categories, lookup types, statuses, roles, countries, currencies.',
    synonyms: ['category', 'categories', 'lookup', 'type', 'types', 'status', 'statuses', 'role', 'roles', 'country', 'countries', 'region', 'regions', 'currency', 'currencies', 'taxonomy', 'master_data', 'reference', 'enumeration', 'enum'],
    signatures: [
      { re: /^(name|label|title|display_name)$/i, field: 'reference.label', label: 'label', points: 3 },
      { re: /^(code|iso|abbreviation|short_code|slug)$/i, field: 'reference.code', label: 'code', points: 3 },
      { re: /(sort|order|rank|ordinal|sequence)$/i, field: 'reference.order', label: 'order', points: 1 },
    ],
  },
  {
    entity: 'Workflow',
    description: 'Process definitions and tasks: workflows, pipelines, state machines, queues, jobs.',
    synonyms: ['workflow', 'process', 'pipeline', 'task', 'job', 'queue', 'step', 'state_machine', 'todo', 'ticket', 'case', 'incident', 'request'],
    signatures: [
      { re: /(status|state|stage|phase)$/i, field: 'workflow.status', label: 'status', points: 3 },
      { re: /(assignee|assignee_id|owner|owner_id)/i, field: 'workflow.assignee', label: 'assignee', points: 3 },
      { re: /(priority|severity|urgency|sla)$/i, field: 'workflow.priority', label: 'priority', points: 2 },
      { re: /(due_at|due_date|deadline|sla_at)/i, field: 'workflow.due_at', label: 'due_at', points: 2 },
      { re: /(step|stage|sequence|order)$/i, field: 'workflow.step', label: 'step', points: 1 },
    ],
  },
];

export const CANONICAL_ENTITY_NAMES = CANONICAL_ENTITIES.map((c) => c.entity);

// ── Mapping result types ──────────────────────────────────────────────────────

export type ConfidenceLabel = 'HIGH_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'LOW_CONFIDENCE' | 'UNRESOLVED';

export interface MappingEvidence {
  kind: 'NAME' | 'COLUMNS' | 'RELATIONSHIPS' | 'DATA' | 'CONSTRAINTS' | 'INDEXES' | 'AI_SEMANTIC';
  detail: string;
  weight: number;
}

export interface ColumnMappingRecord {
  sourceColumn: string;
  canonicalField: string;
  rule: 'IDENTITY' | 'TYPE_CAST' | 'NORMALIZE' | 'NAMESPACE';
  ruleVersion: string;
  confidence: number;
  notes?: string;
}

export interface TableMapping {
  sourceTable: string;
  tablePurpose: string;
  entityType: string;
  canonicalEntity: string | null;
  confidence: number; // 0..100
  confidenceLabel: ConfidenceLabel;
  reason: string;
  evidence: MappingEvidence[];
  columnMappings: ColumnMappingRecord[];
  rowCount: number;
}

// Weight budget: name 2.0, columns 3.0, relationships 2.5, data 1.5,
// constraints/indexes 0.5+0.5, AI 1.0 → max 11.0 scaled to 100.
const W_NAME = 2.0;
const W_COLS = 3.0;
const W_REL = 2.5;
const W_DATA = 1.5;
const W_CONSTRAINTS = 0.5;
const W_INDEXES = 0.5;
const W_AI = 1.0;
const W_TOTAL = W_NAME + W_COLS + W_REL + W_DATA + W_CONSTRAINTS + W_INDEXES + W_AI;

export function confidenceLabelFor(confidence: number): ConfidenceLabel {
  if (confidence >= 85) return 'HIGH_CONFIDENCE';
  if (confidence >= 60) return 'MEDIUM_CONFIDENCE';
  if (confidence >= 35) return 'LOW_CONFIDENCE';
  return 'UNRESOLVED';
}

interface AiSuggestion {
  table: string;
  entity: string;
  rationale?: string;
}

/**
 * Evidence-based canonical mapping (§110/§111). Two passes: relationship
 * evidence from pass 1 feeds pass 2 (FKs to already-mapped entities).
 * AI semantic suggestions (when the internal gateway responds) are MERGED as
 * additional evidence — never decisive on their own (§110: no name-only merges).
 */
export function mapTablesToCanonical(
  tables: DiscoveredTable[],
  aiSuggestions: AiSuggestion[] = [],
  engineVersion: string,
): TableMapping[] {
  const suggestions = new Map(aiSuggestions.map((s) => [s.table.toLowerCase(), s]));
  const pass = (useRelationships: boolean): Map<string, { mapping: TableMapping; entity: string }> => {
    const results = new Map<string, { mapping: TableMapping; entity: string }>();
    for (const t of tables) {
      const scores = new Map<string, { score: number; evidence: MappingEvidence[] }>();
      const normalized = t.def.name.toLowerCase();

      for (const def of CANONICAL_ENTITIES) {
        const evidence: MappingEvidence[] = [];

        // 1) NAME evidence — synonym containment (necessary but never sufficient)
        const nameHit = def.synonyms.some((s) => normalized === s || normalized.startsWith(`${s}s`) || normalized.startsWith(`${s}_`) || normalized.includes(`_${s}`) || normalized.includes(`_${s}s_`) || normalized === `${s}s`);
        if (nameHit) evidence.push({ kind: 'NAME', detail: `table name matches ${def.entity} synonym family`, weight: W_NAME });

        // 2) COLUMN evidence — signature columns (purpose-aware)
        let colPoints = 0;
        let maxPoints = 0;
        const hitFields: { source: string; field: string; label: string }[] = [];
        for (const sig of def.signatures) {
          maxPoints += sig.points;
          const col = t.columns.find((c) => sig.re.test(c.def.name) && (!sig.type || c.def.type === sig.type || c.def.type === 'UNKNOWN'));
          if (col) {
            colPoints += sig.points;
            hitFields.push({ source: col.def.name, field: sig.field, label: sig.label });
          }
        }
        if (colPoints > 0) {
          const ratio = maxPoints > 0 ? colPoints / maxPoints : 0;
          const colScore = Math.min(1, ratio * 1.4); // strong signature coverage
          evidence.push({ kind: 'COLUMNS', detail: `signature columns present: ${hitFields.map((h) => h.label).join(', ')} (${Math.round(ratio * 100)}% coverage)`, weight: W_COLS * colScore });
        }

        // 3) RELATIONSHIP evidence (pass 2) — FKs to/from pass-1 mapped entities
        if (useRelationships) {
          let relScore = 0;
          const relHits: string[] = [];
          for (const fk of t.def.foreignKeys) {
            const target = results.get(fk.refTable.toLowerCase());
            if (target && (target.entity === def.entity || (def.entity === 'Transaction' && ['Party', 'Product', 'Agreement'].includes(target.entity)))) {
              relScore += 0.5;
              relHits.push(`→ ${fk.refTable} (${target.entity})`);
            }
          }
          for (const src of t.inboundRefs) {
            const source = results.get(src.toLowerCase());
            if (source && source.entity === def.entity && def.entity !== 'Party') {
              relScore += 0.4;
              relHits.push(`← ${src} (${source.entity})`);
            }
          }
          if (relScore > 0) {
            evidence.push({ kind: 'RELATIONSHIPS', detail: `foreign-key neighborhood supports ${def.entity}: ${relHits.slice(0, 4).join(', ')}`, weight: Math.min(W_REL, relScore) });
          }
        }

        // 4) DATA evidence — sample value shapes
        let dataScore = 0;
        const dataNotes: string[] = [];
        if (t.def.sampleRows.length > 0) {
          if (def.entity === 'Party') {
            const emailCols = t.columns.filter((c) => /e?mail/i.test(c.def.name) && c.def.type === 'TEXT');
            if (emailCols.length > 0) {
              const hasEmails = t.def.sampleRows.some((r) => emailCols.some((c) => /@/.test(String(r[c.def.name] ?? ''))));
              if (hasEmails) {
                dataScore += 0.6;
                dataNotes.push('sample values contain email addresses');
              }
            }
          }
          if (def.entity === 'Transaction' || def.entity === 'Payment') {
            const numeric = t.columns.filter((c) => c.def.type === 'NUMERIC' || c.def.type === 'REAL' || c.def.type === 'INTEGER');
            if (numeric.length > 0 && t.def.stats.some((s) => s.min != null && s.max != null && s.max !== s.min)) {
              dataScore += 0.5;
              dataNotes.push('varying numeric measures in samples');
            }
          }
          if (def.entity === 'Document') {
            const longText = t.def.stats.find((s) => (s.avgLength ?? 0) > 80);
            if (longText) {
              dataScore += 0.6;
              dataNotes.push(`long text column (${longText.name}, avg ${longText.avgLength} chars)`);
            }
          }
          if (def.entity === 'Configuration') {
            if (t.def.rowCount <= 500 && t.columns.length <= 6) {
              dataScore += 0.4;
              dataNotes.push('small key-value shaped table');
            }
          }
        }
        if (dataScore > 0) evidence.push({ kind: 'DATA', detail: dataNotes.join('; '), weight: Math.min(W_DATA, dataScore) });

        // 5) CONSTRAINTS / INDEXES evidence
        const hasPk = t.def.primaryKey.length > 0 || t.def.constraints.some((c) => c.type === 'PRIMARY_KEY');
        const hasUnique = t.def.indexes.some((i) => i.unique);
        if (hasPk && hasUnique) evidence.push({ kind: 'CONSTRAINTS', detail: 'primary key + unique constraints (strong identity)', weight: W_CONSTRAINTS });
        else if (hasPk) evidence.push({ kind: 'CONSTRAINTS', detail: 'primary key present', weight: W_CONSTRAINTS * 0.5 });
        if (t.def.indexes.length > 1) evidence.push({ kind: 'INDEXES', detail: `${t.def.indexes.length} indexes (query-critical table)`, weight: W_INDEXES });

        // 6) AI semantic evidence — advisory only (§110)
        const ai = suggestions.get(normalized);
        if (ai && ai.entity === def.entity) {
          evidence.push({ kind: 'AI_SEMANTIC', detail: `internal AI semantic analysis agrees: ${ai.rationale ?? def.entity}`, weight: W_AI });
        }

        const total = evidence.reduce((n, e) => n + e.weight, 0);
        scores.set(def.entity, { score: total, evidence });
      }

      // Choose best entity — require at least SOME non-name evidence when name matched,
      // and never pick an entity on name alone with zero structural support (§110).
      let best: { entity: string; score: number; evidence: MappingEvidence[] } | null = null;
      let second: { entity: string; score: number } | null = null;
      for (const [entity, { score, evidence }] of scores) {
        if (!best || score > best.score) {
          second = best ? { entity: best.entity, score: best.score } : second;
          best = { entity, score, evidence };
        } else if (!second || score > second.score) {
          second = { entity, score };
        }
      }
      if (best && best.score > 0) {
        const structural = best.evidence.filter((e) => e.kind !== 'NAME' && e.kind !== 'AI_SEMANTIC');
        if (structural.length === 0) {
          // Name-only evidence — explicitly NOT auto-merged (§110).
          best = { ...best, score: W_NAME * 0.6, evidence: [...best.evidence, { kind: 'COLUMNS', detail: 'NO structural evidence found — name similarity alone is insufficient (§110); confidence capped', weight: 0 }] };
        }
        const confidence = Math.round(Math.min(100, (best.score / W_TOTAL) * 100 * 1.35)); // scale sensibly
        const gap = second ? best.score - second.score : 3;
        const ambiguityNote = gap < 0.8 && second ? ` (close alternative: ${second.entity})` : '';
        results.set(normalized, {
          mapping: {
            sourceTable: t.def.name,
            tablePurpose: t.purpose,
            entityType: t.entityType,
            canonicalEntity: confidence >= 35 ? best.entity : null,
            confidence,
            confidenceLabel: confidenceLabelFor(confidence),
            reason:
              best.evidence
                .filter((e) => e.weight > 0)
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 3)
                .map((e) => e.detail)
                .join(' · ') + ambiguityNote,
            evidence: best.evidence,
            columnMappings: buildColumnMappings(t, CANONICAL_ENTITIES.find((c) => c.entity === best!.entity), engineVersion),
            rowCount: t.def.rowCount,
          },
          entity: best.entity,
        });
      } else {
        results.set(normalized, {
          mapping: {
            sourceTable: t.def.name,
            tablePurpose: t.purpose,
            entityType: t.entityType,
            canonicalEntity: null,
            confidence: 0,
            confidenceLabel: 'UNRESOLVED',
            reason: 'no canonical entity matched with sufficient evidence — preserved as source data (§143)',
            evidence: [],
            columnMappings: [],
            rowCount: t.def.rowCount,
          },
          entity: 'Unknown',
        });
      }
    }
    return results;
  };

  pass(false); // pass 1 populates nothing persisted — pass 2 uses its own map
  const final = pass(true);
  return [...final.values()].map((r) => r.mapping);
}

function buildColumnMappings(
  t: DiscoveredTable,
  entityDef: CanonicalEntityDef | undefined,
  engineVersion: string,
): ColumnMappingRecord[] {
  if (!entityDef) return [];
  const out: ColumnMappingRecord[] = [];
  const mappedCols = new Set<string>();
  for (const sig of entityDef.signatures) {
    const col = t.columns.find((c) => sig.re.test(c.def.name) && (!sig.type || c.def.type === sig.type || c.def.type === 'UNKNOWN'));
    if (col) {
      mappedCols.add(col.def.name);
      const needsCast = col.def.type === 'TEXT' && (sig.field.includes('created_at') || sig.field.includes('_at') || sig.field.includes('date'));
      const needsNormalize = /email/i.test(sig.field);
      out.push({
        sourceColumn: col.def.name,
        canonicalField: sig.field,
        rule: needsCast ? 'TYPE_CAST' : needsNormalize ? 'NORMALIZE' : 'IDENTITY',
        ruleVersion: engineVersion,
        confidence: col.purpose === 'IDENTIFIER' || col.purpose === 'STATUS' ? 0.95 : 0.85,
        notes: needsCast ? 'TEXT → DATETIME (ISO-8601 normalization)' : needsNormalize ? 'lowercase + trim normalization' : undefined,
      });
    }
  }
  // Zero-data-loss: unmapped columns namespaced under canonical custom fields (§143/§116)
  for (const c of t.columns) {
    if (mappedCols.has(c.def.name)) continue;
    out.push({
      sourceColumn: c.def.name,
      canonicalField: `${entityDef.entity.toLowerCase()}.custom.${c.def.name.toLowerCase()}`,
      rule: 'NAMESPACE',
      ruleVersion: engineVersion,
      confidence: 0.5,
      notes: 'preserved under canonical custom namespace — future engine versions may promote it',
    });
  }
  return out;
}

/** Schema signature used for duplicate/drift heuristics (§141/§142). */
export function tableSignature(t: { name: string; columns: { name: string; type: string }[] }): string {
  return contentHash(`${t.name}::${t.columns.map((c) => `${c.name}:${c.type}`).sort().join('|')}`);
}
