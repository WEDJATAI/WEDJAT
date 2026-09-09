"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 5 "Patterns" (contract §3.5): cross-platform reusable
// patterns as cards — type icon, platform chips (preserving source identity),
// per-platform evidence list with record links, confidence bar.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import {
  ChevronRight,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  PatternStatusBadge,
  PatternTypeIcon,
  RefreshButton,
} from "@/components/wedjat/intelligence/intelligence-bits";
import { formatWhen } from "@/lib/wedjat/client";
import { toRatio } from "@/components/wedjat/intelligence/intelligence-helpers";
import { useApiData } from "@/hooks/use-api-data";
import type { PatternDto } from "@/lib/wedjat/types";

function PatternCard({ pattern }: { pattern: PatternDto }) {
  const confidence = toRatio(pattern.confidence);
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            title={pattern.patternType}
          >
            <PatternTypeIcon type={pattern.patternType} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug">{pattern.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {pattern.patternType} · {formatWhen(pattern.createdAt)}
            </p>
          </div>
          <PatternStatusBadge status={pattern.status} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {pattern.description}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Platforms
          </span>
          {pattern.platforms.map((p) => (
            <Badge key={p} variant="outline" className="text-[10px]">
              {p}
            </Badge>
          ))}
        </div>

        <ScoreBar label="Confidence" value={confidence} compact />

        {pattern.evidence.length > 0 ? (
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
              />
              Evidence ({pattern.evidence.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="wedjat-scroll max-h-64 space-y-2 overflow-y-auto pt-2">
              {pattern.evidence.map((ev, i) => (
                <div
                  key={`${pattern.id}-ev-${i}`}
                  className="rounded-lg border bg-card p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {ev.platform}
                    </Badge>
                    {ev.version ? (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] text-muted-foreground"
                      >
                        {ev.version}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-xs leading-snug">{ev.statement}</p>
                  <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/80">
                    {ev.recordId}
                  </code>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IntelligencePatternsTab() {
  const patterns = useApiData<{ patterns: PatternDto[] }>("/api/fabric/patterns");
  const rows = patterns.data?.patterns ?? [];
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            Organizational patterns
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reusable lessons confirmed across platforms — each keeps its source
            identity and evidence trail.
          </p>
        </div>
        <RefreshButton
          onClick={patterns.refresh}
          loading={patterns.loading}
          ariaLabel="Refresh patterns"
        />
      </div>

      {patterns.loading && !patterns.data ? (
        <SkeletonRows rows={4} />
      ) : patterns.error ? (
        <ErrorState message={patterns.error} onRetry={patterns.refresh} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No patterns yet"
          hint="Patterns crystallize when the same lesson is confirmed by evidence from multiple platforms."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sorted.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      )}
    </div>
  );
}
