"use client";

// Section heading: micro-label eyebrow + title + optional description/actions.

import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  className,
  as: Tag = "section",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "header";
}) {
  return (
    <Tag className={cn("mb-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-0.5 text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </Tag>
  );
}
