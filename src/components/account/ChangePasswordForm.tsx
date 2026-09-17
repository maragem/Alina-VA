"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/apiError";

const MIN_LENGTH = 12;

type ChangePasswordFormProps = Readonly<{
  email: string | null;
  mustChangePassword: boolean;
}>;

export function ChangePasswordForm({ email, mustChangePassword }: ChangePasswordFormProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (newPassword.length < MIN_LENGTH) {
      setError(`The new password must be at least ${MIN_LENGTH} characters long.`);
      return;
    }
    if (newPassword !== confirmation) {
      setError("The confirmation does not match the new password.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        throw new Error(
          await apiErrorMessage(response, "The password could not be changed."),
        );
      }
      router.replace("/global");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The password could not be changed.");
      setSaving(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
      {email ? (
        <input type="hidden" name="username" value={email} autoComplete="username" />
      ) : null}
      <label className="block text-sm font-semibold text-(--ec-ink)">
        {mustChangePassword ? "Temporary password" : "Current password"}
        <Input
          className="mt-1 rounded-none"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={saving}
        />
      </label>
      <label className="block text-sm font-semibold text-(--ec-ink)">
        New password
        <Input
          className="mt-1 rounded-none"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={saving}
        />
        <span className="mt-1 block text-xs font-normal text-(--ec-mute)">
          At least {MIN_LENGTH} characters.
        </span>
      </label>
      <label className="block text-sm font-semibold text-(--ec-ink)">
        Confirm new password
        <Input
          className="mt-1 rounded-none"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={saving}
        />
      </label>
      {error ? (
        <p className="border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full rounded-none" size="lg" type="submit" disabled={saving}>
        {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
