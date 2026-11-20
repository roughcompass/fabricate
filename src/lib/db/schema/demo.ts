import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "@repo-facts/contract";
import { applications } from "./applications";
import { createdAt, id, publicId, sqlList, timestamp } from "./columns";

// Anonymous workspaces and what they hold: comment threads and share links on
// applications (template-demo/demo-mode spec; add-applications, design
// decision 7). Only src/lib/demo reads them. Deleting a workspace removes
// everything it owns, and deleting an application removes its threads and
// share links.

export const THREAD_STATUSES = ["open", "resolved"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/**
 * An anonymous visitor. The browser holds a random credential in an httpOnly
 * cookie; only its SHA-256 digest is stored, so the table cannot be used to
 * impersonate a visitor. Rows are created on the first write.
 */
export const demoWorkspaces = sqliteTable(
  "demo_workspaces",
  {
    id: id(),
    keyDigest: text("key_digest").notNull().unique(),
    displayName: text("display_name"),
    /** Guided-hint progress and the hints-off setting, as a JSON object. */
    hints: text("hints").notNull().default("{}"),
    /** Incremented by every reset, so browser-held state from before it is ignored. */
    resetEpoch: integer("reset_epoch").notNull().default(0),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
  },
  (t) => [
    index("demo_workspaces_last_seen").on(t.lastSeenAt),
    check("demo_workspaces_key_digest", sql`length(${t.keyDigest}) = 64`),
    check("demo_workspaces_display_name", sql`${t.displayName} IS NULL OR length(trim(${t.displayName})) BETWEEN 1 AND 60`),
    check("demo_workspaces_hints", sql`json_valid(${t.hints}) AND json_type(${t.hints}) = 'object'`),
    check("demo_workspaces_reset_epoch", sql`${t.resetEpoch} >= 0`),
  ],
);

/** A commit SHA: 40 lowercase hex characters. */
const commitCheck = (column: AnySQLiteColumn) => sql`length(${column}) = 40 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
/** An application's own route: a path from its root, such as /accounts/42. */
const routeCheck = (column: AnySQLiteColumn) => sql`${column} GLOB '/*' AND length(${column}) <= 2048`;

/**
 * A comment thread on one view: an application as seen from one workspace
 * (add-applications, design decision 7). It records the route and the commit
 * of the build it was placed on, and the element by its anchor: a CSS path,
 * its tag, and a fingerprint of its text. Deleting the application deletes
 * its threads.
 */
export const demoThreads = sqliteTable(
  "demo_threads",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    commitSha: text("commit_sha").notNull(),
    /** The element: `{ path, tag, fingerprint }`. */
    anchor: text("anchor", { mode: "json" }).$type<JsonObject>().notNull(),
    offsetX: real("offset_x").notNull(),
    offsetY: real("offset_y").notNull(),
    status: text("status", { enum: THREAD_STATUSES }).notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("demo_threads_view").on(t.applicationId, t.viewWorkspaceId),
    index("demo_threads_workspace").on(t.viewWorkspaceId, t.status),
    check("demo_threads_public_id", sql`${t.publicId} GLOB 'thr_*'`),
    check("demo_threads_status", sql.raw(`status IN (${sqlList(THREAD_STATUSES)})`)),
    check("demo_threads_offsets", sql`${t.offsetX} BETWEEN 0 AND 1 AND ${t.offsetY} BETWEEN 0 AND 1`),
    check("demo_threads_resolved", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
    check("demo_threads_route", routeCheck(t.route)),
    check("demo_threads_commit_sha", commitCheck(t.commitSha)),
    check("demo_threads_anchor", sql`json_valid(${t.anchor}) AND json_type(${t.anchor}) = 'object'`),
  ],
);

/** A comment in a thread, as written, formatting markers included; replies from a reset workspace keep their author's name. */
export const demoComments = sqliteTable(
  "demo_comments",
  {
    id: id(),
    publicId: publicId(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => demoThreads.id, { onDelete: "cascade" }),
    authorWorkspaceId: integer("author_workspace_id").references(() => demoWorkspaces.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("demo_comments_thread").on(t.threadId, t.createdAt),
    check("demo_comments_public_id", sql`${t.publicId} GLOB 'cmt_*'`),
    check("demo_comments_author_name", sql`length(trim(${t.authorName})) BETWEEN 1 AND 60`),
    check("demo_comments_body", sql`length(trim(${t.body})) BETWEEN 1 AND 2000`),
  ],
);

/**
 * A share link to one view of an application (add-applications, design
 * decision 7): the commit of the build shown and the route, with the
 * sharer's workspace, whose comments the link shows. The link carries a
 * random token; only its SHA-256 digest is stored. Resetting the sharer's
 * workspace or deleting the application removes the row, so the link stops
 * working.
 */
export const demoShares = sqliteTable(
  "demo_shares",
  {
    id: id(),
    tokenDigest: text("token_digest").notNull().unique(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    route: text("route").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("demo_shares_view_workspace").on(t.viewWorkspaceId),
    index("demo_shares_application").on(t.applicationId),
    check("demo_shares_token_digest", sql`length(${t.tokenDigest}) = 64`),
    check("demo_shares_commit_sha", commitCheck(t.commitSha)),
    check("demo_shares_route", routeCheck(t.route)),
  ],
);
