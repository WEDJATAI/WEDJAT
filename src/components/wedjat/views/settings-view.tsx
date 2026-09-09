"use client";

// WEDJAT DOMAIN AI — Settings view.
//
// Three tabs:
//   Account     — self-service display name / username / password change.
//   Users       — ADMIN/OWNER user administration (create, activate, disable).
//   AI Providers— OWNER-only provider API key management (stored server-side,
//                 masked in the UI; keys are NEVER displayed after entry).
//

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Bot,
  KeyRound,
  LoaderCircle,
  Lock,
  PlusCircle,
  RefreshCw,
  Save,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoleBadge } from "@/components/wedjat/shared/status-badge";
import { api, apiPost, errMessage } from "@/lib/wedjat/client";
import type {
  AdminUserRow,
  Principal,
  ProviderSettings,
} from "@/lib/wedjat/types";

const ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);

function isAdmin(p: Principal): boolean {
  return ADMIN_ROLES.has(p.role);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

// ── Account tab ───────────────────────────────────────────────────────────────

function AccountTab({
  principal,
  onUpdated,
}: {
  principal: Principal;
  onUpdated: (p: Principal) => void;
}) {
  const [name, setName] = useState(principal.name);
  const [username, setUsername] = useState(principal.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== principal.name ||
    username.trim().toLowerCase() !== principal.email ||
    (newPassword.length > 0 && currentPassword.length > 0);

  const save = async () => {
    if (saving) return;
    setError(null);
    if (newPassword && newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSaving(true);
    try {
      const r = await apiPost<{ principal: Principal }>(
        "/api/account/credentials",
        {
          currentPassword,
          name: name.trim() !== principal.name ? name.trim() : undefined,
          email:
            username.trim().toLowerCase() !== principal.email
              ? username.trim().toLowerCase()
              : undefined,
          newPassword: newPassword || undefined,
        },
      );
      onUpdated(r.principal);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Account updated", {
        description: "Your credentials were changed successfully.",
      });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Your account</h3>
          <RoleBadge role={principal.role} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes require your current password. Changing the password signs
          out your other sessions.
        </p>

        <div className="mt-6 grid gap-5 sm:max-w-md">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Display name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-username">Username</Label>
            <Input
              id="settings-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={200}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
            />
            <p className="text-xs text-muted-foreground">
              You will sign in with this username.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-current">Current password</Label>
            <Input
              id="settings-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Required to save changes"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-new">New password</Label>
              <Input
                id="settings-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to keep"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-confirm">Confirm new password</Label>
              <Input
                id="settings-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <Button
              onClick={save}
              disabled={saving || !dirty || !currentPassword}
              className="gap-1.5"
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ principal }: { principal: Principal }) {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("MEMBER");
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUserRow[] }>("/api/admin/users");
      setUsers(r.users);
      setError(null);
    } catch (err) {
      setError(errMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<{ user: AdminUserRow }>("/api/admin/users", {
        email: newEmail.trim().toLowerCase(),
        name: newName.trim(),
        role: newRole,
        password: newPassword,
      });
      toast.success("User created", {
        description: `${newName.trim()} can now sign in.`,
      });
      setNewEmail("");
      setNewName("");
      setNewRole("MEMBER");
      setNewPassword("");
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error("Could not create user", { description: errMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (user: AdminUserRow) => {
    if (busy) return;
    setBusy(true);
    try {
      await api<{ user: AdminUserRow }>("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({
          userId: user.id,
          status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      await load();
      toast.success(user.status === "ACTIVE" ? "User disabled" : "User activated");
    } catch (err) {
      toast.error("Could not update user", { description: errMessage(err) });
    } finally {
      setBusy(false);
      setConfirmDisable(null);
    }
  };

  const disableConfirmed = async () => {
    if (!confirmDisable) return;
    await toggleStatus(confirmDisable);
  };

  return (
    <Card className="rounded-xl">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Organization users</h3>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => void load()}
              disabled={users === null}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setShowCreate((v) => !v)}
            >
              <PlusCircle className="size-3.5" aria-hidden="true" />
              Add user
            </Button>
          </div>
        </div>

        {showCreate ? (
          <div className="mt-4 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-user-username">Username</Label>
              <Input
                id="new-user-username"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. analyst01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Display name</Label>
              <Input
                id="new-user-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Sara Analyst"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="new-user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CURATOR">CURATOR</SelectItem>
                  <SelectItem value="MEMBER">MEMBER</SelectItem>
                  <SelectItem value="AUDITOR">AUDITOR</SelectItem>
                  {principal.role === "OWNER" ? (
                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Initial password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters — user changes it later"
              />
            </div>
            <div className="md:col-span-2">
              <Button
                onClick={create}
                disabled={
                  busy ||
                  !newEmail.trim() ||
                  !newName.trim() ||
                  newPassword.length < 8
                }
                className="gap-1.5"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PlusCircle className="size-4" aria-hidden="true" />
                )}
                Create user
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Could not load users</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : users === null ? (
          <div className="mt-4 space-y-2" aria-label="Loading users">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : (
          <div className="wedjat-scroll mt-4 max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Last active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const self = u.id === principal.userId;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {u.name}
                              {self ? (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  (you)
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell>
                        {u.status === "ACTIVE" ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
                          >
                            ACTIVE
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-muted-foreground/40 bg-muted text-[10px] text-muted-foreground"
                          >
                            DISABLED
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                        {formatDate(u.lastActiveAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {self ? (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        ) : u.status === "ACTIVE" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => setConfirmDisable(u)}
                            disabled={busy}
                          >
                            <Lock className="size-3.5" aria-hidden="true" />
                            Disable
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => void toggleStatus(u)}
                            disabled={busy}
                          >
                            <BadgeCheck className="size-3.5" aria-hidden="true" />
                            Activate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={confirmDisable !== null}
        onOpenChange={(open) => !open && setConfirmDisable(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDisable?.name} ({confirmDisable?.email}) will no longer
              be able to sign in. Active sessions are revoked immediately. The
              account can be re-activated later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disableConfirmed()}>
              Disable account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── AI Providers tab ──────────────────────────────────────────────────────────

function ProviderTab() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [savingGroq, setSavingGroq] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ providers: ProviderSettings }>(
        "/api/settings/providers",
      );
      setSettings(r.providers);
      setError(null);
    } catch (err) {
      setError(errMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (
    provider: "groq" | "gemini",
    apiKey: string,
    setBusy: (b: boolean) => void,
  ) => {
    if (apiKey && apiKey.length < 8) {
      toast.error("Key looks too short — paste the full API key");
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<{ providers: ProviderSettings }>(
        "/api/settings/providers",
        { provider, apiKey: apiKey.trim() },
      );
      setSettings(r.providers);
      if (provider === "groq") setGroqKey("");
      else setGeminiKey("");
      toast.success(apiKey ? `${provider} key saved` : `${provider} key cleared`, {
        description: apiKey
          ? "Live immediately — no redeploy needed."
          : "The provider falls back to standby.",
      });
    } catch (err) {
      toast.error("Could not save key", { description: errMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (info: { configured: boolean; managed: boolean }) =>
    info.configured ? (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
      >
        {info.managed ? "CONFIGURED (APP)" : "CONFIGURED (ENV)"}
      </Badge>
    ) : (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
      >
        NOT SET
      </Badge>
    );

  return (
    <Card className="rounded-xl">
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold">AI provider keys</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys are stored server-side for the organization, applied immediately
          and never displayed again after saving. Chat generation activates as
          soon as Groq or Gemini is configured.
        </p>

        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Could not load provider settings</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Groq</h4>
                {settings ? statusBadge(settings.groq) : null}
              </div>
              {settings?.groq.hint ? (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {settings.groq.hint}
                </code>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Recommended low-latency tier (llama-3.3-70b) — free API keys
              available at console.groq.com.
            </p>
            <div className="space-y-2">
              <Label htmlFor="groq-key" className="sr-only">
                Groq API key
              </Label>
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="groq-key"
                  type="password"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder={
                    settings?.groq.configured
                      ? "Paste a new key to replace"
                      : "gsk_…"
                  }
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={savingGroq || !groqKey.trim()}
                  onClick={() => void save("groq", groqKey, setSavingGroq)}
                >
                  {savingGroq ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  Save key
                </Button>
                {settings?.groq.managed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    disabled={savingGroq}
                    onClick={() => void save("groq", "", setSavingGroq)}
                  >
                    <ShieldAlert className="size-3.5" aria-hidden="true" />
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Google Gemini</h4>
                {settings ? statusBadge(settings.gemini) : null}
              </div>
              {settings?.gemini.hint ? (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {settings.gemini.hint}
                </code>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Teacher/reference tier (gemini-2.5-pro/flash) — free keys
              available at aistudio.google.com.
            </p>
            <div className="space-y-2">
              <Label htmlFor="gemini-key" className="sr-only">
                Gemini API key
              </Label>
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="gemini-key"
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={
                    settings?.gemini.configured
                      ? "Paste a new key to replace"
                      : "AIza…"
                  }
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={savingGemini || !geminiKey.trim()}
                  onClick={() => void save("gemini", geminiKey, setSavingGemini)}
                >
                  {savingGemini ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  Save key
                </Button>
                {settings?.gemini.managed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    disabled={savingGemini}
                    onClick={() => void save("gemini", "", setSavingGemini)}
                  >
                    <ShieldAlert className="size-3.5" aria-hidden="true" />
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export function SettingsView({
  principal,
  onPrincipalUpdate,
}: {
  principal: Principal;
  onPrincipalUpdate: (p: Principal) => void;
}) {
  const [tab, setTab] = useState("account");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account, organization users and AI provider keys.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="wedjat-scroll h-11 w-max max-w-full overflow-x-auto sm:h-9">
          <TabsTrigger value="account" className="gap-1.5 px-3">
            Account
          </TabsTrigger>
          {isAdmin(principal) ? (
            <TabsTrigger value="users" className="gap-1.5 px-3">
              Users
            </TabsTrigger>
          ) : null}
          {principal.role === "OWNER" ? (
            <TabsTrigger value="providers" className="gap-1.5 px-3">
              AI Providers
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="account" className="mt-4">
          <AccountTab principal={principal} onUpdated={onPrincipalUpdate} />
        </TabsContent>
        {isAdmin(principal) ? (
          <TabsContent value="users" className="mt-4">
            <UsersTab principal={principal} />
          </TabsContent>
        ) : null}
        {principal.role === "OWNER" ? (
          <TabsContent value="providers" className="mt-4">
            <ProviderTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
