// WEDJAT v4 — POST /api/v1/analyze (§76/§113): platform-requested analyses
// (resilience / security-risk / architecture / cto-summary / contradictions /
// cross-platform). Reuses the production analysis workflows with a service
// principal — identical grounding + evidence rules.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, withServiceIdentity, readServiceJson } from '@/lib/wedjat/fabric/api';
import { runAnalysis, type AnalysisType } from '@/lib/wedjat/reasoning/workflows';
import { recordAudit } from '@/lib/wedjat/observability/audit';
import { WedjatError } from '@/lib/wedjat/errors';
import type { Principal } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VALID_TYPES: AnalysisType[] = ['cto-summary', 'resilience', 'contradictions', 'compare', 'cross-platform'];

interface AnalyzeBody {
  platform?: string;
  focus?: string; // resilience | security | architecture | database | performance | cost (§113)
  type?: string;
  fromVersionId?: string;
  toVersionId?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withServiceIdentity(req, ['analysis:read'], {}, async ({ identity }) => {
    const body = await readServiceJson<AnalyzeBody>(req);
    const platform = (typeof body.platform === 'string' && body.platform.trim() !== ''
      ? body.platform.trim().toLowerCase()
      : identity.platformSlug !== '*' ? identity.platformSlug : '');
    if (!platform) return fail('VALIDATION', "field 'platform' is required for org-wide identities");

    const focus = (body.focus ?? body.type ?? 'resilience').toLowerCase();
    const type: AnalysisType =
      focus === 'architecture' || focus === 'cto' || focus === 'summary' ? 'cto-summary' :
      focus === 'security' || focus === 'risk' ? 'resilience' :
      focus === 'database' ? 'resilience' :
      focus === 'performance' || focus === 'cost' ? 'cto-summary' :
      focus === 'contradictions' ? 'contradictions' :
      focus === 'cross-platform' ? 'cross-platform' :
      'resilience';
    if (body.type && !VALID_TYPES.includes(body.type as AnalysisType)) {
      return fail('VALIDATION', `type must be one of ${VALID_TYPES.join(', ')}`);
    }
    const finalType = (body.type as AnalysisType | undefined) ?? type;

    const org = await db.organization.findUnique({ where: { id: identity.orgId } });
    if (!org) return fail('NOT_FOUND', 'organization not found');
    const servicePrincipal: Principal = {
      userId: `service:${identity.id}`,
      name: `service:${identity.name}`,
      email: `${identity.platformSlug}@service.wedjat.local`,
      role: 'MEMBER',
      org: { id: org.id, slug: org.slug, name: org.name, dataPolicy: org.dataPolicy },
    };
    const analysis = await runAnalysis({
      principal: servicePrincipal,
      type: finalType,
      platform,
      fromVersionId: body.fromVersionId,
      toVersionId: body.toVersionId,
    });
    await recordAudit({
      orgId: identity.orgId, actorType: 'system', actorId: `identity:${identity.id}`,
      action: 'v1.analyze', severity: 'INFO',
      detailsJson: JSON.stringify({ platform, type: finalType }),
    });
    return ok(analysis);
  });
}
