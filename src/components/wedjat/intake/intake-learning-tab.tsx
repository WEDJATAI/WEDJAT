"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — Tab 5 "Learning" (§155/§156 learning dashboard).
//
// Totals, knowledge growth chart, canonical entities, KG predicates, eval +
// feedback trends, the improvement queue and the learning health check.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
  Activity,
  Boxes,
  ClipboardCheck,
  Database,
  FileText,
  GraduationCap,
  HeartPulse,
  Layers3,
  ListChecks,
  LoaderCircle,
  Radar,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ErrorState,
  SkeletonGrid,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { StatCard } from "@/components/wedjat/shared/stat-card";
import { FeedbackLabelBadge } from "@/components/wedjat/shared/status-badge";
import {
  KgClassificationBadge,
  MiniBar,
  PriorityBadge,
} from "@/components/wedjat/intake/intake-bits";
import {
  INTAKE_HEALTH_ROLES,
  INTAKE_MUTATION_ROLES,
  formatCount,
} from "@/components/wedjat/intake/intake-helpers";
import { useApiData } from "@/hooks/use-api-data";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  ImprovementItemDto,
  LearningPayload,
} from "@/lib/wedjat/types";

const chartConfig = {
  total: { label: "Knowledge records", color: "var(--chart-1)" },
} satisfies ChartConfig;

function LearningCheckBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls = ["PASS", "OK", "HEALTHY", "GREEN"].includes(s)
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : ["WARN", "DEGRADED", "AMBER"].includes(s)
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : ["FAIL", "ERROR", "CRITICAL", "RED"].includes(s)
        ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn(cls, "text-[10px]")}>
      {status}
    </Badge>
  );
}

function ImprovementStatusBadge({ status }: { status: string }) {
  const cls =
    status === "OPEN"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : status === "ACKNOWLEDGED"
        ? "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  return (
    <Badge variant="outline" className={cn(cls, "text-[10px]")}>
      {status}
    </Badge>
  );
}

export function IntakeLearningTab({ role }: { role: string }) {
  const learning = useApiData<LearningPayload>("/api/learning");
  const canHealth = INTAKE_HEALTH_ROLES.has(role);
  const canImprove = INTAKE_MUTATION_ROLES.has(role);
  const [healthBusy, setHealthBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const runHealthCheck = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    try {
      const res = await apiPost<{
        ranAt: string;
        issuesFound: number;
      }>("/api/learning/health-check");
      toast.success("Learning health check complete (§156)", {
        description: `${res.issuesFound} issue${res.issuesFound === 1 ? "" : "s"} found — details are in the last health check card below.`,
      });
      learning.refresh();
    } catch (e) {
      toast.error("Health check failed", { description: errMessage(e) });
    } finally {
      setHealthBusy(false);
    }
  };

  const improve = async (
    item: ImprovementItemDto,
    action: "acknowledge" | "resolve",
  ) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await apiPost<ImprovementItemDto>(
        `/api/learning/improvements/${encodeURIComponent(item.id)}`,
        { action },
      );
      toast.success(
        action === "acknowledge" ? "Improvement acknowledged" : "Improvement resolved",
        { description: item.description.slice(0, 140) },
      );
      learning.refresh();
    } catch (e) {
      toast.error("Improvement action failed", {
        description: errMessage(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (learning.error && !learning.data) {
    return <ErrorState message={learning.error} onRetry={learning.refresh} />;
  }

  if (learning.loading && !learning.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading learning state…</p>
        <SkeletonGrid count={8} />
        <SkeletonRows rows={2} />
      </div>
    );
  }

  const data = learning.data;
  if (!data) return null;

  // Null-safe defaults: a partially-implemented /api/learning must degrade
  // to zeroed stats and empty tables, never crash the page.
  const totals: LearningPayload["totals"] =
    data.totals ??
    {
      sources: 0,
      documents: 0,
      knowledgeRecords: 0,
      chunks: 0,
      kgEdges: 0,
      trainingExamples: 0,
      trainingCandidates: 0,
      trainingRuns: 0,
      canonicalEntities: 0,
    };
  const knowledgeGrowth = data.knowledgeGrowth ?? [];
  const canonicalEntities = data.canonicalEntities ?? [];
  const kgPredicates = data.kgPredicates ?? [];
  const evalTrends = data.evalTrends ?? [];
  const feedbackTrends = data.feedbackTrends ?? [];
  const improvementQueue = data.improvementQueue ?? [];
  const lastHealthCheck = data.lastHealthCheck ?? null;

  const stats: {
    label: string;
    value: number;
    icon: typeof Database;
  }[] = [
    { label: "Sources", value: totals.sources, icon: Database },
    { label: "Documents", value: totals.documents, icon: FileText },
    { label: "Knowledge records", value: totals.knowledgeRecords, icon: Radar },
    { label: "Chunks", value: totals.chunks, icon: Layers3 },
    { label: "KG edges", value: totals.kgEdges, icon: Workflow },
    { label: "Training examples", value: totals.trainingExamples, icon: GraduationCap },
    { label: "Training candidates", value: totals.trainingCandidates, icon: ClipboardCheck },
    { label: "Training runs", value: totals.trainingRuns, icon: Activity },
    { label: "Canonical entities", value: totals.canonicalEntities, icon: Boxes },
  ];

  const maxFeedback = Math.max(1, ...feedbackTrends.map((f) => f.count));

  return (
    <div className="space-y-6">
      {/* totals */}
      <section aria-label="Learning totals" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Learning totals (§155)
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-3">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      </section>

      {/* knowledge growth */}
      <section aria-label="Knowledge growth" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Knowledge growth
        </h3>
        {knowledgeGrowth.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No growth history yet — the series accumulates as sources are
            imported and knowledge is extracted.
          </p>
        ) : (
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={knowledgeGrowth}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={32}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="total"
                    fill="var(--color-total)"
                    radius={4}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
      </section>

      {/* canonical entities + KG predicates */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Canonical entities" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Canonical entities
          </h3>
          <Card className="rounded-xl">
            <CardContent className="p-0">
              {canonicalEntities.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  No canonical entities registered yet.
                </p>
              ) : (
                <div className="wedjat-scroll max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead className="text-right">Tables</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {canonicalEntities.map((e) => (
                        <TableRow key={e.entity}>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                            >
                              {e.entity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatCount(e.tables)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-label="Knowledge graph predicates" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            KG predicates
          </h3>
          <Card className="rounded-xl">
            <CardContent className="p-0">
              {kgPredicates.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  No KG predicates extracted yet.
                </p>
              ) : (
                <div className="wedjat-scroll max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Predicate</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead className="text-right">Edges</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kgPredicates.map((p) => (
                        <TableRow key={`${p.predicate}:${p.classification}`}>
                          <TableCell className="font-mono text-xs">
                            {p.predicate}
                          </TableCell>
                          <TableCell>
                            <KgClassificationBadge classification={p.classification} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatCount(p.count)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* eval + feedback trends */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Evaluation trends" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Evaluation trends
          </h3>
          <Card className="rounded-xl">
            <CardContent className="p-0">
              {evalTrends.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  No evaluation runs recorded yet.
                </p>
              ) : (
                <div className="wedjat-scroll max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run</TableHead>
                        <TableHead>Pass rate</TableHead>
                        <TableHead>Ground.</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evalTrends.map((t) => (
                        <TableRow key={t.runLabel}>
                          <TableCell className="font-mono text-xs">
                            {t.runLabel}
                          </TableCell>
                          <TableCell>
                            <MiniBar
                              pct={t.passRate * 100}
                              label="Pass rate"
                              className="w-24"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {t.groundedness === null
                              ? "—"
                              : t.groundedness.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatCount(t.latencyMs)} ms
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-label="Feedback trends" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Feedback trends
          </h3>
          <Card className="rounded-xl">
            <CardContent className="space-y-2 p-4">
              {feedbackTrends.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No feedback collected yet.
                </p>
              ) : (
                feedbackTrends.map((f) => (
                  <div
                    key={f.label}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
                  >
                    <FeedbackLabelBadge label={f.label} />
                    <MiniBar
                      pct={(f.count / maxFeedback) * 100}
                      label={`${f.label} count`}
                      className="flex-1"
                    />
                    <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCount(f.count)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* improvement queue (§156) */}
      <section aria-label="Improvement queue" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Improvement queue (§156)
        </h3>
        {improvementQueue.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No open improvements — the learning loop is healthy.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {improvementQueue.map((item) => (
              <Card key={item.id} className="rounded-xl">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {item.kind}
                    </Badge>
                    <PriorityBadge priority={item.priority} />
                    <ImprovementStatusBadge status={item.status} />
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {formatWhen(item.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{item.description}</p>
                  {item.proposedAction ? (
                    <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        proposed action:
                      </span>{" "}
                      {item.proposedAction}
                    </p>
                  ) : null}
                  {canImprove && item.status !== "RESOLVED" ? (
                    <div className="flex gap-2">
                      {item.status === "OPEN" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={busyId !== null}
                          onClick={() => void improve(item, "acknowledge")}
                        >
                          <ListChecks className="size-3.5" aria-hidden="true" />
                          Acknowledge
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        className="h-9"
                        disabled={busyId !== null}
                        onClick={() => void improve(item, "resolve")}
                      >
                        Resolve
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!canImprove && improvementQueue.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Read-only: acknowledging and resolving improvements requires
            CURATOR, OWNER or ADMIN role.
          </p>
        ) : null}
      </section>

      {/* learning health check (§156) */}
      <section aria-label="Learning health check" className="space-y-3">
        <SectionHeading
          as="div"
          eyebrow="§156 health"
          title="Learning health check"
          description="A full pass over the learning loop: retrieval quality, feedback coverage, training gates and knowledge freshness."
          actions={
            canHealth ? (
              <Button
                size="sm"
                className="h-11"
                onClick={() => void runHealthCheck()}
                disabled={healthBusy}
              >
                {healthBusy ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    Running…
                  </>
                ) : (
                  <>
                    <HeartPulse className="size-3.5" aria-hidden="true" />
                    Run health check now
                  </>
                )}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" className="h-11" disabled>
                      <HeartPulse className="size-3.5" aria-hidden="true" />
                      Run health check now
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Health checks require OWNER or ADMIN role (§156).
                </TooltipContent>
              </Tooltip>
            )
          }
          className="mb-0"
        />
        {lastHealthCheck ? (
          <Card className="rounded-xl">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  last run
                </span>
                <span className="font-mono text-xs">
                  {formatWhen(lastHealthCheck.ranAt)}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-auto text-[10px]",
                    lastHealthCheck.issuesFound === 0
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {lastHealthCheck.issuesFound} issue
                  {lastHealthCheck.issuesFound === 1 ? "" : "s"} found
                </Badge>
              </div>
              <div className="wedjat-scroll max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Check</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lastHealthCheck.checks ?? []).map((c, i) => (
                      <TableRow key={`${c.check}-${i}`}>
                        <TableCell className="text-xs font-medium">
                          {c.check}
                        </TableCell>
                        <TableCell>
                          <LearningCheckBadge status={c.status} />
                        </TableCell>
                        <TableCell className="max-w-96">
                          <p className="whitespace-normal break-words text-xs text-muted-foreground">
                            {c.detail}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-xs text-muted-foreground">
            No health check has been recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}
