"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 7 "Platform Registry" (contract §3.7): the 10-platform
// org registry as cards — repo/deployment/db links (external, new tab),
// connection-status badges (CONNECTED/DISCOVERED/DISCONNECTED/RETIRED),
// knowledge coverage counts, last sync, and the ADMIN+ connect action
// (register coordinates, DISCOVERED→CONNECTED). Disconnect keeps knowledge.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { toast } from "sonner";
import {
  Database,
  ExternalLink,
  GitBranch,
  Plug,
  Rocket,
  Server,
  Unplug,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  ErrorState,
  SkeletonGrid,
} from "@/components/wedjat/shared/empty-state";
import {
  ConnectionBadge,
  RefreshButton,
  ReadOnlyNote,
  RoleGateChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  FABRIC_ADMIN_ROLES,
  formatCount,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import type { PlatformRegistryDto } from "@/lib/wedjat/types";

/** External coordinate link — opens in a new tab, never same-tab. */
function CoordinateLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof GitBranch;
}) {
  const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2 text-[10px]"
      onClick={() => window.open(safe, "_blank", "noopener,noreferrer")}
      aria-label={`${label}: ${href} (opens in a new tab)`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
      <ExternalLink aria-hidden="true" className="size-3 text-muted-foreground" />
    </Button>
  );
}

function MissingCoordinate({ label }: { label: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-dashed px-2 text-[10px] text-muted-foreground/70">
      {label} not registered
    </span>
  );
}

/** Connect dialog (ADMIN+): optional repo/deployment/db coordinates. */
function ConnectDialog({
  platform,
  onClose,
  onDone,
}: {
  platform: PlatformRegistryDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRepositoryUrl("");
    setDeploymentUrl("");
    setDatabaseUrl("");
    setBusy(false);
  };

  const connect = async () => {
    if (!platform || busy) return;
    setBusy(true);
    try {
      const body: { repositoryUrl?: string; deploymentUrl?: string; databaseUrl?: string } = {};
      if (repositoryUrl.trim()) body.repositoryUrl = repositoryUrl.trim();
      if (deploymentUrl.trim()) body.deploymentUrl = deploymentUrl.trim();
      if (databaseUrl.trim()) body.databaseUrl = databaseUrl.trim();
      const updated = await apiPost<PlatformRegistryDto>(
        `/api/fabric/registry/${encodeURIComponent(platform.slug)}/connect`,
        body,
      );
      toast.success(`${updated.name} connected`, {
        description: `Coordinates registered — status is now ${updated.connectionStatus ?? "CONNECTED"}.`,
      });
      reset();
      onClose();
      onDone();
    } catch (e) {
      toast.error("Connect failed", { description: errMessage(e) });
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={platform !== null}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {platform ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plug aria-hidden="true" className="size-4 text-primary" />
                Connect {platform.name}
              </DialogTitle>
              <DialogDescription>
                Register or refresh coordinates and mark the platform
                CONNECTED (DISCOVERED → CONNECTED). Fields are optional —
                existing coordinates are kept when left blank.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="registry-repo">Repository URL</Label>
                <Input
                  id="registry-repo"
                  value={repositoryUrl}
                  onChange={(e) => setRepositoryUrl(e.target.value)}
                  placeholder={platform.repositoryUrl ?? "https://github.com/org/repo"}
                  className="h-11 font-mono text-xs"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="registry-deploy">Deployment URL</Label>
                <Input
                  id="registry-deploy"
                  value={deploymentUrl}
                  onChange={(e) => setDeploymentUrl(e.target.value)}
                  placeholder={platform.deploymentUrl ?? "https://app.example.com"}
                  className="h-11 font-mono text-xs"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="registry-db">Database URL</Label>
                <Input
                  id="registry-db"
                  value={databaseUrl}
                  onChange={(e) => setDatabaseUrl(e.target.value)}
                  placeholder={platform.databaseUrl ?? "libsql://…"}
                  className="h-11 font-mono text-xs"
                  disabled={busy}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                  onClose();
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="button" onClick={connect} disabled={busy}>
                {busy ? "Connecting…" : "Connect platform"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RegistryCard({
  platform,
  canMutate,
  onConnect,
  onDisconnect,
}: {
  platform: PlatformRegistryDto;
  canMutate: boolean;
  onConnect: (p: PlatformRegistryDto) => void;
  onDisconnect: (p: PlatformRegistryDto) => void;
}) {
  const connected = platform.connectionStatus === "CONNECTED";
  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{platform.name}</p>
            <code className="font-mono text-[10px] text-muted-foreground">
              {platform.slug}
            </code>
          </div>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={
                platform.criticality?.toUpperCase() === "CRITICAL"
                  ? "border-red-500/30 bg-red-500/10 text-[10px] text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400"
                  : "border-border bg-muted text-[10px] text-muted-foreground"
              }
            >
              {platform.criticality}
            </Badge>
            <ConnectionBadge status={platform.connectionStatus} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {platform.repositoryUrl ? (
            <CoordinateLink href={platform.repositoryUrl} label="Repo" icon={GitBranch} />
          ) : (
            <MissingCoordinate label="Repo" />
          )}
          {platform.deploymentUrl ? (
            <CoordinateLink href={platform.deploymentUrl} label="Deploy" icon={Rocket} />
          ) : (
            <MissingCoordinate label="Deploy" />
          )}
          {platform.databaseUrl ? (
            <CoordinateLink href={platform.databaseUrl} label="DB" icon={Database} />
          ) : (
            <MissingCoordinate label="DB" />
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-2.5 text-center">
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums">
              {formatCount(platform.knowledgeRecords)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              knowledge
            </p>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums">
              {formatCount(platform.blueprints)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              blueprints
            </p>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums">
              {formatCount(platform.events)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              events
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] text-muted-foreground">
            last sync {formatWhen(platform.lastSyncAt)}
          </p>
          {canMutate ? (
            <span className="ml-auto flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[10px]"
                onClick={() => onConnect(platform)}
                aria-label={`Connect ${platform.name}`}
              >
                <Plug aria-hidden="true" className="size-3" />
                {connected ? "Refresh" : "Connect"}
              </Button>
              {connected ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[10px] text-amber-700 dark:text-amber-400"
                  onClick={() => onDisconnect(platform)}
                  aria-label={`Disconnect ${platform.name}`}
                >
                  <Unplug aria-hidden="true" className="size-3" />
                  Disconnect
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function IntelligenceRegistryTab({ role }: { role: string }) {
  const registry = useApiData<{ registry: PlatformRegistryDto[] }>("/api/fabric/registry");
  const [connectTarget, setConnectTarget] = useState<PlatformRegistryDto | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<PlatformRegistryDto | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const canMutate = FABRIC_ADMIN_ROLES.has(role);
  const rows = registry.data?.registry ?? [];

  const disconnect = async () => {
    if (!disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      await apiPost(
        `/api/fabric/registry/${encodeURIComponent(disconnectTarget.slug)}/disconnect`,
      );
      toast.success("Platform disconnected", {
        description: `${disconnectTarget.name} is now DISCONNECTED — its knowledge, events and history are preserved.`,
      });
      setDisconnectTarget(null);
      registry.refresh();
    } catch (e) {
      toast.error("Disconnect failed", { description: errMessage(e) });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            Platform registry
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The org-wide learning network — every platform with its repo,
            deployment and database coordinates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RoleGateChip minRole="ADMIN" />
          <RefreshButton
            onClick={registry.refresh}
            loading={registry.loading}
            ariaLabel="Refresh platform registry"
          />
        </div>
      </div>

      {!canMutate ? <ReadOnlyNote minRole="ADMIN" /> : null}

      {registry.loading && !registry.data ? (
        <SkeletonGrid count={6} />
      ) : registry.error ? (
        <ErrorState message={registry.error} onRetry={registry.refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No platforms registered"
          hint="The 10-platform registry (WEDJAT, CIRKLE, AURIENTA, SGTX, MTQ, JUDGE SMART, EGYCOURT, SGTX FABLE, PPE, MTQ SIGMA) appears once the fabric backend seeds it."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <RegistryCard
              key={p.slug}
              platform={p}
              canMutate={canMutate}
              onConnect={setConnectTarget}
              onDisconnect={setDisconnectTarget}
            />
          ))}
        </div>
      )}

      <ConnectDialog
        platform={connectTarget}
        onClose={() => setConnectTarget(null)}
        onDone={registry.refresh}
      />

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug aria-hidden="true" className="size-4" />
              Disconnect {disconnectTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The platform is marked DISCONNECTED and stops syncing — but its
              knowledge records, events and learning history are preserved
              exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void disconnect();
              }}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
