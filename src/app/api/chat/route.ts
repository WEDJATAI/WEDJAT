import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ok, withPrincipal, readJson, requireString } from '@/lib/wedjat/api';
import { runChatPipeline } from '@/lib/wedjat/reasoning/answer';
import { WedjatError } from '@/lib/wedjat/errors';
import type { ConversationMessage } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface ChatBody {
  message?: string;
  conversationId?: string;
  platform?: string;
  blueprint?: string;
  version?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const body = await readJson<ChatBody>(req);
    const message = requireString(body.message, 'message', 8000);

    const chat = await runChatPipeline({
      principal,
      message,
      conversationId: body.conversationId,
      explicitScope: {
        platform: body.platform || undefined,
        blueprint: body.blueprint || undefined,
        version: body.version || undefined,
      },
    });
    return ok(chat);
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const conversationId = new URL(req.url).searchParams.get('conversationId');
    if (!conversationId) throw new WedjatError('VALIDATION', 'conversationId is required');
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, orgId: principal.org.id },
    });
    if (!conversation) throw new WedjatError('NOT_FOUND', 'Conversation not found');
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { generations: { include: { sources: true } } },
    });
    const dtos: ConversationMessage[] = messages.map((m) => {
      const g = m.generations[0] ?? null;
      return {
        id: m.id,
        role: m.role as ConversationMessage['role'],
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        generation: g
          ? {
              id: g.id,
              provider: g.provider,
              model: g.model,
              status: g.status,
              confidence: g.confidence,
              groundedness: g.groundedness,
              sourceCount: g.sources.length,
            }
          : null,
      };
    });
    return ok(dtos);
  });
}
