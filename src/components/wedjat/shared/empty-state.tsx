"use client";

// Shared loading / error / empty states used across all views.

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  compact,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center",
        compact ? "p-4" : "p-10",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon className={compact ? "size-4" : "size-6"} />
      </div>
      <div>
        <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
          {title}
        </p>
        {hint ? (
          <p
            className={cn(
              "mt-1 max-w-sm text-muted-foreground",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {hint}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  compact,
  className,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Card
      role="alert"
      className={cn(
        "border-red-500/40 bg-red-500/5 dark:bg-red-400/5",
        compact && "border-dashed shadow-none",
        className,
      )}
    >
      <CardContent
        className={cn("flex items-start gap-3", compact ? "p-3" : "p-4")}
      >
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Something went wrong
          </p>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">
            {message}
          </p>
        </div>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SkeletonGrid({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[86px] rounded-xl" />
      ))}
    </div>
  );
}

export function SkeletonRows({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
