"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake Engine (§106–§160) — small presentational building blocks
// shared across the intake tabs. Palette mirrors the shared status-badge
// system (emerald/amber/teal/slate — NO indigo/blue).
//
// Contains the LOCAL IntakeStageChips + event list (stages differ from the
// document-ingestion pipeline, so the shared pipeline-stages.tsx is not
// touched) and the §160 pipeline narrative console.
// ═══════════════════════════════════════════════════════════════════════════

import {
  TriangleAlert,
  Terminal,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { scoreColor } from "@/components/wedjat/shared/score-bar";
import { cn } from "@/lib/utils";
import type { IntakeStageEvent } from "@/lib/wedjat/types";
import { INTAKE_STAGES } from "@/components/wedjat/intake/intake-helpers";

// ── tone classes (kept local — intake-specific statuses) ──────────────────

const GREEN =
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400";
const AMBER =
  "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-400";
const ORANGE =
  "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-400";
const RED =
  "border-red-500/30 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400";
const TEAL =
  "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-400";
const SLATE = "border-border bg-muted text-muted-foreground";
const MUTED = "border-border bg-muted/60 text-muted-foreground/80";

function toneBadge(
  cls: string,
  label: string,
  opts?: { pulse?: boolean; title?: string; className?: string },
) {
  return (
    <Badge
      variant="outline"
      title={opts?.title}
      className={cn(cls, opts?.pulse && "wedjat-pulse", opts?.className)}
    >
      {label}
    </Badge>
  );
}

// ── import status (§153 source status column) ─────────────────────────────

const IMPORT_STATUS: Record<string, { cls: string; pulse?: boolean }> = {
  IMPORTED: { cls: GREEN },
  PROCESSING: { cls: AMBER, pulse: true },
  RAW: { cls: AMBER, pulse: true },
  STAGED: { cls: AMBER, pulse: true },
  ANALYZED: { cls: AMBER, pulse: true },
  MAPPED: { cls: AMBER, pulse: true },
  VALIDATED: { cls: AMBER, pulse: true },
  FAILED: { cls: RED },
  UPLOADED: { cls: SLATE },
  AWAITING_REVIEW: { cls: AMBER },
  SUPERSEDED: { cls: MUTED },
};

export function ImportStatusBadge({ status }: { status: string }) {
  const tone = IMPORT_STATUS[status] ?? { cls: SLATE };
  return toneBadge(tone.cls, status, { pulse: tone.pulse });
}

// ── mapping confidence / decision (§111–§113) ─────────────────────────────

export function ConfidenceLabelBadge({ label }: { label: string }) {
  switch (label) {
    case "HIGH_CONFIDENCE":
      return toneBadge(GREEN, "HIGH", { title: "High confidence" });
    case "MEDIUM_CONFIDENCE":
      return toneBadge(AMBER, "MEDIUM", { title: "Medium confidence" });
    case "LOW_CONFIDENCE":
      return toneBadge(ORANGE, "LOW", { title: "Low confidence" });
    default:
      return toneBadge(SLATE, label, { title: "Unresolved mapping" });
  }
}

export function DecisionBadge({ decision }: { decision: string }) {
  switch (decision) {
    case "AUTO_APPLIED":
      return toneBadge(TEAL, "AUTO_APPLIED", {
        title: "Applied automatically (high confidence, §113)",
      });
    case "PENDING_REVIEW":
      return toneBadge(AMBER, "PENDING_REVIEW");
    case "APPROVED":
      return toneBadge(GREEN, "APPROVED");
    case "REJECTED":
      return toneBadge(RED, "REJECTED");
    case "PRESERVED_SOURCE":
      return toneBadge(SLATE, "PRESERVED_SOURCE", {
        title: "Preserved as source structure — zero data loss (§143)",
      });
    default:
      return toneBadge(SLATE, decision);
  }
}

// ── knowledge-graph edges (§139/§140) ─────────────────────────────────────

export function KgClassificationBadge({ classification }: { classification: string }) {
  switch (classification) {
    case "EXPLICIT_SOURCE_FACT":
      return toneBadge(GREEN, "FACT", {
        title: "Explicit source fact — stated in the source database",
      });
    case "HIGH_CONFIDENCE_INFERENCE":
      return toneBadge(TEAL, "HIGH INFER", { title: "High-confidence inference" });
    case "MEDIUM_CONFIDENCE_INFERENCE":
      return toneBadge(AMBER, "MED INFER", { title: "Medium-confidence inference" });
    case "LOW_CONFIDENCE_INFERENCE":
      return toneBadge(SLATE, "LOW INFER", { title: "Low-confidence inference" });
    default:
      return toneBadge(SLATE, classification);
  }
}

// ── training candidates (§125/§126) ───────────────────────────────────────

export function CandidateStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "TRAINING_CANDIDATE":
      return toneBadge(AMBER, "TRAINING_CANDIDATE");
    case "TRAINING_APPROVED":
      return toneBadge(GREEN, "TRAINING_APPROVED");
    case "TRAINING_REJECTED":
      return toneBadge(RED, "TRAINING_REJECTED");
    case "QUARANTINED":
      return toneBadge(SLATE, "QUARANTINED");
    default:
      return toneBadge(SLATE, status);
  }
}

// ── learning improvement priorities (§156) ────────────────────────────────

export function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case "P0":
      return toneBadge(RED, "P0", { title: "Critical" });
    case "P1":
      return toneBadge(ORANGE, "P1", { title: "High" });
    case "P2":
      return toneBadge(AMBER, "P2", { title: "Medium" });
    case "P3":
      return toneBadge(SLATE, "P3", { title: "Low" });
    default:
      return toneBadge(SLATE, priority);
  }
}

// ── validation checks (§115) ──────────────────────────────────────────────

export function CheckStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PASS":
      return toneBadge(GREEN, "PASS");
    case "WARN":
      return toneBadge(AMBER, "WARN");
    case "FAIL":
      return toneBadge(RED, "FAIL");
    default:
      return toneBadge(SLATE, status);
  }
}

// ── drift change kinds (§142) ─────────────────────────────────────────────

export function DriftKindBadge({ kind }: { kind: string }) {
  switch (kind) {
    case "ADDED":
      return toneBadge(GREEN, "ADDED");
    case "REMOVED":
      return toneBadge(RED, "REMOVED");
    case "MODIFIED":
      return toneBadge(AMBER, "MODIFIED");
    case "RENAMED":
      return toneBadge(TEAL, "RENAMED");
    case "DEPRECATED":
      return toneBadge(SLATE, "DEPRECATED");
    default:
      return toneBadge(SLATE, kind);
  }
}

// ── duplicates (§141) ─────────────────────────────────────────────────────

export function DuplicateStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "DUPLICATE":
      return toneBadge(RED, "DUPLICATE");
    case "POSSIBLE_DUPLICATE":
      return toneBadge(AMBER, "POSSIBLE_DUPLICATE");
    case "RELATED":
      return toneBadge(TEAL, "RELATED");
    default:
      return toneBadge(SLATE, status);
  }
}

// ── 0..100 mini meter (dqScore, confidence, pass rates) ───────────────────

export function MiniBar({
  pct,
  label,
  className,
}: {
  pct: number | null | undefined;
  label?: string;
  className?: string;
}) {
  const v =
    typeof pct === "number" && Number.isFinite(pct)
      ? Math.min(100, Math.max(0, pct))
      : null;
  return (
    <div className={cn("flex min-w-16 items-center gap-2", className)}>
      <div
        role="meter"
        aria-label={`${label ?? "score"}: ${v === null ? "not available" : `${Math.round(v)}%`}`}
        aria-valuenow={v === null ? undefined : Math.round(v)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            v === null ? "bg-muted" : scoreColor(v / 100),
          )}
          style={{ width: v === null ? "0%" : `${Math.round(v)}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {v === null ? "—" : `${Math.round(v)}`}
      </span>
    </div>
  );
}

// ── error / warning count chips (§153 columns) ────────────────────────────

export function IssueChips({
  errors,
  warnings,
}: {
  errors: string[];
  warnings: string[];
}) {
  if (errors.length === 0 && warnings.length === 0) {
    return <span className="text-xs text-muted-foreground/70">—</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {errors.length > 0 ? (
        <Badge
          variant="outline"
          className={cn(RED, "gap-1 text-[10px]")}
          title={errors.join("\n")}
        >
          <XCircle aria-hidden="true" className="size-3" />
          {errors.length} err
        </Badge>
      ) : null}
      {warnings.length > 0 ? (
        <Badge
          variant="outline"
          className={cn(AMBER, "gap-1 text-[10px]")}
          title={warnings.join("\n")}
        >
          <TriangleAlert aria-hidden="true" className="size-3" />
          {warnings.length} warn
        </Badge>
      ) : null}
    </span>
  );
}

// ── staging stage chips (§114) — LOCAL, shared file untouched ─────────────

type IntakeStageState = "done" | "running" | "warn" | "failed" | "pending";

const STAGE_STATE_CLASSES: Record<IntakeStageState, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  running:
    "wedjat-pulse border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  pending: "border-dashed border-border text-muted-foreground/60",
};

function eventStageState(status: IntakeStageEvent["status"]): IntakeStageState {
  switch (status) {
    case "OK":
      return "done";
    case "WARN":
      return "warn";
    case "RUNNING":
      return "running";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * RAW→STAGED→ANALYZED→MAPPED→VALIDATED→IMPORTED chips with per-stage status
 * derived from the run's stageEvents (preferred) and/or the run status
 * (index-based fallback used by the sources table rows).
 */
export function IntakeStageChips({
  status,
  events,
  className,
}: {
  status?: string;
  events?: IntakeStageEvent[];
  className?: string;
}) {
  const states = new Map<string, IntakeStageState>();
  for (const e of events ?? []) {
    states.set(e.stage, eventStageState(e.status));
  }

  const runStatus = status ?? "";
  const cur = INTAKE_STAGES.findIndex((s) => s === runStatus);
  if (cur >= 0) {
    const complete = runStatus === "IMPORTED";
    INTAKE_STAGES.forEach((stage, i) => {
      const existing = states.get(stage);
      if (existing) {
        if (i === cur && existing === "pending") states.set(stage, "running");
        return;
      }
      if (complete || i < cur) states.set(stage, "done");
      else if (i === cur) states.set(stage, "running");
      else states.set(stage, "pending");
    });
  }

  const terminal = runStatus === "FAILED" || runStatus === "CANCELLED";

  return (
    <div
      role="list"
      aria-label={`Intake staging stages${status ? `, run status ${status}` : ""}`}
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {INTAKE_STAGES.map((stage, i) => {
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
                STAGE_STATE_CLASSES[state],
              )}
            >
              {stage}
            </span>
          </span>
        );
      })}
      {terminal ? <StatusBadge status={runStatus} pulse={false} /> : null}
    </div>
  );
}

/** Stage event feed for one run (§114) — newest first, scrollable. */
export function IntakeStageEventList({
  events,
  maxItems = 24,
  className,
}: {
  events: IntakeStageEvent[];
  maxItems?: number;
  className?: string;
}) {
  if (events.length === 0) return null;
  const sorted = [...events].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  return (
    <ul
      className={cn(
        "wedjat-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1",
        className,
      )}
    >
      {sorted.slice(0, maxItems).map((e, i) => (
        <li
          key={`${e.stage}-${e.at}-${i}`}
          className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
        >
          <div className="min-w-0">
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                STAGE_STATE_CLASSES[eventStageState(e.status)],
              )}
            >
              {e.stage}
            </span>
            <p className="mt-1 break-words text-muted-foreground">{e.detail}</p>
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {e.latencyMs}ms ·{" "}
            {new Date(e.at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── §160 pipeline narrative console — the signature feature ───────────────

export function PipelineNarrative({
  narrative,
  icon: Icon = Terminal,
  heading = "WEDJAT pipeline",
}: {
  narrative: string[];
  icon?: LucideIcon;
  heading?: string;
}) {
  if (narrative.length === 0) return null;
  return (
    <Card className="overflow-hidden rounded-xl">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Icon aria-hidden="true" className="size-4 text-primary" />
          <p className="text-sm font-semibold tracking-tight">{heading}</p>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            §160 narrative
          </span>
        </div>
        <div
          aria-label="Pipeline narrative"
          className="wedjat-scroll max-h-96 overflow-y-auto bg-slate-950 p-4 font-mono text-xs leading-6 text-emerald-200/90"
        >
          {narrative.map((line, i) => (
            <p
              key={i}
              className="flex gap-2.5 border-l-2 border-emerald-500/70 py-0.5 pl-3"
            >
              <span className="shrink-0 tabular-nums text-emerald-500/60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 break-words">{line}</span>
            </p>
          ))}
          <p
            aria-hidden="true"
            className="wedjat-pulse mt-1 border-l-2 border-transparent pl-3 text-emerald-400"
          >
            ▊
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
