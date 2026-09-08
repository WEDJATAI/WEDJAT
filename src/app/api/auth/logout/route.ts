import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { logout, SESSION_COOKIE } from '@/lib/wedjat/security/auth';
import { ok, failFrom } from '@/lib/wedjat/api';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await logout(token);
    const res = ok(true);
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return failFrom(err);
  }
}
