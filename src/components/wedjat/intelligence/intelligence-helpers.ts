"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence Fabric (v4 §1–§127) — pure helpers shared by the intelligence
// tabs: role gates, formatting, fabric query building, clipboard support and
// the static /api/v1 endpoint reference (contract §2).
// ═══════════════════════════════════════════════════════════════════════════

import type {
  EventFabricPayload,
  FabricAdminPayload,
} from "@/lib/wedjat/types";

/** Identity create/rotate/revoke, event replay, DLQ resolve, registry
 *  connect/disconnect and recommendation generation (ADMIN+, contract §1). */
export const FABRIC_ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);

/** Recommendation lifecycle transitions and outcome recording (CURATOR+). */
export const FABRIC_CURATOR_ROLES = new Set(["OWNER", "ADMIN", "CURATOR"]);

/** Event fabric poll cadence — ~8s, in the 5–10s band like the intake live lists. */
export const FABRIC_POLL_MS = 8000;

// ── recommendations ─────────────────────────────────────────────────────────

/** Lifecycle statuses accepted by POST /api/fabric/recommendations/[id]/lifecycle. */
export const RECO_LIFECYCLE_STATUSES = [
  "ACCEPTED",
  "REJECTED",
  "IMPLEMENTED",
  "PARTIALLY_IMPLEMENTED",
  "FAILED",
  "REVERTED",
  "VALIDATED",
] as const;

export type RecoLifecycleStatus = (typeof RECO_LIFECYCLE_STATUSES)[number];

export const RECO_LIFECYCLE_HELP: Record<RecoLifecycleStatus, string> = {
  ACCEPTED: "The recommendation is agreed and queued for implementation.",
  REJECTED: "The recommendation is declined — record the reason in the note.",
  IMPLEMENTED: "Fully implemented in the platform.",
  PARTIALLY_IMPLEMENTED: "Implemented in part — note what remains.",
  FAILED: "Implementation was attempted and failed.",
  REVERTED: "Implementation was rolled back.",
  VALIDATED: "Post-implementation verification passed.",
};

/** Status options for the recommendations filter (contract §1 ?status=). */
export const RECO_STATUS_FILTERS: string[] = [
  "ALL",
  "OPEN",
  ...RECO_LIFECYCLE_STATUSES,
];

/** Scope descriptions for the identity create dialog + API console. */
export const SCOPE_HELP: Record<string, string> = {
  "knowledge:write": "Submit knowledge via POST /api/v1/knowledge",
  "knowledge:read": "Query knowledge via GET /api/v1/knowledge",
  "events:write": "Submit events, incidents and outcomes",
  "events:read": "Read the event fabric",
  "schema:write": "Submit database schemas via POST /api/v1/schemas",
  "feedback:write": "Submit feedback via POST /api/v1/feedback",
  "analysis:read": "Run query / analyze / insights",
  "recommendations:read": "Read platform recommendations",
  "training:candidate": "Submit learning candidates",
  admin: "Full fabric administration (grant sparingly)",
};

// ── event fabric filters (contract §1: ?platform=&type=&status=&deadletter=) ─

export interface FabricFilters {
  platform: string;
  type: string;
  status: string;
  deadOnly: boolean;
}

export const DEFAULT_FABRIC_FILTERS: FabricFilters = {
  platform: "ALL",
  type: "ALL",
  status: "ALL",
  deadOnly: false,
};

export const EVENT_STATUS_FILTERS: string[] = [
  "ALL",
  "RECEIVED",
  "PROCESSED",
  "SKIPPED",
  "FAILED",
  "DEAD",
];

/** Filter state → query string for GET /api/fabric. */
export function fabricQuery(f: FabricFilters): string {
  const params = new URLSearchParams();
  if (f.platform !== "ALL") params.set("platform", f.platform);
  if (f.type !== "ALL") params.set("type", f.type);
  if (f.status !== "ALL") params.set("status", f.status);
  if (f.deadOnly) params.set("deadletter", "1");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** True when any filter deviates from the default (drives "Reset"). */
export function filtersActive(f: FabricFilters): boolean {
  return (
    f.platform !== "ALL" ||
    f.type !== "ALL" ||
    f.status !== "ALL" ||
    f.deadOnly
  );
}

// ── apiExamples (contract §2: GET /api/fabric → apiExamples) ────────────────

/** Example row published by the backend for the API Console tab. */
export type ApiExample = FabricAdminPayload["apiExamples"][number];

/**
 * GET /api/fabric payload with the optional `apiExamples` field the API
 * Console reads (§2). Additive accommodation: EventFabricPayload does not
 * declare it, but the contract sources the console examples from this
 * endpoint — treated as optional so both backend shapes are tolerated.
 */
export interface FabricConsolePayload extends EventFabricPayload {
  apiExamples?: ApiExample[];
}

/** Static read-only endpoint reference (public platform API, contract §2). */
export const V1_ENDPOINTS: {
  method: "GET" | "POST";
  path: string;
  scope: string;
  description: string;
}[] = [
  { method: "POST", path: "/api/v1/events", scope: "events:write", description: "Submit an event envelope (idempotency-key honored; duplicates → DUPLICATE)." },
  { method: "POST", path: "/api/v1/knowledge", scope: "knowledge:write", description: "Submit knowledge — ingestion job + document version created." },
  { method: "POST", path: "/api/v1/schemas", scope: "schema:write", description: "Submit a database schema snapshot for a platform." },
  { method: "POST", path: "/api/v1/feedback", scope: "feedback:write", description: "Submit question/answer feedback or a correction." },
  { method: "POST", path: "/api/v1/learning-candidates", scope: "training:candidate", description: "Submit a training candidate with evidence." },
  { method: "POST", path: "/api/v1/incidents", scope: "events:write", description: "Report an incident for a platform." },
  { method: "POST", path: "/api/v1/outcomes", scope: "events:write", description: "Report an outcome (optionally for a recommendation)." },
  { method: "GET", path: "/api/v1/knowledge?platform=&q=", scope: "knowledge:read", description: "Query knowledge for a platform." },
  { method: "GET", path: "/api/v1/platforms/[slug]/insights", scope: "analysis:read", description: "CTO-style platform summary." },
  { method: "GET", path: "/api/v1/platforms/[slug]/recommendations", scope: "recommendations:read", description: "Recommendations for one platform." },
  { method: "POST", path: "/api/v1/query", scope: "analysis:read", description: "Grounded query (ASK | HISTORICAL | AUDIT mode)." },
  { method: "POST", path: "/api/v1/analyze", scope: "analysis:read", description: "Focused platform analysis." },
  { method: "GET", path: "/api/v1/health", scope: "public", description: "Liveness / readiness summary — no auth." },
];

/** Sample body for a public endpoint (client-side reference snippets). */
function sampleBodyFor(path: string): string {
  if (path.startsWith("/api/v1/events")) {
    return '{"eventType":"dep.succeeded","sourcePlatform":"sgtx","payload":{}}';
  }
  if (path.startsWith("/api/v1/knowledge")) {
    return '{"platform":"sgtx","type":"LESSON_LEARNED","title":"...","content":"..."}';
  }
  if (path.startsWith("/api/v1/schemas")) {
    return '{"platform":"sgtx","database":"primary","version":"1","tables":[]}';
  }
  if (path.startsWith("/api/v1/feedback")) {
    return '{"platform":"sgtx","question":"...","correction":"..."}';
  }
  if (path.startsWith("/api/v1/learning-candidates")) {
    return '{"platform":"sgtx","taskType":"qa","input":"...","output":"..."}';
  }
  if (path.startsWith("/api/v1/incidents")) {
    return '{"platform":"sgtx","title":"...","description":"...","severity":"HIGH"}';
  }
  if (path.startsWith("/api/v1/outcomes")) {
    return '{"platform":"sgtx","outcome":"RISK_DECREASED","metricName":"mttr"}';
  }
  if (path.startsWith("/api/v1/query")) {
    return '{"query":"...","mode":"ASK"}';
  }
  if (path.startsWith("/api/v1/analyze")) {
    return '{"platform":"sgtx","focus":"resilience"}';
  }
  return "{}";
}

/** Client-generated curl reference for a public endpoint. */
export function buildCurlExample(ex: {
  method: string;
  path: string;
}): string {
  const isGet = ex.method.toUpperCase() === "GET";
  const body = isGet
    ? ""
    : ` \\\n  --header 'Content-Type: application/json' \\\n  --data '${sampleBodyFor(ex.path)}'`;
  return `curl -X ${ex.method.toUpperCase()} 'https://<wedjat-host>${ex.path}' \\\n  --header 'Authorization: Bearer $WEDJAT_SERVICE_KEY'${body}`;
}

/** Client-generated @wedjat/sdk reference for a public endpoint. */
export function buildSdkExample(ex: {
  method: string;
  path: string;
}): string {
  const isGet = ex.method.toUpperCase() === "GET";
  const body = isGet
    ? ""
    : `, {\n    body: ${sampleBodyFor(ex.path).replace(/"/g, "'")},\n  }`;
  return `import { Wedjat } from "@wedjat/sdk";\n\nconst wedjat = new Wedjat({\n  apiKey: process.env.WEDJAT_SERVICE_KEY,\n});\n\nconst result = await wedjat.request("${ex.method.toUpperCase()}", "${ex.path}"${body});`;
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Locale-formatted integer (events, records, counts). */
export function formatCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/**
 * Normalizes a 0..1-ish metric: accepts 0..1 or 0..100 scales and clamps.
 * Confidence values may arrive on either scale depending on the producer.
 */
export function toRatio(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const v = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, v));
}

/** Compact signed percent label for outcome changePct (e.g. "+12.4%"). */
export function formatChangePct(pct: number | null): string | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Pretty JSON with a hard guard against circular/odd values. */
export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

// ── clipboard (used for API keys / snippets — never for logging) ────────────

/** Clipboard write with a legacy fallback; returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
