"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — Tab 4 "Autonomy" (§151/§152).
//
// Level 0–5 selector (ADMIN+, AlertDialog confirmation with the §152
// governance list), capabilities table and the fixed amber "never
// autonomously overridden" governance card.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
  Check,
  Gauge,
  LoaderCircle,
  Minus,
  ShieldAlert,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import { INTAKE_AUTONOMY_ROLES } from "@/components/wedjat/intake/intake-helpers";
import { useApiData } from "@/hooks/use-api-data";
import { api, errMessage, formatWhen } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import {
  AUTONOMY_LEVELS,
  type AutonomyPayload,
} from "@/lib/wedjat/types";

export function IntakeAutonomyTab({ role }: { role: string }) {
  const autonomy = useApiData<AutonomyPayload>("/api/intake/autonomy");
  const canSet = INTAKE_AUTONOMY_ROLES.has(role);
  const [pendingLevel, setPendingLevel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const applyLevel = async () => {
    if (pendingLevel === null || busy) return;
    setBusy(true);
    try {
      const updated = await api<AutonomyPayload>("/api/intake/autonomy", {
        method: "PUT",
        body: JSON.stringify({ level: pendingLevel }),
      });
      toast.success("Autonomy level updated (§151)", {
        description: `${updated.label} — ${updated.description}`,
      });
      setPendingLevel(null);
      autonomy.refresh();
    } catch (e) {
      toast.error("Could not update autonomy", {
        description: errMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (autonomy.error && !autonomy.data) {
    return <ErrorState message={autonomy.error} onRetry={autonomy.refresh} />;
  }

  if (autonomy.loading && !autonomy.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading autonomy state…</p>
        <SkeletonRows rows={3} />
      </div>
    );
  }

  const data = autonomy.data;
  if (!data) return null;

  const pendingInfo =
    pendingLevel !== null
      ? AUTONOMY_LEVELS.find((l) => l.level === pendingLevel) ?? null
      : null;

  return (
    <div className="space-y-4">
      {/* current level summary */}
      <Card className="rounded-xl">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Gauge aria-hidden="true" className="size-4 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">
              {data.label}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.description}
            </p>
          </div>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            updated {formatWhen(data.updatedAt)}
          </span>
        </CardContent>
      </Card>

      {/* level cards */}
      <section aria-label="Autonomy levels" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Autonomy levels (§151)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {AUTONOMY_LEVELS.map((l) => {
            const isCurrent = l.level === data.level;
            const isPending = l.level === pendingLevel;
            const card = (
              <Card
                className={cn(
                  "rounded-xl transition-colors",
                  isCurrent && "border-primary/40",
                  isPending && !isCurrent && "border-amber-500/40",
                )}
              >
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold tracking-tight">
                      {l.label}
                    </p>
                    {isCurrent ? (
                      <Badge
                        variant="outline"
                        className="ml-auto border-primary/30 bg-primary/10 text-[10px] text-primary"
                      >
                        CURRENT
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {l.description}
                  </p>
                </CardContent>
              </Card>
            );
            return canSet ? (
              <button
                key={l.level}
                type="button"
                aria-label={`Set autonomy to ${l.label}`}
                onClick={() => setPendingLevel(l.level)}
                className="min-h-11 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {card}
              </button>
            ) : (
              <Tooltip key={l.level}>
                <TooltipTrigger asChild>
                  <div aria-disabled="true" className="cursor-not-allowed opacity-70">
                    {card}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Autonomy changes require OWNER or ADMIN role (§151).
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {canSet ? (
          <p className="text-xs text-muted-foreground">
            Select a level to apply — changes take effect for future runs and
            require confirmation.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Read-only: autonomy changes require OWNER or ADMIN role. The
            current level remains {data.label}.
          </p>
        )}
      </section>

      {/* capabilities */}
      <section aria-label="Autonomy capabilities" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Capabilities at the current level
        </h3>
        <Card className="rounded-xl">
          <CardContent className="p-0">
            <div className="wedjat-scroll overflow-x-auto">
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Capability</TableHead>
                    <TableHead>Min level</TableHead>
                    <TableHead className="text-right">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.capabilities ?? []).map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="text-xs">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        ≥ L{c.minLevel}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs font-medium",
                            c.enabled
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {c.enabled ? (
                            <>
                              <Check
                                aria-hidden="true"
                                className="size-3.5"
                              />
                              enabled
                            </>
                          ) : (
                            <>
                              <Minus aria-hidden="true" className="size-3.5" />
                              disabled
                            </>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* governance (§152) — fixed amber warning card */}
      <section aria-label="Autonomy governance" className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Governance (§152)
        </h3>
        <Card className="rounded-xl border-amber-500/40 bg-amber-500/5 dark:bg-amber-400/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert
                aria-hidden="true"
                className="size-4 text-amber-600 dark:text-amber-400"
              />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Never autonomously overridden
              </p>
            </div>
            <ul className="space-y-2">
              {(data.governance ?? []).map((g, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-card px-3 py-2 text-xs"
                >
                  <ShieldAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                  />
                  <span className="break-words text-amber-900/80 dark:text-amber-100/80">
                    {g}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-amber-700/70 dark:text-amber-400/70">
              Enforced at every autonomy level — L5 included. Human gates stay
              human.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* confirmation dialog */}
      <AlertDialog
        open={pendingLevel !== null}
        onOpenChange={(o) => {
          if (!o) setPendingLevel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Set autonomy to {pendingInfo?.label ?? `LEVEL ${pendingLevel}`}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{pendingInfo?.description}</p>
                <p className="text-xs font-medium text-foreground">
                  The §152 governance list is never autonomously overridden —
                  regardless of level:
                </p>
                <ul className="space-y-1.5">
                  {(data.governance ?? []).map((g, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-muted-foreground"
                    >
                      <ShieldAlert
                        aria-hidden="true"
                        className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400"
                      />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void applyLevel()}
            >
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Applying…
                </>
              ) : (
                "Apply level"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
