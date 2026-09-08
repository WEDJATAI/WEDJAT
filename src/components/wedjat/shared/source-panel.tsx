"use client";

// Source references: collapsible source panel with rank chips, provenance,
// truncated previews and retrieval score bars. Also hosts the generation
// metadata row shared by Chat and Analysis views.

import { useState } from "react";
import { BookOpen, ChevronDown, Cpu, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatResponse, SourceRef } from "@/lib/wedjat/types";

const PREVIEW_LEN = 280;

export function SourceCard({
  source,
  defaultExpanded,
}: {
  source: SourceRef;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const truncated = source.content.length > PREVIEW_LEN;
  const preview = expanded
    ? source.content
    : source.content.slice(0, PREVIEW_LEN);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-label={`Source rank ${source.rank}`}
          className="wedjat-citation"
        >
          S{source.rank}
        </span>
        <span className="text-sm font-medium">
          {source.blueprintTitle}
        </span>
        <Badge variant="secondary" className="font-mono text-[10px]">
          v{source.blueprintVersion}
        </Badge>
        <StatusBadge status={source.blueprintVersionStatus} pulse={false} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{source.platformName}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{source.documentTitle}</span>
        <span aria-hidden="true">·</span>
        <span className="italic">{source.sectionHeading}</span>
      </p>
      <p
        className={cn(
          "mt-2 text-sm leading-relaxed text-foreground/90",
          !expanded && truncated && "line-clamp-4",
        )}
      >
        {preview}
        {truncated && !expanded ? "…" : ""}
      </p>
      {truncated ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {expanded ? "Show less" : "Show full chunk"}
        </button>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ScoreBar compact label="lexical" value={source.lexicalScore} />
        <ScoreBar compact label="semantic" value={source.semanticScore} />
        <ScoreBar compact label="rerank" value={source.rerankScore} />
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        effective {source.effectiveFrom.slice(0, 10)} · priority{" "}
        {source.sourcePriority} · {source.status}
      </p>
    </div>
  );
}

export function SourcePanel({
  sources,
  defaultOpen,
  className,
}: {
  sources: SourceRef[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  if (sources.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 w-full">
          <BookOpen className="size-3.5" aria-hidden="true" />
          Sources ({sources.length})
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="wedjat-scroll mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
          {sources.map((s) => (
            <SourceCard key={`${s.rank}-${s.chunkId}`} source={s} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── generation metadata row (chat answers + analysis reports) ──

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border bg-muted/50 px-2 py-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="max-w-48 truncate font-mono text-[11px]">{value}</span>
    </span>
  );
}

export function GenerationMeta({
  generation,
  className,
}: {
  generation: ChatResponse["generation"];
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Cpu aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          generation
        </span>
        <StatusBadge status={generation.status} pulse={false} />
        {generation.fallbackCount > 0 ? (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            {generation.fallbackCount} fallback
            {generation.fallbackCount > 1 ? "s" : ""}
          </Badge>
        ) : null}
        {generation.retryCount > 0 ? (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            {generation.retryCount} retr
            {generation.retryCount > 1 ? "ies" : "y"}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <MetaChip label="provider" value={generation.provider} />
        <MetaChip label="model" value={generation.model} />
        <MetaChip label="prompt" value={generation.promptVersion} />
        <MetaChip label="retriever" value={generation.retrieverVersion} />
        <MetaChip label="latency" value={`${generation.latencyMs} ms`} />
        <MetaChip
          label="tokens"
          value={`${generation.inputTokens} in / ${generation.outputTokens} out`}
        />
        <MetaChip
          label="cost"
          value={`$${generation.costEstimateUsd.toFixed(4)}`}
        />
      </div>
      {generation.fallbackChain.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Layers3
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            fallback chain
          </span>
          {generation.fallbackChain.map((m, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              ) : null}
              <span className="font-mono text-[11px] text-muted-foreground">
                {m}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
