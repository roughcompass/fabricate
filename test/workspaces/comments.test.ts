import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { applications, commentThreads } from "@/lib/db/schema";
import { type ViewedApplication, resolveApplicationView } from "@/lib/workspaces/access";
import { type ThreadInput, type WritableView, addComment, createThread, listThreads, setThreadStatus } from "@/lib/workspaces/comments";
import { createShare } from "@/lib/workspaces/shares";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { THREAD_LIMIT, type Workspace, ensureWorkspace, findWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { EXPORT_ORDERS, commitOf, savedPreviewIn, viewedApplicationIn } from "../support/views";
import { findShare } from "@/lib/workspaces/shares";

/*
 * Comment threads on a running application (template-demo/toolbar spec,
 * "Comments stay bound to their element, route, and commit"; add-applications,
 * task 8.2): stored in the workspace with the route, the commit, and the
 * element's anchor, private to the workspace until it shares a view, and
 * bounded at THREAD_LIMIT open threads (template-demo/demo-mode spec).
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const INPUT: ThreadInput = { route: "/accounts", commit: commitOf("a"), anchor: EXPORT_ORDERS, offsetX: 0.5, offsetY: 0.25, body: "Make this primary" };

describe("comment threads", () => {
  let db: Db;
  let owner: Workspace;
  let stranger: Workspace;
  let ownerKey: string;
  let strangerKey: string;
  let orders: ViewedApplication;
  const original = getConfig();

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    setConfig(withOverrides(original, { previews: { enabled: true } }));
    ownerKey = newWorkspaceKey();
    strangerKey = newWorkspaceKey();
    owner = ensureWorkspace(db, ownerKey);
    stranger = ensureWorkspace(db, strangerKey);
    orders = viewedApplicationIn(db, "Orders portal");
    cookieJar.clear();
  });
  afterEach(() => {
    setDb(undefined);
    setConfig(original);
  });

  const ownView = () => resolveApplicationView(db, orders, owner) as WritableView;
  const author = () => ({ workspaceId: owner.id, name: "Sam" });

  it("starts a thread with its route, commit, and anchor, and its first comment, and lists it in the view", () => {
    const id = createThread(db, ownView(), author(), INPUT);
    const [thread] = listThreads(db, ownView());
    expect(thread).toMatchObject({ id, route: "/accounts", commit: commitOf("a"), anchor: EXPORT_ORDERS, offsetX: 0.5, offsetY: 0.25, status: "open" });
    expect(thread!.comments.map((comment) => [comment.authorName, comment.body])).toEqual([["Sam", "Make this primary"]]);
    // Another workspace's view of the same application has none of them.
    expect(listThreads(db, resolveApplicationView(db, orders, stranger))).toEqual([]);
    expect(listThreads(db, resolveApplicationView(db, orders, null))).toEqual([]);
  });

  it("replies, resolves, and reopens a thread only in its own view", () => {
    const id = createThread(db, ownView(), author(), INPUT);
    addComment(db, ownView(), id, { workspaceId: owner.id, name: "Robin" }, "Agreed");
    setThreadStatus(db, ownView(), id, "resolved");
    expect(listThreads(db, ownView())[0]).toMatchObject({ status: "resolved", comments: [{ body: "Make this primary" }, { authorName: "Robin", body: "Agreed" }] });
    setThreadStatus(db, ownView(), id, "open");
    expect(listThreads(db, ownView())[0]!.status).toBe("open");
    const theirs = resolveApplicationView(db, orders, stranger) as WritableView;
    expect(() => addComment(db, theirs, id, { workspaceId: stranger.id, name: "Eve" }, "Hi")).toThrow(/does not exist/);
    expect(() => setThreadStatus(db, theirs, id, "resolved")).toThrow(/does not exist/);
  });

  it("refuses blank or overlong comments, and keeps comment text exactly as written", () => {
    expect(() => createThread(db, ownView(), author(), { ...INPUT, body: "   " })).toThrow(/Write a comment/);
    expect(() => createThread(db, ownView(), author(), { ...INPUT, body: "x".repeat(2001) })).toThrow(/at most 2,000 characters/);
    createThread(db, ownView(), author(), { ...INPUT, body: "<script>alert(1)</script> **bold**" });
    expect(listThreads(db, ownView())[0]!.comments[0]!.body).toBe("<script>alert(1)</script> **bold**");
  });

  it(`holds at most ${THREAD_LIMIT} open threads in a workspace, and resolving one makes room (Thread limit)`, () => {
    const now = new Date();
    const rows = Array.from({ length: THREAD_LIMIT }, () => ({ publicId: generatePublicId("thr"), applicationId: orders.id, viewWorkspaceId: owner.id, route: "/accounts", commitSha: commitOf("a"), anchor: EXPORT_ORDERS, offsetX: 0.5, offsetY: 0.5, createdAt: now }));
    db.insert(commentThreads).values(rows).run();
    expect(() => createThread(db, ownView(), author(), INPUT)).toThrow("This workspace has 500 open comment threads, the most it can hold. Resolve some threads, or reset the workspace from Applications, to start another.");
    // The limit is the workspace's, whichever application a thread is on.
    expect(() => createThread(db, resolveApplicationView(db, viewedApplicationIn(db), owner) as WritableView, author(), INPUT)).toThrow(/500 open comment threads/);
    setThreadStatus(db, ownView(), rows[0]!.publicId, "resolved");
    expect(() => createThread(db, ownView(), author(), INPUT)).not.toThrow();
    // Reopening counts as starting one: with the workspace full again, the resolved thread stays resolved.
    expect(() => setThreadStatus(db, ownView(), rows[0]!.publicId, "open")).toThrow("This workspace has 500 open comment threads, the most it can hold. Resolve some threads, or reset the workspace from Applications, to start another.");
    expect(db.select({ status: commentThreads.status }).from(commentThreads).where(eq(commentThreads.publicId, rows[0]!.publicId)).get()).toEqual({ status: "resolved" });
    // Resolving an open thread, or reopening one that's open, always works.
    expect(() => setThreadStatus(db, ownView(), rows[1]!.publicId, "open")).not.toThrow();
    setThreadStatus(db, ownView(), rows[1]!.publicId, "resolved");
    expect(() => setThreadStatus(db, ownView(), rows[0]!.publicId, "open")).not.toThrow();
  });

  it("records the saved preview a thread was placed on, with its ref, and keeps the ref once the preview is removed (Comment on a saved preview, Comment on a removed preview)", () => {
    const feature = savedPreviewIn(db, orders);
    const onFeature = resolveApplicationView(db, orders, owner, null, feature) as WritableView;
    const tracked = createThread(db, ownView(), author(), INPUT);
    const placed = createThread(db, onFeature, author(), { ...INPUT, route: "/settings" });
    // Every thread of the view is listed from either preview; the toolbar pins only the preview's own.
    for (const view of [ownView(), onFeature]) {
      expect(listThreads(db, view).map((thread) => [thread.id, thread.preview])).toEqual([
        [tracked, null],
        [placed, { key: "feature-new-nav", ref: "refs/heads/feature/new-nav" }],
      ]);
    }
    db.$client.prepare("delete from application_previews where id = ?").run(feature.id);
    expect(listThreads(db, ownView())[1]).toMatchObject({ id: placed, preview: { key: null, ref: "refs/heads/feature/new-nav" } });
  });

  it("goes with its application", () => {
    createThread(db, ownView(), author(), INPUT);
    db.delete(applications).where(eq(applications.id, orders.id)).run();
    expect(db.select().from(commentThreads).all()).toEqual([]);
  });

  describe("route handlers", () => {
    const url = (path: string, query: Record<string, string> = {}) => `http://localhost/api/workspace/threads${path}?${new URLSearchParams({ application: orders.slug, ...query })}`;
    const post = async (body: unknown, query: Record<string, string> = {}) => {
      const { POST } = await import("@/app/api/workspace/threads/route");
      return POST(new Request(url("", query), { method: "POST", body: JSON.stringify(body) }));
    };
    const threads = async (query: Record<string, string> = {}) => {
      const { GET } = await import("@/app/api/workspace/threads/route");
      const response = await GET(new Request(url("", query)));
      expect(response.status).toBe(200);
      return ((await response.json()) as { threads: { comments: { body: string }[] }[] }).threads;
    };

    it("lists each workspace's own threads, and the sharer's through a share link (Private until shared)", async () => {
      createThread(db, ownView(), author(), INPUT);
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      expect(await threads()).toHaveLength(1);
      cookieJar.set(WORKSPACE_COOKIE, strangerKey);
      expect(await threads()).toEqual([]);

      const share = createShare(db, orders.id, owner.id, { commit: commitOf("a"), route: "/accounts" });
      expect(await threads({ share })).toHaveLength(1);
    });

    it("takes a reply through a share link into the sharer's thread (Reply through a share link)", async () => {
      const id = createThread(db, ownView(), author(), INPUT);
      const share = createShare(db, orders.id, owner.id, { commit: commitOf("a"), route: "/accounts" });
      cookieJar.set(WORKSPACE_COOKIE, strangerKey);
      const { POST } = await import("@/app/api/workspace/threads/[threadId]/comments/route");
      const reply = await POST(new Request(url(`/${id}/comments`, { share }), { method: "POST", body: JSON.stringify({ body: "Looks good", authorName: "Robin" }) }), { params: Promise.resolve({ threadId: id }) });
      expect(reply.status).toBe(201);
      expect(listThreads(db, ownView())[0]!.comments.map((comment) => comment.body)).toEqual(["Make this primary", "Looks good"]);
      // Without the link, the recipient can't reach the thread.
      const refused = await POST(new Request(url(`/${id}/comments`), { method: "POST", body: JSON.stringify({ body: "Again" }) }), { params: Promise.resolve({ threadId: id }) });
      expect(refused.status).toBe(400);
    });

    it("asks for a display name on the first comment and remembers it", async () => {
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      const missing = await post(INPUT);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ errors: { authorName: ["Enter a display name"] } });
      expect((await post({ ...INPUT, authorName: " Sam  Rivera " })).status).toBe(201);
      expect(findWorkspace(db, ownerKey)!.displayName).toBe("Sam Rivera");
      expect((await post(INPUT)).status).toBe(201);
    });

    it("places a thread on the saved preview the request names, shares it with that preview, and refuses an unknown one", async () => {
      savedPreviewIn(db, orders);
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      expect((await post({ ...INPUT, authorName: "Sam" }, { preview: "feature-new-nav" })).status).toBe(201);
      expect(listThreads(db, ownView())[0]!.preview).toEqual({ key: "feature-new-nav", ref: "refs/heads/feature/new-nav" });
      expect((await post({ ...INPUT, authorName: "Sam" }, { preview: "nowhere" })).status).toBe(404);
      const { GET } = await import("@/app/api/workspace/threads/route");
      expect((await GET(new Request(url("", { preview: "nowhere" })))).status).toBe(404);

      const shares = await import("@/app/api/workspace/shares/route");
      const created = await shares.POST(new Request(url("", { preview: "feature-new-nav" }), { method: "POST", body: JSON.stringify({ commit: commitOf("a"), route: "/accounts", view: { theme: { mode: "dark" } } }) }));
      expect(created.status).toBe(201);
      const token = ((await created.json()) as { path: string }).path.slice("/s/".length);
      expect(findShare(db, token)).toMatchObject({ preview: { ref: "refs/heads/feature/new-nav" }, view: { theme: { mode: "dark" } } });
    });

    it("refuses a malformed thread, an overlong comment, and an unknown application", async () => {
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      expect((await post({ ...INPUT, commit: "main", authorName: "Sam" })).status).toBe(400);
      expect((await post({ ...INPUT, anchor: { path: "body", tag: "<script>", fingerprint: "" }, authorName: "Sam" })).status).toBe(400);
      expect(await (await post({ ...INPUT, body: "x".repeat(2001), authorName: "Sam" })).json()).toEqual({ errors: { body: ["Use at most 2,000 characters"] } });
      const { POST } = await import("@/app/api/workspace/threads/route");
      const unknown = await POST(new Request("http://localhost/api/workspace/threads?application=no-such-application", { method: "POST", body: JSON.stringify({ ...INPUT, authorName: "Sam" }) }));
      expect(unknown.status).toBe(404);
    });

    it("answers not found while previews are off, whatever the request", async () => {
      setConfig(withOverrides(original, { previews: { enabled: false } }));
      cookieJar.set(WORKSPACE_COOKIE, ownerKey);
      const { GET } = await import("@/app/api/workspace/threads/route");
      expect((await GET(new Request(url("")))).status).toBe(404);
      expect((await post({ ...INPUT, authorName: "Sam" })).status).toBe(404);
      expect((await post("not json" as unknown)).status).toBe(404);
      const shares = await import("@/app/api/workspace/shares/route");
      expect((await shares.POST(new Request(url(""), { method: "POST", body: JSON.stringify({ commit: commitOf("a"), route: "/" }) }))).status).toBe(404);
      const hints = await import("@/app/api/workspace/hints/route");
      expect((await hints.POST(new Request("http://localhost/api/workspace/hints", { method: "POST", body: JSON.stringify({ action: "off" }) }))).status).toBe(404);
    });
  });
});
