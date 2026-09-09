// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 — Secret detection + redaction (§41, §96).
//
// Applied to event payloads and any externally submitted content BEFORE storage,
// embedding, indexing, remote AI transmission or training (§41 pipeline). Every
// detection is replaced with [SECRET_REDACTED]; the count is returned so callers
// can audit/quarantine. Redaction is deterministic — identical inputs redact
// identically (idempotent ingestion stays idempotent).
// ═══════════════════════════════════════════════════════════════════════════════

// Prefixed provider tokens: OpenAI sk-, GitHub ghp_/gho_/ghu_/ghs_, Vercel vcp_,
// Slack xox*, GitLab glpat-, Google AIza, Anthropic sk-ant-, Groq gsk_,
// Stripe sk_live_/pk_live_, AWS AKIA…, Turso-style libsql tokens (eyJ… long JWT).
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bgsk_[A-Za-z0-9]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bvcp_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\bwj_[a-z0-9]{2,8}_[A-Za-z0-9]{20,}\b/g, // WEDJAT service keys themselves
];

// Key/value JSON shapes: "password": "...", "api_key": "...", "token": "..."
const SECRET_FIELD = /("(?:password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credentials?|bearer)"\s*:\s*")([^"]{6,})(")/gi;

// PEM blocks and Authorization headers.
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const AUTH_HEADER = /\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
// libsql/turso URLs with an embedded token query parameter.
const URL_TOKEN = /\b(libsql|https?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'?]+[?&](?:token|auth|password|apikey)=([A-Za-z0-9._~+/=-]{12,})/gi;

export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

/** Detects and redacts secret material in arbitrary text (§41). */
export function redactSecrets(text: string): RedactionResult {
  let count = 0;
  const kinds = new Set<string>();
  let out = text;

  for (const re of TOKEN_PATTERNS) {
    out = out.replace(re, () => {
      count += 1;
      kinds.add('token');
      return '[SECRET_REDACTED]';
    });
  }
  out = out.replace(SECRET_FIELD, (_m, prefix: string, _value: string, suffix: string) => {
    count += 1;
    kinds.add('credential-field');
    return `${prefix}[SECRET_REDACTED]${suffix}`;
  });
  out = out.replace(PEM_BLOCK, () => {
    count += 1;
    kinds.add('private-key');
    return '[SECRET_REDACTED]';
  });
  out = out.replace(AUTH_HEADER, (m) => {
    count += 1;
    kinds.add('auth-header');
    return m.split(/\s+/).slice(0, 2).join(' ') + ' [SECRET_REDACTED]';
  });
  out = out.replace(URL_TOKEN, (m) => {
    count += 1;
    kinds.add('url-credential');
    return m.replace(/[?&](?:token|auth|password|apikey)=[A-Za-z0-9._~+/=-]+/, (q) => q.split('=')[0] + '=[SECRET_REDACTED]');
  });

  return { text: out, count, kinds: [...kinds] };
}

/** True when secret material is detected (pre-redaction scan, e.g. gating). */
export function containsSecrets(text: string): boolean {
  return redactSecrets(text).count > 0;
}
