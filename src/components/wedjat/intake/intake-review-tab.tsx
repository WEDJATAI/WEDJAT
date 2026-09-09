"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — Tab 3 "Review Queue" (§113 mapping review + §125/§126
// candidate review across ALL sources).
//
// Strategy: the list payload provides authoritative queue counts; pending
// items are collected by fetching detail payloads for the (up to 8) most
// recent sources and filtering locally. Approve/Reject POSTs to
// /api/intake/review (CURATOR+).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  LoaderCircle,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import {
  CandidateStatusBadge,
  ConfidenceLabelBadge,
  DecisionBadge,
} from "@/components/wedjat/intake/intake-bits";
import {
  INTAKE_MUTATION_ROLES,
  formatCount,
  toRatio,
} from "@/components/wedjat/intake/intake-helpers";
import type { UseApiDataResult } from "@/hooks/use-api-data";
import { api, apiPost, errMessage } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type {
  IntakeCandidateDto,
  IntakeDetailPayload,
  IntakeListPayload,
  IntakeMappingDto,
} from "@/lib/wedjat/types";

const DETAIL_FETCH_LIMIT = 8;

interface PendingMapping {
  sourceId: string;
  sourceName: string;
  mapping: IntakeMappingDto;
}

interface PendingCandidate {
  sourceId: string;
  sourceName: string;
  candidate: IntakeCandidateDto;
}

interface ReviewSnap {
  key: string;
  mappings: PendingMapping[];
  candidates: PendingCandidate[];
  error: string | null;
}

interface ReviewBody {
  mappingId?: string;
  candidateId?: string;
  decision: "APPROVE" | "REJECT";
  note?: string;
}

export function IntakeReviewTab({
  role,
  list,
}: {
  role: string;
  list: UseApiDataResult<IntakeListPayload>;
}) {
  const canReview = INTAKE_MUTATION_ROLES.has(role);
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snap, setSnap] = useState<ReviewSnap>({
    key: "",
    mappings: [],
    candidates: [],
    error: null,
  });

  // Most-recent source ids — re-derived every render (cheap) but only the
  // joined KEY participates in the effect deps, so 3s list polling with an
  // unchanged id set does NOT re-trigger detail fetches.
  const idsKey = useMemo(
    () =>
      [...(list.data?.sources ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, DETAIL_FETCH_LIMIT)
        .map((s) => s.id)
        .join(","),
    [list.data],
  );

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split(",");
    let cancelled = false;
    const key = `${idsKey}#${reloadTick}`;
    Promise.all(
      ids.map((id) =>
        api<IntakeDetailPayload>(`/api/intake/${encodeURIComponent(id)}`)
          .then((d) => ({ ok: true as const, d }))
          .catch((e) => ({ ok: false as const, e })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const failures = results.filter((r) => !r.ok);
      if (failures.length === results.length) {
        setSnap({
          key,
          mappings: [],
          candidates: [],
          error: errMessage(failures[0]?.e ?? new Error("unknown error")),
        });
        return;
      }
      const mappings: PendingMapping[] = [];
      const candidates: PendingCandidate[] = [];
      results.forEach((r, idx) => {
        if (!r.ok) return;
        // Null-safe: skip detail payloads whose source record is absent.
        const src = r.d?.source;
        if (!src) return;
        const name = src.name;
        // Prefer the REQUESTED id — it stays unique per source even if a
        // payload's inner id ever disagrees (defensive, key-collision safe).
        const sourceId = ids[idx] ?? src.id;
        for (const m of r.d.mappings ?? []) {
          if (m.decision === "PENDING_REVIEW") {
            mappings.push({ sourceId, sourceName: name, mapping: m });
          }
        }
        for (const c of r.d.candidates ?? []) {
          if (c.status === "TRAINING_CANDIDATE") {
            candidates.push({ sourceId, sourceName: name, candidate: c });
          }
        }
      });
      mappings.sort((a, b) => b.mapping.rowCount - a.mapping.rowCount);
      setSnap({ key, mappings, candidates, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey, reloadTick]);

  const currentKey = `${idsKey}#${reloadTick}`;
  const loading = idsKey !== "" && snap.key !== currentKey;
  const queue = list.data?.reviewQueue ?? null;

  const reload = () => {
    setReloadTick((t) => t + 1);
    list.refresh();
  };

  const postReview = async (body: ReviewBody, label: string) => {
    if (busyId) return;
    setBusyId(body.mappingId ?? body.candidateId ?? "");
    try {
      await apiPost<unknown>("/api/intake/review", body);
      toast.success(body.decision === "APPROVE" ? "Approved" : "Rejected", {
        description: `${label} — ${body.decision === "APPROVE" ? "moving forward" : "withdrawn"}.`,
      });
      reload();
    } catch (e) {
      toast.error("Review failed", { description: errMessage(e) });
    } finally {
      setBusyId(null);
    }
  };

  if (list.error && !list.data) {
    return <ErrorState message={list.error} onRetry={list.refresh} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck aria-hidden="true" className="size-4 text-primary" />
        <p className="text-sm text-muted-foreground">
          {queue
            ? `${formatCount(queue.mappings)} pending mapping${queue.mappings === 1 ? "" : "s"} · ${formatCount(queue.candidates)} pending training candidate${queue.candidates === 1 ? "" : "s"}`
            : "Review queue counts stream in with the source list."}
        </p>
        {!canReview ? (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            read-only — CURATOR+ required to review
          </Badge>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-11"
          onClick={reload}
          disabled={loading}
        >
          {loading ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh queue
        </Button>
      </div>

      {snap.error ? (
        <ErrorState message={snap.error} onRetry={reload} compact />
      ) : null}

      {loading && !snap.error ? (
        <SkeletonRows rows={3} />
      ) : !loading &&
        snap.mappings.length === 0 &&
        snap.candidates.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Review queue is clear"
          hint="Medium-confidence mappings (§113) and gated training candidates land here for a human decision. Nothing is waiting right now."
          compact
        />
      ) : (
        <>
          {snap.mappings.length > 0 ? (
            <section aria-label="Pending mappings" className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending mappings ({formatCount(snap.mappings.length)})
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {snap.mappings.map(({ sourceId, sourceName, mapping: m }) => {
                  const id = m.id;
                  return (
                    <Card key={`${sourceId}:${id}`} className="rounded-xl">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {sourceName}
                          </span>
                          <span aria-hidden="true" className="text-muted-foreground/50">
                            ›
                          </span>
                          <span className="font-mono text-xs font-medium">
                            {m.sourceTable}
                          </span>
                          <span aria-hidden="true" className="text-muted-foreground/50">
                            →
                          </span>
                          {m.canonicalEntity ? (
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                            >
                              {m.canonicalEntity}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground/70">
                              unresolved
                            </span>
                          )}
                          <span className="ml-auto">
                            <ConfidenceLabelBadge label={m.confidenceLabel} />
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {m.reason}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <DecisionBadge decision={m.decision} />
                          <span className="font-mono">
                            {formatCount(m.rowCount)} rows ·{" "}
                            {m.evidence.length} evidence ·{" "}
                            {m.columnMappings.length} column mappings
                          </span>
                        </div>
                        {canReview ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-11"
                              disabled={busyId !== null}
                              onClick={() =>
                                void postReview(
                                  { mappingId: id, decision: "APPROVE" },
                                  `Mapping ${m.sourceTable} → ${m.canonicalEntity ?? "canonical"}`,
                                )
                              }
                            >
                              <ThumbsUp className="size-3.5" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-11"
                              disabled={busyId !== null}
                              onClick={() =>
                                void postReview(
                                  { mappingId: id, decision: "REJECT" },
                                  `Mapping ${m.sourceTable} → ${m.canonicalEntity ?? "canonical"}`,
                                )
                              }
                            >
                              <ThumbsDown className="size-3.5" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          {snap.candidates.length > 0 ? (
            <section aria-label="Pending training candidates" className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending training candidates ({formatCount(snap.candidates.length)})
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {snap.candidates.map(({ sourceId, sourceName, candidate: c }) => (
                  <Card key={`${sourceId}:${c.id}`} className="rounded-xl">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {c.kind}
                        </Badge>
                        <CandidateStatusBadge status={c.status} />
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {sourceName}
                        </span>
                      </div>
                      <p
                        className="line-clamp-2 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed"
                        title={c.prompt}
                      >
                        {c.prompt}
                      </p>
                      <ScoreBar label="Quality" value={toRatio(c.qualityScore)} />
                      <div className="flex flex-wrap gap-1.5" aria-label="Training gates">
                        {c.gates.map((g) => (
                          <span
                            key={g.name}
                            title={g.detail}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                              g.passed
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
                            )}
                          >
                            {g.passed ? "✓" : "✗"} {g.name}
                          </span>
                        ))}
                      </div>
                      {canReview ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-11"
                            disabled={busyId !== null}
                            onClick={() =>
                              void postReview(
                                { candidateId: c.id, decision: "APPROVE" },
                                `Candidate ${c.id.slice(0, 8)}…`,
                              )
                            }
                          >
                            <ThumbsUp className="size-3.5" aria-hidden="true" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11"
                            disabled={busyId !== null}
                            onClick={() =>
                              void postReview(
                                { candidateId: c.id, decision: "REJECT" },
                                `Candidate ${c.id.slice(0, 8)}…`,
                              )
                            }
                          >
                            <ThumbsDown className="size-3.5" aria-hidden="true" />
                            Reject
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
