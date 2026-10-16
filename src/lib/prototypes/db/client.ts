import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { type PrototypesDatabase, getConfig } from "@/lib/config";
import * as schema from "./schema";

/**
 * The Prototypes store (design.md, decision 1): an in-process PGlite
 * directory locally and in memory for tests, or Neon over its WebSocket
 * driver, which supports transactions. Both drivers load on demand, so a
 * hosted server never loads PGlite and a local one never opens a socket.
 */

export type PrototypesSchema = typeof schema;
/** A database handle or an open transaction; data-access functions accept either. */
export type PrototypesExecutor = PgDatabase<PgQueryResultHKT, PrototypesSchema>;

export interface PrototypesConnection {
  readonly db: PrototypesExecutor;
  readonly kind: "pglite" | "postgres";
  close(): Promise<void>;
}

export const PROTOTYPES_MIGRATIONS_FOLDER = path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle-prototypes");
const MIGRATIONS = { migrationsSchema: "prototypes", migrationsTable: "__drizzle_migrations" } as const;

/** Opens the configured store, or a fresh in-memory PGlite for `{ kind: "memory" }`. */
export async function openPrototypesDatabase(database: PrototypesDatabase | { kind: "memory" }): Promise<PrototypesConnection> {
  if (database.kind === "postgres") {
    const [{ Pool }, { drizzle }] = await Promise.all([import("@neondatabase/serverless"), import("drizzle-orm/neon-serverless")]);
    const pool = new Pool({ connectionString: database.url });
    return { db: drizzle({ client: pool, schema }) as unknown as PrototypesExecutor, kind: "postgres", close: () => pool.end() };
  }
  const [{ PGlite }, { drizzle }] = await Promise.all([import("@electric-sql/pglite"), import("drizzle-orm/pglite")]);
  if (database.kind === "pglite") fs.mkdirSync(database.dataDir, { recursive: true });
  const client = database.kind === "pglite" ? new PGlite(database.dataDir) : new PGlite();
  await client.waitReady;
  return { db: drizzle({ client, schema }) as unknown as PrototypesExecutor, kind: "pglite", close: () => client.close() };
}

/** Applies committed migrations from drizzle-prototypes/. Neither the server nor a step applies them; `npm run prototypes:migrate` does. */
export async function migratePrototypesDatabase(connection: PrototypesConnection, migrationsFolder = PROTOTYPES_MIGRATIONS_FOLDER): Promise<void> {
  if (connection.kind === "postgres") {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(connection.db as never, { migrationsFolder, ...MIGRATIONS });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(connection.db as never, { migrationsFolder, ...MIGRATIONS });
  }
}

const holder = globalThis as typeof globalThis & { __fabricatePrototypesDb?: Promise<PrototypesConnection> };

/** The process-wide connection to the configured Prototypes store, opened on first use. */
export async function getPrototypesDb(): Promise<PrototypesExecutor> {
  holder.__fabricatePrototypesDb ??= openPrototypesDatabase(getConfig().prototypes.database).catch((error: unknown) => {
    holder.__fabricatePrototypesDb = undefined;
    throw error;
  });
  return (await holder.__fabricatePrototypesDb).db;
}

/** Replaces the process-wide connection (tests and browser-test resets only), closing the old one. */
export async function setPrototypesDb(connection: PrototypesConnection | undefined): Promise<void> {
  const previous = holder.__fabricatePrototypesDb;
  holder.__fabricatePrototypesDb = connection ? Promise.resolve(connection) : undefined;
  if (previous) await (await previous.catch(() => null))?.close();
}

/** Swaps in another connection without closing the old one, which is returned for the caller to close (browser-test resets only). */
export function replacePrototypesDb(connection: PrototypesConnection): Promise<PrototypesConnection | null> | undefined {
  const previous = holder.__fabricatePrototypesDb;
  holder.__fabricatePrototypesDb = Promise.resolve(connection);
  return previous?.catch(() => null);
}
