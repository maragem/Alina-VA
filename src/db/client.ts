import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseConfig } from "./config";
import * as schema from "./schema";

declare global {
  var alinaPostgresPool: Pool | undefined;
}

export const pool = globalThis.alinaPostgresPool ?? new Pool(databaseConfig());

if (process.env.NODE_ENV !== "production") {
  globalThis.alinaPostgresPool = pool;
}

export const db = drizzle(pool, { schema });

let closing = false;

export async function closeDatabase(): Promise<void> {
  if (closing) return;
  closing = true;
  await pool.end();
}

process.once("SIGTERM", () => {
  void closeDatabase();
});