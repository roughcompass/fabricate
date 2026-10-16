import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assessments } from "./assessments";
import { id, publicId, sqlList, timestamp } from "./columns";
import { PORTAL_LIFECYCLES } from "../../onboarding/vocabulary";
import { applications, portals } from "./ownership";

/*
 * Web onboarding (docs/navigation.md, docs/applications.md). Portals and
 * Applications are edited in place: a Portal's menu is a flat, ordered table
 * of groups and items, each edit takes effect at once, and every change is
 * appended to a history with who stated they made it. An Application links
 * to the DE Web assessments of its repository. Nothing here is written to
 * Studio, CDaaS, Bitbucket, or GitHub.
 */

// Defined beside their labels, in a module the browser can load.
export { PORTAL_LIFECYCLES, type PortalLifecycle } from "../../onboarding/vocabulary";
export { RENDERING_MODES, type RenderingMode } from "../../applications/vocabulary";
export const MENU_ENTRY_KINDS = ["group", "item"] as const;
export const ONBOARDING_SUBJECTS = ["portal", "application"] as const;
/** A person's stated identity, which nothing verifies yet, or Fabricate itself. */
export const ATTRIBUTIONS = ["unverified", "system"] as const;
export const ONBOARDING_EVENTS = ["created", "details_changed", "menu_changed", "default_changed", "promoted", "returned_to_prototype"] as const;

export type MenuEntryKind = (typeof MENU_ENTRY_KINDS)[number];
export type OnboardingSubject = (typeof ONBOARDING_SUBJECTS)[number];
export type Attribution = (typeof ATTRIBUTIONS)[number];
export type OnboardingEvent = (typeof ONBOARDING_EVENTS)[number];

// ---------------------------------------------------------------------------
// Shared checks

export const sealIdCheck = (column: AnySQLiteColumn) => sql`${column} IS NULL OR (length(${column}) BETWEEN 1 AND 64 AND ${column} = trim(${column}))`;

/**
 * A menu route (navigation spec): a leading slash, then lowercase letters,
 * digits, hyphens, and slashes, with no empty segment and no trailing slash
 * except the root.
 */
export const menuRouteCheck = (column: AnySQLiteColumn) =>
  sql`length(${column}) BETWEEN 1 AND 200 AND ${column} GLOB '/*' AND ${column} NOT GLOB '*[^a-z0-9/-]*' AND instr(${column}, '//') = 0 AND (${column} = '/' OR ${column} NOT GLOB '*/')`;

// ---------------------------------------------------------------------------
// Navigation

/**
 * One group or item of a Portal's menu (design decision 8). A group has a
 * label and holds other entries; an item has a label, a route unique within
 * the Portal, and an Application of the same Portal, which a trigger checks.
 * Siblings are ordered by position. At most one item is the Portal's default.
 */
export const portalMenuItems = sqliteTable(
  "portal_menu_items",
  {
    id: id(),
    publicId: publicId(),
    portalId: integer("portal_id")
      .notNull()
      .references(() => portals.id, { onDelete: "restrict" }),
    parentId: integer("parent_id").references((): AnySQLiteColumn => portalMenuItems.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: MENU_ENTRY_KINDS }).notNull(),
    label: text("label").notNull(),
    route: text("route"),
    applicationId: integer("application_id").references(() => applications.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("portal_menu_items_portal").on(t.portalId, t.parentId, t.position),
    index("portal_menu_items_application").on(t.applicationId),
    uniqueIndex("portal_menu_items_route").on(t.portalId, t.route).where(sql`${t.route} IS NOT NULL`),
    uniqueIndex("portal_menu_items_one_default").on(t.portalId).where(sql`${t.isDefault} = 1`),
    check("portal_menu_items_public_id", sql`${t.publicId} GLOB 'mnu_*'`),
    check("portal_menu_items_kind", sql.raw(`kind IN (${sqlList(MENU_ENTRY_KINDS)})`)),
    check("portal_menu_items_label", sql`length(trim(${t.label})) BETWEEN 1 AND 100`),
    check("portal_menu_items_position", sql`${t.position} BETWEEN 0 AND 100000`),
    check("portal_menu_items_is_default", sql`${t.isDefault} IN (0, 1)`),
    check("portal_menu_items_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    check(
      "portal_menu_items_shape",
      sql`CASE ${t.kind}
        WHEN 'group' THEN ${t.route} IS NULL AND ${t.applicationId} IS NULL AND ${t.isDefault} = 0
        WHEN 'item' THEN ${t.route} IS NOT NULL AND ${menuRouteCheck(t.route)} AND ${t.applicationId} IS NOT NULL
        ELSE 0 END`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Assessments

/**
 * Each DE Web assessment launched for an Application (design decision 6),
 * newest last, or the reason one couldn't start. The latest row is the
 * Application's assessment state.
 */
export const applicationAssessments = sqliteTable(
  "application_assessments",
  {
    id: id(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    assessmentId: integer("assessment_id").references(() => assessments.id, { onDelete: "restrict" }),
    /** Why the launch failed; never a credential. */
    error: text("error"),
    startedAt: timestamp("started_at").notNull(),
  },
  (t) => [
    index("application_assessments_application").on(t.applicationId, t.startedAt),
    uniqueIndex("application_assessments_assessment").on(t.applicationId, t.assessmentId).where(sql`${t.assessmentId} IS NOT NULL`),
    check("application_assessments_outcome", sql`(${t.assessmentId} IS NULL) = (${t.error} IS NOT NULL) AND (${t.error} IS NULL OR length(${t.error}) BETWEEN 1 AND 500)`),
  ],
);

// ---------------------------------------------------------------------------
// History

/** Each change to a Portal or Application, with who stated they made it. */
export const onboardingEvents = sqliteTable(
  "onboarding_events",
  {
    id: id(),
    subject: text("subject", { enum: ONBOARDING_SUBJECTS }).notNull(),
    portalId: integer("portal_id").references(() => portals.id, { onDelete: "restrict" }),
    applicationId: integer("application_id").references(() => applications.id, { onDelete: "restrict" }),
    event: text("event", { enum: ONBOARDING_EVENTS }).notNull(),
    fromLifecycle: text("from_lifecycle", { enum: PORTAL_LIFECYCLES }),
    toLifecycle: text("to_lifecycle", { enum: PORTAL_LIFECYCLES }),
    /** What changed, as people read it: "Added Payees at /payees". */
    detail: text("detail"),
    actor: text("actor").notNull(),
    attribution: text("attribution", { enum: ATTRIBUTIONS }).notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
  },
  (t) => [
    index("onboarding_events_portal").on(t.portalId, t.occurredAt),
    index("onboarding_events_application").on(t.applicationId, t.occurredAt),
    check("onboarding_events_subject", sql`CASE ${t.subject}
      WHEN 'portal' THEN ${t.portalId} IS NOT NULL AND ${t.applicationId} IS NULL
      WHEN 'application' THEN ${t.applicationId} IS NOT NULL AND ${t.portalId} IS NULL
      ELSE 0 END`),
    check("onboarding_events_event", sql.raw(`event IN (${sqlList(ONBOARDING_EVENTS)})`)),
    check("onboarding_events_lifecycle", sql.raw(`(from_lifecycle IS NULL OR from_lifecycle IN (${sqlList(PORTAL_LIFECYCLES)})) AND (to_lifecycle IS NULL OR to_lifecycle IN (${sqlList(PORTAL_LIFECYCLES)}))`)),
    check("onboarding_events_detail", sql`${t.detail} IS NULL OR length(trim(${t.detail})) BETWEEN 1 AND 500`),
    check("onboarding_events_actor", sql`length(trim(${t.actor})) BETWEEN 1 AND 200`),
    check("onboarding_events_attribution", sql.raw(`attribution IN (${sqlList(ATTRIBUTIONS)})`)),
  ],
);
