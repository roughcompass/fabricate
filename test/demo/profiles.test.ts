import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { demoProfiles } from "@/lib/db/schema";
import { PROFILE_LIMIT, createProfile, deleteProfile, isBuiltInProfileId, listProfiles, parseProfileFields, updateProfile } from "@/lib/demo/profiles";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { DemoLimitError, ensureWorkspace, purgeIdleWorkspaces, resetWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const NOW = new Date("2026-10-01T12:00:00Z");
const PRIYA = { name: "Priya Shah", persona: "Approver", region: "Mumbai" } as const;

/** The messages a call raised, by field. */
function issues(work: () => unknown): Record<string, string[]> {
  try {
    work();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const byField: Record<string, string[]> = {};
    for (const issue of error.issues) (byField[issue.field] ??= []).push(issue.message);
    return byField;
  }
  throw new Error("expected a validation error");
}

describe("session profiles", () => {
  let db: Db;
  let workspace: number;
  beforeEach(() => {
    db = createTestDb();
    workspace = ensureWorkspace(db, newWorkspaceKey(), NOW).id;
  });
  afterEach(() => db.$client.close());

  it("creates, lists, edits, and deletes a workspace's profiles", () => {
    const created = createProfile(db, workspace, { name: "  Priya Shah ", persona: "Approver", region: " Mumbai" }, NOW);
    expect(created).toMatchObject({ name: "Priya Shah", persona: "Approver", region: "Mumbai", builtIn: false });
    expect(created.id).toMatch(/^dpf_[a-z0-9]{16}$/);
    createProfile(db, workspace, { name: "Lee Chen", persona: "Analyst", region: "Hong Kong" }, new Date(NOW.getTime() + 1000));
    expect(listProfiles(db, workspace).map((profile) => profile.name)).toEqual(["Priya Shah", "Lee Chen"]);

    expect(updateProfile(db, workspace, created.id, { ...PRIYA, persona: "Analyst" }, NOW)).toMatchObject({ id: created.id, persona: "Analyst" });
    expect(deleteProfile(db, workspace, created.id)).toBe(true);
    expect(deleteProfile(db, workspace, created.id)).toBe(false);
    expect(listProfiles(db, workspace).map((profile) => profile.name)).toEqual(["Lee Chen"]);
  });

  it("explains invalid fields beside each field", () => {
    expect(issues(() => parseProfileFields({ name: "   ", persona: "Owner", region: "" }))).toEqual({
      name: ["Enter a name"],
      persona: ["Choose a persona"],
      region: ["Enter a region"],
    });
    expect(issues(() => parseProfileFields({ ...PRIYA, name: "x".repeat(61) }))).toEqual({ name: ["Use at most 60 characters"] });
    expect(issues(() => parseProfileFields({ ...PRIYA, region: "Mum\nbai" }))).toEqual({ region: ["Use letters, numbers, spaces, and punctuation only"] });
    expect(issues(() => parseProfileFields({ ...PRIYA, name: "Priya\u0007" }))).toEqual({ name: ["Use letters, numbers, spaces, and punctuation only"] });
    expect(issues(() => parseProfileFields({ persona: "Analyst" }))).toEqual({ name: ["Enter a name"], region: ["Enter a region"] });
    expect(parseProfileFields({ ...PRIYA, name: "x".repeat(60) }).name).toHaveLength(60);
  });

  it("refuses a name another profile has, ignoring case, including the built-in profiles", () => {
    expect(issues(() => createProfile(db, workspace, { name: "sam rivera", persona: "Analyst", region: "Lisbon" }, NOW))).toEqual({ name: ["A profile with that name already exists"] });
    const priya = createProfile(db, workspace, PRIYA, NOW);
    expect(issues(() => createProfile(db, workspace, { ...PRIYA, name: "PRIYA SHAH" }, NOW))).toEqual({ name: ["A profile with that name already exists"] });
    const lee = createProfile(db, workspace, { name: "Lee Chen", persona: "Analyst", region: "Hong Kong" }, NOW);
    expect(issues(() => updateProfile(db, workspace, lee.id, { ...PRIYA, name: "priya shah" }, NOW))).toEqual({ name: ["A profile with that name already exists"] });
    // Renaming a profile to its own name in another case is fine.
    expect(updateProfile(db, workspace, priya.id, { ...PRIYA, name: "PRIYA SHAH" }, NOW)?.name).toBe("PRIYA SHAH");
  });

  it("refuses the 21st profile with a message suggesting a deletion", () => {
    for (let index = 0; index < PROFILE_LIMIT; index++) createProfile(db, workspace, { name: `Visitor ${index}`, persona: "Analyst", region: "London" }, NOW);
    expect(() => createProfile(db, workspace, PRIYA, NOW)).toThrow(DemoLimitError);
    expect(() => createProfile(db, workspace, PRIYA, NOW)).toThrow("You have 20 custom profiles, the most a demo workspace can hold. Delete a profile to create another.");
    expect(listProfiles(db, workspace)).toHaveLength(PROFILE_LIMIT);
  });

  it("keeps each workspace's profiles to itself", () => {
    const other = ensureWorkspace(db, newWorkspaceKey(), NOW).id;
    const priya = createProfile(db, workspace, PRIYA, NOW);
    // The same name is free in another workspace.
    createProfile(db, other, PRIYA, NOW);
    expect(listProfiles(db, other)).toHaveLength(1);
    expect(updateProfile(db, other, priya.id, { ...PRIYA, region: "Pune" }, NOW)).toBeNull();
    expect(deleteProfile(db, other, priya.id)).toBe(false);
    expect(listProfiles(db, workspace)[0]?.region).toBe("Mumbai");
  });

  it("never treats a built-in profile as editable", () => {
    expect(isBuiltInProfileId("approver")).toBe(true);
    expect(isBuiltInProfileId("dpf_0123456789abcdef")).toBe(false);
    expect(updateProfile(db, workspace, "approver", PRIYA, NOW)).toBeNull();
    expect(deleteProfile(db, workspace, "analyst")).toBe(false);
  });

  it("removes a workspace's profiles when it is reset, and nobody else's", () => {
    const other = ensureWorkspace(db, newWorkspaceKey(), NOW).id;
    createProfile(db, workspace, PRIYA, NOW);
    createProfile(db, other, PRIYA, NOW);
    resetWorkspace(db, workspace);
    expect(listProfiles(db, workspace)).toEqual([]);
    expect(listProfiles(db, other)).toHaveLength(1);
  });

  it("removes an idle workspace's profiles with it", () => {
    createProfile(db, workspace, PRIYA, NOW);
    expect(purgeIdleWorkspaces(db, new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000))).toBe(1);
    expect(db.select().from(demoProfiles).all()).toEqual([]);
  });
});
