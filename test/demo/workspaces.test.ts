import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { demoShares, demoThreads, demoWorkspaces } from "@/lib/db/schema";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
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
} from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-30T12:00:00Z");

describe("demo workspaces", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    resetPurgeClock();
  });
  afterEach(() => db.$client.close());

  const addReferenceThread = (workspaceId: number) =>
    db
      .insert(demoThreads)
      .values({ publicId: generatePublicId("thr"), referenceSlug: "market-watch", viewWorkspaceId: workspaceId, route: "watch", member: "watchlist", memberVersion: "1.8.0", anchor: "filter", offsetX: 0.5, offsetY: 0.5, createdAt: NOW })
      .run();
  const rows = (table: typeof demoThreads | typeof demoShares | typeof demoWorkspaces) => db.select().from(table).all().length;
  const threadsOf = (workspaceId: number) => db.select().from(demoThreads).all().filter((thread) => thread.viewWorkspaceId === workspaceId).length;

  it("creates nothing until the first write, then stores only the key's digest", () => {
    const key = newWorkspaceKey();
    expect(findWorkspace(db, key)).toBeNull();
    expect(rows(demoWorkspaces)).toBe(0);

    const workspace = ensureWorkspace(db, key, NOW);
    expect(findWorkspace(db, key)).toEqual(workspace);
    expect(ensureWorkspace(db, key, NOW).id).toBe(workspace.id);
    const stored = db.select().from(demoWorkspaces).get()!;
    expect(stored.keyDigest).toBe(keyDigest(key));
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it("refuses a missing or malformed credential", () => {
    expect(findWorkspace(db, undefined)).toBeNull();
    expect(findWorkspace(db, "short")).toBeNull();
    expect(() => ensureWorkspace(db, "short")).toThrow(/no demo workspace/);
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
    const seen = () => db.select().from(demoWorkspaces).get()!.lastSeenAt.getTime();

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
    expect(rows(demoWorkspaces)).toBe(1);
    expect(threadsOf(idle.id)).toBe(0);
    expect(threadsOf(active.id)).toBe(1);
  });

  it("runs the idle purge at most once an hour", () => {
    expect(maybePurgeIdleWorkspaces(db, NOW)).toBe(0);
    expect(maybePurgeIdleWorkspaces(db, new Date(NOW.getTime() + 10 * 60 * 1000))).toBeNull();
    expect(maybePurgeIdleWorkspaces(db, new Date(NOW.getTime() + 61 * 60 * 1000))).toBe(0);
  });

  it("resets one workspace without touching another", () => {
    const key = newWorkspaceKey();
    const presenter = ensureWorkspace(db, key, NOW);
    const visitor = ensureWorkspace(db, newWorkspaceKey(), NOW);
    addReferenceThread(presenter.id);
    addReferenceThread(visitor.id);
    db.insert(demoShares).values({ tokenDigest: "b".repeat(64), referenceSlug: "market-watch", viewWorkspaceId: presenter.id, state: "{}", createdAt: NOW }).run();
    setHints(db, presenter.id, { off: true, runtime: "done" });
    setDisplayName(db, presenter.id, "Sam");

    const reset = resetWorkspace(db, presenter.id);

    expect(reset.resetEpoch).toBe(presenter.resetEpoch + 1);
    expect(reset.hints).toEqual({});
    expect(reset.displayName).toBe("Sam");
    expect(db.select().from(demoThreads).all().map((thread) => thread.viewWorkspaceId)).toEqual([visitor.id]);
    expect(rows(demoShares)).toBe(0);
    expect(findWorkspace(db, key)!.id).toBe(presenter.id);
  });
});
