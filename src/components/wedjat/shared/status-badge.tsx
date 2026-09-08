"use client";

// Maps platform/blueprint/run/model statuses to colored Badge variants.
// Palette: emerald (healthy/done) · amber (in-flight/warn) · red (failed) ·
// slate/zinc (neutral/terminal-neutral) · teal (curator flavor).

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "green" | "amber" | "red" | "slate" | "teal";

const TONE_CLASSES: Record<Tone, string> = {
  green:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400",
  amber:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-400",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400",
  slate: "border-border bg-muted text-muted-foreground",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-400",
};

const STATUS_TONES: Record<string, Tone> = {
  // healthy / final-good
  CURRENT: "green",
  APPROVED: "green",
  PRODUCTION: "green",
  COMPLETED: "green",
  CLOSED: "green",
  PASSED: "green",
  CORRECT: "green",
  OK: "green",
  HEALTHY: "green",
  READY: "green",
  READY_FOR_RAG: "green",
  INDEXED: "green",
  HIGH_VALUE: "green",
  ACTIVE: "green",
  RISK_DECREASED: "green",
  ADDED: "green",
  // in-flight / caution
  CANARY: "amber",
  CANDIDATE: "amber",
  DRAFT: "slate",
  REVIEW: "amber",
  RUNNING: "amber",
  RETRYING: "amber",
  VALIDATING: "amber",
  TRAINING: "amber",
  EVALUATING: "amber",
  PENDING: "amber",
  HALF_OPEN: "amber",
  DEGRADED: "amber",
  MEDIUM: "amber",
  MODIFIED: "amber",
  PARTIALLY_CORRECT: "amber",
  OUTDATED: "amber",
  ARCHITECTURE_CHANGED: "amber",
  DEPRECATED: "slate",
  DEPENDENCY_CHANGED: "teal",
  ROLLED_BACK: "amber",
  // failures
  FAILED: "red",
  OPEN: "red",
  INCORRECT: "red",
  UNSUPPORTED: "red",
  HALLUCINATION: "red",
  LOW_VALUE: "slate",
  CRITICAL: "red",
  HIGH: "red",
  REJECTED: "red",
  ERROR: "red",
  RISK_INCREASED: "red",
  REMOVED: "red",
  BLOCKED: "red",
  // neutral
  SUPERSEDED: "slate",
  HISTORICAL: "slate",
  CANCELLED: "slate",
  QUEUED: "slate",
  LOW: "slate",
  LOCKED: "slate",
  AUTO: "slate",
  EXPLICIT: "teal",
  UNRESOLVED: "amber",
};

const PULSING = new Set([
  "RUNNING",
  "RETRYING",
  "OPEN",
  "TRAINING",
  "EVALUATING",
  "VALIDATING",
  "QUEUED",
]);

function statusTone(status: string): Tone {
  return STATUS_TONES[status.toUpperCase()] ?? "slate";
}

export function StatusBadge({
  status,
  className,
  pulse,
}: {
  status: string;
  className?: string;
  pulse?: boolean;
}) {
  const tone = statusTone(status);
  const shouldPulse = pulse ?? PULSING.has(status.toUpperCase());
  return (
    <Badge
      variant="outline"
      className={cn(
        TONE_CLASSES[tone],
        shouldPulse && "wedjat-pulse",
        className,
      )}
    >
      {status}
    </Badge>
  );
}

const ROLE_TONES: Record<string, Tone> = {
  OWNER: "amber",
  ADMIN: "green",
  CURATOR: "teal",
  MEMBER: "slate",
  AUDITOR: "slate",
};

export function RoleBadge({
  role,
  className,
}: {
  role: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(TONE_CLASSES[ROLE_TONES[role] ?? "slate"], className)}
    >
      {role}
    </Badge>
  );
}

// ── feedback labels (shared by Chat + Training views) ──

export const FEEDBACK_LABELS = [
  "CORRECT",
  "PARTIALLY_CORRECT",
  "INCORRECT",
  "UNSUPPORTED",
  "HALLUCINATION",
  "OUTDATED",
  "HIGH_VALUE",
  "LOW_VALUE",
] as const;

export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];

const FEEDBACK_TONES: Record<string, Tone> = {
  CORRECT: "green",
  HIGH_VALUE: "green",
  PARTIALLY_CORRECT: "amber",
  OUTDATED: "amber",
  INCORRECT: "red",
  UNSUPPORTED: "red",
  HALLUCINATION: "red",
  LOW_VALUE: "slate",
};

export function FeedbackLabelBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className={TONE_CLASSES[FEEDBACK_TONES[label] ?? "slate"]}
    >
      {label}
    </Badge>
  );
}
