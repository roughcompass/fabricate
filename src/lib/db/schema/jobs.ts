import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id, sqlList, timestamp, updatedAt } from "./columns";

export const JOB_STATES = ["queued", "running", "succeeded", "failed"] as const;
export type JobState = (typeof JOB_STATES)[number];

/**
 * Durable background work, claimed by worker processes under a lease. An
 * expired lease makes a running job claimable again, so handlers must be
 * idempotent.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    state: text("state", { enum: JOB_STATES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("jobs_claimable").on(t.state, t.runAfter),
    check("jobs_state", sql.raw(`state IN (${sqlList(JOB_STATES)})`)),
    check("jobs_attempts", sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
    check("jobs_payload", sql`json_valid(${t.payload}) AND json_type(${t.payload}) = 'object'`),
    check("jobs_lease", sql`(${t.state} = 'running') = (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`),
  ],
);
