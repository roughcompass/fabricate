import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "@repo-facts/contract";
import { applicationPreviews, applications, savedRefCheck } from "./applications";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";

// Anonymous workspaces and what they hold: comment threads and share links on
// applications, and each workspace's choice of session preset for each
// application (template-demo/demo-mode spec; add-applications, design
// decision 7; restore-toolbar-tools-and-branch-previews, design decisions 5
// and 8). Only src/lib/workspaces reads them. Deleting a workspace removes
// everything it owns, and deleting an application removes its threads, share
// links, and session presets. The workspace, thread, comment, and share
// tables keep the demo_ names they had under the template demo, so no
// migration renames them; only their names in code changed.

export const THREAD_STATUSES = ["open", "resolved"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/**
 * An anonymous visitor. The browser holds a random credential in an httpOnly
 * cookie; only its SHA-256 digest is stored, so the table cannot be used to
 * impersonate a visitor. Rows are created on the first write.
 */
export const workspaces = sqliteTable(
  "demo_workspaces",
  {
    id: id(),
    keyDigest: text("key_digest").notNull().unique(),
    displayName: text("display_name"),
    /** Guided-hint progress and the hints-off setting, as a JSON object. */
    hints: text("hints").notNull().default("{}"),
    /** Incremented by every reset, so browser-held state from before it is ignored. */
    // Retired: nothing reads or writes it now. It stays, at its default, so stored databases need no rebuild.
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

/** A saved preview's ref as it was when a thread or share link recorded it, kept after the preview is removed. */
const previewRefCheck = (preview: AnySQLiteColumn, ref: AnySQLiteColumn) => sql`(${ref} IS NULL OR (${savedRefCheck(ref)})) AND (${preview} IS NULL OR ${ref} IS NOT NULL)`;

/**
 * A comment thread on one view: an application as seen from one workspace
 * (add-applications, design decision 7). It records the route and the commit
 * of the build it was placed on, and the element by its anchor: a CSS path,
 * its tag, and a fingerprint of its text. It also records the saved preview it
 * was placed on, with that preview's ref, or neither for the tracked branch
 * (restore-toolbar-tools-and-branch-previews, design decision 5); removing
 * the preview keeps the thread and its ref. Deleting the application deletes
 * its threads.
 */
export const commentThreads = sqliteTable(
  "demo_threads",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    commitSha: text("commit_sha").notNull(),
    /** The saved preview it was placed on; null for the tracked branch, or once that preview was removed. */
    applicationPreviewId: integer("application_preview_id").references(() => applicationPreviews.id, { onDelete: "set null" }),
    /** That saved preview's ref, qualified, kept after it's removed. */
    previewRef: text("preview_ref"),
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
    index("demo_threads_application_preview").on(t.applicationPreviewId),
    check("demo_threads_public_id", sql`${t.publicId} GLOB 'thr_*'`),
    check("demo_threads_status", sql.raw(`status IN (${sqlList(THREAD_STATUSES)})`)),
    check("demo_threads_offsets", sql`${t.offsetX} BETWEEN 0 AND 1 AND ${t.offsetY} BETWEEN 0 AND 1`),
    check("demo_threads_resolved", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
    check("demo_threads_route", routeCheck(t.route)),
    check("demo_threads_commit_sha", commitCheck(t.commitSha)),
    check("demo_threads_anchor", sql`json_valid(${t.anchor}) AND json_type(${t.anchor}) = 'object'`),
    check("demo_threads_preview_ref", previewRefCheck(t.applicationPreviewId, t.previewRef)),
  ],
);

/** A comment in a thread, as written, formatting markers included; replies from a reset workspace keep their author's name. */
export const threadComments = sqliteTable(
  "demo_comments",
  {
    id: id(),
    publicId: publicId(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => commentThreads.id, { onDelete: "cascade" }),
    authorWorkspaceId: integer("author_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
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
 * sharer's workspace, whose comments the link shows. It also records the
 * saved preview shown, with its ref as it was then, and the view: the Salt
 * theme, the Microfrontends routing, and the chosen session preset's public
 * ID and name, never its entries (restore-toolbar-tools-and-branch-previews,
 * design decision 5). The link carries a random token; only its SHA-256
 * digest is stored. Resetting the sharer's workspace or deleting the
 * application removes the row, so the link stops working.
 */
export const shareLinks = sqliteTable(
  "demo_shares",
  {
    id: id(),
    tokenDigest: text("token_digest").notNull().unique(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    route: text("route").notNull(),
    /** The saved preview shown; null for the tracked branch, or once that preview was removed. */
    applicationPreviewId: integer("application_preview_id").references(() => applicationPreviews.id, { onDelete: "set null" }),
    /** That saved preview's ref, qualified, kept after it's removed for the link's notice. */
    previewRef: text("preview_ref"),
    /** `{ theme?, routing?, session? }`: what opening the link applies besides the build and route. */
    view: text("view", { mode: "json" }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    index("demo_shares_view_workspace").on(t.viewWorkspaceId),
    index("demo_shares_application").on(t.applicationId),
    index("demo_shares_application_preview").on(t.applicationPreviewId),
    check("demo_shares_token_digest", sql`length(${t.tokenDigest}) = 64`),
    check("demo_shares_commit_sha", commitCheck(t.commitSha)),
    check("demo_shares_route", routeCheck(t.route)),
    check("demo_shares_preview_ref", previewRefCheck(t.applicationPreviewId, t.previewRef)),
    check("demo_shares_view", sql`json_valid(${t.view}) AND json_type(${t.view}) = 'object'`),
  ],
);

/** Where a session preset entry is written: local storage, session storage, a cookie, or a query parameter. */
export const SESSION_PRESET_STORES = ["local", "session", "cookie", "query"] as const;
export type SessionPresetStore = (typeof SESSION_PRESET_STORES)[number];

/**
 * A session preset (restore-toolbar-tools-and-branch-previews, design
 * decision 8; template-demo/session-presets spec): a named set of local
 * storage items, session storage items, cookies, and query parameters that an
 * application starts with. Presets belong to the application, not a
 * workspace, so everyone who can open it sees and changes the same ones; the
 * display name of the workspace that last changed one is kept as it was.
 * They're stored unencrypted. Deleting the application deletes its presets.
 */
export const sessionPresets = sqliteTable(
  "session_presets",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The name trimmed, normalized, and lowercased in code, so names are unique ignoring case within the application. */
    nameKey: text("name_key").notNull(),
    /** `[{ store, name, value }]`, between 1 and 50 entries, in the order they're applied. */
    entries: text("entries", { mode: "json" }).$type<JsonObject[]>().notNull(),
    /** The display name of the workspace that last changed it, when that workspace had one. */
    updatedByName: text("updated_by_name"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("session_presets_name_key").on(t.applicationId, t.nameKey),
    check("session_presets_public_id", sql`${t.publicId} GLOB 'ses_*'`),
    check("session_presets_name", sql`length(trim(${t.name})) BETWEEN 1 AND 60 AND length(${t.nameKey}) > 0`),
    check("session_presets_entries", sql`json_valid(${t.entries}) AND json_type(${t.entries}) = 'array' AND json_array_length(${t.entries}) BETWEEN 1 AND 50`),
    check("session_presets_updated_by_name", sql`${t.updatedByName} IS NULL OR length(trim(${t.updatedByName})) BETWEEN 1 AND 60`),
  ],
);

/**
 * Which session preset a workspace starts an application with
 * (template-demo/session-presets spec, "Each visitor chooses what the
 * application starts with"). No row means the application's own storage.
 * Deleting the workspace, the application, or the preset deletes the choice,
 * so deleting a preset clears everyone's choice of it.
 */
export const sessionPresetChoices = sqliteTable(
  "session_preset_choices",
  {
    id: id(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    presetId: integer("preset_id")
      .notNull()
      .references(() => sessionPresets.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("session_preset_choices_workspace_application").on(t.workspaceId, t.applicationId), index("session_preset_choices_application").on(t.applicationId), index("session_preset_choices_preset").on(t.presetId)],
);
