import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging disabled: WEDJAT uses structured logging (see lib/wedjat/logger)
// which redacts secrets and truncates proprietary content — raw prisma query
// logs would bypass that (§56).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db