import { NextResponse } from 'next/server';
import { ok, withPrincipal, readJson } from '@/lib/wedjat/api';
import { hybridRetrieve } from '@/lib/wedjat/retrieval/hybrid';
import { rerank, RERANKER_MODEL } from '@/lib/wedjat/retrieval/reranker';
import { EMBEDDER_MODEL } from '@/lib/wedjat/knowledge/embeddings';
import { metrics } from '@/lib/wedjat/observability/metrics';
import { toSourceRefs } from '@/lib/wedjat/reasoning/source-refs';
import { expandQuery } from '@/lib/wedjat/reasoning/answer';
import type { SearchResponse } from '@/lib/wedjat/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchBody {
  query?: string;
  platform?: string;
  blueprint?: string;
  version?: string;
  docType?: string;
  topK?: number;
}

export async function POST(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    const body = await readJson<SearchBody>(req);
    const query = (body.query ?? '').trim();
    if (!query) {
      return ok(<SearchResponse>{
        traceId: 'n/a',
        query: '',
        results: [],
        retrievalMeta: {
          mode: 'HYBRID', candidatesCount: 0, latencyMs: 0,
          filters: {}, rerankerModel: RERANKER_MODEL, embedderModel: EMBEDDER_MODEL,
        },
      });
    }

    const topK = Math.min(Math.max(body.topK ?? 10, 1), 30);
    const expanded = expandQuery(query);
    const retrieval = await hybridRetrieve(
      expanded,
      {
        orgId: principal.org.id,
        platformSlug: body.platform || undefined,
        blueprintSlug: body.blueprint || undefined,
        versionStatus: body.version ? undefined : 'CURRENT',
        docType: body.docType || undefined,
      },
      Math.max(topK * 3, 24)
    );
    metrics.bumpRetrieval();
    const ranked = rerank(expanded, retrieval.candidates, topK);

    const response: SearchResponse = {
      traceId: retrieval.traceId,
      query,
      results: toSourceRefs(ranked),
      retrievalMeta: {
        mode: 'HYBRID',
        candidatesCount: retrieval.candidatesCount,
        latencyMs: retrieval.latencyMs,
        filters: {
          platform: body.platform ?? null,
          blueprint: body.blueprint ?? null,
          version: body.version ?? null,
          docType: body.docType ?? null,
        },
        rerankerModel: RERANKER_MODEL,
        embedderModel: EMBEDDER_MODEL,
      },
    };
    return ok(response);
  });
}
