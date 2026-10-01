import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSource, setSourceEnabled, updateSource } from "@/app/(operator)/sources/actions";
import { assessmentCounts } from "@/lib/catalog/catalog";
import { getSource, insertSource, listSources } from "@/lib/catalog/source-records";
import { type Db, setDb } from "@/lib/db/client";
import { buildAssessment } from "../support/builders";
import { createTestDb } from "../support/db";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value));
  return data;
};
const blank = { values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} };

describe("source Server Actions", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => setDb(undefined));

  it("creates a source and redirects to the catalog with a notice", async () => {
    const location = await redirectOf(createSource(blank, form({ name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "main" })));

    const [source] = listSources(db);
    expect(location).toBe(`/sources?notice=added&source=${source!.publicId}`);
  });

  it("returns field errors without persisting or echoing a secret", async () => {
    const state = await createSource(blank, form({ name: "", cloneUrl: "https://user:hunter2@git.example.com/acme/app.git", gitRef: "" }));

    expect(state.errors.name).toEqual(["Enter a name"]);
    expect(state.errors.cloneUrl?.[0]).toMatch(/cannot contain a username, password, or access token/);
    expect(JSON.stringify(state)).not.toContain("hunter2");
    expect(listSources(db)).toEqual([]);
  });

  it("returns the duplicate source's identity", async () => {
    const existing = insertSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const state = await createSource(blank, form({ name: "copy", cloneUrl: "https://GIT.EXAMPLE.COM/acme/orders", gitRef: "" }));

    expect(state.errors.cloneUrl).toEqual([`This clone URL is already registered as orders (${existing.publicId})`]);
  });

  it("updates a source and reports a stale edit", async () => {
    const source = insertSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const fields = { name: "orders-ui", cloneUrl: source.cloneUrl, gitRef: "", lockVersion: 0 };

    expect(await redirectOf(updateSource(source.publicId, blank, form(fields)))).toBe(`/sources?notice=updated&source=${source.publicId}`);
    const stale = await updateSource(source.publicId, blank, form({ ...fields, name: "stale" }));
    expect(stale.errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getSource(db, source.publicId).name).toBe("orders-ui");
  });

  it("disables and re-enables a source while preserving assessment history", async () => {
    const source = insertSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    buildAssessment(db, { sources: [source] });

    expect(await redirectOf(setSourceEnabled(form({ publicId: source.publicId, enabled: "false" })))).toBe(`/sources?notice=disabled&source=${source.publicId}`);
    expect(getSource(db, source.publicId).enabled).toBe(false);
    expect(assessmentCounts(db).get(source.id)).toBe(1);
    expect(await redirectOf(setSourceEnabled(form({ publicId: source.publicId, enabled: "true" })))).toBe(`/sources?notice=enabled&source=${source.publicId}`);
  });

  it("refuses to enable a duplicate of an enabled source", async () => {
    insertSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const duplicate = insertSource(db, { name: "old", cloneUrl: "https://git.example.com/acme/orders", canonicalUrl: "https://git.example.com/acme/orders", enabled: false });

    expect(await redirectOf(setSourceEnabled(form({ publicId: duplicate.publicId, enabled: "true" })))).toBe(`/sources?notice=enable-conflict&source=${duplicate.publicId}`);
    expect(getSource(db, duplicate.publicId).enabled).toBe(false);
  });

  it("rejects a malformed source id", async () => {
    await expect(setSourceEnabled(form({ publicId: "../../etc", enabled: "true" }))).rejects.toThrow(/Unknown repository source/);
  });
});
