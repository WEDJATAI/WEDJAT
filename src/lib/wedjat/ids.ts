// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — identifiers and hashing (§26, §30).
// ULID-style monotonic ids for traceability; SHA-256 for source hashing,
// duplicate detection, integrity verification and artifact checksums.
// ═══════════════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Monotonic, sortable ULID-style id (cuid is used by Prisma; this is for traces). */
export function newTraceId(): string {
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ULID_ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(10);
  let randomPart = '';
  for (let i = 0; i < 10; i++) {
    randomPart += ULID_ALPHABET[random[i] % 32];
  }
  return `trc_${timePart}${randomPart}`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hex digest — the integrity/dedupe primitive (§30). */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Content-hash used for duplicate/near-duplicate detection. Normalizes whitespace. */
export function contentHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  return sha256(normalized);
}

/** Constant-time secret comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Short display form for checksums. */
export function shortChecksum(hash: string): string {
  return hash.slice(0, 12);
}
