"use client";

// Search Lab: raw hybrid retrieval over the chunk corpus with filters and
// topK control. Shows every score component (lexical / semantic / rerank)
// plus the retrieval metadata panel.

import { useState } from "react";
import {
  GaugeCircle,
  LoaderCircle,
  Search,
  SearchX,
  Send,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import {
  SourceCard,
} from "@/components/wedjat/shared/source-panel";
import { useBlueprintScope } from "@/hooks/use-blueprint-scope";
import { apiPost, errMessage } from "@/lib/wedjat/client";
import type { SearchResponse } from "@/lib/wedjat/types";

const AUTO = "auto";
const DOC_TYPES = ["BLUEPRINT", "ADR", "SPEC", "AUDIT", "RUNBOOK", "REVIEW", "REFERENCE"];
const TOPK_OPTIONS = [3, 5, 10, 20];

export function SearchView() {
  const scope = useBlueprintScope();
  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState<string>(AUTO);
  const [topK, setTopK] = useState<string>("10");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiPost<SearchResponse>("/api/search", {
        query: q,
        platform: scope.platformSlug ?? undefined,
        blueprint: scope.blueprintSlug ?? undefined,
        ...(docType !== AUTO ? { docType } : {}),
        topK: Number(topK),
      });
      setResult(res);
      if (res.results.length === 0) {
        toast.info("No results", {
          description: "Try a broader scope or different phrasing.",
        });
      }
    } catch (err) {
      const msg = errMessage(err);
      setError(msg);
      toast.error("Search failed", { description: msg });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Retrieval"
        title="Search Lab"
        description="Direct access to the hybrid retriever — BM25 lexical + local embeddings, heuristic rerank — for tuning queries outside the chat pipeline."
      />

      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <form onSubmit={run} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="search-query" className="sr-only">
                Query
              </Label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="search-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the chunk corpus…"
                  className="h-9 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Platform
              </Label>
              <Select
                value={scope.platformSlug ?? AUTO}
                onValueChange={(v) => scope.setPlatform(v === AUTO ? null : v)}
              >
                <SelectTrigger className="h-9 w-full" aria-label="Platform filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    <span className="text-muted-foreground">All</span>
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
              >
                <SelectTrigger className="h-9 w-full" aria-label="Blueprint filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    <span className="text-muted-foreground">All</span>
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
                Doc type
              </Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-9 w-full" aria-label="Doc type filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>
                    <span className="text-muted-foreground">All</span>
                  </SelectItem>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="topk" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                top K
              </Label>
              <Select value={topK} onValueChange={setTopK}>
                <SelectTrigger id="topk" className="h-9 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPK_OPTIONS.map((k) => (
                    <SelectItem key={k} value={String(k)}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              className="h-9"
              onClick={() => run()}
              disabled={pending || !query.trim()}
            >
              {pending ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  Searching…
                </>
              ) : (
                <>
                  <Send className="size-3.5" aria-hidden="true" />
                  Search
                </>
              )}
            </Button>
          </div>
          {scope.platforms.error || scope.blueprints.error ? (
            <p className="text-xs text-muted-foreground">
              Filters partially unavailable:{" "}
              {scope.platforms.error ?? scope.blueprints.error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Card className="rounded-xl border-red-500/40 bg-red-500/5" role="alert">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-red-700 dark:text-red-400">
              Search failed
            </p>
            <p className="mt-0.5 text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {pending ? (
        <div className="space-y-3" aria-live="polite">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
      ) : result ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          <Card className="rounded-xl">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="flex items-center gap-2">
                <GaugeCircle
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  retrieval meta
                </span>
              </div>
              {[
                ["mode", result.retrievalMeta.mode],
                ["candidates", String(result.retrievalMeta.candidatesCount)],
                ["latency", `${result.retrievalMeta.latencyMs} ms`],
                ["reranker", result.retrievalMeta.rerankerModel],
                ["embedder", result.retrievalMeta.embedderModel],
              ].map(([k, v]) => (
                <span key={k} className="text-xs text-muted-foreground">
                  {k}: <span className="font-mono text-foreground">{v}</span>
                </span>
              ))}
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.traceId.slice(0, 14)}…
              </span>
            </CardContent>
          </Card>

          <section aria-label="Search results" className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Results ({result.results.length})
            </h3>
            {result.results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
                <div
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <SearchX className="size-6" />
                </div>
                <p className="text-sm font-medium">No chunks matched</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Try a broader scope (clear the platform/blueprint/docType
                  filters) or rephrase the query.
                </p>
              </div>
            ) : (
              <div className="wedjat-scroll max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {result.results.map((s) => (
                  <SourceCard key={`${s.rank}-${s.chunkId}`} source={s} />
                ))}
              </div>
            )}
          </section>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <Search className="size-6" />
          </div>
          <p className="text-sm font-medium">Run a query to inspect retrieval</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Each result shows its lexical, semantic and rerank scores so you can
            see exactly why it surfaced.
          </p>
        </div>
      )}
    </div>
  );
}
