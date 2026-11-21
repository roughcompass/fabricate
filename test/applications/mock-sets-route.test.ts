import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "@/app/api/applications/[slug]/mock-sets/route";
import { PUT } from "@/app/api/applications/[slug]/mock-sets/choice/route";
import { PATCH as PATCH_RULE, POST as POST_RULE } from "@/app/api/applications/[slug]/mock-sets/[set]/rules/route";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { chosenSet } from "@/lib/mocks/active";
import { setApplicationDefault } from "@/lib/mocks/defaults";
import { createSet } from "@/lib/mocks/records";
import { routes } from "@/lib/web/routes";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { ensureWorkspace, setDisplayName } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { savedPreviewIn, viewedApplicationIn } from "../support/views";

/*
 * The mock sets' endpoints (add-mock-sets, task 4.2): any workspace on the
 * Frontend Registry's own origin creates and edits an application's sets and
 * rules, recorded with its display name; a stale edit answers 409 with the
 * current values; a set of another application isn't found; choosing writes
 * only the caller's row; a change from another origin is refused; and
 * everything is not found while previews are off.
 */

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined) }) }));

const ORIGIN = "http://127.0.0.1:3100";
type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const RULE = {
  method: "GET",
  pattern: "/v1/accounts/:id",
  query: { mode: "ignore_all" },
  body: { mode: "ignore" },
  responses: [{ status: 200, headers: [["X-Request-Id", "1"]], contentType: "application/json", body: { text: '{"name":"Northwind Traders"}' }, latencyMs: 0 }],
};

describe("the mock sets endpoints", () => {
  const original = getConfig();
  let db: Db;
  let storage: string;
  let orders: ViewedApplication;
  let quotes: ViewedApplication;
  const presenter = newWorkspaceKey();
  const visitor = newWorkspaceKey();
  let presenterId: number;
  let visitorId: number;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-route-"));
    setConfig(withOverrides(original, { previews: { enabled: true, storage } }));
    orders = viewedApplicationIn(db, "Orders portal");
    quotes = viewedApplicationIn(db, "Quotes desk");
    presenterId = ensureWorkspace(db, presenter).id;
    visitorId = ensureWorkspace(db, visitor).id;
    setDisplayName(db, presenterId, "Presenter");
    setDisplayName(db, visitorId, "Visitor");
    cookieJar.clear();
  });
  afterEach(() => {
    setConfig(original);
    setDb(undefined);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /** A request to +handler+ at +address+, as the browser of the workspace +key+, from +site+. */
  async function call(handler: Handler, address: string, params: Record<string, string>, key: string, init: { method?: string; body?: unknown; site?: string } = {}) {
    cookieJar.set(WORKSPACE_COOKIE, key);
    const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": init.site ?? "same-origin" };
    const response = await handler(new Request(`${ORIGIN}${address}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(params) });
    const text = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, cache: response.headers.get("cache-control"), body: (text.startsWith("{") ? JSON.parse(text) : {}) as Record<string, any> };
  }
  const sets = (key: string, slug = orders.slug, query = "") => call(GET as Handler, `${routes.mockSetsApi(slug)}${query}`, { slug }, key);
  const create = (key: string, body: unknown, options: { slug?: string; site?: string } = {}) => call(POST as Handler, routes.mockSetsApi(options.slug ?? orders.slug), { slug: options.slug ?? orders.slug }, key, { method: "POST", body, site: options.site });
  const addRule = (key: string, set: string, body: unknown, slug = orders.slug) => call(POST_RULE as Handler, routes.mockRulesApi(slug, set), { slug, set }, key, { method: "POST", body });
  const editRule = (key: string, set: string, rule: string, body: unknown) => call(PATCH_RULE as Handler, `${routes.mockRulesApi(orders.slug, set)}?rule=${rule}`, { slug: orders.slug, set }, key, { method: "PATCH", body });
  const choose = (key: string, set: string | null, query = "") => call(PUT as Handler, `${routes.mockSetChoiceApi(orders.slug)}${query}`, { slug: orders.slug }, key, { method: "PUT", body: { set } });

  it("lists the application's sets with the view's active set, no-store, and creates an empty one", async () => {
    const created = await create(presenter, { name: "Happy path", description: "Every call answered" });
    expect(created.status).toBe(201);
    expect(created.body.set).toMatchObject({ name: "Happy path", source: "written", ruleCount: 0, revision: 1, createdByName: "Presenter" });
    setApplicationDefault(db, orders.id, created.body.set.publicId);
    const listed = await sets(visitor);
    expect(listed.cache).toBe("no-store");
    expect(listed.body.sets.map((set: { name: string; isDefault: boolean }) => [set.name, set.isDefault])).toEqual([["Happy path", true]]);
    expect(listed.body.active).toEqual({ set: { publicId: created.body.set.publicId, name: "Happy path", revision: 1 }, source: "application" });
    expect(listed.body.chosen).toBeNull();
    expect((await sets(visitor, quotes.slug)).body.sets).toEqual([]);
  });

  it("refuses a request from another origin", async () => {
    expect((await create(presenter, { name: "Happy path" }, { site: "cross-site" })).status).toBe(403);
    const set = createSet(db, orders.id, { name: "Happy path" }, null);
    expect((await call(POST_RULE as Handler, routes.mockRulesApi(orders.slug, set.publicId), { slug: orders.slug, set: set.publicId }, presenter, { method: "POST", body: RULE, site: "cross-site" })).status).toBe(403);
    expect((await call(PUT as Handler, routes.mockSetChoiceApi(orders.slug), { slug: orders.slug }, presenter, { method: "PUT", body: { set: null }, site: "same-site" })).status).toBe(403);
    expect((await sets(presenter)).body.sets.map((each: { ruleCount: number }) => each.ruleCount)).toEqual([0]);
  });

  it("lets a second workspace edit a rule another made, and answers a stale edit with 409 and the current values", async () => {
    const set = createSet(db, orders.id, { name: "Happy path" }, "Presenter");
    const added = await addRule(presenter, set.publicId, RULE);
    expect(added.status).toBe(201);
    expect(added.body.set).toEqual({ publicId: set.publicId, revision: 2, ruleCount: 1 });
    const rule = added.body.rule;
    expect(rule).toMatchObject({ pattern: "/v1/accounts/:id", createdByName: "Presenter", enabled: true, needsResponse: false });

    const visitorEdit = await editRule(visitor, set.publicId, rule.publicId, { ...RULE, responses: [{ ...RULE.responses[0], body: { text: '{"name":"Contoso"}' } }], lockVersion: rule.lockVersion });
    expect(visitorEdit.status).toBe(200);
    expect(visitorEdit.body.rule).toMatchObject({ updatedByName: "Visitor", createdByName: "Presenter", lockVersion: 1 });

    const stale = await editRule(presenter, set.publicId, rule.publicId, { ...RULE, lockVersion: rule.lockVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.errors.base).toEqual(["Someone else changed this rule since you opened it. Its newer values are shown; make your change again."]);
    expect(stale.body.rule).toMatchObject({ updatedByName: "Visitor", lockVersion: 1, responses: [{ status: 200, headers: [["X-Request-Id", "1"]] }] });

    // A set's settings are refused the same way.
    const first = await call(PATCH as Handler, `${routes.mockSetsApi(orders.slug)}?set=${set.publicId}`, { slug: orders.slug }, visitor, { method: "PATCH", body: { name: "Happy path", unmatched: "not_mocked", lockVersion: 0 } });
    expect(first.body.set).toMatchObject({ unmatched: "not_mocked", updatedByName: "Visitor" });
    const second = await call(PATCH as Handler, `${routes.mockSetsApi(orders.slug)}?set=${set.publicId}`, { slug: orders.slug }, presenter, { method: "PATCH", body: { name: "Renamed", lockVersion: 0 } });
    expect([second.status, second.body.set.name]).toEqual([409, "Happy path"]);
  });

  it("adds a rule without a response as Needs a response, and says what's wrong with a rule", async () => {
    const set = createSet(db, orders.id, { name: "Happy path" }, null);
    const empty = await addRule(presenter, set.publicId, { ...RULE, pattern: "/v1/rates", responses: [] });
    expect(empty.body.rule).toMatchObject({ enabled: false, needsResponse: true });
    const refused = await addRule(presenter, set.publicId, { ...RULE, responses: [{ ...RULE.responses[0], headers: [["Set-Cookie", "a=1"]], body: { text: '{"name":' } }] });
    expect(refused.status).toBe(400);
    expect(refused.body.errors).toEqual({ "responses.0.headers": ["A mocked response can't set cookies. Remove the Set-Cookie header."], "responses.0.body": ["The body isn't valid JSON. Check its brackets, quotes, and commas."] });
  });

  it("finds no set of another application", async () => {
    const theirs = createSet(db, quotes.id, { name: "Quotes" }, null);
    expect((await addRule(presenter, theirs.publicId, RULE)).status).toBe(404);
    expect((await choose(presenter, theirs.publicId)).status).toBe(404);
    expect((await addRule(presenter, "mks_0000000000000000", RULE)).status).toBe(404);
  });

  it("writes only the caller's choice for the view, and None as a choice", async () => {
    const happy = createSet(db, orders.id, { name: "Happy path" }, null);
    const errors = createSet(db, orders.id, { name: "Errors" }, null);
    setApplicationDefault(db, orders.id, happy.publicId);
    const preview = savedPreviewIn(db, orders);

    const chosen = await choose(presenter, errors.publicId);
    expect(chosen.body).toEqual({ chosen: { set: errors.publicId }, active: { set: { publicId: errors.publicId, name: "Errors", revision: 1 }, source: "choice" } });
    expect(chosenSet(db, visitorId, orders.id, null)).toBeUndefined();
    expect((await sets(visitor)).body.active.source).toBe("application");
    expect((await sets(presenter)).body.chosen).toEqual({ set: errors.publicId });

    // The saved preview's view is another view.
    expect((await choose(presenter, null, `?preview=${preview.key}`)).body.active).toEqual({ set: null, source: "choice" });
    expect((await sets(presenter, orders.slug, `?preview=${preview.key}`)).body.chosen).toEqual({ set: null });
    expect(chosenSet(db, presenterId, orders.id, null)?.set?.name).toBe("Errors");
    expect((await choose(presenter, null, "?preview=no-such-preview")).status).toBe(404);
  });

  it("answers not found for an unknown application, and while previews are off", async () => {
    expect((await sets(presenter, "no-such-application")).status).toBe(404);
    setConfig(withOverrides(original, { previews: { enabled: false, storage } }));
    expect((await sets(presenter)).status).toBe(404);
    expect((await create(presenter, { name: "Happy path" })).status).toBe(404);
    expect((await choose(presenter, null)).status).toBe(404);
    expect((await addRule(presenter, createSet(db, orders.id, { name: "Off" }, null).publicId, RULE)).status).toBe(404);
  });
});
