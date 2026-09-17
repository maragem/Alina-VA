export async function register(): Promise<void> {
  // Only the Node.js server runtime has database access; skip the edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrapInitialAdmin } = await import("@/lib/bootstrapAdmin");
  await bootstrapInitialAdmin();
}
