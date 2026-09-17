import "server-only";

import { countAdmins, createAdminIfMissing } from "@/db/repositories/users";
import { passwordPolicyError } from "@/lib/password";

function log(level: "info" | "warn" | "error", message: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, source: "bootstrap-admin", message, ...extra });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD when the
 * database holds no admin yet. Runs once per server start; a no-op afterwards,
 * so the variables can stay set (or be removed) once the account exists.
 * The created admin must change the password at first sign-in.
 */
export async function bootstrapInitialAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME?.trim() || "ALINA administrator";
  if (!email && !password) return;
  if (!email || !password) {
    log("warn", "ADMIN_EMAIL and ADMIN_PASSWORD must both be set to bootstrap an administrator.");
    return;
  }
  const policyError = passwordPolicyError(password);
  if (policyError) {
    log("warn", `ADMIN_PASSWORD rejected: ${policyError}`);
    return;
  }

  try {
    if ((await countAdmins()) > 0) return;
    const outcome = await createAdminIfMissing({ email, displayName, password });
    if (outcome === "created") {
      log("info", "Initial administrator created; the password must be changed at first sign-in.", { email });
    } else {
      log("warn", "ADMIN_EMAIL belongs to an existing non-admin user; promote it from the Admin page instead.", { email });
    }
  } catch (error) {
    log("error", "Administrator bootstrap failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
