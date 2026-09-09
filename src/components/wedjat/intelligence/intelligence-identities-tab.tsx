"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — Tab 3 "Service Identities" (contract §3.3): platform service
// keys table (platform, name, key preview, scopes, status, last used),
// create dialog (platform select from registry + scope multi-select), rotate
// and revoke actions with confirm dialogs, and the ONE-TIME key reveal after
// create/rotate. All mutations are ADMIN+; the raw key never leaves the
// KeyRevealDialog (never logged, never toasted).
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Fingerprint,
  KeyRound,
  RotateCcw,
  ShieldAlert,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  IdentityStatusBadge,
  KeyPreview,
  KeyRevealDialog,
  RefreshButton,
  ReadOnlyNote,
  RoleGateChip,
  ScopeChip,
} from "@/components/wedjat/intelligence/intelligence-bits";
import {
  FABRIC_ADMIN_ROLES,
  SCOPE_HELP,
} from "@/components/wedjat/intelligence/intelligence-helpers";
import { apiPost, errMessage, formatWhen } from "@/lib/wedjat/client";
import { useApiData } from "@/hooks/use-api-data";
import { API_SCOPES } from "@/lib/wedjat/types";
import type {
  PlatformRegistryDto,
  ServiceIdentityCreatedDto,
  ServiceIdentityDto,
} from "@/lib/wedjat/types";

/** Create dialog (ADMIN+): platform select from the registry, name, scopes. */
function CreateIdentityDialog({
  open,
  onClose,
  platforms,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  platforms: string[];
  onCreated: (created: ServiceIdentityCreatedDto) => void;
}) {
  const [platform, setPlatform] = useState("");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPlatform("");
    setName("");
    setScopes([]);
    setBusy(false);
  };

  const create = async () => {
    if (busy) return;
    if (!platform.trim()) {
      toast.error("Platform required", {
        description: "Pick the platform this identity acts for.",
      });
      return;
    }
    if (!name.trim()) {
      toast.error("Name required", {
        description: "Give the service a recognizable name (e.g. ci-dispatcher).",
      });
      return;
    }
    if (scopes.length === 0) {
      toast.error("At least one scope required", {
        description: "Grant the minimum scopes the service needs.",
      });
      return;
    }
    setBusy(true);
    try {
      const created = await apiPost<ServiceIdentityCreatedDto>(
        "/api/fabric/identities",
        { platformSlug: platform.trim(), name: name.trim(), scopes },
      );
      toast.success("Service identity created", {
        description: `${created.name} on ${created.platformSlug} — copy the key now, it will not be shown again.`,
      });
      onCreated(created);
      reset();
      onClose();
    } catch (e) {
      toast.error("Create failed", { description: errMessage(e) });
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="wedjat-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="size-4 text-primary" />
            Create service identity
          </DialogTitle>
          <DialogDescription>
            Issues a platform API key for /api/v1/* endpoints. Only a hash is
            stored — the raw key is revealed exactly once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="identity-platform">Platform</Label>
            {platforms.length > 0 ? (
              <Select value={platform} onValueChange={setPlatform} disabled={busy}>
                <SelectTrigger id="identity-platform" className="h-11">
                  <SelectValue placeholder="Select a platform" />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  id="identity-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  placeholder="e.g. sgtx"
                  className="h-11"
                  disabled={busy}
                />
                <p className="text-[10px] text-muted-foreground">
                  Registry unavailable — enter the platform slug manually.
                </p>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="identity-name">Name</Label>
            <Input
              id="identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ci-dispatcher"
              className="h-11"
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label>Scopes (grant the minimum)</Label>
            <div className="wedjat-scroll max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
              {API_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(c) =>
                      setScopes((prev) =>
                        c === true
                          ? [...prev, scope]
                          : prev.filter((s) => s !== scope),
                      )
                    }
                    disabled={busy}
                    aria-label={`Scope ${scope}`}
                  />
                  <span className="min-w-0">
                    <ScopeChip scope={scope} title={SCOPE_HELP[scope]} />
                    <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                      {SCOPE_HELP[scope] ?? "Custom scope"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
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
          <Button type="button" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create identity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IntelligenceIdentitiesTab({ role }: { role: string }) {
  const identities = useApiData<{ identities: ServiceIdentityDto[] }>(
    "/api/fabric/identities",
  );
  const registry = useApiData<{ registry: PlatformRegistryDto[] }>(
    "/api/fabric/registry",
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<ServiceIdentityCreatedDto | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ServiceIdentityDto | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ServiceIdentityDto | null>(null);
  const [rotating, setRotating] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const canMutate = FABRIC_ADMIN_ROLES.has(role);
  const rows = identities.data?.identities ?? [];
  const platformSlugs = useMemo(
    () => (registry.data?.registry ?? []).map((r) => r.slug),
    [registry.data],
  );

  const rotate = async () => {
    if (!rotateTarget || rotating) return;
    setRotating(true);
    try {
      const created = await apiPost<ServiceIdentityCreatedDto>(
        `/api/fabric/identities/${encodeURIComponent(rotateTarget.id)}/rotate`,
      );
      toast.success("Key rotated", {
        description:
          "A new key was issued and the old key was revoked at the rotation time. Copy the new key now.",
      });
      setRotateTarget(null);
      setIssued(created);
      identities.refresh();
    } catch (e) {
      toast.error("Rotate failed", { description: errMessage(e) });
    } finally {
      setRotating(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    try {
      await apiPost<{ revoked: boolean }>(
        `/api/fabric/identities/${encodeURIComponent(revokeTarget.id)}/revoke`,
      );
      toast.success("Identity revoked", {
        description: `${revokeTarget.name} can no longer authenticate. Events already recorded are preserved.`,
      });
      setRevokeTarget(null);
      identities.refresh();
    } catch (e) {
      toast.error("Revoke failed", { description: errMessage(e) });
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            Service identities
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Per-platform API keys for the public /api/v1/* surface — hashed at
            rest, scoped, rotatable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RoleGateChip minRole="ADMIN" />
          <RefreshButton
            onClick={() => {
              identities.refresh();
              registry.refresh();
            }}
            loading={identities.loading || registry.loading}
            ariaLabel="Refresh service identities"
          />
          {canMutate ? (
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              New identity
            </Button>
          ) : null}
        </div>
      </div>

      {!canMutate ? <ReadOnlyNote minRole="ADMIN" /> : null}

      <Card className="rounded-xl">
        <CardContent className="p-4">
          {identities.loading && !identities.data ? (
            <SkeletonRows rows={4} />
          ) : identities.error ? (
            <ErrorState message={identities.error} onRetry={identities.refresh} compact />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Fingerprint}
              title="No service identities"
              hint={
                canMutate
                  ? "Create one to let a platform push events, knowledge or feedback to /api/v1/*."
                  : "An ADMIN can issue platform API keys for the public API."
              }
              compact
            />
          ) : (
            <div className="wedjat-scroll max-h-96 overflow-x-auto overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-[10px]">Platform</TableHead>
                    <TableHead className="h-9 text-[10px]">Name</TableHead>
                    <TableHead className="h-9 text-[10px]">Key</TableHead>
                    <TableHead className="h-9 text-[10px]">Scopes</TableHead>
                    <TableHead className="h-9 text-[10px]">Status</TableHead>
                    <TableHead className="h-9 text-[10px]">Last used</TableHead>
                    <TableHead className="h-9 text-[10px]">Rotated</TableHead>
                    {canMutate ? (
                      <TableHead className="h-9 text-[10px] text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((id) => (
                    <TableRow key={id.id} className={id.status === "REVOKED" ? "opacity-60" : ""}>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {id.platformSlug}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-xs font-medium">
                        {id.name}
                      </TableCell>
                      <TableCell className="py-2">
                        <KeyPreview preview={id.keyPreview} />
                      </TableCell>
                      <TableCell className="max-w-56 py-2">
                        <span className="flex flex-wrap gap-1">
                          {id.scopes.map((s) => (
                            <ScopeChip key={s} scope={s} title={SCOPE_HELP[s]} />
                          ))}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        <IdentityStatusBadge status={id.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-[11px] text-muted-foreground">
                        {formatWhen(id.lastUsedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-[11px] text-muted-foreground">
                        {formatWhen(id.rotatedAt)}
                      </TableCell>
                      {canMutate ? (
                        <TableCell className="py-2 text-right">
                          <span className="inline-flex gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[10px]"
                              disabled={id.status === "REVOKED"}
                              onClick={() => setRotateTarget(id)}
                              aria-label={`Rotate key for ${id.name}`}
                            >
                              <RotateCcw aria-hidden="true" className="size-3" />
                              Rotate
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[10px] text-red-700 dark:text-red-400"
                              disabled={id.status === "REVOKED"}
                              onClick={() => setRevokeTarget(id)}
                              aria-label={`Revoke ${id.name}`}
                            >
                              <Ban aria-hidden="true" className="size-3" />
                              Revoke
                            </Button>
                          </span>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateIdentityDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        platforms={platformSlugs}
        onCreated={(created) => {
          setIssued(created);
          identities.refresh();
        }}
      />

      {/* one-time key reveal — shared by create + rotate */}
      <KeyRevealDialog issued={issued} onClose={() => setIssued(null)} />

      {/* rotate confirm */}
      <AlertDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRotateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw aria-hidden="true" className="size-4" />
              Rotate this key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rotateTarget
                ? `A new key is issued for "${rotateTarget.name}" (${rotateTarget.platformSlug}) and the old key stops working immediately (revoked at rotatedAt). The new key is shown exactly once — have your secret manager ready.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void rotate();
              }}
            >
              {rotating ? "Rotating…" : "Rotate key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* revoke confirm (destructive) */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert
                aria-hidden="true"
                className="size-4 text-red-600 dark:text-red-400"
              />
              Revoke this identity?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget
                ? `"${revokeTarget.name}" (${revokeTarget.platformSlug}) will no longer be able to authenticate. This cannot be undone — create a new identity if needed. Events and knowledge already contributed remain part of the fabric.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Keep identity</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
              onClick={(ev) => {
                ev.preventDefault();
                void revoke();
              }}
            >
              {revoking ? "Revoking…" : "Revoke identity"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
