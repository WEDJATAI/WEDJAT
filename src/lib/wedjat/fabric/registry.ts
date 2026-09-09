// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Platform registry helpers (§87/§88, §114/§115).
//
// ADDITIVE ONLY: connecting/disconnecting/retiring platforms changes registry
// STATUS fields — learned knowledge, events, history are NEVER deleted (§114:
// "retain imported historical knowledge; mark source unavailable").
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { WedjatError } from '../errors';
import { recordAudit } from '../observability/audit';
import type { PlatformRegistryDto } from '../types';
import type { Platform } from '@prisma/client';

export async function toRegistryDtos(orgId: string, platforms: Platform[]): Promise<PlatformRegistryDto[]> {
  const ids = platforms.map((p) => p.id);
  const [krCounts, bpCounts, evCounts, lastEvents] = await Promise.all([
    db.knowledgeRecord.groupBy({ by: ['platformId'], where: { platformId: { in: ids } }, _count: { _all: true } }),
    db.blueprint.groupBy({ by: ['platformId'], where: { platformId: { in: ids } }, _count: { _all: true } }),
    db.eventRecord.groupBy({ by: ['sourcePlatform'], where: { orgId }, _count: { _all: true } }),
    db.eventRecord.findMany({
      where: { orgId },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: { sourcePlatform: true, receivedAt: true },
    }),
  ]);
  const krMap = new Map(krCounts.map((k) => [k.platformId, k._count._all]));
  const bpMap = new Map(bpCounts.map((b) => [b.platformId, b._count._all]));
  const evMap = new Map(evCounts.map((e) => [e.sourcePlatform, e._count._all]));
  const lastSync = new Map<string, string>();
  for (const e of lastEvents) {
    if (!lastSync.has(e.sourcePlatform)) lastSync.set(e.sourcePlatform, e.receivedAt.toISOString());
  }
  return platforms.map((p) => ({
    slug: p.slug,
    name: p.name,
    criticality: p.criticality,
    status: p.status,
    connectionStatus: p.connectionStatus ?? 'DISCOVERED',
    repositoryUrl: p.repositoryUrl,
    deploymentUrl: p.deploymentUrl,
    databaseUrl: p.databaseUrl,
    knowledgeRecords: krMap.get(p.id) ?? 0,
    blueprints: bpMap.get(p.id) ?? 0,
    events: evMap.get(p.slug) ?? 0,
    lastSyncAt: lastSync.get(p.slug) ?? null,
  }));
}

/**
 * §88 connect: register/refresh registry coordinates and mark CONNECTED.
 * Creates the platform row when absent (new platforms attach to the core —
 * §11: "current WEDJAT core + new platform", no restructuring).
 */
export async function connectPlatform(
  orgId: string,
  slug: string,
  input: { repositoryUrl?: string; deploymentUrl?: string; databaseUrl?: string },
  userId: string
): Promise<Platform> {
  const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(1, 60);
  if (!/^[a-z][a-z0-9-]*$/.test(safeSlug)) {
    throw new WedjatError('VALIDATION', 'platform slug must be lowercase kebab-case');
  }
  const clean = (v: string | undefined) => {
    if (!v || v.trim() === '') return undefined;
    const t = v.trim();
    if (!/^https?:\/\//i.test(t) && !/^libsql:\/\//i.test(t)) {
      throw new WedjatError('VALIDATION', `URL must start with https:// or libsql:// (got '${t.slice(0, 40)}…')`);
    }
    return t.slice(0, 300);
  };
  const repositoryUrl = clean(input.repositoryUrl);
  const deploymentUrl = clean(input.deploymentUrl);
  const databaseUrl = clean(input.databaseUrl);

  const existing = await db.platform.findFirst({ where: { orgId, slug: safeSlug } });
  const platform = existing
    ? await db.platform.update({
        where: { id: existing.id },
        data: {
          repositoryUrl: repositoryUrl ?? existing.repositoryUrl,
          deploymentUrl: deploymentUrl ?? existing.deploymentUrl,
          databaseUrl: databaseUrl ?? existing.databaseUrl,
          connectionStatus: 'CONNECTED',
          status: 'ACTIVE',
        },
      })
    : await db.platform.create({
        data: {
          orgId,
          slug: safeSlug,
          name: safeSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          criticality: 'MEDIUM',
          status: 'ACTIVE',
          repositoryUrl,
          deploymentUrl,
          databaseUrl,
          connectionStatus: 'CONNECTED',
        },
      });
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'platform.connected',
    targetType: 'Platform', targetId: platform.id, severity: 'INFO',
    detailsJson: JSON.stringify({ slug: safeSlug, created: !existing }),
  });
  return platform;
}

/** §114 disconnect: status change ONLY — knowledge, events and history stay. */
export async function disconnectPlatform(orgId: string, slug: string, userId: string): Promise<Platform> {
  const platform = await db.platform.findFirst({ where: { orgId, slug } });
  if (!platform) throw new WedjatError('NOT_FOUND', `platform '${slug}' is not registered`);
  const updated = await db.platform.update({
    where: { id: platform.id },
    data: { connectionStatus: 'DISCONNECTED' },
  });
  await recordAudit({
    orgId, actorType: 'user', actorId: userId, action: 'platform.disconnected',
    targetType: 'Platform', targetId: platform.id, severity: 'WARN',
    detailsJson: JSON.stringify({ slug, note: 'knowledge preserved (v4 §114)' }),
  });
  return updated;
}
