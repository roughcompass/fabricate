import { and, asc, count, eq, lte } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Executor } from "./client";

/** A table of an Assessment's numbered records: its Runs or its Evaluations. */
type NumberedTable = SQLiteTable & { id: SQLiteColumn; assessmentId: SQLiteColumn };

/*
 * Sequence numbers within an Assessment, counting from 1 in creation order:
 * "Run #3", "Evaluation #2". They're stable because neither is ever deleted;
 * a change that adds deletion must persist the numbers first.
 */

/** +record+'s sequence number among its Assessment's records in +table+. */
export function sequenceNumber(db: Executor, table: NumberedTable, record: { id: number; assessmentId: number }): number {
  return db.select({ value: count() }).from(table).where(and(eq(table.assessmentId, record.assessmentId), lte(table.id, record.id))).get()?.value ?? 0;
}

/** The sequence number of each of the Assessment +assessmentId+'s records in +table+, by id. */
export function sequenceNumbers(db: Executor, table: NumberedTable, assessmentId: number): Map<number, number> {
  const ids = db.select({ id: table.id }).from(table).where(eq(table.assessmentId, assessmentId)).orderBy(asc(table.id)).all() as { id: number }[];
  return new Map(ids.map(({ id }, index) => [id, index + 1]));
}
