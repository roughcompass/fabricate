import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/applications/[slug]/mock-sets/imports/route";
import { GET as HAR } from "@/app/api/applications/[slug]/mock-sets/[set]/har/route";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { exportHar } from "@/lib/mocks/export";
import { draftContents, getDraft, saveDraft } from "@/lib/mocks/imports";
import { routes } from "@/lib/web/routes";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Upload HAR's endpoint (add-mock-sets, design decision 12, step 1, task
 * 4.4) and Export HAR's (task 4.5): an upload is refused past 50 MB before
 * it's read, needs the confirmation, is read at most two at a time, leaves
 * nothing of itself behind, and answers 303 to its review; an export
 * downloads the set as HAR.
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const ORIGIN = "http://127.0.0.1:3100";
const CHROME = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", "orders-portal.chrome.har"), "utf8");

describe("the upload and export endpoints", () => {
  const original = getConfig();
  let db: Db;
  let storage: string;
  let orders: ViewedApplication;
  const key = newWorkspaceKey();
  let workspace: number;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-upload-"));
    setConfig(withOverrides(original, { previews: { enabled: true, storage } }));
    orders = viewedApplicationIn(db, "Orders portal");
    workspace = ensureWorkspace(db, key).id;
    cookieJar.clear();
    cookieJar.set(WORKSPACE_COOKIE, key);
  });
  afterEach(() => {
    setConfig(original);
    setDb(undefined);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const form = (fields: Record<string, string>, file: { name: string; text: string } | null = { name: "orders-portal.chrome.har", text: CHROME }) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    if (file) data.set("file", new File([file.text], file.name, { type: "application/json" }));
    return data;
  };
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    POST(new Request(`${ORIGIN}${routes.mockSetImportsApi(orders.slug)}`, { method: "POST", body, headers: { "sec-fetch-site": "same-origin", ...headers }, ...(body instanceof ReadableStream && { duplex: "half" }) } as RequestInit), { params: Promise.resolve({ slug: orders.slug }) });
  const location = (response: Response) => new URL(response.headers.get("location")!, ORIGIN);
  const written = () => (fs.existsSync(path.join(storage, ".mock-imports")) ? fs.readdirSync(path.join(storage, ".mock-imports")) : []);
  const drafts = () => (db.$client.prepare("select count(*) as n from mock_set_imports").get() as { n: number }).n;

  it("reads a confirmed upload into a draft and answers 303 to its review", async () => {
    const response = await post(form({ target: "new", name: "Happy path", confirm: "yes" }));
    expect(response.status).toBe(303);
    const review = location(response);
    const draftId = review.pathname.split("/").at(-1)!;
    expect(review.pathname).toBe(routes.mockSetImport(orders.slug, draftId));
    const draft = getDraft(db, orders.id, workspace, draftId);
    expect([draft.fileName, draft.setName, draftContents(draft).calls.length]).toEqual(["orders-portal.chrome.har", "Happy path", 11]);
  });

  it("Not confirmed: reads nothing, and goes back to the confirmation", async () => {
    const response = await post(form({ target: "new", name: "Happy path" }));
    expect(response.status).toBe(303);
    expect(Object.fromEntries(location(response).searchParams)).toEqual({ error: "confirm", name: "Happy path" });
    expect([drafts(), written()]).toEqual([0, []]);
  });

  it("Too large: refuses a 60 MB body before reading it, with nothing written", async () => {
    const large = new Uint8Array(60 * 1024 * 1024);
    const declared = await post(large, { "content-length": String(large.byteLength), "content-type": "multipart/form-data; boundary=x" });
    expect(Object.fromEntries(location(declared).searchParams)).toEqual({ error: "too-large" });
    // Without a length, reading stops at the limit.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1024 * 1024;
        if (pulled > 60 * 1024 * 1024) controller.close();
        else controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const counted = await post(stream, { "content-type": "multipart/form-data; boundary=x" });
    expect(location(counted).searchParams.get("error")).toBe("too-large");
    expect(pulled).toBeLessThan(55 * 1024 * 1024);
    expect([drafts(), written()]).toEqual([0, []]);
  });

  it("Not a HAR file: says so, and leaves no file behind after the parse error", async () => {
    const response = await post(form({ target: "new", name: "Happy path", confirm: "yes" }, { name: "data.json", text: '{"log":{}}' }));
    expect(location(response).searchParams.get("error")).toBe("not-har");
    expect([drafts(), written()]).toEqual([0, []]);
  });

  it("asks for a new set's name, and for a file", async () => {
    expect(location(await post(form({ target: "new", name: " ", confirm: "yes" }))).searchParams.get("error")).toBe("name");
    expect(location(await post(form({ target: "new", name: "Happy path", confirm: "yes" }, null))).searchParams.get("error")).toBe("file");
  });

  it("reads two uploads at once, and refuses a third", async () => {
    const releases: (() => void)[] = [];
    const held = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          releases.push(() => controller.close());
        },
      });
    const first = post(held(), { "content-type": "multipart/form-data; boundary=x" });
    const second = post(held(), { "content-type": "multipart/form-data; boundary=x" });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const third = await post(form({ target: "new", name: "Happy path", confirm: "yes" }));
    expect(location(third).searchParams.get("error")).toBe("busy");
    for (const release of releases) release();
    await Promise.all([first, second]);
    expect((await post(form({ target: "new", name: "Happy path", confirm: "yes" }))).status).toBe(303);
  });

  it("refuses an upload from another origin, and answers not found while previews are off", async () => {
    expect((await post(form({ confirm: "yes" }), { "sec-fetch-site": "cross-site" })).status).toBe(403);
    setConfig(withOverrides(original, { previews: { enabled: false, storage } }));
    expect((await post(form({ confirm: "yes" }))).status).toBe(404);
  });

  it("Export HAR: downloads the set as orders-portal-happy-path.har, with the body export.ts writes", async () => {
    const review = location(await post(form({ target: "new", name: "Happy path", confirm: "yes" })));
    const set = saveDraft(db, getDraft(db, orders.id, workspace, review.pathname.split("/").at(-1)!), null);
    const response = await HAR(new Request(`${ORIGIN}${routes.mockSetHar(orders.slug, set.publicId)}`), { params: Promise.resolve({ slug: orders.slug, set: set.publicId }) });
    expect([response.status, response.headers.get("content-disposition"), response.headers.get("cache-control")]).toEqual([200, 'attachment; filename="orders-portal-happy-path.har"', "no-store"]);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(exportHar(db, set))));
  });
});
