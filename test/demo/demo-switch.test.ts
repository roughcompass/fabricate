import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { createShare } from "@/lib/demo/shares";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));

// The demo switch (template-demo/demo-mode spec): while it is off, every demo
// surface answers not found, whatever the request carries.
describe("demo switch off", () => {
  let db: Db;
  const applicationId = "ref-market-watch";
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    const key = newWorkspaceKey();
    const workspace = ensureWorkspace(db, key);
    token = createShare(db, "market-watch", workspace.id, { route: "watch", overrides: {}, theme: "light", persona: "analyst" });
    cookieJar.clear();
    cookieJar.set(WORKSPACE_COOKIE, key);
    setConfig(withOverrides(getConfig(), { demo: { enabled: false } }));
  });
  afterEach(() => {
    setDb(undefined);
    setConfig(withOverrides(getConfig(), { demo: { enabled: true } }));
  });

  it("renders the not-found page for the gallery, a template, and its preview", async () => {
    const { default: Gallery } = await import("@/app/(operator)/templates/page");
    const { default: Template } = await import("@/app/(operator)/templates/[templateSlug]/page");
    const { default: Preview } = await import("@/app/(operator)/templates/[templateSlug]/preview/page");
    expect(await redirectOf(Gallery({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }))).toBe("not-found");
    expect(await redirectOf(Template({ params: Promise.resolve({ templateSlug: "market-watch" }), searchParams: Promise.resolve({}) }))).toBe("not-found");
    expect(await redirectOf(Preview({ params: Promise.resolve({ templateSlug: "market-watch" }), searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("renders the not-found page for a running reference deployment", async () => {
    const { default: RunLayout } = await import("@/app/(runtime)/run/[applicationId]/layout");
    const { default: RunRoute } = await import("@/app/(runtime)/run/[applicationId]/[[...path]]/page");
    expect(await redirectOf(RunLayout({ children: null, params: Promise.resolve({ applicationId }) }))).toBe("not-found");
    expect(await redirectOf(RunRoute({ params: Promise.resolve({ applicationId, path: ["watch"] }), searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("answers 404 for a share link and every demo endpoint", async () => {
    const share = await import("@/app/s/[token]/route");
    const threads = await import("@/app/api/demo/threads/route");
    const shares = await import("@/app/api/demo/shares/route");
    const replies = await import("@/app/api/demo/threads/[threadId]/comments/route");
    const status = await import("@/app/api/demo/threads/[threadId]/status/route");
    const profiles = await import("@/app/api/demo/profiles/route");
    const profile = await import("@/app/api/demo/profiles/[profileId]/route");
    const post = (body: unknown) => new Request("http://localhost/api/demo", { method: "POST", body: JSON.stringify(body) });

    expect((await share.GET(new Request(`http://localhost/s/${token}`), { params: Promise.resolve({ token }) })).status).toBe(404);
    expect((await threads.GET(new Request(`http://localhost/api/demo/threads?application=${applicationId}`))).status).toBe(404);
    expect((await threads.POST(post({ application: applicationId }))).status).toBe(404);
    expect((await shares.POST(post({ application: applicationId, state: { route: "watch", overrides: {}, theme: "light", persona: "analyst" } }))).status).toBe(404);
    expect((await replies.POST(post({ application: applicationId, body: "Hi" }), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
    expect((await status.POST(post({ application: applicationId, status: "resolved" }), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
    // Whatever the body: the switch is checked before anything is read.
    const malformed = () => new Request("http://localhost/api/demo", { method: "POST", body: "not json" });
    expect((await status.POST(post({}), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
    expect((await threads.POST(malformed())).status).toBe(404);
    expect((await shares.POST(malformed())).status).toBe(404);
    expect((await replies.POST(malformed(), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
    expect((await profiles.POST(malformed())).status).toBe(404);
    expect((await profiles.GET()).status).toBe(404);
    expect((await profiles.POST(post({ name: "Priya Shah", persona: "Approver", region: "Mumbai" }))).status).toBe(404);
    expect((await profile.PATCH(post({ name: "Priya Shah", persona: "Approver", region: "Mumbai" }), { params: Promise.resolve({ profileId: "dpf_0000000000000000" }) })).status).toBe(404);
    expect((await profile.DELETE(post({}), { params: Promise.resolve({ profileId: "dpf_0000000000000000" }) })).status).toBe(404);
  });

  it("refuses the demo's Server Actions", async () => {
    const { resetDemo } = await import("@/app/(operator)/templates/actions");
    expect(await redirectOf(resetDemo())).toBe("not-found");
  });
});
