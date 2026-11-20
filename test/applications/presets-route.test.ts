import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/applications/[slug]/presets/route";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { setDb } from "@/lib/db/client";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace, setDisplayName } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * An application's session presets endpoint (restore-toolbar-tools-and-
 * branch-previews, design decision 8, task 10.2): any workspace on the
 * Frontend Registry's own origin reads and changes the application's
 * presets, recorded with its display name; a change from another origin is
 * refused; and it's not found while previews are off.
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const ORIGIN = "http://127.0.0.1:3100";
const ADMIN = { name: "Admin user", entries: [{ store: "cookie", name: "desk-region", value: "london" }] };

type Handler = typeof GET | typeof POST;

describe("the presets endpoint", () => {
  const original = getConfig();
  let slug: string;
  const presenter = newWorkspaceKey();
  const visitor = newWorkspaceKey();

  beforeEach(() => {
    const db = createTestDb();
    setDb(db);
    setConfig(withOverrides(original, { previews: { enabled: true } }));
    slug = viewedApplicationIn(db, "Quotes desk").slug;
    setDisplayName(db, ensureWorkspace(db, presenter).id, "Presenter");
    setDisplayName(db, ensureWorkspace(db, visitor).id, "Visitor");
    cookieJar.clear();
  });
  afterEach(() => {
    setConfig(original);
    setDb(undefined);
  });

  /** A request to +handler+ as the browser of the workspace +key+, from +site+. */
  async function call(handler: Handler, key: string, init: { method: string; body?: unknown; query?: string; site?: string } = { method: "GET" }) {
    cookieJar.set(WORKSPACE_COOKIE, key);
    const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": init.site ?? "same-origin" };
    const response = await (handler as (request: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>)(
      new Request(`${ORIGIN}/api/applications/${slug}/presets${init.query ?? ""}`, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
      { params: Promise.resolve({ slug }) },
    );
    const text = await response.text();
    return { status: response.status, body: (text.startsWith("{") ? JSON.parse(text) : {}) as Record<string, unknown> & { presets: { publicId: string; name: string; updatedByName: string | null; lockVersion: number }[]; chosen: string | null } };
  }

  it("lets one workspace create a preset that another sees and edits, recording each one's display name", async () => {
    const created = await call(POST, presenter, { method: "POST", body: ADMIN });
    expect(created.status).toBe(201);
    const preset = created.body.presets[0]!;
    expect(preset).toMatchObject({ name: "Admin user", updatedByName: "Presenter" });

    const seen = await call(GET, visitor);
    expect(seen.body.presets.map((each) => each.name)).toEqual(["Admin user"]);
    expect(seen.body.chosen).toBeNull();

    const edited = await call(PATCH, visitor, { method: "PATCH", query: `?preset=${preset.publicId}`, body: { ...ADMIN, entries: [{ store: "cookie", name: "desk-region", value: "new-york" }], lockVersion: preset.lockVersion } });
    expect(edited.status).toBe(200);
    expect(edited.body.presets[0]).toMatchObject({ updatedByName: "Visitor", lockVersion: 1 });

    // The presenter's edit from the version they read is refused, with the newer entries.
    const stale = await call(PATCH, presenter, { method: "PATCH", query: `?preset=${preset.publicId}`, body: { ...ADMIN, lockVersion: preset.lockVersion } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ errors: { base: ["Someone else changed this preset since you opened it. Its newer entries are shown; make your change again."] }, preset: { entries: [{ value: "new-york" }] } });
  });

  it("keeps each workspace's choice its own, and deleting a preset removes it for everyone", async () => {
    const preset = (await call(POST, presenter, { method: "POST", body: ADMIN })).body.presets[0]!;
    expect((await call(PUT, presenter, { method: "PUT", body: { preset: preset.publicId } })).body.chosen).toBe(preset.publicId);
    expect((await call(GET, visitor)).body.chosen).toBeNull();
    expect((await call(DELETE, visitor, { method: "DELETE", query: `?preset=${preset.publicId}` })).body.presets).toEqual([]);
    expect((await call(GET, presenter)).body.chosen).toBeNull();
    expect((await call(DELETE, visitor, { method: "DELETE", query: `?preset=${preset.publicId}` })).status).toBe(404);
  });

  it("refuses a change from another origin, and says what's wrong with a preset", async () => {
    expect((await call(POST, presenter, { method: "POST", body: ADMIN, site: "cross-site" })).status).toBe(403);
    expect((await call(GET, presenter)).body.presets).toEqual([]);
    const refused = await call(POST, presenter, { method: "POST", body: { name: "", entries: [{ store: "local", name: "frontend-registry:theme:x", value: "" }] } });
    expect(refused.status).toBe(400);
    expect(refused.body.errors).toEqual({ name: ["Enter a name"], "entries.0.name": ["That name belongs to the Frontend Registry, so a preset can't change it"] });
  });

  it("answers not found for an unknown application, and while previews are off", async () => {
    slug = "no-such-application";
    expect((await call(GET, presenter)).status).toBe(404);
    setConfig(withOverrides(original, { previews: { enabled: false } }));
    expect((await call(POST, presenter, { method: "POST", body: ADMIN })).status).toBe(404);
  });
});
