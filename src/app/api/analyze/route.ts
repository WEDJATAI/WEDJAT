import { NextResponse } from 'next/server';
import { ok, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { runAnalysis, type AnalysisType } from '@/lib/wedjat/reasoning/workflows';
import { WedjatError } from '@/lib/wedjat/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface AnalyzeBody {
  type?: string;
  platform?: string;
  blueprint?: string;
  version?: string;
  fromVersionId?: string;
  toVersionId?: string;
}

const VALID_TYPES: AnalysisType[] = ['cto-summary', 'resilience', 'contradictions', 'compare', 'cross-platform'];

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const body = await readJson<AnalyzeBody>(req);
    const type = requireString(body.type, 'type', 40) as AnalysisType;
    if (!VALID_TYPES.includes(type)) {
      throw new WedjatError('VALIDATION', `type must be one of ${VALID_TYPES.join(', ')}`);
    }
    if (type === 'compare' && (!body.fromVersionId || !body.toVersionId)) {
      throw new WedjatError('VALIDATION', 'compare requires fromVersionId and toVersionId');
    }

    const analysis = await runAnalysis({
      principal,
      type,
      platform: body.platform || undefined,
      blueprint: body.blueprint || undefined,
      version: body.version || undefined,
      fromVersionId: body.fromVersionId,
      toVersionId: body.toVersionId,
    });
    return ok(analysis);
  });
}
