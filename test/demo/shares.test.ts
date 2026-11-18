import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stateFromShare } from "@/demo/runtime/view-store";
import type { Db } from "@/lib/db/client";
import { demoShares } from "@/lib/db/schema";
import { templateBySlug } from "@/lib/demo/catalog";
import { type ShareState, createShare, findShare, shareStateSchema } from "@/lib/demo/shares";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const STATE: ShareState = { route: "payees", overrides: {}, theme: "dark", persona: "approver" };
const PRIYA = { name: "Priya Shah", persona: "Approver", region: "Mumbai" } as const;

// Share links carry a snapshot of the active session profile (template-demo/
// toolbar spec; toolbar-updates design.md, decision 7).
describe("share link profile snapshots", () => {
  let db: Db;
  let workspace: number;
  beforeEach(() => {
    db = createTestDb();
    workspace = ensureWorkspace(db, newWorkspaceKey()).id;
  });
  afterEach(() => db.$client.close());

  it("stores and reads back a profile snapshot, trimmed, beside the matching built-in persona id", () => {
    const token = createShare(db, "payments-workspace", workspace, { ...STATE, profile: { name: " Priya Shah ", persona: "Approver", region: "Mumbai " } });
    expect(findShare(db, token)?.state).toEqual({ ...STATE, profile: PRIYA });
    expect(JSON.parse(db.select().from(demoShares).get()!.state)).toMatchObject({ persona: "approver", profile: PRIYA });
  });

  it("refuses a snapshot that breaks the profile rules", () => {
    for (const profile of [
      { ...PRIYA, name: "" },
      { ...PRIYA, name: "x".repeat(61) },
      { ...PRIYA, region: "Mum\u0000bai" },
      { ...PRIYA, persona: "Owner" },
      { ...PRIYA, role: "Approver" },
      { name: "Priya Shah" },
    ]) {
      expect(shareStateSchema.safeParse({ ...STATE, profile }).success, JSON.stringify(profile)).toBe(false);
    }
  });

  it("still reads a link from before profiles, which opens as the built-in profile its persona names", () => {
    const token = createShare(db, "payments-workspace", workspace, STATE);
    const share = findShare(db, token)!;
    expect(share.state.profile).toBeUndefined();
    expect(stateFromShare(templateBySlug("payments-workspace")!.app, share.state).profileId).toBe("approver");
  });
});
