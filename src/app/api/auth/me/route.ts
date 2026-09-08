import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/wedjat/security/auth';
import { ok, failFrom } from '@/lib/wedjat/api';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const principal = await getPrincipal();
    return ok(principal);
  } catch (err) {
    return failFrom(err);
  }
}
