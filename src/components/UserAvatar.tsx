import { JSX } from "react/jsx-runtime";

type UserAvatarProps = Readonly<{
  name?: string | null;
  email?: string | null;
  className?: string;
  title?: string;
  ariaLabel?: string;
}>;

export function getUserInitials(value: string | null | undefined): string {
  if (!value) return "AU";

  const trimmed = value.trim();
  if (!trimmed) return "AU";

  const nameParts = trimmed
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return (nameParts[0][0] + nameParts[1][0]).toUpperCase();
  }

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }

  const emailLocalPart = trimmed.split("@")[0] ?? "";
  const emailParts = emailLocalPart
    .split(/[._-]+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  if (emailParts.length >= 2) {
    return (emailParts[0][0] + emailParts[1][0]).toUpperCase();
  }

  if (emailParts.length === 1) {
    return emailParts[0].slice(0, 2).toUpperCase();
  }

  return "AU";
}

export function UserAvatar({
  name,
  email,
  className,
  title,
  ariaLabel,
}: UserAvatarProps): JSX.Element {
  const label = name ?? email ?? "ALINA user";
  const initials = getUserInitials(label);

  return (
    <span
      aria-label={ariaLabel ?? `User avatar for ${label}`}
      className={
        "inline-flex size-8 items-center justify-center rounded-full border border-(--ec-blue) bg-(--ec-yellow) text-[11px] font-bold tracking-wide text-(--ec-blue) " +
        (className ?? "")
      }
      title={title ?? label}
    >
      {initials}
    </span>
  );
}
