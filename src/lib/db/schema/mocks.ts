import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "@repo-facts/contract";
import { applicationPreviews, applications } from "./applications";
import { createdAt, id, lockVersion, publicId, sqlList, timestamp, updatedAt } from "./columns";
import { previewScreenshots } from "./previews";
import { workspaces } from "./workspaces";

/*
 * Mock sets (add-mock-sets, design decisions 9 and 10; applications/mock-sets
 * spec): an application's named sets of rules that answer its builds' API
 * calls in previews and screenshots. Rows hold everything matching and pages
 * need, never a body: bodies are content-addressed files under
 * `<previews.storage>/.mock-sets/<set>/`, and import drafts' under
 * `.mock-imports/<import>/` (src/lib/mocks/storage.ts). Sets belong to the
 * application, so every workspace sees and changes the same ones; each
 * workspace only chooses which applies to its views. Deleting an application
 * deletes its sets, rules, defaults, choices, and drafts, and the worker's
 * sweep then removes their files. That a default, choice, or draft names a set
 * of its own application is kept by src/lib/mocks/records.ts, since SQLite
 * can't check it across tables without triggers.
 */

/** Where a set's rules came from: an uploaded HAR, written by hand, or started from the calls a capture saw fail. */
export const MOCK_SET_SOURCES = ["har", "written", "calls"] as const;
export type MockSetSource = (typeof MOCK_SET_SOURCES)[number];

/** Whether a set's rules match any host, or each recorded origin as mapped (design decision 5). */
export const MOCK_HOST_MODES = ["any", "mapped"] as const;
export type MockHostMode = (typeof MOCK_HOST_MODES)[number];

/** What a call no rule matches gets: its own address, or the 501 (design decision 8). */
export const MOCK_UNMATCHED = ["pass", "not_mocked"] as const;
export type MockUnmatched = (typeof MOCK_UNMATCHED)[number];

export const MOCK_QUERY_MODES = ["exact", "ignore_listed", "ignore_all"] as const;
export type MockQueryMode = (typeof MOCK_QUERY_MODES)[number];

export const MOCK_BODY_MODES = ["ignore", "exact", "json"] as const;
export type MockBodyMode = (typeof MOCK_BODY_MODES)[number];

/** How a call failed when a build was captured (design decision 11): a status of 400 or more, no connection, CORS, the 501, or a WebSocket that never opened. */
export const FAILED_CALL_KINDS = ["status", "connect", "cors", "not_mocked", "websocket"] as const;
export type FailedCallKind = (typeof FAILED_CALL_KINDS)[number];

/** The most responses a rule holds, answered in order, then the last again. */
const RESPONSE_LIMIT = 20;

const nameCheck = (column: AnySQLiteColumn) => sql`${column} IS NULL OR length(trim(${column})) BETWEEN 1 AND 60`;
const digestCheck = (column: AnySQLiteColumn) => sql`${column} IS NULL OR (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
const jsonArray = (column: AnySQLiteColumn, max: number) => sql`json_valid(${column}) AND json_type(${column}) = 'array' AND json_array_length(${column}) <= ${sql.raw(String(max))}`;

/**
 * Every response's status is from 200 to 599. SQLite's checks can't hold a
 * subquery, so each of the at most 20 positions is checked on its own.
 */
function responseStatuses(column: AnySQLiteColumn) {
  const positions = Array.from({ length: RESPONSE_LIMIT }, (_, index) => {
    const path = sql.raw(`'$[${index}]'`);
    const status = sql.raw(`'$[${index}].status'`);
    return sql`(json_type(${column}, ${path}) IS NULL OR (json_type(${column}, ${status}) = 'integer' AND json_extract(${column}, ${status}) BETWEEN 200 AND 599))`;
  });
  return sql.join(positions, sql` AND `);
}

/**
 * A mock set: an application's named rules, with how they match hosts and
 * what calls no rule matches get. `revision` goes up with every change to
 * the set or its rules, so a browser or a capture holding an earlier one
 * fetches it again. `rule_count` and `body_bytes` are kept in each change's
 * transaction, so the application page reads only set rows.
 */
export const mockSets = sqliteTable(
  "mock_sets",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The name trimmed, normalized, and lowercased in code, so names are unique ignoring case within the application. */
    nameKey: text("name_key").notNull(),
    description: text("description"),
    source: text("source", { enum: MOCK_SET_SOURCES }).notNull(),
    /** The name of the HAR file it was uploaded from, for a set from an upload. */
    sourceFile: text("source_file"),
    hostMode: text("host_mode", { enum: MOCK_HOST_MODES }).notNull().default("any"),
    /** `[{ from, to }]`: each recorded origin and the origin the build calls instead, or `self`; up to 20. */
    hosts: text("hosts", { mode: "json" }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    unmatched: text("unmatched", { enum: MOCK_UNMATCHED }).notNull().default("pass"),
    revision: integer("revision").notNull().default(1),
    ruleCount: integer("rule_count").notNull().default(0),
    /** The bytes of the distinct bodies stored for its rules. */
    bodyBytes: integer("body_bytes").notNull().default(0),
    createdByName: text("created_by_name"),
    updatedByName: text("updated_by_name"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("mock_sets_name_key").on(t.applicationId, t.nameKey),
    check("mock_sets_public_id", sql`${t.publicId} GLOB 'mks_*'`),
    check("mock_sets_name", sql`length(trim(${t.name})) BETWEEN 1 AND 60 AND length(${t.nameKey}) > 0`),
    check("mock_sets_description", sql`${t.description} IS NULL OR length(${t.description}) <= 280`),
    check("mock_sets_source", sql.raw(`source IN (${sqlList(MOCK_SET_SOURCES)})`)),
    check("mock_sets_source_file", sql`${t.sourceFile} IS NULL OR length(${t.sourceFile}) BETWEEN 1 AND 255`),
    check("mock_sets_host_mode", sql.raw(`host_mode IN (${sqlList(MOCK_HOST_MODES)})`)),
    check("mock_sets_hosts", jsonArray(t.hosts, 20)),
    check("mock_sets_unmatched", sql.raw(`unmatched IN (${sqlList(MOCK_UNMATCHED)})`)),
    check("mock_sets_counts", sql`${t.revision} >= 1 AND ${t.ruleCount} BETWEEN 0 AND 500 AND ${t.bodyBytes} >= 0`),
    check("mock_sets_created_by_name", nameCheck(t.createdByName)),
    check("mock_sets_updated_by_name", nameCheck(t.updatedByName)),
  ],
);

/**
 * A rule of a mock set: the calls it matches, by method, origin, address
 * pattern, query, and body, and the responses it answers them with, in order
 * (design decisions 5 to 7). A body to compare is a stored file named by its
 * digest; so is each response's body. An enabled rule has a response; a rule
 * made from a call stays turned off without one, marked Needs a response.
 */
export const mockRules = sqliteTable(
  "mock_rules",
  {
    id: id(),
    publicId: publicId(),
    setId: integer("set_id")
      .notNull()
      .references(() => mockSets.id, { onDelete: "cascade" }),
    /** Its place in the set's order, from 0, which breaks ties between equally specific rules. */
    position: integer("position").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** An uppercase HTTP method, or `*` for any. */
    method: text("method").notNull(),
    /** The origin it was recorded on, or null for a rule written without one. */
    origin: text("origin"),
    /** The address pattern, such as `/v1/accounts/:id`. */
    pattern: text("pattern").notNull(),
    queryMode: text("query_mode", { enum: MOCK_QUERY_MODES }).notNull().default("ignore_all"),
    /** `[[name, value]]`: the query a call must have, in any order. */
    query: text("query", { mode: "json" }).$type<[string, string][]>().notNull().default(sql`'[]'`),
    /** The parameters ignore listed leaves out. */
    queryIgnored: text("query_ignored", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    bodyMode: text("body_mode", { enum: MOCK_BODY_MODES }).notNull().default("ignore"),
    /** The body to compare: its file's SHA-256, its size in bytes, and its content type. */
    bodyDigest: text("body_digest"),
    bodySize: integer("body_size"),
    bodyType: text("body_type"),
    /** `[{ status, headers, body: { digest, size, type } | null, latencyMs }]`, up to 20, answered in order. */
    responses: text("responses", { mode: "json" }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    createdByName: text("created_by_name"),
    updatedByName: text("updated_by_name"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("mock_rules_set_position").on(t.setId, t.position),
    check("mock_rules_public_id", sql`${t.publicId} GLOB 'mkr_*'`),
    check("mock_rules_position", sql`${t.position} >= 0`),
    check("mock_rules_method", sql`${t.method} = '*' OR (length(${t.method}) BETWEEN 1 AND 20 AND ${t.method} NOT GLOB '*[^A-Z]*')`),
    check("mock_rules_origin", sql`${t.origin} IS NULL OR length(${t.origin}) BETWEEN 1 AND 255`),
    check("mock_rules_pattern", sql`${t.pattern} GLOB '/*' AND length(${t.pattern}) <= 2048`),
    check("mock_rules_query_mode", sql.raw(`query_mode IN (${sqlList(MOCK_QUERY_MODES)})`)),
    check("mock_rules_query", sql`${jsonArray(t.query, 200)} AND ${jsonArray(t.queryIgnored, 200)}`),
    check("mock_rules_body_mode", sql.raw(`body_mode IN (${sqlList(MOCK_BODY_MODES)})`)),
    // A body is compared exactly when the rule has one to compare with, of at most 64 KB.
    check("mock_rules_body", sql`(${t.bodyMode} = 'ignore') = (${t.bodyDigest} IS NULL) AND (${t.bodyDigest} IS NULL) = (${t.bodySize} IS NULL) AND (${t.bodySize} IS NULL OR ${t.bodySize} BETWEEN 0 AND 65536)`),
    check("mock_rules_body_digest", digestCheck(t.bodyDigest)),
    check("mock_rules_responses", jsonArray(t.responses, RESPONSE_LIMIT)),
    check("mock_rules_enabled", sql`NOT ${t.enabled} OR json_array_length(${t.responses}) >= 1`),
    check("mock_rules_statuses", responseStatuses(t.responses)),
    check("mock_rules_created_by_name", nameCheck(t.createdByName)),
    check("mock_rules_updated_by_name", nameCheck(t.updatedByName)),
  ],
);

/**
 * Defaults (design decision 10, decision 14): a row without a saved preview
 * is the application's default set, and requires one. A saved preview's row
 * with a set is its own choice, and with none is None; a saved preview with
 * no row inherits the application's. Deleting a set deletes its rows, so the
 * application has no default and a saved preview inherits again.
 */
export const mockSetDefaults = sqliteTable(
  "mock_set_defaults",
  {
    id: id(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    applicationPreviewId: integer("application_preview_id").references(() => applicationPreviews.id, { onDelete: "cascade" }),
    mockSetId: integer("mock_set_id").references(() => mockSets.id, { onDelete: "cascade" }),
  },
  (t) => [
    // One row for the application, and one for each saved preview: unique on the application and ifnull(preview, 0), as two partial indexes.
    uniqueIndex("mock_set_defaults_application_row").on(t.applicationId).where(sql`${t.applicationPreviewId} IS NULL`),
    uniqueIndex("mock_set_defaults_preview_row").on(t.applicationPreviewId).where(sql`${t.applicationPreviewId} IS NOT NULL`),
    index("mock_set_defaults_set").on(t.mockSetId),
    check("mock_set_defaults_application", sql`${t.applicationPreviewId} IS NOT NULL OR ${t.mockSetId} IS NOT NULL`),
  ],
);

/**
 * Which set a workspace applies to one view of an application, the tracked
 * branch or one saved preview (mock-data spec, "Data chooses the mock set a
 * view uses"); a null set is None, the application's own network. Deleting
 * the workspace, the application, the saved preview, or the set deletes the
 * choice, so the view falls back to its default.
 */
export const mockSetChoices = sqliteTable(
  "mock_set_choices",
  {
    id: id(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    applicationPreviewId: integer("application_preview_id").references(() => applicationPreviews.id, { onDelete: "cascade" }),
    mockSetId: integer("mock_set_id").references(() => mockSets.id, { onDelete: "cascade" }),
  },
  (t) => [
    // One choice for each workspace and view: unique on the workspace, the application, and ifnull(preview, 0), as two partial indexes.
    uniqueIndex("mock_set_choices_application_view").on(t.workspaceId, t.applicationId).where(sql`${t.applicationPreviewId} IS NULL`),
    uniqueIndex("mock_set_choices_preview_view").on(t.workspaceId, t.applicationPreviewId).where(sql`${t.applicationPreviewId} IS NOT NULL`),
    index("mock_set_choices_application").on(t.applicationId),
    index("mock_set_choices_preview").on(t.applicationPreviewId),
    index("mock_set_choices_set").on(t.mockSetId),
  ],
);

/**
 * An uploaded HAR file's draft, between Upload HAR and saving its review
 * (design decision 12, steps 8 to 10). Only the sanitized, grouped calls are
 * kept, as `calls.json` and their bodies under `.mock-imports/<import>/`; the
 * upload itself is deleted as soon as it's read. The row holds the review's
 * choices so far, and only the workspace that uploaded it can read it. It's
 * deleted when saved or cancelled, or by the sweep after `expires_at`.
 */
export const mockSetImports = sqliteTable(
  "mock_set_imports",
  {
    id: id(),
    publicId: publicId(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The set it adds rules to, or null for a new set. */
    targetSetId: integer("target_set_id").references(() => mockSets.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    entryCount: integer("entry_count").notNull(),
    /** The new set's name, as the upload or the review last gave it. */
    setName: text("set_name"),
    /** The keys of the calls the review left unchecked, which aren't saved. */
    unchecked: text("unchecked", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** The new set's hosts: `{ mode, map: [{ from, to }] }`, as the review last gave them. */
    hosts: text("hosts", { mode: "json" }).$type<JsonObject>(),
    /** Whether saving makes the set the application's default; null until the review chose. */
    makeDefault: integer("make_default", { mode: "boolean" }),
    /** Whether it was uploaded during onboarding, whose save opens the Applications page. */
    fromOnboarding: integer("from_onboarding", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("mock_set_imports_application").on(t.applicationId),
    index("mock_set_imports_workspace").on(t.workspaceId),
    index("mock_set_imports_expires").on(t.expiresAt),
    index("mock_set_imports_target").on(t.targetSetId),
    check("mock_set_imports_public_id", sql`${t.publicId} GLOB 'mki_*'`),
    check("mock_set_imports_file_name", sql`length(${t.fileName}) BETWEEN 1 AND 255`),
    check("mock_set_imports_entry_count", sql`${t.entryCount} BETWEEN 0 AND 5000`),
    check("mock_set_imports_set_name", nameCheck(t.setName)),
    check("mock_set_imports_unchecked", sql`json_valid(${t.unchecked}) AND json_type(${t.unchecked}) = 'array'`),
    check("mock_set_imports_hosts", sql`${t.hosts} IS NULL OR (json_valid(${t.hosts}) AND json_type(${t.hosts}) = 'object')`),
    check("mock_set_imports_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/**
 * An API call that failed when a build was captured (design decision 11):
 * its method and redacted address, how it failed, and how often. Each
 * capture keeps up to 50 distinct calls, replacing the capture before's;
 * `preview_screenshots.failed_calls` holds how many there were in all.
 */
export const screenshotFailedCalls = sqliteTable(
  "screenshot_failed_calls",
  {
    id: id(),
    screenshotId: integer("screenshot_id")
      .notNull()
      .references(() => previewScreenshots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    method: text("method").notNull(),
    /** The address, redacted, at most 2,048 characters. */
    url: text("url").notNull(),
    kind: text("kind", { enum: FAILED_CALL_KINDS }).notNull(),
    status: integer("status"),
    /** The browser's error, redacted, at most 200 characters. */
    error: text("error"),
    occurrences: integer("occurrences").notNull().default(1),
  },
  (t) => [
    uniqueIndex("screenshot_failed_calls_position").on(t.screenshotId, t.position),
    check("screenshot_failed_calls_position", sql`${t.position} BETWEEN 0 AND 49`),
    check("screenshot_failed_calls_method", sql`length(${t.method}) BETWEEN 1 AND 20`),
    check("screenshot_failed_calls_url", sql`length(${t.url}) BETWEEN 1 AND 2048`),
    check("screenshot_failed_calls_kind", sql.raw(`kind IN (${sqlList(FAILED_CALL_KINDS)})`)),
    check("screenshot_failed_calls_status", sql`(${t.kind} IN ('status', 'not_mocked')) = (${t.status} IS NOT NULL) AND (${t.status} IS NULL OR ${t.status} BETWEEN 100 AND 599)`),
    check("screenshot_failed_calls_error", sql`${t.error} IS NULL OR length(${t.error}) <= 200`),
    check("screenshot_failed_calls_occurrences", sql`${t.occurrences} >= 1`),
  ],
);
