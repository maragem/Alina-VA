import { LogIn, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { auth, signIn, signOut } from "@/auth";
import { EuFlag } from "@/components/EuFlag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrentUser } from "@/lib/currentUser";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; code?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "The email address or password is incorrect.",
  locked:
    "This account is temporarily locked after too many failed attempts. Try again in 15 minutes or ask an administrator to reset your password.",
  disabled: "This account has been disabled. Contact an administrator.",
};

function errorMessage(error: string | undefined, code: string | undefined): string | null {
  if (!error) return null;
  return (
    (code && ERROR_MESSAGES[code]) ??
    ERROR_MESSAGES[error] ??
    "Sign-in could not be completed. Please try again."
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const hasStaleSession = Boolean(session?.user?.id);
  if (hasStaleSession) {
    // A cookie may outlive the account (disabled or deleted); only a live user proceeds.
    const user = await getCurrentUser();
    if (user) redirect("/global");
  }

  const { error, code } = await searchParams;
  const message = errorMessage(error, code);

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
            Use the account an administrator created for you. Accounts are
            managed inside ALINA; there is no self-registration.
          </p>

          {hasStaleSession ? (
            <div className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              <p>Your account is disabled or no longer exists. Sign out to continue.</p>
              <form
                className="mt-3"
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button variant="outline" size="sm" type="submit">Sign out</Button>
              </form>
            </div>
          ) : null}

          {message ? (
            <p className="mt-5 border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {message}
            </p>
          ) : null}

          <form
            className="mt-7 space-y-4"
            action={async (formData) => {
              "use server";
              try {
                await signIn("credentials", {
                  email: formData.get("email"),
                  password: formData.get("password"),
                  redirectTo: "/global",
                });
              } catch (signInError) {
                if (signInError instanceof AuthError) {
                  const errorCode =
                    signInError instanceof CredentialsSignin
                      ? signInError.code
                      : "";
                  redirect(
                    `/login?error=${encodeURIComponent(signInError.type)}` +
                      (errorCode ? `&code=${encodeURIComponent(errorCode)}` : ""),
                  );
                }
                throw signInError;
              }
            }}
          >
            <label className="block text-sm font-semibold text-(--ec-ink)">
              Email
              <Input
                className="mt-1 rounded-none"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label className="block text-sm font-semibold text-(--ec-ink)">
              Password
              <Input
                className="mt-1 rounded-none"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <Button className="w-full rounded-none" size="lg" type="submit">
              <LogIn aria-hidden />
              Sign in
            </Button>
          </form>
          <p className="mt-5 text-xs leading-5 text-(--ec-mute)">
            Forgot your password? Ask an ALINA administrator to issue a
            temporary one; you will be asked to change it at sign-in.
          </p>
        </div>
      </section>

      <footer className="border-t border-(--ec-line) bg-white px-5 py-5 text-center text-xs text-(--ec-mute)">
        European Commission · ALINA Prototype
      </footer>
    </main>
  );
}
