"use client";

// Training & evaluation lifecycle: eligible sources, dataset creation with
// quality gating, run lifecycle stepper (QUEUED→…→PRODUCTION) with explicit
// human promotion gates, metrics chart, and honest SIMULATION labeling.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  GaugeCircle,
  GraduationCap,
  LoaderCircle,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Download,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import {
  FeedbackLabelBadge,
  StatusBadge,
} from "@/components/wedjat/shared/status-badge";
import { api, apiPost, apiText, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  TrainingDatasetDto,
  TrainingPayload,
  TrainingRunDto,
} from "@/lib/wedjat/types";

const LIFECYCLE = [
  "QUEUED",
  "VALIDATING",
  "TRAINING",
  "EVALUATING",
  "CANDIDATE",
  "CANARY",
  "PRODUCTION",
] as const;

const ACTIVE_RUN_STATUSES = new Set([
  "QUEUED",
  "VALIDATING",
  "TRAINING",
  "EVALUATING",
]);

const TRAINING_KINDS = ["FEEDBACK", "SYNTHETIC", "CORRECTION"] as const;
const METHODS = ["SIMULATED", "LORA", "QLORA"] as const;

const chartConfig = {
  loss: { label: "Loss", color: "var(--chart-1)" },
  evalScore: { label: "Eval score", color: "var(--chart-3)" },
} satisfies ChartConfig;

function canManageTraining(role: string) {
  return role === "CURATOR" || role === "OWNER" || role === "ADMIN";
}

function LifecycleStepper({ status }: { status: string }) {
  const cur = LIFECYCLE.indexOf(status as (typeof LIFECYCLE)[number]);
  const terminal = cur === -1;
  return (
    <div
      className="wedjat-scroll flex items-center gap-1 overflow-x-auto py-1"
      aria-label={`Run lifecycle, current status ${status}`}
    >
      {LIFECYCLE.map((step, i) => {
        const state = terminal
          ? "pending"
          : i < cur
            ? "done"
            : i === cur
              ? "current"
              : "pending";
        return (
          <div key={step} className="flex shrink-0 items-center gap-1">
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-5",
                  state === "pending" ? "bg-border" : "bg-primary/40",
                )}
              />
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium",
                state === "done" &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                state === "current" &&
                  "wedjat-pulse border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
                state === "pending" &&
                  "border-border text-muted-foreground/70",
              )}
            >
              {state === "done" ? (
                <CheckCircle2 aria-hidden="true" className="size-3" />
              ) : null}
              {step}
            </span>
          </div>
        );
      })}
      {terminal ? <StatusBadge status={status} /> : null}
    </div>
  );
}

function RunMetrics({ run }: { run: TrainingRunDto }) {
  const points = run.metrics.filter((m) => m.loss !== null);
  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        Metrics stream once training steps begin.
      </p>
    );
  }
  return (
    <ChartContainer config={chartConfig} className="h-40 w-full">
      <LineChart data={run.metrics}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="step" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          domain={["auto", "auto"]}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="loss"
          type="monotone"
          stroke="var(--color-loss)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ChartContainer>
  );
}

function RunCard({
  run,
  canManage,
  onChanged,
}: {
  run: TrainingRunDto;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const advanceTarget =
    run.status === "EVALUATING" || run.status === "TRAINING" || run.status === "VALIDATING"
      ? "candidate"
      : run.status === "CANDIDATE"
        ? "canary"
        : run.status === "CANARY"
          ? "production"
          : null;

  const doAction = async (
    action: "advance-run" | "rollback",
    to?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ runId: string; status: string; note?: string }>(
        "/api/training",
        { action, runId: run.id, ...(to ? { to } : {}) },
      );
      toast.success(
        action === "advance-run"
          ? `Run advanced to ${to}`
          : "Run rolled back",
        {
          description:
            res.note ??
            `Run ${res.runId.slice(0, 8)}… is now ${res.status}. Training is simulated in this environment.`,
        },
      );
      onChanged();
    } catch (e) {
      toast.error("Training action failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            run {run.id.slice(0, 8)}…
          </span>
          <StatusBadge status={run.status} />
          <Badge variant="secondary" className="font-mono text-[10px]">
            {run.method}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            dataset v{run.datasetVersion}
          </Badge>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {formatWhen(run.createdAt)}
          </span>
        </div>

        <LifecycleStepper status={run.status} />

        <div className="flex items-center gap-3">
          <Progress value={run.progress * 100} className="h-1.5 flex-1" />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {Math.round(run.progress * 100)}%
          </span>
        </div>
        {run.currentStep ? (
          <p className="text-xs text-muted-foreground">
            current step: <span className="font-mono">{run.currentStep}</span>
          </p>
        ) : null}

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p>
            base model:{" "}
            <span className="font-mono text-foreground">
              {run.baseModel ?? "—"}
            </span>
          </p>
          <p>
            candidate model:{" "}
            <span className="font-mono text-foreground">
              {run.candidateModel ?? "—"}
            </span>
          </p>
          <p>
            gpu profile:{" "}
            <span className="font-mono text-foreground">{run.gpuProfile}</span>
          </p>
          <p>
            completed:{" "}
            <span className="font-mono text-foreground">
              {formatWhen(run.completedAt)}
            </span>
          </p>
        </div>
        {run.notes ? (
          <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            {run.notes}
          </p>
        ) : null}

        <RunMetrics run={run} />

        {run.evaluationSummary ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              evaluation gate
            </span>
            <StatusBadge status={run.evaluationSummary.gate} pulse={false} />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              pass rate {Math.round(run.evaluationSummary.passRate * 100)}%
            </span>
            {run.evaluationSummary.regression ? (
              <Badge
                variant="outline"
                className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
              >
                regression detected
              </Badge>
            ) : null}
          </div>
        ) : null}

        {canManage &&
        (advanceTarget || ["CANDIDATE", "CANARY", "PRODUCTION"].includes(run.status)) ? (
          <div className="flex flex-wrap gap-2">
            {advanceTarget ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="h-9" disabled={busy}>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                    Advance to {advanceTarget}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Advance run to {advanceTarget}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This is an explicit promotion gate — it is never
                      automatic. In this environment the transition is
                      simulated (no GPU workloads run).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => doAction("advance-run", advanceTarget)}
                    >
                      Advance
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {["CANDIDATE", "CANARY", "PRODUCTION"].includes(run.status) ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={busy}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Rollback
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Roll back this run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The candidate will be withdrawn and the previous model
                      version restored. Simulated in this environment.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => doAction("rollback")}>
                      Roll back
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        ) : null}
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Read-only: promotion gates require CURATOR, OWNER or ADMIN role.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DatasetCard({ dataset }: { dataset: TrainingDatasetDto }) {
  const v = dataset.currentVersion;
  const [exporting, setExporting] = useState(false);

  const exportJsonl = async () => {
    if (!v || exporting) return;
    setExporting(true);
    try {
      const { text, filename } = await apiText(
        `/api/training/export?datasetVersionId=${encodeURIComponent(v.id)}`,
      );
      const blob = new Blob([text], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `wedjat-${dataset.slug}-v${v.version}.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${v.exampleCount} examples — train anywhere (see docs/TRAINING_ON_FREE_GPU.md)`,
      );
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-semibold">
            {dataset.name}
          </p>
          <StatusBadge status={dataset.status} pulse={false} />
          {v?.lockedAt ? (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Lock aria-hidden="true" className="size-3" />
              LOCKED
            </Badge>
          ) : null}
          {v ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 gap-1 text-xs"
              onClick={exportJsonl}
              disabled={exporting}
              aria-label="Export dataset version as JSONL for external training"
            >
              {exporting ? (
                <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
              ) : (
                <Download aria-hidden="true" className="size-3" />
              )}
              Export JSONL
            </Button>
          ) : null}
        </div>
        {dataset.description ? (
          <p className="text-xs text-muted-foreground">{dataset.description}</p>
        ) : null}
        {v ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              version <span className="font-mono text-foreground">{v.version}</span>{" "}
              · status <StatusBadge status={v.status} pulse={false} />
            </p>
            <p className="font-mono text-[10px]">
              {v.exampleCount} examples · sha {v.checksum}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No version built yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CreateDatasetForm({
  eligibleKinds,
  onCreated,
}: {
  eligibleKinds: string[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kinds, setKinds] = useState<string[]>([...TRAINING_KINDS]);
  const [minQuality, setMinQuality] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleKind = (k: string, checked: boolean) => {
    setKinds((cur) =>
      checked ? [...new Set([...cur, k])] : cur.filter((x) => x !== k),
    );
  };

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{
        datasetId: string;
        datasetVersionId: string;
        exampleCount: number;
        excluded: number;
        reasons: string[];
      }>("/api/training", {
        action: "create-dataset",
        name: name.trim(),
        description: description.trim() || undefined,
        includeKinds: kinds,
        minQuality,
      });
      toast.success("Dataset created", {
        description: `${res.exampleCount} examples included, ${res.excluded} excluded${
          res.reasons.length > 0 ? ` — ${res.reasons.join("; ")}` : ""
        }.`,
      });
      setName("");
      setDescription("");
      onCreated();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="space-y-1.5">
          <Label htmlFor="ds-name">Dataset name</Label>
          <Input
            id="ds-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. checkout-domain-v1"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-desc">Description (optional)</Label>
          <Textarea
            id="ds-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this dataset trains or evaluates…"
            className="min-h-16 text-sm"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Include kinds
          </legend>
          <div className="flex flex-wrap gap-4">
            {TRAINING_KINDS.map((k) => (
              <label
                key={k}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={kinds.includes(k)}
                  onCheckedChange={(c) => toggleKind(k, c === true)}
                  aria-label={`Include ${k} examples`}
                />
                {k}
                <span className="font-mono text-[10px] text-muted-foreground">
                  {eligibleKinds.includes(k) ? "" : "(none eligible yet)"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ds-quality">Minimum quality score</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {minQuality.toFixed(2)}
            </span>
          </div>
          <Slider
            id="ds-quality"
            value={[minQuality]}
            onValueChange={([v]) => setMinQuality(v)}
            min={0}
            max={1}
            step={0.05}
            aria-label="Minimum quality score"
          />
          <p className="text-xs text-muted-foreground">
            Examples below this score are excluded (with reasons reported back).
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : null}
        <Button
          onClick={submit}
          disabled={!name.trim() || kinds.length === 0 || submitting}
        >
          {submitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Building…
            </>
          ) : (
            <>
              <Database className="size-4" aria-hidden="true" />
              Create dataset
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function StartRunForm({
  datasets,
  onStarted,
}: {
  datasets: TrainingDatasetDto[];
  onStarted: () => void;
}) {
  const options = datasets.filter((d) => d.currentVersion);
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [method, setMethod] = useState<string>("SIMULATED");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!datasetVersionId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ runId: string; jobId: string }>(
        "/api/training",
        { action: "start-run", datasetVersionId, method },
      );
      toast.success("Training run started", {
        description: `Run ${res.runId.slice(0, 8)}… (job ${res.jobId.slice(0, 8)}…). The worker auto-progresses to EVALUATING; promotion gates stay manual.`,
      });
      onStarted();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="space-y-1.5">
          <Label htmlFor="sr-dataset">Dataset version</Label>
          <Select
            value={datasetVersionId || "none"}
            onValueChange={(v) => setDatasetVersionId(v === "none" ? "" : v)}
          >
            <SelectTrigger id="sr-dataset" className="h-9 w-full">
              <SelectValue placeholder="Select dataset version" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">Select…</span>
              </SelectItem>
              {options.map((d) => (
                <SelectItem key={d.currentVersion!.id} value={d.currentVersion!.id}>
                  {d.name} · v{d.currentVersion!.version} ·{" "}
                  {d.currentVersion!.exampleCount} examples
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-method">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="sr-method" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-400">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            No GPU is present in this environment — LORA/QLORA requests fall
            back to the SIMULATED lifecycle worker. Everything past
            EVALUATING requires explicit human promotion.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : null}
        <Button
          onClick={submit}
          disabled={!datasetVersionId || submitting}
        >
          {submitting ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Starting…
            </>
          ) : (
            <>
              <Play className="size-4" aria-hidden="true" />
              Start run
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function TrainingView({ role }: { role: string }) {
  const [data, setData] = useState<TrainingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<() => void>(() => {});

  const load = async () => {
    try {
      const d = await api<TrainingPayload>("/api/training");
      setData(d);
      setError(null);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Poll every 3s while any run is in an active lifecycle stage.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const d = await api<TrainingPayload>("/api/training");
        if (stopped) return;
        setData(d);
        setError(null);
        const active = d.runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status));
        if (active && !interval) {
          interval = setInterval(tick, 3000);
        } else if (!active && interval) {
          clearInterval(interval);
          interval = undefined;
        }
      } catch {
        /* keep last state */
      }
    };
    pollRef.current = tick;
    // Initial check arms the interval if runs are already in flight
    // (e.g. the user navigated away and back).
    tick();
    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  const canManage = canManageTraining(role);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Lifecycle" title="Training" />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Lifecycle" title="Training" />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const d = data;
  if (!d) return null;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Lifecycle"
        title="Training"
        description="Datasets from feedback and synthetic sources, quality-gated; runs advance to EVALUATING automatically — promotion to CANDIDATE/CANARY/PRODUCTION is always an explicit human action."
        actions={
          <Button variant="outline" size="sm" className="h-9" onClick={load}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        aria-label="Simulated lifecycle notice"
        className="flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4"
      >
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
            SIMULATED LIFECYCLE
          </p>
          <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-400/80">
            This environment has no GPU. Training runs, metrics, evaluation
            gates and promotions are lifecycle simulations — data provenance
            (datasets, feedback labels, checksums) is real, but no model
            weights are ever trained or deployed. The UI labels this honestly
            everywhere.
          </p>
        </div>
      </motion.div>

      {error ? (
        <ErrorState message={error} onRetry={load} compact />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Eligible sources" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Database aria-hidden="true" className="size-3.5" />
            Eligible training sources
          </h3>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              {d.eligibleSources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No eligible sources yet — leave chat feedback to seed
                  FEEDBACK examples.
                </p>
              ) : (
                <div className="space-y-2">
                  {d.eligibleSources.map((s) => (
                    <div
                      key={s.kind}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
                    >
                      <StatusBadge status={s.kind} pulse={false} />
                      <span className="font-mono text-sm tabular-nums">
                        {s.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-label="Feedback stats" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <GaugeCircle aria-hidden="true" className="size-3.5" />
            Feedback by label
          </h3>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              {d.feedbackStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No feedback collected yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {d.feedbackStats.map((f) => (
                    <div
                      key={f.label}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
                    >
                      <FeedbackLabelBadge label={f.label} />
                      <span className="font-mono text-sm tabular-nums">
                        {f.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Create dataset" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Create dataset
          </h3>
          <CreateDatasetForm
            eligibleKinds={d.eligibleSources.map((s) => s.kind)}
            onCreated={load}
          />
        </section>
        <section aria-label="Start run" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Start run
          </h3>
          <StartRunForm datasets={d.datasets} onStarted={() => pollRef.current()} />
        </section>
      </div>

      <section aria-label="Datasets" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Datasets ({d.datasets.length})
        </h3>
        {d.datasets.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No datasets yet"
            hint="Create one from feedback and synthetic sources on the left."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.datasets.map((ds) => (
              <DatasetCard key={ds.id} dataset={ds} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Runs" className="space-y-3">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <GraduationCap aria-hidden="true" className="size-3.5" />
          Runs ({d.runs.length})
        </h3>
        {d.runs.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No runs yet"
            hint="Start a run from a locked dataset version — the lifecycle is simulated here, but every gate is real."
          />
        ) : (
          <div className="space-y-4">
            {d.runs.map((r) => (
              <RunCard
                key={r.id}
                run={r}
                canManage={canManage}
                onChanged={() => pollRef.current()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
