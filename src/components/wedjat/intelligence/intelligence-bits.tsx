"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence Fabric (v4 §1–§127) — presentational building blocks shared
// across the intelligence tabs. Palette mirrors the shared status-badge
// system (emerald/amber/teal/slate/red — NO indigo/blue).
//
// Includes the ONE-TIME API key reveal dialog (contract §1: the key is shown
// exactly once after create/rotate — never logged, never toasted).
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  BookCheck,
  Check,
  CircleAlert,
  Copy,
  Cpu,
  Database,
  FileJson,
  FlaskConical,
  Gauge,
  KeyRound,
  Layers,
  Lightbulb,
  Lock,
  PencilLine,
  RefreshCw,
  Settings2,
  Shield,
  TrendingUp,
  TriangleAlert,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { copyText, safeJsonStringify } from "@/components/wedjat/intelligence/intelligence-helpers";
import type { ServiceIdentityCreatedDto, TimelineEntryDto } from "@/lib/wedjat/types";

// ── tone classes (local — intelligence-specific statuses) ───────────────────

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

// ── event envelope badges (contract §13/§14) ────────────────────────────────

/** CRITICAL red · HIGH amber · NORMAL slate · LOW muted. */
export function CriticalityBadge({ criticality }: { criticality: string }) {
  switch (criticality) {
    case "CRITICAL":
      return toneBadge(RED, criticality, { pulse: true, title: "Critical event" });
    case "HIGH":
      return toneBadge(AMBER, criticality);
    case "NORMAL":
      return toneBadge(SLATE, criticality);
    case "LOW":
      return toneBadge(MUTED, criticality);
    default:
      return toneBadge(SLATE, criticality);
  }
}

/** PROCESSED emerald · RECEIVED slate · FAILED amber · DEAD red · SKIPPED muted. */
export function EventStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PROCESSED":
      return toneBadge(GREEN, status);
    case "RECEIVED":
      return toneBadge(SLATE, status, { pulse: true, title: "Queued for dispatch" });
    case "FAILED":
      return toneBadge(AMBER, status);
    case "DEAD":
      return toneBadge(RED, status);
    case "SKIPPED":
      return toneBadge(MUTED, status);
    default:
      return toneBadge(SLATE, status);
  }
}

/** Platform identity status (contract §7–§10). */
export function IdentityStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ACTIVE":
      return toneBadge(GREEN, status);
    case "REVOKED":
      return toneBadge(RED, status);
    default:
      return toneBadge(SLATE, status);
  }
}

/** Registry connection badge (contract §88). null → "UNKNOWN". */
export function ConnectionBadge({ status }: { status: string | null }) {
  const label = status ?? "UNKNOWN";
  switch (status) {
    case "CONNECTED":
      return toneBadge(GREEN, label);
    case "DISCOVERED":
      return toneBadge(AMBER, label, { title: "Known platform, coordinates not yet registered" });
    case "DISCONNECTED":
      return toneBadge(SLATE, label, { title: "Disconnected — knowledge is preserved" });
    case "RETIRED":
      return toneBadge(MUTED, label);
    default:
      return toneBadge(MUTED, label);
  }
}

// ── recommendation badges (contract §42–§44) ────────────────────────────────

/** P0 red · P1 amber · P2 neutral · P3 slate. */
export function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case "P0":
      return toneBadge(RED, priority, { title: "Critical" });
    case "P1":
      return toneBadge(AMBER, priority, { title: "High" });
    case "P2":
      return toneBadge(SLATE, priority, { title: "Medium" });
    case "P3":
      return toneBadge(MUTED, priority, { title: "Low" });
    default:
      return toneBadge(SLATE, priority);
  }
}

/** Recommendation lifecycle pill (local map — shared OPEN≠circuit-open). */
export function RecoStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ACCEPTED":
    case "IMPLEMENTED":
    case "VALIDATED":
      return toneBadge(GREEN, status);
    case "OPEN":
      return toneBadge(AMBER, status, { title: "Awaiting decision" });
    case "PARTIALLY_IMPLEMENTED":
    case "REVERTED":
      return toneBadge(ORANGE, status);
    case "REJECTED":
    case "FAILED":
      return toneBadge(RED, status);
    default:
      return toneBadge(SLATE, status);
  }
}

/** Pattern status pill. */
export function PatternStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "CONFIRMED":
    case "ACTIVE":
      return toneBadge(GREEN, status);
    case "PROPOSED":
    case "CANDIDATE":
      return toneBadge(AMBER, status);
    case "RETIRED":
      return toneBadge(MUTED, status);
    default:
      return toneBadge(SLATE, status);
  }
}

// ── scope / method chips (API console, identities) ──────────────────────────

export function ScopeChip({ scope, title }: { scope: string; title?: string }) {
  const cls = scope.endsWith(":read")
    ? TEAL
    : scope.endsWith(":write") || scope.endsWith(":candidate")
      ? AMBER
      : scope === "admin"
        ? RED
        : SLATE;
  return toneBadge(cls, scope, { title, className: "font-mono text-[10px]" });
}

export function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  return toneBadge(m === "GET" ? TEAL : AMBER, m, { className: "font-mono" });
}

// ── key preview (identities table) ──────────────────────────────────────────

export function KeyPreview({ preview }: { preview: string }) {
  return (
    <code
      className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      title="Only a hash of the key is stored — the raw key was shown once at issue time"
    >
      {preview}
    </code>
  );
}

// ── copy button + JSON console block ────────────────────────────────────────

export function CopyButton({
  text,
  label,
  ariaLabel,
  className,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast.success("Copied to clipboard");
    } else {
      toast.error("Copy failed", {
        description: "Select the text and copy it manually.",
      });
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-8 shrink-0 gap-1.5", className)}
      onClick={copy}
      aria-label={ariaLabel ?? label ?? "Copy to clipboard"}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </Button>
  );
}

/** Dark console-style pretty JSON block (event results, payloads). */
export function JsonBlock({
  value,
  label,
  className,
}: {
  value: unknown;
  label?: string;
  className?: string;
}) {
  const text = safeJsonStringify(value);
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
      <pre
        aria-label={label ?? "JSON payload"}
        className="wedjat-scroll max-h-96 overflow-y-auto rounded-lg border border-border bg-slate-950 p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-emerald-200/90"
      >
        {text}
      </pre>
    </div>
  );
}

// ── shared chrome bits ──────────────────────────────────────────────────────

/** LIVE poll indicator (intake convention). */
export function LivePollBadge({ seconds }: { seconds: number }) {
  return (
    <Badge
      variant="outline"
      className="wedjat-pulse border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
    >
      LIVE · {seconds}s
    </Badge>
  );
}

/** Refresh button with spinner (intake convention). */
export function RefreshButton({
  onClick,
  loading,
  ariaLabel,
}: {
  onClick: () => void;
  loading?: boolean;
  ariaLabel: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <RefreshCw
        aria-hidden="true"
        className={loading ? "size-3.5 animate-spin" : "size-3.5"}
      />
      Refresh
    </Button>
  );
}

/** Read-only note for roles below the mutation gate. */
export function ReadOnlyNote({ minRole }: { minRole: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock aria-hidden="true" className="size-3" />
      Read-only for your role — {minRole}+ required to make changes here.
    </p>
  );
}

/** Minimal role gate chip shown next to gated action groups. */
export function RoleGateChip({ minRole }: { minRole: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(AMBER, "text-[10px]")}
      title={`Requires ${minRole} or above`}
    >
      {minRole}+
    </Badge>
  );
}

// ── memory timeline icon map (contract §107–§112) ───────────────────────────

const TIMELINE_KINDS: Record<
  TimelineEntryDto["kind"],
  { icon: LucideIcon; cls: string; label: string }
> = {
  KNOWLEDGE_ADDED: { icon: BookCheck, cls: GREEN, label: "knowledge" },
  EVENT: { icon: Webhook, cls: TEAL, label: "event" },
  CORRECTION: { icon: PencilLine, cls: AMBER, label: "correction" },
  RECOMMENDATION: { icon: Lightbulb, cls: AMBER, label: "recommendation" },
  OUTCOME: { icon: TrendingUp, cls: GREEN, label: "outcome" },
  MODEL: { icon: Cpu, cls: TEAL, label: "model" },
  SOURCE: { icon: Database, cls: SLATE, label: "source" },
  GAP: { icon: CircleAlert, cls: ORANGE, label: "gap" },
};

export function TimelineKindIcon({ kind }: { kind: TimelineEntryDto["kind"] }) {
  const meta = TIMELINE_KINDS[kind] ?? { icon: Layers, cls: SLATE, label: kind };
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border",
        meta.cls,
      )}
      title={kind}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

// ── pattern type icon map ───────────────────────────────────────────────────

/** Static icon map (module-level lookup — never created during render). */
const PATTERN_TYPE_ICONS: Record<string, LucideIcon> = {
  ARCHITECTURE: Layers,
  ARCHITECTURAL: Layers,
  STRUCTURE: Layers,
  STRUCTURAL: Layers,
  FAILURE: TriangleAlert,
  INCIDENT: TriangleAlert,
  OUTAGE: TriangleAlert,
  RISK: TriangleAlert,
  SECURITY: Shield,
  POLICY: Shield,
  GOVERNANCE: Shield,
  PERFORMANCE: Gauge,
  LATENCY: Gauge,
  DATA: Database,
  SCHEMA: Database,
  MODEL: Cpu,
  TRAINING: Cpu,
  PROCESS: Settings2,
  OPERATIONAL: Settings2,
  EXPERIMENT: FlaskConical,
  TEST: FlaskConical,
};

/** Icon for a pattern type — unknown types fall back to the lightbulb. */
export function PatternTypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const Icon =
    PATTERN_TYPE_ICONS[type.toUpperCase().replace(/[^A-Z]/g, "_")] ?? Lightbulb;
  return <Icon aria-hidden="true" className={className} />;
}

// ── ONE-TIME API key reveal dialog (contract §1 identities) ─────────────────

/**
 * Distinct dialog that reveals a freshly issued service key exactly once.
 * The key is NEVER logged and NEVER surfaced in a toast — only in this box,
 * with a copy button and an explicit "will not be shown again" warning.
 */
export function KeyRevealDialog({
  issued,
  onClose,
}: {
  issued: ServiceIdentityCreatedDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={issued !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="size-4 text-primary" />
            Service API key issued
          </DialogTitle>
          <DialogDescription>
            {issued
              ? `Key for "${issued.name}" on platform ${issued.platformSlug}. Use it as the Authorization: Bearer header on /api/v1/* endpoints.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-amber-500/40 bg-amber-500/10">
          <TriangleAlert aria-hidden="true" className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-amber-800 dark:text-amber-300">
            This key will not be shown again
          </AlertTitle>
          <AlertDescription className="text-amber-800/90 dark:text-amber-300/90">
            Only a hash is stored server-side. Store the key in your secret
            manager now — closing this dialog discards it from the UI.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            API key (shown only once)
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-950 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-emerald-200/90">
              {issued?.apiKey ?? ""}
            </code>
            {issued ? <CopyButton text={issued.apiKey} ariaLabel="Copy API key" /> : null}
          </div>
          {issued?.scopes?.length ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Scopes
              </span>
              {issued.scopes.map((s) => (
                <ScopeChip key={s} scope={s} />
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            <Check aria-hidden="true" className="size-4" />
            I have stored it securely
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── JSON payload expander chip (event detail dialog) ────────────────────────

export function JsonPayloadChip({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <FileJson aria-hidden="true" className="size-3.5" />
      {count} field{count === 1 ? "" : "s"}
    </span>
  );
}

/** DLQ / failure icon row marker. */
export function DeadLetterMarker() {
  return (
    <Ban aria-hidden="true" className="size-3.5 shrink-0 text-red-600 dark:text-red-400" />
  );
}
