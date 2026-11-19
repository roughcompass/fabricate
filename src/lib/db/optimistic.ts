import { type SQL, and, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import type { Executor } from "./client";
import { StaleRecordError } from "./errors";

/** A table whose rows carry an id and an optimistic lock version. */
type LockedTable = SQLiteTable & { id: SQLiteColumn; lockVersion: SQLiteColumn };

/**
 * Writes +values+ to the row +current+ and moves its lock version on, only
 * while the row's lock version is still +expected+ (by default the one
 * +current+ was read with) and +guard+, such as an unchanged state, holds.
 * Otherwise someone else changed it first, and it throws StaleRecordError
 * with +stale+.
 */
export function updateLocked<T extends LockedTable>(
  db: Executor,
  table: T,
  current: { id: number; lockVersion: number },
  values: SQLiteUpdateSetSource<T>,
  stale: string,
  options: { expected?: number; guard?: SQL } = {},
): T["$inferSelect"] {
  const expected = options.expected ?? current.lockVersion;
  const updated = db
    .update(table)
    .set({ ...values, lockVersion: expected + 1 } as SQLiteUpdateSetSource<T>)
    .where(and(eq(table.id, current.id), eq(table.lockVersion, expected), options.guard))
    .returning()
    .get() as T["$inferSelect"] | undefined;
  if (!updated) throw new StaleRecordError(stale);
  return updated;
}
