"use client";

// Labeled horizontal score bar for 0..1 metrics
// (lexical / semantic / rerank / confidence / groundedness / recall …).

import { cn } from "@/lib/utils";

export function scoreColor(value: number): string {
  if (value >= 0.7) return "bg-emerald-500";
  if (value >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

export function ScoreBar({
  label,
  value,
  tone,
  className,
  compact,
}: {
  label: string;
  value: number | null | undefined;
  tone?: "auto" | "primary";
  className?: string;
  compact?: boolean;
}) {
  const v =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : null;
  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "mb-1 flex items-baseline justify-between gap-2",
          compact && "mb-0.5",
        )}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {v === null ? "—" : v.toFixed(2)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label}: ${v === null ? "not available" : v.toFixed(2)}`}
        aria-valuenow={v === null ? undefined : v}
        aria-valuemin={0}
        aria-valuemax={1}
        className={cn(
          "w-full overflow-hidden rounded-full bg-muted",
          compact ? "h-1" : "h-1.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            tone === "primary"
              ? "bg-primary"
              : v === null
                ? "bg-muted"
                : scoreColor(v),
          )}
          style={{ width: v === null ? "0%" : `${Math.round(v * 100)}%` }}
        />
      </div>
    </div>
  );
}
