import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { demoEnabled } from "@/lib/demo/guard";
import { WORKSPACE_COOKIE, isWorkspaceKey, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { workspaces } from "@/lib/prototypes/db/schema";
import { config, proxy } from "@/proxy";
import { createPrototypesTestDb } from "../support/prototypes-db";
import { redirectOf } from "../support/next";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));
vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

const ID = { generation: "gen_aaaaaaaaaaaaaaaa", prototype: "pro_aaaaaaaaaaaaaaaa", version: "ver_aaaaaaaaaaaaaaaa", persona: "per_aaaaaaaaaaaaaaaa" };

// prototypes/availability spec, "Prototypes is available only when enabled".
describe("Prototypes switch off", () => {
  let connection: PrototypesConnection;
  const original = getConfig();

  beforeEach(async () => {
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    cookieJar.clear();
    cookieJar.set(WORKSPACE_COOKIE, newWorkspaceKey());
    setConfig(withOverrides(original, { prototypes: { enabled: false } }));
  });

  afterEach(async () => {
    setConfig(original);
    await setPrototypesDb(undefined);
  });

  it("renders the not-found page for every Prototypes page, without creating a workspace (Production default)", async () => {
    const pages = await Promise.all([
      import("@/app/(operator)/prototypes/page").then((module) => module.default({ searchParams: Promise.resolve({}) })),
      import("@/app/(operator)/prototypes/new/page").then((module) => module.default({ searchParams: Promise.resolve({}) })),
      import("@/app/(operator)/prototypes/[prototypeId]/page").then((module) => module.default({ params: Promise.resolve({ prototypeId: ID.prototype }), searchParams: Promise.resolve({}) })),
      import("@/app/(operator)/prototypes/generations/[generationId]/page").then((module) => module.default({ params: Promise.resolve({ generationId: ID.generation }), searchParams: Promise.resolve({}) })),
      import("@/app/(operator)/prototypes/personas/page").then((module) => module.default({ searchParams: Promise.resolve({}) })),
      import("@/app/(operator)/prototypes/personas/[personaId]/page").then((module) => module.default({ params: Promise.resolve({ personaId: ID.persona }) })),
    ].map((page) => redirectOf(page)));
    expect(pages).toEqual(Array(6).fill("not-found"));
    const { default: Layout } = await import("@/app/(operator)/prototypes/layout");
    expect(await redirectOf(Promise.resolve().then(() => Layout({ children: null })))).toBe("not-found");
    expect(await connection.db.select().from(workspaces)).toEqual([]);
  });

  it("answers 404 for a render frame and every endpoint", async () => {
    const { GET: render } = await import("@/app/(operator)/prototypes/render/[versionId]/route");
    const { GET: generationStatus } = await import("@/app/api/prototypes/generations/[generationId]/status/route");
    const { GET: prototypeStatus } = await import("@/app/api/prototypes/[prototypeId]/status/route");
    const { POST: audit } = await import("@/app/api/prototypes/versions/[versionId]/audit/route");
    const { POST: renderError } = await import("@/app/api/prototypes/versions/[versionId]/render-error/route");
    const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
    const responses = await Promise.all([
      render(new Request(`http://localhost/prototypes/render/${ID.version}`), { params: Promise.resolve({ versionId: ID.version }) }),
      generationStatus(new Request("http://localhost/x"), { params: Promise.resolve({ generationId: ID.generation }) }),
      prototypeStatus(new Request("http://localhost/x"), { params: Promise.resolve({ prototypeId: ID.prototype }) }),
      audit(post({ violations: [] }), { params: Promise.resolve({ versionId: ID.version }) }),
      renderError(post({ message: "x" }), { params: Promise.resolve({ versionId: ID.version }) }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  });

  it("leaves the template demo as it is (Independent of the template demo)", () => {
    expect(demoEnabled()).toBe(true);
  });
});

// design.md, decision 2: one anonymous credential for the demo and Prototypes.
describe("Prototypes workspace proxy", () => {
  it.each(["/prototypes", "/prototypes/new", "/prototypes/pro_0000000000000001", "/prototypes/render/ver_0000000000000001", "/api/prototypes/generations/gen_0000000000000001/status", "/p/token"])("runs on the Prototypes path %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each(["/.well-known/workflow/v1/flow", "/prototypesx"])("issues no credential on %s", (url) => {
    expect(proxy(new NextRequest(`http://localhost:3000${url}`)).headers.get("set-cookie")).toBeNull();
  });

  it("never runs on the prototype runtime's static files", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/prototype-runtime/abc/host.js" })).toBe(false);
  });

  it("issues the demo's workspace cookie on a first Prototypes request, and keeps an existing one (One identity across the demo and Prototypes)", () => {
    const first = proxy(new NextRequest("http://localhost:3000/prototypes"));
    const key = first.cookies.get(WORKSPACE_COOKIE)?.value;
    expect(isWorkspaceKey(key)).toBe(true);
    const demoVisitor = proxy(new NextRequest("http://localhost:3000/prototypes/new", { headers: { cookie: `${WORKSPACE_COOKIE}=${key}` } }));
    expect(demoVisitor.headers.get("set-cookie")).toBeNull();
  });
});

// prototypes/availability spec, "The hosted profile runs Prototypes without local Git or SQLite"; design.md, decision 4.
describe("the hosted profile's proxy", () => {
  const original = getConfig();
  beforeEach(() => setConfig(withOverrides(loadConfig({ environment: "test" }), { profile: "hosted" })));
  afterEach(() => setConfig(original));

  it("sends / to /prototypes", () => {
    const response = proxy(new NextRequest("http://localhost:3000/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/prototypes");
  });

  it.each(["/assessments", "/assessments/new", "/repositories", "/templates", "/applications", "/onboarding", "/design-system", "/s/token", "/api/demo/comments", "/prototypesx"])("answers not found for %s (Starting on Vercel)", (url) => {
    expect(proxy(new NextRequest(`http://localhost:3000${url}`)).status).toBe(404);
  });

  it.each(["/prototypes", "/prototypes/new", "/api/prototypes/generations/gen_0000000000000001/status", "/p/token", "/.well-known/workflow/v1/flow", "/api/health"])("serves %s", (url) => {
    const response = proxy(new NextRequest(`http://localhost:3000${url}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
