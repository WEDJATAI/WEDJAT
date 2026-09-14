"use client";

// Section heading: circuit-node eyebrow + monumental display title +
// optional description/actions. The eyebrow tick echoes the logo's
// PCB trace terminals.

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
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <span
                aria-hidden="true"
                className="wedjat-fill inline-block h-2.5 w-0.5 rounded-full"
              />
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </Tag>
  );
}
