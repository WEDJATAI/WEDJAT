// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — /api/intake/review (§113, §126).
//
// GET: the review queue — pending canonical mappings + training candidates.
// POST: APPROVE/REJECT a mapping or candidate (CURATOR+). Approving a candidate
// registers its §148-lineaged INTAKE training source for the next dataset build.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, readJson, withPrincipal } from '@/lib/wedjat/api';
import { requireMutationRole } from '@/lib/wedjat/security/auth';
import { WedjatError } from '@/lib/wedjat/errors';
import { toCandidateDto, toMappingDto } from '@/lib/wedjat/intake/dto';
import { recordAudit } from '@/lib/wedjat/observability/audit';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const mappings = await db.canonicalMapping.findMany({
        where: { orgId: principal.org.id, decision: 'PENDING_REVIEW' },
        orderBy: { confidence: 'desc' },
        take: 150,
      });
      const candidates = await db.trainingCandidate.findMany({
        where: { orgId: principal.org.id, status: 'TRAINING_CANDIDATE' },
        orderBy: { qualityScore: 'desc' },
        take: 150,
      });
      return ok({
        mappings: mappings.map(toMappingDto),
        candidates: candidates.map(toCandidateDto),
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}

interface ReviewBody {
  mappingId?: string;
  candidateId?: string;
  decision?: string;
  note?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireMutationRole(principal);
      const body = await readJson<ReviewBody>(req);
      const decision = String(body.decision ?? '').toUpperCase();
      if (!['APPROVE', 'REJECT'].includes(decision)) {
        throw new WedjatError('VALIDATION', "decision must be 'APPROVE' or 'REJECT'");
      }
      const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;

      if (body.mappingId) {
        const mapping = await db.canonicalMapping.findFirst({
          where: { id: body.mappingId, orgId: principal.org.id },
        });
        if (!mapping) throw new WedjatError('NOT_FOUND', 'Mapping not found');
        if (mapping.decision !== 'PENDING_REVIEW') {
          throw new WedjatError('VALIDATION', `mapping already decided (${mapping.decision})`);
        }
        const updated = await db.canonicalMapping.update({
          where: { id: mapping.id },
          data: {
            decision: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            reviewedById: principal.userId,
            reviewedAt: new Date(),
            reviewNote: note ?? (decision === 'APPROVE' ? 'human-approved mapping (§113 review queue)' : 'human-rejected mapping (§113)'),
          },
        });
        await recordAudit({
          orgId: principal.org.id,
          actorType: 'user',
          actorId: principal.userId,
          action: `intake.mapping_${decision.toLowerCase()}d`,
          targetType: 'canonicalMapping',
          targetId: mapping.id,
          severity: 'INFO',
          details: { table: mapping.sourceTable, entity: mapping.canonicalEntity, confidence: mapping.confidence, note },
        });
        return ok(toMappingDto(updated));
      }

      if (body.candidateId) {
        const candidate = await db.trainingCandidate.findFirst({
          where: { id: body.candidateId, orgId: principal.org.id },
        });
        if (!candidate) throw new WedjatError('NOT_FOUND', 'Training candidate not found');
        if (!['TRAINING_CANDIDATE', 'TRAINING_REJECTED'].includes(candidate.status)) {
          throw new WedjatError('VALIDATION', `candidate already decided (${candidate.status})`);
        }
        const updated = await db.trainingCandidate.update({
          where: { id: candidate.id },
          data: {
            status: decision === 'APPROVE' ? 'TRAINING_APPROVED' : 'TRAINING_REJECTED',
            reviewedById: principal.userId,
            reviewedAt: new Date(),
            reviewNote: note ?? (decision === 'APPROVE' ? 'human-approved (§126 safety gates reviewed)' : 'human-rejected (§126)'),
          },
        });
        // §148: approved candidates become eligible INTAKE training sources
        // for the next dataset build (§129 batching).
        if (decision === 'APPROVE' && !updated.trainingExampleId) {
          const existing = await db.trainingSource.findUnique({
            where: { orgId_kind_refId: { orgId: principal.org.id, kind: 'INTAKE', refId: candidate.id } },
          });
          if (!existing) {
            await db.trainingSource.create({
              data: {
                orgId: principal.org.id,
                kind: 'INTAKE',
                refId: candidate.id,
                status: 'ELIGIBLE',
                reason: 'human-approved intake candidate (§126/§148 lineage on record)',
              },
            });
          }
        }
        await recordAudit({
          orgId: principal.org.id,
          actorType: 'user',
          actorId: principal.userId,
          action: `intake.candidate_${decision === 'APPROVE' ? 'approved' : 'rejected'}`,
          targetType: 'trainingCandidate',
          targetId: candidate.id,
          severity: 'INFO',
          details: { kind: candidate.kind, qualityScore: candidate.qualityScore, note },
        });
        return ok(toCandidateDto(updated));
      }

      throw new WedjatError('VALIDATION', 'mappingId or candidateId is required');
    } catch (err) {
      return failFrom(err);
    }
  });
}
