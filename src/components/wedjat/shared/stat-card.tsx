"use client";

// Stat card for dashboard / observability metric rows — Night Eye
// edition: luminous top edge, laser icon chip, hover glow.

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  accent,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "wedjat-panel rounded-xl border shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:shadow-[0_0_28px_-14px_var(--wedjat-laser)]",
        accent && "border-primary/40",
        className,
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 truncate font-mono text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {Icon ? (
          <div
            aria-hidden="true"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg border",
              accent
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 bg-muted/60 text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
