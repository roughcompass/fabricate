import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { chooseSet, chosenSet, clearChoice, resolveActiveSet, sharedSetGoneNotice, targetDefault } from "@/lib/mocks/active";
import { previewDefault, setApplicationDefault, setPreviewDefault } from "@/lib/mocks/defaults";
import type { MockSet } from "@/lib/mocks/model";
import { createSet, deleteSet } from "@/lib/mocks/records";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { savedPreviewIn, viewedApplicationIn } from "../support/views";

/*
 * A view's active mock set (add-mock-sets, design decision 14, task 2.5;
 * mock-data spec, "A view's active mock set is resolved in one order"): a
 * share link's set, the visitor's choice, the saved preview's own default,
 * the application's default, or none, each with where it came from.
 */

describe("the active mock set", () => {
  let db: Db;
  let orders: ViewedApplication;
  let happy: MockSet;
  let errors: MockSet;
  let newNav: MockSet;
  let visitor: number;
  let preview: { id: number; key: string };

  beforeEach(() => {
    db = createTestDb();
    orders = viewedApplicationIn(db, "Orders portal");
    happy = createSet(db, orders.id, { name: "Happy path" }, null);
    errors = createSet(db, orders.id, { name: "Errors" }, null);
    newNav = createSet(db, orders.id, { name: "New nav data" }, null);
    visitor = ensureWorkspace(db, "v".repeat(43)).id;
    preview = savedPreviewIn(db, orders);
  });
  afterEach(() => db.$client.close());

  const resolve = (target: { previewId?: number | null; workspaceId?: number | null; shared?: { set: string | null; name: string | null } }) =>
    resolveActiveSet(db, { applicationId: orders.id, previewId: target.previewId ?? null, workspaceId: target.workspaceId === undefined ? visitor : target.workspaceId, shared: target.shared ?? null });
  const named = (target: Parameters<typeof resolve>[0]) => {
    const active = resolve(target);
    return [active.set?.name ?? null, active.source];
  };

  it("applies none when nothing chose a set", () => {
    expect(resolve({})).toEqual({ set: null, source: "none" });
    expect(resolve({ workspaceId: null })).toEqual({ set: null, source: "none" });
  });

  it("applies the application's default, with its revision", () => {
    setApplicationDefault(db, orders.id, happy.publicId);
    expect(resolve({})).toEqual({ set: { publicId: happy.publicId, name: "Happy path", revision: 1 }, source: "application" });
    expect(named({ previewId: preview.id })).toEqual(["Happy path", "application"]);
  });

  it("A saved preview's own default: the preview's choice applies, and the panel says it's the saved preview's", () => {
    setApplicationDefault(db, orders.id, happy.publicId);
    setPreviewDefault(db, orders.id, preview.id, { kind: "set", set: newNav.publicId });
    expect(named({ previewId: preview.id })).toEqual(["New nav data", "preview"]);
    // The tracked branch keeps the application's.
    expect(named({})).toEqual(["Happy path", "application"]);
    // A preview's None applies no set, even though the application has a default.
    setPreviewDefault(db, orders.id, preview.id, { kind: "none" });
    expect(named({ previewId: preview.id })).toEqual([null, "preview"]);
    expect(previewDefault(db, orders.id, preview.id)).toEqual({ kind: "none" });
    setPreviewDefault(db, orders.id, preview.id, { kind: "inherit" });
    expect(named({ previewId: preview.id })).toEqual(["Happy path", "application"]);
  });

  it("applies the visitor's choice for the view over every default, and None as a choice", () => {
    setApplicationDefault(db, orders.id, happy.publicId);
    setPreviewDefault(db, orders.id, preview.id, { kind: "set", set: newNav.publicId });
    chooseSet(db, visitor, orders.id, preview.id, errors.publicId);
    expect(named({ previewId: preview.id })).toEqual(["Errors", "choice"]);
    // The choice is the view's: the tracked branch still uses the default.
    expect(named({})).toEqual(["Happy path", "application"]);
    chooseSet(db, visitor, orders.id, null, null);
    expect(named({})).toEqual([null, "choice"]);
    expect(chosenSet(db, visitor, orders.id, null)).toEqual({ set: null });
    // Another visitor's view is unchanged.
    const other = ensureWorkspace(db, "o".repeat(43)).id;
    expect(named({ workspaceId: other })).toEqual(["Happy path", "application"]);
    clearChoice(db, visitor, orders.id, null);
    expect(named({})).toEqual(["Happy path", "application"]);
  });

  it("applies a share link's set over the visitor's choice, for that view only, or its None", () => {
    chooseSet(db, visitor, orders.id, null, happy.publicId);
    expect(named({ shared: { set: errors.publicId, name: "Errors" } })).toEqual(["Errors", "share"]);
    expect(named({ shared: { set: null, name: null } })).toEqual([null, "share"]);
    expect(named({})).toEqual(["Happy path", "choice"]);
    // A shared set of another application is no set of this one.
    const quotes = viewedApplicationIn(db, "Quotes desk");
    const foreign = createSet(db, quotes.id, { name: "Errors" }, null);
    expect(resolve({ shared: { set: foreign.publicId, name: "Errors" } })).toMatchObject({ source: "choice", sharedSetGone: "Errors" });
  });

  it("falls back from a deleted set: the share link's to the visitor's own choice with a notice, a choice to the defaults", () => {
    setApplicationDefault(db, orders.id, happy.publicId);
    chooseSet(db, visitor, orders.id, null, errors.publicId);
    deleteSet(db, orders.id, errors.publicId);
    expect(resolve({ shared: { set: errors.publicId, name: "Errors" } })).toEqual({ set: { publicId: happy.publicId, name: "Happy path", revision: 1 }, source: "application", sharedSetGone: "Errors" });
    expect(sharedSetGoneNotice("Errors")).toBe('The shared mock set "Errors" no longer exists, so this view uses your own choice.');
    // A preview whose own set was deleted inherits again.
    setPreviewDefault(db, orders.id, preview.id, { kind: "set", set: newNav.publicId });
    deleteSet(db, orders.id, newNav.publicId);
    expect(previewDefault(db, orders.id, preview.id)).toEqual({ kind: "inherit" });
    expect(targetDefault(db, orders.id, preview.id)).toMatchObject({ set: { name: "Happy path" }, source: "application" });
  });

  it("refuses a saved preview or set of another application", () => {
    const quotes = viewedApplicationIn(db, "Quotes desk");
    const theirs = savedPreviewIn(db, quotes, "refs/heads/feature/dark-blotter");
    expect(() => chooseSet(db, visitor, orders.id, theirs.id, null)).toThrow(NotFoundError);
    expect(() => setPreviewDefault(db, orders.id, theirs.id, { kind: "none" })).toThrow(NotFoundError);
    expect(() => setPreviewDefault(db, quotes.id, theirs.id, { kind: "set", set: happy.publicId })).toThrow(NotFoundError);
  });
});
