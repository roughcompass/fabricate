import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, publicId, sqlList, timestamp } from "./columns";

// Template demo data (design.md, decision 4). These tables never reference
// catalog, assessment, evaluation, or standard rows, and nothing outside
// src/lib/demo reads them. Deleting a workspace removes everything it owns.

export const DEMO_ENVIRONMENTS = ["sandbox", "dev"] as const;
export type DemoEnvironment = (typeof DEMO_ENVIRONMENTS)[number];

/** Where an application came from: a template's deploy form, or a repository import. */
export const DEMO_ORIGINS = ["template", "import"] as const;
export type DemoOrigin = (typeof DEMO_ORIGINS)[number];

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

/** An application a visitor created from a template or imported from the demo's BitBucket. Its deployment is simulated. */
export const demoApplications = sqliteTable(
  "demo_applications",
  {
    id: id(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    templateSlug: text("template_slug").notNull(),
    name: text("name").notNull(),
    environment: text("environment", { enum: DEMO_ENVIRONMENTS }).notNull(),
    bitbucketProject: text("bitbucket_project"),
    bitbucketRepository: text("bitbucket_repository"),
    /** Added by migration 0014; earlier applications all came from templates. */
    origin: text("origin", { enum: DEMO_ORIGINS }).notNull().default("template"),
    createdAt: createdAt(),
    buildSkippedAt: timestamp("build_skipped_at"),
  },
  (t) => [
    index("demo_applications_workspace").on(t.workspaceId, t.createdAt),
    uniqueIndex("demo_applications_repository").on(t.workspaceId, t.bitbucketProject, t.bitbucketRepository).where(sql`${t.environment} = 'dev'`),
    check("demo_applications_public_id", sql`${t.publicId} GLOB 'app_*'`),
    check("demo_applications_name", sql`length(trim(${t.name})) BETWEEN 1 AND 80`),
    check("demo_applications_environment", sql.raw(`environment IN (${sqlList(DEMO_ENVIRONMENTS)})`)),
    check(
      "demo_applications_bitbucket",
      sql`(${t.environment} = 'dev' AND ${t.bitbucketProject} IS NOT NULL AND ${t.bitbucketRepository} IS NOT NULL) OR (${t.environment} = 'sandbox' AND ${t.bitbucketProject} IS NULL AND ${t.bitbucketRepository} IS NULL)`,
    ),
  ],
);

/**
 * A comment thread on one view of an application: a visitor's own application,
 * or a reference deployment as seen from one workspace. Exactly one of
 * application_id and reference_slug is set.
 */
export const demoThreads = sqliteTable(
  "demo_threads",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id").references(() => demoApplications.id, { onDelete: "cascade" }),
    referenceSlug: text("reference_slug"),
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
    index("demo_threads_application").on(t.applicationId),
    index("demo_threads_reference").on(t.referenceSlug, t.viewWorkspaceId),
    check("demo_threads_public_id", sql`${t.publicId} GLOB 'thr_*'`),
    check("demo_threads_target", sql`(${t.applicationId} IS NULL) <> (${t.referenceSlug} IS NULL)`),
    check("demo_threads_status", sql.raw(`status IN (${sqlList(THREAD_STATUSES)})`)),
    check("demo_threads_offsets", sql`${t.offsetX} BETWEEN 0 AND 1 AND ${t.offsetY} BETWEEN 0 AND 1`),
    check("demo_threads_resolved", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
  ],
);

/** A comment in a thread. Plain text; replies from a reset workspace keep their author's name. */
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
 * digest is stored. Deleting the application or resetting the sharer's
 * workspace removes the row, so the link stops working.
 */
export const demoShares = sqliteTable(
  "demo_shares",
  {
    id: id(),
    tokenDigest: text("token_digest").notNull().unique(),
    applicationId: integer("application_id").references(() => demoApplications.id, { onDelete: "cascade" }),
    referenceSlug: text("reference_slug"),
    viewWorkspaceId: integer("view_workspace_id")
      .notNull()
      .references(() => demoWorkspaces.id, { onDelete: "cascade" }),
    /** The captured route, overrides, theme, and persona, as a JSON object. */
    state: text("state").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("demo_shares_application").on(t.applicationId),
    index("demo_shares_view_workspace").on(t.viewWorkspaceId),
    check("demo_shares_token_digest", sql`length(${t.tokenDigest}) = 64`),
    check("demo_shares_target", sql`(${t.applicationId} IS NULL) <> (${t.referenceSlug} IS NULL)`),
    check("demo_shares_state", sql`json_valid(${t.state}) AND json_type(${t.state}) = 'object'`),
  ],
);
