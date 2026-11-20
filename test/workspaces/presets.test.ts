import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { applications, sessionPresetChoices, workspaces } from "@/lib/db/schema";
import { PRESET_LIMIT, StalePresetError, checkPreset, choosePreset, chosenPreset, createPreset, deletePreset, editPreset, listPresets } from "@/lib/workspaces/presets";
import { newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace, purgeIdleWorkspaces, resetWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Session presets (restore-toolbar-tools-and-branch-previews, design
 * decision 8, task 10.1; template-demo/session-presets spec): the
 * application's, listed for every workspace; each workspace's choice its
 * own; bounded, with the Frontend Registry's own names refused.
 */

const ADMIN = { name: "Admin user", entries: [{ store: "local", name: "desk:user", value: '{"role":"admin"}' }, { store: "cookie", name: "desk-region", value: "london" }, { store: "query", name: "desk", value: "fx" }] };

/** The field-addressed messages of what +work+ refused. */
function refusal(work: () => unknown): Record<string, string[]> {
  try {
    work();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const messages: Record<string, string[]> = {};
    for (const issue of error.issues) (messages[issue.field] ??= []).push(issue.message);
    return messages;
  }
  throw new Error("expected a refusal");
}

describe("session presets", () => {
  let db: Db;
  let desk: ReturnType<typeof viewedApplicationIn>;
  const workspace = () => ensureWorkspace(db, newWorkspaceKey());

  beforeEach(() => {
    db = createTestDb();
    desk = viewedApplicationIn(db, "Quotes desk");
  });

  it("are listed for every workspace, and not for other applications, with who last changed them", () => {
    const presenter = workspace();
    const created = createPreset(db, desk.id, ADMIN, "Presenter");
    expect(created).toMatchObject({ name: "Admin user", updatedByName: "Presenter", lockVersion: 0, entries: ADMIN.entries });
    expect(listPresets(db, desk.id).map((preset) => preset.name)).toEqual(["Admin user"]);
    const other = viewedApplicationIn(db, "Orders portal");
    expect(listPresets(db, other.id)).toEqual([]);
    // Choices are each workspace's own.
    const visitor = workspace();
    choosePreset(db, presenter.id, desk.id, created.publicId);
    expect(chosenPreset(db, presenter.id, desk.id)?.name).toBe("Admin user");
    expect(chosenPreset(db, visitor.id, desk.id)).toBeNull();
    expect(chosenPreset(db, null, desk.id)).toBeNull();
    choosePreset(db, presenter.id, desk.id, null);
    expect(chosenPreset(db, presenter.id, desk.id)).toBeNull();
  });

  it("edits someone else's preset, and refuses a stale edit with the newer preset", () => {
    const created = createPreset(db, desk.id, ADMIN, "Presenter");
    const edited = editPreset(db, desk.id, created.publicId, created.lockVersion, { ...ADMIN, entries: [{ store: "cookie", name: "desk-region", value: "new-york" }] }, "Visitor");
    expect(edited).toMatchObject({ updatedByName: "Visitor", lockVersion: 1, entries: [{ store: "cookie", name: "desk-region", value: "new-york" }] });
    let stale: unknown;
    try {
      editPreset(db, desk.id, created.publicId, created.lockVersion, ADMIN, "Presenter");
    } catch (error) {
      stale = error;
    }
    expect(stale).toBeInstanceOf(StalePresetError);
    expect((stale as StalePresetError).current.entries).toEqual(edited.entries);
    expect((stale as StalePresetError).message).toBe("Someone else changed this preset since you opened it. Its newer entries are shown; make your change again.");
  });

  it("deleting a preset clears every workspace's choice of it, and deleting the application deletes its presets", () => {
    const created = createPreset(db, desk.id, ADMIN, null);
    const [one, two] = [workspace(), workspace()];
    choosePreset(db, one.id, desk.id, created.publicId);
    choosePreset(db, two.id, desk.id, created.publicId);
    expect(deletePreset(db, desk.id, created.publicId)).toBe(true);
    expect(db.select().from(sessionPresetChoices).all()).toEqual([]);
    expect(() => choosePreset(db, one.id, desk.id, created.publicId)).toThrow(NotFoundError);

    createPreset(db, desk.id, ADMIN, null);
    db.delete(applications).where(eq(applications.id, desk.id)).run();
    expect(listPresets(db, desk.id)).toEqual([]);
  });

  it("Reset workspace and the idle deletion remove only that workspace's choices, never the presets", () => {
    const created = createPreset(db, desk.id, ADMIN, "Presenter");
    const [presenter, idle, visitor] = [workspace(), workspace(), workspace()];
    for (const each of [presenter, idle, visitor]) choosePreset(db, each.id, desk.id, created.publicId);
    resetWorkspace(db, presenter.id);
    expect(chosenPreset(db, presenter.id, desk.id)).toBeNull();
    db.update(workspaces).set({ lastSeenAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) }).where(eq(workspaces.id, idle.id)).run();
    expect(purgeIdleWorkspaces(db)).toBe(1);
    expect(chosenPreset(db, visitor.id, desk.id)?.name).toBe("Admin user");
    expect(listPresets(db, desk.id)).toHaveLength(1);
  });

  it("keeps an application to 20 presets, with names unique ignoring case", () => {
    for (let index = 1; index <= PRESET_LIMIT; index++) createPreset(db, desk.id, { name: `Preset ${index}`, entries: [{ store: "local", name: "n", value: String(index) }] }, null);
    expect(refusal(() => createPreset(db, desk.id, { name: "One more", entries: [{ store: "local", name: "n", value: "x" }] }, null))).toEqual({ base: ["An application can have 20 presets. Delete one first."] });
    const other = viewedApplicationIn(db, "Orders portal");
    createPreset(db, other.id, ADMIN, null);
    expect(refusal(() => createPreset(db, other.id, { ...ADMIN, name: "  admin   USER " }, null))).toEqual({ name: ["Another preset of this application has that name. Choose another."] });
  });

  it("refuses the Frontend Registry's own names, cookie names that aren't valid, the share parameter, and entries past their limits", () => {
    expect(refusal(() => checkPreset({ name: "", entries: [] }))).toEqual({ name: ["Enter a name"], entries: ["Add at least one entry"] });
    expect(
      refusal(() =>
        checkPreset({
          name: "x".repeat(61),
          entries: [
            { store: "local", name: "frontend-registry:theme:quotes-desk", value: "{}" },
            { store: "session", name: "Frontend-Registry-Demo", value: "" },
            { store: "cookie", name: "desk region", value: "london" },
            { store: "query", name: "share", value: "x" },
            { store: "local", name: "n".repeat(257), value: "v".repeat(4097) },
            { store: "elsewhere", name: "n", value: "" },
          ],
        }),
      ),
    ).toEqual({
      name: ["Use at most 60 characters"],
      "entries.0.name": ["That name belongs to the Frontend Registry, so a preset can't change it"],
      "entries.1.name": ["That name belongs to the Frontend Registry, so a preset can't change it"],
      "entries.2.name": ["A cookie name can have only letters, digits, and the characters ! # $ % & ' * + - . ^ _ ` | ~"],
      "entries.3.name": ["The query parameter share belongs to the Frontend Registry's share links, so a preset can't set it"],
      "entries.4.name": ["Use at most 256 characters"],
      "entries.4.value": ["Use at most 4,096 characters"],
      "entries.5.store": ["Choose local storage, session storage, a cookie, or a query parameter"],
    });
    expect(refusal(() => checkPreset({ name: "Many", entries: Array.from({ length: 51 }, (_, index) => ({ store: "local", name: `n${index}`, value: "" })) }))).toEqual({ entries: ["A preset can have up to 50 entries"] });
    // A query parameter may start with the Frontend Registry's name: it's the application's.
    expect(checkPreset({ name: "Ok", entries: [{ store: "query", name: "frontend-registry", value: "1" }] }).entries).toHaveLength(1);
  });
});
