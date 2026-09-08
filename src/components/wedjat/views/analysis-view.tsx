"use client";

// Analysis workflows: CTO summary, resilience, contradiction detection,
// version comparison, cross-platform intelligence. Renders the full
// AnalyzeResponse report: exec summary, sections, risks, blockers,
// missing evidence, recommendations, conflicts and changes.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  CircleSlash,
  FileSearch,
  FlaskConical,
  GitCompare,
  Lightbulb,
  LoaderCircle,
  Network,
  Play,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Markdown from "react-markdown";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import {
  GenerationMeta,
  SourcePanel,
} from "@/components/wedjat/shared/source-panel";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { useBlueprintScope } from "@/hooks/use-blueprint-scope";
import { apiPost, errMessage } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type { AnalyzeResponse } from "@/lib/wedjat/types";

type AnalysisType =
  | "cto-summary"
  | "resilience"
  | "contradictions"
  | "compare"
  | "cross-platform";

const WORKFLOWS: {
  type: AnalysisType;
  title: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  {
    type: "cto-summary",
    title: "CTO Summary",
    desc: "Executive brief of architecture, risks and debt for a scope.",
    icon: Briefcase,
  },
  {
    type: "resilience",
    title: "Resilience Analysis",
    desc: "Failure modes, blast radius, recovery posture.",
    icon: ShieldCheck,
  },
  {
    type: "contradictions",
    title: "Contradiction Detection",
    desc: "Conflicts between documents and versions.",
    icon: Scale,
  },
  {
    type: "compare",
    title: "Version Comparison",
    desc: "Diff two versions of one blueprint.",
    icon: GitCompare,
  },
  {
    type: "cross-platform",
    title: "Cross-Platform Intelligence",
    desc: "Shared patterns and risks across platforms.",
    icon: Network,
  },
];

const AUTO = "auto";

function scopeLine(r: AnalyzeResponse) {
  const parts: string[] = [];
  if (r.scope.platformName) parts.push(r.scope.platformName);
  if (r.scope.blueprintTitle) parts.push(r.scope.blueprintTitle);
  if (r.scope.blueprintVersion) parts.push(`v${r.scope.blueprintVersion}`);
  if (parts.length === 0) parts.push("estate-wide");
  parts.push(r.scope.resolution.toLowerCase());
  return parts.join(" · ");
}

function KindBadge({ kind }: { kind: string }) {
  return <StatusBadge status={kind} pulse={false} />;
}

export function AnalysisView() {
  const scope = useBlueprintScope();
  const [type, setType] = useState<AnalysisType>("cto-summary");
  const [fromVersionId, setFromVersionId] = useState<string>("");
  const [toVersionId, setToVersionId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState(0);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versions = scope.detail.data?.versions ?? [];
  const isCompare = type === "compare";

  useEffect(() => {
    setFromVersionId("");
    setToVersionId("");
  }, [scope.blueprintSlug]);

  useEffect(() => {
    if (!pending) return;
    setPhase(0);
    const t = setTimeout(() => setPhase(1), 1500);
    return () => clearTimeout(t);
  }, [pending]);

  const canRun = !pending && (!isCompare || (scope.blueprintSlug !== null && fromVersionId && toVersionId));

  const run = async () => {
    if (!canRun) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiPost<AnalyzeResponse>("/api/analyze", {
        type,
        platform: scope.platformSlug ?? undefined,
        blueprint: scope.blueprintSlug ?? undefined,
        ...(isCompare
          ? {
              fromVersionId: fromVersionId || undefined,
              toVersionId: toVersionId || undefined,
            }
          : {}),
      });
      setResult(res);
      toast.success("Analysis complete", {
        description: res.title,
      });
    } catch (e) {
      const msg = errMessage(e);
      setError(msg);
      toast.error("Analysis failed", { description: msg });
    } finally {
      setPending(false);
    }
  };

  const r = result;
  const currentType = r?.type === type;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Workflows"
        title="Analysis"
        description="Retriever-grounded analytical reports over the versioned blueprint corpus. Every report cites its sources."
      />

      <div
        role="radiogroup"
        aria-label="Analysis type"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        {WORKFLOWS.map((w) => {
          const active = type === w.type;
          return (
            <button
              key={w.type}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setType(w.type)}
              className={cn(
                "flex min-h-11 flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md",
                active && "border-primary/50 ring-2 ring-primary/20",
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <w.icon className="size-4.5" />
              </div>
              <p className="text-sm font-semibold">{w.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {w.desc}
              </p>
            </button>
          );
        })}
      </div>

      <Card className="rounded-xl">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Platform
            </Label>
            <Select
              value={scope.platformSlug ?? AUTO}
              onValueChange={(v) => scope.setPlatform(v === AUTO ? null : v)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Platform scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>
                  <span className="text-muted-foreground">All platforms</span>
                </SelectItem>
                {(scope.platforms.data ?? []).map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Blueprint
            </Label>
            <Select
              value={scope.blueprintSlug ?? AUTO}
              onValueChange={(v) => scope.setBlueprint(v === AUTO ? null : v)}
              disabled={scope.blueprints.loading && !scope.blueprints.data}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Blueprint scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>
                  <span className="text-muted-foreground">All blueprints</span>
                </SelectItem>
                {(scope.blueprints.data ?? []).map((b) => (
                  <SelectItem key={b.slug} value={b.slug}>
                    {b.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isCompare ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  From version
                </Label>
                <Select
                  value={fromVersionId || AUTO}
                  onValueChange={(v) => setFromVersionId(v === AUTO ? "" : v)}
                  disabled={!scope.selectedBlueprint}
                >
                  <SelectTrigger className="h-9 w-full" aria-label="From version">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>
                      <span className="text-muted-foreground">Auto — oldest</span>
                    </SelectItem>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version} · {v.status.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  To version
                </Label>
                <Select
                  value={toVersionId || AUTO}
                  onValueChange={(v) => setToVersionId(v === AUTO ? "" : v)}
                  disabled={!scope.selectedBlueprint}
                >
                  <SelectTrigger className="h-9 w-full" aria-label="To version">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>
                      <span className="text-muted-foreground">Auto — current</span>
                    </SelectItem>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version} · {v.status.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
          {scope.platforms.error || scope.blueprints.error ? (
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
              Scope options partially unavailable:{" "}
              {scope.platforms.error ?? scope.blueprints.error}
            </p>
          ) : null}
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button
              className="h-10 w-full sm:w-auto"
              onClick={run}
              disabled={!canRun}
            >
              {pending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="size-4" aria-hidden="true" />
                  Run {WORKFLOWS.find((w) => w.type === type)?.title}
                </>
              )}
            </Button>
            {isCompare && !scope.selectedBlueprint ? (
              <p className="ml-3 self-center text-xs text-muted-foreground">
                Version comparison requires a selected blueprint.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {pending ? (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            aria-live="polite"
          >
            <Card className="rounded-xl">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-3">
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-5 animate-spin text-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {phase === 0
                        ? "Retrieving evidence…"
                        : "Reasoning over retrieved sources…"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Hybrid BM25 + semantic retrieval, reranked against the
                      scoped corpus.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Alert variant="destructive" role="alert">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Analysis failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </motion.div>
        ) : r && currentType ? (
          <motion.div
            key={r.traceId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-muted-foreground">
                  {r.traceId.slice(0, 14)}… · {scopeLine(r)}
                </p>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight">
                  {r.title}
                </h2>
              </div>
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/10 text-primary"
              >
                {r.sources.length} sources
              </Badge>
            </div>

            <Card className="rounded-xl border-l-4 border-l-primary shadow-sm">
              <CardContent className="p-4 sm:p-6">
                <div className="mb-2 flex items-center gap-2">
                  <Lightbulb
                    aria-hidden="true"
                    className="size-4 text-primary"
                  />
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Executive summary
                  </h3>
                </div>
                <div className="wedjat-prose">
                  <Markdown>{r.report.executiveSummary}</Markdown>
                </div>
              </CardContent>
            </Card>

            {r.report.sections.length > 0 ? (
              <section aria-label="Report sections" className="space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Report
                </h3>
                <Accordion type="multiple" defaultValue={["0"]}>
                  {r.report.sections.map((s, i) => (
                    <AccordionItem
                      key={i}
                      value={String(i)}
                      className="rounded-xl border px-4"
                    >
                      <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
                        {s.heading}
                      </AccordionTrigger>
                      <AccordionContent className="wedjat-prose pb-4">
                        <Markdown>{s.content}</Markdown>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-label="Risks" className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle aria-hidden="true" className="size-3.5" />
                  Risks ({r.report.risks.length})
                </h3>
                {r.report.risks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No risks flagged.
                  </p>
                ) : (
                  <div className="wedjat-scroll overflow-x-auto rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Severity</TableHead>
                          <TableHead>Risk</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.report.risks.map((risk, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <StatusBadge status={risk.severity} pulse={false} />
                            </TableCell>
                            <TableCell className="font-medium">
                              {risk.title}
                              <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                                {risk.detail}
                              </p>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>

              <div className="space-y-6">
                {r.report.blockers.length > 0 ? (
                  <section aria-label="Blockers" className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <CircleSlash aria-hidden="true" className="size-3.5 text-red-600 dark:text-red-400" />
                      Blockers ({r.report.blockers.length})
                    </h3>
                    <ul className="space-y-2">
                      {r.report.blockers.map((b, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm"
                        >
                          {b}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {r.report.missingEvidence.length > 0 ? (
                  <section aria-label="Missing evidence" className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <FileSearch aria-hidden="true" className="size-3.5 text-amber-600 dark:text-amber-400" />
                      Missing evidence ({r.report.missingEvidence.length})
                    </h3>
                    <ul className="space-y-2">
                      {r.report.missingEvidence.map((m, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                        >
                          {m}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {r.report.recommendations.length > 0 ? (
                  <section aria-label="Recommendations" className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      Recommendations ({r.report.recommendations.length})
                    </h3>
                    <ul className="space-y-2">
                      {r.report.recommendations.map((rec, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <CheckCircle2
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </div>

            {r.conflicts && r.conflicts.length > 0 ? (
              <section aria-label="Conflicts" className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Scale aria-hidden="true" className="size-3.5" />
                  Conflicts ({r.conflicts.length})
                </h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {r.conflicts.map((c, i) => (
                    <Card key={i} className="rounded-xl">
                      <CardContent className="space-y-3 p-4">
                        <p className="text-sm font-semibold">{c.topic}</p>
                        <div className="space-y-2 text-xs">
                          <div className="rounded-lg border bg-muted/40 p-2.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              source A
                            </p>
                            <p className="mt-0.5 font-mono">{c.sourceA}</p>
                          </div>
                          <div className="rounded-lg border bg-muted/40 p-2.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              source B
                            </p>
                            <p className="mt-0.5 font-mono">{c.sourceB}</p>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{c.why}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusBadge status={c.confidence} pulse={false} />
                          <span className="text-muted-foreground">
                            newer:{" "}
                            <span className="font-mono">{c.newerSource}</span>
                          </span>
                        </div>
                        <p className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm">
                          <span className="font-medium">Resolution: </span>
                          {c.recommendedResolution}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ) : null}

            {r.changes && r.changes.length > 0 ? (
              <section aria-label="Version changes" className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <GitCompare aria-hidden="true" className="size-3.5" />
                  Changes ({r.changes.length})
                </h3>
                <div className="space-y-2">
                  {r.changes.map((ch, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-start gap-2 rounded-lg border p-3"
                    >
                      <KindBadge kind={ch.kind} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {ch.section}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{ch.summary}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ch.evidence}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <Card className="rounded-xl">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <FlaskConical aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Provenance
                  </h3>
                </div>
                <SourcePanel sources={r.sources} />
                <GenerationMeta generation={r.generation} />
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <div
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <FlaskConical className="size-6" />
              </div>
              <p className="text-sm font-medium">No report yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Pick a workflow, optionally scope it to a platform or blueprint,
                and run it. Reports cite every source they used.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
