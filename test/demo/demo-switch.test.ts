import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { templateBySlug } from "@/lib/demo/catalog";
import { createApplication, validateDeployInput } from "@/lib/demo/deployments";
import { createShare } from "@/lib/demo/shares";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

// The demo switch (template-demo/demo-mode spec): while it is off, every demo
// surface answers not found, whatever the request carries.
describe("demo switch off", () => {
  let db: Db;
  let applicationId: string;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    const key = newWorkspaceKey();
    const workspace = ensureWorkspace(db, key);
    const application = createApplication(db, workspace.id, templateBySlug("market-watch")!, validateDeployInput({ name: "Desk", environment: "sandbox", project: "", repository: "" }));
    applicationId = application.publicId;
    token = createShare(db, { applicationId: application.id }, workspace.id, { route: "watch", overrides: {}, theme: "light", persona: "analyst" });
    cookieJar.clear();
    cookieJar.set(WORKSPACE_COOKIE, key);
    setConfig(withOverrides(getConfig(), { demo: { enabled: false } }));
  });
  afterEach(() => {
    setDb(undefined);
    setConfig(withOverrides(getConfig(), { demo: { enabled: true } }));
  });

  it("renders the not-found page for the create page, the import form, the gallery, a template, its deploy form, and the Applications list", async () => {
    const { default: Create } = await import("@/app/(operator)/new/page");
    const { default: Import } = await import("@/app/(operator)/new/import/page");
    const { default: Gallery } = await import("@/app/(operator)/templates/page");
    const { default: Template } = await import("@/app/(operator)/templates/[templateSlug]/page");
    const { default: Deploy } = await import("@/app/(operator)/templates/[templateSlug]/deploy/page");
    const { default: Applications } = await import("@/app/(operator)/applications/page");
    expect(await redirectOf(Create({ searchParams: Promise.resolve({}) }))).toBe("not-found");
    expect(await redirectOf(Import({ searchParams: Promise.resolve({ project: "PAY", repository: "payee-hub" }) }))).toBe("not-found");
    expect(await redirectOf(Gallery({ searchParams: Promise.resolve({}) }))).toBe("not-found");
    expect(await redirectOf(Template({ params: Promise.resolve({ templateSlug: "market-watch" }) }))).toBe("not-found");
    expect(await redirectOf(Deploy({ params: Promise.resolve({ templateSlug: "market-watch" }) }))).toBe("not-found");
    expect(await redirectOf(Applications({ searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("renders the not-found page for an application page, even for its owner", async () => {
    const { default: ApplicationPage } = await import("@/app/(operator)/applications/[applicationId]/page");
    expect(await redirectOf(ApplicationPage({ params: Promise.resolve({ applicationId }) }))).toBe("not-found");
  });

  it("renders the not-found page for a running application and a reference deployment", async () => {
    const { default: RunLayout } = await import("@/app/(runtime)/run/[applicationId]/layout");
    const { default: RunRoute } = await import("@/app/(runtime)/run/[applicationId]/[[...path]]/page");
    expect(await redirectOf(RunLayout({ children: null, params: Promise.resolve({ applicationId }) }))).toBe("not-found");
    expect(await redirectOf(RunLayout({ children: null, params: Promise.resolve({ applicationId: "ref-market-watch" }) }))).toBe("not-found");
    expect(await redirectOf(RunRoute({ params: Promise.resolve({ applicationId, path: ["watch"] }) }))).toBe("not-found");
  });

  it("answers 404 for a share link and every demo endpoint", async () => {
    const share = await import("@/app/s/[token]/route");
    const threads = await import("@/app/api/demo/threads/route");
    const shares = await import("@/app/api/demo/shares/route");
    const replies = await import("@/app/api/demo/threads/[threadId]/comments/route");
    const status = await import("@/app/api/demo/threads/[threadId]/status/route");
    const post = (body: unknown) => new Request("http://localhost/api/demo", { method: "POST", body: JSON.stringify(body) });

    expect((await share.GET(new Request(`http://localhost/s/${token}`), { params: Promise.resolve({ token }) })).status).toBe(404);
    expect((await threads.GET(new Request(`http://localhost/api/demo/threads?application=${applicationId}`))).status).toBe(404);
    expect((await threads.POST(post({ application: applicationId }))).status).toBe(404);
    expect((await shares.POST(post({ application: applicationId, state: { route: "watch", overrides: {}, theme: "light", persona: "analyst" } }))).status).toBe(404);
    expect((await replies.POST(post({ application: applicationId, body: "Hi" }), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
    expect((await status.POST(post({ application: applicationId, status: "resolved" }), { params: Promise.resolve({ threadId: "thr_0000000000000000" }) })).status).toBe(404);
  });

  it("refuses the demo's Server Actions", async () => {
    const { resetDemo } = await import("@/app/(operator)/templates/actions");
    const { skipBuildAction, deleteApplicationAction } = await import("@/app/(operator)/applications/actions");
    const { createApplicationAction } = await import("@/app/(operator)/templates/[templateSlug]/deploy/actions");
    const { submitPrompt, importRepositoryAction } = await import("@/app/(operator)/new/actions");
    const form = new FormData();
    form.set("application", applicationId);
    expect(await redirectOf(resetDemo())).toBe("not-found");
    expect(await redirectOf(skipBuildAction(form))).toBe("not-found");
    expect(await redirectOf(deleteApplicationAction(form))).toBe("not-found");
    expect(await redirectOf(submitPrompt({ values: { prompt: "" }, errors: {} }, form))).toBe("not-found");
    expect(await redirectOf(importRepositoryAction("PAY", "payee-hub", { values: { name: "" }, errors: {} }, form))).toBe("not-found");
    expect(await redirectOf(createApplicationAction("market-watch", { values: { name: "", environment: "sandbox", project: "", repository: "" }, errors: {} }, form))).toBe("not-found");
  });
});
