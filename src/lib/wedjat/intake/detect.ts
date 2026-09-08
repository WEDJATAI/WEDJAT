// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Database intake: source format auto-detection (§106, §107).
//
// The user never declares the format. Detection combines magic bytes, structural
// sniffing and dialect heuristics, and returns a confidence-scored verdict the
// pipeline records as evidence.
// ═══════════════════════════════════════════════════════════════════════════════

import { WedjatError } from '../errors';

export type DetectedFormat =
  | 'SQLITE'
  | 'SQLITE_DUMP'
  | 'POSTGRESQL'
  | 'MYSQL'
  | 'MARIADB'
  | 'SQLSERVER'
  | 'CSV'
  | 'JSON'
  | 'JSONL'
  | 'UNKNOWN';

export interface DetectionResult {
  format: DetectedFormat;
  method: string;
  confidence: number; // 0..1
  detail: string;
  isBinary: boolean;
}

const SQLITE_MAGIC = 'SQLite format 3\0';

export function detectFormat(bytes: Uint8Array): DetectionResult {
  // ── Magic bytes: real SQLite database file ────────────────────────────────
  const header = new TextDecoder('latin1').decode(bytes.slice(0, 16));
  if (header === SQLITE_MAGIC) {
    return {
      format: 'SQLITE',
      method: 'magic-bytes',
      confidence: 0.99,
      detail: 'SQLite database file header "SQLite format 3" detected (live schema + data readable).',
      isBinary: true,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new WedjatError(
      'VALIDATION',
      'Gzip archives are not supported yet — please extract the database/dump first'
    );
  }

  // ── Text formats ───────────────────────────────────────────────────────────
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 2_000_000));
  } catch {
    return {
      format: 'UNKNOWN',
      method: 'binary-sniff',
      confidence: 0.1,
      detail: 'File is binary and does not match any known database format.',
      isBinary: true,
    };
  }
  const trimmed = text.trim();

  // JSON / JSONL
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed.slice(0, 1_000_000));
      return {
        format: 'JSON',
        method: 'json-parse',
        confidence: 0.97,
        detail: 'Parses as a single JSON document.',
        isBinary: false,
      };
    } catch {
      // fall through to JSONL below
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 1 && lines.slice(0, 50).every((l) => l.trim().startsWith('{'))) {
    const parsed = lines.slice(0, 20).filter((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
    if (parsed.length >= Math.min(5, lines.length)) {
      return {
        format: 'JSONL',
        method: 'line-parse',
        confidence: 0.95,
        detail: `JSON Lines: ${parsed.length}/${Math.min(20, lines.length)} sampled lines parse as JSON objects.`,
        isBinary: false,
      };
    }
  }

  // SQL dump (dialect-tolerant)
  if (/CREATE\s+(TABLE|INDEX|VIEW)/i.test(text) || /INSERT\s+INTO/i.test(text)) {
    const dialect = detectSqlDialect(text);
    return {
      format: dialect.format,
      method: 'ddl-sniff',
      confidence: dialect.confidence,
      detail: `SQL dump: ${dialect.reason}`,
      isBinary: false,
    };
  }

  // CSV / delimited
  const csv = detectDelimited(lines);
  if (csv) return csv;

  return {
    format: 'UNKNOWN',
    method: 'exhaustive-sniff',
    confidence: 0.05,
    detail: 'No database structure recognized (not SQLite, SQL DDL, JSON/JSONL or CSV).',
    isBinary: false,
  };
}

function detectSqlDialect(text: string): { format: DetectedFormat; confidence: number; reason: string } {
  if (/ENGINE\s*=\s*InnoDB/i.test(text)) {
    const isMaria = /mariadb/i.test(text);
    return {
      format: isMaria ? 'MARIADB' : 'MYSQL',
      confidence: isMaria ? 0.95 : 0.92,
      reason: `MySQL/MariaDB DDL (ENGINE=InnoDB${isMaria ? ', MariaDB banner' : ''}).`,
    };
  }
  if (/mariadb/i.test(text)) return { format: 'MARIADB', confidence: 0.9, reason: 'MariaDB dump banner.' };
  if (/\[\w+\]|\bIDENTITY\s*\(|^GO\b/im.test(text)) {
    return { format: 'SQLSERVER', confidence: 0.9, reason: 'SQL Server DDL (bracketed identifiers / IDENTITY / GO batch separator).' };
  }
  if (/AUTOINCREMENT|PRAGMA|sqlite3?/i.test(text)) {
    return { format: 'SQLITE_DUMP', confidence: 0.9, reason: 'SQLite dump (AUTOINCREMENT / PRAGMA markers).' };
  }
  if (/::\w+|SERIAL|CREATE EXTENSION|ON CONFLICT|uuid_generate|NOT NULL DEFAULT/i.test(text)) {
    return { format: 'POSTGRESQL', confidence: 0.9, reason: 'PostgreSQL DDL (casts/SERIAL/extension markers).' };
  }
  return { format: 'POSTGRESQL', confidence: 0.55, reason: 'Generic SQL DDL — defaulting to PostgreSQL-tolerant parsing.' };
}

function detectDelimited(lines: string[]): DetectionResult | null {
  if (lines.length < 2) return null;
  const first = lines[0];
  for (const sep of [',', '\t', ';', '|']) {
    const cols = splitCsvLine(first, sep);
    if (cols.length < 2) continue;
    const second = splitCsvLine(lines[1], sep);
    if (second.length === cols.length && cols.some((c) => c.trim().length > 0)) {
      const consistent = lines
        .slice(1, 8)
        .every((l) => splitCsvLine(l, sep).length === cols.length);
      if (consistent) {
        const sepName = sep === '\t' ? 'tab' : sep === ',' ? 'comma' : `'${sep}'`;
        return {
          format: 'CSV',
          method: 'delimiter-sniff',
          confidence: 0.9,
          detail: `Delimited text: ${sepName}-separated, ${cols.length} columns, header + ${lines.length - 1} rows.`,
          isBinary: false,
        };
      }
    }
  }
  return null;
}

/** Minimal RFC-4180-style splitter for detection + CSV parsing. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
