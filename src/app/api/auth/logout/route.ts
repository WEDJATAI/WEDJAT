import { NextResponse } from 'next/server';
import { logout, SESSION_COOKIE, resolveSessionToken } from '@/lib/wedjat/security/auth';
import { ok, failFrom } from '@/lib/wedjat/api';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Terminates the session whichever transport carried it (cookie or bearer).
    await logout(await resolveSessionToken());
    const res = ok(true);
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return failFrom(err);
  }
}
