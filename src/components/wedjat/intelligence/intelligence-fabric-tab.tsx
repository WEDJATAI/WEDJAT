"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 2 "Event Fabric" (contract §3.2): filterable events list
// (platform/type/status/dead-letter via ?platform=&type=&status=&deadletter=),
// envelope detail dialog with expandable JSON result, replay per event
// (ADMIN+, AlertDialog confirm) and the DLQ section with resolve/replay.
// Polls every ~8s while mounted; 404s degrade to the friendly error state.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  Eye,
  Inbox,
  Play,
  TriangleAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  CriticalityBadge,
  EventStatusBadge,
  JsonBlock,
  LivePollBadge,
  RefreshButton,
  RoleGateChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  DEFAULT_FABRIC_FILTERS,
  EVENT_STATUS_FILTERS,
  FABRIC_ADMIN_ROLES,
  FABRIC_POLL_MS,
  fabricQuery,
  filtersActive,
  formatCount,
  type FabricFilters,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import type { DeadLetterDto, EventEnvelopeDto, EventFabricPayload } from "@/lib/wedjat/types";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-all text-right font-mono text-[11px]">
        {value ?? "—"}
      </span>
    </div>
  );
}

/** Envelope detail dialog (contract §3.2): full envelope + JSON result. */
function EventDetailDialog({
  event,
  onClose,
  onReplay,
  canReplay,
}: {
  event: EventEnvelopeDto | null;
  onClose: () => void;
  onReplay: (e: EventEnvelopeDto) => void;
  canReplay: boolean;
}) {
  return (
    <Dialog
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="wedjat-scroll max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {event ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 font-mono text-sm">
                {event.eventType}
                <Badge variant="outline" className="text-[10px]">
                  {event.sourcePlatform}
                </Badge>
                <EventStatusBadge status={event.status} />
                <CriticalityBadge criticality={event.criticality} />
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px]">
                {event.eventId}
              </DialogDescription>
            </DialogHeader>

            {event.processingError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
                />
                <p className="min-w-0 break-words text-red-700 dark:text-red-400">
                  {event.processingError}
                </p>
              </div>
            ) : null}

            <div className="grid gap-x-6 sm:grid-cols-2">
              <div>
                <Row label="Occurred at" value={event.occurredAt} />
                <Row label="Received at" value={event.receivedAt} />
                <Row label="Processed at" value={event.processedAt} />
                <Row label="Attempts" value={String(event.attempts)} />
                <Row label="Environment" value={event.sourceEnvironment} />
                <Row label="Schema version" value={event.schemaVersion} />
              </div>
              <div>
                <Row label="Source version" value={event.sourceVersion} />
                <Row label="Source commit" value={event.sourceCommit} />
                <Row label="Correlation id" value={event.correlationId} />
                <Row label="Causation id" value={event.causationId} />
                <Row label="Idempotency key" value={event.idempotencyKey} />
                <Row label="Replay of" value={event.replayOfId} />
              </div>
            </div>

            {event.resultSummary ? (
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
                  />
                  Processing result — JSON payload
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <JsonBlock value={event.resultSummary} label="resultSummary" />
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {canReplay ? (
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => onReplay(event)}
                >
                  <Play aria-hidden="true" className="size-3.5" />
                  Replay event
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** DLQ resolve dialog (ADMIN+): optional note + optional replay. */
function ResolveDialog({
  entry,
  onClose,
  onResolved,
}: {
  entry: DeadLetterDto | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [note, setNote] = useState("");
  const [replay, setReplay] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!entry || busy) return;
    setBusy(true);
    try {
      const body: { note?: string; replay?: boolean } = {};
      if (note.trim()) body.note = note.trim();
      if (replay) body.replay = true;
      await apiPost(`/api/fabric/deadletter/${encodeURIComponent(entry.id)}/resolve`, body);
      toast.success("Dead letter resolved", {
        description: replay
          ? `The event was re-dispatched for processing.`
          : `${entry.eventType} marked resolved.`,
      });
      setNote("");
      setReplay(false);
      onClose();
      onResolved();
    } catch (e) {
      toast.error("Resolve failed", { description: errMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {entry ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Inbox aria-hidden="true" className="size-4 text-primary" />
                Resolve dead letter
              </DialogTitle>
              <DialogDescription>
                {entry.eventType} from {entry.sourcePlatform} failed{" "}
                {entry.attempts} attempt{entry.attempts === 1 ? "" : "s"} (
                {entry.errorClass}).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="dlq-note">Resolution note (optional)</Label>
              <Textarea
                id="dlq-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. schema re-registered upstream; safe to retry"
                className="min-h-20"
                disabled={busy}
              />
            </div>
            <div className="flex items-start space-x-2">
              <Checkbox
                id="dlq-replay"
                checked={replay}
                onCheckedChange={(c) => setReplay(c === true)}
                disabled={busy}
              />
              <Label
                htmlFor="dlq-replay"
                className="cursor-pointer text-xs font-normal leading-snug text-muted-foreground"
              >
                Replay the event after resolving — re-dispatch it through the
                fabric (append-only: derived objects are re-created, history
                preserved).
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={resolve} disabled={busy}>
                {busy ? "Resolving…" : "Resolve"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function IntelligenceFabricTab({ role }: { role: string }) {
  const [filters, setFilters] = useState<FabricFilters>(DEFAULT_FABRIC_FILTERS);
  const [selected, setSelected] = useState<EventEnvelopeDto | null>(null);
  const [replayTarget, setReplayTarget] = useState<EventEnvelopeDto | null>(null);
  const [resolveTarget, setResolveTarget] = useState<DeadLetterDto | null>(null);
  const [replaying, setReplaying] = useState(false);

  const canMutate = FABRIC_ADMIN_ROLES.has(role);
  const query = useMemo(() => fabricQuery(filters), [filters]);
  const fabric = useApiData<EventFabricPayload>(`/api/fabric${query}`, {
    pollMs: FABRIC_POLL_MS,
  });

  const events = fabric.data?.events ?? [];
  const deadLetters = useMemo(() => {
    const list = fabric.data?.deadLetters ?? [];
    return [...list].sort((a, b) => Number(a.resolved) - Number(b.resolved));
  }, [fabric.data]);

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set((fabric.data?.stats.byType ?? []).map((t) => t.eventType)),
      ).sort(),
    [fabric.data],
  );
  const platformOptions = useMemo(
    () =>
      Array.from(
        new Set((fabric.data?.stats.byPlatform ?? []).map((p) => p.platform)),
      ).sort(),
    [fabric.data],
  );

  const replay = async () => {
    if (!replayTarget || replaying) return;
    setReplaying(true);
    try {
      const res = await apiPost<{ replayed: boolean; newRecordId: string }>(
        `/api/fabric/events/${encodeURIComponent(replayTarget.eventId)}/replay`,
      );
      toast.success("Event replayed", {
        description: `Append-only re-dispatch — new knowledge record ${res.newRecordId}.`,
      });
      setReplayTarget(null);
      fabric.refresh();
    } catch (e) {
      toast.error("Replay failed", { description: errMessage(e) });
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── toolbar + filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">Event fabric</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Append-only event envelopes — every dispatch is recorded.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LivePollBadge seconds={FABRIC_POLL_MS / 1000} />
          <RefreshButton
            onClick={fabric.refresh}
            loading={fabric.loading}
            ariaLabel="Refresh event fabric"
          />
          <RoleGateChip minRole="ADMIN" />
        </div>
      </div>

      <Card className="rounded-xl">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wide">Platform</Label>
              <Select
                value={filters.platform}
                onValueChange={(v) => setFilters((f) => ({ ...f, platform: v }))}
              >
                <SelectTrigger className="h-9" aria-label="Filter by platform">
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
              <Label className="text-[10px] uppercase tracking-wide">Type</Label>
              <Select
                value={filters.type}
                onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}
              >
                <SelectTrigger className="h-9" aria-label="Filter by event type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wide">Status</Label>
              <Select
                value={filters.status}
                onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger className="h-9" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "ALL" ? "All statuses" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center space-x-2 pb-2">
                <Checkbox
                  id="dead-only"
                  checked={filters.deadOnly}
                  onCheckedChange={(c) =>
                    setFilters((f) => ({ ...f, deadOnly: c === true }))
                  }
                />
                <Label
                  htmlFor="dead-only"
                  className="cursor-pointer text-xs font-normal text-muted-foreground"
                >
                  Dead-letter view
                </Label>
              </div>
              {filtersActive(filters) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 ml-auto"
                  onClick={() => setFilters(DEFAULT_FABRIC_FILTERS)}
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── events list ── */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Eye aria-hidden="true" className="size-4 text-primary" />
            Events
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatCount(events.length)}
            </span>
          </h3>

          {fabric.loading && !fabric.data ? (
            <SkeletonRows rows={5} />
          ) : fabric.error ? (
            <ErrorState message={fabric.error} onRetry={fabric.refresh} compact />
          ) : events.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={filtersActive(filters) ? "No events match these filters" : "No events yet"}
              hint={
                filtersActive(filters)
                  ? "Try resetting the filters — or events will appear as platforms push them."
                  : "Events arrive via POST /api/v1/events from authenticated service identities."
              }
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
                    <TableHead className="h-9 text-[10px]">Crit.</TableHead>
                    <TableHead className="h-9 text-[10px]">Status</TableHead>
                    <TableHead className="h-9 text-[10px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow
                      key={e.eventId}
                      className="cursor-pointer"
                      onClick={() => setSelected(e)}
                    >
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
                      <TableCell className="py-2 text-right">
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelected(e);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.stopPropagation();
                              setSelected(e);
                            }
                          }}
                          aria-label={`Open detail for ${e.eventType}`}
                        >
                          <Eye aria-hidden="true" className="size-3" />
                          Detail
                        </span>
                        {canMutate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-1 h-7 gap-1 px-2 text-[10px]"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setReplayTarget(e);
                            }}
                            aria-label={`Replay ${e.eventType}`}
                          >
                            <Play aria-hidden="true" className="size-3" />
                            Replay
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── dead letters ── */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
            <Archive aria-hidden="true" className="size-4 text-primary" />
            Dead letters (DLQ)
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatCount(deadLetters.filter((d) => !d.resolved).length)} open /{" "}
              {formatCount(deadLetters.length)} total
            </span>
            {!canMutate ? <RoleGateChip minRole="ADMIN" /> : null}
          </h3>

          {fabric.loading && !fabric.data ? (
            <SkeletonRows rows={2} />
          ) : deadLetters.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Dead letter queue is empty"
              hint="Events that exhaust their retries land here for operator resolution."
              compact
            />
          ) : (
            <ul className="wedjat-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
              {deadLetters.map((d) => (
                <li
                  key={d.id}
                  className={`rounded-lg border p-3 ${d.resolved ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-red-500/30 bg-red-500/10 font-mono text-[10px] text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400"
                    >
                      {d.errorClass}
                    </Badge>
                    <span className="font-mono text-xs">{d.eventType}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {d.sourcePlatform}
                    </Badge>
                    {d.resolved ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        RESOLVED
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="wedjat-pulse border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                      >
                        OPEN
                      </Badge>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {d.attempts} attempts
                      </span>
                      {canMutate && !d.resolved ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[10px]"
                          onClick={() => setResolveTarget(d)}
                          aria-label={`Resolve dead letter ${d.eventType}`}
                        >
                          Resolve
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words text-xs text-muted-foreground">
                    {d.reason}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                    first failed {formatWhen(d.firstFailedAt)} · last attempt{" "}
                    {formatWhen(d.lastAttemptAt)}
                    {d.resolutionNote ? ` · note: ${d.resolutionNote}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <EventDetailDialog
        event={selected}
        onClose={() => setSelected(null)}
        onReplay={(e) => {
          setSelected(null);
          setReplayTarget(e);
        }}
        canReplay={canMutate}
      />

      <ResolveDialog
        entry={resolveTarget}
        onClose={() => setResolveTarget(null)}
        onResolved={fabric.refresh}
      />

      {/* Replay confirmation (ADMIN+, destructive-adjacent — always confirmed) */}
      <AlertDialog
        open={replayTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReplayTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replay this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {replayTarget
                ? `${replayTarget.eventType} from ${replayTarget.sourcePlatform} will be re-dispatched through the fabric. Replay is append-only: derived objects are re-created and the event history (including this replay) is preserved.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={replaying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(ev) => {
              ev.preventDefault();
              void replay();
            }}>
              {replaying ? "Replaying…" : "Replay event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
