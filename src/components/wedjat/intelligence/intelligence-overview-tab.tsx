"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 1 "Overview" (contract §3.1): fabric stats cards (events,
// processed/failed/dead, DLQ, patterns, gaps, corrections), recent events
// table with criticality badges, top types / platforms distribution, and the
// ADMIN+ knowledge bundle export (GET /api/fabric/export).
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Archive,
  Ban,
  BookOpen,
  CircleAlert,
  CircleCheck,
  Download,
  PencilLine,
  Shapes,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  ErrorState,
  SkeletonGrid,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { StatCard } from "@/components/wedjat/shared/stat-card";
import {
  CriticalityBadge,
  EventStatusBadge,
  LivePollBadge,
  RefreshButton,
  RoleGateChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  FABRIC_ADMIN_ROLES,
  FABRIC_POLL_MS,
  formatCount,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { apiText, errMessage, formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import type { EventFabricPayload, MemoryInspectorPayload } from "@/lib/wedjat/types";

export function IntelligenceOverviewTab({ role }: { role: string }) {
  // Fabric stats + recent events, polled while the tab is mounted (~8s).
  const fabric = useApiData<EventFabricPayload>("/api/fabric", {
    pollMs: FABRIC_POLL_MS,
  });
  // Memory stats supply the patterns / gaps / corrections cards.
  const memory = useApiData<MemoryInspectorPayload>("/api/fabric/memory");

  const [exporting, setExporting] = useState(false);
  const canExport = FABRIC_ADMIN_ROLES.has(role);

  const stats = fabric.data?.stats;
  const mstats = memory.data?.stats;
  const recent = (fabric.data?.events ?? []).slice(0, 10);
  const byType = (stats?.byType ?? []).slice(0, 6);
  const byPlatform = (stats?.byPlatform ?? []).slice(0, 6);
  const maxTypeCount = Math.max(1, ...byType.map((t) => t.count));

  const downloadExport = async () => {
    if (!canExport || exporting) return;
    setExporting(true);
    try {
      const res = await apiText("/api/fabric/export");
      const blob = new Blob([res.text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        res.filename ??
        `wedjat-knowledge-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Knowledge bundle exported", {
        description:
          "Non-destructive download — every record keeps its lineage, events and model usage.",
      });
    } catch (e) {
      toast.error("Export failed", { description: errMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            Fabric overview
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Event-driven learning across the platform estate — live totals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LivePollBadge seconds={FABRIC_POLL_MS / 1000} />
          <RefreshButton
            onClick={() => {
              fabric.refresh();
              memory.refresh();
            }}
            loading={fabric.loading || memory.loading}
            ariaLabel="Refresh intelligence overview"
          />
          {canExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={downloadExport}
              disabled={exporting}
            >
              <Download
                aria-hidden="true"
                className={exporting ? "size-3.5 animate-pulse" : "size-3.5"}
              />
              {exporting ? "Exporting…" : "Export bundle"}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled>
                    <Download aria-hidden="true" className="size-3.5" />
                    Export bundle
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Knowledge bundle export requires ADMIN+</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── stats cards (single load/error gate for the whole fabric section) ── */}
      {fabric.loading && !fabric.data ? (
        <div className="space-y-4">
          <SkeletonGrid count={8} />
          <SkeletonRows rows={4} />
        </div>
      ) : fabric.error ? (
        <ErrorState message={fabric.error} onRetry={fabric.refresh} />
      ) : (
        <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <StatCard label="Events" value={formatCount(stats?.total)} icon={Activity} hint="All fabric events" />
          <StatCard label="Processed" value={formatCount(stats?.processed)} icon={CircleCheck} accent hint="Dispatched to knowledge" />
          <StatCard label="Failed" value={formatCount(stats?.failed)} icon={XCircle} hint="Retries pending" />
          <StatCard label="Dead" value={formatCount(stats?.dead)} icon={Ban} hint="Exhausted retries" />
          <StatCard label="Dead letters" value={formatCount(fabric.data?.deadLetters.filter((d) => !d.resolved).length)} icon={Archive} hint="Unresolved DLQ entries" />
          <StatCard label="Patterns" value={formatCount(mstats?.patterns)} icon={Shapes} hint="Cross-platform patterns" />
          <StatCard label="Open gaps" value={formatCount(mstats?.gapsOpen)} icon={CircleAlert} hint="Knowledge gaps to close" />
          <StatCard label="Corrections" value={formatCount(mstats?.corrections)} icon={PencilLine} hint="Feedback corrections" />
        </div>

        {memory.error && !memory.data ? (
          <ErrorState message={memory.error} onRetry={memory.refresh} compact />
        ) : null}

        {/* ── recent events + distribution ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-xl lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Activity aria-hidden="true" className="size-4 text-primary" />
                Recent events
              </h3>
              <RoleGateChip minRole="ADMIN" />
            </div>

            {fabric.loading ? (
              <SkeletonRows rows={4} />
            ) : recent.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No events yet"
                hint="Platforms push events through POST /api/v1/events with a service identity key."
                compact
              />
            ) : (
              <div className="wedjat-scroll max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-[10px]">Occurred</TableHead>
                      <TableHead className="h-9 text-[10px]">Type</TableHead>
                      <TableHead className="h-9 text-[10px]">Platform</TableHead>
                      <TableHead className="h-9 text-[10px]">Criticality</TableHead>
                      <TableHead className="h-9 text-[10px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((e) => (
                      <TableRow key={e.eventId}>
                        <TableCell className="whitespace-nowrap py-2 font-mono text-[11px] text-muted-foreground">
                          {formatWhen(e.occurredAt)}
                        </TableCell>
                        <TableCell className="py-2 font-mono text-xs">
                          {e.eventType}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {e.sourcePlatform}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          <CriticalityBadge criticality={e.criticality} />
                        </TableCell>
                        <TableCell className="py-2">
                          <EventStatusBadge status={e.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Shapes aria-hidden="true" className="size-4 text-primary" />
                Top event types
              </h3>
              {fabric.loading && !fabric.data ? (
                <SkeletonRows rows={3} />
              ) : byType.length === 0 ? (
                <p className="text-xs text-muted-foreground">No typed events yet.</p>
              ) : (
                <ul className="space-y-2">
                  {byType.map((t) => (
                    <li key={t.eventType} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px]">
                          {t.eventType}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {formatCount(t.count)}
                        </span>
                      </div>
                      <div
                        role="meter"
                        aria-label={`${t.eventType}: ${t.count} events`}
                        aria-valuenow={t.count}
                        aria-valuemin={0}
                        aria-valuemax={maxTypeCount}
                        className="h-1 w-full overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.round((t.count / maxTypeCount) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
                <BookOpen aria-hidden="true" className="size-4 text-primary" />
                Events by platform
              </h3>
              {fabric.loading && !fabric.data ? (
                <SkeletonRows rows={3} />
              ) : byPlatform.length === 0 ? (
                <p className="text-xs text-muted-foreground">No platform events yet.</p>
              ) : (
                <ul className="wedjat-scroll max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {byPlatform.map((p) => (
                    <li
                      key={p.platform}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5"
                    >
                      <Badge variant="outline" className="text-[10px]">
                        {p.platform}
                      </Badge>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatCount(p.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        </div>
        </>
      )}
    </div>
  );
}
