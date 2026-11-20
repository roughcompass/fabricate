import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { type ViewedApplication, resolveApplicationView, sharedApplication } from "@/lib/workspaces/access";
import { createShare, findShare } from "@/lib/workspaces/shares";
import { newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { type Workspace, ensureWorkspace, resetWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { commitOf, savedPreviewIn, viewedApplicationIn } from "../support/views";
import { viewedPreview } from "@/lib/workspaces/access";

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

  describe("share links of saved previews (restore-toolbar-tools-and-branch-previews, design decision 5)", () => {
    it("records the saved preview shown, its ref, and the view, and keeps the ref once the preview is removed", () => {
      const feature = savedPreviewIn(db, orders);
      const view = { theme: { mode: "dark" as const, density: "high" as const }, routing: [{ remote: "quotesPanel", mechanism: "module-federation" as const, from: "http://127.0.0.1:9311/remoteEntry.js", target: { application: "quotes-panel", preview: "feature-blue-quotes", build: "pvw_0000000000000001" } }] };
      const token = createShare(db, orders.id, owner.id, { commit: commitOf("a"), route: "/blotter", view }, undefined, { preview: feature, session: { preset: "ses_0000000000000001", name: "Admin user" } });
      expect(findShare(db, token)).toMatchObject({ route: "/blotter", preview: { id: feature.id, key: "feature-new-nav", ref: "refs/heads/feature/new-nav" }, view: { ...view, session: { preset: "ses_0000000000000001", name: "Admin user" } } });
      // The view names the preset, never its entries.
      expect(JSON.stringify(db.$client.prepare("select view from demo_shares").get())).not.toContain("desk:user");

      db.$client.prepare("delete from application_previews where id = ?").run(feature.id);
      expect(findShare(db, token)).toMatchObject({ preview: { id: null, key: null, ref: "refs/heads/feature/new-nav" } });
      // A link to the tracked branch records no preview and an empty view.
      expect(findShare(db, share(owner))).toMatchObject({ preview: null, view: {} });
    });

    it("refuses a view it can't store, and a session preset from the client", () => {
      expect(() => createShare(db, orders.id, owner.id, { commit: commitOf("a"), route: "/", view: { theme: { mode: "sepia" } } } as never)).toThrow();
      expect(() => createShare(db, orders.id, owner.id, { commit: commitOf("a"), route: "/", view: { session: { preset: "ses_0000000000000001", name: "Admin" } } } as never)).toThrow();
    });

    it("names the saved preview a view shows by its key, only for its own application", () => {
      const feature = savedPreviewIn(db, orders);
      expect(viewedPreview(db, orders, "feature-new-nav")).toEqual(feature);
      expect(viewedPreview(db, viewedApplicationIn(db, "Billing"), "feature-new-nav")).toBeNull();
      expect(resolveApplicationView(db, orders, owner, null, feature)).toEqual({ application: orders, viewWorkspaceId: owner.id, access: "own", preview: feature });
    });
  });
});
