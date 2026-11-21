import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { eq } from "drizzle-orm";
import { shareLinks, commentThreads, threadComments, workspaces } from "@/lib/db/schema";
import { newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import {
  ensureWorkspace,
  findWorkspace,
  keyDigest,
  maybePurgeIdleWorkspaces,
  purgeIdleWorkspaces,
  resetPurgeClock,
  resetWorkspace,
  setDisplayName,
  setHints,
  touchWorkspace,
} from "@/lib/workspaces/workspaces";
import { chooseSet, resolveActiveSet } from "@/lib/mocks/active";
import { setApplicationDefault } from "@/lib/mocks/defaults";
import { createSet } from "@/lib/mocks/records";
import { createTestDb } from "../support/db";
import { EXPORT_ORDERS, commitOf, viewedApplicationIn } from "../support/views";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-30T12:00:00Z");

describe("workspaces", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    resetPurgeClock();
  });
  afterEach(() => db.$client.close());

  const addReferenceThread = (workspaceId: number) =>
    db
      .insert(commentThreads)
      .values({ publicId: generatePublicId("thr"), applicationId: viewedApplicationIn(db).id, viewWorkspaceId: workspaceId, route: "/accounts", commitSha: commitOf("a"), anchor: EXPORT_ORDERS, offsetX: 0.5, offsetY: 0.5, createdAt: NOW })
      .run();
  const rows = (table: typeof commentThreads | typeof shareLinks | typeof workspaces) => db.select().from(table).all().length;
  const threadsOf = (workspaceId: number) => db.select().from(commentThreads).all().filter((thread) => thread.viewWorkspaceId === workspaceId).length;

  it("creates nothing until the first write, then stores only the key's digest", () => {
    const key = newWorkspaceKey();
    expect(findWorkspace(db, key)).toBeNull();
    expect(rows(workspaces)).toBe(0);

    const workspace = ensureWorkspace(db, key, NOW);
    expect(findWorkspace(db, key)).toEqual(workspace);
    expect(ensureWorkspace(db, key, NOW).id).toBe(workspace.id);
    const stored = db.select().from(workspaces).get()!;
    expect(stored.keyDigest).toBe(keyDigest(key));
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it("refuses a missing or malformed credential", () => {
    expect(findWorkspace(db, undefined)).toBeNull();
    expect(findWorkspace(db, "short")).toBeNull();
    expect(() => ensureWorkspace(db, "short")).toThrow(/has no workspace yet/);
  });

  it("keeps two visitors' workspaces apart", () => {
    const first = ensureWorkspace(db, newWorkspaceKey(), NOW);
    const second = ensureWorkspace(db, newWorkspaceKey(), NOW);
    addReferenceThread(first.id);

    expect(first.id).not.toBe(second.id);
    expect(threadsOf(first.id)).toBe(1);
    expect(threadsOf(second.id)).toBe(0);
  });

  it("stores a trimmed display name and validates it", () => {
    const workspace = ensureWorkspace(db, newWorkspaceKey(), NOW);
    expect(setDisplayName(db, workspace.id, "  Sam   Rivera ")).toBe("Sam Rivera");
    expect(() => setDisplayName(db, workspace.id, "   ")).toThrow(/Enter a display name/);
    expect(() => setDisplayName(db, workspace.id, "x".repeat(61))).toThrow(/at most 60/);
  });

  it("stores only known hint state", () => {
    const key = newWorkspaceKey();
    const workspace = ensureWorkspace(db, key, NOW);
    setHints(db, workspace.id, { off: true, runtime: "done", gallery: "done", surprise: 1 } as never);
    expect(findWorkspace(db, key)!.hints).toEqual({ off: true, runtime: "done" });
  });

  it("updates last-seen at most once an hour", () => {
    const workspace = ensureWorkspace(db, newWorkspaceKey(), NOW);
    const seen = () => db.select().from(workspaces).get()!.lastSeenAt.getTime();

    touchWorkspace(db, workspace.id, new Date(NOW.getTime() + 30 * 60 * 1000));
    expect(seen()).toBe(NOW.getTime());
    touchWorkspace(db, workspace.id, new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
    expect(seen()).toBe(NOW.getTime() + 2 * 60 * 60 * 1000);
  });

  it("purges workspaces idle for 30 days with everything they own", () => {
    const idle = ensureWorkspace(db, newWorkspaceKey(), new Date(NOW.getTime() - 31 * DAY));
    const active = ensureWorkspace(db, newWorkspaceKey(), new Date(NOW.getTime() - 29 * DAY));
    addReferenceThread(idle.id);
    addReferenceThread(active.id);

    expect(purgeIdleWorkspaces(db, NOW)).toBe(1);
    expect(rows(workspaces)).toBe(1);
    expect(threadsOf(idle.id)).toBe(0);
    expect(threadsOf(active.id)).toBe(1);
  });

  it("runs the idle purge at most once an hour", () => {
    expect(maybePurgeIdleWorkspaces(db, NOW)).toBe(0);
    expect(maybePurgeIdleWorkspaces(db, new Date(NOW.getTime() + 10 * 60 * 1000))).toBeNull();
    expect(maybePurgeIdleWorkspaces(db, new Date(NOW.getTime() + 61 * 60 * 1000))).toBe(0);
  });

  it("resets one workspace's threads, share links, display name, and hints, without touching another, the replies it left there, or the applications", () => {
    const key = newWorkspaceKey();
    const presenter = ensureWorkspace(db, key, NOW);
    const visitor = ensureWorkspace(db, newWorkspaceKey(), NOW);
    addReferenceThread(presenter.id);
    addReferenceThread(visitor.id);
    const orders = viewedApplicationIn(db, "Orders portal");
    db.insert(shareLinks).values({ tokenDigest: "b".repeat(64), applicationId: orders.id, viewWorkspaceId: presenter.id, commitSha: commitOf("a"), route: "/accounts", createdAt: NOW }).run();
    setHints(db, presenter.id, { off: true, runtime: "done" });
    setDisplayName(db, presenter.id, "Sam");
    // A reply the presenter left in the view the visitor shared with them.
    const visitorThread = db.select().from(commentThreads).all().find((thread) => thread.viewWorkspaceId === visitor.id)!;
    db.insert(threadComments).values({ publicId: generatePublicId("cmt"), threadId: visitorThread.id, authorWorkspaceId: presenter.id, authorName: "Sam", body: "Agreed", createdAt: NOW }).run();

    const reset = resetWorkspace(db, presenter.id);

    expect(reset).not.toHaveProperty("resetEpoch");
    expect(reset.hints).toEqual({});
    expect(reset.displayName).toBeNull();
    expect(db.select().from(commentThreads).all().map((thread) => thread.viewWorkspaceId)).toEqual([visitor.id]);
    // The reply stays in the visitor's view, which is theirs.
    expect(db.select({ body: threadComments.body }).from(threadComments).where(eq(threadComments.threadId, visitorThread.id)).all()).toEqual([{ body: "Agreed" }]);
    expect(rows(shareLinks)).toBe(0);
    expect(findWorkspace(db, key)!.id).toBe(presenter.id);
    expect(db.$client.prepare("select count(*) as n from applications").get()).toEqual({ n: 3 });
  });

  it("Reset with a mock set chosen: clears the workspace's mock set choices, so the default applies again, and leaves the sets (add-mock-sets, task 2.6)", () => {
    const presenter = ensureWorkspace(db, newWorkspaceKey(), NOW);
    const visitor = ensureWorkspace(db, newWorkspaceKey(), NOW);
    const orders = viewedApplicationIn(db, "Orders portal");
    const happy = createSet(db, orders.id, { name: "Happy path" }, null);
    const errors = createSet(db, orders.id, { name: "Errors" }, "Presenter");
    setApplicationDefault(db, orders.id, happy.publicId);
    chooseSet(db, presenter.id, orders.id, null, errors.publicId);
    chooseSet(db, visitor.id, orders.id, null, errors.publicId);
    const active = (workspaceId: number) => resolveActiveSet(db, { applicationId: orders.id, previewId: null, workspaceId }).set?.name;
    expect(active(presenter.id)).toBe("Errors");

    resetWorkspace(db, presenter.id);

    expect(active(presenter.id)).toBe("Happy path");
    expect(active(visitor.id)).toBe("Errors");
    expect(db.$client.prepare("select name from mock_sets order by name").all()).toEqual([{ name: "Errors" }, { name: "Happy path" }]);
  });

  it("purges an idle workspace's mock set choices, and keeps the sets it created with their application", () => {
    const idle = ensureWorkspace(db, newWorkspaceKey(), new Date(NOW.getTime() - 31 * DAY));
    const orders = viewedApplicationIn(db, "Orders portal");
    const errors = createSet(db, orders.id, { name: "Errors" }, "Presenter");
    chooseSet(db, idle.id, orders.id, null, errors.publicId);

    expect(purgeIdleWorkspaces(db, NOW)).toBe(1);

    expect(db.$client.prepare("select count(*) as n from mock_set_choices").get()).toEqual({ n: 0 });
    expect(db.$client.prepare("select name, created_by_name from mock_sets").all()).toEqual([{ name: "Errors", created_by_name: "Presenter" }]);
  });
});
