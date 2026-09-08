"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake Engine (§106–§160) — pure helpers shared by the intake UI.
//
// Role gates, formatting, active-run detection and the local multipart
// upload wrapper (apiPost only sends JSON, so /api/intake/upload needs a
// FormData-specific client that unwraps the same {ok,data|error} envelope).
// ═══════════════════════════════════════════════════════════════════════════

import { ApiError } from "@/lib/wedjat/client";
import type { ApiResponse, IntakeUploadResult } from "@/lib/wedjat/types";

/** Upload/reprocess/review require CURATOR or above (§ contract). */
export const INTAKE_MUTATION_ROLES = new Set(["OWNER", "ADMIN", "CURATOR"]);

/** Autonomy level changes require ADMIN or above (§151). */
export const INTAKE_AUTONOMY_ROLES = new Set(["OWNER", "ADMIN"]);

/** Learning health check requires ADMIN or above (§156). */
export const INTAKE_HEALTH_ROLES = new Set(["OWNER", "ADMIN"]);

/** Run statuses considered "active" — the list/detail poll 3s while any exist. */
export const ACTIVE_INTAKE_RUN_STATUSES = new Set([
  "RAW",
  "STAGED",
  "ANALYZED",
  "MAPPED",
  "VALIDATED",
]);

/** Canonical staging pipeline (§114). */
export const INTAKE_STAGES = [
  "RAW",
  "STAGED",
  "ANALYZED",
  "MAPPED",
  "VALIDATED",
  "IMPORTED",
] as const;

/** Client-side upload guard — 25 MB (§59 untrusted upload limits). */
export const MAX_INTAKE_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Human-readable byte size: B / KB / MB / GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Locale-formatted integer (records, tables, counts). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/**
 * Normalizes a 0..1-ish metric: accepts 0..1 or 0..100 scales and clamps.
 * Used for confidence/quality values whose scale may differ per producer.
 */
export function toRatio(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const v = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, v));
}

/** "1.2s" / "840ms" style duration label from two ISO strings. */
export function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string | null {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const ms = end - start;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * POST /api/intake/upload — multipart FormData.
 * Unwraps the standard {ok,data}|{ok,error} envelope exactly like the
 * shared client does (including tolerance for non-envelope responses
 * while the backend is being built in parallel).
 */
export async function uploadIntakeFile(
  file: File,
  platform?: string,
  name?: string,
): Promise<IntakeUploadResult> {
  const body = new FormData();
  body.append("file", file);
  if (platform && platform.trim()) body.append("platform", platform.trim());
  if (name && name.trim()) body.append("name", name.trim());

  let res: Response;
  try {
    res = await fetch("/api/intake/upload", { method: "POST", body });
  } catch {
    throw new ApiError(
      "NETWORK",
      "Network error — the WEDJAT API could not be reached.",
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (payload !== null && typeof payload === "object" && "ok" in payload) {
    const envelope = payload as ApiResponse<IntakeUploadResult>;
    if (envelope.ok) return envelope.data;
    const error = (
      payload as { error?: { code?: string; message?: string } }
    ).error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "The upload failed without an error message.",
      res.status,
    );
  }

  throw new ApiError(
    "UNAVAILABLE",
    `Unexpected API response (HTTP ${res.status}) — this endpoint may not be implemented yet.`,
    res.status,
  );
}
