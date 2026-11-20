import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { createShare } from "@/lib/workspaces/shares";
import { newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace, resetWorkspace } from "@/lib/workspaces/workspaces";
import { deleteApplication } from "@/lib/applications/records";
import { createTestDb } from "../support/db";
import { commitOf, viewedApplicationIn } from "../support/views";

/*
 * Opening a share link (template-demo/toolbar spec, "Shared links open the
 * captured view"; page-patterns spec, "Share links that no longer resolve
 * lead back to Applications"): the application running at the captured
 * route with the token in the address, or the running application's
 * not-found page, which leads to Applications, or Home while previews are off.
 */
describe("share link route", () => {
  const original = getConfig();
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    setConfig(withOverrides(original, { previews: { enabled: true } }));
  });
  afterEach(() => {
    setDb(undefined);
    setConfig(original);
  });

  const open = async (token: string) => {
    const { GET } = await import("@/app/s/[token]/route");
    return GET(new Request(`http://localhost/s/${token}`), { params: Promise.resolve({ token }) });
  };

  it("opens the application at the captured route, carrying the token", async () => {
    const orders = viewedApplicationIn(db, "Orders portal");
    const token = createShare(db, orders.id, ensureWorkspace(db, newWorkspaceKey()).id, { commit: commitOf("a"), route: "/accounts/42" });
    const response = await open(token);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/run/${orders.slug}/accounts/42?share=${token}`);
  });

  it("sends an unknown token, a reset workspace's link, and a deleted application's link to the not-found page", async () => {
    const orders = viewedApplicationIn(db, "Orders portal");
    const workspace = ensureWorkspace(db, newWorkspaceKey());
    const reset = createShare(db, orders.id, workspace.id, { commit: commitOf("a"), route: "/" });
    resetWorkspace(db, workspace.id);
    const deleted = createShare(db, orders.id, ensureWorkspace(db, newWorkspaceKey()).id, { commit: commitOf("a"), route: "/" });
    deleteApplication(db, orders.publicId);
    for (const token of ["A".repeat(43), reset, deleted]) {
      const response = await open(token);
      expect([response.status, response.headers.get("location")], token).toEqual([303, "/run/unavailable"]);
    }
  });

  it("shows no application while previews are off, leading to the not-found page", async () => {
    const orders = viewedApplicationIn(db, "Orders portal");
    const token = createShare(db, orders.id, ensureWorkspace(db, newWorkspaceKey()).id, { commit: commitOf("a"), route: "/accounts" });
    setConfig(withOverrides(original, { previews: { enabled: false } }));
    const response = await open(token);
    expect([response.status, response.headers.get("location")]).toEqual([303, "/run/unavailable"]);
  });
});
