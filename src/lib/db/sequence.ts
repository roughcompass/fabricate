import { and, asc, count, eq, lte } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Executor } from "./client";

/** A table of an Initiative's numbered records: its Runs or its Evaluations. */
type NumberedTable = SQLiteTable & { id: SQLiteColumn; initiativeId: SQLiteColumn };

/*
 * Sequence numbers within an Initiative, counting from 1 in creation order:
 * "Run #3", "Evaluation #2". They're stable because neither is ever deleted;
 * a change that adds deletion must persist the numbers first.
 */

/** +record+'s sequence number among its Initiative's records in +table+. */
export function sequenceNumber(db: Executor, table: NumberedTable, record: { id: number; initiativeId: number }): number {
  return db.select({ value: count() }).from(table).where(and(eq(table.initiativeId, record.initiativeId), lte(table.id, record.id))).get()?.value ?? 0;
}

/** The sequence number of each of the Initiative +initiativeId+'s records in +table+, by id. */
export function sequenceNumbers(db: Executor, table: NumberedTable, initiativeId: number): Map<number, number> {
  const ids = db.select({ id: table.id }).from(table).where(eq(table.initiativeId, initiativeId)).orderBy(asc(table.id)).all() as { id: number }[];
  return new Map(ids.map(({ id }, index) => [id, index + 1]));
}
