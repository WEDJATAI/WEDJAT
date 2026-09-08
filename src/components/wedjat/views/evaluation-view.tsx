"use client";

// Evaluation suites & results: per-suite run button (auto label with
// timestamp), results grouped by runLabel with a runLabel filter, per-case
// retrieval metric bars and an overall summary row per group.

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  Play,
  Timer,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { useApiData } from "@/hooks/use-api-data";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type { EvaluationsPayload, EvaluationResultDto } from "@/lib/wedjat/types";

const ALL = "all";

function autoLabel() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `run-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function SuiteCard({
  suite,
  onRun,
  running,
}: {
  suite: EvaluationsPayload["suites"][number];
  onRun: (suiteId: string) => void;
  running: string | null;
}) {
  const lr = suite.lastRun;
  const busy = running === suite.id;
  return (
    <Card className="flex flex-col rounded-xl">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{suite.name}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {suite.slug}
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
            {suite.caseCount} cases
          </Badge>
        </div>
        {suite.description ? (
          <p className="text-xs text-muted-foreground">{suite.description}</p>
        ) : null}
        {lr ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                last run
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatWhen(lr.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Progress value={lr.passRate * 100} className="h-1.5 flex-1" />
              <span className="font-mono text-xs tabular-nums">
                {pct(lr.passRate)}
              </span>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              recall {pct(lr.avgRecall)} · precision {pct(lr.avgPrecision)} ·
              groundedness{" "}
              {lr.avgGroundedness === null ? "—" : pct(lr.avgGroundedness)} ·{" "}
              {Math.round(lr.avgLatencyMs)}ms
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Never run.</p>
        )}
        <Button
          size="sm"
          className="h-9 w-full"
          onClick={() => onRun(suite.id)}
          disabled={busy}
        >
          {busy ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Running {suite.caseCount} cases…
            </>
          ) : (
            <>
              <Play className="size-3.5" aria-hidden="true" />
              Run evaluation
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function ResultRow({ r }: { r: EvaluationResultDto }) {
  return (
    <TableRow>
      <TableCell className="max-w-64">
        <p className="truncate font-medium">{r.caseQuery}</p>
        <Badge variant="secondary" className="mt-1 text-[10px]">
          {r.caseTask}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="w-28 space-y-1.5">
          <ScoreBar compact label="recall" value={r.recallAtK} />
          <ScoreBar compact label="precision" value={r.precisionAtK} />
          <ScoreBar compact label="keywords" value={r.keywordCoverage} />
          <ScoreBar compact label="grounded" value={r.groundedness} />
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs tabular-nums">
        {r.retrievedCount}
      </TableCell>
      <TableCell className="font-mono text-xs tabular-nums">
        {r.latencyMs} ms
      </TableCell>
      <TableCell>
        {r.passed ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            <span className="sr-only">passed</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <XCircle aria-hidden="true" className="size-4" />
            <span className="sr-only">failed</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function GroupTable({
  label,
  rows,
}: {
  label: string;
  rows: EvaluationResultDto[];
}) {
  const avg = (f: (r: EvaluationResultDto) => number | null) => {
    const vals = rows.map(f).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const passed = rows.filter((r) => r.passed).length;
  const passRate = passed / rows.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {passed}/{rows.length} passed · {formatWhen(rows[0]?.createdAt)}
        </span>
      </div>
      <div className="wedjat-scroll overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Metrics</TableHead>
              <TableHead className="text-right">Retrieved</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead>Pass</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <ResultRow key={r.id} r={r} />
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell>Overall ({rows.length} cases)</TableCell>
              <TableCell>
                <p className="font-mono text-[10px] text-muted-foreground">
                  recall {pct(avg((r) => r.recallAtK) ?? 0)} · precision{" "}
                  {pct(avg((r) => r.precisionAtK) ?? 0)} · keywords{" "}
                  {pct(avg((r) => r.keywordCoverage) ?? 0)} · groundedness{" "}
                  {avg((r) => r.groundedness) === null
                    ? "—"
                    : pct(avg((r) => r.groundedness)!)}
                </p>
              </TableCell>
              <TableCell />
              <TableCell className="font-mono text-xs tabular-nums">
                {Math.round(avg((r) => r.latencyMs) ?? 0)} ms
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    passRate >= 0.8
                      ? "text-emerald-600 dark:text-emerald-400"
                      : passRate >= 0.5
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                >
                  {pct(passRate)}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function EvaluationView() {
  const { data, error, loading, refresh } = useApiData<EvaluationsPayload>(
    "/api/evaluations",
  );
  const [runLabelFilter, setRunLabelFilter] = useState<string>(ALL);
  const [running, setRunning] = useState<string | null>(null);

  const groups = useMemo(() => {
    const rows = (data?.results ?? []).filter(
      (r) => runLabelFilter === ALL || r.runLabel === runLabelFilter,
    );
    const byLabel = new Map<string, EvaluationResultDto[]>();
    for (const r of rows) {
      const list = byLabel.get(r.runLabel) ?? [];
      list.push(r);
      byLabel.set(r.runLabel, list);
    }
    return [...byLabel.entries()].sort((a, b) =>
      (b[1][0]?.createdAt ?? "").localeCompare(a[1][0]?.createdAt ?? ""),
    );
  }, [data, runLabelFilter]);

  const runSuite = async (suiteId: string) => {
    if (running) return;
    setRunning(suiteId);
    try {
      const label = autoLabel();
      const res = await apiPost<{
        runLabel: string;
        suiteId: string;
        summary: {
          passRate: number;
          avgRecall: number;
          avgPrecision: number;
          avgGroundedness: number | null;
          avgLatencyMs: number;
          caseCount: number;
        };
      }>("/api/evaluations", { action: "run", suiteId, label });
      toast.success("Evaluation complete", {
        description: `${res.summary.caseCount} cases · pass rate ${pct(res.summary.passRate)} · avg latency ${Math.round(res.summary.avgLatencyMs)}ms · label ${res.runLabel}`,
      });
      setRunLabelFilter(res.runLabel);
      refresh();
    } catch (e) {
      toast.error("Evaluation failed", { description: errMessage(e) });
    } finally {
      setRunning(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Quality" title="Evaluations" />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Quality" title="Evaluations" />
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  const d = data;
  if (!d) return null;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Quality"
        title="Evaluations"
        description="Retrieval regression suites — recall@k, precision@k, keyword coverage and groundedness per case. Suites run through the same retrieval pipeline as production chat."
        actions={
          <div className="flex items-center gap-2">
            <Timer aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {d.results.length} results · {d.runLabels.length} runs
            </span>
          </div>
        }
      />

      {error ? <ErrorState message={error} onRetry={refresh} compact /> : null}

      <section aria-label="Suites" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Suites ({d.suites.length})
        </h3>
        {d.suites.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No evaluation suites"
            hint="Suites are seeded by the backend alongside the knowledge base."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.suites.map((s) => (
              <SuiteCard key={s.id} suite={s} onRun={runSuite} running={running} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Results" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Results by run
          </h3>
          <div className="flex items-center gap-2">
            <Label htmlFor="runlabel" className="sr-only">
              Filter by run label
            </Label>
            <Select
              value={runLabelFilter}
              onValueChange={setRunLabelFilter}
            >
              <SelectTrigger id="runlabel" className="h-9 w-64" aria-label="Filter by run label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  <span className="text-muted-foreground">All runs</span>
                </SelectItem>
                {d.runLabels.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No evaluation results"
            hint="Run a suite above — results stream back grouped by run label."
          />
        ) : (
          <div className="space-y-6">
            {groups.map(([label, rows]) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <GroupTable label={label} rows={rows} />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
