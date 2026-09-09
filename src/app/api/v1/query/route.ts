// WEDJAT v4 — POST /api/v1/query (analysis:read): grounded Q&A over
// organizational knowledge for connected platforms (§26/§27). Reuses the
// production chat pipeline (retrieval → grounding check → generation →
// answer structure) with a service principal — same guarantees, same honest
// degradation (no evidence → no generation, §77/§79).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { runChatPipeline } from '@/lib/wedjat/reasoning/answer';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import type { Principal } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface QueryBody {
  query?: string;
  platform?: string;
  mode?: string; // ASK (default) | HISTORICAL | AUDIT — scope hint
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['analysis:read'], {}, async ({ identity }) => {
    const body = await readServiceJson<QueryBody>(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (query.length < 8) {
      return fail('VALIDATION', "field 'query' is required (min 8 chars)");
    }
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    const mode = (body.mode ?? 'ASK').toUpperCase();
    if (!['ASK', 'HISTORICAL', 'AUDIT'].includes(mode)) {
      return fail('VALIDATION', "field 'mode' must be ASK, HISTORICAL or AUDIT");
    }

    const org = await db.organization.findUnique({ where: { id: identity.orgId } });
    if (!org) return fail('NOT_FOUND', 'organization not found');

    // §28 retrieval modes: HISTORICAL/AUDIT are scope hints — the answer
    // pipeline resolves platform scope and the mode is surfaced in metadata
    // (explicit version scoping is available via the question itself).
    const scopedQuery = platform
      ? mode === 'ASK' ? `${query}\n\n(scope: platform ${platform})` : `${query}\n\n(scope: platform ${platform}, mode: ${mode.toLowerCase()})`
      : mode === 'HISTORICAL' || mode === 'AUDIT' ? `${query}\n\n(mode: ${mode.toLowerCase()})` : query;

    const servicePrincipal: Principal = {
      userId: `service:${identity.id}`,
      name: `service:${identity.name}`,
      email: `${identity.platformSlug}@service.wedjat.local`,
      role: 'MEMBER',
      org: { id: org.id, slug: org.slug, name: org.name, dataPolicy: org.dataPolicy },
    };
    const response = await runChatPipeline({
      principal: servicePrincipal,
      message: scopedQuery,
      explicitScope: platform ? { platform } : undefined,
    });
    await recordAudit({
      orgId: identity.orgId, actorType: 'system', actorId: `identity:${identity.id}`,
      action: 'v1.query', severity: 'INFO',
      detailsJson: JSON.stringify({ platform, mode, confidence: response.confidence ?? null }),
    });
    return ok({
      mode,
      platform: platform || 'auto-resolved',
      answer: response.answer,
      confidence: response.confidence,
      evidenceLevel: response.confidence?.level ?? null,
      sources: response.sources.map((s) => ({
        rank: s.rank,
        title: s.documentTitle,
        heading: s.sectionHeading,
        platform: s.platformSlug,
        score: s.rerankScore,
      })),
      generationStatus: response.generation.status,
      note: response.insufficientEvidence
        ? 'insufficient evidence — no generation was attempted (§77/§79 honest degradation)'
        : null,
    });
  });
}
