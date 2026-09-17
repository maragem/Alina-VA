import { Button } from "@/components/ui/button";
import { KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { UserAvatar } from "@/components/UserAvatar";
import { getCurrentUser } from "@/lib/currentUser";

type AppShellProps = {
  activeTab: "global" | "projects" | "documents" | "admin";
  children: ReactNode;
  footerDetail: string;
};

export async function AppShell({
  activeTab,
  children,
  footerDetail,
}: AppShellProps) {
  const user = await getCurrentUser();
  // The proxy only checks the cookie; a disabled account or a stale session lands here.
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  const userLabel = user.displayName || user.email || "ALINA user";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-(--ec-surface) text-(--ec-ink)">
      <div className="h-1 bg-(--ec-yellow)" aria-hidden />

      <header className="bg-(--ec-blue) text-white border-b border-(--ec-blue-soft)">
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <p className="text-[10px] uppercase tracking-[0.12em] text-(--ec-blue-100)">
            Internal Workspace
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <h1
              className="text-3xl font-bold leading-tight"
              style={{
                fontFamily:
                  "var(--font-noto-serif), Noto Serif, Georgia, serif",
              }}
            >
              ALINA
              <span className="mt-1 block text-sm font-semibold tracking-wide text-(--ec-blue-100) sm:mt-0 sm:ml-3 sm:inline sm:align-middle">
                Procurement Intelligence Assistant
              </span>
            </h1>
            <div className="flex items-center gap-2">
              <UserAvatar
                name={user.displayName}
                email={user.email}
                title={userLabel}
                ariaLabel={`Signed in as ${userLabel}`}
              />
              <span className="hidden max-w-48 truncate text-xs text-(--ec-blue-100) md:inline">
                {userLabel}
              </span>
              <Link
                href="/account/password"
                className="hidden items-center gap-1 rounded-sm px-2 py-1 text-xs text-(--ec-blue-100) hover:bg-(--ec-blue-soft) hover:text-white md:inline-flex"
                title="Change password"
              >
                <KeyRound aria-hidden className="size-3.5" />
                Password
              </Link>
            </div>
          </div>

          <nav
            className="mt-5 -mb-px flex gap-1 overflow-x-auto border-b border-(--ec-blue-soft)"
            aria-label="Primary"
          >
            <Link
              className={`ec-nav-tab ${activeTab === "global" ? "active" : "inactive"}`}
              href="/global"
              aria-current={activeTab === "global" ? "page" : undefined}
            >
              Global
            </Link>
            <Link
              className={`ec-nav-tab ${activeTab === "projects" ? "active" : "inactive"}`}
              href="/projects"
              aria-current={activeTab === "projects" ? "page" : undefined}
            >
              Projects
            </Link>
            <Link
              className={`ec-nav-tab ${activeTab === "documents" ? "active" : "inactive"}`}
              href="/documents"
              aria-current={activeTab === "documents" ? "page" : undefined}
            >
              Documents
            </Link>
            {user.role === "admin" ? (
              <Link
                className={`ec-nav-tab ${activeTab === "admin" ? "active" : "inactive"}`}
                href="/admin"
                aria-current={activeTab === "admin" ? "page" : undefined}
              >
                Admin
              </Link>
            ) : null}

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
              className="ml-auto"
            >
              <Button
                aria-label="Sign out"
                className="h-9 border-transparent bg-transparent px-3 text-sm text-(--ec-blue-100) hover:bg-(--ec-blue-soft) hover:text-white"
                type="submit"
                variant="ghost"
                title="Sign out"
              >
                <LogOut aria-hidden className="mr-2 size-4" />
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>

      <footer className="bg-(--ec-blue) text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-(--ec-blue-100) sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>European Commission · ALINA Prototype</p>
          <p>{footerDetail}</p>
        </div>
      </footer>
    </div>
  );
}
