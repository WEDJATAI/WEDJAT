"use client";

// WEDJAT DOMAIN AI application shell: top bar (brand, theme toggle, user
// menu), left sidebar nav on desktop, mobile sheet + horizontal scrollable
// nav, main content area, and the sticky confidentiality footer.

import { useState, useSyncExternalStore } from "react";
import {
  Activity,
  Boxes,
  ClipboardCheck,
  DatabaseZap,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  MessagesSquare,
  Microscope,
  Moon,
  Search,
  Settings2,
  Share2,
  Sun,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { RoleBadge } from "@/components/wedjat/shared/status-badge";
import { cn } from "@/lib/utils";
import type { Principal } from "@/lib/wedjat/types";

export type ViewId =
  | "dashboard"
  | "chat"
  | "knowledge"
  | "intake"
  | "intelligence"
  | "analysis"
  | "search"
  | "training"
  | "evaluation"
  | "models"
  | "observability"
  | "settings";

interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", hint: "Fleet overview", icon: LayoutDashboard },
  { id: "chat", label: "Domain Chat", hint: "Grounded RAG Q&A", icon: MessagesSquare },
  { id: "knowledge", label: "Knowledge Base", hint: "Blueprints & ingestion", icon: Library },
  { id: "intake", label: "Database Intake", hint: "Auto platform ingestion", icon: DatabaseZap },
  { id: "intelligence", label: "Intelligence", hint: "Event fabric & learning", icon: Share2 },
  { id: "analysis", label: "Analysis", hint: "CTO workflows", icon: Microscope },
  { id: "search", label: "Search Lab", hint: "Retrieval tuning", icon: Search },
  { id: "training", label: "Training", hint: "Datasets & runs", icon: GraduationCap },
  { id: "evaluation", label: "Evaluations", hint: "Suites & results", icon: ClipboardCheck },
  { id: "models", label: "Model Registry", hint: "Versions & promotion", icon: Boxes },
  { id: "observability", label: "Observability", hint: "Health & audit", icon: Activity },
  { id: "settings", label: "Settings", hint: "Account, users & providers", icon: Settings2 },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white"
      >
        <Image
          src="/wedjat-mark-sm.jpg"
          alt=""
          width={36}
          height={36}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-wide">WEDJAT</div>
        <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Domain AI
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Hydration-safe "mounted" flag without setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={
        mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        )
      ) : (
        <span className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function UserMenu({ principal, onLogout }: { principal: Principal; onLogout: () => void }) {
  const openAccess = principal.authMethod === "OPEN_ACCESS";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-11 gap-2 px-2"
          aria-label="Open user menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
              {initials(principal.name) || "W"}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {principal.name}
          </span>
          {openAccess ? (
            <Badge
              variant="outline"
              className="hidden border-amber-500/40 text-[10px] font-semibold uppercase tracking-wide text-amber-600 md:inline"
              title="Credential login is temporarily disabled; you are signed in as the organization OWNER"
            >
              Open access
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-semibold">{principal.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {principal.email}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <RoleBadge role={principal.role} />
            <span className="truncate text-xs text-muted-foreground">
              {principal.org.name}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {openAccess ? (
          <div className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
            Open access mode is active — credential login is temporarily
            disabled and you are operating as the organization OWNER. Re-enable
            sign-in by archiving the <code>access.mode</code> setting.
          </div>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={onLogout}
            className="h-10 cursor-pointer"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesktopNav({
  view,
  onViewChange,
}: {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
}) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            aria-current={active ? "page" : undefined}
            title={item.hint}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate text-left">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function MobileNavRow({
  view,
  onViewChange,
}: {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="wedjat-scroll flex gap-2 overflow-x-auto border-b px-4 py-2 lg:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function MobileNavSheet({
  view,
  onViewChange,
}: {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle asChild>
            <div className="flex items-center justify-between">
              <Brand />
              <span className="sr-only">WEDJAT navigation</span>
            </div>
          </SheetTitle>
        </SheetHeader>
        <DesktopNav
          view={view}
          onViewChange={(v) => {
            onViewChange(v);
            setOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

export function AppShell({
  principal,
  view,
  onViewChange,
  onLogout,
  children,
}: {
  principal: Principal;
  view: ViewId;
  onViewChange: (v: ViewId) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
          <MobileNavSheet view={view} onViewChange={onViewChange} />
          <Brand />
          <Badge
            variant="outline"
            className="ml-1 hidden border-amber-500/40 bg-amber-500/10 text-[10px] font-medium tracking-wide text-amber-700 dark:text-amber-400 md:inline-flex"
          >
            SIM ENV
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu principal={principal} onLogout={onLogout} />
          </div>
        </div>
        <MobileNavRow view={view} onViewChange={onViewChange} />
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 px-0 sm:px-6">
        <aside className="sticky top-[3.5rem] hidden max-h-[calc(100vh-3.5rem)] w-60 shrink-0 self-start overflow-y-auto border-r bg-sidebar lg:block wedjat-scroll">
          <DesktopNav view={view} onViewChange={onViewChange} />
          <div className="mt-2 border-t p-3">
            <p className="rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">WEDJAT</span> is
              the eye of Horus — every answer is grounded in versioned,
              checksummed platform blueprints.
            </p>
          </div>
        </aside>
        <main
          id="main-content"
          className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:pl-6 lg:pr-8"
        >
          <div className="mx-auto w-full">{children}</div>
        </main>
      </div>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-3 pb-[env(safe-area-inset-bottom)] text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>WEDJAT DOMAIN AI v1.0 — Proprietary &amp; Confidential</p>
          <p className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
            >
              SIMULATED
            </Badge>
            Training &amp; fine-tuning are simulated in this environment — no
            GPU workloads run.
          </p>
        </div>
      </footer>
    </div>
  );
}
