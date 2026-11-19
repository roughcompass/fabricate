import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, MIGRATIONS_FOLDER, migrateDatabase, openDatabase } from "@/lib/db/client";

/** A fresh in-memory database with the migrations in +folder+ applied: by default, every committed one. */
export function createTestDb(folder: string = MIGRATIONS_FOLDER): Db {
  const db = openDatabase(":memory:");
  migrateDatabase(db, folder);
  return db;
}

/** Applies every committed migration +db+ hasn't run yet, as an upgrade does. */
export function migrateToLatest(db: Db): void {
  migrateDatabase(db);
}

/** Creates a migrated database file at +file+ and closes it, for a process the test starts. */
export function createTestDbFile(file: string): void {
  const db = openDatabase(file);
  migrateDatabase(db);
  db.$client.close();
}

/**
 * Runs +work+ with two connections to one migrated database file, as two
 * processes would hold, then closes both and removes the file.
 */
export async function withSharedFileDb<T>(work: (first: Db, second: Db) => T | Promise<T>): Promise<T> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-shared-"));
  const file = path.join(directory, "fabricate.sqlite3");
  const first = openDatabase(file);
  migrateDatabase(first);
  const second = openDatabase(file);
  try {
    return await work(first, second);
  } finally {
    second.$client.close();
    first.$client.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** Runs raw SQL, bypassing the data-access layer, to prove database-level rules. */
export function rawRun(db: Db, statement: string, ...params: unknown[]): void {
  db.$client.prepare(statement).run(...params);
}
