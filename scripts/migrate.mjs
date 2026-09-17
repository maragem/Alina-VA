import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;
const MIGRATION_LOCK_ID = 4_180_146;

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  const useTls = process.env.DB_SSL
    ? process.env.DB_SSL === "true"
    : process.env.NODE_ENV === "production";
  const certificate =
    process.env.DB_SSL_CA?.replaceAll("\\n", "\n") ??
    (existsSync("/app/aws-rds-global-bundle.pem")
      ? readFileSync("/app/aws-rds-global-bundle.pem", "utf8")
      : undefined);
  const shared = {
    application_name: "alina-migrations",
    max: 1,
    connectionTimeoutMillis: positiveInteger(
      "DB_CONNECTION_TIMEOUT_MS",
      5_000,
    ),
    statement_timeout: positiveInteger("DB_STATEMENT_TIMEOUT_MS", 30_000),
    ...(useTls
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(certificate ? { ca: certificate } : {}),
          },
        }
      : {}),
  };
  if (connectionString) return { ...shared, connectionString };

  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      "Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.",
    );
  }
  return {
    ...shared,
    host,
    port: positiveInteger("DB_PORT", 5432),
    database,
    user,
    password,
  };
}

const pool = new Pool(databaseConfig());
const client = await pool.connect();

try {
  await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  console.log(JSON.stringify({ level: "info", message: "Database migrations complete." }));
} catch (error) {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Database migration failed.",
      error: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
} finally {
  await client
    .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
    .catch(() => undefined);
  client.release();
  await pool.end();
}