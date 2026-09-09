"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 4 "Recommendations" (contract §3.4): evidence-based
// recommendations with priority badges (P0→P3), status pills, evidence
// accordion, append-only status-history timeline, recorded outcomes, the
// CURATOR+ lifecycle transitions, the "Record Outcome" dialog whose response
// surfaces the stored LESSON_LEARNED statement, and the ADMIN+ "Generate"
// action. Filters use the contract's ?platform=&status= query params.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  CircleCheck,
  Lightbulb,
  Sparkles,
  TrendingUp,
  WandSparkles,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  PriorityBadge,
  RecoStatusBadge,
  RefreshButton,
  ReadOnlyNote,
  RoleGateChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  FABRIC_ADMIN_ROLES,
  FABRIC_CURATOR_ROLES,
  RECO_LIFECYCLE_HELP,
  RECO_LIFECYCLE_STATUSES,
  RECO_STATUS_FILTERS,
  formatChangePct,
  toRatio,
  type RecoLifecycleStatus,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import type { PlatformRegistryDto, RecommendationDto } from "@/lib/wedjat/types";

/** Lifecycle transition dialog (CURATOR+): status + optional note. */
function LifecycleDialog({
  reco,
  onClose,
  onDone,
}: {
  reco: RecommendationDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<RecoLifecycleStatus>("ACCEPTED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reco || busy) return;
    setBusy(true);
    try {
      const body: { status: string; note?: string } = { status };
      if (note.trim()) body.note = note.trim();
      await apiPost(`/api/fabric/recommendations/${encodeURIComponent(reco.id)}/lifecycle`, body);
      toast.success("Recommendation updated", {
        description: `${reco.id.slice(0, 8)} → ${status}. Status history is append-only.`,
      });
      setNote("");
      onClose();
      onDone();
    } catch (e) {
      toast.error("Lifecycle update failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={reco !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {reco ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb aria-hidden="true" className="size-4 text-primary" />
                Lifecycle transition
              </DialogTitle>
              <DialogDescription className="line-clamp-3">
                {reco.finding}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reco-status">New status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as RecoLifecycleStatus)}
                  disabled={busy}
                >
                  <SelectTrigger id="reco-status" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECO_LIFECYCLE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {RECO_LIFECYCLE_HELP[status]}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reco-note">Note (optional)</Label>
                <Textarea
                  id="reco-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. accepted for the Q3 hardening sprint"
                  className="min-h-20"
                  disabled={busy}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={busy}>
                {busy ? "Updating…" : "Record transition"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Record Outcome dialog (CURATOR+) — closes the learning loop (§64–§66). */
function OutcomeDialog({
  reco,
  onClose,
  onDone,
}: {
  reco: RecommendationDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [metricName, setMetricName] = useState("");
  const [beforeValue, setBeforeValue] = useState("");
  const [afterValue, setAfterValue] = useState("");
  const [notes, setNotes] = useState("");
  const [commitRef, setCommitRef] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState<string | null>(null);

  const reset = () => {
    setOutcome("");
    setMetricName("");
    setBeforeValue("");
    setAfterValue("");
    setNotes("");
    setCommitRef("");
    setMeasuredAt("");
    setLearning(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!reco || busy) return;
    if (!outcome.trim()) {
      toast.error("Outcome required", {
        description: "e.g. RISK_DECREASED, RISK_INCREASED, or a free-form result.",
      });
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, string> = { outcome: outcome.trim() };
      if (metricName.trim()) body.metricName = metricName.trim();
      if (beforeValue.trim()) body.beforeValue = beforeValue.trim();
      if (afterValue.trim()) body.afterValue = afterValue.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (commitRef.trim()) body.commitRef = commitRef.trim();
      if (measuredAt) body.measuredAt = new Date(measuredAt).toISOString();
      const res = await apiPost<{ recorded: boolean; learning: string }>(
        `/api/fabric/recommendations/${encodeURIComponent(reco.id)}/outcome`,
        body,
      );
      toast.success("Outcome recorded", {
        description: "The closed loop stored a lesson learned.",
      });
      setLearning(res.learning);
    } catch (e) {
      toast.error("Outcome recording failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    const recorded = learning !== null;
    reset();
    onClose();
    if (recorded) onDone();
  };

  return (
    <Dialog
      open={reco !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="wedjat-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {reco ? (
          learning !== null ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CircleCheck
                    aria-hidden="true"
                    className="size-4 text-emerald-600 dark:text-emerald-400"
                  />
                  Outcome recorded
                </DialogTitle>
                <DialogDescription>
                  WEDJAT closed the loop — this lesson learned is now part of
                  the knowledge memory.
                </DialogDescription>
              </DialogHeader>
              <Alert className="border-emerald-500/40 bg-emerald-500/10">
                <Sparkles
                  aria-hidden="true"
                  className="size-4 text-emerald-600 dark:text-emerald-400"
                />
                <AlertTitle className="text-emerald-800 dark:text-emerald-300">
                  Lesson learned (LESSON_LEARNED record)
                </AlertTitle>
                <AlertDescription className="text-emerald-900/90 dark:text-emerald-200/90">
                  {learning}
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button type="button" onClick={close}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TrendingUp aria-hidden="true" className="size-4 text-primary" />
                  Record outcome
                </DialogTitle>
                <DialogDescription className="line-clamp-3">
                  {reco.finding}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="outcome-label">Outcome *</Label>
                  <Input
                    id="outcome-label"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    placeholder="e.g. RISK_DECREASED"
                    className="h-11"
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-metric">Metric</Label>
                    <Input
                      id="outcome-metric"
                      value={metricName}
                      onChange={(e) => setMetricName(e.target.value)}
                      placeholder="e.g. mttr"
                      className="h-11"
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-before">Before</Label>
                    <Input
                      id="outcome-before"
                      value={beforeValue}
                      onChange={(e) => setBeforeValue(e.target.value)}
                      placeholder="e.g. 4h"
                      className="h-11"
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-after">After</Label>
                    <Input
                      id="outcome-after"
                      value={afterValue}
                      onChange={(e) => setAfterValue(e.target.value)}
                      placeholder="e.g. 1h"
                      className="h-11"
                      disabled={busy}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-commit">Commit ref</Label>
                    <Input
                      id="outcome-commit"
                      value={commitRef}
                      onChange={(e) => setCommitRef(e.target.value)}
                      placeholder="e.g. a1b2c3d"
                      className="h-11 font-mono text-xs"
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-at">Measured at</Label>
                    <Input
                      id="outcome-at"
                      type="datetime-local"
                      value={measuredAt}
                      onChange={(e) => setMeasuredAt(e.target.value)}
                      className="h-11"
                      disabled={busy}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="outcome-notes">Notes</Label>
                  <Textarea
                    id="outcome-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What actually happened after implementation?"
                    className="min-h-20"
                    disabled={busy}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={submit} disabled={busy}>
                  {busy ? "Recording…" : "Record outcome"}
                </Button>
              </DialogFooter>
            </>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** ADMIN+ generate dialog: evidence-based generation from existing findings. */
function GenerateDialog({
  open,
  onClose,
  platforms,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  platforms: string[];
  onDone: () => void;
}) {
  const [platform, setPlatform] = useState("ALL");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body: { platformSlug?: string } =
        platform === "ALL" ? {} : { platformSlug: platform };
      const res = await apiPost<{ created: number; recommendations: RecommendationDto[] }>(
        "/api/fabric/recommendations/generate",
        body,
      );
      toast.success("Recommendations generated", {
        description: `${res.created} new recommendation${res.created === 1 ? "" : "s"} derived from existing audit / health / drift / pattern findings.`,
      });
      setPlatform("ALL");
      onClose();
      onDone();
    } catch (e) {
      toast.error("Generation failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles aria-hidden="true" className="size-4 text-primary" />
            Generate recommendations
          </DialogTitle>
          <DialogDescription>
            Runs evidence-based generation over existing audit, health, drift
            and pattern findings. Existing recommendations are never
            duplicated — the run is additive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Platform (optional)</Label>
          <Select value={platform} onValueChange={setPlatform} disabled={busy}>
            <SelectTrigger className="h-11" aria-label="Target platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All platforms</SelectItem>
              {platforms.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One recommendation card. */
function RecommendationCard({
  reco,
  canMutate,
  onLifecycle,
  onOutcome,
}: {
  reco: RecommendationDto;
  canMutate: boolean;
  onLifecycle: (r: RecommendationDto) => void;
  onOutcome: (r: RecommendationDto) => void;
}) {
  const confidence = toRatio(reco.confidence);
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={reco.priority} />
          <RecoStatusBadge status={reco.status} />
          <Badge variant="outline" className="text-[10px]">
            {reco.platformSlug}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {reco.sourceType}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground">
            updated {formatWhen(reco.updatedAt)}
          </span>
        </div>

        <p className="text-sm font-medium leading-snug">{reco.finding}</p>

        <div className="rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary">
            Recommendation
          </p>
          <p className="mt-0.5 text-sm leading-snug">{reco.recommendation}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {reco.expectedBenefit ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Expected benefit
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {reco.expectedBenefit}
              </p>
            </div>
          ) : null}
          {reco.potentialRisk ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Potential risk
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {reco.potentialRisk}
              </p>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <ScoreBar label="Confidence" value={confidence} compact />
          </div>
        </div>

        {reco.evidence.length > 0 ? (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="evidence" className="border-0">
              <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
                <span className="flex items-center gap-1.5">
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                  Evidence ({reco.evidence.length})
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pt-1">
                {reco.evidence.map((ev, i) => (
                  <div
                    key={`${reco.id}-ev-${i}`}
                    className="rounded-lg border bg-card p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {ev.source}
                      </code>
                      {ev.authority ? (
                        <Badge variant="outline" className="text-[10px]">
                          {ev.authority}
                        </Badge>
                      ) : null}
                      {ev.version ? (
                        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                          {ev.version}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                      {ev.detail}
                    </p>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>

            {reco.statusHistory.length > 0 ? (
              <AccordionItem value="history" className="border-0">
                <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
                  <span className="flex items-center gap-1.5">
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                    Status history ({reco.statusHistory.length}) — append-only
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-1">
                  <ol className="wedjat-scroll max-h-64 space-y-0 overflow-y-auto border-l-2 border-border pl-4">
                    {reco.statusHistory.map((h, i) => (
                      <li key={`${reco.id}-h-${i}`} className="relative pb-3 last:pb-0">
                        <span
                          aria-hidden="true"
                          className="absolute -left-[21px] top-1 size-2 rounded-full border-2 border-background bg-primary"
                        />
                        <div className="flex flex-wrap items-baseline gap-2">
                          <RecoStatusBadge status={h.status} />
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatWhen(h.at)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            by {h.by}
                          </span>
                        </div>
                        {h.note ? (
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            {h.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {reco.outcomes.length > 0 ? (
              <AccordionItem value="outcomes" className="border-0">
                <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
                  <span className="flex items-center gap-1.5">
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                    Outcomes ({reco.outcomes.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pt-1">
                  {reco.outcomes.map((o) => {
                    const change = formatChangePct(o.changePct);
                    return (
                      <div
                        key={o.id}
                        className="rounded-lg border bg-card p-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <RecoStatusBadge status={o.outcome} />
                          {o.metricName ? (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {o.metricName}
                              {o.beforeValue || o.afterValue
                                ? `: ${o.beforeValue ?? "—"} → ${o.afterValue ?? "—"}`
                                : ""}
                            </span>
                          ) : null}
                          {change ? (
                            <Badge
                              variant="outline"
                              className={
                                o.changePct !== null && o.changePct > 0
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400"
                                  : "border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                              }
                            >
                              {change}
                            </Badge>
                          ) : null}
                          {o.measuredAt ? (
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                              {formatWhen(o.measuredAt)}
                            </span>
                          ) : null}
                        </div>
                        {o.notes ? (
                          <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                            {o.notes}
                          </p>
                        ) : null}
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                          reported by {o.reportedBy}
                        </p>
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
        ) : null}

        {canMutate ? (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onLifecycle(reco)}
            >
              <Lightbulb aria-hidden="true" className="size-3.5" />
              Lifecycle
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onOutcome(reco)}
            >
              <TrendingUp aria-hidden="true" className="size-3.5" />
              Record outcome
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IntelligenceRecommendationsTab({ role }: { role: string }) {
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<RecommendationDto | null>(null);
  const [outcomeTarget, setOutcomeTarget] = useState<RecommendationDto | null>(null);

  const canMutate = FABRIC_CURATOR_ROLES.has(role);
  const canGenerate = FABRIC_ADMIN_ROLES.has(role);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (platformFilter !== "ALL") params.set("platform", platformFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [platformFilter, statusFilter]);

  const recos = useApiData<{ recommendations: RecommendationDto[] }>(
    `/api/fabric/recommendations${query}`,
  );
  const registry = useApiData<{ registry: PlatformRegistryDto[] }>("/api/fabric/registry");

  const rows = recos.data?.recommendations ?? [];
  const observedPlatforms = useMemo(
    () => Array.from(new Set(rows.map((r) => r.platformSlug))).sort(),
    [rows],
  );
  const platformOptions = useMemo(() => {
    const set = new Set<string>([
      ...observedPlatforms,
      ...(registry.data?.registry ?? []).map((r) => r.slug),
    ]);
    return Array.from(set).sort();
  }, [observedPlatforms, registry.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">Recommendations</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Evidence-based findings with a closed outcome loop — every recorded
            outcome becomes a lesson learned.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RoleGateChip minRole="CURATOR" />
          <RefreshButton
            onClick={recos.refresh}
            loading={recos.loading}
            ariaLabel="Refresh recommendations"
          />
          {canGenerate ? (
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setGenerateOpen(true)}
            >
              <WandSparkles aria-hidden="true" className="size-3.5" />
              Generate
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button type="button" size="sm" className="h-9 gap-1.5" disabled>
                    <WandSparkles aria-hidden="true" className="size-3.5" />
                    Generate
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Generation requires ADMIN+</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {!canMutate ? <ReadOnlyNote minRole="CURATOR" /> : null}

      <Card className="rounded-xl">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wide">Platform</Label>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="h-9" aria-label="Filter recommendations by platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All platforms</SelectItem>
                  {platformOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wide">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9" aria-label="Filter recommendations by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECO_STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "ALL" ? "All statuses" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {recos.loading && !recos.data ? (
        <SkeletonRows rows={4} />
      ) : recos.error ? (
        <ErrorState message={recos.error} onRetry={recos.refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No recommendations"
          hint={
            platformFilter !== "ALL" || statusFilter !== "ALL"
              ? "Nothing matches these filters."
              : canGenerate
                ? "Run Generate to derive recommendations from existing audit, health, drift and pattern findings."
                : "An ADMIN can run evidence-based generation once findings exist."
          }
          action={
            canGenerate && platformFilter === "ALL" && statusFilter === "ALL" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setGenerateOpen(true)}
              >
                <WandSparkles aria-hidden="true" className="size-3.5" />
                Generate now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="wedjat-scroll max-h-[38rem] space-y-3 overflow-y-auto pr-1">
          {rows.map((r) => (
            <RecommendationCard
              key={r.id}
              reco={r}
              canMutate={canMutate}
              onLifecycle={setLifecycleTarget}
              onOutcome={setOutcomeTarget}
            />
          ))}
        </div>
      )}

      <LifecycleDialog
        reco={lifecycleTarget}
        onClose={() => setLifecycleTarget(null)}
        onDone={recos.refresh}
      />
      <OutcomeDialog
        reco={outcomeTarget}
        onClose={() => setOutcomeTarget(null)}
        onDone={recos.refresh}
      />
      <GenerateDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        platforms={platformOptions}
        onDone={recos.refresh}
      />
    </div>
  );
}
