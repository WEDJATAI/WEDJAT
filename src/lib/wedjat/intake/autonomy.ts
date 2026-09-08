// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake: configurable autonomy levels (§151, §152).
//
// LEVEL 0 MANUAL … LEVEL 5 CONTROLLED AUTO-DEPLOYMENT. Whatever the level,
// governance overrides are hard-coded (§152): no autonomous deletion of
// authoritative data, no history overwrites, no security-policy changes, no
// uncontrolled production-schema migration, no secret exposure, no publishing
// of proprietary data/models, no audit-trail removal, no evaluation bypass and
// no quality-gate bypass. Production promotion stays human-controlled (§127).
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

export interface AutonomyCapabilityDef {
  name: string;
  minLevel: number;
}

export const AUTONOMY_CAPABILITIES: AutonomyCapabilityDef[] = [
  { name: 'Auto ingestion — upload → analyze → import (HIGH-confidence mappings)', minLevel: 1 },
  { name: 'Auto knowledge extraction → RAG indexing', minLevel: 2 },
  { name: 'Auto training-candidate generation', minLevel: 3 },
  { name: 'Auto dataset curation + training runs (quality gates pass)', minLevel: 4 },
  { name: 'Auto canary deployment after evaluation + regression gates', minLevel: 5 },
];

export const GOVERNANCE_NEVER = [
  'delete authoritative data',
  'overwrite historical versions',
  'change security policies',
  'migrate production schemas without migration controls',
  'expose secrets',
  'publish proprietary data or private models',
  'remove audit trails',
  'disable evaluation',
  'bypass quality gates',
  'auto-promote a model to PRODUCTION (explicit human approval is always required, §127/§152)',
];

export const AUTONOMY_LABELS: { level: number; label: string; description: string }[] = [
  { level: 0, label: 'LEVEL 0 — MANUAL', description: 'Nothing is automatically imported or trained.' },
  { level: 1, label: 'LEVEL 1 — AUTO INGESTION', description: 'Upload → analyze → import.' },
  { level: 2, label: 'LEVEL 2 — AUTO KNOWLEDGE', description: 'Upload → ingest → knowledge extraction → RAG.' },
  { level: 3, label: 'LEVEL 3 — AUTO TRAINING DATA', description: 'Upload → knowledge → training candidate generation.' },
  { level: 4, label: 'LEVEL 4 — AUTO TRAINING', description: 'Upload → approved dataset → training → evaluation.' },
  { level: 5, label: 'LEVEL 5 — CONTROLLED AUTO-DEPLOYMENT', description: 'Training → evaluation → canary. Production promotion remains human-controlled (§127/§152).' },
];

export type AutonomyAction =
  | 'CANONICAL_IMPORT'
  | 'KNOWLEDGE_EXTRACTION'
  | 'TRAINING_CANDIDATES'
  | 'TRAINING_DATASET'
  | 'TRAINING_RUN'
  | 'AUTO_CANARY';

const ACTION_MIN_LEVEL: Record<AutonomyAction, number> = {
  CANONICAL_IMPORT: 1,
  KNOWLEDGE_EXTRACTION: 2,
  TRAINING_CANDIDATES: 3,
  TRAINING_DATASET: 4,
  TRAINING_RUN: 4,
  AUTO_CANARY: 5,
};

export function autonomyAllows(level: number, action: AutonomyAction): boolean {
  return level >= ACTION_MIN_LEVEL[action];
}

export interface AutonomyState {
  level: number;
  label: string;
  description: string;
}

export async function getAutonomyState(orgId: string): Promise<AutonomyState> {
  const row = await db.autonomyConfig.findUnique({ where: { orgId } });
  const level = row?.level ?? 4; // §151: default production mode LEVEL 4
  const meta = AUTONOMY_LABELS.find((l) => l.level === level) ?? AUTONOMY_LABELS[4];
  return { level, label: meta.label, description: meta.description };
}

export async function setAutonomyLevel(orgId: string, level: number, updatedById?: string): Promise<AutonomyState> {
  if (!Number.isInteger(level) || level < 0 || level > 5) {
    throw Object.assign(new Error('level must be an integer 0..5'), { name: 'WedjatError' });
  }
  await db.autonomyConfig.upsert({
    where: { orgId },
    create: { orgId, level, updatedById },
    update: { level, updatedById },
  });
  return getAutonomyState(orgId);
}
