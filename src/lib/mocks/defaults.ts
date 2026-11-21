import { and, eq, isNull } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { applicationPreviews, mockSetDefaults, mockSets } from "@/lib/db/schema";
import { type MockSet, toMockSet } from "./model";

/*
 * Defaults (add-mock-sets, design decisions 10 and 14): an application's
 * optional default set, and each saved preview's own choice, the
 * application's default, None, or a set. Each names a set of the same
 * application, which this module checks, since SQLite can't across tables.
 */

function setOf(db: Executor, applicationId: number, publicId: string): MockSet {
  const row = db
    .select()
    .from(mockSets)
    .where(and(eq(mockSets.applicationId, applicationId), eq(mockSets.publicId, publicId)))
    .get();
  if (!row) throw new NotFoundError("That mock set no longer exists. Someone else deleted it.");
  return toMockSet(row);
}

/** A set by its row ID, for a default, choice, or draft that names one. */
export function byId(db: Executor, id: number): MockSet | undefined {
  const row = db.select().from(mockSets).where(eq(mockSets.id, id)).get();
  return row ? toMockSet(row) : undefined;
}

/** Refuses a saved preview of another application. */
export function requirePreviewOf(db: Executor, applicationId: number, previewId: number): void {
  const row = db
    .select({ id: applicationPreviews.id })
    .from(applicationPreviews)
    .where(and(eq(applicationPreviews.id, previewId), eq(applicationPreviews.applicationId, applicationId)))
    .get();
  if (!row) throw new NotFoundError("That saved preview no longer exists. Someone else removed it.");
}

/** The application's default row, if it has one. */
function applicationDefaultRow(db: Executor, applicationId: number) {
  return db
    .select()
    .from(mockSetDefaults)
    .where(and(eq(mockSetDefaults.applicationId, applicationId), isNull(mockSetDefaults.applicationPreviewId)))
    .get();
}

/** The row ID of the application's default set, or null. */
export function applicationDefaultSetId(db: Executor, applicationId: number): number | null {
  return applicationDefaultRow(db, applicationId)?.mockSetId ?? null;
}

/** The application's default set, or null. */
export function applicationDefault(db: Executor, applicationId: number): MockSet | null {
  const row = applicationDefaultRow(db, applicationId);
  return row?.mockSetId ? (byId(db, row.mockSetId) ?? null) : null;
}

/**
 * Makes the set +setPublicId+ the application's default, or clears the
 * default for null. Throws NotFoundError for a set of another application.
 * Returns whether the default changed.
 * @public The application page uses this (add-mock-sets, task 5.1).
 */
export function setApplicationDefault(db: Executor, applicationId: number, setPublicId: string | null): boolean {
  return immediate(db, (tx) => {
    const before = applicationDefaultRow(tx, applicationId)?.mockSetId ?? null;
    const set = setPublicId === null ? null : setOf(tx, applicationId, setPublicId);
    if ((set?.id ?? null) === before) return false;
    tx.delete(mockSetDefaults)
      .where(and(eq(mockSetDefaults.applicationId, applicationId), isNull(mockSetDefaults.applicationPreviewId)))
      .run();
    if (set) tx.insert(mockSetDefaults).values({ applicationId, applicationPreviewId: null, mockSetId: set.id }).run();
    return true;
  });
}

/** A saved preview's own choice of default: the application's, None, or a set of its own. */
export type PreviewDefault = { readonly kind: "inherit" } | { readonly kind: "none" } | { readonly kind: "set"; readonly set: MockSet };

/** The saved preview +previewId+'s own default. */
export function previewDefault(db: Executor, applicationId: number, previewId: number): PreviewDefault {
  const row = db
    .select()
    .from(mockSetDefaults)
    .where(and(eq(mockSetDefaults.applicationId, applicationId), eq(mockSetDefaults.applicationPreviewId, previewId)))
    .get();
  if (!row) return { kind: "inherit" };
  if (row.mockSetId === null) return { kind: "none" };
  const set = byId(db, row.mockSetId);
  return set ? { kind: "set", set } : { kind: "inherit" };
}

/**
 * Sets the saved preview +previewId+'s own default. Throws NotFoundError for a set of another application. Returns whether it changed.
 * @public A saved preview's Mock set form uses this (add-mock-sets, task 5.6).
 */
export function setPreviewDefault(db: Executor, applicationId: number, previewId: number, choice: { kind: "inherit" } | { kind: "none" } | { kind: "set"; set: string }): boolean {
  return immediate(db, (tx) => {
    requirePreviewOf(tx, applicationId, previewId);
    const before = previewDefault(tx, applicationId, previewId);
    const set = choice.kind === "set" ? setOf(tx, applicationId, choice.set) : null;
    if (before.kind === choice.kind && (before.kind !== "set" || before.set.id === set?.id)) return false;
    tx.delete(mockSetDefaults)
      .where(and(eq(mockSetDefaults.applicationId, applicationId), eq(mockSetDefaults.applicationPreviewId, previewId)))
      .run();
    if (choice.kind !== "inherit") tx.insert(mockSetDefaults).values({ applicationId, applicationPreviewId: previewId, mockSetId: set?.id ?? null }).run();
    return true;
  });
}
