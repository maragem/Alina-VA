import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Drizzle CLI commands.");
}

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});