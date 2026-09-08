"use client";

// Dashboard: GET /api/dashboard — estate stats, health badges, recommendation
// & conflict callouts, last ingestion/evaluation, quick actions.

import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Blocks,
  Brain,
  Database,
  DatabaseZap,
  FileText,
  GaugeCircle,
  Layers3,
  Lightbulb,
  MessagesSquare,
  Radar,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Timer,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ErrorState,
  SkeletonGrid,
} from "@/components/wedjat/shared/empty-state";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { StatCard } from "@/components/wedjat/shared/stat-card";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { useApiData } from "@/hooks/use-api-data";
import { formatWhen } from "@/lib/wedjat/client";
import type { ViewId } from "@/components/wedjat/app-shell";
import type { DashboardStats } from "@/lib/wedjat/types";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function HealthBadge({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        {label}
      </span>
      <StatusBadge status={status} />
    </div>
  );
}

export function DashboardView({
  onNavigate,
}: {
  onNavigate: (v: ViewId) => void;
}) {
  const { data, error, loading, refresh } = useApiData<DashboardStats>(
    "/api/dashboard",
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Overview" title="Dashboard" />
        <SkeletonGrid count={8} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Overview" title="Dashboard" />
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  const d = data;
  if (!d) return null;

  const stats: { label: string; value: string | number; icon: LucideIcon; hint?: string }[] = [
    { label: "Platforms", value: d.platforms, icon: Blocks },
    { label: "Blueprints", value: d.blueprints, icon: Layers3 },
    { label: "Documents", value: d.documents, icon: FileText },
    { label: "Chunks indexed", value: d.chunksIndexed, icon: Database },
    { label: "Knowledge records", value: d.knowledgeRecords, icon: Radar },
    { label: "AI generations", value: d.aiGenerations, icon: Brain },
    { label: "Avg latency", value: `${Math.round(d.avgLatencyMs)} ms`, icon: Timer },
    { label: "Avg confidence", value: pct(d.avgConfidence), icon: GaugeCircle },
    { label: "Avg groundedness", value: pct(d.avgGroundedness), icon: ScanSearch },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <SectionHeading
        eyebrow="Overview"
        title="Domain intelligence estate"
        description="Grounded RAG over versioned platform blueprints — live counts, health and attention items."
        actions={
          <Button variant="outline" size="sm" className="h-9" onClick={refresh}>
            <Activity className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <section aria-label="Estate statistics">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-3">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.03 }}
            >
              <StatCard {...s} />
            </motion.div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="System health" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            System health
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <HealthBadge label="Database" status={d.health.database} />
            <HealthBadge label="Retrieval" status={d.health.retrieval} />
            <HealthBadge label="AI providers" status={d.health.providers} />
            <HealthBadge label="Job queue" status={d.health.jobs} />
          </div>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Last ingestion
                </p>
                <p className="mt-1 text-sm">
                  {formatWhen(d.lastIngestionAt)}
                  {d.lastIngestionAt ? (
                    <span className="text-muted-foreground">
                      {" "}
                      (
                      {formatDistanceToNow(new Date(d.lastIngestionAt), {
                        addSuffix: true,
                      })}
                      )
                    </span>
                  ) : null}
                </p>
              </div>
              <Separator orientation="vertical" className="hidden h-8 sm:block" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Last evaluation
                </p>
                <p className="mt-1 text-sm">
                  {formatWhen(d.lastEvaluationAt)}
                  {d.lastEvaluationAt ? (
                    <span className="text-muted-foreground">
                      {" "}
                      (
                      {formatDistanceToNow(new Date(d.lastEvaluationAt), {
                        addSuffix: true,
                      })}
                      )
                    </span>
                  ) : null}
                </p>
              </div>
              <Separator orientation="vertical" className="hidden h-8 sm:block" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Feedback collected
                </p>
                <p className="mt-1 font-mono text-sm">{d.feedbackCount}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section aria-label="Attention items" className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Attention items
          </h3>
          {d.unresolvedRecommendations > 0 ? (
            <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-700 dark:bg-amber-400/5 dark:text-amber-400">
              <Lightbulb aria-hidden="true" />
              <AlertTitle>Unresolved recommendations</AlertTitle>
              <AlertDescription className="text-amber-700/80 dark:text-amber-400/80">
                {d.unresolvedRecommendations} recommendation
                {d.unresolvedRecommendations === 1 ? "" : "s"} from analysis
                workflows await triage. Run a CTO summary or contradiction
                detection to review them.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-emerald-500/30 bg-emerald-500/5">
              <Sparkles aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
              <AlertTitle>No open recommendations</AlertTitle>
              <AlertDescription>
                All analysis recommendations have been triaged.
              </AlertDescription>
            </Alert>
          )}
          {d.detectedConflicts > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Detected conflicts</AlertTitle>
              <AlertDescription>
                {d.detectedConflicts} contradiction
                {d.detectedConflicts === 1 ? "" : "s"} detected between
                blueprint versions. Run contradiction detection to inspect the
                sources.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Refresh failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </section>
      </div>

      <section aria-label="Quick actions" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-xl p-4 text-left"
            onClick={() => onNavigate("chat")}
          >
            <MessagesSquare className="size-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">Ask the domain</span>
            <span className="text-xs font-normal text-muted-foreground">
              Grounded chat over current blueprints
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-xl p-4 text-left"
            onClick={() => onNavigate("knowledge")}
          >
            <Workflow className="size-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">Ingest a document</span>
            <span className="text-xs font-normal text-muted-foreground">
              Version, section, chunk and index knowledge
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-xl p-4 text-left"
            onClick={() => onNavigate("intake")}
          >
            <DatabaseZap className="size-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">Ingest a database</span>
            <span className="text-xs font-normal text-muted-foreground">
              Auto-detected SQLite / SQL / CSV / JSON intake
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1.5 rounded-xl p-4 text-left"
            onClick={() => onNavigate("evaluation")}
          >
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">Run evaluations</span>
            <span className="text-xs font-normal text-muted-foreground">
              Regression gates for retrieval quality
            </span>
          </Button>
        </div>
      </section>
    </motion.div>
  );
}
