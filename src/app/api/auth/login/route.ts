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

    // The session token is mirrored in the response body: the client persists
    // it and echoes it as `Authorization: Bearer` on every request. This keeps
    // sessions alive in embedded preview contexts where browsers block
    // third-party cookies. The principal itself is still resolved server-side.
    const res = ok({ principal, token, expiresAt: expiresAt.toISOString() });

    // Cookie path (first-party access): when the request arrived over HTTPS
    // (preview gateway terminates TLS) use SameSite=None;Secure so the cookie
    // is also accepted in Chrome cross-site iframes. Over plain HTTP dev,
    // SameSite=Lax is the most compatible option (None requires Secure).
    const forwardedProto = req.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      .toLowerCase();
    const viaHttps = forwardedProto === 'https' || new URL(req.url).protocol === 'https:';
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: viaHttps ? 'none' : 'lax',
      secure: viaHttps,
      path: '/',
      expires: expiresAt,
    });
    return res;
  } catch (err) {
    return failFrom(err);
  }
}
