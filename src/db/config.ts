import type { PoolConfig } from "pg";
import { existsSync, readFileSync } from "node:fs";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function databaseConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  const useTls = process.env.DB_SSL
    ? process.env.DB_SSL === "true"
    : process.env.NODE_ENV === "production";
  const certificate = process.env.DB_SSL_CA?.replaceAll("\\n", "\n") ??
    (existsSync("/app/aws-rds-global-bundle.pem")
      ? readFileSync("/app/aws-rds-global-bundle.pem", "utf8")
      : undefined);
  const shared: PoolConfig = {
    application_name: "alina",
    max: positiveInteger("DB_POOL_MAX", 5),
    connectionTimeoutMillis: positiveInteger("DB_CONNECTION_TIMEOUT_MS", 5_000),
    idleTimeoutMillis: positiveInteger("DB_IDLE_TIMEOUT_MS", 30_000),
    statement_timeout: positiveInteger("DB_STATEMENT_TIMEOUT_MS", 30_000),
    ...(useTls
      ? { ssl: { rejectUnauthorized: true, ...(certificate ? { ca: certificate } : {}) } }
      : {}),
  };

  if (connectionString) return { ...shared, connectionString };

  const host = process.env.DB_HOST?.trim();
  const database = process.env.DB_NAME?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      "Database configuration is missing. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.",
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