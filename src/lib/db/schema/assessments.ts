import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, lockVersion, publicId, sqlList, updatedAt } from "./columns";
import { repositories } from "./repositories";

export const SELECTION_MODES = ["all", "explicit"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

/** A long-lived objective that scopes repositories and selects Standard Releases. */
export const assessments = sqliteTable(
  "initiatives",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    objective: text("objective").notNull().default(""),
    selectionMode: text("selection_mode", { enum: SELECTION_MODES }).notNull().default("all"),
    lockVersion: lockVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("initiatives_public_id", sql`${t.publicId} GLOB 'ini_*'`),
    check("initiatives_name", sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    check("initiatives_objective", sql`length(${t.objective}) <= 2000`),
    check("initiatives_selection_mode", sql.raw(`selection_mode IN (${sqlList(SELECTION_MODES)})`)),
  ],
);

/** An explicit repository selection. Only Assessments of selected Repositories have rows. */
export const assessmentTargets = sqliteTable(
  "initiative_targets",
  {
    id: id(),
    assessmentId: integer("initiative_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    repositoryId: integer("repository_source_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("initiative_targets_selection").on(t.assessmentId, t.repositoryId),
    index("initiative_targets_source").on(t.repositoryId),
  ],
);
