// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Intake artifact storage (§108 immutable source preservation).
//
// WHY: serverless runtimes (Vercel) have a READ-ONLY filesystem except /tmp, so
// writing uploaded database artifacts to db/sources only works locally. The
// immutable source bytes are therefore persisted DB-authoritatively
// (SourceDatabase.artifactData, within a portable blob budget) with the local
// file acting as a cache. When a real file is required (SQLite parsing), the
// bytes are re-materialized to a writable temp location on demand.
//
// Zero-data-loss (§143) and immutability (§108) semantics are unchanged: bytes
// are written once, checksumed, and never modified afterwards.
// ═══════════════════════════════════════════════════════════════════════════════

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '@/lib/db';

/**
 * Artifacts up to this size are mirrored into the database so they survive
 * serverless cold starts and can be reprocessed anywhere. Beyond it, the
 * artifact only lives on the instance that received the upload (documented
 * degradation — reprocessing such sources requires a re-upload).
 */
export const ARTIFACT_DB_BUDGET_BYTES = 4 * 1024 * 1024;

export interface ArtifactSourceRow {
  id: string;
  artifactPath: string;
  artifactData: Uint8Array | null;
  checksum: string;
}

/** Dev/sandbox cache dir (writable cwd) — mirrors repo layout. */
function localCachePath(sourceId: string): string {
  return join(process.cwd(), 'db', 'sources', sourceId, 'artifact');
}

/** Serverless-safe writable dir (per-instance ephemeral). */
function tempMaterializedPath(sourceId: string): string {
  return join(tmpdir(), 'wedjat-sources', sourceId, 'artifact');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the immutable artifact bytes: DB blob first (authoritative, portable),
 * then the recorded FS cache path. Throws when neither is available.
 */
export async function loadArtifactBytes(source: ArtifactSourceRow): Promise<Uint8Array> {
  if (source.artifactData && source.artifactData.length > 0) {
    return source.artifactData;
  }
  try {
    return new Uint8Array(await fs.readFile(source.artifactPath));
  } catch {
    throw new Error(
      `Artifact for source ${source.id} is not available: no DB copy and FS path "${source.artifactPath}" is unreachable (serverless instance without the original upload). Re-upload the source to reprocess it.`
    );
  }
}

/**
 * Guarantees a REAL file on disk holding the artifact bytes (required by the
 * SQLite parser, which opens a file handle). Order: existing FS cache →
 * materialize DB bytes into the writable temp dir.
 */
export async function materializeArtifactFile(source: ArtifactSourceRow): Promise<string> {
  for (const candidate of [source.artifactPath, localCachePath(source.id)]) {
    if (candidate && candidate !== 'pending' && (await fileExists(candidate))) {
      return candidate;
    }
  }
  const bytes = await loadArtifactBytes(source);
  const target = tempMaterializedPath(source.id);
  await fs.mkdir(join(tmpdir(), 'wedjat-sources', source.id), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}

/**
 * Persists uploaded artifact bytes:
 *  1. DB blob when within the portable budget (authoritative, immutable);
 *  2. FS cache best-effort (local dev keeps the repo layout; failures on
 *     read-only filesystems are non-fatal by design).
 * Returns the fields to store on the SourceDatabase row.
 */
export async function persistArtifact(
  sourceId: string,
  bytes: Uint8Array
): Promise<{ artifactData: Uint8Array | null; artifactPath: string }> {
  const artifactPath = localCachePath(sourceId);
  try {
    await fs.mkdir(join(process.cwd(), 'db', 'sources', sourceId), { recursive: true });
    await fs.writeFile(artifactPath, bytes);
  } catch {
    // Read-only FS (serverless): the DB copy below is the source of truth.
    return { artifactData: bytes.length <= ARTIFACT_DB_BUDGET_BYTES ? bytes : null, artifactPath };
  }
  return { artifactData: bytes.length <= ARTIFACT_DB_BUDGET_BYTES ? bytes : null, artifactPath };
}

/**
 * Backfills artifactData for legacy sources that only have FS copies
 * (migration helper for the Turso move).
 */
export async function backfillArtifactBlobs(): Promise<number> {
  const sources = await db.sourceDatabase.findMany({
    where: { artifactData: null },
    select: { id: true, artifactPath: true },
  });
  let n = 0;
  for (const s of sources) {
    try {
      const bytes = new Uint8Array(await fs.readFile(s.artifactPath));
      if (bytes.length <= ARTIFACT_DB_BUDGET_BYTES) {
        await db.sourceDatabase.update({
          where: { id: s.id },
          data: { artifactData: bytes },
        });
        n++;
      }
    } catch {
      // FS copy missing — skip; source keeps its DB-less legacy state.
    }
  }
  return n;
}
