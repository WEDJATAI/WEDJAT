// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — API envelope helpers.
//
// Every route returns { ok: true, data } | { ok: false, error: {code,message} }.
// Errors are mapped from the typed taxonomy — safe messages only, never stack
// traces (§60). Auth is enforced centrally here via withPrincipal.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { WedjatError, toWedjatError } from './errors';
import { getPrincipal } from './security/auth';
import { logger } from './logger';
import type { Principal } from './types';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true as const, data }, { status });
}

export function fail(code: string, message: string, status = 500): NextResponse {
  return NextResponse.json({ ok: false as const, error: { code, message } }, { status });
}

export function failFrom(err: unknown): NextResponse {
  const werr = toWedjatError(err);
  if (werr.httpStatus >= 500) {
    // Log full detail server-side; expose only the safe message.
    logger.error('api_error', { code: werr.code, message: werr.message, detail: werr.detail });
  }
  return fail(werr.code, werr.message, werr.httpStatus);
}

/** Wraps a handler with server-side auth; never trusts client identity. */
export async function withPrincipal(
  handler: (principal: Principal) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const principal = await getPrincipal();
    return await handler(principal);
  } catch (err) {
    return failFrom(err);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new WedjatError('VALIDATION', 'Request body must be valid JSON');
  }
}

export function requireString(value: unknown, field: string, maxLen = 100_000): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WedjatError('VALIDATION', `Field '${field}' is required`);
  }
  if (value.length > maxLen) {
    throw new WedjatError('VALIDATION', `Field '${field}' exceeds ${maxLen} characters`);
  }
  return value;
}
