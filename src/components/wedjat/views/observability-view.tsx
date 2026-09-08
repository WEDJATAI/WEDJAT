"use client";

// Observability: GET /api/system (polled every 15s while this view is
// active): provider circuit health, gateway metrics, policies & budget,
// jobs queue, GPU honesty, config/prompt versions, audit log with
// expandable JSON details, and recent ingestion events.

import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  GaugeCircle,
  HardDrive,
  Layers3,
  ListChecks,
  Radio,
  ScrollText,
  Settings2,
  Wallet,
} from "lucide-react";
import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
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
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  StageChips,
  StageEventList,
} from "@/components/wedjat/shared/pipeline-stages";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { StatCard } from "@/components/wedjat/shared/stat-card";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import { api, errMessage } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type { SystemHealthPayload } from "@/lib/wedjat/types";

const POLL_MS = 15_000;

const chartConfig = {
  latency: { label: "Avg latency (ms)", color: "var(--chart-2)" },
} satisfies ChartConfig;

function ProviderCard({
  p,
}: {
  p: SystemHealthPayload["providers"][number];
}) {
  const open = p.circuitState === "OPEN";
  return (
    <Card
      className={cn(
        "rounded-xl",
        open && "border-red-500/40",
        p.circuitState === "HALF_OPEN" && "border-amber-500/40",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{p.provider}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {p.model}
            </p>
          </div>
          <StatusBadge status={p.circuitState} />
        </div>
        <ScoreBar
          label="success rate"
          value={p.successRate}
          tone="primary"
          compact
        />
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["avg ms", Math.round(p.avgLatencyMs)],
            ["reqs", p.requests],
            ["fails", p.failures],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-md bg-muted/50 p-1.5">
              <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                {k}
              </p>
              <p className="font-mono text-xs tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          429: {p.rateLimited429} · 5xx: {p.serverErrors5xx} · timeouts:{" "}
          {p.timeouts}
        </p>
      </CardContent>
    </Card>
  );
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <pre className="wedjat-scroll max-h-48 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function AuditItem({
  a,
}: {
  a: SystemHealthPayload["recentAudit"][number];
}) {
  const [open, setOpen] = useState(false);
  const severityTone =
    a.severity === "CRITICAL" || a.severity === "HIGH"
      ? "text-red-600 dark:text-red-400"
      : a.severity === "MEDIUM"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-card px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-9 w-full items-center gap-2 text-left"
            aria-expanded={open}
          >
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] font-semibold uppercase",
                severityTone,
              )}
            >
              {a.severity}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {a.action}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {new Date(a.createdAt).toLocaleTimeString()}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 pt-2">
            <p className="font-mono text-[10px] text-muted-foreground">
              actor {a.actorType}
              {a.actorId ? ` ${a.actorId.slice(0, 8)}…` : ""} · target{" "}
              {a.targetType ?? "—"}
              {a.targetId ? ` ${a.targetId.slice(0, 8)}…` : ""}
              {a.traceId ? ` · trace ${a.traceId.slice(0, 10)}…` : ""}
            </p>
            <JsonBlock value={a.details} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ObservabilityView() {
  const [data, setData] = useState<SystemHealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const d = await api<SystemHealthPayload>("/api/system");
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(errMessage(e));
        setLoading(false);
      }
    };
    load();
    // Poll every 15s while the Observability view is active (mounted).
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Ops" title="Observability" />
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Ops" title="Observability" />
        <ErrorState message={error} />
      </div>
    );
  }

  const d = data;
  if (!d) return null;

  // Aggregate latency per PROVIDER (several models may share one provider).
  const latencyByProvider = new Map<string, { sum: number; n: number }>();
  for (const p of d.providers) {
    const agg = latencyByProvider.get(p.provider) ?? { sum: 0, n: 0 };
    agg.sum += p.avgLatencyMs;
    agg.n += 1;
    latencyByProvider.set(p.provider, agg);
  }
  const providerLatency = [...latencyByProvider.entries()].map(([name, agg]) => ({
    name,
    latency: agg.n > 0 ? Math.round(agg.sum / agg.n) : 0,
  }));

  const budgetPct =
    d.policies.budgetUsdPerDay > 0
      ? Math.min(
          1,
          d.policies.spentUsdToday / d.policies.budgetUsdPerDay,
        )
      : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <SectionHeading
        eyebrow="Ops"
        title="Observability"
        description="Live system posture — polled every 15 seconds while this view is open."
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio
              aria-hidden="true"
              className="wedjat-pulse size-3.5 text-primary"
            />
            live · v{d.application.version}
          </span>
        }
      />

      {error ? <ErrorState message={error} compact /> : null}

      <section aria-label="System health" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          System
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-xl">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity aria-hidden="true" className="size-4" />
                  Application
                </span>
                <StatusBadge status={d.application.status} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                uptime {Math.floor(d.application.uptimeSec / 60)}m{" "}
                {d.application.uptimeSec % 60}s
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Database aria-hidden="true" className="size-4" />
                  Database
                </span>
                <StatusBadge status={d.database.status} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {d.database.latencyMs}ms · {d.database.migrationStatus}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Layers3 aria-hidden="true" className="size-4" />
                  Retrieval
                </span>
                <StatusBadge status={d.retrieval.status} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {d.retrieval.indexedChunks} chunks ·{" "}
                {d.retrieval.knowledgeRecords} records
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {d.retrieval.embeddingModel} ·{" "}
                {d.retrieval.lexicalPostings} postings
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ListChecks aria-hidden="true" className="size-4" />
                  Jobs
                </span>
                <StatusBadge
                  status={
                    d.jobs.failed > 0
                      ? "DEGRADED"
                      : d.jobs.running + d.jobs.queued > 0
                        ? "RUNNING"
                        : "OK"
                  }
                  pulse={false}
                />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                queued {d.jobs.queued} · running {d.jobs.running} · failed{" "}
                {d.jobs.failed} · done {d.jobs.completed}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-label="Provider health" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          AI provider health
        </h3>
        {d.providers.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title="No providers configured"
            hint="Provider health appears once the AI gateway routes requests."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d.providers.map((p) => (
              // Providers can host multiple models — key by the unique pair.
              <ProviderCard key={`${p.provider}/${p.model}`} p={p} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Gateway metrics" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Gateway metrics
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="AI requests" value={d.metrics.aiRequests} icon={GaugeCircle} />
          <StatCard
            label="Successes"
            value={
              d.metrics.aiRequests > 0
                ? `${Math.round((d.metrics.aiSuccesses / d.metrics.aiRequests) * 100)}%`
                : "—"
            }
            hint={`${d.metrics.aiSuccesses}/${d.metrics.aiRequests}`}
          />
          <StatCard
            label="Failures"
            value={d.metrics.aiFailures}
            hint={`${d.metrics.aiRequests > 0 ? Math.round((d.metrics.aiFailures / d.metrics.aiRequests) * 100) : 0}% of requests`}
          />
          <StatCard
            label="Fallback rate"
            value={`${Math.round(d.metrics.fallbackRate * 100)}%`}
          />
          <StatCard
            label="Retry rate"
            value={`${Math.round(d.metrics.retryRate * 100)}%`}
          />
          <StatCard
            label="Retrieval events"
            value={d.metrics.retrievalEvents}
            hint={`avg ${Math.round(d.metrics.avgLatencyMs)}ms`}
          />
        </div>
        {providerLatency.length > 0 ? (
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Avg latency per provider
              </p>
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={providerLatency}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="latency"
                    fill="var(--color-latency)"
                    radius={6}
                    maxBarSize={48}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Policies" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Wallet aria-hidden="true" className="size-3.5" />
            Policies &amp; budget
          </h3>
          <Card className="rounded-xl">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Data sharing
                  </p>
                  <Badge variant="outline" className="mt-1 font-mono text-[10px]">
                    {d.policies.dataSharing}
                  </Badge>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Embedding policy
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-1 font-mono text-[10px]"
                  >
                    {d.policies.embeddingPolicy}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Daily budget usage
                  </span>
                  <span className="font-mono tabular-nums">
                    ${d.policies.spentUsdToday.toFixed(2)} / $
                    {d.policies.budgetUsdPerDay.toFixed(2)}
                  </span>
                </div>
                <Progress
                  value={budgetPct * 100}
                  className="h-2"
                  aria-label="Daily budget usage"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <section aria-label="GPU" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <HardDrive aria-hidden="true" className="size-3.5" />
            GPU
          </h3>
          <Card className="rounded-xl border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                >
                  {d.gpu.available ? "AVAILABLE" : "SIMULATED"}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {d.gpu.note ||
                  "No GPU is present in this environment — training is lifecycle-simulation only."}
              </p>
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Config versions" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Settings2 aria-hidden="true" className="size-3.5" />
            Config versions
          </h3>
          <div className="wedjat-scroll max-h-96 overflow-y-auto rounded-xl border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.configVersions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No config versions recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  d.configVersions.map((c) => (
                    <TableRow key={`${c.key}-${c.version}`}>
                      <TableCell className="font-mono text-xs">
                        {c.key}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          v{c.version}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} pulse={false} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Latest values per key:{" "}
            {d.configVersions
              .slice(0, 3)
              .map((c) => `${c.key}=v${c.version}`)
              .join(" · ") || "—"}
          </p>
        </section>

        <section aria-label="Prompt versions" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ScrollText aria-hidden="true" className="size-3.5" />
            Prompt versions
          </h3>
          <div className="wedjat-scroll max-h-96 overflow-y-auto rounded-xl border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.promptVersions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No prompt versions recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  d.promptVersions.map((p) => (
                    <TableRow key={`${p.promptId}-${p.version}`}>
                      <TableCell className="font-mono text-xs">
                        {p.promptId}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.task}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          v{p.version}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} pulse={false} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Approved:{" "}
            {d.promptVersions.filter((p) => p.approvedAt).length}/
            {d.promptVersions.length}
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Audit log" className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ScrollText aria-hidden="true" className="size-3.5" />
            Recent audit events
          </h3>
          {d.recentAudit.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No audit events yet"
              hint="Every mutation is written to the audit trail with actor and trace ids."
            />
          ) : (
            <div className="wedjat-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
              {d.recentAudit.map((a) => (
                <AuditItem key={a.id} a={a} />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Recent ingestion" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent ingestion
          </h3>
          {d.recentIngestion.length === 0 ? (
            <EmptyState
              icon={Layers3}
              title="No ingestion events"
              hint="Pipeline events stream here as documents are indexed."
            />
          ) : (
            <Card className="rounded-xl">
              <CardContent className="space-y-4 p-4">
                <StageChips events={d.recentIngestion} />
                <StageEventList events={d.recentIngestion} maxItems={10} />
              </CardContent>
            </Card>
          )}
          <p className="text-[11px] text-muted-foreground">
            Ingestion jobs lifetime: {d.metrics.ingestionJobs}
          </p>
        </section>
      </div>
    </motion.div>
  );
}
