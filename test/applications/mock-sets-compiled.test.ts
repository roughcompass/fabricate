import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as compiled } from "@/app/api/applications/[slug]/mock-sets/[set]/compiled/route";
import { GET as body } from "@/app/api/applications/[slug]/mock-sets/[set]/bodies/[digest]/route";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { INLINE_BODY_LIMIT, compileSet } from "@/lib/mocks/compile";
import type { MockSet } from "@/lib/mocks/model";
import { createRule, createSet, findSet } from "@/lib/mocks/records";
import { routes } from "@/lib/web/routes";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * A mock set's compiled rules and bodies (add-mock-sets, design decision 2,
 * task 4.3): what the routing worker fetches by revision before it
 * acknowledges an arm, and the bodies too large to inline, by digest. Both
 * are no-store, and not found for anything of another application.
 */

const ORIGIN = "http://127.0.0.1:3100";

describe("the compiled set and body endpoints", () => {
  const original = getConfig();
  let db: Db;
  let storage: string;
  let orders: ViewedApplication;
  let quotes: ViewedApplication;
  let happy: MockSet;
  let large: string;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-compiled-"));
    setConfig(withOverrides(original, { previews: { enabled: true, storage } }));
    orders = viewedApplicationIn(db, "Orders portal");
    quotes = viewedApplicationIn(db, "Quotes desk");
    happy = createSet(db, orders.id, { name: "Happy path" }, null);
    const bytes = new TextEncoder().encode(JSON.stringify({ orders: "x".repeat(INLINE_BODY_LIMIT) }));
    const created = createRule(db, orders.id, happy.publicId, { method: "GET", pattern: "/v1/orders", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [{ status: 200, headers: [], contentType: "application/json", body: bytes, latencyMs: 0 }] }, null);
    large = created.rule.responses[0]!.body!.digest;
    happy = created.set;
  });
  afterEach(() => {
    setConfig(original);
    setDb(undefined);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const getCompiled = async (slug: string, set: string, revision?: number) => {
    const response = await compiled(new Request(`${ORIGIN}${routes.compiledMockSet(slug, set, revision)}`), { params: Promise.resolve({ slug, set }) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: response.status === 200 ? await response.json() : null };
  };
  const getBody = (slug: string, set: string, digest: string) => body(new Request(`${ORIGIN}${routes.mockSetBody(slug, set, digest)}`), { params: Promise.resolve({ slug, set, digest }) });

  it("answers the set compiled as compile makes it, no-store", async () => {
    const answer = await getCompiled(orders.slug, happy.publicId, happy.revision);
    expect([answer.status, answer.cache]).toEqual([200, "no-store"]);
    expect(answer.body).toEqual(JSON.parse(JSON.stringify(compileSet(db, findSet(db, orders.id, happy.publicId)!))));
    expect(answer.body.rules[0].responses[0].body).toEqual({ digest: large, size: expect.any(Number) });
  });

  it("answers a stale revision with the current one, which says its revision", async () => {
    createRule(db, orders.id, happy.publicId, { method: "GET", pattern: "/v1/rates", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [] }, null);
    const answer = await getCompiled(orders.slug, happy.publicId, happy.revision);
    expect(answer.body.revision).toBe(happy.revision + 1);
  });

  it("answers a body by its digest, and an unknown digest with 404", async () => {
    const found = await getBody(orders.slug, happy.publicId, large);
    expect([found.status, found.headers.get("cache-control"), found.headers.get("content-type")]).toEqual([200, "no-store", "application/octet-stream"]);
    expect(JSON.parse(await found.text()).orders).toHaveLength(INLINE_BODY_LIMIT);
    expect((await getBody(orders.slug, happy.publicId, "f".repeat(64))).status).toBe(404);
    expect((await getBody(orders.slug, happy.publicId, "../../../etc/passwd")).status).toBe(404);
  });

  it("finds no set of another application, no unknown set, and nothing while previews are off", async () => {
    expect((await getCompiled(quotes.slug, happy.publicId)).status).toBe(404);
    expect((await getBody(quotes.slug, happy.publicId, large)).status).toBe(404);
    expect((await getCompiled(orders.slug, "mks_0000000000000000")).status).toBe(404);
    expect((await getCompiled("nowhere", happy.publicId)).status).toBe(404);
    setConfig(withOverrides(original, { previews: { enabled: false, storage } }));
    expect((await getCompiled(orders.slug, happy.publicId)).status).toBe(404);
    expect((await getBody(orders.slug, happy.publicId, large)).status).toBe(404);
  });
});
