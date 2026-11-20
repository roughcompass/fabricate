import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { applicationPreviews, applications, previewScreenshots } from "@/lib/db/schema";
import { type Application, type SettleValues, type TargetState, buildColumns, compareNames, currentBuild, latestBuild, screenshotColumns, settledColumns, targetState } from "./records";

/*
 * Saved previews (restore-toolbar-tools-and-branch-previews, design decisions
 * 1 and 4; applications/saved-previews spec): the branches and tags of an
 * application's remote that an operator keeps built beside the tracked
 * branch. Each is a build target like its application, built by the same
 * pipeline (pipeline.ts) and settled by the same hooks (hooks.ts), with its
 * status and image derived the same way. This module reads them, names them,
 * and removes them; pipeline.ts creates and rebuilds them.
 */

export type SavedPreviewRow = typeof applicationPreviews.$inferSelect;

/** How many saved previews an application keeps (spec, "An application has at most 20 saved previews"). */
export const SAVED_PREVIEW_LIMIT = 20;
const KEY_LIMIT = 60;

/** A saved preview as pages, the status endpoint, and the toolbar show it. */
export interface SavedPreview extends TargetState {
  readonly publicId: string;
  /** Its address segment: `/run/<slug>@<key>`, `?preview=<key>`. */
  readonly key: string;
  /** The branch or tag, qualified, and as it's shown. */
  readonly ref: string;
  readonly label: string;
  readonly kind: "branch" | "tag";
  /** When the automatic check last found the remote without it; null while the remote has it. */
  readonly remoteMissingAt: Date | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A qualified ref as it's shown: refs/heads/feature/new-nav is feature/new-nav, refs/tags/v1.1.0 is v1.1.0. */
export function refLabel(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, "");
}

export function refKind(ref: string): "branch" | "tag" {
  return ref.startsWith("refs/tags/") ? "tag" : "branch";
}

/**
 * The key of a preview of +ref+ (design decision 4): the ref's short name in
 * lowercase, with each run of characters other than a-z, 0-9, and the dot
 * made one hyphen, hyphens trimmed from the ends, at most 60 characters, and
 * `-2`, `-3`, and so on added when +taken+ has it. It never holds `@` or `/`.
 */
export function savedPreviewKey(ref: string, taken: Iterable<string>): string {
  const base =
    refLabel(ref)
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, KEY_LIMIT)
      .replace(/-+$/, "") || "preview";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;
    const candidate = `${base.slice(0, KEY_LIMIT - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

// -- Reading ----------------------------------------------------------------------

/** The saved previews of the application with +applicationPublicId+, and +where+. */
function selectSavedPreviews(db: Executor, applicationPublicId: string, where?: ReturnType<typeof and>) {
  return db
    .select({ row: applicationPreviews, current: buildColumns(currentBuild), latest: buildColumns(latestBuild), screenshot: screenshotColumns })
    .from(applicationPreviews)
    .innerJoin(applications, and(eq(applications.id, applicationPreviews.applicationId), eq(applications.publicId, applicationPublicId)))
    .leftJoin(currentBuild, eq(currentBuild.id, applicationPreviews.currentPreviewId))
    .leftJoin(latestBuild, eq(latestBuild.id, applicationPreviews.latestPreviewId))
    .leftJoin(previewScreenshots, eq(previewScreenshots.previewId, applicationPreviews.currentPreviewId))
    .where(where);
}

type Selected = Awaited<ReturnType<ReturnType<typeof selectSavedPreviews>["all"]>>[number];

function toSavedPreview({ row, current, latest, screenshot }: Selected): SavedPreview {
  return {
    publicId: row.publicId,
    key: row.key,
    ref: row.ref,
    label: refLabel(row.ref),
    kind: refKind(row.ref),
    ...targetState(row, current, latest, screenshot),
    remoteMissingAt: row.remoteMissingAt,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The saved previews of the application with +applicationPublicId+, by name. At most SAVED_PREVIEW_LIMIT, so they're read whole.
 * @public The application page's Previews section and preview mode's choice list them (tasks 3.1 and 3.3).
 */
export function savedPreviewsOf(db: Executor, applicationPublicId: string): SavedPreview[] {
  return selectSavedPreviews(db, applicationPublicId)
    .all()
    .map(toSavedPreview)
    .sort((a, b) => compareNames(a.label, b.label) || (a.kind === b.kind ? 0 : a.kind === "branch" ? -1 : 1));
}

/** The application's saved preview with +key+, or undefined. */
export function findSavedPreview(db: Executor, applicationPublicId: string, key: string): SavedPreview | undefined {
  const selected = selectSavedPreviews(db, applicationPublicId, eq(applicationPreviews.key, key)).get();
  return selected && toSavedPreview(selected);
}

/** The application's saved preview of the qualified +ref+, or undefined. */
export function savedPreviewOfRef(db: Executor, applicationPublicId: string, ref: string): SavedPreview | undefined {
  const selected = selectSavedPreviews(db, applicationPublicId, eq(applicationPreviews.ref, ref)).get();
  return selected && toSavedPreview(selected);
}

export function getSavedPreviewRow(db: Executor, publicId: string): SavedPreviewRow {
  const row = db.select().from(applicationPreviews).where(eq(applicationPreviews.publicId, publicId)).get();
  if (!row) throw new NotFoundError(`Unknown saved preview ${publicId}`);
  return row;
}

/**
 * The text alternative for a saved preview's screenshot: the application, the branch or tag, and the commit it shows.
 * @public The application page and the screenshot route use it (task 2.3).
 */
export function savedPreviewAlt(application: Pick<Application, "name">, saved: Pick<SavedPreview, "label" | "current">): string {
  return saved.current ? `Screenshot of ${application.name}, ${saved.label}, at commit ${saved.current.commitSha.slice(0, 7)}` : `Screenshot of ${application.name}, ${saved.label}`;
}

// -- Changing ---------------------------------------------------------------------

/** Updates the latest attempt's outcome of the saved previews +where+ selects. */
export function settleSavedPreviews(db: Executor, where: ReturnType<typeof and>, values: SettleValues): number {
  return db.update(applicationPreviews).set(settledColumns(values)).where(where).run().changes;
}

/** Saved previews whose latest attempt is waiting on the preparation with row id +preparationId+ to start a build. */
export function savedWaitingOnPreparation(preparationId: number) {
  return and(eq(applicationPreviews.latestPreparationId, preparationId), eq(applicationPreviews.latestOutcome, "building"), isNull(applicationPreviews.latestPreviewId));
}

/**
 * Removes the application's saved preview with +key+ (spec, "Saved previews
 * can be removed"). Its builds go back to ordinary pruning unless the
 * application or another saved preview uses them; its threads and share
 * links stay, with its ref. Returns the removed preview's ref, or null when
 * there was none.
 * @public The application page's Remove preview uses it (task 3.1).
 */
export function removeSavedPreview(db: Executor, applicationPublicId: string, key: string): string | null {
  const owner = db.select({ id: applications.id }).from(applications).where(eq(applications.publicId, applicationPublicId));
  return (
    db
      .delete(applicationPreviews)
      .where(and(inArray(applicationPreviews.applicationId, owner), eq(applicationPreviews.key, key)))
      .returning({ ref: applicationPreviews.ref })
      .get()?.ref ?? null
  );
}
