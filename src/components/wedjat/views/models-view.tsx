"use client";

// Model registry: provider models with capability badges, expandable version
// rows (deployment stage, canary %, artifact checksums, dataset lineage),
// role-gated promote/rollback, and the promotion lifecycle explanation.

import { Fragment, useState } from "react";
import {
  Boxes,
  Braces,
  ChevronRight,
  Dumbbell,
  Fingerprint,
  ListFilter,
  RotateCcw,
  Server,
  ShieldCheck,
  Wrench,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
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
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { useApiData } from "@/hooks/use-api-data";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type { ModelRegistryDto, ModelsPayload } from "@/lib/wedjat/types";

const LIFECYCLE_STEPS = [
  "TRAIN",
  "EVALUATE",
  "REGRESSION",
  "SECURITY",
  "COST",
  "CANDIDATE",
  "CANARY",
  "PRODUCTION",
] as const;

const PROMOTE_STAGES = ["CANDIDATE", "CANARY", "PRODUCTION"] as const;

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  structuredOutput: Braces,
  toolUse: Wrench,
  embedding: Fingerprint,
  reranking: ListFilter,
  finetuning: Dumbbell,
  localInference: Server,
};

function LifecycleCallout() {
  return (
    <Card className="rounded-xl border-amber-500/40 bg-amber-500/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck
            aria-hidden="true"
            className="size-4 text-amber-600 dark:text-amber-400"
          />
          <h3 className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Promotion lifecycle
          </h3>
        </div>
        <div
          className="wedjat-scroll flex items-center gap-1 overflow-x-auto py-1"
          aria-label="Model promotion lifecycle steps"
        >
          {LIFECYCLE_STEPS.map((s, i) => (
            <span key={s} className="flex shrink-0 items-center gap-1">
              {i > 0 ? (
                <ArrowRight
                  aria-hidden="true"
                  className="size-3 text-muted-foreground/60"
                />
              ) : null}
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium",
                  s === "PRODUCTION"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                {s}
              </span>
            </span>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          A model version reaches PRODUCTION only after training, evaluation
          gates, regression checks, security review and cost analysis — each
          promotion is explicit. Any version can be rolled back to its
          predecessor instantly.
        </p>
      </CardContent>
    </Card>
  );
}

function PromoteDialog({
  modelVersionId,
  versionLabel,
  canManage,
  onChanged,
}: {
  modelVersionId: string;
  versionLabel: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [stage, setStage] = useState<string>("CANDIDATE");
  const [busy, setBusy] = useState(false);

  const promote = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<ModelsPayload>("/api/models", {
        action: "promote",
        modelVersionId,
        stage,
      });
      toast.success("Promotion requested", {
        description: `${versionLabel} → ${stage}.`,
      });
      onChanged();
    } catch (e) {
      toast.error("Promotion failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" className="h-9" disabled={!canManage}>
          Promote
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Promote {versionLabel}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <span>
                The version moves to the selected deployment stage. This is an
                explicit gate — never automatic.
              </span>
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="promote-stage">Target stage</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger id="promote-stage" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMOTE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={promote} disabled={busy}>
            Promote to {stage}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RollbackDialog({
  modelVersionId,
  versionLabel,
  canManage,
  onChanged,
}: {
  modelVersionId: string;
  versionLabel: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const rollback = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<ModelsPayload>("/api/models", {
        action: "rollback",
        modelVersionId,
      });
      toast.success("Rollback requested", {
        description: `${versionLabel} rolled back to its predecessor.`,
      });
      onChanged();
    } catch (e) {
      toast.error("Rollback failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          disabled={!canManage}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Rollback
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Roll back {versionLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Traffic returns to the previously promoted version immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={rollback} disabled={busy}>
            Roll back
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function VersionRow({
  v,
  canManage,
  onChanged,
}: {
  v: ModelRegistryDto["versions"][number];
  canManage: boolean;
  onChanged: () => void;
}) {
  const dep = v.deployment;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-semibold">v{v.version}</span>
        <StatusBadge status={v.status} pulse={false} />
        <span className="text-muted-foreground">
          base <span className="font-mono">{v.baseModel}</span> · method{" "}
          <span className="font-mono">{v.trainingMethod}</span>
        </span>
      </div>
      <p className="font-mono text-[10px] text-muted-foreground">
        dataset {v.datasetVersion ?? "—"} · sha {v.artifactChecksum} ·{" "}
        {formatWhen(v.createdAt)}
      </p>
      {dep ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-xs">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            deployment
          </span>
          <StatusBadge status={dep.stage} pulse={false} />
          <span className="text-muted-foreground">
            env <span className="font-mono">{dep.environment}</span>
          </span>
          {dep.canaryPercent > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400"
            >
              canary {dep.canaryPercent}%
            </Badge>
          ) : null}
          <StatusBadge status={dep.status} pulse={false} />
          {dep.rollbackToId ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              rollback→ {dep.rollbackToId.slice(0, 8)}…
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Not deployed.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <PromoteDialog
          modelVersionId={v.id}
          versionLabel={`v${v.version}`}
          canManage={canManage}
          onChanged={onChanged}
        />
        <RollbackDialog
          modelVersionId={v.id}
          versionLabel={`v${v.version}`}
          canManage={canManage}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

export function ModelsView({ role }: { role: string }) {
  const { data, error, loading, refresh } = useApiData<ModelsPayload>(
    "/api/models",
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const canManage =
    role === "CURATOR" || role === "OWNER" || role === "ADMIN";

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Gateway" title="Model Registry" />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="Gateway" title="Model Registry" />
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  const registry = data?.registry ?? [];

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Gateway"
        title="Model Registry"
        description="Providers and models routed by the WEDJAT inference gateway — with capability classes, latency expectations and deployment stages."
      />

      <LifecycleCallout />

      {error ? <ErrorState message={error} onRetry={refresh} compact /> : null}

      {registry.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Registry is empty"
          hint="Model registry entries appear here once the backend seeds them."
        />
      ) : (
        <div className="wedjat-scroll overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" aria-label="Expand" />
                <TableHead>Model</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Classes</TableHead>
                <TableHead className="text-right">Ctx</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registry.map((m) => {
                const isOpen = expanded === m.id;
                return (
                  <Fragment key={m.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} versions for ${m.model}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(isOpen ? null : m.id);
                          }}
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={cn(
                              "size-4 text-muted-foreground transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{m.model}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {m.provider} · {m.modelVersion}
                        </p>
                        {m.notes ? (
                          <p className="mt-0.5 max-w-64 truncate text-[10px] text-muted-foreground">
                            {m.notes}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(CAPABILITY_ICONS)
                            .filter(([cap]) => (m.supports as Record<string, boolean>)[cap])
                            .map(([cap, Icon]) => (
                              <TooltipBadge key={cap} icon={Icon} cap={cap} />
                            ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            {m.qualityClass}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {m.costClass}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {(m.contextLimit / 1000).toFixed(0)}k
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        ~{m.estimatedLatencyMs}ms
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={m.status} pulse={false} />
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/20 p-0">
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-3 p-4"
                          >
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              GPU requirement:{" "}
                              <span className="font-mono normal-case">
                                {m.gpuRequirement}
                              </span>
                            </p>
                            {m.versions.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No fine-tuned versions registered for this
                                model.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {m.versions.map((v) => (
                                  <VersionRow
                                    key={v.id}
                                    v={v}
                                    canManage={canManage}
                                    onChanged={refresh}
                                  />
                                ))}
                              </div>
                            )}
                          </motion.div>
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

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Promote/rollback controls are role-gated: CURATOR, OWNER and ADMIN
          only. You are signed in as {role}.
        </p>
      ) : null}
    </div>
  );
}

function TooltipBadge({
  icon: Icon,
  cap,
}: {
  icon: LucideIcon;
  cap: string;
}) {
  return (
    <Badge
      variant="outline"
      className="size-6 justify-center p-0"
      aria-label={cap}
      title={cap}
    >
      <Icon className="size-3" aria-hidden="true" />
    </Badge>
  );
}
