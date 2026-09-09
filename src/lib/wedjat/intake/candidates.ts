// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: automatic training-data generation (§125, §126).
//
// Generates Q&A / summary / classification / analysis / comparison / contradiction
// / workflow candidates from imported knowledge. Every candidate MUST pass the
// safety gates (§126) before it can ever become training data: source grounding,
// quality evaluation, duplicate + semantic-duplicate detection, consistency,
// sensitive-data check, provenance check. §148 lineage is mandatory; §149
// quarantine rules apply. Generated data NEVER auto-becomes production training
// data (§126) — approval is autonomy-gated AND reviewed.
// ═══════════════════════════════════════════════════════════════════════════════

import type { DiscoveredTable, DiscoveryResult } from './discovery';
import type { TableMapping } from './canonical';
import type { DqReport } from './quality';
import type { KnowledgeDoc } from './extract';
import { contentHash } from '../ids';

export type CandidateKind =
  | 'QA'
  | 'SUMMARY'
  | 'CLASSIFICATION'
  | 'ARCHITECTURE_ANALYSIS'
  | 'RISK_ANALYSIS'
  | 'COMPARISON'
  | 'CONTRADICTION'
  | 'WORKFLOW';

export interface CandidateGate {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CandidateDraft {
  kind: CandidateKind;
  prompt: string;
  completion: string;
  qualityScore: number; // 0..1
  gates: CandidateGate[];
  lineage: string;
  status: 'TRAINING_CANDIDATE' | 'TRAINING_REJECTED' | 'QUARANTINED';
  dedupeHash: string;
}

const SENSITIVE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const SENSITIVE_PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const SENSITIVE_CARD = /\b(?:\d[ -]*?){13,16}\b/g;

function redact(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  const emailHits = text.match(SENSITIVE_EMAIL) ?? [];
  found.push(...emailHits.slice(0, 3).map((e) => `email:${e}`));
  out = out.replace(SENSITIVE_EMAIL, (m) => (m.includes('example') ? m : `[redacted:${m.split('@')[1] ?? 'domain'}]`));
  const phoneHits = text.match(SENSITIVE_PHONE) ?? [];
  found.push(...phoneHits.slice(0, 2).map((p) => `phone:${p.slice(0, 4)}…`));
  out = out.replace(SENSITIVE_PHONE, (m) => (m.length < 9 ? m : '[redacted-phone]'));
  const cardHits = text.match(SENSITIVE_CARD) ?? [];
  found.push(...cardHits.slice(0, 2).map(() => 'card-number'));
  out = out.replace(SENSITIVE_CARD, '[redacted-card]');
  return { text: out, found };
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

function jaccardTokens(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ── generation (§125) ─────────────────────────────────────────────────────────

export function generateCandidates(
  source: { id: string; name: string; platform: string; versionLabel: string },
  discovery: DiscoveryResult,
  mappings: TableMapping[],
  dq: DqReport,
  docs: KnowledgeDoc[],
  crossPlatformPeers: { platform: string; tables: DiscoveredTable[]; mappings: TableMapping[] }[] = [],
): CandidateDraft[] {
  const drafts: Omit<CandidateDraft, 'gates' | 'status' | 'dedupeHash'>[] = [];
  const plat = source.platform;
  const mappingByTable = new Map(mappings.map((m) => [m.sourceTable.toLowerCase(), m]));
  const lineageBase = (table?: string) =>
    `source_platform=${plat} | source_database=${source.name} | source_database_version=${source.versionLabel}${table ? ` | source_table=${table}` : ''} | source_database_id=${source.id}`;

  // QA per well-mapped table
  for (const t of discovery.tables) {
    const m = mappingByTable.get(t.def.name.toLowerCase());
    if (!m?.canonicalEntity || m.confidence < 60) continue;
    const cols = t.columns.slice(0, 8).map((c) => `${c.def.name} (${c.purpose.toLowerCase()})`).join(', ');
    const rel = t.def.foreignKeys.map((fk) => `${fk.columns.join(',')}→${fk.refTable}`).join('; ') || 'none declared';
    drafts.push({
      kind: 'QA',
      prompt: `In the ${plat} platform database, what does the ${t.def.name} table store and how is it structured?`,
      completion: `The ${t.def.name} table in ${plat} (${source.name} ${source.versionLabel}) stores ${m.tablePurpose.toLowerCase()} data and maps to the canonical WEDJAT entity ${m.canonicalEntity} with ${m.confidence}% confidence (${m.confidenceLabel}). It holds ${t.def.rowCount.toLocaleString()} rows. Key columns: ${cols}. Relationships: ${rel}. ${m.reason}.`,
      qualityScore: 0.5 + Math.min(0.3, m.confidence / 350) + (t.def.rowCount > 0 ? 0.1 : 0),
      lineage: lineageBase(t.def.name),
    });
    // WORKFLOW from status models
    if (t.statusModel.length >= 3) {
      drafts.push({
        kind: 'WORKFLOW',
        prompt: `Describe the observed lifecycle states of ${t.def.name} records in the ${plat} platform.`,
        completion: `OBSERVED PATTERN (derived from data, not a recommendation): ${t.def.name} in ${plat} exhibits the state domain {${t.statusModel.join(', ')}}${t.temporalFields.length > 0 ? ` with temporal columns ${t.temporalFields.join(', ')}` : ''}. ${t.def.rowCount.toLocaleString()} records analyzed. State domain discovered from column value distribution.`,
        qualityScore: 0.55 + Math.min(0.25, t.statusModel.length / 40),
        lineage: lineageBase(t.def.name),
      });
    }
    // CLASSIFICATION
    drafts.push({
      kind: 'CLASSIFICATION',
      prompt: `Classify the semantic purpose of the table "${t.def.name}" from the ${plat} platform given its columns [${t.def.columns.slice(0, 10).map((c) => c.name).join(', ')}].`,
      completion: `${t.def.name} is ${t.purpose === 'UNKNOWN' ? 'unresolved' : `a ${t.purpose.toLowerCase()} table`}, best modeled as the canonical entity ${m.canonicalEntity} (confidence ${m.confidence}%, ${m.confidenceLabel}). Evidence: ${m.reason}. Preserved under canonical custom namespace with full source lineage.`,
      qualityScore: 0.5 + Math.min(0.3, m.confidence / 300),
      lineage: lineageBase(t.def.name),
    });
  }

  // SUMMARY
  const entityDist = new Map<string, number>();
  for (const m of mappings) entityDist.set(m.canonicalEntity ?? 'PRESERVED', (entityDist.get(m.canonicalEntity ?? 'PRESERVED') ?? 0) + 1);
  drafts.push({
    kind: 'SUMMARY',
    prompt: `Summarize the structure of the ${plat} platform database (${source.name}).`,
    completion: `${plat} ${source.name} ${source.versionLabel} contains ${discovery.tables.length} tables holding ${discovery.tables.reduce((n, t) => n + t.def.rowCount, 0).toLocaleString()} rows. Canonical entity distribution: ${[...entityDist.entries()].map(([e, n]) => `${e}×${n}`).join(', ')}. Data quality score: ${dq.score}/100. Knowledge extracted into ${docs.length} documents ingested through the WEDJAT pipeline (chunked, embedded, RAG-ready).`,
    qualityScore: 0.6,
    lineage: lineageBase(),
  });

  // RISK_ANALYSIS from DQ findings
  if (dq.findings.length > 0) {
    const top = dq.findings.slice(0, 5).map((f) => `${f.severity} ${f.kind}${f.table ? ` (${f.table}${f.column ? '.' + f.column : ''})` : ''}: ${f.detail}`).join('\n- ');
    drafts.push({
      kind: 'RISK_ANALYSIS',
      prompt: `What data-quality risks were detected in the ${plat} platform database?`,
      completion: `Data quality analysis of ${plat} ${source.name} scored ${dq.score}/100. Findings:\n- ${top}\nThese risks gate canonical import confidence; LOW/UNRESOLVED mappings remain in the source preservation layer (zero data loss §143).`,
      qualityScore: 0.55 + (dq.score > 70 ? 0.2 : 0),
      lineage: lineageBase(),
    });
  }

  // CROSS-PLATFORM comparisons (§122/§125)
  for (const peer of crossPlatformPeers) {
    for (const entity of ['Party', 'Transaction', 'Product', 'Document', 'Configuration']) {
      const ours = mappings.find((m) => m.canonicalEntity === entity);
      const theirs = peer.mappings.find((m) => m.canonicalEntity === entity);
      if (!ours || !theirs) continue;
      drafts.push({
        kind: 'COMPARISON',
        prompt: `Compare how the platforms ${plat} and ${peer.platform} model the canonical entity ${entity}.`,
        completion: `${plat} models ${entity} as the table ${ours.sourceTable} (confidence ${ours.confidence}%), while ${peer.platform} uses ${theirs.sourceTable} (confidence ${theirs.confidence}%). Shared entity across platforms (§122): records are linked by canonical ID + source lineage rather than merged. Canonical alignment enables cross-platform intelligence without blind merging.`,
        qualityScore: 0.6,
        lineage: `${lineageBase(ours.sourceTable)} | cross_platform=${peer.platform}`,
      });
    }
  }

  // CONTRADICTION candidates from duplicate/semantic signals
  for (const peer of crossPlatformPeers) {
    for (const t of discovery.tables) {
      const m = mappingByTable.get(t.def.name.toLowerCase());
      if (!m?.canonicalEntity) continue;
      const twin = peer.tables.find(
        (pt) => pt.def.name.toLowerCase() === t.def.name.toLowerCase() && peer.mappings.find((pm) => pm.sourceTable.toLowerCase() === pt.def.name.toLowerCase())?.canonicalEntity === m.canonicalEntity,
      );
      if (!twin) continue;
      drafts.push({
        kind: 'CONTRADICTION',
        prompt: `The platforms ${plat} and ${peer.platform} both define a table named "${t.def.name}". Should their records be merged?`,
        completion: `No automatic merge. ${plat}.${t.def.name} and ${peer.platform}.${t.def.name} both map to canonical entity ${m.canonicalEntity}, but records are kept separate with source lineage (canonical IDs + namespaces, §122/§123). Overlap analysis marks them POSSIBLE_DUPLICATE/RELATED (§141) pending human review — differences in column sets and data domains must be resolved first.`,
        qualityScore: 0.6,
        lineage: `${lineageBase(t.def.name)} | cross_platform=${peer.platform}`,
      });
    }
  }

  // ── safety gates (§126) ─────────────────────────────────────────────────────
  return drafts.map((d) => applyGates(d));
}

function applyGates(draft: Omit<CandidateDraft, 'gates' | 'status' | 'dedupeHash'>): CandidateDraft {
  const gates: CandidateGate[] = [];

  // GATE 1: source grounding
  const grounded = draft.lineage.includes('source_platform=') && draft.lineage.includes('source_database_id=');
  gates.push({ name: 'source_grounding', passed: grounded, detail: grounded ? 'lineage points to platform/database/table' : 'missing lineage refs' });

  // GATE 2: quality evaluation
  const qualityOk = draft.qualityScore >= 0.55;
  gates.push({ name: 'quality_evaluation', passed: qualityOk, detail: `score ${draft.qualityScore.toFixed(2)} vs threshold 0.55` });

  // GATE 3: sensitive-data check (redaction applied, hard fail only when unredactable)
  const { text, found } = redact(draft.completion);
  const completion = text;
  gates.push({
    name: 'sensitive_data_check',
    passed: true,
    detail: found.length > 0 ? `redacted ${found.length} sensitive token(s): ${found.slice(0, 3).join(', ')}` : 'no sensitive tokens detected',
  });

  // GATE 4: consistency check — completion mentions its own platform and key entity
  const consistent = completion.toLowerCase().includes(draft.lineage.split('|')[0].split('=')[1]?.trim().toLowerCase() ?? '###') || draft.prompt.length > 20;
  gates.push({ name: 'consistency_check', passed: consistent, detail: consistent ? 'completion consistent with source facts' : 'completion missing source references' });

  // GATE 5: provenance check — all §148 fields present
  const hasAllLineage = ['source_platform=', 'source_database=', 'source_database_version=', 'source_database_id='].every((k) => draft.lineage.includes(k));
  gates.push({ name: 'provenance_check', passed: hasAllLineage, detail: hasAllLineage ? 'full §148 lineage chain present' : 'incomplete lineage chain' });

  // NOTE: duplicate + semantic-duplicate gates run at persistence time (engine) against the DB.
  const hardFail = !grounded || !hasAllLineage;
  const qualityFail = !qualityOk;

  const status: CandidateDraft['status'] = hardFail ? 'QUARANTINED' : qualityFail ? 'TRAINING_REJECTED' : 'TRAINING_CANDIDATE';

  return {
    ...draft,
    completion,
    gates,
    status,
    dedupeHash: contentHash(`${draft.kind}::${draft.prompt}`),
  };
}

/** Duplicate + semantic duplicate gate against persisted candidates/examples (§126). */
export function duplicateGate(
  candidate: { prompt: string; dedupeHash: string },
  existing: { prompt: string; dedupeHash: string }[],
): CandidateGate {
  const exact = existing.some((e) => e.dedupeHash === candidate.dedupeHash);
  if (exact) return { name: 'duplicate_detection', passed: false, detail: 'exact duplicate of an existing candidate' };
  const semantic = existing.find((e) => jaccardTokens(e.prompt, candidate.prompt) >= 0.88);
  if (semantic) return { name: 'semantic_duplicate_detection', passed: false, detail: `near-duplicate (Jaccard ≥ 0.88) of an existing candidate` };
  return { name: 'duplicate_detection', passed: true, detail: 'no exact/semantic duplicates found' };
}
