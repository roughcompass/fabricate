import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
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

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    const key = newWorkspaceKey();
    ensureWorkspace(db, key);
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

  it("renders the not-found page for a running reference deployment, which is then no application either", async () => {
    const { default: RunLayout } = await import("@/app/(runtime)/run/[slug]/layout");
    const { default: RunRoute } = await import("@/app/(runtime)/run/[slug]/[[...path]]/page");
    // Without the demo, the layout leaves the address to the page, which finds no application by that name.
    expect(await RunLayout({ children: null, params: Promise.resolve({ slug: applicationId }) })).toBeNull();
    expect(await redirectOf(RunRoute({ params: Promise.resolve({ slug: applicationId, path: ["watch"] }), searchParams: Promise.resolve({}) }))).toBe("not-found");
  });

  it("refuses the demo's Server Actions", async () => {
    const { resetDemo } = await import("@/app/(operator)/templates/actions");
    expect(await redirectOf(resetDemo())).toBe("not-found");
  });
});
