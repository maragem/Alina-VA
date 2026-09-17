import { LogIn, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { EuFlag } from "@/components/EuFlag";
import { Button } from "@/components/ui/button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user?.id) redirect("/global");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-full flex-col bg-(--ec-surface) text-(--ec-ink)">
      <div className="h-1 bg-(--ec-yellow)" aria-hidden />
      <header className="bg-(--ec-blue) text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-5 py-6 sm:px-8">
          <EuFlag className="h-10 w-[60px] shrink-0 border border-white/25" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--ec-blue-100)">
              Internal Workspace
            </p>
            <p className="mt-1 font-serif text-2xl font-bold">ALINA</p>
          </div>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md border border-(--ec-line) bg-white p-7 shadow-sm sm:p-9">
          <ShieldCheck className="size-9 text-(--ec-blue)" aria-hidden />
          <h1 className="mt-5 font-serif text-2xl font-bold text-(--ec-blue)">
            Sign in to ALINA
          </h1>
          <p className="mt-2 text-sm leading-6 text-(--ec-mute)">
            Use your authorized account to access the procurement intelligence workspace.
          </p>

          {error ? (
            <p className="mt-5 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              Sign-in could not be completed. Please try again.
            </p>
          ) : null}

          <form
            className="mt-7"
            action={async () => {
              "use server";
              await signIn("cognito", { redirectTo: "/global" });
            }}
          >
            <Button className="w-full rounded-none" size="lg" type="submit">
              <LogIn aria-hidden />
              Sign in
            </Button>
          </form>
        </div>
      </section>

      <footer className="border-t border-(--ec-line) bg-white px-5 py-5 text-center text-xs text-(--ec-mute)">
        European Commission · ALINA Prototype
      </footer>
    </main>
  );
}