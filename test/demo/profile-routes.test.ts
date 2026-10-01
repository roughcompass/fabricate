import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { createProfile, listProfiles } from "@/lib/demo/profiles";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace, findWorkspace } from "@/lib/demo/workspaces";
import { createTestDb } from "../support/db";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const PRIYA = { name: "Priya Shah", persona: "Approver", region: "Mumbai" };

// The session profile routes (template-demo/toolbar spec): authorized by the
// visitor's workspace, like the comment routes.
describe("profile route handlers", () => {
  let db: Db;
  let ownerKey: string;
  let strangerKey: string;
  let owner: number;

  const routes = async () => ({ list: await import("@/app/api/demo/profiles/route"), one: await import("@/app/api/demo/profiles/[profileId]/route") });
  const request = (method: string, body?: unknown) => new Request("http://localhost/api/demo/profiles", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const params = (profileId: string) => ({ params: Promise.resolve({ profileId }) });

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    ownerKey = newWorkspaceKey();
    strangerKey = newWorkspaceKey();
    owner = ensureWorkspace(db, ownerKey).id;
    ensureWorkspace(db, strangerKey);
    cookieJar.clear();
    setConfig(withOverrides(getConfig(), { demo: { enabled: true } }));
  });
  afterEach(() => setDb(undefined));

  it("lists, creates, edits, and deletes the visitor's profiles", async () => {
    const { list, one } = await routes();
    cookieJar.set(WORKSPACE_COOKIE, ownerKey);
    expect(await (await list.GET()).json()).toEqual({ profiles: [] });

    const created = await list.POST(request("POST", PRIYA));
    expect(created.status).toBe(201);
    const { profile } = (await created.json()) as { profile: { id: string } };
    expect(profile).toMatchObject({ ...PRIYA, builtIn: false });

    const edited = await one.PATCH(request("PATCH", { ...PRIYA, persona: "Analyst" }), params(profile.id));
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { profiles: { persona: string }[] }).profiles.map((entry) => entry.persona)).toEqual(["Analyst"]);

    expect((await one.DELETE(request("DELETE"), params(profile.id))).status).toBe(200);
    expect(listProfiles(db, owner)).toEqual([]);
  });

  it("creates the workspace on a first profile", async () => {
    const { list } = await routes();
    const fresh = newWorkspaceKey();
    cookieJar.set(WORKSPACE_COOKIE, fresh);
    expect(await (await list.GET()).json()).toEqual({ profiles: [] });
    expect((await list.POST(request("POST", PRIYA))).status).toBe(201);
    expect(listProfiles(db, findWorkspace(db, fresh)!.id)).toHaveLength(1);
  });

  it("explains invalid fields, a duplicate name, and the profile limit", async () => {
    const { list } = await routes();
    cookieJar.set(WORKSPACE_COOKIE, ownerKey);
    expect(await (await list.POST(request("POST", { name: "", persona: "Owner", region: "Mumbai" }))).json()).toEqual({ errors: { name: ["Enter a name"], persona: ["Choose a persona"] } });
    const duplicate = await list.POST(request("POST", { ...PRIYA, name: "sam rivera" }));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({ errors: { name: ["A profile with that name already exists"] } });
    for (let index = 0; index < 20; index++) createProfile(db, owner, { ...PRIYA, name: `Visitor ${index}` });
    expect(await (await list.POST(request("POST", PRIYA))).json()).toEqual({ errors: { base: ["You have 20 custom profiles, the most a demo workspace can hold. Delete a profile to create another."] } });
    expect((await list.POST(new Request("http://localhost/api/demo/profiles", { method: "POST", body: "x".repeat(17 * 1024) }))).status).toBe(413);
  });

  it("answers not found for another workspace's profile", async () => {
    const { list, one } = await routes();
    const priya = createProfile(db, owner, PRIYA);
    cookieJar.set(WORKSPACE_COOKIE, strangerKey);
    expect(await (await list.GET()).json()).toEqual({ profiles: [] });
    expect((await one.PATCH(request("PATCH", { ...PRIYA, region: "Pune" }), params(priya.id))).status).toBe(404);
    expect((await one.DELETE(request("DELETE"), params(priya.id))).status).toBe(404);
    // Without a workspace at all, too.
    cookieJar.delete(WORKSPACE_COOKIE);
    expect((await one.DELETE(request("DELETE"), params(priya.id))).status).toBe(404);
    expect(listProfiles(db, owner)[0]?.region).toBe("Mumbai");
  });

  it("refuses to patch or delete a built-in profile", async () => {
    const { one } = await routes();
    cookieJar.set(WORKSPACE_COOKIE, ownerKey);
    for (const id of ["analyst", "approver", "administrator"]) {
      expect((await one.PATCH(request("PATCH", PRIYA), params(id))).status).toBe(403);
      expect((await one.DELETE(request("DELETE"), params(id))).status).toBe(403);
    }
  });

  it("answers 404 everywhere while the demo is disabled", async () => {
    const { list, one } = await routes();
    const priya = createProfile(db, owner, PRIYA);
    cookieJar.set(WORKSPACE_COOKIE, ownerKey);
    setConfig(withOverrides(getConfig(), { demo: { enabled: false } }));
    try {
      expect((await list.GET()).status).toBe(404);
      expect((await list.POST(request("POST", PRIYA))).status).toBe(404);
      expect((await one.PATCH(request("PATCH", PRIYA), params(priya.id))).status).toBe(404);
      expect((await one.DELETE(request("DELETE"), params(priya.id))).status).toBe(404);
      expect((await one.PATCH(request("PATCH", PRIYA), params("approver"))).status).toBe(404);
    } finally {
      setConfig(withOverrides(getConfig(), { demo: { enabled: true } }));
    }
  });
});
