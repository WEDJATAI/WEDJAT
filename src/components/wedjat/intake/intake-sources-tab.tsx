"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — Tab 1 "Sources" (§153 import dashboard).
//
// Upload card (CURATOR+), review-queue banner, autonomy strip and the
// sources table. Row click → selects the source and opens Run Detail.
// ═══════════════════════════════════════════════════════════════════════════

import { Fragment, useState } from "react";
import {
  ArrowRight,
  Database,
  FileUp,
  Gauge,
  LoaderCircle,
  Lock,
  ChevronRight,
  ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  ImportStatusBadge,
  IntakeStageChips,
  IssueChips,
  MiniBar,
} from "@/components/wedjat/intake/intake-bits";
import {
  INTAKE_MUTATION_ROLES,
  MAX_INTAKE_UPLOAD_BYTES,
  formatBytes,
  formatCount,
  toRatio,
  uploadIntakeFile,
} from "@/components/wedjat/intake/intake-helpers";
import type { UseApiDataResult } from "@/hooks/use-api-data";
import { errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  IntakeListPayload,
  IntakeSourceDto,
  IntakeUploadResult,
} from "@/lib/wedjat/types";

const ACCEPTED_FILES = ".db,.sqlite,.sqlite3,.sql,.csv,.json,.jsonl,.dump,.txt";

// tone classes for the H/M/L/U mapping mini-counts
const HMLU_TONES = {
  high: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  unresolved: "border-border bg-muted text-muted-foreground",
} as const;

function MappingCounts({ m }: { m: IntakeSourceDto["mapping"] }) {
  const items: { key: keyof typeof HMLU_TONES; label: string; value: number; title: string }[] = [
    { key: "high", label: "H", value: m.high, title: `${m.high} high-confidence mappings` },
    { key: "medium", label: "M", value: m.medium, title: `${m.medium} medium-confidence mappings` },
    { key: "low", label: "L", value: m.low, title: `${m.low} low-confidence mappings` },
    { key: "unresolved", label: "U", value: m.unresolved, title: `${m.unresolved} unresolved mappings` },
  ];
  return (
    <span className="flex items-center gap-1" aria-label="Mapping confidence counts">
      {items.map((it) => (
        <Badge
          key={it.key}
          variant="outline"
          title={it.title}
          className={cn(HMLU_TONES[it.key], "px-1.5 text-[10px] tabular-nums")}
        >
          {it.value} {it.label}
        </Badge>
      ))}
    </span>
  );
}

function UploadCard({
  onUploaded,
}: {
  onUploaded: (res: IntakeUploadResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState("");
  const [name, setName] = useState("");
  const [classification, setClassification] = useState("INTERNAL");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file || busy) return;
    if (file.size > MAX_INTAKE_UPLOAD_BYTES) {
      toast.error("File too large", {
        description: `Selected file is ${formatBytes(file.size)} — the intake limit is 25 MB (§59 upload limits).`,
      });
      return;
    }
    setBusy(true);
    try {
      const res = await uploadIntakeFile(file, platform, name, classification);
      const confidencePct = Math.round((toRatio(res.detected.confidence) ?? 0) * 100);
      toast.success("Database intake started", {
        description: `Detected ${res.detected.engine} via ${res.detected.method} (confidence ${confidencePct}%). The staging pipeline is now running — RAW → STAGED → ANALYZED → MAPPED → VALIDATED → IMPORTED.`,
      });
      setFile(null);
      setPlatform("");
      setName("");
      onUploaded(res);
    } catch (e) {
      toast.error("Upload failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <FileUp aria-hidden="true" className="size-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">
            Upload a database
          </h3>
          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
            CURATOR+
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="intake-file">File</Label>
            <Input
              id="intake-file"
              type="file"
              accept={ACCEPTED_FILES}
              aria-label="Database file to ingest"
              className="h-11 cursor-pointer p-0 pr-3 text-xs file:mr-3 file:h-full file:cursor-pointer file:rounded-l-md file:border-0 file:bg-primary/10 file:px-3 file:text-xs file:font-medium file:text-primary"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {file ? (
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {file.name} · {formatBytes(file.size)}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Max 25 MB · auto-detected
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intake-platform">Platform (optional)</Label>
            <Input
              id="intake-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="e.g. legacy-crm"
              className="h-11"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intake-name">Name (optional)</Label>
            <Input
              id="intake-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="defaults to the file name"
              className="h-11"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intake-classification">Data classification</Label>
            <Select
              value={classification}
              onValueChange={setClassification}
              disabled={busy}
            >
              <SelectTrigger id="intake-classification" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL">INTERNAL — chat enabled</SelectItem>
                <SelectItem value="CONFIDENTIAL">CONFIDENTIAL — local only</SelectItem>
                <SelectItem value="PUBLIC">PUBLIC</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-snug text-muted-foreground">
              §66 — CONFIDENTIAL sources never leave the org boundary (no
              remote AI providers).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={submit}
            disabled={!file || busy}
            className="h-11"
          >
            {busy ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              <>
                <Database className="size-4" aria-hidden="true" />
                Upload &amp; analyze
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Supported: SQLite · SQL dumps (PG/MySQL/MariaDB/SQL&nbsp;Server) ·
            CSV · JSON · JSONL — auto-detected
          </p>
        </div>
        <p className="rounded-lg bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">§107 — zero manual mapping:</span>{" "}
          WEDJAT detects the engine, infers table/column purposes, maps source
          tables to canonical entities and preserves everything it cannot map.
          Humans only review what the engine is unsure about.
        </p>
      </CardContent>
    </Card>
  );
}

export function IntakeSourcesTab({
  role,
  list,
  onSelectSource,
  onUploaded,
  onOpenReview,
  onOpenAutonomy,
}: {
  role: string;
  list: UseApiDataResult<IntakeListPayload>;
  onSelectSource: (id: string) => void;
  onUploaded: (res: IntakeUploadResult) => void;
  onOpenReview: () => void;
  onOpenAutonomy: () => void;
}) {
  const canMutate = INTAKE_MUTATION_ROLES.has(role);
  const data = list.data;
  const sources = data?.sources ?? [];
  const pendingMappings = data?.reviewQueue?.mappings ?? 0;
  const pendingCandidates = data?.reviewQueue?.candidates ?? 0;
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  const toggleIssues = (id: string) => {
    setExpandedIssues((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectRow = (s: IntakeSourceDto) => onSelectSource(s.id);

  const handleRowKeyDown = (e: React.KeyboardEvent, s: IntakeSourceDto) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectRow(s);
    }
  };

  return (
    <div className="space-y-4">
      {canMutate ? (
        <UploadCard onUploaded={onUploaded} />
      ) : (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          Upload requires OWNER, ADMIN or CURATOR role — you have view access.
        </p>
      )}

      {data && pendingMappings + pendingCandidates > 0 ? (
        <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-700 dark:bg-amber-400/5 dark:text-amber-400">
          <ClipboardCheck aria-hidden="true" />
          <AlertTitle>Review queue is waiting</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-amber-700/80 dark:text-amber-400/80">
            <span>
              <span className="font-mono font-semibold">
                {pendingMappings}
              </span>{" "}
              mapping{pendingMappings === 1 ? "" : "s"} +{" "}
              <span className="font-mono font-semibold">
                {pendingCandidates}
              </span>{" "}
              training candidate
              {pendingCandidates === 1 ? "" : "s"} await review.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-7 p-0 text-amber-700 underline dark:text-amber-400"
              onClick={onOpenReview}
            >
              Open review queue
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {data?.autonomy ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
          <Gauge aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Autonomy</span>
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            {data.autonomy.label}
          </Badge>
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
            {data.autonomy.description}
          </span>
          <Button
            variant="link"
            size="sm"
            className="ml-auto h-8"
            onClick={onOpenAutonomy}
          >
            Configure autonomy
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {list.error && !data ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.loading && !data ? (
        <SkeletonRows rows={4} />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No databases ingested yet"
          hint={
            canMutate
              ? "Upload a SQLite file, SQL dump, CSV or JSON export above — the intake engine detects the engine and maps everything automatically."
              : "A curator can upload SQLite files, SQL dumps, CSV and JSON exports — the intake engine handles detection and mapping automatically."
          }
        />
      ) : (
        <Card className="rounded-xl">
          <CardContent className="p-0 sm:p-2">
            <div className="wedjat-scroll overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Schema quality</TableHead>
                    <TableHead>Mapping conf.</TableHead>
                    <TableHead>Knowledge</TableHead>
                    <TableHead>Training</TableHead>
                    <TableHead>Issues</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latest run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s) => {
                    const expanded = expandedIssues.has(s.id);
                    return (
                      <Fragment key={s.id}>
                        <TableRow
                          tabIndex={0}
                          aria-label={`View run detail for ${s.name}`}
                          className="cursor-pointer"
                          onClick={() => selectRow(s)}
                          onKeyDown={(e) => handleRowKeyDown(e, s)}
                        >
                          <TableCell className="max-w-56">
                            <button
                              type="button"
                              className="block max-w-full truncate text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectRow(s);
                              }}
                            >
                              {s.name}
                            </button>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="truncate">{s.platform}</span>
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[9px] font-medium text-muted-foreground"
                              >
                                {s.versionLabel}
                              </Badge>
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              {s.engine}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                            {formatBytes(s.byteSize)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {formatCount(s.tablesTotal)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {formatCount(s.rowsTotal)}
                          </TableCell>
                          <TableCell>
                            <MiniBar pct={s.dqScore} label="Schema quality" />
                          </TableCell>
                          <TableCell>
                            <MappingCounts m={s.mapping} />
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {formatCount(s.knowledgeRecords)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {formatCount(s.trainingCandidates)}
                          </TableCell>
                          <TableCell>
                            {s.errors.length + s.warnings.length > 0 ? (
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-label={`Toggle ${s.errors.length} errors and ${s.warnings.length} warnings for ${s.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleIssues(s.id);
                                }}
                                className="rounded"
                              >
                                <IssueChips errors={s.errors} warnings={s.warnings} />
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground/70">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <ImportStatusBadge status={s.status} />
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <IntakeStageChips status={s.latestRun?.status} />
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {s.latestRun
                                  ? `${s.latestRun.trigger} · ${formatWhen(s.latestRun.finishedAt ?? null)}`
                                  : "no run yet"}
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded &&
                        (s.errors.length > 0 || s.warnings.length > 0) ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={12} className="bg-muted/40">
                              <div className="space-y-1.5">
                                {s.errors.map((err, i) => (
                                  <p
                                    key={`e-${i}`}
                                    className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400"
                                  >
                                    <span aria-hidden="true" className="font-mono">✗</span>
                                    <span className="break-words">{err}</span>
                                  </p>
                                ))}
                                {s.warnings.map((w, i) => (
                                  <p
                                    key={`w-${i}`}
                                    className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
                                  >
                                    <span aria-hidden="true" className="font-mono">!</span>
                                    <span className="break-words">{w}</span>
                                  </p>
                                ))}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
