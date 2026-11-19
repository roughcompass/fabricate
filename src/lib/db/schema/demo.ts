import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { PERSONAS } from "../../demo/catalog/types";
import { createdAt, id, publicId, sqlList, timestamp, updatedAt } from "./columns";

// Template demo data (design.md, decision 4). These tables never reference
// Repository, Assessment, Run, Evaluation, or Standard rows, and nothing outside
// src/lib/demo reads them. Deleting a workspace removes everything it owns.

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

/** A comment thread on one view: a reference deployment as seen from one workspace. */
export const demoThreads = sqliteTable(
  "demo_threads",
  {
    id: id(),
    publicId: publicId(),
    referenceSlug: text("reference_slug").notNull(),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    member: text("member").notNull(),
    memberVersion: text("member_version").notNull(),
    anchor: text("anchor").notNull(),
    offsetX: real("offset_x").notNull(),
    offsetY: real("offset_y").notNull(),
    status: text("status", { enum: THREAD_STATUSES }).notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("demo_threads_reference").on(t.referenceSlug, t.viewWorkspaceId),
    check("demo_threads_public_id", sql`${t.publicId} GLOB 'thr_*'`),
    check("demo_threads_status", sql.raw(`status IN (${sqlList(THREAD_STATUSES)})`)),
    check("demo_threads_offsets", sql`${t.offsetX} BETWEEN 0 AND 1 AND ${t.offsetY} BETWEEN 0 AND 1`),
    check("demo_threads_resolved", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
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
 * A share link to one view. The link carries a random token; only its SHA-256
 * digest is stored. Resetting the sharer's workspace removes the row, so the
 * link stops working.
 */
export const demoShares = sqliteTable(
  "demo_shares",
  {
    id: id(),
    tokenDigest: text("token_digest").notNull().unique(),
    referenceSlug: text("reference_slug").notNull(),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    /** The captured route, overrides, theme, and persona, as a JSON object. */
    state: text("state").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("demo_shares_view_workspace").on(t.viewWorkspaceId),
    check("demo_shares_token_digest", sql`length(${t.tokenDigest}) = 64`),
    check("demo_shares_state", sql`json_valid(${t.state}) AND json_type(${t.state}) = 'object'`),
  ],
);

/**
 * A session profile a visitor created: who is using a running application,
 * with a persona and a region (template-demo/toolbar spec; design.md,
 * decision 6). Profiles belong to the workspace, so every application the
 * visitor opens offers them. name_key is the name lowercased in code (SQLite's
 * lower() folds only ASCII), unique within the workspace; the built-in
 * profiles' names are refused in code.
 */
export const demoProfiles = sqliteTable(
  "demo_profiles",
  {
    id: id(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    persona: text("persona", { enum: PERSONAS }).notNull(),
    region: text("region").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("demo_profiles_name").on(t.workspaceId, t.nameKey),
    index("demo_profiles_workspace").on(t.workspaceId, t.createdAt),
    check("demo_profiles_public_id", sql`${t.publicId} GLOB 'dpf_*'`),
    check("demo_profiles_name", sql`length(trim(${t.name})) BETWEEN 1 AND 60`),
    check("demo_profiles_persona", sql.raw(`persona IN (${sqlList(PERSONAS)})`)),
    check("demo_profiles_region", sql`length(trim(${t.region})) BETWEEN 1 AND 60`),
  ],
);
