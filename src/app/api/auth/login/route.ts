import { NextResponse } from 'next/server';
import { login, SESSION_COOKIE } from '@/lib/wedjat/security/auth';
import { ok, failFrom, readJson, requireString } from '@/lib/wedjat/api';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = requireString(body.email, 'email', 200);
    const password = requireString(body.password, 'password', 200);
    const { principal, token, expiresAt } = await login(email, password);
    const res = ok(principal);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    });
    return res;
  } catch (err) {
    return failFrom(err);
  }
}
