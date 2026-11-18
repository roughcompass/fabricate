import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfig, withOverrides, getConfig } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { resolveView } from "@/lib/demo/access";
import { type ThreadInput, type WritableView, addComment, createThread, listThreads, setThreadStatus } from "@/lib/demo/comments";
import { shareCookieName } from "@/lib/demo/runtime-view";
import { createShare } from "@/lib/demo/shares";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type Workspace, ensureWorkspace, findWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const INPUT: ThreadInput = { route: "payees", member: "payee-list", memberVersion: "1.4.2", anchor: "pay-lumen", offsetX: 0.5, offsetY: 0.25, body: "Make this primary" };

describe("comment threads", () => {
  let db: Db;
  let owner: Workspace;
  let stranger: Workspace;
  let ownerKey: string;
  let strangerKey: string;
  const appPublicId = "ref-payments-workspace";

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    ownerKey = newWorkspaceKey();
    strangerKey = newWorkspaceKey();
    owner = ensureWorkspace(db, ownerKey);
    stranger = ensureWorkspace(db, strangerKey);
    cookieJar.clear();
  });
  afterEach(() => setDb(undefined));

  const ownView = () => resolveView(db, appPublicId, owner) as WritableView;

  it("starts a thread with its first comment and lists it in the view", () => {
    const id = createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
    const [thread] = listThreads(db, ownView());
    expect(thread).toMatchObject({ id, route: "payees", member: "payee-list", memberVersion: "1.4.2", anchor: "pay-lumen", status: "open" });
    expect(thread!.comments.map((comment) => [comment.authorName, comment.body])).toEqual([["Sam", "Make this primary"]]);
  });

  it("refuses an unknown route, member, or version, and blank or overlong comments", () => {
    const view = ownView();
    const author = { workspaceId: owner.id, name: "Sam" };
    expect(() => createThread(db, view, author, { ...INPUT, route: "nowhere" })).toThrow(/route is not part of the application/);
    expect(() => createThread(db, view, author, { ...INPUT, member: "watchlist" })).toThrow(/microfrontend is not part of the application/);
    expect(() => createThread(db, view, author, { ...INPUT, memberVersion: "9.9.9" })).toThrow(/version is not available/);
    expect(() => createThread(db, view, author, { ...INPUT, body: "   " })).toThrow(/Write a comment/);
    expect(() => createThread(db, view, author, { ...INPUT, body: "x".repeat(2001) })).toThrow(/at most 2,000 characters/);
    expect(() => createThread(db, view, author, { ...INPUT, body: "x".repeat(2000) })).not.toThrow();
  });

  it("keeps comment text exactly as plain text", () => {
    createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, { ...INPUT, body: "<script>alert(1)</script> **bold**" });
    expect(listThreads(db, ownView())[0]!.comments[0]!.body).toBe("<script>alert(1)</script> **bold**");
  });

  it("replies, resolves, and reopens threads", () => {
    const id = createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
    addComment(db, ownView(), id, { workspaceId: owner.id, name: "Sam" }, "Agreed");
    setThreadStatus(db, ownView(), id, "resolved");
    expect(listThreads(db, ownView())[0]).toMatchObject({ status: "resolved" });
    setThreadStatus(db, ownView(), id, "open");
    const [thread] = listThreads(db, ownView());
    expect(thread!.status).toBe("open");
    expect(thread!.comments).toHaveLength(2);
  });

  it("gives each workspace private threads on a reference deployment", () => {
    const theirs = resolveView(db, appPublicId, stranger) as WritableView;
    createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
    expect(listThreads(db, ownView())).toHaveLength(1);
    expect(listThreads(db, theirs)).toEqual([]);
    expect(listThreads(db, resolveView(db, appPublicId, null)!)).toEqual([]);
  });

  it("refuses to change a thread from another view", () => {
    const id = createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
    const theirs = resolveView(db, appPublicId, stranger) as WritableView;
    expect(() => addComment(db, theirs, id, { workspaceId: stranger.id, name: "Robin" }, "Hi")).toThrow(ValidationError);
    expect(() => setThreadStatus(db, theirs, id, "resolved")).toThrow(/does not exist/);
  });

  it("lets a share link holder read and reply in the shared view", () => {
    const id = createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
    const token = createShare(db, "payments-workspace", owner.id, { route: "payees", overrides: {}, theme: "light", persona: "analyst" });
    const shared = resolveView(db, appPublicId, stranger, token) as WritableView;
    addComment(db, shared, id, { workspaceId: stranger.id, name: "Robin" }, "Looks good");
    expect(listThreads(db, ownView())[0]!.comments.map((comment) => comment.authorName)).toEqual(["Sam", "Robin"]);
  });

  describe("route handlers", () => {
    beforeEach(() => setConfig(withOverrides(getConfig(), { demo: { enabled: true } })));

    const post = async (path: string, body: unknown) => {
      const { POST } = await import("@/app/api/demo/threads/route");
      return POST(new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) }));
    };

    it("lists each workspace's own threads, and the sharer's through a share link", async () => {
      const { GET } = await import("@/app/api/demo/threads/route");
      const threads = async () => {
        const response = await GET(new Request(`http://localhost/api/demo/threads?application=${appPublicId}`));
        expect(response.status).toBe(200);
        return ((await response.json()) as { threads: unknown[] }).threads;
      };
      createThread(db, ownView(), { workspaceId: owner.id, name: "Sam" }, INPUT);
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      expect(await threads()).toHaveLength(1);
      cookieJar.set(WORKSPACE_COOKIE, strangerKey);
      expect(await threads()).toEqual([]);

      const token = createShare(db, "payments-workspace", owner.id, { route: "payees", overrides: {}, theme: "light", persona: "analyst" });
      cookieJar.set(shareCookieName(appPublicId), token);
      expect(await threads()).toHaveLength(1);
    });

    it("asks for a display name on the first comment and remembers it", async () => {
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      const missing = await post("/api/demo/threads", { application: appPublicId, ...INPUT });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ errors: { authorName: ["Enter a display name"] } });

      const created = await post("/api/demo/threads", { application: appPublicId, ...INPUT, authorName: " Sam  Rivera " });
      expect(created.status).toBe(201);
      expect(findWorkspace(db, ownerKey)!.displayName).toBe("Sam Rivera");
      expect((await post("/api/demo/threads", { application: appPublicId, ...INPUT })).status).toBe(201);
    });

    it("rejects an overlong comment and a request for an unknown application", async () => {
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      const long = await post("/api/demo/threads", { application: appPublicId, ...INPUT, body: "x".repeat(2001), authorName: "Sam" });
      expect(await long.json()).toEqual({ errors: { body: ["Use at most 2,000 characters"] } });
      expect((await post("/api/demo/threads", { application: "app_0000000000000000", ...INPUT, authorName: "Sam" })).status).toBe(404);
    });

    it("answers not found while the demo is disabled", async () => {
      setConfig(withOverrides(getConfig(), { demo: { enabled: false } }));
      const { GET } = await import("@/app/api/demo/threads/route");
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      expect((await GET(new Request(`http://localhost/api/demo/threads?application=${appPublicId}`))).status).toBe(404);
      expect((await post("/api/demo/threads", { application: appPublicId, ...INPUT, authorName: "Sam" })).status).toBe(404);
    });
  });
});
