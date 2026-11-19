import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

type Schema = typeof schema;
export type Db = BetterSQLite3Database<Schema> & { $client: Database.Database };
/** A database handle or an open transaction; data-access functions accept either. */
export type Executor = BaseSQLiteDatabase<"sync", Database.RunResult, Schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Opens a SQLite database with the pragmas every Fabricate process relies on:
 * write-ahead logging so the web server and worker can read while one writes,
 * enforced foreign keys, and a busy timeout so immediate transactions wait for
 * the single writer instead of failing.
 */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  return drizzle(sqlite, { schema }) as Db;
}

/**
 * Applies committed SQL migrations from drizzle/. A migration that rebuilds a
 * table drops it while other rows still reference it, which an enforced
 * foreign key refuses. SQLite can switch enforcement only outside a
 * transaction, and Drizzle applies every pending migration in one, so
 * enforcement is off for the run; a rebuilding migration checks every foreign
 * key before it ends, so a broken reference rolls the whole run back.
 */
export function migrateDatabase(db: Db, migrationsFolder = MIGRATIONS_FOLDER): void {
  if (!hasMigrations(migrationsFolder)) return;
  const enforced = db.$client.pragma("foreign_keys", { simple: true }) === 1;
  if (enforced) db.$client.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
  } finally {
    if (enforced) db.$client.pragma("foreign_keys = ON");
  }
}

/** Number of committed migrations not yet applied to this database. */
export function pendingMigrationCount(db: Db, migrationsFolder = MIGRATIONS_FOLDER): number {
  if (!hasMigrations(migrationsFolder)) return 0;

  const migrations = readMigrationFiles({ migrationsFolder });
  const table = db.$client.prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  if (!table) return migrations.length;

  const row = db.get<{ last: number | null }>(sql`select max(created_at) as last from __drizzle_migrations`);
  const last = row?.last ?? 0;
  return migrations.filter((migration) => migration.folderMillis > last).length;
}

const holder = globalThis as typeof globalThis & { __frontendRegistryDb?: Db };

/** The process-wide connection to the configured database. */
export function getDb(): Db {
  return (holder.__frontendRegistryDb ??= openDatabase(getConfig().database));
}

/** Replaces the process-wide connection (tests only). */
export function setDb(db: Db | undefined): void {
  holder.__frontendRegistryDb = db;
}

/**
 * Runs +work+ in an immediate transaction, which takes SQLite's write lock at
 * the start so concurrent writers serialize instead of failing mid-transaction.
 * Inside an existing transaction it runs in a savepoint.
 */
export function immediate<T>(db: Executor, work: (tx: Executor) => T): T {
  return db.transaction((tx) => work(tx), { behavior: "immediate" });
}

function hasMigrations(migrationsFolder: string): boolean {
  return fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"));
}
