"use client";

// Login gate: demo user picker (GET /api/auth/users) + password field.
// The demo password is `wedjat`.

import { useEffect, useState } from "react";
import {
  Eye,
  KeyRound,
  LoaderCircle,
  LogIn,
  Network,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RoleBadge } from "@/components/wedjat/shared/status-badge";
import { api, errMessage } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import type { LoginUserOption, Principal } from "@/lib/wedjat/types";

const FEATURES = [
  {
    icon: Network,
    title: "Versioned knowledge graph",
    text: "Platform blueprints, documents, sections and chunks — checksummed and time-scoped.",
  },
  {
    icon: ShieldCheck,
    title: "Grounded, citable answers",
    text: "Every claim maps to [S1..Sn] sources with confidence and groundedness scoring.",
  },
  {
    icon: Sparkles,
    title: "Controlled training lifecycle",
    text: "Datasets, runs and promotion gates — simulated honestly in this environment.",
  },
];

export function LoginView({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<Principal>;
}) {
  const [users, setUsers] = useState<LoginUserOption[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<LoginUserOption[]>("/api/auth/users")
      .then((u) => {
        if (cancelled) return;
        setUsers(u);
        setSelected((prev) => prev ?? u[0]?.email ?? null);
      })
      .catch((e) => {
        if (!cancelled) setUsersError(errMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !password.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(selected, password.trim());
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          aria-label="About WEDJAT"
          className="order-2 lg:order-1"
        >
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
            >
              <Eye className="size-6" />
            </div>
            <div>
              <p className="text-xl font-semibold tracking-wide">WEDJAT</p>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Domain AI
              </p>
            </div>
          </div>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight sm:text-3xl">
            Proprietary domain intelligence for your platform estate.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            RAG chat over versioned platform blueprints, CTO analysis
            workflows, training &amp; evaluation lifecycle, and full
            observability — behind your organization boundary.
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <div
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                >
                  <f.icon className="size-4.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {f.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-muted-foreground">
            WEDJAT DOMAIN AI v1.0 — Proprietary &amp; Confidential
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          aria-label="Sign in"
          className="order-1 lg:order-2"
        >
          <Card className="rounded-xl shadow-sm">
            <CardContent className="p-6">
              <h2 className="text-base font-semibold">Sign in</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a demo principal to explore role-based behavior.
              </p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Demo user
                  </Label>
                  {usersError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Could not load demo users</AlertTitle>
                      <AlertDescription>{usersError}</AlertDescription>
                    </Alert>
                  ) : users === null ? (
                    <div className="space-y-2" aria-label="Loading users">
                      <Skeleton className="h-14 rounded-lg" />
                      <Skeleton className="h-14 rounded-lg" />
                      <Skeleton className="h-14 rounded-lg" />
                    </div>
                  ) : users.length === 0 ? (
                    <Alert>
                      <AlertTitle>No demo users</AlertTitle>
                      <AlertDescription>
                        The backend has not seeded demo users yet.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label="Demo user"
                      className="wedjat-scroll max-h-64 space-y-2 overflow-y-auto pr-1"
                    >
                      {users.map((u) => (
                        <button
                          key={u.email}
                          type="button"
                          role="radio"
                          aria-checked={selected === u.email}
                          onClick={() => setSelected(u.email)}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                            selected === u.email
                              ? "border-primary/50 bg-primary/10"
                              : "border-border hover:bg-accent",
                          )}
                        >
                          <UserRound
                            aria-hidden="true"
                            className={cn(
                              "size-4 shrink-0",
                              selected === u.email
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {u.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.email}
                            </span>
                          </span>
                          <RoleBadge role={u.role} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wedjat-password">Password</Label>
                  <div className="relative">
                    <KeyRound
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      id="wedjat-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="demo password: wedjat"
                      className="pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      All demo accounts share the password{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        wedjat
                      </code>
                      .
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setPassword("wedjat")}
                    >
                      <Wand2 className="size-3.5" aria-hidden="true" />
                      Fill demo password
                    </Button>
                  </div>
                </div>

                {error ? (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>Sign-in failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full"
                  disabled={submitting || !selected || !password.trim()}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Signing in…
                    </>
                  ) : (
                    <>
                      <LogIn className="size-4" aria-hidden="true" />
                      Sign in
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
            >
              SIMULATED
            </Badge>
            <p className="text-xs text-muted-foreground">
              Training is simulated in this environment.
            </p>
          </div>
        </motion.section>
      </main>
      <footer className="mt-auto border-t bg-background px-4 py-3 pb-[env(safe-area-inset-bottom)] text-xs text-muted-foreground">
        <p className="mx-auto max-w-6xl">
          WEDJAT DOMAIN AI v1.0 — Proprietary &amp; Confidential · Training is
          simulated in this environment.
        </p>
      </footer>
    </div>
  );
}
