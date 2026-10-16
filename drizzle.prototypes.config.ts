import { defineConfig } from "drizzle-kit";

// Prototypes' Postgres store (design.md, decision 1), apart from the SQLite
// database and its drizzle/ migrations: `npx drizzle-kit generate --config drizzle.prototypes.config.ts`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/prototypes/db/schema.ts",
  out: "./drizzle-prototypes",
  schemaFilter: ["prototypes"],
  migrations: { schema: "prototypes", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
