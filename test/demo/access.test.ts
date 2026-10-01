import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { demoApplications } from "@/lib/db/schema";
import { resolveView, viewApplicationId } from "@/lib/demo/access";
import { type ShareState, createShare, findShare } from "@/lib/demo/shares";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type Workspace, ensureWorkspace, resetWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const STATE: ShareState = { route: "payees", overrides: { "payee-list": { version: "2.0.0", environment: "sandbox" } }, theme: "dark", persona: "approver" };

describe("demo view access", () => {
  let db: Db;
  let owner: Workspace;
  let stranger: Workspace;
  beforeEach(() => {
    db = createTestDb();
    owner = ensureWorkspace(db, newWorkspaceKey());
    stranger = ensureWorkspace(db, newWorkspaceKey());
  });
  afterEach(() => db.$client.close());

  const addApplication = (workspaceId: number) =>
    db
      .insert(demoApplications)
      .values({ publicId: generatePublicId("app"), workspaceId, templateSlug: "payments-workspace", name: "Payments", environment: "sandbox", createdAt: new Date() })
      .returning()
      .get();

  it("opens a visitor's own application as its owner", () => {
    const app = addApplication(owner.id);
    const view = resolveView(db, app.publicId, owner);

    expect(view?.access).toBe("owner");
    expect(view?.viewWorkspaceId).toBe(owner.id);
    expect(viewApplicationId(view!.target)).toBe(app.publicId);
  });

  it("refuses someone else's application without a share link", () => {
    const app = addApplication(owner.id);
    expect(resolveView(db, app.publicId, stranger)).toBeNull();
    expect(resolveView(db, app.publicId, null)).toBeNull();
  });

  it("refuses unknown applications and templates", () => {
    expect(resolveView(db, "app_0000000000000000", owner)).toBeNull();
    expect(resolveView(db, "ref-no-such-template", owner)).toBeNull();
    expect(resolveView(db, "../etc/passwd", owner)).toBeNull();
  });

  it("gives each workspace its own private view of a reference deployment", () => {
    const mine = resolveView(db, "ref-market-watch", owner);
    const theirs = resolveView(db, "ref-market-watch", stranger);
    const anonymous = resolveView(db, "ref-market-watch", null);

    expect(mine).toMatchObject({ access: "reference", viewWorkspaceId: owner.id });
    expect(theirs).toMatchObject({ access: "reference", viewWorkspaceId: stranger.id });
    expect(anonymous).toMatchObject({ access: "reference", viewWorkspaceId: null });
    expect(mine!.target.kind).toBe("reference");
  });

  it("grants the sharer's view to anyone holding the token, with its captured state", () => {
    const app = addApplication(owner.id);
    const token = createShare(db, { applicationId: app.id }, owner.id, STATE);

    const shared = resolveView(db, app.publicId, stranger, token);
    expect(shared).toMatchObject({ access: "share", viewWorkspaceId: owner.id, shareState: STATE });
    expect(resolveView(db, app.publicId, null, token)?.viewWorkspaceId).toBe(owner.id);
  });

  it("shares a reference deployment view, exposing the sharer's private comments only through the link", () => {
    const token = createShare(db, { referenceSlug: "market-watch" }, owner.id, { ...STATE, route: "watch", overrides: {} });

    expect(resolveView(db, "ref-market-watch", stranger, token)).toMatchObject({ access: "share", viewWorkspaceId: owner.id });
    expect(resolveView(db, "ref-market-watch", stranger)?.viewWorkspaceId).toBe(stranger.id);
  });

  it("refuses a token used for a different application, a forged token, and a malformed token", () => {
    const app = addApplication(owner.id);
    const other = addApplication(owner.id);
    const token = createShare(db, { applicationId: app.id }, owner.id, STATE);

    expect(resolveView(db, other.publicId, stranger, token)).toBeNull();
    expect(resolveView(db, app.publicId, stranger, "A".repeat(43))).toBeNull();
    expect(resolveView(db, app.publicId, stranger, "nope")).toBeNull();
  });

  it("stops honoring a link once the sharer resets or deletes the application", () => {
    const app = addApplication(owner.id);
    const token = createShare(db, { applicationId: app.id }, owner.id, STATE);
    const referenceToken = createShare(db, { referenceSlug: "market-watch" }, owner.id, { ...STATE, route: "watch", overrides: {} });

    resetWorkspace(db, owner.id);
    expect(resolveView(db, app.publicId, stranger, token)).toBeNull();
    expect(findShare(db, referenceToken)).toBeNull();
  });

  it("rejects share state outside the schema", () => {
    const app = addApplication(owner.id);
    expect(() => createShare(db, { applicationId: app.id }, owner.id, { ...STATE, theme: "neon" } as never)).toThrow();
    expect(() => createShare(db, { applicationId: app.id }, owner.id, { ...STATE, route: "../admin" })).toThrow();
  });
});
