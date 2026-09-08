// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Startup instrumentation (§91).
//
// WHY: Next.js instrumentation runs once at server start. We use it to:
// 1. validate configuration (no secret VALUES printed — booleans only),
// 2. start the durable job worker,
// 3. lazily warm the retrieval corpus stats (IDF cache) on first request.
// ═══════════════════════════════════════════════════════════════════════════════

export async function register(): Promise<void> {
  // Only run in the Node.js server runtime (not edge / build).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { logger } = await import('@/lib/wedjat/logger');
  const { validateStartupConfig, providerKeyStatus } = await import('@/lib/wedjat/config');

  const { ok, problems } = validateStartupConfig();
  if (!ok) {
    logger.error('startup_config_invalid', { problems });
  } else {
    logger.info('startup_config_valid', {
      database: true,
      // Boolean key presence ONLY — never the values.
      providerKeys: providerKeyStatus(),
    });
  }

  const { startJobWorker } = await import('@/lib/wedjat/observability/jobs');
  startJobWorker();

  const { db } = await import('@/lib/db');
  try {
    await db.$queryRaw`SELECT 1`;
    logger.info('startup_db_reachable', {});
  } catch (err) {
    logger.error('startup_db_unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('wedjat_domain_ai_started', { version: '1.0.0', env: process.env.NODE_ENV });
}
