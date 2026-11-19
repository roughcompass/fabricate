import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

/** How many jobs are in each state, for tests that wait on the queue. */
export function jobCounts(db: Executor): Record<string, number> {
  const rows = db.select({ state: jobs.state, count: sql<number>`count(*)` }).from(jobs).groupBy(jobs.state).all();
  return Object.fromEntries(rows.map((row) => [row.state, row.count]));
}
