// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Structured logger with centralized secret redaction (§55, §56).
//
// WHY: developers must never have to remember to redact — patterns that look like
// keys/tokens/JWTs/credentials are masked at the single log funnel. Proprietary
// content is truncated, never dumped wholesale (§56 "do not log proprietary
// content unnecessarily").
// ═══════════════════════════════════════════════════════════════════════════════

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACTION_PATTERNS: { re: RegExp; replacement: string }[] = [
  { re: /\b(sk-|pk-|pk_)[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED_KEY]' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, replacement: '[REDACTED_JWT]' },
  { re: /\b(?:api[_-]?key|apikey|token|secret|password|authorization)\s*[:=]\s*["']?[^"'\s,}]{6,}/gi, replacement: '$1=[REDACTED]' },
  { re: /\bbearer\s+[A-Za-z0-9._-]{10,}/gi, replacement: 'Bearer [REDACTED]' },
  { re: /libsql:\/\/[^\s"']+/g, replacement: '[REDACTED_DB_URL]' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED_TOKEN]' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
];

function redact(value: string): string {
  let out = value;
  for (const { re, replacement } of REDACTION_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** Deep redaction of structured payloads. */
function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') {
    const r = redact(value);
    // Truncate long text (queries/chunks) so logs never dump proprietary corpora.
    return r.length > 400 ? `${r.slice(0, 400)}…[truncated ${r.length} chars]` : r;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = /token|secret|key|password|credential|authorization/i.test(k)
        ? `${k}:REDACTED`
        : k;
      out[key] = /token|secret|password|credential|authorization/i.test(k) ? '[REDACTED]' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = process.env.WEDJAT_LOG_LEVEL === 'debug' ? 'debug' : 'info';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redact(msg),
    ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
