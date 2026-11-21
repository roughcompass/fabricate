import { and, eq, isNull } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { mockSetChoices, mockSets } from "@/lib/db/schema";
import { applicationDefault, byId, previewDefault, requirePreviewOf } from "./defaults";
import { type MockSet, toMockSet } from "./model";

/*
 * The mock set a view applies (add-mock-sets, design decision 14; mock-data
 * spec, "A view's active mock set is resolved in one order"). Each visitor
 * chooses per view, the tracked branch or one saved preview, in their
 * workspace: a set, or None, the application's own network. A view resolves,
 * in order: the set a share link names, for that view only; the visitor's
 * choice; the saved preview's own default; the application's default; or
 * none. Screenshots skip the first two.
 */

/** Where a view's active set came from, which Data says. */
export type ActiveSource = "share" | "choice" | "preview" | "application" | "none";

export interface ActiveSet {
  /** The set that applies, or null for the application's own network. */
  readonly set: Pick<MockSet, "publicId" | "name" | "revision"> | null;
  readonly source: ActiveSource;
  /** The name a share link recorded for a set that has since been deleted, for its notice. */
  readonly sharedSetGone?: string;
}

/** A share link's `view.mocks`: the set it was made with, by ID and name, or None. */
export interface SharedMocks {
  readonly set: string | null;
  readonly name: string | null;
}

/** The view to resolve: the application, the saved preview shown, the visitor's workspace, and the share link's set, when it was opened through one. */
export interface ViewTarget {
  readonly applicationId: number;
  /** The saved preview shown, by its row ID; null for the tracked branch. */
  readonly previewId: number | null;
  readonly workspaceId: number | null;
  readonly shared?: SharedMocks | null;
}

const viewOf = (workspaceId: number, applicationId: number, previewId: number | null) =>
  and(eq(mockSetChoices.workspaceId, workspaceId), eq(mockSetChoices.applicationId, applicationId), previewId === null ? isNull(mockSetChoices.applicationPreviewId) : eq(mockSetChoices.applicationPreviewId, previewId));

/** The visitor's choice for a view: a set, None (a null set), or undefined when they never chose. */
export function chosenSet(db: Executor, workspaceId: number | null, applicationId: number, previewId: number | null): { set: MockSet | null } | undefined {
  if (workspaceId === null) return undefined;
  const row = db.select().from(mockSetChoices).where(viewOf(workspaceId, applicationId, previewId)).get();
  if (!row) return undefined;
  if (row.mockSetId === null) return { set: null };
  const set = byId(db, row.mockSetId);
  return set ? { set } : undefined;
}

/**
 * Records that the workspace +workspaceId+ applies the set +setPublicId+ to
 * one view of the application, or None for null. Only that workspace's
 * choice for that view changes. Throws NotFoundError for a set or saved
 * preview of another application.
 * @public The mock sets endpoints and the Data tool use this (add-mock-sets, tasks 4.2 and 10.2).
 */
export function chooseSet(db: Executor, workspaceId: number, applicationId: number, previewId: number | null, setPublicId: string | null): MockSet | null {
  return immediate(db, (tx) => {
    if (previewId !== null) requirePreviewOf(tx, applicationId, previewId);
    let set: MockSet | null = null;
    if (setPublicId !== null) {
      const row = tx
        .select()
        .from(mockSets)
        .where(and(eq(mockSets.applicationId, applicationId), eq(mockSets.publicId, setPublicId)))
        .get();
      if (!row) throw new NotFoundError("That mock set no longer exists. Someone else deleted it.");
      set = toMockSet(row);
    }
    tx.delete(mockSetChoices).where(viewOf(workspaceId, applicationId, previewId)).run();
    tx.insert(mockSetChoices)
      .values({ workspaceId, applicationId, applicationPreviewId: previewId, mockSetId: set?.id ?? null })
      .run();
    return set;
  });
}

/** Forgets every choice of the workspace +workspaceId+, inside the caller's transaction, as Reset workspace does; the sets stay. */
export function clearWorkspaceChoices(tx: Executor, workspaceId: number): void {
  tx.delete(mockSetChoices).where(eq(mockSetChoices.workspaceId, workspaceId)).run();
}

/**
 * Forgets the visitor's choice for a view, so it applies its default again.
 * @public Tests use it, and the Data tool may (add-mock-sets, task 10.2).
 */
export function clearChoice(db: Executor, workspaceId: number, applicationId: number, previewId: number | null): void {
  db.delete(mockSetChoices).where(viewOf(workspaceId, applicationId, previewId)).run();
}

/**
 * The default a capture of the view applies (design decision 11): the saved
 * preview's own choice when it has one, otherwise the application's.
 */
export function targetDefault(db: Executor, applicationId: number, previewId: number | null): { set: MockSet | null; source: "preview" | "application" | "none" } {
  if (previewId !== null) {
    const own = previewDefault(db, applicationId, previewId);
    if (own.kind === "set") return { set: own.set, source: "preview" };
    if (own.kind === "none") return { set: null, source: "preview" };
  }
  const set = applicationDefault(db, applicationId);
  return { set, source: set ? "application" : "none" };
}

const shown = (set: MockSet | null) => (set ? { publicId: set.publicId, name: set.name, revision: set.revision } : null);

/**
 * The set +target+ applies, and where it came from, in the spec's order.
 * @public The endpoints, running applications, preview mode, and share links use this (add-mock-sets, tasks 4.2, 11.1, and 12.1).
 */
export function resolveActiveSet(db: Executor, target: ViewTarget): ActiveSet {
  let sharedSetGone: string | undefined;
  if (target.shared) {
    if (target.shared.set === null) return { set: null, source: "share" };
    const row = db
      .select()
      .from(mockSets)
      .where(and(eq(mockSets.applicationId, target.applicationId), eq(mockSets.publicId, target.shared.set)))
      .get();
    if (row) return { set: shown(toMockSet(row)), source: "share" };
    sharedSetGone = target.shared.name ?? target.shared.set;
  }
  const gone = sharedSetGone === undefined ? {} : { sharedSetGone };
  const choice = chosenSet(db, target.workspaceId, target.applicationId, target.previewId);
  if (choice) return { set: shown(choice.set), source: "choice", ...gone };
  const fallback = targetDefault(db, target.applicationId, target.previewId);
  return { set: shown(fallback.set), source: fallback.source, ...gone };
}

/**
 * The notice for a share link whose set was deleted (design decision 17).
 * @public Share links use this (add-mock-sets, task 12.1).
 */
export function sharedSetGoneNotice(name: string): string {
  return `The shared mock set "${name}" no longer exists, so this view uses your own choice.`;
}
