import { type Db, migrateDatabase, openDatabase } from "@/lib/db/client";

/** A fresh in-memory database with every committed migration applied. */
export function createTestDb(): Db {
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  return db;
}

/** Runs raw SQL, bypassing the data-access layer, to prove database-level rules. */
export function rawRun(db: Db, statement: string, ...params: unknown[]): void {
  db.$client.prepare(statement).run(...params);
}
