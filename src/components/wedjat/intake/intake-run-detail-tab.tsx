"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — Tab 2 "Run Detail" (§109–§160 deep dive for one source).
//
// Sections: source header + reprocess · §160 pipeline narrative console ·
// staging stages (§114) · validation report (§115) · data quality (§117) ·
// canonical mappings w/ review (§111–§113) · schema snapshot browser (§109) ·
// drift (§142) · duplicates (§141) · preserved fields (§143) · KG edges
// (§139/§140) · training candidates (§125/§126).
// ═══════════════════════════════════════════════════════════════════════════

import { Fragment, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  LoaderCircle,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import {
  CandidateStatusBadge,
  CheckStatusBadge,
  ConfidenceLabelBadge,
  DecisionBadge,
  DriftKindBadge,
  DuplicateStatusBadge,
  ImportStatusBadge,
  IntakeStageChips,
  IntakeStageEventList,
  IssueChips,
  KgClassificationBadge,
  MiniBar,
  PipelineNarrative,
} from "@/components/wedjat/intake/intake-bits";
import {
  INTAKE_MUTATION_ROLES,
  formatBytes,
  formatCount,
  formatDuration,
  toRatio,
} from "@/components/wedjat/intake/intake-helpers";
import type { UseApiDataResult } from "@/hooks/use-api-data";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  IntakeCandidateDto,
  IntakeDetailPayload,
  IntakeDqReport,
  IntakeImportReport,
  IntakeMappingDto,
  IntakeRunDto,
  IntakeSnapshotDto,
  IntakeTableDto,
} from "@/lib/wedjat/types";

// ───────────────────────────────────────────────────────────────────────────
// Contract accommodation (additive only): the §115 import report and §117 DQ
// report DTOs exist in the contract but are not (yet) fields of
// IntakeDetailPayload. We type them as optional extras — present → rendered,
// absent → the sections degrade to compact "not reported" notes.
// ───────────────────────────────────────────────────────────────────────────
export type IntakeDetail = IntakeDetailPayload & {
  importReport?: IntakeImportReport | null;
  dqReport?: IntakeDqReport | null;
};

const MAX_SNAPSHOT_TABLES = 60;

const GREEN_TXT = "text-emerald-700 dark:text-emerald-400";
const RED_TXT = "text-red-700 dark:text-red-400";

interface ReviewBody {
  mappingId?: string;
  candidateId?: string;
  decision: "APPROVE" | "REJECT";
  note?: string;
}

/** Collapsible card section with eyebrow + title + description. */
function DetailSection({
  eyebrow,
  title,
  description,
  defaultOpen = true,
  open,
  onOpenChange,
  children,
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  id?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
  return (
    <Card id={id} className="rounded-xl">
      <Collapsible open={isOpen} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <h3 className="mt-0.5 truncate text-sm font-semibold tracking-tight">
              {title}
            </h3>
            {description ? (
              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                {description}
              </p>
            ) : null}
          </div>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 transition-transform",
                  isOpen ? "" : "-rotate-90",
                )}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CardContent className="p-4">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Chip({
  children,
  mono,
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <Badge
      variant="secondary"
      title={title}
      className={cn(
        "max-w-full truncate text-[10px]",
        mono && "font-mono font-normal",
      )}
    >
      {children}
    </Badge>
  );
}

// ── §111–§113 mappings ─────────────────────────────────────────────────────

function EvidenceList({
  evidence,
}: {
  evidence: IntakeMappingDto["evidence"];
}) {
  if (evidence.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {evidence.map((e, i) => (
        <li
          key={`${e.kind}-${i}`}
          className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
        >
          <div className="min-w-0">
            <Chip mono title={e.kind}>
              {e.kind}
            </Chip>
            <p className="mt-1 break-words text-muted-foreground">{e.detail}</p>
          </div>
          <span className="flex w-24 shrink-0 items-center gap-2">
            <MiniBar
              pct={(toRatio(e.weight) ?? 0) * 100}
              label={`${e.kind} weight`}
              className="w-16"
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ColumnMappingsTable({
  columns,
}: {
  columns: IntakeMappingDto["columnMappings"];
}) {
  if (columns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No column mappings.</p>
    );
  }
  return (
    <div className="wedjat-scroll overflow-x-auto">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Source column → canonical field</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map((c) => (
            <TableRow key={`${c.sourceColumn}-${c.canonicalField}`}>
              <TableCell>
                <span className="font-mono text-xs">{c.sourceColumn}</span>
                <span aria-hidden="true" className="mx-1.5 text-muted-foreground">
                  →
                </span>
                <span className="font-mono text-xs font-medium text-primary">
                  {c.canonicalField}
                </span>
                {c.notes ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {c.notes}
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <Chip mono>
                  {c.rule} v{c.ruleVersion}
                </Chip>
              </TableCell>
              <TableCell>
                <MiniBar
                  pct={(toRatio(c.confidence) ?? 0) * 100}
                  label="Column mapping confidence"
                  className="w-24"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── §109 snapshot browser ───────────────────────────────────────────────────

function ColumnsTable({ table }: { table: IntakeTableDto }) {
  if (table.columns.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No column metadata.</p>
    );
  }
  return (
    <div className="wedjat-scroll overflow-x-auto">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Column</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Enum values</TableHead>
            <TableHead>Null %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.columns.map((col) => {
            const nullPct =
              col.nullPct === undefined
                ? null
                : Math.round((toRatio(col.nullPct) ?? 0) * 100);
            return (
              <TableRow key={col.name}>
                <TableCell className="font-mono text-xs">{col.name}</TableCell>
                <TableCell>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {col.rawType}
                  </span>
                  {col.normalizedType !== col.rawType ? (
                    <span className="ml-1.5 font-mono text-[10px] text-primary">
                      → {col.normalizedType}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-56">
                  <p className="truncate text-xs text-muted-foreground" title={col.purpose}>
                    {col.purpose}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    {col.isPrimaryKey ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 px-1 text-[9px] text-emerald-700 dark:text-emerald-400"
                      >
                        PK
                      </Badge>
                    ) : null}
                    {col.isForeignKey ? (
                      <Badge
                        variant="outline"
                        className="border-teal-500/30 bg-teal-500/10 px-1 text-[9px] text-teal-700 dark:text-teal-400"
                      >
                        FK
                      </Badge>
                    ) : null}
                    {col.nullable ? (
                      <Badge variant="outline" className="px-1 text-[9px] text-muted-foreground">
                        NULL
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-64">
                  {col.enumValues && col.enumValues.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {col.enumValues.slice(0, 6).map((v) => (
                        <Chip key={v} mono>
                          {v}
                        </Chip>
                      ))}
                      {col.enumValues.length > 6 ? (
                        <span className="text-[10px] text-muted-foreground">
                          +{col.enumValues.length - 6}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {nullPct === null ? "—" : `${nullPct}%`}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SnapshotBrowser({
  snapshot,
}: {
  snapshot: IntakeSnapshotDto | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tables = snapshot?.tables ?? [];
  const visible = tables.slice(0, MAX_SNAPSHOT_TABLES);
  const truncated =
    snapshot?.tablesTruncated === true || tables.length > visible.length;

  const toggle = (name: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (!snapshot) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <p>
          engine: <span className="font-mono text-foreground">{snapshot.engine}</span>
        </p>
        <p>
          detection:{" "}
          <span className="font-mono text-foreground">
            {snapshot.detection.method} (
            {Math.round((toRatio(snapshot.detection.confidence) ?? 0) * 100)}%)
          </span>
        </p>
        <p>
          snapshot v<span className="font-mono text-foreground">{snapshot.version}</span>{" "}
          · {formatCount(snapshot.tablesCount)} tables ·{" "}
          {formatCount(snapshot.columnsCount)} columns
        </p>
      </div>
      {snapshot.detection.detail ? (
        <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          {snapshot.detection.detail}
        </p>
      ) : null}

      <div className="wedjat-scroll overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" aria-label="Expand" />
              <TableHead>Table</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Canonical entity</TableHead>
              <TableHead>Primary key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((t) => {
              const isOpen = expanded.has(t.name);
              return (
                <Fragment key={t.name}>
                  <TableRow
                    className={cn(
                      "cursor-pointer",
                      isOpen && "border-b-0 bg-muted/30 hover:bg-muted/30",
                    )}
                    onClick={() => toggle(t.name)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} columns of ${t.name}`}
                        className="flex size-6 items-center justify-center rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(t.name);
                        }}
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform",
                            isOpen && "rotate-90",
                          )}
                        />
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">
                      {t.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {formatCount(t.rowCount)}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-xs text-muted-foreground" title={t.purpose}>
                        {t.purpose}
                      </p>
                    </TableCell>
                    <TableCell>
                      {t.canonicalEntity ? (
                        <Badge
                          variant="outline"
                          className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                        >
                          {t.canonicalEntity}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/70">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip mono>{t.primaryKey.join(", ") || "—"}</Chip>
                    </TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/30 p-4">
                        <ColumnsTable table={t} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {MAX_SNAPSHOT_TABLES} of{" "}
          {formatCount(snapshot.tablesCount)} tables — the snapshot is truncated
          for display; full metadata is preserved in the store.
        </p>
      ) : null}
    </div>
  );
}

// ── §125/§126 training candidates ──────────────────────────────────────────

function CandidateCard({
  candidate,
  canReview,
  busy,
  onReview,
}: {
  candidate: IntakeCandidateDto;
  canReview: boolean;
  busy: boolean;
  onReview: (body: ReviewBody, label: string) => void;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip mono title="candidate kind">
            {candidate.kind}
          </Chip>
          <CandidateStatusBadge status={candidate.status} />
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {formatWhen(candidate.createdAt)}
          </span>
        </div>

        <p className="border-l-2 border-primary/40 pl-3 text-sm leading-relaxed">
          {candidate.prompt}
        </p>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group h-8 gap-1 px-2 text-xs text-muted-foreground"
              aria-label="Toggle candidate completion"
            >
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              />
              Show completion
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="wedjat-scroll max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
              {candidate.completion}
            </pre>
          </CollapsibleContent>
        </Collapsible>

        <ScoreBar
          label="Quality"
          value={toRatio(candidate.qualityScore)}
        />

        <div className="flex flex-wrap gap-1.5" aria-label="Training gates">
          {candidate.gates.map((g) => (
            <span
              key={g.name}
              title={g.detail}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                g.passed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
              )}
            >
              {g.passed ? "✓" : "✗"} {g.name}
            </span>
          ))}
        </div>

        <p
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={candidate.lineage}
        >
          lineage: {candidate.lineage}
        </p>

        {canReview && candidate.status === "TRAINING_CANDIDATE" ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() =>
                onReview(
                  { candidateId: candidate.id, decision: "APPROVE" },
                  `Candidate ${candidate.id.slice(0, 8)}…`,
                )
              }
            >
              <ThumbsUp className="size-3.5" aria-hidden="true" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              disabled={busy}
              onClick={() =>
                onReview(
                  { candidateId: candidate.id, decision: "REJECT" },
                  `Candidate ${candidate.id.slice(0, 8)}…`,
                )
              }
            >
              <ThumbsDown className="size-3.5" aria-hidden="true" />
              Reject
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── main tab component ──────────────────────────────────────────────────────

export function IntakeRunDetailTab({
  role,
  selectedId,
  detail,
  onListRefresh,
}: {
  role: string;
  selectedId: string | null;
  detail: UseApiDataResult<IntakeDetail>;
  onListRefresh: () => void;
}) {
  const canMutate = INTAKE_MUTATION_ROLES.has(role);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [expandedMappings, setExpandedMappings] = useState<Set<string>>(
    new Set(),
  );
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const data = detail.data;

  if (selectedId === null) {
    return (
      <EmptyState
        icon={MousePointerClick}
        title="Select a source"
        hint="Choose a database source from the Sources tab to inspect its staging pipeline, canonical mappings, extracted knowledge and training candidates."
      />
    );
  }

  if (detail.error && !data) {
    return <ErrorState message={detail.error} onRetry={detail.refresh} />;
  }

  if (detail.loading && !data) {
    return <SkeletonRows rows={5} />;
  }

  if (!data) return null;

  // Null-safe: while the backend lands in parallel a stub/partial detail
  // payload must degrade to an error state, never crash the page.
  if (!data.source) {
    return (
      <ErrorState
        message="The intake detail payload is missing its source record — this endpoint may still be implementing the contract."
        onRetry={detail.refresh}
      />
    );
  }

  const { source, snapshot } = data;
  const runs = data.runs ?? [];
  const mappings = data.mappings ?? [];
  const preserved = data.preserved ?? [];
  const kgEdges = data.kgEdges ?? [];
  const candidates = data.candidates ?? [];
  const narrative = data.narrative ?? [];

  const sortedRuns = [...runs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const selectedRun: IntakeRunDto | undefined =
    sortedRuns.find((r) => r.id === selectedRunId) ?? sortedRuns[0];

  const importReport = data.importReport ?? null;
  const dqReport = data.dqReport ?? null;
  const dqScore = dqReport?.score ?? source.dqScore;
  const drift = data.drift ?? null;
  const duplicates = data.duplicates ?? [];

  // ── mutations ──

  const reprocess = async () => {
    if (!source.id || reprocessing) return;
    setReprocessing(true);
    try {
      const res = await apiPost<{ runId: string; jobId: string }>(
        `/api/intake/${encodeURIComponent(source.id)}/reprocess`,
      );
      toast.success("Reprocess queued (§145)", {
        description: `New staging run ${res.runId.slice(0, 8)}… enqueued (job ${res.jobId.slice(0, 8)}…). Stage updates stream in automatically.`,
      });
      setSelectedRunId(null);
      detail.refresh();
      onListRefresh();
    } catch (e) {
      toast.error("Reprocess failed", { description: errMessage(e) });
    } finally {
      setReprocessing(false);
    }
  };

  const postReview = async (body: ReviewBody, label: string) => {
    if (reviewBusy) return;
    setReviewBusy(body.mappingId ?? body.candidateId ?? "");
    try {
      await apiPost<unknown>("/api/intake/review", body);
      toast.success(
        body.decision === "APPROVE" ? "Approved" : "Rejected",
        {
          description: `${label} — ${body.decision === "APPROVE" ? "the mapping/candidate moves forward" : "the mapping/candidate is withdrawn"}. Zero data loss guarantees apply (§143).`,
        },
      );
      detail.refresh();
      onListRefresh();
    } catch (e) {
      toast.error("Review failed", { description: errMessage(e) });
    } finally {
      setReviewBusy(null);
    }
  };

  const toggleMapping = (id: string) => {
    setExpandedMappings((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* 1 — source header */}
      <Card className="rounded-xl">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">
              {source.name}
            </h3>
            <ImportStatusBadge status={source.status} />
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {source.versionLabel}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {source.engine}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">
              sha {source.checksum}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatBytes(source.byteSize)}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              uploaded {formatWhen(source.createdAt)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              platform: {source.platform}
            </Badge>
            <IssueChips errors={source.errors} warnings={source.warnings} />
            <div className="ml-auto flex flex-wrap gap-2">
              {canMutate ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11"
                      disabled={reprocessing}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={cn(
                          "size-3.5",
                          reprocessing && "animate-spin",
                        )}
                      />
                      Reprocess
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Reprocess {source.name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        A fresh staging run (RAW → STAGED → ANALYZED → MAPPED →
                        VALIDATED → IMPORTED) will re-analyze the stored
                        snapshot under the current autonomy level and engine
                        version (§145). Existing approvals are preserved — only
                        new mappings enter the review queue.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void reprocess()}>
                        Start reprocess
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-11"
                aria-expanded={snapshotOpen}
                onClick={() => setSnapshotOpen((v) => !v)}
              >
                <Database className="size-3.5" aria-hidden="true" />
                {snapshotOpen ? "Close raw snapshot" : "Open raw snapshot"}
              </Button>
            </div>
          </div>
          {canMutate ? null : (
            <p className="text-xs text-muted-foreground">
              Read-only: reprocess and review actions require CURATOR, OWNER or
              ADMIN role.
            </p>
          )}
        </CardContent>
      </Card>

      {/* run selector */}
      {sortedRuns.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            Staging run
          </span>
          <Select
            value={selectedRun?.id ?? "__latest"}
            onValueChange={(v) =>
              setSelectedRunId(v === "__latest" ? null : v)
            }
          >
            <SelectTrigger
              className="h-11 w-full max-w-md font-mono text-xs"
              aria-label="Select staging run"
            >
              <SelectValue placeholder="Select run" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__latest" className="text-xs">
                latest run
              </SelectItem>
              {sortedRuns.map((r) => (
                <SelectItem key={r.id} value={r.id} className="font-mono text-xs">
                  {r.id.slice(0, 8)}… · {r.trigger} · {r.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {/* 2 — §160 pipeline narrative */}
      <PipelineNarrative narrative={narrative} />

      {/* 3 — staging stages (§114) */}
      {selectedRun ? (
        <DetailSection
          eyebrow="§114 staging"
          title="Staging pipeline"
          description="RAW → STAGED → ANALYZED → MAPPED → VALIDATED → IMPORTED — per-stage status, timings and events."
        >
          <div className="space-y-4">
            <IntakeStageChips
              status={selectedRun.status}
              events={selectedRun.stageEvents}
            />
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <p>
                trigger:{" "}
                <span className="font-mono text-foreground">
                  {selectedRun.trigger}
                </span>
              </p>
              <p>
                autonomy:{" "}
                <span className="font-mono text-foreground">
                  L{selectedRun.autonomyLevel}
                </span>
              </p>
              <p>
                engine:{" "}
                <span className="font-mono text-foreground">
                  {selectedRun.engineVersion}
                </span>
              </p>
              <p>
                started:{" "}
                <span className="font-mono text-foreground">
                  {formatWhen(selectedRun.startedAt)}
                </span>
              </p>
              <p>
                finished:{" "}
                <span className="font-mono text-foreground">
                  {formatWhen(selectedRun.finishedAt)}
                </span>
              </p>
              <p>
                duration:{" "}
                <span className="font-mono text-foreground">
                  {formatDuration(selectedRun.startedAt, selectedRun.finishedAt) ??
                    "in progress"}
                </span>
              </p>
            </div>
            {selectedRun.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Run errors</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {selectedRun.errors.map((e, i) => (
                      <li key={i} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {selectedRun.warnings.length > 0 ? (
              <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-700 dark:bg-amber-400/5 dark:text-amber-400">
                <AlertTitle>Run warnings</AlertTitle>
                <AlertDescription className="text-amber-700/80 dark:text-amber-400/80">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {selectedRun.warnings.map((w, i) => (
                      <li key={i} className="break-words">
                        {w}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <IntakeStageEventList events={selectedRun.stageEvents} />
          </div>
        </DetailSection>
      ) : null}

      {/* 4 — validation report (§115) */}
      <DetailSection
        eyebrow="§115 validation"
        title="Import validation report"
        description="Pre-import checks — a blocked report stops the import cold."
        defaultOpen={false}
      >
        {importReport ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px]", "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}
              >
                {importReport.passed} passed
              </Badge>
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
              >
                {importReport.warned} warned
              </Badge>
              <Badge
                variant="outline"
                className="border-red-500/30 bg-red-500/10 text-[10px] text-red-700 dark:text-red-400"
              >
                {importReport.failed} failed
              </Badge>
              {importReport.blocked ? (
                <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-[10px] text-red-700 dark:text-red-400">
                  BLOCKED
                </Badge>
              ) : importReport.importable ? (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-400">
                  IMPORTABLE
                </Badge>
              ) : null}
            </div>
            {importReport.blocked ? (
              <Alert variant="destructive">
                <AlertTitle>Import blocked</AlertTitle>
                <AlertDescription>
                  One or more checks failed — the snapshot will not be imported
                  until they are resolved (§115).
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="wedjat-scroll overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Metric</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importReport.checks.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="text-xs font-medium">
                        {c.name}
                      </TableCell>
                      <TableCell>
                        <CheckStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="max-w-72">
                        <p className="whitespace-normal break-words text-xs text-muted-foreground">
                          {c.detail}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.metric ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Validation report not reported for this run yet — it is produced at
            the VALIDATED stage (§115).
          </p>
        )}
      </DetailSection>

      {/* 5 — data quality (§117) */}
      <DetailSection
        eyebrow="§117 data quality"
        title="Data quality report"
        description="Schema-level quality score and findings across tables, columns and values."
        defaultOpen={false}
      >
        <div className="space-y-3">
          <ScoreBar
            label="Schema quality score"
            value={toRatio(dqScore)}
          />
          {dqReport ? (
            <p className="text-xs text-muted-foreground">
              checked {formatCount(dqReport.checkedTables)} tables ·{" "}
              {formatCount(dqReport.checkedRows)} rows
            </p>
          ) : null}
          {dqReport && dqReport.findings.length > 0 ? (
            <ul className="wedjat-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {dqReport.findings.map((f, i) => (
                <li
                  key={`${f.kind}-${i}`}
                  className="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                        f.severity === "FAIL"
                          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
                          : f.severity === "WARN"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {f.severity}
                    </span>
                    <Chip mono>{f.kind}</Chip>
                    {f.table ? <Chip mono>{f.table}</Chip> : null}
                    {f.column ? <Chip mono>{f.column}</Chip> : null}
                    <p className="mt-1 break-words text-muted-foreground">
                      {f.detail}
                    </p>
                  </div>
                  {f.count !== undefined ? (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatCount(f.count)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No quality findings reported for this snapshot.
            </p>
          )}
        </div>
      </DetailSection>

      {/* 6 — canonical mappings (§111–§113) */}
      <DetailSection
        eyebrow="§111–§113 mappings"
        title="Canonical mappings"
        description="Source tables mapped to canonical domain entities with evidence, column rules and confidence-gated decisions."
      >
        {mappings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No mappings yet — the MAPPED stage produces them during the run.
          </p>
        ) : (
          <div className="wedjat-scroll overflow-x-auto">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" aria-label="Expand" />
                  <TableHead>Source table</TableHead>
                  <TableHead>Canonical entity</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((m) => {
                  const isOpen = expandedMappings.has(m.id);
                  const pending = m.decision === "PENDING_REVIEW";
                  return (
                    <Fragment key={m.id}>
                      <TableRow
                        className={cn(
                          "cursor-pointer",
                          isOpen && "border-b-0 bg-muted/30 hover:bg-muted/30",
                        )}
                        onClick={() => toggleMapping(m.id)}
                      >
                      <TableCell>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} mapping for ${m.sourceTable}`}
                          className="flex size-6 items-center justify-center rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMapping(m.id);
                          }}
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs font-medium">
                          {m.sourceTable}
                        </p>
                        <p className="max-w-56 truncate text-[10px] text-muted-foreground" title={m.tablePurpose}>
                          {m.tablePurpose}
                        </p>
                      </TableCell>
                      <TableCell>
                        {m.canonicalEntity ? (
                          <Badge
                            variant="outline"
                            className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                          >
                            {m.canonicalEntity}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">
                            unresolved
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {formatCount(m.rowCount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <MiniBar
                            pct={(toRatio(m.confidence) ?? 0) * 100}
                            label="Mapping confidence"
                            className="w-20"
                          />
                          <ConfidenceLabelBadge label={m.confidenceLabel} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionBadge decision={m.decision} />
                        {m.reviewedBy ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            by {m.reviewedBy} · {formatWhen(m.reviewedAt)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {pending && canMutate ? (
                          <span className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              className="h-9"
                              disabled={reviewBusy !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                void postReview(
                                  { mappingId: m.id, decision: "APPROVE" },
                                  `Mapping ${m.sourceTable} → ${m.canonicalEntity ?? "canonical"}`,
                                );
                              }}
                            >
                              <ThumbsUp className="size-3.5" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9"
                              disabled={reviewBusy !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                void postReview(
                                  { mappingId: m.id, decision: "REJECT" },
                                  `Mapping ${m.sourceTable} → ${m.canonicalEntity ?? "canonical"}`,
                                );
                              }}
                            >
                              <ThumbsDown className="size-3.5" aria-hidden="true" />
                              Reject
                            </Button>
                          </span>
                        ) : pending ? (
                          <span className="text-[10px] text-muted-foreground">
                            CURATOR+ required
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">
                                reason:
                              </span>{" "}
                              {m.reason}
                            </p>
                            {m.reviewNote ? (
                              <p className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  review note:
                                </span>{" "}
                                {m.reviewNote}
                              </p>
                            ) : null}
                            <div>
                              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Evidence (§112)
                              </p>
                              <EvidenceList evidence={m.evidence} />
                            </div>
                            <div>
                              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Column mappings
                              </p>
                              <ColumnMappingsTable
                                columns={m.columnMappings}
                              />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DetailSection>

      {/* 7 — schema snapshot browser (§109) */}
      <div id="intake-snapshot-section">
        <DetailSection
          eyebrow="§109 snapshot"
          title="Schema snapshot browser"
          description="Versioned raw schema snapshot — inferred purposes, keys, foreign keys and enum values."
          defaultOpen={false}
          open={snapshotOpen}
          onOpenChange={setSnapshotOpen}
        >
          <SnapshotBrowser snapshot={snapshot} />
          {!snapshot ? (
            <p className="text-xs text-muted-foreground">
              No schema snapshot is attached yet — it is sealed at the STAGED
              stage (§114).
            </p>
          ) : null}
        </DetailSection>
      </div>

      {/* 8 — drift / duplicates / preserved / KG edges (conditional) */}
      {drift && drift.changes.length > 0 ? (
        <DetailSection
          eyebrow="§142 drift"
          title="Schema drift report"
          description={`Compared against snapshot ${drift.fromVersion}`}
          defaultOpen={false}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{drift.fromVersion}</span>
              <span aria-hidden="true">→</span>
              <span className="font-mono text-primary">{drift.toVersion}</span>
              <span className="ml-auto font-mono text-[10px]">
                {formatWhen(drift.createdAt)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{drift.summary}</p>
            <div className="wedjat-scroll overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Change</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.changes.map((c, i) => (
                    <TableRow key={`${c.kind}-${c.name}-${i}`}>
                      <TableCell>
                        <DriftKindBadge kind={c.kind} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.objectType}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.name}
                      </TableCell>
                      <TableCell className="max-w-80">
                        <p className="whitespace-normal break-words text-xs text-muted-foreground">
                          {c.detail}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </DetailSection>
      ) : null}

      {duplicates.length > 0 ? (
        <DetailSection
          eyebrow="§141 duplicates"
          title="Duplicate detection"
          description="Exact, near and semantic duplicates discovered across sources."
          defaultOpen={false}
        >
          <div className="wedjat-scroll overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Left</TableHead>
                  <TableHead>Right</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {duplicates.map((d, i) => (
                  <TableRow key={`${d.left}-${d.right}-${i}`}>
                    <TableCell>
                      <Chip mono>{d.kind}</Chip>
                    </TableCell>
                    <TableCell>
                      <DuplicateStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.left}</TableCell>
                    <TableCell className="font-mono text-xs">{d.right}</TableCell>
                    <TableCell className="max-w-80">
                      <p className="whitespace-normal break-words text-xs text-muted-foreground">
                        {d.evidence}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DetailSection>
      ) : null}

      {preserved.length > 0 ? (
        <DetailSection
          eyebrow="§143 preservation"
          title="Preserved fields"
          description="Source fields that could not be mapped — preserved verbatim, never discarded."
          defaultOpen={false}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                <ShieldCheck aria-hidden="true" className="size-3" />
                Zero data loss — unmapped fields are preserved, not discarded
              </Badge>
            </div>
            <div className="wedjat-scroll max-h-96 overflow-y-auto pr-1">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preserved.map((p, i) => (
                    <TableRow key={`${p.tableName}.${p.columnName}-${i}`}>
                      <TableCell className="font-mono text-xs">
                        {p.tableName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.columnName}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.columnType}
                      </TableCell>
                      <TableCell className="max-w-80">
                        <p className="whitespace-normal break-words text-xs text-muted-foreground">
                          {p.reason}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </DetailSection>
      ) : null}

      {kgEdges.length > 0 ? (
        <DetailSection
          eyebrow="§139/§140 knowledge graph"
          title="Extracted KG edges"
          description="Explicit facts come straight from the source; inferences are confidence-classified (§140)."
          defaultOpen={false}
        >
          <div className="wedjat-scroll max-h-96 overflow-y-auto pr-1">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Subject → predicate → object</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Provenance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kgEdges.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className="whitespace-normal break-words font-mono text-xs">
                        <span className="font-medium">{e.subject}</span>
                        <span className="mx-1.5 text-muted-foreground">
                          —{e.predicate}→
                        </span>
                        <span className={GREEN_TXT}>{e.object}</span>
                      </p>
                    </TableCell>
                    <TableCell>
                      <KgClassificationBadge classification={e.classification} />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p
                        className="whitespace-normal break-words text-xs text-muted-foreground"
                        title={e.evidence}
                      >
                        {e.evidence}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-48">
                      <p
                        className="truncate font-mono text-[10px] text-muted-foreground"
                        title={e.provenance}
                      >
                        {e.provenance}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DetailSection>
      ) : null}

      {/* 9 — training candidates (§125/§126) */}
      <DetailSection
        eyebrow="§125/§126 candidates"
        title="Training candidates"
        description="Generated (prompt, completion) pairs with quality gates and full lineage — approved pairs become training examples."
      >
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No training candidates — generation happens at autonomy ≥ 3
            (auto training-data level).
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                canReview={canMutate}
                busy={reviewBusy !== null}
                onReview={(body, label) => void postReview(body, label)}
              />
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
