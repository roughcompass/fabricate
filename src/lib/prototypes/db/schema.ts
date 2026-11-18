import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgSchema, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  Attempt,
  Audit,
  BrandId,
  Direction,
  Failure,
  FitReview,
  GateResult,
  LessonCategory,
  LessonCopy,
  LessonScope,
  NotedElement,
  NoteStatus,
  PairwiseVerdict,
  PersonaCopy,
  Provenance,
  RenderError,
  SampleData,
  Scope,
  ShellConfig,
  Stage,
  VariantStatus,
} from "../types";

/**
 * Prototypes' own Postgres schema (design.md, decision 1), apart from the
 * SQLite database. Every table lives in the `prototypes` schema, with its own
 * migrations in drizzle-prototypes/. Rows are keyed by their public ids, and
 * everything a workspace owns is deleted with it, except accepted templates.
 */

export const prototypesSchema = pgSchema("prototypes");

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const workspaceRef = () =>
  text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const workspaces = prototypesSchema.table("workspaces", {
  id: text("id").primaryKey(),
  /** The SHA-256 digest of the template demo's workspace cookie, so a browser has one identity in both. */
  credentialDigest: text("credential_digest").notNull().unique(),
  /** Remembered when the visitor accepts a template under a name. */
  displayName: text("display_name"),
  /** The UTC day the counter covers, and the variants generated on it (availability spec, "Generation is bounded per workspace"). */
  counterDay: text("counter_day").notNull(),
  variantsToday: integer("variants_today").notNull().default(0),
  /** Kept in step with the rows, so each bound is one conditional update. */
  prototypeCount: integer("prototype_count").notNull().default(0),
  personaCount: integer("persona_count").notNull().default(0),
  lessonCount: integer("lesson_count").notNull().default(0),
  createdAt: createdAt(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const personas = prototypesSchema.table(
  "personas",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    organizationType: text("organization_type").notNull().default(""),
    goals: jsonb("goals").$type<string[]>().notNull(),
    context: text("context").notNull().default(""),
    constraints: jsonb("constraints").$type<string[]>().notNull(),
    distinction: text("distinction"),
    /** Seeded examples are marked as such, and are otherwise like any other persona. */
    example: boolean("example").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("personas_workspace").on(table.workspaceId)],
);

export const pageShells = prototypesSchema.table("page_shells", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<ShellConfig>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const benchmarkIntents = prototypesSchema.table(
  "benchmark_intents",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    position: integer("position").notNull(),
    intent: text("intent").notNull(),
    scope: text("scope").$type<Scope>().notNull(),
    personaIds: jsonb("persona_ids").$type<string[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("benchmark_intents_position").on(table.workspaceId, table.position)],
);

/**
 * The template a generation starts from (converge-templates-and-prototypes,
 * design decision 8): its latest version when the generation started, which
 * is variant 0, and the hero its lineage starts from, if any.
 */
export interface GenerationTemplate {
  readonly templateId: string;
  readonly templateVersionId: string;
  /** A template version's number, or a hero's catalog version, such as 3.2.0. */
  readonly templateVersion: number | string;
  readonly title: string;
  readonly hero: string | null;
}

export interface GenerationHero {
  readonly slug: string;
  readonly member: string | null;
  /** The hand-written source this version ports to Salt, as the prompt shows it. */
  readonly reference?: string;
}

export const generations = prototypesSchema.table(
  "generations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    kind: text("kind").$type<"generate" | "refine" | "lesson-check">().notNull(),
    intent: text("intent").notNull(),
    scope: text("scope").$type<Scope>().notNull(),
    personas: jsonb("personas").$type<readonly PersonaCopy[]>().notNull(),
    variantCount: integer("variant_count").notNull(),
    status: text("status").$type<"running" | "done" | "failed">().notNull().default("running"),
    /** The directions and the shared sample data, written by the plan step. */
    directions: jsonb("directions").$type<readonly Direction[]>(),
    sampleData: jsonb("sample_data").$type<SampleData>(),
    /** The lessons applied, as they read when the generation started. */
    lessons: jsonb("lessons").$type<readonly LessonCopy[]>().notNull(),
    /** For a refinement: the prototype, the version it builds on, and the message. */
    prototypeId: text("prototype_id"),
    baseVersionId: text("base_version_id"),
    message: text("message"),
    /** For a lesson check's variants: the check and whether lessons applied. */
    lessonCheckId: text("lesson_check_id"),
    withLessons: boolean("with_lessons"),
    /** The attached template, which is variant 0; null otherwise. */
    template: jsonb("template").$type<GenerationTemplate>(),
    /**
     * For a portal microfrontend or shell: the template, by slug, whose
     * lineage its versions start, and the microfrontend it writes, or null
     * for a shell.
     */
    hero: jsonb("hero").$type<GenerationHero>(),
    error: jsonb("error").$type<Failure>(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("generations_workspace").on(table.workspaceId, table.createdAt)],
);

export const variants = prototypesSchema.table(
  "variants",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    direction: jsonb("direction").$type<Direction>(),
    stage: text("stage").$type<Stage>().notNull().default("planning"),
    status: text("status").$type<VariantStatus>().notNull().default("running"),
    failure: jsonb("failure").$type<Failure>(),
    /** The version it produced, once ready. */
    versionId: text("version_id"),
    decision: text("decision").$type<"kept" | "discarded">(),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("variants_position").on(table.generationId, table.position)],
);

export const prototypes = prototypesSchema.table(
  "prototypes",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    scope: text("scope").$type<Scope>().notNull(),
    /** The generation it was kept from; its variants stay viewable from the prototype. */
    generationId: text("generation_id"),
    latestNumber: integer("latest_number").notNull().default(0),
    /** The running refinement, claimed by one conditional update so only one runs at a time. */
    refiningGenerationId: text("refining_generation_id"),
    seeded: boolean("seeded").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("prototypes_workspace").on(table.workspaceId, table.updatedAt)],
);

export const versions = prototypesSchema.table(
  "versions",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    /** Null while the version is an unkept variant. */
    prototypeId: text("prototype_id").references(() => prototypes.id, { onDelete: "cascade" }),
    number: integer("number"),
    generationId: text("generation_id"),
    status: text("status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
    scope: text("scope").$type<Scope>().notNull(),
    /** The page title and the shell navigation item the page belongs to. */
    title: text("title").notNull().default(""),
    navItem: text("nav_item"),
    /** What changed, in the generator's words. */
    summary: text("summary").notNull().default(""),
    code: text("code").notNull().default(""),
    /** The version's CSS module, which the code imports as ./Prototype.module.css, or null when it has none. */
    styles: text("styles"),
    /** The sample data module the code imports as ./data: the generation's, or the base version's for a refinement. */
    sampleData: jsonb("sample_data").$type<SampleData>(),
    compiled: text("compiled"),
    /** The runtime build the compiled code was made for; seeds recompile when it changes. */
    runtimeHash: text("runtime_hash"),
    provenance: jsonb("provenance").$type<Provenance>(),
    attempts: jsonb("attempts").$type<readonly Attempt[]>().notNull().default(sql`'[]'::jsonb`),
    /** The first attempt's gate results (quality-checks spec, "Failed gates are repaired automatically"). */
    firstPass: jsonb("first_pass").$type<readonly GateResult[]>(),
    gatesPassed: boolean("gates_passed").notNull().default(false),
    audit: jsonb("audit").$type<Audit>(),
    renderError: jsonb("render_error").$type<RenderError>(),
    fit: jsonb("fit").$type<FitReview>(),
    fitAverage: real("fit_average"),
    /** For a refinement built on open notes: what it did about each one. */
    addressedNotes: jsonb("addressed_notes").$type<readonly { noteId: string; addressed: boolean; how: string }[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("versions_number").on(table.prototypeId, table.number), index("versions_workspace").on(table.workspaceId)],
);

export const feedback = prototypesSchema.table(
  "feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    kind: text("kind").$type<"keep-reason" | "discard-reason" | "rating" | "note" | "lesson">().notNull(),
    versionId: text("version_id"),
    variantId: text("variant_id"),
    prototypeId: text("prototype_id"),
    /** The version's personas, as they read when the feedback was given. */
    personas: jsonb("personas").$type<readonly PersonaCopy[]>().notNull(),
    rating: integer("rating"),
    text: text("text"),
    element: jsonb("element").$type<NotedElement>(),
    noteStatus: text("note_status").$type<NoteStatus>(),
    addressedByVersionId: text("addressed_by_version_id"),
    createdAt: createdAt(),
  },
  (table) => [index("feedback_version").on(table.versionId), uniqueIndex("feedback_one_rating").on(table.versionId).where(sql`kind = 'rating'`)],
);

export type LessonCitation = { readonly kind: "feedback"; readonly feedbackId: string } | { readonly kind: "failure"; readonly signature: string; readonly versionIds: readonly string[] };

export const lessons = prototypesSchema.table(
  "lessons",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceRef(),
    text: text("text").notNull(),
    scope: jsonb("scope").$type<LessonScope>().notNull(),
    category: text("category").$type<LessonCategory>().notNull(),
    status: text("status").$type<"proposed" | "active" | "off" | "dismissed">().notNull(),
    source: text("source").$type<"agent" | "visitor" | "seed">().notNull(),
    citations: jsonb("citations").$type<readonly LessonCitation[]>().notNull(),
    /** A proposed edit names the lesson it would replace; a conflict names the active lesson it contradicts. */
    editsLessonId: text("edits_lesson_id"),
    conflictsWithLessonId: text("conflicts_with_lesson_id"),
    appliedCount: integer("applied_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("lessons_workspace").on(table.workspaceId, table.status)],
);

export const lessonChecks = prototypesSchema.table("lesson_checks", {
  id: text("id").primaryKey(),
  workspaceId: workspaceRef(),
  status: text("status").$type<"running" | "done" | "failed">().notNull().default("running"),
  lessons: jsonb("lessons").$type<readonly LessonCopy[]>().notNull(),
  intents: jsonb("intents").$type<{ intent: string; scope: Scope; personas: PersonaCopy[] }[]>().notNull(),
  result: jsonb("result").$type<{ won: number; lost: number; undecided: number; pairs: { intent: string; withVersionId: string | null; withoutVersionId: string | null; winner: "with" | "without" | "undecided"; withGates: boolean | null; withoutGates: boolean | null }[] }>(),
  error: jsonb("error").$type<Failure>(),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
});

export const pairwiseReviews = prototypesSchema.table("pairwise_reviews", {
  id: text("id").primaryKey(),
  workspaceId: workspaceRef(),
  versionAId: text("version_a_id").notNull(),
  versionBId: text("version_b_id").notNull(),
  status: text("status").$type<"running" | "done" | "failed">().notNull().default("running"),
  model: text("model").notNull(),
  verdicts: jsonb("verdicts").$type<readonly PairwiseVerdict[]>(),
  error: jsonb("error").$type<Failure>(),
  lessonCheckId: text("lesson_check_id"),
  createdAt: createdAt(),
});

export const shares = prototypesSchema.table("shares", {
  id: text("id").primaryKey(),
  workspaceId: workspaceRef(),
  versionId: text("version_id")
    .notNull()
    .references(() => versions.id, { onDelete: "cascade" }),
  /** Only the token's digest is stored. */
  tokenDigest: text("token_digest").notNull().unique(),
  /** The shell as it was when the link was created. */
  shell: jsonb("shell").$type<ShellConfig>().notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
});

/** A copy of an accepted version, kept by the template version even after the prototype or workspace is gone. */
export interface TemplateSnapshot {
  readonly versionId: string;
  readonly number: number;
  readonly prototypeName: string;
  readonly code: string;
  /** The version's CSS module; absent in snapshots taken before modules existed. */
  readonly styles?: string | null;
  /** The sample data module the code imports as ./data; Use template needs it. */
  readonly sampleData: SampleData | null;
  readonly compiled: string;
  readonly runtimeHash: string;
  readonly title: string;
  readonly navItem: string | null;
  readonly personas: readonly PersonaCopy[];
  readonly provenance: Provenance;
  readonly gates: readonly GateResult[];
  readonly attempts: number;
  readonly audit: Audit | null;
  readonly fit: FitReview | null;
}

/**
 * A template accepted from a prototype (design.md, decisions 1 and 13): its
 * identity, slug, accepting workspace, latest version number, and withdrawal.
 * Provider and origin are always Community and From Prototypes, so they
 * aren't stored. Templates outlive the prototype and workspace they came
 * from, so their references are kept as plain ids.
 */
export const templates = prototypesSchema.table("templates", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  workspaceId: text("workspace_id"),
  prototypeId: text("prototype_id"),
  latestNumber: integer("latest_number").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "date" }),
});

/** What a template version was checked against (design.md, decision 13), so it can be treated like any other pinned input. */
export interface Reproducibility {
  readonly saltRelease: string;
  readonly registryRelease: string;
  readonly kitVersion: string;
  readonly checksVersion: number;
  /** The SHA-256 of the normalized gate results it passed. */
  readonly checkDigest: string;
}

/**
 * What a template version's acceptance was held to (template-conformance
 * spec): the Salt Patterns Run and Evaluation it met, by SQLite public id, or
 * Not evaluated because no Release was selected. Null on versions accepted
 * before acceptance checked Standards.
 */
export type TemplateStandards = { readonly status: "evaluated"; readonly assessmentId: string; readonly evaluationId: string } | { readonly status: "not_evaluated"; readonly reason: "no_release" };

/** One acceptance of a template, immutable once published (versions spec, "Template versions are immutable"). */
export const templateVersions = prototypesSchema.table(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    /** Who accepted it: a plain reference, and the name shown as unverified. */
    workspaceId: text("workspace_id"),
    acceptedBy: text("accepted_by").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    brand: text("brand").$type<BrandId>().notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    snapshot: jsonb("snapshot").$type<TemplateSnapshot>().notNull(),
    /** The shell as it was at acceptance. */
    shell: jsonb("shell").$type<ShellConfig>().notNull(),
    previewPng: bytea("preview_png"),
    reproducibility: jsonb("reproducibility").$type<Reproducibility>().notNull(),
    standards: jsonb("standards").$type<TemplateStandards>(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("template_versions_number").on(table.templateId, table.number)],
);

export type RecheckStatus = "unchanged" | "fixed" | "regressed" | "broken";

/**
 * A re-check of a template version against a later runtime build (design.md,
 * decision 17): one row per version and runtime hash, claimed by the first
 * request that sees the version stale. The version itself never changes.
 */
export const templateRechecks = prototypesSchema.table(
  "template_rechecks",
  {
    id: text("id").primaryKey(),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => templateVersions.id, { onDelete: "cascade" }),
    runtimeHash: text("runtime_hash").notNull(),
    saltRelease: text("salt_release").notNull(),
    /** Null while it runs. */
    status: text("status").$type<RecheckStatus>(),
    gates: jsonb("gates").$type<readonly GateResult[]>(),
    /** The code compiled for this runtime build, when the build gate passed. */
    compiled: text("compiled"),
    /**
     * The Salt Patterns Run of the version's export for this runtime build, by
     * SQLite public id, and the Releases, by public id, its acceptance used
     * (converge-templates-and-prototypes, design decision 10). Null when the
     * version wasn't evaluated at acceptance.
     */
    standards: jsonb("standards").$type<{ readonly assessmentId: string; readonly releaseIds: readonly string[] }>(),
    error: text("error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [uniqueIndex("template_rechecks_runtime").on(table.templateVersionId, table.runtimeHash)],
);

export const sandboxRuns = prototypesSchema.table("sandbox_runs", {
  id: text("id").primaryKey(),
  workspaceId: workspaceRef(),
  versionId: text("version_id").notNull(),
  status: text("status").$type<"starting" | "ready" | "failed" | "stopped">().notNull().default("starting"),
  stage: text("stage"),
  sandboxId: text("sandbox_id"),
  url: text("url"),
  error: text("error"),
  stopsAt: timestamp("stops_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});
