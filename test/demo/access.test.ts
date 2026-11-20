import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { type ViewedApplication, resolveApplicationView, sharedApplication } from "@/lib/demo/access";
import { createShare, findShare } from "@/lib/demo/shares";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type Workspace, ensureWorkspace, resetWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";
import { commitOf, viewedApplicationIn } from "../support/views";

/*
 * Who sees which view of a running application (template-demo/demo-mode
 * spec, "Each visitor works in an anonymous workspace"): each workspace its
 * own, and the sharer's through a share link to that application.
 */

describe("application views", () => {
  let db: Db;
  let owner: Workspace;
  let stranger: Workspace;
  let orders: ViewedApplication;
  beforeEach(() => {
    db = createTestDb();
    owner = ensureWorkspace(db, newWorkspaceKey());
    stranger = ensureWorkspace(db, newWorkspaceKey());
    orders = viewedApplicationIn(db, "Orders portal");
  });
  afterEach(() => db.$client.close());

  const share = (workspace: Workspace, application = orders) => createShare(db, application.id, workspace.id, { commit: commitOf("a"), route: "/accounts/42" });

  it("gives each workspace its own private view of an application", () => {
    expect(resolveApplicationView(db, orders, owner)).toEqual({ application: orders, viewWorkspaceId: owner.id, access: "own" });
    expect(resolveApplicationView(db, orders, stranger)).toMatchObject({ access: "own", viewWorkspaceId: stranger.id });
    expect(resolveApplicationView(db, orders, null)).toMatchObject({ access: "own", viewWorkspaceId: null });
  });

  it("shares a view, exposing the sharer's comments only through the link, to that application only", () => {
    const token = share(owner);
    expect(resolveApplicationView(db, orders, stranger, token)).toMatchObject({ access: "share", viewWorkspaceId: owner.id, share: { commit: commitOf("a"), route: "/accounts/42" } });
    expect(resolveApplicationView(db, orders, null, token).viewWorkspaceId).toBe(owner.id);
    expect(sharedApplication(db, findShare(db, token)!)).toEqual(orders);

    // Another application, a forged token, or a malformed one opens the visitor's own view.
    const billing = viewedApplicationIn(db, "Billing");
    expect(resolveApplicationView(db, billing, stranger, token)).toMatchObject({ access: "own", viewWorkspaceId: stranger.id });
    expect(resolveApplicationView(db, orders, stranger, "A".repeat(43))).toMatchObject({ access: "own", viewWorkspaceId: stranger.id });
    expect(resolveApplicationView(db, orders, stranger, "nope")).toMatchObject({ access: "own" });
  });

  it("stops honoring a link once the sharer resets their workspace", () => {
    const token = share(owner);
    resetWorkspace(db, owner.id);
    expect(findShare(db, token)).toBeNull();
    expect(resolveApplicationView(db, orders, stranger, token)).toMatchObject({ access: "own", viewWorkspaceId: stranger.id });
  });
});
