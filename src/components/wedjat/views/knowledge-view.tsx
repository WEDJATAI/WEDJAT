"use client";

// Knowledge base: platforms grid → blueprint cards → full blueprint detail
// (version timeline, documents, knowledge stats), plus the Ingest Document
// dialog with a live ingestion pipeline event feed.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  FileStack,
  FilePlus2,
  GitCommitVertical,
  Layers3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  StageChips,
  StageEventList,
} from "@/components/wedjat/shared/pipeline-stages";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { useApiData } from "@/hooks/use-api-data";
import { api, apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  BlueprintDetail,
  BlueprintSummary,
  IngestionEventDto,
  IngestionSubmitResult,
  JobDto,
  PlatformSummary,
} from "@/lib/wedjat/types";

const DOC_TYPES = ["BLUEPRINT", "ADR", "SPEC", "AUDIT", "RUNBOOK", "REVIEW", "REFERENCE"] as const;
const CLASSIFICATIONS = ["CONFIDENTIAL", "INTERNAL", "PUBLIC"] as const;

function isActiveJob(j: JobDto) {
  return j.status === "QUEUED" || j.status === "RUNNING" || j.status === "RETRYING";
}

function PlatformCard({
  platform,
  active,
  onSelect,
}: {
  platform: PlatformSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md",
        active && "border-primary/50 ring-2 ring-primary/20",
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{platform.name}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {platform.slug}
          </p>
        </div>
        <StatusBadge
          status={platform.criticality}
          pulse={false}
        />
      </div>
      <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{platform.blueprintCount} blueprints</span>
        <span>{platform.documentCount} docs</span>
        <span>{platform.chunkCount} chunks</span>
      </div>
      <p className="w-full font-mono text-[10px] text-muted-foreground">
        {platform.currentPlatformVersion
          ? `platform v${platform.currentPlatformVersion}`
          : "no versions"}
      </p>
    </button>
  );
}

function VersionTimeline({ detail }: { detail: BlueprintDetail }) {
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {detail.versions.map((v) => (
        <li key={v.id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[26px] top-1 flex size-3 items-center justify-center rounded-full border-2",
              v.status === "CURRENT"
                ? "border-primary bg-primary"
                : v.status === "SUPERSEDED"
                  ? "border-border bg-muted"
                  : "border-amber-500/60 bg-amber-500/40",
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              v{v.version}
            </span>
            <StatusBadge status={v.status} pulse={false} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {v.documentCount} docs · {v.chunkCount} chunks
            </span>
          </div>
          {v.summary ? (
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {v.summary}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            effective {v.effectiveFrom.slice(0, 10)}
            {v.approvedAt ? ` · approved ${v.approvedAt.slice(0, 10)}` : ""}
          </p>
          <p
            className="mt-0.5 max-w-md truncate font-mono text-[10px] text-muted-foreground"
            title={`checksum ${v.checksum}`}
          >
            sha {v.checksum}
          </p>
        </li>
      ))}
    </ol>
  );
}

function IngestDialog({
  platforms,
  blueprints,
  onIngested,
}: {
  platforms: PlatformSummary[];
  blueprints: { slug: string; title: string; platformSlug: string }[];
  onIngested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [platformSlug, setPlatformSlug] = useState("");
  const [newBlueprint, setNewBlueprint] = useState(false);
  const [blueprintSlug, setBlueprintSlug] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("BLUEPRINT");
  const [classification, setClassification] = useState<string>("INTERNAL");
  const [version, setVersion] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scopedBlueprints = blueprints.filter(
    (b) => !platformSlug || b.platformSlug === platformSlug,
  );

  const valid =
    platformSlug &&
    (newBlueprint ? newSlug.trim() && newTitle.trim() : blueprintSlug) &&
    title.trim() &&
    content.trim();

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<IngestionSubmitResult>("/api/ingestion", {
        platformSlug,
        blueprintSlug: newBlueprint ? newSlug.trim() : blueprintSlug,
        ...(newBlueprint ? { blueprintTitle: newTitle.trim() } : {}),
        title: title.trim(),
        docType,
        classification,
        content,
        ...(version.trim() ? { version: version.trim() } : {}),
      });
      toast.success("Ingestion job started", {
        description: `${res.message} — job ${res.jobId.slice(0, 8)}… is moving through the pipeline. Live events appear below.`,
      });
      setOpen(false);
      setTitle("");
      setContent("");
      setVersion("");
      setNewSlug("");
      setNewTitle("");
      onIngested();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <FilePlus2 className="size-3.5" aria-hidden="true" />
          Ingest Document
        </Button>
      </DialogTrigger>
      <DialogContent className="wedjat-scroll max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ingest document</DialogTitle>
          <DialogDescription>
            Submits a markdown document to the ingestion pipeline:
            validate → classify → version → section → chunk → embed → index.
            Returns a job you can watch live below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ing-platform">Platform</Label>
            <Select value={platformSlug} onValueChange={setPlatformSlug}>
              <SelectTrigger id="ing-platform" className="h-9 w-full">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent>
                {platforms.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-doctype">Document type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="ing-doctype" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ing-bp">Blueprint</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="ing-new-bp"
                  checked={newBlueprint}
                  onCheckedChange={setNewBlueprint}
                  aria-label="Create a new blueprint"
                />
                <Label
                  htmlFor="ing-new-bp"
                  className="text-xs text-muted-foreground"
                >
                  New blueprint
                </Label>
              </div>
            </div>
            {newBlueprint ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  id="ing-bp"
                  placeholder="blueprint-slug"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  className="font-mono text-sm"
                />
                <Input
                  placeholder="Blueprint title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>
            ) : (
              <Select value={blueprintSlug} onValueChange={setBlueprintSlug}>
                <SelectTrigger id="ing-bp" className="h-9 w-full">
                  <SelectValue placeholder="Select blueprint" />
                </SelectTrigger>
                <SelectContent>
                  {scopedBlueprints.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No blueprints for this platform yet.
                    </p>
                  ) : null}
                  {scopedBlueprints.map((b) => (
                    <SelectItem key={b.slug} value={b.slug}>
                      {b.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ing-title">Title</Label>
            <Input
              id="ing-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Checkout Service — Resilience Standard v3"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-class">Classification</Label>
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger id="ing-class" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ing-version">Version (optional)</Label>
            <Input
              id="ing-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 3.0.0 (auto if empty)"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ing-content">Content (markdown)</Label>
            <Textarea
              id="ing-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Section&#10;&#10;Markdown content. Sections become retrieval units; chunks get embedded locally."
              className="wedjat-scroll min-h-48 font-mono text-[13px]"
            />
            <p className="text-xs text-muted-foreground">
              {content.length.toLocaleString()} characters
            </p>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Ingestion failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              <>
                <Upload className="size-4" aria-hidden="true" />
                Ingest
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgeView() {
  const platforms = useApiData<PlatformSummary[]>("/api/platforms");
  const [platformSlug, setPlatformSlug] = useState<string | null>(null);
  const blueprints = useApiData<BlueprintSummary[]>(
    platformSlug
      ? `/api/blueprints?platform=${encodeURIComponent(platformSlug)}`
      : "/api/blueprints",
  );
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const detail = useApiData<BlueprintDetail>(
    blueprintId ? `/api/blueprints?id=${encodeURIComponent(blueprintId)}&full=1` : null,
  );

  const [events, setEvents] = useState<IngestionEventDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [polling, setPolling] = useState(false);
  const recheckRef = useRef<() => void>(() => {});

  // Poll /api/jobs + /api/ingestion every 3s ONLY while jobs are active.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const j = await api<JobDto[]>("/api/jobs");
        if (stopped) return;
        setJobs(j);
        const active = j.some(isActiveJob);
        try {
          const ing = await api<{ events: IngestionEventDto[]; jobs: JobDto[] }>(
            "/api/ingestion",
          );
          if (!stopped) setEvents(ing.events);
        } catch {
          /* events endpoint may not exist yet */
        }
        if (active) {
          if (!interval) {
            setPolling(true);
            interval = setInterval(tick, 3000);
          }
        } else if (interval) {
          clearInterval(interval);
          interval = undefined;
          setPolling(false);
        }
      } catch {
        /* jobs endpoint may not exist yet */
      }
    };
    tick();
    recheckRef.current = tick;
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const activeJobs = jobs.filter(isActiveJob);
  const failedJobs = jobs.filter((j) => j.status === "FAILED");

  const jobAction = async (action: "retry" | "cancel", jobId: string) => {
    try {
      await apiPost<JobDto>("/api/jobs", { action, jobId });
      toast.success(`Job ${action} queued`, {
        description: `Job ${jobId.slice(0, 8)}… — ${action === "retry" ? "it will re-run with attempt counter incremented" : "it will stop at the next checkpoint"}.`,
      });
      recheckRef.current();
    } catch (e) {
      toast.error(`Could not ${action} job`, { description: errMessage(e) });
    }
  };

  const onIngested = useCallback(() => {
    recheckRef.current();
    blueprints.refresh();
    platforms.refresh();
  }, [blueprints, platforms]);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Knowledge graph"
        title="Knowledge Base"
        description="Platforms → blueprints → versions → documents → sections → chunks. All retrieval is scoped to CURRENT (or explicitly pinned) versions."
        actions={<IngestDialog
          platforms={platforms.data ?? []}
          blueprints={(blueprints.data ?? []).map((b) => ({
            slug: b.slug,
            title: b.title,
            platformSlug: b.platformSlug,
          }))}
          onIngested={onIngested}
        />}
      />

      {platforms.error && !platforms.data ? (
        <ErrorState message={platforms.error} onRetry={platforms.refresh} />
      ) : platforms.loading && !platforms.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (platforms.data ?? []).length === 0 ? (
        <EmptyState
          icon={Layers3}
          title="No platforms yet"
          hint="Ingest your first blueprint document to bootstrap a platform."
        />
      ) : (
        <section aria-label="Platforms" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Platforms{(platforms.data ?? []).length ? ` (${(platforms.data ?? []).length})` : ""}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(platforms.data ?? []).map((p) => (
              <PlatformCard
                key={p.id}
                platform={p}
                active={platformSlug === p.slug}
                onSelect={() =>
                  setPlatformSlug((cur) => (cur === p.slug ? null : p.slug))
                }
              />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Blueprints" className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Blueprints
          {platformSlug ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {platformSlug}
            </Badge>
          ) : null}
          <button
            type="button"
            onClick={blueprints.refresh}
            className="ml-auto inline-flex min-h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            aria-label="Refresh blueprints"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Refresh
          </button>
        </h3>
        {blueprints.error && !blueprints.data ? (
          <ErrorState message={blueprints.error} onRetry={blueprints.refresh} compact />
        ) : blueprints.loading && !blueprints.data ? (
          <SkeletonRows rows={3} />
        ) : (blueprints.data ?? []).length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No blueprints found"
            hint={
              platformSlug
                ? "This platform has no blueprints yet — ingest a document or clear the platform filter."
                : "Ingest a document to create the first blueprint."
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(blueprints.data ?? []).map((b) => {
              const active = blueprintId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBlueprintId(active ? null : b.id)}
                  className={cn(
                    "flex min-h-11 flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md",
                    active && "border-primary/50 ring-2 ring-primary/20",
                  )}
                >
                  <div className="flex w-full items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      {b.title}
                    </p>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {b.blueprintType}
                    </Badge>
                  </div>
                  <p className="w-full truncate font-mono text-[10px] text-muted-foreground">
                    {b.platformSlug}/{b.slug}
                  </p>
                  <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">
                      {b.currentVersion ? `v${b.currentVersion}` : "unversioned"}
                    </span>
                    <span>{b.versionCount} versions</span>
                    <span>{b.documentCount} docs</span>
                    <span>{b.knowledgeRecordCount} knowledge</span>
                  </div>
                  {b.currentVersionStatus ? (
                    <StatusBadge status={b.currentVersionStatus} pulse={false} />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {blueprintId ? (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          aria-label="Blueprint detail"
          className="space-y-4"
        >
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Blueprint detail
          </h3>
          {detail.error ? (
            <ErrorState message={detail.error} onRetry={detail.refresh} />
          ) : detail.loading && !detail.data ? (
            <SkeletonRows rows={4} />
          ) : detail.data ? (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="rounded-xl">
                  <CardContent className="p-4 sm:p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <GitCommitVertical
                        aria-hidden="true"
                        className="size-4 text-primary"
                      />
                      <h4 className="text-sm font-semibold">
                        Version timeline
                      </h4>
                    </div>
                    {detail.data.versions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No versions yet.
                      </p>
                    ) : (
                      <VersionTimeline detail={detail.data} />
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-xl">
                  <CardContent className="p-4 sm:p-6">
                    <h4 className="mb-4 text-sm font-semibold">
                      Knowledge records
                    </h4>
                    <p className="font-mono text-2xl font-semibold tabular-nums">
                      {detail.data.knowledgeStats.total}
                    </p>
                    <div className="mt-4 space-y-3">
                      <div>
                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          by status
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(detail.data.knowledgeStats.byStatus).map(
                            ([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex items-center gap-1"
                              >
                                <StatusBadge status={k} pulse={false} />
                                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                  {v}
                                </span>
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          by type
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(detail.data.knowledgeStats.byType).map(
                            ([k, v]) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                {k}
                                <span className="ml-1 text-muted-foreground">
                                  {v}
                                </span>
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-xl">
                <CardContent className="p-4 sm:p-6">
                  <h4 className="mb-4 text-sm font-semibold">Documents</h4>
                  {detail.data.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No documents ingested for this blueprint yet.
                    </p>
                  ) : (
                    <div className="wedjat-scroll overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Class</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Sections</TableHead>
                            <TableHead className="text-right">Chunks</TableHead>
                            <TableHead>Ingested</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.data.documents.map((doc) => (
                            <TableRow key={doc.id}>
                              <TableCell className="max-w-56 truncate font-medium">
                                {doc.title}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-[10px]">
                                  {doc.docType}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">
                                  {doc.classification}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={doc.status} pulse={false} />
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {doc.sectionCount}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {doc.chunkCount}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatWhen(doc.ingestedAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </motion.section>
      ) : null}

      <section aria-label="Ingestion pipeline" className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ingestion pipeline
          {polling ? (
            <Badge
              variant="outline"
              className="wedjat-pulse border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
            >
              LIVE
            </Badge>
          ) : null}
        </h3>
        <Card className="rounded-xl">
          <CardContent className="space-y-4 p-4">
            {events.length === 0 && jobs.length === 0 ? (
              <EmptyState
                icon={Upload}
                title="No ingestion activity yet"
                hint="Ingest a document — stages stream here every 3 seconds while jobs run."
                compact
                className="border-0 p-4"
              />
            ) : (
              <>
                <StageChips events={events} />
                {activeJobs.length > 0 ? (
                  <div className="space-y-2">
                    {activeJobs.map((j) => (
                      <div
                        key={j.id}
                        className="flex items-center gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs">
                              {j.type} · {j.id.slice(0, 8)}…
                            </span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {Math.round(j.progress * 100)}%
                            </span>
                          </div>
                          <Progress value={j.progress * 100} className="mt-2 h-1.5" />
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            attempt {j.attempts}/{j.maxAttempts}
                            {j.lastError ? ` · last error: ${j.lastError}` : ""}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0"
                          onClick={() => jobAction("cancel", j.id)}
                        >
                          <Ban className="size-3.5" aria-hidden="true" />
                          Cancel
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {failedJobs.length > 0 ? (
                  <div className="space-y-2">
                    {failedJobs.map((j) => (
                      <div
                        key={j.id}
                        className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="truncate font-mono text-xs">
                            {j.type} · {j.id.slice(0, 8)}…
                          </span>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {j.lastError ?? "failed"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0"
                          onClick={() => jobAction("retry", j.id)}
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                          Retry
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <StageEventList events={events} maxItems={12} />
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
