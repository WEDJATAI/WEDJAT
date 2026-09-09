// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — /api/v1 route helpers: service-identity auth wrapper + request
// size limit (§85). Mirrors withPrincipal for platform API keys.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { WedjatError, toWedjatError } from '../errors';
import { logger } from '../logger';
import { failFrom, ok as okEnvelope, fail } from '../api';
import { authenticateServiceIdentity, type AuthenticatedIdentity } from './identity';
import type { ApiScope } from '../types';

export interface ServiceContext {
  identity: AuthenticatedIdentity;
  /** Request body size guard (§85 request size limits). */
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB

/**
 * Wraps a /api/v1 handler with service-identity authentication, scopes and
 * platform ownership validation (§8/§10). Rate limiting (§33) and last-used
 * stamping are applied inside authenticateServiceIdentity.
 */
export async function withServiceIdentity(
  req: Request,
  requiredScopes: ApiScope[],
  opts: { platform?: string } = {},
  handler: (ctx: ServiceContext) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return fail('VALIDATION', `request body exceeds ${MAX_BODY_BYTES} bytes`, 413);
    }
    const identity = await authenticateServiceIdentity(req, requiredScopes, opts);
    return await handler({ identity });
  } catch (err) {
    const werr = toWedjatError(err);
    if (werr.httpStatus >= 500) {
      logger.error('v1_api_error', { code: werr.code, message: werr.message });
    }
    return failFrom(err);
  }
}

/** Reads and validates a JSON body with a hard size cap (§85). */
export async function readServiceJson<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new WedjatError('VALIDATION', `request body exceeds ${MAX_BODY_BYTES} characters`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new WedjatError('VALIDATION', 'request body must be valid JSON');
  }
}

export { okEnvelope as ok, fail };
