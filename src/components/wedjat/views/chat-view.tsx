"use client";

// THE core screen: grounded RAG chat over versioned platform blueprints.
// Scope selectors (platform/blueprint/version, all optional with Auto),
// markdown thread with [S1..Sn] citations, confidence + groundedness,
// generation metadata, source panels, and 8-label feedback controls.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Eye,
  LoaderCircle,
  MessagesSquare,
  MessageSquarePlus,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBlueprintScope } from "@/hooks/use-blueprint-scope";
import { apiPost, errMessage } from "@/lib/wedjat/client";
import { cn } from "@/lib/utils";
import { GenerationMeta, SourcePanel } from "@/components/wedjat/shared/source-panel";
import { ScoreBar } from "@/components/wedjat/shared/score-bar";
import {
  FEEDBACK_LABELS,
  FeedbackLabelBadge,
} from "@/components/wedjat/shared/status-badge";
import { StatusBadge } from "@/components/wedjat/shared/status-badge";
import type { ChatResponse } from "@/lib/wedjat/types";

const PENDING_PHASES = [
  "Resolving scope…",
  "Retrieving evidence…",
  "Reasoning over sources…",
  "Composing a grounded answer…",
];

interface AssistantMessage {
  id: string;
  role: "assistant";
  content: string;
  response: ChatResponse;
  feedbackGiven?: { label: string };
}

type ThreadMessage =
  | { id: string; role: "user"; content: string }
  | AssistantMessage;

const AUTO = "auto";

/** Turn `[S1]` markers into internal links so they render as citation chips. */
function withCitationLinks(md: string): string {
  return md.replace(/\[S(\d+)\]/g, (_, d: string) => `[S${d}](#cite-${d})`);
}

function CitationLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  if (href && href.startsWith("#cite-")) {
    return (
      <span className="wedjat-citation" title={`Source ${href.replace("#cite-", "")}`}>
        {children}
      </span>
    );
  }
  return <a href={href}>{children}</a>;
}

function confidenceTone(level: string) {
  if (level === "HIGH")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (level === "MEDIUM")
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400";
}

function ScopeLine({ scope }: { scope: ChatResponse["scope"] }) {
  const parts: string[] = [];
  if (scope.platformName) parts.push(scope.platformName);
  if (scope.blueprintTitle) parts.push(scope.blueprintTitle);
  if (scope.blueprintVersion) parts.push(`v${scope.blueprintVersion}`);
  if (parts.length === 0) parts.push("no scope");
  parts.push(scope.resolution.toLowerCase());
  return (
    <p className="text-[11px] text-muted-foreground">
      scope: {parts.join(" · ")}
    </p>
  );
}

function FeedbackControls({
  message,
  onSubmitted,
}: {
  message: AssistantMessage;
  onSubmitted: (id: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string>("CORRECT");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preset, setPreset] = useState<"positive" | "negative" | null>(null);

  if (message.feedbackGiven) {
    return (
      <div className="flex items-center gap-2">
        <FeedbackLabelBadge label={message.feedbackGiven.label} />
        <span className="text-[11px] text-muted-foreground">
          feedback recorded
        </span>
      </div>
    );
  }

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiPost("/api/feedback", {
        generationId: message.response.generationId,
        label,
        comment: comment.trim() || undefined,
      });
      toast.success("Feedback recorded", {
        description: `Label ${label} attached to generation ${message.response.generationId.slice(0, 8)}…`,
      });
      onSubmitted(message.id, label);
    } catch (e) {
      toast.error("Could not submit feedback", {
        description: errMessage(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">was this grounded?</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Give positive feedback"
          onClick={() => {
            setPreset("positive");
            setLabel("CORRECT");
            setOpen(true);
          }}
        >
          <ThumbsUp className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Give negative feedback"
          onClick={() => {
            setPreset("negative");
            setLabel("INCORRECT");
            setOpen(true);
          }}
        >
          <ThumbsDown className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent>
          <div className="space-y-2 rounded-lg border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              {preset === "positive" ? (
                <ThumbsUp className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : preset === "negative" ? (
                <ThumbsDown className="size-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
              ) : null}
              <Label htmlFor={`fb-label-${message.id}`} className="text-xs text-muted-foreground">
                Feedback label
              </Label>
            </div>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger id={`fb-label-${message.id}`} className="h-9 w-full" aria-label="Feedback label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_LABELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment (what was right or wrong?)"
              className="min-h-16 text-sm"
              aria-label="Feedback comment"
            />
            <Button size="sm" className="h-9" onClick={submit} disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Submit feedback
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function AssistantBubble({
  message,
  onFeedbackSubmitted,
}: {
  message: AssistantMessage;
  onFeedbackSubmitted: (id: string, label: string) => void;
}) {
  const r = message.response;
  const warn =
    r.insufficientEvidence || r.blockedPatterns.length > 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex gap-3"
    >
      <div
        aria-hidden="true"
        className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <Eye className="size-4" />
      </div>
      <Card className="min-w-0 flex-1 rounded-xl">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/10 text-primary"
            >
              {r.intent}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn("cursor-help", confidenceTone(r.confidence.level))}
                >
                  confidence {r.confidence.level} · {r.confidence.score.toFixed(2)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72">
                <p className="mb-1 font-semibold">Confidence derivation</p>
                <ul className="list-disc space-y-0.5 pl-4 text-left">
                  {r.confidence.signals.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
            {r.generation.status === "DEGRADED" ? (
              <StatusBadge status="DEGRADED" pulse={false} />
            ) : null}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {r.traceId.slice(0, 14)}…
            </span>
          </div>
          <ScopeLine scope={r.scope} />

          {warn ? (
            <div className="space-y-2">
              {r.insufficientEvidence ? (
                <Alert className="border-amber-500/40 bg-amber-500/5">
                  <ShieldAlert aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
                  <AlertTitle>Insufficient evidence</AlertTitle>
                  <AlertDescription>
                    The system refused to answer to avoid hallucination. The
                    answer below explains what evidence is missing.
                  </AlertDescription>
                </Alert>
              ) : null}
              {r.blockedPatterns.length > 0 ? (
                <Alert variant="destructive">
                  <ShieldAlert aria-hidden="true" />
                  <AlertTitle>Blocked patterns detected</AlertTitle>
                  <AlertDescription>
                    {r.blockedPatterns.join(", ")}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <div className="wedjat-prose">
            <Markdown components={{ a: CitationLink }}>
              {withCitationLinks(message.content)}
            </Markdown>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <ScoreBar
              label="groundedness"
              value={r.groundedness}
            />
            <FeedbackControls
              message={message}
              onSubmitted={onFeedbackSubmitted}
            />
          </div>

          <SourcePanel sources={r.sources} />
          <GenerationMeta generation={r.generation} />
        </CardContent>
      </Card>
    </motion.div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex justify-end"
    >
      <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm sm:max-w-[75%]">
        {content}
      </div>
    </motion.div>
  );
}

function PendingBubble() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setPhase((p) => (p + 1) % PENDING_PHASES.length),
      1600,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-3" aria-live="polite" aria-label="Assistant is working">
      <div
        aria-hidden="true"
        className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <Eye className="size-4" />
      </div>
      <Card className="rounded-xl">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex gap-1" aria-hidden="true">
            <span className="wedjat-dot size-1.5 rounded-full bg-primary" />
            <span className="wedjat-dot size-1.5 rounded-full bg-primary" />
            <span className="wedjat-dot size-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-sm text-muted-foreground">
            {PENDING_PHASES[phase]}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

const EXAMPLES = [
  "What is the current authentication architecture?",
  "Summarize the resilience posture of the most critical platform.",
  "Which blueprint sections mention data classification rules?",
  "What changed in the latest blueprint version?",
];

export function ChatView() {
  const scope = useBlueprintScope();
  const [version, setVersion] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const versions = scope.detail.data?.versions ?? [];

  useEffect(() => {
    setVersion(null);
  }, [scope.blueprintSlug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  const newConversation = () => {
    setMessages([]);
    setConversationId(null);
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setPending(true);
    const optimisticId = crypto.randomUUID();
    setMessages((m) => [...m, { id: optimisticId, role: "user", content: text }]);
    try {
      const res = await apiPost<ChatResponse>("/api/chat", {
        message: text,
        conversationId: conversationId ?? undefined,
        platform: scope.platformSlug ?? undefined,
        blueprint: scope.blueprintSlug ?? undefined,
        version: version ?? undefined,
      });
      setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: res.answer,
          response: res,
        },
      ]);
    } catch (err) {
      setMessages((m) => m.filter((msg) => msg.id !== optimisticId));
      setInput(text);
      toast.error("Chat request failed", { description: errMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const onFeedbackSubmitted = (id: string, label: string) => {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id && msg.role === "assistant"
          ? { ...msg, feedbackGiven: { label } }
          : msg,
      ),
    );
  };

  const scopeError = useMemo(() => {
    if (scope.platforms.error && !scope.platforms.data)
      return scope.platforms.error;
    if (scope.blueprints.error && !scope.blueprints.data)
      return scope.blueprints.error;
    return null;
  }, [scope.platforms.error, scope.platforms.data, scope.blueprints.error, scope.blueprints.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Grounded RAG
          </p>
          <h1 className="mt-0.5 text-base font-semibold tracking-tight">
            Domain Chat
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={newConversation}
          disabled={messages.length === 0 && !conversationId}
        >
          <MessageSquarePlus className="size-3.5" aria-hidden="true" />
          New conversation
        </Button>
      </div>

      {scopeError ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Could not load scope options</AlertTitle>
          <AlertDescription>{scopeError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-xl">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Platform
            </Label>
            <Select
              value={scope.platformSlug ?? AUTO}
              onValueChange={(v) => scope.setPlatform(v === AUTO ? null : v)}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Platform scope">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>
                  <span className="text-muted-foreground">Auto — all platforms</span>
                </SelectItem>
                {(scope.platforms.data ?? []).map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Blueprint
            </Label>
            <Select
              value={scope.blueprintSlug ?? AUTO}
              onValueChange={(v) => scope.setBlueprint(v === AUTO ? null : v)}
              disabled={scope.blueprints.loading && !scope.blueprints.data}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Blueprint scope">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>
                  <span className="text-muted-foreground">Auto — all blueprints</span>
                </SelectItem>
                {(scope.blueprints.data ?? []).map((b) => (
                  <SelectItem key={b.slug} value={b.slug}>
                    {b.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Version
            </Label>
            <Select
              value={version ?? AUTO}
              onValueChange={(v) => setVersion(v === AUTO ? null : v)}
              disabled={!scope.selectedBlueprint}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Blueprint version scope">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>
                  <span className="text-muted-foreground">Auto — current version</span>
                </SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.version}>
                    {v.version} · {v.status.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {scope.selectedBlueprint && scope.detail.error ? (
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Version list unavailable: {scope.detail.error}
            </p>
          ) : null}
          {conversationId ? (
            <p className="font-mono text-[10px] text-muted-foreground sm:col-span-3">
              conversation {conversationId}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {messages.length === 0 && !pending ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-10 text-center">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <MessagesSquare className="size-7" />
          </div>
          <div>
            <p className="text-sm font-semibold">Ask the domain</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Every answer is grounded in the current, versioned blueprint
              corpus — citations [S1..Sn] map to retrieved chunks.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setInput(ex)}
                className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="space-y-5"
          role="log"
          aria-label="Conversation thread"
          aria-live="polite"
        >
          <AnimatePresence initial={false}>
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble
                  key={m.id}
                  message={m}
                  onFeedbackSubmitted={onFeedbackSubmitted}
                />
              ),
            )}
            {pending ? <PendingBubble key="pending" /> : null}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>
      )}

      <form
        onSubmit={send}
        className="sticky bottom-4 z-10 rounded-xl border bg-background/90 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75"
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about platform architecture, resilience, standards… (Enter to send, Shift+Enter for a new line)"
            aria-label="Chat message"
            className="wedjat-scroll max-h-44 min-h-11 flex-1 resize-none"
            rows={2}
            disabled={pending}
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Send message"
            disabled={pending || !input.trim()}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3 text-primary" />
          Refuses to answer when evidence is insufficient — hallucination
          control is always on.
        </p>
      </form>
    </div>
  );
}
