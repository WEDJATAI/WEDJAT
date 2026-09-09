import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Prisma client via the libSQL driver adapter.
//
// WHY: one code path for every environment (see docs/DEPLOYMENT.md):
//   • TURSO_DATABASE_URL + TURSO_AUTH_TOKEN → remote Turso (Vercel / live)
//   • DATABASE_URL (file:…)                 → local SQLite file (dev / sandbox)
// The HttpOnly session cookie + Bearer token auth is unchanged; org scoping
// stays enforced server-side. Query logging stays off: raw prisma logs would
// bypass the structured logger's redaction (§56).
// ═══════════════════════════════════════════════════════════════════════════════

function adapterConfig(): { url: string; authToken?: string } {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  if (tursoUrl) {
    const authToken = process.env.TURSO_AUTH_TOKEN
    if (!authToken) {
      throw new Error('TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is missing')
    }
    return { url: tursoUrl, authToken }
  }
  const fileUrl = process.env.DATABASE_URL
  if (!fileUrl || !fileUrl.startsWith('file:')) {
    throw new Error(
      'Database misconfigured: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (remote) or ' +
        'DATABASE_URL=file:<path> (local).'
    )
  }
  return { url: fileUrl }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaLibSQL(adapterConfig()),
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
