"use client";

// Ingestion pipeline stage chips:
// DISCOVERED→VALIDATED→NORMALIZED→CLASSIFIED→VERSIONED→SECTIONED→CHUNKED→
// ENRICHED→DEDUPLICATED→QUALITY_SCORED→EMBEDDED→INDEXED→READY_FOR_RAG
// with per-stage status colors derived from the event stream.

import { cn } from "@/lib/utils";
import type { IngestionEventDto } from "@/lib/wedjat/types";

export const INGESTION_STAGES = [
  "DISCOVERED",
  "VALIDATED",
  "NORMALIZED",
  "CLASSIFIED",
  "VERSIONED",
  "SECTIONED",
  "CHUNKED",
  "ENRICHED",
  "DEDUPLICATED",
  "QUALITY_SCORED",
  "EMBEDDED",
  "INDEXED",
  "READY_FOR_RAG",
] as const;

type StageState = "done" | "running" | "failed" | "skipped" | "pending";

function stageState(status: string): StageState {
  const s = status.toUpperCase();
  if (["COMPLETED", "OK", "READY", "DONE", "SUCCESS"].includes(s))
    return "done";
  if (["RUNNING", "IN_PROGRESS", "ACTIVE"].includes(s)) return "running";
  if (["FAILED", "ERROR"].includes(s)) return "failed";
  if (["SKIPPED", "SKIPPED_DUPLICATE"].includes(s)) return "skipped";
  return "pending";
}

const STATE_CLASSES: Record<StageState, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  running:
    "wedjat-pulse border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  failed: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  skipped: "border-border bg-muted text-muted-foreground",
  pending: "border-dashed border-border text-muted-foreground/60",
};

/** Latest event per stage → chip state. */
export function stageStatesFromEvents(
  events: IngestionEventDto[],
): Map<string, StageState> {
  const map = new Map<string, StageState>();
  for (const e of events) {
    map.set(e.stage, stageState(e.status));
  }
  return map;
}

export function StageChips({
  events,
  className,
}: {
  events: IngestionEventDto[];
  className?: string;
}) {
  const states = stageStatesFromEvents(events);
  return (
    <div
      role="list"
      aria-label="Ingestion pipeline stages"
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {INGESTION_STAGES.map((stage, i) => {
        const state = states.get(stage) ?? "pending";
        return (
          <span key={stage} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ›
              </span>
            ) : null}
            <span
              role="listitem"
              aria-label={`${stage}: ${state}`}
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                STATE_CLASSES[state],
              )}
            >
              {stage}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function StageEventList({
  events,
  maxItems = 12,
  className,
}: {
  events: IngestionEventDto[];
  maxItems?: number;
  className?: string;
}) {
  if (events.length === 0) return null;
  const sorted = [...events].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return (
    <ul className={cn("space-y-1.5", className)}>
      {sorted.slice(0, maxItems).map((e) => {
        const state = stageState(e.status);
        return (
          <li
            key={e.id}
            className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                  STATE_CLASSES[state],
                )}
              >
                {e.stage}
              </span>
              {e.documentTitle ? (
                <span className="ml-2 truncate text-muted-foreground">
                  {e.documentTitle}
                </span>
              ) : null}
              {e.detail ? (
                <p className="mt-1 break-words text-muted-foreground">
                  {e.detail}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {e.latencyMs}ms ·{" "}
              {new Date(e.createdAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
