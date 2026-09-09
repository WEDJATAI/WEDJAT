"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 6 "Memory" (contract §3.6): learning history as a
// vertical timeline with kind icons, open knowledge gaps with priority +
// occurrences, and the provenance inspector — "Why does WEDJAT know this?"
// searches a knowledge record id (or traces one straight from the timeline)
// and renders source doc, lineage chain, events and model usage.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import {
  BookOpen,
  Brain,
  CircleAlert,
  FileSearch,
  History,
  Link2,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { StatCard } from "@/components/wedjat/shared/stat-card";
import {
  EmptyState,
  ErrorState,
  SkeletonGrid,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  PriorityBadge,
  RefreshButton,
  TimelineKindIcon,
} from "@/components/wedjat/intelligence/intelligence-bits";
import { formatCount } from "@/components/wedjat/intelligence/intelligence-helpers";
import { formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import type { MemoryInspectorPayload, ProvenanceDto } from "@/lib/wedjat/types";

/** "Why does WEDJAT know this?" — provenance panel for one record. */
function ProvenancePanel({ provenance }: { provenance: ProvenanceDto }) {
  return (
    <Card className="rounded-xl border-primary/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {provenance.recordId}
          </Badge>
          <StatusBadge status={provenance.status} pulse={false} />
          {provenance.platform ? (
            <Badge variant="outline" className="text-[10px]">
              {provenance.platform}
            </Badge>
          ) : null}
        </div>

        <div className="rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary">
            Statement
          </p>
          <p className="mt-0.5 text-sm leading-snug">{provenance.statement}</p>
        </div>

        <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
          <p>
            Learned:{" "}
            <span className="font-mono">{formatWhen(provenance.learnedAt)}</span>
          </p>
          <p>
            Last verified:{" "}
            <span className="font-mono">{formatWhen(provenance.lastVerifiedAt)}</span>
          </p>
        </div>

        {provenance.document ? (
          <div className="rounded-lg border bg-card p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Source document
            </p>
            <p className="mt-0.5 text-xs font-medium">{provenance.document.title}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {provenance.document.docType} · version {provenance.document.version} ·{" "}
              {provenance.document.id}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No source document — this record was learned from the event fabric.
          </p>
        )}

        {provenance.lineage.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Lineage chain ({provenance.lineage.length})
            </p>
            <ol className="wedjat-scroll max-h-64 space-y-0 overflow-y-auto border-l-2 border-border pl-4">
              {provenance.lineage.map((l, i) => (
                <li key={`${l.recordId}-${i}`} className="relative pb-3 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-background bg-teal-500"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="border-teal-500/30 bg-teal-500/10 font-mono text-[10px] text-teal-700 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-400"
                    >
                      {l.relation}
                    </Badge>
                    <code className="font-mono text-[10px] text-muted-foreground">
                      {l.recordId}
                    </code>
                  </div>
                  <p className="mt-1 text-xs leading-snug">{l.statement}</p>
                  {l.note ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{l.note}</p>
                  ) : null}
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                    {formatWhen(l.at)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {provenance.events.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Fabric events ({provenance.events.length})
            </p>
            <ul className="wedjat-scroll max-h-40 space-y-1 overflow-y-auto pr-1">
              {provenance.events.map((e, i) => (
                <li
                  key={`${e.eventId}-${i}`}
                  className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[11px]"
                >
                  <code className="font-mono text-[10px]">{e.eventType}</code>
                  <code className="font-mono text-[10px] text-muted-foreground">
                    {e.eventId}
                  </code>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {formatWhen(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {provenance.usedByModels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Used by models
            </span>
            {provenance.usedByModels.map((m) => (
              <Badge key={m} variant="outline" className="font-mono text-[10px]">
                {m}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IntelligenceMemoryTab() {
  const memory = useApiData<MemoryInspectorPayload>("/api/fabric/memory");

  const [recordInput, setRecordInput] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);

  const provenance = useApiData<ProvenanceDto>(
    recordId ? `/api/fabric/memory/provenance?recordId=${encodeURIComponent(recordId)}` : null,
  );

  const timeline = memory.data?.timeline ?? [];
  const gaps = useMemo(
    () =>
      [...(memory.data?.gaps ?? [])].sort(
        (a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0),
      ),
    [memory.data],
  );
  const stats = memory.data?.stats;

  const search = () => {
    const id = recordInput.trim();
    if (!id) {
      // fall back to the newest knowledge record in the timeline
      const fallback = timeline.find((t) => t.kind === "KNOWLEDGE_ADDED" && t.refId);
      if (!fallback?.refId) return;
      setRecordInput(fallback.refId);
      setRecordId(fallback.refId);
      return;
    }
    setRecordId(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">Memory</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Learning history, open knowledge gaps, and full provenance for any
            statement WEDJAT holds.
          </p>
        </div>
        <RefreshButton
          onClick={() => {
            memory.refresh();
            provenance.refresh();
          }}
          loading={memory.loading || provenance.loading}
          ariaLabel="Refresh memory inspector"
        />
      </div>

      {/* ── memory stats ── */}
      {memory.loading && !memory.data ? (
        <SkeletonGrid count={6} />
      ) : memory.error ? (
        <ErrorState message={memory.error} onRetry={memory.refresh} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Records" value={formatCount(stats?.knowledgeRecords)} icon={BookOpen} />
          <StatCard label="Lineages" value={formatCount(stats?.lineages)} icon={Link2} />
          <StatCard label="Patterns" value={formatCount(stats?.patterns)} icon={Brain} />
          <StatCard label="Open gaps" value={formatCount(stats?.gapsOpen)} icon={CircleAlert} />
          <StatCard label="Events" value={formatCount(stats?.eventsTotal)} icon={History} />
          <StatCard label="Corrections" value={formatCount(stats?.corrections)} icon={FileSearch} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── learning timeline ── */}
        <Card className="rounded-xl">
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
              <History aria-hidden="true" className="size-4 text-primary" />
              Learning timeline
            </h3>
            {memory.loading && !memory.data ? (
              <SkeletonRows rows={4} />
            ) : timeline.length === 0 ? (
              <EmptyState
                icon={History}
                title="No learning history yet"
                hint="Every knowledge addition, correction, recommendation outcome and model event lands here."
                compact
              />
            ) : (
              <ol className="wedjat-scroll max-h-96 space-y-0 overflow-y-auto border-l-2 border-border pl-5">
                {timeline.map((t, i) => (
                  <li key={`${t.at}-${t.kind}-${i}`} className="relative pb-4 last:pb-0">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[31px] top-0"
                    >
                      <TimelineKindIcon kind={t.kind} />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatWhen(t.at)}
                      </span>
                      {t.platform ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t.platform}
                        </Badge>
                      ) : null}
                      {t.kind === "KNOWLEDGE_ADDED" && t.refId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[10px]"
                          onClick={() => {
                            setRecordInput(t.refId ?? "");
                            setRecordId(t.refId);
                          }}
                          aria-label="Trace provenance of this record"
                        >
                          <Link2 aria-hidden="true" className="size-3" />
                          Trace
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug">{t.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* ── provenance inspector ── */}
        <Card className="rounded-xl">
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Search aria-hidden="true" className="size-4 text-primary" />
              Why does WEDJAT know this?
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="provenance-record">Knowledge record id</Label>
              <div className="flex gap-2">
                <Input
                  id="provenance-record"
                  value={recordInput}
                  onChange={(e) => setRecordInput(e.target.value)}
                  placeholder="e.g. rec_000000… or paste from the timeline"
                  className="h-11 font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") search();
                  }}
                />
                <Button
                  type="button"
                  className="h-11 shrink-0 gap-1.5"
                  onClick={search}
                >
                  <Search aria-hidden="true" className="size-4" />
                  Trace
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Source document, lineage chain, fabric events and model usage —
                the full evidence trail for one statement.
              </p>
            </div>

            {provenance.loading ? (
              <SkeletonRows rows={3} />
            ) : provenance.error ? (
              <ErrorState
                message={provenance.error}
                onRetry={provenance.refresh}
                compact
              />
            ) : provenance.data ? (
              <ProvenancePanel provenance={provenance.data} />
            ) : (
              <EmptyState
                icon={FileSearch}
                title="No record traced yet"
                hint="Trace a record from the timeline or paste a record id above."
                compact
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── open knowledge gaps ── */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <CircleAlert aria-hidden="true" className="size-4 text-primary" />
            Open knowledge gaps
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatCount(gaps.length)}
            </span>
          </h3>
          {memory.loading && !memory.data ? (
            <SkeletonRows rows={2} />
          ) : gaps.length === 0 ? (
            <EmptyState
              icon={CircleAlert}
              title="No open gaps"
              hint="Unanswered questions and missing evidence surface here with a priority."
              compact
            />
          ) : (
            <ul className="wedjat-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
              {gaps.map((g) => (
                <li key={g.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={g.priority} />
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {g.gapType}
                    </Badge>
                    {g.platformSlug ? (
                      <Badge variant="outline" className="text-[10px]">
                        {g.platformSlug}
                      </Badge>
                    ) : null}
                    <StatusBadge status={g.status} pulse={false} />
                    <span className="ml-auto flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                      <CircleAlert aria-hidden="true" className="size-3" />
                      {formatCount(g.occurrences)}×
                    </span>
                  </div>
                  <p className="mt-1.5 break-words text-xs leading-snug text-muted-foreground">
                    {g.description}
                  </p>
                  {g.query ? (
                    <code className="mt-1 block break-all rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {g.query}
                    </code>
                  ) : null}
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                    first seen {formatWhen(g.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
