import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Prisma client via the libSQL driver adapter.
//
// WHY: one code path for every environment (see docs/DEPLOYMENT.md):
//   • TURSO_DATABASE_URL + TURSO_AUTH_TOKEN → remote Turso (Vercel / live)
//   • DATABASE_URL (file:…)                 → local SQLite file (dev / sandbox)
//
// LAZY PROXY (serverless hardening): the client is created on FIRST ACCESS,
// not at import time. `next build` evaluates route module scopes during
// "Collecting page data" — eager instantiation there threw "Database
// misconfigured" on Vercel before env vars were baked (builds must never
// depend on runtime credentials). The proxy defers adapterConfig() until the
// first actual query, which only happens in a warm runtime.
//
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

function createDb(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaLibSQL(adapterConfig()),
    log: ['error', 'warn'],
  })
}

// Serverless-friendly cache: module scope persists across warm invocations of
// the same lambda instance (previously only cached in development).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function resolveDb(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createDb()
  return globalForPrisma.prisma
}

// Transparent lazy proxy: any property access (db.organization, db.$transaction,
// db.$disconnect, …) materializes the real client first. Function members are
// bound so destructuring/standalone invocation keeps the correct `this`.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = resolveDb()
    const value = Reflect.get(client, prop)
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
  has(_target, prop) {
    return prop in resolveDb()
  },
})
