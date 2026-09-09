"use client";

// Login gate: real credential sign-in (username + password).
// The WEDJAT brand logo ships as a static asset. No demo identities, no
// password hints, no autofill — credentials are never displayed.

import { useState } from "react";
import { KeyRound, LoaderCircle, LogIn, ShieldCheck, UserRound } from "lucide-react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errMessage } from "@/lib/wedjat/client";
import type { Principal } from "@/lib/wedjat/types";

const FEATURES = [
  {
    title: "Versioned knowledge graph",
    text: "Platform blueprints, documents, sections and chunks — checksummed and time-scoped.",
  },
  {
    title: "Grounded, citable answers",
    text: "Every claim maps to [S1..Sn] sources with confidence and groundedness scoring.",
  },
  {
    title: "Controlled training lifecycle",
    text: "Datasets, runs and promotion gates — with an honest export path for real fine-tuning.",
  },
];

export function LoginView({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<Principal>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(username.trim(), password);
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
          <div className="relative overflow-hidden rounded-2xl border border-border shadow-lg">
            <Image
              src="/wedjat-logo.jpg"
              alt="WEDJAT AI logo — the Eye of Horus rendered as glowing circuitry"
              width={1344}
              height={768}
              priority
              sizes="(max-width: 1024px) 100vw, 576px"
              className="h-auto w-full"
            />
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
                  <ShieldCheck className="size-4.5" />
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
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
                  <Image
                    src="/wedjat-mark-sm.jpg"
                    alt=""
                    width={44}
                    height={44}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Sign in</h2>
                  <p className="text-xs text-muted-foreground">
                    WEDJAT organization access
                  </p>
                </div>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wedjat-username">Username or email</Label>
                  <div className="relative">
                    <UserRound
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      id="wedjat-username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Your username"
                      className="pl-9"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
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
                      placeholder="Your password"
                      className="pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
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
                  disabled={submitting || !username.trim() || !password}
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
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Training is simulated in this environment — inference runs on
            sanctioned providers.
          </p>
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
