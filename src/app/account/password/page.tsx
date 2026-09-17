import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { EuFlag } from "@/components/EuFlag";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/currentUser";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-full flex-col bg-(--ec-surface) text-(--ec-ink)">
      <div className="h-1 bg-(--ec-yellow)" aria-hidden />
      <header className="bg-(--ec-blue) text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <div className="flex items-center gap-4">
            <EuFlag className="h-10 w-[60px] shrink-0 border border-white/25" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--ec-blue-100)">
                Internal Workspace
              </p>
              <p className="mt-1 font-serif text-2xl font-bold">ALINA</p>
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button
              className="border-transparent bg-transparent text-(--ec-blue-100) hover:bg-(--ec-blue-soft) hover:text-white"
              size="sm"
              type="submit"
              variant="ghost"
            >
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md border border-(--ec-line) bg-white p-7 shadow-sm sm:p-9">
          <KeyRound className="size-9 text-(--ec-blue)" aria-hidden />
          <h1 className="mt-5 font-serif text-2xl font-bold text-(--ec-blue)">
            {user.mustChangePassword ? "Choose a new password" : "Change your password"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-(--ec-mute)">
            {user.mustChangePassword
              ? "You signed in with a temporary password. Set a personal one before continuing."
              : "Enter your current password, then choose a new one."}
          </p>
          <ChangePasswordForm
            email={user.email}
            mustChangePassword={user.mustChangePassword}
          />
        </div>
      </section>

      <footer className="border-t border-(--ec-line) bg-white px-5 py-5 text-center text-xs text-(--ec-mute)">
        European Commission · ALINA Prototype
      </footer>
    </main>
  );
}
