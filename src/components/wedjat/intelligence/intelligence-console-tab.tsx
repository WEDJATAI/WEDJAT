"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 8 "API Console" (contract §3.8): read-only reference for
// the public /api/v1/* platform API — endpoint table with method + scope
// chips, plus the backend-published apiExamples (GET /api/fabric) rendered
// with copyable curl and @wedjat/sdk snippets. No mutations here by design.
// ═══════════════════════════════════════════════════════════════════════════

import { SquareTerminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/wedjat/shared/empty-state";
import {
  CopyButton,
  MethodBadge,
  RefreshButton,
  ScopeChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  buildCurlExample,
  buildSdkExample,
  SCOPE_HELP,
  V1_ENDPOINTS,
  type ApiExample,
  type FabricConsolePayload,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { API_SCOPES } from "@/lib/wedjat/types";
import { useApiData } from "@/hooks/use-api-data";

/** Snippet block with a copy affordance. */
function SnippetBlock({
  code,
  label,
  copyLabel,
}: {
  code: string;
  label: string;
  copyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <CopyButton text={code} label={copyLabel} ariaLabel={`Copy ${label}`} />
      </div>
      <pre className="wedjat-scroll max-h-48 overflow-x-auto rounded-lg border border-border bg-slate-950 p-3 font-mono text-[11px] leading-5 text-emerald-200/90">
        {code}
      </pre>
    </div>
  );
}

function ExampleCard({ example }: { example: ApiExample }) {
  const curl = buildCurlExample(example);
  const sdk = buildSdkExample(example);
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={example.method} />
          <code className="min-w-0 break-all font-mono text-xs">{example.path}</code>
          {example.scope && example.scope !== "public" ? (
            <ScopeChip scope={example.scope} title={SCOPE_HELP[example.scope]} />
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              public
            </Badge>
          )}
        </div>
        {example.title ? (
          <p className="text-sm font-medium leading-snug">{example.title}</p>
        ) : null}
        {example.description ? (
          <p className="text-xs leading-snug text-muted-foreground">
            {example.description}
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <SnippetBlock code={curl} label="curl" copyLabel="Copy curl" />
          <SnippetBlock code={sdk} label="@wedjat/sdk" copyLabel="Copy SDK" />
        </div>
      </CardContent>
    </Card>
  );
}

export function IntelligenceConsoleTab() {
  // apiExamples ride on GET /api/fabric (contract §2) — optional field,
  // tolerated when absent so the static reference always renders.
  const fabric = useApiData<FabricConsolePayload>("/api/fabric");
  const examples = fabric.data?.apiExamples ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">API console</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The public platform API — service identities authenticate with
            Authorization: Bearer &lt;service key&gt;. Read-only reference.
          </p>
        </div>
        <RefreshButton
          onClick={fabric.refresh}
          loading={fabric.loading}
          ariaLabel="Refresh API examples"
        />
      </div>

      {/* ── scopes ── */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold tracking-tight">
            Scopes
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {API_SCOPES.map((s) => (
              <ScopeChip key={s} scope={s} title={SCOPE_HELP[s]} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── endpoint reference ── */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <SquareTerminal aria-hidden="true" className="size-4 text-primary" />
            Endpoints ({V1_ENDPOINTS.length})
          </h3>
          <div className="wedjat-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 text-[10px]">Method</TableHead>
                  <TableHead className="h-9 text-[10px]">Path</TableHead>
                  <TableHead className="h-9 text-[10px]">Scope</TableHead>
                  <TableHead className="h-9 text-[10px]">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {V1_ENDPOINTS.map((ep) => (
                  <TableRow key={`${ep.method}-${ep.path}`}>
                    <TableCell className="py-2">
                      <MethodBadge method={ep.method} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 font-mono text-xs">
                      {ep.path}
                    </TableCell>
                    <TableCell className="py-2">
                      {ep.scope === "public" ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          public
                        </Badge>
                      ) : (
                        <ScopeChip scope={ep.scope} title={SCOPE_HELP[ep.scope]} />
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {ep.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── backend-published examples ── */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
          Examples ({examples.length})
          <span className="font-mono text-[10px] font-normal text-muted-foreground">
            from GET /api/fabric → apiExamples
          </span>
        </h3>
        {fabric.loading && !fabric.data ? (
          <SkeletonRows rows={3} />
        ) : fabric.error && !fabric.data ? (
          <ErrorState message={fabric.error} onRetry={fabric.refresh} compact />
        ) : examples.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title="No live examples published yet"
            hint="The fabric backend publishes curl and @wedjat/sdk examples on GET /api/fabric once v4 lands — the endpoint reference above is always available."
            compact
          />
        ) : (
          <div className="wedjat-scroll max-h-[38rem] space-y-3 overflow-y-auto pr-1">
            {examples.map((ex, i) => (
              <ExampleCard key={`${ex.title}-${ex.path}-${i}`} example={ex} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
