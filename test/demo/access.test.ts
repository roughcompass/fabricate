import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { resolveView } from "@/lib/demo/access";
import { type ShareState, createShare, findShare } from "@/lib/demo/shares";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type Workspace, ensureWorkspace, resetWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const STATE: ShareState = { route: "watch", overrides: {}, theme: "dark", persona: "approver" };

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

  it("refuses unknown templates and anything that isn't a reference deployment", () => {
    expect(resolveView(db, "ref-no-such-template", owner)).toBeNull();
    expect(resolveView(db, "app_0000000000000000", owner)).toBeNull();
    expect(resolveView(db, "../etc/passwd", owner)).toBeNull();
  });

  it("gives each workspace its own private view of a reference deployment", () => {
    const mine = resolveView(db, "ref-market-watch", owner);
    const theirs = resolveView(db, "ref-market-watch", stranger);
    const anonymous = resolveView(db, "ref-market-watch", null);

    expect(mine).toMatchObject({ access: "reference", viewWorkspaceId: owner.id });
    expect(theirs).toMatchObject({ access: "reference", viewWorkspaceId: stranger.id });
    expect(anonymous).toMatchObject({ access: "reference", viewWorkspaceId: null });
    expect(mine!.template.slug).toBe("market-watch");
  });

  it("shares a reference deployment view, exposing the sharer's private comments only through the link", () => {
    const token = createShare(db, "market-watch", owner.id, STATE);

    expect(resolveView(db, "ref-market-watch", stranger, token)).toMatchObject({ access: "share", viewWorkspaceId: owner.id, shareState: STATE });
    expect(resolveView(db, "ref-market-watch", null, token)?.viewWorkspaceId).toBe(owner.id);
    expect(resolveView(db, "ref-market-watch", stranger)?.viewWorkspaceId).toBe(stranger.id);
  });

  it("refuses a token used for a different reference deployment, a forged token, and a malformed token", () => {
    const token = createShare(db, "market-watch", owner.id, STATE);

    expect(resolveView(db, "ref-payments-workspace", stranger, token)).toBeNull();
    expect(resolveView(db, "ref-market-watch", stranger, "A".repeat(43))).toBeNull();
    expect(resolveView(db, "ref-market-watch", stranger, "nope")).toBeNull();
  });

  it("stops honoring a link once the sharer resets the demo", () => {
    const token = createShare(db, "market-watch", owner.id, STATE);

    resetWorkspace(db, owner.id);
    expect(resolveView(db, "ref-market-watch", stranger, token)).toBeNull();
    expect(findShare(db, token)).toBeNull();
  });

  it("rejects share state outside the schema", () => {
    expect(() => createShare(db, "market-watch", owner.id, { ...STATE, theme: "neon" } as never)).toThrow();
    expect(() => createShare(db, "market-watch", owner.id, { ...STATE, route: "../admin" })).toThrow();
  });
});
