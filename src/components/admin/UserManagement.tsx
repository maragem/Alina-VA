"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { AdminUserView } from "@/lib/adminUsers";
import { apiErrorMessage } from "@/lib/apiError";
import type { UserRole } from "@/lib/roles";

type IssuedPassword = Readonly<{
  user: AdminUserView;
  temporaryPassword: string;
  reason: "created" | "reset";
}>;

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isLocked(user: AdminUserView): boolean {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

function StatusBadges({ user }: { user: AdminUserView }) {
  if (user.disabledAt) return <Badge variant="secondary">Disabled</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {!user.hasPassword ? <Badge variant="warning">No password</Badge> : null}
      {user.hasPassword && user.mustChangePassword ? (
        <Badge variant="info">Temporary password</Badge>
      ) : null}
      {isLocked(user) ? <Badge variant="warning">Locked</Badge> : null}
      {user.hasPassword && !user.mustChangePassword && !isLocked(user) ? (
        <Badge variant="success">Active</Badge>
      ) : null}
    </span>
  );
}

function IssuedPasswordNotice({
  issued,
  onDismiss,
}: {
  issued: IssuedPassword;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(issued.temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="border-l-4 border-(--ec-yellow) bg-amber-50 px-4 py-3 text-sm text-(--ec-ink)"
      role="status"
    >
      <p className="font-semibold">
        {issued.reason === "created" ? "Account created for" : "Temporary password issued to"}{" "}
        {issued.user.displayName} ({issued.user.email ?? "no email"}).
      </p>
      <p className="mt-1 text-(--ec-mute)">
        Share this temporary password securely. It is shown once and the user must
        replace it at first sign-in.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-sm border border-(--ec-line) bg-white px-2 py-1 font-mono text-sm tracking-wide">
          {issued.temporaryPassword}
        </code>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5 text-emerald-700" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [issued, setIssued] = useState<IssuedPassword>();
  const [resetTarget, setResetTarget] = useState<AdminUserView>();
  const [resetEmail, setResetEmail] = useState("");
  const [disableTarget, setDisableTarget] = useState<AdminUserView>();

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/users", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, "Could not load users."));
        }
        return (await response.json()) as { users: AdminUserView[] };
      })
      .then((payload) => {
        if (!active) return;
        setUsers(payload.users);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load users.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function replaceUser(user: AdminUserView): void {
    setUsers((current) => current.map((item) => (item.id === user.id ? user : item)));
  }

  async function createUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, displayName: newName, role: newRole }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not create the user."));
      }
      const payload = (await response.json()) as {
        user: AdminUserView;
        temporaryPassword: string;
      };
      setUsers((current) =>
        [...current, payload.user].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      );
      setIssued({ user: payload.user, temporaryPassword: payload.temporaryPassword, reason: "created" });
      setNewEmail("");
      setNewName("");
      setNewRole("member");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the user.");
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(user: AdminUserView, role: UserRole): Promise<void> {
    if (role === user.role) return;
    setBusyId(user.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not change the role."));
      }
      const payload = (await response.json()) as { user: AdminUserView };
      replaceUser(payload.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change the role.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function resetPassword(): Promise<void> {
    const target = resetTarget;
    if (!target) return;
    setBusyId(target.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/users/${target.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target.email ? {} : { email: resetEmail }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not reset the password."));
      }
      const payload = (await response.json()) as {
        user: AdminUserView;
        temporaryPassword: string;
      };
      replaceUser(payload.user);
      setIssued({ user: payload.user, temporaryPassword: payload.temporaryPassword, reason: "reset" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset the password.");
    } finally {
      setBusyId(undefined);
      setResetTarget(undefined);
      setResetEmail("");
    }
  }

  async function setDisabled(user: AdminUserView, disabled: boolean): Promise<void> {
    setBusyId(user.id);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not update the account."));
      }
      const payload = (await response.json()) as { user: AdminUserView };
      replaceUser(payload.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the account.");
    } finally {
      setBusyId(undefined);
      setDisableTarget(undefined);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <section className="ec-card overflow-hidden rounded-lg" aria-labelledby="users-title">
        <div className="border-b border-(--ec-line) px-5 py-4">
          <h2 id="users-title" className="text-lg font-semibold text-(--ec-blue)">
            Users
          </h2>
          <p className="mt-1 text-sm text-(--ec-mute)">
            Accounts are created here with a temporary password. Users choose their own
            password at first sign-in. Disabled accounts cannot sign in.
          </p>
        </div>

        <form
          className="grid gap-3 border-b border-(--ec-line) bg-slate-50 px-5 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_10rem_auto] sm:items-end"
          onSubmit={(event) => void createUser(event)}
        >
          <label className="text-xs font-semibold text-(--ec-mute)">
            Email
            <Input
              className="mt-1 h-9"
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="name@ec.europa.eu"
              disabled={creating}
            />
          </label>
          <label className="text-xs font-semibold text-(--ec-mute)">
            Display name
            <Input
              className="mt-1 h-9"
              required
              maxLength={100}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Full name"
              disabled={creating}
            />
          </label>
          <label className="text-xs font-semibold text-(--ec-mute)">
            Role
            <select
              className="mt-1 h-9 w-full rounded-md border border-(--ec-line) bg-white px-2 text-sm text-(--ec-ink)"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as UserRole)}
              disabled={creating}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" disabled={creating || !newEmail.trim() || !newName.trim()}>
            {creating ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-4" aria-hidden />
            )}
            Create user
          </Button>
        </form>

        {issued ? (
          <div className="border-b border-(--ec-line) px-5 py-3">
            <IssuedPasswordNotice issued={issued} onDismiss={() => setIssued(undefined)} />
          </div>
        ) : null}

        {error ? (
          <p className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-(--ec-mute)">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Loading users…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 border-collapse text-left">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.06em] text-(--ec-mute)">
                <tr>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-3 py-3 font-semibold">Role</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Last sign-in</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const busy = busyId === user.id;
                  const isSelf = user.id === currentUserId;
                  return (
                    <tr key={user.id} className="border-t border-slate-100 align-middle">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            name={user.displayName}
                            email={user.email}
                            className="size-9 text-xs"
                            ariaLabel={`Avatar for ${user.displayName}`}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {user.displayName}
                              {isSelf ? (
                                <span className="ml-2 text-xs font-normal text-(--ec-mute)">(you)</span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {user.email ?? "No email set"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          className="h-8 rounded-md border border-(--ec-line) bg-white px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          value={user.role}
                          aria-label={`Role for ${user.displayName}`}
                          disabled={busy || Boolean(user.disabledAt)}
                          onChange={(event) => void changeRole(user, event.target.value as UserRole)}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <StatusBadges user={user} />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700">
                        {formatDate(user.lastLoginAt)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || Boolean(user.disabledAt)}
                            onClick={() => {
                              setResetTarget(user);
                              setResetEmail("");
                            }}
                            title={user.hasPassword ? "Issue a temporary password" : "Set a first password"}
                          >
                            <KeyRound className="size-3.5" aria-hidden />
                            {user.hasPassword ? "Reset password" : "Set password"}
                          </Button>
                          {user.disabledAt ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void setDisabled(user, false)}
                            >
                              <UserRoundCheck className="size-3.5" aria-hidden />
                              Enable
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={busy || isSelf}
                              title={isSelf ? "You cannot disable your own account" : "Disable account"}
                              onClick={() => setDisableTarget(user)}
                            >
                              <UserRoundX className="size-3.5" aria-hidden />
                              Disable
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resetTarget ? (
        <div className="fixed inset-0 z-70 flex animate-fade-in items-center justify-center bg-slate-950/45 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="w-full max-w-md animate-scale-in rounded-lg bg-white p-6 shadow-2xl"
          >
            <h2 id="reset-title" className="text-lg font-bold text-slate-950">
              {resetTarget.hasPassword ? "Reset password?" : "Set a first password?"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              A new temporary password will be generated for {resetTarget.displayName}.
              {resetTarget.hasPassword
                ? " Their current password stops working immediately and any lockout is cleared."
                : ""}{" "}
              They must choose their own password at the next sign-in.
            </p>
            {!resetTarget.email ? (
              <label className="mt-4 block text-sm font-semibold text-(--ec-ink)">
                Email (required to sign in)
                <Input
                  className="mt-1"
                  type="email"
                  required
                  autoFocus
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  placeholder="name@ec.europa.eu"
                />
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResetTarget(undefined)} disabled={Boolean(busyId)}>
                Cancel
              </Button>
              <Button
                onClick={() => void resetPassword()}
                disabled={Boolean(busyId) || (!resetTarget.email && !resetEmail.trim())}
              >
                {busyId ? "Working…" : "Generate password"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(disableTarget)}
        title="Disable account?"
        description={
          disableTarget
            ? `${disableTarget.displayName} will be signed out and unable to sign in until the account is enabled again. Their conversations and files are kept.`
            : ""
        }
        confirmLabel="Disable"
        busy={Boolean(busyId)}
        onCancel={() => setDisableTarget(undefined)}
        onConfirm={() => (disableTarget ? void setDisabled(disableTarget, true) : undefined)}
      />
    </div>
  );
}
