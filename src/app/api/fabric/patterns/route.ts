// WEDJAT v4 — GET /api/fabric/patterns (§47/§48/§90): organizational reusable
// patterns with per-platform evidence — source identity is PRESERVED (§46).
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, failFrom, withPrincipal } from '@/lib/wedjat/api';
import type { PatternDto } from '@/lib/wedjat/types';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const rows = await db.orgPattern.findMany({
        where: { orgId: principal.org.id },
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
        take: 100,
      });
      const patterns: PatternDto[] = rows.map((p) => ({
        id: p.id,
        name: p.name,
        patternType: p.patternType,
        description: p.description,
        status: p.status,
        platforms: (() => { try { return JSON.parse(p.platformSlugsJson) as string[]; } catch { return []; } })(),
        evidence: (() => { try { return JSON.parse(p.evidenceJson) as PatternDto['evidence']; } catch { return []; } })(),
        confidence: p.confidence,
        createdAt: p.createdAt.toISOString(),
      }));
      return ok({ patterns });
    } catch (err) {
      return failFrom(err);
    }
  });
}
