// WEDJAT v4 — POST /api/fabric/registry/[slug]/connect (ADMIN+) — §88:
// register/refresh platform coordinates; mark CONNECTED. Returns the row.
import { NextResponse } from 'next/server';
import { ok, failFrom, withPrincipal, readJson } from '@/lib/wedjat/api';
import { requireAdminRole } from '@/lib/wedjat/security/auth';
import { connectPlatform, toRegistryDtos } from '@/lib/wedjat/fabric/registry';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      requireAdminRole(principal);
      const { slug } = await params;
      const body = await readJson<{ repositoryUrl?: string; deploymentUrl?: string; databaseUrl?: string }>(req).catch(
        () => ({}) as { repositoryUrl?: string; deploymentUrl?: string; databaseUrl?: string }
      );
      const platform = await connectPlatform(principal.org.id, slug, body, principal.userId);
      const [dto] = await toRegistryDtos(principal.org.id, [platform]);
      return ok(dto);
    } catch (err) {
      return failFrom(err);
    }
  });
}
