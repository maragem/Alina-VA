import "server-only";

type Check = Readonly<{ ok: boolean; message: string }>;

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Logs one clear line per configuration problem at server start. It never
 * throws: the app still boots so the health check and logs stay reachable, but
 * the operator sees exactly which variable to fix instead of a library error
 * such as MissingSecret or UntrustedHost on the first request.
 */
export function runStartupChecks(): void {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const hasDatabase =
    present("DATABASE_URL") ||
    (present("DB_HOST") && present("DB_NAME") && present("DB_USER") && present("DB_PASSWORD"));
  const onRailway = present("RAILWAY_ENVIRONMENT") || present("RAILWAY_PROJECT_ID");
  const tlsDefaultsOn =
    process.env.DB_SSL === undefined && process.env.NODE_ENV === "production";

  const checks: Check[] = [
    {
      ok: secret.length >= 32,
      message: secret
        ? "AUTH_SECRET is shorter than 32 characters; generate one with `openssl rand -base64 33`."
        : "AUTH_SECRET is not set; sessions cannot be issued. Generate one with `openssl rand -base64 33`.",
    },
    {
      ok: hasDatabase,
      message: "No database configuration: set DATABASE_URL (on Railway: ${{Postgres.DATABASE_URL}}).",
    },
    {
      ok: !(onRailway && tlsDefaultsOn),
      message:
        "Running on Railway without DB_SSL: production defaults to TLS, which Railway's internal Postgres does not serve. Set DB_SSL=false.",
    },
    {
      ok: present("AUTH_URL"),
      message: "AUTH_URL is not set; redirects will use the incoming Host header. Set it to the public https URL.",
    },
    {
      ok: present("HAYSTACK_API_KEY") && present("HAYSTACK_WORKSPACE") && present("HAYSTACK_PIPELINE"),
      message:
        "Haystack variables incomplete (HAYSTACK_API_KEY, HAYSTACK_WORKSPACE, HAYSTACK_PIPELINE); chat and documents will return configuration errors.",
    },
  ];

  const problems = checks.filter((check) => !check.ok);
  const line = (level: "info" | "warn", message: string) =>
    JSON.stringify({ level, source: "startup-check", message });
  if (problems.length === 0) {
    console.log(line("info", "Configuration check passed."));
    return;
  }
  for (const problem of problems) console.warn(line("warn", problem.message));
}
