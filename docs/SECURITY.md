# WEDJAT DOMAIN AI — Security

This document describes the security posture of the implementation: server-side authentication
and role/tenant gates (§53), secrets handling and redaction (§54/§55), prompt-injection defense
and its instruction hierarchy (§16), ingestion security (§59), the data-sharing policy engine
(§17/§66), output validation (§81), and the known limitations of this demo environment. Code:
`src/lib/wedjat/security/{auth,policy,injection}.ts`, `src/lib/wedjat/logger.ts`,
`src/lib/wedjat/api.ts`.

## Server-side auth (§53)

- Sessions: HttpOnly cookie `wedjat_session` (32-byte random token, `Session` row, 12 h TTL
  `config.auth.sessionTtlHours`), set by `POST /api/auth/login`, deleted on logout. Every route
  except login/health requires it (`withPrincipal` in `src/lib/wedjat/api.ts`); 401 responses use
  the envelope `{ok:false, error:{code:'UNAUTHORIZED'}}`.
- Passwords: sha256 with a static application salt for seeded demo identities, compared with
  `timingSafeEqual`; login failures log only the first 3 chars of the email, never the attempted
  password, and return an identical error for unknown user vs. bad password.
- **Tenant scoping is always server-side**: the `Principal` (userId, role, org incl. dataPolicy)
  is resolved from the session; `orgId` used in every org-scoped query comes from the principal,
  never from client input. Blueprint resolution always goes through the platform→org relation.
  The client is never trusted with org/user/platform/blueprint ids.
- Roles: OWNER / ADMIN / CURATOR can mutate (`requireMutationRole` gates ingestion, training,
  model promotion); MEMBER / AUDITOR are read-only. 403 FORBIDDEN otherwise.

## Secrets handling (§54, §55)

- All provider keys are env-only (`GEMINI_API_KEY`, `GROQ_API_KEY`, `HF_TOKEN`,
  `WEDJAT_DEMO_PASSWORD`, `DATABASE_URL`); nothing is hard-coded. Presence is tracked only as
  booleans (`config.keys`, `providerKeyStatus()`), surfaced as booleans at
  `/api/health` and `/api/system` — key values are never logged or returned.
- **Centralized redaction** (`src/lib/wedjat/logger.ts`, §55): all log output passes through one
  funnel that masks 7 pattern families — `sk-`/`pk-`-style keys, JWTs, `api-key|token|secret|
  password|authorization: value` assignments, `Bearer …` tokens, `libsql://` URLs, GitHub
  `gh[pousr]_…` tokens, and PEM private-key blocks; object keys matching token/secret/password/
  credential/authorization are `[REDACTED]` at any depth (depth cap 4, array cap 20), and long
  strings are truncated at 400 chars so proprietary corpora are never dumped wholesale (§56).
  Audit `detailsJson` goes through the same redaction (`observability/audit.ts`).
- Startup validation (§91) prints config problems and key-presence booleans only.

## Prompt-injection defense (§16)

Enforced hierarchy: **SYSTEM POLICY > APPLICATION POLICY > TASK INSTRUCTIONS > USER REQUEST >
DATA**. Retrieved content is evidence, never authority. Concretely:

1. User queries are scanned/neutralized BEFORE retrieval (`scanAndNeutralize`, 8 patterns incl.
   ignore-previous-instructions, reveal-system-prompt, role-override, exfiltrate-secrets,
   developer-mode); matched text is replaced with `[untrusted-instruction-removed]` and the
   pattern names are returned as `blockedPatterns`.
2. Evidence blocks are fenced (`<<<EVIDENCE-Sn …>>> … <<<END-EVIDENCE-Sn>>>`) with explicit
   "untrusted data" framing in the system prompt; nested fences/code fences are defused with
   zero-width characters so content cannot break out of the fence.
3. The system prompt (`reasoning/prompts.ts` SYSTEM_POLICY) forbids revealing rules or
   system prompts and instructs the model to treat fence content as data.

## Document ingestion security (§59)

Uploads are untrusted content: 2 MB size cap and ≥ 40-char minimum (resource-exhaustion /
junk guard), NUL-byte/CRLF normalization, sensitive-data detection (api-key, jwt, private-key,
db-url, gh-token) at the VALIDATED stage — flagged (WARN) for curation rather than silently
kept, and later used as training-data gate 4 (§32). Duplicate content is detected by checksum.
Ingested content never influences control flow; it only becomes fenced evidence and indexed
data. Chunk quality below threshold 30 is EXCLUDED from retrieval.

## Data-sharing policy engine (§17, §66)

`security/policy.ts:resolveGenerationPolicy` decides per request which provider class may serve
generation: LOCAL_ONLY/BLOCK_REMOTE forbid remote providers entirely; APPROVED_REMOTE_PROVIDER
(default) and RESTRICTED_REMOTE allow remote unless any evidence classification is CONFIDENTIAL —
CONFIDENTIAL material always requires local inference (the sanctioned internal gateway).
Embedding/indexing is invariantly LOCAL_ONLY (`wedjat-local-embed-v1`), so proprietary text
never leaves the boundary to build indexes. Rate limits (30/min/user, 120/min/provider) and the
$50/day budget add backpressure (§24/§67) — see [MODEL_ROUTING.md](MODEL_ROUTING.md).

## Output validation (§81)

Model output is scanned before the user sees it (`validateOutput`): system-prompt leakage
patterns and secret patterns (`sk-…`, `ghp_…`, private keys) are replaced with
`[removed-by-output-validator]`; matches are flagged in the response (`blockedPatterns` +
`output-validation: …` flag persisted on the generation). Low groundedness (< 0.25) is flagged
`low-groundedness` — see [RAG_ARCHITECTURE.md](RAG_ARCHITECTURE.md).

## Known demo limitations (explicit)

- Demo password `wedjat` for all seeded users (override via `WEDJAT_DEMO_PASSWORD`); password
  hashing is sha256+static salt — acceptable for seeded demo identities only, not a production
  scheme.
- Single-organization seed; no per-user isolation beyond role gates within that org.
- Rate buckets, budget accounting, circuit state, provider-health windows and IDF cache are
  in-process memory — a restart resets them (DB persistence covers `ProviderHealth`, jobs, audit).
- No TLS/secret-manager integration is in scope of this environment; remote provider keys are
  optional and unset by default (all remote adapters STANDBY).
