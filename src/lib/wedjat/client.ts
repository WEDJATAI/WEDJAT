"use client";

// ═══════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — typed HTTP client for the WEDJAT API.
//
// Every response is enveloped: { ok: true, data } | { ok: false, error }.
// `api`/`apiPost` unwrap the envelope and throw a typed ApiError otherwise.
// A module-level UNAUTHORIZED handler lets the app bounce back to the login
// view whenever any request comes back 401.
// ═══════════════════════════════════════════════════════════════════════════

import type { ApiResponse } from "@/lib/wedjat/types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

function notifyUnauthorized() {
  unauthorizedHandler?.();
}

// ── Bearer token persistence (embedded-context fallback) ──────────────────────
// The HttpOnly session cookie is the primary transport. In cross-site preview
// iframes browsers block those cookies, so the login response mirrors the
// session token; we persist it here and echo it as `Authorization: Bearer`.
// The server still resolves the principal from the token — never trusted.

const TOKEN_KEY = "wedjat.token";

export function setAuthToken(token: string | null) {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — cookie path still applies */
  }
}

export function getAuthToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function bearerHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...bearerHeaders(),
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "Network error — the WEDJAT API could not be reached.",
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (body !== null && typeof body === "object" && "ok" in body) {
    const envelope = body as ApiResponse<T>;
    if (envelope.ok) {
      return envelope.data;
    }
    const error = (body as { error?: { code?: string; message?: string } })
      .error;
    const code = error?.code ?? "INTERNAL";
    if (code === "UNAUTHORIZED") {
      setAuthToken(null);
      notifyUnauthorized();
    }
    throw new ApiError(
      code,
      error?.message ?? "The request failed without an error message.",
      res.status,
    );
  }

  // Non-envelope payload — endpoint missing (backend being built in parallel),
  // gateway 5xx HTML, etc.
  if (res.status === 401) {
    setAuthToken(null);
    notifyUnauthorized();
    throw new ApiError("UNAUTHORIZED", "Session expired or missing.", 401);
  }
  throw new ApiError(
    "UNAVAILABLE",
    `Unexpected API response (HTTP ${res.status}) — this endpoint may not be implemented yet.`,
    res.status,
  );
}

/** GET (or other verb via init) — unwraps the `{ok,data}` envelope. */
export function api<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init);
}

/** POST JSON — unwraps the `{ok,data}` envelope. */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Human-readable message for any thrown error. */
export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error.";
}

/** Short, human label for a timestamp (ISO string or null → "never"). */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
