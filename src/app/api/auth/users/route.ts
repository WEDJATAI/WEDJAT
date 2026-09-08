import { NextResponse } from 'next/server';
import { listLoginUsers } from '@/lib/wedjat/security/auth';
import { ok, failFrom } from '@/lib/wedjat/api';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const users = await listLoginUsers();
    return ok(users);
  } catch (err) {
    return failFrom(err);
  }
}
