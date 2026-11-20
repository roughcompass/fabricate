import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { applications, shareLinks } from "@/lib/db/schema";
import { createShare, findShare, shareInputSchema } from "@/lib/workspaces/shares";
import { newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace, keyDigest } from "@/lib/workspaces/workspaces";
import { eq } from "drizzle-orm";
import { createTestDb } from "../support/db";
import { commitOf, viewedApplicationIn } from "../support/views";

/*
 * Share links to a view of a running application (template-demo/toolbar
 * spec, "Visitors can share an application view"; add-applications, task
 * 8.6): the application, the commit of the build shown, and the route, with
 * the sharer's workspace. Only the token's digest is stored.
 */

describe("share links", () => {
  let db: Db;
  let workspace: number;
  beforeEach(() => {
    db = createTestDb();
    workspace = ensureWorkspace(db, newWorkspaceKey()).id;
  });
  afterEach(() => db.$client.close());

  it("captures the application, commit, and route, storing only the token's digest", () => {
    const orders = viewedApplicationIn(db);
    const token = createShare(db, orders.id, workspace, { commit: commitOf("a"), route: "/accounts/42" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(findShare(db, token)).toEqual({ applicationId: orders.id, viewWorkspaceId: workspace, commit: commitOf("a"), route: "/accounts/42" });
    const row = db.select().from(shareLinks).get()!;
    expect(row.tokenDigest).toBe(keyDigest(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("refuses a view outside the rules", () => {
    for (const input of [
      { commit: "abc", route: "/accounts" },
      { commit: commitOf("A"), route: "/accounts" },
      { commit: commitOf("a"), route: "accounts" },
      { commit: commitOf("a"), route: "/acc ounts" },
      { commit: commitOf("a"), route: "/acc\u0000ounts" },
      { commit: commitOf("a"), route: `/${"a".repeat(2048)}` },
      { commit: commitOf("a"), route: "/accounts", theme: "dark" },
    ]) {
      expect(shareInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("finds nothing for a forged or malformed token, and stops working once the application is deleted", () => {
    const orders = viewedApplicationIn(db);
    const token = createShare(db, orders.id, workspace, { commit: commitOf("a"), route: "/" });
    expect(findShare(db, "A".repeat(43))).toBeNull();
    expect(findShare(db, "nope")).toBeNull();
    expect(findShare(db, undefined)).toBeNull();
    db.delete(applications).where(eq(applications.id, orders.id)).run();
    expect(findShare(db, token)).toBeNull();
  });
});
