import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, sqlList, timestamp } from "./columns";

/** What an adoption snapshot is of: a design system the Reference Catalog describes, or one of its packages. */
export const ADOPTION_SUBJECTS = ["design_system", "package"] as const;
export type AdoptionSubject = (typeof ADOPTION_SUBJECTS)[number];

/**
 * An adoption snapshot (establish-frontend-registry, design decision 7):
 * one tracked design system's or package's figures across the fleet at one
 * time, and its per-component usages or per-version Repository counts. Each
 * figure's change is computed against the previous snapshot of the same
 * subject, so comparing two snapshots reads two rows. One is taken per
 * subject per schedule slot, and none changes.
 */
export const adoptionSnapshots = sqliteTable(
  "adoption_snapshots",
  {
    id: id(),
    kind: text("kind", { enum: ADOPTION_SUBJECTS }).notNull(),
    /** The design system's id, such as salt, or the package's name, such as @salt-ds/core. */
    subject: text("subject").notNull(),
    /** The schedule slot it was taken for, as an ISO time. */
    slot: text("slot").notNull(),
    takenAt: timestamp("taken_at").notNull(),
    /** Its figures by name, such as components_used. */
    figures: text("figures", { mode: "json" }).$type<Record<string, number>>().notNull(),
    /** A design system's app usages by component, or a package's Repositories by resolved version. */
    counts: text("counts", { mode: "json" }).$type<Record<string, number>>().notNull(),
    /** For a design system, the Reference Catalog entry whose components it tracked. */
    entryDigest: text("entry_digest"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("adoption_snapshots_slot").on(t.kind, t.subject, t.slot),
    index("adoption_snapshots_subject").on(t.kind, t.subject, t.takenAt),
    check("adoption_snapshots_kind", sql.raw(`kind IN (${sqlList(ADOPTION_SUBJECTS)})`)),
    check("adoption_snapshots_figures", sql`json_valid(${t.figures}) AND json_type(${t.figures}) = 'object'`),
    check("adoption_snapshots_counts", sql`json_valid(${t.counts}) AND json_type(${t.counts}) = 'object'`),
    check("adoption_snapshots_entry_digest", sql`${t.entryDigest} IS NULL OR (${t.kind} = 'design_system' AND length(${t.entryDigest}) = 64)`),
  ],
);
