// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — GET /api/training/export (§38, §41).
//
// Streams a locked dataset version as LoRA/SFT-ready JSONL so training can run
// on ANY external executor — including free GPU tiers (Colab T4, Kaggle P100;
// see docs/TRAINING_ON_FREE_GPU.md). One JSON object per line:
//   {"prompt":…, "completion":…, "type":…, "quality":…, "synthetic":…}
// The platform itself never needs a GPU: RAG retrieval + grounding is the
// production intelligence path; fine-tuning is an optional offline step.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { failFrom, withPrincipal } from '@/lib/wedjat/api';
import { WedjatError } from '@/lib/wedjat/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  return withPrincipal(async (principal) => {
    try {
      const url = new URL(req.url);
      const datasetVersionId = url.searchParams.get('datasetVersionId');
      if (!datasetVersionId) {
        throw new WedjatError('VALIDATION', 'datasetVersionId query parameter is required');
      }

      const dv = await db.trainingDatasetVersion.findUnique({
        where: { id: datasetVersionId },
        include: {
          dataset: true,
          examples: {
            orderBy: { createdAt: 'asc' },
            select: {
              prompt: true,
              completion: true,
              exampleType: true,
              qualityScore: true,
              isSynthetic: true,
              status: true,
            },
          },
        },
      });
      if (!dv || dv.dataset.orgId !== principal.org.id) {
        throw new WedjatError('NOT_FOUND', 'Dataset version not found');
      }

      // Export the validated build: examples that made it into the version.
      const eligible = dv.examples.filter((e) => e.status !== 'EXCLUDED');
      const lines = eligible.map((e) =>
        JSON.stringify({
          prompt: e.prompt,
          completion: e.completion,
          type: e.exampleType,
          quality: Math.round(e.qualityScore * 1000) / 1000,
          synthetic: e.isSynthetic,
        })
      );
      const body = lines.length > 0 ? lines.join('\n') + '\n' : '';

      const safeName = `${dv.dataset.slug || dv.dataset.name}`.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 48);
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="wedjat-${safeName}-v${dv.version}.jsonl"`,
          'X-Example-Count': String(eligible.length),
          'X-Dataset-Checksum': dv.checksum.slice(0, 16),
        },
      });
    } catch (err) {
      return failFrom(err);
    }
  });
}
